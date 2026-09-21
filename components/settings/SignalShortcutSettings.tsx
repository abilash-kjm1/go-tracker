'use client';

import { useMemo, useState } from 'react';
import { useDangleStops } from '@/lib/client/dangleStops';
import { useFavorites } from '@/lib/client/favorites';
import { useTransit } from '@/lib/client/useTransit';
import type { TransitStop } from '@/lib/transit/types';

const tidy = (name: string) => name.replace(/\s+GO(\s+Bus)?$/i, '');

/**
 * Chooses what the hanging signal lamp opens. Up to four stations; tapping the
 * lamp steps through them and holding it opens the one showing.
 */
export function SignalShortcutSettings() {
  const { stops, hidden, ready, add, remove, setHidden } = useDangleStops();
  const { favorites } = useFavorites();
  const [query, setQuery] = useState('');

  const { data: allStops } = useTransit<TransitStop[]>('/api/transit/stations?limit=1000');

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const chosen = new Set(stops.map((s) => s.id));
    return (allStops ?? [])
      .filter((s) => !chosen.has(s.id) && s.name.toLowerCase().includes(q))
      // Stations before their bus stops, so "Burlington" finds the station first.
      .sort((a, b) => Number(b.modes.includes('train')) - Number(a.modes.includes('train')))
      .slice(0, 6);
  }, [allStops, query, stops]);

  const starred = favorites.filter((f) => f.kind === 'stop');
  const full = stops.length >= 4;

  return (
    <div className="space-y-4">
      <label className="flex items-center justify-between gap-4">
        <span className="min-w-0">
          <span className="block text-[14px] font-semibold">Show the signal lamp</span>
          <span className="block text-[12.5px] text-muted">
            Hangs in the corner. Tap it to change station, hold it to open.
          </span>
        </span>
        <button
          type="button"
          role="switch"
          aria-checked={!hidden}
          onClick={() => setHidden(!hidden)}
          className="relative h-7 w-12 shrink-0 rounded-full transition-colors"
          style={{ background: hidden ? 'var(--border-strong)' : 'var(--accent)' }}
        >
          <span
            className="absolute top-1 size-5 rounded-full bg-white shadow transition-all"
            style={{ left: hidden ? 4 : 24 }}
          />
        </button>
      </label>

      {!hidden ? (
        <>
          <div>
            <p className="mb-2 text-[12px] font-semibold tracking-wide text-faint uppercase">
              Stations it opens
            </p>

            {ready && stops.length === 0 ? (
              <p className="rounded-xl bg-[var(--bg-sunken)] px-3 py-2.5 text-[13px] text-muted">
                {starred.length > 0
                  ? `Using your ${starred.length} favourite stop${starred.length === 1 ? '' : 's'}. Add one below to choose for yourself.`
                  : 'Using Union Station. Add a station below to change it.'}
              </p>
            ) : null}

            <ul className="space-y-1.5">
              {stops.map((stop, i) => (
                <li
                  key={stop.id}
                  className="flex items-center gap-3 rounded-xl bg-[var(--bg-sunken)] px-3 py-2.5"
                >
                  <span className="tabular grid size-6 shrink-0 place-items-center rounded-full bg-[var(--bg-elevated)] text-[11px] font-bold text-muted">
                    {i + 1}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-[14px] font-medium">
                    {tidy(stop.name)}
                  </span>
                  <button
                    type="button"
                    onClick={() => remove(stop.id)}
                    aria-label={`Remove ${tidy(stop.name)}`}
                    className="shrink-0 rounded-full px-2.5 py-1 text-[12px] font-semibold text-muted hover:bg-[var(--bg-elevated)]"
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          </div>

          {full ? (
            <p className="text-[12.5px] text-muted">
              Four is the most it will hold. Remove one to add another.
            </p>
          ) : (
            <div className="relative">
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Add a station or stop"
                aria-label="Add a station to the signal lamp"
                className="min-h-12 w-full rounded-xl border px-3.5 text-[14px] outline-none hairline bg-[var(--bg-elevated)] focus:border-[var(--accent)]"
              />
              {matches.length > 0 ? (
                <ul className="absolute inset-x-0 top-full z-20 mt-1 overflow-hidden rounded-xl p-1 surface">
                  {matches.map((stop) => (
                    <li key={stop.id}>
                      <button
                        type="button"
                        onClick={() => {
                          add({ id: stop.id, name: stop.name });
                          setQuery('');
                        }}
                        className="flex min-h-11 w-full items-center rounded-lg px-3 text-left text-[14px] hover:bg-[var(--bg-sunken)]"
                      >
                        <span className="truncate">{stop.name}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          )}
        </>
      ) : null}
    </div>
  );
}
