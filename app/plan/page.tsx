import type { Metadata } from 'next';
import { PlanScreen } from '@/components/plan/PlanScreen';
import { getProvider } from '@/lib/transit/provider';

export const metadata: Metadata = { title: 'Plan a trip' };
export const dynamic = 'force-dynamic';

export default async function PlanPage() {
  const provider = await getProvider();
  const stops = await provider.getStations().catch(() => []);
  return <PlanScreen stops={stops} />;
}
