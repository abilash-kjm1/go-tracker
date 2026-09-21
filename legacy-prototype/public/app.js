const $ = (id) => document.getElementById(id);
const els = {
  station: $('station'), stations: $('stations'), refresh: $('refresh'),
  banner: $('banner'), meta: $('meta'), rows: $('rows'), empty: $('empty'),
};

const POLL_MS = 60_000;
let stations = [];
let current = null;      // { code, name }
let departures = [];
let fetchedAt = null;

function showBanner(msg) {
  els.banner.textContent = msg;
  els.banner.hidden = !msg;
}

async function api(path) {
  const res = await fetch(path);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.detail ? `${body.error} — ${body.detail}` : body.error || `HTTP ${res.status}`);
  return body;
}

// Metrolinx returns local Toronto times like "2026-09-19 17:42:00".
function parseTime(s) {
  if (!s) return null;
  const m = String(s).match(/(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/);
  if (!m) return null;
  const [, y, mo, d, h, mi, sec] = m;
  return new Date(+y, +mo - 1, +d, +h, +mi, +(sec ?? 0));
}

function clock(date) {
  return date ? date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '—';
}

function countdown(date) {
  if (!date) return '—';
  const mins = Math.round((date - Date.now()) / 60000);
  if (mins <= 0) return 'Now';
  if (mins < 60) return `${mins} min`;
  return `${Math.floor(mins / 60)}h ${mins % 60}m`;
}

function statusClass(status) {
  const s = (status || '').toLowerCase();
  if (s.includes('cancel') || s.includes('delay')) return 'bad';
  if (s.includes('late') || s.includes('hold')) return 'warn';
  return 'ok';
}

function delayLabel(d) {
  const sched = parseTime(d.scheduled);
  const real = parseTime(d.computed);
  if (!sched || !real) return d.status || 'On time';
  const late = Math.round((real - sched) / 60000);
  if (late >= 1) return `${d.status || 'Delayed'} +${late} min`;
  return d.status || 'On time';
}

function render() {
  if (!current) return;
  els.empty.hidden = departures.length > 0;
  if (!departures.length) els.empty.textContent = `No upcoming departures listed for ${current.name}.`;

  els.meta.textContent = fetchedAt
    ? `${current.name} (${current.code}) · updated ${clock(fetchedAt)}`
    : `${current.name} (${current.code})`;

  els.rows.replaceChildren(...departures.map((d) => {
    const when = parseTime(d.computed);
    const tr = document.createElement('tr');
    const cells = [
      ['count', countdown(when)],
      ['time', clock(when)],
      ['', d.line || d.serviceType || '—'],
      ['', d.direction || d.lineName || '—'],
      ['', d.platform || '—'],
      ['status', null],
    ];
    for (const [cls, text] of cells) {
      const td = document.createElement('td');
      if (cls) td.className = cls;
      if (cls === 'status') {
        const span = document.createElement('span');
        span.className = `pill ${statusClass(d.status)}`;
        span.textContent = delayLabel(d);
        td.append(span);
      } else {
        td.textContent = text;
      }
      tr.append(td);
    }
    return tr;
  }));
}

async function loadStations() {
  try {
    const { stations: list } = await api('/api/stations');
    stations = list;
    els.stations.replaceChildren(...stations.map((s) => {
      const o = document.createElement('option');
      o.value = `${s.name} (${s.code})`;
      return o;
    }));
  } catch (err) {
    showBanner(`Could not load the station list: ${err.message}`);
  }
}

function matchStation(input) {
  const q = input.trim().toLowerCase();
  if (!q) return null;
  const byCode = q.match(/\(([a-z0-9]+)\)\s*$/);
  if (byCode) return stations.find((s) => s.code.toLowerCase() === byCode[1]) ?? null;
  return (
    stations.find((s) => s.code.toLowerCase() === q) ??
    stations.find((s) => s.name.toLowerCase() === q) ??
    stations.find((s) => s.name.toLowerCase().startsWith(q)) ??
    null
  );
}

async function loadDepartures() {
  if (!current) return;
  try {
    const data = await api(`/api/departures/${encodeURIComponent(current.code)}`);
    departures = data.departures;
    fetchedAt = new Date(data.fetchedAt);
    showBanner('');
  } catch (err) {
    showBanner(`Live data unavailable: ${err.message}`);
  }
  render();
}

function selectStation(station) {
  current = station;
  departures = [];
  fetchedAt = null;
  localStorage.setItem('go-tracker:stop', station.code);
  els.station.value = `${station.name} (${station.code})`;
  els.empty.hidden = true;
  els.meta.textContent = `Loading ${station.name}…`;
  loadDepartures();
}

els.station.addEventListener('change', () => {
  const match = matchStation(els.station.value);
  if (match) selectStation(match);
  else showBanner(`No station matches "${els.station.value}".`);
});
els.refresh.addEventListener('click', loadDepartures);

setInterval(loadDepartures, POLL_MS);
setInterval(render, 15_000); // keep the countdown honest between polls

await loadStations();
const saved = localStorage.getItem('go-tracker:stop');
const savedStation = saved && stations.find((s) => s.code === saved);
if (savedStation) selectStation(savedStation);
