import { getProvider } from '@/lib/transit/provider';
import { GoTrackerTemporaryProvider } from '@/lib/transit/providers/GoTrackerTemporaryProvider';
import { envelope, handleError, okLive, rateLimit } from '@/lib/transit/api';
import type { LiveVehicle } from '@/lib/transit/types';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const limited = rateLimit(request, 240);
  if (limited) return limited;
  try {
    const provider = await getProvider();
    const url = new URL(request.url);
    const mode = url.searchParams.get('mode');
    const routeId = url.searchParams.get('routeId');

    let updatedAt: Date | null = null;
    let vehicles: LiveVehicle[];

    if (provider instanceof GoTrackerTemporaryProvider) {
      const result = await provider.getLiveVehiclesWithMeta();
      vehicles = result.value;
      updatedAt = result.updatedAt;
    } else {
      vehicles = await provider.getLiveVehicles();
    }

    if (mode && mode !== 'all') vehicles = vehicles.filter((v) => v.vehicleType === mode);
    if (routeId && routeId !== 'all') vehicles = vehicles.filter((v) => v.routeId === routeId);

    return okLive(envelope(vehicles, { updatedAt }));
  } catch (err) {
    return handleError(err);
  }
}
