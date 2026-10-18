import { z } from 'zod';
import { fail, handleError, ok, envelope, rateLimit } from '@/lib/transit/api';
import {
  addWatch,
  dropWatch,
  pushConfigured,
  watchesSurvive,
} from '@/lib/transit/platformWatch';
import { cleanSubscription, deviceStoreSurvives, saveDevice } from '@/lib/transit/pushDevice';

export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  kind: z.enum(['platform', 'arrival']).default('platform'),
  // Checked properly below. The endpoint must belong to a real push service:
  // any https URL used to be accepted, which let a forged request make this
  // server sign and post to an address of the sender's choosing.
  subscription: z.unknown(),
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

    const body = bodySchema.parse(await request.json());
    const subscription = cleanSubscription(body.subscription);
    if (!subscription) return fail('That is not a usable push subscription', 400);

    await addWatch({ ...body, subscription, createdAt: Date.now() });

    // Arming an alert is also this phone saying it wants to hear from the app,
    // so the device is registered at the same time. It then stays reachable
    // after this one watch has come and gone.
    await saveDevice(subscription).catch(() => undefined);

    return ok(
      envelope(
        // Said plainly: on a server without a shared store the watch will not
        // outlive this request, and the rider deserves to know that.
        { watching: true, durable: watchesSurvive() && deviceStoreSurvives() },
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
