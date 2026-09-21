/**
 * Builds compact GTFS snapshots used for static data (stops, routes) and
 * scheduled departures. The upstream real-time service only reports live train
 * positions, so the schedule is what gives us bus coverage and the baseline
 * every live delay is applied to.
 *
 *   node scripts/build-gtfs.mjs [--days 14] [--zip path/to/GO_GTFS.zip]
 *
 * Output (git-ignored, regenerate when the feed window expires):
 *   data/gtfs/meta.json
 *   data/gtfs/routes.json
 *   data/gtfs/stops.json
 *   data/gtfs/schedule/YYYYMMDD.json
 */
import AdmZip from 'adm-zip';
import { createReadStream } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const GTFS_URL =
  process.env.GTFS_URL ??
  'https://assets.metrolinx.com/raw/upload/Documents/Metrolinx/Open%20Data/GO-GTFS.zip';

const args = process.argv.slice(2);
const argOf = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const DAYS = Number(argOf('days', '14'));
const ZIP_ARG = argOf('zip', null);
const OUT = new URL('../data/gtfs/', import.meta.url);

const log = (...m) => console.log('[gtfs]', ...m);

function parseCsvLine(line) {
  const out = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quoted) {
      if (c === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else quoted = false;
      } else cur += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') {
      out.push(cur);
      cur = '';
    } else cur += c;
  }
  out.push(cur);
  return out;
}

function csvRows(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.length);
  const header = parseCsvLine(lines[0].replace(/^﻿/, ''));
  return lines.slice(1).map((line) => {
    const cells = parseCsvLine(line);
    const row = {};
    header.forEach((h, i) => {
      row[h] = cells[i] ?? '';
    });
    return row;
  });
}

/** GTFS times can exceed 24h ("25:10:00" = 1:10am next day). Keep the raw seconds. */
function toSeconds(hms) {
  const m = /^(\d+):(\d{2}):(\d{2})$/.exec(hms.trim());
  if (!m) return null;
  return +m[1] * 3600 + +m[2] * 60 + +m[3];
}

const routeType = (t) => (t === '2' ? 'train' : t === '3' ? 'bus' : 'unknown');

/**
 * Service dates to build, as YYYYMMDD in TORONTO time.
 *
 * "Today" has to be Toronto's today, not the build machine's: Vercel builds in
 * UTC, so from about 8pm Toronto the machine is already on tomorrow, and using
 * its calendar would start the snapshot a day late and drop today's timetable.
 *
 * Starts one day back because trips after midnight ("25:10:00") stay filed
 * under the previous service date until about 4am.
 */
function dateKeys(days) {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Toronto',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const [y, m, d] = fmt
    .format(new Date())
    .split('-')
    .map(Number);

  const keys = [];
  for (let i = -1; i < days; i++) {
    // Pure calendar arithmetic in UTC, so it never depends on the host's zone.
    const x = new Date(Date.UTC(y, m - 1, d + i));
    keys.push(
      `${x.getUTCFullYear()}${String(x.getUTCMonth() + 1).padStart(2, '0')}${String(x.getUTCDate()).padStart(2, '0')}`,
    );
  }
  return keys;
}

async function loadZip() {
  if (ZIP_ARG) {
    log('using local zip', ZIP_ARG);
    return new AdmZip(await readFile(ZIP_ARG));
  }
  log('downloading', GTFS_URL);
  const res = await fetch(GTFS_URL, { signal: AbortSignal.timeout(300_000) });
  if (!res.ok) throw new Error(`GTFS download failed: HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  log(`downloaded ${(buf.length / 1e6).toFixed(1)} MB`);
  return new AdmZip(buf);
}

async function main() {
  const zip = await loadZip();
  const text = (name) => zip.readAsText(name, 'utf8');

  const feedInfo = csvRows(text('feed_info.txt'))[0] ?? {};
  const routes = csvRows(text('routes.txt'));
  const stops = csvRows(text('stops.txt'));
  log(`routes=${routes.length} stops=${stops.length} feed=${feedInfo.feed_version ?? '?'}`);

  const routeById = new Map(
    routes.map((r) => [
      r.route_id,
      {
        id: r.route_id,
        code: r.route_short_name || r.route_id,
        name: r.route_long_name || r.route_short_name || r.route_id,
        type: routeType(r.route_type),
        color: r.route_color ? `#${r.route_color}` : null,
        textColor: r.route_text_color ? `#${r.route_text_color}` : null,
      },
    ]),
  );

  // Only keep trips inside the requested date window; in this feed service_id is the date.
  const wanted = new Set(dateKeys(DAYS));
  const availableServices = new Set(
    csvRows(text('calendar_dates.txt'))
      .filter((r) => r.exception_type === '1')
      .map((r) => r.service_id),
  );
  const dates = [...wanted].filter((d) => availableServices.has(d));
  if (!dates.length) {
    throw new Error(
      `GTFS feed covers none of the next ${DAYS} days (feed window ${feedInfo.feed_start_date}-${feedInfo.feed_end_date}). Download a fresher feed.`,
    );
  }
  log(`building ${dates.length} days: ${dates[0]}..${dates.at(-1)}`);

  const tripMeta = new Map();
  for (const t of csvRows(text('trips.txt'))) {
    if (!wanted.has(t.service_id)) continue;
    if (!routeById.has(t.route_id)) continue;
    // trip_id looks like 20260920-LW-1639; the tail is the public trip number.
    const tripNumber = t.trip_id.split('-').at(-1) ?? '';
    tripMeta.set(t.trip_id, {
      id: t.trip_id,
      date: t.service_id,
      number: tripNumber,
      routeId: t.route_id,
      headsign: t.trip_headsign,
      // GO runs lettered variants of a route (12, 12B, 12D) that serve
      // different stops — riders need the letter, not just the number.
      variant: (t.route_variant || '').trim(),
      direction: t.direction_id === '1' ? 1 : 0,
      stops: [],
    });
  }
  log(`trips in window: ${tripMeta.size}`);

  // stop_times.txt is ~108 MB, so stream it off disk instead of holding it in memory.
  const tmpName = `gtfs-stop-times-${process.pid}.txt`;
  const tmp = join(tmpdir(), tmpName);
  zip.extractEntryTo('stop_times.txt', tmpdir(), false, true, false, tmpName);
  let header = null;
  let kept = 0;
  const rl = createInterface({ input: createReadStream(tmp, 'utf8'), crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line) continue;
    if (!header) {
      header = parseCsvLine(line.replace(/^﻿/, ''));
      continue;
    }
    const c = parseCsvLine(line);
    const trip = tripMeta.get(c[0]);
    if (!trip) continue;
    trip.stops.push([c[3], toSeconds(c[1]), toSeconds(c[2]), Number(c[4]) || 0]);
    kept++;
  }
  await rm(tmp, { force: true });
  log(`stop_times kept: ${kept}`);

  // Which modes and routes actually serve each stop, so the UI can filter honestly.
  const stopModes = new Map();
  const stopRoutes = new Map();
  for (const trip of tripMeta.values()) {
    const mode = routeById.get(trip.routeId)?.type ?? 'unknown';
    for (const s of trip.stops) {
      if (!stopModes.has(s[0])) stopModes.set(s[0], new Set());
      if (!stopRoutes.has(s[0])) stopRoutes.set(s[0], new Set());
      stopModes.get(s[0]).add(mode);
      stopRoutes.get(s[0]).add(trip.routeId);
    }
  }

  await mkdir(new URL('schedule/', OUT), { recursive: true });

  const stopOut = stops
    .map((s) => ({
      id: s.stop_id,
      name: s.stop_name,
      lat: Number(s.stop_lat),
      lon: Number(s.stop_lon),
      code: s.stop_code || s.stop_id,
      url: s.stop_url || null,
      wheelchair: s.wheelchair_boarding === '1',
      modes: [...(stopModes.get(s.stop_id) ?? [])].sort(),
      routeIds: [...(stopRoutes.get(s.stop_id) ?? [])].sort(),
    }))
    .filter((s) => Number.isFinite(s.lat) && Number.isFinite(s.lon))
    .sort((a, b) => a.name.localeCompare(b.name));

  await writeFile(new URL('stops.json', OUT), JSON.stringify(stopOut));
  await writeFile(new URL('routes.json', OUT), JSON.stringify([...routeById.values()]));

  let written = 0;
  for (const date of dates) {
    const trips = [...tripMeta.values()]
      .filter((t) => t.date === date && t.stops.length)
      .map((t) => {
        t.stops.sort((a, b) => a[3] - b[3]);
        return {
          i: t.id,
          n: t.number,
          r: t.routeId,
          h: t.headsign,
          v: t.variant || undefined,
          d: t.direction,
          s: t.stops.map(([stopId, arr, dep]) => [stopId, arr, dep]),
        };
      });
    await writeFile(new URL(`schedule/${date}.json`, OUT), JSON.stringify({ date, trips }));
    written += trips.length;
    log(`  ${date}: ${trips.length} trips`);
  }

  await writeFile(
    new URL('meta.json', OUT),
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        feedVersion: feedInfo.feed_version ?? null,
        feedStart: feedInfo.feed_start_date ?? null,
        feedEnd: feedInfo.feed_end_date ?? null,
        publisher: feedInfo.feed_publisher_name ?? 'Metrolinx',
        dates,
        stops: stopOut.length,
        routes: routeById.size,
        trips: written,
      },
      null,
      2,
    ),
  );
  log('done');
}

main().catch((err) => {
  console.error('[gtfs] failed:', err);
  process.exit(1);
});
