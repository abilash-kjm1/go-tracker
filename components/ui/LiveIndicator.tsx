'use client';

import clsx from 'clsx';
import { formatAge } from '@/lib/transit/time';
import { useTicker } from '@/lib/client/useTransit';
import type { DataFreshness } from '@/lib/transit/types';

/**
 * The app's honesty control. Cached or delayed data is never dressed up as
 * live — the label changes with the actual age of the payload.
 */
export function LiveIndicator({
  freshness,
  updatedAt,
  compact = false,
  className,
}: {
  freshness: DataFreshness;
  updatedAt: string | null;
  compact?: boolean;
  className?: string;
}) {
  const now = useTicker(5_000);

  const tone =
    freshness === 'live'
      ? 'text-signal-600 dark:text-signal-300'
      : freshness === 'stale'
        ? 'text-warn-500'
        : freshness === 'scheduled'
          ? 'text-[var(--fg-muted)]'
          : 'text-alert-500';

  const label =
    freshness === 'live'
      ? 'LIVE'
      : freshness === 'stale'
        ? 'DATA DELAYED'
        : freshness === 'scheduled'
          ? 'SCHEDULED'
          : 'LIVE DATA UNAVAILABLE';

  return (
    <span
      className={clsx('inline-flex items-center gap-1.5 text-[11px] font-semibold tracking-wide', tone, className)}
      aria-live="polite"
    >
      <span
        className={clsx(
          'size-1.5 rounded-full',
          freshness === 'live' && 'live-dot bg-signal-500',
          freshness === 'stale' && 'bg-warn-500',
          freshness === 'scheduled' && 'bg-[var(--fg-faint)]',
          freshness === 'unavailable' && 'bg-alert-500',
        )}
        aria-hidden
      />
      {label}
      {!compact && updatedAt ? (
        <span className="font-normal text-[var(--fg-faint)]">· updated {formatAge(updatedAt, now)}</span>
      ) : null}
    </span>
  );
}
