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
 * State for a from → to search. Direct services lead; when none exist, one-change
 * itineraries are built from the published timetable and always labelled as a
 * change so the rider can judge it. Shared by the home screen and /plan.
 */
export function useTripPlanner(stops: TransitStop[]) {
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
      // Storage unavailable: the journey still works, it just isn't remembered.
    }
  }, [from, to]);

  const ready = Boolean(from && to && from.id !== to.id);
  const result = useTransit<Journey[]>(
    ready ? `/api/transit/journeys?from=${from!.id}&to=${to!.id}&limit=8` : null,
    { intervalMs: 60_000 },
  );

  return {
    from,
    to,
    setFrom,
    setTo,
    swap: () => {
      setFrom(to);
      setTo(from);
    },
    ready,
    recent,
    pick: (journey: RecentJourney) => {
      setFrom(stops.find((s) => s.id === journey.from) ?? null);
      setTo(stops.find((s) => s.id === journey.to) ?? null);
    },
    ...result,
  };
}

export type TripPlannerState = ReturnType<typeof useTripPlanner>;

/** The From / To fields, with swap and recent searches. */
export function PlannerForm({
  planner,
  stops,
  loadingStops = false,
}: {
  planner: TripPlannerState;
  stops: TransitStop[];
  loadingStops?: boolean;
}) {
  const { from, to, setFrom, setTo, swap, ready, recent, pick } = planner;
  return (
    <div>
      <div className="relative">
        <div className="overflow-visible rounded-2xl bg-[var(--bg-elevated)] text-[var(--fg)] shadow-lg ring-1 ring-black/5">
          <StopPicker
            label="From"
            dot="from"
            stops={stops}
            loading={loadingStops}
            value={from}
            onChange={setFrom}
            exclude={to?.id}
          />
          <div className="mx-4 h-px bg-[var(--border)]" aria-hidden />
          <StopPicker
            label="To"
            dot="to"
            stops={stops}
            loading={loadingStops}
            value={to}
            onChange={setTo}
            exclude={from?.id}
          />
        </div>
        <button
          type="button"
          onClick={swap}
          disabled={!from && !to}
          aria-label="Swap origin and destination"
          className="absolute top-1/2 right-3 z-10 grid size-9 -translate-y-1/2 place-items-center rounded-full border text-[var(--fg-muted)] shadow-sm hairline bg-[var(--bg-elevated)] transition-transform active:rotate-180 disabled:opacity-40"
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
        <div className="no-scrollbar mt-3 flex gap-2 overflow-x-auto pb-0.5">
          {recent.map((journey) => (
            <button
              key={`${journey.from}-${journey.to}`}
              type="button"
              onClick={() => pick(journey)}
              className="shrink-0 rounded-full bg-white/15 px-3 py-1.5 text-[12px] font-semibold whitespace-nowrap text-white ring-1 ring-white/25 backdrop-blur"
            >
              {journey.fromName.replace(/\s+GO$/i, '')} → {journey.toName.replace(/\s+GO$/i, '')}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/** Journey cards for the chosen pair. Renders nothing until both ends are set. */
export function PlannerResults({ planner }: { planner: TripPlannerState }) {
  const { from, to, ready, data, meta, error, loading, freshness } = planner;
  if (!ready) return null;

  return (
    <section className="mt-5" aria-label="Journeys">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 className="text-[12px] font-bold tracking-[0.12em] text-faint uppercase">
          {from!.name.replace(/\s+GO$/i, '')} → {to!.name.replace(/\s+GO$/i, '')}
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
          connection may not hold. Check the live status of each leg before relying on it.
        </p>
      ) : null}
    </section>
  );
}

/** Type-ahead stop picker over the full stop list. */
function StopPicker({
  label,
  dot,
  stops,
  loading,
  value,
  onChange,
  exclude,
}: {
  label: string;
  dot: 'from' | 'to';
  stops: TransitStop[];
  loading: boolean;
  value: TransitStop | null;
  onChange: (stop: TransitStop | null) => void;
  exclude?: string;
}) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    // Stations first, so "Burlington" finds the station before its bus stops.
    return stops
      .filter((s) => s.id !== exclude && s.name.toLowerCase().includes(q))
      .sort((a, b) => Number(b.modes.includes('train')) - Number(a.modes.includes('train')))
      .slice(0, 8);
  }, [stops, query, exclude]);

  return (
    <div className="relative">
      <label className="flex min-h-14 items-center gap-3 px-4 focus-within:bg-[var(--bg-sunken)] rounded-2xl">
        <span aria-hidden className="grid w-3 place-items-center">
          {dot === 'from' ? (
            <span className="size-3 rounded-full border-[3px] border-[var(--accent)] bg-transparent" />
          ) : (
            <span className="size-3 rounded-full bg-[var(--accent)]" />
          )}
        </span>
        <span className="sr-only">{label}</span>
        <input
          value={value ? value.name : query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
            if (value) onChange(null);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          placeholder={loading ? 'Loading stations…' : label === 'From' ? 'From: station or stop' : 'To: station or stop'}
          aria-label={`${label} stop`}
          className="min-w-0 flex-1 bg-transparent py-3 pr-12 text-[16px] font-semibold outline-none placeholder:font-medium placeholder:text-[var(--fg-faint)]"
        />
      </label>

      {open && matches.length > 0 ? (
        <ul className="absolute inset-x-0 top-full z-30 mt-1 max-h-72 overflow-y-auto rounded-2xl p-1 text-[var(--fg)] surface">
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
