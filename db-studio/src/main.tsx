import React from 'react';
import { createRoot } from 'react-dom/client';
import { DbStudio } from './DbStudio';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <DbStudio />
  </React.StrictMode>
);
