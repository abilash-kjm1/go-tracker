import 'server-only';

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { TransitRoute, TransitStop, VehicleType } from './types';
import { currentServiceDate, zonedToInstant } from './time';

/**
 * Static schedule data, built by `npm run gtfs:build` from the official
 * Metrolinx GTFS feed. Real-time data is layered on top of this — the two are
 * never mixed at the source level.
 */

const DATA_DIR = join(process.cwd(), 'data', 'gtfs');

/**
 * Colour for every GO Bus. Orange-700, chosen because nothing else in the app
 * uses it (status is green/amber/red, direction blue/purple/slate/sand,
 * express teal) and because white text on it clears 5:1 contrast.
 */
export const BUS_COLOR = '#c2410c';

interface RawScheduleTrip {
  i: string;
  n: string;
  r: string;
  h: string;
  /** Route variant: "12B", "31M". Absent on trains. */
  v?: string;
  d: 0 | 1;
  /** [stopId, arrivalSeconds, departureSeconds] */
  s: Array<[string, number | null, number | null]>;
}

export interface ScheduledStopTime {
  tripId: string;
  tripNumber: string;
  routeId: string;
  headsign: string;
  /** Route variant ("12B") where GO publishes one. */
  variant?: string;
  direction: 0 | 1;
  stopId: string;
  stopSequence: number;
  arrivalSeconds: number | null;
  departureSeconds: number | null;
  /** First and last stop names of the trip, for "origin → destination". */
  originStopId: string;
  destinationStopId: string;
  /** A trip does not "depart" its terminus, nor "arrive" at its origin. */
  isOrigin: boolean;
  isTerminus: boolean;
  /** Arrival at the trip's last stop, for "gets in at ..." on a board row. */
  terminusArrivalSeconds: number | null;
}

export interface DaySchedule {
  dateKey: string;
  trips: Map<string, RawScheduleTrip>;
  tripsByNumber: Map<string, RawScheduleTrip[]>;
  byStop: Map<string, ScheduledStopTime[]>;
}

export interface GtfsMeta {
  generatedAt: string;
  feedVersion: string | null;
  feedStart: string | null;
  feedEnd: string | null;
  publisher: string;
  dates: string[];
  stops: number;
  routes: number;
  trips: number;
}

let stopsCache: TransitStop[] | null = null;
let stopIndexCache: Map<string, TransitStop> | null = null;
let routesCache: TransitRoute[] | null = null;
let routeIndexCache: Map<string, TransitRoute> | null = null;
let metaCache: GtfsMeta | null = null;
const dayCache = new Map<string, DaySchedule>();

export class GtfsMissingError extends Error {
  constructor(what: string) {
    super(
      `GTFS snapshot missing (${what}). Run "npm run gtfs:build" to generate data/gtfs from the Metrolinx feed.`,
    );
    this.name = 'GtfsMissingError';
  }
}

async function readJson<T>(file: string, what: string): Promise<T> {
  try {
    return JSON.parse(await readFile(join(DATA_DIR, file), 'utf8')) as T;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') throw new GtfsMissingError(what);
    throw err;
  }
}

export async function getMeta(): Promise<GtfsMeta> {
  metaCache ??= await readJson<GtfsMeta>('meta.json', 'meta.json');
  return metaCache;
}

export async function getStops(): Promise<TransitStop[]> {
  if (!stopsCache) {
    const raw = await readJson<Array<TransitStop & { modes: string[] }>>('stops.json', 'stops.json');
    stopsCache = raw.map((s) => ({ ...s, modes: s.modes as VehicleType[] }));
    stopIndexCache = new Map(stopsCache.map((s) => [s.id, s]));
  }
  return stopsCache;
}

export async function getStop(id: string): Promise<TransitStop | null> {
  await getStops();
  return stopIndexCache?.get(id) ?? null;
}

export async function getRoutes(): Promise<TransitRoute[]> {
  if (!routesCache) {
    const raw = await readJson<TransitRoute[]>('routes.json', 'routes.json');
    // GTFS paints bus routes in the same colours as the train corridors they
    // parallel (route 12 is the same burgundy as Lakeshore West), so at a
    // glance a bus reads as a train. Every bus gets one colour of its own; the
    // official per-route colour is still in routes.json if it is ever wanted.
    routesCache = raw.map((route) =>
      route.type === 'bus' ? { ...route, color: BUS_COLOR, textColor: '#ffffff' } : route,
    );
    routeIndexCache = new Map(routesCache.map((r) => [r.id, r]));
  }
  return routesCache;
}

export async function getRoute(id: string): Promise<TransitRoute | null> {
  await getRoutes();
  return routeIndexCache?.get(id) ?? null;
}

/** Route lookup by the code GO Tracker reports on live vehicles ("LW", "GT"). */
export async function getRouteByCorridor(code: string): Promise<TransitRoute | null> {
  const routes = await getRoutes();
  const upper = code.toUpperCase();
  return (
    routes.find((r) => r.type === 'train' && r.id.toUpperCase().endsWith(`-${upper}`)) ??
    routes.find((r) => r.code.toUpperCase() === upper) ??
    null
  );
}

export async function getDaySchedule(dateKey: string): Promise<DaySchedule> {
  const hit = dayCache.get(dateKey);
  if (hit) return hit;

  const raw = await readJson<{ date: string; trips: RawScheduleTrip[] }>(
    join('schedule', `${dateKey}.json`),
    `schedule/${dateKey}.json`,
  );

  const trips = new Map<string, RawScheduleTrip>();
  const tripsByNumber = new Map<string, RawScheduleTrip[]>();
  const byStop = new Map<string, ScheduledStopTime[]>();

  for (const trip of raw.trips) {
    trips.set(trip.i, trip);
    const list = tripsByNumber.get(trip.n);
    if (list) list.push(trip);
    else tripsByNumber.set(trip.n, [trip]);

    const originStopId = trip.s[0]?.[0] ?? '';
    const last = trip.s.at(-1);
    const destinationStopId = last?.[0] ?? '';
    const terminusArrivalSeconds = last ? (last[1] ?? last[2]) : null;

    trip.s.forEach(([stopId, arr, dep], index) => {
      const entry: ScheduledStopTime = {
        tripId: trip.i,
        tripNumber: trip.n,
        routeId: trip.r,
        headsign: trip.h,
        variant: trip.v,
        direction: trip.d,
        stopId,
        stopSequence: index,
        arrivalSeconds: arr,
        departureSeconds: dep,
        originStopId,
        destinationStopId,
        isOrigin: index === 0,
        isTerminus: index === trip.s.length - 1,
        terminusArrivalSeconds,
      };
      const bucket = byStop.get(stopId);
      if (bucket) bucket.push(entry);
      else byStop.set(stopId, [entry]);
    });
  }

  for (const bucket of byStop.values()) {
    bucket.sort((a, b) => (a.departureSeconds ?? 0) - (b.departureSeconds ?? 0));
  }

  const day: DaySchedule = { dateKey, trips, tripsByNumber, byStop };
  dayCache.set(dateKey, day);
  // Keep at most a few days resident; this runs in a warm serverless instance.
  if (dayCache.size > 4) dayCache.delete([...dayCache.keys()][0]);
  return day;
}

export interface ScheduleWindowOptions {
  /** How far back to include already-departed services. */
  pastMinutes?: number;
  /** How far ahead to look. */
  forwardMinutes?: number;
  limit?: number;
  now?: Date;
}

/**
 * Scheduled departures at a stop within a time window, spanning the midnight
 * boundary into the next service date when needed.
 */
export async function getScheduledDepartures(
  stopId: string,
  { pastMinutes = 10, forwardMinutes = 180, limit = 60, now = new Date() }: ScheduleWindowOptions = {},
): Promise<Array<ScheduledStopTime & { dateKey: string; instant: Date }>> {
  const { dateKey, secondsOfDay } = currentServiceDate(now);
  const from = secondsOfDay - pastMinutes * 60;
  const to = secondsOfDay + forwardMinutes * 60;

  const out: Array<ScheduledStopTime & { dateKey: string; instant: Date }> = [];

  const collect = async (key: string, offsetSeconds: number) => {
    let day: DaySchedule;
    try {
      day = await getDaySchedule(key);
    } catch (err) {
      if (err instanceof GtfsMissingError) return; // window edge — not fatal
      throw err;
    }
    for (const entry of day.byStop.get(stopId) ?? []) {
      const dep = entry.departureSeconds ?? entry.arrivalSeconds;
      if (dep == null) continue;
      const shifted = dep + offsetSeconds;
      if (shifted < from || shifted > to) continue;
      out.push({ ...entry, dateKey: key, instant: zonedToInstant(key, dep) });
    }
  };

  await collect(dateKey, 0);
  // Trips belonging to the next service date can still fall inside the window.
  const next = nextDateKey(dateKey);
  await collect(next, 86_400);

  out.sort((a, b) => a.instant.getTime() - b.instant.getTime());
  return out.slice(0, limit);
}

/**
 * Stops with the most scheduled service today — used to give a first-time user
 * somewhere to start instead of an empty home screen. Derived from the feed,
 * not a hand-picked list.
 */
export async function getBusiestStops(limit = 6, mode: VehicleType = 'train'): Promise<TransitStop[]> {
  const { dateKey } = currentServiceDate();
  const [day, stops, routes] = await Promise.all([
    getDaySchedule(dateKey).catch(() => null),
    getStops(),
    getRoutes(),
  ]);
  if (!day) return [];

  const routeType = new Map(routes.map((r) => [r.id, r.type]));
  const counts = new Map<string, number>();
  for (const [stopId, entries] of day.byStop) {
    const relevant = entries.filter((e) => routeType.get(e.routeId) === mode);
    if (relevant.length) counts.set(stopId, relevant.length);
  }

  const byId = new Map(stops.map((s) => [s.id, s]));
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([id]) => byId.get(id))
    .filter((s): s is TransitStop => Boolean(s))
    .slice(0, limit);
}

/**
 * GO splits one physical site into several GTFS stops: "Burlington GO" is the
 * platform, "Burlington GO Bus" is the bus loop 96 m away, and a rider looking
 * at the station would otherwise never see the buses. Co-located stops are
 * matched by their base name and confirmed by distance.
 */
const BASE_NAME = /\s+(go\s+bus|bus\s+terminal|go\s+station|go|bus|terminal|station)\s*$/gi;

function baseName(name: string): string {
  let out = name.trim();
  let previous = '';
  // Strip the trailing qualifiers repeatedly: "Burlington GO Bus" -> "Burlington".
  while (out !== previous) {
    previous = out;
    out = out.replace(BASE_NAME, '').trim();
  }
  return out.toLowerCase();
}

let siteMapCache: Map<string, string> | null = null;

/**
 * Every stop mapped to a canonical id for the site it belongs to, so a change
 * between a station platform and its bus loop counts as one place. Computed
 * once — doing it per stop would be quadratic.
 */
export async function getSiteMap(): Promise<Map<string, string>> {
  if (siteMapCache) return siteMapCache;

  const stops = await getStops();
  const byBase = new Map<string, TransitStop[]>();
  for (const stop of stops) {
    const base = baseName(stop.name);
    if (!base) continue;
    const list = byBase.get(base);
    if (list) list.push(stop);
    else byBase.set(base, [stop]);
  }

  const map = new Map<string, string>();
  for (const group of byBase.values()) {
    // Same name is not enough — cluster on distance so two "Main St" stops in
    // different cities stay separate.
    const unassigned = [...group];
    while (unassigned.length) {
      const seed = unassigned.shift()!;
      const cluster = [seed];
      for (let i = unassigned.length - 1; i >= 0; i--) {
        if (haversineKm(seed.lat, seed.lon, unassigned[i].lat, unassigned[i].lon) <= 0.8) {
          cluster.push(unassigned[i]);
          unassigned.splice(i, 1);
        }
      }
      // Prefer a short code (a station id like "BU") as the canonical id.
      const canonical = cluster.reduce((a, b) => (a.id.length <= b.id.length ? a : b)).id;
      for (const stop of cluster) map.set(stop.id, canonical);
    }
  }

  siteMapCache = map;
  return map;
}

/** Other stops at the same place, excluding the stop itself. */
export async function getRelatedStops(stopId: string): Promise<TransitStop[]> {
  const stop = await getStop(stopId);
  if (!stop) return [];
  const base = baseName(stop.name);
  if (!base) return [];

  const stops = await getStops();
  return stops.filter(
    (other) =>
      other.id !== stop.id &&
      baseName(other.name) === base &&
      // 800 m covers a station and its bus loop without swallowing neighbours.
      haversineKm(stop.lat, stop.lon, other.lat, other.lon) <= 0.8,
  );
}

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

export interface RoutePattern {
  direction: 0 | 1;
  headsign: string;
  /** Stops in travel order, taken from the longest trip in that direction. */
  stops: Array<{ id: string; name: string; lat?: number; lon?: number }>;
  tripCount: number;
}

/**
 * What a route actually serves today, in order. Taken from the longest trip in
 * each direction — short-turns and variants cover a subset of it, so the
 * longest pattern is the one that describes the route.
 */
export async function getRoutePatterns(routeId: string): Promise<RoutePattern[]> {
  const { dateKey } = currentServiceDate();
  const [day, stops] = await Promise.all([
    getDaySchedule(dateKey).catch(() => null),
    getStops(),
  ]);
  if (!day) return [];

  const byId = new Map(stops.map((s) => [s.id, s]));
  const longest = new Map<0 | 1, RawScheduleTrip>();
  const counts = new Map<0 | 1, number>();

  for (const trip of day.trips.values()) {
    if (trip.r !== routeId) continue;
    counts.set(trip.d, (counts.get(trip.d) ?? 0) + 1);
    const current = longest.get(trip.d);
    if (!current || trip.s.length > current.s.length) longest.set(trip.d, trip);
  }

  return [...longest.entries()]
    .map(([direction, trip]) => ({
      direction,
      headsign: trip.h,
      stops: trip.s.map(([id]) => ({
        id,
        name: byId.get(id)?.name ?? id,
        lat: byId.get(id)?.lat,
        lon: byId.get(id)?.lon,
      })),
      tripCount: counts.get(direction) ?? 0,
    }))
    .sort((a, b) => b.tripCount - a.tripCount);
}

export function nextDateKey(dateKey: string): string {
  const y = Number(dateKey.slice(0, 4));
  const m = Number(dateKey.slice(4, 6));
  const d = Number(dateKey.slice(6, 8));
  const next = new Date(Date.UTC(y, m - 1, d) + 86_400_000);
  return `${next.getUTCFullYear()}${String(next.getUTCMonth() + 1).padStart(2, '0')}${String(
    next.getUTCDate(),
  ).padStart(2, '0')}`;
}

/** Finds a scheduled trip by GTFS trip id, or by the public trip number. */
export async function findTrip(
  idOrNumber: string,
  now: Date = new Date(),
): Promise<{ trip: RawScheduleTrip; dateKey: string } | null> {
  const { dateKey } = currentServiceDate(now);
  const candidateDates = [dateKey, nextDateKey(dateKey)];

  // A full GTFS trip id carries its own service date.
  const embedded = /^(\d{8})-/.exec(idOrNumber)?.[1];
  if (embedded) candidateDates.unshift(embedded);

  for (const key of candidateDates) {
    let day: DaySchedule;
    try {
      day = await getDaySchedule(key);
    } catch {
      continue;
    }
    const direct = day.trips.get(idOrNumber);
    if (direct) return { trip: direct, dateKey: key };
    const byNumber = day.tripsByNumber.get(idOrNumber);
    if (byNumber?.length) return { trip: byNumber[0], dateKey: key };
  }
  return null;
}

export type { RawScheduleTrip };
