import { getProvider } from '@/lib/transit/provider';
import { envelope, fail, handleError, idSchema, okLive, rateLimit } from '@/lib/transit/api';

export const dynamic = 'force-dynamic';

export async function GET(request: Request, { params }: { params: Promise<{ tripId: string }> }) {
  const limited = rateLimit(request);
  if (limited) return limited;
  try {
    const { tripId } = await params;
    const id = idSchema.parse(tripId);
    const provider = await getProvider();
    const trip = await provider.getTrip(id);
    if (!trip) return fail('Trip not found', 404);
    return okLive(
      envelope(trip, {
        updatedAt: trip.vehicle?.updatedAt ?? null,
        freshness: trip.vehicle ? 'live' : 'scheduled',
        degraded: trip.vehicle
          ? undefined
          : 'No live vehicle is reporting for this trip; times are scheduled.',
      }),
    );
  } catch (err) {
    return handleError(err);
  }
}
