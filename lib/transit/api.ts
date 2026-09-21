import 'server-only';

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { config } from './config';
import { GtfsMissingError } from './gtfs';
import type { ApiEnvelope, DataFreshness } from './types';

/** Stop and trip ids come straight from GTFS: short, alphanumeric, no slashes. */
export const idSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z0-9_.-]+$/, 'invalid id');

export const searchQuerySchema = z.string().trim().min(1).max(80);

export function envelope<T>(
  data: T,
  meta: {
    updatedAt?: Date | string | null;
    freshness?: DataFreshness;
    degraded?: string;
  } = {},
): ApiEnvelope<T> {
  const updatedAt =
    meta.updatedAt instanceof Date
      ? meta.updatedAt.toISOString()
      : (meta.updatedAt ?? null);

  const ageSeconds = updatedAt
    ? Math.max(0, Math.round((Date.now() - new Date(updatedAt).getTime()) / 1000))
    : null;

  let freshness: DataFreshness = meta.freshness ?? 'live';
  if (freshness === 'live' && ageSeconds != null && ageSeconds > config.staleAfterSeconds) {
    freshness = 'stale';
  }

  return {
    data,
    meta: {
      freshness,
      updatedAt,
      ageSeconds,
      provider: config.provider,
      ...(meta.degraded ? { degraded: meta.degraded } : {}),
    },
  };
}

const NO_STORE = {
  'Cache-Control': 'no-store, must-revalidate',
} as const;

/**
 * How long Vercel's CDN may serve a response without asking us again.
 *
 * This is what makes the app fast and keeps the upstream calm: with a 15s
 * `s-maxage`, a thousand people watching one station cost one function run
 * every 15 seconds instead of a thousand. `stale-while-revalidate` lets the
 * edge answer instantly with the last copy while it refreshes in the
 * background. The browser itself never caches (`max-age=0`), so a reload is
 * always answered by the edge, never by a stale local copy.
 *
 * Accuracy is bounded, not sacrificed: every payload carries `updatedAt`, so
 * the freshness label always reflects the age of the data, whichever cache
 * served it. TTLs track how fast each dataset genuinely changes.
 */
export type CacheTier = 'none' | 'live' | 'board' | 'alerts' | 'search' | 'static';

const CACHE_POLICY: Record<CacheTier, string> = {
  none: 'no-store, must-revalidate',
  // Vehicle positions move every ~25s upstream.
  live: 'public, max-age=0, s-maxage=10, stale-while-revalidate=20',
  // Boards blend the timetable with live delay and platform.
  board: 'public, max-age=0, s-maxage=15, stale-while-revalidate=30',
  alerts: 'public, max-age=0, s-maxage=30, stale-while-revalidate=60',
  search: 'public, max-age=0, s-maxage=300, stale-while-revalidate=600',
  // Timetable-derived and only changes when the snapshot is rebuilt.
  static: 'public, max-age=0, s-maxage=3600, stale-while-revalidate=86400',
};

export function ok<T>(body: ApiEnvelope<T>, status = 200, tier: CacheTier = 'none') {
  return NextResponse.json(body, {
    status,
    // Only successes are cached: an error must never be replayed to everyone.
    headers: { 'Cache-Control': status === 200 ? CACHE_POLICY[tier] : CACHE_POLICY.none },
  });
}

export const okLive = <T,>(body: ApiEnvelope<T>) => ok(body, 200, 'live');
export const okBoard = <T,>(body: ApiEnvelope<T>) => ok(body, 200, 'board');
export const okAlerts = <T,>(body: ApiEnvelope<T>) => ok(body, 200, 'alerts');
export const okSearch = <T,>(body: ApiEnvelope<T>) => ok(body, 200, 'search');
export const okStatic = <T,>(body: ApiEnvelope<T>) => ok(body, 200, 'static');

/**
 * Error responses never leak upstream URLs, keys or stack traces — just a
 * short reason the UI can show.
 */
export function fail(message: string, status = 502, extra?: Record<string, unknown>) {
  return NextResponse.json(
    { error: message, ...extra, meta: { provider: config.provider } },
    { status, headers: NO_STORE },
  );
}

export function handleError(err: unknown) {
  if (err instanceof GtfsMissingError) {
    return fail(err.message, 503);
  }
  if (err instanceof z.ZodError) {
    return fail('Invalid request', 400);
  }
  const message = err instanceof Error ? err.message : 'Upstream request failed';
  // Strip anything that looks like a URL or key before it reaches the client.
  const safe = message.replace(/https?:\/\/\S+/g, 'upstream').replace(/key=[^&\s]+/gi, 'key=***');
  return fail(safe, 502);
}

// ---- rate limiting -------------------------------------------------------

const buckets = new Map<string, { count: number; resetAt: number }>();

/**
 * Small fixed-window limiter. Enough to stop a single client hammering our
 * routes; the upstream is protected by the cache regardless.
 */
export function rateLimit(request: Request, limit = 120, windowMs = 60_000): NextResponse | null {
  const ip =
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    request.headers.get('x-real-ip') ||
    'local';
  const now = Date.now();
  const bucket = buckets.get(ip);

  if (!bucket || now > bucket.resetAt) {
    buckets.set(ip, { count: 1, resetAt: now + windowMs });
    return null;
  }
  bucket.count++;
  if (bucket.count > limit) {
    return NextResponse.json(
      { error: 'Too many requests' },
      { status: 429, headers: { ...NO_STORE, 'Retry-After': String(Math.ceil((bucket.resetAt - now) / 1000)) } },
    );
  }
  if (buckets.size > 5000) buckets.clear();
  return null;
}
