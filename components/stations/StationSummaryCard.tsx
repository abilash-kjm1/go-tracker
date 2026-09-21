'use client';

import Link from 'next/link';
import { ModeIcon, Pill, Skeleton } from '@/components/ui/primitives';
import { formatClock, formatCountdown } from '@/lib/transit/time';
import { useTicker, useTransit } from '@/lib/client/useTransit';
import { formatDistance } from '@/lib/transit/geo';
import type { Departure } from '@/lib/transit/types';

/**
 * Compact "next departure" card used for favourites and nearby stops on the
 * home screen — one glance should answer "when do I need to leave".
 */
export function StationSummaryCard({
  stopId,
  name,
  starred = false,
  distanceKm,
}: {
  stopId: string;
  name: string;
  starred?: boolean;
  distanceKm?: number;
}) {
  const now = useTicker(15_000);
  const { data, loading } = useTransit<Departure[]>(
    `/api/transit/stations/${encodeURIComponent(stopId)}/departures?limit=6`,
    { intervalMs: 60_000 },
  );

  // The board keeps just-departed services for context; "next departure" must
  // not be one of them.
  const next =
    data?.find((d) => {
      const at = new Date(d.estimatedTime ?? d.scheduledTime).getTime();
      return !d.cancelled && Number.isFinite(at) && at >= now - 30_000;
    }) ?? undefined;
  const delayMin = next?.delaySeconds != null ? Math.round(next.delaySeconds / 60) : null;
  const late = !next?.cancelled && delayMin != null && delayMin >= 1;

  return (
    <Link
      href={`/stations/${encodeURIComponent(stopId)}`}
      className="block rounded-2xl border px-4 py-3.5 transition-colors hairline bg-[var(--bg-elevated)] hover:bg-[var(--bg-sunken)]"
    >
      <div className="flex items-center gap-2">
        {starred ? <span aria-hidden className="text-warn-400">★</span> : null}
        <h3 className="min-w-0 flex-1 truncate font-semibold">{name}</h3>
        {distanceKm != null ? (
          <span className="tabular text-xs text-faint">{formatDistance(distanceKm)}</span>
        ) : null}
      </div>

      {loading && !data ? (
        <div className="mt-3 space-y-2">
          <Skeleton className="h-6 w-28" />
          <Skeleton className="h-4 w-48" />
        </div>
      ) : next ? (
        <div className="mt-3">
          <p className="text-[11px] font-semibold tracking-wide text-faint uppercase">
            Next departure
          </p>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="tabular text-2xl leading-none font-semibold tracking-tight">
              {formatClock(next.scheduledTime)}
            </span>
            {next.cancelled ? (
              <Pill tone="bad">Cancelled</Pill>
            ) : late ? (
              <Pill tone="warn">+{delayMin} min</Pill>
            ) : next.realtime ? (
              <Pill tone="ok">On time</Pill>
            ) : (
              <Pill tone="neutral">Scheduled</Pill>
            )}
          </div>

          <div className="mt-2 flex items-center gap-2 text-sm">
            <ModeIcon type={next.vehicleType} className="size-4 text-[var(--fg-muted)]" />
            <span className="min-w-0 truncate">{next.destination ?? next.routeName}</span>
          </div>

          <div className="mt-2 flex items-center gap-3 text-[13px] text-muted">
            {next.platform ? (
              <span className="flex items-baseline gap-1.5 rounded-lg bg-[var(--bg-sunken)] px-2 py-1">
                <span className="text-[8px] font-bold tracking-[0.1em] text-faint uppercase">
                  Platform
                </span>
                <span className="tabular text-[15px] leading-none font-bold text-[var(--fg)]">
                  {next.platform.replace(/^platforms?\s*/i, '')}
                </span>
              </span>
            ) : null}
            {!next.cancelled ? (
              <span className="ml-auto font-medium text-[var(--fg)]">
                {departureLabel(formatCountdown(next.estimatedTime ?? next.scheduledTime, now))}
              </span>
            ) : null}
          </div>
        </div>
      ) : (
        <p className="mt-3 text-sm text-muted">No departures scheduled in the next few hours.</p>
      )}
    </Link>
  );
}

/** "Departing in 8 min", but "Departed" / "2 min ago" once the time has passed. */
function departureLabel(countdown: string): string {
  if (!countdown) return '';
  if (countdown === 'Now') return 'Departing now';
  if (countdown === 'Departed' || countdown.endsWith('ago')) return `Departed ${countdown === 'Departed' ? '' : countdown}`.trim();
  return `Departing in ${countdown}`;
}
