/**
 * apk-portal — one small, dependency-free server that hands out the BoostPay
 * Android builds. It is its own Dokploy application (app.boostpay.online) so a
 * broken main site never takes the download links down with it.
 *
 *   GET /                     → the gallery page (every app, one card each)
 *   GET /userapk              → that app's own page (install steps + button)
 *   GET /userapk/download     → the APK file
 *   GET /apks/<file>.apk      → the APK file (direct link, used by the buttons)
 *   GET /api/apks             → JSON list (name, slug, size, sha256, version…)
 *   GET /api/health           → {"status":"ok"} for uptime checks
 *
 * Files live in ./apks. Nothing is uploaded at runtime — the builds are committed
 * by CI (or by hand) and served from disk.
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APK_DIR = path.join(__dirname, 'apks');
const PORT = Number(process.env.PORT || 3000);

/** The catalogue. `slug` is the public link: app.boostpay.online/<slug> */
const APPS = [
  {
    slug: 'userapk', file: 'boostpay-user.apk', title: 'BoostPay', short: 'User app',
    icon: '₿', color: '#f59e0b', pkg: 'com.boostpay.app',
    tagline: 'The main wallet — deposit, withdraw, send, boost, referral team.',
    audience: 'Every customer',
    note: 'Deposit / Withdraw / Send / Boost / Referral — সবকিছু এই অ্যাপে।',
  },
  {
    slug: 'agentapk', file: 'boostpay-agent.apk', title: 'BoostPay Agent', short: 'Agent app',
    icon: '🤝', color: '#22d3ee', pkg: 'com.boostpay.agent',
    tagline: 'For the agents who accept cash and hand over cash for users.',
    audience: 'Field agents',
    note: 'ক্যাশ নেওয়া/দেওয়া, ইউজারের সাথে চ্যাট — এজেন্টদের নিজের অ্যাপ।',
  },
  {
    slug: 'managementapk', file: 'boostpay-management.apk', title: 'BoostPay Management', short: 'Management app',
    icon: '📊', color: '#a78bfa', pkg: 'com.boostpay.management',
    tagline: 'Runs an agent network: float, funding, chats, wallet-agent accounts.',
    audience: 'Network managers',
    note: 'নিজের নেটওয়ার্কের এজেন্ট, ফান্ড ও ওয়ালেট-এজেন্ট অ্যাকাউন্ট — ম্যানেজমেন্ট অ্যাপ।',
  },
  {
    slug: 'adminapk', file: 'boostpay-admin.apk', title: 'BoostPay Admin', short: 'Admin console',
    icon: '🛡️', color: '#f87171', pkg: 'com.boostpay.admin',
    tagline: 'Full platform control: users, money flow, payments, SMS bridge.',
    audience: 'Owner / staff only',
    note: 'শুধু আপনি/আপনার স্টাফ — সম্পূর্ণ কন্ট্রোল প্যানেল। অন্য কাউকে দেবেন না।',
    private: true,
  },
  {
    slug: 'relayapk', file: 'boostpay-sms-relay.apk', title: 'BoostPay SMS Relay', short: 'SMS relay',
    icon: '📩', color: '#34d399', pkg: 'com.boostpay.smsrelay',
    tagline: 'Runs on the bKash/Nagad phone and auto-credits deposits from SMS.',
    audience: 'Your own receiving phones',
    note: 'যে ফোনে bKash/Nagad-এর টাকা আসে, সেই ফোনে — SMS পড়ে অটো ব্যালেন্স যোগ করে।',
    private: true,
  },
];

const bySlug = new Map(APPS.map((a) => [a.slug, a]));
/** One APPS entry with its on-disk stats merged in (size/sha/ready/download). */
const view = (app) => ({ ...app, ...statApk(app.file), download: '/' + app.slug + '/download' });

function statApk(file) {
  try {
    const full = path.join(APK_DIR, file);
    const st = fs.statSync(full);
    const buf = fs.readFileSync(full);
    return {
      ready: true,
      size: st.size,
      mtime: st.mtimeMs,
      sha256: crypto.createHash('sha256').update(buf).digest('hex').slice(0, 16),
      version: '1.0',
    };
  } catch {
    return { ready: false, size: 0, mtime: 0, sha256: '', version: '' };
  }
}

const mb = (bytes) => (bytes ? (bytes / (1024 * 1024)).toFixed(1) + ' MB' : '—');
const dateOf = (ms) => (ms ? new Date(ms).toISOString().slice(0, 10) : '—');

function envelope(apps) {
  return apps.map(view);
}

const CSS = `
*{box-sizing:border-box}
body{margin:0;background:#09090b;color:#fafafa;font-family:ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,"Noto Sans Bengali",sans-serif}
a{color:inherit;text-decoration:none}
.wrap{max-width:960px;margin:0 auto;padding:28px 18px 60px}
.brand{display:flex;align-items:center;gap:10px}
.logo{display:flex;height:38px;width:38px;align-items:center;justify-content:center;border-radius:14px;background:linear-gradient(135deg,#f59e0b,#f97316);color:#09090b;font-weight:900;font-size:18px}
h1{font-size:22px;margin:0;letter-spacing:-.02em}
.sub{color:#71717a;font-size:12.5px;margin:6px 0 22px;line-height:1.6}
.grid{display:grid;gap:14px;grid-template-columns:repeat(auto-fill,minmax(280px,1fr))}
.card{display:flex;flex-direction:column;gap:12px;border:1px solid #27272a;background:#111113;border-radius:20px;padding:18px}
.card .top{display:flex;gap:12px;align-items:flex-start}
.ic{display:flex;height:44px;width:44px;flex-shrink:0;align-items:center;justify-content:center;border-radius:16px;font-size:20px}
.card h2{font-size:15px;margin:0}
.meta{color:#71717a;font-size:11px;margin-top:3px;line-height:1.5}
.tag{display:inline-block;border-radius:999px;padding:2px 8px;font-size:10px;font-weight:800;letter-spacing:.02em}
.ready{background:rgba(52,211,153,.15);color:#6ee7b7}
.waiting{background:rgba(245,158,11,.15);color:#fcd34d}
.priv{background:rgba(248,113,113,.15);color:#fca5a5}
.btnrow{display:flex;gap:8px;margin-top:auto}
.btn{flex:1;display:flex;align-items:center;justify-content:center;gap:6px;border-radius:14px;padding:11px 14px;font-size:12.5px;font-weight:800;background:#f59e0b;color:#09090b;border:0;cursor:pointer}
.btn.ghost{background:#18181b;color:#e4e4e7;border:1px solid #27272a;flex:0 0 auto;padding:11px 14px}
.btn.big{padding:15px;font-size:14px}
.steps{color:#a1a1aa;font-size:12px;line-height:1.7;margin:0;padding-left:18px}
.steps li{margin-bottom:4px}
.foot{color:#52525b;font-size:10.5px;margin-top:26px;line-height:1.7}
.warn{border:1px solid rgba(245,158,11,.35);background:rgba(245,158,11,.08);color:#fcd34d;border-radius:14px;padding:10px 12px;font-size:11.5px;line-height:1.6;margin-top:16px}
.code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:10.5px;color:#a1a1aa;word-break:break-all}
`;

function page(title, body) {
  return `<!doctype html><html lang="bn"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="theme-color" content="#09090b"><title>${title}</title>
<meta name="robots" content="noindex,nofollow">
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Crect width='64' height='64' rx='16' fill='%23f59e0b'/%3E%3Ctext x='32' y='44' font-size='36' font-family='sans-serif' font-weight='bold' text-anchor='middle' fill='%2309090b'%3EB%3C/text%3E%3C/svg%3E">
<style>${CSS}</style></head><body><div class="wrap">
<div class="brand"><div class="logo">₿</div><h1>${title}</h1></div>
${body}
<div class="foot">BoostPay · app.boostpay.online · these builds are signed and safe to install. Nothing here asks for your PIN or password.</div>
</div></body></html>`;
}

const indexHtml = () => page('BoostPay apps — download', `
<p class="sub">বাংলাদেশের জন্য BoostPay-এর সব অ্যাপ। নিচের যেকোনো কার্ডে <b>Download</b> চাপলেই APK নামবে, অথবা কার্ডের নামে চাপলে অ্যাপের নিজের পেজ (ইনস্টল ধাপসহ) খুলবে।</p>
<div class="grid">
${envelope(APPS).map((a) => `
  <div class="card">
    <div class="top">
      <div class="ic" style="background:${a.color}22;color:${a.color}">${a.icon}</div>
      <div style="min-width:0">
        <h2><a href="/${a.slug}">${a.title}</a></h2>
        <div class="meta">${a.tagline}</div>
        <div class="meta" style="margin-top:6px">
          <span class="tag ${a.ready ? 'ready' : 'waiting'}">${a.ready ? 'READY' : 'BUILDING'}</span>
          ${a.private ? '<span class="tag priv">PRIVATE</span>' : ''}
          <span style="margin-left:6px">${mb(a.size)} · v${a.version} · ${dateOf(a.mtime)}</span>
        </div>
      </div>
    </div>
    <div class="btnrow">
      <a class="btn" href="/${a.slug}/download" ${a.ready ? '' : 'aria-disabled="true"'}>⬇ Download</a>
      <a class="btn ghost" href="/${a.slug}">Details</a>
    </div>
  </div>`).join('')}
</div>
<div class="warn">⚠️ ইনস্টল করার সময় ফোন "Unknown app" / "Install anyway" জিজ্ঞেস করবে — অনুমতি দিন। এগুলো Play Store-এ নেই, আমাদের নিজের সাইট থেকেই আসল ফাইল।</div>
`);

const appHtml = (a) => page(`${a.title} — download`, `
<p class="sub">${a.tagline}<br><span style="color:#52525b">${a.note || ''}</span></p>
<div class="card">
  <div class="top">
    <div class="ic" style="background:${a.color}22;color:${a.color}">${a.icon}</div>
    <div>
      <h2>${a.title} <span style="color:#71717a;font-weight:500">· ${a.short}</span></h2>
      <div class="meta">
        <span class="tag ${a.ready ? 'ready' : 'waiting'}">${a.ready ? 'READY' : 'BUILDING'}</span>
        <div style="margin-top:6px">version ${a.version} · ${mb(a.size)} · built ${dateOf(a.mtime)}<br>
        package <span class="code">${a.pkg}</span><br>sha256 <span class="code">${a.sha256}…</span></div>
      </div>
    </div>
  </div>
  ${a.ready
    ? `<a class="btn big" href="/${a.slug}/download">⬇ Download ${a.title} APK</a>`
    : `<div class="warn">This build is not on the server yet — it uploads itself on the next CI run.</div>`}
</div>
<div class="card" style="margin-top:14px">
  <h2 style="font-size:13px">ইনস্টল কীভাবে</h2>
  <ol class="steps">
    <li><b>Download</b> চাপুন — ফাইলের নাম হবে <span class="code">${a.file}</span></li>
    <li>ফোনে খুলুন → "Install anyway" / "Allow from this source" দিন</li>
    <li>অ্যাপ খুলুন → লগইন করুন (অ্যাকাউন্ট না থাকলে সাইন-আপ)</li>
    <li>App info → Battery → <b>Unrestricted</b> (নোটিফিকেশন ঠিক সময়ে আসার জন্য)</li>
  </ol>
</div>
<p class="sub" style="margin-top:16px"><a href="/" style="color:#f59e0b;font-weight:700">← সব অ্যাপ</a></p>
`);

function sendApk(req, res, app) {
  const full = path.join(APK_DIR, app.file);
  let st;
  try { st = fs.statSync(full); } catch {
    return html(res, 404, page('Not ready', `<p class="sub">${app.title} এখনো আপলোড হয়নি।</p><p><a class="btn" href="/">সব অ্যাপ</a></p>`));
  }
  res.writeHead(200, {
    'Content-Type': 'application/vnd.android.package-archive',
    'Content-Length': String(st.size),
    'Content-Disposition': `attachment; filename="${app.file}"`,
    'Cache-Control': 'no-cache',
    'X-Content-Type-Options': 'nosniff',
  });
  if (req.method === 'HEAD') return res.end();
  fs.createReadStream(full).pipe(res);
}

function html(res, code, body) {
  res.writeHead(code, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'public, max-age=60' });
  res.end(body);
}
function json(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(obj));
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url || '/', 'http://localhost');
  const p = decodeURIComponent(url.pathname).replace(/\/+$/, '') || '/';
  const method = req.method || 'GET';
  if (method !== 'GET' && method !== 'HEAD') return json(res, 405, { error: 'GET only' });

  if (p === '/api/health' || p === '/health') return json(res, 200, { status: 'ok', service: 'apk-portal', version: '1.0.0', apps: APPS.length });
  if (p === '/api/apks') return json(res, 200, { success: true, apps: envelope(APPS) });

  if (p === '/' || p === '/index.html') return html(res, 200, indexHtml());

  const pathNoSlash = p.replace(/^\//, '');

  if (pathNoSlash.endsWith('/download')) {
    const a2 = bySlug.get(pathNoSlash.slice(0, -'/download'.length));
    if (a2) return sendApk(req, res, a2);
  }
  const app = bySlug.get(pathNoSlash);
  if (app) return html(res, 200, appHtml(view(app)));
  const direct = /^\/apks\/([a-z0-9.-]+\.apk)$/i.exec(p);
  if (direct) {
    const a3 = APPS.find((a) => a.file === direct[1]);
    if (a3) return sendApk(req, res, a3);
  }
  return html(res, 404, page('Not found', `<p class="sub">এই লিংকটা নেই।</p><p><a class="btn" href="/">সব অ্যাপ দেখুন</a></p>`));
});

server.listen(PORT, '0.0.0.0', () => {
  const ready = APPS.filter((a) => statApk(a.file).ready).length;
  console.log(`[apk-portal] listening on :${PORT} · ${ready}/${APPS.length} APKs on disk`);
  for (const a of APPS) console.log(`  /${a.slug}  →  ${a.file} (${statApk(a.file).ready ? mb(statApk(a.file).size) : 'missing'})`);
});
