import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = { title: 'Offline' };

export default function OfflinePage() {
  return (
    <div className="mx-auto flex w-full max-w-md flex-col items-center gap-3 px-6 pt-24 text-center pt-safe">
      <span className="text-3xl" aria-hidden>
        ◌
      </span>
      <h1 className="text-2xl font-semibold tracking-tight">You&rsquo;re offline.</h1>
      <p className="text-[15px] text-muted">
        Showing the latest available information. Nothing on screen is live until you reconnect.
      </p>
      <Link
        href="/"
        className="mt-3 inline-flex min-h-12 items-center rounded-2xl bg-[var(--accent)] px-5 font-semibold text-[var(--accent-fg)]"
      >
        Try again
      </Link>
    </div>
  );
}
