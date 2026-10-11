// Service Worker for MAK Group of Companies
// Play Store / TWA / PWABuilder Compliant Service Worker with Auto-Update

const CACHE_NAME = 'mak-group-pwa-v10';
const OFFLINE_URL = '/';

// Install: Immediately skip waiting to take over
self.addEventListener('install', (event) => {
  self.skipWaiting();
});

// Activate: Clean ALL old caches and claim clients immediately so new code runs without reload issues
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }
          return Promise.resolve();
        })
      );
    }).then(() => self.clients.claim())
  );
});

// Fetch: Clean pass-through for development, API calls, and new deployments
self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);

  // Bypass all dev/preview endpoints and non-GET requests
  if (
    request.method !== 'GET' ||
    url.origin !== self.location.origin ||
    url.pathname.startsWith('/api/') ||
    url.pathname.startsWith('/@') ||
    url.pathname.includes('/node_modules/') ||
    url.pathname.endsWith('.tsx') ||
    url.pathname.endsWith('.ts') ||
    url.search.includes('v=') ||
    url.hostname.includes('ais-dev-') ||
    url.hostname.includes('ais-pre-') ||
    url.hostname.includes('localhost') ||
    url.hostname.includes('127.0.0.1') ||
    url.pathname.includes('firestore.googleapis.com') ||
    url.pathname.includes('identitytoolkit.googleapis.com')
  ) {
    return;
  }

  // Network-first for navigation requests with cache fallback
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request, { cache: 'no-cache' }).catch(() => {
        return caches.match(OFFLINE_URL);
      })
    );
    return;
  }

  // Network-first for all other assets; do not cache 404 or bad responses
  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response && response.status === 200 && response.type === 'basic') {
          const responseToCache = response.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(request, responseToCache);
          }).catch(() => {});
        }
        return response;
      })
      .catch(() => {
        return caches.match(request);
      })
  );
});
