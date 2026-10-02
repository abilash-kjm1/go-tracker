'use client';

import { useTicker } from '@/lib/client/useTransit';
import { useWalkTime, WALKABLE_KM } from '@/lib/client/walkTime';
import { formatDistance } from '@/lib/transit/geo';
import type { Departure } from '@/lib/transit/types';

/**
 * When to set off.
 *
 * The board says when the train goes. This says when the rider has to leave to
 * be on it — which is the number they are actually doing arithmetic on in their
 * head, and the one they get wrong.
 *
 * It only ever reports the first departure the walk can still reach. Promising
 * a service that left while the rider was putting their shoes on would be worse
 * than saying nothing.
 */
export function LeaveBy({
  origin,
  departures,
}: {
  origin?: { lat: number; lon: number } | null;
  departures: Departure[];
}) {
  const walk = useWalkTime(origin);
  const now = useTicker(30_000);

  if (!origin) return null;

  // Nagging someone who said no is how an app loses its location permission for
  // good, so a refusal is final and silent.
  if (walk.status === 'denied' || walk.status === 'unsupported') return null;

  if (walk.status === 'idle') {
    return (
      <button
        type="button"
        onClick={walk.request}
        className="flex min-h-11 w-full items-center justify-center gap-2 rounded-2xl border text-[13px] font-semibold text-muted transition-colors hairline hover:bg-[var(--bg-sunken)]"
      >
        <WalkGlyph className="size-4" />
        Work out when I need to leave
      </button>
    );
  }

  if (walk.status === 'prompting' || walk.km == null) {
    return (
      <p className="flex min-h-11 items-center justify-center gap-2 rounded-2xl border text-[13px] text-faint hairline">
        <WalkGlyph className="size-4" />
        Finding you…
      </p>
    );
  }

  if (walk.arrived) {
    // A board keeps a service listed for a few minutes after it has gone, so
    // the first row is not always the next one to leave.
    const next = departures.find((d) => minutesTo(d, now) >= 0);
    const wait = next ? minutesTo(next, now) : null;
    return (
      <Strip tone="here">
        <WalkGlyph className="size-4 shrink-0" />
        <span>
          You&rsquo;re at the stop.
          {wait != null ? (
            <span className="text-muted">
              {' '}
              {wait === 0 ? 'Next one is leaving now.' : `Next one in ${wait} min.`}
            </span>
          ) : null}
        </span>
      </Strip>
    );
  }

  if (walk.minutes == null) {
    return (
      <Strip tone="far">
        <WalkGlyph className="size-4 shrink-0" />
        <span>
          You&rsquo;re {formatDistance(walk.km)} away &mdash; too far to walk, so no leave-by time.
        </span>
      </Strip>
    );
  }

  // The first departure still standing when the walk is over.
  const catchable = departures.find((d) => minutesTo(d, now) >= walk.minutes!);
  const walkLabel = `${walk.minutes} min walk · ${formatDistance(walk.km)}`;

  if (!catchable) {
    return (
      <Strip tone="miss">
        <WalkGlyph className="size-4 shrink-0" />
        <span>
          <b>{walkLabel}.</b>{' '}
          <span className="text-muted">
            Nothing on this board is still reachable on foot.
          </span>
        </span>
      </Strip>
    );
  }

  const departsIn = minutesTo(catchable, now);
  const leaveIn = departsIn - walk.minutes;
  const leaveAt = new Date(
    Date.parse(catchable.estimatedTime ?? catchable.scheduledTime) - walk.minutes * 60_000,
  );

  return (
    <Strip tone={leaveIn <= 2 ? 'now' : 'ok'}>
      <WalkGlyph className="size-4 shrink-0" />
      <span className="min-w-0">
        <b>{leaveIn <= 0 ? 'Leave now' : leaveIn <= 2 ? `Leave in ${leaveIn} min` : `Leave by ${clock(leaveAt)}`}</b>
        <span className="text-muted">
          {' '}
          for the {clock(new Date(Date.parse(catchable.estimatedTime ?? catchable.scheduledTime)))}
          {catchable.destination ? ` to ${tidy(catchable.destination)}` : ''}
        </span>
        <span className="block text-[11.5px] text-faint">{walkLabel} — estimated</span>
      </span>
    </Strip>
  );
}

function Strip({
  tone,
  children,
}: {
  tone: 'ok' | 'now' | 'miss' | 'here' | 'far';
  children: React.ReactNode;
}) {
  const style =
    tone === 'now'
      ? { background: 'var(--tile-amber-bg)', color: 'var(--tile-amber-fg)' }
      : tone === 'miss'
        ? { background: 'var(--bg-sunken)', color: 'var(--fg-muted)' }
        : tone === 'ok'
          ? {
              background: 'color-mix(in srgb, var(--accent) 10%, var(--bg-elevated))',
              color: 'var(--fg)',
            }
          : { background: 'var(--bg-elevated)', color: 'var(--fg)' };

  return (
    <p
      className="flex items-start gap-2.5 rounded-2xl border px-3.5 py-2.5 text-[13px] leading-snug hairline"
      style={style}
    >
      {children}
    </p>
  );
}

/** Minutes until a departure leaves, from the best time we have for it. */
function minutesTo(departure: Departure, now: number): number {
  const at = Date.parse(departure.estimatedTime ?? departure.scheduledTime);
  if (!Number.isFinite(at)) return Number.POSITIVE_INFINITY;
  return Math.round((at - now) / 60_000);
}

function clock(at: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Toronto',
    hour: 'numeric',
    minute: '2-digit',
  }).format(at);
}

const tidy = (name: string) => name.replace(/\s+GO(\s+Bus)?$/i, '');

function WalkGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" aria-hidden>
      <circle cx="13" cy="4" r="2" fill="currentColor" />
      <path
        d="M13 8.5 10 11l-1.5 4M13 8.5l2.5 2 2 1M13 8.5l-.5 5 2.5 3.5.5 4M12.5 13.5 9 17l-1.5 4"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export { WALKABLE_KM };
