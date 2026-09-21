'use client';

import Link from 'next/link';
import { useMemo } from 'react';
import { progressAlongLeg } from '@/lib/transit/geo';
import type { LiveVehicle } from '@/lib/transit/types';

const ROW = 46;
const tidy = (name: string) => name.replace(/\s+GO(\s+Bus)?$/i, '');

export interface PatternStop {
  id: string;
  name: string;
  lat?: number;
  lon?: number;
}

/**
 * The whole line at once: every stop in travel order, with each train that is
 * running placed where it actually is between two stops.
 *
 * A vehicle is put on this direction only when its destination lies ahead of
 * its next stop in this pattern, which is what tells the two directions apart.
 */
export function LineDiagram({
  stops,
  vehicles,
  color,
}: {
  stops: PatternStop[];
  vehicles: LiveVehicle[];
  color: string;
}) {
  const placed = useMemo(() => {
    const indexById = new Map(stops.map((s, i) => [s.id, i]));

    return vehicles.flatMap((vehicle) => {
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
      const y = nextIndex === 0 ? 0 : (nextIndex - 1 + progress) * ROW;
      return [{ vehicle, y }];
    });
  }, [stops, vehicles]);

  // Two trains close together would sit on top of each other, so step them
  // sideways instead of moving them, which would misreport where they are.
  const laid = useMemo(() => {
    const laneEnds: number[] = [];
    return [...placed]
      .sort((a, b) => a.y - b.y)
      .map((entry) => {
        let lane = laneEnds.findIndex((end) => entry.y - end > 30);
        if (lane < 0) lane = laneEnds.length;
        laneEnds[lane] = entry.y;
        return { ...entry, lane: Math.min(lane, 2) };
      });
  }, [placed]);

  return (
    <div className="relative overflow-hidden rounded-2xl border hairline bg-[var(--bg-elevated)]">
      <ol className="relative py-2">
        {stops.map((stop, index) => (
          <li key={`${stop.id}-${index}`} className="relative">
            <Link
              href={`/stations/${encodeURIComponent(stop.id)}`}
              className="flex items-center gap-3 px-4 hover:bg-[var(--bg-sunken)]"
              style={{ height: ROW }}
            >
              <span className="relative w-4 shrink-0" aria-hidden>
                {index < stops.length - 1 ? (
                  <span
                    className="absolute top-1/2 left-1/2 w-[3px] -translate-x-1/2"
                    style={{ height: ROW, background: color }}
                  />
                ) : null}
                <span
                  className="absolute top-1/2 left-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-[3px] bg-[var(--bg-elevated)]"
                  style={{ borderColor: color }}
                />
              </span>
              <span className="min-w-0 flex-1 truncate text-[14px]">{tidy(stop.name)}</span>
            </Link>
          </li>
        ))}

        {/* Trains, floating on the line between their stops. */}
        {laid.map(({ vehicle, y, lane }) => {
          const delayMin = vehicle.delaySeconds != null ? Math.round(vehicle.delaySeconds / 60) : 0;
          const late = delayMin >= 2;
          return (
            <Link
              key={vehicle.id}
              href={vehicle.tripId ? `/trips/${encodeURIComponent(vehicle.tripId)}` : '/map'}
              className="absolute flex items-center gap-2 rounded-full py-1 pr-2.5 pl-1 text-[11px] font-bold shadow-md ring-2 ring-[var(--bg-elevated)]"
              style={{
                top: y + ROW / 2 + 8,
                right: 12 + lane * 82,
                transform: 'translateY(-50%)',
                background: color,
                color: '#fff',
                transition: 'top 20s linear',
              }}
              aria-label={`Train ${vehicle.tripNumber ?? ''} to ${vehicle.destination ?? ''}${late ? `, ${delayMin} minutes late` : ', on time'}`}
            >
              <span className="grid size-5 place-items-center rounded-full bg-white/25">
                <TrainGlyph />
              </span>
              <span className="tabular">{vehicle.tripNumber ?? '•'}</span>
              {late ? (
                <span className="rounded-full bg-black/25 px-1.5 py-0.5">+{delayMin}</span>
              ) : null}
            </Link>
          );
        })}
      </ol>

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
      <rect x="5" y="3" width="10" height="10" rx="3" stroke="currentColor" strokeWidth="1.8" />
      <path d="M5 8.5h10" stroke="currentColor" strokeWidth="1.8" />
      <path d="M7 16l1.4-2.6M13 16l-1.4-2.6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}
