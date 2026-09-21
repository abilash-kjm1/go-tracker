'use client';

import clsx from 'clsx';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { LiveIndicator } from '@/components/ui/LiveIndicator';
import {
  EmptyState,
  ExpressBadge,
  ModeIcon,
  Pill,
  RouteBadge,
  Skeleton,
  StarButton,
} from '@/components/ui/primitives';
import dynamic from 'next/dynamic';
import { useFavorites } from '@/lib/client/favorites';
import { useTicker, useTransit } from '@/lib/client/useTransit';
import { formatAge, formatClock } from '@/lib/transit/time';
import type { TransitAlert, TripDetail } from '@/lib/transit/types';

// MapLibre only loads once a trip is actually open.
const TripMap = dynamic(() => import('./TripMap').then((m) => m.TripMap), {
  ssr: false,
  loading: () => <Skeleton className="h-[180px] rounded-2xl" />,
});

export function TripScreen({ tripId }: { tripId: string }) {
  const router = useRouter();
  const now = useTicker(5_000);
  const { isFavorite, toggle } = useFavorites();
  const { data: trip, meta, error, loading, freshness } = useTransit<TripDetail>(
    `/api/transit/trips/${encodeURIComponent(tripId)}`,
    { intervalMs: 20_000 },
  );

  // Alerts are filtered to this trip's own route, so the page only shows
  // disruptions that actually affect this journey.
  const { data: alerts } = useTransit<TransitAlert[]>('/api/transit/alerts', {
    intervalMs: 60_000,
  });

  if (loading && !trip) {
    return (
      <div className="mx-auto w-full max-w-2xl space-y-4 px-4 pt-10 pt-safe">
        <Skeleton className="h-8 w-56" />
        <Skeleton className="h-5 w-72" />
        <Skeleton className="h-72 rounded-2xl" />
      </div>
    );
  }

  if (!trip) {
    return (
      <div className="mx-auto w-full max-w-2xl px-4 pt-10 pt-safe">
        <EmptyState
          title="Trip unavailable"
          body={error ?? 'This trip is not in the current schedule window.'}
        />
      </div>
    );
  }

  const delayMin = trip.delaySeconds != null ? Math.round(trip.delaySeconds / 60) : null;
  const late = delayMin != null && delayMin >= 1;
  const starred = isFavorite('trip', trip.id);

  return (
    <div className="mx-auto w-full max-w-2xl px-4 pt-safe">
      <button
        type="button"
        onClick={() => router.back()}
        className="-ml-2 mt-4 flex min-h-11 items-center gap-1 rounded-xl px-2 text-sm font-medium text-muted"
      >
        <span aria-hidden>←</span> Back
      </button>

      <header className="flex items-start gap-3 pt-1 pb-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-sm font-medium text-muted">
            <ModeIcon type={trip.vehicleType} className="size-5" />
            {trip.vehicleType === 'bus' ? 'GO Bus' : trip.vehicleType === 'train' ? 'GO Train' : 'GO service'}
            <RouteBadge
              code={trip.serviceCode ?? trip.routeCode}
              color={trip.routeColor}
              type={trip.vehicleType}
            />
          </div>
          <h1 className="mt-1.5 text-[26px] leading-tight font-semibold tracking-tight">
            {trip.routeName ?? 'GO service'}
          </h1>
          <p className="mt-1 text-[15px] text-muted">
            {[trip.origin, trip.destination].filter(Boolean).join(' → ')}
          </p>
        </div>
        <StarButton
          active={starred}
          label={starred ? 'Remove trip from favourites' : 'Add trip to favourites'}
          onClick={() =>
            toggle({
              kind: 'trip',
              id: trip.id,
              name: `Trip ${trip.tripNumber ?? trip.id}`,
              subtitle: trip.routeName,
              vehicleType: trip.vehicleType,
            })
          }
        />
      </header>

      <div className="flex flex-wrap items-center gap-2 pb-4">
        {trip.cancelled ? (
          <Pill tone="bad">Cancelled</Pill>
        ) : late ? (
          <Pill tone="warn">+{delayMin} min</Pill>
        ) : trip.vehicle ? (
          <Pill tone="ok">On time</Pill>
        ) : (
          <Pill tone="neutral">Scheduled</Pill>
        )}
        {trip.express ? <ExpressBadge className="h-[22px]" /> : null}
        {trip.tripNumber ? <Pill tone="neutral">Trip {trip.tripNumber}</Pill> : null}
        <LiveIndicator freshness={freshness} updatedAt={meta?.updatedAt ?? null} className="ml-auto" />
      </div>

      {meta?.degraded ? (
        <p className="mb-4 rounded-xl bg-[var(--bg-sunken)] px-3 py-2 text-[13px] text-muted">
          {meta.degraded}
        </p>
      ) : null}

      <div className="mb-3">
        <TripMap trip={trip} />
      </div>

      {trip.vehicle ? (
        <div className="mt-3 rounded-2xl border px-4 py-3.5 hairline bg-[var(--bg-elevated)]">
          <div className="flex items-center gap-2">
            <span
              className={clsx(
                'size-2 rounded-full',
                trip.vehicle.isMoving ? 'live-dot bg-signal-500' : 'bg-warn-500',
              )}
              aria-hidden
            />
            <p className="text-[15px] font-semibold">
              {trip.vehicle.isMoving ? 'Moving' : 'Stopped'}
              {trip.vehicle.nextStopName ? (
                <span className="font-normal text-muted"> · next stop {trip.vehicle.nextStopName}</span>
              ) : null}
            </p>
          </div>
          {trip.vehicle.detail ? (
            <p className="mt-1.5 text-[13px] text-muted">{trip.vehicle.detail}</p>
          ) : null}
          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-faint">
            <span>Updated {formatAge(trip.vehicle.updatedAt, now)}</span>
            {trip.vehicle.vehicleLabel ? <span>Vehicle {trip.vehicle.vehicleLabel}</span> : null}
          </div>
          {Number.isFinite(trip.vehicle.latitude) ? (
            <Link
              href={`/map?trip=${encodeURIComponent(trip.id)}`}
              className="mt-3 flex min-h-11 items-center justify-center rounded-xl bg-[var(--accent)] px-4 text-sm font-semibold text-[var(--accent-fg)]"
            >
              Follow on the live map
            </Link>
          ) : null}
        </div>
      ) : null}

      <section aria-label="Journey" className="mt-3 rounded-2xl border px-4 py-2 hairline bg-[var(--bg-elevated)]">
        <ol className="relative">
          {trip.stops.map((stop, index) => {
            const isLast = index === trip.stops.length - 1;
            return (
              <li key={`${stop.stopId}-${index}`} className="relative flex gap-3 py-2.5">
                <div className="flex w-5 flex-col items-center">
                  <span
                    className={clsx(
                      'z-10 mt-1 grid size-3.5 place-items-center rounded-full border-2',
                      stop.status === 'departed' && 'border-[var(--fg-faint)] bg-[var(--fg-faint)]',
                      stop.status === 'current' && 'border-[var(--accent)] bg-[var(--accent)] live-dot',
                      stop.status === 'upcoming' && 'border-[var(--border-strong)] bg-[var(--bg-elevated)]',
                    )}
                    aria-hidden
                  />
                  {!isLast ? (
                    <span
                      className={clsx(
                        'w-0.5 flex-1',
                        stop.status === 'departed' ? 'bg-[var(--fg-faint)]' : 'bg-[var(--border)]',
                      )}
                      aria-hidden
                    />
                  ) : null}
                </div>

                <div className="flex min-w-0 flex-1 items-baseline justify-between gap-3">
                  <span
                    className={clsx(
                      'min-w-0 truncate',
                      stop.status === 'current' ? 'font-semibold' : 'font-medium',
                      stop.status === 'departed' && 'text-[var(--fg-muted)]',
                    )}
                  >
                    {stop.stopName}
                    {stop.platform ? (
                      <span className="ml-2 text-[13px] font-normal text-muted">{stop.platform}</span>
                    ) : null}
                  </span>
                  <span className="shrink-0 text-right">
                    <span
                      className={clsx(
                        'tabular text-sm',
                        stop.status === 'departed' ? 'text-[var(--fg-faint)]' : 'font-medium',
                      )}
                    >
                      {formatClock(stop.estimatedDeparture ?? stop.scheduledDeparture)}
                    </span>
                    {late && stop.status !== 'departed' ? (
                      <span className="tabular block text-[11px] text-faint line-through">
                        {formatClock(stop.scheduledDeparture)}
                      </span>
                    ) : null}
                  </span>
                </div>
              </li>
            );
          })}
        </ol>
      </section>

      <TripAlerts trip={trip} alerts={alerts ?? []} />

      <div className="h-10" />
    </div>
  );
}

/**
 * Disruptions that affect this journey: the operator's own delay reason plus
 * any network alert scoped to this trip's route. Nothing generic is shown —
 * an empty section means the data reports nothing for this route.
 */
function TripAlerts({ trip, alerts }: { trip: TripDetail; alerts: TransitAlert[] }) {
  const relevant = alerts.filter(
    (alert) =>
      (alert.scope.kind === 'route' && alert.scope.id === trip.routeId) ||
      (alert.scope.kind === 'trip' && alert.scope.id === trip.id) ||
      alert.scope.kind === 'network',
  );
  const reason = trip.vehicle?.delayReason;

  if (!relevant.length && !reason) return null;

  return (
    <section className="mt-3 space-y-2">
      <h2 className="px-1 text-[11px] font-semibold tracking-wide text-faint uppercase">
        Alerts for this trip
      </h2>

      {reason ? (
        <div className="rounded-2xl border px-4 py-3 text-[13px] hairline bg-warn-500/10">
          <p className="font-semibold text-warn-500">Reported on this train</p>
          <p className="mt-0.5 text-muted">{reason}</p>
        </div>
      ) : null}

      {relevant.map((alert) => (
        <div
          key={alert.id}
          className={clsx(
            'rounded-2xl border px-4 py-3 text-[13px] hairline',
            alert.severity === 'severe' ? 'bg-alert-500/8' : 'bg-[var(--bg-elevated)]',
          )}
        >
          <p
            className={clsx(
              'font-semibold',
              alert.severity === 'severe' ? 'text-alert-500' : 'text-warn-500',
            )}
          >
            {alert.title}
          </p>
          <p className="mt-0.5 text-muted">{alert.body}</p>
        </div>
      ))}
    </section>
  );
}
