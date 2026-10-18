import { NextResponse } from 'next/server';
import { rateLimit } from '@/lib/transit/api';
import { requireTickSecret } from '@/lib/transit/tickAuth';
import {
  listWatches,
  pushConfigured,
  readTickStatus,
  watchesSurvive,
} from '@/lib/transit/platformWatch';
import { getLiveBoard } from '@/lib/transit/sources/goTrackerBoards';
import { getProvider } from '@/lib/transit/provider';
import { listDevices } from '@/lib/transit/pushDevice';
import { listLineWatches } from '@/lib/transit/lineWatch';
import { listTests } from '@/lib/transit/pushTest';

export const dynamic = 'force-dynamic';

/**
 * What the watches are waiting on, for working out why an alert has not
 * arrived. Behind the same secret as the tick, and it never returns the push
 * subscription itself.
 */
export async function GET(request: Request) {
  const limited = rateLimit(request, 30);
  if (limited) return limited;

  const denied = requireTickSecret(request);
  if (denied) return denied;

  const watches = await listWatches();
  const status = await readTickStatus();
  // "Nothing arrived" has three quite different causes — no phone registered,
  // nothing asked for, or the sending itself failing — and only the first two
  // are visible from here. Both are now.
  const devices = await listDevices().catch(() => []);
  const lines = await listLineWatches().catch(() => []);
  const tests = await listTests().catch(() => []);
  const out = [];

  for (const { value } of watches) {
    const kind = value.kind ?? 'platform';
    let seen: unknown = null;

    if (kind === 'platform') {
      const board = await getLiveBoard(value.stopId).catch(() => null);
      seen = {
        boardRows: board ? board.byTrip.size : 0,
        tripOnBoard: Boolean(board?.byTrip.get(value.tripNumber)),
        platform: board?.byTrip.get(value.tripNumber)?.platform ?? null,
        note: board?.byTrip.get(value.tripNumber)?.note ?? null,
      };
    } else if (value.tripId) {
      const trip = await (await getProvider()).getTrip(value.tripId).catch(() => null);
      const stop = trip?.stops.find((s) => s.stopId === value.stopId);
      seen = { tripFound: Boolean(trip), stopStatus: stop?.status ?? null };
    }

    out.push({
      kind,
      stopId: value.stopId,
      stopName: value.stopName,
      tripNumber: value.tripNumber,
      tripId: value.tripId ?? null,
      departsAt: value.departsAt,
      minutesUntilDeparture: Math.round((Date.parse(value.departsAt) - Date.now()) / 60000),
      pushHost: (() => {
        try {
          return new URL(value.subscription.endpoint).host;
        } catch {
          return 'invalid';
        }
      })(),
      seen,
    });
  }

  return NextResponse.json({
    // Without these two a watch cannot possibly fire, and no amount of staring
    // at the list below will say why.
    pushConfigured: pushConfigured(),
    watchesSurvive: watchesSurvive(),
    lastTickAt: status ? new Date(status.lastAt).toISOString() : null,
    minutesSinceTick: status ? Math.round((Date.now() - status.lastAt) / 60000) : null,
    failingStreak: status?.failingStreak ?? 0,
    // The last twenty runs, newest first: what actually happened the night an
    // alert did not arrive, instead of having to guess at it afterwards.
    recentTicks: (status?.recent ?? []).map((run) => ({
      at: new Date(run.at).toISOString(),
      ok: run.ok,
      ms: run.ms,
      checked: run.checked,
      notified: run.notified,
      ...(run.cutShort ? { cutShort: true } : {}),
      ...(run.error ? { error: run.error } : {}),
    })),
    // Phones that have registered at all. Zero here means nothing the rider
    // does in the app can ever reach them, whatever else looks healthy.
    devices: devices.map(({ value }) => ({
      label: value.label ?? 'unknown',
      host: (() => {
        try {
          return new URL(value.subscription.endpoint).host;
        } catch {
          return 'invalid';
        }
      })(),
      registeredAt: new Date(value.createdAt).toISOString(),
      lastSeenAt: new Date(value.seenAt).toISOString(),
    })),
    followedLines: lines.map(({ value }) => ({
      routeName: value.routeName,
      routeId: value.routeId,
      notifiedAt: value.notifiedAt ? new Date(value.notifiedAt).toISOString() : null,
    })),
    pendingTests: tests.length,
    count: out.length,
    watches: out,
  }, {
    headers: { 'Cache-Control': 'no-store' },
  });
}
