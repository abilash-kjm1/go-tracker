'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { TripDetail } from '@/lib/transit/types';

/**
 * "Tell me when this train reaches that stop."
 *
 * Alerts are armed per trip and stop, kept in this browser only, and fired as a
 * notification the moment the live feed says the train has reached the stop.
 *
 * iOS only grants notification permission to a PWA that has been added to the
 * Home Screen, and it suspends a web app's JavaScript once it is off screen, so
 * an alert arrives while GO Tracker is open. The UI says so rather than
 * promising a background alarm this cannot deliver.
 */

const KEY = 'gotracker:stop-alerts:v1';

export interface StopAlert {
  tripId: string;
  stopId: string;
  stopName: string;
  /** Set once the notification has been delivered, so it never repeats. */
  firedAt?: number;
}

const alertKey = (tripId: string, stopId: string) => `${tripId}::${stopId}`;

function read(): StopAlert[] {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as StopAlert[]) : [];
  } catch {
    return [];
  }
}

function write(alerts: StopAlert[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(alerts));
  } catch {
    // Storage unavailable: alerts still work for this session.
  }
}

/** True once the app is running from the Home Screen rather than a browser tab. */
export function useIsInstalled(): boolean {
  const [installed, setInstalled] = useState(false);
  useEffect(() => {
    const standalone =
      window.matchMedia('(display-mode: standalone)').matches ||
      // iOS Safari's own flag, which predates display-mode.
      (navigator as Navigator & { standalone?: boolean }).standalone === true;
    setInstalled(Boolean(standalone));
  }, []);
  return installed;
}

export type PermissionState = 'unsupported' | 'default' | 'granted' | 'denied';

export function useStopAlerts(tripId: string | undefined) {
  const [alerts, setAlerts] = useState<StopAlert[]>([]);
  const [permission, setPermission] = useState<PermissionState>('unsupported');
  const installed = useIsInstalled();

  useEffect(() => {
    setAlerts(read());
    if (typeof Notification === 'undefined') setPermission('unsupported');
    else setPermission(Notification.permission as PermissionState);
  }, []);

  const forTrip = useMemo(
    () => (tripId ? alerts.filter((a) => a.tripId === tripId) : []),
    [alerts, tripId],
  );

  const armedStopIds = useMemo(
    () => new Set(forTrip.filter((a) => !a.firedAt).map((a) => a.stopId)),
    [forTrip],
  );

  const toggle = useCallback(
    (stopId: string, stopName: string) => {
      if (!tripId) return;
      setAlerts((current) => {
        const exists = current.some((a) => alertKey(a.tripId, a.stopId) === alertKey(tripId, stopId));
        const next = exists
          ? current.filter((a) => alertKey(a.tripId, a.stopId) !== alertKey(tripId, stopId))
          : [...current, { tripId, stopId, stopName }];
        write(next);
        return next;
      });
    },
    [tripId],
  );

  const markFired = useCallback((tripId: string, stopId: string) => {
    setAlerts((current) => {
      const next = current.map((a) =>
        alertKey(a.tripId, a.stopId) === alertKey(tripId, stopId) ? { ...a, firedAt: Date.now() } : a,
      );
      write(next);
      return next;
    });
  }, []);

  const clearTrip = useCallback(() => {
    if (!tripId) return;
    setAlerts((current) => {
      const next = current.filter((a) => a.tripId !== tripId);
      write(next);
      return next;
    });
  }, [tripId]);

  const request = useCallback(async () => {
    if (typeof Notification === 'undefined') return;
    try {
      const result = await Notification.requestPermission();
      setPermission(result as PermissionState);
    } catch {
      // Safari rejects outside a user gesture; the button is the gesture.
    }
  }, []);

  return {
    alerts: forTrip,
    armedStopIds,
    armedCount: armedStopIds.size,
    toggle,
    markFired,
    clearTrip,
    permission,
    request,
    installed,
  };
}

/**
 * Delivers one alert. Prefers the service worker so the notification survives a
 * page navigation, and buzzes the phone where the platform allows it (Android
 * does; iOS Safari has no vibration API, and uses the system alert instead).
 */
export async function deliverAlert(title: string, body: string, tag: string, url?: string) {
  const options: NotificationOptions & { vibrate?: number[]; renotify?: boolean } = {
    body,
    tag,
    renotify: true,
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    vibrate: [220, 120, 220],
    data: { url: url ?? '/' },
  };

  try {
    const registration = await navigator.serviceWorker?.getRegistration();
    if (registration?.showNotification) {
      await registration.showNotification(title, options);
    } else if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
      new Notification(title, options);
    }
  } catch {
    // A failed notification must never break the page the rider is watching.
  }

  try {
    navigator.vibrate?.([220, 120, 220]);
  } catch {
    // Not supported on iOS; the system notification alerts instead.
  }
}

/**
 * Watches a trip's live stops and fires each armed alert once, the moment the
 * feed reports the train has reached that stop.
 */
export function useStopAlertWatcher(
  trip: TripDetail | null,
  alerts: StopAlert[],
  markFired: (tripId: string, stopId: string) => void,
) {
  useEffect(() => {
    if (!trip) return;
    for (const alert of alerts) {
      if (alert.firedAt || alert.tripId !== trip.id) continue;
      const stop = trip.stops.find((s) => s.stopId === alert.stopId);
      // "Reached" covers standing at the stop and having already left it, so a
      // brief dwell between two polls is never missed.
      if (!stop || (stop.status !== 'current' && stop.status !== 'departed')) continue;

      const name = alert.stopName.replace(/\s+GO(\s+Bus)?$/i, '');
      const service = trip.routeName ?? 'Your train';
      void deliverAlert(
        `Arriving at ${name}`,
        stop.status === 'current'
          ? `${service} ${trip.tripNumber ?? ''} is at ${name} now.`.replace('  ', ' ')
          : `${service} ${trip.tripNumber ?? ''} has reached ${name}.`.replace('  ', ' '),
        `stop-alert-${alert.tripId}-${alert.stopId}`,
        `/trips/${encodeURIComponent(trip.id)}`,
      );
      markFired(alert.tripId, alert.stopId);
    }
  }, [trip, alerts, markFired]);
}

/** Adds alerts from outside React (the planner arms a trip's alerts on start). */
export function armAlerts(newAlerts: StopAlert[]) {
  const existing = read();
  const seen = new Set(existing.map((a) => alertKey(a.tripId, a.stopId)));
  const merged = [...existing, ...newAlerts.filter((a) => !seen.has(alertKey(a.tripId, a.stopId)))];
  write(merged);
  return merged;
}

/** Drops every alert belonging to these trips — used when a journey ends. */
export function clearAlertsForTrips(tripIds: string[]) {
  const ids = new Set(tripIds);
  write(read().filter((a) => !ids.has(a.tripId)));
}
