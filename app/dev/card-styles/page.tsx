import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { CardStyles } from '@/components/dev/CardStyles';
import { config } from '@/lib/transit/config';

export const metadata: Metadata = { title: 'Card styles', robots: { index: false } };
export const dynamic = 'force-dynamic';

export default async function CardStylesPage({
  searchParams,
}: {
  searchParams: Promise<{ stop?: string }>;
}) {
  // Dev-only, like /dev/transit: a design decision aid, not a product page.
  if (!config.devPageEnabled) notFound();
  const { stop } = await searchParams;
  return <CardStyles stationId={stop ?? 'BU'} />;
}
