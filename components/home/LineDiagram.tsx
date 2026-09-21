'use client';

import Link from 'next/link';
import { Fragment, useMemo } from 'react';
import { progressAlongLeg } from '@/lib/transit/geo';
import type { LiveVehicle } from '@/lib/transit/types';

/** Distance from the card's left edge to the centre of the rail. */
const RAIL_X = 27;
const tidy = (name: string) => name.replace(/\s+GO(\s+Bus)?$/i, '');

export interface PatternStop {
  id: string;
  name: string;
  lat?: number;
  lon?: number;
}

/**
 * The whole line at once. Stops and the trains between them share one column,
 * so a train appears in the gap it is actually in and every row lines up. The
 * rail runs behind all of it.
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
  /** Trains keyed by the stop they are heading for. */
  const byNextStop = useMemo(() => {
    const indexById = new Map(stops.map((s, i) => [s.id, i]));
    const map = new Map<number, Array<{ vehicle: LiveVehicle; progress: number }>>();

    for (const vehicle of vehicles) {
      const nextIndex = vehicle.nextStopId != null ? indexById.get(vehicle.nextStopId) : undefined;
      if (nextIndex == null) continue;

      // Only this direction: where the train is heading must come later here.
      const destination = tidy(vehicle.destination ?? '').toLowerCase();
      const destIndex = stops.findIndex((s) => tidy(s.name).toLowerCase() === destination);
      if (destIndex >= 0 && destIndex < nextIndex) continue;

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

      const list = map.get(nextIndex) ?? [];
      list.push({ vehicle, progress });
      map.set(nextIndex, list);
    }

    // Closest to the next stop sits nearest it.
    for (const list of map.values()) list.sort((a, b) => a.progress - b.progress);
    return map;
  }, [stops, vehicles]);

  const running = [...byNextStop.values()].reduce((sum, list) => sum + list.length, 0);

  return (
    <div className="overflow-hidden rounded-2xl border hairline bg-[var(--bg-elevated)]">
      <div
        className="flex items-center justify-between gap-3 px-4 py-3"
        style={{ background: `color-mix(in srgb, ${color} 10%, transparent)` }}
      >
        <p className="flex min-w-0 items-center gap-2 text-[13px] font-bold">
          <span aria-hidden style={{ color }}>
            ↓
          </span>
          <span className="truncate">towards {tidy(headsign ?? stops.at(-1)?.name ?? '')}</span>
        </p>
        <p className="tabular shrink-0 text-[12px] font-semibold" style={{ color }}>
          {running} running
        </p>
      </div>

      <div className="relative py-1">
        {/* One rail behind every row. */}
        <span
          aria-hidden
          className="absolute top-6 bottom-6 w-[4px] rounded-full"
          style={{ left: RAIL_X - 2, background: color, opacity: 0.85 }}
        />

        <ol>
          {stops.map((stop, index) => {
            const terminus = index === 0 || index === stops.length - 1;
            return (
              <Fragment key={`${stop.id}-${index}`}>
                {/* Trains heading for this stop appear just above it. */}
                {(byNextStop.get(index) ?? []).map(({ vehicle }) => (
                  <li key={vehicle.id}>
                    <TrainRow vehicle={vehicle} color={color} nextStopName={stop.name} />
                  </li>
                ))}

                <li>
                  <Link
                    href={`/stations/${encodeURIComponent(stop.id)}`}
                    className="relative flex h-11 items-center transition-colors hover:bg-[var(--bg-sunken)]"
                    style={{ paddingLeft: RAIL_X + 20 }}
                  >
                    <span
                      aria-hidden
                      className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[var(--bg-elevated)]"
                      style={{
                        left: RAIL_X,
                        width: terminus ? 15 : 11,
                        height: terminus ? 15 : 11,
                        border: `${terminus ? 5 : 3.5}px solid ${color}`,
                      }}
                    />
                    <span
                      className={`min-w-0 flex-1 truncate ${terminus ? 'text-[15.5px] font-bold' : 'text-[14.5px] font-medium'}`}
                    >
                      {tidy(stop.name)}
                    </span>
                  </Link>
                </li>
              </Fragment>
            );
          })}
        </ol>
      </div>

      {running === 0 ? (
        <p className="border-t px-4 py-3 text-center text-[12.5px] text-muted hairline">
          No trains are reporting a position in this direction right now.
        </p>
      ) : null}
    </div>
  );
}

/** A train, in the gap between the stop it has left and the one it is nearing. */
function TrainRow({
  vehicle,
  color,
  nextStopName,
}: {
  vehicle: LiveVehicle;
  color: string;
  nextStopName: string;
}) {
  const delayMin = vehicle.delaySeconds != null ? Math.round(vehicle.delaySeconds / 60) : 0;
  const late = delayMin >= 2;
  const tone = late ? 'var(--color-warn-500)' : color;
  const stopped = vehicle.isMoving === false;

  return (
    <Link
      href={vehicle.tripId ? `/trips/${encodeURIComponent(vehicle.tripId)}` : '/map'}
      className="relative my-1 flex items-center gap-2.5 rounded-xl py-2 pr-3 pl-3"
      style={{
        marginLeft: RAIL_X + 12,
        marginRight: 12,
        background: `color-mix(in srgb, ${tone} 13%, transparent)`,
        boxShadow: `inset 3px 0 0 ${tone}`,
      }}
    >
      <span
        className="grid size-6 shrink-0 place-items-center rounded-full text-white shadow-sm"
        style={{ background: tone }}
      >
        <TrainGlyph />
      </span>

      <span className="min-w-0 flex-1">
        <span className="tabular block text-[13px] leading-tight font-bold">
          {vehicle.tripNumber ?? 'Train'}
        </span>
        <span className="block truncate text-[11.5px] text-muted">
          {stopped ? 'at' : 'approaching'} {tidy(nextStopName)}
        </span>
      </span>

      <span
        className="tabular shrink-0 rounded-full px-2 py-0.5 text-[11px] font-bold"
        style={{ background: tone, color: '#fff' }}
      >
        {late ? `+${delayMin}` : 'on time'}
      </span>
    </Link>
  );
}

function TrainGlyph() {
  return (
    <svg viewBox="0 0 20 20" className="size-3.5" fill="none" aria-hidden>
      <rect x="5" y="3" width="10" height="10" rx="3" stroke="currentColor" strokeWidth="2" />
      <path d="M5 8.5h10" stroke="currentColor" strokeWidth="2" />
      <path d="M7 16l1.4-2.6M13 16l-1.4-2.6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}
