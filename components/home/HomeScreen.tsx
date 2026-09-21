'use client';

import Link from 'next/link';
import { useState } from 'react';
import { SearchIcon, SearchOverlay } from '@/components/search/SearchOverlay';
import { StationSummaryCard } from '@/components/stations/StationSummaryCard';
import { LiveIndicator } from '@/components/ui/LiveIndicator';
import { ModeIcon, Skeleton } from '@/components/ui/primitives';
import { useFavorites, useRecentStops } from '@/lib/client/favorites';
import { useNearbyStops } from '@/lib/client/useNearby';
import { useTransit } from '@/lib/client/useTransit';
import { greeting } from '@/lib/transit/time';
import type { LiveVehicle, TransitAlert, TransitStop } from '@/lib/transit/types';

export function HomeScreen({ featured = [] }: { featured?: TransitStop[] }) {
  const [searchOpen, setSearchOpen] = useState(false);
  const { favorites, ready } = useFavorites();
  const recent = useRecentStops();
  const nearby = useNearbyStops();

  const { data: vehicles, meta, freshness } = useTransit<LiveVehicle[]>(
    '/api/transit/vehicles/live',
    { intervalMs: 20_000 },
  );
  const { data: alerts } = useTransit<TransitAlert[]>('/api/transit/alerts', { intervalMs: 60_000 });

  const trains = vehicles?.filter((v) => v.vehicleType === 'train').length ?? 0;
  const buses = vehicles?.filter((v) => v.vehicleType === 'bus').length ?? 0;
  const favoriteStops = favorites.filter((f) => f.kind === 'stop');

  return (
    <div className="mx-auto w-full max-w-2xl px-4 pt-safe">
      <header className="pt-6 pb-4">
        <p className="text-[13px] font-medium text-muted">{greeting()}</p>
        <h1 className="mt-0.5 text-[28px] leading-tight font-semibold tracking-tight">
          Where are you going?
        </h1>
      </header>

      <button
        type="button"
        onClick={() => setSearchOpen(true)}
        className="flex min-h-13 w-full items-center gap-3 rounded-2xl border px-4 py-3.5 text-left text-[15px] text-muted transition-colors hairline bg-[var(--bg-elevated)] hover:bg-[var(--bg-sunken)]"
      >
        <SearchIcon className="size-5 text-[var(--fg-faint)]" />
        Search stations, routes or trips
      </button>

      <Link
        href="/plan"
        className="mt-2 flex min-h-12 items-center justify-center gap-2 rounded-2xl border px-4 text-[14px] font-semibold hairline bg-[var(--bg-elevated)] hover:bg-[var(--bg-sunken)]"
      >
        Plan a trip from A to B
      </Link>

      <Link
        href="/map"
        className="mt-3 flex items-center gap-4 rounded-2xl border px-4 py-3.5 transition-colors hairline bg-[var(--bg-elevated)] hover:bg-[var(--bg-sunken)]"
      >
        <div className="flex-1">
          <LiveIndicator freshness={freshness} updatedAt={meta?.updatedAt ?? null} />
          <p className="mt-1.5 text-[22px] leading-none font-semibold tracking-tight">
            {vehicles ? `${vehicles.length} vehicle${vehicles.length === 1 ? '' : 's'}` : <Skeleton className="h-6 w-24" />}
          </p>
          {vehicles ? (
            <p className="mt-1.5 flex items-center gap-3 text-[13px] text-muted">
              <span className="flex items-center gap-1">
                <ModeIcon type="train" className="size-4" /> {trains}
              </span>
              <span className="flex items-center gap-1">
                <ModeIcon type="bus" className="size-4" /> {buses}
              </span>
            </p>
          ) : null}
        </div>
        <span className="text-sm font-medium text-[var(--accent)]">Open map →</span>
      </Link>

      {alerts && alerts.length > 0 ? (
        <Link
          href="/alerts"
          className="mt-3 flex items-center gap-3 rounded-2xl bg-warn-500/12 px-4 py-3 text-[13px] font-medium text-warn-500"
        >
          <span aria-hidden>⚠</span>
          {alerts.length === 1
            ? alerts[0].title + ' — ' + alerts[0].body
            : `${alerts.length} services are reporting delays`}
        </Link>
      ) : null}

      {ready && favoriteStops.length > 0 ? (
        <Section title="Favourites">
          {favoriteStops.map((fav) => (
            <StationSummaryCard key={fav.id} stopId={fav.id} name={fav.name} starred />
          ))}
        </Section>
      ) : null}

      {nearby.status === 'granted' && nearby.stops.length > 0 ? (
        <Section title="Nearby">
          {nearby.stops.slice(0, 3).map((stop) => (
            <StationSummaryCard
              key={stop.id}
              stopId={stop.id}
              name={stop.name}
              distanceKm={stop.distanceKm}
            />
          ))}
        </Section>
      ) : null}

      {nearby.status === 'idle' && favoriteStops.length === 0 ? (
        <button
          type="button"
          onClick={nearby.request}
          className="mt-4 flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl border px-4 text-sm font-semibold hairline"
        >
          Use my location to sort by distance
        </button>
      ) : null}

      {nearby.status === 'denied' ? (
        <p className="mt-4 rounded-xl bg-[var(--bg-sunken)] px-3 py-2 text-[13px] text-muted">
          Location is blocked, so nearby stops are unavailable.{' '}
          <Link href="/stations" className="font-medium text-[var(--accent)]">
            Browse stations instead
          </Link>
          .
        </p>
      ) : null}

      {ready && favoriteStops.length === 0 && recent.length > 0 ? (
        <Section title="Recently viewed">
          {recent.slice(0, 3).map((stop) => (
            <StationSummaryCard key={stop.id} stopId={stop.id} name={stop.name} />
          ))}
        </Section>
      ) : null}

      {ready && favoriteStops.length === 0 && nearby.stops.length === 0 && featured.length > 0 ? (
        <Section title="Busiest today">
          {featured.slice(0, 3).map((stop) => (
            <StationSummaryCard key={stop.id} stopId={stop.id} name={stop.name} />
          ))}
          <Link
            href="/stations"
            className="flex min-h-12 items-center justify-center rounded-2xl border px-4 text-sm font-semibold hairline"
          >
            Browse all stations &amp; stops
          </Link>
        </Section>
      ) : null}

      <p className="mt-8 pb-4 text-center text-[11px] leading-relaxed text-faint">
        Independent app. Not operated by or affiliated with Metrolinx or GO Transit.
      </p>

      <SearchOverlay open={searchOpen} onClose={() => setSearchOpen(false)} />
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-6">
      <h2 className="px-1 pb-2 text-[11px] font-semibold tracking-wide text-faint uppercase">
        {title}
      </h2>
      <div className="space-y-2">{children}</div>
    </section>
  );
}
