import { describe, expect, it } from 'vitest';
import {
  FRESH_MS,
  LOST_MS,
  MAX_SPEED_KMH,
  fixAgeMs,
  isLostFix,
  isStaleFix,
  markerMotion,
} from '@/lib/transit/liveness';

const NOW = Date.parse('2026-10-15T18:00:00.000Z');
const agoIso = (ms: number) => new Date(NOW - ms).toISOString();

describe('fixAgeMs', () => {
  it('measures how long ago the vehicle reported', () => {
    expect(fixAgeMs(agoIso(42_000), NOW)).toBe(42_000);
  });

  it('treats a missing or unparseable timestamp as infinitely old', () => {
    expect(fixAgeMs(undefined, NOW)).toBe(Infinity);
    expect(fixAgeMs(null, NOW)).toBe(Infinity);
    expect(fixAgeMs('not a date', NOW)).toBe(Infinity);
  });

  it('never reports a negative age when a clock runs ahead', () => {
    expect(fixAgeMs(new Date(NOW + 30_000).toISOString(), NOW)).toBe(0);
  });
});

describe('isStaleFix', () => {
  // The real distribution these thresholds were chosen against: trains ran
  // 20-42s old, half of all buses were under 20s. Neither may be flagged.
  it('leaves a healthy train or bus fix alone', () => {
    expect(isStaleFix(agoIso(20_000), NOW)).toBe(false);
    expect(isStaleFix(agoIso(42_000), NOW)).toBe(false);
  });

  it('still allows for the whole cache chain before flagging', () => {
    // upstream ~30s + server 15s + CDN 10s + client poll 15s = 70s.
    expect(isStaleFix(agoIso(70_000), NOW)).toBe(false);
    expect(isStaleFix(agoIso(FRESH_MS), NOW)).toBe(false);
    expect(isStaleFix(agoIso(FRESH_MS + 1), NOW)).toBe(true);
  });

  it('flags the long tail the bus feed actually produces', () => {
    expect(isStaleFix(agoIso(209_000), NOW)).toBe(true); // 3m29s, seen live
    expect(isStaleFix(agoIso(2_229_000), NOW)).toBe(true); // 37m, seen live
  });

  it('flags a vehicle that never gave a timestamp', () => {
    expect(isStaleFix(undefined, NOW)).toBe(true);
  });
});

describe('isLostFix', () => {
  it('keeps a merely stale fix on the map', () => {
    expect(isLostFix(agoIso(5 * 60_000), NOW)).toBe(false);
  });

  it('drops one too old to be evidence of anything', () => {
    expect(isLostFix(agoIso(LOST_MS + 1), NOW)).toBe(true);
    expect(isLostFix(agoIso(6_619_000), NOW)).toBe(true); // 1h50m, seen live
  });
});

describe('markerMotion', () => {
  // Union Station to roughly Exhibition: about 2.6 km west along Lakeshore.
  const union = { lat: 43.6453, lon: -79.3806 };
  const exhibition = { lat: 43.6346, lon: -79.4166 };

  it('glides between two fixes a vehicle could have driven', () => {
    // 2.6 km in 90s is about 105 km/h: fast, but a Lakeshore express does it.
    const motion = markerMotion(
      { fixAt: NOW - 90_000, ...union },
      { fixAt: NOW, ...exhibition },
    );
    expect(motion.teleported).toBe(false);
    expect(motion.impliedKmh).toBeLessThan(MAX_SPEED_KMH);
  });

  it('places rather than animates a jump nothing could have driven', () => {
    // The same 2.6 km in 15s would be 625 km/h. The feed went quiet and came
    // back; the straight line between is not a path the bus took.
    const motion = markerMotion(
      { fixAt: NOW - 15_000, ...union },
      { fixAt: NOW, ...exhibition },
    );
    expect(motion.teleported).toBe(true);
    expect(motion.durationMs).toBe(1);
  });

  it('places a fix that arrives with no time having passed', () => {
    const motion = markerMotion({ fixAt: NOW, ...union }, { fixAt: NOW, ...exhibition });
    expect(motion.teleported).toBe(true);
  });

  it('does not glide backwards when fixes arrive out of order', () => {
    const motion = markerMotion({ fixAt: NOW, ...union }, { fixAt: NOW - 60_000, ...exhibition });
    expect(motion.teleported).toBe(true);
  });

  it('arrives quickly rather than lagging a whole poll behind', () => {
    // A bus 200 m on after 20s: real movement, animated — but the marker
    // must land on the reported position in well under the 20s gap, or it
    // is permanently showing where the bus used to be.
    const motion = markerMotion(
      { fixAt: NOW - 20_000, lat: 43.6453, lon: -79.3806 },
      { fixAt: NOW, lat: 43.6471, lon: -79.3806 },
    );
    expect(motion.teleported).toBe(false);
    expect(motion.durationMs).toBeLessThanOrEqual(7_000);
    expect(motion.durationMs).toBeGreaterThanOrEqual(600);
  });

  it('never eases for so long that the next fix overtakes it', () => {
    // Even across a five-minute silence the ease is capped, so the marker is
    // never still travelling when the following fix lands.
    const motion = markerMotion(
      { fixAt: NOW - 300_000, lat: 43.6453, lon: -79.3806 },
      { fixAt: NOW, lat: 43.66, lon: -79.3806 },
    );
    expect(motion.durationMs).toBeLessThanOrEqual(5_000);
  });

  it('keeps a stationary vehicle stationary', () => {
    const motion = markerMotion(
      { fixAt: NOW - 30_000, ...union },
      { fixAt: NOW, ...union },
    );
    expect(motion.impliedKmh).toBe(0);
    expect(motion.teleported).toBe(false);
  });
});
