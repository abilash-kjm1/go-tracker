'use client';

import { useCallback, useEffect, useState } from 'react';
import { armAlerts, clearAlertsForTrips, type StopAlert } from './stopAlerts';
import type { Journey, TripDetail } from '@/lib/transit/types';

/**
 * The journey the rider is on right now. One at a time, kept on this device.
 *
 * Starting a trip arms its alerts automatically: two stops before where you get
 * off, the stop before, the stop itself, and — on a journey with a change — the
 * stop before the interchange, because missing a change costs more than missing
 * the end of the line.
 */

const KEY = 'gotracker:active-trip:v1';

export interface TripLeg {
  tripId: string;
  boardStopId: string;
  boardStopName: string;
  alightStopId: string;
  alightStopName: string;
}

export interface ActiveTrip {
  id: string;
  legs: TripLeg[];
  originName: string;
  destinationName: string;
  startedAt: number;
  /** Scheduled arrival, used to retire the trip once it is clearly over. */
  arrivalTime?: string;
}

function read(): ActiveTrip | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const trip = JSON.parse(raw) as ActiveTrip;
    // A trip from an earlier day is never the one you are on now.
    if (Date.now() - trip.startedAt > 18 * 60 * 60 * 1000) return null;
    return trip;
  } catch {
    return null;
  }
}

function write(trip: ActiveTrip | null) {
  try {
    if (trip) localStorage.setItem(KEY, JSON.stringify(trip));
    else localStorage.removeItem(KEY);
    window.dispatchEvent(new Event('gotracker:active-trip'));
  } catch {
    // Storage unavailable: the trip still works for this session.
  }
}

/**
 * Turns a planned journey into legs. The stop you get off at is the next leg's
 * boarding stop, or the destination you asked for on the final leg.
 */
export function legsFromJourney(
  journey: Journey,
  destinationId: string,
  destinationName: string,
): TripLeg[] {
  return journey.legs.flatMap((leg, i) => {
    if (!leg.tripId) return [];
    const next = journey.legs[i + 1];
    return [
      {
        tripId: leg.tripId,
        boardStopId: leg.stopId,
        boardStopName: leg.stopName,
        alightStopId: next ? next.stopId : destinationId,
        alightStopName: next ? next.stopName : destinationName,
      },
    ];
  });
}

/**
 * Which stops to warn about on one leg: the alighting stop and the two before
 * it for the final leg, or the interchange and the one before it for a leg that
 * ends in a change.
 */
export function autoAlertsForLeg(trip: TripDetail, leg: TripLeg, isFinalLeg: boolean): StopAlert[] {
  const index = trip.stops.findIndex((s) => s.stopId === leg.alightStopId);
  if (index < 0) return [];
  const wanted = isFinalLeg ? [index - 2, index - 1, index] : [index - 1, index];
  return wanted
    .filter((i) => i >= 0 && i < trip.stops.length)
    .map((i) => ({ tripId: leg.tripId, stopId: trip.stops[i].stopId, stopName: trip.stops[i].stopName }));
}

/** Arms the default alerts for every leg, fetching each leg's stop list. */
async function armJourneyAlerts(legs: TripLeg[]) {
  const alerts: StopAlert[] = [];
  for (const [i, leg] of legs.entries()) {
    try {
      const res = await fetch(`/api/transit/trips/${encodeURIComponent(leg.tripId)}`);
      if (!res.ok) continue;
      const body = (await res.json()) as { data: TripDetail };
      alerts.push(...autoAlertsForLeg(body.data, leg, i === legs.length - 1));
    } catch {
      // A leg we cannot read simply gets no automatic alerts; the rider can
      // still arm them by hand on the trip page.
    }
  }
  if (alerts.length) armAlerts(alerts);
}

export function useActiveTrip() {
  const [trip, setTrip] = useState<ActiveTrip | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const sync = () => setTrip(read());
    sync();
    setReady(true);
    window.addEventListener('gotracker:active-trip', sync);
    window.addEventListener('storage', sync);
    return () => {
      window.removeEventListener('gotracker:active-trip', sync);
      window.removeEventListener('storage', sync);
    };
  }, []);

  const start = useCallback(
    async (journey: Journey, destinationId: string, destinationName: string) => {
      const legs = legsFromJourney(journey, destinationId, destinationName);
      if (!legs.length) return;
      const next: ActiveTrip = {
        id: journey.id,
        legs,
        originName: legs[0].boardStopName,
        destinationName,
        startedAt: Date.now(),
        arrivalTime: journey.arrivalTime,
      };
      write(next);
      setTrip(next);
      await armJourneyAlerts(legs);
    },
    [],
  );

  const end = useCallback(() => {
    const current = read();
    if (current) clearAlertsForTrips(current.legs.map((l) => l.tripId));
    write(null);
    setTrip(null);
  }, []);

  return { trip, ready, start, end };
}

/** Keeps the screen on while the rider is watching for their stop. */
export function useWakeLock(enabled: boolean) {
  const [supported, setSupported] = useState(false);

  useEffect(() => {
    setSupported('wakeLock' in navigator);
  }, []);

  useEffect(() => {
    if (!enabled || !('wakeLock' in navigator)) return;
    let sentinel: WakeLockSentinel | null = null;
    let cancelled = false;

    const acquire = async () => {
      try {
        sentinel = await navigator.wakeLock.request('screen');
      } catch {
        // Denied (low battery, or the tab is hidden); the page still works.
      }
    };
    // iOS drops the lock whenever the app leaves the screen, so take it again.
    const onVisible = () => {
      if (document.visibilityState === 'visible' && !cancelled) void acquire();
    };

    void acquire();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisible);
      void sentinel?.release().catch(() => undefined);
    };
  }, [enabled]);

  return supported;
}
