import { getProvider } from '@/lib/transit/provider';
import { envelope, fail, handleError, idSchema, okStatic, rateLimit } from '@/lib/transit/api';
import { getRelatedStops } from '@/lib/transit/gtfs';

export const dynamic = 'force-dynamic';

export async function GET(request: Request, { params }: { params: Promise<{ stationId: string }> }) {
  const limited = rateLimit(request);
  if (limited) return limited;
  try {
    const { stationId } = await params;
    const id = idSchema.parse(stationId);
    const provider = await getProvider();
    const station = await provider.getStation(id);
    if (!station) return fail('Station not found', 404);

    // Report the modes of the whole site, so a train station that also has a
    // bus loop advertises both.
    const related = await getRelatedStops(id).catch(() => []);
    const modes = [...new Set([...station.modes, ...related.flatMap((s) => s.modes)])].sort();
    const routeIds = [...new Set([...station.routeIds, ...related.flatMap((s) => s.routeIds)])];

    return okStatic(
      envelope(
        { ...station, modes, routeIds, relatedStopIds: related.map((s) => s.id) },
        { freshness: 'scheduled', updatedAt: null },
      ),
    );
  } catch (err) {
    return handleError(err);
  }
}
