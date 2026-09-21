'use client';

import clsx from 'clsx';
import { useState } from 'react';
import { distanceKm, progressAlongLeg } from '@/lib/transit/geo';
import { formatAge, formatClock } from '@/lib/transit/time';
import type { TripDetail, TripStopTime } from '@/lib/transit/types';

/**
 * The journey drawn like a transit-map line diagram: the line in its own colour,
 * stations as rings on it, and a train that travels along the line between them.
 * Above it, a "now" panel says which leg the train is on and when it arrives.
 */
export function JourneyLine({ trip, now }: { trip: TripDetail; now: number }) {
  // GO's line colours are pure primaries (#ff0d00 red); softened towards slate they
  // stay recognisable without glaring on a light or dark page.
  const color = `color-mix(in srgb, ${trip.routeColor ?? '#10b981'} 78%, #0f172a)`;
  const stops = trip.stops;
  const [showPassed, setShowPassed] = useState(false);

  const hereIdx = stops.findIndex((s) => s.status === 'current');
  const nextIdx = stops.findIndex((s) => s.status === 'next');
  const hasPosition = hereIdx >= 0 || nextIdx >= 0;

  // The leg in progress: from the stop just left (or stood at) to the one ahead.
  const fromIdx = hereIdx >= 0 ? hereIdx : nextIdx > 0 ? nextIdx - 1 : -1;
  const toIdx = hereIdx >= 0 ? hereIdx + 1 : nextIdx;
  const from = fromIdx >= 0 ? stops[fromIdx] : undefined;
  const to = toIdx >= 0 && toIdx < stops.length ? stops[toIdx] : undefined;

  const vehicle = trip.vehicle;
  const progress =
    hereIdx < 0 &&
    from &&
    to &&
    vehicle &&
    Number.isFinite(vehicle.latitude) &&
    Number.isFinite(vehicle.longitude) &&
    from.lat != null &&
    from.lon != null &&
    to.lat != null &&
    to.lon != null
      ? progressAlongLeg(
          vehicle.latitude,
          vehicle.longitude,
          { lat: from.lat, lon: from.lon },
          { lat: to.lat, lon: to.lon },
        )
      : hereIdx >= 0
        ? 0
        : null;

  const arriveAt = to ? (to.estimatedDeparture ?? to.scheduledArrival ?? to.scheduledDeparture) : undefined;
  const minutes = arriveAt ? Math.max(0, Math.round((new Date(arriveAt).getTime() - now) / 60_000)) : null;
  const stopsLeft = stops.filter((s) => s.status === 'next' || s.status === 'upcoming').length;

  // Passed stops are folded away by default: what matters is what is ahead.
  const firstShown = showPassed || fromIdx < 0 ? 0 : Math.max(0, fromIdx);
  const hiddenCount = firstShown;

  return (
    <section aria-label="Journey" className="mt-3 space-y-3">
      {hasPosition && from && to ? (
        <NowPanel
          trip={trip}
          now={now}
          color={color}
          from={from}
          to={to}
          progress={progress ?? 0}
          atStation={hereIdx >= 0}
          minutes={minutes}
          arriveAt={arriveAt}
          stopsLeft={stopsLeft}
        />
      ) : null}

      <div className="overflow-hidden rounded-2xl border hairline bg-[var(--bg-elevated)]">
        <div className="flex items-center justify-between gap-3 border-b px-4 py-3 hairline">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold tracking-[0.12em] text-faint uppercase">All stops</p>
            <p className="truncate text-[14px] font-semibold">
              {tidy(stops[0]?.stopName ?? '')} <span className="text-faint">to</span>{' '}
              {tidy(stops.at(-1)?.stopName ?? '')}
            </p>
          </div>
          <span
            className="tabular shrink-0 rounded-full px-2.5 py-1 text-[12px] font-bold text-white"
            style={{ background: color }}
          >
            {stops.length} stops
          </span>
        </div>
        <div className="px-4 pb-2">
          {hiddenCount > 0 ? (
            <button
              type="button"
              onClick={() => setShowPassed(true)}
              className="mt-2 flex w-full items-center gap-2 rounded-xl bg-[var(--bg-sunken)] px-3 py-2 text-[12px] font-semibold text-muted"
            >
              <span aria-hidden>▾</span>
              {hiddenCount} stop{hiddenCount === 1 ? '' : 's'} already passed
              <span className="ml-auto font-normal text-faint">Show</span>
            </button>
          ) : null}

          <ol className="pt-1">
            {stops.slice(firstShown).map((stop, i) => {
              const index = i + firstShown;
              return (
                <StopRow
                  key={`${stop.stopId}-${index}`}
                  stop={stop}
                  index={index}
                  isFirst={index === 0}
                  isLast={index === stops.length - 1}
                  follower={stops[index + 1]}
                  color={color}
                  progress={index === fromIdx && hereIdx < 0 ? progress : null}
                  minutes={stop.status === 'next' ? minutes : null}
                />
              );
            })}
          </ol>
        </div>
      </div>
    </section>
  );
}

function tidy(name: string) {
  return name.replace(/\s+GO(\s+Bus)?$/i, '');
}

function TrainIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" className={className} aria-hidden>
      <path
        d="M6 2.5h8a2.5 2.5 0 0 1 2.5 2.5v7A2.5 2.5 0 0 1 14 14.5H6A2.5 2.5 0 0 1 3.5 12V5A2.5 2.5 0 0 1 6 2.5Z"
        stroke="currentColor"
        strokeWidth="1.6"
      />
      <path d="M4 7.5h12" stroke="currentColor" strokeWidth="1.6" />
      <circle cx="7" cy="11.5" r="1.1" fill="currentColor" />
      <circle cx="13" cy="11.5" r="1.1" fill="currentColor" />
      <path d="M6 17.5l1.6-3M14 17.5l-1.6-3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

// ---- the "now" panel -------------------------------------------------------

function Stat({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: 'warn' | 'good' }) {
  return (
    <div className="min-w-0 rounded-xl bg-[var(--bg-sunken)] px-3 py-2.5">
      <p className="text-[10px] font-semibold tracking-[0.12em] text-faint uppercase">{label}</p>
      <p
        className={clsx(
          'tabular mt-0.5 truncate text-[16px] leading-tight font-bold',
          tone === 'warn' && 'text-[var(--color-warn-500)]',
          tone === 'good' && 'text-[var(--color-signal-600)]',
        )}
      >
        {value}
      </p>
      {sub ? <p className="mt-0.5 truncate text-[11px] text-muted">{sub}</p> : null}
    </div>
  );
}

const kmText = (km: number) => (km < 1 ? `${Math.max(50, Math.round(km * 10) * 100)} m` : `${km.toFixed(1)} km`);

function NowPanel({
  trip,
  now,
  color,
  from,
  to,
  progress,
  atStation,
  minutes,
  arriveAt,
  stopsLeft,
}: {
  trip: TripDetail;
  now: number;
  color: string;
  from: TripStopTime;
  to: TripStopTime;
  progress: number;
  atStation: boolean;
  minutes: number | null;
  arriveAt?: string;
  stopsLeft: number;
}) {
  const stops = trip.stops;
  const vehicle = trip.vehicle;
  const pct = Math.round(progress * 100);
  const fromName = tidy(from.stopName);
  const toName = tidy(to.stopName);
  const final = stops.at(-1);
  const delayMin = trip.delaySeconds != null ? Math.round(trip.delaySeconds / 60) : 0;
  const late = delayMin >= 1;

  // Distances along the route's own legs (straight between stops).
  const legs = stops.slice(1).map((st, i) => {
    const a = stops[i];
    return a.lat != null && a.lon != null && st.lat != null && st.lon != null
      ? distanceKm(a.lat, a.lon, st.lat, st.lon)
      : 0;
  });
  const total = legs.reduce((x, y) => x + y, 0);
  const toIdx = stops.indexOf(to);
  const legKm = toIdx > 0 ? legs[toIdx - 1] : 0;
  const toNextKm = (1 - progress) * legKm;
  const toEndKm = toNextKm + legs.slice(toIdx).reduce((x, y) => x + y, 0);
  const doneFrac = total > 0 ? Math.min(1, Math.max(0, (total - toEndKm) / total)) : 0;

  const leftClock = formatClock(from.estimatedDeparture ?? from.scheduledDeparture);
  const finalClock = final ? formatClock(final.estimatedDeparture ?? final.scheduledArrival ?? final.scheduledDeparture) : '';
  const rideMinutes =
    final && stops[0]
      ? Math.round(
          (new Date(final.scheduledArrival ?? final.scheduledDeparture ?? 0).getTime() -
            new Date(stops[0].scheduledDeparture ?? 0).getTime()) /
            60_000,
        )
      : null;

  return (
    <div className="overflow-hidden rounded-3xl border bg-[var(--bg-elevated)] shadow-[var(--shadow-card)] hairline">
      {/* Header: what is this service, and how is it doing. */}
      <div className="flex items-center justify-between gap-3 px-4 pt-4">
        <div className="flex min-w-0 items-center gap-2">
          <span
            className="grid size-9 shrink-0 place-items-center rounded-xl text-white"
            style={{ background: color }}
          >
            <TrainIcon className="size-5" />
          </span>
          <div className="min-w-0">
            <p className="truncate text-[14px] leading-tight font-bold">
              {trip.routeName ?? 'GO Train'}
              {trip.express ? <span className="ml-1.5 text-[var(--color-warn-500)]">Express</span> : null}
            </p>
            <p className="text-[12px] text-muted">
              Train {trip.tripNumber} to {tidy(trip.destination ?? '')}
            </p>
          </div>
        </div>
        <span
          className={clsx(
            'shrink-0 rounded-full px-3 py-1 text-[12px] font-bold',
            late
              ? 'bg-[color-mix(in_srgb,var(--color-warn-500)_18%,transparent)] text-[var(--color-warn-500)]'
              : 'bg-[color-mix(in_srgb,var(--color-signal-500)_16%,transparent)] text-[var(--color-signal-600)]',
          )}
        >
          {late ? `${delayMin} min late` : 'On time'}
        </span>
      </div>

      {/* Flight-tracker: both ends of the leg, the train between them. */}
      <div className="px-4 pt-5">
        <div className="grid grid-cols-[1fr_auto_1fr] items-end gap-3">
          <div className="min-w-0">
            <p className="text-[10px] font-semibold tracking-[0.12em] text-faint uppercase">
              {atStation ? 'Now at' : 'Left'}
            </p>
            <p className="truncate text-[20px] leading-tight font-bold">{fromName}</p>
            <p className="tabular text-[12px] text-muted">
              {atStation ? `Departs ${leftClock}` : leftClock}
            </p>
          </div>
          <div className="pb-1 text-center">
            <p className="tabular text-[34px] leading-none font-black" style={{ color }}>
              {minutes ?? '–'}
            </p>
            <p className="text-[10px] font-bold tracking-[0.14em] text-faint uppercase">min</p>
          </div>
          <div className="min-w-0 text-right">
            <p className="text-[10px] font-semibold tracking-[0.12em] text-faint uppercase">Arriving</p>
            <p className="truncate text-[20px] leading-tight font-bold">{toName}</p>
            <p className="tabular text-[12px] text-muted">{arriveAt ? formatClock(arriveAt) : ''}</p>
          </div>
        </div>

        <div className="relative mt-5 mb-2 h-8">
          <div className="absolute inset-x-0 top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-[var(--border)]" />
          <div
            className="absolute top-1/2 left-0 h-1.5 -translate-y-1/2 rounded-full"
            style={{ width: `${pct}%`, background: color, transition: 'width 20s linear' }}
          />
          <span
            className="absolute top-1/2 left-0 size-4 -translate-y-1/2 rounded-full border-[3.5px] bg-[var(--bg-elevated)]"
            style={{ borderColor: color }}
            aria-hidden
          />
          <span
            className="absolute top-1/2 right-0 size-4 -translate-y-1/2 rounded-full border-[3.5px] bg-[var(--bg-elevated)]"
            style={{ borderColor: 'var(--border-strong)' }}
            aria-hidden
          />
          <span
            className="live-dot absolute top-1/2 z-10 grid size-9 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-xl text-white shadow-lg ring-4 ring-[var(--bg-elevated)]"
            style={{ left: `${Math.max(4, Math.min(96, pct))}%`, background: color, transition: 'left 20s linear' }}
            role="img"
            aria-label={atStation ? `Train is at ${fromName}` : `Train is ${pct}% of the way to ${toName}`}
          >
            <TrainIcon className="size-5" />
          </span>
        </div>
      </div>

      {/* The numbers a rider actually wants. */}
      <div className="grid grid-cols-2 gap-2 px-4 pt-3 min-[420px]:grid-cols-3">
        <Stat label="To next stop" value={kmText(toNextKm)} sub={atStation ? 'at station' : `${pct}% of this leg`} />
        <Stat label="Stops to go" value={String(stopsLeft)} sub={`to ${tidy(final?.stopName ?? '')}`} />
        <Stat
          label="Final arrival"
          value={finalClock}
          sub={late ? 'includes the delay' : 'as scheduled'}
          tone={late ? 'warn' : 'good'}
        />
        <Stat label="Left to travel" value={kmText(toEndKm)} sub={`${Math.round(doneFrac * 100)}% done`} />
        <Stat
          label="Status"
          value={vehicle?.isMoving === false ? 'Stopped' : 'Moving'}
          sub={late ? `${delayMin} min behind schedule` : 'Running to schedule'}
        />
        <Stat
          label="Full trip"
          value={rideMinutes != null && rideMinutes > 0 ? `${rideMinutes} min` : '–'}
          sub={vehicle?.vehicleLabel ? `Vehicle ${vehicle.vehicleLabel}` : undefined}
        />
      </div>

      {/* Whole-journey progress. */}
      <div className="px-4 pt-4 pb-4">
        <div className="mb-1.5 flex items-center justify-between text-[11px] font-semibold text-muted">
          <span className="truncate">{tidy(stops[0]?.stopName ?? '')}</span>
          <span className="tabular text-faint">{Math.round(doneFrac * 100)}% of journey</span>
          <span className="truncate">{tidy(final?.stopName ?? '')}</span>
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-[var(--border)]">
          <div
            className="h-full rounded-full"
            style={{ width: `${Math.round(doneFrac * 100)}%`, background: color, transition: 'width 20s linear' }}
          />
        </div>
        {vehicle ? (
          <p className="mt-2.5 text-[11px] text-faint">
            Live position updated {formatAge(vehicle.updatedAt, now)}
            {vehicle.delayReason ? ` · ${vehicle.delayReason}` : ''}
          </p>
        ) : null}
      </div>
    </div>
  );
}

// ---- one station on the line ------------------------------------------------

function StopRow({
  stop,
  index,
  isFirst,
  isLast,
  follower,
  color,
  progress,
  minutes,
}: {
  stop: TripStopTime;
  index: number;
  isFirst: boolean;
  isLast: boolean;
  follower?: TripStopTime;
  color: string;
  progress: number | null;
  minutes: number | null;
}) {
  const passed = stop.status === 'departed';
  const here = stop.status === 'current';
  const next = stop.status === 'next';
  const terminal = isFirst || isLast;
  const clock = formatClock(stop.estimatedDeparture ?? stop.scheduledDeparture);
  const shifted =
    stop.estimatedDeparture &&
    stop.scheduledDeparture &&
    formatClock(stop.estimatedDeparture) !== formatClock(stop.scheduledDeparture);

  // The stretch below this stop is behind the train when this stop is passed
  // and the next one is too; otherwise it is ahead (full colour).
  const legBehind = passed && follower?.status === 'departed';
  const legLive = progress != null;

  return (
    <li className="relative flex gap-3" data-index={index}>
      <div className="relative w-10 shrink-0" aria-hidden>
        {!isLast ? (
          <span
            className="absolute top-[30px] -bottom-[30px] left-1/2 w-1.5 -translate-x-1/2 rounded-full"
            style={{
              background: legBehind || legLive ? 'var(--border-strong)' : color,
            }}
          />
        ) : null}
        {!isLast && legLive ? (
          <>
            <span
              className="absolute top-[30px] left-1/2 w-2 -translate-x-1/2 rounded-full"
              style={{
                background: color,
                height: `calc((100% + 0px) * ${Math.min(1, progress ?? 0)})`,
                bottom: 'auto',
                transition: 'height 20s linear',
              }}
            />
            <span
              className="live-dot absolute left-1/2 z-20 grid size-8 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-xl text-white shadow-md ring-4 ring-[var(--bg-elevated)]"
              style={{
                background: color,
                top: `calc(30px + (100% ) * ${Math.min(1, progress ?? 0)})`,
                transition: 'top 20s linear',
              }}
            >
              <TrainIcon className="size-5" />
            </span>
          </>
        ) : null}

        {here ? (
          <span
            className="live-dot absolute top-[30px] left-1/2 z-20 grid size-10 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-2xl text-white shadow-lg ring-4 ring-[var(--bg-elevated)]"
            style={{ background: color }}
          >
            <TrainIcon className="size-6" />
          </span>
        ) : (
          <span
            className={clsx(
              'absolute top-[30px] left-1/2 z-10 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[var(--bg-elevated)]',
              terminal ? 'size-7 border-[6px]' : next ? 'size-6 border-[5px]' : 'size-5 border-[4px]',
              next && 'shadow-[0_0_0_6px_color-mix(in_srgb,var(--halo)_25%,transparent)]',
            )}
            style={
              {
                borderColor: passed ? 'var(--border-strong)' : color,
                '--halo': color,
              } as React.CSSProperties
            }
          />
        )}
      </div>

      <div className="flex min-w-0 flex-1 items-start justify-between gap-3 py-[16px]">
        <div className="min-w-0">
          <p
            className={clsx(
              'truncate leading-tight',
              here || next || terminal ? 'text-[17px] font-bold' : 'text-[15px] font-medium',
              passed && 'text-[var(--fg-muted)]',
            )}
          >
            {tidy(stop.stopName)}
          </p>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {here ? (
              <span
                className="rounded-full px-2 py-0.5 text-[10px] font-bold tracking-wide text-white uppercase"
                style={{ background: color }}
              >
                Train is here
              </span>
            ) : null}
            {next ? (
              <span
                className="rounded-full border px-2 py-0.5 text-[10px] font-bold tracking-wide uppercase"
                style={{ borderColor: color, color }}
              >
                Next stop{minutes != null ? ` · ${minutes} min` : ''}
              </span>
            ) : null}
            {isFirst && !here ? (
              <span className="rounded-full bg-[var(--bg-sunken)] px-2 py-0.5 text-[10px] font-bold tracking-wide text-muted uppercase">
                Start
              </span>
            ) : null}
            {isLast ? (
              <span className="rounded-full bg-[var(--bg-sunken)] px-2 py-0.5 text-[10px] font-bold tracking-wide text-muted uppercase">
                Final stop
              </span>
            ) : null}
            {stop.platform ? (
              <span className="rounded-full bg-[var(--bg-sunken)] px-2 py-0.5 text-[11px] font-semibold text-muted">
                {stop.platform}
              </span>
            ) : null}
          </div>
        </div>
        <div className="shrink-0 text-right">
          <p
            className={clsx(
              'tabular text-[14px]',
              passed ? 'text-[var(--fg-faint)]' : 'font-semibold',
              shifted && !passed && 'text-[var(--color-warn-500)]',
            )}
          >
            {clock}
          </p>
          {shifted && !passed ? (
            <p className="tabular text-[11px] text-faint line-through">
              {formatClock(stop.scheduledDeparture)}
            </p>
          ) : null}
        </div>
      </div>
    </li>
  );
}
