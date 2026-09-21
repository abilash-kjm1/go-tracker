'use client';

import clsx from 'clsx';

import { useEffect, useMemo, useState } from 'react';
import { DepartureCard } from './DepartureCard';
import { directionColors, groupByDirection } from './directions';
import { LiveIndicator } from '@/components/ui/LiveIndicator';
import { EmptyState, ModeIcon, Segmented, Skeleton } from '@/components/ui/primitives';
import { useTransit } from '@/lib/client/useTransit';
import type { Departure, VehicleType } from '@/lib/transit/types';

type ModeFilter = 'all' | VehicleType;
type BoardKind = 'departures' | 'arrivals';

export function DepartureBoard({
  stationId,
  availableModes,
  homeStopId,
}: {
  stationId: string;
  availableModes: VehicleType[];
  /** Rows from a different stop at the same site are labelled with it. */
  homeStopId?: string;
}) {
  const [kind, setKind] = useState<BoardKind>('departures');
  const [mode, setMode] = useState<ModeFilter>('all');

  const { data, meta, error, loading, freshness } = useTransit<Departure[]>(
    `/api/transit/stations/${encodeURIComponent(stationId)}/${kind}?limit=40`,
    { intervalMs: 30_000 },
  );

  const rows = (data ?? []).filter((d) => mode === 'all' || d.vehicleType === mode);
  const showModeFilter = availableModes.length > 1;

  const groups = useMemo(() => groupByDirection(rows), [rows]);
  const [activeKey, setActiveKey] = useState<string | null>(null);

  // Directions come and go as the board refreshes or the mode filter changes,
  // so fall back to the first rather than showing nothing.
  const activeGroup = groups.find((g) => g.key === activeKey) ?? groups[0];
  const resolvedKey = activeGroup?.key ?? null;
  useEffect(() => {
    if (activeKey !== resolvedKey) setActiveKey(resolvedKey);
  }, [activeKey, resolvedKey]);

  return (
    <section className="space-y-3">
      {/* Row 1: which board, and whether it is live. */}
      <div className="flex items-center justify-between gap-3">
        <Segmented<BoardKind>
          value={kind}
          onChange={setKind}
          ariaLabel="Board type"
          options={[
            { value: 'departures', label: 'Departures' },
            { value: 'arrivals', label: 'Arrivals' },
          ]}
        />
        <LiveIndicator freshness={freshness} updatedAt={meta?.updatedAt ?? null} compact />
      </div>

      {/* Row 2: what kind of vehicle. Stretches to the full width so the three
          options are evenly sized instead of hugging the left edge. */}
      {showModeFilter ? (
        <Segmented<ModeFilter>
          value={mode}
          onChange={setMode}
          ariaLabel="Filter by vehicle type"
          className="flex w-full"
          optionClassName="flex-1 justify-center"
          options={[
            { value: 'all', label: 'All' },
            ...availableModes.map((m) => ({
              value: m,
              label: (
                <span className="flex items-center gap-1.5">
                  <ModeIcon type={m} className="size-4" />
                  {m === 'train' ? 'Trains' : m === 'bus' ? 'Buses' : 'Other'}
                </span>
              ),
            })),
          ]}
        />
      ) : null}

      {meta?.degraded ? (
        <p className="rounded-xl bg-[var(--bg-sunken)] px-3 py-2 text-[12px] text-muted">
          {meta.degraded}
        </p>
      ) : null}

      {rows.some((r) => r.platformNote) && !rows.some((r) => r.platform) ? (
        <p className="text-[12px] text-faint">
          {rows.find((r) => r.platformNote)?.platformNote} &mdash; GO posts it to the station
          screens a few minutes before departure.
        </p>
      ) : null}

      {error && !data ? (
        <EmptyState
          title="GO real-time data is temporarily unavailable."
          body={
            meta?.updatedAt
              ? `Last successful update ${new Date(meta.updatedAt).toLocaleTimeString()}.`
              : error
          }
        />
      ) : null}

      {loading && !data ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }, (_, i) => (
            <Skeleton key={i} className="h-[104px] rounded-2xl" />
          ))}
        </div>
      ) : null}

      {data && rows.length === 0 ? (
        <EmptyState
          title={`No ${kind} in the next few hours`}
          body="Nothing is scheduled from this stop in the current window."
        />
      ) : null}

      {/*
        Split by travel direction, the way GO's own station screens do.
        Side by side once there is room; below that a switcher, because
        stacking them buries the second direction a full screen down.
      */}
      {groups.length > 1 ? (
        <div
          role="group"
          aria-label="Direction"
          className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4 pb-0.5 min-[680px]:hidden"
        >
          {groups.map((group) => {
            const colors = directionColors(group.tone);
            const active = group.key === resolvedKey;
            return (
              <button
                key={group.key}
                type="button"
                onClick={() => setActiveKey(group.key)}
                aria-pressed={active}
                className="flex min-h-10 min-w-0 shrink-0 items-center gap-1.5 rounded-full border px-3.5 text-[13px] font-semibold whitespace-nowrap transition-colors"
                style={
                  active
                    ? { background: colors.surface, borderColor: colors.border, color: colors.fg }
                    : { borderColor: 'var(--border)', color: 'var(--fg-muted)' }
                }
              >
                {group.shortLabel}
                <span className="tabular text-[11px] opacity-70">{group.departures.length}</span>
              </button>
            );
          })}
        </div>
      ) : null}

      <div className={clsx('grid gap-x-4 gap-y-5', groups.length > 1 && 'min-[680px]:grid-cols-2')}>
        {groups.map((group) => {
          const colors = directionColors(group.tone);
          const active = group.key === resolvedKey;
          return (
            <section
              key={group.key}
              aria-label={group.label}
              // Both are always rendered; the switcher only governs the
              // narrow layout, so the two columns stay intact on desktop.
              className={clsx('min-w-0', !active && 'hidden min-[680px]:block')}
            >
              <h3 className="sticky top-0 z-10 mb-2 hidden items-start gap-2 bg-[var(--bg)]/95 py-1.5 backdrop-blur min-[680px]:flex">
                <span
                  aria-hidden
                  className="mt-[5px] h-3 w-1 shrink-0 rounded-full"
                  style={{ background: colors.fg }}
                />
                <span
                  className="text-[13px] leading-snug font-semibold tracking-tight text-balance"
                  style={{ color: colors.fg }}
                >
                  {group.label}
                </span>
                <span
                  className="tabular mt-px shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold"
                  style={{ background: colors.surface, color: colors.fg }}
                >
                  {group.departures.length}
                </span>
              </h3>

              {/* On narrow screens the switcher is the heading, but the full
                  wording still belongs on the page for screen readers. */}
              <p className="sr-only min-[680px]:hidden">{group.label}</p>

              <ul className="space-y-2">
                {group.departures.map((departure, index) => (
                  <li
                    key={departure.id}
                    className="animate-rise"
                    style={{ animationDelay: `${Math.min(index, 8) * 18}ms` }}
                  >
                    <DepartureCard departure={departure} tone={group.tone} heading={group.compass} />
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
      </div>
    </section>
  );
}
