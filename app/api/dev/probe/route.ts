import { NextResponse } from 'next/server';
import { z } from 'zod';
import { config } from '@/lib/transit/config';
import { getProvider } from '@/lib/transit/provider';
import { GoTrackerTemporaryProvider } from '@/lib/transit/providers/GoTrackerTemporaryProvider';
import { rateLimit } from '@/lib/transit/api';
import { probeBoard } from '@/lib/transit/sources/goTrackerBoards';
import { parseBusSignage, parseRailSignage } from '@/lib/transit/parsers/goTrackerLiveParser';

export const dynamic = 'force-dynamic';

const querySchema = z.object({
  kind: z.enum(['vehicles', 'station', 'message', 'search', 'trip', 'provider', 'board', 'busboard', 'terminals']),
  // Constrained so this can never be used to probe an arbitrary upstream path.
  // Slash allowed so a rail probe can pass "LW/BU".
  arg: z
    .string()
    .max(64)
    .regex(/^[A-Za-z0-9_ ./-]*$/)
    .optional(),
});

/**
 * Backs the /dev/transit console. Disabled unless ENABLE_DEV_TRANSIT_PAGE is
 * set, and it only ever calls fixed upstream operations — there is no
 * arbitrary URL proxying here.
 */
export async function GET(request: Request) {
  if (!config.devPageEnabled) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  const limited = rateLimit(request, 30);
  if (limited) return limited;

  const url = new URL(request.url);
  const parsed = querySchema.safeParse({
    kind: url.searchParams.get('kind') ?? 'vehicles',
    arg: url.searchParams.get('arg') ?? undefined,
  });
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid probe request' }, { status: 400 });
  }

  const { kind, arg } = parsed.data;
  const started = Date.now();

  try {
    const provider = await getProvider();

    if (kind === 'provider') {
      return NextResponse.json({
        ok: true,
        latencyMs: Date.now() - started,
        summary: { provider: provider.id, label: provider.label },
        raw: JSON.stringify(await provider.health(), null, 2),
      });
    }

    if (kind === 'search') {
      const results = await provider.search(arg || 'union');
      return NextResponse.json({
        ok: true,
        latencyMs: Date.now() - started,
        summary: {
          stops: results.stops.length,
          routes: results.routes.length,
          trips: results.trips.length,
        },
        raw: JSON.stringify(results, null, 2),
      });
    }

    if (kind === 'trip') {
      const trip = await provider.getTrip(arg || '');
      return NextResponse.json({
        ok: Boolean(trip),
        latencyMs: Date.now() - started,
        summary: trip
          ? { tripNumber: trip.tripNumber, stops: trip.stops.length, live: Boolean(trip.vehicle) }
          : { found: false },
        raw: JSON.stringify(trip, null, 2),
      });
    }

    if (kind === 'board' || kind === 'busboard' || kind === 'terminals') {
      const started2 = Date.now();
      const payload = await probeBoard(
        kind === 'board' ? 'rail' : kind === 'busboard' ? 'bus' : 'terminals',
        arg,
      );
      const rows =
        kind === 'board'
          ? parseRailSignage(payload).length
          : kind === 'busboard'
            ? parseBusSignage(payload).length
            : undefined;
      return NextResponse.json({
        ok: true,
        latencyMs: Date.now() - started2,
        summary: { parsedRows: rows },
        raw: JSON.stringify(payload, null, 2).slice(0, 20_000),
      });
    }

    if (!(provider instanceof GoTrackerTemporaryProvider)) {
      return NextResponse.json(
        { ok: false, error: 'Raw probes are only available for the GO Tracker provider.' },
        { status: 400 },
      );
    }

    const result = await provider.probe(kind, arg);
    return NextResponse.json({
      ok: true,
      latencyMs: result.latencyMs,
      summary: { parsedRows: result.parsed },
      raw: typeof result.raw === 'string' ? result.raw.slice(0, 20_000) : String(result.raw),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Probe failed';
    return NextResponse.json(
      { ok: false, latencyMs: Date.now() - started, error: message.replace(/https?:\/\/\S+/g, 'upstream') },
      { status: 502 },
    );
  }
}
