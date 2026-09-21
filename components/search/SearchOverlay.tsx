'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { ModeIcon, RouteBadge, Skeleton } from '@/components/ui/primitives';
import { useTransit } from '@/lib/client/useTransit';
import type { SearchResults } from '@/lib/transit/types';

/**
 * Global search. Full-screen on mobile, a centred panel on desktop. Queries
 * are debounced so typing doesn't produce a request per keystroke.
 */
export function SearchOverlay({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(query.trim()), 180);
    return () => clearTimeout(t);
  }, [query]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    const t = setTimeout(() => inputRef.current?.focus(), 30);
    return () => {
      document.removeEventListener('keydown', onKey);
      clearTimeout(t);
    };
  }, [open, onClose]);

  const { data, loading } = useTransit<SearchResults>(
    open && debounced.length >= 2 ? `/api/transit/search?q=${encodeURIComponent(debounced)}` : null,
  );

  if (!open) return null;

  const empty =
    data && !data.stops.length && !data.routes.length && !data.trips.length && debounced.length >= 2;

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-[var(--bg)] sm:items-center sm:justify-start sm:bg-black/40 sm:p-8 sm:backdrop-blur-sm">
      <div className="flex min-h-0 w-full flex-1 flex-col sm:max-w-2xl sm:flex-none sm:rounded-3xl sm:surface sm:overflow-hidden">
        <div className="flex items-center gap-2 border-b px-3 py-3 hairline pt-safe sm:pt-3">
          <SearchIcon className="ml-1 size-5 text-[var(--fg-faint)]" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search stations, routes or trips"
            aria-label="Search GO Transit"
            enterKeyHint="search"
            className="min-h-11 flex-1 bg-transparent text-[16px] outline-none placeholder:text-[var(--fg-faint)]"
          />
          <button
            type="button"
            onClick={onClose}
            className="min-h-11 rounded-xl px-3 text-sm font-medium text-muted"
          >
            Cancel
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto scroll-touch px-3 py-3 pb-safe sm:max-h-[60vh]">
          {debounced.length < 2 ? (
            <p className="px-2 py-8 text-center text-sm text-muted">
              Search by station, bus stop, line, route number or trip number.
            </p>
          ) : null}

          {loading && !data ? (
            <div className="space-y-2">
              {Array.from({ length: 4 }, (_, i) => (
                <Skeleton key={i} className="h-14 rounded-xl" />
              ))}
            </div>
          ) : null}

          {empty ? (
            <p className="px-2 py-8 text-center text-sm text-muted">
              Nothing matched &ldquo;{debounced}&rdquo;.
            </p>
          ) : null}

          {data?.stops.length ? (
            <Section title="Stations & stops">
              {data.stops.map((stop) => (
                <Row
                  key={stop.id}
                  href={`/stations/${encodeURIComponent(stop.id)}`}
                  onNavigate={onClose}
                  title={stop.name}
                  subtitle={stop.modes.map((m) => (m === 'train' ? 'Train' : 'Bus')).join(' · ') || stop.id}
                  leading={<ModeIcon type={stop.modes.includes('train') ? 'train' : 'bus'} className="size-5" />}
                />
              ))}
            </Section>
          ) : null}

          {data?.routes.length ? (
            <Section title="Routes">
              {data.routes.map((route) => (
                <Row
                  key={route.id}
                  href={`/routes/${encodeURIComponent(route.id)}`}
                  onNavigate={onClose}
                  title={route.name}
                  subtitle={route.type === 'train' ? 'GO Train line' : 'GO Bus route'}
                  leading={<RouteBadge code={route.code} color={route.color} type={route.type} />}
                />
              ))}
            </Section>
          ) : null}

          {data?.trips.length ? (
            <Section title="Trips">
              {data.trips.map((trip) => (
                <Row
                  key={trip.id}
                  href={`/trips/${encodeURIComponent(trip.id)}`}
                  onNavigate={onClose}
                  title={`Trip ${trip.tripNumber}`}
                  subtitle={trip.label}
                  leading={<ModeIcon type={trip.vehicleType} className="size-5" />}
                />
              ))}
            </Section>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-4">
      <h2 className="px-2 pb-1 text-[11px] font-semibold tracking-wide text-faint uppercase">{title}</h2>
      <ul className="space-y-1">{children}</ul>
    </section>
  );
}

function Row({
  href,
  title,
  subtitle,
  leading,
  onNavigate,
}: {
  href: string;
  title: string;
  subtitle?: string;
  leading?: React.ReactNode;
  onNavigate: () => void;
}) {
  return (
    <li>
      <Link
        href={href}
        onClick={onNavigate}
        className="flex min-h-14 items-center gap-3 rounded-xl px-3 transition-colors hover:bg-[var(--bg-sunken)]"
      >
        <span className="text-[var(--fg-muted)]">{leading}</span>
        <span className="min-w-0 flex-1">
          <span className="block truncate font-medium">{title}</span>
          {subtitle ? <span className="block truncate text-[13px] text-muted">{subtitle}</span> : null}
        </span>
      </Link>
    </li>
  );
}

export function SearchIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" aria-hidden>
      <circle cx="11" cy="11" r="6.5" stroke="currentColor" strokeWidth="1.7" />
      <path d="m16 16 4 4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  );
}
