import React from 'react';
import { createRoot } from 'react-dom/client';
import { AdminPortal } from './components/AdminPortal';
import './index.css';

const App = () => (
  <div className="min-h-screen bg-zinc-950 text-white">
    <AdminPortal />
  </div>
);

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

// PWA: register the service worker (needed for install + push notifications)
if (typeof window !== 'undefined' && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch((err) => {
      console.warn('Service worker registration failed:', err);
    });
  });
}
