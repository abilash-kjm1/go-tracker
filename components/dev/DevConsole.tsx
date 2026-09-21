'use client';

import { useState } from 'react';
import { formatAge } from '@/lib/transit/time';
import { useTicker, useTransit } from '@/lib/client/useTransit';
import type { ProviderHealth } from '@/lib/transit/types';

interface ProbeResult {
  ok: boolean;
  latencyMs?: number;
  summary?: Record<string, unknown>;
  raw?: string;
  error?: string;
}

const PROBES = [
  { kind: 'vehicles', label: 'Test Live Vehicles', arg: '' },
  { kind: 'board', label: 'Test Rail Platform Board', arg: 'LW/BU' },
  { kind: 'busboard', label: 'Test Bus Platform Board', arg: 'brptnT' },
  { kind: 'terminals', label: 'Test Bus Terminals', arg: '' },
  { kind: 'station', label: 'Test Legacy Station Status', arg: 'UN' },
  { kind: 'message', label: 'Test Station Message', arg: 'UN' },
  { kind: 'search', label: 'Test Search', arg: 'niagara' },
  { kind: 'trip', label: 'Test Trip', arg: '' },
  { kind: 'provider', label: 'Test Provider', arg: '' },
] as const;

export function DevConsole({ initialHealth }: { initialHealth: ProviderHealth }) {
  const now = useTicker(1000);
  const [results, setResults] = useState<Record<string, ProbeResult | 'loading'>>({});
  const [args, setArgs] = useState<Record<string, string>>(
    Object.fromEntries(PROBES.map((p) => [p.kind, p.arg])),
  );
  const [expanded, setExpanded] = useState<string | null>(null);

  const { data: live } = useTransit<ProviderHealth>('/api/transit/health', { intervalMs: 10_000 });
  const health = live ?? initialHealth;

  const run = async (kind: string) => {
    setResults((r) => ({ ...r, [kind]: 'loading' }));
    try {
      const res = await fetch(
        `/api/dev/probe?kind=${kind}&arg=${encodeURIComponent(args[kind] ?? '')}`,
        { cache: 'no-store' },
      );
      const body = await res.json();
      setResults((r) => ({ ...r, [kind]: body }));
    } catch (err) {
      setResults((r) => ({
        ...r,
        [kind]: { ok: false, error: err instanceof Error ? err.message : 'failed' },
      }));
    }
  };

  return (
    <div className="mx-auto w-full max-w-3xl px-4 pt-safe">
      <header className="pt-6 pb-4">
        <p className="text-[11px] font-semibold tracking-wide text-faint uppercase">
          Developer only
        </p>
        <h1 className="mt-1 text-[28px] leading-tight font-semibold tracking-tight">
          Transit diagnostics
        </h1>
        <p className="mt-1 text-[13px] text-muted">
          Blocked in production unless ENABLE_DEV_TRANSIT_PAGE is set.
        </p>
      </header>

      <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-2xl border bg-[var(--border)] text-sm hairline sm:grid-cols-3">
        <Stat label="Provider" value={health.providerLabel} />
        <Stat label="Status" value={health.connected ? 'Connected' : 'Disconnected'} />
        <Stat
          label="Last success"
          value={health.lastSuccessAt ? formatAge(health.lastSuccessAt, now) : 'never'}
        />
        <Stat label="Live vehicles" value={String(health.counts.liveVehicles)} />
        <Stat label="Train vehicles" value={String(health.counts.trainVehicles)} />
        <Stat label="Bus vehicles" value={String(health.counts.busVehicles)} />
        <Stat label="Stops" value={String(health.counts.stops)} />
        <Stat label="Routes" value={String(health.counts.routes)} />
        <Stat
          label="Upstream latency"
          value={health.latencyMs != null ? `${health.latencyMs} ms` : '—'}
        />
      </dl>

      {health.lastError ? (
        <p className="mt-3 rounded-xl bg-alert-500/10 px-3 py-2 text-[13px] text-alert-500">
          Last error: {health.lastError}
          {health.lastErrorAt ? ` (${formatAge(health.lastErrorAt, now)})` : ''}
        </p>
      ) : null}

      {health.staticData ? (
        <p className="mt-3 rounded-xl bg-[var(--bg-sunken)] px-3 py-2 text-[13px] text-muted">
          Static data: {health.staticData.source}, feed {health.staticData.feedVersion ?? '?'},{' '}
          {health.staticData.datesAvailable.length} days from{' '}
          {health.staticData.datesAvailable[0] ?? '—'}.
        </p>
      ) : null}

      <section className="mt-6 space-y-2 pb-12">
        {PROBES.map((probe) => {
          const result = results[probe.kind];
          return (
            <div key={probe.kind} className="rounded-2xl border px-4 py-3 hairline">
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => run(probe.kind)}
                  className="min-h-10 rounded-xl bg-[var(--accent)] px-3 text-sm font-semibold text-[var(--accent-fg)]"
                >
                  {probe.label}
                </button>
                {['station', 'message', 'search', 'trip', 'board', 'busboard'].includes(probe.kind) ? (
                  <input
                    value={args[probe.kind] ?? ''}
                    onChange={(e) => setArgs((a) => ({ ...a, [probe.kind]: e.target.value }))}
                    placeholder={probe.kind === 'trip' ? 'trip number' : 'argument'}
                    aria-label={`${probe.label} argument`}
                    className="min-h-10 w-40 rounded-xl border px-3 text-sm hairline bg-[var(--bg-elevated)]"
                  />
                ) : null}
                {result && result !== 'loading' ? (
                  <span
                    className={`text-[13px] font-medium ${result.ok ? 'text-signal-600 dark:text-signal-300' : 'text-alert-500'}`}
                  >
                    {result.ok ? 'OK' : 'FAILED'}
                    {result.latencyMs != null ? ` · ${result.latencyMs} ms` : ''}
                  </span>
                ) : result === 'loading' ? (
                  <span className="text-[13px] text-muted">running…</span>
                ) : null}
              </div>

              {result && result !== 'loading' ? (
                <div className="mt-2 space-y-2">
                  {result.summary ? (
                    <pre className="overflow-x-auto rounded-lg bg-[var(--bg-sunken)] p-2 text-[12px]">
                      {JSON.stringify(result.summary, null, 2)}
                    </pre>
                  ) : null}
                  {result.error ? (
                    <p className="text-[13px] text-alert-500">{result.error}</p>
                  ) : null}
                  {result.raw ? (
                    <details
                      open={expanded === probe.kind}
                      onToggle={(e) =>
                        setExpanded((e.currentTarget as HTMLDetailsElement).open ? probe.kind : null)
                      }
                    >
                      <summary className="cursor-pointer text-[13px] font-medium text-muted">
                        Raw upstream response
                      </summary>
                      <pre className="mt-2 max-h-80 overflow-auto rounded-lg bg-[var(--bg-sunken)] p-2 text-[11px] break-all whitespace-pre-wrap">
                        {result.raw}
                      </pre>
                    </details>
                  ) : null}
                </div>
              ) : null}
            </div>
          );
        })}
      </section>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-[var(--bg-elevated)] px-3 py-3">
      <dt className="text-[11px] font-semibold tracking-wide text-faint uppercase">{label}</dt>
      <dd className="mt-0.5 truncate font-medium">{value}</dd>
    </div>
  );
}
