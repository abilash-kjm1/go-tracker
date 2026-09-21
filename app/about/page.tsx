import type { Metadata } from 'next';
import { Wordmark } from '@/components/navigation/AppShell';
import { getMeta } from '@/lib/transit/gtfs';

export const metadata: Metadata = { title: 'About' };
export const dynamic = 'force-dynamic';

export default async function AboutPage() {
  const meta = await getMeta().catch(() => null);

  return (
    <div className="mx-auto w-full max-w-2xl px-4 pt-safe">
      <header className="pt-8 pb-5">
        <Wordmark />
        <h1 className="mt-4 text-[28px] leading-tight font-semibold tracking-tight">
          An independent GO Transit tracking application.
        </h1>
      </header>

      <div className="space-y-4 text-[15px] leading-relaxed text-muted">
        <p>
          GO Tracker is an independent project. It is not operated by, endorsed by, or affiliated
          with Metrolinx or GO Transit.
        </p>
        <p>
          Real-time and schedule information is provided through applicable GO Transit / Metrolinx
          data sources. Schedule data comes from the published GO Transit GTFS feed. Live vehicle
          positions and delays come from the GO Transit real-time service currently configured for
          this deployment.
        </p>
        <p>
          Times shown here are best-effort. Always check official GO Transit channels before
          travelling, especially during disruptions.
        </p>
        <p>
          Map tiles &copy;{' '}
          <a className="text-[var(--accent)]" href="https://carto.com/attributions">
            CARTO
          </a>
          , map data &copy;{' '}
          <a className="text-[var(--accent)]" href="https://www.openstreetmap.org/copyright">
            OpenStreetMap
          </a>{' '}
          contributors.
        </p>
      </div>

      {meta ? (
        <dl className="mt-8 grid grid-cols-2 gap-x-4 gap-y-3 rounded-2xl border px-4 py-4 text-sm hairline">
          <dt className="text-muted">Schedule source</dt>
          <dd className="text-right font-medium">{meta.publisher} GTFS</dd>
          <dt className="text-muted">Feed version</dt>
          <dd className="tabular text-right font-medium">{meta.feedVersion ?? 'unknown'}</dd>
          <dt className="text-muted">Snapshot built</dt>
          <dd className="text-right font-medium">
            {new Date(meta.generatedAt).toLocaleDateString('en-CA')}
          </dd>
          <dt className="text-muted">Days covered</dt>
          <dd className="tabular text-right font-medium">{meta.dates.length}</dd>
        </dl>
      ) : null}

      <div className="h-10" />
    </div>
  );
}
