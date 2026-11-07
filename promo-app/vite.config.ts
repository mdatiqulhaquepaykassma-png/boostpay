import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Promotion console: a standalone app. In production it is served by its own
// tiny node server (server.ts) which also proxies /api to the BoostPay API.
export default defineConfig({
  plugins: [react()],
  build: { outDir: 'dist', emptyOutDir: true },
});
