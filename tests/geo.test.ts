import { describe, expect, it } from 'vitest';
import {
  distanceKm,
  distanceToSegmentKm,
  formatDistance,
  progressAlongLeg,
} from '@/lib/transit/geo';
import { walkMinutes } from '@/lib/client/walkTime';

/**
 * The geometry that decides which stop a vehicle is at, where the dot sits on a
 * trip timeline, and how long a walk to the station takes. Getting any of these
 * wrong puts a rider at the wrong stop.
 */

const UNION = { lat: 43.645195, lon: -79.3806 };
const BURLINGTON = { lat: 43.341265, lon: -79.809141 };
const OAKVILLE = { lat: 43.4568, lon: -79.6834 };

describe('distanceKm', () => {
  it('is zero for a point against itself', () => {
    expect(distanceKm(UNION.lat, UNION.lon, UNION.lat, UNION.lon)).toBe(0);
  });

  it('matches the real Union–Burlington distance', () => {
    // ~50 km as the crow flies.
    const km = distanceKm(UNION.lat, UNION.lon, BURLINGTON.lat, BURLINGTON.lon);
    expect(km).toBeGreaterThan(48);
    expect(km).toBeLessThan(52);
  });

  it('is symmetric', () => {
    const there = distanceKm(UNION.lat, UNION.lon, OAKVILLE.lat, OAKVILLE.lon);
    const back = distanceKm(OAKVILLE.lat, OAKVILLE.lon, UNION.lat, UNION.lon);
    expect(there).toBeCloseTo(back, 9);
  });

  it('resolves platform-scale distances', () => {
    // Roughly 100 m north. The bus locator calls a stop "reached" at 250 m, so
    // this scale has to be trustworthy.
    const km = distanceKm(UNION.lat, UNION.lon, UNION.lat + 0.0009, UNION.lon);
    expect(km).toBeGreaterThan(0.08);
    expect(km).toBeLessThan(0.12);
  });
});

describe('distanceToSegmentKm', () => {
  it('is zero on the segment itself', () => {
    const mid = { lat: (UNION.lat + OAKVILLE.lat) / 2, lon: (UNION.lon + OAKVILLE.lon) / 2 };
    expect(distanceToSegmentKm(mid.lat, mid.lon, UNION, OAKVILLE)).toBeLessThan(0.5);
  });

  it('clamps to the endpoints rather than the infinite line', () => {
    // A point well beyond Burlington must measure to Burlington, not to some
    // imagined continuation of the track.
    const beyond = { lat: 43.2, lon: -79.95 };
    const toSegment = distanceToSegmentKm(beyond.lat, beyond.lon, UNION, BURLINGTON);
    const toEnd = distanceKm(beyond.lat, beyond.lon, BURLINGTON.lat, BURLINGTON.lon);
    // Within 1%, not to the metre: distanceToSegmentKm works on a local flat
    // approximation while distanceKm is a great circle, and over 19 km the two
    // differ by about 50 m. That gap is the projection, not a clamping failure.
    expect(Math.abs(toSegment - toEnd) / toEnd).toBeLessThan(0.01);
  });

  it('handles a zero-length segment without dividing by zero', () => {
    const d = distanceToSegmentKm(OAKVILLE.lat, OAKVILLE.lon, UNION, UNION);
    expect(Number.isFinite(d)).toBe(true);
    expect(d).toBeGreaterThan(0);
  });

  it('picks the nearer of two legs, which is how a bus finds its leg', () => {
    const nearOakville = { lat: 43.46, lon: -79.69 };
    const onFirstLeg = distanceToSegmentKm(nearOakville.lat, nearOakville.lon, UNION, OAKVILLE);
    const onSecondLeg = distanceToSegmentKm(
      nearOakville.lat,
      nearOakville.lon,
      OAKVILLE,
      BURLINGTON,
    );
    expect(Math.min(onFirstLeg, onSecondLeg)).toBeLessThan(2);
  });
});

describe('progressAlongLeg', () => {
  it('is 0 at the start and 1 at the end', () => {
    expect(progressAlongLeg(UNION.lat, UNION.lon, UNION, BURLINGTON)).toBeCloseTo(0, 5);
    expect(progressAlongLeg(BURLINGTON.lat, BURLINGTON.lon, UNION, BURLINGTON)).toBeCloseTo(1, 5);
  });

  it('is about half way at the midpoint', () => {
    const mid = {
      lat: (UNION.lat + BURLINGTON.lat) / 2,
      lon: (UNION.lon + BURLINGTON.lon) / 2,
    };
    expect(progressAlongLeg(mid.lat, mid.lon, UNION, BURLINGTON)).toBeCloseTo(0.5, 1);
  });

  it('never leaves 0..1, so the dot cannot run off the line', () => {
    const before = progressAlongLeg(43.9, -79.2, UNION, BURLINGTON);
    const after = progressAlongLeg(43.0, -80.2, UNION, BURLINGTON);
    expect(before).toBeGreaterThanOrEqual(0);
    expect(before).toBeLessThanOrEqual(1);
    expect(after).toBeGreaterThanOrEqual(0);
    expect(after).toBeLessThanOrEqual(1);
  });

  it('increases monotonically along the leg', () => {
    let previous = -1;
    for (let t = 0; t <= 1.0001; t += 0.1) {
      const lat = UNION.lat + (BURLINGTON.lat - UNION.lat) * t;
      const lon = UNION.lon + (BURLINGTON.lon - UNION.lon) * t;
      const p = progressAlongLeg(lat, lon, UNION, BURLINGTON);
      expect(p).toBeGreaterThanOrEqual(previous);
      previous = p;
    }
  });

  it('returns 0 for a zero-length leg instead of NaN', () => {
    expect(progressAlongLeg(UNION.lat, UNION.lon, UNION, UNION)).toBe(0);
  });
});

describe('formatDistance', () => {
  it('uses metres below a kilometre and kilometres above', () => {
    expect(formatDistance(0.25)).toBe('250 m');
    expect(formatDistance(1.24)).toBe('1.2 km');
    expect(formatDistance(42)).toBe('42 km');
  });
});

describe('walkMinutes', () => {
  it('never returns less than a minute', () => {
    expect(walkMinutes(0)).toBe(1);
    expect(walkMinutes(0.01)).toBe(1);
  });

  it('is a plausible pace for a real walk', () => {
    // 1 km of straight line is ~1.35 km of streets at 4.8 km/h ≈ 17 min.
    expect(walkMinutes(1)).toBeGreaterThanOrEqual(15);
    expect(walkMinutes(1)).toBeLessThanOrEqual(20);
  });

  it('grows with distance and never shrinks', () => {
    let previous = 0;
    for (let km = 0; km <= 5; km += 0.25) {
      const m = walkMinutes(km);
      expect(m).toBeGreaterThanOrEqual(previous);
      previous = m;
    }
  });
});
