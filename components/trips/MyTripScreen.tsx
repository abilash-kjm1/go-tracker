'use client';

import Link from 'next/link';
import { useState } from 'react';
import { JourneyLine } from './JourneyLine';
import { EmptyState, Skeleton } from '@/components/ui/primitives';
import { LiveIndicator } from '@/components/ui/LiveIndicator';
import { useActiveTrip, useWakeLock } from '@/lib/client/activeTrip';
import { useStopAlertWatcher, useStopAlerts } from '@/lib/client/stopAlerts';
import { useTicker, useTransit } from '@/lib/client/useTransit';
import { formatClock } from '@/lib/transit/time';
import type { TripDetail } from '@/lib/transit/types';

const tidy = (name: string) => name.replace(/\s+GO(\s+Bus)?$/i, '');

/**
 * The screen to keep open while travelling: how many stops until you get off,
 * when you arrive, and the alerts that will tell you. One active journey only.
 */
export function MyTripScreen() {
  const { trip, ready, end } = useActiveTrip();
  const [awake, setAwake] = useState(true);
  const wakeSupported = useWakeLock(awake);
  const now = useTicker(15_000);

  // The leg you are on: the first whose alighting stop is still ahead.
  const legs = trip?.legs ?? [];
  const [legIndex, setLegIndex] = useState(0);
  const leg = legs[Math.min(legIndex, Math.max(0, legs.length - 1))];

  const { data: detail, meta, freshness, loading } = useTransit<TripDetail>(
    leg ? `/api/transit/trips/${encodeURIComponent(leg.tripId)}` : null,
    { intervalMs: 20_000, enabled: Boolean(leg) },
  );

  const stopAlerts = useStopAlerts(leg?.tripId);
  useStopAlertWatcher(detail ?? null, stopAlerts.alerts, stopAlerts.markFired);

  if (ready && !trip) {
    return (
      <div className="mx-auto w-full max-w-2xl px-4 pt-safe">
        <header className="pt-6 pb-4">
          <h1 className="text-[28px] leading-tight font-semibold tracking-tight">My trip</h1>
        </header>
        <EmptyState
          title="No journey on the go"
          body="Plan a trip from the home screen and tap Start this trip. This page then follows you, counts down your stops and tells you when to get off."
        />
        <Link
          href="/"
          className="mt-3 flex min-h-12 items-center justify-center rounded-2xl bg-[var(--accent)] px-4 text-sm font-semibold text-[var(--accent-fg)]"
        >
          Plan a trip
        </Link>
      </div>
    );
  }

  if (!trip || !leg) {
    return (
      <div className="mx-auto w-full max-w-2xl space-y-3 px-4 pt-10">
        <Skeleton className="h-24 rounded-3xl" />
        <Skeleton className="h-64 rounded-2xl" />
      </div>
    );
  }

  const stops = detail?.stops ?? [];
  const alightIndex = stops.findIndex((s) => s.stopId === leg.alightStopId);
  const nextIndex = stops.findIndex((s) => s.status === 'next' || s.status === 'current');
  const stopsLeft = alightIndex >= 0 && nextIndex >= 0 ? Math.max(0, alightIndex - nextIndex + 1) : null;
  const alight = alightIndex >= 0 ? stops[alightIndex] : undefined;
  const arriveAt = alight?.estimatedDeparture ?? alight?.scheduledArrival ?? alight?.scheduledDeparture;
  const minutes = arriveAt ? Math.max(0, Math.round((new Date(arriveAt).getTime() - now) / 60_000)) : null;
  const finalLeg = legIndex === legs.length - 1;
  const arrived = stopsLeft === 0 && alight?.status !== 'upcoming';

  return (
    <div className="mx-auto w-full max-w-2xl px-4 pt-safe pb-28">
      <header className="flex items-center justify-between gap-3 pt-6 pb-3">
        <div className="min-w-0">
          <h1 className="truncate text-[26px] leading-tight font-semibold tracking-tight">My trip</h1>
          <p className="truncate text-[13px] text-muted">
            {tidy(trip.originName)} → {tidy(trip.destinationName)}
          </p>
        </div>
        <button
          type="button"
          onClick={end}
          className="shrink-0 rounded-full bg-[var(--bg-sunken)] px-3.5 py-2 text-[12px] font-semibold text-muted"
        >
          End trip
        </button>
      </header>

      {/* The one number that matters while you are on board. */}
      <section
        className="relative overflow-hidden rounded-3xl px-5 py-5 text-white"
        style={{ background: 'linear-gradient(150deg, #04351f 0%, #067a45 100%)' }}
      >
        <div className="flex items-start justify-between gap-3">
          <p className="text-[11px] font-bold tracking-[0.18em] text-white/60 uppercase">
            {finalLeg ? 'Get off at' : 'Change at'}
          </p>
          <LiveIndicator freshness={freshness} updatedAt={meta?.updatedAt ?? null} compact />
        </div>
        <p className="mt-1 truncate text-[26px] leading-tight font-bold">{tidy(leg.alightStopName)}</p>

        <div className="mt-4 flex items-end gap-5">
          <div>
            <p className="tabular text-[46px] leading-none font-black">
              {stopsLeft ?? (loading ? '–' : '?')}
            </p>
            <p className="mt-1 text-[11px] font-semibold tracking-wide text-white/60">
              {stopsLeft === 1 ? 'stop to go' : 'stops to go'}
            </p>
          </div>
          <span aria-hidden className="mb-6 h-10 w-px bg-white/20" />
          <div>
            <p className="tabular text-[24px] leading-none font-bold">
              {minutes != null ? `${minutes} min` : '—'}
            </p>
            <p className="mt-1 text-[11px] font-semibold tracking-wide text-white/60">
              {arriveAt ? formatClock(arriveAt) : 'no estimate yet'}
            </p>
          </div>
        </div>

        {arrived ? (
          <p className="mt-4 rounded-xl bg-white/15 px-3 py-2 text-[13px] font-bold">
            {finalLeg ? 'This is your stop.' : 'Change here for your next leg.'}
          </p>
        ) : null}

        <div className="mt-4 flex flex-wrap gap-2">
          {detail ? (
            <Link
              href={`/map?trip=${encodeURIComponent(detail.id)}`}
              className="rounded-full bg-white/15 px-3.5 py-2 text-[12.5px] font-bold ring-1 ring-white/20"
            >
              Show on map
            </Link>
          ) : null}
          {legs.length > 1 ? (
            <button
              type="button"
              onClick={() => setLegIndex((i) => (i + 1) % legs.length)}
              className="rounded-full bg-white/15 px-3.5 py-2 text-[12.5px] font-bold ring-1 ring-white/20"
            >
              {finalLeg ? 'Show first leg' : 'Show next leg'}
            </button>
          ) : null}
          {wakeSupported ? (
            <button
              type="button"
              onClick={() => setAwake((v) => !v)}
              aria-pressed={awake}
              className="rounded-full px-3.5 py-2 text-[12.5px] font-bold ring-1 ring-white/20"
              style={awake ? { background: '#7dfab8', color: '#04351f' } : { background: 'rgb(255 255 255 / 0.15)' }}
            >
              {awake ? 'Screen staying on' : 'Keep screen on'}
            </button>
          ) : null}
        </div>
      </section>

      {stopAlerts.permission === 'default' ? (
        <button
          type="button"
          onClick={() => void stopAlerts.request()}
          className="mt-3 flex min-h-12 w-full items-center justify-center rounded-2xl bg-[var(--accent)] px-4 text-[13px] font-bold text-[var(--accent-fg)]"
        >
          Allow notifications for your stop alerts
        </button>
      ) : null}
      {stopAlerts.permission === 'granted' ? (
        <p className="mt-3 rounded-2xl border px-4 py-3 text-[12px] text-muted hairline bg-[var(--bg-elevated)]">
          {stopAlerts.armedCount} alert{stopAlerts.armedCount === 1 ? '' : 's'} set on this leg. Keep GO
          Tracker on screen — iPhone pauses web apps in the background.
        </p>
      ) : null}

      {detail ? (
        <JourneyLine
          trip={detail}
          now={now}
          armedStopIds={stopAlerts.armedStopIds}
          onToggleAlert={stopAlerts.toggle}
        />
      ) : (
        <Skeleton className="mt-3 h-64 rounded-2xl" />
      )}
    </div>
  );
}
