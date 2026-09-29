import 'server-only';

import webpush from 'web-push';
import { getStop } from './gtfs';
import { getLiveBoard } from './sources/goTrackerBoards';
import { durable, list, put, remove } from '../server/store';

/**
 * "Tell me when my platform is posted."
 *
 * GO holds a platform back until a few minutes before departure, which is
 * exactly when a rider is least able to watch a screen. A watch records one
 * phone's interest in one trip at one stop; a tick from an outside scheduler
 * checks the boards and pushes the moment a real platform appears.
 *
 * Nothing is ever guessed: the notification only fires on a platform the
 * operator has actually published.
 */

const SET = 'platform-watch';

export interface PushSubscriptionRecord {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

export interface PlatformWatch {
  subscription: PushSubscriptionRecord;
  stopId: string;
  stopName: string;
  tripId?: string;
  tripNumber: string;
  /** Scheduled departure, so a watch cleans itself up after the train has gone. */
  departsAt: string;
  createdAt: number;
}

/** One watch per phone, trip and stop. */
const watchKey = (endpoint: string, tripNumber: string, stopId: string) =>
  Buffer.from(`${endpoint}|${tripNumber}|${stopId}`).toString('base64url').slice(0, 96);

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
  await put(SET, watchKey(watch.subscription.endpoint, watch.tripNumber, watch.stopId), watch);
}

export async function dropWatch(
  endpoint: string,
  tripNumber: string,
  stopId: string,
): Promise<void> {
  await remove(SET, watchKey(endpoint, tripNumber, stopId));
}

export async function listWatches(): Promise<Array<{ key: string; value: PlatformWatch }>> {
  return list<PlatformWatch>(SET);
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

  // One board fetch per stop, however many phones are waiting on it.
  const stopIds = [...new Set(live.map((entry) => entry.value.stopId))];
  result.stops = stopIds.length;
  const boards = new Map<string, Awaited<ReturnType<typeof getLiveBoard>>>();
  for (const stopId of stopIds) {
    try {
      boards.set(stopId, await getLiveBoard(stopId));
    } catch {
      // A board that will not answer is simply not ready yet.
    }
  }

  if (pushConfigured()) configureWebPush();

  for (const entry of live) {
    const { value: watch } = entry;
    const platform = boards.get(watch.stopId)?.byTrip.get(watch.tripNumber)?.platform;
    if (!platform) continue;

    const stop = await getStop(watch.stopId).catch(() => null);
    const where = (stop?.name ?? watch.stopName).replace(/\s+GO(\s+Bus)?$/i, '');
    const sent = await sendPush(watch.subscription, {
      title: `${platform} at ${where}`,
      body: `Train ${watch.tripNumber} has been given ${platform.toLowerCase()}.`,
      url: watch.tripId ? `/trips/${encodeURIComponent(watch.tripId)}` : `/stations/${watch.stopId}`,
      tag: `platform-${watch.tripNumber}-${watch.stopId}`,
    });

    // Delivered or undeliverable, this watch is finished either way.
    await remove(SET, entry.key);
    if (sent) result.notified += 1;
  }

  return result;
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
