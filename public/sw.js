/*
 * GO Tracker service worker.
 *
 * App shell is cached so the PWA opens offline. Transit API responses are
 * network-first and stored in a separate cache; when a cached API response is
 * served, the `x-gt-cached-at` header tells the UI exactly how old it is so it
 * is never presented as live.
 */

const SHELL_CACHE = 'gt-shell-v1';
const API_CACHE = 'gt-api-v1';
const SHELL_URLS = ['/', '/map', '/stations', '/favorites', '/offline', '/icons/icon.svg'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) => cache.addAll(SHELL_URLS).catch(() => undefined))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.filter((k) => k !== SHELL_CACHE && k !== API_CACHE).map((k) => caches.delete(k)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (url.pathname.startsWith('/api/transit/')) {
    event.respondWith(networkFirst(request));
    return;
  }

  if (request.mode === 'navigate') {
    event.respondWith(navigationHandler(request));
    return;
  }

  event.respondWith(cacheFirst(request));
});

async function networkFirst(request) {
  const cache = await caches.open(API_CACHE);
  try {
    const response = await fetch(request);
    if (response.ok) {
      // Stamp the time so the client can label cached data honestly.
      const body = await response.clone().blob();
      const headers = new Headers(response.headers);
      headers.set('x-gt-cached-at', new Date().toISOString());
      await cache.put(request, new Response(body, { status: response.status, headers }));
    }
    return response;
  } catch (err) {
    const cached = await cache.match(request);
    if (cached) return cached;
    throw err;
  }
}

async function navigationHandler(request) {
  try {
    return await fetch(request);
  } catch {
    const cache = await caches.open(SHELL_CACHE);
    return (await cache.match(request)) ?? (await cache.match('/offline')) ?? Response.error();
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(SHELL_CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok && new URL(request.url).pathname.startsWith('/icons/')) {
    cache.put(request, response.clone());
  }
  return response;
}

/* A stop alert opens the trip it came from. */
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = event.notification.data && event.notification.data.url;
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if ('focus' in client) {
          if (target && 'navigate' in client) client.navigate(target).catch(() => undefined);
          return client.focus();
        }
      }
      return self.clients.openWindow(target || '/');
    }),
  );
});
