'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { ModeIcon, RouteBadge, Segmented, StarButton } from '@/components/ui/primitives';
import { useFavorites } from '@/lib/client/favorites';
import { useTransit } from '@/lib/client/useTransit';
import type { LiveVehicle, TransitRoute, VehicleType } from '@/lib/transit/types';

type ModeFilter = 'all' | VehicleType;

export function RoutesScreen({ routes }: { routes: TransitRoute[] }) {
  const [mode, setMode] = useState<ModeFilter>('all');
  const { isFavorite, toggle } = useFavorites();
  const { data: vehicles } = useTransit<LiveVehicle[]>('/api/transit/vehicles/live', {
    intervalMs: 30_000,
  });

  const liveByRoute = useMemo(() => {
    const counts = new Map<string, number>();
    for (const v of vehicles ?? []) {
      if (!v.routeId) continue;
      counts.set(v.routeId, (counts.get(v.routeId) ?? 0) + 1);
    }
    return counts;
  }, [vehicles]);

  const filtered = routes
    .filter((r) => mode === 'all' || r.type === mode)
    .sort((a, b) => {
      const live = (liveByRoute.get(b.id) ?? 0) - (liveByRoute.get(a.id) ?? 0);
      return live !== 0 ? live : a.name.localeCompare(b.name);
    });

  return (
    <div className="mx-auto w-full max-w-2xl px-4 pt-safe">
      <header className="pt-6 pb-3">
        <h1 className="text-[28px] leading-tight font-semibold tracking-tight">Routes</h1>
        <p className="mt-1 text-[13px] text-muted">
          {routes.filter((r) => r.type === 'train').length} train lines ·{' '}
          {routes.filter((r) => r.type === 'bus').length} bus routes
        </p>
      </header>

      <Segmented<ModeFilter>
        value={mode}
        onChange={setMode}
        ariaLabel="Filter routes by type"
        className="mb-4"
        options={[
          { value: 'all', label: 'All' },
          { value: 'train', label: (<span className="flex items-center gap-1.5"><ModeIcon type="train" className="size-4" />Trains</span>) },
          { value: 'bus', label: (<span className="flex items-center gap-1.5"><ModeIcon type="bus" className="size-4" />Buses</span>) },
        ]}
      />

      <ul className="space-y-1 pb-10">
        {filtered.map((route) => {
          const live = liveByRoute.get(route.id) ?? 0;
          const starred = isFavorite('route', route.id);
          return (
            <li key={route.id} className="flex min-h-14 items-center gap-1 rounded-xl pr-1 transition-colors hover:bg-[var(--bg-sunken)]">
              <Link
                href={`/routes/${encodeURIComponent(route.id)}`}
                className="flex min-w-0 flex-1 items-center gap-3 px-3 py-2"
              >
                <RouteBadge code={route.code} color={route.color} type={route.type} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{route.name}</span>
                  <span className="block text-[13px] text-muted">
                    {route.type === 'train' ? 'GO Train' : 'GO Bus'}
                    {live > 0 ? ` · ${live} in service now` : ''}
                  </span>
                </span>
              </Link>
              <StarButton
                active={starred}
                label={starred ? `Unfavourite ${route.name}` : `Favourite ${route.name}`}
                onClick={() =>
                  toggle({
                    kind: 'route',
                    id: route.id,
                    name: route.name,
                    vehicleType: route.type,
                  })
                }
              />
            </li>
          );
        })}
      </ul>
    </div>
  );
}
