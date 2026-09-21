'use client';

import clsx from 'clsx';
import { ModeIcon } from '@/components/ui/primitives';
import { formatClockParts, formatCountdown } from '@/lib/transit/time';
import { useTicker, useTransit } from '@/lib/client/useTransit';
import type { Departure } from '@/lib/transit/types';

/**
 * A style gallery: the same live departures rendered five ways, so a design
 * can be chosen by looking rather than by describing. Dev-only — this is a
 * decision aid, not part of the app.
 */
export function CardStyles({ stationId = 'BU' }: { stationId?: string }) {
  const { data } = useTransit<Departure[]>(
    `/api/transit/stations/${encodeURIComponent(stationId)}/departures?limit=12`,
    { intervalMs: 60_000 },
  );

  // Three contrasting rows: on time, delayed, and express if one is running.
  const rows = (data ?? []).filter((d) => d.arrivalTime);
  const sample = [
    rows.find((r) => !r.delaySeconds && !r.express),
    rows.find((r) => (r.delaySeconds ?? 0) >= 60),
    rows.find((r) => r.express),
  ].filter(Boolean) as Departure[];
  const picks = (sample.length ? sample : rows).slice(0, 3);

  if (!picks.length) {
    return <p className="px-4 py-10 text-center text-sm text-muted">Loading live departures…</p>;
  }

  const styles = [
    { id: 'A', name: 'Boarding pass', note: 'Route colour as a solid block, ticket-stub platform.', render: StyleA },
    { id: 'B', name: 'Editorial', note: 'Huge type, no borders, whitespace does the work.', render: StyleB },
    { id: 'C', name: 'Coloured header', note: 'Solid line-colour header band over a clean body.', render: StyleC },
    { id: 'D', name: 'Soft tint', note: 'Tinted surface, deeper shadow, pill platform.', render: StyleD },
    { id: 'E', name: 'Timetable', note: 'No cards — aligned rows, hairlines, one dot of colour.', render: StyleE },
  ] as const;

  return (
    <div className="mx-auto w-full max-w-2xl px-4 pt-safe">
      <header className="pt-6 pb-2">
        <h1 className="text-[26px] leading-tight font-semibold tracking-tight">Card styles</h1>
        <p className="mt-1 text-[13px] text-muted">
          Same live departures, five designs. Pick one by letter.
        </p>
      </header>

      {styles.map((style) => (
        <section key={style.id} className="py-6">
          <div className="mb-3 flex items-baseline gap-2">
            <span className="grid size-6 place-items-center rounded-md bg-[var(--fg)] text-[12px] font-bold text-[var(--bg)]">
              {style.id}
            </span>
            <h2 className="text-[15px] font-semibold">{style.name}</h2>
          </div>
          <p className="mb-3 text-[12px] text-faint">{style.note}</p>
          <div className={style.id === 'E' ? '' : 'space-y-2'}>
            {picks.map((d) => (
              <style.render key={`${style.id}-${d.id}`} d={d} />
            ))}
          </div>
        </section>
      ))}

      <div className="h-16" />
    </div>
  );
}

// ---- shared helpers ------------------------------------------------------

function useBits(d: Departure) {
  const now = useTicker(15_000);
  const delayMin = d.delaySeconds != null ? Math.round(d.delaySeconds / 60) : 0;
  const late = !d.cancelled && delayMin >= 1;
  const depart = formatClockParts(d.scheduledTime);
  const arrive = formatClockParts(late ? (d.arrivalEstimated ?? d.arrivalTime) : d.arrivalTime);
  const countdown = formatCountdown(d.estimatedTime ?? d.scheduledTime, now);
  const status = d.cancelled
    ? 'Cancelled'
    : late
      ? `${delayMin} min late`
      : d.realtime
        ? 'On time'
        : 'Scheduled';
  const plat = d.platform?.replace(/^platforms?\s*/i, '');
  const dur = d.durationMinutes
    ? d.durationMinutes >= 60
      ? `${Math.floor(d.durationMinutes / 60)}h ${d.durationMinutes % 60}m`
      : `${d.durationMinutes} min`
    : null;
  return { late, depart, arrive, countdown, status, plat, dur, color: d.routeColor ?? '#10b981' };
}

const statusColor = (late: boolean, realtime: boolean) =>
  late ? 'var(--color-warn-500)' : realtime ? 'var(--color-signal-500)' : 'var(--fg-faint)';

// ---- A. Boarding pass ----------------------------------------------------

function StyleA({ d }: { d: Departure }) {
  const b = useBits(d);
  return (
    <article className="flex overflow-hidden rounded-2xl border hairline bg-[var(--bg-elevated)]">
      <div
        className="flex w-11 shrink-0 flex-col items-center justify-center gap-1 py-3 text-white"
        style={{ background: b.color }}
      >
        <span className="text-[13px] font-bold">{d.serviceCode ?? d.routeCode}</span>
        <ModeIcon type={d.vehicleType} className="size-4" />
      </div>

      <div className="min-w-0 flex-1 px-3.5 py-3">
        <p className="tabular text-[22px] leading-none font-semibold tracking-tight">
          {b.depart.time}
          <span className="ml-1 text-[11px] text-faint">{b.depart.suffix.replace(/\./g, '')}</span>
        </p>
        <p className="mt-1.5 truncate text-[14px] font-medium">{d.arrivalStopName}</p>
        <p className="mt-1 text-[12px] text-muted">
          arrives {b.arrive.time} · {b.dur}
        </p>
      </div>

      <div className="flex w-[74px] shrink-0 flex-col items-center justify-center gap-1 border-l border-dashed px-2 hairline">
        {b.plat ? (
          <>
            <span className="text-[8px] font-bold tracking-[0.1em] text-faint uppercase">Plat</span>
            <span className="tabular text-[20px] leading-none font-bold">{b.plat}</span>
          </>
        ) : (
          <span className="text-[11px] text-faint">—</span>
        )}
        <span
          className="mt-1 text-[10px] font-semibold"
          style={{ color: statusColor(b.late, d.realtime) }}
        >
          {b.countdown}
        </span>
      </div>
    </article>
  );
}

// ---- B. Editorial --------------------------------------------------------

function StyleB({ d }: { d: Departure }) {
  const b = useBits(d);
  return (
    <article className="border-b py-4 hairline">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="tabular text-[34px] leading-none font-semibold tracking-tighter">
            {b.depart.time}
            <span className="ml-1.5 text-[12px] font-medium text-faint">
              {b.depart.suffix.replace(/\./g, '')}
            </span>
          </p>
          <p className="mt-2 truncate text-[17px] leading-tight font-medium">{d.arrivalStopName}</p>
          <p className="mt-1 text-[12px] text-faint">
            {d.serviceCode ?? d.routeCode} · {d.routeName} · arrives {b.arrive.time}
          </p>
        </div>
        <div className="shrink-0 text-right">
          <p className="tabular text-[15px] font-semibold">{b.countdown}</p>
          <p className="mt-1 text-[11px]" style={{ color: statusColor(b.late, d.realtime) }}>
            {b.status}
          </p>
          {b.plat ? <p className="tabular mt-2 text-[13px] font-bold">Plat {b.plat}</p> : null}
        </div>
      </div>
    </article>
  );
}

// ---- C. Coloured header --------------------------------------------------

function StyleC({ d }: { d: Departure }) {
  const b = useBits(d);
  return (
    <article className="overflow-hidden rounded-2xl border hairline bg-[var(--bg-elevated)]">
      <div
        className="flex items-center gap-2 px-3.5 py-2 text-white"
        style={{ background: b.color }}
      >
        <ModeIcon type={d.vehicleType} className="size-4" />
        <span className="text-[13px] font-bold">{d.serviceCode ?? d.routeCode}</span>
        <span className="min-w-0 flex-1 truncate text-[12px] opacity-90">{d.routeName}</span>
        {d.express ? (
          <span className="rounded bg-white/25 px-1.5 py-0.5 text-[9px] font-bold tracking-wide uppercase">
            Express
          </span>
        ) : null}
      </div>

      <div className="flex items-end justify-between gap-3 px-3.5 py-3">
        <div className="min-w-0">
          <p className="tabular text-[24px] leading-none font-semibold tracking-tight">
            {b.depart.time}
            <span className="ml-1 text-[11px] text-faint">{b.depart.suffix.replace(/\./g, '')}</span>
          </p>
          <p className="mt-1.5 truncate text-[14px] font-medium">{d.arrivalStopName}</p>
          <p className="mt-0.5 text-[12px] text-muted">
            arrives {b.arrive.time} · {b.dur}
          </p>
        </div>
        <div className="shrink-0 text-right">
          {b.plat ? (
            <p className="tabular text-[20px] leading-none font-bold">
              <span className="mr-1 text-[9px] font-bold text-faint uppercase">Plat</span>
              {b.plat}
            </p>
          ) : null}
          <p className="mt-2 text-[12px] font-semibold" style={{ color: statusColor(b.late, d.realtime) }}>
            {b.status}
          </p>
          <p className="tabular mt-0.5 text-[12px] font-semibold">{b.countdown}</p>
        </div>
      </div>
    </article>
  );
}

// ---- D. Soft tint --------------------------------------------------------

function StyleD({ d }: { d: Departure }) {
  const b = useBits(d);
  return (
    <article
      className="rounded-3xl px-4 py-4"
      style={{
        background: `color-mix(in oklab, ${b.color} 8%, var(--bg-elevated))`,
        boxShadow: 'var(--shadow-card)',
        border: `1px solid color-mix(in oklab, ${b.color} 22%, transparent)`,
      }}
    >
      <div className="flex items-center gap-2">
        <span
          className="grid size-7 shrink-0 place-items-center rounded-full text-[11px] font-bold text-white"
          style={{ background: b.color }}
        >
          {d.serviceCode ?? d.routeCode}
        </span>
        <span className="min-w-0 flex-1 truncate text-[13px] font-medium">{d.routeName}</span>
        <span
          className="rounded-full px-2 py-1 text-[11px] font-semibold"
          style={{ background: 'var(--bg-elevated)', color: statusColor(b.late, d.realtime) }}
        >
          {b.status}
        </span>
      </div>

      <div className="mt-3 flex items-baseline gap-2">
        <p className="tabular text-[26px] leading-none font-semibold tracking-tight">
          {b.depart.time}
        </p>
        <span className="text-[11px] text-faint">{b.depart.suffix.replace(/\./g, '')}</span>
        <span className="text-faint">→</span>
        <p className="tabular text-[17px] leading-none font-medium text-muted">{b.arrive.time}</p>
      </div>
      <p className="mt-1.5 truncate text-[13px] text-muted">{d.arrivalStopName}</p>

      <div className="mt-3 flex items-center justify-between">
        <span className="tabular text-[13px] font-semibold">{b.countdown}</span>
        {b.plat ? (
          <span
            className="rounded-full px-3 py-1 text-[12px] font-bold text-white"
            style={{ background: b.color }}
          >
            Platform {b.plat}
          </span>
        ) : null}
      </div>
    </article>
  );
}

// ---- E. Timetable --------------------------------------------------------

function StyleE({ d }: { d: Departure }) {
  const b = useBits(d);
  return (
    <div className="flex items-center gap-3 border-b py-3 hairline">
      <span className="size-2 shrink-0 rounded-full" style={{ background: b.color }} aria-hidden />
      <p className="tabular w-[66px] shrink-0 text-[17px] leading-none font-semibold">
        {b.depart.time}
        <span className="ml-0.5 text-[9px] text-faint">{b.depart.suffix.replace(/\./g, '')}</span>
      </p>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[14px] font-medium">{d.arrivalStopName}</p>
        <p className="truncate text-[11px] text-faint">
          {d.serviceCode ?? d.routeCode} · arrives {b.arrive.time} ·{' '}
          <span style={{ color: statusColor(b.late, d.realtime) }}>{b.status}</span>
        </p>
      </div>
      <div className="shrink-0 text-right">
        {b.plat ? <p className="tabular text-[15px] leading-none font-bold">{b.plat}</p> : null}
        <p className="tabular mt-1 text-[11px] text-muted">{b.countdown}</p>
      </div>
    </div>
  );
}
