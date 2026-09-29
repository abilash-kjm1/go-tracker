import 'server-only';

/**
 * A tiny key-value store for the few things the server has to remember between
 * requests — today, which phones asked to be told when a platform is posted.
 *
 * Backed by Upstash Redis over its REST API when the environment provides one,
 * which is what Vercel's own integration sets up. Without it the store falls
 * back to process memory: fine for a single machine in development, useless on
 * serverless where each request may land on a different instance. `durable`
 * says which of the two is in effect, so the UI never promises what it cannot
 * keep.
 */

const url =
  process.env.UPSTASH_REDIS_REST_URL ||
  process.env.KV_REST_API_URL ||
  process.env.REDIS_REST_URL ||
  '';
const token =
  process.env.UPSTASH_REDIS_REST_TOKEN ||
  process.env.KV_REST_API_TOKEN ||
  process.env.REDIS_REST_TOKEN ||
  '';

export const durable = Boolean(url && token);

const memory = new Map<string, string>();

async function command(...args: (string | number)[]): Promise<unknown> {
  const response = await fetch(`${url.replace(/\/$/, '')}/${args.map(encodeURIComponent).join('/')}`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: 'no-store',
  });
  if (!response.ok) throw new Error(`Store HTTP ${response.status}`);
  const body = (await response.json()) as { result?: unknown };
  return body.result;
}

/** Stores a value under a key, in a named set so it can be listed later. */
export async function put(set: string, key: string, value: unknown): Promise<void> {
  const payload = JSON.stringify(value);
  if (!durable) {
    memory.set(`${set}:${key}`, payload);
    return;
  }
  await command('set', `${set}:${key}`, payload);
  await command('sadd', set, key);
}

export async function remove(set: string, key: string): Promise<void> {
  if (!durable) {
    memory.delete(`${set}:${key}`);
    return;
  }
  await command('del', `${set}:${key}`);
  await command('srem', set, key);
}

/** Everything in a set, skipping entries that have gone missing. */
export async function list<T>(set: string): Promise<Array<{ key: string; value: T }>> {
  if (!durable) {
    const prefix = `${set}:`;
    return [...memory.entries()]
      .filter(([k]) => k.startsWith(prefix))
      .map(([k, v]) => ({ key: k.slice(prefix.length), value: JSON.parse(v) as T }));
  }

  const keys = ((await command('smembers', set)) as string[] | null) ?? [];
  const out: Array<{ key: string; value: T }> = [];
  for (const key of keys) {
    const raw = (await command('get', `${set}:${key}`)) as string | null;
    if (!raw) {
      await command('srem', set, key);
      continue;
    }
    try {
      out.push({ key, value: JSON.parse(raw) as T });
    } catch {
      await remove(set, key);
    }
  }
  return out;
}
