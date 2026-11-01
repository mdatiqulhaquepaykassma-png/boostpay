#!/usr/bin/env node
/**
 * prepare.mjs — build one web app and copy it into the Android shell.
 *
 *   node scripts/prepare.mjs user         → mobile/www = BoostPay user app
 *   node scripts/prepare.mjs agent        → mobile/www = agent app
 *   node scripts/prepare.mjs management   → mobile/www = management app
 *   node scripts/prepare.mjs admin        → mobile/www = admin console
 *
 * After this, `npx cap sync android` (or `npm run sync`) copies www/ into the
 * Android project, and `npm run apk:debug` (or GitHub Actions) produces the APK.
 *
 * Only DIST output is used — the app ships as static files, it never loads the
 * website from the internet (that is what keeps it alive when a domain dies).
 */
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const mobileDir = path.resolve(here, '..');
const repoRoot = path.resolve(mobileDir, '..');

const APPS = {
  user: { dir: '.', name: 'BoostPay', appId: 'com.boostpay.app' },
  agent: { dir: 'agent-app', name: 'BoostPay Agent', appId: 'com.boostpay.agent' },
  management: { dir: 'management-app', name: 'BoostPay Management', appId: 'com.boostpay.management' },
  admin: { dir: 'admin-app', name: 'BoostPay Admin', appId: 'com.boostpay.admin' }
};

const which = (process.argv[2] || 'user').toLowerCase();
const app = APPS[which];
if (!app) {
  console.error(`Unknown app "${which}". Use one of: ${Object.keys(APPS).join(', ')}`);
  process.exit(1);
}

const appDir = path.resolve(repoRoot, app.dir);
const dist = path.join(appDir, 'dist');
const www = path.join(mobileDir, 'www');

console.log(`[1/4] building ${which} app (${app.dir}) …`);
execSync('npm run build', { cwd: appDir, stdio: 'inherit' });

if (!fs.existsSync(path.join(dist, 'index.html'))) {
  console.error(`Build produced no dist/index.html in ${dist}`);
  process.exit(1);
}

console.log('[2/4] copying dist → mobile/www …');
execSync(`rm -rf "${www}"`, { stdio: 'inherit' });
fs.mkdirSync(www, { recursive: true });
execSync(`cp -R "${dist}/." "${www}/"`, { stdio: 'inherit' });

// The Android app has no service-worker push (it uses FCM later), and a cached SW
// inside the WebView only serves stale bundles — drop it.
for (const f of ['sw.js', 'push-sw.js', 'registerSW.js', 'workbox-*.js']) {
  for (const name of fs.readdirSync(www)) {
    if (f.includes('*') ? name.startsWith(f.replace('*', '')) : name === f) {
      fs.rmSync(path.join(www, name), { force: true });
    }
  }
}

// index.html must load api-base.js first (it decides which server to talk to).
const indexPath = path.join(www, 'index.html');
let html = fs.readFileSync(indexPath, 'utf8');
if (!html.includes('api-base.js')) {
  html = html.replace(/<head>/, '<head>\n    <script src="/api-base.js"></script>');
  fs.writeFileSync(indexPath, html);
}
if (!fs.existsSync(path.join(www, 'api-base.js'))) {
  fs.copyFileSync(path.join(repoRoot, 'public', 'api-base.js'), path.join(www, 'api-base.js'));
}

console.log('[3/4] writing app metadata (appId / name) …');
const cfgPath = path.join(mobileDir, 'capacitor.config.json');
const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
cfg.appId = app.appId;
cfg.appName = app.name;
fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2) + '\n');

// Each app gets its own Android package id (user/admin/agent/management can be
// installed side by side) and app label.
const gradlePath = path.join(mobileDir, 'android', 'app', 'build.gradle');
if (fs.existsSync(gradlePath)) {
  let gradle = fs.readFileSync(gradlePath, 'utf8');
  gradle = gradle.replace(/applicationId "[^"]*"/, `applicationId "${app.appId}"`);
  fs.writeFileSync(gradlePath, gradle);
}
const stringsPath = path.join(mobileDir, 'android', 'app', 'src', 'main', 'res', 'values', 'strings.xml');
if (fs.existsSync(stringsPath)) {
  let xml = fs.readFileSync(stringsPath, 'utf8');
  xml = xml.replace(/(<string name="app_name">)[^<]*(<\/string>)/, `$1${app.name}$2`);
  xml = xml.replace(/(<string name="title_activity_main">)[^<]*(<\/string>)/, `$1${app.name}$2`);
  fs.writeFileSync(stringsPath, xml);
}

// Version stamp so the app can show which build it is running.
const versionFile = path.join(www, 'build.json');
fs.writeFileSync(
  versionFile,
  JSON.stringify({ app: which, appId: app.appId, builtAt: new Date().toISOString(), git: safeGit('rev-parse --short HEAD') }, null, 2)
);

console.log('[4/4] done. Assets in mobile/www.');
console.log('       next: npm run sync   (copies into android/)');
console.log('             npm run apk:debug   → android/app/build/outputs/apk/debug/app-debug.apk');

function safeGit(cmd) {
  try {
    return execSync(`git ${cmd}`, { cwd: repoRoot }).toString().trim();
  } catch {
    return 'unknown';
  }
}
