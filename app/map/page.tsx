import type { Metadata } from 'next';
import { MapView } from '@/components/map/MapView';
import { getProvider } from '@/lib/transit/provider';

export const metadata: Metadata = { title: 'Live map' };
export const dynamic = 'force-dynamic';

export default async function MapPage() {
  const provider = await getProvider();
  // Static data is rendered on the server so the map has stations immediately.
  const [stops, routes] = await Promise.all([
    provider.getStations().catch(() => []),
    provider.getRoutes().catch(() => []),
  ]);

  return <MapView stops={stops} routes={routes} />;
}
