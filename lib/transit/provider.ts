import 'server-only';

import { config } from './config';
import type {
  Departure,
  LiveVehicle,
  ProviderHealth,
  SearchResults,
  TransitAlert,
  TransitRoute,
  TransitStop,
  TripDetail,
} from './types';

export interface DepartureQuery {
  /** "departures" uses departure times; "arrivals" uses arrival times. */
  direction?: 'departures' | 'arrivals';
  limit?: number;
  now?: Date;
}

/**
 * The seam between our app and whichever upstream is in play. Adding the
 * official Metrolinx API means implementing this interface — no route handler
 * or component changes.
 */
export interface TransitDataProvider {
  readonly id: string;
  readonly label: string;

  getStations(): Promise<TransitStop[]>;
  getStation(stopId: string): Promise<TransitStop | null>;
  getDepartures(stopId: string, query?: DepartureQuery): Promise<Departure[]>;
  getArrivals(stopId: string, query?: DepartureQuery): Promise<Departure[]>;
  getLiveVehicles(): Promise<LiveVehicle[]>;
  getTrip(tripId: string): Promise<TripDetail | null>;
  getRoutes(): Promise<TransitRoute[]>;
  search(query: string): Promise<SearchResults>;
  getAlerts(): Promise<TransitAlert[]>;
  health(): Promise<ProviderHealth>;
}

let instance: TransitDataProvider | null = null;

export async function getProvider(): Promise<TransitDataProvider> {
  if (instance) return instance;

  if (config.provider === 'metrolinx') {
    const { MetrolinxOfficialProvider } = await import('./providers/MetrolinxOfficialProvider');
    instance = new MetrolinxOfficialProvider();
  } else {
    const { GoTrackerTemporaryProvider } = await import('./providers/GoTrackerTemporaryProvider');
    instance = new GoTrackerTemporaryProvider();
  }
  return instance;
}

/** Test/dev helper — forces the next getProvider() to rebuild. */
export function resetProvider() {
  instance = null;
}
