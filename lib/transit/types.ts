/**
 * The normalized transit model. Everything the frontend renders comes from
 * these shapes — no provider-specific field ever reaches a component, which is
 * what lets us swap GO Tracker for the official Metrolinx API later.
 */

export type VehicleType = 'train' | 'bus' | 'unknown';

export type DataFreshness = 'live' | 'stale' | 'unavailable' | 'scheduled';

export interface TransitStop {
  id: string;
  name: string;
  code: string;
  lat: number;
  lon: number;
  /** Modes actually scheduled to serve this stop. */
  modes: VehicleType[];
  routeIds: string[];
  url?: string | null;
  wheelchair?: boolean;
}

export interface TransitRoute {
  id: string;
  /** Short public code: "LW", "21", "40". */
  code: string;
  name: string;
  type: VehicleType;
  color?: string | null;
  textColor?: string | null;
}

export interface LiveVehicle {
  id: string;
  tripId?: string;
  tripNumber?: string;

  vehicleType: VehicleType;

  serviceId?: string;
  serviceName?: string;

  routeId?: string;
  routeName?: string;

  origin?: string;
  destination?: string;

  latitude: number;
  longitude: number;

  delaySeconds?: number;
  isMoving?: boolean;
  /** Runs express, as reported by the upstream. */
  express?: boolean;

  nextStopId?: string;
  nextStopName?: string;

  /** Free-text status from the upstream, e.g. "On Time at Bronte GO". */
  detail?: string;
  /** Operator-supplied delay reason, when one is published. */
  delayReason?: string;
  vehicleLabel?: string;

  updatedAt: string;
}

export interface Departure {
  id: string;

  stopId: string;
  stopName: string;

  tripId?: string;
  tripNumber?: string;

  vehicleType: VehicleType;

  routeId?: string;
  routeName?: string;
  routeCode?: string;
  /**
   * What a rider sees on the front of the bus: the route variant ("12B") when
   * GO publishes one, otherwise the plain route code. Variants of a route stop
   * at different places, so the letter matters.
   */
  serviceCode?: string;
  routeColor?: string | null;

  origin?: string;
  destination?: string;

  /** GTFS direction_id — groups a board into its two travel directions. */
  direction?: 0 | 1;
  /**
   * Human direction from GO's own signage, e.g. "Eastbound towards Union".
   * Absent where no signage board exists.
   */
  directionLabel?: string;

  scheduledTime: string;
  estimatedTime?: string;
  actualTime?: string;

  /** When this service reaches the far end: its terminus, or on a planned
   *  journey the stop the rider actually asked for. */
  arrivalTime?: string;
  arrivalEstimated?: string;
  arrivalStopName?: string;
  /** Journey length in minutes, from this stop to that arrival. */
  durationMinutes?: number;

  delaySeconds?: number;

  /**
   * Boarding location as the rider should read it. Trains get "Platform 4",
   * buses get whatever the data actually says ("Bay 3"). Never invented.
   */
  platform?: string;

  cancelled: boolean;

  /** Runs express — skips stops the all-stops service calls at. */
  express?: boolean;

  /**
   * Board status shown where there is no platform yet — Union withholds the
   * platform until close to departure and says so.
   */
  platformNote?: string;

  /** Whether the times on this row are backed by real-time data. */
  realtime: boolean;

  updatedAt: string;
}

/**
 * A planned journey: one leg when a direct service exists, two when a change
 * is needed. Connections are computed from the published schedule with a
 * minimum buffer — never assumed.
 */
export interface Journey {
  id: string;
  legs: Departure[];
  /** 0 for a direct service. */
  transfers: number;
  departureTime: string;
  arrivalTime: string;
  durationMinutes: number;
  /** Minutes on the platform between legs, in order. */
  connectionMinutes: number[];
  /** True when any leg is backed by real-time data. */
  realtime: boolean;
}

export interface TripStopTime {
  stopId: string;
  stopName: string;
  /** Position, so the trip view can draw the journey and the vehicle on it. */
  lat?: number;
  lon?: number;
  scheduledArrival?: string;
  scheduledDeparture?: string;
  estimatedDeparture?: string;
  /** Rider-facing boarding location, when the data provides one. */
  platform?: string;
  status: 'departed' | 'current' | 'upcoming';
}

export interface TripDetail {
  id: string;
  tripNumber?: string;
  vehicleType: VehicleType;

  routeId?: string;
  routeName?: string;
  routeCode?: string;
  /** Route variant ("12B") when GO publishes one. */
  serviceCode?: string;
  routeColor?: string | null;

  origin?: string;
  destination?: string;

  scheduledStart?: string;
  scheduledEnd?: string;

  delaySeconds?: number;
  cancelled: boolean;
  express?: boolean;

  vehicle?: LiveVehicle | null;
  stops: TripStopTime[];

  updatedAt: string;
}

export interface TransitAlert {
  id: string;
  severity: 'info' | 'warning' | 'severe';
  title: string;
  body: string;
  /** What the alert is attached to, so the UI can deep-link. */
  scope: { kind: 'route' | 'stop' | 'trip' | 'network'; id?: string; name?: string };
  vehicleType?: VehicleType;
  updatedAt: string;
}

export interface SearchResults {
  stops: TransitStop[];
  routes: TransitRoute[];
  trips: Array<{ id: string; tripNumber: string; label: string; vehicleType: VehicleType }>;
}

export interface ProviderHealth {
  provider: string;
  providerLabel: string;
  connected: boolean;
  lastSuccessAt: string | null;
  lastErrorAt: string | null;
  lastError: string | null;
  latencyMs: number | null;
  counts: {
    liveVehicles: number;
    trainVehicles: number;
    busVehicles: number;
    stops: number;
    routes: number;
  };
  staticData: {
    source: string;
    feedVersion: string | null;
    generatedAt: string | null;
    datesAvailable: string[];
  } | null;
  /** True when live vehicle data is older than the staleness threshold. */
  stale: boolean;
  /** Whether an official-API key is configured to supply platform numbers. */
  platformSource?: boolean;
}

/** Envelope every API route returns, so the client can reason about freshness. */
export interface ApiEnvelope<T> {
  data: T;
  meta: {
    freshness: DataFreshness;
    updatedAt: string | null;
    ageSeconds: number | null;
    provider: string;
    /** Set when live data failed and this payload is schedule-only or cached. */
    degraded?: string;
  };
}
