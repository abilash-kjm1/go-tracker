import type { Metadata } from 'next';
import { StationsBrowser } from '@/components/stations/StationsBrowser';
import { getProvider } from '@/lib/transit/provider';

export const metadata: Metadata = { title: 'Stations & stops' };
export const dynamic = 'force-dynamic';

export default async function StationsPage() {
  const provider = await getProvider();
  const [stops, routes] = await Promise.all([
    provider.getStations().catch(() => []),
    provider.getRoutes().catch(() => []),
  ]);
  return <StationsBrowser stops={stops} routes={routes} />;
}
