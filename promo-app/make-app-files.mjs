#!/usr/bin/env node
/**
 * tools/make-app-files.mjs — builds the installable /app entry for an app.
 *
 * Opening  https://<host>/app  must give the native "Install app" sheet. The
 * page itself is the normal SPA (served by the console's own express server),
 * and this script only publishes a second manifest whose start_url/scope point
 * at /app, so the installed icon launches /app instead of /.
 *
 *   dist/app-manifest.json   = public/manifest.json with start_url + scope /app
 *
 * Notes
 *  - `id` is left unchanged on purpose: an existing install is updated (its
 *    launch URL becomes /app) instead of appearing twice on the home screen.
 *  - The service worker stays where it already is (/sw.js, scope /), which
 *    already controls /app — no second worker, no scope fight.
 *  - Icons are absolute paths, so they resolve the same from /app.
 *
 * Run automatically by `npm run build` in each app.
 */
import fs from 'node:fs';
import path from 'node:path';

const appDir = process.cwd();
const publicDir = path.join(appDir, 'public');
const distDir = path.join(appDir, 'dist');

if (!fs.existsSync(distDir)) {
  console.error('[make-app-files] no dist/ — build first');
  process.exit(1);
}

const manifest = JSON.parse(fs.readFileSync(path.join(publicDir, 'manifest.json'), 'utf8'));

// /app is a real page, so its scope is /app; the icons and the worker stay at
// the root scope they already use.
const appManifest = { ...manifest, start_url: '/app', scope: '/' };

// installability needs a 192 and a 512 icon; fail loudly rather than shipping a
// manifest Chrome will silently refuse.
const sizes = (appManifest.icons || []).map((i) => String(i.sizes || ''));
if (!sizes.includes('192x192') || !sizes.includes('512x512')) {
  console.error(`[make-app-files] ${appDir}: manifest needs 192x192 and 512x512 icons, has ${sizes.join(', ')}`);
  process.exit(1);
}

fs.writeFileSync(path.join(distDir, 'app-manifest.json'), JSON.stringify(appManifest, null, 2) + '\n');

// The page at /app must POINT at that manifest, otherwise the browser installs
// the root manifest (start_url "/") and the icon launches the wrong entry.
const indexHtml = fs.readFileSync(path.join(distDir, 'index.html'), 'utf8');
const appHtml = indexHtml.replace(/<link[^>]+rel=["']manifest["'][^>]*>/gi,
  '<link rel="manifest" href="/app/manifest.json" />');
fs.writeFileSync(path.join(distDir, 'app.html'), appHtml);

console.log('[make-app-files] wrote dist/app-manifest.json (start_url=/app) + dist/app.html');
