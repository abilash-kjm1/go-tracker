import type { Metadata } from 'next';
import { TripScreen } from '@/components/trips/TripScreen';

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ tripId: string }>;
}): Promise<Metadata> {
  const { tripId } = await params;
  return { title: `Trip ${tripId.split('-').at(-1) ?? tripId}` };
}

export default async function TripPage({ params }: { params: Promise<{ tripId: string }> }) {
  const { tripId } = await params;
  return <TripScreen tripId={tripId} />;
}
