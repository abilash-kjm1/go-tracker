import type { Metadata, Viewport } from 'next';
import './globals.css';
import { AppShell } from '@/components/navigation/AppShell';
import { ServiceWorker } from '@/components/ui/ServiceWorker';
import { THEME_BOOTSTRAP } from '@/lib/client/theme';

export const metadata: Metadata = {
  title: { default: 'GO Tracker', template: '%s · GO Tracker' },
  description:
    'Live GO Train and GO Bus departures, delays and vehicle positions. An independent transit tracker.',
  manifest: '/manifest.webmanifest',
  applicationName: 'GO Tracker',
  appleWebApp: { capable: true, statusBarStyle: 'black-translucent', title: 'GO Tracker' },
  icons: {
    icon: [{ url: '/icons/icon.svg', type: 'image/svg+xml' }],
    apple: [{ url: '/icons/apple-touch-icon.png' }],
  },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f6f8fa' },
    { media: '(prefers-color-scheme: dark)', color: '#0b0f17' },
  ],
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  maximumScale: 5,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Applied before first paint so dark mode never flashes white. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOTSTRAP }} />
      </head>
      <body className="antialiased">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:left-3 focus:top-3 focus:z-50 focus:rounded-lg focus:bg-[var(--accent)] focus:px-3 focus:py-2 focus:text-[var(--accent-fg)]"
        >
          Skip to content
        </a>
        <AppShell>
          <div id="main">{children}</div>
        </AppShell>
        <ServiceWorker />
      </body>
    </html>
  );
}
