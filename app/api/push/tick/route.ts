import { NextResponse } from 'next/server';
import { runPlatformTick } from '@/lib/transit/platformWatch';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

/**
 * Checks the boards and pushes any platform that has appeared.
 *
 * A serverless app cannot wake itself, so an outside scheduler calls this every
 * minute. The secret keeps it from being run by anyone who finds the URL.
 */
export async function GET(request: Request) {
  const expected = process.env.PUSH_TICK_SECRET;
  if (!expected) {
    return NextResponse.json({ error: 'Tick is not configured' }, { status: 503 });
  }

  const provided =
    new URL(request.url).searchParams.get('key') ??
    request.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
  if (provided !== expected) {
    return NextResponse.json({ error: 'Not authorised' }, { status: 401 });
  }

  try {
    const result = await runPlatformTick();
    return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Tick failed' },
      { status: 500 },
    );
  }
}
