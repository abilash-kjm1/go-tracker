import { distanceKm } from './geo';

/**
 * How old a position fix is, and what the map may honestly do with it.
 *
 * Measured against the live feed on a weekday afternoon: train fixes ran
 * 20–42 seconds old and not one was over two minutes. Buses were different —
 * half were under 20 seconds, but 14% of 143 buses were over two minutes
 * stale, eleven were over five, and the worst had not reported for an hour
 * and a half. Several of those claimed to be in motion.
 *
 * Every one of them was drawn on the map exactly like a vehicle that reported
 * a second ago. That is the whole of "the bus is not moving accurately": it
 * is not moving badly, it has stopped reporting, and nothing said so.
 */

/**
 * Under this, a fix is current enough to present as live.
 *
 * 90s clears the entire chain — upstream ~30s, server cache 15s, CDN 10s,
 * client poll 15s — so a healthy vehicle is never wrongly flagged.
 */
export const FRESH_MS = 90_000;

/**
 * Past this, a fix is not evidence of where anything is now. A bus at
 * 60 km/h is ten kilometres from a ten-minute-old position, so the map
 * declines to place it rather than placing it wrongly.
 */
export const LOST_MS = 10 * 60_000;

/**
 * The fastest a GO vehicle plausibly travels, km/h. Express trains on the
 * Lakeshore run near 140; nothing in the fleet sustains more than this.
 */
export const MAX_SPEED_KMH = 160;

/** Age of a vehicle's fix in ms. Infinity when it never gave a usable one. */
export function fixAgeMs(updatedAt: string | null | undefined, now = Date.now()): number {
  if (!updatedAt) return Infinity;
  const at = Date.parse(updatedAt);
  return Number.isNaN(at) ? Infinity : Math.max(0, now - at);
}

/** Whether the map should stop calling this position live. */
export function isStaleFix(updatedAt: string | null | undefined, now = Date.now()): boolean {
  return fixAgeMs(updatedAt, now) > FRESH_MS;
}

/** Whether the position is too old to place on a map at all. */
export function isLostFix(updatedAt: string | null | undefined, now = Date.now()): boolean {
  return fixAgeMs(updatedAt, now) > LOST_MS;
}

export interface MarkerMotion {
  /** True when the two fixes are not two points on one journey. */
  teleported: boolean;
  /** How long the marker should take to reach the new fix. */
  durationMs: number;
  /** Implied ground speed between the fixes, km/h. Infinity when unknowable. */
  impliedKmh: number;
}

/**
 * How a marker should cross the gap between two fixes.
 *
 * The map used to glide the whole way over the time until the next poll. It
 * looked smooth and was wrong twice over. It left every marker a full
 * interval behind the truth at every moment — what you saw was where the
 * vehicle had been fifteen seconds ago — and when a bus went quiet for three
 * minutes and came back four kilometres on, it drew that as a serene 580 km/h
 * cruise down a road the bus may never have taken.
 *
 * Two fixes are real; the line between them is not. So the marker eases onto
 * the reported position in well under a second and then stands on it, which
 * halves the average error and spends most of its time showing a position GO
 * actually published. And a jump no vehicle could have driven is not a
 * journey to animate — it is placed, not glided.
 */
export function markerMotion(
  previous: { fixAt: number; lat: number; lon: number },
  next: { fixAt: number; lat: number; lon: number },
): MarkerMotion {
  const gapMs = Math.max(0, next.fixAt - previous.fixAt);
  const km = distanceKm(previous.lat, previous.lon, next.lat, next.lon);
  const impliedKmh = gapMs > 0 ? km / (gapMs / 3_600_000) : Infinity;
  const teleported = !Number.isFinite(impliedKmh) || impliedKmh > MAX_SPEED_KMH;
  return {
    teleported,
    impliedKmh,
    durationMs: teleported ? 1 : Math.min(5_000, Math.max(600, gapMs * 0.35)),
  };
}
