import 'server-only';

import { z } from 'zod';
import { cached } from '../cache';
import { config } from '../config';

/**
 * Live GO Bus positions from Metrolinx's own Open API.
 *
 * GO Tracker publishes nothing for buses, so without a key half the network is
 * timetable-only. This is the sanctioned source: it needs the free API key in
 * METROLINX_API_KEY, and returns nothing at all when no key is configured.
 */

const tripSchema = z.object({
  TripNumber: z.string().nullish(),
  LineCode: z.string().nullish(),
  RouteNumber: z.string().nullish(),
  /** "11  - Brock University": the route, then the headsign. */
  Display: z.string().nullish(),
  Latitude: z.number().nullish(),
  Longitude: z.number().nullish(),
  IsInMotion: z.boolean().nullish(),
  DelaySeconds: z.number().nullish(),
  FirstStopCode: z.string().nullish(),
  LastStopCode: z.string().nullish(),
  PrevStopCode: z.string().nullish(),
  NextStopCode: z.string().nullish(),
  AtStationCode: z.string().nullish(),
  ModifiedDate: z.string().nullish(),
  BusType: z.string().nullish(),
});

const payloadSchema = z.object({
  Metadata: z.object({ ErrorCode: z.string().optional() }).nullish(),
  Trips: z.object({ Trip: z.array(tripSchema).nullable().optional() }).nullish(),
});

export interface RawBus {
  tripNumber?: string;
  lineCode?: string;
  headsign?: string;
  latitude?: number;
  longitude?: number;
  isMoving?: boolean;
  delaySeconds?: number;
  originStopCode?: string;
  nextStopCode?: string;
  atStopCode?: string;
  updatedAt?: string;
}

const CACHE_KEY = 'metrolinx:buses';

/** "11  - Brock University" is the route code and the headsign in one string. */
function splitDisplay(display?: string | null): string | undefined {
  if (!display) return undefined;
  const index = display.indexOf(' - ');
  const headsign = index >= 0 ? display.slice(index + 3) : display;
  return headsign.trim() || undefined;
}

/** Blank and "0" both mean "not at a stop" in this feed. */
function stopCode(value?: string | null): string | undefined {
  const trimmed = value?.trim();
  return trimmed && trimmed !== '0' ? trimmed : undefined;
}

export function metrolinxConfigured(): boolean {
  return Boolean(config.metrolinx.apiKey);
}

export async function getLiveBuses(): Promise<RawBus[]> {
  if (!metrolinxConfigured()) return [];

  const result = await cached(CACHE_KEY, config.liveVehicleRefreshSeconds, async () => {
    const base = config.metrolinx.baseUrl.replace(/\/$/, '');
    const url = `${base}/api/V1/ServiceataGlance/Buses/All?key=${encodeURIComponent(config.metrolinx.apiKey)}`;

    const response = await fetch(url, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(config.upstreamTimeoutMs),
      cache: 'no-store',
    });
    if (!response.ok) throw new Error(`Metrolinx HTTP ${response.status}`);

    // The feed is served with a UTF-8 BOM, which JSON.parse rejects.
    const text = (await response.text()).replace(/^﻿/, '');
    const parsed = payloadSchema.safeParse(JSON.parse(text));
    if (!parsed.success) return [];

    return (parsed.data.Trips?.Trip ?? []).flatMap((trip): RawBus[] => {
      if (!trip.TripNumber || trip.Latitude == null || trip.Longitude == null) return [];
      // 0,0 is the feed's way of saying it has no fix.
      if (trip.Latitude === 0 && trip.Longitude === 0) return [];
      return [
        {
          tripNumber: trip.TripNumber.trim(),
          lineCode: trip.LineCode?.trim() || undefined,
          headsign: splitDisplay(trip.Display),
          latitude: trip.Latitude,
          longitude: trip.Longitude,
          isMoving: trip.IsInMotion ?? undefined,
          // A bus reported as early is on time; only lateness is useful here.
          delaySeconds: trip.DelaySeconds != null ? Math.max(0, trip.DelaySeconds) : undefined,
          originStopCode: stopCode(trip.FirstStopCode),
          nextStopCode: stopCode(trip.NextStopCode),
          atStopCode: stopCode(trip.AtStationCode),
          updatedAt: trip.ModifiedDate ?? undefined,
        },
      ];
    });
  });

  return result.value;
}
