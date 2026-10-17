import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import { registerSW } from 'virtual:pwa-register';

// Register service worker immediately for PWA installability and offline support
try {
  registerSW({ immediate: true });
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
