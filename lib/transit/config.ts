/** Server-only configuration. Nothing here may be imported by a client component. */

import 'server-only';

const num = (value: string | undefined, fallback: number) => {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

export const config = {
  provider: (process.env.TRANSIT_PROVIDER ?? 'gotracker').toLowerCase(),

  goTracker: {
    baseUrl:
      process.env.GOTRACKER_BASE_URL ?? 'https://www.gotracker.ca/GOTracker/web/GODataAPIProxy.svc',
    // The upstream rejects requests that arrive without a same-site Referer.
    referer: process.env.GOTRACKER_REFERER ?? 'https://www.gotracker.ca/GOTracker/en/index.aspx',
    refreshSeconds: num(process.env.GOTRACKER_REFRESH_SECONDS, 15),
  },

  metrolinx: {
    baseUrl: process.env.METROLINX_API_BASE_URL ?? 'https://api.openmetrolinx.com/OpenDataAPI',
    apiKey: process.env.METROLINX_API_KEY ?? '',
  },

  liveVehicleRefreshSeconds: num(process.env.LIVE_VEHICLE_REFRESH_SECONDS, 15),
  stationRefreshSeconds: num(process.env.STATION_REFRESH_SECONDS, 20),
  upstreamTimeoutMs: num(process.env.UPSTREAM_TIMEOUT_MS, 10_000),

  /** Live data older than this is labelled "delayed", never "live". */
  staleAfterSeconds: num(process.env.STALE_AFTER_SECONDS, 90),

  devPageEnabled:
    process.env.ENABLE_DEV_TRANSIT_PAGE === 'true' || process.env.NODE_ENV !== 'production',
} as const;

export const TIMEZONE = 'America/Toronto';
