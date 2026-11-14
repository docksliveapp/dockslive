// Service Worker for MAK Group of Companies
// Production Cache-First + Stale-While-Revalidate App Shell Strategy
// Provides instant offline-capable native launch for Android APK (PWABuilder / TWA), iOS, Windows, and macOS.

const CACHE_NAME = 'mak-group-cache-first-v2026-22';
const FONT_CACHE_NAME = 'mak-group-fonts-v2026-22';

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
  '/pwa-512x512-v3.png',
  '/logos/mak_main_logo.png',
  '/logos/mak_main_logo_dark.png'
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

  // Network-First with offline cache fallback for HTML navigations so updates apply immediately
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request, { cache: 'no-store' })
        .then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            const copy = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put('/index.html', copy).catch(() => {});
            });
          }
          return networkResponse;
        })
        .catch(() => {
          return caches.open(CACHE_NAME).then((cache) => {
            return cache.match('/index.html') || cache.match('/');
          });
        })
    );
    return;
  }

  // Stale-While-Revalidate for static assets
  if (isStaticAsset(url, event.request)) {
    event.respondWith(
      caches.open(CACHE_NAME).then((cache) => {
        return cache.match(event.request).then((cachedResponse) => {
          const fetchPromise = fetch(event.request)
            .then((networkResponse) => {
              if (networkResponse && networkResponse.status === 200 && networkResponse.type === 'basic') {
                cache.put(event.request, networkResponse.clone()).catch(() => {});
              }
              return networkResponse;
            })
            .catch(() => cachedResponse);

          return cachedResponse || fetchPromise;
        });
      })
    );
    return;
  }
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const notifData = (event.notification && event.notification.data) || {};
  const targetUrl = notifData.url || '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        try {
          if (new URL(client.url).origin === self.location.origin && 'focus' in client) {
            client.postMessage({
              type: 'MAK_PUSH_CLICK',
              url: targetUrl,
              caseNo: notifData.caseNo || '',
              targetView: notifData.targetView || '',
              notificationId: notifData.notificationId || ''
            });
            return client.focus();
          }
        } catch (_) {}
      }
      if (self.clients.openWindow) {
        return self.clients.openWindow(targetUrl);
      }
    })
  );
});
