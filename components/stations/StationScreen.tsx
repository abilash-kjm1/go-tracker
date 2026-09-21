'use client';

import Link from 'next/link';
import { useEffect } from 'react';
import { DepartureBoard } from '@/components/departures/DepartureBoard';
import { ModeIcon, StarButton } from '@/components/ui/primitives';
import { pushRecentStop, useFavorites } from '@/lib/client/favorites';
import type { TransitStop } from '@/lib/transit/types';

/**
 * A station page should be departures. Everything else — where the site is on
 * a map, which co-located stops are folded in, how to favourite it — is one
 * line of chrome, so the first departure is visible without scrolling.
 */
export function StationScreen({
  stop,
  related = [],
}: {
  stop: TransitStop;
  /** Co-located stops whose departures are folded into this board. */
  related?: TransitStop[];
}) {
  const { isFavorite, toggle } = useFavorites();
  const starred = isFavorite('stop', stop.id);

  useEffect(() => {
    pushRecentStop({ id: stop.id, name: stop.name });
  }, [stop.id, stop.name]);

  const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${stop.lat},${stop.lon}`;

  return (
    <div className="mx-auto w-full max-w-4xl px-4 pt-safe">
      <div className="flex items-center justify-between gap-2 pt-3">
        <Link
          href="/stations"
          className="-ml-2 flex min-h-10 items-center gap-1 rounded-xl px-2 text-[13px] font-medium text-muted"
        >
          <span aria-hidden>←</span> Stations
        </Link>

        <div className="flex items-center gap-0.5">
          <a
            href={mapsUrl}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`Open ${stop.name} in Maps`}
            className="grid size-10 place-items-center rounded-full text-[var(--fg-muted)]"
          >
            <svg viewBox="0 0 24 24" className="size-5" fill="none" aria-hidden>
              <path
                d="M12 21s7-6.2 7-11a7 7 0 1 0-14 0c0 4.8 7 11 7 11Z"
                stroke="currentColor"
                strokeWidth="1.6"
              />
              <circle cx="12" cy="10" r="2.4" stroke="currentColor" strokeWidth="1.6" />
            </svg>
          </a>
          <StarButton
            active={starred}
            label={starred ? `Remove ${stop.name} from favourites` : `Add ${stop.name} to favourites`}
            onClick={() => toggle({ kind: 'stop', id: stop.id, name: stop.name })}
          />
        </div>
      </div>

      <header className="pb-4">
        <h1 className="text-[26px] leading-tight font-semibold tracking-tight">{stop.name}</h1>
        <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-muted">
          {stop.modes.map((m) => (
            <span key={m} className="flex items-center gap-1">
              <ModeIcon type={m} className="size-3.5" />
              {m === 'train' ? 'Train' : 'Bus'}
            </span>
          ))}
          {stop.wheelchair ? <span>· Accessible</span> : null}
          {related.length ? (
            <span>· incl. {related.map((s) => s.name).join(', ')}</span>
          ) : null}
        </p>
      </header>

      <DepartureBoard stationId={stop.id} availableModes={stop.modes} homeStopId={stop.id} />

      <div className="h-8" />
    </div>
  );
}
