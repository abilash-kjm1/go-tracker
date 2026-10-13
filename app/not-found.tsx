import Link from 'next/link';

/**
 * A stop or line that does not exist — usually an old link, or a station GO has
 * renamed. Browsing is more useful here than an apology, so the page is mostly
 * a way back into the app.
 */
export default function NotFound() {
  return (
    <div className="mx-auto flex w-full max-w-md flex-col items-center gap-4 px-4 py-16 text-center pt-safe">
      <span
        aria-hidden
        className="grid size-14 place-items-center rounded-2xl bg-[var(--bg-sunken)] text-[26px] text-[var(--fg-faint)]"
      >
        🚉
      </span>

      <div>
        <h1 className="text-[22px] font-semibold tracking-tight">Nothing here</h1>
        <p className="mt-1.5 text-ui leading-relaxed text-muted">
          This page doesn&rsquo;t exist. A stop or line may have been renamed since the link was
          made.
        </p>
      </div>

      <div className="mt-1 flex w-full flex-col gap-2">
        <Link
          href="/"
          className="flex min-h-11 items-center justify-center rounded-2xl px-4 text-ui font-semibold"
          style={{ background: 'var(--accent)', color: 'var(--accent-fg)' }}
        >
          Plan a trip
        </Link>
        <Link
          href="/stations"
          className="flex min-h-11 items-center justify-center rounded-2xl border px-4 text-ui font-semibold text-muted hairline"
        >
          Find a station
        </Link>
      </div>
    </div>
  );
}
