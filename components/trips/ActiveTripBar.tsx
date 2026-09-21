'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useActiveTrip } from '@/lib/client/activeTrip';
import { useTransit } from '@/lib/client/useTransit';
import type { TripDetail } from '@/lib/transit/types';

/**
 * A bar pinned above the tab bar while a journey is on. It is how a rider finds
 * their train again after wandering off to the map or a station page.
 */
export function ActiveTripBar() {
  const { trip } = useActiveTrip();
  const pathname = usePathname();

  // The trip's own screen already shows all of this.
  const hidden = !trip || pathname.startsWith('/my-trip');
  const leg = trip?.legs[0];

  const { data: detail } = useTransit<TripDetail>(
    !hidden && leg ? `/api/transit/trips/${encodeURIComponent(leg.tripId)}` : null,
    { intervalMs: 30_000, enabled: !hidden },
  );

  if (hidden || !trip || !leg) return null;

  const stops = detail?.stops ?? [];
  const alightIndex = stops.findIndex((s) => s.stopId === leg.alightStopId);
  const nextIndex = stops.findIndex((s) => s.status === 'next' || s.status === 'current');
  const stopsLeft = alightIndex >= 0 && nextIndex >= 0 ? Math.max(0, alightIndex - nextIndex + 1) : null;
  const nextStop = nextIndex >= 0 ? stops[nextIndex].stopName.replace(/\s+GO(\s+Bus)?$/i, '') : null;

  return (
    <div className="above-nav pointer-events-none fixed inset-x-0 z-30 px-3 md:left-60">
      <Link
        href="/my-trip"
        className="pointer-events-auto mx-auto flex max-w-2xl items-center gap-3 rounded-2xl px-4 py-2.5 text-white shadow-[0_14px_30px_-14px_rgb(0_0_0/0.8)]"
        style={{ background: 'linear-gradient(120deg, #04351f 0%, #067a45 100%)' }}
      >
        <span className="live-dot size-2 shrink-0 rounded-full bg-[#7dfab8]" aria-hidden />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-bold">
            {stopsLeft != null
              ? stopsLeft === 0
                ? `Getting off at ${trip.destinationName.replace(/\s+GO$/i, '')}`
                : `${stopsLeft} stop${stopsLeft === 1 ? '' : 's'} to ${trip.destinationName.replace(/\s+GO$/i, '')}`
              : `On your way to ${trip.destinationName.replace(/\s+GO$/i, '')}`}
          </span>
          <span className="block truncate text-[11.5px] text-white/70">
            {nextStop ? `Next stop ${nextStop}` : 'Waiting for a live position'}
          </span>
        </span>
        <span aria-hidden className="shrink-0 text-[13px] font-bold text-[#7dfab8]">
          My trip →
        </span>
      </Link>
    </div>
  );
}
