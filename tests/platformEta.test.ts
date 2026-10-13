import { describe, expect, it } from 'vitest';
import { withPlatformEta } from '@/lib/transit/providers/GoTrackerTemporaryProvider';
import type { Departure } from '@/lib/transit/types';

/**
 * Saying when a platform will be called is a promise, so the rules around it
 * matter more than the arithmetic: it is derived only from the board in hand,
 * only within one stop and one mode, and only when there is enough posted to
 * measure against.
 */

const NOW = Date.parse('2026-10-13T12:00:00Z');

function row(
  minutes: number,
  extra: Partial<Departure> = {},
): Departure {
  return {
    id: `r${minutes}-${extra.platform ?? 'none'}-${extra.stopId ?? 'UN'}-${extra.vehicleType ?? 'train'}`,
    stopId: 'UN',
    stopName: 'Union Station GO',
    vehicleType: 'train',
    scheduledTime: new Date(NOW + minutes * 60_000).toISOString(),
    cancelled: false,
    realtime: true,
    updatedAt: new Date(NOW).toISOString(),
    ...extra,
  };
}

const etaMinutes = (d: Departure) =>
  d.platformEta ? Math.round((Date.parse(d.platformEta) - NOW) / 60_000) : null;

describe('withPlatformEta', () => {
  it('derives the wait from the furthest-out posted platform', () => {
    // Posting horizon is 15 min, so a train leaving in 20 should be called in 5.
    const out = withPlatformEta(
      [
        row(8, { platform: 'Platform 12' }),
        row(15, { platform: 'Platform 7' }),
        row(20),
        row(31),
      ],
      NOW,
    );
    expect(etaMinutes(out[2])).toBe(5);
    expect(etaMinutes(out[3])).toBe(16);
  });

  it('never annotates a departure that already has a platform', () => {
    const out = withPlatformEta(
      [row(8, { platform: 'Platform 12' }), row(15, { platform: 'Platform 7' }), row(40)],
      NOW,
    );
    expect(out[0].platformEta).toBeUndefined();
    expect(out[1].platformEta).toBeUndefined();
  });

  it('says nothing when only one departure is posted', () => {
    // One posted row is an outlier, not a pattern.
    const out = withPlatformEta([row(10, { platform: 'Platform 3' }), row(40)], NOW);
    expect(out[1].platformEta).toBeUndefined();
  });

  it('says nothing when nothing is posted at all', () => {
    const out = withPlatformEta([row(10), row(25), row(40)], NOW);
    expect(out.every((r) => r.platformEta === undefined)).toBe(true);
  });

  it('says nothing for a departure inside the horizon', () => {
    // It is already late enough to have been called and has not been, so the
    // honest answer is silence rather than "any moment now".
    const out = withPlatformEta(
      [row(20, { platform: 'Platform 1' }), row(30, { platform: 'Platform 2' }), row(12)],
      NOW,
    );
    expect(out[2].platformEta).toBeUndefined();
  });

  it('keeps buses and trains apart at the same site', () => {
    // The bug this was written for: Union Bus Terminal posts bays hours ahead,
    // Union's train platforms minutes ahead. Pooled, the buses set a horizon of
    // 90 minutes and no train on the board ever gets an answer.
    const out = withPlatformEta(
      [
        row(60, { vehicleType: 'bus', platform: 'Platform 11' }),
        row(90, { vehicleType: 'bus', platform: 'Platform 5' }),
        row(10, { platform: 'Platform 3' }),
        row(14, { platform: 'Platform 8' }),
        row(25),
      ],
      NOW,
    );
    // The train horizon is 14, so a train at 25 is called in about 11 minutes —
    // it is not drowned by the 90-minute bus horizon.
    expect(etaMinutes(out[4])).toBe(11);
  });

  it('keeps two stops at the same site apart', () => {
    const out = withPlatformEta(
      [
        row(50, { stopId: 'UNB', platform: 'Platform 1' }),
        row(70, { stopId: 'UNB', platform: 'Platform 2' }),
        row(30),
      ],
      NOW,
    );
    // Nothing posted at UN itself, so UN's rows get no answer from UNB's.
    expect(out[2].platformEta).toBeUndefined();
  });

  it('measures from the live estimate, not the timetable', () => {
    const delayed = row(20, { estimatedTime: new Date(NOW + 40 * 60_000).toISOString() });
    const out = withPlatformEta(
      [row(8, { platform: 'Platform 12' }), row(15, { platform: 'Platform 7' }), delayed],
      NOW,
    );
    // Running 20 minutes late, so the platform comes 20 minutes later too.
    expect(etaMinutes(out[2])).toBe(25);
  });

  it('ignores departures already gone when setting the horizon', () => {
    const out = withPlatformEta(
      [
        row(-5, { platform: 'Platform 9' }),
        row(8, { platform: 'Platform 12' }),
        row(15, { platform: 'Platform 7' }),
        row(20),
      ],
      NOW,
    );
    expect(etaMinutes(out[3])).toBe(5);
  });

  it('leaves an unparseable time alone rather than inventing one', () => {
    const broken = row(0, { scheduledTime: 'not a time' });
    const out = withPlatformEta(
      [row(8, { platform: 'Platform 12' }), row(15, { platform: 'Platform 7' }), broken],
      NOW,
    );
    expect(out[2].platformEta).toBeUndefined();
  });
});
