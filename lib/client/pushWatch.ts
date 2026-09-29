'use client';

/**
 * Registering interest with the server, so an alert can reach a phone whose
 * screen is off and whose browser is closed.
 *
 * Everything here fails quietly: a rider who refuses notifications, or whose
 * browser has no push support, still gets the in-page alerts. This only ever
 * adds the ability to be told while away.
 */

const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? '';

export function pushSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    typeof Notification !== 'undefined' &&
    Boolean(publicKey)
  );
}

function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padded = `${base64}${'='.repeat((4 - (base64.length % 4)) % 4)}`
    .replace(/-/g, '+')
    .replace(/_/g, '/');
  const raw = atob(padded);
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

/**
 * The browser's push subscription, asking permission the first time. Returns
 * null whenever push is unavailable or refused.
 */
export async function ensureSubscription(): Promise<PushSubscription | null> {
  if (!pushSupported()) return null;
  try {
    if (Notification.permission === 'denied') return null;
    if (Notification.permission === 'default') {
      const granted = await Notification.requestPermission();
      if (granted !== 'granted') return null;
    }
    const registration = await navigator.serviceWorker.ready;
    return (
      (await registration.pushManager.getSubscription()) ??
      (await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      }))
    );
  } catch {
    return null;
  }
}

export interface WatchTarget {
  stopId: string;
  stopName: string;
  tripId?: string;
  tripNumber: string;
  /** Scheduled time at this stop, so the watch expires by itself. */
  departsAt: string;
}

/** Asks the server to push when this stop is reached (or its platform posted). */
export async function registerWatch(
  kind: 'platform' | 'arrival',
  target: WatchTarget,
): Promise<boolean> {
  const subscription = await ensureSubscription();
  if (!subscription) return false;
  try {
    const response = await fetch('/api/push/watch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind, subscription: subscription.toJSON(), ...target }),
    });
    return response.ok;
  } catch {
    return false;
  }
}

export async function unregisterWatch(
  kind: 'platform' | 'arrival',
  tripNumber: string,
  stopId: string,
): Promise<void> {
  if (!pushSupported()) return;
  try {
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.getSubscription();
    if (!subscription) return;
    await fetch('/api/push/watch', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind, endpoint: subscription.endpoint, tripNumber, stopId }),
    });
  } catch {
    // Offline, or already gone; the watch expires after the train has passed.
  }
}
