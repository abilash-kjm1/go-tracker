'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { SearchIcon, SearchOverlay } from '@/components/search/SearchOverlay';
import { StationSummaryCard } from '@/components/stations/StationSummaryCard';
import { LiveIndicator } from '@/components/ui/LiveIndicator';
import { ModeIcon, Skeleton } from '@/components/ui/primitives';
import { useFavorites, useRecentStops } from '@/lib/client/favorites';
import { useNearbyStops } from '@/lib/client/useNearby';
import { useTransit } from '@/lib/client/useTransit';
import { greeting } from '@/lib/transit/time';
import type { LiveVehicle, TransitAlert, TransitRoute, TransitStop } from '@/lib/transit/types';

export function HomeScreen({ featured = [] }: { featured?: TransitStop[] }) {
  const [searchOpen, setSearchOpen] = useState(false);
  const { favorites, ready } = useFavorites();
  const recent = useRecentStops();
  const nearby = useNearbyStops();

  const { data: vehicles, meta, freshness } = useTransit<LiveVehicle[]>(
    '/api/transit/vehicles/live',
    { intervalMs: 20_000 },
  );
  const { data: alerts } = useTransit<TransitAlert[]>('/api/transit/alerts', { intervalMs: 60_000 });

  const { data: routes } = useTransit<TransitRoute[]>('/api/transit/routes?type=train');

  const trains = vehicles?.filter((v) => v.vehicleType === 'train').length ?? 0;
  const buses = vehicles?.filter((v) => v.vehicleType === 'bus').length ?? 0;

  // Which lines have trains out right now, and how many of those are running late.
  const lines = useMemo(() => {
    const byRoute = new Map<string, { route: TransitRoute; count: number; late: number }>();
    for (const v of vehicles ?? []) {
      if (v.vehicleType !== 'train' || !v.routeId) continue;
      const route = routes?.find((r) => r.id === v.routeId);
      if (!route) continue;
      const entry = byRoute.get(route.id) ?? { route, count: 0, late: 0 };
      entry.count += 1;
      if ((v.delaySeconds ?? 0) >= 120) entry.late += 1;
      byRoute.set(route.id, entry);
    }
    return [...byRoute.values()].sort((a, b) => b.count - a.count);
  }, [vehicles, routes]);
  const lateTotal = lines.reduce((sum, l) => sum + l.late, 0);
  const favoriteStops = favorites.filter((f) => f.kind === 'stop');

  return (
    <div className="mx-auto w-full max-w-2xl px-4 pt-safe">
      {/* Hero: the one question the app answers, with the two ways in. */}
      <header
        className="relative mt-4 overflow-hidden rounded-[28px] p-5 pb-5 text-white shadow-[var(--shadow-card)]"
        style={{
          background:
            'radial-gradient(120% 90% at 100% 0%, #38bdf8 0%, transparent 55%), linear-gradient(140deg, #047857 0%, #0f766e 48%, #0c4a6e 100%)',
        }}
      >
        <Rails />
        <p className="relative text-[13px] font-medium text-white/80">{greeting()}</p>
        <h1 className="relative mt-0.5 text-[30px] leading-[1.1] font-extrabold tracking-tight">
          Where are you
          <br />
          going today?
        </h1>

        <button
          type="button"
          onClick={() => setSearchOpen(true)}
          className="relative mt-5 flex min-h-13 w-full items-center gap-3 rounded-2xl bg-white px-4 py-3 text-left text-[15px] font-medium text-slate-500 shadow-lg"
        >
          <SearchIcon className="size-5 text-slate-400" />
          Search stations, lines or buses
        </button>

        <Link
          href="/plan"
          className="relative mt-2.5 flex min-h-12 items-center justify-between gap-3 rounded-2xl bg-white/15 px-4 text-[14px] font-bold backdrop-blur ring-1 ring-white/25 transition-colors hover:bg-white/25"
        >
          <span className="flex items-center gap-2.5">
            <span className="grid size-2 place-items-center rounded-full bg-white" aria-hidden />
            <span className="h-px w-5 bg-white/60" aria-hidden />
            <span className="size-2 rounded-full ring-2 ring-white" aria-hidden />
            <span className="ml-1">Plan a trip from A to B</span>
          </span>
          <span aria-hidden>→</span>
        </Link>
      </header>

      {/* Shortcuts. */}
      <nav aria-label="Shortcuts" className="mt-4 grid grid-cols-4 gap-2.5">
        <Shortcut href="/map" hue="green" label="Live map" icon={<MapGlyph />} />
        <Shortcut href="/stations" hue="blue" label="Stations" icon={<StationGlyph />} />
        <Shortcut href="/routes" hue="violet" label="Lines" icon={<LinesGlyph />} />
        <Shortcut
          href="/alerts"
          hue="amber"
          label="Alerts"
          icon={<AlertGlyph />}
          badge={alerts && alerts.length > 0 ? alerts.length : undefined}
        />
      </nav>

      {/* Live network: what is out there right now. */}
      <Link
        href="/map"
        className="group mt-4 block rounded-3xl border px-4 py-4 transition-colors hairline bg-[var(--bg-elevated)] shadow-[var(--shadow-card)]"
      >
        <div className="flex items-center justify-between gap-3">
          <LiveIndicator freshness={freshness} updatedAt={meta?.updatedAt ?? null} />
          <span className="text-[13px] font-bold text-[var(--accent)] transition-transform group-hover:translate-x-0.5">
            Open live map →
          </span>
        </div>

        <div className="mt-3 grid grid-cols-3 gap-2">
          <div className="rounded-2xl px-3 py-2.5" style={{ background: 'var(--tile-green-bg)', color: 'var(--tile-green-fg)' }}>
            <p className="text-[10px] font-bold tracking-[0.12em] uppercase opacity-75">Trains now</p>
            <p className="tabular text-[28px] leading-none font-extrabold">
              {vehicles ? trains : <Skeleton className="h-7 w-10" />}
            </p>
          </div>
          <div
            className="rounded-2xl px-3 py-2.5"
            style={{
              background: lateTotal > 0 ? 'var(--tile-amber-bg)' : 'var(--tile-teal-bg)',
              color: lateTotal > 0 ? 'var(--tile-amber-fg)' : 'var(--tile-teal-fg)',
            }}
          >
            <p className="text-[10px] font-bold tracking-[0.12em] uppercase opacity-75">
              {lateTotal > 0 ? 'Running late' : 'On time'}
            </p>
            <p className="tabular text-[28px] leading-none font-extrabold">
              {vehicles ? (lateTotal > 0 ? lateTotal : trains) : <Skeleton className="h-7 w-10" />}
            </p>
          </div>
          <div className="rounded-2xl px-3 py-2.5" style={{ background: 'var(--tile-violet-bg)', color: 'var(--tile-violet-fg)' }}>
            <p className="text-[10px] font-bold tracking-[0.12em] uppercase opacity-75">Lines out</p>
            <p className="tabular text-[28px] leading-none font-extrabold">
              {vehicles && routes ? lines.length : <Skeleton className="h-7 w-10" />}
            </p>
          </div>
        </div>

        {lines.length > 0 ? (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {lines.map(({ route, count, late }) => (
              <span
                key={route.id}
                className="flex items-center gap-1.5 rounded-full py-1 pr-2.5 pl-1 text-[12px] font-semibold ring-1 ring-[var(--border)]"
              >
                <span
                  className="grid h-5 min-w-7 place-items-center rounded-full px-1.5 text-[10px] font-extrabold text-white"
                  style={{ background: route.color ?? '#64748b' }}
                >
                  {route.code}
                </span>
                <span className="tabular">{count}</span>
                {late > 0 ? (
                  <span className="text-[var(--tile-amber-fg)]" title={`${late} running late`}>
                    · {late} late
                  </span>
                ) : null}
              </span>
            ))}
          </div>
        ) : null}

        <p className="mt-3 text-[11px] text-faint">
          {buses === 0
            ? 'GO publishes live positions for trains only; buses show timetable and platform info.'
            : `${buses} bus${buses === 1 ? '' : 'es'} reporting a position.`}
        </p>
      </Link>

      {alerts && alerts.length > 0 ? (
        <Link
          href="/alerts"
          className="mt-3 flex items-start gap-3 rounded-2xl px-4 py-3 text-[13px] font-semibold"
          style={{ background: 'var(--tile-amber-bg)', color: 'var(--tile-amber-fg)' }}
        >
          <span aria-hidden className="mt-px text-[15px]">⚠</span>
          <span className="min-w-0">
            {alerts.length === 1
              ? `${alerts[0].title} — ${alerts[0].body}`
              : `${alerts.length} services are reporting delays`}
            <span className="ml-1 font-bold underline underline-offset-2">Details</span>
          </span>
        </Link>
      ) : null}

      {ready && favoriteStops.length > 0 ? (
        <Section title="Favourites">
          {favoriteStops.map((fav) => (
            <StationSummaryCard key={fav.id} stopId={fav.id} name={fav.name} starred />
          ))}
        </Section>
      ) : null}

      {nearby.status === 'granted' && nearby.stops.length > 0 ? (
        <Section title="Nearby">
          {nearby.stops.slice(0, 3).map((stop) => (
            <StationSummaryCard
              key={stop.id}
              stopId={stop.id}
              name={stop.name}
              distanceKm={stop.distanceKm}
            />
          ))}
        </Section>
      ) : null}

      {nearby.status === 'idle' && favoriteStops.length === 0 ? (
        <button
          type="button"
          onClick={nearby.request}
          className="mt-4 flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl border px-4 text-sm font-semibold hairline"
        >
          Use my location to sort by distance
        </button>
      ) : null}

      {nearby.status === 'denied' ? (
        <p className="mt-4 rounded-xl bg-[var(--bg-sunken)] px-3 py-2 text-[13px] text-muted">
          Location is blocked, so nearby stops are unavailable.{' '}
          <Link href="/stations" className="font-medium text-[var(--accent)]">
            Browse stations instead
          </Link>
          .
        </p>
      ) : null}

      {ready && favoriteStops.length === 0 && recent.length > 0 ? (
        <Section title="Recently viewed">
          {recent.slice(0, 3).map((stop) => (
            <StationSummaryCard key={stop.id} stopId={stop.id} name={stop.name} />
          ))}
        </Section>
      ) : null}

      {ready && favoriteStops.length === 0 && nearby.stops.length === 0 && featured.length > 0 ? (
        <Section title="Busiest today">
          {featured.slice(0, 3).map((stop) => (
            <StationSummaryCard key={stop.id} stopId={stop.id} name={stop.name} />
          ))}
          <Link
            href="/stations"
            className="flex min-h-12 items-center justify-center rounded-2xl border px-4 text-sm font-semibold hairline"
          >
            Browse all stations &amp; stops
          </Link>
        </Section>
      ) : null}

      <p className="mt-8 pb-4 text-center text-[11px] leading-relaxed text-faint">
        Independent app. Not operated by or affiliated with Metrolinx or GO Transit.
      </p>

      <SearchOverlay open={searchOpen} onClose={() => setSearchOpen(false)} />
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-6">
      <h2 className="px-1 pb-2 text-[12px] font-bold tracking-[0.12em] text-faint uppercase">
        {title}
      </h2>
      <div className="space-y-2">{children}</div>
    </section>
  );
}

type Hue = 'blue' | 'violet' | 'amber' | 'teal' | 'rose' | 'green';

function Shortcut({
  href,
  hue,
  label,
  icon,
  badge,
}: {
  href: string;
  hue: Hue;
  label: string;
  icon: React.ReactNode;
  badge?: number;
}) {
  return (
    <Link
      href={href}
      className="relative flex flex-col items-center gap-1.5 rounded-2xl px-1 py-3 text-center text-[12px] font-bold transition-transform active:scale-[0.97]"
      style={{ background: `var(--tile-${hue}-bg)`, color: `var(--tile-${hue}-fg)` }}
    >
      <span className="grid size-9 place-items-center">{icon}</span>
      {label}
      {badge ? (
        <span className="tabular absolute top-1.5 right-2 grid h-[18px] min-w-[18px] place-items-center rounded-full bg-[var(--color-alert-500)] px-1 text-[10px] font-extrabold text-white">
          {badge}
        </span>
      ) : null}
    </Link>
  );
}

/** Decorative track lines behind the hero. */
function Rails() {
  return (
    <svg
      aria-hidden
      viewBox="0 0 400 220"
      className="pointer-events-none absolute inset-0 size-full opacity-[0.16]"
      preserveAspectRatio="xMaxYMid slice"
      fill="none"
      stroke="white"
    >
      <path d="M-20 190 C 90 190, 120 90, 220 90 S 340 30, 430 30" strokeWidth="6" strokeLinecap="round" />
      <path d="M-20 215 C 110 215, 150 130, 250 130 S 350 80, 430 80" strokeWidth="3" strokeLinecap="round" strokeDasharray="2 9" />
      <circle cx="220" cy="90" r="9" fill="white" stroke="none" />
      <circle cx="340" cy="52" r="6" fill="white" stroke="none" />
    </svg>
  );
}

const glyph = 'size-6';
function MapGlyph() {
  return (
    <svg viewBox="0 0 24 24" className={glyph} fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M9 4 3.5 6v14L9 18l6 2 5.5-2V4L15 6 9 4Z" />
      <path d="M9 4v14M15 6v14" />
    </svg>
  );
}
function StationGlyph() {
  return (
    <svg viewBox="0 0 24 24" className={glyph} fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="5" y="3" width="14" height="14" rx="3.5" />
      <path d="M5 10h14M9 21l2-4M15 21l-2-4" />
      <circle cx="9" cy="13.5" r=".8" fill="currentColor" />
      <circle cx="15" cy="13.5" r=".8" fill="currentColor" />
    </svg>
  );
}
function LinesGlyph() {
  return (
    <svg viewBox="0 0 24 24" className={glyph} fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M4 7h10a3 3 0 0 1 0 6H8a3 3 0 0 0 0 6h12" />
      <circle cx="4" cy="7" r="1.6" fill="currentColor" />
      <circle cx="20" cy="19" r="1.6" fill="currentColor" />
    </svg>
  );
}
function AlertGlyph() {
  return (
    <svg viewBox="0 0 24 24" className={glyph} fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M12 3.5 2.8 19.5h18.4L12 3.5Z" />
      <path d="M12 10v4.5" />
      <circle cx="12" cy="17" r=".9" fill="currentColor" />
    </svg>
  );
}
