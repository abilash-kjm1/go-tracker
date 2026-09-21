'use client';

import clsx from 'clsx';
import { LiveIndicator } from '@/components/ui/LiveIndicator';
import { EmptyState, ModeIcon, Skeleton } from '@/components/ui/primitives';
import { useTransit } from '@/lib/client/useTransit';
import type { TransitAlert } from '@/lib/transit/types';

/**
 * Alerts are derived from live vehicle data (delays and operator-reported
 * reasons). The temporary upstream publishes no network alert feed, so nothing
 * here is invented — an empty list means the data shows no disruption.
 */
export function AlertsScreen() {
  const { data, meta, error, loading, freshness } = useTransit<TransitAlert[]>(
    '/api/transit/alerts',
    { intervalMs: 45_000 },
  );

  return (
    <div className="mx-auto w-full max-w-2xl px-4 pt-safe">
      <header className="flex items-end justify-between gap-3 pt-6 pb-4">
        <div>
          <h1 className="text-[28px] leading-tight font-semibold tracking-tight">Alerts</h1>
          <p className="mt-1 text-[13px] text-muted">Delays reported by vehicles in service.</p>
        </div>
        <LiveIndicator freshness={freshness} updatedAt={meta?.updatedAt ?? null} compact />
      </header>

      {loading && !data ? (
        <div className="space-y-2">
          {Array.from({ length: 3 }, (_, i) => (
            <Skeleton key={i} className="h-24 rounded-2xl" />
          ))}
        </div>
      ) : null}

      {error && !data ? (
        <EmptyState title="GO real-time data is temporarily unavailable." body={error} />
      ) : null}

      {data?.length === 0 ? (
        <EmptyState
          title="No delays reported"
          body="Every vehicle currently reporting is running close to schedule."
        />
      ) : null}

      <ul className="space-y-2">
        {data?.map((alert) => (
          <li
            key={alert.id}
            className={clsx(
              'rounded-2xl border px-4 py-3.5 hairline',
              alert.severity === 'severe' ? 'bg-alert-500/8' : 'bg-[var(--bg-elevated)]',
            )}
          >
            <div className="flex items-center gap-2">
              <ModeIcon type={alert.vehicleType ?? 'unknown'} className="size-5 text-[var(--fg-muted)]" />
              <h2 className="min-w-0 flex-1 truncate font-semibold">{alert.title}</h2>
              <span
                className={clsx(
                  'text-[11px] font-semibold tracking-wide uppercase',
                  alert.severity === 'severe' ? 'text-alert-500' : 'text-warn-500',
                )}
              >
                {alert.severity === 'severe' ? 'Major delay' : 'Delay'}
              </span>
            </div>
            <p className="mt-1.5 text-sm text-muted">{alert.body}</p>
          </li>
        ))}
      </ul>

      <div className="h-8" />
    </div>
  );
}
