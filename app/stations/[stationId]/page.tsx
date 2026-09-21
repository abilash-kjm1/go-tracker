import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { StationScreen } from '@/components/stations/StationScreen';
import { getRelatedStops } from '@/lib/transit/gtfs';
import { getProvider } from '@/lib/transit/provider';

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ stationId: string }>;
}): Promise<Metadata> {
  const { stationId } = await params;
  const provider = await getProvider();
  const stop = await provider.getStation(stationId).catch(() => null);
  return { title: stop?.name ?? 'Station' };
}

export default async function StationPage({
  params,
}: {
  params: Promise<{ stationId: string }>;
}) {
  const { stationId } = await params;
  const provider = await getProvider();
  const stop = await provider.getStation(stationId).catch(() => null);
  if (!stop) notFound();

  // GO files a station's bus loop as its own stop; the page covers the site.
  const related = await getRelatedStops(stationId).catch(() => []);
  const modes = [...new Set([...stop.modes, ...related.flatMap((s) => s.modes)])].sort();

  return <StationScreen stop={{ ...stop, modes }} related={related} />;
}
