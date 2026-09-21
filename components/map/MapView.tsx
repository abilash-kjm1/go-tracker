'use client';

import dynamic from 'next/dynamic';
import { Skeleton } from '@/components/ui/primitives';
import type { TransitRoute, TransitStop } from '@/lib/transit/types';

/** MapLibre is heavy, so it is only loaded when the map screen is opened. */
const LiveMap = dynamic(() => import('./LiveMap').then((m) => m.LiveMap), {
  ssr: false,
  loading: () => (
    <div className="relative h-[calc(100dvh-4rem)] w-full md:h-dvh">
      <Skeleton className="size-full rounded-none" />
      <div className="absolute inset-x-0 top-0 p-3 pt-safe">
        <Skeleton className="h-11 rounded-2xl" />
      </div>
    </div>
  ),
});

export function MapView({ stops, routes }: { stops: TransitStop[]; routes: TransitRoute[] }) {
  return <LiveMap stops={stops} routes={routes} />;
}
