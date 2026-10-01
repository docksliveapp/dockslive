// Service Worker for DPL - Docks Private Limited
// Play Store / TWA / PWABuilder 100% Compliant Service Worker

const CACHE_NAME = 'docks-pwa-v3';
const OFFLINE_URL = '/';

const PRECACHE_ASSETS = [
  '/',
  '/index.html',
  '/manifest.webmanifest',
  '/manifest.json',
  '/favicon.svg',
  '/logo.svg',
  '/pwa-192x192.png',
  '/pwa-512x512.png',
  '/pwa-192x192-v2.png',
  '/pwa-512x512-v2.png',
  '/pwa-maskable-512x512-v2.png',
  '/apple-touch-icon.png',
  '/apple-touch-icon-v2.png'
];

// Install: Cache essential app shell
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      // Precache assets individually so one failure does not break the entire service worker
      for (const asset of PRECACHE_ASSETS) {
        try {
          await cache.add(asset);
        } catch (e) {
          console.warn('[SW] Could not precache:', asset);
        }
      }
    })
  );
  self.skipWaiting();
});

// Activate: Clean old caches and claim clients immediately
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      );
    }).then(() => self.clients.claim())
  );
});

// Fetch: Network-first with offline fallback for navigation requests
self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);

  // Bypass non-GET requests or external APIs/Firestore
  if (
    request.method !== 'GET' ||
    url.origin !== self.location.origin ||
    url.pathname.startsWith('/api/') ||
    url.pathname.includes('firestore.googleapis.com') ||
    url.pathname.includes('identitytoolkit.googleapis.com')
  ) {
    return;
  }

  // Navigation (HTML pages) - Network first, fall back to cached index.html / offline
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            const copy = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
          }
          return networkResponse;
        })
        .catch(async () => {
          const cached = await caches.match(request);
          if (cached) return cached;
          const fallback = await caches.match(OFFLINE_URL);
          if (fallback) return fallback;
          return new Response(
            `<!DOCTYPE html>
            <html lang="en">
            <head><meta charset="utf-8"><title>Docks Offline</title><meta name="viewport" content="width=device-width, initial-scale=1"></head>
            <body style="font-family: sans-serif; background: #0f172a; color: white; text-align: center; padding: 40px 20px;">
              <h2>Docks (Pvt.) Ltd</h2>
              <p>You are currently offline. Please reconnect to internet to access live logistics cases and data.</p>
              <button onclick="window.location.reload()" style="background:#2563eb;color:white;border:none;padding:10px 20px;border-radius:8px;cursor:pointer;">Retry Connection</button>
            </body>
            </html>`,
            { headers: { 'Content-Type': 'text/html' } }
          );
        })
    );
    return;
  }

  // Static assets (CSS, JS, Images, Fonts) - Stale-while-revalidate or Cache first
  event.respondWith(
    caches.match(request).then((cachedResponse) => {
      const fetchPromise = fetch(request)
        .then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200 && networkResponse.type === 'basic') {
            const copy = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
          }
          return networkResponse;
        })
        .catch(() => cachedResponse);

      return cachedResponse || fetchPromise;
    })
  );
});
