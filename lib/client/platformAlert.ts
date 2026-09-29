'use client';

import { useCallback, useEffect, useState } from 'react';

/**
 * "Tell me when my platform is posted", delivered by the server so it arrives
 * with the app closed.
 *
 * This is the one alert that cannot be done in the page: GO posts a platform a
 * few minutes before departure, which is exactly when the phone is in a pocket.
 * So the browser hands the server a push subscription, and the server does the
 * watching.
 */

const KEY = 'gotracker:platform-watches:v1';

export type WatchState = 'unsupported' | 'idle' | 'asking' | 'watching' | 'blocked' | 'failed';

/** The public half of the server's signing key, safe to ship to the browser. */
const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? '';

function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padded = `${base64}${'='.repeat((4 - (base64.length % 4)) % 4)}`
    .replace(/-/g, '+')
    .replace(/_/g, '/');
  const raw = atob(padded);
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

function readWatched(): string[] {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '[]') as string[];
  } catch {
    return [];
  }
}

function writeWatched(list: string[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list.slice(-40)));
  } catch {
    // Storage unavailable; the server still holds the watch.
  }
}

export interface PlatformAlertTarget {
  stopId: string;
  stopName: string;
  tripId?: string;
  tripNumber: string;
  departsAt: string;
}

export function usePlatformAlert(target: PlatformAlertTarget | null) {
  const [state, setState] = useState<WatchState>('unsupported');
  const [durable, setDurable] = useState(true);

  const id = target ? `${target.tripNumber}:${target.stopId}` : '';

  useEffect(() => {
    const supported =
      typeof window !== 'undefined' &&
      'serviceWorker' in navigator &&
      'PushManager' in window &&
      typeof Notification !== 'undefined' &&
      Boolean(publicKey);

    if (!supported) {
      setState('unsupported');
      return;
    }
    if (Notification.permission === 'denied') {
      setState('blocked');
      return;
    }
    setState(id && readWatched().includes(id) ? 'watching' : 'idle');
  }, [id]);

  const watch = useCallback(async () => {
    if (!target) return;
    setState('asking');
    try {
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        setState(permission === 'denied' ? 'blocked' : 'idle');
        return;
      }

      const registration = await navigator.serviceWorker.ready;
      const subscription =
        (await registration.pushManager.getSubscription()) ??
        (await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(publicKey),
        }));

      const response = await fetch('/api/push/watch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subscription: subscription.toJSON(), ...target }),
      });
      if (!response.ok) {
        setState('failed');
        return;
      }

      const body = await response.json();
      setDurable(body?.data?.durable !== false);
      writeWatched([...readWatched().filter((x) => x !== id), id]);
      setState('watching');
    } catch {
      setState('failed');
    }
  }, [target, id]);

  const stop = useCallback(async () => {
    if (!target) return;
    try {
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();
      if (subscription) {
        await fetch('/api/push/watch', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            endpoint: subscription.endpoint,
            tripNumber: target.tripNumber,
            stopId: target.stopId,
          }),
        });
      }
    } catch {
      // Already gone, or offline; the watch expires after departure regardless.
    }
    writeWatched(readWatched().filter((x) => x !== id));
    setState('idle');
  }, [target, id]);

  return { state, durable, watch, stop };
}
