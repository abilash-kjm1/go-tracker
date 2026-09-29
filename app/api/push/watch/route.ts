import { z } from 'zod';
import { fail, handleError, ok, envelope, rateLimit } from '@/lib/transit/api';
import {
  addWatch,
  dropWatch,
  pushConfigured,
  watchesSurvive,
} from '@/lib/transit/platformWatch';

export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  kind: z.enum(['platform', 'arrival']).default('platform'),
  subscription: z.object({
    endpoint: z.string().url(),
    keys: z.object({ p256dh: z.string(), auth: z.string() }),
  }),
  stopId: z.string().min(1).max(40),
  stopName: z.string().min(1).max(120),
  tripId: z.string().max(80).optional(),
  tripNumber: z.string().min(1).max(20),
  departsAt: z.string().min(1).max(40),
});

/** Ask to be told when this trip's platform is posted at this stop. */
export async function POST(request: Request) {
  const limited = rateLimit(request, 30);
  if (limited) return limited;
  try {
    if (!pushConfigured()) return fail('Push notifications are not configured on this server', 503);

    const watch = bodySchema.parse(await request.json());
    await addWatch({ ...watch, createdAt: Date.now() });

    return ok(
      envelope(
        // Said plainly: on a server without a shared store the watch will not
        // outlive this request, and the rider deserves to know that.
        { watching: true, durable: watchesSurvive() },
        { freshness: 'scheduled', updatedAt: null },
      ),
    );
  } catch (err) {
    return handleError(err);
  }
}

/** Stop watching. */
export async function DELETE(request: Request) {
  const limited = rateLimit(request, 30);
  if (limited) return limited;
  try {
    const body = z
      .object({
        endpoint: z.string().url(),
        tripNumber: z.string(),
        stopId: z.string(),
        kind: z.enum(['platform', 'arrival']).default('platform'),
      })
      .parse(await request.json());
    await dropWatch(body.endpoint, body.tripNumber, body.stopId, body.kind);
    return ok(envelope({ watching: false }, { freshness: 'scheduled', updatedAt: null }));
  } catch (err) {
    return handleError(err);
  }
}
