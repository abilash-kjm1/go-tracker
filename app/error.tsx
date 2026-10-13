'use client';

import Link from 'next/link';
import { useEffect } from 'react';

/**
 * What a rider sees when a page throws.
 *
 * The app depends on third-party feeds that will go down, so this is a normal
 * state, not an exceptional one. It says what still works — the timetable is
 * baked into the deployment and does not need the live feeds — and offers the
 * two things worth trying, rather than showing a stack trace nobody can act on.
 */
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // The digest is the only handle on the server-side log for this failure.
    console.error('Page error', error.digest ?? '', error);
  }, [error]);

  return (
    <div className="mx-auto flex w-full max-w-md flex-col items-center gap-4 px-4 py-16 text-center pt-safe">
      <span
        aria-hidden
        className="grid size-14 place-items-center rounded-2xl text-[26px]"
        style={{ background: 'var(--tile-amber-bg)', color: 'var(--tile-amber-fg)' }}
      >
        ⚠
      </span>

      <div>
        <h1 className="text-[22px] font-semibold tracking-tight">This screen didn&rsquo;t load</h1>
        <p className="mt-1.5 text-ui leading-relaxed text-muted">
          Something failed on our side, most likely a live GO feed that stopped answering.
          Timetables are built into the app and still work.
        </p>
      </div>

      <div className="mt-1 flex w-full flex-col gap-2">
        <button
          type="button"
          onClick={reset}
          className="flex min-h-11 items-center justify-center rounded-2xl px-4 text-ui font-semibold"
          style={{ background: 'var(--accent)', color: 'var(--accent-fg)' }}
        >
          Try again
        </button>
        <Link
          href="/stations"
          className="flex min-h-11 items-center justify-center rounded-2xl border px-4 text-ui font-semibold text-muted hairline"
        >
          Browse the timetable
        </Link>
      </div>

      {error.digest ? (
        <p className="tabular text-mini text-faint">Reference {error.digest}</p>
      ) : null}
    </div>
  );
}
