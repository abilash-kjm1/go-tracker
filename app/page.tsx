import { HomeScreen } from '@/components/home/HomeScreen';
import { getBusiestStops } from '@/lib/transit/gtfs';

export const dynamic = 'force-dynamic';

export default async function Page() {
  // Somewhere to start before the user has favourites or shares a location.
  const featured = await getBusiestStops(5).catch(() => []);
  return <HomeScreen featured={featured} />;
}
