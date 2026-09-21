import { envelope, fail, handleError, idSchema, okBoard, rateLimit } from '@/lib/transit/api';
import { cached } from '@/lib/transit/cache';
import { planJourneys } from '@/lib/transit/journeys';
import { getStop } from '@/lib/transit/gtfs';

export const dynamic = 'force-dynamic';
// The planner scans two days of timetable for changes; give it headroom on a
// cold serverless instance rather than the platform's default.
export const maxDuration = 30;

export async function GET(request: Request) {
  const limited = rateLimit(request);
  if (limited) return limited;
  try {
    const url = new URL(request.url);
    const from = idSchema.parse(url.searchParams.get('from') ?? '');
    const to = idSchema.parse(url.searchParams.get('to') ?? '');
    if (from === to) return fail('Pick two different stops', 400);

    const limit = Math.min(Number(url.searchParams.get('limit')) || 8, 20);

    const [fromStop, toStop] = await Promise.all([getStop(from), getStop(to)]);
    if (!fromStop || !toStop) return fail('Stop not found', 404);

    // Identical requests share one computation for a few seconds, including ones
    // arriving while it is still running, so a rush on a popular pair of stops
    // costs one timetable scan rather than one per person.
    const { value: journeys } = await cached(`journeys:${from}:${to}:${limit}`, 15, () =>
      planJourneys({ fromStopId: from, toStopId: to, limit }),
    );
    const realtime = journeys.filter((j) => j.realtime);
    const anyDirect = journeys.some((j) => j.transfers === 0);

    return okBoard(
      envelope(journeys, {
        updatedAt: realtime.length ? new Date() : null,
        freshness: realtime.length ? 'live' : 'scheduled',
        degraded: journeys.length
          ? anyDirect
            ? undefined
            : 'No direct service — these journeys need a change.'
          : 'Nothing connects these stops in the next few hours.',
      }),
    );
  } catch (err) {
    return handleError(err);
  }
}
