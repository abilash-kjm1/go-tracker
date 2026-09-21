import 'server-only';

import { cached } from '../cache';
import { config } from '../config';
import { getRoutes, getStop, getStops } from '../gtfs';
import { zonedToInstant } from '../time';
import type { DepartureQuery, TransitDataProvider } from '../provider';
import type {
  Departure,
  LiveVehicle,
  ProviderHealth,
  SearchResults,
  TransitAlert,
  TransitRoute,
  TransitStop,
  TripDetail,
} from '../types';

/**
 * Official Metrolinx Open Data API provider.
 *
 * Wired up to the documented endpoints but NOT verified against live
 * responses — we have no API key yet, so every call returns 401 with the real
 * status buried in `Metadata.ErrorCode` (the API answers HTTP 200 regardless).
 * Field mapping below follows the published help pages and should be checked
 * against a real response before this provider is switched on.
 *
 * Switch over with:
 *   TRANSIT_PROVIDER=metrolinx
 *   METROLINX_API_KEY=...
 */
export class MetrolinxOfficialProvider implements TransitDataProvider {
  readonly id = 'metrolinx';
  readonly label = 'Metrolinx Open Data (official)';

  private assertConfigured() {
    if (!config.metrolinx.apiKey) {
      throw new Error(
        'METROLINX_API_KEY is not set. Set it, or switch TRANSIT_PROVIDER back to "gotracker".',
      );
    }
  }

  private async get<T>(path: string): Promise<T> {
    this.assertConfigured();
    const base = config.metrolinx.baseUrl.replace(/\/$/, '');
    const sep = path.includes('?') ? '&' : '?';
    const res = await fetch(`${base}/${path.replace(/^\//, '')}${sep}key=${config.metrolinx.apiKey}`, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(config.upstreamTimeoutMs),
      cache: 'no-store',
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`Metrolinx HTTP ${res.status}`);

    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      throw new Error('Metrolinx returned a non-JSON response');
    }
    // The API answers HTTP 200 even for auth failures; the truth is in Metadata.
    const code = (body as { Metadata?: { ErrorCode?: string; ErrorMessage?: string } })?.Metadata
      ?.ErrorCode;
    if (code && !['200', '0'].includes(String(code))) {
      const message =
        (body as { Metadata?: { ErrorMessage?: string } }).Metadata?.ErrorMessage ?? 'unknown';
      throw new Error(`Metrolinx error ${code}: ${message}`);
    }
    return body as T;
  }

  // Static data stays on GTFS regardless of provider — same stop ids either way.
  getStations(): Promise<TransitStop[]> {
    return getStops();
  }

  getStation(stopId: string): Promise<TransitStop | null> {
    return getStop(stopId);
  }

  getRoutes(): Promise<TransitRoute[]> {
    return getRoutes();
  }

  async getDepartures(stopId: string, query: DepartureQuery = {}): Promise<Departure[]> {
    const result = await cached(`metrolinx:next:${stopId}`, config.stationRefreshSeconds, () =>
      this.get<MetrolinxNextService>(`api/V1/Stop/NextService/${encodeURIComponent(stopId)}`),
    );
    const stop = await getStop(stopId);
    const lines = asArray(result.value?.NextService?.Lines);
    const limit = query.limit ?? 40;

    return lines.slice(0, limit).map((line, index) => {
      const scheduled = parseMetrolinxTime(line.ScheduledDepartureTime);
      const computed = parseMetrolinxTime(line.ComputedDepartureTime) ?? scheduled;
      const delaySeconds =
        scheduled && computed ? Math.round((computed.getTime() - scheduled.getTime()) / 1000) : undefined;

      return {
        id: `${line.TripNumber ?? index}:${stopId}`,
        stopId,
        stopName: stop?.name ?? stopId,
        tripNumber: line.TripNumber,
        // ServiceType is documented as "T"/"B"; verify against a live response.
        vehicleType: line.ServiceType?.toUpperCase().startsWith('B')
          ? 'bus'
          : line.ServiceType?.toUpperCase().startsWith('T')
            ? 'train'
            : 'unknown',
        routeCode: line.LineCode,
        routeName: line.LineName,
        destination: line.DirectionName,
        scheduledTime: (scheduled ?? new Date()).toISOString(),
        estimatedTime: computed?.toISOString(),
        delaySeconds,
        platform: normalizePlatform(line.ActualPlatform || line.ScheduledPlatform),
        cancelled: /cancel/i.test(line.Status ?? ''),
        realtime: Boolean(line.ComputedDepartureTime),
        updatedAt: new Date().toISOString(),
      } satisfies Departure;
    });
  }

  getArrivals(stopId: string, query: DepartureQuery = {}): Promise<Departure[]> {
    // The official API exposes one board; arrivals are filtered client-side.
    return this.getDepartures(stopId, query);
  }

  async getLiveVehicles(): Promise<LiveVehicle[]> {
    // TODO(verify): map GTFS-RT VehiclePosition entities once a key is available.
    const result = await cached('metrolinx:vehicles', config.liveVehicleRefreshSeconds, () =>
      this.get<unknown>('api/V1/Gtfs/Feed/VehiclePosition'),
    );
    void result;
    throw new Error(
      'MetrolinxOfficialProvider.getLiveVehicles is not implemented yet — the GTFS-realtime mapping needs a live response to verify.',
    );
  }

  async getTrip(): Promise<TripDetail | null> {
    throw new Error('MetrolinxOfficialProvider.getTrip is not implemented yet.');
  }

  async search(): Promise<SearchResults> {
    throw new Error('MetrolinxOfficialProvider.search is not implemented yet.');
  }

  async getAlerts(): Promise<TransitAlert[]> {
    // api/V1/Gtfs/Feed/Alerts — needs a live response before mapping.
    return [];
  }

  async health(): Promise<ProviderHealth> {
    const [stops, routes] = await Promise.all([
      getStops().catch(() => []),
      getRoutes().catch(() => []),
    ]);
    let connected = false;
    let lastError: string | null = null;
    try {
      await this.get<unknown>('api/V1/ServiceataGlance/Trains/All');
      connected = true;
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    }

    return {
      provider: this.id,
      providerLabel: this.label,
      connected,
      lastSuccessAt: connected ? new Date().toISOString() : null,
      lastErrorAt: connected ? null : new Date().toISOString(),
      lastError,
      latencyMs: null,
      counts: {
        liveVehicles: 0,
        trainVehicles: 0,
        busVehicles: 0,
        stops: stops.length,
        routes: routes.length,
      },
      staticData: null,
      stale: !connected,
    };
  }
}

interface MetrolinxLine {
  LineCode?: string;
  LineName?: string;
  ServiceType?: string;
  DirectionName?: string;
  TripNumber?: string;
  ScheduledDepartureTime?: string;
  ComputedDepartureTime?: string;
  ScheduledPlatform?: string;
  ActualPlatform?: string;
  Status?: string;
}

interface MetrolinxNextService {
  NextService?: { Lines?: MetrolinxLine | MetrolinxLine[] };
}

function asArray<T>(v: T | T[] | undefined): T[] {
  if (v == null) return [];
  return Array.isArray(v) ? v : [v];
}

/** "2026-09-20 14:32:00", Toronto local, no offset. */
function parseMetrolinxTime(value: string | undefined): Date | null {
  if (!value) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/.exec(value.trim());
  if (!m) return null;
  const [, y, mo, d, h, mi, s] = m;
  const seconds = Number(h) * 3600 + Number(mi) * 60 + Number(s ?? 0);
  return zonedToInstant(`${y}${mo}${d}`, seconds);
}

/** Riders read "Platform", never "Track". */
function normalizePlatform(value: string | undefined): string | undefined {
  const raw = value?.trim();
  if (!raw) return undefined;
  if (/^\d+[A-Za-z]?$/.test(raw)) return `Platform ${raw}`;
  return raw.replace(/^track\b/i, 'Platform');
}
