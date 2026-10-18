'use client';

/**
 * Keeping this phone reachable.
 *
 * GO Tracker used to hand the server a push subscription only as part of a
 * watch — "tell me when this train's platform is posted" — which was deleted
 * once that train had gone. Between trips the server had no way to reach the
 * phone at all, and a push address the browser had quietly renewed was never
 * corrected, because nothing ever looked at it again.
 *
 * Settle keeps a device registered for as long as it exists and re-saves it
 * every single time the app is opened. That one habit is why its
 * notifications arrive with the app shut, and it is what this file does.
 */

const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? '';

/** What was last sent to the server, so the same thing is not sent again. */
const SEEN_KEY = 'gotracker:push-device:v1';

/**
 * How long a registration is trusted before it is refreshed anyway.
 *
 * Re-saving on every open is the habit that keeps the address true, but
 * "every open" taken literally meant a request every single time the app came
 * back to the foreground — dozens a day, on a phone, to say something the
 * server already knew. A changed address is still sent the instant it
 * changes; an unchanged one is confirmed twice a day.
 */
const REREGISTER_AFTER_MS = 12 * 60 * 60 * 1000;

function lastRegistered(): { endpoint: string; at: number } | null {
  try {
    const raw = localStorage.getItem(SEEN_KEY);
    return raw ? (JSON.parse(raw) as { endpoint: string; at: number }) : null;
  } catch {
    return null;
  }
}

function rememberRegistered(endpoint: string) {
  try {
    localStorage.setItem(SEEN_KEY, JSON.stringify({ endpoint, at: Date.now() }));
  } catch {
    // Private mode, or storage full. The only cost is registering again.
  }
}

export type PushState =
  | 'unknown'
  | 'on'
  | 'off'
  /** iPhone, but not yet installed to the Home Screen — Safari offers a tab nothing. */
  | 'ios-install'
  | 'denied'
  | 'unsupported';

function isIOS(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent || '';
  return (
    /iPad|iPhone|iPod/.test(ua) ||
    // iPadOS 13+ reports itself as a Mac; the touch points give it away.
    (/Macintosh/.test(ua) && typeof document !== 'undefined' && navigator.maxTouchPoints > 1)
  );
}

function isStandalone(): boolean {
  try {
    return (
      window.matchMedia('(display-mode: standalone)').matches ||
      (navigator as { standalone?: boolean }).standalone === true
    );
  } catch {
    return false;
  }
}

/** What to call this phone when listing devices. Never identifying. */
export function deviceLabel(): string {
  if (typeof navigator === 'undefined') return 'browser';
  const ua = navigator.userAgent || '';
  if (isIOS()) return /iPad/.test(ua) ? 'iPad' : 'iPhone';
  if (/Android/i.test(ua)) return 'Android phone';
  return 'browser';
}

/**
 * What this device can do, before asking anything of anybody.
 *
 * An iPhone that has not been added to the Home Screen gets the steps to do
 * that rather than a button that cannot work: Safari gives an ordinary tab no
 * notifications at all, and offering one anyway is how an app teaches people
 * its notifications are broken.
 */
export function pushSupport(): PushState {
  if (typeof window === 'undefined') return 'unknown';
  if (!publicKey) return 'unsupported';
  if (!('serviceWorker' in navigator)) return 'unsupported';
  if (!('PushManager' in window) || typeof Notification === 'undefined') {
    return isIOS() && !isStandalone() ? 'ios-install' : 'unsupported';
  }
  if (Notification.permission === 'denied') return 'denied';
  return 'off';
}

/** The registration, but never waiting forever on a worker that never starts. */
function swReady(ms = 8000): Promise<ServiceWorkerRegistration> {
  return Promise.race([
    navigator.serviceWorker.ready,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('the app is still starting — reload and try again')), ms),
    ),
  ]);
}

function keyBytes(base64: string): Uint8Array<ArrayBuffer> {
  const padded = `${base64}${'='.repeat((4 - (base64.length % 4)) % 4)}`
    .replace(/-/g, '+')
    .replace(/_/g, '/');
  const raw = atob(padded);
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

async function register(subscription: PushSubscription): Promise<boolean> {
  const json = subscription.toJSON();
  if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) return false;
  try {
    const response = await fetch('/api/push/device', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        subscription: { endpoint: json.endpoint, keys: json.keys },
        label: deviceLabel(),
      }),
    });
    if (!response.ok) return false;
    const body = (await response.json().catch(() => null)) as {
      data?: { durable?: boolean };
    } | null;
    rememberRegistered(json.endpoint);
    return body?.data?.durable !== false;
  } catch {
    return false;
  }
}

/**
 * Where this device stands, re-saving a live subscription as it goes.
 *
 * Called on every open and whenever the app comes back to the foreground, so
 * a push address the browser renewed behind our backs is corrected within one
 * use of the app rather than discovered on a platform at seven in the
 * morning.
 */
export async function refreshDevice(force = false): Promise<PushState> {
  const support = pushSupport();
  if (support !== 'off') return support;
  try {
    const registration = await swReady(5000);
    const subscription = await registration.pushManager.getSubscription();
    if (!subscription || Notification.permission !== 'granted') return 'off';

    // A changed address goes up at once — that is the whole point. An
    // unchanged one is left alone until it is a few hours old, so returning
    // to the app forty times in a day costs forty nothings.
    const seen = lastRegistered();
    const changed = seen?.endpoint !== subscription.endpoint;
    const old = !seen || Date.now() - seen.at > REREGISTER_AFTER_MS;
    if (force || changed || old) await register(subscription);

    return 'on';
  } catch {
    return 'off';
  }
}

export interface EnableResult {
  state: PushState;
  /** False when the server accepted the device but cannot remember it. */
  durable: boolean;
  error?: string;
}

/**
 * Turn notifications on for this phone.
 *
 * Permission is asked for first and inside the tap: Safari refuses a request
 * that waits on anything else, and older versions answer by callback rather
 * than by promise.
 */
export async function enablePush(): Promise<EnableResult> {
  const support = pushSupport();
  if (support !== 'off') return { state: support, durable: true };

  const permission = await new Promise<NotificationPermission>((resolve) => {
    try {
      const maybe = Notification.requestPermission(resolve);
      if (maybe && typeof maybe.then === 'function') maybe.then(resolve);
    } catch {
      resolve('default');
    }
  });

  if (permission !== 'granted') {
    return { state: permission === 'denied' ? 'denied' : 'off', durable: true };
  }

  try {
    const registration = await swReady();
    let subscription = await registration.pushManager.getSubscription();
    if (!subscription) {
      const options: PushSubscriptionOptionsInit = {
        userVisibleOnly: true,
        applicationServerKey: keyBytes(publicKey),
      };
      try {
        subscription = await registration.pushManager.subscribe(options);
      } catch {
        // Left over from a different signing key: clear it and start again.
        const stale = await registration.pushManager.getSubscription();
        if (stale) await stale.unsubscribe();
        subscription = await registration.pushManager.subscribe(options);
      }
    }
    const durable = await register(subscription);
    return { state: 'on', durable };
  } catch (err) {
    return {
      state: 'off',
      durable: true,
      error: err instanceof Error ? err.message : 'could not turn them on',
    };
  }
}

export async function disablePush(): Promise<void> {
  try {
    const registration = await swReady(5000);
    const subscription = await registration.pushManager.getSubscription();
    if (subscription) {
      const { endpoint } = subscription;
      await subscription.unsubscribe();
      await fetch('/api/push/device', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ endpoint }),
      }).catch(() => undefined);
    }
  } catch {
    // Already gone. Nothing useful left to do.
  }
}

export interface LinkReport {
  linked: boolean;
  durable: boolean;
  configured: boolean;
  seenAt: string | null;
  /** Set when the check itself could not be made. */
  error?: string;
}

/**
 * Can the server actually reach this phone?
 *
 * The question a test notification cannot answer. Showing one proves only
 * that the phone can display a notification the page asked for; it says
 * nothing about whether the server holds a working address for it. This asks
 * the server directly, which is the difference between "notifications are on"
 * and "notifications will arrive".
 */
export async function checkLinked(): Promise<LinkReport> {
  const blank: LinkReport = { linked: false, durable: true, configured: true, seenAt: null };
  try {
    const registration = await swReady(5000);
    const subscription = await registration.pushManager.getSubscription();
    if (!subscription) return { ...blank, error: 'This device has no subscription yet.' };

    const response = await fetch(
      `/api/push/device?endpoint=${encodeURIComponent(subscription.endpoint)}`,
    );
    if (!response.ok) return { ...blank, error: 'Could not reach the server.' };
    const body = (await response.json()) as { data?: Omit<LinkReport, 'error'> };
    return body.data ? { ...blank, ...body.data } : { ...blank, error: 'No answer from the server.' };
  } catch (err) {
    return { ...blank, error: err instanceof Error ? err.message : 'Could not check.' };
  }
}

/** Register again, for when the check above says this phone is not linked. */
export async function relink(): Promise<boolean> {
  try {
    const registration = await swReady(5000);
    const subscription = await registration.pushManager.getSubscription();
    if (!subscription) return false;
    return await register(subscription);
  } catch {
    return false;
  }
}

/** Prove the phone can show one at all. */
export async function showTestNotification(): Promise<void> {
  const registration = await swReady(4000);
  await registration.showNotification('Notifications are working', {
    body: 'This is how GO Tracker will reach you when a platform is posted.',
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    tag: 'gotracker-test',
  });
}

/**
 * Keep the registration true for as long as the app is open.
 *
 * Returns a teardown function. Mounted once, high up, so every screen
 * benefits without any of them knowing about it.
 */
export function watchDeviceRegistration(onState?: (state: PushState) => void): () => void {
  if (typeof window === 'undefined') return () => undefined;

  let stopped = false;
  const run = () => {
    refreshDevice().then((state) => {
      if (!stopped) onState?.(state);
    });
  };

  run();
  const onVisible = () => {
    if (!document.hidden) run();
  };
  document.addEventListener('visibilitychange', onVisible);
  return () => {
    stopped = true;
    document.removeEventListener('visibilitychange', onVisible);
  };
}

export interface FollowedLine {
  routeId: string;
  routeName: string;
}

/**
 * Which lines this phone follows.
 *
 * The only standing subscription in the app — a platform alert dies with its
 * train and a trip's alerts end with the trip, but a followed line keeps its
 * claim on a phone until it is dropped. Anything that can notify you
 * indefinitely has to be visible somewhere you can turn it off.
 */
export async function followedLines(): Promise<FollowedLine[]> {
  try {
    const registration = await swReady(5000);
    const subscription = await registration.pushManager.getSubscription();
    if (!subscription) return [];
    const response = await fetch(
      `/api/push/lines?endpoint=${encodeURIComponent(subscription.endpoint)}`,
    );
    if (!response.ok) return [];
    const body = (await response.json()) as { data?: { lines?: FollowedLine[] } };
    return body.data?.lines ?? [];
  } catch {
    return [];
  }
}

export async function unfollowLine(routeId: string): Promise<boolean> {
  try {
    const registration = await swReady(5000);
    const subscription = await registration.pushManager.getSubscription();
    if (!subscription) return false;
    const response = await fetch('/api/push/lines', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ endpoint: subscription.endpoint, routeId }),
    });
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * Ask the server to push a real test to this phone.
 *
 * Different in kind from showTestNotification above, which only asks the page
 * to draw one. This goes out to the signing key, the push service, and back
 * down to the service worker — every part that can actually be broken — and
 * arrives about a minute later, by which time the app can be closed. It is
 * the only way to answer "will I get told while I am not using it".
 */
export async function requestServerTest(): Promise<{ ok: boolean; error?: string }> {
  try {
    const registration = await swReady(5000);
    const subscription = await registration.pushManager.getSubscription();
    if (!subscription) return { ok: false, error: 'This device is not subscribed yet.' };

    const response = await fetch('/api/push/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ subscription: subscription.toJSON() }),
    });
    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as { error?: string } | null;
      return { ok: false, error: body?.error ?? 'The server would not take it.' };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Could not ask.' };
  }
}
