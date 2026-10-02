import 'server-only';

import webpush from 'web-push';
import { findTrip, getRoute, getStop } from './gtfs';
import { getProvider } from './provider';
import { getLiveBoard } from './sources/goTrackerBoards';
import type { TripDetail } from './types';
import { durable, list, put, remove } from '../server/store';

/**
 * Watches that outlive the page: the two things a rider wants to be told while
 * the phone is in a pocket.
 *
 * `platform` — GO holds a platform back until a few minutes before departure,
 * which is exactly when nobody is watching a screen.
 *
 * `arrival` — a stop marked on a journey, so the train reaching it reaches you
 * too. It fires on approach where possible, because a notification as the doors
 * open is too late to be any use.
 *
 * A watch records one phone's interest in one trip at one stop; a tick from an
 * outside scheduler does the checking. Nothing is ever guessed: each fires only
 * on something the live data actually reports.
 */

const SET = 'platform-watch';
/** One record, overwritten each tick, holding when the scheduler last called. */
const HEARTBEAT = 'platform-watch-tick';

export interface PushSubscriptionRecord {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

export type WatchKind = 'platform' | 'arrival';

export interface PlatformWatch {
  kind?: WatchKind;
  subscription: PushSubscriptionRecord;
  stopId: string;
  stopName: string;
  tripId?: string;
  tripNumber: string;
  /** Scheduled time here, so a watch cleans itself up after the train has gone. */
  departsAt: string;
  createdAt: number;
}

/** One watch per phone, kind, trip and stop. */
const watchKey = (endpoint: string, tripNumber: string, stopId: string, kind: WatchKind) =>
  Buffer.from(`${endpoint}|${kind}|${tripNumber}|${stopId}`).toString('base64url').slice(0, 96);

export function pushConfigured(): boolean {
  return Boolean(process.env.VAPID_PRIVATE_KEY && process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY);
}

/** True when a watch set now will still exist when the platform is posted. */
export function watchesSurvive(): boolean {
  return durable;
}

function configureWebPush() {
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT || 'mailto:noreply@example.com',
    process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!,
    process.env.VAPID_PRIVATE_KEY!,
  );
}

export async function addWatch(watch: PlatformWatch): Promise<void> {
  const kind = watch.kind ?? 'platform';
  await put(SET, watchKey(watch.subscription.endpoint, watch.tripNumber, watch.stopId, kind), {
    ...watch,
    kind,
  });
}

export async function dropWatch(
  endpoint: string,
  tripNumber: string,
  stopId: string,
  kind: WatchKind = 'platform',
): Promise<void> {
  await remove(SET, watchKey(endpoint, tripNumber, stopId, kind));
}

export async function listWatches(): Promise<Array<{ key: string; value: PlatformWatch }>> {
  return list<PlatformWatch>(SET);
}

/** When the outside scheduler last called the tick, or null if it never has. */
export async function lastTickAt(): Promise<number | null> {
  const rows = await list<{ at: number }>(HEARTBEAT).catch(() => []);
  return rows[0]?.value?.at ?? null;
}

export interface TickResult {
  checked: number;
  notified: number;
  expired: number;
  stops: number;
}

/**
 * Checks every watch and pushes the ones whose platform has appeared. Called by
 * an outside scheduler, because a serverless app cannot wake itself up.
 */
export async function runPlatformTick(now = Date.now()): Promise<TickResult> {
  // Written before any work, so a tick that fails still proves the scheduler
  // reached us. An alert that never arrives is usually a cron that stopped.
  await put(HEARTBEAT, 'last', { at: now }).catch(() => {});

  const watches = await listWatches();
  const result: TickResult = { checked: watches.length, notified: 0, expired: 0, stops: 0 };
  if (!watches.length) return result;

  // A watch is pointless once the train has gone; give it a few minutes' grace
  // in case the departure slipped.
  const live: typeof watches = [];
  for (const entry of watches) {
    const departs = Date.parse(entry.value.departsAt);
    if (Number.isFinite(departs) && departs + 10 * 60_000 < now) {
      await remove(SET, entry.key);
      result.expired += 1;
      continue;
    }
    live.push(entry);
  }
  if (!live.length) return result;

  const platformWatches = live.filter((entry) => (entry.value.kind ?? 'platform') === 'platform');
  const arrivalWatches = live.filter((entry) => entry.value.kind === 'arrival');

  // One board fetch per stop, however many phones are waiting on it.
  const stopIds = [...new Set(platformWatches.map((entry) => entry.value.stopId))];
  result.stops = stopIds.length;
  const boards = new Map<string, Awaited<ReturnType<typeof getLiveBoard>>>();
  for (const stopId of stopIds) {
    try {
      boards.set(stopId, await getLiveBoard(stopId));
    } catch {
      // A board that will not answer is simply not ready yet.
    }
  }

  // One trip lookup per trip, however many stops are marked on it.
  const trips = new Map<string, TripDetail | null>();
  if (arrivalWatches.length) {
    const provider = await getProvider();
    for (const tripId of new Set(arrivalWatches.map((e) => e.value.tripId).filter(Boolean))) {
      trips.set(tripId!, await provider.getTrip(tripId!).catch(() => null));
    }
  }

  if (pushConfigured()) configureWebPush();

  for (const entry of platformWatches) {
    const { value: watch } = entry;
    const platform = boards.get(watch.stopId)?.byTrip.get(watch.tripNumber)?.platform;
    if (!platform) continue;

    const where = await stopLabel(watch);
    // A notification is plain system text on iOS: no colour, no fonts. The only
    // emphasis available is the bold title line, capitals, and an emoji to
    // carry colour — so the platform gets all three and nothing else competes.
    const shouted = platform.replace(/^platforms?\s*/i, 'PLATFORM ').toUpperCase();
    const sent = await sendPush(watch.subscription, {
      title: `🟢 ${shouted}`,
      body: `${where} · ${await serviceLabel(watch.tripNumber)} at ${clockAt(watch.departsAt)}`,
      url: watch.tripId ? `/trips/${encodeURIComponent(watch.tripId)}` : `/stations/${watch.stopId}`,
      tag: `platform-${watch.tripNumber}-${watch.stopId}`,
    });

    // Delivered or undeliverable, this watch is finished either way.
    await remove(SET, entry.key);
    if (sent) result.notified += 1;
  }

  for (const entry of arrivalWatches) {
    const { value: watch } = entry;
    const stop = watch.tripId
      ? trips.get(watch.tripId)?.stops.find((s) => s.stopId === watch.stopId)
      : undefined;
    // `next` is the train approaching; `current` is it standing there. Either
    // is worth telling someone about, and `departed` means we were too slow.
    if (!stop || (stop.status !== 'next' && stop.status !== 'current' && stop.status !== 'departed')) {
      continue;
    }

    const where = await stopLabel(watch);
    const approaching = stop.status === 'next';
    const sent = await sendPush(watch.subscription, {
      title: approaching ? `🔔 ${where.toUpperCase()} IS NEXT` : `🚉 ARRIVING AT ${where.toUpperCase()}`,
      body: approaching
        ? `${await serviceLabel(watch.tripNumber)} is on its way in.`
        : `${await serviceLabel(watch.tripNumber)} is at ${where} now.`,
      url: watch.tripId ? `/my-trip` : `/stations/${watch.stopId}`,
      tag: `arrival-${watch.tripNumber}-${watch.stopId}`,
    });

    await remove(SET, entry.key);
    if (sent) result.notified += 1;
  }

  return result;
}

/**
 * How a rider names the service: the line code and the trip number, "LW 1639".
 * Falls back to the number alone when the timetable cannot place the trip.
 */
async function serviceLabel(tripNumber: string): Promise<string> {
  try {
    const found = await findTrip(tripNumber);
    const route = found ? await getRoute(found.trip.r) : null;
    if (route?.code) return `${route.code} ${tripNumber}`;
  } catch {
    // The number on its own is still enough to identify the train.
  }
  return `train ${tripNumber}`;
}

/** Departure time as a rider reads it, in Toronto. */
function clockAt(iso: string): string {
  const at = Date.parse(iso);
  if (!Number.isFinite(at)) return 'its scheduled time';
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Toronto',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(at));
}

/** The stop's own name where we have it, falling back to what was saved. */
async function stopLabel(watch: PlatformWatch): Promise<string> {
  const stop = await getStop(watch.stopId).catch(() => null);
  return (stop?.name ?? watch.stopName).replace(/\s+GO(\s+Bus)?$/i, '');
}

async function sendPush(
  subscription: PushSubscriptionRecord,
  payload: { title: string; body: string; url: string; tag: string },
): Promise<boolean> {
  if (!pushConfigured()) return false;
  try {
    await webpush.sendNotification(subscription, JSON.stringify(payload), { TTL: 600 });
    return true;
  } catch {
    // A phone that has uninstalled the app returns 404/410; either way there is
    // nothing useful to do but forget it, which the caller does.
    return false;
  }
}
