'use client';

import { useCallback, useEffect, useState } from 'react';
import { distanceKm } from '@/lib/transit/geo';

/**
 * How long it takes to walk to a stop, and therefore when to set off.
 *
 * A departure board answers "when does it go", which is only half of what a
 * rider standing in a kitchen actually needs. The other half is "when do I have
 * to leave", and that depends on where they are.
 *
 * Location is never requested on first paint — only when asked for, or when the
 * browser already says permission was granted on an earlier visit. Same rule as
 * the nearby-stops list.
 */

export type WalkStatus = 'idle' | 'prompting' | 'granted' | 'denied' | 'unsupported';

/** Straight-line distance understates a walk: streets do not run as the crow flies. */
const DETOUR = 1.35;
/** An unhurried walking pace, in km/h. */
const PACE_KMH = 4.8;
/** Past this a walking estimate is a fiction, so none is offered. */
export const WALKABLE_KM = 5;
/** Inside this the rider is at the stop, not on the way to it. */
export const AT_STOP_KM = 0.15;

export function walkMinutes(km: number): number {
  return Math.max(1, Math.ceil(((km * DETOUR) / PACE_KMH) * 60));
}

export interface WalkTime {
  status: WalkStatus;
  /** Straight-line distance to the stop, once known. */
  km: number | null;
  /** Estimated walking minutes, or null when too far to be worth guessing. */
  minutes: number | null;
  /** True once the rider is close enough to count as being there. */
  arrived: boolean;
  request: () => void;
}

export function useWalkTime(target?: { lat: number; lon: number } | null): WalkTime {
  const [status, setStatus] = useState<WalkStatus>('idle');
  const [km, setKm] = useState<number | null>(null);

  const lat = target?.lat;
  const lon = target?.lon;

  const locate = useCallback(() => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setStatus('unsupported');
      return;
    }
    if (lat == null || lon == null) return;
    setStatus('prompting');
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setKm(distanceKm(pos.coords.latitude, pos.coords.longitude, lat, lon));
        setStatus('granted');
      },
      () => setStatus('denied'),
      // A walk of several minutes does not need metre accuracy, and asking for
      // it costs battery and time at exactly the wrong moment.
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 60_000 },
    );
  }, [lat, lon]);

  useEffect(() => {
    if (typeof navigator === 'undefined' || !navigator.permissions?.query) return;
    navigator.permissions
      .query({ name: 'geolocation' })
      .then((p) => {
        if (p.state === 'granted') locate();
        else if (p.state === 'denied') setStatus('denied');
      })
      .catch(() => {
        // No permissions API: stay idle until the rider asks.
      });
  }, [locate]);

  return {
    status,
    km,
    minutes: km == null || km > WALKABLE_KM ? null : walkMinutes(km),
    arrived: km != null && km <= AT_STOP_KM,
    request: locate,
  };
}
