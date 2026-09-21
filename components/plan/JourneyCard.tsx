'use client';

import clsx from 'clsx';
import Link from 'next/link';
import { DepartureCard } from '@/components/departures/DepartureCard';
import { ExpressBadge, ModeIcon, RouteBadge } from '@/components/ui/primitives';
import { formatClockParts, formatCountdown } from '@/lib/transit/time';
import { useTicker } from '@/lib/client/useTransit';
import type { DirectionTone } from '@/components/departures/directions';
import type { Journey } from '@/lib/transit/types';

/**
 * A planned journey. A direct service reuses the departure card; a journey
 * with a change shows every leg and the time between them, because the change
 * is the part a rider needs to judge.
 */
export function JourneyCard({ journey, tone }: { journey: Journey; tone?: DirectionTone }) {
  const now = useTicker(15_000);

  if (journey.transfers === 0) {
    return <DepartureCard departure={journey.legs[0]} tone={tone} />;
  }

  const depart = formatClockParts(journey.departureTime);
  const arrive = formatClockParts(journey.arrivalTime);
  const countdown = formatCountdown(journey.departureTime, now);
  const tight = journey.connectionMinutes.some((m) => m <= 8);

  return (
    <article className="overflow-hidden rounded-2xl border hairline bg-[var(--bg-elevated)]">
      {/* Summary ------------------------------------------------------- */}
      <div className="flex items-start justify-between gap-3 px-4 pt-3.5 pb-3">
        <div className="min-w-0">
          <p className="tabular flex items-baseline gap-1.5 text-[21px] leading-none font-semibold tracking-tight">
            {depart.time}
            <span className="text-[10px] font-semibold text-faint uppercase">
              {depart.suffix.replace(/\./g, '')}
            </span>
            <span className="px-1 text-faint" aria-hidden>
              →
            </span>
            {arrive.time}
            <span className="text-[10px] font-semibold text-faint uppercase">
              {arrive.suffix.replace(/\./g, '')}
            </span>
          </p>
          <p className="mt-1.5 text-[12px] text-muted">
            {formatDuration(journey.durationMinutes)} ·{' '}
            {journey.transfers === 1 ? '1 change' : `${journey.transfers} changes`}
            {countdown ? ` · departs in ${countdown.toLowerCase()}` : ''}
          </p>
        </div>

        <span
          className={clsx(
            'shrink-0 rounded-full px-2 py-1 text-[10px] font-bold tracking-wide uppercase',
            tight ? 'bg-warn-500/14 text-warn-500' : 'bg-[var(--bg-sunken)] text-[var(--fg-muted)]',
          )}
        >
          {tight ? 'Tight change' : 'Change'}
        </span>
      </div>

      {/* Legs ---------------------------------------------------------- */}
      <ol className="border-t px-4 py-3 hairline">
        {journey.legs.map((leg, index) => {
          const legDepart = formatClockParts(leg.scheduledTime);
          const legArrive = formatClockParts(leg.arrivalTime);
          const wait = journey.connectionMinutes[index];

          return (
            <li key={leg.id}>
              <div className="flex gap-3 py-1.5">
                <span
                  aria-hidden
                  className="mt-1.5 w-1 shrink-0 rounded-full"
                  style={{ background: leg.express ? 'var(--express)' : (leg.routeColor ?? 'var(--accent)') }}
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <ModeIcon type={leg.vehicleType} className="size-4 text-[var(--fg-muted)]" />
                    <RouteBadge
                      code={leg.serviceCode ?? leg.routeCode}
                      color={leg.routeColor}
                      type={leg.vehicleType}
                      className="h-5 text-[11px]"
                    />
                    {leg.express ? <ExpressBadge /> : null}
                    <span className="min-w-0 truncate text-[12px] text-muted">{leg.routeName}</span>
                    {leg.platform ? (
                      <span className="tabular ml-auto shrink-0 rounded-md bg-[var(--bg-sunken)] px-1.5 py-0.5 text-[11px] font-bold">
                        {leg.platform.replace(/^platforms?\s*/i, 'Plat ')}
                      </span>
                    ) : null}
                  </div>

                  <p className="mt-1 flex items-baseline gap-2 text-[13px]">
                    <span className="tabular font-semibold">{legDepart.time}</span>
                    <span className="min-w-0 truncate text-muted">{leg.stopName}</span>
                  </p>
                  <p className="mt-0.5 flex items-baseline gap-2 text-[13px]">
                    <span className="tabular font-semibold">{legArrive.time}</span>
                    <span className="min-w-0 truncate text-muted">{leg.arrivalStopName}</span>
                  </p>

                  {leg.tripId ? (
                    <Link
                      href={`/trips/${encodeURIComponent(leg.tripId)}`}
                      className="mt-1 inline-block text-[12px] font-medium text-[var(--accent)]"
                    >
                      Track this {leg.vehicleType === 'bus' ? 'bus' : 'train'} →
                    </Link>
                  ) : null}
                </div>
              </div>

              {wait != null ? (
                <div className="my-1 flex items-center gap-2 rounded-lg bg-[var(--bg-sunken)] px-2.5 py-1.5 text-[12px]">
                  <span aria-hidden>⇄</span>
                  <span className={clsx('font-medium', wait <= 8 && 'text-warn-500')}>
                    {wait} min to change
                  </span>
                  <span className="min-w-0 truncate text-faint">at {leg.arrivalStopName}</span>
                </div>
              ) : null}
            </li>
          );
        })}
      </ol>
    </article>
  );
}

function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}
