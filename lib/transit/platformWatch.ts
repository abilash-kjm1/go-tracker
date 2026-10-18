import 'server-only';

import webpush from 'web-push';
import { findTrip, getRoute, getStop } from './gtfs';
import { getProvider } from './provider';
import { getLiveBoard } from './sources/goTrackerBoards';
import type { TripDetail } from './types';
import { durable, list, put, readOne, remove, writeOne } from '../server/store';
import { deviceId, dropDevice } from './pushDevice';

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
/** One record, overwritten each tick, holding how the last few runs went. */
const STATUS_KEY = 'platform-watch-status';
/** How many runs to keep. Enough to tell a blip from something that is broken. */
const HISTORY = 20;
/**
 * A tick must finish well inside the scheduler's timeout, so past this it stops
 * starting new work and reports what it managed. A run that is cut short is far
 * better than one the scheduler records as a failure.
 */
const BUDGET_MS = 18_000;

export interface TickRun {
  at: number;
  ok: boolean;
  ms: number;
  checked: number;
  notified: number;
  /** Why it failed, when it did. */
  error?: string;
  /** True when the time budget stopped it early. */
  cutShort?: boolean;
}

export interface TickStatus {
  lastAt: number;
  lastOk: boolean;
  /** Consecutive failures ending with the most recent run. */
  failingStreak: number;
  recent: TickRun[];
}

export async function readTickStatus(): Promise<TickStatus | null> {
  return readOne<TickStatus>(STATUS_KEY).catch(() => null);
}

/** Appends one run to the record. One read and one write, whatever happened. */
export async function recordTick(run: TickRun): Promise<TickStatus | null> {
  const previous = await readTickStatus();
  const recent = [run, ...(previous?.recent ?? [])].slice(0, HISTORY);
  let failingStreak = 0;
  for (const entry of recent) {
    if (entry.ok) break;
    failingStreak += 1;
  }
  const status: TickStatus = { lastAt: run.at, lastOk: run.ok, failingStreak, recent };

  // Null means the record did not survive, which the caller must be able to
  // tell apart from a clean run: a streak counted from a history that was never
  // written would reset to one every single time, and a store outage would look
  // like an unbroken series of first failures.
  try {
    await writeOne(STATUS_KEY, status);
  } catch {
    return null;
  }
  return status;
}

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
  /** Delivery attempts that failed for a reason worth retrying. */
  attempts?: number;
}

/** After this many failed sends, stop trying this one. */
const MAX_SEND_ATTEMPTS = 5;

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
  return (await readTickStatus())?.lastAt ?? null;
}

export interface TickResult {
  checked: number;
  notified: number;
  expired: number;
  stops: number;
  /** The push service said the phone is no longer there. */
  gone?: number;
  /** Left in place to try again on the next tick. */
  retrying?: number;
  /** Given up on after too many failures. */
  abandoned?: number;
  /** Set when the time budget stopped the run before it finished. */
  cutShort?: boolean;
}

/**
 * Checks every watch and pushes the ones whose platform has appeared. Called by
 * an outside scheduler, because a serverless app cannot wake itself up.
 */
export async function runPlatformTick(now = Date.now()): Promise<TickResult> {
  const deadline = now + BUDGET_MS;
  const outOfTime = () => Date.now() > deadline;

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
    if (outOfTime()) {
      result.cutShort = true;
      break;
    }
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
      if (outOfTime()) {
        result.cutShort = true;
        break;
      }
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

    await settleWatch(entry.key, watch, sent, result);
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

    await settleWatch(entry.key, watch, sent, result);
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

/**
 * What became of one notification.
 *
 * The difference matters more than it looks. This used to return a plain
 * boolean and the caller deleted the watch whichever way it went — so a
 * single bad minute at Google's push service, a 500 or a dropped connection,
 * silently cancelled a rider's platform alert for good. A platform is posted
 * once; there is no second chance to catch it. `failed` now means try again
 * on the next tick, sixty seconds later, and only `gone` means the phone is
 * really not there any more.
 */
export type SendOutcome = 'sent' | 'gone' | 'failed';

async function sendPush(
  subscription: PushSubscriptionRecord,
  payload: { title: string; body: string; url: string; tag: string },
): Promise<SendOutcome> {
  if (!pushConfigured()) return 'failed';
  try {
    await webpush.sendNotification(subscription, JSON.stringify(payload), {
      TTL: 600,
      // Without this, a push service is free to hold the notification until
      // the phone next wakes on its own — which is how alerts end up arriving
      // in a batch the moment the app is opened, long after they mattered.
      // A platform number has a useful life of minutes, so it goes now.
      urgency: 'high',
    });
    return 'sent';
  } catch (err) {
    const status = (err as { statusCode?: number } | null)?.statusCode;
    if (status === 404 || status === 410) return 'gone';
    return 'failed';
  }
}

/**
 * Act on the outcome: finish with the watch, or leave it for the next tick.
 *
 * A phone the push service says is gone has its device record removed too, so
 * nothing else in the app keeps writing to an address that no longer exists.
 */
async function settleWatch(
  key: string,
  watch: PlatformWatch,
  outcome: SendOutcome,
  result: TickResult,
): Promise<void> {
  if (outcome === 'sent') {
    await remove(SET, key);
    result.notified += 1;
    return;
  }
  if (outcome === 'gone') {
    await remove(SET, key);
    result.gone = (result.gone ?? 0) + 1;
    await dropDevice(deviceId(watch.subscription.endpoint)).catch(() => undefined);
    return;
  }

  // Try again next minute, but not forever: a watch that has failed this many
  // times is failing for a reason a retry will not fix.
  const attempts = (watch.attempts ?? 0) + 1;
  if (attempts >= MAX_SEND_ATTEMPTS) {
    await remove(SET, key);
    result.abandoned = (result.abandoned ?? 0) + 1;
    return;
  }
  await put(SET, key, { ...watch, attempts });
  result.retrying = (result.retrying ?? 0) + 1;
}
