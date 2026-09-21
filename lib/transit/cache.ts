import 'server-only';

/**
 * A TTL cache with in-flight request coalescing. One hundred people watching
 * Niagara Falls GO produce one upstream request, not one hundred — and if that
 * request fails we keep serving the last good value, clearly marked as stale.
 */

interface Entry<T> {
  value: T;
  storedAt: number;
  /** Set when the most recent refresh failed but we still hold an older value. */
  lastError?: string;
  lastErrorAt?: number;
}

export interface CachedResult<T> {
  value: T;
  /** When the value was actually fetched from upstream. */
  updatedAt: Date;
  ageSeconds: number;
  fromCache: boolean;
  /** Present when the newest refresh attempt failed. */
  error?: string;
}

const store = new Map<string, Entry<unknown>>();
const inFlight = new Map<string, Promise<unknown>>();

export interface CacheStats {
  lastSuccessAt: number | null;
  lastErrorAt: number | null;
  lastError: string | null;
  lastLatencyMs: number | null;
}

const stats: CacheStats = {
  lastSuccessAt: null,
  lastErrorAt: null,
  lastError: null,
  lastLatencyMs: null,
};

export const upstreamStats = (): CacheStats => ({ ...stats });

export function recordUpstream(ok: boolean, latencyMs: number, error?: string) {
  stats.lastLatencyMs = latencyMs;
  if (ok) {
    stats.lastSuccessAt = Date.now();
  } else {
    stats.lastErrorAt = Date.now();
    stats.lastError = error ?? 'unknown error';
  }
}

export async function cached<T>(
  key: string,
  ttlSeconds: number,
  loader: () => Promise<T>,
): Promise<CachedResult<T>> {
  const now = Date.now();
  const hit = store.get(key) as Entry<T> | undefined;

  if (hit && now - hit.storedAt < ttlSeconds * 1000) {
    return {
      value: hit.value,
      updatedAt: new Date(hit.storedAt),
      ageSeconds: Math.round((now - hit.storedAt) / 1000),
      fromCache: true,
      error: hit.lastError,
    };
  }

  let pending = inFlight.get(key) as Promise<T> | undefined;
  if (!pending) {
    pending = (async () => {
      const started = Date.now();
      try {
        const value = await loader();
        recordUpstream(true, Date.now() - started);
        store.set(key, { value, storedAt: Date.now() });
        return value;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        recordUpstream(false, Date.now() - started, message);
        const stale = store.get(key) as Entry<T> | undefined;
        if (stale) {
          // Keep serving the last good value rather than blanking the app.
          stale.lastError = message;
          stale.lastErrorAt = Date.now();
          throw Object.assign(new Error(message), { staleEntry: stale });
        }
        throw err;
      } finally {
        inFlight.delete(key);
      }
    })();
    inFlight.set(key, pending);
  }

  try {
    const value = await pending;
    const entry = store.get(key)!;
    return {
      value,
      updatedAt: new Date(entry.storedAt),
      ageSeconds: Math.round((Date.now() - entry.storedAt) / 1000),
      fromCache: false,
    };
  } catch (err) {
    const stale = (err as { staleEntry?: Entry<T> }).staleEntry;
    if (stale) {
      return {
        value: stale.value,
        updatedAt: new Date(stale.storedAt),
        ageSeconds: Math.round((Date.now() - stale.storedAt) / 1000),
        fromCache: true,
        error: stale.lastError,
      };
    }
    throw err;
  }
}

/** Last known value for a key, without triggering a fetch. */
export function peek<T>(key: string): CachedResult<T> | null {
  const hit = store.get(key) as Entry<T> | undefined;
  if (!hit) return null;
  return {
    value: hit.value,
    updatedAt: new Date(hit.storedAt),
    ageSeconds: Math.round((Date.now() - hit.storedAt) / 1000),
    fromCache: true,
    error: hit.lastError,
  };
}

export function clearCache() {
  store.clear();
  inFlight.clear();
}
