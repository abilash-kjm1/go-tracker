import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { RouteScreen } from '@/components/home/RouteScreen';
import { getRoute, getRoutePatterns } from '@/lib/transit/gtfs';

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ routeId: string }>;
}): Promise<Metadata> {
  const { routeId } = await params;
  const route = await getRoute(decodeURIComponent(routeId)).catch(() => null);
  return { title: route?.name ?? 'Route' };
}

export default async function RoutePage({ params }: { params: Promise<{ routeId: string }> }) {
  const { routeId } = await params;
  const id = decodeURIComponent(routeId);
  const route = await getRoute(id).catch(() => null);
  if (!route) notFound();

  const patterns = await getRoutePatterns(id).catch(() => []);
  return <RouteScreen route={route} patterns={patterns} />;
}
