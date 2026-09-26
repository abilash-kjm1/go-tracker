import { envelope, handleError, okStatic, rateLimit } from '@/lib/transit/api';
import { getMeta } from '@/lib/transit/gtfs';

export const dynamic = 'force-dynamic';

/** Which service days the bundled timetable covers, so a picker can offer them. */
export async function GET(request: Request) {
  const limited = rateLimit(request);
  if (limited) return limited;
  try {
    const meta = await getMeta();
    return okStatic(
      envelope(
        { dates: meta.dates, generatedAt: meta.generatedAt, feedVersion: meta.feedVersion },
        { freshness: 'scheduled', updatedAt: null },
      ),
    );
  } catch (err) {
    return handleError(err);
  }
}
