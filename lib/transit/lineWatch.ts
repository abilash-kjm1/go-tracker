import 'server-only';

import { list, put, remove } from '../server/store';
import { deviceId, type PushSubscriptionRecord } from './pushDevice';
import type { TransitAlert } from './types';

/**
 * "Tell me when my line is in trouble."
 *
 * The first alert in the app that is not tied to one train on one day. It is
 * only possible now that a phone stays registered between trips, and it needs
 * more restraint than the others, because the thing it watches is noisy.
 *
 * The alert feed is derived from live delays, and a line earns a `warning` as
 * soon as any one service is two minutes down. Sixteen lines were carrying
 * one at three in the morning. Two minutes is not news and sixteen
 * notifications is not a service, so:
 *
 *   - only `severe` is pushed, which means something is a quarter of an hour
 *     late, not a train that left a moment behind;
 *   - one notification per incident, not one per minute while it lasts;
 *   - and a line has to behave itself for half an hour before it can raise a
 *     new one, so a service flapping between fifteen and fourteen minutes
 *     late cannot ring a phone repeatedly.
 */

const SET = 'line-watch';

/** How long a line must be out of trouble before a new incident can be raised. */
export const CALM_MS = 30 * 60_000;

/** A rider may follow this many lines. Enough for any commute. */
export const MAX_LINES = 12;

export interface LineWatch {
  routeId: string;
  routeName: string;
  subscription: PushSubscriptionRecord;
  createdAt: number;
  /** When this device was last told about this line's current trouble. */
  notifiedAt?: number;
  /** When the line stopped being severe, so recovery can be confirmed. */
  calmSince?: number;
}

const watchKey = (endpoint: string, routeId: string) => `${deviceId(endpoint)}:${routeId}`;

export async function addLineWatch(
  subscription: PushSubscriptionRecord,
  routeId: string,
  routeName: string,
): Promise<void> {
  const key = watchKey(subscription.endpoint, routeId);
  await put(SET, key, {
    routeId,
    routeName,
    subscription,
    createdAt: Date.now(),
  } satisfies LineWatch);
}

export async function dropLineWatch(endpoint: string, routeId: string): Promise<void> {
  await remove(SET, watchKey(endpoint, routeId));
}

export async function listLineWatches(): Promise<Array<{ key: string; value: LineWatch }>> {
  return list<LineWatch>(SET);
}

/** Which lines this one phone follows. */
export async function lineWatchesFor(endpoint: string): Promise<LineWatch[]> {
  const prefix = `${deviceId(endpoint)}:`;
  return (await listLineWatches())
    .filter(({ key }) => key.startsWith(prefix))
    .map(({ value }) => value);
}

export type LineAction =
  /** Push now: this line has just got into trouble. */
  | { do: 'notify'; alert: TransitAlert; next: LineWatch }
  /** Nothing to say, but the record has moved on. */
  | { do: 'save'; next: LineWatch }
  | { do: 'nothing' };

/**
 * What to do about one followed line this minute.
 *
 * Pure, so the restraint above is testable rather than merely intended.
 */
export function decideLine(
  watch: LineWatch,
  alerts: TransitAlert[],
  now = Date.now(),
): LineAction {
  const alert = alerts.find(
    (a) => a.scope.kind === 'route' && a.scope.id === watch.routeId && a.severity === 'severe',
  );

  if (alert) {
    // Already told them about this one. Saying it again every minute for the
    // length of a bad morning is how an app gets its notifications turned off.
    if (watch.notifiedAt) {
      return watch.calmSince
        ? { do: 'save', next: { ...watch, calmSince: undefined } }
        : { do: 'nothing' };
    }
    return {
      do: 'notify',
      alert,
      next: { ...watch, notifiedAt: now, calmSince: undefined },
    };
  }

  // Not severe. Only once it has stayed that way for a while is the incident
  // treated as over and the line allowed to raise another.
  if (!watch.notifiedAt) return { do: 'nothing' };
  if (!watch.calmSince) return { do: 'save', next: { ...watch, calmSince: now } };
  if (now - watch.calmSince >= CALM_MS) {
    return { do: 'save', next: { ...watch, notifiedAt: undefined, calmSince: undefined } };
  }
  return { do: 'nothing' };
}

/** How the notification reads. The line, then how bad, then what is known. */
export function lineMessage(alert: TransitAlert, routeName: string) {
  return {
    title: `⚠️ ${routeName.toUpperCase()} DELAYS`,
    body: alert.body,
    url: alert.scope.id ? `/routes/${encodeURIComponent(alert.scope.id)}` : '/alerts',
    tag: `line-${alert.scope.id ?? routeName}`,
  };
}

export async function saveLineWatch(key: string, watch: LineWatch): Promise<void> {
  await put(SET, key, watch);
}

export async function removeLineWatch(key: string): Promise<void> {
  await remove(SET, key);
}
