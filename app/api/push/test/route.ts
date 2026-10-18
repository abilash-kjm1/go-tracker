import { z } from 'zod';
import { envelope, fail, handleError, ok, rateLimit } from '@/lib/transit/api';
import { pushConfigured } from '@/lib/transit/platformWatch';
import { cleanSubscription, deviceStoreSurvives, saveDevice } from '@/lib/transit/pushDevice';
import { queueTest } from '@/lib/transit/pushTest';

export const dynamic = 'force-dynamic';

/**
 * Ask the server to push a test to this phone.
 *
 * It is not sent from here. The scheduler sends it on its next pass, within a
 * minute, by which time the rider has put the phone away — which is the only
 * way to prove the thing they actually care about: that a notification
 * arrives with the app closed.
 */
export async function POST(request: Request) {
  const limited = rateLimit(request, 10);
  if (limited) return limited;
  try {
    if (!pushConfigured()) return fail('Push notifications are not configured on this server', 503);

    const body = z.object({ subscription: z.unknown() }).parse(await request.json());
    const subscription = cleanSubscription(body.subscription);
    if (!subscription) return fail('That is not a usable push subscription', 400);

    // Asking for a test is also this phone saying it wants to be reachable,
    // so a device that somehow never registered is registered here.
    await saveDevice(subscription).catch(() => undefined);
    await queueTest(subscription);

    return ok(
      envelope(
        { queued: true, withinSeconds: 60, durable: deviceStoreSurvives() },
        { freshness: 'scheduled', updatedAt: null },
      ),
    );
  } catch (err) {
    return handleError(err);
  }
}
