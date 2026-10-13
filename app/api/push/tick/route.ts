import { NextResponse } from 'next/server';
import { recordTick, runPlatformTick } from '@/lib/transit/platformWatch';
import { requireTickSecret } from '@/lib/transit/tickAuth';
import { rateLimit } from '@/lib/transit/api';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

/**
 * Checks the boards and pushes any platform that has appeared.
 *
 * A serverless app cannot wake itself, so an outside scheduler calls this every
 * minute. The secret keeps it from being run by anyone who finds the URL.
 *
 * On failure it reports a 200 the first couple of times and a 500 after that.
 * That is deliberate: this depends on a cold start, two upstream feeds and a
 * metered key-value store, so the occasional run will fail and recover on its
 * own a minute later. Paging someone for that teaches them to ignore the pager,
 * which is how a real outage goes unnoticed. Three failures in a row is not a
 * blip, and that is what the scheduler is told about.
 */
const ALARM_AFTER = 3;

/**
 * Counts failures we could not write down, because the store itself was the
 * thing that failed. Process memory is not shared between serverless instances,
 * but a job running once a minute usually lands on a warm one, so this is
 * enough to tell a store blip from a store outage.
 */
let unrecordedFailures = 0;

export async function GET(request: Request) {
  // Generous, because a one-a-minute scheduler must never be throttled, but
  // finite, so the endpoint cannot be hammered by someone guessing the secret.
  const limited = rateLimit(request, 30);
  if (limited) return limited;

  const denied = requireTickSecret(request);
  if (denied) return denied;

  const started = Date.now();
  const headers = { 'Cache-Control': 'no-store' };

  try {
    const result = await runPlatformTick();
    const status = await recordTick({
      at: started,
      ok: true,
      ms: Date.now() - started,
      checked: result.checked,
      notified: result.notified,
      cutShort: result.cutShort,
    });
    unrecordedFailures = 0;
    return NextResponse.json(
      { ok: true, ...result, failingStreak: status?.failingStreak ?? 0 },
      { headers },
    );
  } catch (err) {
    const error = err instanceof Error ? err.message : 'Tick failed';
    // Recording must not itself throw, or a store outage would lose the very
    // evidence that a store outage happened.
    const status = await recordTick({
      at: started,
      ok: false,
      ms: Date.now() - started,
      checked: 0,
      notified: 0,
      error,
    }).catch(() => null);

    if (status) unrecordedFailures = 0;
    else unrecordedFailures += 1;

    const streak = Math.max(status?.failingStreak ?? 0, unrecordedFailures);
    const sustained = streak >= ALARM_AFTER;
    return NextResponse.json(
      {
        ok: false,
        error,
        failingStreak: streak,
        note: sustained
          ? 'Failing repeatedly — reported as an error so the scheduler raises it.'
          : 'Transient failure; the next run is expected to recover.',
      },
      { status: sustained ? 500 : 200, headers },
    );
  }
}
