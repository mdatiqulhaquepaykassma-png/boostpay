import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './index.css';

// PWA: register the shell service worker so the console is installable on a phone.
// API traffic is never cached (support replies and money data must be live).
if (typeof window !== 'undefined' && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => {
      /* installability is nice-to-have; the app works without it */
    });
  });
}

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
