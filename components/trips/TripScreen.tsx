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
import { JourneyLine } from './JourneyLine';
import { useFavorites } from '@/lib/client/favorites';
import { useStopAlertWatcher, useStopAlerts } from '@/lib/client/stopAlerts';
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
  const stopAlerts = useStopAlerts(tripId);
  useStopAlertWatcher(trip ?? null, stopAlerts.alerts, stopAlerts.markFired);

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

      <StopAlertBar state={stopAlerts} />

      <JourneyLine
        trip={trip}
        now={now}
        armedStopIds={stopAlerts.armedStopIds}
        onToggleAlert={stopAlerts.toggle}
      />

      <TripAlerts trip={trip} alerts={alerts ?? []} />

      <div className="h-10" />
    </div>
  );
}

/**
 * Explains the state of arrival alerts for this trip: how many are set, whether
 * the browser will allow a notification, and what iOS needs before it will.
 */
function StopAlertBar({ state }: { state: ReturnType<typeof useStopAlerts> }) {
  const { armedCount, permission, request, installed, clearTrip } = state;
  if (armedCount === 0) {
    return (
      <p className="mt-3 rounded-2xl border px-4 py-3 text-[13px] text-muted hairline bg-[var(--bg-elevated)]">
        Tap the bell beside a stop to be told when this train reaches it.
      </p>
    );
  }

  const needsPermission = permission === 'default';
  const blocked = permission === 'denied';
  const unsupported = permission === 'unsupported';

  return (
    <div className="mt-3 rounded-2xl border px-4 py-3 hairline bg-[var(--bg-elevated)]">
      <div className="flex items-center justify-between gap-3">
        <p className="text-[13px] font-semibold">
          {armedCount} stop alert{armedCount === 1 ? '' : 's'} set
        </p>
        <button
          type="button"
          onClick={clearTrip}
          className="rounded-full bg-[var(--bg-sunken)] px-3 py-1 text-[12px] font-semibold text-muted"
        >
          Clear
        </button>
      </div>

      {needsPermission ? (
        <button
          type="button"
          onClick={() => void request()}
          className="mt-2.5 flex min-h-11 w-full items-center justify-center rounded-xl bg-[var(--accent)] px-4 text-[13px] font-bold text-[var(--accent-fg)]"
        >
          Allow notifications
        </button>
      ) : null}

      {blocked ? (
        <p className="mt-2 text-[12px] text-[var(--color-warn-500)]">
          Notifications are blocked for this site, so alerts can only appear on screen. Turn them
          back on in your browser or iPhone settings.
        </p>
      ) : null}

      {unsupported && !installed ? (
        <p className="mt-2 text-[12px] text-muted">
          On iPhone, add GO Tracker to your Home Screen first: tap Share, then{' '}
          <strong>Add to Home Screen</strong>. Notifications only work from the installed app.
        </p>
      ) : null}

      {permission === 'granted' ? (
        <p className="mt-2 text-[12px] text-muted">
          Keep GO Tracker open as you travel. iPhone pauses web apps once they leave the screen, so
          an alert can only reach you while the app is showing.
        </p>
      ) : null}
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
