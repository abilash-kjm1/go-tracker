import type { Metadata } from 'next';
import { RoutesScreen } from '@/components/home/RoutesScreen';
import { getProvider } from '@/lib/transit/provider';

export const metadata: Metadata = { title: 'Routes' };
export const dynamic = 'force-dynamic';

export default async function RoutesPage() {
  const provider = await getProvider();
  const routes = await provider.getRoutes().catch(() => []);
  return <RoutesScreen routes={routes} />;
}
