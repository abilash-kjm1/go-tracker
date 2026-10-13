import { describe, expect, it } from 'vitest';
import {
  currentServiceDate,
  formatAge,
  formatClock,
  formatCountdown,
  formatDelay,
  greeting,
  torontoParts,
  zonedToInstant,
} from '@/lib/transit/time';

/**
 * The timezone and service-day maths, which is where this app's real bugs have
 * lived: departures showing as already gone, journeys arriving before they
 * left, and tomorrow's services leaking into today's board.
 *
 * Toronto is UTC-5 in winter (EST) and UTC-4 in summer (EDT). In 2026 the
 * clocks go forward on 8 March and back on 1 November.
 */

const utc = (iso: string) => new Date(iso);

describe('torontoParts', () => {
  it('reads a summer instant as EDT (UTC-4)', () => {
    const p = torontoParts(utc('2026-07-01T16:30:00Z'));
    expect(p.dateKey).toBe('20260701');
    expect(p.hour).toBe(12);
    expect(p.minute).toBe(30);
  });

  it('reads a winter instant as EST (UTC-5)', () => {
    const p = torontoParts(utc('2026-01-15T16:30:00Z'));
    expect(p.hour).toBe(11);
  });

  it('rolls the date back when UTC is already the next day', () => {
    // 03:30 UTC is 22:30 the previous evening in Toronto.
    const p = torontoParts(utc('2026-07-02T03:30:00Z'));
    expect(p.dateKey).toBe('20260701');
    expect(p.hour).toBe(23);
  });

  it('reports midnight as hour 0, not 24', () => {
    const p = torontoParts(utc('2026-07-01T04:00:00Z'));
    expect(p.hour).toBe(0);
    expect(p.secondsOfDay).toBe(0);
  });
});

describe('zonedToInstant', () => {
  it('maps a summer service time to the right UTC instant', () => {
    // 08:30 local on 1 July 2026, EDT, is 12:30Z.
    expect(zonedToInstant('20260701', 8 * 3600 + 30 * 60).toISOString()).toBe(
      '2026-07-01T12:30:00.000Z',
    );
  });

  it('maps a winter service time to the right UTC instant', () => {
    // 08:30 local on 15 January 2026, EST, is 13:30Z.
    expect(zonedToInstant('20260115', 8 * 3600 + 30 * 60).toISOString()).toBe(
      '2026-01-15T13:30:00.000Z',
    );
  });

  it('handles GTFS times past 24:00:00 as the following morning', () => {
    // 25:10 on the 1st is 01:10 on the 2nd, local.
    const at = zonedToInstant('20260701', 25 * 3600 + 10 * 60);
    expect(at.toISOString()).toBe('2026-07-02T05:10:00.000Z');
    expect(torontoParts(at).hour).toBe(1);
    expect(torontoParts(at).dateKey).toBe('20260702');
  });

  it('keeps times strictly ordered across the 24:00 boundary', () => {
    const before = zonedToInstant('20260701', 23 * 3600 + 59 * 60);
    const after = zonedToInstant('20260701', 24 * 3600 + 1 * 60);
    expect(after.getTime()).toBeGreaterThan(before.getTime());
  });

  describe('daylight saving', () => {
    it('is correct on either side of the spring forward', () => {
      // 8 March 2026: 02:00 becomes 03:00. 01:30 is still EST, 03:30 is EDT.
      expect(zonedToInstant('20260308', 1 * 3600 + 30 * 60).toISOString()).toBe(
        '2026-03-08T06:30:00.000Z',
      );
      expect(zonedToInstant('20260308', 3 * 3600 + 30 * 60).toISOString()).toBe(
        '2026-03-08T07:30:00.000Z',
      );
    });

    it('does not go backwards across the spring-forward gap', () => {
      // 02:30 does not exist. Whatever it resolves to must still sit between
      // its neighbours, or a board would list a later trip above an earlier one.
      const before = zonedToInstant('20260308', 1 * 3600 + 30 * 60).getTime();
      const gap = zonedToInstant('20260308', 2 * 3600 + 30 * 60).getTime();
      const after = zonedToInstant('20260308', 3 * 3600 + 30 * 60).getTime();
      expect(gap).toBeGreaterThanOrEqual(before);
      expect(gap).toBeLessThanOrEqual(after);
    });

    it('is correct on either side of the autumn fall back', () => {
      // 1 November 2026: 02:00 becomes 01:00. 00:30 is EDT, 03:30 is EST.
      expect(zonedToInstant('20261101', 0 * 3600 + 30 * 60).toISOString()).toBe(
        '2026-11-01T04:30:00.000Z',
      );
      expect(zonedToInstant('20261101', 3 * 3600 + 30 * 60).toISOString()).toBe(
        '2026-11-01T08:30:00.000Z',
      );
    });

    it('keeps a whole DST day monotonically increasing', () => {
      // The strongest guarantee a departure board needs: later in the
      // timetable always means later in real time.
      for (const dateKey of ['20260308', '20261101']) {
        let previous = -Infinity;
        for (let s = 0; s < 28 * 3600; s += 600) {
          const at = zonedToInstant(dateKey, s).getTime();
          expect(at, `${dateKey} at ${s}s went backwards`).toBeGreaterThanOrEqual(previous);
          previous = at;
        }
      }
    });
  });

  it('round-trips against torontoParts for a year of noons', () => {
    for (let month = 1; month <= 12; month++) {
      const dateKey = `2026${String(month).padStart(2, '0')}15`;
      const at = zonedToInstant(dateKey, 12 * 3600);
      const parts = torontoParts(at);
      expect(parts.dateKey).toBe(dateKey);
      expect(parts.hour).toBe(12);
    }
  });
});

describe('currentServiceDate', () => {
  it('uses today once the service day has started', () => {
    // 10:00 local on 1 July.
    const r = currentServiceDate(utc('2026-07-01T14:00:00Z'));
    expect(r.dateKey).toBe('20260701');
    expect(r.secondsOfDay).toBe(10 * 3600);
  });

  it('still belongs to yesterday just after midnight', () => {
    // 00:40 local on 2 July is the 1st's service day at 24:40.
    const r = currentServiceDate(utc('2026-07-02T04:40:00Z'));
    expect(r.dateKey).toBe('20260701');
    expect(r.secondsOfDay).toBe(24 * 3600 + 40 * 60);
  });

  it('switches to the new service day at 4am', () => {
    const before = currentServiceDate(utc('2026-07-02T07:59:00Z')); // 03:59 local
    const after = currentServiceDate(utc('2026-07-02T08:01:00Z')); // 04:01 local
    expect(before.dateKey).toBe('20260701');
    expect(after.dateKey).toBe('20260702');
  });

  it('rolls back across a month boundary', () => {
    // 00:30 local on 1 August belongs to 31 July.
    const r = currentServiceDate(utc('2026-08-01T04:30:00Z'));
    expect(r.dateKey).toBe('20260731');
  });

  it('rolls back across a year boundary', () => {
    // 00:30 local on 1 January 2027 belongs to 31 December 2026.
    const r = currentServiceDate(utc('2027-01-01T05:30:00Z'));
    expect(r.dateKey).toBe('20261231');
  });

  it('agrees with zonedToInstant about where "now" is', () => {
    const now = utc('2026-07-02T04:40:00Z');
    const { dateKey, secondsOfDay } = currentServiceDate(now);
    expect(zonedToInstant(dateKey, secondsOfDay).toISOString()).toBe(now.toISOString());
  });
});

describe('formatCountdown', () => {
  const now = Date.parse('2026-07-01T12:00:00Z');
  const inMinutes = (m: number) => new Date(now + m * 60_000).toISOString();

  it('counts up to the hour and then in hours', () => {
    expect(formatCountdown(inMinutes(8), now)).toBe('8 min');
    expect(formatCountdown(inMinutes(0), now)).toBe('Now');
    expect(formatCountdown(inMinutes(72), now)).toBe('1h 12m');
  });

  it('says how long ago a service went, then gives up', () => {
    expect(formatCountdown(inMinutes(-3), now)).toBe('3 min ago');
    expect(formatCountdown(inMinutes(-61), now)).toBe('Departed');
  });

  it('returns empty for missing or unparseable input', () => {
    expect(formatCountdown(undefined, now)).toBe('');
    expect(formatCountdown('not a date', now)).toBe('');
  });
});

describe('formatDelay', () => {
  it('treats zero and negative as on time', () => {
    // A service never leaves early; the upstream reports large negative delays
    // for trains waiting at a terminus.
    expect(formatDelay(0)).toBe('On time');
    expect(formatDelay(-1100)).toBe('On time');
  });

  it('rounds lateness to whole minutes', () => {
    expect(formatDelay(180)).toBe('+3 min');
    expect(formatDelay(200)).toBe('+3 min');
  });

  it('is empty when there is no delay information at all', () => {
    expect(formatDelay(null)).toBe('');
    expect(formatDelay(undefined)).toBe('');
  });
});

describe('formatAge and formatClock', () => {
  const now = Date.parse('2026-07-01T12:00:00Z');

  it('describes freshness in the largest sensible unit', () => {
    expect(formatAge(new Date(now - 8_000).toISOString(), now)).toBe('8 sec ago');
    expect(formatAge(new Date(now - 120_000).toISOString(), now)).toBe('2 min ago');
    expect(formatAge(new Date(now - 7_200_000).toISOString(), now)).toBe('2 h ago');
    expect(formatAge(null, now)).toBe('never');
  });

  it('never reports a negative age for a clock that is slightly ahead', () => {
    expect(formatAge(new Date(now + 5_000).toISOString(), now)).toBe('0 sec ago');
  });

  it('formats a clock in Toronto regardless of host timezone', () => {
    expect(formatClock('2026-07-01T16:30:00Z')).toMatch(/12:30/);
    expect(formatClock(undefined)).toBe('--:--');
    expect(formatClock('nonsense')).toBe('--:--');
  });
});

describe('greeting', () => {
  it('follows Toronto time, not the host clock', () => {
    // 13:00Z is 09:00 in Toronto in July — morning there, afternoon in UTC.
    expect(greeting(utc('2026-07-01T13:00:00Z'))).toBe('Good morning');
    expect(greeting(utc('2026-07-01T18:00:00Z'))).toBe('Good afternoon');
    expect(greeting(utc('2026-07-01T23:00:00Z'))).toBe('Good evening');
  });
});
