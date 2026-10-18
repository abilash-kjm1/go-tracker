import 'server-only';

import { createHash } from 'node:crypto';
import { durable, list, put, readOne, remove } from '../server/store';

/**
 * A phone that has said yes, remembered independently of anything it is
 * waiting for.
 *
 * This is the piece GO Tracker was missing. Until now the only record of a
 * phone was inside a watch — "tell me when trip 1234's platform is posted at
 * Union" — which carried the subscription with it and was deleted ten minutes
 * after that train left. So the server could only ever reach a rider who had
 * armed an alert by hand, for as long as that one alert lasted, and the
 * moment it expired the app had no way to reach that phone again. Checked
 * against production: VAPID configured, the store durable, the scheduler
 * ticking every sixty seconds without a single failure in its last twenty
 * runs — and nought watches, so every one of those ticks had nothing to send.
 *
 * Settle (the shared-expenses app) does the opposite and is the reason its
 * notifications arrive with the app shut: a device registers once, against
 * the account, and is re-saved every time the app is opened. The server can
 * then reach it whenever there is something to say. The same idea is used
 * here, with the device standing in for the account, because GO Tracker has
 * no sign-in — the subscription is the identity.
 */

const SET = 'push-device';

/** How long a device may go unseen before it is presumed gone. */
export const DEVICE_TTL_MS = 180 * 24 * 60 * 60 * 1000;

export interface PushSubscriptionRecord {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

export interface DeviceRecord {
  subscription: PushSubscriptionRecord;
  /** "iPhone", "Android", "browser" — only for telling two devices apart. */
  label?: string;
  createdAt: number;
  /** Last time the app re-registered this device, so dead ones can be swept. */
  seenAt: number;
}

/*
 * Only the push services browsers actually use.
 *
 * Ported from Settle, and not cosmetic: the watch endpoint accepted any https
 * URL, so a forged request could make this server sign and POST to an address
 * of the sender's choosing. An allowlist is the fix.
 */
const PUSH_HOSTS = [
  /^fcm\.googleapis\.com$/, // Chrome, Edge, most Android browsers
  /(^|\.)push\.apple\.com$/, // Safari, including iPhone home-screen apps
  /(^|\.)push\.services\.mozilla\.com$/, // Firefox
  /(^|\.)notify\.windows\.com$/, // older Edge
];

const B64URL = /^[A-Za-z0-9_-]+={0,2}$/;

/**
 * A subscription exactly as a browser saved it, or null if it cannot be used.
 *
 * The key lengths are not arbitrary: p256dh is an uncompressed P-256 point,
 * 65 bytes, and auth is 16 bytes, which in base64url come out at 87 and 22
 * characters give or take padding. Anything else did not come from a browser.
 */
export function cleanSubscription(raw: unknown): PushSubscriptionRecord | null {
  if (!raw || typeof raw !== 'object') return null;
  const value = raw as { endpoint?: unknown; keys?: unknown };

  const endpoint = typeof value.endpoint === 'string' ? value.endpoint.trim() : '';
  if (!endpoint || endpoint.length > 1000) return null;

  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.port) return null;
  if (!PUSH_HOSTS.some((host) => host.test(url.hostname))) return null;

  const keys = (value.keys && typeof value.keys === 'object' ? value.keys : {}) as {
    p256dh?: unknown;
    auth?: unknown;
  };
  const p256dh = typeof keys.p256dh === 'string' ? keys.p256dh : '';
  const auth = typeof keys.auth === 'string' ? keys.auth : '';
  if (!B64URL.test(p256dh) || p256dh.length < 86 || p256dh.length > 90) return null;
  if (!B64URL.test(auth) || auth.length < 21 || auth.length > 26) return null;

  return { endpoint, keys: { p256dh, auth } };
}

/**
 * One id per push address, so turning notifications on twice updates the same
 * record instead of leaving a second one behind. The browser works this out
 * too and sends it along, but the server recomputes rather than trusting it:
 * otherwise a caller could file its subscription under somebody else's id.
 */
export function deviceId(endpoint: string): string {
  return createHash('sha256').update(endpoint).digest('base64url').slice(0, 32);
}

export function deviceStoreSurvives(): boolean {
  return durable;
}

/** Register this phone, or refresh the record the app already has for it. */
export async function saveDevice(
  subscription: PushSubscriptionRecord,
  label?: string,
): Promise<string> {
  const id = deviceId(subscription.endpoint);
  const existing = await readOne<DeviceRecord>(`${SET}:${id}`).catch(() => null);
  const now = Date.now();
  await put(SET, id, {
    subscription,
    label: label?.slice(0, 40),
    createdAt: existing?.createdAt ?? now,
    seenAt: now,
  } satisfies DeviceRecord);
  return id;
}

export async function getDevice(id: string): Promise<DeviceRecord | null> {
  return readOne<DeviceRecord>(`${SET}:${id}`).catch(() => null);
}

export async function dropDevice(id: string): Promise<void> {
  await remove(SET, id);
}

export async function listDevices(): Promise<Array<{ key: string; value: DeviceRecord }>> {
  return list<DeviceRecord>(SET);
}

/** Forget devices that have not opened the app in months. */
export async function sweepDevices(now = Date.now()): Promise<number> {
  const devices = await listDevices();
  let dropped = 0;
  for (const { key, value } of devices) {
    if (now - (value.seenAt ?? value.createdAt ?? 0) > DEVICE_TTL_MS) {
      await remove(SET, key);
      dropped += 1;
    }
  }
  return dropped;
}
