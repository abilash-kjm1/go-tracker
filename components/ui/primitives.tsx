'use client';

import clsx from 'clsx';
import type { ReactNode } from 'react';
import type { VehicleType } from '@/lib/transit/types';

/** Mode glyphs. A bus never gets a train icon. */
export function ModeIcon({ type, className }: { type: VehicleType; className?: string }) {
  const label = type === 'train' ? 'GO Train' : type === 'bus' ? 'GO Bus' : 'GO service';
  return (
    <span className={clsx('inline-flex shrink-0 items-center', className)} role="img" aria-label={label}>
      {type === 'train' ? (
        <svg viewBox="0 0 20 20" className="size-full" fill="none" aria-hidden>
          <path
            d="M6 2.5h8a2.5 2.5 0 0 1 2.5 2.5v7A2.5 2.5 0 0 1 14 14.5H6A2.5 2.5 0 0 1 3.5 12V5A2.5 2.5 0 0 1 6 2.5Z"
            stroke="currentColor"
            strokeWidth="1.4"
          />
          <path d="M4 7.5h12" stroke="currentColor" strokeWidth="1.4" />
          <circle cx="7" cy="11.5" r="1" fill="currentColor" />
          <circle cx="13" cy="11.5" r="1" fill="currentColor" />
          <path d="M7.5 14.5 5.5 18M12.5 14.5 14.5 18" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
        </svg>
      ) : type === 'bus' ? (
        <svg viewBox="0 0 20 20" className="size-full" fill="none" aria-hidden>
          <path
            d="M4.5 4.5h11a1.5 1.5 0 0 1 1.5 1.5v7.5a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1.5 1.5 0 0 1 1.5-1.5Z"
            stroke="currentColor"
            strokeWidth="1.4"
          />
          <path d="M3 8.5h14" stroke="currentColor" strokeWidth="1.4" />
          <circle cx="6.5" cy="12" r="1" fill="currentColor" />
          <circle cx="13.5" cy="12" r="1" fill="currentColor" />
          <path d="M5.5 14.5V17M14.5 14.5V17" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
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
      className={clsx(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold tracking-wide uppercase',
        tone === 'neutral' && 'bg-[var(--bg-sunken)] text-[var(--fg-muted)]',
        tone === 'ok' && 'bg-signal-500/12 text-signal-600 dark:text-signal-300',
        tone === 'warn' && 'bg-warn-500/14 text-warn-500',
        tone === 'bad' && 'bg-alert-500/14 text-alert-500',
        tone === 'accent' && 'bg-[var(--accent)] text-[var(--accent-fg)]',
        className,
      )}
    >
      {children}
    </span>
  );
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
        'inline-flex h-6 min-w-6 items-center justify-center rounded-md px-1.5 font-bold whitespace-nowrap text-white',
        // A variant like "12B" needs to fit without shrinking the badge.
        code.length > 3 ? 'text-[10px]' : 'text-xs',
        className,
      )}
      style={{ background: color ?? 'var(--color-ink-600)' }}
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
        'inline-flex shrink-0 items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-bold tracking-wide uppercase',
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
              'flex min-h-9 items-center gap-1.5 rounded-full px-3.5 transition-colors',
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
