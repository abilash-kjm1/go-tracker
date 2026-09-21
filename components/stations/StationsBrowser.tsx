'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { SearchIcon } from '@/components/search/SearchOverlay';
import { ModeIcon, Segmented } from '@/components/ui/primitives';
import { formatDistance } from '@/lib/transit/geo';
import { useNearby } from '@/lib/client/useNearby';
import type { TransitRoute, TransitStop, VehicleType } from '@/lib/transit/types';

type ModeFilter = 'all' | VehicleType;

/**
 * The full stop directory — 800+ entries, so it filters client-side and
 * renders a bounded slice rather than the whole list at once.
 */
export function StationsBrowser({
  stops,
  routes = [],
}: {
  stops: TransitStop[];
  routes?: TransitRoute[];
}) {
  const [query, setQuery] = useState('');
  // Buses outnumber trains here; defaulting to one mode hides most of the network.
  const [mode, setMode] = useState<ModeFilter>('all');
  const nearby = useNearby(6);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return stops
      .filter((s) => (mode === 'all' ? true : s.modes.includes(mode)))
      .filter((s) => (q ? s.name.toLowerCase().includes(q) || s.id.toLowerCase() === q : true));
  }, [stops, query, mode]);

  const nearestById = useMemo(
    () => new Map(nearby.stops.map((s) => [s.id, s.distanceKm])),
    [nearby.stops],
  );

  const routeLookup = useMemo(() => new Map(routes.map((r) => [r.id, r.code])), [routes]);

  // Terminals expose one stop per bay, all sharing a name. Without a hint the
  // list shows four identical rows and the rider cannot tell them apart.
  const duplicateNames = useMemo(() => {
    const counts = new Map<string, number>();
    for (const s of stops) counts.set(s.name, (counts.get(s.name) ?? 0) + 1);
    return new Set([...counts].filter(([, n]) => n > 1).map(([name]) => name));
  }, [stops]);

  return (
    <div className="mx-auto w-full max-w-2xl px-4 pt-safe">
      <header className="pt-6 pb-3">
        <h1 className="text-[28px] leading-tight font-semibold tracking-tight">Stations &amp; stops</h1>
        <p className="mt-1 text-[13px] text-muted">
          {stops.length} GO stations and bus stops in the schedule.
        </p>
      </header>

      <div className="sticky top-0 z-10 -mx-4 space-y-3 bg-[var(--bg)]/95 px-4 pt-2 pb-3 backdrop-blur">
        <label className="flex min-h-12 items-center gap-2 rounded-2xl border px-3 hairline bg-[var(--bg-elevated)]">
          <SearchIcon className="size-5 text-[var(--fg-faint)]" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter by name"
            aria-label="Filter stations"
            className="min-w-0 flex-1 bg-transparent text-[16px] outline-none placeholder:text-[var(--fg-faint)]"
          />
        </label>

        <Segmented<ModeFilter>
          value={mode}
          onChange={setMode}
          ariaLabel="Filter by vehicle type"
          options={[
            { value: 'all', label: 'All' },
            { value: 'train', label: (<span className="flex items-center gap-1.5"><ModeIcon type="train" className="size-4" />Trains</span>) },
            { value: 'bus', label: (<span className="flex items-center gap-1.5"><ModeIcon type="bus" className="size-4" />Buses</span>) },
          ]}
        />
      </div>

      {nearby.status === 'granted' && nearby.stops.length > 0 && !query ? (
        <section className="mb-5">
          <h2 className="px-1 pb-2 text-[11px] font-semibold tracking-wide text-faint uppercase">
            Nearby
          </h2>
          <ul className="space-y-1">
            {nearby.stops.slice(0, 4).map((stop) => (
              <StopRow
                key={stop.id}
                stop={stop}
                distanceKm={stop.distanceKm}
                routeHint={duplicateNames.has(stop.name)}
                routeLookup={routeLookup}
              />
            ))}
          </ul>
        </section>
      ) : null}

      {nearby.status === 'idle' ? (
        <button
          type="button"
          onClick={nearby.request}
          className="mb-4 w-full rounded-xl border px-3 py-2.5 text-sm font-medium hairline"
        >
          Sort by distance from me
        </button>
      ) : null}

      <ul className="space-y-1 pb-6">
        {filtered.slice(0, 250).map((stop) => (
          <StopRow
            key={stop.id}
            stop={stop}
            distanceKm={nearestById.get(stop.id)}
            routeHint={duplicateNames.has(stop.name)}
            routeLookup={routeLookup}
          />
        ))}
      </ul>

      {filtered.length > 250 ? (
        <p className="pb-8 text-center text-[13px] text-muted">
          Showing the first 250 of {filtered.length}. Keep typing to narrow it down.
        </p>
      ) : null}

      {filtered.length === 0 ? (
        <p className="py-10 text-center text-sm text-muted">No stops match that filter.</p>
      ) : null}
    </div>
  );
}

function StopRow({
  stop,
  distanceKm,
  routeHint = false,
  routeLookup,
}: {
  stop: TransitStop;
  distanceKm?: number;
  routeHint?: boolean;
  routeLookup?: Map<string, string>;
}) {
  const routes = routeHint
    ? stop.routeIds
        .map((id) => routeLookup?.get(id))
        .filter(Boolean)
        .slice(0, 4)
        .join(', ')
    : '';

  return (
    <li>
      <Link
        href={`/stations/${encodeURIComponent(stop.id)}`}
        className="flex min-h-14 items-center gap-3 rounded-xl px-3 transition-colors hover:bg-[var(--bg-sunken)]"
      >
        <span className="flex gap-1 text-[var(--fg-muted)]">
          {stop.modes.length ? (
            stop.modes.map((m) => <ModeIcon key={m} type={m} className="size-5" />)
          ) : (
            <ModeIcon type="unknown" className="size-5" />
          )}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate font-medium">{stop.name}</span>
          <span className="block truncate text-[13px] text-muted">
            {routes
              ? `Routes ${routes}`
              : stop.modes.length
                ? stop.modes.map((m) => (m === 'train' ? 'Train' : 'Bus')).join(' · ')
                : 'No scheduled service in this window'}
          </span>
        </span>
        {distanceKm != null ? (
          <span className="tabular text-xs text-faint">{formatDistance(distanceKm)}</span>
        ) : null}
      </Link>
    </li>
  );
}
