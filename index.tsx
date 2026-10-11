import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import App from './App';
import ErrorBoundary from './components/ErrorBoundary';

// Global Build Version - Auto-invalidates stale caches across updates
const APP_BUILD_VERSION = '2026.10.11-v10';

try {
  const currentVersion = localStorage.getItem('dpl_app_build_version');
  if (currentVersion !== APP_BUILD_VERSION) {
    localStorage.setItem('dpl_app_build_version', APP_BUILD_VERSION);
    // Purge old cache storage from previous builds
    if (typeof caches !== 'undefined') {
      caches.keys().then((names) => {
        names.forEach((name) => caches.delete(name));
      }).catch(() => {});
    }
    // Clean up temporary draft flags and broken state from previous deployments
    const temporaryKeys = [
      'dpl_reg_draft_active', 'dpl_reg_step', 'dpl_reg_caseno',
      'dpl_reg_formdata', 'dpl_reg_docs', 'dpl_reg_updated_at',
      'dpl_reg_timestamp', 'dpl_reg_view', 'dpl_bundle_auto_healed'
    ];
    temporaryKeys.forEach((k) => {
      try { localStorage.removeItem(k); } catch (_) {}
      try { sessionStorage.removeItem(k); } catch (_) {}
    });
  }
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

// Register Service Worker for PWA / Google Play Store TWA only on production custom domains
if ('serviceWorker' in navigator && typeof window !== 'undefined' && !window.location.hostname.includes('ais-')) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').then((reg) => {
      // Check for updates on page load
      reg.update().catch(() => {});
    }).catch(() => {});
  });
}
