'use client';

import { useCallback, useEffect, useState } from 'react';
import type { TransitStop } from '@/lib/transit/types';

export type NearbyStatus = 'idle' | 'prompting' | 'granted' | 'denied' | 'unsupported';

export interface NearbyStop extends TransitStop {
  distanceKm: number;
}

/**
 * Nearby stops. Location is only requested when the user asks for it, or when
 * the browser already reports the permission as granted — never on first paint.
 */
export function useNearby(limit = 8) {
  const [status, setStatus] = useState<NearbyStatus>('idle');
  const [stops, setStops] = useState<NearbyStop[]>([]);

  const locate = useCallback(async () => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setStatus('unsupported');
      return;
    }
    setStatus('prompting');
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        try {
          const { latitude, longitude } = pos.coords;
          const res = await fetch(
            `/api/transit/stations?near=${latitude},${longitude}&limit=${limit}`,
            { cache: 'no-store' },
          );
          const body = await res.json();
          setStops(res.ok ? (body.data as NearbyStop[]) : []);
          setStatus('granted');
        } catch {
          setStops([]);
          setStatus('granted');
        }
      },
      () => setStatus('denied'),
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 120_000 },
    );
  }, [limit]);

  useEffect(() => {
    // Only auto-locate if permission was already granted in a previous visit.
    if (typeof navigator === 'undefined' || !navigator.permissions?.query) return;
    navigator.permissions
      .query({ name: 'geolocation' })
      .then((p) => {
        if (p.state === 'granted') void locate();
        else if (p.state === 'denied') setStatus('denied');
      })
      .catch(() => {
        /* permissions API unavailable — stay idle until asked */
      });
  }, [locate]);

  return { status, stops, request: locate };
}

export const useNearbyStops = useNearby;
