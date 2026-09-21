import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const PORT = Number(process.env.PORT) || 3000;
const API_KEY = process.env.GO_API_KEY || '';
const UPSTREAM = 'https://api.openmetrolinx.com/OpenDataAPI';
const PUBLIC_DIR = fileURLToPath(new URL('./public/', import.meta.url));

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.json': 'application/json; charset=utf-8',
};

// Small in-memory cache so a room full of browsers doesn't hammer Metrolinx.
const cache = new Map();

async function upstream(path, ttlMs) {
  const hit = cache.get(path);
  if (hit && Date.now() - hit.at < ttlMs) return hit.body;

  const url = `${UPSTREAM}/${path}${path.includes('?') ? '&' : '?'}key=${encodeURIComponent(API_KEY)}`;
  const res = await fetch(url, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(15_000),
  });
  const text = await res.text();
  if (!res.ok) {
    const err = new Error(`Metrolinx returned ${res.status}`);
    err.status = res.status === 401 || res.status === 403 ? 502 : 502;
    err.detail = text.slice(0, 500);
    throw err;
  }
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    const err = new Error('Metrolinx returned a non-JSON response');
    err.status = 502;
    err.detail = text.slice(0, 500);
    throw err;
  }
  // Metrolinx answers with HTTP 200 even for auth/quota failures — the real
  // status lives in Metadata.ErrorCode.
  const code = body?.Metadata?.ErrorCode;
  if (code && !['200', '0'].includes(String(code))) {
    const err = new Error(`Metrolinx error ${code}: ${body?.Metadata?.ErrorMessage ?? 'unknown'}`);
    err.status = String(code) === '401' ? 401 : 502;
    err.detail = String(code) === '401' ? 'Check that GO_API_KEY is a valid Metrolinx key.' : undefined;
    throw err;
  }
  cache.set(path, { at: Date.now(), body });
  return body;
}

function json(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

// Stop/All nests stations a few layers deep; flatten to {code, name}.
function flattenStations(payload) {
  const raw = payload?.Stations?.Station ?? payload?.Stations ?? [];
  const list = Array.isArray(raw) ? raw : [raw];
  return list
    .map((s) => ({
      code: s?.LocationCode ?? s?.Code ?? '',
      name: s?.LocationName ?? s?.Name ?? '',
      type: s?.LocationType ?? '',
    }))
    .filter((s) => s.code && s.name)
    .sort((a, b) => a.name.localeCompare(b.name));
}

// NextService rows vary by service type; normalize the fields the UI needs.
function normalizeDepartures(payload) {
  const raw = payload?.NextService?.Lines ?? payload?.Lines ?? [];
  const list = Array.isArray(raw) ? raw : [raw];
  return list.map((l) => ({
    line: l?.LineCode ?? '',
    lineName: l?.LineName ?? '',
    serviceType: l?.ServiceType ?? '',
    direction: l?.DirectionName ?? '',
    trip: l?.TripNumber ?? '',
    scheduled: l?.ScheduledDepartureTime ?? '',
    computed: l?.ComputedDepartureTime ?? l?.ScheduledDepartureTime ?? '',
    status: l?.Status ?? '',
    platform: l?.ActualPlatform || l?.ScheduledPlatform || '',
    stopCode: l?.StopCode ?? '',
  }));
}

async function handleApi(req, res, url) {
  if (url.pathname === '/api/health') {
    return json(res, 200, { ok: true, keyConfigured: Boolean(API_KEY) });
  }
  if (!API_KEY) {
    return json(res, 503, {
      error: 'No API key configured.',
      detail: 'Copy .env.example to .env and set GO_API_KEY, then restart the server.',
    });
  }
  if (url.pathname === '/api/stations') {
    const data = await upstream('api/V1/Stop/All', 24 * 60 * 60 * 1000);
    return json(res, 200, { stations: flattenStations(data) });
  }
  const dep = url.pathname.match(/^\/api\/departures\/([A-Za-z0-9_-]{1,12})$/);
  if (dep) {
    const code = dep[1].toUpperCase();
    const data = await upstream(`api/V1/Stop/NextService/${code}`, 30_000);
    return json(res, 200, {
      stopCode: code,
      fetchedAt: new Date().toISOString(),
      departures: normalizeDepartures(data),
    });
  }
  return json(res, 404, { error: 'Unknown endpoint' });
}

async function serveStatic(res, pathname) {
  const rel = pathname === '/' ? 'index.html' : normalize(pathname).replace(/^[\/]+/, '');
  const file = join(PUBLIC_DIR, rel);
  if (!file.startsWith(PUBLIC_DIR)) {
    res.writeHead(403).end('Forbidden');
    return;
  }
  try {
    const body = await readFile(file);
    res.writeHead(200, { 'Content-Type': MIME[extname(file)] || 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found');
  }
}

createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host ?? 'localhost'}`);
  try {
    if (url.pathname.startsWith('/api/')) await handleApi(req, res, url);
    else await serveStatic(res, url.pathname);
  } catch (err) {
    json(res, err.status ?? 500, { error: err.message, detail: err.detail });
  }
}).listen(PORT, () => {
  console.log(`GO tracker on http://localhost:${PORT}`);
  if (!API_KEY) console.log('WARNING: GO_API_KEY is not set — API routes will return 503.');
});
