import { z } from 'zod';
import { envelope, fail, handleError, ok, rateLimit } from '@/lib/transit/api';
import {
  cleanSubscription,
  deviceId,
  deviceStoreSurvives,
  dropDevice,
  getDevice,
  saveDevice,
} from '@/lib/transit/pushDevice';
import { pushConfigured } from '@/lib/transit/platformWatch';

export const dynamic = 'force-dynamic';

const meta = { freshness: 'scheduled', updatedAt: null } as const;

const registerSchema = z.object({
  subscription: z.unknown(),
  label: z.string().max(40).optional(),
});

/**
 * Register this phone, so the server can reach it at all.
 *
 * The app calls this every time it opens, not only the first time. A browser
 * may quietly renew a push address, and a record pointing at the old one is
 * indistinguishable from a working one until the morning it fails to tell
 * somebody their platform. Re-saving on every open is what keeps it true —
 * the single habit that makes Settle's notifications dependable.
 */
export async function POST(request: Request) {
  const limited = rateLimit(request, 60);
  if (limited) return limited;
  try {
    if (!pushConfigured()) return fail('Push notifications are not configured on this server', 503);

    const body = registerSchema.parse(await request.json());

    // Validated before it is believed: the endpoint must belong to a real push
    // service, and the keys must be the shape a browser produces.
    const subscription = cleanSubscription(body.subscription);
    if (!subscription) return fail('That is not a usable push subscription', 400);

    const id = await saveDevice(subscription, body.label);

    return ok(
      envelope(
        // Said plainly: without a shared store the record dies with this
        // request, and a rider deserves to know before trusting it.
        { id, linked: true, durable: deviceStoreSurvives() },
        meta,
      ),
    );
  } catch (err) {
    return handleError(err);
  }
}

/**
 * Is this phone actually registered?
 *
 * Settle's best idea, and the answer to "why did nothing arrive". A test
 * notification only proves the phone can display one; it says nothing about
 * whether the server can reach it. This does, and the app offers to repair it
 * when the answer is no.
 */
export async function GET(request: Request) {
  const limited = rateLimit(request, 60);
  if (limited) return limited;
  try {
    const endpoint = new URL(request.url).searchParams.get('endpoint') ?? '';
    const subscription = cleanSubscription({
      endpoint,
      // Only the endpoint identifies the record; the keys are not needed to
      // look one up, so a placeholder of the right shape stands in for them.
      keys: { p256dh: 'x'.repeat(87), auth: 'y'.repeat(22) },
    });
    if (!subscription) return fail('That is not a usable push endpoint', 400);

    const record = await getDevice(deviceId(subscription.endpoint));
    return ok(
      envelope(
        {
          linked: Boolean(record),
          durable: deviceStoreSurvives(),
          configured: pushConfigured(),
          seenAt: record ? new Date(record.seenAt).toISOString() : null,
        },
        meta,
      ),
    );
  } catch (err) {
    return handleError(err);
  }
}

/** Forget this phone. */
export async function DELETE(request: Request) {
  const limited = rateLimit(request, 60);
  if (limited) return limited;
  try {
    const body = z.object({ endpoint: z.string().max(1000) }).parse(await request.json());
    const subscription = cleanSubscription({
      endpoint: body.endpoint,
      keys: { p256dh: 'x'.repeat(87), auth: 'y'.repeat(22) },
    });
    if (!subscription) return fail('That is not a usable push endpoint', 400);

    await dropDevice(deviceId(subscription.endpoint));
    return ok(envelope({ linked: false }, meta));
  } catch (err) {
    return handleError(err);
  }
}
