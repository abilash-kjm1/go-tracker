import { describe, expect, it } from 'vitest';
import { CALM_MS, type LineWatch, decideLine, lineMessage } from '@/lib/transit/lineWatch';
import type { TransitAlert } from '@/lib/transit/types';

const NOW = Date.parse('2026-10-18T12:00:00.000Z');
const ROUTE = '09261126-30';

const watch = (over: Partial<LineWatch> = {}): LineWatch => ({
  routeId: ROUTE,
  routeName: 'Lakeshore West',
  subscription: { endpoint: 'https://fcm.googleapis.com/fcm/send/x', keys: { p256dh: 'p', auth: 'a' } },
  createdAt: NOW - 86_400_000,
  ...over,
});

const alert = (over: Partial<TransitAlert> = {}): TransitAlert => ({
  id: `delay:Lakeshore West`,
  severity: 'severe',
  title: 'Lakeshore West',
  body: '2 services are running late (worst 22 min).',
  scope: { kind: 'route', id: ROUTE, name: 'Lakeshore West' },
  updatedAt: new Date(NOW).toISOString(),
  ...over,
});

describe('decideLine', () => {
  it('notifies when a followed line first goes severe', () => {
    const action = decideLine(watch(), [alert()], NOW);
    expect(action.do).toBe('notify');
    if (action.do === 'notify') expect(action.next.notifiedAt).toBe(NOW);
  });

  // The whole point of the restraint: a bad morning lasts an hour, and the
  // tick runs every minute. Sixty notifications is not a service.
  it('says nothing more while the same trouble continues', () => {
    const already = watch({ notifiedAt: NOW - 10 * 60_000 });
    expect(decideLine(already, [alert()], NOW).do).toBe('nothing');
  });

  // A "warning" is any service two minutes down. Sixteen lines were carrying
  // one at three in the morning; not one of them was worth a notification.
  it('ignores a line that is merely a little late', () => {
    expect(decideLine(watch(), [alert({ severity: 'warning' })], NOW).do).toBe('nothing');
    expect(decideLine(watch(), [alert({ severity: 'info' })], NOW).do).toBe('nothing');
  });

  it('ignores trouble on somebody else’s line', () => {
    const other = alert({ scope: { kind: 'route', id: 'other-route', name: 'Milton' } });
    expect(decideLine(watch(), [other], NOW).do).toBe('nothing');
  });

  it('ignores an alert that is not about a route at all', () => {
    const network = alert({ scope: { kind: 'network' } });
    expect(decideLine(watch(), [network], NOW).do).toBe('nothing');
  });

  it('says nothing when there is no trouble and none was reported', () => {
    expect(decideLine(watch(), [], NOW).do).toBe('nothing');
  });

  describe('recovering', () => {
    it('starts the clock when the trouble clears', () => {
      const action = decideLine(watch({ notifiedAt: NOW - 600_000 }), [], NOW);
      expect(action.do).toBe('save');
      if (action.do === 'save') expect(action.next.calmSince).toBe(NOW);
    });

    it('will not call it over too soon', () => {
      const recovering = watch({ notifiedAt: NOW - 900_000, calmSince: NOW - 60_000 });
      expect(decideLine(recovering, [], NOW).do).toBe('nothing');
    });

    it('clears the incident once the line has behaved for half an hour', () => {
      const recovering = watch({ notifiedAt: NOW - 3_600_000, calmSince: NOW - CALM_MS });
      const action = decideLine(recovering, [], NOW);
      expect(action.do).toBe('save');
      if (action.do === 'save') {
        expect(action.next.notifiedAt).toBeUndefined();
        expect(action.next.calmSince).toBeUndefined();
      }
    });

    it('notifies again for a genuinely new incident', () => {
      const settled = watch({ notifiedAt: undefined, calmSince: undefined });
      expect(decideLine(settled, [alert()], NOW).do).toBe('notify');
    });

    // A service hovering either side of fifteen minutes must not be able to
    // ring the phone over and over.
    it('does not let a flapping line raise a second alert', () => {
      // Briefly calm...
      const calmed = decideLine(watch({ notifiedAt: NOW - 300_000 }), [], NOW);
      expect(calmed.do).toBe('save');
      if (calmed.do !== 'save') return;
      // ...then severe again a minute later, well inside the calm period.
      const again = decideLine(calmed.next, [alert()], NOW + 60_000);
      expect(again.do).not.toBe('notify');
      if (again.do === 'save') expect(again.next.calmSince).toBeUndefined();
    });
  });
});

describe('lineMessage', () => {
  it('leads with the line and carries what is actually known', () => {
    const message = lineMessage(alert(), 'Lakeshore West');
    expect(message.title).toContain('LAKESHORE WEST');
    expect(message.body).toBe('2 services are running late (worst 22 min).');
    expect(message.url).toBe(`/routes/${ROUTE}`);
  });

  it('gives one line one tag, so a second never stacks on the first', () => {
    expect(lineMessage(alert(), 'Lakeshore West').tag).toBe(`line-${ROUTE}`);
  });

  it('falls back to the alerts page when the route has no id', () => {
    const scopeless = alert({ scope: { kind: 'route', name: 'Milton' } });
    expect(lineMessage(scopeless, 'Milton').url).toBe('/alerts');
  });
});
