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

  const combined = [...journeys, ...transferJourneys].sort(
    (a, b) =>
      new Date(a.arrivalTime).getTime() - new Date(b.arrivalTime).getTime() ||
      a.transfers - b.transfers,
  );

  return combined.slice(0, limit);
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
