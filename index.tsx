import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import App from './App';
import ErrorBoundary from './components/ErrorBoundary';

// Global Build Version - Auto-invalidates stale caches on every refresh / domain open
const APP_BUILD_VERSION = '2026.10.21-luxury-pearl-v16';

try {
  // Always clear browser CacheStorage so old JS/HTML/CSS bundles never persist
  if (typeof caches !== 'undefined') {
    caches.keys().then((names) => {
      names.forEach((name) => {
        caches.delete(name).catch(() => {});
      });
    }).catch(() => {});
  }

  // Unregister any old caching Service Workers that trap the domain on old builds
  if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
    navigator.serviceWorker.getRegistrations().then((registrations) => {
      for (const registration of registrations) {
        registration.unregister().catch(() => {});
      }
    }).catch(() => {});
  }

  // Purge stale temporary UI/draft cache keys on every page load/refresh
  // while preserving all live operational data (dpl_live_*) synced with Firestore
  const staleCacheKeys = [
    'dpl_reg_draft_active',
    'dpl_reg_step',
    'dpl_reg_caseno',
    'dpl_reg_formdata',
    'dpl_reg_docs',
    'dpl_reg_updated_at',
    'dpl_reg_timestamp',
    'dpl_reg_view',
    'dpl_bundle_auto_healed',
    'dpl_mock_cache',
    'dpl_temp_filter'
  ];
  staleCacheKeys.forEach((k) => {
    try { localStorage.removeItem(k); } catch (_) {}
    try { sessionStorage.removeItem(k); } catch (_) {}
  });

  localStorage.setItem('dpl_app_build_version', APP_BUILD_VERSION);
} catch (_) {}

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

const root = ReactDOM.createRoot(rootElement);
root.render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>
);
