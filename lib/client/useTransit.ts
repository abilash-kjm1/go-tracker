'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { ApiEnvelope, DataFreshness } from '@/lib/transit/types';

export interface LiveState<T> {
  data: T | null;
  meta: ApiEnvelope<T>['meta'] | null;
  error: string | null;
  loading: boolean;
  /** Freshness after accounting for fetch failures and the browser being offline. */
  freshness: DataFreshness;
  refresh: () => void;
}

interface Options {
  /** Poll interval in ms. 0 disables polling. */
  intervalMs?: number;
  enabled?: boolean;
}

/**
 * Polls one of our API routes. Pauses while the tab is hidden and while the
 * browser is offline, and keeps the last payload on screen (clearly labelled)
 * rather than blanking the UI when a refresh fails.
 */
export function useTransit<T>(url: string | null, { intervalMs = 0, enabled = true }: Options = {}) {
  const [data, setData] = useState<T | null>(null);
  const [meta, setMeta] = useState<ApiEnvelope<T>['meta'] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(Boolean(url && enabled));
  const abortRef = useRef<AbortController | null>(null);
  const urlRef = useRef(url);
  urlRef.current = url;

  const load = useCallback(async () => {
    const target = urlRef.current;
    if (!target) return;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      // No `cache: 'no-store'`: the API answers `max-age=0` so the browser always
      // revalidates, and forcing a bypass would also defeat the CDN in front of it.
      const res = await fetch(target, { signal: controller.signal });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error ?? `Request failed (${res.status})`);
      setData((body as ApiEnvelope<T>).data);
      setMeta((body as ApiEnvelope<T>).meta);
      setError(null);
    } catch (err) {
      if ((err as Error).name === 'AbortError') return;
      setError(err instanceof Error ? err.message : 'Request failed');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!url || !enabled) {
      setLoading(false);
      return;
    }
    setLoading(true);
    void load();

    if (!intervalMs) return;

    let timer: ReturnType<typeof setInterval> | null = null;
    const start = () => {
      timer ??= setInterval(() => {
        if (document.visibilityState === 'visible' && navigator.onLine) void load();
      }, intervalMs);
    };
    const stop = () => {
      if (timer) clearInterval(timer);
      timer = null;
    };
    const onVisible = () => {
      if (document.visibilityState === 'visible') {
        void load();
        start();
      } else stop();
    };

    start();
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('online', onVisible);
    return () => {
      stop();
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('online', onVisible);
      abortRef.current?.abort();
    };
  }, [url, enabled, intervalMs, load]);

  const online = useOnline();

  let freshness: DataFreshness = meta?.freshness ?? 'unavailable';
  if (!online && data) freshness = 'stale';
  if (error && !data) freshness = 'unavailable';
  if (error && data) freshness = 'stale';

  return { data, meta, error, loading, freshness, refresh: load } satisfies LiveState<T>;
}

export function useOnline(): boolean {
  const [online, setOnline] = useState(true);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    update();
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);
  return online;
}

/** Re-renders on a timer so countdowns stay honest between polls. */
export function useTicker(ms = 15_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}
