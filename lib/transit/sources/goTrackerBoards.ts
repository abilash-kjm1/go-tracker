import 'server-only';

import { cached } from '../cache';
import { config } from '../config';
import { distanceKm } from '../geo';
import { getRoute, getStop, getStops } from '../gtfs';
import {
  busRowStopCodes,
  parseBusSignage,
  parseBusTerminals,
  parseRailSignage,
  parseUnionDepartures,
  type BusTerminalPlace,
  type LiveBoardRow,
} from '../parsers/goTrackerLiveParser';

/**
 * Live departure boards from the GO Tracker mobile proxy API.
 *
 * This is where platform numbers come from — for trains via the rail signage
 * feed, and for buses via the terminal signage feed. Both are keyless.
 *
 * Rail signage is per corridor + station ("ALL" is accepted for Union only).
 * Bus signage is per terminal, and each row names the GTFS stop id of the bay
 * it departs from, which is what lets a bay land on the right stop.
 */

const BASE =
  process.env.GOTRACKER_LIVE_BASE_URL || 'https://www.gotracker.ca/gotracker/mobile/proxy/web';

async function getJson(path: string): Promise<unknown> {
  const res = await fetch(`${BASE}/${path.replace(/^\//, '')}`, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(config.upstreamTimeoutMs),
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`Board upstream HTTP ${res.status}`);
  // Responses are served with a UTF-8 BOM, which JSON.parse rejects.
  const text = (await res.text()).replace(/^﻿/, '');
  return JSON.parse(text);
}

/** GTFS route id (…-LW) → the corridor code the signage API expects. */
async function corridorCodesFor(stopId: string): Promise<string[]> {
  const stop = await getStop(stopId);
  if (!stop) return [];
  const codes = new Set<string>();
  for (const routeId of stop.routeIds) {
    const route = await getRoute(routeId);
    if (route?.type !== 'train') continue;
    const suffix = routeId.split('-').at(-1);
    if (suffix) codes.add(suffix.toUpperCase());
  }
  return [...codes];
}

async function railBoard(corridor: string, stationCode: string): Promise<LiveBoardRow[]> {
  const result = await cached(
    `board:rail:${corridor}:${stationCode}`,
    config.stationRefreshSeconds,
    async () => parseRailSignage(await getJson(`Messages/Signage/Rail/${corridor}/${stationCode}`)),
  );
  return result.value;
}

/** Union has no corridor signage; it has its own board. */
async function unionBoard(): Promise<LiveBoardRow[]> {
  const result = await cached('board:union', config.stationRefreshSeconds, async () =>
    parseUnionDepartures(await getJson('Messages/Departures/UN')),
  );
  return result.value;
}

async function busTerminals(): Promise<BusTerminalPlace[]> {
  // The terminal list is effectively static; refresh it rarely.
  const result = await cached('board:bus:terminals', 6 * 60 * 60, async () =>
    parseBusTerminals(await getJson('Info/Places/BusTerminal')),
  );
  return result.value;
}

/**
 * Which signage terminal (if any) covers a GTFS bus stop. Matched by position,
 * since the two systems share no identifier at the terminal level. Only the
 * ~16 terminals publish live bay data; every other bus stop is schedule-only.
 */
async function terminalForStop(stopId: string): Promise<BusTerminalPlace | null> {
  const [stop, terminals] = await Promise.all([getStop(stopId), busTerminals()]);
  if (!stop || !terminals.length) return null;

  let best: { terminal: BusTerminalPlace; km: number } | null = null;
  for (const terminal of terminals) {
    const km = distanceKm(stop.lat, stop.lon, terminal.lat, terminal.lon);
    if (!best || km < best.km) best = { terminal, km };
  }
  // Terminal footprints are large, but 500 m keeps unrelated stops out.
  return best && best.km <= 0.5 ? best.terminal : null;
}

async function busBoard(terminalCode: string): Promise<{
  rows: LiveBoardRow[];
  stopCodes: Map<string, string>;
}> {
  const result = await cached(`board:bus:${terminalCode}`, config.stationRefreshSeconds, async () => {
    const payload = await getJson(`Messages/Signage/Bus/${terminalCode}`);
    return { rows: parseBusSignage(payload), stopCodes: busRowStopCodes(payload) };
  });
  return result.value;
}

export interface LiveBoard {
  /** Keyed by public trip number. */
  byTrip: Map<string, LiveBoardRow>;
  /** True when at least one source answered, even if it had no rows. */
  available: boolean;
  /** Distinct operator remarks across the board. */
  remarks: string[];
}

const EMPTY: LiveBoard = { byTrip: new Map(), available: false, remarks: [] };

/**
 * Live board for one stop: platform, expected time, delay and cancellations,
 * keyed by trip number so it can be merged onto scheduled departures.
 *
 * Never throws — a board outage degrades rows to schedule-only.
 */
export async function getLiveBoard(stopId: string): Promise<LiveBoard> {
  try {
    const stop = await getStop(stopId);
    if (!stop) return EMPTY;

    const byTrip = new Map<string, LiveBoardRow>();
    const remarks = new Set<string>();
    let available = false;

    if (stopId === 'UN') {
      // Union publishes its own combined board instead of corridor signage.
      try {
        for (const row of await unionBoard()) byTrip.set(row.tripNumber, row);
        available = true;
      } catch {
        // fall through to schedule-only
      }
    } else if (stop.modes.includes('train')) {
      const corridors = await corridorCodesFor(stopId);
      const boards = await Promise.allSettled(corridors.map((c) => railBoard(c, stopId)));
      for (const board of boards) {
        if (board.status !== 'fulfilled') continue;
        available = true;
        for (const row of board.value) {
          byTrip.set(row.tripNumber, row);
          for (const remark of row.remarks) remarks.add(remark);
        }
      }
    }

    if (stop.modes.includes('bus')) {
      const terminal = await terminalForStop(stopId);
      if (terminal) {
        try {
          const { rows, stopCodes } = await busBoard(terminal.code);
          available = true;
          for (const row of rows) {
            // Only rows that depart from this exact bay belong to this stop.
            const rowStop = stopCodes.get(row.tripNumber);
            if (rowStop && rowStop !== stopId) continue;
            byTrip.set(row.tripNumber, row);
          }
        } catch {
          // Bus board unavailable — trains (if any) still count as available.
        }
      }
    }

    return { byTrip, available, remarks: [...remarks] };
  } catch {
    return EMPTY;
  }
}

/** Exposed for the dev diagnostics page. */
export async function probeBoard(kind: 'rail' | 'bus' | 'terminals', arg?: string) {
  if (kind === 'terminals') return getJson('Info/Places/BusTerminal');
  if (kind === 'bus') return getJson(`Messages/Signage/Bus/${arg || 'brptnT'}`);
  if (arg === 'UN' || arg === 'union') return getJson('Messages/Departures/UN');
  const [corridor, station] = (arg || 'LW/BU').split('/');
  return getJson(`Messages/Signage/Rail/${corridor}/${station}`);
}

/** Bus stops that can show live bays, for the boarding panel's wording. */
export async function stopHasLiveBoard(stopId: string): Promise<boolean> {
  const stop = await getStop(stopId);
  if (!stop) return false;
  if (stop.modes.includes('train')) return true;
  return Boolean(await terminalForStop(stopId));
}

export async function listBusTerminalStops(): Promise<string[]> {
  const [stops, terminals] = await Promise.all([getStops(), busTerminals()]);
  const out: string[] = [];
  for (const stop of stops) {
    if (!stop.modes.includes('bus')) continue;
    if (terminals.some((t) => distanceKm(stop.lat, stop.lon, t.lat, t.lon) <= 0.5)) out.push(stop.id);
  }
  return out;
}
