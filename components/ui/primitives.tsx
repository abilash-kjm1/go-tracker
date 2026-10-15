'use client';

import clsx from 'clsx';
import type { ReactNode } from 'react';
import type { VehicleType } from '@/lib/transit/types';

/** Mode glyphs. A bus never gets a train icon. */
export function ModeIcon({ type, className }: { type: VehicleType; className?: string }) {
  const label = type === 'train' ? 'GO Train' : type === 'bus' ? 'GO Bus' : 'GO service';
  return (
    <span className={clsx('inline-flex shrink-0 items-center', className)} role="img" aria-label={label}>
      {/* Bus and train separate on silhouette, not on detail: a bus carries two
          wheels below its body, a train has none and rides a rail. Anything
          finer than that is lost by the time these are drawn at 14px on a
          departure card, which is where the old pair became the same blob. */}
      {type === 'train' ? (
        <svg viewBox="0 0 20 20" className="size-full" fill="none" aria-hidden>
          <path
            d="M10 2.2c3 0 4.9 1.6 4.9 4.1v5.6c0 1-.8 1.8-1.8 1.8H6.9c-1 0-1.8-.8-1.8-1.8V6.3c0-2.5 1.9-4.1 4.9-4.1Z"
            fill="currentColor"
          />
          <rect x="7" y="5" width="6" height="3.1" rx="0.9" fill="#fff" fillOpacity="0.9" />
          <circle cx="7.5" cy="11" r="0.95" fill="#fff" fillOpacity="0.9" />
          <circle cx="12.5" cy="11" r="0.95" fill="#fff" fillOpacity="0.9" />
          <path d="M4.3 16.6h11.4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
      ) : type === 'bus' ? (
        <svg viewBox="0 0 20 20" className="size-full" fill="none" aria-hidden>
          <rect x="2.6" y="4.4" width="14.8" height="8.6" rx="2.1" fill="currentColor" />
          <rect x="4.2" y="6" width="11.6" height="3.2" rx="0.9" fill="#fff" fillOpacity="0.9" />
          <circle cx="6.4" cy="15.1" r="2" fill="currentColor" />
          <circle cx="13.6" cy="15.1" r="2" fill="currentColor" />
        </svg>
      ) : (
        <svg viewBox="0 0 20 20" className="size-full" fill="none" aria-hidden>
          <circle cx="10" cy="10" r="6.5" stroke="currentColor" strokeWidth="1.4" />
          <path d="M10 6.5v4l2.5 1.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
        </svg>
      )}
    </span>
  );
}

export function ModeLabel({ type }: { type: VehicleType }) {
  return <>{type === 'train' ? 'GO Train' : type === 'bus' ? 'GO Bus' : 'GO service'}</>;
}

export function Pill({
  children,
  tone = 'neutral',
  className,
}: {
  children: ReactNode;
  tone?: 'neutral' | 'ok' | 'warn' | 'bad' | 'accent';
  className?: string;
}) {
  return (
    <span
      /*
        Each tone is a ground and an ink from the status palette, which is
        tuned per theme. "ok" used to be a wash of the brand sage over sage
        ink, and in the light theme that landed on olive-on-cream: a pill
        reading "ON TIME" in a colour that said nothing was fine, or anything
        else. These are the greens, ambers and reds a rider already knows.
      */
      className={clsx(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-mini font-semibold tracking-wide uppercase',
        tone === 'neutral' && 'bg-[var(--bg-sunken)] text-[var(--fg-muted)]',
        tone === 'ok' && 'bg-[var(--status-live-bg)] text-[var(--status-live-fg)]',
        tone === 'warn' && 'bg-[var(--status-delayed-bg)] text-[var(--status-delayed-fg)]',
        tone === 'bad' && 'bg-[var(--status-disruption-bg)] text-[var(--status-disruption-fg)]',
        tone === 'accent' && 'bg-[var(--accent)] text-[var(--accent-fg)]',
        className,
      )}
    >
      {children}
    </span>
  );
}


/**
 * A readable label on a line's own colour.
 *
 * Route colours come from the GTFS feed and belong to the railway. The text on
 * top is ours, so that gives way first: white on Lakeshore West's deep
 * burgundy, near-black on a pale bus route.
 *
 * A handful of lines defeat both. Lakeshore East is rgb(255,13,0), where white
 * reaches 3.96:1 and black 3.79:1 — there is no ink that passes on it, so the
 * fill itself has to move. It is darkened in its own hue by the smallest step
 * that lets white clear 4.5:1, which for LE is a few percent: still plainly
 * the Lakeshore East red, and now with a line code that can be read. Nothing
 * is recoloured beyond that, and most lines are not touched at all.
 */
function luminanceOf(hex: string): number {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const ch = (i: number) => {
    const v = parseInt(full.slice(i, i + 2), 16) / 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * ch(0) + 0.7152 * ch(2) + 0.0722 * ch(4);
}

const contrast = (a: number, b: number) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);

const INK = '#13170f';
const INK_LUM = luminanceOf(INK);

export function readableOn(background: string): string {
  const hex = background.trim();
  if (!/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(hex)) return '#ffffff';
  const l = luminanceOf(hex);
  return contrast(l, INK_LUM) >= contrast(l, 1) ? INK : '#ffffff';
}

/** The fill and the ink together, with the fill adjusted only if it must be. */
export function badgeColors(background: string): { background: string; color: string } {
  const hex = background.trim();
  if (!/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(hex)) {
    return { background, color: '#ffffff' };
  }

  const ink = readableOn(hex);
  const inkLum = ink === INK ? INK_LUM : 1;
  if (contrast(luminanceOf(hex), inkLum) >= 4.5) return { background: hex, color: ink };

  // Step the fill toward black in its own hue until the chosen ink clears AA.
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const rgb = [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16));
  for (let f = 0.97; f >= 0.3; f -= 0.03) {
    const next =
      '#' + rgb.map((v) => Math.round(v * f).toString(16).padStart(2, '0')).join('');
    if (contrast(luminanceOf(next), 1) >= 4.5) return { background: next, color: '#ffffff' };
  }
  return { background: hex, color: ink };
}

export function RouteBadge({
  code,
  color,
  type,
  className,
}: {
  code?: string;
  color?: string | null;
  type: VehicleType;
  className?: string;
}) {
  if (!code) return null;
  return (
    <span
      className={clsx(
        'inline-flex h-6 min-w-6 items-center justify-center rounded-md px-1.5 font-bold whitespace-nowrap',
        // A variant like "12B" needs to fit without shrinking the badge.
        code.length > 3 ? 'text-micro' : 'text-xs',
        className,
      )}
      // Fill and ink decided together: GO's line colour is kept as it is
      // wherever an ink can be read on it, which is every current line.
      style={badgeColors(color ?? '#565e51')}
      title={type === 'bus' ? `GO Bus route ${code}` : `GO Train line ${code}`}
    >
      {code}
    </span>
  );
}

/**
 * Express services skip stops, which changes the journey — so it gets its own
 * colour rather than being buried in the route name.
 */
export function ExpressBadge({ className }: { className?: string }) {
  return (
    <span
      className={clsx(
        'inline-flex shrink-0 items-center gap-1 rounded-md border px-1.5 py-0.5 text-micro font-bold tracking-wide uppercase',
        className,
      )}
      style={{
        background: 'var(--express-surface)',
        borderColor: 'var(--express-border)',
        color: 'var(--express)',
      }}
      title="Express — skips some stops"
    >
      <svg viewBox="0 0 12 12" className="size-2.5" fill="currentColor" aria-hidden>
        <path d="M1 6 5 2v2.6L9 1v10L5 7.4V10z" />
      </svg>
      Express
    </span>
  );
}

/** A span so it is valid inside <p> as well as block containers. */
export function Skeleton({ className }: { className?: string }) {
  return <span className={clsx('skeleton block rounded-lg', className)} aria-hidden />;
}

export function Segmented<T extends string>({
  value,
  onChange,
  options,
  ariaLabel,
  className,
  optionClassName,
}: {
  value: T;
  onChange: (value: T) => void;
  options: Array<{ value: T; label: ReactNode }>;
  ariaLabel: string;
  className?: string;
  /** Applied to every option — e.g. `flex-1` to share the width equally. */
  optionClassName?: string;
}) {
  return (
    // A group of toggles, not tabs: there is no tabpanel to own, and
    // aria-pressed describes the state accurately for screen readers.
    <div
      role="group"
      aria-label={ariaLabel}
      className={clsx(
        'inline-flex gap-0.5 rounded-full bg-[var(--bg-sunken)] p-0.5 text-sm font-medium',
        className,
      )}
    >
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(opt.value)}
            className={clsx(
              'flex min-h-11 items-center gap-1.5 rounded-full px-3.5 transition-colors',
              optionClassName,
              active
                ? 'bg-[var(--bg-elevated)] text-[var(--fg)] shadow-sm'
                : 'text-[var(--fg-muted)] hover:text-[var(--fg)]',
            )}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

export function EmptyState({
  title,
  body,
  action,
}: {
  title: string;
  body?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed px-6 py-10 text-center hairline">
      <p className="font-semibold">{title}</p>
      {body ? <p className="max-w-sm text-sm text-muted">{body}</p> : null}
      {action}
    </div>
  );
}

export function StarButton({
  active,
  onClick,
  label,
  className,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      aria-label={label}
      className={clsx(
        'grid size-10 place-items-center rounded-full transition-colors',
        active ? 'text-warn-400' : 'text-[var(--fg-faint)] hover:text-[var(--fg-muted)]',
        className,
      )}
    >
      <svg viewBox="0 0 20 20" className="size-5" fill={active ? 'currentColor' : 'none'} aria-hidden>
        <path
          d="m10 2.8 2.25 4.56 5.03.73-3.64 3.55.86 5.01L10 14.28l-4.5 2.37.86-5.01L2.72 8.1l5.03-.73L10 2.8Z"
          stroke="currentColor"
          strokeWidth="1.3"
          strokeLinejoin="round"
        />
      </svg>
    </button>
  );
}
