/* eslint-disable no-undef */
// Background Firebase Cloud Messaging (FCM) Service Worker for MAK Group of Companies
// Supports Android (TWA / PWABuilder APK) and Windows / macOS Desktop when app or browser is closed/minimized.

importScripts('https://www.gstatic.com/firebasejs/10.14.1/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.14.1/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: 'AIzaSyBeqE3m7X4uQ5p1n-p_p9k1T-H_3m6rI5U',
  authDomain: 'gen-lang-client-0130190709.firebaseapp.com',
  projectId: 'gen-lang-client-0130190709',
  storageBucket: 'gen-lang-client-0130190709.firebasestorage.app',
  messagingSenderId: '909385350620',
  appId: '1:909385350620:web:78e5352aeb4ac1ab816319'
});

const messaging = firebase.messaging();

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

messaging.onBackgroundMessage((payload) => {
  try {
    const notif = (payload && payload.notification) || {};
    const data = (payload && payload.data) || {};

    const notificationTitle =
      notif.title ||
      data.title ||
      'MAK Group of Companies';

    const notificationBody =
      notif.body ||
      data.body ||
      data.description ||
      'You have a new logistics alert or workflow assignment.';

    const targetUrl = data.url || (data.targetView ? `/?view=${encodeURIComponent(data.targetView)}` : '/');
    const iconUrl = notif.icon || data.icon || '/pwa-192x192-v3.png';
    const badgeUrl = data.badge || '/pwa-192x192-v3.png';
    const notifTag = data.notificationId ? `mak-notif-${data.notificationId}` : `mak-push-${Date.now()}`;

    const notificationOptions = {
      body: notificationBody,
      icon: iconUrl,
      badge: badgeUrl,
      tag: notifTag,
      renotify: true,
      vibrate: [180, 90, 180],
      requireInteraction: data.priority === 'HIGH',
      data: {
        url: targetUrl,
        caseNo: data.caseNo || '',
        targetView: data.targetView || '',
        notificationId: data.notificationId || ''
      }
    };

    return self.registration.showNotification(notificationTitle, notificationOptions);
  } catch (err) {
    console.warn('[MAK FCM SW] Background message display error:', err);
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
          const clientOrigin = new URL(client.url).origin;
          if (clientOrigin === self.location.origin && 'focus' in client) {
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
