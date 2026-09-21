'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { SearchIcon, SearchOverlay } from '@/components/search/SearchOverlay';
import { HeroCard } from './HeroCard';
import { usePhase } from './HeroScene';
import { PlannerForm, PlannerResults, useTripPlanner } from '@/components/plan/TripPlanner';
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

  // Every stop, for the planner's type-ahead. Fetched here (and CDN-cached) rather
  // than baked into the page, so the home screen stays light.
  const { data: allStops, loading: stopsLoading } = useTransit<TransitStop[]>(
    '/api/transit/stations?limit=1000',
  );
  const planner = useTripPlanner(allStops ?? []);
  const phase = usePhase();

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

  // What the live card is showing underneath: nothing, all trains, late trains,
  // the list of lines, or one line's trains. Tapping the same thing again closes it.
  const [liveView, setLiveView] = useState<LiveView | null>(null);
  const toggleView = (next: LiveView) =>
    setLiveView((current) => (sameView(current, next) ? null : next));

  const trainList = useMemo(() => {
    const trainsOnly = (vehicles ?? []).filter((v) => v.vehicleType === 'train');
    const routeOf = (id?: string) => routes?.find((r) => r.id === id);
    const rows = trainsOnly.map((v) => ({ v, route: routeOf(v.routeId) }));
    if (!liveView) return [];
    if (liveView.kind === 'late') {
      return rows
        .filter((r) => (r.v.delaySeconds ?? 0) >= 120)
        .sort((a, b) => (b.v.delaySeconds ?? 0) - (a.v.delaySeconds ?? 0));
    }
    if (liveView.kind === 'line') return rows.filter((r) => r.v.routeId === liveView.routeId);
    return rows.sort((a, b) => (a.route?.name ?? '').localeCompare(b.route?.name ?? ''));
  }, [vehicles, routes, liveView]);
  const favoriteStops = favorites.filter((f) => f.kind === 'stop');

  return (
    <div className="mx-auto w-full max-w-2xl px-4 pt-safe">
      {/* Hero: a warm card with a train mascot, the headline and the planner. */}
      <HeroCard
        phase={phase}
        greeting={greeting()}
        trainsLive={vehicles ? trains : null}
        late={lateTotal}
        onSearch={() => setSearchOpen(true)}
      >
        <PlannerForm planner={planner} stops={allStops ?? []} loadingStops={stopsLoading && !allStops} />
      </HeroCard>

      {/* Straight under the form, so choosing two stops answers itself in place. */}
      <PlannerResults planner={planner} />

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

      {/* Live network: what is out there right now. Every number opens its trains. */}
      <section className="mt-4 rounded-3xl border px-4 py-4 hairline bg-[var(--bg-elevated)] shadow-[var(--shadow-card)]">
        <div className="flex items-center justify-between gap-3">
          <LiveIndicator freshness={freshness} updatedAt={meta?.updatedAt ?? null} />
          <Link href="/map" className="text-[13px] font-bold text-[var(--accent)]">
            Open live map →
          </Link>
        </div>

        <div className="mt-3 grid grid-cols-3 gap-2">
          <StatButton
            hue="green"
            label="Trains now"
            value={vehicles ? trains : null}
            active={liveView?.kind === 'all'}
            onClick={() => toggleView({ kind: 'all' })}
          />
          <StatButton
            hue={lateTotal > 0 ? 'amber' : 'teal'}
            label={lateTotal > 0 ? 'Running late' : 'On time'}
            value={vehicles ? (lateTotal > 0 ? lateTotal : trains) : null}
            active={liveView?.kind === (lateTotal > 0 ? 'late' : 'all')}
            onClick={() => toggleView(lateTotal > 0 ? { kind: 'late' } : { kind: 'all' })}
          />
          <StatButton
            hue="violet"
            label="Lines out"
            value={vehicles && routes ? lines.length : null}
            active={liveView?.kind === 'lines'}
            onClick={() => toggleView({ kind: 'lines' })}
          />
        </div>

        {lines.length > 0 ? (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {lines.map(({ route, count, late }) => {
              const active = liveView?.kind === 'line' && liveView.routeId === route.id;
              return (
                <button
                  key={route.id}
                  type="button"
                  aria-pressed={active}
                  onClick={() => toggleView({ kind: 'line', routeId: route.id })}
                  className="flex items-center gap-1.5 rounded-full py-1 pr-2.5 pl-1 text-[12px] font-semibold transition-transform active:scale-[0.97]"
                  style={
                    active
                      ? {
                          background: 'var(--tile-violet-bg)',
                          color: 'var(--tile-violet-fg)',
                          boxShadow: `inset 0 0 0 1.5px ${route.color ?? '#64748b'}`,
                        }
                      : { boxShadow: 'inset 0 0 0 1px var(--border-strong)' }
                  }
                >
                  <span
                    className="grid h-5 min-w-7 place-items-center rounded-full px-1.5 text-[10px] font-extrabold text-white"
                    style={{ background: route.color ?? '#64748b' }}
                  >
                    {route.code}
                  </span>
                  <span className="tabular">{count}</span>
                  {late > 0 ? <span className="text-[var(--tile-amber-fg)]">· {late} late</span> : null}
                </button>
              );
            })}
          </div>
        ) : null}

        {liveView ? (
          <LiveList
            view={liveView}
            trains={trainList}
            lines={lines}
            onPickLine={(routeId) => setLiveView({ kind: 'line', routeId })}
            onClose={() => setLiveView(null)}
            routeName={
              liveView.kind === 'line'
                ? lines.find((l) => l.route.id === liveView.routeId)?.route.name
                : undefined
            }
          />
        ) : (
          <p className="mt-3 text-[11px] text-faint">
            Tap a number or a line to see its trains.{' '}
            {buses === 0
              ? 'GO publishes live positions for trains only; buses show timetable and platform info.'
              : `${buses} bus${buses === 1 ? '' : 'es'} reporting a position.`}
          </p>
        )}
      </section>

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

type LiveView =
  | { kind: 'all' }
  | { kind: 'late' }
  | { kind: 'lines' }
  | { kind: 'line'; routeId: string };

function sameView(a: LiveView | null, b: LiveView): boolean {
  if (!a || a.kind !== b.kind) return false;
  return a.kind !== 'line' || (b.kind === 'line' && a.routeId === b.routeId);
}

function StatButton({
  hue,
  label,
  value,
  active,
  onClick,
}: {
  hue: Hue;
  label: string;
  value: number | null;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className="rounded-2xl px-3 py-2.5 text-left transition-transform active:scale-[0.97]"
      style={{
        background: `var(--tile-${hue}-bg)`,
        color: `var(--tile-${hue}-fg)`,
        boxShadow: active ? `inset 0 0 0 2px var(--tile-${hue}-fg)` : undefined,
      }}
    >
      <p className="flex items-center justify-between text-[10px] font-bold tracking-[0.12em] uppercase opacity-75">
        {label}
        <span aria-hidden className={active ? 'rotate-180' : ''}>▾</span>
      </p>
      <p className="tabular text-[28px] leading-none font-extrabold">
        {value == null ? <Skeleton className="h-7 w-10" /> : value}
      </p>
    </button>
  );
}

type LineSummary = { route: TransitRoute; count: number; late: number };
type TrainRow = { v: LiveVehicle; route?: TransitRoute };

function LiveList({
  view,
  trains,
  lines,
  onPickLine,
  onClose,
  routeName,
}: {
  view: LiveView;
  trains: TrainRow[];
  lines: LineSummary[];
  onPickLine: (routeId: string) => void;
  onClose: () => void;
  routeName?: string;
}) {
  const title =
    view.kind === 'all'
      ? 'All trains right now'
      : view.kind === 'late'
        ? 'Trains running late'
        : view.kind === 'lines'
          ? 'Lines with trains out'
          : `${routeName ?? 'Line'} trains`;

  return (
    <div className="mt-4 border-t pt-3 hairline">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="text-[13px] font-bold">{title}</h3>
        <button
          type="button"
          onClick={onClose}
          className="rounded-full bg-[var(--bg-sunken)] px-3 py-1 text-[12px] font-semibold text-muted"
        >
          Close
        </button>
      </div>

      {view.kind === 'lines' ? (
        <ul className="space-y-1.5">
          {lines.map(({ route, count, late }) => (
            <li key={route.id}>
              <button
                type="button"
                onClick={() => onPickLine(route.id)}
                className="flex w-full items-center gap-3 rounded-2xl bg-[var(--bg-sunken)] px-3 py-2.5 text-left"
              >
                <span
                  className="grid h-7 min-w-9 place-items-center rounded-full px-2 text-[11px] font-extrabold text-white"
                  style={{ background: route.color ?? '#64748b' }}
                >
                  {route.code}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[14px] font-semibold">{route.name}</span>
                  <span className="text-[12px] text-muted">
                    {count} train{count === 1 ? '' : 's'} out
                    {late > 0 ? ` · ${late} running late` : ' · all on time'}
                  </span>
                </span>
                <span aria-hidden className="text-faint">›</span>
              </button>
            </li>
          ))}
        </ul>
      ) : trains.length === 0 ? (
        <p className="rounded-xl bg-[var(--bg-sunken)] px-3 py-3 text-[13px] text-muted">
          {view.kind === 'late' ? 'No trains are running late right now.' : 'No trains to show.'}
        </p>
      ) : (
        <ul className="space-y-1.5">
          {trains.map(({ v, route }) => (
            <TrainRowItem key={v.id} vehicle={v} route={route} />
          ))}
        </ul>
      )}
    </div>
  );
}

function TrainRowItem({ vehicle: v, route }: { vehicle: LiveVehicle; route?: TransitRoute }) {
  const delayMin = v.delaySeconds != null ? Math.round(v.delaySeconds / 60) : 0;
  const late = delayMin >= 2;
  const dest = (v.destination ?? '').replace(/\s+GO$/i, '');
  const nextStop = (v.nextStopName ?? '').replace(/\s+GO(\s+Bus)?$/i, '');

  return (
    <li className="overflow-hidden rounded-2xl bg-[var(--bg-sunken)]">
      <div className="flex items-stretch">
        <Link
          href={v.tripId ? `/trips/${encodeURIComponent(v.tripId)}` : '/map'}
          className="flex min-w-0 flex-1 items-center gap-3 px-3 py-2.5"
        >
          <span
            className="grid h-7 min-w-9 shrink-0 place-items-center rounded-full px-2 text-[11px] font-extrabold text-white"
            style={{ background: route?.color ?? '#64748b' }}
          >
            {route?.code ?? '?'}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[14px] font-semibold">
              {dest ? `to ${dest}` : (route?.name ?? 'Train')}
              {v.tripNumber ? (
                <span className="ml-1.5 text-[12px] font-medium text-faint">#{v.tripNumber}</span>
              ) : null}
            </span>
            <span className="block truncate text-[12px] text-muted">
              {v.isMoving === false ? 'Stopped' : 'Moving'}
              {nextStop ? ` · next ${nextStop}` : ''}
            </span>
            {late && v.delayReason ? (
              <span className="block truncate text-[11px] font-medium text-[var(--tile-amber-fg)]">
                {v.delayReason}
              </span>
            ) : null}
          </span>
          <span
            className="tabular shrink-0 rounded-full px-2.5 py-1 text-[12px] font-bold"
            style={
              late
                ? { background: 'var(--tile-amber-bg)', color: 'var(--tile-amber-fg)' }
                : { background: 'var(--tile-green-bg)', color: 'var(--tile-green-fg)' }
            }
          >
            {late ? `+${delayMin} min` : 'On time'}
          </span>
        </Link>
        {v.tripId ? (
          <Link
            href={`/map?trip=${encodeURIComponent(v.tripId)}`}
            aria-label="Show this train on the map"
            className="grid w-11 shrink-0 place-items-center border-l text-[var(--accent)] hairline"
          >
            <MapGlyph />
          </Link>
        ) : null}
      </div>
    </li>
  );
}
