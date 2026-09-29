import { NextResponse } from 'next/server';
import { listWatches } from '@/lib/transit/platformWatch';
import { getLiveBoard } from '@/lib/transit/sources/goTrackerBoards';
import { getProvider } from '@/lib/transit/provider';

export const dynamic = 'force-dynamic';

/**
 * What the watches are waiting on, for working out why an alert has not
 * arrived. Behind the same secret as the tick, and it never returns the push
 * subscription itself.
 */
export async function GET(request: Request) {
  const expected = process.env.PUSH_TICK_SECRET;
  const provided = new URL(request.url).searchParams.get('key');
  if (!expected || provided !== expected) {
    return NextResponse.json({ error: 'Not authorised' }, { status: 401 });
  }

  const watches = await listWatches();
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

  return NextResponse.json({ count: out.length, watches: out }, {
    headers: { 'Cache-Control': 'no-store' },
  });
}
