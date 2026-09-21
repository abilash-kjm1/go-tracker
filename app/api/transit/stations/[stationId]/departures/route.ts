import { getProvider } from '@/lib/transit/provider';
import { envelope, fail, handleError, idSchema, okBoard, rateLimit } from '@/lib/transit/api';

export const dynamic = 'force-dynamic';

export async function GET(request: Request, { params }: { params: Promise<{ stationId: string }> }) {
  const limited = rateLimit(request);
  if (limited) return limited;
  try {
    const { stationId } = await params;
    const id = idSchema.parse(stationId);
    const url = new URL(request.url);
    const mode = url.searchParams.get('mode');
    const limit = Math.min(Number(url.searchParams.get('limit')) || 40, 100);

    const provider = await getProvider();
    const station = await provider.getStation(id);
    if (!station) return fail('Station not found', 404);

    let rows = await provider.getDepartures(id, { limit });
    if (mode && mode !== 'all') rows = rows.filter((d) => d.vehicleType === mode);

    const realtime = rows.filter((r) => r.realtime);
    const newest = realtime.length
      ? realtime.map((r) => new Date(r.updatedAt).getTime()).reduce((a, b) => Math.max(a, b), 0)
      : null;

    return okBoard(
      envelope(rows, {
        updatedAt: newest ? new Date(newest) : null,
        freshness: realtime.length ? 'live' : 'scheduled',
        degraded: realtime.length
          ? undefined
          : 'No real-time data for this stop right now; showing the published schedule.',
      }),
    );
  } catch (err) {
    return handleError(err);
  }
}
