'use client';

import Link from 'next/link';
import { StationSummaryCard } from '@/components/stations/StationSummaryCard';
import { EmptyState, ModeIcon, Skeleton } from '@/components/ui/primitives';
import { useFavorites } from '@/lib/client/favorites';

export function FavoritesScreen() {
  const { favorites, ready, remove } = useFavorites();

  const stops = favorites.filter((f) => f.kind === 'stop');
  const routes = favorites.filter((f) => f.kind === 'route');
  const trips = favorites.filter((f) => f.kind === 'trip');

  return (
    <div className="mx-auto w-full max-w-2xl px-4 pt-safe">
      <header className="pt-6 pb-4">
        <h1 className="text-[28px] leading-tight font-semibold tracking-tight">Favourites</h1>
        <p className="mt-1 text-[13px] text-muted">Saved on this device. No account needed.</p>
      </header>

      {!ready ? (
        <div className="space-y-2">
          <Skeleton className="h-28 rounded-2xl" />
          <Skeleton className="h-28 rounded-2xl" />
        </div>
      ) : favorites.length === 0 ? (
        <EmptyState
          title="Nothing saved yet"
          body="Star a station, route or trip and it will show up here and on your home screen."
          action={
            <Link
              href="/stations"
              className="mt-2 inline-flex min-h-11 items-center rounded-xl bg-[var(--accent)] px-4 text-sm font-semibold text-[var(--accent-fg)]"
            >
              Browse stations
            </Link>
          }
        />
      ) : null}

      {stops.length ? (
        <section className="mb-6">
          <h2 className="px-1 pb-2 text-[11px] font-semibold tracking-wide text-faint uppercase">
            Stations &amp; stops
          </h2>
          <div className="space-y-2">
            {stops.map((fav) => (
              <StationSummaryCard key={fav.id} stopId={fav.id} name={fav.name} starred />
            ))}
          </div>
        </section>
      ) : null}

      {routes.length ? (
        <section className="mb-6">
          <h2 className="px-1 pb-2 text-[11px] font-semibold tracking-wide text-faint uppercase">
            Routes
          </h2>
          <ul className="space-y-1">
            {routes.map((fav) => (
              <li key={fav.id} className="flex items-center gap-3 rounded-xl px-3 py-3 hairline border">
                <ModeIcon type={fav.vehicleType ?? 'unknown'} className="size-5 text-[var(--fg-muted)]" />
                <span className="min-w-0 flex-1 truncate font-medium">{fav.name}</span>
                <button
                  type="button"
                  onClick={() => remove('route', fav.id)}
                  className="min-h-9 rounded-lg px-2 text-[13px] font-medium text-muted"
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {trips.length ? (
        <section className="mb-6">
          <h2 className="px-1 pb-2 text-[11px] font-semibold tracking-wide text-faint uppercase">
            Trips
          </h2>
          <ul className="space-y-1">
            {trips.map((fav) => (
              <li key={fav.id} className="flex items-center gap-3 rounded-xl border px-3 py-3 hairline">
                <ModeIcon type={fav.vehicleType ?? 'unknown'} className="size-5 text-[var(--fg-muted)]" />
                <Link href={`/trips/${encodeURIComponent(fav.id)}`} className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{fav.name}</span>
                  {fav.subtitle ? (
                    <span className="block truncate text-[13px] text-muted">{fav.subtitle}</span>
                  ) : null}
                </Link>
                <button
                  type="button"
                  onClick={() => remove('trip', fav.id)}
                  className="min-h-9 rounded-lg px-2 text-[13px] font-medium text-muted"
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <div className="h-8" />
    </div>
  );
}
