import 'server-only';

import { currentServiceDate, zonedToInstant } from './time';
import {
  getDaySchedule,
  getRelatedStops,
  getRoute,
  getSiteMap,
  getStop,
  nextDateKey,
  type DaySchedule,
  type RawScheduleTrip,
} from './gtfs';
import { getLiveBoard } from './sources/goTrackerBoards';
import type { Departure, Journey } from './types';

/**
 * Journey planning between two places.
 *
 * Direct services first. When none exist — Union to Niagara Falls outside the
 * few through trains, for example — one-change itineraries are built from the
 * published schedule: the connection must be a real stop shared by both legs,
 * with the second leg departing at least MIN_CONNECTION after the first
 * arrives. Nothing is inferred beyond what the timetable states, and a change
 * is always labelled as such so the rider can judge it.
 */

/** Minutes a rider needs between legs at the same stop. */
const MIN_CONNECTION = 5;
/** A change between two stops at one site (station platform to bus loop). */
const MIN_CONNECTION_ACROSS_SITE = 10;
/** Beyond this a "connection" is really just a later trip. */
const MAX_CONNECTION = 75;

export interface JourneyQuery {
  fromStopId: string;
  toStopId: string;
  limit?: number;
  now?: Date;
}

interface LegMatch {
  trip: RawScheduleTrip;
  dateKey: string;
  boardStopId: string;
  alightStopId: string;
  departSeconds: number;
  arriveSeconds: number;
  /** Absolute epoch ms, so day-boundary trips compare correctly. */
  departAt: number;
  arriveAt: number;
}

export async function planJourneys({
  fromStopId,
  toStopId,
  limit = 8,
  now = new Date(),
}: JourneyQuery): Promise<Journey[]> {
  const [fromStop, toStop] = await Promise.all([getStop(fromStopId), getStop(toStopId)]);
  if (!fromStop || !toStop) return [];

  const [fromRelated, toRelated] = await Promise.all([
    getRelatedStops(fromStopId).catch(() => []),
    getRelatedStops(toStopId).catch(() => []),
  ]);
  const fromIds = new Set([fromStopId, ...fromRelated.map((s) => s.id)]);
  const toIds = new Set([toStopId, ...toRelated.map((s) => s.id)]);

  // More than an hour out, live boards have nothing to say about these trips.
  const planningAhead = now.getTime() > Date.now() + 60 * 60_000;

  const { dateKey, secondsOfDay } = currentServiceDate(now);
  const earliest = now.getTime() - 5 * 60_000;
  const latest = now.getTime() + 8 * 3600_000;

  const days: Array<{ key: string; offset: number }> = [
    { key: dateKey, offset: 0 },
    { key: nextDateKey(dateKey), offset: 86_400 },
  ];
  void secondsOfDay;

  const schedules: Array<{ key: string; day: DaySchedule }> = [];
  for (const { key } of days) {
    try {
      schedules.push({ key, day: await getDaySchedule(key) });
    } catch {
      // Outside the snapshot window — skip that day.
    }
  }
  if (!schedules.length) return [];

  // ---- direct services ---------------------------------------------------

  const direct: LegMatch[] = [];
  for (const { key, day } of schedules) {
    for (const trip of day.trips.values()) {
      const match = findLeg(trip, key, fromIds, toIds);
      if (match && match.departAt >= earliest && match.departAt <= latest) direct.push(match);
    }
  }
  direct.sort((a, b) => a.departAt - b.departAt);

  const journeys: Journey[] = [];
  for (const match of direct.slice(0, limit)) {
    const leg = await toLeg(match, planningAhead);
    journeys.push(buildJourney([leg]));
  }

  // Only reach for a change when direct service is thin or absent.
  if (journeys.length >= Math.min(limit, 4)) return journeys.slice(0, limit);

  // ---- one change --------------------------------------------------------

  const siteMap = await getSiteMap().catch(() => new Map<string, string>());
  const transferJourneys = await planWithOneChange({
    planningAhead,
    schedules,
    siteMap,
    fromIds,
    toIds,
    earliest,
    latest,
    // A change is only worth offering if it beats waiting for a direct one.
    beforeTime: journeys[0] ? new Date(journeys[0].arrivalTime).getTime() : Infinity,
    limit: limit - journeys.length,
  });

  // Scarborough to Niagara Falls needs three legs: a train to Union, another to
  // Burlington, then a bus. Nothing above can see a journey like that, and the
  // one change it does find — waiting hours for the through train — is far
  // worse. So the full search always runs here, and the best arrival wins.
  const deepJourneys = await planWithChanges({
    planningAhead,
    schedules,
    siteMap,
    fromIds,
    toIds,
    earliest,
    latest,
    limit,
  });

  const combined: Journey[] = [];
  const seenJourneys = new Set<string>();
  for (const journey of [...journeys, ...transferJourneys, ...deepJourneys]) {
    const key = `${journey.departureTime}:${journey.arrivalTime}:${journey.transfers}`;
    if (seenJourneys.has(key)) continue;
    seenJourneys.add(key);
    combined.push(journey);
  }

  combined.sort(
    (a, b) =>
      new Date(a.arrivalTime).getTime() - new Date(b.arrivalTime).getTime() ||
      a.transfers - b.transfers,
  );

  return combined.slice(0, limit);
}

/** How we reached a stop: by riding a leg, or by walking within one site. */
interface RawLeg {
  trip: RawScheduleTrip;
  dateKey: string;
  boardStopId: string;
  boardSeconds: number;
  alightStopId: string;
  alightSeconds: number;
}

interface Label {
  arriveAt: number;
  leg?: RawLeg;
  walkFrom?: string;
}

/** Most changes a rider will accept before the journey stops being worth it. */
const MAX_CHANGES = 2;

/**
 * A time-expanded search over the whole timetable, one round per leg, so a
 * journey needing two changes is found the same way as one needing none.
 *
 * Each round rides every trip that can be boarded from somewhere reached in the
 * round before, keeping only the earliest arrival at each stop. Walking between
 * the stops of one site (a station and its bus loop) is a round of its own.
 *
 * Search times are computed from each service day's midnight rather than
 * converted stop by stop, which is far cheaper over hundreds of thousands of
 * stop times. The legs that come back are rebuilt with the exact conversion, so
 * what a rider is shown is never the approximation.
 */
async function planWithChanges({
  planningAhead,
  schedules,
  siteMap,
  fromIds,
  toIds,
  earliest,
  latest,
  limit,
}: {
  planningAhead: boolean;
  schedules: Array<{ key: string; day: DaySchedule }>;
  siteMap: Map<string, string>;
  fromIds: Set<string>;
  toIds: Set<string>;
  earliest: number;
  latest: number;
  limit: number;
}): Promise<Journey[]> {
  const dayStart = new Map<string, number>();
  for (const { key } of schedules) dayStart.set(key, zonedToInstant(key, 0).getTime());

  // Which stops share a site, so a change can cross from platform to bus loop.
  const siblings = new Map<string, string[]>();
  const bySite = new Map<string, string[]>();
  for (const [stopId, site] of siteMap) {
    const list = bySite.get(site) ?? [];
    list.push(stopId);
    bySite.set(site, list);
  }
  for (const [stopId, site] of siteMap) {
    siblings.set(stopId, (bySite.get(site) ?? []).filter((id) => id !== stopId));
  }

  const out: Journey[] = [];
  const seen = new Set<number>();
  let from = earliest;

  // Each pass finds the earliest arrival; the next starts a minute later, which
  // walks forward through the day's departures rather than repeating one answer.
  for (let pass = 0; pass < limit && out.length < limit; pass++) {
    const chain = searchOnce(from);
    if (!chain || !chain.legs.length) break;

    const firstDepart =
      (dayStart.get(chain.legs[0].dateKey) ?? 0) + chain.legs[0].boardSeconds * 1000;
    from = firstDepart + 60_000;
    if (seen.has(firstDepart)) continue;
    seen.add(firstDepart);

    const legs = await Promise.all(
      chain.legs.map((leg) =>
        toLeg(
          {
            trip: leg.trip,
            dateKey: leg.dateKey,
            boardStopId: leg.boardStopId,
            alightStopId: leg.alightStopId,
            departSeconds: leg.boardSeconds,
            arriveSeconds: leg.alightSeconds,
            departAt: zonedToInstant(leg.dateKey, leg.boardSeconds).getTime(),
            arriveAt: zonedToInstant(leg.dateKey, leg.alightSeconds).getTime(),
          },
          planningAhead,
        ),
      ),
    );
    out.push(buildJourney(legs));
  }

  return out;

  function searchOnce(notBefore: number): { legs: RawLeg[] } | null {
    const labels = new Map<string, Label>();
    for (const id of fromIds) labels.set(id, { arriveAt: notBefore });
    let marked = new Set<string>(fromIds);

    for (let round = 0; round <= MAX_CHANGES && marked.size; round++) {
      const improved = new Set<string>();

      for (const { key, day } of schedules) {
        const base = dayStart.get(key) ?? 0;
        for (const trip of day.trips.values()) {
          let boardStopId: string | null = null;
          let boardSeconds = 0;
          let boardAt = Infinity;

          for (let i = 0; i < trip.s.length; i++) {
            const [stopId, arrivalSeconds, departureSeconds] = trip.s[i];
            const arriveSec = arrivalSeconds ?? departureSeconds;
            const departSec = departureSeconds ?? arrivalSeconds;

            // Already aboard: can we do better by getting off here?
            if (boardStopId && arriveSec != null) {
              const arriveAt = base + arriveSec * 1000;
              if (arriveAt <= latest && arriveAt < (labels.get(stopId)?.arriveAt ?? Infinity)) {
                labels.set(stopId, {
                  arriveAt,
                  leg: {
                    trip,
                    dateKey: key,
                    boardStopId,
                    boardSeconds,
                    alightStopId: stopId,
                    alightSeconds: arriveSec,
                  },
                });
                improved.add(stopId);
              }
            }

            // Or board here, if we were already standing at this stop in time.
            if (departSec != null && marked.has(stopId)) {
              const ready =
                (labels.get(stopId)?.arriveAt ?? Infinity) +
                (round === 0 ? 0 : MIN_CONNECTION * 60_000);
              const departAt = base + departSec * 1000;
              if (departAt >= ready && departAt <= latest && departAt < boardAt) {
                boardStopId = stopId;
                boardSeconds = departSec;
                boardAt = departAt;
              }
            }
          }
        }
      }

      // Walking to the other stops of the same site counts as reaching them.
      for (const stopId of [...improved]) {
        const arriveAt = labels.get(stopId)?.arriveAt;
        if (arriveAt == null) continue;
        for (const sibling of siblings.get(stopId) ?? []) {
          const walked = arriveAt + MIN_CONNECTION_ACROSS_SITE * 60_000;
          if (walked < (labels.get(sibling)?.arriveAt ?? Infinity)) {
            labels.set(sibling, { arriveAt: walked, walkFrom: stopId });
            improved.add(sibling);
          }
        }
      }

      marked = improved;
    }

    // The best arrival among the destination's stops.
    let bestStop: string | null = null;
    let bestAt = Infinity;
    for (const id of toIds) {
      const at = labels.get(id)?.arriveAt;
      if (at != null && at < bestAt) {
        bestAt = at;
        bestStop = id;
      }
    }
    if (!bestStop) return null;

    const legs: RawLeg[] = [];
    let cursor: string | null = bestStop;
    for (let guard = 0; guard < 12 && cursor; guard++) {
      const label: Label | undefined = labels.get(cursor);
      if (!label) break;
      if (label.leg) {
        legs.push(label.leg);
        cursor = label.leg.boardStopId;
        continue;
      }
      if (label.walkFrom) {
        cursor = label.walkFrom;
        continue;
      }
      break;
    }
    legs.reverse();
    return legs.length ? { legs } : null;
  }
}

/** First boarding at `fromIds` and the first later alighting at `toIds`. */
function findLeg(
  trip: RawScheduleTrip,
  dateKey: string,
  fromIds: Set<string>,
  toIds: Set<string>,
): LegMatch | null {
  let boardIndex = -1;
  let alightIndex = -1;

  for (let i = 0; i < trip.s.length; i++) {
    const stopId = trip.s[i][0];
    if (boardIndex < 0 && fromIds.has(stopId)) boardIndex = i;
    else if (boardIndex >= 0 && toIds.has(stopId)) {
      alightIndex = i;
      break;
    }
  }
  if (boardIndex < 0 || alightIndex < 0) return null;

  const board = trip.s[boardIndex];
  const alight = trip.s[alightIndex];
  const departSeconds = board[2] ?? board[1];
  const arriveSeconds = alight[1] ?? alight[2];
  if (departSeconds == null || arriveSeconds == null) return null;

  return {
    trip,
    dateKey,
    boardStopId: board[0],
    alightStopId: alight[0],
    departSeconds,
    arriveSeconds,
    departAt: zonedToInstant(dateKey, departSeconds).getTime(),
    arriveAt: zonedToInstant(dateKey, arriveSeconds).getTime(),
  };
}

async function planWithOneChange({
  schedules,
  siteMap,
  fromIds,
  toIds,
  earliest,
  latest,
  beforeTime,
  limit,
  planningAhead,
}: {
  schedules: Array<{ key: string; day: DaySchedule }>;
  /** stopId -> canonical id of the site it belongs to. */
  siteMap: Map<string, string>;
  fromIds: Set<string>;
  toIds: Set<string>;
  earliest: number;
  latest: number;
  beforeTime: number;
  limit: number;
  planningAhead: boolean;
}): Promise<Journey[]> {
  if (limit <= 0) return [];

  // Everything reachable from the origin, and everything that reaches the
  // destination — the intersection is where a change can happen.
  const firstLegs = new Map<string, LegMatch[]>();
  const secondLegs = new Map<string, LegMatch[]>();

  // Keyed by site, so a change from a station platform to its bus loop joins.
  const site = (stopId: string) => siteMap.get(stopId) ?? stopId;

  for (const { key, day } of schedules) {
    for (const trip of day.trips.values()) {
      collectFrom(trip, key, fromIds, earliest, latest, firstLegs, site);
      collectTo(trip, key, toIds, secondLegs, site);
    }
  }

  const candidates: Array<{ first: LegMatch; second: LegMatch; wait: number }> = [];

  for (const [siteKey, arrivals] of firstLegs) {
    const departures = secondLegs.get(siteKey);
    if (!departures) continue;

    for (const first of arrivals) {
      let best: { second: LegMatch; wait: number } | null = null;

      for (const second of departures) {
        // Walking between two stops at one site needs longer than staying put.
        const buffer =
          (first.alightStopId === second.boardStopId
            ? MIN_CONNECTION
            : MIN_CONNECTION_ACROSS_SITE) * 60_000;
        const wait = second.departAt - first.arriveAt;
        if (wait < buffer) continue;
        if (wait > MAX_CONNECTION * 60_000) continue;
        if (second.arriveAt >= beforeTime) continue;
        if (!best || second.arriveAt < best.second.arriveAt) best = { second, wait };
      }

      if (best) candidates.push({ first, second: best.second, wait: best.wait });
    }
  }

  // Earliest arrival wins; a shorter wait breaks ties.
  candidates.sort((a, b) => a.second.arriveAt - b.second.arriveAt || a.wait - b.wait);

  const seen = new Set<string>();
  const out: Journey[] = [];
  for (const candidate of candidates) {
    // One suggestion per departure time — not five variations of the same idea.
    const key = `${candidate.first.departAt}:${candidate.second.arriveAt}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const [legA, legB] = await Promise.all([toLeg(candidate.first, planningAhead), toLeg(candidate.second, planningAhead)]);
    out.push(buildJourney([legA, legB]));
    if (out.length >= limit) break;
  }
  return out;
}

function collectFrom(
  trip: RawScheduleTrip,
  dateKey: string,
  fromIds: Set<string>,
  earliest: number,
  latest: number,
  into: Map<string, LegMatch[]>,
  site: (stopId: string) => string,
) {
  const boardIndex = trip.s.findIndex(([stopId]) => fromIds.has(stopId));
  if (boardIndex < 0) return;

  const board = trip.s[boardIndex];
  const departSeconds = board[2] ?? board[1];
  if (departSeconds == null) return;
  const departAt = zonedToInstant(dateKey, departSeconds).getTime();
  if (departAt < earliest || departAt > latest) return;

  for (let i = boardIndex + 1; i < trip.s.length; i++) {
    const [stopId, arr, dep] = trip.s[i];
    const arriveSeconds = arr ?? dep;
    if (arriveSeconds == null) continue;

    const match: LegMatch = {
      trip,
      dateKey,
      boardStopId: board[0],
      alightStopId: stopId,
      departSeconds,
      arriveSeconds,
      departAt,
      arriveAt: zonedToInstant(dateKey, arriveSeconds).getTime(),
    };
    const key = site(stopId);
    const list = into.get(key);
    if (list) list.push(match);
    else into.set(key, [match]);
  }
}

function collectTo(
  trip: RawScheduleTrip,
  dateKey: string,
  toIds: Set<string>,
  into: Map<string, LegMatch[]>,
  site: (stopId: string) => string,
) {
  const alightIndex = trip.s.findIndex(([stopId]) => toIds.has(stopId));
  if (alightIndex <= 0) return;

  const alight = trip.s[alightIndex];
  const arriveSeconds = alight[1] ?? alight[2];
  if (arriveSeconds == null) return;
  const arriveAt = zonedToInstant(dateKey, arriveSeconds).getTime();

  for (let i = 0; i < alightIndex; i++) {
    const [stopId, arr, dep] = trip.s[i];
    const departSeconds = dep ?? arr;
    if (departSeconds == null) continue;

    const match: LegMatch = {
      trip,
      dateKey,
      boardStopId: stopId,
      alightStopId: alight[0],
      departSeconds,
      arriveSeconds,
      departAt: zonedToInstant(dateKey, departSeconds).getTime(),
      arriveAt,
    };
    const key = site(stopId);
    const list = into.get(key);
    if (list) list.push(match);
    else into.set(key, [match]);
  }
}

/** Turns a schedule match into a rider-facing leg, with live data applied. */
async function toLeg(match: LegMatch, planningAhead: boolean): Promise<Departure> {
  const [route, boardStop, alightStop, board] = await Promise.all([
    getRoute(match.trip.r),
    getStop(match.boardStopId),
    getStop(match.alightStopId),
    // Live boards only describe the next few hours; planning ahead is schedule-only.
    planningAhead ? null : getLiveBoard(match.boardStopId).catch(() => null),
  ]);

  const live = board?.byTrip.get(match.trip.n);
  const delaySeconds = live?.delaySeconds;

  const scheduledAt = new Date(match.departAt);
  const arrivalAt = new Date(match.arriveAt);
  const estimated = live?.expectedTime
    ? new Date(live.expectedTime)
    : delaySeconds != null
      ? new Date(match.departAt + delaySeconds * 1000)
      : undefined;
  const arrivalEstimated =
    delaySeconds != null ? new Date(match.arriveAt + delaySeconds * 1000) : arrivalAt;

  return {
    id: `${match.trip.i}:${match.boardStopId}:${match.alightStopId}`,
    stopId: match.boardStopId,
    stopName: boardStop?.name ?? match.boardStopId,
    tripId: match.trip.i,
    tripNumber: match.trip.n,
    vehicleType: route?.type ?? 'unknown',
    routeId: match.trip.r,
    routeName: route?.name,
    routeCode: route?.code,
    serviceCode: match.trip.v || route?.code,
    routeColor: route?.color ?? null,
    origin: boardStop?.name,
    destination: alightStop?.name,
    direction: match.trip.d,
    scheduledTime: scheduledAt.toISOString(),
    estimatedTime: estimated?.toISOString(),
    arrivalTime: arrivalAt.toISOString(),
    arrivalEstimated: arrivalEstimated.toISOString(),
    arrivalStopName: alightStop?.name,
    durationMinutes: Math.max(1, Math.round((match.arriveAt - match.departAt) / 60_000)),
    delaySeconds,
    platform: live?.platform,
    platformNote: live?.platform ? undefined : live?.note,
    cancelled: live?.cancelled === true,
    realtime: Boolean(live),
    updatedAt: new Date().toISOString(),
  };
}

function buildJourney(legs: Departure[]): Journey {
  const first = legs[0];
  const last = legs[legs.length - 1];
  const departureTime = first.scheduledTime;
  const arrivalTime = last.arrivalTime ?? last.scheduledTime;

  const connectionMinutes: number[] = [];
  for (let i = 1; i < legs.length; i++) {
    const previousArrival = new Date(legs[i - 1].arrivalTime ?? legs[i - 1].scheduledTime).getTime();
    const nextDeparture = new Date(legs[i].scheduledTime).getTime();
    connectionMinutes.push(Math.max(0, Math.round((nextDeparture - previousArrival) / 60_000)));
  }

  return {
    id: legs.map((l) => l.id).join('|'),
    legs,
    transfers: legs.length - 1,
    departureTime,
    arrivalTime,
    durationMinutes: Math.max(
      1,
      Math.round((new Date(arrivalTime).getTime() - new Date(departureTime).getTime()) / 60_000),
    ),
    connectionMinutes,
    realtime: legs.some((l) => l.realtime),
  };
}

export const MIN_CONNECTION_MINUTES = MIN_CONNECTION;
export const MIN_CONNECTION_ACROSS_SITE_MINUTES = MIN_CONNECTION_ACROSS_SITE;
