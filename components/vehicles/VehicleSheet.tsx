'use client';

import Link from 'next/link';
import { Sheet } from '@/components/ui/Sheet';
import { ModeIcon, Pill } from '@/components/ui/primitives';
import { formatAge } from '@/lib/transit/time';
import { useTicker } from '@/lib/client/useTransit';
import type { LiveVehicle } from '@/lib/transit/types';

/** Vehicle detail. Every field is omitted when the upstream doesn't report it. */
export function VehicleSheet({
  vehicle,
  onClose,
}: {
  vehicle: LiveVehicle | null;
  onClose: () => void;
}) {
  const now = useTicker(5_000);
  if (!vehicle) return null;

  const delayMin = vehicle.delaySeconds != null ? Math.round(vehicle.delaySeconds / 60) : null;
  const late = delayMin != null && delayMin >= 1;

  return (
    <Sheet open={Boolean(vehicle)} onClose={onClose} title="Vehicle detail">
      <div className="space-y-5 px-5 pt-2 pb-24 sm:pb-6">
        <header className="space-y-2">
          <div className="flex items-center gap-2 text-sm font-medium text-muted">
            <ModeIcon type={vehicle.vehicleType} className="size-5" />
            {vehicle.vehicleType === 'bus' ? 'GO Bus' : vehicle.vehicleType === 'train' ? 'GO Train' : 'GO service'}
          </div>
          <h2 className="text-2xl font-semibold tracking-tight">
            {vehicle.routeName ?? vehicle.serviceName ?? 'GO service'}
          </h2>
          {vehicle.origin || vehicle.destination ? (
            <p className="text-[15px] text-muted">
              {[vehicle.origin, vehicle.destination].filter(Boolean).join(' → ')}
            </p>
          ) : null}
        </header>

        <div className="flex flex-wrap items-center gap-2">
          {late ? <Pill tone="warn">+{delayMin} min</Pill> : <Pill tone="ok">On time</Pill>}
          {vehicle.tripNumber ? <Pill tone="neutral">Trip {vehicle.tripNumber}</Pill> : null}
          {vehicle.isMoving != null ? (
            <Pill tone="neutral">{vehicle.isMoving ? 'Moving' : 'Stopped'}</Pill>
          ) : null}
        </div>

        {vehicle.delayReason ? (
          <p className="rounded-xl bg-warn-500/10 px-3 py-2 text-[13px] text-warn-500">
            {vehicle.delayReason}
          </p>
        ) : null}

        <dl className="grid grid-cols-2 gap-x-4 gap-y-4 text-sm">
          {vehicle.nextStopName ? (
            <div className="col-span-2">
              <dt className="text-[11px] font-semibold tracking-wide text-faint uppercase">Next stop</dt>
              <dd className="mt-0.5 text-[15px] font-medium">{vehicle.nextStopName}</dd>
            </div>
          ) : null}
          {vehicle.detail ? (
            <div className="col-span-2">
              <dt className="text-[11px] font-semibold tracking-wide text-faint uppercase">Status</dt>
              <dd className="mt-0.5">{vehicle.detail}</dd>
            </div>
          ) : null}
          {vehicle.vehicleLabel ? (
            <div>
              <dt className="text-[11px] font-semibold tracking-wide text-faint uppercase">Vehicle</dt>
              <dd className="mt-0.5 tabular">{vehicle.vehicleLabel}</dd>
            </div>
          ) : null}
          <div>
            <dt className="text-[11px] font-semibold tracking-wide text-faint uppercase">Updated</dt>
            <dd className="mt-0.5">{formatAge(vehicle.updatedAt, now)}</dd>
          </div>
        </dl>

        {vehicle.tripId ? (
          <Link
            href={`/trips/${encodeURIComponent(vehicle.tripId)}`}
            className="flex min-h-12 items-center justify-center rounded-2xl bg-[var(--accent)] px-4 font-semibold text-[var(--accent-fg)]"
          >
            See full trip details
          </Link>
        ) : null}
      </div>
    </Sheet>
  );
}
