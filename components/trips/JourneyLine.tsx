'use client';

import clsx from 'clsx';
import { useState } from 'react';
import { progressAlongLeg } from '@/lib/transit/geo';
import { formatClock } from '@/lib/transit/time';
import type { TripDetail, TripStopTime } from '@/lib/transit/types';

/**
 * The journey drawn like a transit-map line diagram: the line in its own colour,
 * stations as rings on it, and a train that travels along the line between them.
 * Above it, a "now" panel says which leg the train is on and when it arrives.
 */
export function JourneyLine({ trip, now }: { trip: TripDetail; now: number }) {
  const color = trip.routeColor ?? '#10b981';
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
          color={color}
          fromName={tidy(from.stopName)}
          toName={tidy(to.stopName)}
          progress={progress ?? 0}
          atStation={hereIdx >= 0}
          minutes={minutes}
          arriveClock={arriveAt ? formatClock(arriveAt) : null}
          stopsLeft={stopsLeft}
        />
      ) : null}

      <div className="overflow-hidden rounded-2xl border hairline bg-[var(--bg-elevated)]">
        <div className="h-1.5" style={{ background: color }} aria-hidden />
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

function NowPanel({
  color,
  fromName,
  toName,
  progress,
  atStation,
  minutes,
  arriveClock,
  stopsLeft,
}: {
  color: string;
  fromName: string;
  toName: string;
  progress: number;
  atStation: boolean;
  minutes: number | null;
  arriveClock: string | null;
  stopsLeft: number;
}) {
  const pct = Math.round(progress * 100);
  return (
    <div
      className="relative overflow-hidden rounded-2xl p-4 text-white shadow-lg"
      style={{ background: `linear-gradient(135deg, ${color}, color-mix(in srgb, ${color} 55%, #000))` }}
    >
      {/* Faint rail motif behind the content. */}
      <div
        aria-hidden
        className="pointer-events-none absolute -right-6 -bottom-8 size-40 rounded-full opacity-15"
        style={{ background: 'radial-gradient(circle, #fff 0, transparent 65%)' }}
      />

      <p className="text-[11px] font-semibold tracking-[0.14em] uppercase opacity-80">
        {atStation ? `At ${fromName}` : 'On the way'}
      </p>

      <div className="mt-1 flex items-end justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[13px] opacity-80">{atStation ? 'Next stop' : 'Arriving at'}</p>
          <p className="truncate text-[26px] leading-none font-bold tracking-tight">{toName}</p>
        </div>
        <div className="shrink-0 text-right">
          {minutes != null ? (
            <p className="tabular text-[34px] leading-none font-bold">
              {minutes}
              <span className="ml-1 text-[13px] font-semibold opacity-85">min</span>
            </p>
          ) : null}
          {arriveClock ? <p className="tabular mt-0.5 text-[12px] opacity-85">{arriveClock}</p> : null}
        </div>
      </div>

      {/* The leg as a track, with the train on it. */}
      <div className="relative mt-5 mb-1">
        <div className="h-1.5 rounded-full bg-white/25" />
        <div
          className="absolute top-0 left-0 h-1.5 rounded-full bg-white"
          style={{ width: `${pct}%`, transition: 'width 20s linear' }}
        />
        <span
          className="absolute top-1/2 left-0 size-3 -translate-x-0 -translate-y-1/2 rounded-full border-2 border-white bg-transparent"
          aria-hidden
        />
        <span
          className="absolute top-1/2 right-0 size-3 -translate-y-1/2 rounded-full bg-white"
          aria-hidden
        />
        <span
          className="absolute top-1/2 z-10 grid size-8 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-xl bg-white shadow-md"
          style={{ left: `${pct}%`, transition: 'left 20s linear', color }}
          role="img"
          aria-label={
            atStation ? `Train is at ${fromName}` : `Train is ${pct}% of the way to ${toName}`
          }
        >
          <TrainIcon className="size-5" />
        </span>
      </div>

      <div className="mt-3 flex items-center justify-between gap-3 text-[12px] opacity-90">
        <span className="min-w-0 truncate">{fromName}</span>
        <span className="shrink-0 rounded-full bg-white/20 px-2.5 py-1 font-semibold">
          {stopsLeft} stop{stopsLeft === 1 ? '' : 's'} to go
        </span>
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
            className="absolute top-[30px] -bottom-[30px] left-1/2 w-2 -translate-x-1/2 rounded-full"
            style={{
              background: color,
              opacity: legBehind ? 0.22 : legLive ? 0.22 : 1,
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
                borderColor: color,
                opacity: passed ? 0.4 : 1,
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
