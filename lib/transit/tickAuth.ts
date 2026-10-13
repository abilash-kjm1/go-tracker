import 'server-only';

import { timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';

/**
 * The gate on the scheduler and diagnostic endpoints.
 *
 * Compared in constant time. A plain `!==` on a secret leaks its length and,
 * given enough attempts, its prefix: the comparison stops at the first wrong
 * byte, so a guess sharing more of the prefix takes measurably longer. These
 * endpoints are public and unauthenticated by design, so the secret is the only
 * thing protecting them.
 *
 * An Authorization header is preferred over the query string, because a URL
 * ends up in proxy logs, browser history and Referer headers. The query form
 * is still accepted, because schedulers that cannot send headers are common.
 */
function constantTimeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  // timingSafeEqual throws on a length mismatch, which would itself be a
  // timing signal, so pad to a fixed width first.
  const width = Math.max(left.length, right.length, 32);
  const padLeft = Buffer.alloc(width);
  const padRight = Buffer.alloc(width);
  left.copy(padLeft);
  right.copy(padRight);
  return timingSafeEqual(padLeft, padRight) && left.length === right.length;
}

/** Null when the caller is allowed through; otherwise the response to return. */
export function requireTickSecret(request: Request): NextResponse | null {
  const expected = process.env.PUSH_TICK_SECRET;
  if (!expected) {
    return NextResponse.json({ error: 'Not configured' }, { status: 503 });
  }

  const provided =
    request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ??
    new URL(request.url).searchParams.get('key') ??
    '';

  if (!constantTimeEqual(provided, expected)) {
    return NextResponse.json({ error: 'Not authorised' }, { status: 401 });
  }
  return null;
}
