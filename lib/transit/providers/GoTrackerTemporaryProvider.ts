import 'server-only';

import { cached, peek, upstreamStats } from '../cache';
import { config } from '../config';
import {
  parseStationMessage,
  parseStationStatusJson,
  parseTripLocations,
  parseUpstreamTimestamp,
  sourceToVehicleType,
  toBool,
  toNumber,
  UpstreamError,
  type RawStationStatusRow,
  type RawTripElement,
} from '../parsers/goTrackerParser';
import {
  findTrip,
  getMeta,
  getRelatedStops,
  getRoute,
  getRouteByCorridor,
  getRoutes,
  getScheduledDepartures,
  getStop,
  getStops,
  nextDateKey,
  type ScheduledStopTime,
} from '../gtfs';
import { getPlatformsByTrip } from '../platformSource';
import { getLiveBoard } from '../sources/goTrackerBoards';
import { currentServiceDate, zonedToInstant } from '../time';
import type { DepartureQuery, TransitDataProvider } from '../provider';
import type {
  Departure,
  LiveVehicle,
  ProviderHealth,
  SearchResults,
  TransitAlert,
  TransitRoute,
  TransitStop,
  TripDetail,
  TripStopTime,
  VehicleType,
} from '../types';

const LIVE_KEY = 'gotracker:vehicles';

/** GO names some routes "... Express" outright, e.g. "Oshawa / Finch Express". */
const EXPRESS_NAME = /\bexpress\b/i;

/**
 * Temporary development provider backed by the public GO Tracker service.
 *
 * What the upstream actually gives us (verified against live responses):
 *   - TripLocation: live positions + delays, train rows only (Source="T").
 *   - StationStatus*: currently returns empty TripStatus arrays / an "S4"
 *     error, so departure boards are built from the GTFS schedule and have
 *     live delay applied per trip number.
 *
 * Anything the upstream does not supply — platforms, bus positions — is left
 * absent rather than guessed.
 */
export class GoTrackerTemporaryProvider implements TransitDataProvider {
  readonly id = 'gotracker';
  readonly label = 'GO Tracker (temporary)';

  private lastRawTripXml: string | null = null;
  private lastRawStationJson: string | null = null;

  // ---- upstream plumbing -------------------------------------------------

  private async fetchText(path: string, attempt = 0): Promise<string> {
    const url = `${config.goTracker.baseUrl.replace(/\/$/, '')}/${path.replace(/^\//, '')}`;
    try {
      const res = await fetch(url, {
        headers: {
          Accept: 'application/xml,text/xml,*/*',
          // The upstream 403s requests without a same-site referer.
          Referer: config.goTracker.referer,
          'User-Agent': 'GOTracker-Independent/1.0 (+self-hosted)',
        },
        signal: AbortSignal.timeout(config.upstreamTimeoutMs),
        cache: 'no-store',
      });
      if (!res.ok) throw new UpstreamError(`Upstream HTTP ${res.status}`, String(res.status));
      return await res.text();
    } catch (err) {
      // One retry covers the transient timeouts this service is prone to.
      if (attempt === 0) return this.fetchText(path, 1);
      throw err instanceof UpstreamError
        ? err
        : new UpstreamError(err instanceof Error ? err.message : 'Upstream request failed');
    }
  }

  // ---- static data -------------------------------------------------------

  getStations(): Promise<TransitStop[]> {
    return getStops();
  }

  getStation(stopId: string): Promise<TransitStop | null> {
    return getStop(stopId);
  }

  getRoutes(): Promise<TransitRoute[]> {
    return getRoutes();
  }

  // ---- live vehicles -----------------------------------------------------

  private async loadLiveVehicles(): Promise<LiveVehicle[]> {
    const xml = await this.fetchText('TripLocation/Service/Lang/ALL/en');
    this.lastRawTripXml = xml;
    const rows = parseTripLocations(xml);
    const out: LiveVehicle[] = [];
    for (const row of rows) {
      const vehicle = await this.toLiveVehicle(row);
      if (vehicle) out.push(vehicle);
    }
    return out;
  }

  private async toLiveVehicle(row: RawTripElement): Promise<LiveVehicle | null> {
    const lat = toNumber(row.Latitude);
    const lon = toNumber(row.Longitude);
    const tripNumber = row.TripNumber?.trim() || undefined;

    // Equipment moves are not passenger service; hidden markers are hidden upstream.
    if (toBool(row.IsEquipmentMove)) return null;

    const route = row.CorridorCode ? await getRouteByCorridor(row.CorridorCode) : null;
    const scheduled = tripNumber ? await findTrip(tripNumber) : null;
    // GO reports a train waiting at its terminus as hugely "early" (-1100 s and
    // the like). A service never leaves before its timetabled time, so a
    // negative delay means on time, not a departure 18 minutes ago.
    const rawDelay = toNumber(row.DelaySeconds);
    const delaySeconds = rawDelay != null ? Math.max(0, rawDelay) : undefined;

    const next = scheduled
      ? await this.projectNextStop(scheduled, delaySeconds ?? 0, row.InStationId)
      : null;

    return {
      id: tripNumber ? `trip-${tripNumber}` : `equip-${row.EquipmentCode ?? Math.random()}`,
      tripId: scheduled?.trip.i,
      tripNumber,
      vehicleType: sourceToVehicleType(row.Source),
      serviceId: row.CorridorCode?.trim() || undefined,
      serviceName: row.Corridor?.trim() || row.Service?.trim() || undefined,
      routeId: route?.id,
      routeName: route?.name ?? row.Corridor?.trim(),
      origin: row.StartStation?.trim() || undefined,
      destination: row.Destination?.trim() || row.EndStation?.trim() || undefined,
      latitude: lat ?? Number.NaN,
      longitude: lon ?? Number.NaN,
      delaySeconds,
      isMoving: toBool(row.IsMoving),
      express: toBool(row.Express),
      nextStopId: next?.stopId,
      nextStopName: next?.stopName,
      detail: row.Detail?.trim() || undefined,
      delayReason: row.DelayMemo?.trim() || undefined,
      vehicleLabel: row.EquipmentCode?.trim() || undefined,
      updatedAt: parseUpstreamTimestamp(row.ModifiedDate).toISOString(),
    };
  }

  /**
   * Next stop is derived from the trip's own schedule shifted by the reported
   * delay, floored at the station the upstream says the vehicle is currently
   * at. Nothing is invented: if there is no matching scheduled trip we return
   * no next stop at all.
   */
  private async projectNextStop(
    scheduled: { trip: { s: Array<[string, number | null, number | null]> }; dateKey: string },
    delaySeconds: number,
    inStationId?: string,
  ): Promise<{ stopId: string; stopName: string } | null> {
    const now = Date.now();
    const stops = scheduled.trip.s;
    const atIndex = inStationId ? stops.findIndex(([id]) => id === inStationId) : -1;

    for (let i = Math.max(atIndex + 1, 0); i < stops.length; i++) {
      const [stopId, arr, dep] = stops[i];
      const seconds = arr ?? dep;
      if (seconds == null) continue;
      const eta = zonedToInstant(scheduled.dateKey, seconds).getTime() + delaySeconds * 1000;
      if (eta >= now || atIndex >= 0) {
        const stop = await getStop(stopId);
        return { stopId, stopName: stop?.name ?? stopId };
      }
    }
    return null;
  }

  async getLiveVehicles(): Promise<LiveVehicle[]> {
    const result = await cached(LIVE_KEY, config.liveVehicleRefreshSeconds, () =>
      this.loadLiveVehicles(),
    );
    return result.value;
  }

  /** Same data as getLiveVehicles but with the cache metadata attached. */
  async getLiveVehiclesWithMeta() {
    return cached(LIVE_KEY, config.liveVehicleRefreshSeconds, () => this.loadLiveVehicles());
  }

  // ---- departures --------------------------------------------------------

  async getDepartures(stopId: string, query: DepartureQuery = {}): Promise<Departure[]> {
    return this.buildSiteBoard(stopId, { ...query, direction: query.direction ?? 'departures' });
  }

  async getArrivals(stopId: string, query: DepartureQuery = {}): Promise<Departure[]> {
    return this.buildSiteBoard(stopId, { ...query, direction: 'arrivals' });
  }

  /**
   * A board for the whole site, not just one GTFS stop. GO files a station's
   * bus loop as a separate stop ("Burlington GO" vs "Burlington GO Bus"), so a
   * station-only board silently hides every bus that calls there.
   */
  private async buildSiteBoard(stopId: string, query: DepartureQuery): Promise<Departure[]> {
    const related = await getRelatedStops(stopId).catch(() => []);
    if (!related.length) return this.buildBoard(stopId, query);

    const limit = query.limit ?? 40;
    const boards = await Promise.all(
      [stopId, ...related.map((s) => s.id)].map((id) =>
        this.buildBoard(id, { ...query, limit }).catch(() => [] as Departure[]),
      ),
    );

    return boards
      .flat()
      .sort(
        (a, b) =>
          new Date(a.estimatedTime ?? a.scheduledTime).getTime() -
          new Date(b.estimatedTime ?? b.scheduledTime).getTime(),
      )
      .slice(0, limit);
  }

  private async buildBoard(stopId: string, query: DepartureQuery): Promise<Departure[]> {
    const stop = await getStop(stopId);
    if (!stop) return [];

    const now = query.now ?? new Date();
    const limit = query.limit ?? 40;
    // Over-fetch: roughly half the scheduled rows at a stop are the other
    // direction (a trip that ends here does not depart), and the caller's
    // limit means "rows on the board", not "rows considered".
    const scheduled = await getScheduledDepartures(stopId, {
      now,
      limit: limit * 3 + 10,
      pastMinutes: query.direction === 'arrivals' ? 15 : 8,
      forwardMinutes: 240,
    });

    // Live rows are keyed by trip number; only trains are present upstream today.
    const live = await this.safeLiveVehicles();
    const liveByTrip = new Map(live.filter((v) => v.tripNumber).map((v) => [v.tripNumber!, v]));

    // The mobile-proxy signage board is the platform source: it carries track
    // numbers for trains and bay numbers for buses, plus expected times.
    const board = await getLiveBoard(stopId);

    // Official API platforms take precedence when a key is configured.
    const platforms = await getPlatformsByTrip(stopId);

    // If the upstream station board ever starts returning rows again, they win.
    const stationRows = await this.safeStationStatus(stopId);
    const stationByTrip = new Map<string, RawStationStatusRow>();
    for (const row of stationRows) {
      const num = String(row.TripNumber ?? row.TripNum ?? '').trim();
      if (num) stationByTrip.set(num, row);
    }

    const out: Departure[] = [];
    for (const entry of scheduled) {
      // A service that ends here has no departure; one that starts here has no arrival.
      if (query.direction === 'arrivals' ? entry.isOrigin : entry.isTerminus) continue;

      const route = await getRoute(entry.routeId);
      const vehicleType: VehicleType = route?.type ?? 'unknown';
      const useArrival = query.direction === 'arrivals';
      const baseSeconds = useArrival
        ? (entry.arrivalSeconds ?? entry.departureSeconds)
        : (entry.departureSeconds ?? entry.arrivalSeconds);
      if (baseSeconds == null) continue;

      const scheduledAt = zonedToInstant(entry.dateKey, baseSeconds);
      const vehicle = liveByTrip.get(entry.tripNumber);
      const stationRow = stationByTrip.get(entry.tripNumber);
      const official = platforms.get(entry.tripNumber);
      const boardRow = board.byTrip.get(entry.tripNumber);

      const rawBoardDelay =
        boardRow?.delaySeconds ??
        toNumber(stationRow?.DelaySeconds) ??
        (toNumber(stationRow?.DelayMinute) != null
          ? toNumber(stationRow?.DelayMinute)! * 60
          : undefined) ??
        vehicle?.delaySeconds;
      const delaySeconds = rawBoardDelay != null ? Math.max(0, rawBoardDelay) : undefined;

      // The board's own expected time wins; otherwise apply the delay to schedule.
      const estimated = boardRow?.expectedTime
        ? new Date(boardRow.expectedTime)
        : delaySeconds != null
          ? new Date(scheduledAt.getTime() + delaySeconds * 1000)
          : undefined;

      const [originStop, destinationStop] = await Promise.all([
        getStop(entry.originStopId),
        getStop(entry.destinationStopId),
      ]);

      // "Gets in at ..." — the same delay is assumed to hold to the terminus,
      // which is what GO's own estimates do until a fresh one arrives.
      const arrivalAt =
        entry.terminusArrivalSeconds != null
          ? zonedToInstant(entry.dateKey, entry.terminusArrivalSeconds)
          : undefined;
      const arrivalEstimated =
        arrivalAt && delaySeconds != null
          ? new Date(arrivalAt.getTime() + delaySeconds * 1000)
          : arrivalAt;

      out.push({
        id: `${entry.tripId}:${entry.stopSequence}`,
        stopId,
        stopName: stop.name,
        tripId: entry.tripId,
        tripNumber: entry.tripNumber,
        vehicleType,
        routeId: entry.routeId,
        routeName: route?.name,
        routeCode: route?.code,
        serviceCode: entry.variant || route?.code,
        routeColor: route?.color ?? null,
        origin: originStop?.name ?? undefined,
        // GO's headsign is what is written on the vehicle ("Niagara Falls");
        // the terminus stop name is the internal one ("Niagara Falls Bus
        // Terminal"), so it is only the fallback.
        destination: headsignDestination(entry.headsign) ?? destinationStop?.name,
        direction: entry.direction,
        directionLabel: boardRow?.directionText,
        scheduledTime: scheduledAt.toISOString(),
        estimatedTime: estimated?.toISOString(),
        arrivalTime: arrivalAt?.toISOString(),
        arrivalEstimated: arrivalEstimated?.toISOString(),
        arrivalStopName: destinationStop?.name ?? undefined,
        durationMinutes: arrivalAt
          ? Math.max(1, Math.round((arrivalAt.getTime() - scheduledAt.getTime()) / 60_000))
          : undefined,
        delaySeconds,
        // Platform only when a source actually reports one.
        platform: official?.platform ?? boardRow?.platform ?? boardingLocation(stationRow),
        platformNote: boardRow?.platform ? undefined : boardRow?.note,
        cancelled: isCancelled(stationRow) || official?.cancelled === true || boardRow?.cancelled === true,
        // The live board knows which runs skip stops; failing that, GO names
        // some routes "… Express" outright.
        express:
          boardRow?.isExpress === true || EXPRESS_NAME.test(route?.name ?? '') ? true : undefined,
        realtime: Boolean(vehicle || stationRow || official || boardRow),
        updatedAt: vehicle?.updatedAt ?? new Date().toISOString(),
      });

      if (out.length >= limit) break;
    }

    return out;
  }

  private async safeLiveVehicles(): Promise<LiveVehicle[]> {
    try {
      return await this.getLiveVehicles();
    } catch {
      // A live outage degrades the board to schedule-only; it never empties it.
      return peek<LiveVehicle[]>(LIVE_KEY)?.value ?? [];
    }
  }

  private async safeStationStatus(stopId: string): Promise<RawStationStatusRow[]> {
    try {
      const result = await cached(`gotracker:station:${stopId}`, config.stationRefreshSeconds, async () => {
        const xml = await this.fetchText(
          `StationStatusJSON/Service/StationCd/Lang/ALL/${encodeURIComponent(stopId)}/en`,
        );
        this.lastRawStationJson = xml;
        return parseStationStatusJson(xml).rows;
      });
      return result.value;
    } catch {
      return [];
    }
  }

  // ---- trips -------------------------------------------------------------

  async getTrip(tripId: string): Promise<TripDetail | null> {
    const found = await findTrip(tripId);
    if (!found) return null;
    const { trip, dateKey } = found;

    const route = await getRoute(trip.r);
    const live = (await this.safeLiveVehicles()).find((v) => v.tripNumber === trip.n) ?? null;

    // Only a board that still lists this trip knows whether it runs express,
    // and a board drops a trip once it has gone — so try a few stops along the
    // way. The legacy position feed reports Express="false" even for runs the
    // boards flag as express, so it is only trusted when it says true.
    const probeStops = [trip.s[0], trip.s[Math.floor(trip.s.length / 2)], trip.s.at(-1)]
      .map((entry) => entry?.[0])
      .filter((id, index, all): id is string => Boolean(id) && all.indexOf(id) === index);

    let boardExpress: boolean | undefined;
    for (const stopId of probeStops) {
      const row = (await getLiveBoard(stopId).catch(() => null))?.byTrip.get(trip.n);
      if (row?.isExpress != null) {
        boardExpress = row.isExpress;
        if (boardExpress) break;
      }
    }
    const delaySeconds = live?.delaySeconds;
    const now = Date.now();

    const stops: TripStopTime[] = [];
    let currentMarked = false;
    for (const [stopId, arr, dep] of trip.s) {
      const stop = await getStop(stopId);
      const depSeconds = dep ?? arr;
      const arrSeconds = arr ?? dep;
      const scheduledDeparture = depSeconds != null ? zonedToInstant(dateKey, depSeconds) : undefined;
      const scheduledArrival = arrSeconds != null ? zonedToInstant(dateKey, arrSeconds) : undefined;
      const estimated =
        scheduledDeparture && delaySeconds != null
          ? new Date(scheduledDeparture.getTime() + delaySeconds * 1000)
          : scheduledDeparture;

      let status: TripStopTime['status'] = 'upcoming';
      if (live?.nextStopId) {
        if (stopId === live.nextStopId) {
          status = 'current';
          currentMarked = true;
        } else status = currentMarked ? 'upcoming' : 'departed';
      } else if (estimated) {
        if (estimated.getTime() < now) status = 'departed';
        else if (!currentMarked) {
          status = 'current';
          currentMarked = true;
        }
      }

      stops.push({
        stopId,
        stopName: stop?.name ?? stopId,
        lat: stop?.lat,
        lon: stop?.lon,
        scheduledArrival: scheduledArrival?.toISOString(),
        scheduledDeparture: scheduledDeparture?.toISOString(),
        estimatedDeparture: estimated?.toISOString(),
        status,
      });
    }

    const first = trip.s[0];
    const last = trip.s.at(-1);

    return {
      id: trip.i,
      tripNumber: trip.n,
      vehicleType: route?.type ?? 'unknown',
      routeId: trip.r,
      routeName: route?.name,
      routeCode: route?.code,
      serviceCode: trip.v || route?.code,
      routeColor: route?.color ?? null,
      origin: stops[0]?.stopName,
      // Match the board: GO's headsign is the rider-facing destination.
      destination: headsignDestination(trip.h) ?? stops.at(-1)?.stopName,
      scheduledStart:
        first?.[2] != null ? zonedToInstant(dateKey, first[2]!).toISOString() : undefined,
      scheduledEnd: last?.[1] != null ? zonedToInstant(dateKey, last[1]!).toISOString() : undefined,
      delaySeconds,
      cancelled: false,
      // Positive evidence only: a "false" from an unreliable source must not
      // mask a "true" from a better one.
      express:
        boardExpress === true || live?.express === true || EXPRESS_NAME.test(route?.name ?? '')
          ? true
          : undefined,
      vehicle: live,
      stops,
      updatedAt: live?.updatedAt ?? new Date().toISOString(),
    };
  }

  // ---- search ------------------------------------------------------------

  async search(query: string): Promise<SearchResults> {
    const q = query.trim().toLowerCase();
    if (!q) return { stops: [], routes: [], trips: [] };

    const [stops, routes] = await Promise.all([getStops(), getRoutes()]);

    const stopMatches = rank(stops, q, (s) => [s.name, s.id, s.code]).slice(0, 12);

    // Riders search the code on the bus ("12B"), which is a variant of route
    // 12 — the route itself is what we can offer them.
    const variantBase = /^(\d{1,3})[a-z]$/i.exec(q)?.[1];
    const routeMatches = rank(
      routes,
      q,
      (r) => [r.name, r.code, r.id],
    );
    if (variantBase) {
      const base = routes.find((r) => r.code.toLowerCase() === variantBase);
      if (base && !routeMatches.some((r) => r.id === base.id)) routeMatches.unshift(base);
    }

    const trips: SearchResults['trips'] = [];
    if (/^\d{2,5}$/.test(q)) {
      const { dateKey } = currentServiceDate();
      for (const key of [dateKey, nextDateKey(dateKey)]) {
        const found = await findTrip(q, zonedToInstant(key, 12 * 3600));
        if (found) {
          const route = await getRoute(found.trip.r);
          trips.push({
            id: found.trip.i,
            tripNumber: found.trip.n,
            label: found.trip.h || `${route?.name ?? ''} ${found.trip.n}`.trim(),
            vehicleType: route?.type ?? 'unknown',
          });
          break;
        }
      }
    }

    return { stops: stopMatches, routes: routeMatches.slice(0, 8), trips };
  }

  // ---- alerts ------------------------------------------------------------

  /**
   * Derived strictly from live data: delayed services and operator-published
   * delay reasons. The upstream publishes no network alert feed, so we do not
   * manufacture one.
   */
  async getAlerts(): Promise<TransitAlert[]> {
    const vehicles = await this.safeLiveVehicles();
    const delayed = vehicles.filter((v) => (v.delaySeconds ?? 0) >= 120);

    const byRoute = new Map<string, LiveVehicle[]>();
    for (const v of delayed) {
      const key = v.routeName ?? v.serviceName ?? 'GO network';
      const list = byRoute.get(key);
      if (list) list.push(v);
      else byRoute.set(key, [v]);
    }

    const alerts: TransitAlert[] = [];
    for (const [routeName, list] of byRoute) {
      const worst = Math.max(...list.map((v) => v.delaySeconds ?? 0));
      const reasons = [...new Set(list.map((v) => v.delayReason).filter(Boolean))] as string[];
      alerts.push({
        id: `delay:${routeName}`,
        severity: worst >= 900 ? 'severe' : 'warning',
        title: routeName,
        body:
          `${list.length} ${list.length === 1 ? 'service is' : 'services are'} running late` +
          ` (worst ${Math.round(worst / 60)} min).` +
          (reasons.length ? ` Reported: ${reasons.join('; ')}.` : ''),
        scope: { kind: 'route', id: list[0].routeId, name: routeName },
        vehicleType: list[0].vehicleType,
        updatedAt: list[0].updatedAt,
      });
    }

    alerts.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === 'severe' ? -1 : 1));
    return alerts;
  }

  // ---- health ------------------------------------------------------------

  async health(): Promise<ProviderHealth> {
    let vehicles: LiveVehicle[] = [];
    let connected = true;
    try {
      vehicles = await this.getLiveVehicles();
    } catch {
      connected = false;
      vehicles = peek<LiveVehicle[]>(LIVE_KEY)?.value ?? [];
    }

    const stats = upstreamStats();
    const [stops, routes] = await Promise.all([
      getStops().catch(() => []),
      getRoutes().catch(() => []),
    ]);
    const meta = await getMeta().catch(() => null);
    const cache = peek<LiveVehicle[]>(LIVE_KEY);

    return {
      provider: this.id,
      providerLabel: this.label,
      connected,
      lastSuccessAt: stats.lastSuccessAt ? new Date(stats.lastSuccessAt).toISOString() : null,
      lastErrorAt: stats.lastErrorAt ? new Date(stats.lastErrorAt).toISOString() : null,
      lastError: stats.lastError,
      latencyMs: stats.lastLatencyMs,
      counts: {
        liveVehicles: vehicles.length,
        trainVehicles: vehicles.filter((v) => v.vehicleType === 'train').length,
        busVehicles: vehicles.filter((v) => v.vehicleType === 'bus').length,
        stops: stops.length,
        routes: routes.length,
      },
      staticData: meta
        ? {
            source: `${meta.publisher} GTFS`,
            feedVersion: meta.feedVersion,
            generatedAt: meta.generatedAt,
            datesAvailable: meta.dates,
          }
        : null,
      stale: (cache?.ageSeconds ?? Infinity) > config.staleAfterSeconds,
    };
  }

  // ---- dev helpers -------------------------------------------------------

  /** Raw upstream payloads, exposed only through the guarded /dev/transit page. */
  async probe(kind: 'vehicles' | 'station' | 'message', arg?: string) {
    const started = Date.now();
    if (kind === 'vehicles') {
      const xml = await this.fetchText('TripLocation/Service/Lang/ALL/en');
      return { latencyMs: Date.now() - started, raw: xml, parsed: parseTripLocations(xml).length };
    }
    if (kind === 'station') {
      const xml = await this.fetchText(
        `StationStatusJSON/Service/StationCd/Lang/ALL/${encodeURIComponent(arg ?? 'UN')}/en`,
      );
      return {
        latencyMs: Date.now() - started,
        raw: xml,
        parsed: parseStationStatusJson(xml).rows.length,
      };
    }
    const xml = await this.fetchText(
      `StationMessage/Service/StationCd/Lang/ALL/${encodeURIComponent(arg ?? 'UN')}/en`,
    );
    return { latencyMs: Date.now() - started, raw: xml, parsed: parseStationMessage(xml) ? 1 : 0 };
  }

  lastRaw() {
    return { trips: this.lastRawTripXml, station: this.lastRawStationJson };
  }
}

// ---- shared helpers ------------------------------------------------------

/** GTFS headsigns look like "LW - Aldershot GO" or "21F - Milton GO". */
function headsignDestination(headsign: string | undefined): string | undefined {
  if (!headsign) return undefined;
  const idx = headsign.indexOf(' - ');
  return idx >= 0 ? headsign.slice(idx + 3).trim() : headsign.trim();
}

/**
 * Rider-facing boarding location. Upstream calls it "track"; riders read
 * "Platform". Buses keep whatever bay/stop wording the data supplies.
 */
function boardingLocation(row: RawStationStatusRow | undefined): string | undefined {
  if (!row) return undefined;
  const bay = row.Bay?.trim();
  if (bay) return /^\d+$/.test(bay) ? `Bay ${bay}` : bay;
  const raw = (row.Platform ?? row.Track)?.trim();
  if (!raw) return undefined;
  if (/^\d+[A-Za-z]?$/.test(raw)) return `Platform ${raw}`;
  return raw.replace(/^track\b/i, 'Platform');
}

function isCancelled(row: RawStationStatusRow | undefined): boolean {
  if (!row) return false;
  return (
    toBool(row.IsCancelled) === true ||
    toBool(row.Cancelled) === true ||
    /cancel/i.test(row.Status ?? '')
  );
}

/**
 * GO stop names are dense with abbreviations — "Dundas St. @ Hwy. 407 Park &
 * Ride" — so a search for "highway" or "street" has to reach them.
 */
const ABBREVIATIONS: Array<[RegExp, string]> = [
  [/\bhwy\b/g, 'highway'],
  [/\bst\b/g, 'street'],
  [/\brd\b/g, 'road'],
  [/\bave?\b/g, 'avenue'],
  [/\bdr\b/g, 'drive'],
  [/\bblvd\b/g, 'boulevard'],
  [/\bctr\b/g, 'centre'],
  [/\bterm\b/g, 'terminal'],
  [/\bstn\b/g, 'station'],
  [/\bn\b/g, 'north'],
  [/\bs\b/g, 'south'],
  [/\be\b/g, 'east'],
  [/\bw\b/g, 'west'],
  [/\bu of\b/g, 'university of'],
  [/@/g, 'at'],
];

const expandCache = new Map<string, string>();

/** "Dundas St. @ Hwy. 407" -> "dundas street at highway 407". Memoized. */
function expand(value: string): string {
  const hit = expandCache.get(value);
  if (hit !== undefined) return hit;

  let out = value.toLowerCase().replace(/[.,]/g, ' ');
  for (const [pattern, replacement] of ABBREVIATIONS) out = out.replace(pattern, replacement);
  out = out.replace(/\s+/g, ' ').trim();

  // Bounded so a long-lived process cannot grow this without limit.
  if (expandCache.size < 5000) expandCache.set(value, out);
  return out;
}

/** Small fuzzy ranker: exact > prefix > word-prefix > subsequence. */
function rank<T>(items: T[], query: string, fields: (item: T) => Array<string | undefined>): T[] {
  const expandedQuery = expand(query);
  const scored: Array<{ item: T; score: number }> = [];
  for (const item of items) {
    let best = 0;
    for (const field of fields(item)) {
      if (!field) continue;
      const value = field.toLowerCase();

      // Abbreviation-expanded match, scored just under the literal tiers so a
      // real match always outranks an expanded one.
      const expandedValue = expand(field);
      if (expandedValue !== value || expandedQuery !== query) {
        if (expandedValue === expandedQuery) best = Math.max(best, 95);
        else if (expandedValue.startsWith(expandedQuery)) best = Math.max(best, 75);
        else if (expandedValue.split(' ').some((w) => w.startsWith(expandedQuery)))
          best = Math.max(best, 55);
        else if (expandedValue.includes(expandedQuery)) best = Math.max(best, 35);
      }

      let score = 0;
      if (value === query) score = 100;
      else if (value.startsWith(query)) score = 80;
      else if (value.split(/[\s/–-]+/).some((w) => w.startsWith(query))) score = 60;
      else if (value.includes(query)) score = 40;
      // Subsequence matching only for longer queries — on a short one it
      // drags in unrelated stops that merely contain the letters in order.
      else if (query.length >= 6 && isSubsequence(query, value)) score = 15;
      best = Math.max(best, score);
    }
    if (best > 0) scored.push({ item, score: best });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.map((s) => s.item);
}

function isSubsequence(needle: string, haystack: string): boolean {
  let i = 0;
  for (const ch of haystack) {
    if (ch === needle[i]) i++;
    if (i === needle.length) return true;
  }
  return false;
}

export type { ScheduledStopTime };
