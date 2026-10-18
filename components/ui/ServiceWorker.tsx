'use client';

import { useEffect } from 'react';
import { watchDeviceRegistration } from '@/lib/client/pushDevice';

/**
 * Registers the PWA service worker once the page is idle, and keeps this
 * phone's push registration true for as long as the app is open.
 *
 * The second part is the habit borrowed from Settle. A browser may renew a
 * push address at any time, and a server record pointing at the old one looks
 * exactly like a working one right up until the morning it fails to tell
 * somebody their platform. Re-saving on every open, and again whenever the
 * app comes back to the foreground, corrects that within one use of the app
 * instead of never.
 */
export function ServiceWorker() {
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    if (process.env.NODE_ENV !== 'production') return;
    const register = () => {
      navigator.serviceWorker.register('/sw.js').catch(() => {
        // Registration failures are non-fatal — the app still works online.
      });
    };
    if (document.readyState === 'complete') register();
    else window.addEventListener('load', register, { once: true });
  }, []);

  useEffect(() => {
    if (process.env.NODE_ENV !== 'production') return;
    return watchDeviceRegistration();
  }, []);

  return null;
}
