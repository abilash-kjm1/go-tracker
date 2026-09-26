import { envelope, fail, handleError, idSchema, okBoard, rateLimit } from '@/lib/transit/api';
import { cached } from '@/lib/transit/cache';
import { planJourneys } from '@/lib/transit/journeys';
import { getStop } from '@/lib/transit/gtfs';
import { zonedToInstant } from '@/lib/transit/time';

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

    // `at` is a Toronto wall-clock time ("2026-09-27T09:30"), not an instant, so
    // the journey a rider asks for is the one they mean whatever their device's
    // clock is set to. Anything already past is treated as "now".
    const at = url.searchParams.get('at');
    const parts = at ? /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(at) : null;
    const requested = parts
      ? zonedToInstant(
          `${parts[1]}${parts[2]}${parts[3]}`,
          Number(parts[4]) * 3600 + Number(parts[5]) * 60,
        )
      : null;
    const planned = requested && requested.getTime() > Date.now() ? requested : null;

    const [fromStop, toStop] = await Promise.all([getStop(from), getStop(to)]);
    if (!fromStop || !toStop) return fail('Stop not found', 404);

    // Identical requests share one computation for a few seconds, including ones
    // arriving while it is still running, so a rush on a popular pair of stops
    // costs one timetable scan rather than one per person.
    // A future timetable does not change minute to minute, so it is cached for
    // far longer than the live "leaving now" board.
    const { value: journeys } = await cached(
      `journeys:${from}:${to}:${limit}:${planned ? at : 'now'}`,
      planned ? 600 : 15,
      () => planJourneys({ fromStopId: from, toStopId: to, limit, now: planned ?? undefined }),
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
          : planned
            ? 'Nothing runs between these stops around that time.'
            : 'Nothing connects these stops in the next few hours.',
      }),
    );
  } catch (err) {
    return handleError(err);
  }
}
