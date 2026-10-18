import { describe, expect, it } from 'vitest';
import { autoAlertsForLeg } from '@/lib/client/activeTrip';
import type { TripDetail } from '@/lib/transit/types';

/**
 * Which stops a journey arms by itself, and — the point of these — which it
 * must not. Every one of these is a notification a rider would otherwise get
 * without asking for it and without needing it.
 */

const stop = (id: string, name: string) => ({
  stopId: id,
  stopName: name,
  status: 'upcoming' as const,
  scheduledArrival: '2026-10-18T09:00:00.000Z',
  scheduledDeparture: '2026-10-18T09:01:00.000Z',
});

const trip = (ids: string[]): TripDetail =>
  ({
    id: 'trip-1',
    tripNumber: '1639',
    routeName: 'Lakeshore West',
    stops: ids.map((id) => stop(id, id)),
  }) as unknown as TripDetail;

const leg = (boardStopId: string, alightStopId: string) => ({
  tripId: 'trip-1',
  boardStopId,
  boardStopName: boardStopId,
  alightStopId,
  alightStopName: alightStopId,
});

describe('autoAlertsForLeg', () => {
  const line = ['UN', 'EX', 'MI', 'LO', 'PO', 'CL', 'OA', 'BO'];

  it('warns twice before the destination, then on arrival', () => {
    const alerts = autoAlertsForLeg(trip(line), leg('UN', 'OA'), true);
    expect(alerts.map((a) => a.stopId)).toEqual(['PO', 'CL', 'OA']);
  });

  it('gives a connection one warning and the change itself', () => {
    const alerts = autoAlertsForLeg(trip(line), leg('UN', 'OA'), false);
    expect(alerts.map((a) => a.stopId)).toEqual(['CL', 'OA']);
  });

  // The bug these exist for: on a short leg, "two stops before the
  // destination" can be the platform the rider is standing on.
  it('never alerts for the stop the rider boards at', () => {
    const alerts = autoAlertsForLeg(trip(line), leg('CL', 'OA'), true);
    expect(alerts.map((a) => a.stopId)).toEqual(['OA']);
    expect(alerts.map((a) => a.stopId)).not.toContain('CL');
  });

  it('never alerts for a stop the train passed before they got on', () => {
    const alerts = autoAlertsForLeg(trip(line), leg('PO', 'OA'), true);
    expect(alerts.map((a) => a.stopId)).toEqual(['CL', 'OA']);
    expect(alerts.map((a) => a.stopId)).not.toContain('MI');
  });

  it('gives a single-stop hop exactly one alert', () => {
    const alerts = autoAlertsForLeg(trip(line), leg('OA', 'BO'), true);
    expect(alerts.map((a) => a.stopId)).toEqual(['BO']);
  });

  it('still warns twice when there is room to', () => {
    const alerts = autoAlertsForLeg(trip(line), leg('UN', 'BO'), true);
    expect(alerts).toHaveLength(3);
  });

  it('says nothing about a destination that is not on this trip', () => {
    expect(autoAlertsForLeg(trip(line), leg('UN', 'NOWHERE'), true)).toEqual([]);
  });

  it('carries what the server needs to watch the stop while the phone sleeps', () => {
    const [first] = autoAlertsForLeg(trip(line), leg('UN', 'OA'), true);
    expect(first.tripNumber).toBe('1639');
    expect(first.departsAt).toBeTruthy();
  });
});
