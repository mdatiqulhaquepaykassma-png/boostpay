import React from 'react';
import { createRoot } from 'react-dom/client';
import { DbStudio } from './DbStudio';
import './index.css';

// PWA: makes /app installable (a manifest without a service worker is not
// installable on Android/Chrome).
if (typeof window !== 'undefined' && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => {
      /* install prompt simply stays unavailable */
    });
  });
}

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <DbStudio />
  </React.StrictMode>
);
