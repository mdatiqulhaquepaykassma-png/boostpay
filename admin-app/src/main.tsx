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
