'use client';

import { useEffect, useMemo, useState } from 'react';
import { JourneyCard } from './JourneyCard';
import { LiveIndicator } from '@/components/ui/LiveIndicator';
import { EmptyState, ModeIcon, Skeleton } from '@/components/ui/primitives';
import { useTransit } from '@/lib/client/useTransit';
import type { Journey, TransitStop } from '@/lib/transit/types';

const RECENT_KEY = 'gotracker:recent-journeys:v1';

interface RecentJourney {
  from: string;
  fromName: string;
  to: string;
  toName: string;
}

/**
 * From → to. Direct services lead; when none exist, one-change itineraries are
 * built from the published timetable with a minimum connection buffer, and are
 * always labelled as a change so the rider can judge it.
 */
export function PlanScreen({ stops }: { stops: TransitStop[] }) {
  const [from, setFrom] = useState<TransitStop | null>(null);
  const [to, setTo] = useState<TransitStop | null>(null);
  const [recent, setRecent] = useState<RecentJourney[]>([]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(RECENT_KEY);
      setRecent(raw ? JSON.parse(raw) : []);
    } catch {
      setRecent([]);
    }
  }, []);

  useEffect(() => {
    if (!from || !to) return;
    const entry: RecentJourney = { from: from.id, fromName: from.name, to: to.id, toName: to.name };
    try {
      const raw = localStorage.getItem(RECENT_KEY);
      const list: RecentJourney[] = raw ? JSON.parse(raw) : [];
      const next = [entry, ...list.filter((r) => !(r.from === entry.from && r.to === entry.to))].slice(0, 4);
      localStorage.setItem(RECENT_KEY, JSON.stringify(next));
      setRecent(next);
    } catch {
      // Storage unavailable — the journey still works, it just isn't remembered.
    }
  }, [from, to]);

  const ready = Boolean(from && to && from.id !== to.id);
  const { data, meta, error, loading, freshness } = useTransit<Journey[]>(
    ready ? `/api/transit/journeys?from=${from!.id}&to=${to!.id}&limit=8` : null,
    { intervalMs: 60_000 },
  );

  const swap = () => {
    setFrom(to);
    setTo(from);
  };

  return (
    <div className="mx-auto w-full max-w-2xl px-4 pt-safe">
      <header className="pt-6 pb-4">
        <h1 className="text-[28px] leading-tight font-semibold tracking-tight">Plan a trip</h1>
        <p className="mt-1 text-[13px] text-muted">
          Direct GO services, or one change when there is no through service.
        </p>
      </header>

      <div className="relative space-y-2">
        <StopPicker label="From" stops={stops} value={from} onChange={setFrom} exclude={to?.id} />
        <StopPicker label="To" stops={stops} value={to} onChange={setTo} exclude={from?.id} />

        <button
          type="button"
          onClick={swap}
          disabled={!from && !to}
          aria-label="Swap origin and destination"
          className="absolute top-1/2 right-3 z-10 grid size-9 -translate-y-1/2 place-items-center rounded-full border text-[var(--fg-muted)] hairline bg-[var(--bg-elevated)] disabled:opacity-40"
        >
          <svg viewBox="0 0 24 24" className="size-4" fill="none" aria-hidden>
            <path
              d="M7 4v14m0 0-3-3m3 3 3-3M17 20V6m0 0-3 3m3-3 3 3"
              stroke="currentColor"
              strokeWidth="1.7"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      </div>

      {!ready && recent.length > 0 ? (
        <section className="mt-6">
          <h2 className="px-1 pb-2 text-[11px] font-semibold tracking-wide text-faint uppercase">
            Recent
          </h2>
          <ul className="space-y-1">
            {recent.map((journey) => (
              <li key={`${journey.from}-${journey.to}`}>
                <button
                  type="button"
                  onClick={() => {
                    setFrom(stops.find((s) => s.id === journey.from) ?? null);
                    setTo(stops.find((s) => s.id === journey.to) ?? null);
                  }}
                  className="flex min-h-12 w-full items-center gap-2 rounded-xl px-3 text-left text-[14px] hover:bg-[var(--bg-sunken)]"
                >
                  <span className="min-w-0 flex-1 truncate">
                    {journey.fromName} <span className="text-faint">→</span> {journey.toName}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {ready ? (
        <section className="mt-6 pb-10">
          <div className="mb-2 flex items-center justify-between gap-2">
            <h2 className="text-[11px] font-semibold tracking-wide text-faint uppercase">
              Next departures
            </h2>
            <LiveIndicator freshness={freshness} updatedAt={meta?.updatedAt ?? null} compact />
          </div>

          {loading && !data ? (
            <div className="space-y-2">
              {Array.from({ length: 3 }, (_, i) => (
                <Skeleton key={i} className="h-[132px] rounded-2xl" />
              ))}
            </div>
          ) : null}

          {error && !data ? <EmptyState title="Could not plan that trip" body={error} /> : null}

          {data?.length === 0 ? (
            <EmptyState
              title="Nothing connects these stops"
              body={`No GO service runs from ${from!.name} to ${to!.name} in the next few hours, directly or with one change.`}
            />
          ) : null}

          {meta?.degraded ? (
            <p className="mb-2 rounded-xl bg-[var(--bg-sunken)] px-3 py-2 text-[12px] text-muted">
              {meta.degraded}
            </p>
          ) : null}

          <ul className="space-y-2">
            {data?.map((journey, index) => (
              <li
                key={journey.id}
                className="animate-rise"
                style={{ animationDelay: `${Math.min(index, 6) * 20}ms` }}
              >
                <JourneyCard journey={journey} tone={index % 2 === 0 ? 'a' : 'b'} />
              </li>
            ))}
          </ul>

          {data?.some((j) => j.transfers > 0) ? (
            <p className="mt-3 text-[12px] leading-relaxed text-faint">
              Change times come from the published timetable. If the first leg runs late the
              connection may not hold — check the live status of each leg before relying on it.
            </p>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}

/** Type-ahead stop picker over the full 888-stop list. */
function StopPicker({
  label,
  stops,
  value,
  onChange,
  exclude,
}: {
  label: string;
  stops: TransitStop[];
  value: TransitStop | null;
  onChange: (stop: TransitStop | null) => void;
  exclude?: string;
}) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return stops
      .filter((s) => s.id !== exclude && s.name.toLowerCase().includes(q))
      .slice(0, 8);
  }, [stops, query, exclude]);

  return (
    <div className="relative">
      <label className="flex min-h-14 items-center gap-3 rounded-2xl border px-4 hairline bg-[var(--bg-elevated)] focus-within:border-[var(--accent)]">
        <span className="w-10 shrink-0 text-[11px] font-semibold tracking-wide text-faint uppercase">
          {label}
        </span>
        <input
          value={value ? value.name : query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
            if (value) onChange(null);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          placeholder="Station or stop"
          aria-label={`${label} stop`}
          className="min-w-0 flex-1 bg-transparent py-3 pr-10 text-[15px] outline-none placeholder:text-[var(--fg-faint)]"
        />
      </label>

      {open && matches.length > 0 ? (
        <ul className="absolute inset-x-0 top-full z-20 mt-1 max-h-72 overflow-y-auto rounded-2xl p-1 surface">
          {matches.map((stop) => (
            <li key={stop.id}>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  onChange(stop);
                  setQuery('');
                  setOpen(false);
                }}
                className="flex min-h-12 w-full items-center gap-2 rounded-xl px-3 text-left hover:bg-[var(--bg-sunken)]"
              >
                <span className="flex gap-1 text-[var(--fg-muted)]">
                  {(stop.modes.length ? stop.modes : (['unknown'] as const)).map((m) => (
                    <ModeIcon key={m} type={m} className="size-4" />
                  ))}
                </span>
                <span className="min-w-0 flex-1 truncate text-[14px]">{stop.name}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
