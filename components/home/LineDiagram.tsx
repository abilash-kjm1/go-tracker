'use client';

import Link from 'next/link';
import { useMemo } from 'react';
import { progressAlongLeg } from '@/lib/transit/geo';
import type { LiveVehicle } from '@/lib/transit/types';

const ROW = 48;
/** Distance from the card's left edge to the centre of the rail. */
const RAIL_X = 86;
const tidy = (name: string) => name.replace(/\s+GO(\s+Bus)?$/i, '');

export interface PatternStop {
  id: string;
  name: string;
  lat?: number;
  lon?: number;
}

/**
 * The whole line at once. Stations are named to the right of the rail and the
 * trains ride on the rail itself, labelled to its left, so a train never covers
 * a station name and its position on the line is the position you read.
 */
export function LineDiagram({
  stops,
  vehicles,
  color,
  headsign,
}: {
  stops: PatternStop[];
  vehicles: LiveVehicle[];
  color: string;
  headsign?: string;
}) {
  const placed = useMemo(() => {
    const indexById = new Map(stops.map((s, i) => [s.id, i]));

    const found = vehicles.flatMap((vehicle) => {
      const nextIndex = vehicle.nextStopId != null ? indexById.get(vehicle.nextStopId) : undefined;
      if (nextIndex == null) return [];

      // Only this direction: where the train is heading must come later here.
      const destination = tidy(vehicle.destination ?? '').toLowerCase();
      const destIndex = stops.findIndex((s) => tidy(s.name).toLowerCase() === destination);
      if (destIndex >= 0 && destIndex < nextIndex) return [];

      const previous = stops[nextIndex - 1];
      const next = stops[nextIndex];
      let progress = 0.5;
      if (
        previous?.lat != null &&
        previous?.lon != null &&
        next?.lat != null &&
        next?.lon != null &&
        Number.isFinite(vehicle.latitude) &&
        Number.isFinite(vehicle.longitude)
      ) {
        progress = progressAlongLeg(
          vehicle.latitude,
          vehicle.longitude,
          { lat: previous.lat, lon: previous.lon },
          { lat: next.lat, lon: next.lon },
        );
      }

      // Standing at the first stop of the run has no leg behind it.
      const y = (nextIndex === 0 ? 0 : nextIndex - 1 + progress) * ROW + ROW / 2;
      return [{ vehicle, y }];
    });

    // Two trains close together would sit on top of each other, so step them
    // outwards instead of moving them, which would misreport where they are.
    const laneEnds: number[] = [];
    return found
      .sort((a, b) => a.y - b.y)
      .map((entry) => {
        let lane = laneEnds.findIndex((end) => entry.y - end > 34);
        if (lane < 0) lane = laneEnds.length;
        laneEnds[lane] = entry.y;
        return { ...entry, lane: Math.min(lane, 2) };
      });
  }, [stops, vehicles]);

  const height = stops.length * ROW;

  return (
    <div className="overflow-hidden rounded-2xl border hairline bg-[var(--bg-elevated)]">
      <div
        className="flex items-center justify-between gap-3 border-b px-4 py-2.5 hairline"
        style={{ background: `color-mix(in srgb, ${color} 8%, transparent)` }}
      >
        <p className="flex min-w-0 items-center gap-2 text-[12px] font-bold">
          <span aria-hidden style={{ color }}>
            ↓
          </span>
          <span className="truncate">towards {tidy(headsign ?? stops.at(-1)?.name ?? '')}</span>
        </p>
        <p className="tabular shrink-0 text-[11.5px] font-semibold text-muted">
          {placed.length} running
        </p>
      </div>

      <div className="relative" style={{ height }}>
        {/* One continuous rail behind everything. */}
        <span
          aria-hidden
          className="absolute w-[5px] rounded-full"
          style={{
            left: RAIL_X - 2.5,
            top: ROW / 2,
            height: height - ROW,
            background: `linear-gradient(180deg, color-mix(in srgb, ${color} 55%, transparent), ${color} 12%, ${color} 88%, color-mix(in srgb, ${color} 55%, transparent))`,
          }}
        />

        <ol>
          {stops.map((stop, index) => {
            const major = index === 0 || index === stops.length - 1;
            return (
              <li key={`${stop.id}-${index}`}>
                <Link
                  href={`/stations/${encodeURIComponent(stop.id)}`}
                  className="group relative flex items-center transition-colors hover:bg-[var(--bg-sunken)]"
                  style={{ height: ROW, paddingLeft: RAIL_X + 18 }}
                >
                  <span
                    aria-hidden
                    className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[var(--bg-elevated)]"
                    style={{
                      left: RAIL_X,
                      width: major ? 15 : 11,
                      height: major ? 15 : 11,
                      border: `${major ? 4.5 : 3.5}px solid ${color}`,
                    }}
                  />
                  <span
                    className={`min-w-0 flex-1 truncate ${major ? 'text-[15px] font-bold' : 'text-[14px] font-medium'}`}
                  >
                    {tidy(stop.name)}
                  </span>
                </Link>
              </li>
            );
          })}
        </ol>

        {/* Trains, riding the rail itself. */}
        {placed.map(({ vehicle, y, lane }) => {
          const delayMin = vehicle.delaySeconds != null ? Math.round(vehicle.delaySeconds / 60) : 0;
          const late = delayMin >= 2;
          const moving = vehicle.isMoving !== false;
          return (
            <Link
              key={vehicle.id}
              href={vehicle.tripId ? `/trips/${encodeURIComponent(vehicle.tripId)}` : '/map'}
              className="absolute left-0 flex items-center justify-end gap-2 pr-2"
              style={{
                top: y,
                width: RAIL_X + 9,
                transform: 'translateY(-50%)',
                transition: 'top 20s linear',
              }}
              aria-label={`Train ${vehicle.tripNumber ?? ''} to ${tidy(vehicle.destination ?? '')}${late ? `, ${delayMin} minutes late` : ', on time'}`}
            >
              {/* Every train here shares the heading in the card's header, so the
                  label only needs the trip number and how late it is. */}
              <span className="flex items-center gap-1.5 rounded-lg px-2 py-1 text-[11.5px] font-bold shadow-sm ring-1 ring-black/5 bg-[var(--bg-elevated)]">
                <span className="tabular" style={{ color }}>
                  {vehicle.tripNumber ?? '•'}
                </span>
                {late ? (
                  <span className="tabular text-[10.5px] font-extrabold text-[var(--color-warn-500)]">
                    +{delayMin}
                  </span>
                ) : null}
              </span>

              {/* The token sits exactly on the rail. */}
              <span
                className="grid size-[22px] shrink-0 place-items-center rounded-full text-white shadow-md ring-[3px] ring-[var(--bg-elevated)]"
                style={{ background: late ? 'var(--color-warn-500)' : color }}
              >
                <TrainGlyph />
              </span>
              {moving ? (
                <span
                  aria-hidden
                  className="live-dot absolute size-[22px] rounded-full"
                  style={{ right: 8, background: late ? 'var(--color-warn-500)' : color, opacity: 0.35 }}
                />
              ) : null}
            </Link>
          );
        })}
      </div>

      {placed.length === 0 ? (
        <p className="border-t px-4 py-3 text-center text-[12.5px] text-muted hairline">
          No trains are reporting a position in this direction right now.
        </p>
      ) : null}
    </div>
  );
}

function TrainGlyph() {
  return (
    <svg viewBox="0 0 20 20" className="size-3" fill="none" aria-hidden>
      <rect x="5" y="3" width="10" height="10" rx="3" stroke="currentColor" strokeWidth="2" />
      <path d="M5 8.5h10" stroke="currentColor" strokeWidth="2" />
      <path d="M7 16l1.4-2.6M13 16l-1.4-2.6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}
