/**
 * GO runs on Toronto local time while the server may run anywhere (Vercel is
 * UTC), so every schedule calculation goes through these helpers rather than
 * the host's local timezone.
 */

export const TORONTO = 'America/Toronto';

const partsFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: TORONTO,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
});

export interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  /** YYYYMMDD, matching the GTFS service_id keys. */
  dateKey: string;
  /** Seconds since local midnight. */
  secondsOfDay: number;
}

export function torontoParts(date: Date = new Date()): ZonedParts {
  const p: Record<string, string> = {};
  for (const part of partsFormatter.formatToParts(date)) {
    if (part.type !== 'literal') p[part.type] = part.value;
  }
  const year = Number(p.year);
  const month = Number(p.month);
  const day = Number(p.day);
  // "24" shows up at midnight in some ICU versions.
  const hour = Number(p.hour) % 24;
  const minute = Number(p.minute);
  const second = Number(p.second);
  return {
    year,
    month,
    day,
    hour,
    minute,
    second,
    dateKey: `${p.year}${p.month}${p.day}`,
    secondsOfDay: hour * 3600 + minute * 60 + second,
  };
}

function offsetMsAt(instant: number): number {
  const p: Record<string, string> = {};
  for (const part of partsFormatter.formatToParts(new Date(instant))) {
    if (part.type !== 'literal') p[part.type] = part.value;
  }
  const asUtc = Date.UTC(
    Number(p.year),
    Number(p.month) - 1,
    Number(p.day),
    Number(p.hour) % 24,
    Number(p.minute),
    Number(p.second),
  );
  return asUtc - instant;
}

/**
 * Turns a GTFS service date plus seconds-since-midnight into a real instant.
 * `seconds` may exceed 86400 — GTFS uses 25:10:00 for trips after midnight.
 */
export function zonedToInstant(dateKey: string, seconds: number): Date {
  const year = Number(dateKey.slice(0, 4));
  const month = Number(dateKey.slice(4, 6));
  const day = Number(dateKey.slice(6, 8));
  const naiveUtc = Date.UTC(year, month - 1, day) + seconds * 1000;
  // Two passes settle the DST boundary cases.
  let instant = naiveUtc - offsetMsAt(naiveUtc);
  instant = naiveUtc - offsetMsAt(instant);
  return new Date(instant);
}

/** The GTFS service date currently in effect (service after midnight still belongs to the previous day). */
export function currentServiceDate(now: Date = new Date()): { dateKey: string; secondsOfDay: number } {
  const p = torontoParts(now);
  if (p.secondsOfDay < 4 * 3600) {
    // Before 4am, trips are still numbered against yesterday's service date.
    const prev = new Date(Date.UTC(p.year, p.month - 1, p.day) - 86_400_000);
    const y = prev.getUTCFullYear();
    const m = String(prev.getUTCMonth() + 1).padStart(2, '0');
    const d = String(prev.getUTCDate()).padStart(2, '0');
    return { dateKey: `${y}${m}${d}`, secondsOfDay: p.secondsOfDay + 86_400 };
  }
  return { dateKey: p.dateKey, secondsOfDay: p.secondsOfDay };
}

export function formatClock(iso: string | undefined | null, opts?: { seconds?: boolean }): string {
  if (!iso) return '--:--';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '--:--';
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TORONTO,
    hour: 'numeric',
    minute: '2-digit',
    ...(opts?.seconds ? { second: '2-digit' } : {}),
    hour12: true,
  }).format(d);
}

/** Clock split into value and meridiem, so a card can size them differently. */
export function formatClockParts(iso: string | undefined | null): { time: string; suffix: string } {
  const full = formatClock(iso);
  const match = /^(.*?)\s*([ap]\.?m\.?)$/i.exec(full);
  return match ? { time: match[1], suffix: match[2] } : { time: full, suffix: '' };
}

/** "8 min", "Now", "1h 12m" — the countdown shown on departure rows. */
export function formatCountdown(iso: string | undefined | null, now: number = Date.now()): string {
  if (!iso) return '';
  const target = new Date(iso).getTime();
  if (Number.isNaN(target)) return '';
  const mins = Math.round((target - now) / 60_000);
  if (mins <= -60) return 'Departed';
  if (mins < 0) return `${Math.abs(mins)} min ago`;
  if (mins === 0) return 'Now';
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  return `${h}h ${mins % 60}m`;
}

/** "8 sec ago", "2 min ago" — for freshness indicators. */
export function formatAge(iso: string | null | undefined, now: number = Date.now()): string {
  if (!iso) return 'never';
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return 'never';
  const secs = Math.max(0, Math.round((now - t) / 1000));
  if (secs < 60) return `${secs} sec ago`;
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins} min ago`;
  return `${Math.round(mins / 60)} h ago`;
}

export function formatDelay(delaySeconds: number | undefined | null): string {
  if (delaySeconds == null) return '';
  const mins = Math.round(delaySeconds / 60);
  if (mins <= 0) return 'On time';
  return `+${mins} min`;
}

export function greeting(now: Date = new Date()): string {
  const { hour } = torontoParts(now);
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}
