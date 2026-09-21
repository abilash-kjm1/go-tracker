import type { Metadata } from 'next';
import Link from 'next/link';
import { SignalShortcutSettings } from '@/components/settings/SignalShortcutSettings';
import { ThemePicker } from '@/components/ui/ThemePicker';
import { config } from '@/lib/transit/config';

export const metadata: Metadata = { title: 'More' };

const LINKS = [
  { href: '/plan', title: 'Plan a trip', body: 'Direct services between two stops.' },
  { href: '/routes', title: 'Routes', body: 'Every GO Train line and GO Bus route.' },
  { href: '/alerts', title: 'Alerts', body: 'Delays currently reported in service.' },
  { href: '/about', title: 'About & attribution', body: 'Who runs this app and where the data comes from.' },
];

export default function MorePage() {
  return (
    <div className="mx-auto w-full max-w-2xl px-4 pt-safe">
      <header className="pt-6 pb-4">
        <h1 className="text-[28px] leading-tight font-semibold tracking-tight">More</h1>
      </header>

      <section className="mb-6">
        <h2 className="px-1 pb-2 text-[11px] font-semibold tracking-wide text-faint uppercase">
          Appearance
        </h2>
        <div className="rounded-2xl border px-4 py-4 hairline bg-[var(--bg-elevated)]">
          <ThemePicker />
        </div>
      </section>

      <section className="mb-6">
        <h2 className="px-1 pb-2 text-[11px] font-semibold tracking-wide text-faint uppercase">
          Signal shortcut
        </h2>
        <div className="rounded-2xl border px-4 py-4 hairline bg-[var(--bg-elevated)]">
          <SignalShortcutSettings />
        </div>
      </section>

      <ul className="space-y-1">
        {LINKS.map((link) => (
          <li key={link.href}>
            <Link
              href={link.href}
              className="flex min-h-16 items-center gap-3 rounded-xl px-3 transition-colors hover:bg-[var(--bg-sunken)]"
            >
              <span className="min-w-0 flex-1">
                <span className="block font-medium">{link.title}</span>
                <span className="block truncate text-[13px] text-muted">{link.body}</span>
              </span>
              <span aria-hidden className="text-[var(--fg-faint)]">
                ›
              </span>
            </Link>
          </li>
        ))}
        {config.devPageEnabled ? (
          <li>
            <Link
              href="/dev/transit"
              className="flex min-h-16 items-center gap-3 rounded-xl px-3 transition-colors hover:bg-[var(--bg-sunken)]"
            >
              <span className="min-w-0 flex-1">
                <span className="block font-medium">Developer diagnostics</span>
                <span className="block truncate text-[13px] text-muted">
                  Provider status and raw upstream responses.
                </span>
              </span>
              <span aria-hidden className="text-[var(--fg-faint)]">
                ›
              </span>
            </Link>
          </li>
        ) : null}
      </ul>

      <div className="h-8" />
    </div>
  );
}
