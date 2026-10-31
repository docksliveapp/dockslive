// Service Worker for MAK Group of Companies
// Production Cache-First + Stale-While-Revalidate App Shell Strategy
// Provides instant offline-capable native launch for Android APK (PWABuilder / TWA), iOS, Windows, and macOS.

const CACHE_NAME = 'mak-group-cache-first-v2026-12';
const FONT_CACHE_NAME = 'mak-group-fonts-v2026-12';

const CORE_APP_SHELL = [
  '/',
  '/index.html',
  '/index.css',
  '/manifest.json',
  '/manifest.webmanifest',
  '/favicon.svg',
  '/favicon-32x32.png',
  '/favicon-16x16.png',
  '/apple-touch-icon-v3.png',
  '/pwa-192x192-v3.png',
  '/pwa-512x512-v3.png'
];

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(CORE_APP_SHELL).catch(() => {});
    })
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME && key !== FONT_CACHE_NAME) {
            return caches.delete(key);
          }
          return Promise.resolve();
        })
      );
    }).then(() => self.clients.claim())
  );
});

function isStaticAsset(url, request) {
  const dest = request.destination || '';
  if (
    dest === 'style' ||
    dest === 'script' ||
    dest === 'worker' ||
    dest === 'font' ||
    dest === 'image' ||
    dest === 'manifest'
  ) {
    return true;
  }
  return /\.(?:js|mjs|css|woff2?|ttf|otf|png|jpe?g|gif|svg|webp|ico|json|webmanifest)(\?.*)?$/i.test(url.pathname);
}

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  const url = new URL(event.request.url);

  // Never intercept live database, API, or authentication endpoints
  if (
    url.pathname.startsWith('/api/') ||
    url.hostname.includes('firestore.googleapis.com') ||
    url.hostname.includes('identitytoolkit.googleapis.com') ||
    url.hostname.includes('securetoken.googleapis.com') ||
    url.hostname.includes('accounts.google.com')
  ) {
    return;
  }

  // Cache-First strategy for Google Fonts stylesheets and font binaries
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    event.respondWith(
      caches.open(FONT_CACHE_NAME).then((cache) => {
        return cache.match(event.request).then((cachedResponse) => {
          const networkFetch = fetch(event.request)
            .then((networkResponse) => {
              if (networkResponse && (networkResponse.status === 200 || networkResponse.type === 'opaque')) {
                cache.put(event.request, networkResponse.clone()).catch(() => {});
              }
              return networkResponse;
            })
            .catch(() => cachedResponse);
          return cachedResponse || networkFetch;
        });
      })
    );
    return;
  }

  // Only handle same-origin requests for App Shell and static bundles
  if (url.origin !== self.location.origin) return;

  // Cache-First with background Stale-While-Revalidate for all static assets & App Shell navigations
  if (event.request.mode === 'navigate' || isStaticAsset(url, event.request)) {
    event.respondWith(
      caches.open(CACHE_NAME).then((cache) => {
        return cache.match(event.request, { ignoreSearch: event.request.mode === 'navigate' }).then((cachedResponse) => {
          const fetchPromise = fetch(event.request)
            .then((networkResponse) => {
              if (networkResponse && networkResponse.status === 200 && networkResponse.type === 'basic') {
                cache.put(event.request, networkResponse.clone()).catch(() => {});
              }
              return networkResponse;
            })
            .catch(() => {
              if (event.request.mode === 'navigate') {
                return cache.match('/index.html') || cache.match('/');
              }
              return cachedResponse;
            });

          // Return cached response immediately if available (Cache-First), while updating cache in background
          return cachedResponse || fetchPromise;
        });
      })
    );
    return;
  }
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ('focus' in client) {
          return client.focus();
        }
      }
      if (self.clients.openWindow) {
        return self.clients.openWindow(targetUrl);
      }
    })
  );
});
