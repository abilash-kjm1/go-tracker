'use client';

import Link from 'next/link';
import { useState } from 'react';
import { LineDiagram } from './LineDiagram';
import { LiveIndicator } from '@/components/ui/LiveIndicator';
import { ModeIcon, Pill, RouteBadge, Segmented, StarButton } from '@/components/ui/primitives';
import { useFavorites } from '@/lib/client/favorites';
import { useTransit } from '@/lib/client/useTransit';
import type { LiveVehicle, TransitRoute } from '@/lib/transit/types';

interface RoutePattern {
  direction: 0 | 1;
  headsign: string;
  stops: Array<{ id: string; name: string; lat?: number; lon?: number }>;
  tripCount: number;
}

/**
 * A route's own page: what is running on it right now, and every stop it
 * serves in travel order. This is where a search result for a route lands —
 * previously it went to the route list and appeared to do nothing.
 */
export function RouteScreen({
  route,
  patterns,
}: {
  route: TransitRoute;
  patterns: RoutePattern[];
}) {
  const { isFavorite, toggle } = useFavorites();
  const starred = isFavorite('route', route.id);
  const [dir, setDir] = useState(0);

  const { data: vehicles, meta, freshness } = useTransit<LiveVehicle[]>(
    `/api/transit/vehicles/live?routeId=${encodeURIComponent(route.id)}`,
    { intervalMs: 20_000 },
  );

  const live = vehicles ?? [];
  const pattern = patterns[dir] ?? patterns[0];

  return (
    <div className="mx-auto w-full max-w-2xl px-4 pt-safe">
      <div className="flex items-center justify-between gap-2 pt-3">
        <Link
          href="/routes"
          className="-ml-2 flex min-h-10 items-center gap-1 rounded-xl px-2 text-[13px] font-medium text-muted"
        >
          <span aria-hidden>←</span> Routes
        </Link>
        <StarButton
          active={starred}
          label={starred ? `Unfavourite ${route.name}` : `Favourite ${route.name}`}
          onClick={() =>
            toggle({ kind: 'route', id: route.id, name: route.name, vehicleType: route.type })
          }
        />
      </div>

      <header className="pb-4">
        <div className="flex items-center gap-2">
          <RouteBadge code={route.code} color={route.color} type={route.type} />
          <span className="flex items-center gap-1.5 text-sm font-medium text-muted">
            <ModeIcon type={route.type} className="size-4" />
            {route.type === 'train' ? 'GO Train line' : 'GO Bus route'}
          </span>
        </div>
        <h1 className="mt-2 text-[26px] leading-tight font-semibold tracking-tight">{route.name}</h1>
      </header>

      <section className="mb-5">
        <div className="mb-2 flex items-center justify-between gap-2">
          <h2 className="text-[11px] font-semibold tracking-wide text-faint uppercase">
            In service now
          </h2>
          <LiveIndicator freshness={freshness} updatedAt={meta?.updatedAt ?? null} compact />
        </div>

        {live.length === 0 ? (
          <p className="rounded-2xl border border-dashed px-4 py-4 text-center text-[13px] text-muted hairline">
            {route.type === 'bus'
              ? 'No live positions are published for GO buses, so nothing is tracked here.'
              : 'Nothing is reporting a position on this line right now.'}
          </p>
        ) : (
          <ul className="space-y-2">
            {live.map((vehicle) => {
              const delayMin = vehicle.delaySeconds != null ? Math.round(vehicle.delaySeconds / 60) : 0;
              return (
                <li key={vehicle.id}>
                  <Link
                    href={vehicle.tripId ? `/trips/${encodeURIComponent(vehicle.tripId)}` : '/map'}
                    className="flex items-center gap-3 rounded-2xl border px-4 py-3 hairline bg-[var(--bg-elevated)]"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">
                        <span className="font-normal text-faint">to </span>
                        {vehicle.destination ?? 'GO service'}
                      </span>
                      <span className="mt-0.5 block truncate text-[13px] text-muted">
                        {vehicle.nextStopName ? `Next stop ${vehicle.nextStopName}` : 'In service'}
                        {vehicle.tripNumber ? ` · ${vehicle.tripNumber}` : ''}
                      </span>
                    </span>
                    {delayMin >= 1 ? (
                      <Pill tone="warn">+{delayMin} min</Pill>
                    ) : (
                      <Pill tone="ok">On time</Pill>
                    )}
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {pattern ? (
        <section className="pb-8">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-[11px] font-semibold tracking-wide text-faint uppercase">
              The line right now
            </h2>
            {patterns.length > 1 ? (
              <Segmented<string>
                value={String(dir)}
                onChange={(v) => setDir(Number(v))}
                ariaLabel="Direction"
                options={patterns.map((p, index) => ({
                  value: String(index),
                  label: shortHeadsign(p.headsign),
                }))}
              />
            ) : null}
          </div>

          <p className="mb-2 text-[12px] text-faint">
            {pattern.stops.length} stops · {pattern.tripCount} trips today
          </p>

          <LineDiagram
            stops={pattern.stops}
            vehicles={live}
            color={route.color ?? 'var(--accent)'}
            headsign={shortHeadsign(pattern.headsign)}
          />
        </section>
      ) : (
        <p className="pb-8 text-[13px] text-muted">
          No trips are scheduled on this route today, so its stops cannot be listed.
        </p>
      )}
    </div>
  );
}

/** "12B - Burlington GO" is too long for a toggle; the destination is enough. */
function shortHeadsign(headsign: string): string {
  const idx = headsign.indexOf(' - ');
  return idx >= 0 ? headsign.slice(idx + 3) : headsign;
}
