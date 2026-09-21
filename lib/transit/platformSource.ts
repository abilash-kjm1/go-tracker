import 'server-only';

import { cached } from './cache';
import { config } from './config';

/**
 * Optional platform enrichment from the official Metrolinx Open Data API.
 *
 * Why this exists separately from MetrolinxOfficialProvider: platform numbers
 * are the one thing the temporary GO Tracker upstream cannot supply at all
 * (its S4 station-status backend returns an error, and gotracker.ca itself is
 * decommissioned). So as soon as a METROLINX_API_KEY is present we use it for
 * platforms only, while everything else keeps running on the current provider.
 *
 * No key configured → this is inert and boards simply carry no platform.
 * Nothing here ever guesses a platform.
 */

export interface PlatformInfo {
  /** Already rider-facing: "Platform 4", "Bay 3". */
  platform?: string;
  status?: string;
  cancelled?: boolean;
}

interface NextServiceLine {
  TripNumber?: string | number;
  ScheduledPlatform?: string;
  ActualPlatform?: string;
  Platform?: string;
  Track?: string;
  Bay?: string;
  Status?: string;
  ServiceType?: string;
}

export const platformSourceEnabled = () => Boolean(config.metrolinx.apiKey);

/**
 * Platform by trip number for one stop, or an empty map when no key is set or
 * the upstream is unhappy. Never throws — platform is an enhancement, and its
 * absence must not take a departure board down.
 */
export async function getPlatformsByTrip(stopId: string): Promise<Map<string, PlatformInfo>> {
  if (!platformSourceEnabled()) return new Map();

  try {
    const result = await cached(
      `metrolinx:platforms:${stopId}`,
      config.stationRefreshSeconds,
      async () => {
        const base = config.metrolinx.baseUrl.replace(/\/$/, '');
        const url = `${base}/api/V1/Stop/NextService/${encodeURIComponent(stopId)}?key=${encodeURIComponent(
          config.metrolinx.apiKey,
        )}`;
        const res = await fetch(url, {
          headers: { Accept: 'application/json' },
          signal: AbortSignal.timeout(config.upstreamTimeoutMs),
          cache: 'no-store',
        });
        const text = await res.text();
        if (!res.ok) throw new Error(`Metrolinx HTTP ${res.status}`);

        const body = JSON.parse(text) as {
          Metadata?: { ErrorCode?: string; ErrorMessage?: string };
          NextService?: { Lines?: NextServiceLine | NextServiceLine[] };
        };

        // This API answers HTTP 200 even for auth failures.
        const code = body?.Metadata?.ErrorCode;
        if (code && !['200', '0'].includes(String(code))) {
          throw new Error(`Metrolinx error ${code}: ${body?.Metadata?.ErrorMessage ?? 'unknown'}`);
        }

        const raw = body?.NextService?.Lines;
        return raw == null ? [] : Array.isArray(raw) ? raw : [raw];
      },
    );

    const out = new Map<string, PlatformInfo>();
    for (const line of result.value) {
      const trip = String(line.TripNumber ?? '').trim();
      if (!trip) continue;
      const info: PlatformInfo = {
        platform: normalizeBoarding(line),
        status: line.Status?.trim() || undefined,
        cancelled: /cancel/i.test(line.Status ?? ''),
      };
      if (info.platform || info.status) out.set(trip, info);
    }
    return out;
  } catch {
    // Enrichment is best-effort by design.
    return new Map();
  }
}

/**
 * Riders read "Platform", never "Track" — but a bus bay keeps its own wording,
 * and anything non-numeric is passed through as published.
 */
function normalizeBoarding(line: NextServiceLine): string | undefined {
  const bay = line.Bay?.trim();
  if (bay) return /^\d+[A-Za-z]?$/.test(bay) ? `Bay ${bay}` : bay;

  const raw = (line.ActualPlatform || line.ScheduledPlatform || line.Platform || line.Track)?.trim();
  if (!raw) return undefined;

  const isBus = (line.ServiceType ?? '').toUpperCase().startsWith('B');
  if (/^\d+[A-Za-z]?$/.test(raw)) return isBus ? `Bay ${raw}` : `Platform ${raw}`;
  return raw.replace(/^track\b/i, 'Platform');
}
