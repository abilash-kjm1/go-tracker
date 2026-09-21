'use client';

import clsx from 'clsx';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { useOnline } from '@/lib/client/useTransit';
import { ActiveTripBar } from '@/components/trips/ActiveTripBar';
import { SignalDangle } from '@/components/ui/SignalDangle';

const NAV = [
  { href: '/', label: 'Home', icon: HomeIcon },
  { href: '/map', label: 'Map', icon: MapIcon },
  { href: '/stations', label: 'Stations', icon: StationIcon },
  { href: '/favorites', label: 'Favorites', icon: StarIcon },
  { href: '/more', label: 'More', icon: MoreIcon },
] as const;

const isActive = (pathname: string, href: string) =>
  href === '/' ? pathname === '/' : pathname.startsWith(href);

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const online = useOnline();
  // The map owns its own full-bleed layout.
  const fullBleed = pathname.startsWith('/map');

  return (
    <div className="min-h-dvh md:flex">
      <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col gap-1 border-r px-3 py-5 hairline md:flex">
        <Link href="/" className="mb-5 flex items-center gap-2 px-2">
          <Wordmark />
        </Link>
        {NAV.map((item) => {
          const active = isActive(pathname, item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? 'page' : undefined}
              className={clsx(
                'flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors',
                active
                  ? 'bg-[var(--bg-sunken)] text-[var(--fg)]'
                  : 'text-[var(--fg-muted)] hover:bg-[var(--bg-sunken)] hover:text-[var(--fg)]',
              )}
            >
              <item.icon className="size-5" />
              {item.label}
            </Link>
          );
        })}
        <div className="mt-auto px-3 text-[11px] leading-relaxed text-faint">
          Independent app. Not operated by Metrolinx or GO Transit.
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {!online ? (
          <div className="sticky top-0 z-40 bg-warn-500/15 px-4 py-2 text-center text-xs font-medium text-warn-500 pt-safe">
            You&rsquo;re offline — showing the latest information we had.
          </div>
        ) : null}
        <main className={clsx('flex-1', fullBleed ? 'min-h-0' : 'pb-24 md:pb-8')}>{children}</main>
      </div>

      <nav
        aria-label="Primary"
        className="fixed inset-x-0 bottom-0 z-40 h-nav border-t bg-[var(--bg-elevated)]/92 backdrop-blur-xl hairline md:hidden"
      >
        <ul className="grid h-16 grid-cols-5">
          {NAV.map((item) => {
            const active = isActive(pathname, item.href);
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  aria-current={active ? 'page' : undefined}
                  className={clsx(
                    'flex h-full flex-col items-center justify-center gap-1 text-[10px] font-medium transition-colors',
                    active ? 'text-[var(--accent)]' : 'text-[var(--fg-muted)]',
                  )}
                >
                  <item.icon className="size-6" />
                  {item.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      <SignalDangle />
      <ActiveTripBar />
    </div>
  );
}

export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={clsx('flex items-center gap-2', className)}>
      <span className="grid size-8 place-items-center rounded-xl bg-[var(--accent)] text-[var(--accent-fg)]">
        <svg viewBox="0 0 20 20" className="size-5" fill="none" aria-hidden>
          <path d="M4 14.5 9 5l3 5.5L14.5 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          <circle cx="15.5" cy="14" r="1.6" fill="currentColor" />
        </svg>
      </span>
      <span className="text-[15px] font-semibold tracking-tight">GO Tracker</span>
    </span>
  );
}

type IconProps = { className?: string };

function HomeIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" aria-hidden>
      <path d="M4 10.5 12 4l8 6.5V19a1 1 0 0 1-1 1h-4.5v-5h-5v5H5a1 1 0 0 1-1-1v-8.5Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
    </svg>
  );
}
function MapIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" aria-hidden>
      <path d="m9 4.5-5 2V20l5-2 6 2 5-2V5l-5 2-6-2.5Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
      <path d="M9 4.5V18M15 7v13" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  );
}
function StationIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" aria-hidden>
      <rect x="6" y="3.5" width="12" height="13" rx="3" stroke="currentColor" strokeWidth="1.6" />
      <path d="M6 9.5h12" stroke="currentColor" strokeWidth="1.6" />
      <circle cx="9.5" cy="13" r="1.1" fill="currentColor" />
      <circle cx="14.5" cy="13" r="1.1" fill="currentColor" />
      <path d="m9 16.5-2 4M15 16.5l2 4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}
function StarIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" aria-hidden>
      <path d="m12 3.6 2.7 5.5 6 .9-4.35 4.25L17.4 20 12 17.15 6.6 20l1.05-5.75L3.3 10l6-.9L12 3.6Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
    </svg>
  );
}
function MoreIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" aria-hidden>
      <circle cx="5.5" cy="12" r="1.5" fill="currentColor" />
      <circle cx="12" cy="12" r="1.5" fill="currentColor" />
      <circle cx="18.5" cy="12" r="1.5" fill="currentColor" />
    </svg>
  );
}
