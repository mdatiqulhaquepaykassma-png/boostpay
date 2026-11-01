#!/usr/bin/env node
/**
 * icons.mjs — put the BoostPay logo on the Android launcher + splash.
 * Uses the PWA artwork already in public/ (no extra dependency, no image resizing
 * library): Android scales the 512px source for every density.
 *
 *   node scripts/icons.mjs user        (or agent | management | admin)
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const mobileDir = path.resolve(here, '..');
const repoRoot = path.resolve(mobileDir, '..');
const resDir = path.join(mobileDir, 'android', 'app', 'src', 'main', 'res');

const app = (process.argv[2] || 'user').toLowerCase();
const icons = {
  user: { icon: 'public/pwa-512x512.png', splash: 'public/pwa-512x512.png' },
  agent: { icon: 'agent-app/public/pwa-512x512.png', splash: 'agent-app/public/pwa-512x512.png' },
  management: { icon: 'management-app/public/pwa-512x512.png', splash: 'management-app/public/pwa-512x512.png' },
  admin: { icon: 'admin-app/public/pwa-512x512.png', splash: 'admin-app/public/pwa-512x512.png' }
}[app];

if (!icons) {
  console.error(`Unknown app "${app}". Use: user | agent | management | admin`);
  process.exit(1);
}

const src = path.resolve(repoRoot, icons.icon);
const fallback = path.resolve(repoRoot, 'public/pwa-512x512.png');
const image = fs.existsSync(src) ? src : fallback;
if (!fs.existsSync(image)) {
  console.error('No source icon found — run this after the app has a pwa-512x512.png.');
  process.exit(1);
}

if (!fs.existsSync(resDir)) {
  console.error('android/ platform missing — run: npx cap add android');
  process.exit(1);
}

let n = 0;
for (const folder of fs.readdirSync(resDir)) {
  const full = path.join(resDir, folder);
  if (!fs.statSync(full).isDirectory()) continue;
  const isMipmap = folder.startsWith('mipmap');
  const isSplash = folder.startsWith('drawable') && folder !== 'drawable';
  if (isMipmap) {
    for (const name of ['ic_launcher.png', 'ic_launcher_round.png', 'ic_launcher_foreground.png']) {
      const target = path.join(full, name);
      if (fs.existsSync(target)) { fs.copyFileSync(image, target); n++; }
    }
  } else if (isSplash) {
    const target = path.join(full, 'splash.png');
    if (fs.existsSync(target)) { fs.copyFileSync(image, target); n++; }
  }
}
// Adaptive-icon background: BoostPay dark.
const bg = path.join(resDir, 'drawable', 'ic_launcher_background.xml');
if (fs.existsSync(bg)) {
  fs.writeFileSync(bg, `<?xml version="1.0" encoding="utf-8"?>
<shape xmlns:android="http://schemas.android.com/apk/res/android" android:shape="rectangle">
    <solid android:color="#09090b" />
</shape>
`);
  n++;
}
console.log(`icons.mjs: updated ${n} drawables for the ${app} app from ${path.basename(image)}`);
