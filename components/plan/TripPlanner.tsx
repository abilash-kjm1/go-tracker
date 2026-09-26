'use client';

import { useEffect, useMemo, useState } from 'react';
import { JourneyCard } from './JourneyCard';
import { LiveIndicator } from '@/components/ui/LiveIndicator';
import { EmptyState, ModeIcon, Skeleton } from '@/components/ui/primitives';
import { useActiveTrip } from '@/lib/client/activeTrip';
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
  /**
   * When to travel, as a Toronto wall-clock string ("2026-09-27T09:30"), or
   * null for "now". Sent as typed rather than as an instant, so the journey is
   * the one the rider meant whatever their device's clock says.
   */
  const [at, setAt] = useState<string | null>(null);

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
    ready
      ? `/api/transit/journeys?from=${from!.id}&to=${to!.id}&limit=8${at ? `&at=${encodeURIComponent(at)}` : ''}`
      : null,
    // A future timetable does not change; only the live board needs polling.
    { intervalMs: at ? 0 : 60_000 },
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
    at,
    setAt,
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
  const { from, to, setFrom, setTo, swap, ready, at, setAt, recent, pick } = planner;
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

      <WhenPicker value={at} onChange={setAt} />

      {!ready && recent.length > 0 ? (
        <div className="no-scrollbar mt-3 flex gap-2 overflow-x-auto pb-0.5">
          {recent.map((journey) => (
            <button
              key={`${journey.from}-${journey.to}`}
              type="button"
              onClick={() => pick(journey)}
              className="shrink-0 rounded-full bg-[var(--bg-elevated)]/75 px-3 py-1.5 text-[12px] font-semibold whitespace-nowrap text-[var(--fg)] shadow-sm ring-1 ring-black/10 backdrop-blur"
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
  const { from, to, ready, at, data, meta, error, loading, freshness } = planner;
  const { trip: active, start } = useActiveTrip();
  if (!ready) return null;

  return (
    <section className="mt-5" aria-label="Journeys">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 className="text-[12px] font-bold tracking-[0.12em] text-faint uppercase">
          {from!.name.replace(/\s+GO$/i, '')} → {to!.name.replace(/\s+GO$/i, '')}
        </h2>
        {at ? (
          <span className="shrink-0 text-[12px] font-semibold text-muted">{describeWhen(at)}</span>
        ) : (
          <LiveIndicator freshness={freshness} updatedAt={meta?.updatedAt ?? null} compact />
        )}
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
            <button
              type="button"
              onClick={() => void start(journey, to!.id, to!.name)}
              className="mt-1.5 flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border text-[13px] font-bold transition-colors hairline bg-[var(--bg-elevated)] hover:bg-[var(--bg-sunken)]"
            >
              {active?.id === journey.id ? (
                <span className="text-[var(--accent)]">Following this trip</span>
              ) : (
                <>Start this trip</>
              )}
            </button>
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

/** "2026-09-27T09:30" as a rider would say it. */
function describeWhen(value: string): string {
  const parts = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!parts) return value;
  const [, y, m, d, hh, mm] = parts;
  // Built as a local date purely for formatting the day and month name.
  const date = new Date(Number(y), Number(m) - 1, Number(d), Number(hh), Number(mm));
  const day = date.toLocaleDateString('en-CA', { weekday: 'short', day: 'numeric', month: 'short' });
  const time = date.toLocaleTimeString('en-CA', { hour: 'numeric', minute: '2-digit' });
  return `${day}, ${time}`;
}

/** "2026-10-04" as a rider would say the day. */
function describeDay(value: string): string {
  const [y, m, d] = value.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-CA', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });
}

/** Today in Toronto, as the value a date input expects. */
function torontoToday(): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Toronto',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '01';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/** "20260927" -> "2026-09-27". */
const toInputDate = (key: string) => `${key.slice(0, 4)}-${key.slice(4, 6)}-${key.slice(6, 8)}`;

/**
 * Leave now, or pick a day and time. The timetable is bundled at build time and
 * covers a fixed run of days, so the picker offers exactly those and no more.
 */
function WhenPicker({ value, onChange }: { value: string | null; onChange: (v: string | null) => void }) {
  const [open, setOpen] = useState(false);
  const { data: calendar } = useTransit<{ dates: string[] }>('/api/transit/calendar');

  const today = torontoToday();
  const dates = calendar?.dates ?? [];
  const min = dates.length ? toInputDate(dates[0]) : today;
  const max = dates.length ? toInputDate(dates[dates.length - 1]) : undefined;

  const date = value ? value.slice(0, 10) : today;
  const time = value ? value.slice(11, 16) : '09:00';

  const set = (nextDate: string, nextTime: string) => {
    if (!nextDate || !nextTime) return;
    onChange(`${nextDate}T${nextTime}`);
  };

  return (
    <div className="mt-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => {
            onChange(null);
            setOpen(false);
          }}
          aria-pressed={!value}
          className={`rounded-full px-3 py-1.5 text-[12px] font-bold shadow-sm ring-1 backdrop-blur ${
            value
              ? 'bg-[var(--bg-elevated)]/70 text-[var(--fg)] ring-black/10'
              : 'bg-[var(--bg-elevated)] text-[var(--fg)] ring-black/10'
          }`}
          style={!value ? { boxShadow: 'inset 0 0 0 2px var(--accent)' } : undefined}
        >
          Leave now
        </button>

        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="flex items-center gap-1.5 rounded-full bg-[var(--bg-elevated)]/85 px-3 py-1.5 text-[12px] font-bold text-[var(--fg)] shadow-sm ring-1 ring-black/10 backdrop-blur"
          style={value ? { boxShadow: 'inset 0 0 0 2px var(--accent)' } : undefined}
        >
          <CalendarGlyph />
          {value ? describeWhen(value) : 'Pick a day'}
        </button>
      </div>

      {open ? (
        <div className="mt-2 flex flex-wrap items-end gap-2 rounded-2xl p-3 text-[var(--fg)] surface">
          <label className="min-w-0 flex-1">
            <span className="block text-[10.5px] font-bold tracking-wide text-faint uppercase">Day</span>
            <input
              type="date"
              value={date}
              min={min}
              max={max}
              onChange={(e) => set(e.target.value, time)}
              className="mt-1 min-h-11 w-full rounded-xl border px-3 text-[14px] outline-none hairline bg-[var(--bg-elevated)]"
            />
          </label>
          <label className="w-[124px]">
            <span className="block text-[10.5px] font-bold tracking-wide text-faint uppercase">Time</span>
            <input
              type="time"
              value={time}
              onChange={(e) => set(date, e.target.value)}
              className="mt-1 min-h-11 w-full rounded-xl border px-3 text-[14px] outline-none hairline bg-[var(--bg-elevated)]"
            />
          </label>
          {max ? (
            <p className="w-full text-[11px] text-faint">
              Timetable loaded through {describeDay(max)}.
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function CalendarGlyph() {
  return (
    <svg viewBox="0 0 24 24" className="size-3.5" fill="none" aria-hidden>
      <rect x="3.5" y="5" width="17" height="15.5" rx="3" stroke="currentColor" strokeWidth="1.9" />
      <path d="M3.5 9.5h17M8 3.5v3M16 3.5v3" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
    </svg>
  );
}
