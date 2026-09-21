import { getProvider } from '@/lib/transit/provider';
import { envelope, handleError, ok, okStatic, rateLimit } from '@/lib/transit/api';
import { distanceKm } from '@/lib/transit/geo';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const limited = rateLimit(request);
  if (limited) return limited;
  try {
    const provider = await getProvider();
    const url = new URL(request.url);
    const mode = url.searchParams.get('mode');
    const near = url.searchParams.get('near');
    const limit = Math.min(Number(url.searchParams.get('limit')) || 500, 1000);

    let stations = await provider.getStations();
    if (mode && mode !== 'all') {
      stations = stations.filter((s) => s.modes.includes(mode as 'train' | 'bus'));
    }

    if (near) {
      const [latRaw, lonRaw] = near.split(',');
      const lat = Number(latRaw);
      const lon = Number(lonRaw);
      if (Number.isFinite(lat) && Number.isFinite(lon)) {
        const withDistance = stations
          .map((s) => ({ ...s, distanceKm: distanceKm(lat, lon, s.lat, s.lon) }))
          .sort((a, b) => a.distanceKm - b.distanceKm)
          .slice(0, limit);
        // Personal to one location: never cached at the edge.
        return ok(envelope(withDistance, { freshness: 'scheduled', updatedAt: null }));
      }
    }

    return okStatic(envelope(stations.slice(0, limit), { freshness: 'scheduled', updatedAt: null }));
  } catch (err) {
    return handleError(err);
  }
}
