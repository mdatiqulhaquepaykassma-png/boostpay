import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import { registerSW } from 'virtual:pwa-register';

// Register service worker immediately for PWA installability and offline support.
// When a new version deploys, gently notify the app so the user can refresh.
try {
  const updateSW = registerSW({
    immediate: true,
    onNeedRefresh() {
      (window as any).__boostpay_update_sw = updateSW;
      window.dispatchEvent(new CustomEvent('boostpay:update-available'));
      // Auto-apply update without hard refresh — skipWaiting + reload
      try { updateSW(true); } catch {}
    },
    onOfflineReady() {
      // optional: app ready offline
    }
  });
  (window as any).__boostpay_update_sw = updateSW;
  // Also listen for controlling change to auto-reload even if banner missed
  if (typeof navigator !== 'undefined' && (navigator as any).serviceWorker) {
    (navigator as any).serviceWorker.addEventListener('controllerchange', () => {
      // only reload once per update
      if (!(window as any).__boostpay_reloaded) {
        (window as any).__boostpay_reloaded = true;
        window.location.reload();
      }
    });
  }
} catch {
  // Ignore virtual SW error if any
}

// Ensure dedicated /sw.js with fetch listener is registered for Chromium install criteria
if (typeof window !== 'undefined' && 'serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch((err) => {
    console.debug('SW direct registration:', err);
  });
}

createRoot(document.getElementById('root')!).render(<App />);
