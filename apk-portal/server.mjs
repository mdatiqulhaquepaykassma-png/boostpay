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
const SVG = (inner) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`;
const ICONS = {
  wallet: SVG('<rect x="2.5" y="6" width="19" height="13" rx="3.2"/><path d="M2.5 10.5h19"/><circle cx="17.2" cy="15" r="1.4" fill="currentColor" stroke="none"/>'),
  people: SVG('<circle cx="9" cy="8" r="3.3"/><path d="M3 20.2a6 6 0 0 1 12 0"/><circle cx="17.6" cy="9.4" r="2.4"/><path d="M15.4 20.2a5 5 0 0 1 6.1-4.6"/>'),
  chart: SVG('<path d="M3.5 20.5h17"/><rect x="5" y="12" width="3.4" height="6"/><rect x="10.5" y="8" width="3.4" height="10"/><rect x="16" y="4.5" width="3.4" height="13.5"/>'),
  shield: SVG('<path d="M12 3.2l7 2.8v5.6c0 4.5-2.9 7.6-7 8.9-4.1-1.3-7-4.4-7-8.9V6z"/><path d="M9.2 11.9l1.9 1.9 3.8-3.9"/>'),
  dial: SVG('<rect x="7" y="2.8" width="10" height="18.4" rx="2.6"/><circle cx="10.4" cy="7.6" r=".55" fill="currentColor" stroke="none"/><circle cx="13.6" cy="7.6" r=".55" fill="currentColor" stroke="none"/><circle cx="10.4" cy="11" r=".55" fill="currentColor" stroke="none"/><circle cx="13.6" cy="11" r=".55" fill="currentColor" stroke="none"/><path d="M10.6 17.6h2.8"/>'),
  mail: SVG('<rect x="3" y="5" width="18" height="14" rx="2.8"/><path d="M3.6 7.2l8.4 5.9 8.4-5.9"/>'),
};

const APPS = [
  {
    slug: 'userapk', icon: 'wallet', file: 'boostpay-user.apk', title: 'BoostPay', short: 'User app',
    color: '#f59e0b', pkg: 'com.boostpay.app',
    tagline: 'The main wallet — deposit, withdraw, send, boost, referral team.',
    audience: 'Every customer',
    note: 'Deposit / Withdraw / Send / Boost / Referral — সবকিছু এই অ্যাপে।',
  },
  {
    slug: 'agentapk', icon: 'people', file: 'boostpay-agent.apk', title: 'BoostPay Agent', short: 'Agent app',
    color: '#22d3ee', pkg: 'com.boostpay.agent',
    tagline: 'For the agents who accept cash and hand over cash for users.',
    audience: 'Field agents',
    note: 'ক্যাশ নেওয়া/দেওয়া, ইউজারের সাথে চ্যাট — এজেন্টদের নিজের অ্যাপ।',
  },
  {
    slug: 'managementapk', icon: 'chart', file: 'boostpay-management.apk', title: 'BoostPay Management', short: 'Management app',
    color: '#a78bfa', pkg: 'com.boostpay.management',
    tagline: 'Runs an agent network: float, funding, chats, wallet-agent accounts.',
    audience: 'Network managers',
    note: 'নিজের নেটওয়ার্কের এজেন্ট, ফান্ড ও ওয়ালেট-এজেন্ট অ্যাকাউন্ট — ম্যানেজমেন্ট অ্যাপ।',
  },
  {
    slug: 'adminapk', icon: 'shield', file: 'boostpay-admin.apk', title: 'BoostPay Admin', short: 'Admin console',
    color: '#f87171', pkg: 'com.boostpay.admin',
    tagline: 'Full platform control: users, money flow, payments, SMS bridge.',
    audience: 'Owner / staff only',
    note: 'শুধু আপনি/আপনার স্টাফ — সম্পূর্ণ কন্ট্রোল প্যানেল। অন্য কাউকে দেবেন না।',
    private: true,
  },
  {
    slug: 'relayapk', icon: 'mail', file: 'boostpay-sms-relay.apk', title: 'BoostPay SMS Relay', short: 'SMS relay',
    color: '#34d399', pkg: 'com.boostpay.smsrelay',
    tagline: 'Runs on the bKash/Nagad phone and auto-credits deposits from SMS.',
    audience: 'Your own receiving phones',
    note: 'যে ফোনে bKash/Nagad-এর টাকা আসে, সেই ফোনে — SMS পড়ে অটো ব্যালেন্স যোগ করে।',
    private: true,
    steps: [
      'APK ইনস্টল করুন — <b>যে ফোনে bKash/Nagad-এর টাকা আসে</b> সেই ফোনে',
      'Admin console → <b>SMS Bridge</b> → Add a phone → <b>Create &amp; show token</b> → <code>BPX-…</code> কপি করুন',
      'অ্যাপে token পেস্ট করুন → <b>Save &amp; start forwarding</b> → SMS permission <b>Allow</b>',
      'ফোনের Settings-এ <b>Battery → Unrestricted</b> আর <b>Autostart</b> চালু করুন',
      'Admin-এ ডিভাইসের নিচে <span class="code">last seen just now</span> দেখলেই চালু',
    ],
  },
  {
    btn: 'Payout (bKash)', slug: 'ussdpayout', icon: 'dial', file: 'boostpay-ussd-payout.apk', title: 'BoostPay Payout (bKash)', short: 'Payout robot · bKash',
    color: '#fb923c', pkg: 'com.boostpay.ussdpayout',
    tagline: 'Walks the *247# menu on your own phone — dual SIM: each SIM gets its own wallet (bKash/Nagad) and Personal/Agent.',
    audience: 'Owner only',
    note: 'bKash বিল্ড: *247# মেনু হাঁটে, DRY RUN-এ PIN-এর আগেই থেমে যায়। আগে ড্রাই রান, পরে ছোট অ্যামাউন্ট।',
    private: true,
    steps: [
      '<b>SIM 1 / SIM 2</b> — প্রতিটা SIM-এ দিন: bKash/Nagad, Personal/Agent, নিজের নম্বর, সেই SIM-এর PIN',
      'ইনস্টল করুন — <b>আলাদা, কম-ব্যালেন্স bKash নম্বরে</b> (মূল ফ্লোটে নয়)',
      'Service code <span class="code">*247#</span>, receiver = আপনার নিজের দ্বিতীয় নম্বর, amount 10-20',
      '<b>Adaptive ON</b> রাখুন (স্ক্রিন পড়ে নিজেই ঠিক মান বসায়) — বা steps <span class="code">1,{number},{amount},1,{pin}</span>',
      'লিমিট ছোট রাখুন (max 100 / day 200) → <b>① DRY RUN</b> — PIN-এর আগেই থামবে, এক টাকাও যাবে না',
      'লগে মেনু ঠিক দেখালে <b>② SEND REAL MONEY</b> → confirmation-এ <span class="code">amount + শেষ ৪ ডিজিট</span> টাইপ করুন',
    ],
  },
  {
    btn: 'Payout (Nagad)', slug: 'nagadpayout', icon: 'dial', file: 'boostpay-ussd-nagad.apk', title: 'BoostPay Payout (Nagad)', short: 'Payout robot · Nagad',
    color: '#f43f5e', pkg: 'com.boostpay.ussdpayout.nagad',
    tagline: 'Walks the *167# menu on your own phone — dual SIM: each SIM gets its own wallet (bKash/Nagad) and Personal/Agent.',
    audience: 'Owner only',
    note: 'Nagad বিল্ড: *167# মেনু, ৪ ডিজিট PIN। DRY RUN-এ PIN-এর আগেই থেমে যায়।',
    private: true,
    steps: [
      '<b>SIM 1 / SIM 2</b> — প্রতিটার জন্য বেছে নিন: bKash না Nagad, Personal না Agent, নিজের নম্বর, আর সেই SIM-এর PIN (আলাদা PIN রাখা হয়)',
      'ইনস্টল করুন — <b>আলাদা Nagad নম্বরে</b> (মূল ফ্লোটে নয়), ব্যালেন্স ২০০-৩০০ টাকা',
      'Service code <span class="code">*167#</span>, receiver = নিজের দ্বিতীয় নম্বর, amount 10-20, PIN = <b>৪ ডিজিট</b>',
      '<b>Adaptive ON</b> রাখুন — "amount"/"PIN"/"number" যে স্ক্রিন যা চাইবে, সেই মানটাই বসাবে (+ বাংলা শব্দও বোঝে)',
      '<b>① DRY RUN</b> → লগে মেনু ঠিক দেখালে <b>② SEND REAL MONEY</b> → <span class="code">amount + শেষ ৪ ডিজিট</span> টাইপ',
      'কিছু ভুল হলে <b>⛔ STOP</b> — যে কোনো সময় রান বাতিল হয়, আর কোনো কী যায় না',
    ],
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
      version: (file.includes('ussd') ? '2.1.6' : '1.0'),
    };
  } catch {
    return { ready: false, size: 0, mtime: 0, sha256: '', version: '' };
  }
}

const mb = (bytes) =>
  !bytes ? '—' : bytes < 1024 * 1024 ? Math.round(bytes / 1024) + ' KB' : (bytes / (1024 * 1024)).toFixed(1) + ' MB';
const dateOf = (ms) => (ms ? new Date(ms).toISOString().slice(0, 10) : '—');

function envelope(apps) {
  return apps.map(view);
}

const DOWNLOAD_ICON = `<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4v10"/><path d="M7.5 10l4.5 4.5 4.5-4.5"/><path d="M4.5 19.5h15"/></svg>`;

const CSS = `
*{box-sizing:border-box}
body{margin:0;background:#09090b;color:#fafafa;font-family:ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,"Noto Sans Bengali",sans-serif}
a{color:inherit;text-decoration:none}
.wrap{max-width:960px;margin:0 auto;padding:28px 18px 60px}
.brand{display:flex;align-items:center;gap:10px}
.logo{display:flex;height:38px;width:38px;align-items:center;justify-content:center;border-radius:14px;background:linear-gradient(135deg,#f59e0b,#f97316);color:#09090b}
.logo svg{width:21px;height:21px}
.ic svg{width:22px;height:22px}
.btn svg{flex:0 0 auto}
h1{font-size:22px;margin:0;letter-spacing:-.02em}
.sub{color:#71717a;font-size:12.5px;margin:6px 0 22px;line-height:1.6}
.grid{display:grid;gap:14px;grid-template-columns:repeat(auto-fill,minmax(280px,1fr))}
.card{display:flex;flex-direction:column;gap:12px;border:1px solid #27272a;background:#111113;border-radius:20px;padding:18px}
.card .top{display:flex;gap:12px;align-items:flex-start}
.ic{display:flex;height:44px;width:44px;flex-shrink:0;align-items:center;justify-content:center;border-radius:16px;font-size:20px}
.card h2{font-size:15px;margin:0}
.meta{color:#71717a;font-size:11px;margin-top:3px;line-height:1.5}
.row{display:flex;flex-wrap:wrap;gap:5px 7px;align-items:center;margin-top:7px}
.nowrap{white-space:nowrap}
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
<div class="brand"><div class="logo"><svg viewBox="0 0 24 24" fill="none" stroke="#09090b" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M7 4.5h6.2a3.4 3.4 0 0 1 0 6.8H7zM7 11.3h7a3.5 3.5 0 0 1 0 7H7z"/><path d="M7 4.5v13.8"/></svg></div><h1>${title}</h1></div>
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
      <div class="ic" style="background:${a.color}22;color:${a.color}">${ICONS[a.icon]}</div>
      <div style="min-width:0">
        <h2><a href="/${a.slug}">${a.title}</a></h2>
        <div class="meta">${a.tagline}</div>
        <div class="meta row">
          <span class="tag ${a.ready ? 'ready' : 'waiting'}">${a.ready ? 'READY' : 'BUILDING'}</span>
          ${a.private ? '<span class="tag priv">PRIVATE</span>' : ''}
          <span class="nowrap">${mb(a.size)}</span>
          <span class="nowrap">v${a.version}</span>
          <span class="nowrap">${dateOf(a.mtime)}</span>
        </div>
      </div>
    </div>
    <div class="btnrow">
      <a class="btn" href="/${a.slug}/download" ${a.ready ? '' : 'aria-disabled="true"'}>${DOWNLOAD_ICON} Download</a>
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
    <div class="ic" style="background:${a.color}22;color:${a.color}">${ICONS[a.icon]}</div>
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
    ? `<a class="btn big" href="/${a.slug}/download">${DOWNLOAD_ICON} Download ${a.btn || a.title} APK</a>`
    : `<div class="warn">This build is not on the server yet — it uploads itself on the next CI run.</div>`}
</div>
<div class="card" style="margin-top:14px">
  <h2 style="font-size:13px">ইনস্টল কীভাবে</h2>
  <ol class="steps">
    ${(a.steps || [
      `<b>Download</b> চাপুন — ফাইলের নাম হবে <span class="code">${a.file}</span>`,
      'ফোনে খুলুন → "Install anyway" / "Allow from this source" দিন',
      'অ্যাপ খুলুন → লগইন করুন (অ্যাকাউন্ট না থাকলে সাইন-আপ)',
      'App info → Battery → <b>Unrestricted</b> (নোটিফিকেশন ঠিক সময়ে আসার জন্য)',
    ]).map((step) => `<li>${step}</li>`).join('')}
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
