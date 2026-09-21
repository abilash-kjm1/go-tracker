import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { DevConsole } from '@/components/dev/DevConsole';
import { config } from '@/lib/transit/config';
import { getProvider } from '@/lib/transit/provider';

export const metadata: Metadata = { title: 'Transit diagnostics', robots: { index: false } };
export const dynamic = 'force-dynamic';

export default async function DevTransitPage() {
  // Never reachable in production unless explicitly enabled.
  if (!config.devPageEnabled) notFound();

  const provider = await getProvider();
  const health = await provider.health().catch((err) => ({ error: String(err) }) as never);

  return <DevConsole initialHealth={health} />;
}
