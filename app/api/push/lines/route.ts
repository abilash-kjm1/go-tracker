import { z } from 'zod';
import { envelope, fail, handleError, ok, rateLimit } from '@/lib/transit/api';
import { pushConfigured } from '@/lib/transit/platformWatch';
import { cleanSubscription, deviceStoreSurvives, saveDevice } from '@/lib/transit/pushDevice';
import { MAX_LINES, addLineWatch, dropLineWatch, lineWatchesFor } from '@/lib/transit/lineWatch';

export const dynamic = 'force-dynamic';

const meta = { freshness: 'scheduled', updatedAt: null } as const;

/** Which lines this phone follows. */
export async function GET(request: Request) {
  const limited = rateLimit(request, 60);
  if (limited) return limited;
  try {
    const endpoint = new URL(request.url).searchParams.get('endpoint') ?? '';
    const subscription = cleanSubscription({
      endpoint,
      keys: { p256dh: 'x'.repeat(87), auth: 'y'.repeat(22) },
    });
    if (!subscription) return fail('That is not a usable push endpoint', 400);

    const watches = await lineWatchesFor(subscription.endpoint);
    return ok(
      envelope(
        {
          lines: watches.map((w) => ({ routeId: w.routeId, routeName: w.routeName })),
          durable: deviceStoreSurvives(),
        },
        meta,
      ),
    );
  } catch (err) {
    return handleError(err);
  }
}

const followSchema = z.object({
  subscription: z.unknown(),
  routeId: z.string().min(1).max(60),
  routeName: z.string().min(1).max(80),
});

/** Follow a line: be told when it is properly in trouble, not when it is a minute down. */
export async function POST(request: Request) {
  const limited = rateLimit(request, 60);
  if (limited) return limited;
  try {
    if (!pushConfigured()) return fail('Push notifications are not configured on this server', 503);

    const body = followSchema.parse(await request.json());
    const subscription = cleanSubscription(body.subscription);
    if (!subscription) return fail('That is not a usable push subscription', 400);

    const already = await lineWatchesFor(subscription.endpoint);
    if (
      already.length >= MAX_LINES &&
      !already.some((w) => w.routeId === body.routeId)
    ) {
      return fail(`You can follow up to ${MAX_LINES} lines. Unfollow one first.`, 409);
    }

    await addLineWatch(subscription, body.routeId, body.routeName);
    // Following a line is also this phone asking to stay reachable.
    await saveDevice(subscription).catch(() => undefined);

    return ok(envelope({ following: true, durable: deviceStoreSurvives() }, meta));
  } catch (err) {
    return handleError(err);
  }
}

export async function DELETE(request: Request) {
  const limited = rateLimit(request, 60);
  if (limited) return limited;
  try {
    const body = z
      .object({ endpoint: z.string().max(1000), routeId: z.string().min(1).max(60) })
      .parse(await request.json());
    const subscription = cleanSubscription({
      endpoint: body.endpoint,
      keys: { p256dh: 'x'.repeat(87), auth: 'y'.repeat(22) },
    });
    if (!subscription) return fail('That is not a usable push endpoint', 400);

    await dropLineWatch(subscription.endpoint, body.routeId);
    return ok(envelope({ following: false }, meta));
  } catch (err) {
    return handleError(err);
  }
}
