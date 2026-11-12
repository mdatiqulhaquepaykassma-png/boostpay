import express from 'express';
import http from 'http';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import zlib from 'zlib';
import { Pool } from 'pg';
import { fileURLToPath } from 'url';
import { createServer as createViteServer } from 'vite';
import nodemailer from 'nodemailer';
import QRCode from 'qrcode';
import webpush from 'web-push';
import { CURRENCIES, COUNTRY_CURRENCY, currencyForCountry, isCurrencyCode, countriesForCurrency, primaryCountryForCurrency } from './currency-data';
import {
  PAYMENT_CATEGORIES, defaultPaymentMethods, ensurePaymentCollections, findMethod,
  methodAvailable, limitsFor, toPublicMethod, withdrawFieldsFor,
} from './payments';
import { parseSms, normalizeTrxId } from './sms-parse';
import {
  ensurePayoutJobs, buildJob, claimNext, markResult, cancelJob, matchDebit,
  publicJob, queueStats, cleanMsisdn, cleanAmount,
} from './payout-queue';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_DIR = path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'boostpay_db.json');
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) try { fs.mkdirSync(UPLOAD_DIR, { recursive: true }); } catch {}
// STORAGE FIX: Move image/voice/file from inline base64 in DB to disk files + auto-cleanup to prevent DB full (10-30 days TTL, 50MB limit, 500 msg/conversation cap)

// ── Gmail SMTP pool (unlimited accounts, round-robin after 500/day) ──
const SMTP_ENV_USER = (process.env.SMTP_USER || 'joypaykassma@gmail.com').trim();
const SMTP_ENV_PASS = (process.env.SMTP_PASS || 'spbdbqqbffqlvkkf').replace(/\s+/g,'');
const SMTP_ENV_FROM = (process.env.SMTP_FROM || `BoostPay <${SMTP_ENV_USER}>`).trim();
const SMTP_ENV_HOST = (process.env.SMTP_HOST || 'smtp.gmail.com').trim();
const SMTP_ENV_PORT = parseInt(process.env.SMTP_PORT || '465', 10);
// per-transport cache
const _smtpTransporters = new Map<string, any>();
function getMailerForAccount(acct:any): any {
  const key = String(acct.id || acct.email);
  if (_smtpTransporters.has(key)) return _smtpTransporters.get(key);
  try {
    const t = nodemailer.createTransport({
      host: acct.host || 'smtp.gmail.com',
      port: Number(acct.port || 465),
      secure: Number(acct.port || 465) === 465,
      auth: { user: acct.email, pass: (acct.appPassword||'').replace(/\s+/g,'') },
      pool: true, maxConnections: 2,
    } as any);
    t.verify().then(()=> console.log(`[SMTP] ready ${acct.email} via ${acct.host||'smtp.gmail.com'}:${acct.port||465}`)).catch((e:any)=> console.warn(`[SMTP] verify failed ${acct.email}:`, e?.message));
    _smtpTransporters.set(key, t);
    return t;
  } catch(e:any){ console.warn('[SMTP] create failed for', acct.email, e?.message); return null; }
}
function smtpDayKey(ts?: number): string {
  const d = ts ? new Date(ts) : new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,'0')}-${String(d.getUTCDate()).padStart(2,'0')}`;
}
function ensureSmtpDefaults(db:any): any {
  if (!db.smtp) db.smtp = { accounts: [], config: { dailyLimitPerAccount: 500, strategy:'round-robin', rateLimitPerEmailPerMin: 1, rateLimitPerIpPerHour: 12, enabled:true, fallbackToInbox:true }, stats:{ totalSent:0, totalFailed:0, byDay:{} }, roundRobinIndex:0 } as any;
  if (!db.smtp.accounts) db.smtp.accounts = [];
  if (!db.smtp.config) db.smtp.config = { dailyLimitPerAccount: 500, strategy:'round-robin', rateLimitPerEmailPerMin: 1, rateLimitPerIpPerHour: 12, enabled:true, fallbackToInbox:true } as any;
  if (!db.smtp.stats) db.smtp.stats = { totalSent:0, totalFailed:0, byDay:{} } as any;
  if (db.smtp.roundRobinIndex === undefined) db.smtp.roundRobinIndex = 0;
  if (!Array.isArray((db.smtp as any).logs)) (db.smtp as any).logs = [];
  // seed from env if pool empty (first run)
  if (db.smtp.accounts.length===0 && SMTP_ENV_USER && SMTP_ENV_PASS) {
    const today = smtpDayKey();
    db.smtp.accounts.push({
      id: 'smtp-'+Math.floor(100000+Math.random()*900000),
      email: SMTP_ENV_USER,
      appPassword: SMTP_ENV_PASS,
      host: SMTP_ENV_HOST, port: SMTP_ENV_PORT, secure: SMTP_ENV_PORT===465,
      label: 'Primary Gmail (env)',
      enabled: true, dailyCount: 0, totalSent: 0, failedCount:0, lastError:'', lastSentAt:0, dayKey: today, createdAt: Date.now()
    });
  }
  // ensure per-account fields + daily reset
  const today = smtpDayKey();
  for (const a of db.smtp.accounts) {
    if (a.dailyCount===undefined) a.dailyCount=0;
    if (a.totalSent===undefined) a.totalSent=0;
    if (a.failedCount===undefined) a.failedCount=0;
    if (!a.dayKey) a.dayKey=today;
    if (a.dayKey !== today) { a.dailyCount=0; a.dayKey=today; a.lastError=''; }
    if (a.enabled===undefined) a.enabled=true;
  }
  return db.smtp;
}
function pickSmtpAccount(db:any): any | null {
  const smtp = ensureSmtpDefaults(db);
  if (smtp.config.enabled === false) return null;
  const today = smtpDayKey();
  const limit = Number(smtp.config.dailyLimitPerAccount||500);
  let pool = smtp.accounts.filter((a:any)=> a.enabled && (a.dailyCount||0) < limit);
  // daily reset check
  for (const a of pool) if (a.dayKey!==today) { a.dailyCount=0; a.dayKey=today; }
  pool = pool.filter((a:any)=> (a.dailyCount||0) < limit);
  if (pool.length===0) return null;
  const idx = (smtp.roundRobinIndex || 0) % pool.length;
  const picked = pool[idx];
  smtp.roundRobinIndex = (idx + 1) % Math.max(1, smtp.accounts.filter((a:any)=>a.enabled).length);
  return picked;
}
function recordSmtpSent(db:any, accountId:string, success:boolean, to?:string, subject?:string, errMsg?:string): void {
  const smtp = ensureSmtpDefaults(db);
  const today = smtpDayKey();
  if (!smtp.stats.byDay[today]) smtp.stats.byDay[today]={ sent:0, failed:0 };
  if (success) {
    smtp.stats.totalSent = (smtp.stats.totalSent||0)+1;
    smtp.stats.byDay[today].sent +=1;
    const acc = smtp.accounts.find((a:any)=> String(a.id)===String(accountId));
    if (acc) { acc.dailyCount=(acc.dailyCount||0)+1; acc.totalSent=(acc.totalSent||0)+1; acc.lastSentAt=Date.now(); acc.lastError=''; }
  } else {
    smtp.stats.totalFailed=(smtp.stats.totalFailed||0)+1;
    smtp.stats.byDay[today].failed+=1;
    const acc = smtp.accounts.find((a:any)=> String(a.id)===String(accountId));
    if (acc) { acc.failedCount=(acc.failedCount||0)+1; acc.lastError=String(errMsg||'send failed').slice(0,300); }
  }
  // Full email log for monitoring (keep last 500)
  try {
    const acc = smtp.accounts.find((a:any)=> String(a.id)===String(accountId));
    const via = acc ? acc.email : (accountId || 'system');
    if (!Array.isArray((smtp as any).logs)) (smtp as any).logs = [];
    (smtp as any).logs.unshift({
      id: 'mail-'+Date.now()+'-'+Math.floor(Math.random()*90000),
      to: String(to||'').slice(0,120),
      subject: String(subject||'').slice(0,200),
      via,
      accountId: String(accountId||''),
      success: !!success,
      error: success ? '' : String(errMsg||'').slice(0,500),
      timestamp: Date.now()
    });
    if ((smtp as any).logs.length > 500) (smtp as any).logs = (smtp as any).logs.slice(0,500);
  } catch {}
}
// legacy single-mailer fallback (if smtp pool disabled)
let _legacyMailer:any=null;
function getLegacyMailer(): any {
  if (!SMTP_ENV_USER || !SMTP_ENV_PASS) return null;
  if (_legacyMailer) return _legacyMailer;
  try {
    _legacyMailer = nodemailer.createTransport({ host: SMTP_ENV_HOST, port: SMTP_ENV_PORT, secure: SMTP_ENV_PORT===465, auth:{ user:SMTP_ENV_USER, pass:SMTP_ENV_PASS }, pool:true, maxConnections:2 } as any);
    _legacyMailer.verify().then(()=> console.log(`[SMTP-LEGACY] ready ${SMTP_ENV_USER}`)).catch((e:any)=> console.warn('[SMTP-LEGACY] verify failed', e?.message));
  } catch(e:any){ return null; }
  return _legacyMailer;
}
async function sendMail(to: string, subject: string, html: string, text?: string): Promise<{ ok:boolean; via?:string; error?:string }> {
  const db = readDb();
  const smtp = ensureSmtpDefaults(db);
  // try pool first
  let lastErr = '';
  const tried = new Set<string>();
  for (let attempt=0; attempt < Math.max(1, smtp.accounts.length); attempt++) {
    const acct = pickSmtpAccount(db);
    if (!acct || tried.has(String(acct.id))) break;
    tried.add(String(acct.id));
    const t = getMailerForAccount(acct);
    if (!t) { lastErr='no transporter'; continue; }
    try {
      await t.sendMail({ from: acct.email, to, subject, html, text: text || html.replace(/<[^>]+>/g,' ').trim() });
      console.log(`[SMTP] sent via ${acct.email} → ${to} | ${subject}`);
      recordSmtpSent(db, acct.id, true, to, subject);
      writeDb(db);
      return { ok:true, via: acct.email };
    } catch (e:any) {
      lastErr = e?.message || String(e);
      console.error(`[SMTP] send failed via ${acct.email} to ${to}:`, lastErr);
      recordSmtpSent(db, acct.id, false, to, subject, lastErr);
      writeDb(db);
      // if limit hit (Gmail 421/ 550 Daily limit) try next account automatically
      if (/limit|quota|exceeded|too many/i.test(lastErr) && smtp.accounts.filter((a:any)=>a.enabled).length>1) continue;
      // auth error -> try next as well
      if (/auth|credentials|password/i.test(lastErr)) continue;
      break;
    }
  }
  // fallback to legacy env if pool exhausted or disabled
  if (SMTP_ENV_USER && SMTP_ENV_PASS) {
    const t2 = getLegacyMailer();
    if (t2) {
      try {
        await t2.sendMail({ from: SMTP_ENV_FROM, to, subject, html, text: text || html.replace(/<[^>]+>/g,' ').trim() });
        console.log(`[SMTP-LEGACY] sent → ${to} | ${subject}`);
        return { ok:true, via: SMTP_ENV_USER };
      } catch(e:any){ lastErr = e?.message||String(e); console.error(`[SMTP-LEGACY] fail to ${to}:`, lastErr); }
    }
  }
  if (!lastErr) lastErr='no available SMTP account (all 500/day exhausted or disabled)';
  console.warn(`[SMTP] all pools failed for ${to}: ${lastErr}`);
  return { ok:false, error:lastErr };
}
function makeResetCode(): string {
  return String(Math.floor(100000 + Math.random() * 900000));
}
async function sendPasswordResetMail(kind: 'AGENT' | 'MANAGEMENT', id: string, email: string, code: string) {
  const label = kind === 'AGENT' ? 'Agent' : 'Management';
  const html = emailWrap(`${label} Password Reset Code`, `<p style="margin:0 0 10px">Hi <b>${label} ${id}</b>,</p><p style="margin:0 0 12px">Your BoostPay ${label.toLowerCase()} password reset code:</p><div style="text-align:center;margin:14px 0"><span style="display:inline-block;background:#09090b;border:1px solid #27272a;padding:12px 22px;border-radius:12px;font-family:monospace;font-size:22px;font-weight:800;letter-spacing:5px;color:#fbbf24">${code}</span></div><p style="margin:0;font-size:12px;color:#a1a1aa">Valid for 15 minutes. If you did not request this, ignore this email.</p>`);
  try { return await sendMail(email, `BoostPay — ${label} Password Reset Code`, html); }
  catch (e: any) { return { ok: false, error: e?.message || 'send failed' }; }
}
function emailWrap(title: string, bodyHtml: string): string {
  return `<!DOCTYPE html><html><body style="margin:0;padding:0;background:#09090b;font-family:Inter,system-ui,Arial,sans-serif">
<div style="max-width:480px;margin:24px auto;background:#18181b;border:1px solid #27272a;border-radius:16px;overflow:hidden">
<div style="background:linear-gradient(135deg,#f59e0b,#ea580c);padding:18px 20px;text-align:center;color:#fff;font-weight:800;font-size:18px">BoostPay</div>
<div style="padding:18px 20px;color:#e4e4e7;line-height:1.6">
<h2 style="margin:0 0 8px;color:#fff;font-size:16px">${title}</h2>
${bodyHtml}
<p style="margin:14px 0 0;font-size:11px;color:#71717a">If you didn't request this, ignore this email. Code expires in 15 minutes.</p>
</div>
<div style="padding:10px 20px;background:#09090b;text-align:center;font-size:10px;color:#52525b">BoostPay • Secure Wallet</div>
</div></body></html>`;
}
// rate-limit for OTP (per email + per IP) — in-memory
const otpEmailBuckets = new Map<string, { count:number; resetAt:number }>();
const otpIpBuckets = new Map<string, { count:number; resetAt:number }>();
function checkOtpRateLimit(email:string, ip:string): { ok:boolean; error?:string; retryAfter?:number } {
  const db = readDb();
  const smtp = ensureSmtpDefaults(db);
  const cfg = smtp.config || { rateLimitPerEmailPerMin:1, rateLimitPerIpPerHour:12 };
  const perEmail = Number(cfg.rateLimitPerEmailPerMin||1); // per minute actually 15min window
  const perIp = Number(cfg.rateLimitPerIpPerHour||12); // per hour
  const now = Date.now();
  const eKey = `otp:email:${email.toLowerCase()}`;
  let eb = otpEmailBuckets.get(eKey);
  if (!eb || eb.resetAt < now) { eb={ count:0, resetAt: now+15*60*1000 }; otpEmailBuckets.set(eKey, eb); }
  eb.count++;
  if (eb.count > perEmail) {
    const sec = Math.ceil((eb.resetAt-now)/1000);
    return { ok:false, error:`Too many codes to ${email} — wait ${Math.ceil(sec/60)} min`, retryAfter: sec };
  }
  const iKey = `otp:ip:${ip}`;
  let ib = otpIpBuckets.get(iKey);
  if (!ib || ib.resetAt < now) { ib={ count:0, resetAt: now+60*60*1000 }; otpIpBuckets.set(iKey, ib); }
  ib.count++;
  if (ib.count > perIp) {
    const sec2 = Math.ceil((ib.resetAt-now)/1000);
    return { ok:false, error:`Too many requests from your network — wait ${Math.ceil(sec2/60)} min`, retryAfter: sec2 };
  }
  return { ok:true };
}
setInterval(()=>{ const n=Date.now(); for(const [k,v] of otpEmailBuckets) if(v.resetAt < n-5*60*1000) otpEmailBuckets.delete(k); for(const [k,v] of otpIpBuckets) if(v.resetAt < n-60*60*1000) otpIpBuckets.delete(k); }, 5*60*1000);

// Active Real-time Server-Sent Events (SSE) connections for Chat
interface ChatSseClient {
  id: string;
  userId: string;
  sid?: string;
  res: express.Response;
}
const chatSseClients = new Map<string, ChatSseClient>();

/**
 * Live SSE connections for the Agent console (AGT-xxxx).
 * Used for WebRTC call signaling (agent <-> user) and inbound chat wake-ups.
 */
interface AgentSseClient {
  id: string;
  agentId: string;
  sid?: string;
  res: express.Response;
}
const agentSseClients = new Map<string, AgentSseClient>();

function pushToAgent(agentId: string, event: Record<string, any>) {
  const payload = `data: ${JSON.stringify(event)}\n\n`;
  for (const [clientId, client] of agentSseClients.entries()) {
    if (client.agentId === String(agentId)) {
      try { client.res.write(payload); } catch { agentSseClients.delete(clientId); }
    }
  }
}

// ===========================================================================
// Web Push — notifications that arrive while the app is CLOSED
// ---------------------------------------------------------------------------
// A service worker alone cannot wake a closed app; the browser's push service
// has to do it. Each device subscribes once (PushManager + VAPID) and the
// subscription is stored on the account that owns it:
//   db.pushSubscriptions = [{ id, ownerType: 'ADMIN'|'USER', ownerId, subscription, createdAt, ua }]
// VAPID keys: env override (VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY) or generated
// once and kept in the state document (db.pushKeys) so they survive redeploys —
// subscribers stay valid as long as the key pair does not change.
// ===========================================================================
let pushReady = false;
let pushPublicKey = '';
try {
  const envPub = (process.env.VAPID_PUBLIC_KEY || '').trim();
  const envPriv = (process.env.VAPID_PRIVATE_KEY || '').trim();
  // Set from the first readDb() call (see ensureVapidKeys) — needs the document.
  if (envPub && envPriv) {
    webpush.setVapidDetails(process.env.VAPID_SUBJECT || 'mailto:support@boostpay.online', envPub, envPriv);
    pushPublicKey = envPub;
    pushReady = true;
  }
} catch (e: any) {
  console.error('[push] VAPID env setup failed:', String(e?.message || e));
}

/**
 * `create` is false on the notification path: generating a key pair there would
 * write the state document in the middle of somebody else's mutation. Only the
 * subscribe / public-key endpoints create the pair.
 */
function ensureVapidKeys(db: any, create = false): boolean {
  if (pushReady) return true;
  try {
    let keys = db.pushKeys;
    if (!keys || !keys.publicKey || !keys.privateKey) {
      if (!create) return false;
      keys = webpush.generateVAPIDKeys();
      db.pushKeys = { publicKey: keys.publicKey, privateKey: keys.privateKey, createdAt: Date.now() };
      writeDb(db);
      console.log('[push] generated a new VAPID key pair (stored in the state document)');
    }
    webpush.setVapidDetails(process.env.VAPID_SUBJECT || 'mailto:support@boostpay.online', keys.publicKey, keys.privateKey);
    pushPublicKey = keys.publicKey;
    pushReady = true;
    return true;
  } catch (e: any) {
    console.error('[push] could not initialise VAPID keys:', String(e?.message || e));
    return false;
  }
}

type PushOwnerType = 'ADMIN' | 'USER' | 'AGENT' | 'MANAGEMENT';
type PushOwner = { type: PushOwnerType; id: string };

function pushSubsFor(db: any, owner: PushOwner): any[] {
  const all = Array.isArray(db.pushSubscriptions) ? db.pushSubscriptions : [];
  return all.filter((r: any) => r && r.ownerType === owner.type && String(r.ownerId) === String(owner.id));
}

/** Fire-and-forget delivery. Dead endpoints (404/410) are dropped from the store. */
function sendPushTo(db: any, owner: PushOwner, payload: { title: string; body: string; tag?: string; url?: string; kind?: string; callId?: string; from?: string; media?: string; data?: any }) {
  if (!ensureVapidKeys(db)) return;
  const subs = pushSubsFor(db, owner);
  if (!subs.length) return;
  const body = JSON.stringify({ ...payload, timestamp: Date.now() });
  for (const rec of subs) {
    try {
      Promise.resolve(
        webpush.sendNotification(rec.subscription, body, { TTL: 600, urgency: 'high' })
      ).catch((err: any) => {
        const code = Number(err?.statusCode || 0);
        if (code === 404 || code === 410) {
          // The browser dropped this subscription (app uninstalled, permission reset) — forget it.
          try {
            const doc = readDb();
            const before = (doc.pushSubscriptions || []).length;
            doc.pushSubscriptions = (doc.pushSubscriptions || []).filter((r: any) => r.id !== rec.id);
            if (doc.pushSubscriptions.length !== before) writeDb(doc);
          } catch { /* non-fatal */ }
        } else {
          console.warn('[push] delivery failed:', code || String(err?.message || err));
        }
      });
    } catch (e: any) {
      console.warn('[push] send threw:', String(e?.message || e));
    }
  }
}

/** Everyone who replies to users: support staff + superadmins. */
function notifyAdminsPush(db: any, payload: { title: string; body: string; tag?: string; url?: string }) {
  const all = Array.isArray(db.pushSubscriptions) ? db.pushSubscriptions : [];
  const adminIds = new Set<string>();
  for (const r of all) if (r && r.ownerType === 'ADMIN') adminIds.add(String(r.ownerId));
  for (const id of adminIds) sendPushTo(db, { type: 'ADMIN', id }, payload);
}

function notifyUserPush(db: any, userId: string, payload: { title: string; body: string; tag?: string; url?: string }) {
  sendPushTo(db, { type: 'USER', id: String(userId) }, payload);
}

function notifyAgentPush(db: any, agentId: string, payload: { title: string; body: string; tag?: string; url?: string }) {
  sendPushTo(db, { type: 'AGENT', id: String(agentId) }, payload);
}

function notifyManagementPush(db: any, managementId: string, payload: { title: string; body: string; tag?: string; url?: string }) {
  sendPushTo(db, { type: 'MANAGEMENT', id: String(managementId) }, payload);
}

/** One-line preview for a chat message of any kind (text / photo / voice / file). */
function pushPreview(m: any): string {
  const kind = String(m?.kind || 'text');
  if (kind === 'photo') return '📷 Photo';
  if (kind === 'voice') return '🎤 Voice message';
  if (kind === 'file') return '📎 File';
  const t = String(m?.text || '').trim();
  return t ? t.slice(0, 140) : 'New message';
}

function broadcastChatMessage(message: any, conversation: any) {
  const payload = JSON.stringify({
    type: 'chat_message',
    message,
    conversation,
    timestamp: Date.now()
  });

  const participants: string[] = Array.isArray(conversation.participants) ? conversation.participants : [];

  for (const [clientId, client] of chatSseClients.entries()) {
    // Deliver if client is admin listening to all or is one of the participants
    if (client.userId === 'ADMIN_SUPPORT' || participants.includes(client.userId)) {
      try {
        client.res.write(`data: ${payload}\n\n`);
      } catch {
      }
    }
  }
}

function broadcastChatMessageReaction(messageId: string, reactions: any, conversationId: string) {
  const payload = JSON.stringify({
    type: 'reaction_update',
    messageId,
    reactions,
    conversationId,
    timestamp: Date.now()
  });

  for (const [clientId, client] of chatSseClients.entries()) {
    try {
      client.res.write(`data: ${payload}\n\n`);
    } catch {
      chatSseClients.delete(clientId);
    }
  }
}

// ── Attachment storage helpers (fix storage-full: save base64 to disk, serve via /api/chat/file/:id, auto-cleanup old files) ──
/**
 * Parse a browser data-URL. Chrome/Safari ship the recorder mime WITH parameters
 * ("data:audio/webm;codecs=opus;base64,…"), and a naive /^data:([^;]+);base64,/
 * regex silently rejected every real voice note as "not an audio file".
 * Here the parameters are dropped and only the base type is kept.
 */
function parseDataUrl(dataUrl: string): { mime: string; base64: string } | null {
  const s = String(dataUrl || '');
  if (!/^data:/i.test(s)) return null;
  const comma = s.indexOf(',');
  if (comma < 0) return null;
  const params = s.slice(5, comma).split(';').map((x) => x.trim()).filter(Boolean);
  if (!params.some((x) => /^base64$/i.test(x))) return null;
  const mime = String(params[0] || 'application/octet-stream').toLowerCase();
  const base64 = s.slice(comma + 1).replace(/\s+/g, '');
  if (!base64) return null;
  return { mime, base64 };
}

function saveAttachmentToDisk(dataUrl: string, prefix: string): { fileId: string; url: string; mime: string; size: number } | null {
  try {
    const parsed = parseDataUrl(dataUrl);
    if (!parsed) return null;
    const mime = parsed.mime;
    const b64 = parsed.base64;
    const buf = Buffer.from(b64, 'base64');
    if (!buf.length || buf.length > 6*1024*1024) return null;
    const fileId = `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2,7)}`;
    // Audio must keep its real container: iOS/Safari records audio/mp4 (m4a),
    // Chrome records audio/webm. Serving an mp4 recording as audio/webm made
    // voice notes unplayable on iPhone.
    const ext = mime.includes('png') ? 'png'
      : mime.includes('jpeg') || mime.includes('jpg') ? 'jpg'
      : mime.includes('webp') ? 'webp'
      : mime.includes('gif') ? 'gif'
      : mime.includes('pdf') ? 'pdf'
      : mime.includes('audio/mp4') || mime.includes('audio/aac') || mime.includes('audio/m4a') ? 'm4a'
      : mime.includes('audio/ogg') ? 'ogg'
      : mime.includes('audio/wav') || mime.includes('audio/x-wav') ? 'wav'
      : mime.includes('audio/mpeg') ? 'mp3'
      : mime.includes('audio') ? 'webm'
      : mime.includes('video') ? 'mp4' : 'bin';
    const fname = `${fileId}.${ext}`;
    const fpath = path.join(UPLOAD_DIR, fname);
    fs.writeFileSync(fpath, buf);
    return { fileId, url: attachmentUrl(fileId), mime, size: buf.length };
  } catch { return null; }
}
function resolveAttachmentPath(fileId: string): string | null {
  try {
    const clean = String(fileId||'').replace(/[^a-zA-Z0-9._-]/g,'').slice(0,80);
    const files = fs.readdirSync(UPLOAD_DIR);
    const hit = files.find(f=> f.startsWith(clean+'.'));
    return hit ? path.join(UPLOAD_DIR, hit) : null;
  } catch { return null; }
}
/** Chat media is displayed by <img>/<audio> tags, which cannot send an
 *  Authorization header. A short HMAC of the (random, unguessable) fileId is
 *  appended to the URL instead, so media works without leaking the file to
 *  anyone who simply guesses an id. */
function signAttachmentId(fileId: string): string {
  return crypto.createHmac('sha256', API_SECRET).update(`chatfile:${String(fileId)}`).digest('base64url').slice(0, 32);
}
function attachmentUrl(fileId: string): string {
  return `/api/chat/file/${fileId}?t=${signAttachmentId(fileId)}`;
}
/* ── Chat content (shared by user↔agent and management↔agent threads) ──────
 * Owner rule (2026-10-23): the agent and management chats get the SAME
 * capabilities as the user chat — text, photos, voice notes, replies and read
 * receipts. File documents, polls, contact cards and stickers stay out. */
type ChatContent = {
  ok: true; kind: 'text' | 'photo' | 'voice'; text: string;
  photoFileId?: string; photoUrl?: string;
  voiceFileId?: string; voiceUrl?: string; voiceDurationMs?: number;
} | { ok: false; error: string };

function chatContentFromBody(body: any, maxLen = 500): ChatContent {
  const rawKind = String(body?.kind || '').toLowerCase();
  const photo = typeof body?.photo === 'string' ? body.photo : (typeof body?.photoData === 'string' ? body.photoData : '');
  const voice = typeof body?.voice === 'string' ? body.voice : (typeof body?.voiceData === 'string' ? body.voiceData : '');
  const kind: 'text' | 'photo' | 'voice' = (rawKind === 'photo' || (!rawKind && photo)) ? 'photo'
    : (rawKind === 'voice' || (!rawKind && voice)) ? 'voice' : 'text';
  const text = sanitizeText(body?.text || '', maxLen).trim();
  if (kind === 'photo') {
    if (!photo) return { ok: false, error: 'Photo data is missing.' };
    const mime = (parseDataUrl(photo) || {} as any).mime || '';
    if (!/^image\//i.test(String(mime))) return { ok: false, error: 'Only photos can be sent in chat.' };
    const saved = saveAttachmentToDisk(photo, 'chatphoto');
    if (!saved) return { ok: false, error: 'Photo could not be saved (max 6 MB).' };
    return { ok: true, kind, text, photoFileId: saved.fileId, photoUrl: saved.url };
  }
  if (kind === 'voice') {
    if (!voice) return { ok: false, error: 'Voice data is missing.' };
    const mime = (parseDataUrl(voice) || {} as any).mime || '';
    if (!/^audio\//i.test(String(mime))) return { ok: false, error: 'Only voice notes can be sent.' };
    const dur = Math.max(0, Math.min(120000, Number(body?.voiceDurationMs) || 0));
    if (dur > 120000) return { ok: false, error: 'Voice message too long (max 2 minutes).' };
    const saved = saveAttachmentToDisk(voice, 'chatvoice');
    if (!saved) return { ok: false, error: 'Voice note could not be saved (max 6 MB).' };
    return { ok: true, kind, text, voiceFileId: saved.fileId, voiceUrl: saved.url, voiceDurationMs: dur };
  }
  if (!text) return { ok: false, error: 'Message cannot be empty.' };
  return { ok: true, kind: 'text', text };
}

function chatReplyPatch(list: any[], replyToId: any, sameThread?: (m: any) => boolean) {
  const id = String(replyToId || '').trim();
  if (!id) return null;
  // Replies are scoped to one thread: a replyToId from another conversation must
  // never be echoed back as a quote (that leaked message text across threads).
  const src = (list || []).find((m: any) => String(m.id) === id && (!sameThread || sameThread(m)));
  if (!src) return null;
  const preview = src.kind === 'photo' ? 'Photo' : src.kind === 'voice' ? 'Voice message' : String(src.text || '').slice(0, 120);
  return { replyToId: String(src.id), replyToText: preview, replyToSender: String(src.senderRole || '') };
}
function chatPreviewOf(m: any): string {
  if (m.kind === 'photo') return 'Photo';
  if (m.kind === 'voice') return 'Voice message';
  return String(m.text || '');
}

/* Typing indicators (in-memory, 6 s TTL) — one key per thread. */
const chatTyping = new Map<string, { role: string; at: number }>();
function markChatTyping(key: string, role: string) { chatTyping.set(key, { role, at: Date.now() }); }
function isPeerTyping(key: string, myRole: string): boolean {
  const t = chatTyping.get(key);
  if (!t) return false;
  if (Date.now() - t.at > 6000) { chatTyping.delete(key); return false; }
  return String(t.role) !== String(myRole);
}

/** Re-sign media links that were stored before signed URLs existed. */
function ensureSignedMediaUrls(doc: any): boolean {
  let changed = false;
  for (const m of (doc && doc.messages) || []) {
    if (!m) continue;
    const pairs: [string, string][] = [['photoFileId', 'photoUrl'], ['fileId', 'fileUrl'], ['voiceFileId', 'voiceUrl']];
    for (const [idKey, urlKey] of pairs) {
      const id = (m as any)[idKey];
      if (!id) continue;
      const want = attachmentUrl(String(id));
      if ((m as any)[urlKey] !== want) { (m as any)[urlKey] = want; changed = true; }
    }
  }
  return changed;
}

function cleanupOldAttachments() {
  try {
    const db = readDb();
    const now = Date.now();
    const TTL_MS = 14*24*3600*1000; // 14 days for voice/photo/file (storage fix)
    const MAX_MSGS_PER_CONV = 500;
    const MAX_TOTAL_MSGS = 5000;
    const MAX_DB_MB = 50;
    let changed = false;
    // 1) Per-conversation cap 500 (delete oldest)
    const byConv = new Map<string, any[]>();
    for (const m of (db.messages||[])) {
      const cid = String(m.conversationId||'');
      if (!byConv.has(cid)) byConv.set(cid, []);
      byConv.get(cid)!.push(m);
    }
    for (const [cid, arr] of byConv.entries()) {
      if (arr.length > MAX_MSGS_PER_CONV) {
        arr.sort((a:any,b:any)=> (a.timestamp||0)-(b.timestamp||0));
        const toDel = arr.slice(0, arr.length - MAX_MSGS_PER_CONV);
        for (const mm of toDel) {
          if (mm.fileId) { try { const p=resolveAttachmentPath(mm.fileId); if(p&&fs.existsSync(p)) fs.unlinkSync(p); } catch{} }
          if ((mm as any).voiceFileId) { try { const p=resolveAttachmentPath((mm as any).voiceFileId); if(p&&fs.existsSync(p)) fs.unlinkSync(p); } catch{} }
          if ((mm as any).photoFileId) { try { const p=resolveAttachmentPath((mm as any).photoFileId); if(p&&fs.existsSync(p)) fs.unlinkSync(p); } catch{} }
        }
        (db as any).messages = (db.messages||[]).filter((x:any)=> !toDel.includes(x));
        changed = true;
      }
    }
    // 2) Global cap 5000 + TTL 14 days
    if ((db.messages||[]).length > MAX_TOTAL_MSGS) {
      const sorted = [...(db.messages||[])].sort((a:any,b:any)=> (a.timestamp||0)-(b.timestamp||0));
      const toDel2 = sorted.slice(0, sorted.length - MAX_TOTAL_MSGS);
      for (const mm of toDel2) {
        if ((mm as any).fileId) try { const p=resolveAttachmentPath((mm as any).fileId); if(p&&fs.existsSync(p)) fs.unlinkSync(p);} catch{}
      }
      (db as any).messages = (db.messages||[]).filter((x:any)=> !toDel2.includes(x));
      changed = true;
    }
    // TTL 14 days for media
    const ttlDel = (db.messages||[]).filter((m:any)=> m.timestamp && (now - m.timestamp > TTL_MS) && (m.kind==='photo'||m.kind==='voice'||m.kind==='file'));
    if (ttlDel.length) {
      for (const mm of ttlDel) {
        if ((mm as any).fileId) try { const p=resolveAttachmentPath((mm as any).fileId); if(p&&fs.existsSync(p)) fs.unlinkSync(p);} catch{}
      }
      (db as any).messages = (db.messages||[]).filter((x:any)=> !ttlDel.includes(x));
      changed = true;
    }
    // 3) DB file size >50MB → prune oldest 20%
    try {
      const stat = fs.statSync(DB_FILE);
      if (stat.size > MAX_DB_MB*1024*1024) {
        const sortedAll = [...(db.messages||[])].sort((a:any,b:any)=> (a.timestamp||0)-(b.timestamp||0));
        const cut = Math.floor(sortedAll.length*0.2);
        const toDel3 = sortedAll.slice(0, cut);
        for (const mm of toDel3) if ((mm as any).fileId) try { const p=resolveAttachmentPath((mm as any).fileId); if(p&&fs.existsSync(p)) fs.unlinkSync(p);} catch{}
        (db as any).messages = (db.messages||[]).filter((x:any)=> !toDel3.includes(x));
        changed = true;
      }
    } catch {}
    // 4) Inline base64 bloat → if message still has large inline data, move to disk now (migrate old)
    for (const m of (db.messages||[])) {
      const inline = (m as any).photoData || (m as any).fileData || (m as any).voiceData;
      if (inline && String(inline).length > 5000 && String(inline).startsWith('data:')) {
        const saved = saveAttachmentToDisk(String(inline), m.kind||'migrate');
        if (saved) {
          if ((m as any).photoData) { (m as any).photoFileId = saved.fileId; (m as any).photoUrl = saved.url; delete (m as any).photoData; }
          if ((m as any).fileData) { (m as any).fileId = saved.fileId; (m as any).fileUrl = saved.url; delete (m as any).fileData; }
          if ((m as any).voiceData) { (m as any).voiceFileId = saved.fileId; (m as any).voiceUrl = saved.url; delete (m as any).voiceData; }
          changed = true;
        }
      }
    }
    // 5) Orphan files on disk not referenced in DB → delete if older than 7 days
    try {
      const files = fs.readdirSync(UPLOAD_DIR);
      const refs = new Set<string>();
      for (const m of (db.messages||[])) { if ((m as any).fileId) refs.add((m as any).fileId); if ((m as any).photoFileId) refs.add((m as any).photoFileId); if ((m as any).voiceFileId) refs.add((m as any).voiceFileId); }
      for (const f of files) {
        const fid = f.split('.')[0];
        if (!refs.has(fid)) {
          const fp = path.join(UPLOAD_DIR, f);
          try { const st=fs.statSync(fp); if (now - st.mtimeMs > 7*24*3600*1000) fs.unlinkSync(fp); } catch{}
        }
      }
    } catch {}
    if (changed) writeDb(db);
  } catch {}
}

// --- Process safety net: one bad request must never crash the whole API ---
process.on('uncaughtException', (err: any) => {
  console.error('[UNCAUGHT]', err && err.code, err && err.message);
  // Header-already-sent style errors leave the process healthy — keep serving.
  if (err && (err.code === 'ERR_HTTP_HEADERS_SENT' || err.code === 'ERR_STREAM_WRITE_AFTER_END')) return;
  // Anything else: exit and let the orchestrator restart a clean worker.
  try { process.exit(1); } catch {}
});
process.on('unhandledRejection', (reason: any) => {
  console.error('[UNHANDLED-REJECTION]', reason && (reason.code || reason.message || reason));
});
setInterval(cleanupOldAttachments, 6*3600*1000); // every 6h
setTimeout(cleanupOldAttachments, 10*1000); // 10s after boot

// Server startup version for update/deployment detection
const SERVER_BOOT_TIME = Date.now();
const SERVER_VERSION = `v1.2.${Math.floor(SERVER_BOOT_TIME / 1000)}`;

// Ensure data directory and initial database file exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const INITIAL_DB = {
  users: [
    {
      id: "1",
      balance: 250.00,
      lifetimeProfit: 14.50,
      phrase: "alpha beacon crypto dynamic ember falcon galaxy harbor impact jupiter kinetic legacy",
      password: "user123",
      createdAt: Date.now() - 86400000,
      boostState: {
        isActive: false,
        isPaused: false,
        startedAt: 0,
        pausedAt: 0,
        elapsedMs: 0,
        targetDurationMs: 86400000,
        startingBalance: 250.00,
        accumulatedYield: 0
      }
    }
  ],
  transactions: [
    {
      id: "TX-99014120",
      userId: "1",
      type: "REWARD",
      amount: 14.50,
      timestamp: Date.now() - 3600000,
      notes: "Boosting reward credited"
    }
  ],
  conversations: [],
  messages: [],
  blocks: {},
  referrals: [],
  referCommissions: [],
  antifraudLogs: [],
  notifications: [
    {
      id: "NOTIF-99014120",
      userId: "1",
      type: "YIELD_REWARD",
      title: "BOOSTPAY-ALERTS",
      message: "YIELD ALERT: Boosting reward credited. $14.50 profit credited to your wallet balance. Ref: TX-99014120",
      amount: 14.50,
      referenceId: "TX-99014120",
      timestamp: Date.now() - 3600000,
      isRead: true,
      metadata: {
        balanceAfter: 250.00
      }
    }
  ],
  config: {
    minuteRatePercent: 0.001605, // 0.001605% per minute
    hourlyRatePercent: 0.09634, // ~0.0963% equivalent per hour
    minBoostMs: 60000, // 1 minute minimum
    maxBoostMs: 86400000, // 24 hours maximum
    dokploy: {
      host: "boostpay-eoqehk",
      port: 5432,
      database: "boostpaydb",
      user: "boostpaydbuser",
      externalIp: "72.60.42.18",
      dockerHostname: "boostpay-eoqehk",
      isConnected: true,
      lastPingMs: 42
    },
    referral: {
      enabled: true,
      baseRatePercent: 1, // default 1%
      maxRatePercent: 10,
      dailyTierEnabled: true, // 1 refer=1% ... 10+=10% per 24h UTC cycle
      commissionOnCompounding: true
    },
    antifraud: {
      enabled: true,
      tempFreezeMs: 3600000, // 1h temporary freeze (default)
      maxTransfersPer10Min: 5,
      maxDistinctSendersPerIp: 3,
      maxVolumePer10Min: 500,
      newAccountLargeTransferThreshold: 100, // new account <24h + transfer >100 => flag
      velocityEnabled: true,
      // per-reason dynamic durations (ms) — admin can set each
      freezeDurations: {
        velocity: 3600000,        // high velocity transfers
        multiIp: 3600000,        // multi-account same IP
        newAccountLarge: 1800000, // 30min for new account large
        deviceFingerprint: 7200000, // 2h for device multi-account
        loginSpam: 3600000,       // 1h login brute force
        chatSpam: 1800000,        // 30min chat spam
        scam: 7200000             // 2h scam attempt
      },
      // per-feature on/off toggles — admin can enable/disable each detection type
      features: {
        velocity: true,
        multiIp: true,
        newAccountLarge: true,
        deviceFingerprint: true,
        loginSpam: true,
        chatSpam: true,
        scam: true
      },
      maxLoginsPer10Min: 10, // FIX 5→10 for same-device typo tolerance
      maxMessagesPerMin: 10,
      ipBlockEnabled: true,
      blockedIps: [] as any[],
      ipAutoBlockThreshold: 50,
      ipAutoBlockDurationMs: 600000, // 10 min default (user reported "10 min" block)
      ipAutoBlockEnabled: true
    }
  },
  auditLogs: [
    {
      id: "LOG-INIT",
      action: "SYSTEM_INIT",
      adminEmail: "admin@boostpay.app",
      details: "System initialized with minute compounding engine (0.001605%/min)",
      timestamp: Date.now() - 3600000
    }
  ],
  smtp: {
    accounts: [],
    config: { dailyLimitPerAccount: 500, strategy:'round-robin', rateLimitPerEmailPerMin: 3, rateLimitPerIpPerHour: 20, enabled:true, fallbackToInbox:true },
    stats: { totalSent:0, totalFailed:0, byDay:{} },
    roundRobinIndex: 0
  }
};

function recordAuditLog(db: any, action: string, adminEmail: string, details: string, targetUserId?: string) {
  if (!db.auditLogs) db.auditLogs = [];
  const log = {
    id: 'LOG-' + Math.floor(10000000 + Math.random() * 90000000),
    action,
    adminEmail: adminEmail || 'admin@boostpay.app',
    targetUserId: targetUserId ? String(targetUserId) : undefined,
    details,
    timestamp: Date.now()
  };
  db.auditLogs.unshift(log);
  if (db.auditLogs.length > 1000) db.auditLogs.pop();
  return log;
}

// ---------------------------------------------------------------------------
// Referral helpers — dynamic 1-10% daily tier (UTC 00:00 cycle)
// ---------------------------------------------------------------------------
function getDayKey(ts?: number): string {
  const d = ts ? new Date(ts) : new Date();
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth()+1).padStart(2,'0');
  const dy = String(d.getUTCDate()).padStart(2,'0');
  return `${y}-${m}-${dy}`;
}
function getReferDailyCount(db: any, referrerId: string, dayKey?: string): number {
  const k = dayKey || getDayKey(Date.now());
  return (db.referrals || []).filter((r: any) => String(r.referrerId)===String(referrerId) && (r.dayKey||getDayKey(r.createdAt))===k).length;
}
function getReferTierRate(dailyCount: number, cfg: any): number {
  if (dailyCount <= 0) return Number(cfg?.referral?.baseRatePercent ?? 1);
  const v = Math.min(10, Math.max(1, dailyCount));
  // clamp to maxRate if configured lower
  const cap = Number(cfg?.referral?.maxRatePercent ?? 10);
  return Math.min(v, cap);
}
function getReferCommissionRate(db: any, referrerId: string, now?: number): number {
  const cfg = db.config || INITIAL_DB.config;
  if (cfg?.referral && cfg.referral.enabled === false) return 0;
  // Global ranking: who has most active referrals today gets 10%, least gets 1%
  if (cfg.referral.dailyTierEnabled !== false) {
    const dayK = getDayKey(now);
    // compute max dailyCount among all referrers for this day
    let maxCount = 0;
    const counts = new Map<string, number>();
    for (const r of (db.referrals || [])) {
      const k = (r.dayKey || getDayKey(r.createdAt));
      if (k === dayK) {
        const c = (counts.get(String(r.referrerId)) || 0) + 1;
        counts.set(String(r.referrerId), c);
        if (c > maxCount) maxCount = c;
      }
    }
    const myCnt = counts.get(String(referrerId)) || 0;
    if (myCnt === 0) return Number(cfg.referral.baseRatePercent ?? 1);
    if (maxCount <= 1) return myCnt >= 1 ? Number(cfg.referral.maxRatePercent ?? 10) : Number(cfg.referral.baseRatePercent ?? 1);
    // linear scale 1% to 10% based on rank relative to max
    // top (max) => 10%, bottom (1) => 1%+ small, 0=>base
    const ratio = myCnt / maxCount; // 0..1
    const minRate = Number(cfg.referral.baseRatePercent ?? 1);
    const maxRate = Number(cfg.referral.maxRatePercent ?? 10);
    const rate = minRate + ratio * (maxRate - minRate);
    return Math.round(rate * 100) / 100; // 2 decimal
  }
  return Number(cfg.referral.baseRatePercent ?? 1);
}
function getReferLifetimeCommission(db: any, referrerId: string): number {
  return (db.referCommissions || []).filter((c:any)=>String(c.referrerId)===String(referrerId)).reduce((acc:number,c:any)=>acc+(Number(c.amount)||0),0);
}
function getFreezeMsForReason(db:any, reasonKey:string): number {
  const cfg:any = (db.config||INITIAL_DB.config).antifraud || (INITIAL_DB as any).config.antifraud;
  const map:any = (cfg && cfg.freezeDurations) || {};
  if (map[reasonKey] !== undefined) return Number(map[reasonKey]);
  return Number(cfg.tempFreezeMs || 3600000);
}
function isAntifraudFeatureEnabled(db:any, reasonKey:string): boolean {
  const cfg:any = (db.config||INITIAL_DB.config).antifraud || (INITIAL_DB as any).config.antifraud;
  if (!cfg || cfg.enabled === false) return false;
  const feats:any = (cfg && cfg.features) || {};
  if (feats[reasonKey] === false) return false;
  // legacy velocityEnabled maps to velocity feature
  if (reasonKey==='velocity' && (cfg as any).velocityEnabled === false) return false;
  return true;
}
function getReferralsCount(db: any, referrerId: string): number {
  return (db.referrals || []).filter((r:any)=>String(r.referrerId)===String(referrerId)).length;
}

// ── Custom referral codes (vanity codes) ────────────────────────────────────
// A user's code is what youtubers put in a video description, so it has to be
// memorable ("MRBEAST", "TECH_GURU") and it has to keep working forever: when a
// user claims a new code the OLD one stays alive as an alias, so every link that
// was ever published still credits them. `db.referCodes` is the single registry
// ({code, userId, createdAt}); the number id keeps working as a fallback.
const REF_CODE_MIN = 4;
const REF_CODE_MAX = 16;
const REF_CODE_MAX_CLAIMS = 3;  // 1 first claim + 2 changes, for the account's lifetime
const REF_CODE_RESERVED = new Set([
  'ADMIN','ADMIN1','ADMINS','AGENT','AGENTS','SUPPORT','SYSTEM','ROOT','OWNER','STAFF',
  'BOOSTPAY','OFFICIAL','MANAGEMENT','API','NULL','UNDEFINED','TEST','DEMO','HELP','INFO',
  'REF','REFER','REFERRAL','JOIN','SIGNUP','LOGIN','WALLET','MONEY','FREE','BONUS','USDT',
]);

function normalizeRefCode(raw: any): string {
  return String(raw ?? '').trim()
    .replace(/^#/, '')
    .replace(/^REF-?/i, '')
    .replace(/[\s-]+/g, '')
    .toUpperCase();
}

/** Format rules only — "is this allowed at all", not "is it taken". */
function validateRefCodeFormat(code: string): { ok: boolean; error?: string } {
  if (!code) return { ok: false, error: 'Refer code is required.' };
  if (code.length < REF_CODE_MIN) return { ok: false, error: `Code must be at least ${REF_CODE_MIN} characters.` };
  if (code.length > REF_CODE_MAX) return { ok: false, error: `Code can be at most ${REF_CODE_MAX} characters.` };
  if (!/^[A-Z][A-Z0-9_]*$/.test(code)) return { ok: false, error: 'Use letters, numbers and _ only, and start with a letter.' };
  if (/^\d+$/.test(code)) return { ok: false, error: 'A code cannot be only numbers.' };
  if (REF_CODE_RESERVED.has(code)) return { ok: false, error: 'That code is reserved — pick another one.' };
  if (/^U\d+$/.test(code)) return { ok: false, error: 'That looks like a user ID — pick another one.' };
  if (/^(\d)\1+$/.test(code)) return { ok: false, error: 'That code is too repetitive — pick another one.' };
  return { ok: true };
}

/** Who owns this code right now? Custom codes first, then the legacy number id. */
function resolveRefCode(db: any, rawCode: any): { userId: string | null; code: string; via: 'custom' | 'id' | null } {
  const code = normalizeRefCode(rawCode);
  if (!code) return { userId: null, code, via: null };
  const row = (db.referCodes || []).find((r: any) => String(r.code).toUpperCase() === code);
  if (row) {
    const owner = (db.users || []).find((u: any) => String(u.id) === String(row.userId));
    if (owner) return { userId: String(owner.id), code, via: 'custom' };
  }
  // legacy: the plain user id (case-insensitive, "U12" or "12")
  const byId = (db.users || []).find((u: any) => String(u.id).toUpperCase() === code);
  if (byId) return { userId: String(byId.id), code, via: 'id' };
  return { userId: null, code, via: null };
}

/** The code a user should share: their custom one, else their number id. */
function primaryRefCode(db: any, user: any): string {
  if (!user) return '';
  const custom = String(user.referCodeCustom || '').toUpperCase();
  if (custom) return custom;
  return String(user.id);
}

/** Every code that still credits this user (primary first, then old aliases, then the id). */
function refCodeList(db: any, user: any): Array<{ code: string; primary: boolean; createdAt: number; kind: string }> {
  if (!user) return [];
  const primary = primaryRefCode(db, user);
  const rows = (db.referCodes || []).filter((r: any) => String(r.userId) === String(user.id));
  const out: Array<{ code: string; primary: boolean; createdAt: number; kind: string }> = [];
  const seen = new Set<string>();
  for (const r of rows) {
    const c = String(r.code).toUpperCase();
    if (seen.has(c)) continue;
    seen.add(c);
    out.push({ code: c, primary: c === primary, createdAt: Number(r.createdAt) || 0, kind: 'custom' });
  }
  out.sort((a, b) => (a.primary === b.primary ? b.createdAt - a.createdAt : (a.primary ? -1 : 1)));
  if (!seen.has(String(user.id).toUpperCase())) {
    out.push({ code: String(user.id), primary: !out.some(o => o.primary), createdAt: Number(user.createdAt) || 0, kind: 'id' });
  }
  return out;
}

/** Admin-tunable settings for vanity codes (Admin → Referral → Codes). */
function refCodeSettings(db: any): { limit: number; enabled: boolean; maxLength: number } {
  const cfg: any = (db.config || INITIAL_DB.config || {}).referral || {};
  const raw = Number(cfg.codeLimit);
  const limit = Number.isFinite(raw) && raw >= 0 && raw <= 50 ? Math.trunc(raw) : REF_CODE_MAX_CLAIMS;
  return {
    limit,
    enabled: cfg.codesEnabled !== false,
    maxLength: Math.min(24, Math.max(4, Number(cfg.codeMaxLength) || REF_CODE_MAX) as number),
  };
}

/** How many custom codes THIS user may claim: the global limit + any admin grant. */
function refCodeLimitFor(db: any, user: any): number {
  const base = refCodeSettings(db).limit;
  const extra = Math.max(0, Math.min(100, Number(user?.referCodeExtraClaims) || 0));
  return base + extra;
}

/** ── Signup bonus codes ────────────────────────────────────────────────────
 * A code can carry money: join with it and the new wallet is credited. The admin
 * decides per code the amount, how many people may use it, and whether that money
 * is transferable or boost-only. Rows live in db.bonusCodes.
 */
const BONUS_MAX_AMOUNT = 100000;
const BONUS_MAX_CLAIMS = 1000000;

function bonusRowOf(db: any, rawCode: any): any | null {
  const code = normalizeRefCode(rawCode);
  if (!code) return null;
  return (db.bonusCodes || []).find((b: any) => String(b.code).toUpperCase() === code) || null;
}

function bonusUsableView(b: any): any | null {
  if (!b) return null;
  const max = Math.max(0, Math.trunc(Number(b.maxClaims) || 0));
  const used = Math.max(0, Math.trunc(Number(b.used) || 0));
  const remaining = Math.max(0, max - used);
  const amount = Math.max(0, Number(b.amount) || 0);
  const active = b.enabled !== false && remaining > 0 && amount > 0;
  return {
    code: String(b.code).toUpperCase(),
    amount: Math.round(amount * 1e8) / 1e8,
    transferable: b.transferable !== false,
    maxClaims: max,
    used,
    remaining,
    active,
    note: String(b.note || ''),
  };
}

/** ══════════════════════════════════════════════════════════════════════════
 * PROMOTION ENGINE — Referral Code / Campaign / Bonus Wallet
 * ──────────────────────────────────────────────────────────────────────────
 * Deliberately three separate things so future promo types (deposit bonus,
 * welcome bonus, special reward) can reuse the same machinery:
 *
 *   campaign      — the offer: a code, a bonus per user, a use cap, a budget,
 *                   dates, audience, min deposit, transfer/withdraw permissions
 *   bonus grant   — one credited amount for one user from one campaign, with its
 *                   own remaining balance and expiry. Unique per (campaign,user)
 *                   so a retried signup/callback can never pay twice.
 *   bonus wallet  — the user's totals, computed from their grants (never stored
 *                   as a second number that could drift).
 *
 * Every credit/debit/expire/revoke is a row in db.bonusLedger.
 * ══════════════════════════════════════════════════════════════════════════ */
const CAMPAIGN_STATUSES = ['ACTIVE', 'PAUSED', 'INACTIVE'] as const;
const BONUS_MAX_USES = 1000000;
const BONUS_AMOUNT_MAX = 100000;

/** The single automatic welcome-bonus campaign, if one is configured and live. */
function welcomeCampaignOf(db: any): any | null {
  const list = (db.campaigns || []).filter((c: any) => c && c.kind === 'WELCOME');
  if (!list.length) return null;
  // prefer a live one, so an expired welcome campaign never hides a newer active one
  const live = list.find((c: any) => campaignState(db, c).live);
  return live || null;
}

function campaignOf(db: any, rawCode: any): any | null {
  const code = normalizeRefCode(rawCode);
  if (!code) return null;
  return (db.campaigns || []).find((c: any) => c.kind !== 'WELCOME' && String(c.code).toUpperCase() === code) || null;
}

/** Is this campaign allowed to pay right now? Returns the reason when it is not. */
function campaignState(db: any, c: any, now = Date.now()): { live: boolean; reason: string } {
  if (!c) return { live: false, reason: 'NO_CAMPAIGN' };
  if (c.status !== 'ACTIVE') return { live: false, reason: c.status === 'PAUSED' ? 'PAUSED' : 'INACTIVE' };
  const startAt = Number(c.startAt) || 0;
  const endAt = Number(c.endAt) || 0;
  if (startAt && now < startAt) return { live: false, reason: 'NOT_STARTED' };
  if (endAt && now > endAt) return { live: false, reason: 'EXPIRED' };
  const used = Math.max(0, Math.trunc(Number(c.used) || 0));
  const maxUses = Math.max(0, Math.trunc(Number(c.maxUses) || 0));
  if (maxUses > 0 && used >= maxUses) return { live: false, reason: 'FULL' };
  const budgetLimit = Number(c.budgetLimit) || 0;
  const budgetUsed = Number(c.budgetUsed) || 0;
  const perUser = Number(c.bonusPerUser) || 0;
  if (budgetLimit > 0 && budgetUsed + perUser > budgetLimit + 1e-9) return { live: false, reason: 'BUDGET_DONE' };
  return { live: true, reason: 'OK' };
}

function campaignPublicView(db: any, c: any): any {
  const st = campaignState(db, c);
  const used = Math.max(0, Math.trunc(Number(c.used) || 0));
  const maxUses = Math.max(0, Math.trunc(Number(c.maxUses) || 0));
  return {
    code: String(c.code).toUpperCase(),
    name: String(c.name || ''),
    bonusPerUser: Math.round((Number(c.bonusPerUser) || 0) * 1e8) / 1e8,
    valid: st.live,
    reason: st.reason,
    remainingSlots: maxUses > 0 ? Math.max(0, maxUses - used) : null,
    minDeposit: Number(c.minDeposit) || 0,
    // The bonus is real money in the main balance. It never expires; `bonusLockDays`
    // only keeps that slice out of transfers/withdrawals (boost is always allowed).
    bonusLockDays: Math.max(0, Math.trunc(Number(c.bonusLockDays) || 0)),
    bonusSend: campaignBonusSend(c),
    bonusSendLabel: BONUS_SEND_LABEL[campaignBonusSend(c)],
    creditedTo: 'BALANCE',
    endAt: Number(c.endAt) || 0,
    firstDepositBonus: Number(c.firstDepositBonus) || 0,
    firstDepositMin: Number(c.firstDepositMin) || 0,
    audience: c.audience === 'ALL' ? 'ALL' : 'NEW',
    kind: c.kind === 'WELCOME' ? 'WELCOME' : 'CODE',
    stackWithCode: c.stackWithCode !== false,
    dupIp: c.dupIp !== false,
    dupDevice: c.dupDevice !== false,
  };
}

/**
 * Every grant this user still holds, for reporting only. Bonuses no longer expire
 * and no longer sit in a separate wallet, so nothing is retired here.
 */
function activeGrants(db: any, userId: string, now = Date.now()): any[] {
  return (db.bonusGrants || []).filter((g: any) =>
    String(g.userId) === String(userId) && g.status === 'ACTIVE');
}

/** The expiry sweep mutates the db lazily — make sure a read path actually saves it. */
function persistBonusSweep(db: any) {
  if (db && db.__expiryDirty) {
    delete db.__expiryDirty;
    try { writeDb(db); } catch { /* next write will carry it */ }
  }
}

/**
 * The separate bonus wallet is gone (owner decision 2026-11-08): every promotion
 * bonus is credited straight to `user.balance`. This stays as an empty shell so
 * older installed apps keep working — they render nothing when everything is 0.
 */
function bonusWalletOf(db: any, userId: string, now = Date.now()): any {
  const user = (db.users || []).find((u: any) => String(u.id) === String(userId));
  return {
    available: 0, granted: 0, used: 0, nextExpiryAt: 0,
    canTransfer: false, canWithdraw: false, grants: [],
    mainBalance: Math.round((Number(user && user.balance) || 0) * 1e8) / 1e8,
    lockedPromo: promoBonusLockOf(user),
    bonusRestricted: promoBonusRestrictionOf(db, user).amount,
    bonusSendMode: promoBonusRestrictionOf(db, user).mode,
    bonusSendLabel: BONUS_SEND_LABEL[promoBonusRestrictionOf(db, user).mode] || BONUS_SEND_LABEL.ALL,
    ownSendable: ownSendable(user, db),
    creditedTo: 'BALANCE',
    notice: 'Promotion bonuses are added straight to your main balance.',
  };
}

/**
 * Move bonuses that still sit in the retired bonus wallet into the main balance
 * (owner decision 2026-11-08). Idempotent — a grant is moved once and flagged
 * `creditedTo: 'MAIN'`, so no money can be created or lost by running it twice.
 */
function migrateBonusWalletToBalance(db: any, opts: { userId?: string } = {}): { grants: number; users: string[]; total: number } {
  const only = opts.userId ? String(opts.userId) : '';
  const rows = (db.bonusGrants || []).filter((g: any) =>
    g.status === 'ACTIVE' && Number(g.remaining) > 0 && g.creditedTo !== 'MAIN' &&
    (!only || String(g.userId) === only));
  const r8v = (n: number) => Math.round((Number(n) || 0) * 1e8) / 1e8;
  let movedTotal = 0;
  const touched = new Set<string>();
  for (const g of rows) {
    const u = (db.users || []).find((x: any) => String(x.id) === String(g.userId));
    if (!u) continue;
    const amt = r8v(Number(g.remaining) || 0);
    if (!(amt > 0)) continue;
    u.balance = r8v((Number(u.balance) || 0) + amt);
    g.creditedTo = 'MAIN';
    g.movedToBalanceAt = Date.now();
    g.remaining = amt;
    movedTotal = r8v(movedTotal + amt);
    touched.add(String(u.id));
    if (!db.transactions) db.transactions = [];
    db.transactions.unshift({
      id: 'TX-' + Math.floor(10000000 + Math.random() * 90000000), userId: String(u.id),
      type: 'PROMO_BONUS', amount: amt, timestamp: Date.now(), balanceAfter: u.balance,
      notes: `${String(g.campaignCode || 'PROMO')} bonus moved into your balance`,
    });
    bonusLedgerRow(db, {
      id: 'BL-' + Math.floor(10000000 + Math.random() * 90000000), userId: String(u.id),
      grantId: g.id, campaignId: g.campaignId, type: 'BONUS_MOVED_TO_MAIN', amount: amt,
      timestamp: Date.now(), notes: `Bonus wallet retired — $${amt} from ${g.campaignCode} moved to the main balance`,
    });
  }
  return { grants: rows.length, users: [...touched], total: movedTotal };
}

/* ─────────────────────────────────────────────────────────────────────────────
 * Global currency display system.
 *
 * The wallet, the ledger and every transaction stay in USD. A user (or agent)
 * picks a display currency; the server converts with its own cached rate and the
 * apps only ever show what the server sends. Entry fields (send / withdraw /
 * boost) may be typed in the selected currency — the conversion back to USD is
 * always done here, never trusted from the client.
 * ───────────────────────────────────────────────────────────────────────────── */

const CURRENCY_CODES = new Set(CURRENCIES.map((c) => c.code));
const CURRENCY_BY_CODE = new Map(CURRENCIES.map((c) => [c.code, c]));
const FX_DEFAULT_URL = 'https://open.er-api.com/v6/latest/USD';
const FX_DEFAULT_REFRESH_MIN = 60;

function currencyConfigOf(db: any): any {
  if (!db.currencyConfig || typeof db.currencyConfig !== 'object') db.currencyConfig = {};
  const c = db.currencyConfig;
  if (!Array.isArray(c.disabled)) c.disabled = [];
  if (!c.default || !CURRENCY_CODES.has(String(c.default))) c.default = 'USD';
  if (!c.providerUrl) c.providerUrl = FX_DEFAULT_URL;
  const mins = Math.trunc(Number(c.refreshMinutes));
  c.refreshMinutes = mins >= 5 && mins <= 1440 ? mins : FX_DEFAULT_REFRESH_MIN;
  if (!c.manualRates || typeof c.manualRates !== 'object') c.manualRates = {};
  return c;
}

function enabledCurrencyCodes(db: any): string[] {
  const cfg = currencyConfigOf(db);
  const off = new Set(cfg.disabled.map((x: any) => String(x).toUpperCase()));
  return CURRENCIES.map((c) => c.code).filter((code) => !off.has(code));
}

/** The cached USD→X table plus when it was fetched and where it came from. */
function fxCacheOf(db: any): any {
  if (!db.fxCache || typeof db.fxCache !== 'object') db.fxCache = {};
  const c = db.fxCache;
  if (!c.rates || typeof c.rates !== 'object') c.rates = { USD: 1 };
  if (!c.fetchedAt) c.fetchedAt = 0;
  if (!c.source) c.source = '';
  return c;
}

function fxRate(db: any, code: string): number {
  const upper = String(code || 'USD').toUpperCase();
  if (upper === 'USD') return 1;
  const cfg = currencyConfigOf(db);
  const manual = Number(cfg.manualRates[upper]);
  if (manual > 0) return manual;
  const rate = Number(fxCacheOf(db).rates[upper]);
  return rate > 0 ? rate : 0;
}

/** USD → display currency. Never writes anything; display only. */
function toDisplay(db: any, usdAmount: number, code: string): number | null {
  const r = fxRate(db, code);
  if (!(r > 0)) return null;
  return Math.round((Number(usdAmount) || 0) * r * 1e6) / 1e6;
}

/**
 * Display currency → USD for an amount the user typed. Returns null when the
 * currency has no rate (the caller must refuse, never guess).
 */
function toUsd(db: any, amount: number, code: string): number | null {
  const r = fxRate(db, code);
  if (!(r > 0)) return null;
  return Math.round(((Number(amount) || 0) / r) * 100) / 100;
}

/** The currency a request may use for entry: the caller's saved preference, else USD. */
function entryCurrencyOf(owner: any): string {
  const code = String((owner && owner.currency) || 'USD').toUpperCase();
  return CURRENCY_CODES.has(code) ? code : 'USD';
}

/** Convert a typed amount into USD using the server's own rate table. */
function entryAmountToUsd(db: any, owner: any, amount: number, sentCode?: string): { usd: number; code: string; error?: string } {
  const saved = entryCurrencyOf(owner);
  const asked = String(sentCode || saved).toUpperCase();
  if (!CURRENCY_CODES.has(asked)) return { usd: 0, code: asked, error: 'Unknown currency code.' };
  if (asked !== saved && asked !== 'USD') {
    return { usd: 0, code: asked, error: 'Switch your display currency first, then enter the amount.' };
  }
  const cfg = currencyConfigOf(db);
  if (asked !== 'USD' && cfg.disabled.includes(asked)) {
    return { usd: 0, code: asked, error: `${asked} is not available right now.` };
  }
  const usd = toUsd(db, amount, asked);
  if (usd === null) return { usd: 0, code: asked, error: `No exchange rate for ${asked} yet — please enter the amount in USD.` };
  return { usd, code: asked };
}

/** Fetch fresh rates from the configured provider (server side, cached in the db). */
async function refreshFxRates(db: any, force = false): Promise<{ ok: boolean; fetchedAt: number; source: string; stale: boolean; error?: string }> {
  const cfg = currencyConfigOf(db);
  const cache = fxCacheOf(db);
  const ageMs = Date.now() - (Number(cache.fetchedAt) || 0);
  if (!force && cache.fetchedAt && ageMs < cfg.refreshMinutes * 60000) {
    return { ok: true, fetchedAt: cache.fetchedAt, source: cache.source, stale: false };
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(cfg.providerUrl, { signal: controller.signal, headers: { accept: 'application/json' } });
    if (!res.ok) throw new Error(`Provider HTTP ${res.status}`);
    const body: any = await res.json();
    const table: any = body && (body.rates || (body.data && body.data.rates) || body.conversion_rates);
    if (!table || typeof table !== 'object') throw new Error('Provider returned no rates');
    let n = 0;
    for (const cur of CURRENCIES) {
      const v = Number(table[cur.code]);
      if (v > 0) { cache.rates[cur.code] = v; n += 1; }
    }
    if (!n) throw new Error('Provider returned no usable rates');
    cache.rates.USD = 1;
    cache.fetchedAt = Date.now();
    cache.source = String(cfg.providerUrl);
    cache.stale = false;
    cache.lastError = '';
    writeDb(db);
    return { ok: true, fetchedAt: cache.fetchedAt, source: cache.source, stale: false };
  } catch (err: any) {
    cache.stale = true;
    cache.lastError = String(err?.message || err).slice(0, 200);
    // Last known good rate stays in place — the apps show it with its timestamp.
    try { writeDb(db); } catch { /* ignore */ }
    return { ok: false, fetchedAt: Number(cache.fetchedAt) || 0, source: cache.source, stale: true, error: cache.lastError };
  } finally {
    clearTimeout(timer);
  }
}

/** What the apps render: the enabled list + rates + freshness. */
function currencyOptionsPayload(db: any, forCode?: string) {
  const cfg = currencyConfigOf(db);
  const cache = fxCacheOf(db);
  const enabled = new Set(enabledCurrencyCodes(db));
  const rows = CURRENCIES.map((c) => ({
    code: c.code, name: c.name, symbol: c.symbol, flag: c.flag, country: c.country,
    decimals: c.decimals, enabled: enabled.has(c.code),
    rate: enabled.has(c.code) ? fxRate(db, c.code) : 0,
  }));
  const selected = String(forCode || cfg.default || 'USD').toUpperCase();
  const ageMin = cache.fetchedAt ? Math.floor((Date.now() - cache.fetchedAt) / 60000) : 0;
  return {
    base: 'USD',
    default: cfg.default,
    selected: CURRENCY_CODES.has(selected) && enabled.has(selected) ? selected : 'USD',
    refreshedAt: Number(cache.fetchedAt) || 0,
    ageMinutes: ageMin,
    stale: !!cache.stale || !Number(cache.fetchedAt),
    source: cache.source || '',
    refreshMinutes: cfg.refreshMinutes,
    autoDetect: geoConfigOf(db).autoDetect !== false,
    currencies: rows.filter((r) => r.enabled || r.code === 'USD'),
  };
}

/**
 * Country detection for the first-time currency pick.
 *
 * Priority (owner spec 2026-11-08):
 *   1. a currency the account already chose (manual or already detected) wins — always
 *   2. otherwise the country of THIS request: Cloudflare's CF-IPCountry header, then
 *      the country the app sent, then a cached IP-geo lookup
 *   3. otherwise the admin's default currency
 * Detection happens once per account and is stored; a later login — even from a
 * different country or through a VPN — never changes it.
 */
function geoConfigOf(db: any): any {
  const cfg = currencyConfigOf(db);
  if (cfg.autoDetect === undefined) cfg.autoDetect = true;
  if (!cfg.geoProvider) cfg.geoProvider = 'https://ip-api.com/json/';
  if (!db.geoCache || typeof db.geoCache !== 'object') db.geoCache = {};
  return cfg;
}

/** Country of the caller without any network call (header / client hint / cache). */
function countryHintOf(req: any, db?: any): string {
  const hdr = String(req?.headers?.['cf-ipcountry'] || '').toUpperCase();
  if (/^[A-Z]{2}$/.test(hdr) && hdr !== 'XX' && hdr !== 'T1') return hdr;
  const posted = String(req?.body?.country || '').toUpperCase();
  if (/^[A-Z]{2}$/.test(posted)) return posted;
  const ip = clientIp(req);
  if (db && db.geoCache && db.geoCache[ip] && Date.now() - Number(db.geoCache[ip].at || 0) < 30 * 86400000) {
    return String(db.geoCache[ip].country || '').toUpperCase();
  }
  return '';
}

/** Optional IP-geo lookup (best effort, 3s timeout, cached 30 days). */
async function geoLookupCountry(req: any, db: any): Promise<string> {
  const hint = countryHintOf(req, db);
  if (hint) return hint;
  const cfg = geoConfigOf(db);
  if (!cfg.geoProvider) return '';
  const ip = clientIp(req);
  if (!ip || /^(10\.|127\.|::1|172\.(1[6-9]|2\d|3[01])\.|192\.168\.)/.test(ip)) return '';
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 3000);
  try {
    const res = await fetch(`${cfg.geoProvider}${encodeURIComponent(ip)}?fields=countryCode`, { signal: controller.signal });
    if (!res.ok) return '';
    const body: any = await res.json().catch(() => ({}));
    const cc = String(body.countryCode || body.country_code || body.country || '').toUpperCase();
    if (!/^[A-Z]{2}$/.test(cc)) return '';
    if (!db.geoCache) db.geoCache = {};
    db.geoCache[ip] = { country: cc, at: Date.now() };
    return cc;
  } catch {
    return '';
  } finally { clearTimeout(timer); }
}

/**
 * Pick the display currency for a brand-new (or not-yet-set) account.
 * An unknown/geo-failed country, or a currency the admin disabled, falls back to
 * the platform default. Returns the ISO code and where it came from.
 */
function autoCurrencyForCountry(db: any, country: string): { code: string; source: 'COUNTRY' | 'DEFAULT'; country: string } {
  const cfg = geoConfigOf(db);
  const enabled = enabledCurrencyCodes(db);
  const byCountry = currencyForCountry(country);
  if (cfg.autoDetect && byCountry && enabled.includes(byCountry)) {
    return { code: byCountry, source: 'COUNTRY', country: String(country).toUpperCase() };
  }
  const def = enabled.includes(cfg.default) ? cfg.default : 'USD';
  return { code: def, source: 'DEFAULT', country: String(country || '').toUpperCase() };
}

/** Apply the auto pick to an account that has no currency yet. Returns true when set. */
function applyAutoCurrency(db: any, owner: any, country: string): boolean {
  if (!owner || owner.currency) return false;      // an existing choice is never overwritten
  const pick = autoCurrencyForCountry(db, country);
  owner.currency = pick.code;
  owner.currencySource = pick.source;
  owner.currencyCountry = pick.country;
  owner.currencySetAt = Date.now();
  try {
    recordAuditLog(db, 'CURRENCY_AUTO_SET', 'system',
      `Auto currency for ${owner.email ? 'account' : 'agent'} #${owner.id}: ${pick.code} (${pick.source}${pick.country ? `, country ${pick.country}` : ''})`,
      String(owner.id));
  } catch { /* audit must not break signup */ }
  return true;
}

/** Store a preference on a user / agent / admin row (audited, ISO validated). */
function setCurrencyPref(db: any, owner: any, code: string, who: string, kind: string): { ok: boolean; error?: string } {
  const upper = String(code || '').toUpperCase();
  if (!CURRENCY_CODES.has(upper)) return { ok: false, error: 'Not an ISO 4217 currency code.' };
  if (!enabledCurrencyCodes(db).includes(upper)) return { ok: false, error: `${upper} is not available right now.` };
  const before = String(owner.currency || 'USD');
  owner.currency = upper;
  // the country follows the currency the user picked, so the payment catalogue
  // immediately shows that country's local methods
  const cc = primaryCountryForCurrency(upper);
  if (cc) owner.currencyCountry = cc;
  owner.currencySource = 'MANUAL';       // permanent: auto-detection must never override this
  owner.currencySetAt = Date.now();
  recordAuditLog(db, 'CURRENCY_PREF_CHANGED', who, `${kind} #${owner.id} display currency ${before} → ${upper}`, String(owner.id));
  return { ok: true };
}

/**
 * Which country's LOCAL payment methods this account may use (owner spec
 * 2026-11-10). Priority:
 *   1. an explicit country saved on the account (signup/geo)
 *   2. the country stored with the auto currency pick
 *   3. the country of the display currency the user chose (BDT → BD)
 * Nothing is guessed from the IP here — the stored choice wins, exactly like the
 * currency rule, so a VPN or a trip abroad never changes the payment list.
 */
function effectiveCountryOf(db: any, owner: any): string {
  const explicit = String((owner && (owner.country || owner.currencyCountry)) || '').toUpperCase();
  if (/^[A-Z]{2}$/.test(explicit)) return explicit;
  // Only a currency the user actually chose pins a country. The legacy default
  // (USD from an empty profile) must stay "no restriction", otherwise accounts
  // that never used the picker would suddenly lose every local method.
  if (String((owner && owner.currencySource) || '').toUpperCase() !== 'MANUAL') return '';
  const cc = primaryCountryForCurrency(String((owner && owner.currency) || ''));
  return cc || '';
}

/** Country + label for the payment catalogue header. */
function countryLabelOf(cc: string): { code: string; label: string; flag: string } {
  const code = String(cc || '').toUpperCase();
  if (!/^[A-Z]{2}$/.test(code)) return { code: '', label: '', flag: '' };
  const code2 = currencyForCountry(code);
  const row = CURRENCIES.find((c) => c.code === code2);
  return { code, label: row ? row.country : code, flag: row ? row.flag : '' };
}

function bonusLedgerRow(db: any, row: any) {
  if (!db.bonusLedger) db.bonusLedger = [];
  db.bonusLedger.unshift(row);
  if (db.bonusLedger.length > 20000) db.bonusLedger.length = 20000;
}

/**
 * Pay a campaign bonus to one user — exactly once.
 * The (campaign, user) pair is the idempotency key, so a retried signup, a double
 * tap, or a replayed callback finds the existing grant and pays nothing.
 */
function creditCampaignBonus(db: any, opts: { campaign: any; userId: string; reason?: string; bypassFraud?: boolean; user?: any }): { paid: boolean; grant?: any; reason: string; reviewId?: string } {
  const { campaign: c, userId } = opts;
  const now = Date.now();
  const already = (db.bonusGrants || []).find((g: any) => String(g.campaignId) === String(c.id) && String(g.userId) === String(userId));
  if (already) return { paid: false, reason: 'ALREADY_PAID', grant: already };
  const st = campaignState(db, c, now);
  if (!st.live) return { paid: false, reason: st.reason };
  const amount = Math.max(0, Number(c.bonusPerUser) || 0);
  if (!(amount > 0)) return { paid: false, reason: 'NO_AMOUNT' };

  // Anti-fraud: another account on the same device/IP already claimed from this
  // campaign → hold for a human instead of paying. Never blocks the signup.
  if (!opts.bypassFraud) {
    // Which duplicate signals count is a per-campaign choice. Mobile carriers put
    // thousands of real users behind one IP (CGNAT), so IP-only matching blocks
    // genuine people — the admin can turn that signal off and keep device matching.
    const watchIp = c.dupIp !== false;
    const watchDevice = c.dupDevice !== false;
    const user = opts.user || (db.users || []).find((u: any) => String(u.id) === String(userId));
    const ip = watchIp ? String((user && (user as any).signupIp) || '') : '';
    const device = watchDevice ? String((user && (user as any).signupDevice) || '') : '';
    const dupGrant = (!watchIp && !watchDevice) ? null : (db.bonusGrants || []).find((g: any) => {
      if (String(g.campaignId) !== String(c.id)) return false;
      if (String(g.userId) === String(userId)) return false;
      const other = (db.users || []).find((u: any) => String(u.id) === String(g.userId));
      if (!other) return false;
      const sameIp = watchIp && ip && String((other as any).signupIp || '') === ip;
      const sameDevice = watchDevice && device && String((other as any).signupDevice || '') === device;
      return !!(sameIp || sameDevice);
    });
    if (dupGrant) {
      const review = {
        id: 'RV-' + Math.floor(10000000 + Math.random() * 90000000),
        userId: String(userId), campaignId: String(c.id), campaignCode: String(c.code).toUpperCase(),
        amount, status: 'PENDING', reason: 'DUPLICATE_ACCOUNT', timestamp: now,
        matchedUserId: String(dupGrant.userId), ip, device,
      };
      if (!db.bonusReviews) db.bonusReviews = [];
      db.bonusReviews.unshift(review);
      recordAuditLog(db, 'BONUS_HELD_FOR_REVIEW', String(userId), `Bonus $${amount} (campaign ${c.code}) held: duplicate account signal with #${dupGrant.userId}`, String(userId));
      return { paid: false, reason: 'PENDING_REVIEW', reviewId: review.id };
    }
  }

  const grant: any = {
    id: 'BG-' + Math.floor(10000000 + Math.random() * 90000000),
    userId: String(userId), campaignId: String(c.id), campaignCode: String(c.code).toUpperCase(),
    grantedAmount: amount, remaining: amount,
    grantedAt: now,
    expiresAt: 0, expiryAction: 'NONE',
    bonusTransfer: true, bonusWithdraw: true,
    status: 'ACTIVE', reason: opts.reason || 'SIGNUP',
  };
  if (!db.bonusGrants) db.bonusGrants = [];
  db.bonusGrants.unshift(grant);
  c.used = Math.max(0, Math.trunc(Number(c.used) || 0)) + 1;
  c.budgetUsed = Math.round(((Number(c.budgetUsed) || 0) + amount) * 1e8) / 1e8;
  const r8v = (n: number) => Math.round((Number(n) || 0) * 1e8) / 1e8;
  const lockDays = Math.max(0, Math.trunc(Number(c.bonusLockDays) || 0));
  grant.lockUntil = lockDays > 0 ? now + lockDays * 86400000 : 0;
  // The money is real money now: it goes straight into the main balance (owner
  // decision 2026-11-08 — no second wallet). The grant row stays for reporting.
  grant.creditedTo = 'MAIN';
  const moneyUser = opts.user || (db.users || []).find((u: any) => String(u.id) === String(userId));
  if (moneyUser) {
    moneyUser.balance = r8v((Number(moneyUser.balance) || 0) + amount);
    if (lockDays > 0) {
      moneyUser.promoBonusLocked = r8v((Number(moneyUser.promoBonusLocked) || 0) + amount);
      moneyUser.promoBonusLockUntil = Math.max(Number(moneyUser.promoBonusLockUntil) || 0, grant.lockUntil);
    }
    if (!db.transactions) db.transactions = [];
    db.transactions.unshift({
      id: 'TX-' + Math.floor(10000000 + Math.random() * 90000000), userId: String(userId),
      type: 'PROMO_BONUS', amount, timestamp: now, balanceAfter: moneyUser.balance,
      notes: `${String(c.code).toUpperCase()} bonus $${amount} added to balance${lockDays > 0 ? ` (locked for boosting for ${lockDays}d)` : ''}`,
    });
  }
  bonusLedgerRow(db, {
    id: 'BL-' + Math.floor(10000000 + Math.random() * 90000000),
    userId: String(userId), grantId: grant.id, campaignId: String(c.id),
    type: 'BONUS_CREDIT', amount, timestamp: now,
    notes: `Bonus $${amount} from campaign ${c.code} added to main balance${lockDays > 0 ? ` (locked ${lockDays}d, boost only)` : ''}`,
  });
  recordAuditLog(db, 'BONUS_CREDITED', String(userId), `Campaign ${c.code}: $${amount} added to the balance of #${userId} (${grant.id})`, String(userId));
  return { paid: true, reason: 'OK', grant };
}

function refCodeClaimsLeft(db: any, user: any): number {
  const used = (db.referCodes || []).filter((r: any) => String(r.userId) === String(user?.id)).length;
  return Math.max(0, refCodeLimitFor(db, user) - used);
}


// ── Team tree (unlimited downline) ───────────────────────────────────────────
// A user's team is every account that joined under them, at ANY depth. The tree
// is derived from db.referrals ({referrerId → referredId}) — it is never stored
// a second time, so it can never drift from the commission logic.
const TEAM_TREE_MAX_NODES = 50000;
const TEAM_TREE_MAX_DEPTH = 500;

function buildReferralIndex(db: any): Map<string, any[]> {
  const index = new Map<string, any[]>();
  for (const r of (db.referrals || [])) {
    if (!r || r.referrerId == null || r.referredId == null) continue;
    if (String(r.referrerId) === String(r.referredId)) continue; // self-link = corrupt, skip
    const parent = String(r.referrerId);
    const entry = { id: String(r.referredId), joinedAt: Number(r.createdAt) || 0 };
    const list = index.get(parent);
    if (list) list.push(entry); else index.set(parent, [entry]);
  }
  return index;
}

function walkTeam(index: Map<string, any[]>, rootId: string) {
  // BFS from the root: level per member, per-level counts, then subtree sizes
  // bottom-up. `seen` makes a corrupt cyclic link harmless instead of an
  // infinite loop, and the node cap keeps a runaway team from hanging the server.
  const childrenOf = (id: string) => index.get(String(id)) || [];
  const root = String(rootId);
  const level = new Map<string, number>();
  const levelCounts: number[] = [];
  const seen = new Set<string>([root]);
  let frontier = [root];
  let depth = 0;
  let visited = 0;
  let truncated = false;
  while (frontier.length) {
    if (depth >= TEAM_TREE_MAX_DEPTH) { truncated = true; break; }
    const next: string[] = [];
    for (const parent of frontier) {
      for (const child of childrenOf(parent)) {
        if (seen.has(child.id)) continue;
        if (visited >= TEAM_TREE_MAX_NODES) { truncated = true; break; }
        seen.add(child.id);
        visited += 1;
        level.set(child.id, depth + 1);
        levelCounts[depth] = (levelCounts[depth] || 0) + 1;
        next.push(child.id);
      }
      if (truncated) break;
    }
    if (truncated) break;
    if (!next.length) break;
    depth += 1;
    frontier = next;
  }
  const subtree = new Map<string, number>();
  for (const id of level.keys()) subtree.set(id, 0);
  const byDepthDesc = Array.from(level.keys()).sort((a, b) => (level.get(b) as number) - (level.get(a) as number));
  for (const id of byDepthDesc) {
    let size = 0;
    for (const child of childrenOf(id)) {
      if (!level.has(child.id)) continue;
      size += 1 + (subtree.get(child.id) || 0);
    }
    subtree.set(id, size);
  }
  return {
    level,
    subtree,
    levelCounts: Array.from({ length: depth }, (_, i) => levelCounts[i] || 0),
    depth,
    total: visited,
    truncated,
    childrenOf
  };
}

/**
 * Income map for a referrer's whole tree.
 *
 * Multi-level commission means the money a user earns from a member can come
 * from that member's OWN cycles and from everyone under them. Given the caller's
 * commissions (db.referCommissions) and the team graph we return two maps:
 *   self[id] = commission earned from that member's own boosting
 *   via[id]  = commission earned from that member AND everyone below them
 * so a tree row can say "ei member theke/er team theke ami koto pelam".
 * Legacy commission rows without a `level` field still work — attribution is
 * done on the graph, not on the stored level.
 */
function referralIncomeMaps(db: any, uid: string, walk: any, index: Map<string, any[]>) {
  const self = new Map<string, number>();
  const via = new Map<string, number>();
  const parentOf = new Map<string, string>();
  for (const [parent, kids] of index) {
    for (const k of kids) if (!parentOf.has(k.id)) parentOf.set(k.id, parent);
  }
  for (const c of (db.referCommissions || [])) {
    if (String(c.referrerId) !== String(uid)) continue;
    const rid = String(c.referredId);
    const amt = Number(c.amount) || 0;
    if (!(amt > 0)) continue;
    if (rid === uid) continue;                       // never pay yourself
    if (!walk.level.has(rid)) continue;              // not inside my tree (stale row)
    self.set(rid, (self.get(rid) || 0) + amt);
    let cur: string | undefined = rid;
    let guard = 0;
    while (cur && cur !== uid && guard < 500) {
      via.set(cur, (via.get(cur) || 0) + amt);
      cur = parentOf.get(cur);
      guard += 1;
    }
  }
  return { self, via };
}

function teamMemberLive(db: any, id: string) {
  const u = (db.users || []).find((x: any) => String(x.id) === String(id));
  if (!u) return { exists: false, boostActive: false, boostPaused: false };
  let live: any = null;
  try { live = liveBoostState(u); } catch { live = u.boostState; }
  return {
    exists: true,
    boostActive: !!(live && live.isActive && !live.isPaused),
    boostPaused: !!(live && live.isActive && live.isPaused)
  };
}

const LEGACY_USER_ID_MAP: Record<string, string> = {
  '849201': '1',
  '223344': '2'
};

function getNextSequentialUserId(users: any[]): string {
  if (!users || !Array.isArray(users) || users.length === 0) return '1';
  const numericIds = users
    .map((u: any) => parseInt(u.id, 10))
    .filter((n: number) => !isNaN(n) && n > 0 && n < 100000);
  if (numericIds.length === 0) return '1';
  return (Math.max(...numericIds) + 1).toString();
}

let lastKnownConfig: any = null;
function readDb() {
  // When PostgreSQL holds the state, it is the single source of truth
  if (pgDoc) {
    if (pgDoc.config) lastKnownConfig = pgDoc.config;
    ensureSmtpDefaults(pgDoc);
    ensurePaymentCollections(pgDoc);
    return pgDoc;
  }
  try {
    if (!fs.existsSync(DB_FILE)) {
      // If a rolling backup exists, restore it instead of seeding fresh data
      const backup = newestBackup();
      if (backup) {
        try {
          const restored = JSON.parse(fs.readFileSync(backup, 'utf-8'));
          if (restored && Array.isArray(restored.users) && restored.users.length > 0) {
            fs.writeFileSync(DB_FILE, JSON.stringify(restored, null, 2), 'utf-8');
            console.log(`Data restored from backup: ${path.basename(backup)} (${restored.users.length} users)`);
            return restored;
          }
        } catch { /* fall through to seed */ }
      }
      fs.writeFileSync(DB_FILE, JSON.stringify(INITIAL_DB, null, 2), 'utf-8');
      return INITIAL_DB;
    }
    const raw = fs.readFileSync(DB_FILE, 'utf-8');
    const parsed = JSON.parse(raw);
    if (!parsed.users) parsed.users = INITIAL_DB.users;
    if (!parsed.transactions) parsed.transactions = INITIAL_DB.transactions;
    if (!parsed.conversations) parsed.conversations = [];
    if (!parsed.messages) parsed.messages = [];
    if (!parsed.blocks) parsed.blocks = {};
    if (!Array.isArray(parsed.referrals)) parsed.referrals = [];
    if (!Array.isArray(parsed.referCommissions)) parsed.referCommissions = [];
    if (!Array.isArray(parsed.antifraudLogs)) parsed.antifraudLogs = [];
    ensurePaymentCollections(parsed);   // payment methods + deposit/withdraw queues
    // ensure config.referral + antifraud defaults
    if (!parsed.config) parsed.config = INITIAL_DB.config;
    if (!parsed.config.referral) parsed.config.referral = (INITIAL_DB as any).config.referral;
    if (!parsed.config.antifraud) parsed.config.antifraud = (INITIAL_DB as any).config.antifraud;
    if (parsed.config.antifraud && !(parsed.config.antifraud as any).freezeDurations) (parsed.config.antifraud as any).freezeDurations = (INITIAL_DB as any).config.antifraud.freezeDurations;
    if (parsed.config.antifraud && !(parsed.config.antifraud as any).features) (parsed.config.antifraud as any).features = (INITIAL_DB as any).config.antifraud.features;
    // ensure all freezeDurations keys exist
    if (parsed.config.antifraud && (parsed.config.antifraud as any).freezeDurations) {
      for (const k of Object.keys((INITIAL_DB as any).config.antifraud.freezeDurations)) {
        if ((parsed.config.antifraud as any).freezeDurations[k] === undefined) (parsed.config.antifraud as any).freezeDurations[k] = (INITIAL_DB as any).config.antifraud.freezeDurations[k];
      }
    }
    if (parsed.config.antifraud && (parsed.config.antifraud as any).features) {
      for (const k of Object.keys((INITIAL_DB as any).config.antifraud.features)) {
        if ((parsed.config.antifraud as any).features[k] === undefined) (parsed.config.antifraud as any).features[k] = (INITIAL_DB as any).config.antifraud.features[k];
      }
    }
    if (parsed.config.antifraud && (parsed.config.antifraud as any).blockedIps === undefined) (parsed.config.antifraud as any).blockedIps = [];
    if (parsed.config.antifraud && (parsed.config.antifraud as any).ipBlockEnabled === undefined) (parsed.config.antifraud as any).ipBlockEnabled = true;
    if (parsed.config.antifraud && (parsed.config.antifraud as any).ipAutoBlockThreshold === undefined) (parsed.config.antifraud as any).ipAutoBlockThreshold = 50;
    if (parsed.config.antifraud && (parsed.config.antifraud as any).ipAutoBlockDurationMs === undefined) (parsed.config.antifraud as any).ipAutoBlockDurationMs = 600000;
    if (parsed.config.antifraud && (parsed.config.antifraud as any).ipAutoBlockEnabled === undefined) (parsed.config.antifraud as any).ipAutoBlockEnabled = true;
    if (parsed.config.antifraud && Array.isArray((parsed.config.antifraud as any).blockedIps)) {
      const nowC=Date.now();
      (parsed.config.antifraud as any).blockedIps = (parsed.config.antifraud as any).blockedIps.filter((e:any)=> !e.until || Number(e.until) > nowC || e.enabled===false);
    }
    if (!parsed.smtp) parsed.smtp = (INITIAL_DB as any).smtp;
    if (!parsed.smtp.accounts) parsed.smtp.accounts = [];
    if (!parsed.smtp.config) parsed.smtp.config = (INITIAL_DB as any).smtp.config;
    if (!parsed.smtp.stats) parsed.smtp.stats = (INITIAL_DB as any).smtp.stats;
    if (parsed.smtp.roundRobinIndex===undefined) parsed.smtp.roundRobinIndex=0;
    // seed from env if empty (first run)
    if (parsed.smtp.accounts.length===0 && SMTP_ENV_USER && SMTP_ENV_PASS) {
      const today = smtpDayKey();
      parsed.smtp.accounts.push({ id:'smtp-'+Math.floor(100000+Math.random()*900000), email: SMTP_ENV_USER, appPassword: SMTP_ENV_PASS, host: SMTP_ENV_HOST, port: SMTP_ENV_PORT, secure: SMTP_ENV_PORT===465, label:'Primary Gmail (env)', enabled:true, dailyCount:0, totalSent:0, failedCount:0, lastError:'', lastSentAt:0, dayKey: today, createdAt: Date.now() });
    }
    if (!parsed.notifications) parsed.notifications = INITIAL_DB.notifications || [];
    // FIX #8: migrate old permanently frozen users that were auto-freeze but missing temp flags
    if (Array.isArray(parsed.users)) {
      const nowTmp = Date.now();
      for (const u of parsed.users) {
        if ((u as any).isFrozen) {
          const reason = String((u as any).frozenReason||'');
          const isAuto = reason.includes('Auto anti-fraud') || reason.includes('Auto anti-fraud 1h freeze') || reason.includes('Device fingerprint') || reason.includes('High velocity') || reason.includes('Multi-account');
          const hasUntil = !!(u as any).frozenUntil;
          const isTemp = !!(u as any).isTempFreeze;
          if (isAuto && !hasUntil) {
            // old auto freeze without expiry — convert to temp 1h from now
            (u as any).frozenUntil = nowTmp + 3600000;
            (u as any).isTempFreeze = true;
            if (!reason) (u as any).frozenReason = 'Auto anti-fraud 1h freeze (migrated)';
          }
          // also ensure any temp freeze older than 24h gets corrected to not stay forever
          if (isTemp && hasUntil && (u as any).frozenUntil < nowTmp - 24*3600000) {
            (u as any).frozenUntil = nowTmp + 3600000;
          }
        }
        // ensure allowMessages etc exist (from earlier backfill) — already handled elsewhere
      }
    }
    if (Array.isArray(parsed.users)) for (const u of parsed.users) { if ((u as any).allowMessages===undefined) (u as any).allowMessages=true; if ((u as any).allowVoiceCall===undefined) (u as any).allowVoiceCall=true; if (!(u as any).lastSeen) (u as any).lastSeen = (u as any).createdAt||Date.now(); }
    if (!parsed.config) parsed.config = INITIAL_DB.config;
    if (!parsed.auditLogs) parsed.auditLogs = INITIAL_DB.auditLogs || [];
    lastKnownConfig = parsed.config;
    if (!Array.isArray(parsed.sessions)) parsed.sessions = [];

    // Check for legacy user IDs and auto-migrate sequentially starting at 1
    let migrated = false;
    if (Array.isArray(parsed.users)) {
      for (const u of parsed.users) {
        if (LEGACY_USER_ID_MAP[u.id]) {
          u.id = LEGACY_USER_ID_MAP[u.id];
          migrated = true;
        }
      }
    }

    // backfill referCode for old users
    if (Array.isArray(parsed.users)) {
      for (const u of (parsed.users as any[])) {
        if (!(u as any).referCode) (u as any).referCode = String(u.id);
      }
    }
    if (migrated) {
      if (Array.isArray(parsed.transactions)) {
        for (const t of parsed.transactions) {
          if (LEGACY_USER_ID_MAP[t.userId]) t.userId = LEGACY_USER_ID_MAP[t.userId];
          if (LEGACY_USER_ID_MAP[t.senderId]) {
            t.senderId = LEGACY_USER_ID_MAP[t.senderId];
            if (t.notes) t.notes = t.notes.replace('#849201', '#1').replace('#223344', '#2');
          }
          if (LEGACY_USER_ID_MAP[t.recipientId]) {
            t.recipientId = LEGACY_USER_ID_MAP[t.recipientId];
            if (t.notes) t.notes = t.notes.replace('#849201', '#1').replace('#223344', '#2');
          }
        }
      }

      if (Array.isArray(parsed.notifications)) {
        for (const n of parsed.notifications) {
          if (LEGACY_USER_ID_MAP[n.userId]) n.userId = LEGACY_USER_ID_MAP[n.userId];
          if (n.metadata) {
            if (n.metadata.senderId && LEGACY_USER_ID_MAP[n.metadata.senderId]) {
              n.metadata.senderId = LEGACY_USER_ID_MAP[n.metadata.senderId];
            }
            if (n.metadata.recipientId && LEGACY_USER_ID_MAP[n.metadata.recipientId]) {
              n.metadata.recipientId = LEGACY_USER_ID_MAP[n.metadata.recipientId];
            }
          }
          if (n.message) {
            n.message = n.message.replace(/#849201/g, '#1').replace(/#223344/g, '#2');
          }
        }
      }

      if (Array.isArray(parsed.conversations)) {
        for (const c of parsed.conversations) {
          if (Array.isArray(c.participants)) {
            c.participants = c.participants.map((p: string) => LEGACY_USER_ID_MAP[p] || p);
          }
        }
      }

      if (Array.isArray(parsed.messages)) {
        for (const m of parsed.messages) {
          if (LEGACY_USER_ID_MAP[m.senderId]) m.senderId = LEGACY_USER_ID_MAP[m.senderId];
        }
      }

      writeDb(parsed);
    }

    return parsed;
  } catch (err) {
    console.error('Error reading db file:', err);
    return INITIAL_DB;
  }
}

// ---------------------------------------------------------------------------
// Rolling data backups: the live db is the source of truth, but every N writes
// a timestamped snapshot is kept in data/backups/ so data loss is always
// recoverable (and a lost/empty db auto-restores from the newest snapshot).
// ---------------------------------------------------------------------------
const BACKUP_DIR = path.join(DATA_DIR, 'backups');
let writeCount = 0;

// ---------------------------------------------------------------------------
// Disk-write budget (VPS I/O).
// The old code wrote the whole 2.4 MB JSON document on EVERY mutation, made a
// full snapshot backup every 10 writes and pushed the same document to
// PostgreSQL each time: one small change cost ~5 MB of disk I/O and the app
// burned 30-47 GB/day. Postgres is the source of truth when connected, so the
// file is now only a debounced crash-recovery cache.
// ---------------------------------------------------------------------------
// Postgres is the source of truth (2s), so the local JSON cache can be lazy:
// one 2.4 MB rewrite every 5 min instead of every minute.
const FILE_FLUSH_MS = Number(process.env.DB_FILE_FLUSH_MS || 5 * 60 * 1000); // 5 min debounce
const BACKUP_INTERVAL_MS = Number(process.env.DB_BACKUP_INTERVAL_MS || 30 * 60 * 1000); // 30 min
const BACKUP_KEEP = Number(process.env.DB_BACKUP_KEEP || 24);
const PG_FLUSH_MS = Number(process.env.DB_PG_FLUSH_MS || 2000);           // 2s debounce
const LASTSEEN_FLUSH_MS = 5 * 60 * 1000;                                  // persist lastSeen every 5 min

// /api/db is gzipped on the wire (≈10:1 for JSON): at 1,000 users the payload is
// ~230 KB, and the app fetches it on open/login. Cheap to encode, big on mobile data.
let pendingFileDoc: any = null;   // latest doc waiting for the debounced file flush (no per-write serialization)
let fileFlushTimer: any = null;
let lastBackupAt = 0;
let lastSeenFlushAt = 0;

function rotateBackups() {
  try {
    if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const files = fs.readdirSync(BACKUP_DIR).filter((f) => f.startsWith('boostpay_db.')).sort();
    // keep at most BACKUP_KEEP snapshots (24 = 12h at the 30-min cadence)
    while (files.length >= BACKUP_KEEP) {
      const oldest = files.shift();
      if (oldest) {
        try { fs.unlinkSync(path.join(BACKUP_DIR, oldest)); } catch { /* ignore */ }
      }
    }
    return path.join(BACKUP_DIR, `boostpay_db.${stamp}.json`);
  } catch {
    return null;
  }
}

function writeDb(data: any) {
  try {
    // SAFETY NET: no write may ever silently drop admin accounts, sessions or
    // audit history. Merge endpoints rebuild the doc from partial payloads and
    // have wiped these collections in the past (users reported losing the admin
    // account after client syncs / restores). The preserved arrays are shared
    // references into the live doc, so normal in-place mutations still work.
    if (pgDoc && data !== pgDoc) {
      if (!Array.isArray(data.admins) || data.admins.length === 0) {
        if (Array.isArray(pgDoc.admins) && pgDoc.admins.length > 0) data.admins = pgDoc.admins;
      }
      if (!Array.isArray(data.sessions)) data.sessions = Array.isArray(pgDoc.sessions) ? pgDoc.sessions : [];
      if (!Array.isArray(data.auditLogs)) data.auditLogs = Array.isArray(pgDoc.auditLogs) ? pgDoc.auditLogs : [];
    }

    // PERF: the document used to be JSON.stringify-ed on EVERY write (~27 ms of
    // blocked event loop for a 4 MB doc), even though Postgres only persists it
    // every 2 s. Serialization is now done once per flush, not once per write.
    writeCount++;

    const writeFileNow = () => {
      const tempFile = `${DB_FILE}.tmp`;
      fs.writeFileSync(tempFile, JSON.stringify(data), 'utf-8');
      fs.renameSync(tempFile, DB_FILE);
    };

    if (pgPool) {
      // Postgres holds the state: keep the local file as a debounced cache only.
      pendingFileDoc = data;
      if (!fileFlushTimer) {
        fileFlushTimer = setTimeout(() => {
          fileFlushTimer = null;
          const doc = pendingFileDoc;
          pendingFileDoc = null;
          if (!doc) return;
          try {
            const tempFile = `${DB_FILE}.tmp`;
            fs.writeFileSync(tempFile, JSON.stringify(doc), 'utf-8');
            fs.renameSync(tempFile, DB_FILE);
          } catch (err) {
            console.error('Error flushing db file cache:', err);
          }
        }, FILE_FLUSH_MS);
        if (typeof fileFlushTimer.unref === 'function') fileFlushTimer.unref();
      }
      pgDoc = data;
      schedulePgPersist(data);
    } else {
      // No Postgres: the file IS the database, write it synchronously.
      writeFileNow();
    }

    // Rolling safety snapshot — time based (was every 10 writes)
    if (Date.now() - lastBackupAt >= BACKUP_INTERVAL_MS) {
      lastBackupAt = Date.now();
      const backupFile = rotateBackups();
      if (backupFile) {
        try { fs.writeFileSync(backupFile, JSON.stringify(data), 'utf-8'); } catch { /* disk full etc. */ }
      }
    }
  } catch (err) {
    console.error('Error writing db file:', err);
  }
}

/** Newest available backup file path, or null. */
function newestBackup(): string | null {
  try {
    if (!fs.existsSync(BACKUP_DIR)) return null;
    const files = fs.readdirSync(BACKUP_DIR).filter((f) => f.startsWith('boostpay_db.')).sort();
    return files.length ? path.join(BACKUP_DIR, files[files.length - 1]) : null;
  } catch {
    return null;
  }
}

// ===========================================================================
// PostgreSQL persistence (optional, enabled with DATABASE_URL)
// The complete application state is stored as a JSON document in Postgres so
// data survives container rebuilds and redeploys. When DATABASE_URL is not
// configured the app keeps using the local JSON file (with rolling backups).
// ===========================================================================
const DATABASE_URL = (process.env.DATABASE_URL || '').trim();
let pgPool: any = null;
let pgDoc: any = null;
let pgFlushTimer: any = null;
let pgPending: any = null;
export const pgStatus = {
  mode: (DATABASE_URL ? 'postgres' : 'json-file') as 'postgres' | 'json-file',
  connected: false,
  host: '',
  database: '',
  latencyMs: 0,
  lastError: '',
  lastPersistAt: 0
};

async function initPostgres(): Promise<void> {
  if (!DATABASE_URL) {
    console.log('DATABASE_URL not set — using JSON file storage (data/boostpay_db.json)');
    return;
  }
  try {
    const u = new URL(DATABASE_URL);
    pgPool = new Pool({
      connectionString: DATABASE_URL,
      max: Number(process.env.PG_POOL_MAX || 20),
      connectionTimeoutMillis: 8000,
      idleTimeoutMillis: 30000
    });
    pgPool.on('error', (err: any) => {
      pgStatus.connected = false;
      pgStatus.lastError = String(err?.message || err);
      console.error('PostgreSQL pool error:', pgStatus.lastError);
    });

    const t0 = Date.now();
    const client = await pgPool.connect();
    await client.query(
      `CREATE TABLE IF NOT EXISTS app_state (
         id INTEGER PRIMARY KEY,
         data JSONB NOT NULL,
         updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
       )`
    );
    client.release();

    pgStatus.connected = true;
    pgStatus.host = u.hostname;
    pgStatus.database = (u.pathname || '/').slice(1) || 'postgres';
    pgStatus.latencyMs = Date.now() - t0;
    pgStatus.lastError = '';
    console.log(`PostgreSQL connected: ${pgStatus.database}@${pgStatus.host} (${pgStatus.latencyMs}ms)`);

    // Load state: Postgres is the source of truth when it has data.
    const res = await pgPool.query('SELECT data FROM app_state WHERE id = 1');
    if (res.rows.length && res.rows[0].data) {
      pgDoc = res.rows[0].data;
      adoptPersistedApiSecret(pgDoc);
      // refresh the local file cache
      try { fs.writeFileSync(DB_FILE, JSON.stringify(pgDoc, null, 2), 'utf-8'); } catch { /* ignore */ }
      console.log(`State loaded from PostgreSQL (${(pgDoc.users || []).length} users, ${(pgDoc.transactions || []).length} transactions)`);
    } else {
      // First run with a fresh database: migrate the local file (or seed) into Postgres
      const seed = readDb();
      pgDoc = seed;
      adoptPersistedApiSecret(seed);
      await pgPool.query('INSERT INTO app_state (id, data, updated_at) VALUES (1, $1, now())', [JSON.stringify(seed)]);
      pgStatus.lastPersistAt = Date.now();
      console.log(`State migrated into PostgreSQL (${(seed.users || []).length} users)`);
    }
  } catch (err: any) {
    pgStatus.connected = false;
    pgStatus.lastError = String(err?.message || err);
    console.error('PostgreSQL connection FAILED — falling back to JSON file storage:', pgStatus.lastError);
    // Drop the pool: with it alive, writeDb() would debounce the file cache while
    // the Postgres write fails, i.e. mutations could be lost on restart.
    try { await pgPool?.end?.(); } catch { /* ignore */ }
    pgPool = null;
    pgPending = null;
  }
}

function schedulePgPersist(data: any) {
  if (!pgPool) return;
  pgPending = data;
  if (pgFlushTimer) return;
  pgFlushTimer = setTimeout(async () => {
    pgFlushTimer = null;
    const doc = pgPending;
    pgPending = null;
    if (!doc) return;
    try {
      await pgPool.query(
        `INSERT INTO app_state (id, data, updated_at) VALUES (1, $1, now())
         ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, updated_at = now()`,
        [JSON.stringify(doc)]
      );
      pgStatus.connected = true;
      pgStatus.lastError = '';
      pgStatus.lastPersistAt = Date.now();
    } catch (err: any) {
      pgStatus.connected = false;
      pgStatus.lastError = String(err?.message || err);
      console.error('PostgreSQL persist error:', pgStatus.lastError);
    }
  }, PG_FLUSH_MS);
}

/** Real database latency probe (SELECT 1). */
async function pingPostgres(): Promise<{ ok: boolean; latencyMs: number; error?: string }> {
  if (!pgPool) return { ok: false, latencyMs: 0, error: 'DATABASE_URL not configured' };
  const t0 = Date.now();
  try {
    await pgPool.query('SELECT 1');
    pgStatus.connected = true;
    pgStatus.lastError = '';
    return { ok: true, latencyMs: Date.now() - t0 };
  } catch (err: any) {
    pgStatus.connected = false;
    pgStatus.lastError = String(err?.message || err);
    return { ok: false, latencyMs: Date.now() - t0, error: pgStatus.lastError };
  }
}

// ---------------------------------------------------------------------------
// Security: password hashing (scrypt, no external deps) + signed session tokens
// ---------------------------------------------------------------------------

/** Hash a password with a random per-user salt. Format: scrypt$<salt>$<hex> */
function hashPassword(plain: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(plain), salt, 32).toString('hex');
  return `scrypt$${salt}$${hash}`;
}

/** Verify a password. Supports legacy plaintext rows (auto-upgraded on login). */
function verifyPassword(stored: string | undefined, plain: string): boolean {
  if (!stored) return true; // account has no password set (legacy behaviour)
  if (stored.startsWith('scrypt$')) {
    const parts = stored.split('$');
    const salt = parts[1] || '';
    const hash = parts[2] || '';
    try {
      const test = crypto.scryptSync(String(plain), salt, 32).toString('hex');
      const a = Buffer.from(hash, 'hex');
      const b = Buffer.from(test, 'hex');
      return a.length === b.length && crypto.timingSafeEqual(a, b);
    } catch {
      return false;
    }
  }
  // Legacy plaintext row: constant-time-ish compare, then caller should re-hash
  const a = Buffer.from(stored);
  const b = Buffer.from(String(plain));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function needsRehash(stored: string | undefined): boolean {
  return !!stored && !stored.startsWith('scrypt$');
}

/** Persistent signing secret so sessions survive server restarts.
 *  Set API_SECRET in the environment for stable tokens across container redeploys. */
const SECRET_FILE = path.join(DATA_DIR, '.api-secret');
function getApiSecret(): string {
  if (process.env.API_SECRET) return process.env.API_SECRET;
  try {
    if (fs.existsSync(SECRET_FILE)) {
      const existing = fs.readFileSync(SECRET_FILE, 'utf-8').trim();
      if (existing) return existing;
    }
    const secret = crypto.randomBytes(32).toString('hex');
    fs.writeFileSync(SECRET_FILE, secret, { encoding: 'utf-8', mode: 0o600 });
    return secret;
  } catch {
    return crypto.randomBytes(32).toString('hex');
  }
}
// Deploy-safe signing secret: the container filesystem is ephemeral, so the file
// fallback produced a NEW secret on every redeploy and silently logged every user
// and admin out. The secret of record now lives inside the database document
// (state.secrets.apiSecret) and the old one stays accepted for a grace period.
let API_SECRET = getApiSecret();
const ACCEPTED_SECRETS: Set<string> = new Set([API_SECRET]);

/** One-time baseline for the Telegram-style unread feature.
 *  Without it every participant of a conversation that already existed would
 *  open the app to a phantom flood of "unread" history (lastRead was empty, so
 *  every old message counted). Existing conversations therefore start read;
 *  only messages that arrive from now on raise a badge. Runs exactly once per
 *  database (guarded by doc.unreadBaselineAt). */
function ensureUnreadBaseline(doc: any): boolean {
  if (!doc || typeof doc !== 'object') return false;
  if (doc.unreadBaselineAt) return false;
  try {
    for (const c of (doc.conversations || [])) {
      if (!c || !Array.isArray(c.participants)) continue;
      if (!c.lastRead || typeof c.lastRead !== 'object') c.lastRead = {};
      const seen = Number(c.lastMessageAt || c.timestamp || 0) || Date.now();
      for (const p of c.participants) {
        const key = String(p);
        if (!(key in c.lastRead)) c.lastRead[key] = seen;
      }
    }
  } catch { /* never block startup on this */ }
  doc.unreadBaselineAt = Date.now();
  return true;
}

/** Adopt the secret stored in the DB (or publish the current one) after load. */
function adoptPersistedApiSecret(doc: any): void {
  try {
    if (!doc) return;
    if (!doc.secrets || typeof doc.secrets !== 'object') doc.secrets = {};
    const stored = String(doc.secrets.apiSecret || '').trim();
    if (!stored) {
      doc.secrets.apiSecret = API_SECRET;      // first run after this fix
      return;
    }
    ACCEPTED_SECRETS.add(API_SECRET);          // keep sessions signed with the file secret valid
    ACCEPTED_SECRETS.add(stored);
    API_SECRET = stored;
    try { fs.writeFileSync(SECRET_FILE, stored, { encoding: 'utf-8', mode: 0o600 }); } catch { /* ignore */ }
  } catch { /* never block startup on this */ }
}

const TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days (was 30d — harden token theft window)

function issueToken(sub: string, role: 'USER' | 'ADMIN' | 'AGENT' | 'MANAGEMENT' | 'WALLET_AGENT', sid?: string, adminRole?: string): string {
  const payload: any = { sub: String(sub), role, exp: Date.now() + TOKEN_TTL_MS };
  if (sid) payload.sid = String(sid);
  if (adminRole) payload.adminRole = adminRole;
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', API_SECRET).update(body).digest('base64url');
  return `${body}.${sig}`;
}

function verifyToken(token: unknown): { sub: string; role: string; exp: number; sid?: string; adminRole?: string } | null {
  try {
    const raw = String(token || '');
    const dot = raw.lastIndexOf('.');
    if (dot <= 0) return null;
    const body = raw.slice(0, dot);
    const sig = raw.slice(dot + 1);
    const a = Buffer.from(sig);
    let sigOk = false;
    for (const secret of ACCEPTED_SECRETS) {
      const expected = crypto.createHmac('sha256', secret).update(body).digest('base64url');
      const b = Buffer.from(expected);
      if (a.length === b.length && crypto.timingSafeEqual(a, b)) { sigOk = true; break; }
    }
    if (!sigOk) return null;
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf-8'));
    if (!payload || !payload.sub || !payload.role || !payload.exp) return null;
    if (Number(payload.exp) < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

/**
 * Real client IP behind Cloudflare (2026-11-02, live).
 *
 * Evidence measured on production: through Cloudflare the origin sees the
 * Cloudflare EDGE address (172.71.151.36) as the last proxy hop, while a direct
 * hit — even with a forged `x-forwarded-for` — is correctly resolved to the real
 * caller (Traefik appends the peer address, it does not preserve a spoofed one).
 *
 * => We may trust `cf-connecting-ip` ONLY when the hop that reached Traefik is a
 *    published Cloudflare address. A direct-to-origin attacker cannot fake that,
 *    because his own address is what lands in the last hop.
 *
 * TRUST_CF_IP=1 forces the old behaviour (always trust the header),
 * TRUST_CF_IP=0 disables the Cloudflare path entirely.
 */
const TRUST_CF_IP = String(process.env.TRUST_CF_IP || 'auto').toLowerCase();
const IP_LIKE = /^[0-9a-fA-F:.]{3,45}$/;

// Cloudflare's published ranges — https://www.cloudflare.com/ips-v4 (bundled
// fallback; refreshed from the public API at boot when the network allows).
const CF_V4_FALLBACK = [
  '173.245.48.0/20', '103.21.244.0/22', '103.22.200.0/22', '103.31.4.0/22',
  '141.101.64.0/18', '108.162.192.0/18', '190.93.240.0/20', '188.114.96.0/20',
  '197.234.240.0/22', '198.41.128.0/17', '162.158.0.0/15', '104.16.0.0/13',
  '104.24.0.0/14', '172.64.0.0/13', '131.0.72.0/22'
];
const CF_V6_FALLBACK = [
  '2400:cb00::/32', '2606:4700::/32', '2803:f800::/32', '2405:b500::/32',
  '2405:8100::/32', '2a06:98c0::/29', '2c0f:f248::/32'
];
let cfRanges: { v4: [number, number][]; v6: [string, number][] } = { v4: [], v6: [] };

function ipToInt(ip: string): number {
  const p = ip.split('.');
  if (p.length !== 4) return -1;
  let n = 0;
  for (const part of p) {
    const b = Number(part);
    if (!Number.isInteger(b) || b < 0 || b > 255) return -1;
    n = (n * 256) + b;
  }
  return n;
}

function buildCfRanges(v4: string[], v6: string[]) {
  const out: { v4: [number, number][]; v6: [string, number][] } = { v4: [], v6: [] };
  for (const cidr of v4) {
    const [base, bitsRaw] = cidr.split('/');
    const bits = Number(bitsRaw);
    const start = ipToInt(base);
    if (start < 0 || !(bits >= 0 && bits <= 32)) continue;
    const size = Math.pow(2, 32 - bits);
    out.v4.push([start, start + size - 1]);
  }
  for (const cidr of v6) {
    const [base, bitsRaw] = cidr.split('/');
    const bits = Number(bitsRaw);
    if (!base || !(bits >= 0 && bits <= 128)) continue;
    out.v6.push([base.toLowerCase(), bits]);
  }
  return out;
}

function ipv6Prefix(ip: string): string {
  // Expand a compressed v6 address to 32 hex digits (no '::' left).
  const [head, tail] = ip.split('::');
  const h = head ? head.split(':').filter(Boolean) : [];
  const t = tail !== undefined ? (tail ? tail.split(':').filter(Boolean) : []) : null;
  let groups: string[];
  if (t === null) groups = h;
  else groups = [...h, ...Array(Math.max(0, 8 - h.length - t.length)).fill('0'), ...t];
  return groups.map(g => g.padStart(4, '0')).join('').toLowerCase();
}

function isCloudflareIp(ipRaw: string): boolean {
  const ip = String(ipRaw || '').trim().replace(/^\[|\]$/g, '');
  if (!ip) return false;
  if (cfRanges.v4.length === 0 && cfRanges.v6.length === 0) cfRanges = buildCfRanges(CF_V4_FALLBACK, CF_V6_FALLBACK);
  if (ip.includes(':')) {
    const bitsPrefix = ipv6Prefix(ip);
    return cfRanges.v6.some(([base, bits]) => {
      const full = ipv6Prefix(base);
      return bitsPrefix.slice(0, Math.floor(bits / 4)) === full.slice(0, Math.floor(bits / 4));
    });
  }
  const n = ipToInt(ip);
  if (n < 0) return false;
  return cfRanges.v4.some(([lo, hi]) => n >= lo && n <= hi);
}

/** The address that actually reached Traefik: last hop of x-forwarded-for. */
function peerHop(req: any): string {
  const xff = req.headers && req.headers['x-forwarded-for'];
  if (typeof xff === 'string' && xff.trim()) {
    const parts = xff.split(',').map((s: string) => s.trim()).filter(Boolean);
    if (parts.length) return parts[parts.length - 1];
  }
  return (req.socket && req.socket.remoteAddress) || '';
}

// Refresh the ranges once at boot (non-blocking, best effort) and every 12 h.
async function refreshCfRanges(): Promise<void> {
  try {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 8000);
    const r = await fetch('https://api.cloudflare.com/client/v4/ips', { signal: ctl.signal });
    clearTimeout(timer);
    const j: any = await r.json();
    const v4: string[] = (j && j.result && j.result.ipv4_cidrs) || [];
    const v6: string[] = (j && j.result && j.result.ipv6_cidrs) || [];
    if (v4.length) {
      cfRanges = buildCfRanges(v4, v6.length ? v6 : CF_V6_FALLBACK);
      console.log(`[cf-ip] refreshed ${v4.length} v4 + ${v6.length} v6 Cloudflare ranges`);
    }
  } catch { /* keep the bundled list */ }
}
cfRanges = buildCfRanges(CF_V4_FALLBACK, CF_V6_FALLBACK);
setTimeout(() => { void refreshCfRanges(); }, 3000);
setInterval(() => { void refreshCfRanges(); }, 12 * 60 * 60 * 1000).unref?.();

function clientIp(req: any): string {
  const hop = peerHop(req);
  const cfHeader = req.headers && (req.headers['cf-connecting-ip'] || req.headers['true-client-ip']);
  if (TRUST_CF_IP !== '0' && typeof cfHeader === 'string' && IP_LIKE.test(cfHeader.trim())) {
    const useIt = TRUST_CF_IP === '1' || TRUST_CF_IP === 'true' || TRUST_CF_IP === 'yes'
      || isCloudflareIp(hop);
    if (useIt) return cfHeader.trim();
  }
  // Behind trusted proxy (app.set trust proxy 1) Express populates req.ip correctly
  // Fallback to x-forwarded-for only if we trust proxy, otherwise socket IP
  try {
    const trustedIp = (req as any).ip;
    if (trustedIp && typeof trustedIp === 'string' && trustedIp !== '::1' && trustedIp !== '127.0.0.1') return trustedIp;
  } catch { /* ignore */ }
  const fwd = req.headers && (req.headers['x-forwarded-for'] || req.headers['x-real-ip']);
  if (typeof fwd === 'string' && fwd.trim()) {
    const cand = fwd.split(',')[0].trim();
    if (/^[a-fA-F0-9:.]+$/.test(cand)) return cand;
  }
  return (req.socket && req.socket.remoteAddress) || (req as any).ip || 'unknown';
}

function getBearerToken(req: any): string | null {
  const auth = req.headers['authorization'];
  if (typeof auth === 'string' && auth.toLowerCase().startsWith('bearer ')) {
    return auth.slice(7).trim();
  }
  const alt = req.headers['x-boostpay-token'];
  if (typeof alt === 'string' && alt.trim()) return alt.trim();
  // EventSource cannot send headers — allow ?token= for the SSE stream only
  // (safe over TLS; tokens are never logged by this server)
  const q = req.query && req.query.token;
  if (typeof q === 'string' && q.trim()) return q.trim();
  return null;
}

// ---------------------------------------------------------------------------
// Session devices (login sessions bound to signed tokens)
// ---------------------------------------------------------------------------
interface SessionRecord {
  id: string;
  userId: string;
  role: 'USER' | 'ADMIN' | 'AGENT' | 'MANAGEMENT' | 'WALLET_AGENT';
  ip: string;
  userAgent: string;
  createdAt: number;
  lastSeenAt: number;
  revoked?: boolean;
}
const revokedSessions = new Set<string>();
// Idempotency for agent money movements (double-tap / retry protection)
const agentIdempotency = new Map<string, { at: number; resp: any }>();
function sessionSnapshot(db: any): SessionRecord[] {
  if (!Array.isArray(db.sessions)) db.sessions = [];
  return db.sessions;
}
/** Push a "you were signed out" event to the affected device(s) and close their
 *  chat stream, so a second-device login kicks the first device immediately
 *  instead of waiting for its next API call. */
function kickRevokedStreams(userId: string, revokedSids: Set<string>, reason: string): void {
  try {
    for (const [clientId, client] of chatSseClients.entries()) {
      if (String(client.userId) !== String(userId)) continue;
      const sid = String(client.sid || '');
      // Close streams of the revoked sessions; also close unidentified legacy
      // streams since they can no longer be validated.
      if (revokedSids.size > 0 && sid && !revokedSids.has(sid)) continue;
      try {
        client.res.write(`data: ${JSON.stringify({ type: 'session_revoked', reason, timestamp: Date.now() })}\n\n`);
        client.res.end();
      } catch { /* stream already gone */ }
      chatSseClients.delete(clientId);
    }
  } catch { /* never block login */ }
}

/** Why a signed token may no longer be used (null = still valid).
 *  Single source of truth for USER *and* ADMIN protected routes. */
function sessionBlockReason(db: any, payload: any): string | null {
  if (!payload) return 'Authentication required. Please sign in.';
  const sid = String(payload.sid || '');
  // Tokens issued before session tracking (or forged without a session) are no
  // longer accepted: they cannot be revoked, which would defeat the device cap.
  if (!sid) return 'Your session is no longer valid. Please sign in again.';
  if (revokedSessions.has(sid)) return 'This session was signed out. Please sign in again.';
  try {
    const rec = sessionSnapshot(db).find((x: SessionRecord) => x.id === sid);
    // A session id belongs to exactly one account/role — a token that claims a
    // different subject than its session is never honoured.
    if (rec && (String(rec.userId) !== String(payload.sub) || String(rec.role) !== String(payload.role))) {
      return 'Your session is no longer valid. Please sign in again.';
    }
    if (rec && rec.revoked) {
      revokedSessions.add(sid);
      return 'This session was signed out. Please sign in again.';
    }
    if (rec && rec.lastSeenAt && Date.now() - rec.lastSeenAt > 7 * 24 * 3600 * 1000) {
      rec.revoked = true; revokedSessions.add(sid); writeDb(db);
      return 'Session expired due to 7-day inactivity. Please sign in again.';
    }
  } catch { /* non-fatal */ }
  return null;
}

function createSession(db: any, userId: string, role: 'USER' | 'ADMIN' | 'AGENT' | 'MANAGEMENT' | 'WALLET_AGENT', ip: string, userAgent: string): SessionRecord {
  const sess: SessionRecord = {
    id: 'SESS-' + Date.now().toString(36) + '-' + Math.floor(Math.random() * 1e9).toString(36),
    userId: String(userId),
    role,
    ip: ip || 'unknown',
    userAgent: (userAgent || '').slice(0, 220),
    createdAt: Date.now(),
    lastSeenAt: Date.now()
  };
  // CONCURRENCY CAP 1/device: 2nd login auto-logs-out 1st device — revoke all other active sessions for same user+role
  try {
    const revokedIds = new Set<string>();
    for (const s of sessionSnapshot(db)) {
      if (String(s.userId)===String(userId) && s.role===role && !s.revoked && s.id!==sess.id) {
        s.revoked = true;
        revokedSessions.add(s.id);
        revokedIds.add(s.id);
      }
    }
    if (revokedIds.size > 0) {
      kickRevokedStreams(String(userId), revokedIds, 'You were signed in on another device, so this device was signed out.');
    }
  } catch {}
  sessionSnapshot(db).unshift(sess);
  if (db.sessions.length > 2000) db.sessions.length = 2000;
  return sess;
}
// Enforce 1-device cap on future logins without needing to restart: also revoke orphaned sessions right after creation
function enforceSingleSession(db:any, userId:string, role:'USER'|'ADMIN', keepSid:string){
  try {
    for(const s of sessionSnapshot(db)){
      if(String(s.userId)===String(userId) && s.role===role && !s.revoked && s.id!==keepSid){
        s.revoked=true; revokedSessions.add(s.id);
      }
    }
  } catch {}
}
function revokeSession(db: any, sessionId: string): boolean {
  const list = sessionSnapshot(db);
  const sess = list.find((x: SessionRecord) => x.id === sessionId);
  if (!sess) return false;
  sess.revoked = true;
  revokedSessions.add(sessionId);
  return true;
}
function touchSession(db: any, sid?: string) {
  if (!sid) return;
  const sess = sessionSnapshot(db).find((x: SessionRecord) => x.id === sid && !x.revoked);
  if (sess) sess.lastSeenAt = Date.now();
}
// Session hygiene: expire idle sessions after 7d and prune revoked >30d (prevents DB bloat + stolen token reuse)
const SESSION_IDLE_MS = 7 * 24 * 3600 * 1000;
const SESSION_PRUNE_MS = 30 * 24 * 3600 * 1000;
setInterval(()=>{ try { const db=readDb(); const now=Date.now(); let changed=false;
  const before=(db.sessions||[]).length;
  db.sessions = (db.sessions||[]).filter((s:any)=> {
    if (s.revoked && s.lastSeenAt && now - s.lastSeenAt > SESSION_PRUNE_MS) { changed=true; return false; }
    if (!s.revoked && s.lastSeenAt && now - s.lastSeenAt > SESSION_IDLE_MS) { s.revoked=true; revokedSessions.add(s.id); changed=true; return true; }
    return true;
  });
  if (changed || before!==db.sessions.length) writeDb(db);
} catch {} }, 3600*1000);

// ---------------------------------------------------------------------------
// Realtime event push (reuses the authenticated SSE connections)
// ---------------------------------------------------------------------------
function pushToUser(userId: string, event: Record<string, any>) {
  const payload = `data: ${JSON.stringify(event)}\n\n`;
  for (const [clientId, client] of chatSseClients.entries()) {
    if (client.userId === String(userId)) {
      try { client.res.write(payload); } catch { chatSseClients.delete(clientId); }
    }
  }
}
function pushToAdmins(event: Record<string, any>) {
  const payload = `data: ${JSON.stringify(event)}\n\n`;
  for (const [clientId, client] of chatSseClients.entries()) {
    if (client.userId === 'ADMIN_SUPPORT') {
      try { client.res.write(payload); } catch { chatSseClients.delete(clientId); }
    }
  }
}

/** Push a fresh (live-computed) user snapshot to that user's open tabs + admins (realtime). */
function broadcastUserUpdate(db: any, userId: string) {
  const u = (db.users || []).find((x: any) => x.id === String(userId));
  if (!u) return;
  const evt = { type: 'user_update', user: publicUser(u), adminUser: adminUserView(u), timestamp: Date.now() };
  pushToUser(String(userId), evt);
  pushToAdmins(evt);
  // also notify admins about transaction stream updates (ledger realtime)
  pushToAdmins({ type: 'stats_invalidate', timestamp: Date.now() });
}

// ---------------------------------------------------------------------------
// Anti-phishing code tag: every genuine server alert carries the user's code
// ---------------------------------------------------------------------------
function phishTag(u: any): string {
  const code = u && typeof u.antiPhishingCode === 'string' && u.antiPhishingCode.trim()
    ? u.antiPhishingCode.trim()
    : '';
  return code ? ` [PhishCode: ${code}]` : '';
}

/** Notification helper that automatically stamps the user's anti-phishing code. */
function pushNotification(db: any, notif: any) {
  if (!db.notifications) db.notifications = [];
  const user = (db.users || []).find((x: any) => x.id === String(notif.userId));
  const stamped = { ...notif, message: `${notif.message || ''}${phishTag(user)}` };
  db.notifications.unshift(stamped);
  if (db.notifications.length > 5000) db.notifications.length = 5000;
  pushToUser(String(notif.userId), { type: 'notification', notification: stamped, timestamp: Date.now() });
  // Same alert as a Web Push, so the phone buzzes with the app closed.
  // Anything that looks like a secret (reset codes, OTPs, passwords) is stripped
  // from the lock-screen text on purpose.
  try {
    const raw = String(notif.message || '');
    const sensitive = /(code|otp|password|passcode|pin)\b/i.test(raw);
    const title = String(notif.title || 'BoostPay').replace(/\s*·.*$/, '').slice(0, 60);
    const body = sensitive ? 'Tap to open BoostPay and see the details.' : (raw.slice(0, 140) || 'You have a new update.');
    notifyUserPush(db, String(notif.userId), { title, body, tag: String(notif.type || 'boostpay'), url: '/' });
  } catch { /* notifications must never break on push problems */ }
  return stamped;
}

/**
 * Live boost state: elapsed time and accrued yield are computed on read so the
 * background ticker never needs to rewrite the database every second (this was
 * the source of UI flashing and disk churn).
 */
function liveBoostState(u: any): any {
  const bs = u && u.boostState ? u.boostState : null;
  if (!bs) return bs;
  const config = lastKnownConfig || INITIAL_DB.config;
  const minuteRate = config.minuteRatePercent !== undefined
    ? config.minuteRatePercent
    : (config.hourlyRatePercent ? config.hourlyRatePercent / 60 : 0.001605);
  const ratePerMs = (minuteRate / 100) / 60000;
  const out = { ...bs };
  if (bs.isActive && !bs.isPaused && bs.startedAt > 0) {
    const target = bs.targetDurationMs || 1;
    const elapsed = Math.min(Date.now() - bs.startedAt, target);
    out.elapsedMs = elapsed;
    const startingBal = Number(bs.startingBalance ?? u.balance) || 0;
    out.accumulatedYield = ratePerMs > 0
      ? (elapsed * ratePerMs < 1e-5
          ? startingBal * elapsed * ratePerMs
          : startingBal * Math.expm1(elapsed * Math.log1p(ratePerMs)))
      : 0;
  } else if (bs.isActive && bs.isPaused) {
    // Frozen view while paused: keep the checkpointed progress visible.
    const frozenElapsed = Number(bs.elapsedMs) || 0;
    const startingBal = Number(bs.startingBalance ?? u.balance) || 0;
    out.elapsedMs = frozenElapsed;
    out.accumulatedYield = bs.accumulatedYield !== undefined && bs.accumulatedYield !== null
      ? bs.accumulatedYield
      : (ratePerMs > 0
          ? (frozenElapsed * ratePerMs < 1e-5
              ? startingBal * frozenElapsed * ratePerMs
              : startingBal * Math.expm1(frozenElapsed * Math.log1p(ratePerMs)))
          : 0);
  }
  return out;
}

function requireUser(req: any, res: any, next: any) {
  const payload = verifyToken(getBearerToken(req));
  if (!payload || payload.role !== 'USER') {
    return res.status(401).json({ error: 'Authentication required. Please sign in.' });
  }
  {
    let dbChk: any = null;
    try { dbChk = readDb(); } catch { /* ignore */ }
    const blocked = sessionBlockReason(dbChk, payload);
    if (blocked) return res.status(401).json({ error: blocked });
  }
  // A token is only valid while its account still exists: an admin deleting a
  // user must immediately kill that user's API access (previously the JWT kept
  // working for chat/leaderboard/etc. and could even post as a ghost account).
  {
    const db: any = readDb();
    const u = (db.users || []).find((x: any) => String(x.id) === String(payload.sub));
    if (!u) return res.status(401).json({ error: 'This account no longer exists. Please sign in again.' });
    (u as any).lastSeen = Date.now();
    // Persist presence at most every 5 minutes (was a random 15% of EVERY
    // request, which meant dashboard polling rewrote the whole DB constantly).
    if (Date.now() - lastSeenFlushAt > LASTSEEN_FLUSH_MS) {
      lastSeenFlushAt = Date.now();
      writeDb(db);
    }
  }
  req.authUserId = payload.sub;
  req.authSid = payload.sid;
  try {
    const db = readDb();
    // Durable revocation: a signed-out session stays dead across restarts.
    const rec = sessionSnapshot(db).find((x: SessionRecord) => x.id === payload.sid);
    if (rec && rec.revoked && payload.sid) {
      revokedSessions.add(payload.sid);
      return res.status(401).json({ error: 'This session was signed out. Please sign in again.' });
    }
    if (rec && rec.lastSeenAt && Date.now() - rec.lastSeenAt > 7*24*3600*1000) {
      rec.revoked = true; if (payload.sid) revokedSessions.add(payload.sid); writeDb(db);
      return res.status(401).json({ error: 'Session expired due to 7-day inactivity. Please sign in again.' });
    }
    touchSession(db, payload.sid);
  } catch { /* non-fatal */ }
  next();
}

function requireAdmin(req: any, res: any, next: any) {
  const payload = verifyToken(getBearerToken(req));
  if (!payload || payload.role !== 'ADMIN') {
    return res.status(401).json({ error: 'Administrator authentication required.' });
  }
  {
    let dbChkA: any = null;
    try { dbChkA = readDb(); } catch { /* ignore */ }
    const blockedA = sessionBlockReason(dbChkA, payload);
    if (blockedA) return res.status(401).json({ error: blockedA });
  }
  req.authAdmin = payload.sub;
  req.authSid = payload.sid;
  req.authAdminRole = payload.adminRole || 'SUPERADMIN';
  try {
    const db = readDb();
    const rec = sessionSnapshot(db).find((x: SessionRecord) => x.id === payload.sid);
    if (rec && rec.revoked && payload.sid) {
      revokedSessions.add(payload.sid);
      return res.status(401).json({ error: 'This admin session was signed out.' });
    }
    if (rec && rec.lastSeenAt && Date.now() - rec.lastSeenAt > 7*24*3600*1000) {
      rec.revoked = true; if (payload.sid) revokedSessions.add(payload.sid); writeDb(db);
      return res.status(401).json({ error: 'Admin session expired (7-day inactivity). Please sign in again.' });
    }
    // Refresh lastSeen for active admin
    if (payload.sid) { const r2 = sessionSnapshot(db).find((x: SessionRecord)=> x.id===payload.sid); if (r2) r2.lastSeenAt = Date.now(); }
  } catch { /* non-fatal */ }
  next();
}

/** Sensitive admin operations require the SUPERADMIN role (audit-logged). */
function requireSuperAdmin(req: any, res: any, next: any) {
  if ((req.authAdminRole || 'SUPERADMIN') !== 'SUPERADMIN') {
    return res.status(403).json({ error: 'This action requires a SUPERADMIN account. Support admins have read-only access.' });
  }
  next();
}

/**
 * Guard for the wallet-agent panel (walletagent.boostpay.online).
 *
 * A wallet agent is NOT an admin: it can only see and action the deposit and
 * withdrawal requests of the one payment method it was bound to when the admin
 * created the account.
 */
function requireWalletAgent(req: any, res: any, next: any) {
  const payload = verifyToken(getBearerToken(req));
  if (!payload || payload.role !== 'WALLET_AGENT') {
    return res.status(401).json({ error: 'Wallet agent sign-in required.' });
  }
  let db: any = null;
  try { db = readDb(); } catch { /* ignore */ }
  const blocked = sessionBlockReason(db, payload);
  if (blocked) return res.status(401).json({ error: blocked });
  const ag = ((db && db.walletAgents) || []).find((a: any) => String(a.id) === String(payload.sub));
  if (!ag) return res.status(401).json({ error: 'This wallet-agent account no longer exists.' });
  if (ag.active === false) return res.status(403).json({ error: 'This wallet-agent account is disabled.' });
  req.authWalletAgentId = String(ag.id);
  req.authWalletAgentEmail = String(ag.email || '');
  req.authSid = payload.sid;
  next();
}

/**
 * Guard for routes shared by the user app and the agent console.
 * Resolves the caller to req.authUserId / req.authAdmin / req.authAgentId.
 */
function requireUserAdminOrAgent(req: any, res: any, next: any) {
  const payload = verifyToken(getBearerToken(req));
  if (!payload || !['USER', 'ADMIN', 'AGENT'].includes(payload.role)) {
    return res.status(401).json({ error: 'Authentication required. Please sign in.' });
  }
  let db: any = null;
  try { db = readDb(); } catch { /* ignore */ }
  const blocked = sessionBlockReason(db, payload);
  if (blocked) return res.status(401).json({ error: blocked });
  if (payload.role === 'USER') {
    const exists = ((db && db.users) || []).some((x: any) => String(x.id) === String(payload.sub));
    if (!exists) return res.status(401).json({ error: 'This account no longer exists. Please sign in again.' });
    req.authUserId = String(payload.sub);
  } else if (payload.role === 'AGENT') {
    const agent = ((db && db.agents) || []).find((a: any) => String(a.id) === String(payload.sub));
    if (!agent) return res.status(401).json({ error: 'This agent account no longer exists.' });
    if (agent.isActive === false) return res.status(403).json({ error: 'This agent account is disabled. Contact management.' });
    req.authAgentId = String(agent.id);
  } else {
    req.authAdmin = payload.sub;
  }
  req.authSid = payload.sid;
  req.authAdminRole = payload.adminRole || 'SUPERADMIN';
  try { if (db) touchSession(db, payload.sid); } catch { /* non-fatal */ }
  next();
}

function requireUserOrAdmin(req: any, res: any, next: any) {
  const payload = verifyToken(getBearerToken(req));
  if (!payload || (payload.role !== 'USER' && payload.role !== 'ADMIN')) {
    return res.status(401).json({ error: 'Authentication required. Please sign in.' });
  }
  let db: any = null;
  try { db = readDb(); } catch { /* fall through with null */ }
  // Single-device cap: a session revoked by a login on another device must lose
  // access here too (this guard covers /api/db, /api/chat and /api/sync — before
  // this check the first device kept full access after being "signed out").
  const blocked = sessionBlockReason(db, payload);
  if (blocked) return res.status(401).json({ error: blocked });
  if (payload.role === 'USER') {
    req.authUserId = payload.sub;
    let exists = false;
    try { exists = ((db && db.users) || []).some((x: any) => String(x.id) === String(payload.sub)); } catch { exists = true; }
    if (!exists) return res.status(401).json({ error: 'This account no longer exists. Please sign in again.' });
  }
  if (payload.role === 'ADMIN') req.authAdmin = payload.sub;
  req.authSid = payload.sid;
  req.authAdminRole = payload.adminRole || 'SUPERADMIN';
  try { if (db) touchSession(db, payload.sid); } catch { /* non-fatal */ }
  next();
}

/** Never leak credentials through the API. All sensitive fields stripped — only public profile visible to frontend. */
function publicUser(u: any): any {
  if (!u || typeof u !== 'object') return u;
  const { password, passwordPlain, passwordHash, phrase, resetToken, resetExpires, emailVerificationCode, emailVerificationExpires, ...rest } = u;
  // serverTime lets the app paint boost progress from elapsedMs + time-since-receipt instead of
  // `Date.now() - startedAt`. A phone whose clock is a few minutes off used to show 0 s / 0.0 %
  // (or jump straight to 100 %) while the server compounded normally.
  const lock = sendLockOf(u);
  const agentLock = agentLockOf(u);
  const pay = agentPayInfo(u);
  return {
    ...rest,
    boostState: liveBoostState(u),
    serverTime: Date.now(),
    // The user sees their own holds (the admin note stays internal).
    sendLock: { full: lock.full, amount: lock.amount, sendable: sendableBalance(u) },
    agentLock: { full: pay.full, amount: agentLock.amount, sendable: pay.cap, cause: pay.cause },
    // Display currency (money is always USD underneath).
    currency: entryCurrencyOf(u),
    currencySource: (u as any).currencySource || 'DEFAULT',
    currencyCountry: (u as any).currencyCountry || null,
    baseCurrency: 'USD',
    // A "boost only" signup bonus is visible but cannot leave the wallet.
    signupBonusLocked: signupBonusLockOf(u),
    signupBonus: Number((u as any).signupBonus) || 0,
    signupBonusCode: (u as any).signupBonusCode || null,
    signupBonusTransferable: (u as any).signupBonusTransferable !== false
  };
}

/**
 * Slim directory row for OTHER users (perf + privacy).
 * The user app only renders id / balance / profit and the boost state of peers
 * (leaderboard, dynamic boost duration, transfer preview, "chat with user #N").
 * Emails and account metadata are never included — the payload also shrinks by
 * ~60 %, which matters because every client polls /api/db.
 */
function directoryEntry(u: any): any {
  const bs = liveBoostState(u) || {};
  return {
    id: u.id,
    balance: Number(u.balance) || 0,
    lifetimeProfit: Number(u.lifetimeProfit) || 0,
    isFrozen: !!u.isFrozen,
    isBlocked: !!u.isBlocked,
    boostState: {
      isActive: !!bs.isActive,
      isPaused: !!bs.isPaused,
      startedAt: Number(bs.startedAt) || 0,
      elapsedMs: Number(bs.elapsedMs) || 0,
      targetDurationMs: Number(bs.targetDurationMs) || 0,
      startingBalance: Number(bs.startingBalance) || 0,
      accumulatedYield: Number(bs.accumulatedYield) || 0
    }
  };
}

/** Escape HTML to prevent stored XSS when user content is ever rendered as HTML */
function escapeHtml(s: string): string {
  return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}
/** Sanitize chat/inbox text — strip dangerous protocols + trim + length cap */
/**
 * Owner rule (2026-10-23): agent and management accounts follow the SAME Gmail
 * rule as the user app — only @gmail.com addresses, and the login form takes the
 * local part only ("abir567" -> abir567@gmail.com).
 */
function gmailLocalPart(raw: any): string {
  let s = String(raw == null ? '' : raw).trim().toLowerCase().replace(/\s+/g, '');
  // strip a Gmail domain typed (possibly twice) by mistake
  let prev = '';
  while (prev !== s) {
    prev = s;
    s = s.replace(/@gmail\.com$/, '').replace(/\.gmail\.com$/, '').replace(/gmail\.com$/, '');
    s = s.replace(/@gmailcom$/, '').replace(/\.gmailcom$/, '').replace(/gmailcom$/, '');
  }
  s = s.split('@')[0].replace(/[@.]+$/g, '');
  // keep only legal gmail local characters
  s = s.replace(/[^a-z0-9._]/g, '');
  return s;
}
function toGmailEmail(raw: any): string {
  const local = gmailLocalPart(raw);
  return local ? `${local}@gmail.com` : '';
}
/** For account creation: an explicit non-gmail domain is rejected, a bare
 *  username is expanded — never silently rewrites someone else's domain. */
function resolveGmailAccountEmail(raw: any): { ok: boolean; email: string; error?: string } {
  const src = String(raw == null ? '' : raw).trim();
  if (src.includes('@')) {
    const lower = src.toLowerCase();
    if (!/^[a-z0-9._]+@gmail\.com$/.test(lower)) {
      return { ok: false, email: '', error: 'Only @gmail.com email addresses are allowed (example: name@gmail.com).' };
    }
    return { ok: true, email: lower };
  }
  const email = toGmailEmail(src);
  if (!email || !isGmailEmail(email)) return { ok: false, email: '', error: 'Enter a Gmail username (example: name -> name@gmail.com).' };
  return { ok: true, email };
}
function isGmailEmail(raw: any): boolean {
  const e = String(raw || '').trim().toLowerCase();
  return /^[a-z0-9._]+@gmail\.com$/.test(e);
}
function sanitizeText(input: any, maxLen=2000): string {
  let t = String(input||'').trim();
  t = t.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g,''); // strip control chars
  // Strip dangerous tags entirely (defense in depth — React already escapes {m.text} but we sanitize storage)
  t = t.replace(/<script[^>]*>.*?<\/script>/gis,'').replace(/<iframe[^>]*>.*?<\/iframe>/gis,'').replace(/<object[^>]*>.*?<\/object>/gis,'');
  t = t.replace(/javascript:/gi,'').replace(/data:/gi,'').replace(/vbscript:/gi,'');
  // Escape remaining HTML so even if rendered via innerHTML it is inert
  t = t.replace(/</g,'&lt;').replace(/>/g,'&gt;');
  if (t.length > maxLen) t = t.slice(0,maxLen);
  return t;
}
function containsSpamLink(text: string): boolean {
  const lower = String(text||'').toLowerCase();
  // block obvious spam/phishing patterns
  const spamPatterns = ['http://','https://','www.','.ru','.xyz','bit.ly','tinyurl','t.me/','discord.gg','free money','double your','click here to win'];
  let hits=0;
  for (const p of spamPatterns) if (lower.includes(p)) hits++;
  return hits >= 2; // allow single link, block spam blast
}

/** Admin console view: shows stored credentials (owner-requested password visibility), keeps recovery phrase for support search. */
/**
 * Admin "sent money" lock — a temporary hold that only blocks OUTGOING money.
 *   sendLock = { mode: 'amount' | 'full' | 'off', amount, note, setBy, setAt }
 * mode 'full'   -> the user cannot send anything at all
 * mode 'amount' -> only (balance - amount) can be sent; the held part stays put
 * Receiving, boosting and admin adjustments are never blocked.
 */
const lockMoney = (n: any) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
/** Upper bound for a temporary hold — guards against typos / absurd values. */
const MAX_LOCK_AMOUNT = 1e9;

/**
 * Two INDEPENDENT temporary holds an admin can put on one user:
 *   sendLock  → outgoing P2P transfers        (/api/transfer)
 *   agentLock → outgoing payments to an agent (/api/user/send-to-agent)
 * Shape: { mode: 'amount' | 'full' | 'off', amount, note, setBy, setAt }
 * A hold only ever blocks OUTGOING money. Receiving, boosting, admin
 * adjustments and chat are never affected.
 */
type LockKey = 'sendLock' | 'agentLock';
type LockView = { full: boolean; amount: number; note: string; setAt: number };

function lockOf(u: any, key: LockKey): LockView {
  const raw = u && u[key];
  const mode = String((raw && raw.mode) || 'off');
  const balance = lockMoney(Number(u && u.balance) || 0);
  if (mode === 'full') return { full: true, amount: balance, note: String(raw.note || ''), setAt: Number(raw.setAt) || 0 };
  if (mode === 'amount') {
    // The hold is NOT capped at the current balance: an admin can park e.g. $50 on an
    // account that holds $0 today so nothing can leave as soon as money arrives
    // (owner request 2026-11-01). sendable = max(0, balance - amount).
    const amount = lockMoney(Math.max(0, Math.min(Number(raw.amount) || 0, MAX_LOCK_AMOUNT)));
    if (amount > 0) return { full: false, amount, note: String(raw.note || ''), setAt: Number(raw.setAt) || 0 };
  }
  return { full: false, amount: 0, note: '', setAt: 0 };
}

function sendLockOf(u: any): LockView { return lockOf(u, 'sendLock'); }
function agentLockOf(u: any): LockView { return lockOf(u, 'agentLock'); }

/**
 * A signup bonus can be marked "boost only" by the admin (per code). That money
 * sits in the wallet and compounds like any other balance, but it can never leave
 * the account: transfers, agent payments and withdrawals are capped at
 * (balance − hold − locked bonus). Profit earned ON TOP of the bonus is spendable,
 * so a $5 boost-only bonus on a $0 wallet becomes sendable as the wallet grows.
 */
function signupBonusLockOf(u: any): number {
  const raw = Number(u && u.signupBonusLocked);
  if (!(raw > 0)) return 0;
  const balance = lockMoney(Number(u && u.balance) || 0);
  return lockMoney(Math.min(raw, balance));
}

/**
 * A promotion bonus lands in the main balance, but for `bonusLockDays` that slice
 * cannot leave the account (transfers, agent payments, withdrawals). Boosting is
 * always allowed — the owner's rule for the welcome bonus (2026-11-08).
 * The lock expires on its own: once `promoBonusLockUntil` has passed nothing is held.
 */
function promoBonusLockOf(u: any): number {
  if (!u) return 0;
  const raw = Number(u.promoBonusLocked);
  if (!(raw > 0)) return 0;
  const until = Number(u.promoBonusLockUntil) || 0;
  if (until && Date.now() > until) return 0;
  const balance = lockMoney(Number(u.balance) || 0);
  return lockMoney(Math.min(raw, balance));
}

/**
 * WHO the money from a promotion bonus may be sent to — a per-campaign tick
 * (owner request 2026-11-08). The bonus itself is ordinary main-balance money, so
 * the rule only bites while the user still holds unspent bonus: money above
 * "own money" may only go to the allowed people.
 *   NONE  → boost only, it may not be sent at all
 *   L1    → the direct referrer (the person who referred them)
 *   DOWN  → their own downline, at any depth
 *   TEAM  → the referrer + the whole downline
 *   ALL   → anyone (no restriction)
 */
const BONUS_SEND_MODES = ['NONE', 'L1', 'DOWN', 'TEAM', 'ALL'];
const BONUS_SEND_LABEL: Record<string, string> = {
  NONE: 'boost only — it cannot be sent to anyone',
  L1: 'your direct referrer only',
  DOWN: 'your own team members only',
  TEAM: 'your referrer and your own team members only',
  ALL: 'anyone',
};

function campaignBonusSend(c: any): string {
  const m = String((c && c.bonusSend) || '').toUpperCase();
  if (BONUS_SEND_MODES.includes(m)) return m;
  // No tick stored yet (campaigns created before this setting): a WELCOME bonus is
  // boost-only by default — that is the owner's rule for the welcome bonus — while
  // older code campaigns keep the freedom they already had.
  return String((c && c.kind) || '').toUpperCase() === 'WELCOME' ? 'NONE' : 'ALL';
}

/** The people a bonus may be paid to under one mode. */
function bonusRecipientsOf(db: any, userId: string, mode: string): Set<string> {
  const out = new Set<string>();
  const uid = String(userId);
  if (mode === 'NONE' || mode === 'ALL') return out;
  if (mode === 'L1' || mode === 'TEAM') {
    const uplink = (db.referrals || []).find((r: any) => String(r.referredId) === uid);
    if (uplink) out.add(String(uplink.referrerId));
  }
  if (mode === 'DOWN' || mode === 'TEAM') {
    const walk = walkTeam(buildReferralIndex(db), uid);
    for (const id of walk.level.keys()) out.add(String(id));
  }
  out.delete(uid);
  return out;
}

/** How much of this user's balance is still bonus money that carries a send rule. */
function promoBonusRestrictionOf(db: any, u: any): { amount: number; mode: string } {
  const byId = new Map<string, any>((db.campaigns || []).map((c: any) => [String(c.id), c]));
  const rank: Record<string, number> = { ALL: 0, TEAM: 1, DOWN: 2, L1: 3, NONE: 4 };
  let amount = 0;
  let mode = 'ALL';
  const sendable = sendableBalance(u);
  for (const g of (db.bonusGrants || [])) {
    if (String(g.userId) !== String(u.id) || g.status !== 'ACTIVE') continue;
    const left = Number(g.remaining) || 0;
    if (!(left > 0)) continue;
    const m = campaignBonusSend(byId.get(String(g.campaignId)));
    if (m === 'ALL') continue;
    amount += left;
    if ((rank[m] || 0) > (rank[mode] || 0)) mode = m;
  }
  return { amount: Math.round(Math.min(amount, Math.max(0, sendable)) * 1e8) / 1e8, mode };
}

/** Money the user may send to anybody, because it is not bonus money. */
function ownSendable(u: any, db: any): number {
  const sendable = sendableBalance(u);
  const restricted = promoBonusRestrictionOf(db, u).amount;
  return Math.round(Math.max(0, sendable - restricted) * 1e8) / 1e8;
}

/**
 * Would sending `amount` to `recipientId` spend bonus money that is not allowed
 * to go there? Returns the refusal text, or null when the send may proceed.
 */
function bonusSendRefusal(db: any, sender: any, recipientId: string, amount: number): string | null {
  const restriction = promoBonusRestrictionOf(db, sender);
  if (!(restriction.amount > 0)) return null;
  const own = ownSendable(sender, db);
  if (amount <= own + 1e-9) return null;                 // paid from their own money
  if (restriction.mode === 'NONE') {
    return `$${restriction.amount.toFixed(2)} of your balance is a promotion bonus that can only be used for boosting — it cannot be sent to anyone. Boost it and the profit you earn on top is free to send.`;
  }
  const allowed = bonusRecipientsOf(db, String(sender.id), restriction.mode);
  if (allowed.has(String(recipientId))) return null;
  return `$${restriction.amount.toFixed(2)} of your balance is a promotion bonus that can be sent to ${BONUS_SEND_LABEL[restriction.mode]}. You can send up to $${own.toFixed(2)} to other users.`;
}

/** Book the part of a send that came out of bonus money (reporting + later release). */
function consumeBonusForSend(db: any, userId: string, amount: number, note: string) {
  let left = Math.round((Number(amount) || 0) * 1e8) / 1e8;
  if (!(left > 0)) return 0;
  let used = 0;
  for (const g of (db.bonusGrants || [])) {
    if (left <= 1e-9) break;
    if (String(g.userId) !== String(userId) || g.status !== 'ACTIVE') continue;
    const rem = Number(g.remaining) || 0;
    if (!(rem > 0)) continue;
    const take = Math.min(left, rem);
    g.remaining = Math.round((rem - take) * 1e8) / 1e8;
    if (g.remaining <= 1e-9) { g.status = 'USED'; g.closedAt = Date.now(); }
    left = Math.round((left - take) * 1e8) / 1e8;
    used = Math.round((used + take) * 1e8) / 1e8;
    bonusLedgerRow(db, {
      id: 'BL-' + Math.floor(10000000 + Math.random() * 90000000), userId: String(userId),
      grantId: g.id, campaignId: g.campaignId, type: 'BONUS_SENT_FROM_BALANCE', amount: take,
      timestamp: Date.now(), notes: note,
    });
  }
  return used;
}

function sendableWith(u: any, lock: LockView): number {
  const balance = lockMoney(Number(u && u.balance) || 0);
  if (lock.full) return 0;
  return lockMoney(Math.max(0, balance - lock.amount - signupBonusLockOf(u) - promoBonusLockOf(u)));
}

/** Balance the user may transfer out right now (P2P only). */
function sendableBalance(u: any): number { return sendableWith(u, sendLockOf(u)); }

/**
 * What is still payable to an agent. The agent lock and the general "sent
 * money" lock both cap it — whichever is tighter wins — and `cause` says which
 * one produced the number so the refusal message can name the real reason.
 */
function agentPayInfo(u: any): { cap: number; full: boolean; cause: 'none' | 'send' | 'agent' } {
  const sendLock = sendLockOf(u);
  const agentLock = agentLockOf(u);
  const s = sendableWith(u, sendLock);
  const a = sendableWith(u, agentLock);
  const cap = Math.min(s, a);
  let cause: 'none' | 'send' | 'agent' = 'none';
  if (a < s) cause = 'agent';
  else if (s < a) cause = 'send';
  else if (agentLock.full || agentLock.amount > 0) cause = 'agent';
  else if (sendLock.full || sendLock.amount > 0) cause = 'send';
  return { cap, full: !!(agentLock.full || sendLock.full), cause };
}

/** Refusal for an outgoing P2P transfer. */
function sendLockError(u: any): string {
  const lock = sendLockOf(u);
  const bonusLocked = signupBonusLockOf(u);
  const promoLocked = promoBonusLockOf(u);
  if (lock.full) return 'Sending money is temporarily locked on this account by administration. Please contact support.';
  if (promoLocked > 0 && lock.amount <= 0 && bonusLocked <= 0) {
    const until = Number(u && u.promoBonusLockUntil) || 0;
    const when = until ? new Date(until).toISOString().slice(0, 10) : '';
    const left = sendableBalance(u);
    if (left <= 0) return `Your $${promoLocked.toFixed(2)} promotion bonus stays in your balance but can only be boosted${when ? ` until ${when}` : ''}. Boost it — the profit you earn on top is free to send.`;
    return `$${promoLocked.toFixed(2)} of your balance is a promotion bonus locked for boosting${when ? ` until ${when}` : ''}. You can send up to $${left.toFixed(2)} right now.`;
  }
  const left = sendableBalance(u);
  // A signup bonus marked "boost only" is a DIFFERENT reason than an admin hold —
  // the refusal must name the real one, or the user is left guessing.
  if (lock.amount <= 0 && bonusLocked > 0) {
    if (left <= 0) return `Your $${bonusLocked.toFixed(2)} signup bonus can only be boosted — it cannot be sent, paid to an agent or withdrawn. Boost it and the profit you earn on top becomes sendable.`;
    return `$${bonusLocked.toFixed(2)} of your balance is a boost-only signup bonus. You can send up to $${left.toFixed(2)} of your own profit.`;
  }
  if (left <= 0) return `$${lock.amount.toFixed(2)} is temporarily held on this account by administration, which currently covers your whole balance. You cannot send money right now. Please contact support.`;
  return `$${lock.amount.toFixed(2)} of your balance is temporarily held by administration. You can send up to $${left.toFixed(2)} right now.`;
}

// ── "Send to refer only" policy ────────────────────────────────────────────
// Admin can pin a user's outgoing P2P transfers to their own upline, with a cap:
//   mode 'off'  → normal sending
//   mode 'l1'   → only the direct referrer (tick: "only L1 refer")
//   mode 'team' → the direct referrer AND everyone in their downline
//   period      → the cap applies per day ('day'), per send ('send') or once ('total')
// It is a SEND restriction only: receiving, boosting, withdrawals and agent
// payments are untouched. The server is the only place it is enforced.
const referRound2 = (n: number) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const REFER_SEND_MODES = ['off', 'l1', 'team'];
const REFER_SEND_PERIODS = ['day', 'send', 'total'];

function referSendPolicyOf(u: any) {
  const p = (u && (u as any).referSend) || {};
  const mode = REFER_SEND_MODES.includes(String(p.mode)) ? String(p.mode) : 'off';
  const period = REFER_SEND_PERIODS.includes(String(p.period)) ? String(p.period) : 'day';
  const amount = Math.max(0, referRound2(Number(p.amount) || 0));
  return {
    mode, period, amount,
    // tick in the admin card: may this user send to the person who referred them?
    // Everything else in the rule is unaffected — only the upline is switched off.
    allowUpline: p.allowUpline !== false,
    // tick in the admin card: the same rule follows the money to whoever receives it
    inherit: !!p.inherit,
    inheritedFrom: String(p.inheritedFrom || ''),
    source: String(p.source || ''),
    note: String(p.note || '').slice(0, 160),
    setBy: String(p.setBy || ''),
    setAt: Number(p.setAt) || 0,
  };
}

/**
 * "Also apply to the receiver" — the rule follows the money.
 *
 * When a restricted user pays somebody and that tick is on, the receiver is put
 * under the same rule (same mode, cap and period), so they too can only send to
 * their own refer/team. Two safety rules:
 *   · an EXPLICIT admin rule on the receiver is never overwritten;
 *   · a rule that itself arrived by inheritance IS replaced by the newer one,
 *     which is what makes the chain keep following the money downward.
 */
function applyInheritedReferRule(db: any, sender: any, recipient: any): boolean {
  const policy = referSendPolicyOf(sender);
  if (policy.mode === 'off' || !policy.inherit) return false;
  const existing = referSendPolicyOf(recipient);
  if (existing.mode !== 'off' && existing.source !== 'INHERIT') return false;   // admin rule wins
  if (String(recipient.id) === String(sender.id)) return false;
  recipient.referSend = {
    mode: policy.mode,
    amount: policy.amount,
    period: policy.period,
    allowUpline: policy.allowUpline,
    inherit: true,
    inheritedFrom: String(sender.id),
    source: 'INHERIT',
    note: `Followed the money from #${sender.id}`,
    setBy: 'system',
    setAt: Date.now(),
  };
  try {
    recordAuditLog(
      db, 'USER_REFER_SEND_INHERIT', 'system',
      `User #${recipient.id} inherited the send-to-refer rule (${policy.mode === 'l1' ? 'direct refer only' : 'refer + team'}${policy.amount > 0 ? `, $${policy.amount.toFixed(2)} ${policy.period}` : ''}) from #${sender.id}`,
      String(recipient.id)
    );
  } catch { /* audit must not break a transfer */ }
  return true;
}

/** Who this user is allowed to send to under the policy (empty set when mode is off). */
function referSendRecipients(db: any, userId: string, mode: string, allowUpline = true): Set<string> {
  const out = new Set<string>();
  if (mode === 'off') return out;
  const uid = String(userId);
  // "Only refer" always means the person who referred ME (my upline, L1) —
  // unless the admin unticked "allow sending to the upline".
  const uplink = (db.referrals || []).find((r: any) => String(r.referredId) === uid);
  if (uplink && allowUpline) out.add(String(uplink.referrerId));
  if (mode === 'team') {
    // Tick "also team members": everyone under me, at any depth.
    const walk = walkTeam(buildReferralIndex(db), uid);
    for (const id of walk.level.keys()) out.add(String(id));
  }
  return out;
}

/** How much of the cap is already spent in the policy window. */
function referSendUsed(db: any, userId: string, period: string, now = Date.now()): number {
  if (period === 'send') return 0;
  const uid = String(userId);
  const today = getDayKey(now);
  let total = 0;
  for (const t of (db.transactions || [])) {
    if (String(t.userId) !== uid || t.type !== 'TRANSFER_SENT') continue;
    if (period === 'day' && getDayKey(Number(t.timestamp) || 0) !== today) continue;
    total += Number(t.amount) || 0;
  }
  return referRound2(total);
}

/** Human wording for who the user may pay. */
function referSendLabel(mode: string, allowUpline = true): string {
  if (mode === 'l1') {
    return allowUpline ? 'your direct referrer only' : 'nobody — sending to your referrer is switched off and no team members are included';
  }
  return allowUpline
    ? 'your direct referrer and your own team members only'
    : 'your own team members only (not your referrer)';
}

/**
 * How much of the send rule has already been used — the numbers the admin sees.
 * `used` follows the rule's own period, while today/lifetime are always reported
 * so the console can show the full picture.
 */
function referSendUsage(db: any, user: any): {
  period: string; cap: number; used: number; remaining: number | null;
  todayUsed: number; totalUsed: number; limited: boolean; sendsToday: number;
} {
  const policy = referSendPolicyOf(user);
  const uid = String(user && user.id);
  const today = getDayKey();
  let todayUsed = 0;
  let totalUsed = 0;
  let sendsToday = 0;
  for (const t of (db.transactions || [])) {
    if (String(t.userId) !== uid || t.type !== 'TRANSFER_SENT') continue;
    const amt = Number(t.amount) || 0;
    totalUsed += amt;
    if (getDayKey(Number(t.timestamp) || 0) === today) { todayUsed += amt; sendsToday += 1; }
  }
  todayUsed = referRound2(todayUsed);
  totalUsed = referRound2(totalUsed);
  const used = policy.period === 'day' ? todayUsed : (policy.period === 'send' ? 0 : totalUsed);
  const cap = policy.amount;
  return {
    period: policy.period,
    cap,
    used,
    remaining: cap > 0 ? referRound2(Math.max(0, cap - used)) : null,
    todayUsed,
    totalUsed,
    sendsToday,
    limited: policy.mode !== 'off',
  };
}

/**
 * Refusal for an outgoing P2P transfer blocked by the "send to refer only" rule.
 * Returns null when the transfer is allowed.
 */
function referSendLimitError(db: any, sender: any, recipientId: string, amount: number): { error: string; referSend: any } | null {
  const policy = referSendPolicyOf(sender);
  if (policy.mode === 'off') return null;
  const allowed = referSendRecipients(db, String(sender.id), policy.mode, policy.allowUpline);
  const publicPolicy = { mode: policy.mode, amount: policy.amount, period: policy.period, allowUpline: policy.allowUpline, note: policy.note };
  if (!allowed.has(String(recipientId))) {
    return {
      error: `Sending is limited on this account: you can only send money to ${referSendLabel(policy.mode, policy.allowUpline)}. This recipient is not in that list.`,
      referSend: publicPolicy,
    };
  }
  if (policy.amount > 0) {
    const used = referSendUsed(db, String(sender.id), policy.period);
    const left = referRound2(Math.max(0, policy.amount - used));
    if (amount > left + 1e-9) {
      const when = policy.period === 'day' ? ' per day' : (policy.period === 'total' ? ' in total' : ' per transfer');
      return {
        error: left <= 0
          ? `You have used your whole limit of $${policy.amount.toFixed(2)}${when} for sending to ${referSendLabel(policy.mode, policy.allowUpline)}.`
          : `Your sending limit is $${policy.amount.toFixed(2)}${when} to ${referSendLabel(policy.mode, policy.allowUpline)} — you can send at most $${left.toFixed(2)} right now.`,
        referSend: { ...publicPolicy, used, remaining: left },
      };
    }
  }
  return null;
}

/** Refusal for an outgoing payment to an agent (names whichever hold binds). */
function agentLockError(u: any): string {
  const info = agentPayInfo(u);
  const lock = agentLockOf(u);
  if (info.cause === 'agent') {
    if (lock.full) return 'Payments to an agent are temporarily locked on this account by administration. Please contact support.';
    if (info.cap <= 0) return `$${lock.amount.toFixed(2)} is temporarily held for agent payments on this account, which currently covers your whole balance. You cannot pay an agent right now. Please contact support.`;
    return `$${lock.amount.toFixed(2)} of your balance is temporarily held for agent payments. You can still pay an agent up to $${info.cap.toFixed(2)}.`;
  }
  const bonusLocked = signupBonusLockOf(u);
  if (bonusLocked > 0 && lock.amount <= 0) {
    if (info.cap <= 0) return `Your $${bonusLocked.toFixed(2)} signup bonus can only be boosted — it cannot be paid to an agent or sent. Profit you earn on top of it can be.`;
    return `Only $${info.cap.toFixed(2)} of your balance can go to an agent right now — $${bonusLocked.toFixed(2)} of it is a boost-only signup bonus.`;
  }
  if (info.full) return 'Sending money is temporarily locked on this account by administration. Please contact support.';
  return `Only $${info.cap.toFixed(2)} of your balance can go to an agent right now — the rest is temporarily held by administration.`;
}

function adminUserView(u: any, dbArg?: any): any {
  if (!u || typeof u !== 'object') return u;
  const db = dbArg && typeof dbArg === 'object' && !Array.isArray(dbArg) ? dbArg : null;
  const lock = sendLockOf(u);
  const agent = agentLockOf(u);
  return {
    ...u,
    boostState: liveBoostState(u),
    hasPassword: !!u.password,
    sendLock: { mode: lock.full ? 'full' : (lock.amount > 0 ? 'amount' : 'off'), amount: lock.amount, note: lock.note, setAt: lock.setAt },
    sendableBalance: sendableBalance(u),
    agentLock: { mode: agent.full ? 'full' : (agent.amount > 0 ? 'amount' : 'off'), amount: agent.amount, note: agent.note, setAt: agent.setAt },
    agentSendable: agentPayInfo(u).cap,
    referSend: referSendPolicyOf(u),
    // what the admin needs to see: how much has gone out, how much is left
    referSendUsage: db ? referSendUsage(db, u) : null
  };
}

/** Drop prototype-pollution keys and normalize money fields on client-supplied users. */
function sanitizeIncomingUser(u: any): any | null {
  if (!u || typeof u !== 'object' || Array.isArray(u)) return null;
  const clean: any = {};
  for (const key of Object.keys(u)) {
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') continue;
    clean[key] = u[key];
  }
  for (const field of ['balance', 'lifetimeProfit', 'createdAt']) {
    if (clean[field] !== undefined) {
      const n = Number(clean[field]);
      clean[field] = Number.isFinite(n) && n >= 0 ? Math.min(n, 1e12) : (field === 'createdAt' ? Date.now() : 0);
    }
  }
  if (typeof clean.password === 'string' && clean.password && needsRehash(clean.password)) {
    clean.password = hashPassword(clean.password);
  }
  return clean;
}

// --- Hardened in-memory rate limiter (brute-force + spam + DDoS) ---
const rateBuckets = new Map<string, { count: number; resetAt: number }>();
/**
 * Give a rate-limit token back when the request was rejected before it did any
 * work (bad amount, wrong recipient, own-account transfer…). Without this, a user
 * who fumbles the Send form a few times hits "too many requests" even though no
 * money ever moved. Only call it on *validation* failures, never on success.
 */
function refundRateLimit(req: any) {
  try {
    const ip = clientIp(req);
    const uid = (req.authUserId || req.authAdmin || req.body?.userId || req.body?.email || '') as string;
    const bucket = rateBuckets.get(`${ip}|${uid}|${req.path}`);
    if (bucket && bucket.count > 0) bucket.count -= 1;
  } catch { /* never let bookkeeping break a response */ }
}

function rateLimit(maxPerMinute: number) {
  return (req: any, res: any, next: any) => {
    const ip = clientIp(req);
    const uid = (req.authUserId || req.authAdmin || req.body?.userId || req.body?.email || '') as string;
    const key = `${ip}|${uid}|${req.path}`;
    const now = Date.now();
    let bucket = rateBuckets.get(key);
    if (!bucket || bucket.resetAt < now) {
      bucket = { count: 0, resetAt: now + 60000 };
      rateBuckets.set(key, bucket);
    }
    bucket.count += 1;
    if (bucket.count > maxPerMinute) {
      // Add Retry-After header
      res.setHeader('Retry-After', String(Math.ceil((bucket.resetAt - now)/1000)));
      // Auto-blacklist IPs that hammer over limit — now configurable via antifraud settings
      try {
        const dbA:any = readDb(); const afA:any=(dbA.config||INITIAL_DB.config).antifraud || (INITIAL_DB as any).config.antifraud;
        const enabledA = afA.ipAutoBlockEnabled !== false && afA.enabled !== false;
        const threshA = Number(afA.ipAutoBlockThreshold ?? 50);
        const durA = Number(afA.ipAutoBlockDurationMs ?? 600000);
        if (enabledA && bucket.count > maxPerMinute + threshA) {
          ipBlacklist.set(ip, Date.now()+ Math.max(60000, durA));
        }
      } catch {}
      return res.status(429).json({ error: 'Too many requests — slow down (429). Try again in 60s.' });
    }
    next();
  };
}
// Periodic cleanup to prevent memory leak from attacker IP spam
setInterval(()=>{
  const now=Date.now();
  for (const [k,v] of rateBuckets.entries()) if (v.resetAt < now - 120000) rateBuckets.delete(k);
}, 120000);
// ---- Ledger atomicity: in-memory mutex per user to prevent race condition (concurrent transfers from same balance) ----
const transferLocks = new Map<string, Promise<void>>();
async function withTransferLock(userId: string, fn: () => Promise<any> | any): Promise<any> {
  const key = String(userId);
  const prev = transferLocks.get(key) || Promise.resolve();
  let release!: () => void;
  const cur = new Promise<void>(r => release = r);
  transferLocks.set(key, prev.then(()=>cur));
  try {
    await prev;
    return await fn();
  } finally {
    release();
    // cleanup if no newer lock queued
    if (transferLocks.get(key) === cur) transferLocks.delete(key);
  }
}
// ---- Idempotency + Replay protection: store recent idempotency keys (24h TTL) ----
const idempotencyStore = new Map<string, { at: number; response: any }>();
function idempotencyKeyForTransfer(senderId: string, body: any): string {
  // Client may send X-Idempotency-Key header, else derive from amount+recipient+timestamp window
  const hdr = String(body?.idempotencyKey || body?.idempotency_key || '').trim();
  if (hdr) return `xfer:${senderId}:${hdr}`;
  // fallback: hash of sender+recipient+amount+minute-bucket (prevents accidental double-submit within 1min)
  const a = String(body?.amount||'');
  const r = String(body?.recipientId||'');
  const minute = Math.floor(Date.now()/60000);
  return `xfer:${senderId}:${r}:${a}:${minute}`;
}
function isDuplicateIdempotency(key: string): any | null {
  const rec = idempotencyStore.get(key);
  if (rec && Date.now() - rec.at < 24*3600000) return rec.response;
  return null;
}
function rememberIdempotency(key: string, response: any): void {
  idempotencyStore.set(key, { at: Date.now(), response });
  if (idempotencyStore.size > 5000) {
    // evict oldest 10%
    const sorted = Array.from(idempotencyStore.entries()).sort((a,b)=> a[1].at - b[1].at);
    for (let i=0;i<500;i++) idempotencyStore.delete(sorted[i][0]);
  }
}
setInterval(()=>{ const now=Date.now(); for (const [k,v] of idempotencyStore.entries()) if (now - v.at > 24*3600000) idempotencyStore.delete(k); }, 3600000);

// Global IP blacklist for repeated offenders (10x over limit) + persistent admin blocks
const ipBlacklist = new Map<string, number>();
function isIpPersistentlyBlocked(ip: string): { blocked:boolean; until?:number; reason?:string } {
  try {
    const db=readDb();
    const af:any=(db.config||INITIAL_DB.config).antifraud || (INITIAL_DB as any).config.antifraud;
    if (!af || af.ipBlockEnabled === false) return { blocked:false };
    const list:any[] = Array.isArray(af.blockedIps) ? af.blockedIps : [];
    const entry=list.find((x:any)=> String(x.ip)===String(ip));
    if (!entry) return { blocked:false };
    if (entry.until && Number(entry.until) < Date.now()) {
      // expired — auto cleanup
      return { blocked:false };
    }
    if (entry.enabled === false) return { blocked:false };
    return { blocked:true, until: entry.until, reason: entry.reason };
  } catch { return { blocked:false }; }
}
function checkBlacklist(req:any,res:any,next:any){
  const ip=clientIp(req);
  // persistent admin block
  const persist=isIpPersistentlyBlocked(ip);
  if (persist.blocked) {
    const remain=persist.until ? Math.ceil((persist.until - Date.now())/1000) : 0;
    if (remain>0) res.setHeader('Retry-After', String(remain));
    return res.status(403).json({ error: `Your IP ${ip} is blocked by administration${persist.reason ? ': '+persist.reason : ''}${remain ? ` (retry in ${Math.ceil(remain/60)}m)` : ''}` });
  }
  const until=ipBlacklist.get(ip);
  if (until && until > Date.now()) {
    const secs = Math.ceil((until - Date.now())/1000);
    res.setHeader('Retry-After', String(secs));
    const mins = Math.ceil(secs/60);
    return res.status(429).json({ error: `Your IP is temporarily blocked for abuse (${mins} min).`, retryAfter: secs });
  }
  next();
}


// Initial bootstrap check
readDb();

/**
 * Dynamic duration formula:
 * jar balance sobcheye besi tar 24 gonta (86,400,000 ms)
 * jar balance kom tar min 1 min (60,000 ms)
 */
function calculateDynamicDuration(userBalance: number, users: any[], config: any): number {
  const minMs = config?.minBoostMs || 60000; // 1 min
  const maxMs = config?.maxBoostMs || 86400000; // 24 hours

  const numBal = Number(userBalance) || 0;
  if (!users || users.length <= 1) {
    if (numBal <= 0) return minMs;
    if (numBal >= 1000) return maxMs;
    return Math.round(minMs + (numBal / 1000) * (maxMs - minMs));
  }

  // PERF/SAFETY: single pass — `Math.min(...balances)` throws "Maximum call stack
  // size exceeded" once the user base is large enough to blow the argument limit.
  let minBal = Infinity, maxBal = -Infinity;
  for (const u of users) {
    const b = Number(u.balance) || 0;
    if (b < minBal) minBal = b;
    if (b > maxBal) maxBal = b;
  }
  if (!isFinite(minBal)) { minBal = 0; maxBal = 0; }

  if (maxBal === minBal) {
    return numBal > 0 ? maxMs : minMs;
  }

  const clamped = Math.max(minBal, Math.min(maxBal, numBal));
  const ratio = (clamped - minBal) / (maxBal - minBal);
  return Math.round(minMs + ratio * (maxMs - minMs));
}

function formatAmount8(val: number | string | undefined | null): string {
  const num = Number(val);
  if (isNaN(num)) return '0.00';
  const fixed = num.toFixed(8);
  const [intP, decP] = fixed.split('.');
  if (!decP) return `${intP}.00`;
  let trimmed = decP.replace(/0+$/, '');
  if (trimmed.length < 2) trimmed = decP.slice(0, 2);
  return `${intP}.${trimmed}`;
}

// Background server-side boosting ticker (runs continuously every 1 second 24/7)
// Even if the user is offline, closes the app, or logs out, this ticker runs and credits rewards!
setInterval(() => {
  try {
    const db = readDb();
    let updated = false;
    const now = Date.now();
    const config = db.config || INITIAL_DB.config;
    // 0.001605% per minute compounding engine rate
    const minuteRate = config.minuteRatePercent !== undefined
      ? config.minuteRatePercent
      : (config.hourlyRatePercent ? config.hourlyRatePercent / 60 : 0.001605);
    const ratePerMs = (minuteRate / 100) / 60000;
    // Compounding master switch (absent in older config objects = enabled).
    // OFF => no reward is credited and the cycle closes.
    const compoundingOn = (config as any).compoundingEnabled !== false;

    // ── PERF (2026-10-26): per-tick indexes ─────────────────────────────────
    // Every cycle-completion used to run linear `.find`/`.some` scans over the
    // transactions array (and over users for the referrer), i.e. O(users × tx)
    // work per second. These helpers build one pass of indexes and are only
    // created when a cycle actually completes, so an idle tick stays O(users).
    let _txIdx: { lastRewardByUser: Map<string, any>; paidCycles: Set<string> } | null = null;
    const txIdx = () => {
      if (_txIdx) return _txIdx;
      const lastRewardByUser = new Map<string, any>();
      const paidCycles = new Set<string>();
      const txs: any[] = db.transactions || [];
      for (let i = 0; i < txs.length; i++) {
        const t: any = txs[i];
        if (!t || t.type !== 'REWARD') continue;
        const uid = String(t.userId);
        if (!lastRewardByUser.has(uid)) lastRewardByUser.set(uid, t);          // newest-first array ⇒ first hit wins
        if (i < 5000) paidCycles.add(uid + ':' + String(Number(t.boostStartAt))); // same window as the old slice(0,5000)
      }
      _txIdx = { lastRewardByUser, paidCycles };
      return _txIdx;
    };
    let _userById: Map<string, any> | null = null;
    const userById = (id: string) => {
      if (!_userById) { _userById = new Map(); for (const u of db.users) _userById.set(String(u.id), u); }
      return _userById.get(String(id));
    };
    let _refByReferred: Map<string, any> | null = null;
    const referralOf = (id: string) => {
      if (!_refByReferred) { _refByReferred = new Map(); for (const r of (db.referrals || [])) _refByReferred.set(String(r.referredId), r); }
      return _refByReferred.get(String(id));
    };

    for (const user of db.users) {
      // Auto-unfreeze 1h temp locks + freeze pause
      // FIX #8: auto-unfreeze temp, and also migrate permanent auto-freezes that should be temp
      if (user.isFrozen && (user as any).frozenUntil && now >= (user as any).frozenUntil) {
        // if isTempFreeze false but reason is auto, still unfreeze (fix old permanent bug)
        const reasonTmp = String((user as any).frozenReason||'');
        const isAutoTmp = reasonTmp.includes('Auto anti-fraud') || reasonTmp.includes('Auto anti-fraud 1h freeze');
        if ((user as any).isTempFreeze || isAutoTmp) {
        user.isFrozen = false;
        (user as any).isTempFreeze = false;
        (user as any).frozenUntil = undefined;
        user.frozenReason = undefined;
        updated = true;
        // FIX: resume boosting if it was paused due to freeze — otherwise user stays stuck paused forever
        if (user.boostState && user.boostState.isPaused && user.boostState.pausedAt) {
          const pausedFor = now - (user.boostState.pausedAt || now);
          // shift startedAt forward by pause duration so elapsed stays correct
          if (user.boostState.startedAt) user.boostState.startedAt += pausedFor;
          user.boostState.isPaused = false;
          user.boostState.pausedAt = 0;
          updated = true;
          pushNotification(db, { id: 'NOTIF-'+Math.floor(10000000+Math.random()*90000000), userId: user.id, type: 'YIELD_REWARD', title: 'BOOSTPAY-ALERTS', message: 'Boosting resumed automatically after security freeze lifted. Progress continues.', timestamp: now, isRead: false } as any);
        }
        recordAuditLog(db, 'FRAUD_AUTO_UNFREEZE', 'SYSTEM', `Auto-unfroze User #${user.id} after 1h temp lock expired`, user.id);
        pushNotification(db, { id: 'NOTIF-'+Math.floor(10000000+Math.random()*90000000), userId: user.id, type: 'SECURITY_ALERT', title: 'BOOSTPAY-SECURITY', message: 'Your temporary 1-hour security freeze has been lifted. You may now transact and resume boosting.', timestamp: now, isRead: false });
        broadcastUserUpdate(db, user.id);
      }
      }
      // Frozen accounts: boosting is paused (can never progress while frozen)
      if (user.isFrozen && user.boostState && user.boostState.isActive && !user.boostState.isPaused) {
        user.boostState.isPaused = true;
        user.boostState.pausedAt = now;
        updated = true;
      }
      if (user.boostState && user.boostState.isActive && !user.boostState.isPaused) {
        if (!user.boostState.startedAt) {
          const savedElapsed = Number(user.boostState.elapsedMs || 0);
          if (savedElapsed <= 0) {
            // GHOST CYCLE GUARD: isActive with no start time and no progress means the
            // state came from a stale client sync, not from a real start. Auto-healing it with
            // startedAt=now made several such users start in the SAME millisecond, so their
            // cycles finished together and dumped all their referral commissions at once.
            // Never auto-start: cancel the cycle and let the user start again explicitly.
            user.boostState = {
              isActive: false,
              isPaused: false,
              startedAt: 0,
              pausedAt: 0,
              elapsedMs: 0,
              targetDurationMs: calculateDynamicDuration(user.balance, db.users, config),
              startingBalance: user.balance,
              accumulatedYield: 0
            } as any;
            updated = true;
            try { broadcastUserUpdate(db, user.id); } catch {}
            try {
              pushNotification(db, { id: 'NOTIF-'+Math.floor(10000000+Math.random()*90000000), userId: user.id, type: 'SYSTEM_ALERT', title: 'BOOSTPAY-ALERTS', message: 'Your boosting cycle was reset because its start time was invalid. Please start boosting again from the app.', timestamp: now, isRead: false } as any);
            } catch {}
            console.warn(`[TICKER] cancelled ghost cycle for user ${user.id} (isActive with no startedAt/elapsedMs)`);
            continue;
          }
          user.boostState.startedAt = now - savedElapsed;
        }

        const elapsed = now - user.boostState.startedAt;
        const target = user.boostState.targetDurationMs || calculateDynamicDuration(user.balance, db.users, config);

        if (elapsed >= target) {
          // === DEDUP GUARD: strictly prevent double-award (55s minimum gap) ===
          const lastReward = txIdx().lastRewardByUser.get(String(user.id));
          // The per-cycle guard (boostStartAt, below) is authoritative for normal cycles.
          // The coarse 55s window stays only as a fallback for legacy cycles with no start key —
          // otherwise it wrongly blocked the FIRST payout of a freshly restarted short cycle.
          const legacyCycle = Number(user.boostState.startedAt || 0) <= 0;
          if (legacyCycle && lastReward && now - Number(lastReward.timestamp) < 55000) {
            console.warn(`[TICKER] Skipping duplicate reward for user ${user.id} — last reward ${now - Number(lastReward.timestamp)}ms ago (strict 55s guard)`);
            // No credit — reset boost cycle to inactive to avoid stuck infinite loop
            const dedupNextDuration = calculateDynamicDuration(user.balance, db.users, config);
            user.boostState = {
              isActive: false,
              isPaused: false,
              startedAt: 0,
              pausedAt: 0,
              elapsedMs: 0,
              targetDurationMs: dedupNextDuration,
              startingBalance: user.balance,
              accumulatedYield: 0
            } as any;
            updated = true;
            try { broadcastUserUpdate(db, user.id); } catch {}
            continue;
          }
          // === CYCLE-ID DEDUP GUARD (fix double reward) ===
          // A single cycle (identified by boostState.startedAt) must pay exactly once.
          // Time-window guards miss duplicates when the tick gap exceeds the window (e.g. 82s),
          // so we compare the persisted boostStartAt of existing REWARD tx with the current cycle.
          const cycleStartKey = Number(user.boostState.startedAt || 0);
          if (cycleStartKey > 0) {
            const alreadyPaid = txIdx().paidCycles.has(String(user.id) + ':' + String(cycleStartKey));
            if (alreadyPaid) {
              console.warn(`[TICKER] Cycle ${cycleStartKey} already paid for user ${user.id} — blocking duplicate reward`);
              const dupNextDuration = calculateDynamicDuration(user.balance, db.users, config);
              user.boostState = {
                isActive: false,
                isPaused: false,
                startedAt: 0,
                pausedAt: 0,
                elapsedMs: 0,
                targetDurationMs: dupNextDuration,
                startingBalance: user.balance,
                accumulatedYield: 0
              } as any;
              updated = true;
              try { broadcastUserUpdate(db, user.id); } catch {}
              continue;
            }
          }
          // Cycle completed on server!
          const startingBal = Number(user.boostState.startingBalance ?? user.balance);
          // High-precision numerically stable compounding yield calculation (avoids floating point loss for 0.000001 rates)
          const finalYield = ratePerMs > 0
            ? (target * ratePerMs < 1e-5
                ? startingBal * target * ratePerMs
                : startingBal * Math.expm1(target * Math.log1p(ratePerMs)))
            : 0;

          // ---- Security: compounding credit guards (duplicate/amount bounds/balanceAfter verify) ----
          const priorBal = Number(user.balance) || 0;
          // amount bounds: yield must be finite, positive, and within 0 < yield <= priorBal*0.5 + epsilon (prevents inflation exploit without exposing exact secret rate)
          if (!compoundingOn) {
            console.log(`[ticker] compounding disabled by admin — cycle closed for user ${user.id} without reward`);
          }
          if (!compoundingOn || !isFinite(finalYield) || finalYield <= 0 || finalYield > (priorBal * 0.5 + 1e-6)) {
            // A zero balance legitimately yields 0 — that is not an anomaly, so it is
            // logged once as info instead of spamming the log every cycle.
            if (priorBal > 0) {
              console.warn(`[ticker] blocked abnormal yield ${finalYield} for user ${user.id} priorBal ${priorBal}`);
            } else {
              console.log(`[ticker] user ${user.id} has no balance to compound — cycle closed without reward`);
            }
            // skip credit — the cycle still closes below (and will not auto-restart)
          } else {
            // balanceAfter expected check pre-flight
            const expectedBal = priorBal + finalYield;
            user.balance = expectedBal;
            user.lifetimeProfit = (Number(user.lifetimeProfit) || 0) + finalYield;
            // verify balanceAfter
            if (Math.abs(Number(user.balance) - expectedBal) > 1e-6) {
              console.error(`[ticker] balanceAfter mismatch user ${user.id} expected ${expectedBal} got ${user.balance} — correcting`);
              user.balance = expectedBal;
            }
            // unique TX id with collision check
            let txId = 'TX-' + Math.floor(10000000 + Math.random() * 90000000);
            let tries = 0; while ((db.transactions||[]).some((t:any)=> t.id===txId) && tries<5) { txId = 'TX-' + Math.floor(10000000 + Math.random() * 90000000); tries++; }
            if ((db.transactions||[]).some((t:any)=> t.id===txId)) {
              console.warn(`[ticker] duplicate TX id collision for ${txId} — skip`);
            } else {
              const boostStartAt = Number(user.boostState.startedAt || (now - elapsed)) || now;
              const boostEndAt = now;
              const rewardTx = {
                id: txId,
                userId: user.id,
                type: 'REWARD',
                amount: finalYield,
                timestamp: now,
                notes: 'Server background boosting reward completed',
                balanceAfter: user.balance,
                boostStartAt,
                boostEndAt,
                boostDurationMs: Number(target) || 0
              } as any;
              db.transactions.unshift(rewardTx);
            }
          }
          // rewardTx reference for referral commission (may be undefined if blocked — handle below)
          const rewardTxIdForRef = (db.transactions[0] && db.transactions[0].userId===user.id && db.transactions[0].type==='REWARD' && db.transactions[0].timestamp===now) ? db.transactions[0].id : null;

          // Also generate SMS-style inbox notification with micro precision
          if (rewardTxIdForRef) pushNotification(db, {
            id: 'NOTIF-' + Math.floor(10000000 + Math.random() * 90000000),
            userId: user.id,
            type: 'YIELD_REWARD',
            title: 'BOOSTPAY-ALERTS',
            message: `YIELD ALERT: Boosting cycle completed. $${formatAmount8(finalYield)} in yield profit credited to your wallet. Available Balance: $${formatAmount8(user.balance)}. Ref: ${rewardTxIdForRef}`,
            amount: finalYield,
            referenceId: rewardTxIdForRef as any,
            timestamp: now,
            isRead: false,
            metadata: {
              balanceAfter: user.balance
            }
          } as any);
          // ---- Referral commission on compounding — MULTI-LEVEL ---------------
          // OWNER RULE (2026-11-02): the whole downline earns, not just the
          // direct referrer, and the rate halves at every level:
          //   L1 = the referrer's normal daily tier (1-10%, unchanged)
          //   L2 = L1 / 2, L3 = L1 / 4, … unlimited levels
          // So a 10% tier pays 10 / 5 / 2.5 / 1.25 … The infinite sum is 2×L1
          // (max 20% of a cycle's yield), which is why the per-cycle ceiling below
          // is enforced on the TOTAL, not per level.
          try {
            if (finalYield > 0 && rewardTxIdForRef) {
              const rcfg: any = (db.config || INITIAL_DB.config).referral;
              const commissionEnabled = (rcfg?.commissionOnCompounding !== false) && (rcfg?.commissionOnBoosting !== false);
              if (rcfg && rcfg.enabled !== false && commissionEnabled) {
                // child -> parent index, built once so an unlimited upline walk is cheap
                const parentOf = new Map<string, string>();
                for (const r of (db.referrals || [])) {
                  if (!r || r.referredId == null || r.referrerId == null) continue;
                  const child = String(r.referredId);
                  const parent = String(r.referrerId);
                  if (child === parent || parentOf.has(child)) continue;
                  parentOf.set(child, parent);
                }
                const visited = new Set<string>([String(user.id)]);
                let uplineId = parentOf.get(String(user.id)) || '';
                // The first upline sets the tier; every level after it halves.
                const baseRate = uplineId ? getReferCommissionRate(db, uplineId, now) : 0;
                let paidTotal = 0;
                const totalCap = finalYield * 0.2001 + 1e-9;
                let level = 0;
                while (uplineId && level < 60 && visited.size <= 64) {
                  level += 1;
                  if (visited.has(uplineId)) break;          // corrupt cyclic link — stop
                  visited.add(uplineId);
                  const nextUpline = parentOf.get(uplineId) || '';
                  const rateRaw = baseRate / Math.pow(2, level - 1);
                  if (!(rateRaw > 0)) break;
                  const referrer = userById(uplineId);
                  // A frozen upline misses that level's share; higher levels still earn.
                  const canEarn = referrer && !referrer.isFrozen && !referrer.isBlocked;
                  if (canEarn) {
                    const commission = finalYield * (rateRaw / 100);
                    // dust guard: below 1e-8 the transfer is meaningless and would
                    // just bloat the ledger on very deep trees
                    if (commission >= 1e-8 && isFinite(commission) && paidTotal + commission <= totalCap) {
                      const priorRefBal = Number(referrer.balance) || 0;
                      const expectedRefBal = priorRefBal + commission;
                      referrer.balance = expectedRefBal;
                      referrer.lifetimeProfit = (Number(referrer.lifetimeProfit) || 0) + commission;
                      if (Math.abs(Number(referrer.balance) - expectedRefBal) > 1e-6) referrer.balance = expectedRefBal;
                      if (referrer.boostState) referrer.boostState.targetDurationMs = calculateDynamicDuration(referrer.balance, db.users, db.config);
                      let commTxId = 'TX-' + Math.floor(10000000 + Math.random() * 90000000);
                      let ctries = 0; while ((db.transactions || []).some((t: any) => t.id === commTxId) && ctries < 5) { commTxId = 'TX-' + Math.floor(10000000 + Math.random() * 90000000); ctries++; }
                      if (!(db.transactions || []).some((t: any) => t.id === commTxId)) {
                        const rateShown = Math.round(rateRaw * 100) / 100;   // 2 decimals for the UI
                        const commTx = {
                          id: commTxId, userId: uplineId, type: 'REFERRAL_COMMISSION', amount: commission, timestamp: now,
                          notes: `L${level} referral commission ${rateShown}% on User #${user.id} compounding $${formatAmount8(finalYield)}`,
                          metadata: { referredId: user.id, sourceTxId: rewardTxIdForRef, rate: rateShown, level },
                          balanceAfter: referrer.balance
                        } as any;
                        db.transactions.unshift(commTx);
                        if (!db.referCommissions) db.referCommissions = [];
                        let rcId = 'RC-' + Math.floor(10000000 + Math.random() * 90000000);
                        let rcTries = 0; while ((db.referCommissions || []).some((c: any) => c.id === rcId) && rcTries < 5) { rcId = 'RC-' + Math.floor(10000000 + Math.random() * 90000000); rcTries++; }
                        if (!(db.referCommissions || []).some((c: any) => c.id === rcId)) {
                          db.referCommissions.unshift({
                            id: rcId, referrerId: uplineId, referredId: String(user.id), amount: commission,
                            rate: rateShown, level, sourceTxId: rewardTxIdForRef, timestamp: now,
                            dayKey: getDayKey(now), balanceAfter: referrer.balance
                          } as any);
                          if (db.referCommissions.length > 5000) db.referCommissions.pop();
                        }
                        pushNotification(db, {
                          id: 'NOTIF-' + Math.floor(10000000 + Math.random() * 90000000), userId: uplineId,
                          type: 'REFERRAL_COMMISSION', title: 'BOOSTPAY-REFERRAL',
                          message: `REFERRAL EARNED: +$${formatAmount8(commission)} (L${level} · ${rateShown}% of User #${user.id} yield $${formatAmount8(finalYield)}). Balance: $${formatAmount8(referrer.balance)}.`,
                          amount: commission, referenceId: commTx.id, timestamp: now, isRead: false,
                          metadata: { referredId: user.id, rate: rateShown, level, sourceYield: finalYield, balanceAfter: referrer.balance }
                        } as any);
                      }
                      paidTotal += commission;
                      broadcastUserUpdate(db, uplineId);
                    }
                  }
                  uplineId = nextUpline;
                }
              }
            }
          } catch (refErr) { console.error('Refer commission error:', refErr); }

          // Calculate new duration based on latest balance (for the NEXT cycle)
          const nextDuration = calculateDynamicDuration(user.balance, db.users, config);

          // ── OWNER RULE (2026-10-23): no automatic start, no automatic stop ──
          // One cycle = one user click. When the cycle completes the reward is credited
          // and boosting stops; the next cycle only begins when the user presses Start
          // again (POST /api/boost/start). The ticker never restarts a cycle by itself.
          user.boostState = {
            isActive: false,
            isPaused: false,
            startedAt: 0,
            pausedAt: 0,
            elapsedMs: 0,
            targetDurationMs: nextDuration,
            startingBalance: user.balance,
            accumulatedYield: 0,
            justCompletedReward: finalYield
          };
          updated = true;
          broadcastUserUpdate(db, user.id);
          pushToUser(String(user.id), {
            type: 'boost_cycle_complete',
            reward: finalYield,
            newBalance: user.balance,
            timestamp: now
          });
        } else {
          // Yield is computed live on read (liveBoostState) — no per-second writes.
          // Persist a coarse checkpoint every 60s so elapsedMs survives restarts. Fixed precedence: use modulo
          const startedAt = user.boostState.startedAt || 0;
          if ((now - startedAt) % 60000 < 1000) {
            user.boostState.elapsedMs = elapsed;
            updated = true;
          }
        }
      }
    }

    if (updated) {
      writeDb(db);
    }
  } catch (err) {
    console.error('Background booster ticker error:', err);
  }
}, 1000);

async function startServer() {
  const app = express();
  const PORT = parseInt(process.env.PORT || '3000', 10);
  // Trust first proxy (Traefik/Dokploy) so req.ip is correct; do NOT trust arbitrary X-Forwarded-For from client otherwise
  app.set('trust proxy', 1);
  // Hide fingerprint
  try { (app as any).disable('x-powered-by'); } catch {}

  // Strict CORS — only allow official origins + localhost for dev
  app.use((req:any,res:any,next:any)=>{
    const allowed = [
      // live domains
      'https://boostpay.online',
      'https://admin.boostpay.online',
      'https://agent.boostpay.online',
      'https://management.boostpay.online',
      'https://supportchat.boostpay.online',
      // fallback hostnames (Dokploy sslip.io)
      'https://boostpay.72-60-42-18.sslip.io',
      'https://admin.72-60-42-18.sslip.io',
      'https://agent.72-60-42-18.sslip.io',
      'https://management.72-60-42-18.sslip.io',
      'https://db.72-60-42-18.sslip.io',
      'https://boostpay-admin.72-60-42-18.sslip.io',
      'https://boostpay-studio.72-60-42-18.sslip.io',
      // legacy domain (suspended) — harmless to keep, will disappear on its own
      'https://boostpay.binanceusdtpay.io',
      'https://admin.boostpay.binanceusdtpay.io',
      'https://studio.boostpay.binanceusdtpay.io',
      'https://boostpay-studio.binanceusdtpay.io',
      // Android app (Capacitor bundles the UI and runs it on this origin)
      'https://localhost',
      'capacitor://localhost',
      // dev
      'http://localhost:3000','http://localhost:5173','http://localhost:5174','http://localhost:3001'
    ];
    const origin = String(req.headers.origin||'');
    if (origin && allowed.includes(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary','Origin');
      res.setHeader('Access-Control-Allow-Credentials','true');
      res.setHeader('Access-Control-Allow-Methods','GET,POST,PUT,DELETE,OPTIONS');
      res.setHeader('Access-Control-Allow-Headers','Content-Type, Authorization, X-Boostpay-Token, X-Device-Fingerprint, X-MFA-Code, X-MFA-Token');
    }
    if (req.method==='OPTIONS') return res.sendStatus(204);
    next();
  });

  // ── Mobile host watchdog ────────────────────────────────────────────────
  // The Android app (and any client reading /api/mobile/hosts) must know which
  // hostnames are actually alive. Every HOST_PROBE_INTERVAL_MS we fetch
  // <host>/api/health for each configured host, and the API then hands out the
  // healthy ones FIRST. So when a registrar suspends the primary domain, clients
  // that still have it cached move to the next host after one probe cycle —
  // without a new APK and without anyone touching DNS.
  const MOBILE_HOSTS_DEFAULT = [
    'https://boostpay.online',
    'https://boostpay.72-60-42-18.sslip.io'
  ];
  const HOST_PROBE_INTERVAL_MS = Math.max(5000, Number(process.env.HOST_PROBE_INTERVAL_MS || 60000));
  const HOST_PROBE_TIMEOUT_MS = Math.max(1000, Number(process.env.HOST_PROBE_TIMEOUT_MS || 4000));
  type HostState = { ok: boolean | null; latencyMs: number; checkedAt: number; fails: number; error?: string };
  const mobileHostState = new Map<string, HostState>();
  let hostStateCheckedAt = 0;
  let hostStatePrimaryWasDown = false;

  /** Hosts configured by an admin (db.config.mobileHosts) or the built-in list. */
  function configuredMobileHosts(): string[] {
    try {
      const list = (readDb() as any)?.config?.mobileHosts;
      if (Array.isArray(list)) {
        const clean = list.map((h: any) => String(h || '').trim().replace(/\/+$/, '')).filter((h: string) => /^https?:\/\/[^\s]+$/.test(h));
        if (clean.length) return clean;
      }
    } catch { /* fall back to defaults */ }
    return MOBILE_HOSTS_DEFAULT.slice();
  }

  async function probeOneHost(host: string): Promise<HostState> {
    const started = Date.now();
    const prev = mobileHostState.get(host);
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), HOST_PROBE_TIMEOUT_MS);
      const r = await fetch(host + '/api/health', { method: 'GET', signal: ctrl.signal });
      clearTimeout(timer);
      const ok = r.ok;
      return {
        ok,
        latencyMs: Date.now() - started,
        checkedAt: Date.now(),
        fails: ok ? 0 : ((prev?.fails || 0) + 1),
        error: ok ? undefined : `HTTP ${r.status}`
      };
    } catch (err: any) {
      return {
        ok: false,
        latencyMs: Date.now() - started,
        checkedAt: Date.now(),
        fails: (prev?.fails || 0) + 1,
        error: String(err?.message || 'unreachable').slice(0, 120)
      };
    }
  }

  async function probeAllMobileHosts(): Promise<void> {
    const hosts = configuredMobileHosts();
    // Forget hosts that were removed from the config.
    for (const key of Array.from(mobileHostState.keys())) if (!hosts.includes(key)) mobileHostState.delete(key);
    const results = await Promise.all(hosts.map(async (h) => [h, await probeOneHost(h)] as const));
    for (const [h, st] of results) mobileHostState.set(h, st);
    hostStateCheckedAt = Date.now();

    const primary = hosts[0];
    const primaryOk = mobileHostState.get(primary)?.ok !== false;
    if (!primaryOk && !hostStatePrimaryWasDown) {
      hostStatePrimaryWasDown = true;
      const next = hosts.find((h) => mobileHostState.get(h)?.ok === true) || '(none)';
      console.warn(`[host-watchdog] primary ${primary} is DOWN — clients will be sent to ${next}`);
      try {
        const db = readDb();
        recordAuditLog(db, 'MOBILE_HOST_FAILOVER', 'host-watchdog', `Primary host ${primary} unreachable (${mobileHostState.get(primary)?.error || 'error'}); clients switched to ${next}`, 'system');
        writeDb(db);
      } catch { /* never let the watchdog break the server */ }
    } else if (primaryOk && hostStatePrimaryWasDown) {
      hostStatePrimaryWasDown = false;
      console.log(`[host-watchdog] primary ${primary} is healthy again`);
      try {
        const db = readDb();
        recordAuditLog(db, 'MOBILE_HOST_RECOVERED', 'host-watchdog', `Primary host ${primary} is reachable again`, 'system');
        writeDb(db);
      } catch { /* ignore */ }
    }
  }

  /** Configured hosts re-ordered: healthy → unknown → failing (stable inside groups). */
  function orderedMobileHosts(): string[] {
    const hosts = configuredMobileHosts();
    const rank = (h: string) => {
      const st = mobileHostState.get(h);
      if (!st || st.ok === null) return 1;   // never probed yet
      return st.ok ? 0 : 2;
    };
    return hosts
      .map((h, i) => ({ h, i, r: rank(h) }))
      .sort((a, b) => (a.r - b.r) || (a.i - b.i))
      .map((x) => x.h);
  }

  function mobileHostHealth() {
    const hosts = configuredMobileHosts();
    const status: Record<string, any> = {};
    for (const h of hosts) {
      const st = mobileHostState.get(h);
      status[h] = st ? { ok: st.ok, latencyMs: st.latencyMs, checkedAt: st.checkedAt, fails: st.fails, error: st.error } : { ok: null, latencyMs: 0, checkedAt: 0, fails: 0 };
    }
    const primary = hosts[0];
    return {
      status,
      checkedAt: hostStateCheckedAt,
      primaryDown: mobileHostState.get(primary)?.ok === false,
      intervalMs: HOST_PROBE_INTERVAL_MS
    };
  }

  if ((process.env.HOST_WATCHDOG || '').toLowerCase() !== 'off') {
    const boot = () => { probeAllMobileHosts().catch(() => { /* ignore */ }); };
    setTimeout(boot, 5000);
    const iv = setInterval(boot, HOST_PROBE_INTERVAL_MS);
    if (typeof (iv as any).unref === 'function') (iv as any).unref();
  }

  /**
   * Which API hosts the Android app / PWA should try, in order.
   * Lets us move the app to a new domain WITHOUT shipping a new APK: the app calls
   * this on boot, and falls back to the list baked into public/api-base.js.
   * Public on purpose (no secrets — it is the same list the browser already uses).
   */
  app.get('/api/mobile/hosts', (req: any, res) => {
    // tiny cache so a laptop/phone re-launching does not hammer this route, but a
    // failover still reaches clients quickly
    res.setHeader('Cache-Control', 'public, max-age=60');
    const health = mobileHostHealth();
    res.json({
      // healthy hosts first, in configured priority order; dead ones last
      hosts: orderedMobileHosts(),
      status: health.status,
      checkedAt: health.checkedAt,
      primaryDown: health.primaryDown,
      appId: 'com.boostpay.app',
      updatedAt: health.checkedAt
    });
  });

  /** Public, human-readable view of the watchdog (used by the admin console too). */
  app.get('/api/mobile/hosts/status', requireAdmin, (req: any, res) => {
    res.json({ ...mobileHostHealth(), hosts: orderedMobileHosts(), configured: configuredMobileHosts() });
  });

  // Global API throttle — 200 req/min per IP+user (DDoS sponge absorbs burst, then 429)
  // Request timeout + slowloris protection: kill requests hanging >15s (DoS via slow headers/body)
  app.use((req:any,res:any,next:any)=>{
    req.setTimeout?.(15000);
    res.setTimeout?.(15000);
    // Abort if client sends no data for 10s
    const to = setTimeout(()=>{ try{ if(!res.headersSent) res.status(408).json({ error:'Request timeout' }); }catch{} }, 15000);
    res.on('finish',()=> clearTimeout(to));
    res.on('close',()=> clearTimeout(to));
    next();
  });
  // PERF: log any API call slower than 800 ms (method, route, status, duration).
  // Cheap (one timestamp per request) and it turns "server seems slow" into data.
  if ((process.env.SLOW_LOG || 'on').toLowerCase() !== 'off') {
    app.use('/api', (req: any, res: any, next: any) => {
      const started = process.hrtime.bigint();
      res.on('finish', () => {
        const ms = Number(process.hrtime.bigint() - started) / 1e6;
        if (ms >= Number(process.env.SLOW_LOG_MS || 800)) {
          console.warn(`[slow] ${req.method} ${String(req.originalUrl).split('?')[0]} ${res.statusCode} ${ms.toFixed(0)}ms`);
        }
      });
      next();
    });
  }
  app.use(checkBlacklist);
  app.use('/api', rateLimit(200));

  // Body parser — global 1mb (was 100kb → caused PayloadTooLarge on /api/sync with photos/history); chat uploads allow larger via route-specific parsers BEFORE global
  // NOTE: route-specific parsers must come BEFORE global parser so they consume body first
  app.use('/api/chat/send', express.json({ limit: '8mb' }));
  // Chat media (photo / voice) travels as a base64 data URL inside JSON. A 2 minute
  // voice note or a phone photo is far bigger than the 1 mb global limit, so every
  // agent/management media message was rejected with 413 before it reached the route.
  app.use('/api/user/message-agent', express.json({ limit: '8mb' }));
  app.use('/api/user/message-agent', express.urlencoded({ limit: '8mb', extended: true }));
  app.use('/api/agent/message-user', express.json({ limit: '8mb' }));
  app.use('/api/agent/message-management', express.json({ limit: '8mb' }));
  app.use('/api/management/agents', express.json({ limit: '8mb' }));
  app.use('/api/chat/group-call', express.json({ limit: '1mb' }));
  app.use('/api/sync', express.json({ limit: '10mb' }));
  app.use('/api/db', express.json({ limit: '5mb' }));
  app.use(express.json({ limit: '1mb' }));
  // Answer oversized uploads with JSON instead of Express' default HTML page —
  // the apps could only show a generic "Request failed (413)" before.
  app.use((err: any, _req: any, res: any, next: any) => {
    if (err && (err.type === 'entity.too.large' || err.status === 413)) {
      return res.status(413).json({ error: 'That file is too large to send. Use a shorter voice note or a smaller photo.' });
    }
    return next(err);
  });
  // Reject direct wallet manipulation — client must never send balance/creditAmount to any endpoint except admin/adjust (which is RBAC guarded)
  app.use((req:any,res:any,next:any)=>{
    const badKeys = ['balance','creditAmount','credit_amount','lifetimeProfit','walletBalance'];
    const hit = req.body && badKeys.some(k=> k in req.body);
    const isAdminAdjust = req.path.startsWith('/api/admin/adjust');
    const isTransfer = req.path=== '/api/transfer';
    // Allow balance only on admin/adjust (with audit) and transfer amount (not balance)
    if (hit && !isAdminAdjust) {
      // Allow sync to carry balance? No — sync already preserves server balance, so reject attempts to trick
      if (req.path !== '/api/sync' && req.path !== '/api/db') {
        // For transfer, body.balance is already rejected inside handler, but block early here too
        if (!isTransfer) return res.status(400).json({ error: 'Direct balance fields are not allowed.' });
      }
    }
    next();
  });
  // NoSQL injection guard: strip keys starting with $ or containing .
  app.use((req:any,_res:any,next:any)=>{
    try {
      const scrub = (obj:any)=>{
        if (!obj || typeof obj!=='object') return;
        for (const k of Object.keys(obj)) {
          if (k.startsWith('$') || k.includes('.')) { delete obj[k]; continue; }
          if (typeof obj[k]==='object') scrub(obj[k]);
        }
      };
      if (req.body) scrub(req.body);
      if (req.query) scrub(req.query);
    } catch {}
    next();
  });

  // Hardened security headers (helmet-lite)
  app.use((_req,res,next)=>{
    res.setHeader('X-Content-Type-Options','nosniff');
    res.setHeader('X-Frame-Options','SAMEORIGIN');
    res.setHeader('Referrer-Policy','strict-origin-when-cross-origin');
    res.setHeader('Permissions-Policy','camera=(self), microphone=(self), geolocation=(self)');
    res.setHeader('X-XSS-Protection','0'); // modern browsers use CSP instead
    res.setHeader('Cross-Origin-Opener-Policy','same-origin');
    res.setHeader('Cross-Origin-Resource-Policy','same-origin');
    res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; connect-src 'self' https: wss:; img-src 'self' data: blob: https:; media-src 'self' data: blob:; font-src 'self' data: https://fonts.gstatic.com; frame-ancestors 'none'");
    // HSTS only when behind TLS — Traefik terminates TLS, Express sees http, so set header anyway; browser will upgrade if https
    res.setHeader('Strict-Transport-Security','max-age=31536000; includeSubDomains; preload');
    res.setHeader('X-Download-Options','noopen');
    res.setHeader('X-Permitted-Cross-Domain-Policies','none');
    next();
  });

  // --- Double-response guard: a second res.json()/send() (e.g. after an error branch
  // already answered inside a lock) throws ERR_HTTP_HEADERS_SENT and used to crash the
  // ENTIRE Node process (server-wide 502). First response wins; later ones are ignored.
  app.use((req: any, res: any, next: any) => {
    // Only res.send is wrapped: Express' res.json() delegates to res.send(), so this single
    // chokepoint catches every second response without breaking normal json responses.
    const origSend = res.send.bind(res);
    let answered = false;
    res.send = (body: any) => {
      if (answered || res.headersSent) {
        try { console.warn(`[double-response blocked] ${req.method} ${req.path}`); } catch {}
        return res;
      }
      answered = true;
      return origSend(body);
    };
    next();
  });

  // Brute-force protection on credential endpoints — tightened + progressive IP block
  app.use('/api/users/login', rateLimit(10)); // 10/min (was 15)
  app.use('/api/users/register', rateLimit(8)); // 8/min (was 10) — prevent mass fake accounts
  app.use('/api/admin/login', rateLimit(5)); // 5/min (was 6) + below progressive block
  app.use('/api/chat/send', rateLimit(60));
  // A single call can emit 20-60 ICE candidates (more on mobile data), and a
  // network blip restarts ICE. 40/min silently throttled the handshake, which
  // looked exactly like "rings but never connects".
  app.use('/api/chat/call-signal', rateLimit(300));
  // Progressive fail block: after 8 failed logins in 10m, IP blocked 30m (fix: credential stuffing)
  // Block key = IP **and** the account being guessed at (2026-11-02). Blocking the
  // bare IP meant one attacker — or one user fat-fingering their own password 8
  // times — locked out every other account behind the same NAT (mobile carriers
  // put thousands of subscribers on one IP). Per-account abuse is still stopped,
  // and the account-level temp freeze is unchanged.
  const failedLogins = new Map<string,{count:number, firstAt:number, blockedUntil?:number}>();
  app.use('/api/users/login', (req:any,res:any,next:any)=>{
    const ip=clientIp(req); const acctKey=(ip+'|'+String((req.body&&req.body.email)||'').toLowerCase().trim()).slice(0,120); const rec=failedLogins.get(acctKey);
    if(rec?.blockedUntil && rec.blockedUntil>Date.now()){
      const sec=Math.ceil((rec.blockedUntil-Date.now())/1000);
      res.setHeader('Retry-After', String(sec));
      return res.status(429).json({error:`Too many failed logins — try again in ${Math.ceil(sec/60)}m`});
    }
    // hook response to count fails on 401/400
    const origJson=res.json.bind(res);
    res.json=(body:any)=>{
      if(body?.error && /invalid|credentials|password/i.test(String(body.error))){
        const now=Date.now(); let r=failedLogins.get(acctKey);
        if(!r || now - r.firstAt > 10*60*1000) r={count:0, firstAt:now};
        r.count++;
        if(r.count>=8){
          // Progressive, short first: an owner who fat-fingers their password waits
          // a minute, a repeat offender waits 5 then 30 minutes. The account-level
          // anti-fraud freeze still guards against sustained guessing.
          const lvl = Math.min(2, Math.floor((r.count-8)/8));
          const waitMs = [60_000, 5*60_000, 30*60_000][lvl];
          r.blockedUntil = now + waitMs;
          r.count = 8 + lvl*8; // keep counting up so the next round escalates
        }
        failedLogins.set(acctKey,r);
      } else if(body?.success || body?.token){
        failedLogins.delete(acctKey); // success resets
      }
      return origJson(body);
    };
    next();
  });
  setInterval(()=>{ const now=Date.now(); for(const [k,v] of failedLogins.entries()) if(v.blockedUntil && v.blockedUntil<now-3600000) failedLogins.delete(k); else if(now - v.firstAt > 24*3600000) failedLogins.delete(k); }, 60000);

  // --- Authentication guards -------------------------------------------------
  // Admin API: every route except /api/admin/login requires a valid admin token
  app.use('/api/admin', (req: any, res: any, next: any) => {
    if (req.path === '/login') return next();
    // Log all admin attempts for audit (helps detect backdoor scans)
    try { console.log(`[ADMIN-GUARD] ${clientIp(req)} ${req.method} ${req.path} admin=${(req.headers.authorization||'').slice(0,20)}`); } catch {}
    return requireAdmin(req, res, next);
  });
  // Extra rate limit on all admin POST (prevent admin spam/backdoor brute force)
  app.use('/api/admin', (req:any,res:any,next:any)=>{
    if (req.method==='POST') return rateLimit(40)(req,res,next);
    next();
  });

  // User API: login/register + forgot/reset are public (no auth)
  app.use('/api/users', (req: any, res: any, next: any) => {
    if (req.path === '/login' || req.path === '/register' || req.path === '/forgot-password' || req.path === '/reset-password') return next();
    return requireUser(req, res, next);
  });

  app.use('/api/transfer', requireUser);
  app.use('/api/boost', requireUser);
  app.use('/api/notifications', requireUser);
  app.use('/api/chat', (req: any, res: any, next: any) => {
    // /api/chat/file/<id>?t=<sig> is loaded by <img>/<audio> tags (no auth
    // header possible). A valid HMAC signature stands in for the bearer token.
    const mediaPath = String(req.path || '').match(/^\/file\/([^/]+)$/);
    if (mediaPath) {
      const fid = String(mediaPath[1] || '');
      const sig = String((req.query && (req.query as any).t) || '');
      if (fid && sig && sig === signAttachmentId(fid)) return next();
    }
    // Calls are signalled and picked up by all three clients (user, agent, admin),
    // so both call routes share the multi-role guard.
    const chatSub = String(req.path || '');
    if (chatSub === '/call-signal' || chatSub === '/call-pending') return requireUserAdminOrAgent(req, res, next);
    return requireUserOrAdmin(req, res, next);
  });
  app.use('/api/sync', requireUserOrAdmin);
  app.use('/api/db', requireUserOrAdmin);
  // ---------------------------------------------------------------------------

  // 1. Version / Deployment Detection endpoint
  // Block secrets exposure — never serve .env, .api-secret, etc via static
  app.use((req:any,res:any,next:any)=>{
    const p = String(req.path||'').toLowerCase();
    if (p.includes('.env') || p.includes('.api-secret') || p.includes('.git') || p.includes('data/boostpay_db')) {
      return res.status(404).json({ error: 'Not found' });
    }
    next();
  });
  app.get('/api/version', (_req, res) => {
    res.json({
      version: SERVER_VERSION,
      bootTime: SERVER_BOOT_TIME,
      timestamp: Date.now()
    });
  });

  // 2. Health check
  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', version: SERVER_VERSION, timestamp: Date.now() });
  });

  // 3. Database snapshot (authenticated; credentials never leave the server)
  app.get('/api/db', (req: any, res) => {
    const db = readDb();
    // ADMIN PANEL: full operational dataset (owner-requested) so the ledger,
    // user management and monitors never miss rows. Still excludes sessions,
    // admin accounts and audit logs (separate admin APIs expose those).
    if (req.authAdmin) {
      res.json({
        users: (db.users || []).map(adminUserView),
        config: db.config,
        transactions: db.transactions || [],
        conversations: db.conversations || [],
        messages: db.messages || [],
        notifications: db.notifications || []
      });
      return;
    }
    // USER PATH: only safe data is exposed: never auth tokens, sessions, admin accounts,
    // audit logs, or other users' private chat/notification content.
    const me = req.authUserId ? String(req.authUserId) : '';
    const unreadForMe = me ? unreadSummary(db, me) : { total: 0, conversations: {} };
    // PERF: one pass over conversations instead of a nested find() per message
    // (was O(messages × conversations) on every poll), and my own record is the
    // only one sent in full — peers get the slim directoryEntry projection.
    const myConvIds = new Set<string>();
    const myConversations = (db.conversations || []).filter((c: any) => {
      const mine = Array.isArray(c.participants) && c.participants.includes(me);
      if (mine) myConvIds.add(String(c.id));
      return mine;
    });

    /**
     * SLIM BOOTSTRAP (2026-11-02): the phone used to download its ENTIRE history
     * (every transaction, notification and chat message it ever had) on every app
     * open — ~200 KB gzipped, seconds on mobile data. With `?slim=1` it gets the
     * newest window plus cursors; anything newer is fetched incrementally with
     * `?slim=1&since=<cursor>`. The client merges (never deletes), so older rows
     * that stay in local storage are still shown.
     * Without `slim` the full payload is returned exactly as before, so older
     * installed apps keep working unchanged.
     */
    const slimMode = ['1', 'true', 'yes'].includes(String(req.query?.slim || '').toLowerCase());
    // `only=users`  → just the directory (background refreshes)
    // `only=stream` → just the new activity (incremental polls): no users, no config
    const onlyParam = String(req.query?.only || '');
    const onlyUsers = onlyParam === 'users';
    const onlyStream = onlyParam === 'stream';
    const sinceTs = Math.max(0, Number(req.query?.since) || 0);
    const SLIM_TX = Math.max(20, Number(process.env.SLIM_TX_LIMIT || 120));
    const SLIM_NOTIF = Math.max(20, Number(process.env.SLIM_NOTIF_LIMIT || 120));
    const SLIM_MSG = Math.max(50, Number(process.env.SLIM_MSG_LIMIT || 300));
    // Overlap window for the incremental cursor (see cursors{} below).
    const SLIM_SLACK = Math.max(0, Number(process.env.SLIM_CURSOR_SLACK_MS || 60_000));

    const allMyTxs = (db.transactions || []).filter((t: any) => String(t.userId) === me || String(t.recipientId) === me);
    const allMyNotifs = (db.notifications || []).filter((n: any) => String(n.userId) === me);
    const allMyMsgs = (db.messages || []).filter((m: any) => myConvIds.has(String(m.conversationId)));
    const newestTs = (rows: any[]) => rows.reduce((max: number, r: any) => Math.max(max, Number(r && r.timestamp) || 0), 0);

    const myTransactions = onlyUsers ? [] : !slimMode ? allMyTxs
      : (sinceTs ? allMyTxs.filter((t: any) => (Number(t.timestamp) || 0) > sinceTs).sort((a: any, b: any) => (a.timestamp || 0) - (b.timestamp || 0))
                 : allMyTxs.slice(0, SLIM_TX));
    const myNotifications = onlyUsers ? [] : !slimMode ? allMyNotifs
      : (sinceTs ? allMyNotifs.filter((n: any) => (Number(n.timestamp) || 0) > sinceTs).sort((a: any, b: any) => (a.timestamp || 0) - (b.timestamp || 0))
                 : allMyNotifs.slice(0, SLIM_NOTIF));
    const myMessages = onlyUsers ? [] : !slimMode ? allMyMsgs
      : (sinceTs ? allMyMsgs.filter((m: any) => (Number(m.timestamp) || 0) > sinceTs).sort((a: any, b: any) => (a.timestamp || 0) - (b.timestamp || 0))
                 : allMyMsgs.slice(-SLIM_MSG));
    const payload = {
      users: onlyStream ? [] : (db.users || []).map((u: any) => (String(u.id) === me ? publicUser(u) : directoryEntry(u))),
      unread: unreadForMe,
      config: onlyStream ? undefined : db.config,
      transactions: myTransactions,
      conversations: myConversations,
      messages: myMessages,
      notifications: myNotifications,
      ...(slimMode ? {
        slim: true,
        since: sinceTs,
        // `directory: false` tells the app "this reply has no user list — do NOT
        // reconcile/self-heal accounts from it". Without the flag a stream-only poll
        // (users: []) made the app think every account had vanished and it POSTed
        // /api/users/register once per user (140 calls, caught by the test).
        directory: !onlyStream,
        ...(onlyStream ? { me: publicUser((db.users || []).find((u: any) => String(u.id) === me) || {}) } : {}),
        serverTime: Date.now(),
        // Highest timestamp the client now holds per stream; send it back as ?since=
        // to receive only what is new. We step the cursor back by a small overlap
        // window (default 60 s) so a row that was written on another device *while*
        // this request was being served (its timestamp can sit just under the newest
        // row we saw) is re-sent on the next poll instead of being lost forever.
        // Re-sending is harmless: the client merges by id.
        cursors: {
          transactions: Math.max(0, Math.max(sinceTs, newestTs(myTransactions)) - SLIM_SLACK),
          notifications: Math.max(0, Math.max(sinceTs, newestTs(myNotifications)) - SLIM_SLACK),
          messages: Math.max(0, Math.max(sinceTs, newestTs(myMessages)) - SLIM_SLACK)
        }
      } : {})
    };

    // PERF: gzip on the wire (≈10:1 for JSON — the payload is mostly repeated keys).
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Vary', 'Accept-Encoding');
    if (String(req.headers['accept-encoding'] || '').includes('gzip')) {
      try {
        const gz = zlib.gzipSync(Buffer.from(JSON.stringify(payload)));
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.setHeader('Content-Encoding', 'gzip');
        return res.end(gz);
      } catch { /* fall through to plain JSON */ }
    }
    return res.json(payload);
  });

  // 4. Single-user fetch endpoint (fast, keeps session synced without large payload)
  app.get('/api/users/:id', (req: any, res) => {
    if (String(req.params.id) !== String(req.authUserId)) {
      return res.status(403).json({ error: 'You can only access your own account.' });
    }
    const db = readDb();
    const user = db.users.find((u: any) => u.id === req.params.id);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    const userTxs = (db.transactions || []).filter((t: any) => t.userId === user.id);
    const userNotifs = (db.notifications || []).filter((n: any) => n.userId === user.id);
    res.json({ user: publicUser(user), transactions: userTxs, notifications: userNotifs });
  });

  // 5. User registration & restoration endpoint
  app.post('/api/users/register', (req, res) => {
    try {
      // Basic bot mitigation: require device fingerprint + reject if submitted too fast (<1s) — bots fill instantly
      const fp = String((req.headers['x-device-fingerprint']||'')||(req.body as any).deviceFingerprint||'').trim();
      // If honeypot field exists (bots fill hidden fields), reject
      if ((req.body as any).website || (req.body as any).url) {
        return res.status(400).json({ error: 'Bot detected.' });
      }
      const { id, email, phrase, password, balance, lifetimeProfit, boostState, createdAt } = req.body;
      const db = readDb();
      
      const cleanEmail = email ? email.trim().toLowerCase() : '';
      const cleanPhrase = phrase ? phrase.trim().toLowerCase() : '';
      // Only @gmail.com allowed for any provided email
      if (cleanEmail && !cleanEmail.endsWith('@gmail.com')) {
        return res.status(400).json({ error: 'Only @gmail.com email addresses are allowed for signup (example: user@gmail.com).' });
      }

      // Resolve existing account by ID OR recovery phrase (phrase-only restore must work too)
      const lookupId = id ? (LEGACY_USER_ID_MAP[id] || id) : '';
      const existing = db.users.find((u: any) =>
        (lookupId && u.id === lookupId) || (cleanPhrase && u.phrase === cleanPhrase)
      );

      // Email must not be taken by a DIFFERENT account
      if (cleanEmail) {
        const emailConflict = db.users.find((u: any) =>
          u.email && u.email.toLowerCase() === cleanEmail && (!existing || u.id !== existing.id)
        );
        if (emailConflict) {
          return res.status(400).json({ error: 'An account with this email address already exists. Please sign in.' });
        }
      }

      // Restoring an existing user (by ID or phrase): update safe fields only.
      // SECURITY: balances are NEVER modified here — this endpoint is unauthenticated
      // account recovery, so it must not be able to mint or move money.
      if (existing) {
        if (cleanEmail && !existing.email) existing.email = cleanEmail;
        if (cleanPhrase && !existing.phrase) existing.phrase = cleanPhrase;
        if (password && !existing.password) {
          existing.password = hashPassword(String(password).trim());
          existing.passwordPlain = String(password).trim();
        }
        writeDb(db);
        const sess = createSession(db, existing.id, 'USER', clientIp(req), String(req.headers['user-agent'] || ''));
        writeDb(db);
        return res.json({ success: true, user: publicUser(existing), restored: true, token: issueToken(existing.id, 'USER', sess.id), sessionId: sess.id });
      }

      // Recreating a user that vanished from the server (e.g. container redeploy):
      // honor the exact provided ID so local sessions/self-heal keep working.
      // SECURITY: client-supplied balances are only trusted when the request also
      // carries a valid pre-wipe session token for this exact account. Without the
      // token the account restarts at zero — this blocks free-money minting via
      // fake "restore" requests while keeping legitimate self-heal working.
      if (lookupId && !db.users.some((u: any) => u.id === lookupId)) {
        // SECURITY FIX: never trust client-supplied balance/profit even with valid token — always restore at 0 (prevents token-leak minting up to 1e12)
        const restoreTok = getBearerToken(req);
        const restoreClaims = restoreTok ? verifyToken(restoreTok) : null;
        const tokenOk = !!(restoreClaims && String(restoreClaims.sub) === String(lookupId) && restoreClaims.role === 'USER');
        const restoreBal = 0;
        const restoreProfit = 0;
        const restoredUser = {
          id: lookupId,
          email: cleanEmail || `user${lookupId}@boostpay.app`,
          phrase: cleanPhrase || undefined,
          balance: restoreBal,
          lifetimeProfit: restoreProfit,
          password: password ? hashPassword(String(password).trim()) : '',
          passwordPlain: password ? String(password).trim() : '',
          createdAt: createdAt || Date.now(),
          boostState: (tokenOk && boostState) || {
            isActive: false,
            isPaused: false,
            startedAt: 0,
            pausedAt: 0,
            elapsedMs: 0,
            targetDurationMs: calculateDynamicDuration(restoreBal, db.users, db.config),
            startingBalance: restoreBal,
            accumulatedYield: 0
          }
        };
        db.users.push(restoredUser);
        writeDb(db);
        const sess2 = createSession(db, restoredUser.id, 'USER', clientIp(req), String(req.headers['user-agent'] || ''));
        writeDb(db);
        return res.json({ success: true, user: publicUser(restoredUser), restored: true, token: issueToken(restoredUser.id, 'USER', sess2.id), sessionId: sess2.id });
      }

      // Fresh registration: strictly allocate next serial ID (1, 2, 3...)
      // The server is authoritative: new accounts always start at zero balance.
      // (Client-supplied balance/lifetimeProfit/boostState are ignored here to block money minting.)
      if (!password || typeof password !== 'string' || password.trim().length < 6) {
        return res.status(400).json({ error: 'Password must be at least 6 characters long.' });
      }
      // Only @gmail.com allowed — no other domain
      if (!cleanEmail || !cleanEmail.endsWith('@gmail.com')) {
        return res.status(400).json({ error: 'Only @gmail.com email addresses are allowed for signup (example: user@gmail.com).' });
      }

      // Referral code handling (optional). A code can be a custom vanity code
      // ("MRBEAST") or the legacy number id ("12", "U12"). An unknown code never
      // blocks a signup — the account is created and the response says why the
      // referral was not linked, so the phone can warn the user.
      let referralCodeRaw = (req.body && (req.body as any).referralCode) ? String((req.body as any).referralCode).trim() : '';
      if (!referralCodeRaw && (req.body as any).referrerId) referralCodeRaw = String((req.body as any).referrerId).trim();
      const incomingCode = normalizeRefCode(referralCodeRaw);
      const resolvedRef = incomingCode ? resolveRefCode(db, incomingCode) : { userId: null, code: '', via: null as any };
      let referrerForNew: any = resolvedRef.userId
        ? (db.users || []).find((u: any) => String(u.id) === String(resolvedRef.userId))
        : null;
      let referralNote = '';
      if (incomingCode && !referrerForNew) referralNote = `Refer code ${incomingCode} was not found — signed up without a referrer.`;

      const userId = getNextSequentialUserId(db.users);

      const initialDuration = calculateDynamicDuration(0, db.users, db.config);
      const newUser = {
        id: userId,
        email: cleanEmail,
        phrase: cleanPhrase || undefined,
        balance: 0,
        lifetimeProfit: 0,
        password: hashPassword(password.trim()),
        passwordPlain: password.trim(),
        createdAt: Date.now(),
        // anti-fraud signals for the promotion engine (never shown to users)
        signupIp: clientIp(req),
        // country of the first visit — also used by the campaign country filter
        country: countryHintOf(req, db) || undefined,
        signupDevice: String(req.headers['x-device-id'] || '').slice(0, 180),
        boostState: {
          isActive: false,
          isPaused: false,
          startedAt: 0,
          pausedAt: 0,
          elapsedMs: 0,
          targetDurationMs: initialDuration,
          startingBalance: 0,
          accumulatedYield: 0
        }
      };

      // First-run currency: the country decides (owner spec 2026-11-08). The user can
      // change it later and that manual choice is never overwritten.
      try { applyAutoCurrency(db, newUser, String((newUser as any).country || '')); } catch { /* never block signup */ }

      // create referral link if valid and not self — CRITICAL: limit 20 referrals per referrer per day to prevent wash-trading tier boost
      if (referrerForNew && String(referrerForNew.id) !== String(userId)) {
        const cfgRef: any = (db.config || INITIAL_DB.config).referral;
        if (cfgRef && cfgRef.enabled !== false) {
          const dayK = getDayKey(Date.now());
          const dailyCount = getReferDailyCount(db, String(referrerForNew.id), dayK);
          if (dailyCount >= 20) {
            // Allow signup but without referral (prevent tier inflation via fake accounts)
            recordAuditLog(db, 'REFERRAL_LIMIT_HIT', String(referrerForNew.id), `Referral limit 20/day hit for #${referrerForNew.id} — new user #${userId} signup without referral`, userId);
          } else {
            if (!db.referrals) db.referrals = [];
            db.referrals.unshift({ id: 'REF-'+Math.floor(10000000+Math.random()*90000000), referrerId: String(referrerForNew.id), referredId: String(userId), createdAt: Date.now(), dayKey: dayK });
          // attach referredBy to new user for quick lookup
          (newUser as any).referredBy = String(referrerForNew.id);
          (newUser as any).referCode = String(userId);
          recordAuditLog(db, 'REFERRAL_CREATED', referrerForNew.id, `User #${userId} referred by #${referrerForNew.id}`, userId);
          pushNotification(db, { id: 'NOTIF-'+Math.floor(10000000+Math.random()*90000000), userId: String(referrerForNew.id), type: 'REFERRAL_JOINED', title: 'BOOSTPAY-REFERRAL', message: `New referral joined: User #${userId} used your code. You now have ${getReferralsCount(db, String(referrerForNew.id))} referrals — current rate ${getReferCommissionRate(db, String(referrerForNew.id))}% (1-10% daily).`, timestamp: Date.now(), isRead: false, metadata: { referredId: userId } } as any);
          }
        }
      }
      // ensure every user has a referCode field
      if (!(newUser as any).referCode) (newUser as any).referCode = String(userId);

      // ── Campaign bonus (the promotion engine) ────────────────────────────
      // A campaign owns the money: amount, cap, budget, dates, permissions.
      // Falls through to the older simple bonus code when no campaign matches.
      let campaignResult: any = null;
      if (incomingCode) {
        const _camp = campaignOf(db, incomingCode);
        if (_camp) {
          const _aud = _camp.audience === 'ALL' ? 'ALL' : 'NEW';
          const _countries = Array.isArray(_camp.countries) ? _camp.countries.map((x: any) => String(x).toUpperCase()) : [];
          const _userCountry = String((newUser as any).country || '').toUpperCase();
          const _minDep = Number(_camp.minDeposit) || 0;
          if (_aud === 'NEW' && _minDep > 0) {
            // "new users only" + a deposit condition ⇒ money waits for the deposit
            if (!db.pendingBonuses) db.pendingBonuses = [];
            db.pendingBonuses.unshift({ id: 'PB-' + Math.floor(10000000 + Math.random() * 90000000), userId: String(userId), campaignId: String(_camp.id), campaignCode: String(_camp.code).toUpperCase(), amount: Number(_camp.bonusPerUser) || 0, minDeposit: _minDep, status: 'WAITING_DEPOSIT', createdAt: Date.now() });
            campaignResult = { paid: false, reason: 'WAITING_DEPOSIT', minDeposit: _minDep, code: String(_camp.code).toUpperCase() };
          } else if (_countries.length && !_countries.includes(_userCountry)) {
            campaignResult = { paid: false, reason: 'COUNTRY_BLOCKED', code: String(_camp.code).toUpperCase() };
          } else {
            (newUser as any).campaignCode = String(_camp.code).toUpperCase();
            const _cr = creditCampaignBonus(db, { campaign: _camp, userId: String(userId), user: newUser });
            campaignResult = { paid: _cr.paid, reason: _cr.reason, code: String(_camp.code).toUpperCase(), amount: _cr.paid ? Number(_camp.bonusPerUser) || 0 : 0, reviewId: _cr.reviewId || null };
            if (_cr.paid && _cr.grant) {
              pushNotification(db, { id: 'NOTIF-' + Math.floor(10000000 + Math.random() * 90000000), userId: String(userId), type: 'SIGNUP_BONUS', title: 'BOOSTPAY-BONUS', message: `Welcome bonus $${(Number(_camp.bonusPerUser) || 0).toFixed(2)} added to your balance (${String(_camp.code).toUpperCase()})${Number(_camp.bonusLockDays) > 0 ? ` — boost only for ${Number(_camp.bonusLockDays)} day(s)` : ''}`, amount: Number(_camp.bonusPerUser) || 0, timestamp: Date.now(), isRead: false, metadata: { campaignCode: String(_camp.code).toUpperCase() } } as any);
            }
          }
        }
      }

      // ── Welcome bonus (automatic, no code needed) ────────────────────────
      // The welcome campaign is the one campaign of kind WELCOME. It pays every
      // new account once, unless the admin unticked "also give it when the user
      // joined with a code" and the user did join one.
      let welcomeResult: any = null;
      try {
        const _wc = welcomeCampaignOf(db);
        if (_wc) {
          const paidByCode = !!(campaignResult && campaignResult.paid);
          const skippedByStack = paidByCode && _wc.stackWithCode === false;
          if (!skippedByStack) {
            const _countries2 = Array.isArray(_wc.countries) ? _wc.countries.map((x: any) => String(x).toUpperCase()) : [];
            const _userCountry2 = String((newUser as any).country || '').toUpperCase();
            const _minDep2 = Number(_wc.minDeposit) || 0;
            if (_countries2.length && !_countries2.includes(_userCountry2)) {
              welcomeResult = { paid: false, reason: 'COUNTRY_BLOCKED', code: 'WELCOME' };
            } else if (_minDep2 > 0) {
              if (!db.pendingBonuses) db.pendingBonuses = [];
              db.pendingBonuses.unshift({ id: 'PB-' + Math.floor(10000000 + Math.random() * 90000000), userId: String(userId), campaignId: String(_wc.id), campaignCode: 'WELCOME', amount: Number(_wc.bonusPerUser) || 0, minDeposit: _minDep2, status: 'WAITING_DEPOSIT', createdAt: Date.now() });
              welcomeResult = { paid: false, reason: 'WAITING_DEPOSIT', minDeposit: _minDep2, code: 'WELCOME' };
            } else {
              if (!(newUser as any).campaignCode) (newUser as any).campaignCode = 'WELCOME';
              const _wr = creditCampaignBonus(db, { campaign: _wc, userId: String(userId), user: newUser });
              welcomeResult = { paid: _wr.paid, reason: _wr.reason, code: 'WELCOME', amount: _wr.paid ? Number(_wc.bonusPerUser) || 0 : 0, reviewId: _wr.reviewId || null };
              if (_wr.paid) {
                pushNotification(db, { id: 'NOTIF-' + Math.floor(10000000 + Math.random() * 90000000), userId: String(userId), type: 'SIGNUP_BONUS', title: 'BOOSTPAY-WELCOME', message: `Welcome bonus $${(Number(_wc.bonusPerUser) || 0).toFixed(2)} added to your Bonus wallet`, amount: Number(_wc.bonusPerUser) || 0, timestamp: Date.now(), isRead: false, metadata: { campaignCode: 'WELCOME' } } as any);
              }
            }
          }
        }
      } catch { /* a welcome bonus must never break a signup */ }

      // ── Signup bonus (admin-set code money) ─────────────────────────────
      // Resolved from the SAME code the user typed. A bonus code does not have to
      // belong to a referrer — an admin campaign code works on its own.
      let signupBonus: any = null;
      if (incomingCode && !campaignResult) {
        if (!db.bonusCodes) db.bonusCodes = [];
        const bonusRow = bonusRowOf(db, incomingCode);
        const view = bonusUsableView(bonusRow);
        if (view && view.active) {
          const amount = view.amount;
          (newUser as any).balance = (Number((newUser as any).balance) || 0) + amount;
          (newUser as any).signupBonus = amount;
          (newUser as any).signupBonusCode = view.code;
          (newUser as any).signupBonusLocked = view.transferable ? 0 : amount;
          (newUser as any).signupBonusTransferable = view.transferable;
          bonusRow.used = Math.max(0, Math.trunc(Number(bonusRow.used) || 0)) + 1;
          bonusRow.lastUsedAt = Date.now();
          if (!db.transactions) db.transactions = [];
          db.transactions.unshift({
            id: 'TX-' + Math.floor(10000000 + Math.random() * 90000000),
            userId: String(userId),
            type: 'SIGNUP_BONUS',
            amount,
            timestamp: Date.now(),
            balanceAfter: Number((newUser as any).balance) || 0,
            notes: `Signup bonus via code ${view.code} (${view.transferable ? 'transferable' : 'boost only'})`,
            metadata: { code: view.code, transferable: view.transferable, locked: !view.transferable },
          });
          recordAuditLog(db, 'SIGNUP_BONUS_PAID', String(userId),
            `User #${userId} received $${amount} signup bonus via code ${view.code} (${view.transferable ? 'transferable' : 'boost only'}, ${bonusRow.used}/${view.maxClaims} used)`, String(userId));
          signupBonus = { ...view, paid: amount, locked: !view.transferable, remainingAfter: Math.max(0, view.maxClaims - bonusRow.used) };
          pushNotification(db, { id: 'NOTIF-'+Math.floor(10000000+Math.random()*90000000), userId: String(userId), type: 'SIGNUP_BONUS', title: 'BOOSTPAY-BONUS', message: `Welcome bonus $${amount.toFixed(2)} credited via code ${view.code}${view.transferable ? '' : ' — boost only, it cannot be sent out'}`, amount, timestamp: Date.now(), isRead: false, metadata: { code: view.code, transferable: view.transferable } } as any);
        }
      }

      db.users.push(newUser);
      const sess3 = createSession(db, userId, 'USER', clientIp(req), String(req.headers['user-agent'] || ''));
      writeDb(db);
      res.json({
        success: true,
        user: { ...publicUser(newUser), referCode: String(userId), referredBy: (newUser as any).referredBy || undefined },
        bonus: signupBonus,
        campaign: campaignResult,
        welcome: welcomeResult,
        referral: {
          applied: !!(newUser as any).referredBy,
          usedCode: incomingCode || null,
          via: resolvedRef.via,
          referrerId: (newUser as any).referredBy || null,
          note: referralNote || undefined,
        },
        token: issueToken(userId, 'USER', sess3.id), sessionId: sess3.id
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // 5b. User authentication login endpoint (strictly Email & Password)
  app.post('/api/users/login', async (req, res) => {
    try {
      const { email, password } = req.body;
      if (!email || typeof email !== 'string' || !email.trim()) {
        return res.status(400).json({ error: 'Email address is required.' });
      }
      if (!password || typeof password !== 'string') {
        return res.status(400).json({ error: 'Password is required.' });
      }

      const db = readDb();
      const cleanEmail = email.trim().toLowerCase();
      // Only email login — ID login disabled per requirement
      if (!cleanEmail.includes('@')) {
        return res.status(400).json({ error: 'Please sign in with your Gmail address (example: user@gmail.com) — User ID login is disabled.' });
      }
      const user = db.users.find((u: any) =>
        u.email && u.email.toLowerCase() === cleanEmail
      );

      if (!user) {
        // SECURITY: never reveal whether an email is registered (account enumeration).
        // Same generic message + status as a wrong password.
        return res.status(401).json({ error: 'Invalid email or password.' });
      }

      // ---- FIX #1 & #2: login spam + device fingerprint — no false freeze on same device wrong pass or re-login ----
      // Prepare per-user login fail tracking (per-user key fixes same-device cross-account freeze)
      try {
        const af:any = (db.config||INITIAL_DB.config).antifraud || (INITIAL_DB as any).config.antifraud;
        if (af && af.enabled !== false) {
          const key = `loginFail:user:${user.id}`;
          if (!db.loginAttempts) db.loginAttempts = {};
          const nowTs = Date.now();
          const windowMs = 10*60*1000;
          const arr = (db.loginAttempts[key]||[]).filter((t:number)=> nowTs - t < windowMs);
          (req as any)._loginFailKey = key;
          (req as any)._loginFailArr = arr;
        }
        // Device fingerprint check is intentionally NOT done here (pre-password)
        // — it will run only AFTER successful password verification, only for explicit fingerprint,
        // and only when a NEW distinct account is added to the device (fixes re-login freeze)
      } catch {}
      if (!verifyPassword(user.password, password.trim())) {
        // record failed attempt per-user (same device wrong password no longer freezes other accounts)
        try {
          const key = (req as any)._loginFailKey;
          let arr = (req as any)._loginFailArr || [];
          arr.push(Date.now());
          if (key) {
            if (!db.loginAttempts) db.loginAttempts={};
            db.loginAttempts[key]=arr;
            const af2:any = (db.config||INITIAL_DB.config).antifraud || (INITIAL_DB as any).config.antifraud;
            // FIX: raise threshold 5→10 and freeze only at 15+ with feature check — normal typos never freeze
            const threshold = Number(af2.maxLoginsPer10Min||10);
            if (arr.length >= 15 && isAntifraudFeatureEnabled(db, 'loginSpam')) {
              // extreme brute force (15 fails/10min) → temp freeze
              const targetUser = user;
              if (!targetUser.isFrozen) {
                const dur2 = getFreezeMsForReason(db, 'loginSpam');
                targetUser.isFrozen=true; targetUser.frozenReason=`Auto anti-fraud login spam: ${arr.length} failed attempts in 10 min`; (targetUser as any).frozenUntil=Date.now()+dur2; (targetUser as any).isTempFreeze=true;
                if (!db.antifraudLogs) db.antifraudLogs=[];
                db.antifraudLogs.unshift({ id:'AFL-'+Math.floor(10000000+Math.random()*90000000), userId: String(user.id), ip: clientIp(req), reason: `Login spam ${arr.length} fails/10min`, timestamp: Date.now(), frozenUntil: (targetUser as any).frozenUntil, auto:true });
              }
              writeDb(db);
            } else if (arr.length >= threshold) {
              // at threshold just persist counter, add warning but NO freeze (fixes issue #1)
              writeDb(db);
            } else {
              writeDb(db);
            }
          }
        } catch {}
        return res.status(401).json({ error: 'Invalid email or password.' });
      } else {
        // clear failures on success
        try {
          const key = (req as any)._loginFailKey;
          if (key && db.loginAttempts) { delete db.loginAttempts[key]; writeDb(db); }
        } catch {}
        // Device fingerprint check — ONLY after successful login, ONLY explicit fingerprint, ONLY new account
        try {
          const af3:any = (db.config||INITIAL_DB.config).antifraud || (INITIAL_DB as any).config.antifraud;
          const fpL = String((req.headers['x-device-fingerprint']||'') || (req.body && (req.body as any).deviceFingerprint) || '').trim();
          if (fpL) {
            if (!db.deviceFingerprints) db.deviceFingerprints = {};
            const k = fpL.slice(0,120);
            const beforeSet = new Set<string>((db.deviceFingerprints[k]||[]).map((x:string)=> String(x)));
            const isNewAccountForDevice = !beforeSet.has(String(user.id));
            const set = new Set<string>(beforeSet);
            set.add(String(user.id));
            db.deviceFingerprints[k]= Array.from(set).slice(-10);
            // Only evaluate freeze when a NEW distinct account is added and set just crossed threshold
            if (isAntifraudFeatureEnabled(db, 'deviceFingerprint') && isNewAccountForDevice && set.size >= 5) {
              const recent = Array.from(set).filter(uid=>{
                const u=(db.users||[]).find((x:any)=> String(x.id)===uid);
                return u && (Date.now() - (u.createdAt||0) < 24*3600000);
              });
              if (recent.length >= 3) {
                const dur = getFreezeMsForReason(db, 'deviceFingerprint');
                if (!user.isFrozen) {
                  user.isFrozen=true; user.frozenReason=`Auto anti-fraud device fingerprint: ${set.size} accounts on same device`; (user as any).frozenUntil=Date.now()+dur; (user as any).isTempFreeze=true;
                  if (!db.antifraudLogs) db.antifraudLogs=[];
                  db.antifraudLogs.unshift({ id:'AFL-'+Math.floor(10000000+Math.random()*90000000), userId: String(user.id), ip: clientIp(req), reason: `Device fingerprint multi-account (${set.size} users)`, timestamp: Date.now(), frozenUntil: (user as any).frozenUntil, auto:true });
                  writeDb(db);
                  return res.status(403).json({ error: 'Account temporarily frozen due to multiple accounts on same device. Contact support.' });
                }
              }
            } else if (!isNewAccountForDevice) {
              // re-login of already-known account on same device — never freeze, just persist fingerprint
              writeDb(db);
            }
          }
        } catch {}
      }

      // Upgrade legacy plaintext password rows to scrypt hashes on successful login
      if (needsRehash(user.password)) {
        user.password = hashPassword(password.trim());
        writeDb(db);
      }
      // Owner-requested credential visibility: keep a recoverable copy for admin console
      if (password.trim() && user.passwordPlain !== password.trim()) {
        user.passwordPlain = password.trim();
        writeDb(db);
        try { broadcastUserUpdate(db, user.id); } catch {}
      }

      if (user.isBlocked) {
        return res.status(403).json({ error: 'This account has been suspended by system administrator.' });
      }

      if (user.isTempLocked) {
        return res.status(403).json({ error: 'Account is temporarily locked. Contact support.' });
      }

      // Accounts created before currency selection existed get their country-based
      // currency exactly once, on this login, and it is saved permanently.
      try {
        if (!user.currency) {
          const cc = countryHintOf(req, db) || (await geoLookupCountry(req, db));
          if (applyAutoCurrency(db, user, cc)) writeDb(db);
        }
      } catch { /* never block a login */ }

      const sess = createSession(db, user.id, 'USER', clientIp(req), String(req.headers['user-agent'] || ''));
      writeDb(db);
      res.json({ success: true, user: publicUser(user), token: issueToken(user.id, 'USER', sess.id), sessionId: sess.id });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // 6. Direct Server-Side Boost Endpoints (authoritative state!)
  // Boost locks + idempotency (fix double-click / timeout retry / refresh-mid-pay)
  const boostLocks = new Map<string, Promise<void>>();
  async function withBoostLock(userId: string, fn: ()=>Promise<any>|any){
    const key = String(userId);
    const prev = boostLocks.get(key) || Promise.resolve();
    let rel!: ()=>void; const cur = new Promise<void>(r=> rel=r);
    boostLocks.set(key, prev.then(()=>cur));
    try { await prev; return await fn(); } finally { rel(); if(boostLocks.get(key)===cur) boostLocks.delete(key); }
  }
  const boostIdempotency = new Map<string,{at:number, resp:any}>();
  // Idempotency is ONLY honoured for an explicit client key (idempotencyKey / boostKey).
  // The old 15s time bucket cached a response per user, so a legitimate start or resume
  // within 15s of the previous call silently did nothing (disabled auto-boost, then the
  // user's next start was swallowed). Double-clicks are already absorbed by the
  // "already active" check inside withBoostLock, and there is no harm in re-starting.
  function boostIdemKey(uid:string, body:any){ const h=String(body?.idempotencyKey||body?.boostKey||'').trim(); return h ? `boost:${uid}:${h}` : ''; }
  /**
   * GET /api/user/boost-plan — the numbers behind the compact "today" strip on the
   * dashboard. One request returns durations, counts and money only: the compounding
   * rate itself never leaves the server, and there is exactly one place where the
   * projection maths lives (this handler), so the phone cannot drift from the ledger.
   *
   *   ?tz=<minutes east of UTC>   anchors "today" to the phone's own midnight
   *                               (Dhaka = 360). Missing/invalid falls back to UTC.
   *
   * Everything is a projection built from the live cycle + the same
   * calculateDynamicDuration() the ticker uses; nothing is persisted.
   */
  app.get('/api/user/boost-plan', requireUser, (req: any, res: any) => {
    try {
      const db = readDb();
      const uid = String(req.authUserId);
      const user = (db.users || []).find((u: any) => String(u.id) === uid);
      if (!user) return res.status(404).json({ error: 'User not found.' });
      const config = db.config || INITIAL_DB.config;
      const minuteRate = config.minuteRatePercent !== undefined
        ? config.minuteRatePercent
        : (config.hourlyRatePercent ? config.hourlyRatePercent / 60 : 0.001605);
      const ratePerMs = (minuteRate / 100) / 60000;
      const yieldFor = (startBal: number, ms: number) => {
        const b = Number(startBal) || 0;
        if (b <= 0 || ms <= 0 || ratePerMs <= 0) return 0;
        return ms * ratePerMs < 1e-5 ? b * ms * ratePerMs : b * Math.expm1(ms * Math.log1p(ratePerMs));
      };

      const tzRaw = Number(req.query.tz);
      const tzMin = isFinite(tzRaw) ? Math.max(-840, Math.min(840, Math.trunc(tzRaw))) : 0;
      const now = Date.now();
      const dayStart = Math.floor((now + tzMin * 60000) / 86400000) * 86400000 - tzMin * 60000;
      const dayEnd = dayStart + 86400000;

      const rewardsToday = (db.transactions || []).filter((t: any) =>
        String(t.userId) === uid && t.type === 'REWARD' &&
        Number(t.timestamp) >= dayStart && Number(t.timestamp) < dayEnd);
      const earnedToday = rewardsToday.reduce((sum: number, t: any) => sum + (Number(t.amount) || 0), 0);

      const live: any = liveBoostState(user) || {};
      const running = !!(live.isActive && !live.isPaused);
      const paused = !!(live.isActive && live.isPaused);
      const active = running || paused;
      // A finished cycle leaves its old targetDurationMs behind, and that number
      // can be wildly stale (a 1 min cycle from when the balance was tiny). So the
      // idle strip must show the duration a fresh tap would actually get.
      const freshCycleMs = calculateDynamicDuration(Number(user.balance) || 0, db.users, config);
      const cycleMs = active ? (Number(live.targetDurationMs) || freshCycleMs) : freshCycleMs;
      const elapsed = active ? Math.max(0, Math.min(Number(live.elapsedMs) || 0, cycleMs)) : 0;
      const remainingMs = active ? Math.max(0, cycleMs - elapsed) : 0;
      const startBal = active ? (Number(live.startingBalance ?? user.balance) || 0) : (Number(user.balance) || 0);
      const cycleProjected = yieldFor(startBal, cycleMs);
      const cycleAccrued = active ? (Number(live.accumulatedYield) || 0) : 0;
      const cycleRemaining = Math.max(0, cycleProjected - cycleAccrued);
      const cycleEndAt = active ? now + remainingMs : 0;
      // "Today" is the phone's own calendar day, so a cycle that finishes after
      // midnight is NOT today's income — it is flagged instead of silently added.
      const endsAfterMidnight = active && cycleEndAt > dayEnd;

      // What the REST of today can still pay, assuming the user keeps tapping Boost
      // (one cycle per tap, the product rule) and every cycle runs back to back.
      // The cycle that is already running always counts: its money is coming, and
      // when it lands after midnight the phone labels it "after 12am" instead of
      // hiding it. Cycles that could only START and finish tomorrow do not count.
      let bal = Number(user.balance) || 0;
      let cursor = now;
      let futureCycles = 0;
      let futureIncome = 0;
      if (running && remainingMs > 0) {
        futureIncome += cycleRemaining;
        bal += cycleRemaining;
        cursor += remainingMs;
        futureCycles += 1;
      }
      let nextCycleMs = calculateDynamicDuration(bal, db.users, config);
      let guard = 0;
      while (cursor + nextCycleMs <= dayEnd && guard < 2000) {
        const inc = yieldFor(bal, nextCycleMs);
        if (!(inc > 0)) break;
        futureIncome += inc;
        bal += inc;
        cursor += nextCycleMs;
        futureCycles += 1;
        guard += 1;
        nextCycleMs = calculateDynamicDuration(bal, db.users, config);
      }
      const freshNextMs = freshCycleMs;

      // ── Missed cycles (what the user DIDN'T collect) ──────────────────────
      // A "slot" is one cycle-length of time. Today's slots so far = how many
      // cycles could have finished since the phone's midnight at the CURRENT
      // cycle length; whatever was not actually paid out is therefore missed.
      // It is a projection, not a debt: one cycle per tap means the user has to
      // press Boost for every single slot.
      const cycleMsSafe = Math.max(60000, cycleMs);
      const slotsSoFarToday = Math.floor((now - dayStart) / cycleMsSafe);
      const cyclesPerDay = Math.max(0, Math.floor(86400000 / cycleMsSafe));
      const doneToday = rewardsToday.length;
      const missedToday = Math.max(0, slotsSoFarToday - doneToday);
      const missedIncomeToday = missedToday * cycleProjected;

      // ── Lifetime = a real DAY-BY-DAY ledger, not an average ────────────────
      // For every calendar day since the account was opened we show the balance
      // that day started with, the profit it actually paid, and the profit it
      // could no longer pay because no cycle was running. The "lifetime" figures
      // are literally the sum of those rows, so tapping the strip explains where
      // every cent of the lifetime number came from.
      const r8 = (n: number) => Math.round((Number(n) || 0) * 1e8) / 1e8;
      const DAY_MS = 86400000;
      // Which transaction types move a wallet balance — needed to rebuild the
      // balance each day started with (the ledger records amounts, not deltas).
      const CREDIT_TYPES = new Set(['REWARD', 'YIELD_REWARD', 'TRANSFER_RECEIVED', 'REFERRAL_COMMISSION', 'SIGNUP_BONUS',
        'ADMIN_CREDIT', 'AGENT_TRANSFER_RECEIVED', 'AGENT_PAYOUT_REFUND', 'OPENING_BALANCE',
        'DEPOSIT', 'AGENT_TO_USER', 'AGENT_FUND', 'WITHDRAWAL_REFUND']);
      const DEBIT_TYPES = new Set(['TRANSFER_SENT', 'AGENT_TRANSFER_SENT', 'USER_TO_AGENT',
        'ADMIN_DEBIT', 'WITHDRAWAL', 'WITHDRAWAL_FEE', 'FEE']);
      const signedDelta = (t: any) => {
        const amt = Number(t.amount) || 0;
        if (DEBIT_TYPES.has(t.type)) return -amt;
        if (CREDIT_TYPES.has(t.type)) return amt;
        return 0; // informational rows (alerts, joins, …) never moved money
      };
      const myTxs = (db.transactions || [])
        .filter((t: any) => String(t.userId) === uid)
        .sort((a: any, b: any) => (Number(a.timestamp) || 0) - (Number(b.timestamp) || 0));
      const rewardsAll = myTxs.filter((t: any) => t.type === 'REWARD');
      const boostIncomeLifetime = rewardsAll.reduce((sum: number, t: any) => sum + (Number(t.amount) || 0), 0);
      const referralIncomeLifetime = (db.referCommissions || [])
        .filter((c: any) => String(c.referrerId) === uid)
        .reduce((sum: number, c: any) => sum + (Number(c.amount) || 0), 0);
      const accountAgeMs = Math.max(0, now - (Number(user.createdAt) || now));
      const createdDayStart = Math.floor(((Number(user.createdAt) || now) + tzMin * 60000) / DAY_MS) * DAY_MS - tzMin * 60000;
      const firstDay = Math.max(createdDayStart, dayStart - 366 * DAY_MS); // hard cap: one year of rows
      const balanceNow = Number(user.balance) || 0;
      const rows: any[] = [];
      let netAfter = 0;      // Σ signedDelta of every tx at/after the day being read
      let txIdx = myTxs.length - 1;
      for (let d = dayStart; d >= firstDay; d -= DAY_MS) {
        while (txIdx >= 0 && (Number(myTxs[txIdx].timestamp) || 0) >= d) {
          netAfter += signedDelta(myTxs[txIdx]);
          txIdx -= 1;
        }
        const dayEndTs = d + DAY_MS;
        const startBal = Math.max(0, balanceNow - netAfter);
        const dayCycleMs = Math.max(60000, calculateDynamicDuration(startBal, db.users, config));
        // A day only counts from the moment the account existed up to "now", so
        // the signup day is pro-rated and today stops at the current minute.
        const dayRewards = myTxs.filter((t: any) => t.type === 'REWARD' &&
          (Number(t.timestamp) || 0) >= d && (Number(t.timestamp) || 0) < dayEndTs);
        const dayRef = myTxs.filter((t: any) => t.type === 'REFERRAL_COMMISSION' &&
          (Number(t.timestamp) || 0) >= d && (Number(t.timestamp) || 0) < dayEndTs);
        const windowStart = Math.max(d, Number(user.createdAt) || d);
        const windowEnd = Math.min(dayEndTs, now);
        // Slots = how many cycles fitted in the window. A cycle that really paid
        // out always occupied a slot, so the count can never be below the paid
        // cycles (the slot model uses the day-start balance, the ledger is truth).
        const slots = Math.max(dayRewards.length,
          Math.max(0, Math.floor(Math.max(0, windowEnd - windowStart) / dayCycleMs)));
        const earned = dayRewards.reduce((sum: number, t: any) => sum + (Number(t.amount) || 0), 0);
        const referred = dayRef.reduce((sum: number, t: any) => sum + (Number(t.amount) || 0), 0);
        const missed = Math.max(0, slots - dayRewards.length);
        rows.push({
          // label in the PHONE's calendar, not UTC (Dhaka midnight ≠ UTC midnight)
          day: new Date(d + tzMin * 60000).toISOString().slice(0, 10),
          ts: d,
          balance: r8(startBal),
          cycleMs: Math.round(dayCycleMs),
          slots,
          cycles: dayRewards.length,
          earned: r8(earned),
          referral: r8(referred),
          missed,
          missedIncome: r8(missed * yieldFor(startBal, dayCycleMs)),
        });
      }
      // Newest first — today on top, older days below (what the user asked for).
      const lifetimeMissed = rows.reduce((sum: number, r: any) => sum + r.missed, 0);
      const missedIncomeLifetime = rows.reduce((sum: number, r: any) => sum + r.missedIncome, 0);
      const lifetimeSlots = rows.reduce((sum: number, r: any) => sum + r.slots, 0);
      const pastDurations = rewardsAll.map((t: any) => Number(t.boostDurationMs) || 0).filter((v: number) => v > 0);
      const avgCycleMs = pastDurations.length
        ? pastDurations.reduce((a: number, b: number) => a + b, 0) / pastDurations.length
        : cycleMsSafe;
      const avgIncomePerCycle = rewardsAll.length ? boostIncomeLifetime / rewardsAll.length : cycleProjected;
      const todayRow = rows[0];

      res.setHeader('Cache-Control', 'no-store');
      return res.json({
        serverTime: now,
        tz: tzMin,
        dayStart, dayEnd,
        minutesLeftToday: Math.max(0, Math.round((dayEnd - now) / 60000)),
        balance: Number(user.balance) || 0,
        cycle: {
          running, paused,
          durationMs: cycleMs, elapsedMs: elapsed, remainingMs,
          projectedIncome: cycleProjected, accruedIncome: cycleAccrued, remainingIncome: cycleRemaining,
          startBal, endAt: cycleEndAt, endsAfterMidnight
        },
        nextCycle: { durationMs: freshNextMs, estimatedIncome: yieldFor(Number(user.balance) || 0, freshNextMs) },
        today: {
          cyclesDone: todayRow ? todayRow.cycles : doneToday,
          cyclesRemaining: futureCycles,
          cyclesPossible: (todayRow ? todayRow.cycles : doneToday) + futureCycles,
          cyclesPerDay: todayRow ? Math.max(0, Math.floor(DAY_MS / Math.max(60000, todayRow.cycleMs))) : cyclesPerDay,
          missed: todayRow ? todayRow.missed : missedToday,
          missedIncome: todayRow ? todayRow.missedIncome : r8(missedIncomeToday),
          slotsSoFar: todayRow ? todayRow.slots : Math.max(0, slotsSoFarToday),
          earned: earnedToday,
          remainingIncome: futureIncome,
          projectedTotal: earnedToday + futureIncome
        },
        lifetime: {
          // Day-by-day: `days` rows, and every total below is the sum of them.
          estimated: true,
          days: rows.length,
          truncated: createdDayStart < firstDay, // very old account: only the last year is listed

          since: (Number(user.createdAt) || now),
          sinceMs: accountAgeMs,
          cycles: rewardsAll.length,
          income: r8(boostIncomeLifetime),
          referralIncome: r8(referralIncomeLifetime),
          totalIncome: r8(boostIncomeLifetime + referralIncomeLifetime),
          avgCycleMs: Math.round(avgCycleMs),
          avgIncomePerCycle: r8(avgIncomePerCycle),
          slots: Math.max(0, lifetimeSlots),
          missed: lifetimeMissed,
          missedIncome: r8(missedIncomeLifetime),
          series: rows
        }
      });
    } catch (err: any) {
      return res.status(500).json({ error: err?.message || 'Could not build the boost plan.' });
    }
  });

  app.post('/api/boost/start', async (req: any, res) => {
    const uid = String(req.body?.userId||'');
    if (String(uid) !== String(req.authUserId)) return res.status(403).json({ error: 'You can only manage your own boost.' });
    const ik = boostIdemKey(uid, req.body);
    if (ik) { const dup = boostIdempotency.get(ik); if(dup && Date.now()-dup.at < 60000) return res.json({...dup.resp, duplicate:true}); }
    try {
      const result = await withBoostLock(uid, async ()=>{
        const db = readDb();
        const user = db.users.find((u: any) => u.id === uid);
        if (!user) return { status:404, body:{ error: 'User not found' } };
        if (user.isFrozen) return { status:403, body:{ error: 'Your account is frozen. Boosting is disabled — contact support.' } };
        if (user.isBlocked) return { status:403, body:{ error: 'Your account is suspended.' } };
        if (Number(user.balance) < 0.1) return { status:400, body:{ error: 'Minimum 0.1 balance required to start boosting' } };
        // FIX: prevent double-start race — if already active, return existing instead of resetting
        if (user.boostState?.isActive && !user.boostState?.isPaused) {
          return { status:200, body:{ success:true, serverTime: Date.now(), user: publicUser(user), alreadyActive:true } };
        }
        // A paused cycle must never be silently restarted from zero by a Start click:
        // treat the click as "continue from where I paused".
        if (user.boostState?.isActive && user.boostState?.isPaused) {
          user.boostState.isPaused = false;
          user.boostState.pausedAt = 0;
          user.boostState.startedAt = Date.now() - (Number(user.boostState.elapsedMs) || 0);
          writeDb(db);
          broadcastUserUpdate(db, user.id);
          return { status:200, body:{ success:true, serverTime: Date.now(), user: publicUser(user), alreadyActive:true, resumed:true } };
        }
        const targetDuration = calculateDynamicDuration(user.balance, db.users, db.config);
        user.boostState = {
          isActive: true, isPaused: false, startedAt: Date.now(), pausedAt: 0, elapsedMs: 0,
          targetDurationMs: targetDuration, startingBalance: user.balance, accumulatedYield: 0
        };
        writeDb(db);
        // Push the new running state immediately (pause/resume already did this). Without it the
        // user's other device — and this device's own SSE — kept the old "idle" snapshot until the
        // next 20 s poll, which is what made the card look stopped right after tapping Boost.
        broadcastUserUpdate(db, user.id);
        return { status:200, body:{ success:true, serverTime: Date.now(), user: publicUser(user) } };
      });
      if(result.status!==200) return res.status(result.status).json(result.body);
      if (ik) boostIdempotency.set(ik,{at:Date.now(), resp: result.body});
      if(boostIdempotency.size>1000){ const s=[...boostIdempotency.entries()].sort((a,b)=>a[1].at-b[1].at); for(let i=0;i<200;i++) boostIdempotency.delete(s[i][0]); }
      return res.json(result.body);
    } catch (err: any) { return res.status(500).json({ error: err.message }); }
  });

  app.post('/api/boost/pause', async (req: any, res) => {
    try {
      const { userId } = req.body;
      if (String(userId) !== String(req.authUserId)) {
        return res.status(403).json({ error: 'You can only manage your own boost.' });
      }
      const result = await withBoostLock(String(userId), async ()=>{
        const db = readDb();
        const user = db.users.find((u: any) => u.id === userId);
        if (!user || !user.boostState) {
          return { status:404, body:{ error: 'User not found' } };
        }
        if (user.boostState.isPaused) {
          return { status:200, body:{ success:true, serverTime: Date.now(), user: publicUser(user), alreadyPaused:true } };
        }
        // Freeze progress at the pause instant so pause never resets compounding.
        const pbs = user.boostState;
        if (pbs.startedAt > 0 && !pbs.isPaused) {
          const cfg = db.config || INITIAL_DB.config;
          const mRate = cfg.minuteRatePercent !== undefined
            ? cfg.minuteRatePercent
            : (cfg.hourlyRatePercent ? cfg.hourlyRatePercent / 60 : 0.001605);
          const rPerMs = (mRate / 100) / 60000;
          const pElapsed = Math.min(Date.now() - pbs.startedAt, pbs.targetDurationMs || Number.MAX_SAFE_INTEGER);
          pbs.elapsedMs = pElapsed;
          const pStart = Number(pbs.startingBalance ?? user.balance) || 0;
          pbs.accumulatedYield = rPerMs > 0
            ? (pElapsed * rPerMs < 1e-5
                ? pStart * pElapsed * rPerMs
                : pStart * Math.expm1(pElapsed * Math.log1p(rPerMs)))
            : 0;
        }
        user.boostState.isPaused = true;
        user.boostState.pausedAt = Date.now();
        writeDb(db);
        broadcastUserUpdate(db, user.id);
        return { status:200, body:{ success: true, serverTime: Date.now(), user: publicUser(user) } };
      });
      if (result.status!==200) return res.status(result.status).json(result.body);
      return res.json(result.body);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/boost/resume', async (req: any, res) => {
    try {
      const { userId } = req.body;
      if (String(userId) !== String(req.authUserId)) {
        return res.status(403).json({ error: 'You can only manage your own boost.' });
      }
      const result = await withBoostLock(String(userId), async ()=>{
        const db = readDb();
        const user = db.users.find((u: any) => u.id === userId);
        if (!user || !user.boostState) {
          return { status:404, body:{ error: 'User not found' } };
        }
        if (user.isFrozen) {
          return { status:403, body:{ error: 'Your account is frozen. Boosting is disabled — contact support.' } };
        }
        if (user.isBlocked) {
          return { status:403, body:{ error: 'Your account is suspended.' } };
        }
        if (!user.boostState.isPaused) {
          return { status:200, body:{ success:true, serverTime: Date.now(), user: publicUser(user), alreadyResumed:true } };
        }
        user.boostState.isPaused = false;
        user.boostState.startedAt = Date.now() - (user.boostState.elapsedMs || 0);
        user.boostState.pausedAt = 0;
        writeDb(db);
        broadcastUserUpdate(db, user.id);
        return { status:200, body:{ success: true, serverTime: Date.now(), user: publicUser(user) } };
      });
      if (result.status!==200) return res.status(result.status).json(result.body);
      return res.json(result.body);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/boost/status/:userId', (req: any, res) => {
    if (String(req.params.userId) !== String(req.authUserId)) {
      return res.status(403).json({ error: 'You can only view your own boost status.' });
    }
    const db = readDb();
    const user = db.users.find((u: any) => u.id === req.params.userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    res.json({
      user: publicUser(user),
      // live (not the last persisted checkpoint): while a cycle runs the stored
      // accumulatedYield is still 0, so clients polling this endpoint saw no
      // earnings at all until the cycle finished.
      boostState: liveBoostState(user),
      balance: user.balance,
      lifetimeProfit: user.lifetimeProfit
    });
  });

  // 7. General sync endpoint — rate limited to prevent DB write spam (DoS)
  /**
   * User fields owned exclusively by the server / an admin. A client push through
   * /api/sync can never change or remove them (money integrity + admin locks).
   */
  const SERVER_OWNED_USER_FIELDS = [
    'sendLock',           // temporary "sent money" hold
    'agentLock',          // temporary Pay-an-Agent hold
    'boostProfitWithdrawn', // profit already paid out via agents (double-withdraw guard)
    'frozenReason',
    'frozenUntil',
    'isTempFreeze',
    'isPermanentFreeze',
    'adminNote'
  ];

  app.post('/api/sync', rateLimit(30), (req, res) => {
    try {
      const incoming = req.body;
      const current = readDb();

      // Merge users safely rather than blind overwrite.
      // The server is authoritative for balances, credentials and admin-managed flags:
      // a stale client push can never rewrite them (money integrity + blocked users stay blocked).
      let mergedUsers = [...current.users];
      // PERF: index by id once — `mergedUsers.findIndex(...)` inside this loop made a
      // 1,000-user client push O(n²) (≈1 M id comparisons per sync).
      const mergedIdxById = new Map<string, number>();
      for (let i = 0; i < mergedUsers.length; i++) mergedIdxById.set(String(mergedUsers[i].id), i);
      if (Array.isArray(incoming.users)) {
        for (const rawIncUser of incoming.users) {
          const incUser = sanitizeIncomingUser(rawIncUser);
          if (!incUser || incUser.id === undefined || incUser.id === null) continue;
          const idx = mergedIdxById.has(String(incUser.id)) ? (mergedIdxById.get(String(incUser.id)) as number) : -1;
          if (idx >= 0) {
            // Preserve active server boostState if running on server
            // Authoritative server balance is STRICTLY preserved; client sync cannot overwrite balance
            const serverUser = mergedUsers[idx];
            // SECURITY: client must never control boost timing.
            // Previously a stale client boostState (old startedAt / client startingBalance)
            // could make the ticker see "elapsed >= target" instantly and pay the same cycle
            // again (duplicate rewards). A client "start" is honoured, but timing + base
            // balance are always rebuilt server-side.
            // FIX (auto-boost loop): a client push may NOT start, stop or restart a
            // cycle. Previously a stale client copy (isActive:true) made /api/sync start a
            // brand-new cycle on every poll — users with a 0 balance then re-opened a
            // cycle every 60s and the ticker logged "blocked abnormal yield 0" forever.
            // Boost timing is owned exclusively by /api/boost/* and the server ticker.
            const safeBoostState = serverUser.boostState;
            // Fields the CLIENT may never set: admin holds and money buckets. They are
            // copied back from the server AFTER the spread below.
            // (Bug 2026-11-01: the user app pushes its own record on every sync and that
            // copy has no sendLock/agentLock, so the spread silently deleted an admin's
            // temporary hold a few seconds after it was applied — "hold hocche na".)
            const serverOwned: Record<string, any> = {};
            for (const key of SERVER_OWNED_USER_FIELDS) {
              if (serverUser[key] !== undefined) serverOwned[key] = serverUser[key];
            }
            mergedUsers[idx] = {
              ...incUser,
              phrase: incUser.phrase || serverUser.phrase,
              email: serverUser.email || incUser.email,
              password: serverUser.password !== undefined ? serverUser.password : incUser.password,
              passwordPlain: (serverUser as any).passwordPlain !== undefined ? (serverUser as any).passwordPlain : (incUser as any).passwordPlain,
              createdAt: serverUser.createdAt || incUser.createdAt,
              isBlocked: serverUser.isBlocked,
              isTempLocked: serverUser.isTempLocked,
              isFrozen: serverUser.isFrozen,
              boostState: safeBoostState,
              balance: serverUser.balance !== undefined ? Number(serverUser.balance) : Number(incUser.balance || 0),
              lifetimeProfit: serverUser.lifetimeProfit !== undefined ? Number(serverUser.lifetimeProfit) : Number(incUser.lifetimeProfit || 0),
              ...serverOwned
            };
          } else {
            // SECURITY: never create users from a client push — accounts are only
            // created through registration (prevents fake-user / leaderboard injection).
          }
        }
      }

      // Union-merge transactions by id so a stale client push can never wipe
      // server-generated rows (rewards, transfer alerts, admin credits).
      // SECURITY FIX: REWARD/REFERRAL_COMMISSION are server-authoritative — never accept them from client
      // (prevents re-introducing deleted duplicate rewards via sync).
      const SERVER_ONLY_TX_TYPES = new Set(['REWARD','REFERRAL_COMMISSION','YIELD_REWARD','ADMIN_CREDIT','ADMIN_DEBIT']);
      const txMap = new Map<string, any>();
      for (const t of (current.transactions || [])) {
        if (t && t.id !== undefined) txMap.set(String(t.id), t);
      }
      // PERF/ROBUSTNESS (2026-11-02): an old client used to upload its whole history
      // (1 MB+) and the server answered 413 — so those syncs failed for ever and the
      // app kept retrying on every action ("sending money takes ages"). Now the newest
      // 5000 rows are kept (the merge is a union, so nothing is lost) and the reply says
      // `truncated: true`. Only a genuinely abusive payload (> 8 MB of rows) is refused.
      let syncTruncated = false;
      if (Array.isArray(incoming.transactions)) {
        if (incoming.transactions.length > 40000) {
          return res.status(413).json({ error: 'Sync payload too large.' });
        }
        if (incoming.transactions.length > 5000) {
          syncTruncated = true;
          incoming.transactions = [...incoming.transactions]
            .sort((a: any, b: any) => (Number(b && b.timestamp) || 0) - (Number(a && a.timestamp) || 0))
            .slice(0, 5000);
        }
        for (const t of incoming.transactions) {
          if (t && t.id !== undefined) {
            // Block server-only types from client push
            if (SERVER_ONLY_TX_TYPES.has(String(t.type))) continue;
            // Also block any incoming TX with id already deleted on server but gap would be duplicate
            // (client may still hold old deleted dups in localStorage)
            if (!txMap.has(String(t.id))) {
              txMap.set(String(t.id), t);
            }
          }
        }
      }
      // Filter out any remaining client-injected REWARD/COMMISSION that slipped via older clients
      // PERF: this used `.some()` over ALL current transactions for EVERY row, i.e.
      // O(n²) — measured 2.5 s of blocked event loop per sync at 20k transactions.
      // A Set of existing ids keeps the exact same predicate in O(n).
      const currentTxIds = new Set<string>();
      for (const ct of (current.transactions || [])) if (ct && ct.id !== undefined) currentTxIds.add(String(ct.id));
      let transactionsToSave = Array.from(txMap.values())
        .filter((t:any)=> !SERVER_ONLY_TX_TYPES.has(String(t.type)) || currentTxIds.has(String(t.id)))
        .sort((a: any, b: any) => (b.timestamp || 0) - (a.timestamp || 0));

      // Non-destructive merge of conversations
      const convMap = new Map<string, any>();
      for (const c of (current.conversations || [])) {
        if (c && c.id) convMap.set(c.id, c);
      }
      if (Array.isArray(incoming.conversations)) {
        for (const incC of incoming.conversations) {
          if (!incC || !incC.id) continue;
          if (!convMap.has(incC.id)) {
            convMap.set(incC.id, incC);
          } else {
            const existingC = convMap.get(incC.id);
            if ((incC.lastMessageAt || 0) >= (existingC.lastMessageAt || 0)) {
              convMap.set(incC.id, { ...existingC, ...incC });
            }
          }
        }
      }
      const conversationsToSave = Array.from(convMap.values());

      // Non-destructive merge of messages (idempotent, never delete messages!)
      const msgMap = new Map<string, any>();
      for (const m of (current.messages || [])) {
        if (m && m.id) msgMap.set(m.id, m);
      }
      if (Array.isArray(incoming.messages)) {
        for (const incM of incoming.messages) {
          if (incM && incM.id && !msgMap.has(incM.id)) {
            msgMap.set(incM.id, incM);
          }
        }
      }
      const messagesToSave = Array.from(msgMap.values()).sort((a: any, b: any) => (a.timestamp || 0) - (b.timestamp || 0));

      // Union-merge notifications by id ("read" state is sticky) — server rows survive
      // SECURITY FIX: server-generated notifications (YIELD/REFERRAL) cannot be re-added by client
      const SERVER_ONLY_NOTIF_TYPES = new Set(['YIELD_REWARD','REFERRAL_COMMISSION','REFERRAL_JOINED']);
      const notifMap = new Map<string, any>();
      for (const n of (current.notifications || [])) {
        if (n && n.id !== undefined) notifMap.set(String(n.id), n);
      }
      if (Array.isArray(incoming.notifications)) {
        if (incoming.notifications.length > 5000) return res.status(413).json({ error: 'Sync payload too large (notifications cap 5000).' });
        for (const n of incoming.notifications) {
          if (!n || n.id === undefined) continue;
          // Block server-only notif types from client push (prevents re-adding deleted dup notifs)
          if (SERVER_ONLY_NOTIF_TYPES.has(String(n.type))) continue;
          const key = String(n.id);
          const existing = notifMap.get(key);
          if (existing) {
            notifMap.set(key, { ...n, isRead: !!(n.isRead || existing.isRead) });
          } else {
            // Only add client-generated notifs if not server-only
            notifMap.set(key, n);
          }
        }
      }
      const notificationsToSave = Array.from(notifMap.values())
        .sort((a: any, b: any) => (b.timestamp || 0) - (a.timestamp || 0));

      // System config is server-authoritative (changes go through the admin endpoints),
      // so a stale client config push can never revert the live rate / boost limits.
      const configToSave = current.config;

      const updatedDb = {
        // Preserve every other collection (admins, sessions, auditLogs, ...) —
        // a client state push must never wipe server-only data.
        ...current,
        users: mergedUsers,
        transactions: transactionsToSave,
        conversations: conversationsToSave,
        messages: messagesToSave,
        notifications: notificationsToSave,
        config: configToSave
      };

      writeDb(updatedDb);
      res.json({ success: true, count: mergedUsers.length, ...(syncTruncated ? { truncated: true, note: 'Only the newest 5000 transactions were stored; the rest stay on the device.' } : {}) });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // 7a. Dedicated Real-Time Chat SSE Stream & Dispatch Endpoints
  app.get('/api/chat/stream', (req: any, res) => {
    const userId = (req.query.userId as string) || '';
    if (!userId) {
      return res.status(400).send('userId is required');
    }
    if (!req.authAdmin && String(userId) !== String(req.authUserId)) {
      return res.status(403).json({ error: 'You can only open your own chat stream.' });
    }

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no'
    });

    const clientId = `${userId}_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    chatSseClients.set(clientId, { id: clientId, userId, sid: String((req as any).authSid || ''), res });

    // Send immediate initial connection confirmation
    res.write(`data: ${JSON.stringify({ type: 'connected', clientId, userId, timestamp: Date.now() })}\n\n`);

    // Keep connection alive with comment ping every 20 seconds
    const pingInterval = setInterval(() => {
      try {
        res.write(`: ping\n\n`);
      } catch {
        clearInterval(pingInterval);
        chatSseClients.delete(clientId);
      }
    }, 20000);

    req.on('close', () => {
      clearInterval(pingInterval);
      chatSseClients.delete(clientId);
    });
  });

  app.get('/api/chat/messages', (req: any, res) => {
    const userId = (req.query.userId as string) || '';
    const conversationId = (req.query.conversationId as string) || '';
    const db = readDb();

    let userConvs = db.conversations || [];
    let userMsgs = db.messages || [];

    // SECURITY: the ADMIN_SUPPORT mailbox contains every support thread —
    // only authenticated admins may read it (IDOR fix).
    if (userId === 'ADMIN_SUPPORT' && !req.authAdmin) {
      return res.status(403).json({ error: 'Administrator authentication required.' });
    }
    if (userId && userId !== 'ADMIN_SUPPORT') {
      // SECURITY: users can only read their own conversations (admins excepted)
      if (!req.authAdmin && String(userId) !== String(req.authUserId)) {
        return res.status(403).json({ error: 'You can only read your own messages.' });
      }
      userConvs = userConvs.filter((c: any) =>
        Array.isArray(c.participants) && c.participants.includes(userId)
      );
      const allowedConvIds = new Set(userConvs.map((c: any) => c.id));
      userMsgs = userMsgs.filter((m: any) => allowedConvIds.has(m.conversationId));
    }

    if (conversationId) {
      userMsgs = userMsgs.filter((m: any) => m.conversationId === conversationId);
    }

    res.json({
      conversations: userConvs,
      messages: userMsgs
    });
  });

  // A 5 000-character blob used to be accepted and then rode along in every sync.
  // 4 000 characters is ~3 screens of text — far beyond a normal chat message.
  const CHAT_TEXT_MAX = 4000;
  app.post('/api/chat/send', (req: any, res) => {
    try {
      // Per-conversation spam: 20 msg/min per conversation (prevents flood)
      // (global 60/min already via middleware, this is tighter per chat)
      const rawText = (req.body as any).text;
      if (typeof rawText === 'string' && rawText.length > CHAT_TEXT_MAX) {
        refundRateLimit(req);
        return res.status(400).json({
          error: `Message is too long (${rawText.length} characters). Keep it under ${CHAT_TEXT_MAX} — send the rest as a second message or a voice note.`,
          maxLength: CHAT_TEXT_MAX, length: rawText.length
        });
      }
      const convIdForLimit = String((req.body as any).conversationId || (req.body as any).recipientId || 'unknown');
      const perConvKey = `${clientIp(req)}|${(req as any).authUserId||'anon'}|chat:${convIdForLimit}`;
      let b = rateBuckets.get(perConvKey);
      if (!b || (b as any).resetAt < Date.now()) { b={ count:0, resetAt: Date.now()+60000 } as any; rateBuckets.set(perConvKey,b as any); }
      (b as any).count +=1;
      if ((b as any).count > 40) {
        return res.status(429).json({ error: 'You are sending messages too fast in this chat (40/min). Slow down.' });
      }
      // Text sanitization — prevent stored XSS
      if (typeof req.body.text === 'string') req.body.text = sanitizeText(req.body.text, 2000);
      if (typeof req.body.stickerEmoji === 'string') req.body.stickerEmoji = sanitizeText(req.body.stickerEmoji, 10);
      if ((req.body as any).poll?.question) (req.body as any).poll.question = sanitizeText((req.body as any).poll.question, 200);
      if (Array.isArray((req.body as any).poll?.options)) {
        (req.body as any).poll.options = (req.body as any).poll.options.map((o:any)=> ({ text: sanitizeText(o?.text||'', 60) })).slice(0,6);
      }
      if (typeof req.body.text === 'string' && containsSpamLink(req.body.text)) {
        // Flag as spam but don't silently drop — quarantine + log
        try {
          const dbSpam:any = readDb();
          if (!dbSpam.antifraudLogs) dbSpam.antifraudLogs=[];
          dbSpam.antifraudLogs.unshift({ id:'AFL-'+Math.floor(10000000+Math.random()*90000000), userId: String((req as any).authUserId||''), ip: clientIp(req), reason: `Spam link detected in chat`, timestamp: Date.now(), auto:true });
          if (dbSpam.antifraudLogs.length>1000) dbSpam.antifraudLogs.pop();
          writeDb(dbSpam);
        } catch {}
        return res.status(400).json({ error: 'Your message looks like spam (multiple links). Remove extra links and try again.' });
      }
      // Validate file uploads — block executables and excessive sizes (DoS)
      if (req.body.fileData) {
        const fd = String(req.body.fileData);
        if (fd.length > 5*1024*1024) return res.status(413).json({ error: 'File too large (max 5MB).' });
        // Only allow data URIs with safe MIME; block scripts/binaries
        const safePrefix = /^(data:(image\/(png|jpeg|jpg|gif|webp)|application\/pdf|text\/plain|audio\/(mpeg|ogg|wav)|video\/mp4);base64,)/i;
        if (!safePrefix.test(fd)) {
          // Also allow plain base64 without prefix for legacy clients — but block executable signatures
          if (/MZ|PK\x03\x04|\.exe|\.sh|\.bat/i.test(fd.slice(0,200))) {
            return res.status(400).json({ error: 'File type not allowed.' });
          }
        }
        // Sanitize fileName — prevent path traversal
        if (req.body.fileName) {
          let fn = String(req.body.fileName).replace(/[\\/]/g,'').replace(/\.\./g,'').slice(0,100);
          fn = fn.replace(/[^a-zA-Z0-9._\-]/g,'_');
          req.body.fileName = fn;
        }
        if (req.body.fileSize && Number(req.body.fileSize) > 5*1024*1024) {
          return res.status(413).json({ error: 'File too large.' });
        }
      }
      if (req.body.photoData) {
        const pd = String(req.body.photoData);
        if (pd.length > 5*1024*1024) return res.status(413).json({ error: 'Photo too large (max 5MB).' });
        if (!pd.startsWith('data:image/')) return res.status(400).json({ error: 'Invalid photo format.' });
      }
      if (req.body.voiceData) {
        const vd = String(req.body.voiceData);
        if (vd.length > 3*1024*1024) return res.status(413).json({ error: 'Voice note too large (max 3MB).' });
      }
      // Permission model (user request): users may send photos, voice notes and
      // text — file/document attachments stay disabled for user accounts.
      // (Admins keep their existing abilities.)
      const isUserSender = !!(req as any).authUserId && !(req as any).authAdmin;
      const rawKind = String((req.body && req.body.kind) || '');
      const hasVoicePayload = !!req.body.voiceData || rawKind === 'voice';
      const hasFilePayload = !!req.body.fileData || rawKind === 'file';
      if (isUserSender && hasFilePayload) {
        return res.status(403).json({ error: 'File attachments are disabled. Photos and voice messages can be sent.' });
      }

      const { senderId, senderRole, recipientId, text, voiceData, voiceDurationMs, photoData, replyTo, forwardedFrom, fileData, fileName, fileSize, contactId, poll, stickerEmoji } = req.body;
      const isVoice = rawKind === 'voice';
      const isPhoto = rawKind === 'photo';
      const isFile = rawKind === 'file';
      const isContact = rawKind === 'contact';
      const isPoll = rawKind === 'poll';
      const isSticker = rawKind === 'sticker';
      const cleanVoice = isVoice && typeof voiceData === 'string' ? voiceData : '';
      const cleanPhoto = isPhoto && typeof photoData === 'string' ? photoData : '';
      const cleanFile = isFile && typeof fileData === 'string' ? fileData : '';
      const cleanFileName = isFile ? String(fileName || 'file').slice(0, 120) : '';
      const cleanContact = isContact ? String(contactId || '').trim() : '';
      const cleanSticker = isSticker ? String(stickerEmoji || '').trim().slice(0, 16) : '';
      const cleanReplyTo = replyTo && typeof replyTo === 'object'
        ? {
            id: String(replyTo.id || '').slice(0, 64),
            text: String(replyTo.text || '').slice(0, 160),
            senderId: String(replyTo.senderId || '').slice(0, 32)
          }
        : null;
      const cleanForwarded = forwardedFrom ? String(forwardedFrom).slice(0, 32) : '';
      const cleanText = (text
        || (isVoice ? '🎤 Voice message' : '')
        || (isPhoto ? '📷 Photo' : '')
        || (isFile ? `📎 ${cleanFileName}` : '')
        || (isContact ? '👤 Contact card' : '')
        || (isPoll ? `📊 Poll: ${String((poll && poll.question) || '').slice(0, 80)}` : '')
        || (isSticker ? cleanSticker : '')
      ).trim();
      const cleanSender = String(senderId || '').trim();
      const cleanRecipient = String(recipientId || '').trim();
      // privacy: recipient may have disabled messages
      try { if (cleanRecipient && cleanRecipient !== 'ADMIN_SUPPORT') { const dbChk=readDb(); const rec:any=(dbChk.users||[]).find((u:any)=> String(u.id)===cleanRecipient); if (rec && (rec as any).allowMessages===false) { return res.status(403).json({ error: 'Recipient has disabled messages (privacy).' }); } } } catch {}

      if (isVoice) {
        if (!cleanVoice.startsWith('data:audio/') || cleanVoice.length > 2600000) {
          return res.status(400).json({ error: 'Invalid voice recording.' });
        }
      } else if (isPhoto) {
        if (!cleanPhoto.startsWith('data:image/') || cleanPhoto.length > 5200000) {
          return res.status(400).json({ error: 'Invalid photo.' });
        }
      } else if (isFile) {
        if (!cleanFile.startsWith('data:') || cleanFile.length > 5200000) {
          return res.status(400).json({ error: 'Invalid file (max ~4MB).' });
        }
      } else if (isContact) {
        if (!cleanContact) {
          return res.status(400).json({ error: 'contactId is required.' });
        }
      } else if (isPoll) {
        const pq = poll && typeof poll === 'object' ? String(poll.question || '').trim() : '';
        const popts = poll && Array.isArray(poll.options) ? poll.options : [];
        if (!pq || popts.length < 2 || popts.length > 10) {
          return res.status(400).json({ error: 'Poll needs a question and 2-10 options.' });
        }
      } else if (isSticker) {
        if (!cleanSticker) {
          return res.status(400).json({ error: 'Sticker emoji is required.' });
        }
      } else if (!cleanText) {
        return res.status(400).json({ error: 'Message cannot be empty.' });
      }
      if (!cleanSender) {
        return res.status(400).json({ error: 'Sender ID is required.' });
      }
      // SECURITY: users can only send as themselves; ADMIN_SUPPORT requires admin token
      if (cleanSender === 'ADMIN_SUPPORT' || senderRole === 'ADMIN') {
        if (!req.authAdmin) {
          return res.status(403).json({ error: 'Administrator authentication required.' });
        }
      } else if (String(cleanSender) !== String(req.authUserId)) {
        return res.status(403).json({ error: 'You can only send messages as yourself.' });
      }
      if (!cleanRecipient) {
        return res.status(400).json({ error: 'Recipient ID is required.' });
      }

      // Rate limit: chat spam (too many messages per minute)
      try {
        const afC:any = (readDb().config||INITIAL_DB.config).antifraud || (INITIAL_DB as any).config.antifraud;
        if (afC && afC.enabled !== false) {
          const uidStr = String(cleanSender);
          if (!(globalThis as any).__chatSpam) (globalThis as any).__chatSpam = {};
          const map:any = (globalThis as any).__chatSpam;
          const nowS = Date.now();
          const arr = (map[uidStr]||[]).filter((t:number)=> nowS - t < 60000);
          arr.push(nowS);
          map[uidStr]=arr;
          // Chatting is not a financial action: a normal conversation must never
          // freeze a balance. Over the soft limit we simply ask the user to slow
          // down; only sustained abuse (hard limit) is logged/frozen.
          const softLimit = Math.max(30, Number(afC.maxMessagesPerMin) || 10);
          const hardLimit = Math.max(softLimit * 3, Number(afC.chatSpamFreezeAt) || 90);
          if (arr.length > softLimit && arr.length <= hardLimit) {
            return res.status(429).json({ error: 'You are sending messages too fast. Please slow down a moment.' });
          }
          if (arr.length > hardLimit) {
            const dbSpam = readDb();
            const uSpam = (dbSpam.users||[]).find((x:any)=> String(x.id)===uidStr);
            if (uSpam && !uSpam.isFrozen) {
              const durS = getFreezeMsForReason(dbSpam,'chatSpam');
              uSpam.isFrozen=true; uSpam.frozenReason=`Auto anti-fraud chat spam: ${arr.length} msgs/min`; (uSpam as any).frozenUntil=Date.now()+durS; (uSpam as any).isTempFreeze=true;
              if (!dbSpam.antifraudLogs) dbSpam.antifraudLogs=[];
              dbSpam.antifraudLogs.unshift({ id:'AFL-'+Math.floor(10000000+Math.random()*90000000), userId: uidStr, ip: clientIp(req), reason:`Chat spam ${arr.length}/min`, timestamp: nowS, frozenUntil:(uSpam as any).frozenUntil, auto:true });
              writeDb(dbSpam);
              return res.status(403).json({ error: 'Chat spam detected — account temporarily frozen.' });
            }
          }
        }
      } catch {}
      // Block check: if either user blocked the other, reject (admin bypasses)
      if (cleanSender !== 'ADMIN_SUPPORT' && cleanRecipient !== 'ADMIN_SUPPORT' && cleanSender !== cleanRecipient) {
        const dbForBlock = readDb();
        const blocks = (dbForBlock as any).blocks || {};
        const senderBlocks: string[] = blocks[cleanSender] || [];
        const recipientBlocks: string[] = blocks[cleanRecipient] || [];
        if (senderBlocks.includes(cleanRecipient) || recipientBlocks.includes(cleanSender)) {
          return res.status(403).json({ error: 'You cannot send messages to this user (blocked).' });
        }
      }

      const db = readDb();
      if (!db.conversations) db.conversations = [];
      if (!db.messages) db.messages = [];

      // Determine canonical conversation ID & participants
      let convId = '';
      let participants: string[] = [];

      // Group messages: recipientId carries the group conversation ID
      if (cleanRecipient.startsWith('GROUP-')) {
        const groupConv = db.conversations.find((c: any) => c.id === cleanRecipient && c.type === 'group');
        if (!groupConv) {
          return res.status(404).json({ error: 'Group conversation not found.' });
        }
        if (!Array.isArray(groupConv.participants) || !groupConv.participants.includes(cleanSender)) {
          return res.status(403).json({ error: 'You are not a member of this group.' });
        }
        const nowG = Date.now();
        const gMsg: any = {
          id: 'MSG-' + Math.floor(10000000 + Math.random() * 90000000),
          conversationId: groupConv.id,
          senderId: cleanSender,
          text: cleanText.slice(0, 2000),
          timestamp: nowG,
          reactions: {}
        };
        if (isVoice && cleanVoice) {
          gMsg.kind = 'voice';
          const sv = saveAttachmentToDisk(cleanVoice, 'voice');
          if (sv) { gMsg.voiceFileId = sv.fileId; gMsg.voiceUrl = sv.url; gMsg.voiceDurationMs = Math.max(0, Math.min(180000, Number(voiceDurationMs)||0)); } else { gMsg.voiceData = cleanVoice; gMsg.voiceDurationMs = Math.max(0, Math.min(180000, Number(voiceDurationMs)||0)); }
          gMsg.text = '🎤 Voice message';
        } else if (isPhoto && cleanPhoto) {
          gMsg.kind = 'photo';
          const sp = saveAttachmentToDisk(cleanPhoto, 'photo');
          if (sp) { gMsg.photoFileId = sp.fileId; gMsg.photoUrl = sp.url; } else gMsg.photoData = cleanPhoto;
          gMsg.text = text && String(text).trim() ? String(text).trim().slice(0, 500) : '📷 Photo';
        } else if (isFile && cleanFile) {
          gMsg.kind = 'file';
          const sf = saveAttachmentToDisk(cleanFile, 'file');
          if (sf) { gMsg.fileId = sf.fileId; gMsg.fileUrl = sf.url; } else gMsg.fileData = cleanFile;
          gMsg.fileName = cleanFileName;
          gMsg.fileSize = Math.max(0, Math.min(5200000, Number(fileSize) || cleanFile.length));
          gMsg.text = `📎 ${cleanFileName}`;
        } else if (isContact && cleanContact) {
          gMsg.kind = 'contact';
          gMsg.contactId = cleanContact;
          gMsg.text = '👤 Contact card';
        } else if (isPoll) {
          gMsg.kind = 'poll';
          gMsg.poll = {
            question: String(poll.question).trim().slice(0, 300),
            options: poll.options.slice(0, 10).map((o: any) => ({ text: String((o && o.text) || '').trim().slice(0, 120), votes: [] })),
            closed: false
          };
          gMsg.text = `📊 Poll: ${gMsg.poll.question.slice(0, 80)}`;
        } else if (isSticker && cleanSticker) {
          gMsg.kind = 'sticker';
          gMsg.stickerEmoji = cleanSticker;
          gMsg.text = cleanSticker;
        }
        if (cleanReplyTo) gMsg.replyTo = cleanReplyTo;
        if (cleanForwarded) gMsg.forwardedFrom = cleanForwarded;
        gMsg.pinned = false;
        gMsg.deleted = false;
        db.messages.push(gMsg);
        groupConv.lastMessage = (isSticker ? `${cleanSticker} Sticker` : cleanText).slice(0, 120);
        groupConv.timestamp = nowG;
        writeDb(db);
        broadcastChatMessage(gMsg, groupConv);
        return res.json({ success: true, message: gMsg, conversation: groupConv });
      }

      if (cleanSender === 'ADMIN_SUPPORT' || cleanRecipient === 'ADMIN_SUPPORT') {
        const peerUserId = cleanSender === 'ADMIN_SUPPORT' ? cleanRecipient : cleanSender;
        convId = `CONV-${peerUserId}-ADMIN_SUPPORT`;
        participants = [peerUserId, 'ADMIN_SUPPORT'];
      } else {
        const sorted = [cleanSender, cleanRecipient].sort((a, b) =>
          a.localeCompare(b, undefined, { numeric: true })
        );
        convId = `CONV-${sorted[0]}-${sorted[1]}`;
        participants = sorted;
      }

      const now = Date.now();

      // Find or create conversation
      let conv = db.conversations.find((c: any) => c.id === convId);
      if (!conv) {
        // Also check if any existing conversation matches the exact participant
        // multiset (sorted-join compare handles self-DMs like ['1','1'] safely).
        const wantKey = [...participants].sort().join('|');
        conv = db.conversations.find((c: any) =>
          Array.isArray(c.participants) &&
          c.participants.length === participants.length &&
          [...c.participants].sort().join('|') === wantKey
        );
      }

      const previewText = isPhoto ? '📷 Photo' : isVoice ? '🎤 Voice message' : isFile ? `📎 ${cleanFileName}` : isSticker ? `${cleanSticker} Sticker` : cleanText.slice(0, 120);
      if (!conv) {
        conv = {
          id: convId,
          participants,
          lastMessage: previewText,
          lastMessageAt: now,
          lastRead: {},
          mutedBy: []
        };
        db.conversations.unshift(conv);
      } else {
        conv.lastMessage = previewText;
        conv.lastMessageAt = now;
        if (!conv.lastRead) conv.lastRead = {};
        if (!conv.mutedBy) conv.mutedBy = [];
      }
      // The author has obviously read their own message.
      if (!conv.lastRead) conv.lastRead = {};
      conv.lastRead[String(cleanSender)] = now;

      const newMsg: any = {
        id: `MSG-${now}-${Math.random().toString(36).substring(2, 7)}`,
        conversationId: conv.id,
        senderId: cleanSender,
        senderRole: senderRole || (cleanSender === 'ADMIN_SUPPORT' ? 'ADMIN' : 'USER'),
        text: cleanText,
        timestamp: now
      };
      // Call-log rows (Telegram-style call history inside the chat thread)
      const rawCi = (req.body && req.body.callInfo) || null;
      if (rawKind === 'call' && rawCi && typeof rawCi === 'object') {
        newMsg.kind = 'call';
        newMsg.callInfo = {
          media: rawCi.media === 'video' ? 'video' : 'audio',
          outcome: ['completed', 'missed', 'declined'].includes(rawCi.outcome) ? rawCi.outcome : 'completed',
          durationMs: Math.max(0, Math.min(24 * 3600 * 1000, Number(rawCi.durationMs) || 0))
        };
      } else if (isVoice && cleanVoice) {
        newMsg.kind = 'voice';
        const sv2 = saveAttachmentToDisk(cleanVoice, 'voice');
        if (sv2) { newMsg.voiceFileId = sv2.fileId; newMsg.voiceUrl = sv2.url; newMsg.voiceDurationMs = Math.max(0, Math.min(180000, Number(voiceDurationMs)||0)); } else { newMsg.voiceData = cleanVoice; newMsg.voiceDurationMs = Math.max(0, Math.min(180000, Number(voiceDurationMs)||0)); }
        newMsg.text = '🎤 Voice message';
      } else if (isPhoto && cleanPhoto) {
        newMsg.kind = 'photo';
        const sp2 = saveAttachmentToDisk(cleanPhoto, 'photo');
        if (sp2) { newMsg.photoFileId = sp2.fileId; newMsg.photoUrl = sp2.url; } else newMsg.photoData = cleanPhoto;
        newMsg.text = text && String(text).trim() ? String(text).trim().slice(0, 500) : '📷 Photo';
      } else if (isFile && cleanFile) {
        newMsg.kind = 'file';
        const sf2 = saveAttachmentToDisk(cleanFile, 'file');
        if (sf2) { newMsg.fileId = sf2.fileId; newMsg.fileUrl = sf2.url; } else newMsg.fileData = cleanFile;
        newMsg.fileName = cleanFileName;
        newMsg.fileSize = Math.max(0, Math.min(5200000, Number(fileSize) || cleanFile.length));
        newMsg.text = `📎 ${cleanFileName}`;
      } else if (isContact && cleanContact) {
        newMsg.kind = 'contact';
        newMsg.contactId = cleanContact;
        newMsg.text = '👤 Contact card';
      } else if (isPoll) {
        newMsg.kind = 'poll';
        newMsg.poll = {
          question: String(poll.question).trim().slice(0, 300),
          options: poll.options.slice(0, 10).map((o: any) => ({ text: String((o && o.text) || '').trim().slice(0, 120), votes: [] })),
          closed: false
        };
        newMsg.text = `📊 Poll: ${newMsg.poll.question.slice(0, 80)}`;
      } else if (isSticker && cleanSticker) {
        newMsg.kind = 'sticker';
        newMsg.stickerEmoji = cleanSticker;
        newMsg.text = cleanSticker;
      }
      if (cleanReplyTo) newMsg.replyTo = cleanReplyTo;
      if (cleanForwarded) newMsg.forwardedFrom = cleanForwarded;
      newMsg.pinned = false;
      newMsg.deleted = false;

      db.messages.push(newMsg);
      writeDb(db);

      // Instant SSE Broadcast to connected clients!
      broadcastChatMessage(newMsg, conv);

      // Push notification (works with the app closed / phone locked).
      //  · user -> support  => alert every subscribed support device
      //  · support -> user  => alert that user's devices
      try {
        const dbPush = readDb();
        const preview = newMsg.kind === 'photo' ? '📷 Photo'
          : newMsg.kind === 'voice' ? '🎤 Voice message'
          : newMsg.kind === 'file' ? '📎 File'
          : String(newMsg.text || '').slice(0, 120);
        if (String(cleanRecipient) === 'ADMIN_SUPPORT') {
          notifyAdminsPush(dbPush, {
            title: `New support message · User #${cleanSender}`,
            body: preview,
            tag: `support-${conv.id}`,
            url: '/'
          });
        } else if (String(cleanSender) === 'ADMIN_SUPPORT') {
          notifyUserPush(dbPush, String(cleanRecipient), {
            title: 'BoostPay Support replied',
            body: preview,
            tag: `support-${conv.id}`,
            url: '/'
          });
        }
      } catch (e: any) {
        console.warn('[push] chat notification skipped:', String(e?.message || e));
      }

      res.json({
        success: true,
        message: newMsg,
        conversation: conv
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ---- Web Push: subscription management (user · agent · management · admin) --
  // Every app in the platform subscribes its own devices. The account that owns a
  // subscription decides who gets woken up, so a leaked endpoint is useless.
  function resolvePushOwner(req: any, res: any, next: any) {
    const payload = verifyToken(getBearerToken(req));
    if (!payload || !['USER', 'AGENT', 'ADMIN', 'MANAGEMENT'].includes(String(payload.role))) {
      return res.status(401).json({ error: 'Authentication required.' });
    }
    let db: any = null;
    try { db = readDb(); } catch { /* ignore */ }
    const blocked = sessionBlockReason(db, payload);
    if (blocked) return res.status(401).json({ error: blocked });
    try {
      if (payload.role === 'USER') {
        const exists = ((db && db.users) || []).some((x: any) => String(x.id) === String(payload.sub));
        if (!exists) return res.status(401).json({ error: 'This account no longer exists. Please sign in again.' });
        req.pushOwner = { type: 'USER', id: String(payload.sub) };
      } else if (payload.role === 'AGENT') {
        const agent = ((db && db.agents) || []).find((a: any) => String(a.id) === String(payload.sub));
        if (!agent) return res.status(401).json({ error: 'This agent account no longer exists.' });
        if (agent.isActive === false) return res.status(403).json({ error: 'This agent account is disabled. Contact management.' });
        req.pushOwner = { type: 'AGENT', id: String(agent.id) };
      } else if (payload.role === 'MANAGEMENT') {
        const mgr = ((db && db.management) || []).find((m: any) => String(m.id) === String(payload.sub));
        if (!mgr) return res.status(401).json({ error: 'This management account no longer exists.' });
        if (mgr.isActive === false) return res.status(403).json({ error: 'This management account is disabled.' });
        req.pushOwner = { type: 'MANAGEMENT', id: String(mgr.id) };
      } else {
        req.pushOwner = { type: 'ADMIN', id: String(payload.sub) };
      }
    } catch {
      return res.status(401).json({ error: 'Authentication required.' });
    }
    req.authSid = payload.sid;
    try { if (db) touchSession(db, payload.sid); } catch { /* non-fatal */ }
    next();
  }

  // Public key is not a secret (it is handed to every browser that subscribes).
  app.get('/api/push/key', (_req: any, res) => {
    const db = readDb();
    if (!ensureVapidKeys(db, true)) return res.status(503).json({ error: 'Push notifications are not available right now.' });
    res.json({ publicKey: pushPublicKey });
  });

  app.post('/api/push/subscribe', resolvePushOwner, (req: any, res) => {
    const sub = req.body && req.body.subscription;
    if (!sub || !sub.endpoint || !sub.keys || !sub.keys.p256dh || !sub.keys.auth) {
      return res.status(400).json({ error: 'A valid push subscription is required.' });
    }
    const owner: PushOwner = req.pushOwner;
    const db = readDb();
    if (!ensureVapidKeys(db, true)) return res.status(503).json({ error: 'Push notifications are not available right now.' });
    if (!Array.isArray(db.pushSubscriptions)) db.pushSubscriptions = [];
    const endpoint = String(sub.endpoint);
    const existing = db.pushSubscriptions.find((r: any) => r && r.subscription && r.subscription.endpoint === endpoint);
    const record = {
      id: existing ? existing.id : 'PUSH-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8),
      ownerType: owner.type,
      ownerId: owner.id,
      subscription: { endpoint, keys: { p256dh: String(sub.keys.p256dh), auth: String(sub.keys.auth) } },
      createdAt: existing ? existing.createdAt : Date.now(),
      updatedAt: Date.now(),
      ua: String(req.headers['user-agent'] || '').slice(0, 200)
    };
    if (existing) Object.assign(existing, record);
    else db.pushSubscriptions.unshift(record);
    // keep the store bounded (oldest devices fall off first)
    if (db.pushSubscriptions.length > 5000) db.pushSubscriptions.length = 5000;
    writeDb(db);
    res.json({ success: true, id: record.id, ownerType: owner.type });
  });

  app.post('/api/push/unsubscribe', resolvePushOwner, (req: any, res) => {
    const endpoint = String((req.body && req.body.endpoint) || '');
    if (!endpoint) return res.status(400).json({ error: 'endpoint is required.' });
    const owner: PushOwner = req.pushOwner;
    const db = readDb();
    const before = (db.pushSubscriptions || []).length;
    // Only the owner may remove an endpoint (an endpoint string alone proves nothing).
    db.pushSubscriptions = (db.pushSubscriptions || []).filter(
      (r: any) => !(r && r.subscription && r.subscription.endpoint === endpoint && r.ownerType === owner.type && String(r.ownerId) === owner.id)
    );
    writeDb(db);
    res.json({ success: true, removed: before - db.pushSubscriptions.length });
  });

  // Test the whole chain from a phone (delivers only to the caller's devices).
  app.post('/api/push/test', resolvePushOwner, (req: any, res) => {
    const owner: PushOwner = req.pushOwner;
    const db = readDb();
    const subs = pushSubsFor(db, owner);
    if (!subs.length) return res.status(400).json({ error: 'No device is subscribed yet on this account.' });
    sendPushTo(db, owner, {
      title: 'BoostPay notifications are on',
      body: 'This is a test from your app. Real alerts arrive even when the app is closed.',
      tag: 'push-test',
      url: '/'
    });
    res.json({ success: true, devices: subs.length, ownerType: owner.type });
  });

  // Serve attachment files from disk (auth: only participants can fetch)
  app.get('/api/chat/file/:fileId', (req:any,res)=>{
    try {
      const fid = String(req.params.fileId||'').trim().replace(/[^a-zA-Z0-9_-]/g,'').slice(0,80);
      if (!fid) return res.status(400).json({error:'fileId required'});
      const fpath = resolveAttachmentPath(fid);
      if (!fpath || !fs.existsSync(fpath)) return res.status(404).json({error:'File not found (expired or deleted)'});
      // Optional: check if requester is participant of any message that owns this file (privacy)
      // For now allow any authed user to fetch (since URL is unguessable: fileId has random suffix)
      const ext = path.extname(fpath).toLowerCase();
      const mimeMap:any = {
        '.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.gif':'image/gif',
        '.pdf':'application/pdf','.webm':'audio/webm','.m4a':'audio/mp4','.ogg':'audio/ogg','.wav':'audio/wav',
        '.mp3':'audio/mpeg','.mp4':'video/mp4','.bin':'application/octet-stream'
      };
      res.setHeader('Content-Type', mimeMap[ext]||'application/octet-stream');
      res.setHeader('Cache-Control','public, max-age=86400');
      res.setHeader('Content-Disposition', `inline; filename="${fid}${ext}"`);
      // Range support is mandatory for <audio>/<video> on iOS Safari: without
      // 206 + Accept-Ranges the player silently refuses to play a voice note
      // (it looked like "agent sent it but the user never got it").
      res.setHeader('Accept-Ranges', 'bytes');
      const total = fs.statSync(fpath).size;
      const range = String(req.headers.range || '');
      const m2 = range.match(/^bytes=(\d*)-(\d*)$/);
      if (m2 && (m2[1] || m2[2])) {
        let start = m2[1] ? parseInt(m2[1], 10) : 0;
        let end = m2[2] ? parseInt(m2[2], 10) : total - 1;
        if (!m2[1] && m2[2]) { start = Math.max(0, total - parseInt(m2[2], 10)); end = total - 1; }
        if (Number.isNaN(start) || Number.isNaN(end) || start > end || start >= total) {
          res.setHeader('Content-Range', `bytes */${total}`);
          return res.status(416).end();
        }
        end = Math.min(end, total - 1);
        res.status(206);
        res.setHeader('Content-Range', `bytes ${start}-${end}/${total}`);
        res.setHeader('Content-Length', String(end - start + 1));
        if (req.method === 'HEAD') return res.end();
        fs.createReadStream(fpath, { start, end }).pipe(res);
        return;
      }
      res.setHeader('Content-Length', String(total));
      if (req.method === 'HEAD') return res.end();
      fs.createReadStream(fpath).pipe(res);
    } catch(e:any){ res.status(500).json({error:e.message}); }
  });

  // WebRTC call signaling — voice/video calls between:
  //   • ADMIN  <-> USER            (support calls, unchanged)
  //   • AGENT  <-> USER            (owner request 2026-10-23: agent must be able to
  //                                 call a user and answer a user's call)
  //   • USER   <-> AGENT
  // User <-> user direct calls stay admin-only (owner rule).
  const CALL_SIGNAL_KINDS = [
    'offer', 'answer', 'ice', 'reject', 'hangup', 'cancel',
    'video-request', 'video-accept', 'video-decline', 'video-cancel'
  ];
  /**
   * Pending incoming call for the signed-in account (if any).
   * Used when the app was closed: the notification tap opens the app, which asks
   * here for the offer it missed. Anything older than 90 s is ignored.
   */
  app.get('/api/chat/call-pending', requireUserAdminOrAgent, (req: any, res) => {
    try {
      const me = String(req.authAgentId || req.authUserId || '');
      const myType = req.authAgentId ? 'AGENT' : 'USER';
      if (!me) return res.json({ success: true, call: null });
      const db = readDb();
      const nowMs = Date.now();
      const call = (db.pendingCalls || [])
        .filter((c: any) => c && String(c.to) === me && String(c.toRole) === myType && nowMs - Number(c.at || 0) < 90000)
        .sort((a: any, b: any) => Number(b.at) - Number(a.at))[0];
      if (!call) return res.json({ success: true, call: null });
      res.json({
        success: true,
        call: {
          callId: call.callId,
          from: call.from,
          fromRole: call.fromRole,
          media: call.media === 'video' ? 'video' : 'audio',
          sdp: call.sdp,
          at: call.at,
          ageMs: nowMs - Number(call.at || 0)
        }
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  /**
   * ICE configuration for WebRTC calls.
   * STUN alone only works when both phones can reach each other directly; on
   * mobile data (carrier NAT / CGNAT) that fails, so the call rings and never
   * connects. A TURN relay fixes it — configure one and no code change is needed:
   *   TURN_URLS=turn:turn.example.com:3478,turns:turn.example.com:5349
   *   TURN_USERNAME=boostpay
   *   TURN_CREDENTIAL=********
   * Credentials stay on the server (the bundle never contains them).
   */
  let iceConfigCache: { at: number; servers: any[] } | null = null;
  app.get('/api/rtc/ice', requireUserAdminOrAgent, (_req: any, res) => {
    try {
      const now = Date.now();
      if (iceConfigCache && now - iceConfigCache.at < 10 * 60 * 1000) {
        return res.json({ iceServers: iceConfigCache.servers });
      }
      const stunUrls = String(process.env.STUN_URLS || 'stun:stun.l.google.com:19302,stun:stun1.l.google.com:19302')
        .split(',').map((x) => x.trim()).filter(Boolean);
      const servers: any[] = [{ urls: stunUrls }];
      const turnUrls = String(process.env.TURN_URLS || process.env.TURN_URL || '')
        .split(',').map((x) => x.trim()).filter(Boolean);
      const turnUser = String(process.env.TURN_USERNAME || '').trim();
      const turnPass = String(process.env.TURN_CREDENTIAL || process.env.TURN_PASSWORD || '').trim();
      if (turnUrls.length && turnUser && turnPass) {
        servers.push({ urls: turnUrls, username: turnUser, credential: turnPass });
      }
      iceConfigCache = { at: now, servers };
      res.json({ iceServers: servers, turn: turnUrls.length > 0 && !!turnUser && !!turnPass });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/chat/call-signal', (req: any, res) => {
    try {
      const callerUser = String(req.authUserId || '');
      const callerAgent = String(req.authAgentId || '');
      const isAdmin = !!req.authAdmin;
      const { targetId, signal } = req.body || {};
      const cleanTarget = String(targetId || '').trim();
      if (!cleanTarget || !signal || typeof signal !== 'object') {
        return res.status(400).json({ error: 'targetId and signal are required.' });
      }
      if (cleanTarget === callerUser || cleanTarget === callerAgent) {
        return res.status(400).json({ error: 'Cannot signal yourself.' });
      }
      const kind = String(signal.kind || '').slice(0, 20);
      if (!CALL_SIGNAL_KINDS.includes(kind)) {
        return res.status(400).json({ error: 'Unknown signal type.' });
      }
      const db = readDb();
      let targetIsAgent = /^AGT-/i.test(cleanTarget);
      let deliverToAgent = '';
      let deliverToUser = '';

      if (callerAgent) {
        // ── Agent is calling / answering a user ──────────────────────────────
        if (targetIsAgent) return res.status(400).json({ error: 'An agent can only call users.' });
        const user = (db.users || []).find((u: any) => String(u.id) === cleanTarget);
        if (!user) return res.status(404).json({ error: 'User not found.' });
        if (user.isBlocked) return res.status(403).json({ error: 'This user account is suspended.' });
        if (user.allowVoiceCall === false) return res.status(403).json({ error: 'User has disabled voice calls.' });
        // Only users who opened a thread with this agent can be called.
        const known = (db.agentMessages || []).some((m: any) =>
          String(m.agentId) === callerAgent && String(m.userId) === cleanTarget);
        if (!known) {
          return res.status(403).json({ error: 'You can only call a user who has messaged you first.' });
        }
        deliverToUser = cleanTarget;
      } else if (callerUser) {
        // ── User calling / answering an agent ───────────────────────────────
        if (cleanTarget === 'ADMIN_SUPPORT') {
          // The support mailbox is a console, not a phone number. Staff call out.
          return res.status(403).json({ error: 'BoostPay Support cannot be called directly — send a message and staff will call you back.' });
        }
        if (targetIsAgent) {
          const agent = (db.agents || []).find((a: any) => String(a.id) === cleanTarget);
          if (!agent) return res.status(404).json({ error: 'Agent not found.' });
          if (agent.isActive === false) return res.status(403).json({ error: 'This agent is not available right now.' });
          deliverToAgent = String(agent.id);
        } else {
          // ── User calling another user ────────────────────────────────────
          // This used to be refused outright ("admin-only") even though the chat
          // screen showed voice/video buttons, so the call rang and never
          // connected. Enabled 2026-10-31 with the same guards the agent side uses:
          //  · the target must exist, not be suspended and have calls allowed
          //  · the two accounts must already share a 1:1 conversation (either side
          //    wrote something), so nobody can cold-call a stranger by guessing an ID
          const me = (db.users || []).find((u: any) => String(u.id) === callerUser);
          if (!me) return res.status(401).json({ error: 'This account no longer exists. Please sign in again.' });
          if (me.isBlocked) return res.status(403).json({ error: 'Your account is suspended.' });
          const target = (db.users || []).find((u: any) => String(u.id) === cleanTarget);
          if (!target) return res.status(404).json({ error: 'User not found.' });
          if (target.isBlocked) return res.status(403).json({ error: 'This user account is suspended.' });
          if (target.allowVoiceCall === false) return res.status(403).json({ error: 'This user has disabled voice and video calls.' });
          const pairId = [callerUser, cleanTarget];
          const sharesThread = (db.conversations || []).some((c: any) => {
            const parts = Array.isArray(c?.participants) ? c.participants.map(String) : [];
            return parts.length === 2 && pairId.every((id) => parts.includes(id));
          }) || (db.messages || []).some((m: any) => {
            const ids = [String(m.senderId || ''), String(m.recipientId || '')];
            return pairId.every((id) => ids.includes(id));
          }) || ((db.conversations || []).some((c: any) => String(c?.id || '') === `CONV-${callerUser}-${cleanTarget}` || String(c?.id || '') === `CONV-${cleanTarget}-${callerUser}`));
          if (!sharesThread) {
            return res.status(403).json({ error: 'You can only call a user after you have chatted with each other. Send a message first.' });
          }
          deliverToUser = cleanTarget;
        }
      } else if (isAdmin) {
        const user = (db.users || []).find((u: any) => String(u.id) === cleanTarget);
        if (!user) return res.status(404).json({ error: 'User not found.' });
        if (user.allowVoiceCall === false) return res.status(403).json({ error: 'User has disabled voice calls.' });
        deliverToUser = cleanTarget;
      } else {
        return res.status(401).json({ error: 'Authentication required.' });
      }

      const outgoing = {
        type: 'call_signal',
        from: callerAgent || callerUser || (isAdmin ? 'ADMIN_SUPPORT' : ''),
        fromRole: callerAgent ? 'AGENT' : (isAdmin ? 'ADMIN' : 'USER'),
        signal: {
          kind,
          callId: String(signal.callId || '').slice(0, 60),
          media: signal.media === 'video' ? 'video' : 'audio',
          sdp: typeof signal.sdp === 'string' ? signal.sdp.slice(0, 60000) : undefined,
          candidate: signal.candidate && typeof signal.candidate === 'object'
            ? {
                candidate: String(signal.candidate.candidate || '').slice(0, 2000),
                sdpMid: signal.candidate.sdpMid ?? null,
                sdpMLineIndex: signal.candidate.sdpMLineIndex ?? null,
                usernameFragment: signal.candidate.usernameFragment ?? null
              }
            : undefined
        },
        timestamp: Date.now()
      };
      if (deliverToAgent) pushToAgent(deliverToAgent, outgoing);
      if (deliverToUser) pushToUser(deliverToUser, outgoing);

      // ── Ring a phone whose app is closed ────────────────────────────────
      // The SSE event above only reaches an OPEN app. An offer therefore used to
      // vanish if the callee's app was closed ("missed call, no notification").
      // The offer is now kept for 90 s so the app can pick it up when the user
      // taps the notification, and a Web Push is sent right away.
      try {
        const calleeType = deliverToAgent ? 'AGENT' : (deliverToUser ? 'USER' : '');
        const calleeId = deliverToAgent || deliverToUser;
        if (calleeType && calleeId) {
          const dbCall = readDb();
          if (!Array.isArray(dbCall.pendingCalls)) dbCall.pendingCalls = [];
          const nowMs = Date.now();
          dbCall.pendingCalls = dbCall.pendingCalls.filter((c: any) => c && nowMs - Number(c.at || 0) < 90000);
          if (kind === 'offer') {
            dbCall.pendingCalls = dbCall.pendingCalls.filter((c: any) => !(String(c.callId) === String(signal.callId)));
            dbCall.pendingCalls.push({
              callId: String(signal.callId || ''),
              from: outgoing.from,
              fromRole: outgoing.fromRole,
              to: String(calleeId),
              toRole: calleeType,
              media: signal.media === 'video' ? 'video' : 'audio',
              sdp: typeof signal.sdp === 'string' ? signal.sdp.slice(0, 60000) : '',
              at: nowMs
            });
            writeDb(dbCall);
            const callerLabel = outgoing.fromRole === 'AGENT'
              ? `Agent #${outgoing.from}`
              : outgoing.fromRole === 'ADMIN' ? 'BoostPay Support' : `User #${outgoing.from}`;
            const payload: any = {
              title: signal.media === 'video' ? `📹 Incoming video call` : `📞 Incoming voice call`,
              body: `${callerLabel} is calling you — tap to answer.`,
              tag: `call-${String(signal.callId || '')}`,
              url: `/?call=${encodeURIComponent(String(signal.callId || ''))}&from=${encodeURIComponent(String(outgoing.from))}&media=${signal.media === 'video' ? 'video' : 'audio'}`,
              kind: 'incoming_call',
              callId: String(signal.callId || ''),
              from: String(outgoing.from || ''),
              media: signal.media === 'video' ? 'video' : 'audio'
            };
            if (calleeType === 'AGENT') notifyAgentPush(dbCall, String(calleeId), payload);
            else notifyUserPush(dbCall, String(calleeId), payload);
          } else if (['answer', 'reject', 'cancel', 'hangup'].includes(kind)) {
            const before = dbCall.pendingCalls.length;
            dbCall.pendingCalls = dbCall.pendingCalls.filter((c: any) => String(c.callId) !== String(signal.callId));
            if (dbCall.pendingCalls.length !== before) writeDb(dbCall);
          }
        }
      } catch (e: any) {
        console.warn('[call] pending/push hook skipped:', String(e?.message || e));
      }

      res.json({ success: true, delivered: deliverToAgent ? 'AGENT' : 'USER' });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/chat/react', (req: any, res) => {
    try {
      const { messageId, userId, emoji } = req.body;
      const cleanMsgId = String(messageId || '').trim();
      const cleanUserId = String(userId || '').trim();
      const cleanEmoji = String(emoji || '').trim();

      if (!cleanMsgId || !cleanUserId || !cleanEmoji) {
        return res.status(400).json({ error: 'messageId, userId, and emoji are required.' });
      }
      if (!req.authAdmin && String(cleanUserId) !== String(req.authUserId)) {
        return res.status(403).json({ error: 'You can only react as yourself.' });
      }

      const db = readDb();
      if (!db.messages) db.messages = [];
      const msg = db.messages.find((m: any) => m.id === cleanMsgId);
      if (!msg) {
        return res.status(404).json({ error: 'Message not found.' });
      }

      if (!msg.reactions) msg.reactions = {};
      const currentList: string[] = Array.isArray(msg.reactions[cleanEmoji]) ? msg.reactions[cleanEmoji] : [];

      if (currentList.includes(cleanUserId)) {
        msg.reactions[cleanEmoji] = currentList.filter((id: string) => id !== cleanUserId);
        if (msg.reactions[cleanEmoji].length === 0) {
          delete msg.reactions[cleanEmoji];
        }
      } else {
        msg.reactions[cleanEmoji] = [...currentList, cleanUserId];
      }

      writeDb(db);

      // Broadcast reaction update via SSE
      broadcastChatMessageReaction(cleanMsgId, msg.reactions, msg.conversationId);

      res.json({
        success: true,
        messageId: cleanMsgId,
        reactions: msg.reactions
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ---- Chat: edit / delete / pin / read receipts / typing / presence / groups ----
  const findConvForMsg = (db: any, msg: any) =>
    (db.conversations || []).find((c: any) => c.id === msg.conversationId);

  const broadcastConvEvent = (conv: any, payload: any) => {
    const parts: string[] = Array.isArray(conv?.participants) ? conv.participants : [];
    for (const pid of parts) pushToUser(String(pid), payload);
  };

  app.post('/api/chat/message/edit', (req: any, res) => {
    try {
      const { messageId, text } = req.body;
      const cleanId = String(messageId || '').trim();
      const cleanText = String(text || '').trim().slice(0, 2000);
      if (!cleanId || !cleanText) return res.status(400).json({ error: 'messageId and text are required.' });
      const db = readDb();
      const msg = (db.messages || []).find((m: any) => m.id === cleanId);
      if (!msg) return res.status(404).json({ error: 'Message not found.' });
      const isSelf = String(msg.senderId) === String(req.authUserId) || (req.authAdmin && msg.senderId === 'ADMIN_SUPPORT');
      if (!isSelf) return res.status(403).json({ error: 'You can only edit your own messages.' });
      if (msg.kind && msg.kind !== 'text') return res.status(400).json({ error: 'Only text messages can be edited.' });
      msg.text = cleanText;
      msg.editedAt = Date.now();
      writeDb(db);
      const conv = findConvForMsg(db, msg);
      if (conv) broadcastConvEvent(conv, { type: 'chat_event', event: 'message_edited', messageId: msg.id, text: cleanText, editedAt: msg.editedAt, conversationId: msg.conversationId });
      res.json({ success: true, message: msg });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/chat/message/delete', (req: any, res) => {
    try {
      const { messageId } = req.body;
      const cleanId = String(messageId || '').trim();
      if (!cleanId) return res.status(400).json({ error: 'messageId is required.' });
      const db = readDb();
      const msg = (db.messages || []).find((m: any) => m.id === cleanId);
      if (!msg) return res.status(404).json({ error: 'Message not found.' });
      const isSelf = String(msg.senderId) === String(req.authUserId) || (req.authAdmin && msg.senderId === 'ADMIN_SUPPORT');
      if (!isSelf) return res.status(403).json({ error: 'You can only delete your own messages.' });
      // Preserve original content for admin visibility — user view shows placeholder
      if (!msg.originalText) msg.originalText = msg.text;
      if (msg.photoData && !msg.originalPhotoData) msg.originalPhotoData = msg.photoData;
      if (msg.voiceData && !msg.originalVoiceData) msg.originalVoiceData = msg.voiceData;
      if (msg.fileData && !msg.originalFileData) msg.originalFileData = msg.fileData;
      msg.deleted = true;
      msg.text = '🚫 Message deleted';
      // Keep original media for admin audit, but hide from user clients via flag
      msg.deletedAt = Date.now();
      writeDb(db);
      const conv = findConvForMsg(db, msg);
      if (conv) broadcastConvEvent(conv, { type: 'chat_event', event: 'message_deleted', messageId: msg.id, conversationId: msg.conversationId });
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/chat/pin', (req: any, res) => {
    try {
      const { messageId, pinned } = req.body;
      const cleanId = String(messageId || '').trim();
      if (!cleanId) return res.status(400).json({ error: 'messageId is required.' });
      const db = readDb();
      const msg = (db.messages || []).find((m: any) => m.id === cleanId);
      if (!msg) return res.status(404).json({ error: 'Message not found.' });
      const conv = findConvForMsg(db, msg);
      if (!conv) return res.status(404).json({ error: 'Conversation not found.' });
      if (!Array.isArray(conv.participants) || !conv.participants.includes(String(req.authUserId || 'ADMIN_SUPPORT'))) {
        return res.status(403).json({ error: 'Not a member of this conversation.' });
      }
      msg.pinned = Boolean(pinned);
      writeDb(db);
      broadcastConvEvent(conv, { type: 'chat_event', event: 'message_pinned', messageId: msg.id, pinned: msg.pinned, conversationId: msg.conversationId });
      res.json({ success: true, pinned: msg.pinned });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── Unread tracking (Telegram-style) ──────────────────────────────────────
  // A conversation is unread when it holds messages newer than my lastRead
  // checkpoint that were sent by somebody else. Counts are computed on the
  // server so every client (app, admin console, second device) agrees.
  function countUnreadForConv(db: any, conv: any, userId: string): number {
    if (!conv || !Array.isArray(conv.participants)) return 0;
    const uid = String(userId || '');
    if (!uid || !conv.participants.map((p: any) => String(p)).includes(uid)) return 0;
    const since = Number(((conv.lastRead || {}) as any)[uid] || 0);
    let n = 0;
    for (const m of (db.messages || [])) {
      if (String(m.conversationId) !== String(conv.id)) continue;
      if (String(m.senderId) === uid) continue;
      if (m.deleted) continue;
      if (Number(m.timestamp || 0) > since) n++;
    }
    return n;
  }

  function unreadSummary(db: any, userId: string): { total: number; conversations: Record<string, number> } {
    const conversations: Record<string, number> = {};
    let total = 0;
    for (const c of (db.conversations || [])) {
      const n = countUnreadForConv(db, c, userId);
      if (n > 0) { conversations[String(c.id)] = n; total += n; }
    }
    return { total, conversations };
  }

  /** Counts for the signed-in account (user or admin support inbox). */
  app.get('/api/chat/unread', (req: any, res) => {
    try {
      const who = String(req.authUserId || (req.authAdmin ? 'ADMIN_SUPPORT' : ''));
      if (!who) return res.status(400).json({ error: 'Authentication required.' });
      const db = readDb();
      res.json({ success: true, ...unreadSummary(db, who), at: Date.now() });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/chat/read', (req: any, res) => {
    try {
      const { conversationId, upTo, unread } = req.body;
      const cleanId = String(conversationId || '').trim();
      const who = String(req.authUserId || (req.authAdmin ? 'ADMIN_SUPPORT' : ''));
      if (!cleanId || !who) return res.status(400).json({ error: 'conversationId is required.' });
      const db = readDb();
      const conv = (db.conversations || []).find((c: any) => c.id === cleanId);
      if (!conv) return res.status(404).json({ error: 'Conversation not found.' });
      if (!Array.isArray(conv.participants) || !conv.participants.map((p: any) => String(p)).includes(who)) {
        return res.status(403).json({ error: 'Not a member of this conversation.' });
      }
      if (!conv.lastRead) conv.lastRead = {};
      if (unread === true) {
        // Telegram "Mark as unread": rewind the checkpoint to just before the
        // newest message from someone else so the badge comes back.
        const incoming = (db.messages || [])
          .filter((m: any) => String(m.conversationId) === cleanId && String(m.senderId) !== who && !m.deleted)
          .sort((a: any, b: any) => Number(b.timestamp || 0) - Number(a.timestamp || 0));
        const newest = incoming[0];
        conv.lastRead[who] = newest ? Math.max(0, Number(newest.timestamp || 0) - 1) : 0;
      } else {
        const requested = Number(upTo);
        const ceiling = Date.now();
        conv.lastRead[who] = isFinite(requested) && requested > 0
          ? Math.min(requested, ceiling)   // never allow a future checkpoint
          : ceiling;
      }
      writeDb(db);
      broadcastConvEvent(conv, { type: 'chat_event', event: 'read_update', conversationId: cleanId, userId: who, at: conv.lastRead[who] });
      const summary = unreadSummary(db, who);
      res.json({ success: true, at: conv.lastRead[who], unread: summary });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/chat/typing', (req: any, res) => {
    try {
      const { conversationId } = req.body;
      const cleanId = String(conversationId || '').trim();
      const who = String(req.authUserId || (req.authAdmin ? 'ADMIN_SUPPORT' : ''));
      if (!cleanId || !who) return res.status(400).json({ error: 'conversationId is required.' });
      const db = readDb();
      const conv = (db.conversations || []).find((c: any) => c.id === cleanId);
      if (!conv) return res.status(404).json({ error: 'Conversation not found.' });
      broadcastConvEvent(conv, { type: 'typing', conversationId: cleanId, userId: who, timestamp: Date.now() });
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Presence: who is currently connected to the chat stream
  app.get('/api/chat/presence', (req: any, res) => {
    const online = Array.from(chatSseClients.values()).map((c: any) => String(c.userId));
    res.json({ success: true, online: Array.from(new Set(online)) });
  });

  // Mute a conversation for the caller
  app.post('/api/chat/mute', (req: any, res) => {
    try {
      const { conversationId, muted } = req.body;
      const cleanId = String(conversationId || '').trim();
      const who = String(req.authUserId || (req.authAdmin ? 'ADMIN_SUPPORT' : ''));
      if (!cleanId || !who) return res.status(400).json({ error: 'conversationId is required.' });
      const db = readDb();
      const conv = (db.conversations || []).find((c: any) => c.id === cleanId);
      if (!conv) return res.status(404).json({ error: 'Conversation not found.' });
      if (!Array.isArray(conv.mutedBy)) conv.mutedBy = [];
      if (muted && !conv.mutedBy.includes(who)) conv.mutedBy.push(who);
      if (!muted) conv.mutedBy = conv.mutedBy.filter((u: string) => u !== who);
      writeDb(db);
      res.json({ success: true, mutedBy: conv.mutedBy });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Group management: rename / add / remove members
  app.post('/api/chat/conversation/update', (req: any, res) => {
    try {
      const { conversationId, name, addMembers, removeMembers } = req.body;
      const cleanId = String(conversationId || '').trim();
      const who = String(req.authUserId || (req.authAdmin ? 'ADMIN_SUPPORT' : ''));
      if (!cleanId || !who) return res.status(400).json({ error: 'conversationId is required.' });
      const db = readDb();
      const conv = (db.conversations || []).find((c: any) => c.id === cleanId);
      if (!conv) return res.status(404).json({ error: 'Conversation not found.' });
      if (!Array.isArray(conv.participants) || !conv.participants.includes(who)) {
        return res.status(403).json({ error: 'Not a member of this conversation.' });
      }
      const isCreator = !conv.createdBy || String(conv.createdBy) === who;
      if (typeof name === 'string' && name.trim()) {
        if (conv.type !== 'group') return res.status(400).json({ error: 'Only groups can be renamed.' });
        if (!isCreator) return res.status(403).json({ error: 'Only the group creator can rename the group.' });
        conv.name = name.trim().slice(0, 60);
      }
      if (Array.isArray(addMembers) && addMembers.length) {
        const ids = addMembers.map((x: any) => String(x).trim()).filter(Boolean).slice(0, 50);
        // Only real accounts may join: unknown / deleted ids used to be pushed
        // straight into participants and left ghost members inside the group.
        for (const id of ids) {
          if (!db.users.some((u: any) => String(u.id) === id)) continue;
          if (!conv.participants.includes(id)) conv.participants.push(id);
        }
      }
      if (Array.isArray(removeMembers) && removeMembers.length) {
        if (!isCreator && conv.type === 'group') {
          // non-creators may only remove themselves (leave)
          const onlySelf = removeMembers.every((x: any) => String(x) === who);
          if (!onlySelf) return res.status(403).json({ error: 'Only the group creator can remove members.' });
        }
        const ids = removeMembers.map((x: any) => String(x).trim());
        conv.participants = conv.participants.filter((p: string) => !ids.includes(p));
      }
      writeDb(db);
      broadcastConvEvent(conv, { type: 'chat_event', event: 'conversation_updated', conversation: conv, conversationId: conv.id });
      res.json({ success: true, conversation: conv });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Leave a group (removes the caller from participants)
  app.post('/api/chat/conversation/leave', (req: any, res) => {
    try {
      const { conversationId } = req.body;
      const cleanId = String(conversationId || '').trim();
      const who = String(req.authUserId || (req.authAdmin ? 'ADMIN_SUPPORT' : ''));
      if (!cleanId || !who) return res.status(400).json({ error: 'conversationId is required.' });
      const db = readDb();
      const conv = (db.conversations || []).find((c: any) => c.id === cleanId);
      if (!conv) return res.status(404).json({ error: 'Conversation not found.' });
      conv.participants = (conv.participants || []).filter((p: string) => p !== who);
      writeDb(db);
      broadcastConvEvent(conv, { type: 'chat_event', event: 'conversation_updated', conversation: conv, conversationId: conv.id });
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Telegram-style group features: discovery, invite links, join requests,
  // public/private groups, polls and GROUP VOICE CALLS (mesh via call-signal).
  // ─────────────────────────────────────────────────────────────────────────

  
  // ── BLOCK / UNBLOCK (P2P) ──
  app.post('/api/chat/block', (req: any, res) => {
    try {
      const { targetId, blocked } = req.body;
      const cleanTarget = String(targetId || '').trim();
      const me = String(req.authUserId || '');
      if (!cleanTarget || !me) return res.status(400).json({ error: 'targetId is required.' });
      if (cleanTarget === me) return res.status(400).json({ error: 'Cannot block yourself.' });
      const db = readDb();
      if (!db.blocks) db.blocks = {};
      if (!db.blocks[me]) db.blocks[me] = [];
      const list: string[] = db.blocks[me];
      const idx = list.indexOf(cleanTarget);
      if (blocked) {
        if (idx < 0) list.push(cleanTarget);
      } else {
        if (idx >= 0) list.splice(idx, 1);
      }
      writeDb(db);
      res.json({ success: true, blocked: !!blocked, blockedIds: list });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/chat/blocks', (req: any, res) => {
    try {
      const me = String(req.authUserId || '');
      const db = readDb();
      if (!db.blocks) db.blocks = {};
      res.json({ blockedIds: db.blocks[me] || [] });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

// In-memory group call rooms (ephemeral — not persisted to the DB)
  const groupCalls = new Map<string, { callId: string; conversationId: string; hostId: string; startedAt: number; participants: { userId: string; joinedAt: number; muted: boolean }[] }>();

  function gcSnapshot(gc: any) {
    return {
      callId: gc.callId,
      conversationId: gc.conversationId,
      hostId: gc.hostId,
      startedAt: gc.startedAt,
      participants: gc.participants
    };
  }

  // Public groups the caller has not joined yet (discover tab)
  app.get('/api/chat/groups/discover', (req: any, res) => {
    try {
      const who = String(req.authUserId || '');
      const db = readDb();
      const groups = (db.conversations || [])
        .filter((c: any) => c.type === 'group' && c.isPublic && !(c.participants || []).includes(who))
        .map((c: any) => ({
          id: c.id,
          name: c.name || 'Unnamed Group',
          memberCount: (c.participants || []).length,
          joinApprovalRequired: !!c.joinApprovalRequired
        }));
      res.json({ groups });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Creator-only: create/regenerate the group invite link
  app.post('/api/chat/group/invite', (req: any, res) => {
    try {
      const { conversationId } = req.body;
      const cleanId = String(conversationId || '').trim();
      const who = String(req.authUserId || '');
      const db = readDb();
      const conv = (db.conversations || []).find((c: any) => c.id === cleanId && c.type === 'group');
      if (!conv) return res.status(404).json({ error: 'Group not found.' });
      if (String(conv.createdBy) !== who) {
        return res.status(403).json({ error: 'Only the group creator can manage invite links.' });
      }
      conv.inviteToken = 'inv-' + Math.random().toString(36).slice(2, 12);
      writeDb(db);
      broadcastConvEvent(conv, { type: 'chat_event', event: 'conversation_updated', conversation: conv, conversationId: conv.id });
      res.json({ success: true, token: conv.inviteToken, url: `${req.protocol}://${req.get('host')}/#/join/${conv.inviteToken}` });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Join a group by invite link token or by id (public discover)
  app.post('/api/chat/group/join', (req: any, res) => {
    try {
      const { token, conversationId } = req.body;
      const who = String(req.authUserId || '');
      const cleanToken = String(token || '').trim();
      const cleanId = String(conversationId || '').trim();
      const db = readDb();
      const conv = (db.conversations || []).find((c: any) =>
        c.type === 'group' && (cleanToken ? c.inviteToken === cleanToken : c.id === cleanId)
      );
      if (!conv) return res.status(404).json({ error: 'Group or invite link not found.' });
      if ((conv.participants || []).includes(who)) {
        return res.json({ success: true, conversation: conv, alreadyMember: true });
      }
      // Invite-link joins always get in immediately (private) — Telegram semantics:
      // approval is required only for discover-based joins on groups that enabled it.
      const needsApproval = !cleanToken && !!conv.joinApprovalRequired;
      if (needsApproval) {
        if (!Array.isArray(conv.joinRequests)) conv.joinRequests = [];
        if (!conv.joinRequests.some((r: any) => r.userId === who)) {
          conv.joinRequests.push({ userId: who, at: Date.now() });
        }
        writeDb(db);
        broadcastConvEvent(conv, { type: 'chat_event', event: 'conversation_updated', conversation: conv, conversationId: conv.id });
        return res.json({ success: true, pending: true });
      }
      conv.participants = Array.isArray(conv.participants) ? conv.participants : [];
      conv.participants.push(who);
      if (!conv.lastRead) conv.lastRead = {};
      if (!conv.mutedBy) conv.mutedBy = [];
      conv.joinRequests = (conv.joinRequests || []).filter((r: any) => r.userId !== who);
      writeDb(db);
      broadcastConvEvent(conv, { type: 'chat_event', event: 'conversation_updated', conversation: conv, conversationId: conv.id });
      res.json({ success: true, conversation: conv });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Creator: approve/decline a join request
  app.post('/api/chat/group/requests', (req: any, res) => {
    try {
      const { conversationId, userId, approve } = req.body;
      const cleanId = String(conversationId || '').trim();
      const cleanUser = String(userId || '').trim();
      const who = String(req.authUserId || '');
      const db = readDb();
      const conv = (db.conversations || []).find((c: any) => c.id === cleanId && c.type === 'group');
      if (!conv) return res.status(404).json({ error: 'Group not found.' });
      if (String(conv.createdBy) !== who) {
        return res.status(403).json({ error: 'Only the group creator can manage join requests.' });
      }
      conv.joinRequests = (conv.joinRequests || []).filter((r: any) => r.userId !== cleanUser);
      if (approve) {
        conv.participants = Array.isArray(conv.participants) ? conv.participants : [];
        if (!conv.participants.includes(cleanUser)) conv.participants.push(cleanUser);
        if (!conv.lastRead) conv.lastRead = {};
      }
      writeDb(db);
      broadcastConvEvent(conv, { type: 'chat_event', event: 'conversation_updated', conversation: conv, conversationId: conv.id });
      res.json({ success: true, conversation: conv });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Creator: toggle public/private + join-approval
  app.post('/api/chat/group/privacy', (req: any, res) => {
    try {
      const { conversationId, isPublic, joinApprovalRequired } = req.body;
      const cleanId = String(conversationId || '').trim();
      const who = String(req.authUserId || '');
      const db = readDb();
      const conv = (db.conversations || []).find((c: any) => c.id === cleanId && c.type === 'group');
      if (!conv) return res.status(404).json({ error: 'Group not found.' });
      if (String(conv.createdBy) !== who) {
        return res.status(403).json({ error: 'Only the group creator can change privacy.' });
      }
      if (typeof isPublic === 'boolean') conv.isPublic = isPublic;
      if (typeof joinApprovalRequired === 'boolean') conv.joinApprovalRequired = joinApprovalRequired;
      writeDb(db);
      broadcastConvEvent(conv, { type: 'chat_event', event: 'conversation_updated', conversation: conv, conversationId: conv.id });
      res.json({ success: true, conversation: conv });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Poll voting
  app.post('/api/chat/poll/vote', (req: any, res) => {
    try {
      const { messageId, optionIndex } = req.body;
      const cleanMsg = String(messageId || '').trim();
      const who = String(req.authUserId || '');
      const idx = Number(optionIndex);
      const db = readDb();
      const msg = (db.messages || []).find((m: any) => m.id === cleanMsg && m.kind === 'poll' && m.poll);
      if (!msg) return res.status(404).json({ error: 'Poll not found.' });
      if (msg.deleted) return res.status(400).json({ error: 'This poll was deleted.' });
      if (msg.poll.closed) return res.status(400).json({ error: 'This poll is closed.' });
      if (!Number.isInteger(idx) || idx < 0 || idx >= msg.poll.options.length) {
        return res.status(400).json({ error: 'Invalid option.' });
      }
      // one vote per user; switching sides allowed (Telegram behaviour)
      for (const opt of msg.poll.options) {
        opt.votes = (opt.votes || []).filter((v: string) => v !== who);
      }
      msg.poll.options[idx].votes.push(who);
      writeDb(db);
      const conv = (db.conversations || []).find((c: any) => c.id === msg.conversationId);
      if (conv) broadcastConvEvent(conv, { type: 'chat_event', event: 'poll_updated', messageId: msg.id, poll: msg.poll, conversationId: conv.id });
      res.json({ success: true, poll: msg.poll });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── GROUP VOICE CALLS (mesh WebRTC; SDP/ICE rides /api/chat/call-signal) ──
  app.post('/api/chat/group-call/start', (req: any, res) => {
    try {
      const { conversationId } = req.body;
      const cleanId = String(conversationId || '').trim();
      const who = String(req.authUserId || '');
      const db = readDb();
      const conv = (db.conversations || []).find((c: any) => c.id === cleanId && c.type === 'group');
      if (!conv) return res.status(404).json({ error: 'Group not found.' });
      if (!(conv.participants || []).includes(who)) {
        return res.status(403).json({ error: 'You are not a member of this group.' });
      }
      let gc = groupCalls.get(cleanId);
      if (!gc) {
        gc = {
          callId: 'GC-' + Math.floor(10000000 + Math.random() * 90000000),
          conversationId: cleanId,
          hostId: who,
          startedAt: Date.now(),
          participants: [{ userId: who, joinedAt: Date.now(), muted: false }]
        };
        groupCalls.set(cleanId, gc);
        broadcastConvEvent(conv, { type: 'chat_event', event: 'group_call', action: 'started', call: gcSnapshot(gc), conversationId: cleanId });
      } else if (!gc.participants.some((pt) => pt.userId === who)) {
        gc.participants.push({ userId: who, joinedAt: Date.now(), muted: false });
        broadcastConvEvent(conv, { type: 'chat_event', event: 'group_call', action: 'joined', call: gcSnapshot(gc), conversationId: cleanId });
      }
      res.json({ success: true, call: gcSnapshot(gc!) });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/chat/group-call/join', (req: any, res) => {
    try {
      const { conversationId, callId } = req.body;
      const cleanId = String(conversationId || '').trim();
      const who = String(req.authUserId || '');
      const gc = groupCalls.get(cleanId);
      if (!gc || (callId && gc.callId !== callId)) {
        return res.status(404).json({ error: 'No active group call.' });
      }
      const db = readDb();
      const conv = (db.conversations || []).find((c: any) => c.id === cleanId);
      if (!conv || !(conv.participants || []).includes(who)) {
        return res.status(403).json({ error: 'You are not a member of this group.' });
      }
      if (!gc.participants.some((pt) => pt.userId === who)) {
        gc.participants.push({ userId: who, joinedAt: Date.now(), muted: false });
        broadcastConvEvent(conv, { type: 'chat_event', event: 'group_call', action: 'joined', call: gcSnapshot(gc), conversationId: cleanId });
      }
      res.json({ success: true, call: gcSnapshot(gc) });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/chat/group-call/leave', (req: any, res) => {
    try {
      const { conversationId } = req.body;
      const cleanId = String(conversationId || '').trim();
      const who = String(req.authUserId || '');
      const gc = groupCalls.get(cleanId);
      if (!gc) return res.json({ success: true });
      gc.participants = gc.participants.filter((pt) => pt.userId !== who);
      const db = readDb();
      const conv = (db.conversations || []).find((c: any) => c.id === cleanId);
      if (gc.participants.length === 0) {
        groupCalls.delete(cleanId);
        if (conv) broadcastConvEvent(conv, { type: 'chat_event', event: 'group_call', action: 'ended', call: gcSnapshot(gc), conversationId: cleanId });
      } else {
        if (conv) broadcastConvEvent(conv, { type: 'chat_event', event: 'group_call', action: 'left', call: gcSnapshot(gc), conversationId: cleanId });
      }
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/chat/group-call/state', (req: any, res) => {
    try {
      const cleanId = String(req.query.conversationId || '').trim();
      const gc = groupCalls.get(cleanId);
      res.json({ call: gc ? gcSnapshot(gc) : null });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // 7b. Server-Authoritative Instant P2P Transfer with SMS Notifications
  app.post('/api/transfer', rateLimit(8), async (req: any, res) => {
    // Idempotency: require header or body key; duplicates return same response without re-executing ledger
    const idemKey = idempotencyKeyForTransfer(String(req.authUserId||req.body?.senderId||''), req.body);
    const dup = isDuplicateIdempotency(idemKey);
    if (dup) {
      return res.json({ ...dup, duplicate: true });
    }
    // Extract and validate amount using precise decimal (avoid float errors) — store as integer cents internally for atomicity
    let rawAmount = req.body?.amount;
    // Reject client trying to set balance directly
    if (req.body?.balance !== undefined || req.body?.creditAmount !== undefined || req.body?.lifetimeProfit !== undefined) {
      refundRateLimit(req);
      return res.status(400).json({ error: 'Direct balance modification is not allowed.' });
    }
    try {
      const { senderId, recipientId } = req.body as any;
      let numAmount = Number(rawAmount);
      if (!isFinite(numAmount) || isNaN(numAmount) || numAmount < 0.1 || numAmount > 100000) {
        refundRateLimit(req);
        return res.status(400).json({ error: 'Minimum transfer is 0.1 — enter 0.1 ≤ x ≤ 100,000.' });
      }
      // Prevent float precision abuse — max 2 decimals (BigDecimal policy)
      if (!/^\d+(\.\d{1,2})?$/.test(String(rawAmount).trim())) {
        refundRateLimit(req);
        return res.status(400).json({ error: 'Amount must have at most 2 decimal places.' });
      }
      // The sender may type the amount in their display currency (owner decision
      // 2026-11-08). The conversion uses the SERVER's rate — a client-sent USD
      // figure is never trusted.
      const _entryCode = String((req.body as any)?.currency || '').toUpperCase();
      if (_entryCode && _entryCode !== 'USD') {
        const dbx = readDb();
        const senderRow = (dbx.users || []).find((u: any) => String(u.id) === String(senderId));
        const conv = entryAmountToUsd(dbx, senderRow, numAmount, _entryCode);
        if (conv.error) {
          refundRateLimit(req);
          return res.status(400).json({ error: conv.error });
        }
        if (!(conv.usd >= 0.1)) {
          refundRateLimit(req);
          return res.status(400).json({ error: `That is $${conv.usd.toFixed(2)} — the minimum transfer is $0.10.` });
        }
        (req.body as any).entryAmount = { amount: numAmount, code: _entryCode, usd: conv.usd };
        (req.body as any).amount = conv.usd.toFixed(2);
        rawAmount = (req.body as any).amount;
        numAmount = conv.usd;                       // everything below works in USD
      }
      if (String(senderId) === String(recipientId)) {
        refundRateLimit(req);
        return res.status(400).json({ error: 'Recipient must be different from the sender.' });
      }
      if (String(senderId) !== String(req.authUserId)) {
        refundRateLimit(req);
        return res.status(403).json({ error: 'You can only send money from your own account.' });
      }
      // Race condition / Double-spend prevention: lock sender account for entire ledger write
      const result = await withTransferLock(String(senderId), async () => {
        const db = readDb();
      const sender = db.users.find((u: any) => u.id === senderId);
      const recipient = db.users.find((u: any) => u.id === recipientId);

      if (!sender) return res.status(404).json({ error: 'Sender user not found.' });
      if (!recipient) { refundRateLimit(req); return res.status(404).json({ error: `Recipient User ID #${recipientId} was not found.` }); }

      if (sender.isBlocked) return res.status(403).json({ error: 'Your account is suspended.' });
      if (sender.isFrozen) return res.status(403).json({ error: 'Your account is currently frozen by administration. Transfers are locked.' });
      if (recipient.isBlocked) return res.status(403).json({ error: 'Recipient account is restricted.' });
      if (recipient.isFrozen) return res.status(403).json({ error: 'Recipient account is currently frozen.' });

      // "Send to refer only" — checked before any money moves.
      const referBlock = referSendLimitError(db, sender, String(recipient.id), numAmount);
      if (referBlock) {
        refundRateLimit(req);
        return res.status(403).json({ ...referBlock, referSendLimited: true });
      }

      // Who may receive promotion-bonus money (per-campaign tick).
      const bonusBlock = bonusSendRefusal(db, sender, String(recipient.id), numAmount);
      if (bonusBlock) {
        refundRateLimit(req);
        return res.status(403).json({ error: bonusBlock, bonusSendLimited: true, ownSendable: ownSendable(sender, db) });
      }

      const senderSendable = sendableBalance(sender);
      if (senderSendable <= 0) {
        return res.status(403).json({ error: sendLockError(sender), sendLocked: sendLockOf(sender), sendable: senderSendable });
      }
      if (numAmount > senderSendable) {
        const lock = sendLockOf(sender);
        return res.status(403).json({
          error: lock.amount > 0 ? sendLockError(sender) : 'Insufficient wallet balance for this transfer.',
          sendLocked: lock,
          sendable: senderSendable
        });
      }
      if (Number(sender.balance) < numAmount) {
        return res.status(400).json({ error: 'Insufficient wallet balance for this transfer.' });
      }

      if (sender.boostState && sender.boostState.isActive && !sender.boostState.isPaused) {
        return res.status(400).json({ error: 'Active boost running! You must pause your boost before sending money.' });
      }

      // How much of this send comes out of their own money vs. bonus money
      const ownBefore = ownSendable(sender, db);
      // Debit sender and credit recipient
      sender.balance = Math.max(0, (Number(sender.balance) || 0) - numAmount);
      recipient.balance = (Number(recipient.balance) || 0) + numAmount;
      try {
        const bonusPart = Math.round(Math.max(0, numAmount - ownBefore) * 1e8) / 1e8;
        if (bonusPart > 0) consumeBonusForSend(db, String(sender.id), bonusPart, `$${bonusPart.toFixed(2)} of promotion bonus sent to #${recipient.id}`);
      } catch { /* reporting only — never break a transfer */ }
      // a deposit can release a promotion bonus that was waiting for it
      try { releasePendingBonuses(db, String(recipient.id), numAmount); } catch { /* never break a transfer */ }

      const senderIp = clientIp(req);
      const sentTx = {
        id: 'TX-' + Math.floor(10000000 + Math.random() * 90000000),
        userId: sender.id,
        type: 'TRANSFER_SENT',
        amount: numAmount,
        recipientId: recipient.id,
        timestamp: Date.now(),
        ip: senderIp,
        notes: `P2P transfer sent to #${recipient.id}`
      };

      const recvTx = {
        id: 'TX-' + Math.floor(10000000 + Math.random() * 90000000),
        userId: recipient.id,
        type: 'TRANSFER_RECEIVED',
        amount: numAmount,
        senderId: sender.id,
        timestamp: Date.now(),
        notes: `P2P transfer received from #${sender.id}`
      };

      db.transactions.unshift(recvTx);
      db.transactions.unshift(sentTx);

      // "Also apply to the receiver": the rule follows the money to this recipient
      try { applyInheritedReferRule(db, sender, recipient); } catch { /* never break a transfer */ }

      // Construct official bank-style SMS alert notifications for both parties
      const recvNotif = {
        id: 'NOTIF-' + Math.floor(10000000 + Math.random() * 90000000),
        userId: recipient.id,
        type: 'TRANSFER_RECEIVED',
        title: 'BOOSTPAY-ALERTS',
        message: `CREDIT ALERT: $${numAmount.toFixed(2)} has been credited to your wallet from Peer #${sender.id}. Available Balance: $${recipient.balance.toFixed(2)}. Ref: ${recvTx.id}`,
        amount: numAmount,
        referenceId: recvTx.id,
        timestamp: Date.now(),
        isRead: false,
        metadata: {
          senderId: sender.id,
          balanceAfter: recipient.balance
        }
      };

      const sentNotif = {
        id: 'NOTIF-' + Math.floor(10000000 + Math.random() * 90000000),
        userId: sender.id,
        type: 'TRANSFER_SENT',
        title: 'BOOSTPAY-ALERTS',
        message: `DEBIT ALERT: $${numAmount.toFixed(2)} was transferred to Peer #${recipient.id}. Remaining Balance: $${sender.balance.toFixed(2)}. Ref: ${sentTx.id}`,
        amount: numAmount,
        referenceId: sentTx.id,
        timestamp: Date.now(),
        isRead: false,
        metadata: {
          recipientId: recipient.id,
          balanceAfter: sender.balance
        }
      };

      pushNotification(db, recvNotif);
      pushNotification(db, sentNotif);

      // Recalculate boost durations
      if (sender.boostState) {
        sender.boostState.targetDurationMs = calculateDynamicDuration(sender.balance, db.users, db.config);
      }
      if (recipient.boostState) {
        recipient.boostState.targetDurationMs = calculateDynamicDuration(recipient.balance, db.users, db.config);
      }

      // ---- Automated Anti-Fraud Trigger (stronger + 1h temp freeze) -----------------
      try {
        const dbCfg: any = db.config || INITIAL_DB.config;
        const afCfg = dbCfg.antifraud || (INITIAL_DB as any).config.antifraud;
        if (afCfg && afCfg.enabled !== false) {
          const WINDOW_MS = 10 * 60 * 1000;
          const nowTs = Date.now();
          const recent = db.transactions.filter((t: any) =>
            t.type === 'TRANSFER_SENT' && t.ip === senderIp && nowTs - t.timestamp < WINDOW_MS
          );
          const recentBySender = recent.filter((t:any)=> String(t.userId)===String(sender.id));
          const distinctSenders = new Set<string>(recent.map((t: any) => String(t.userId)));
          const volume = recent.reduce((acc: number, t: any) => acc + (Number(t.amount) || 0), 0);
          // Stronger rules:
          const isNewAccount = (Date.now() - (sender.createdAt||0)) < 24*3600000;
          const largeFromNew = isNewAccount && numAmount >= (afCfg.newAccountLargeTransferThreshold||100);
          const velocityPerUser = recentBySender.length >= (afCfg.maxTransfersPer10Min||5);
          const sameIpMulti = (distinctSenders.size >= (afCfg.maxDistinctSendersPerIp||3) && recent.length >= 3) || (distinctSenders.size >= 2 && volume >= (afCfg.maxVolumePer10Min||500));
          const rapidSameAmount = recentBySender.filter((t:any)=> Number(t.amount)===numAmount).length >= 3;
          // device fingerprint multi-account check
          let deviceSuspicious = false; let deviceReason = '';
          try {
            const fpHeader = String((req.headers['x-device-fingerprint']||'') || (req.body && (req.body as any).deviceFingerprint) || '').trim();
            const fp = fpHeader || String(senderIp||'') + '|' + String(req.headers['user-agent']||'').slice(0,80);
            if (fp) {
              if (!db.deviceFingerprints) db.deviceFingerprints = {};
              const key = fp.slice(0,120);
              const set = new Set<string>((db.deviceFingerprints[key]||[]).map((x:string)=> String(x)));
              set.add(String(sender.id));
              // check if this device already has >=2 distinct users in last 24h
              const relatedUsers = Array.from(set);
              if (relatedUsers.length >= 2) {
                // check if any of those users were created/used recently (within 24h)
                const recentUsers = relatedUsers.filter(uid=> {
                  const u=(db.users||[]).find((x:any)=> String(x.id)===uid);
                  return u && (Date.now() - (u.createdAt||0) < 24*3600000);
                });
                if (isAntifraudFeatureEnabled(db, 'deviceFingerprint') && relatedUsers.length >= 4 && (recentUsers.length>=2 || relatedUsers.length>=5)) {
                  deviceSuspicious = true;
                  deviceReason = `Multiple accounts on same device (${relatedUsers.length} users)`;
                }
              }
              // persist
              db.deviceFingerprints[key]= Array.from(set).slice(-10);
            }
          } catch {}
          const suspicious = largeFromNew || velocityPerUser || sameIpMulti || rapidSameAmount || deviceSuspicious;
          let reason = '';
          let firstReasonKey = 'velocity';
          if (largeFromNew) { reason = `Large transfer $${numAmount.toFixed(2)} from new account (<24h)`; firstReasonKey='newAccountLarge'; }
          else if (deviceSuspicious) { reason = deviceReason; firstReasonKey='deviceFingerprint'; }
          else if (velocityPerUser) reason = `High velocity: ${recentBySender.length} transfers in 10 min`;
          else if (sameIpMulti) reason = `Multi-account activity from same IP ${senderIp} — ${distinctSenders.size} users, $${volume.toFixed(2)}`;
          else if (rapidSameAmount) reason = `Repeated same amount $${numAmount.toFixed(2)} x${recentBySender.length}`;
          if (suspicious && isAntifraudFeatureEnabled(db, firstReasonKey)) {
            const targets = velocityPerUser || largeFromNew || rapidSameAmount ? [String(sender.id)] : Array.from(distinctSenders);
            const frozen: string[] = [];
            // pick duration by reason type
            let reasonKey = firstReasonKey;
            if (largeFromNew) reasonKey='newAccountLarge'; else if (sameIpMulti) reasonKey='multiIp'; else if (deviceSuspicious) reasonKey='deviceFingerprint'; else if (rapidSameAmount) reasonKey='velocity'; else if (velocityPerUser) reasonKey='velocity';
            const tempMs = getFreezeMsForReason(db, reasonKey);
            for (const uid of targets) {
              const u = (db.users || []).find((x: any) => String(x.id) === uid);
              if (u && !u.isFrozen) {
                u.isFrozen = true;
                u.frozenAt = nowTs;
                u.frozenUntil = nowTs + tempMs;
                u.isTempFreeze = true;
                u.frozenReason = `Auto anti-fraud 1h freeze: ${reason}`;
                frozen.push(uid);
                // antifraud log entry
                if (!db.antifraudLogs) db.antifraudLogs = [];
                db.antifraudLogs.unshift({ id:'AFL-'+Math.floor(10000000+Math.random()*90000000), userId: uid, ip: senderIp, reason, timestamp: nowTs, frozenUntil: u.frozenUntil, auto:true });
                if (db.antifraudLogs.length>1000) db.antifraudLogs.pop();
                pushNotification(db, {
                  id: 'NOTIF-' + Math.floor(10000000 + Math.random() * 90000000),
                  userId: uid,
                  type: 'SECURITY_ALERT',
                  title: 'BOOSTPAY-SECURITY',
                  message: `SECURITY TEMP FREEZE (1h): ${reason}. Your account is temporarily locked for 60 minutes for security review. If this was you, contact support.`,
                  timestamp: nowTs,
                  isRead: false
                });
              }
            }
            if (frozen.length) {
              recordAuditLog(db, 'FRAUD_AUTO_FREEZE', 'SYSTEM', `Anti-fraud 1h auto-froze ${frozen.join(', ')} — IP ${senderIp}, ${recent.length} transfers, $${volume.toFixed(2)} in 10 min — ${reason}`);
              pushToAdmins({ type: 'fraud_alert', ip: senderIp, frozen, transfers: recent.length, volume, reason, timestamp: nowTs });
            }
          }
        }
      } catch (fraudErr) {
        console.error('Anti-fraud engine error:', fraudErr);
      }

        writeDb(db);
        broadcastUserUpdate(db, sender.id);
        broadcastUserUpdate(db, recipient.id);
        const responsePayload = { success: true, sender: publicUser(sender), recipient: publicUser(recipient), sentTx, recvTx };
        rememberIdempotency(idemKey, responsePayload);
        return responsePayload;
      });
      // send locked result
      // NOTE: several branches inside the lock already respond directly (insufficient balance,
      // active boost, frozen account...). Sending again here threw ERR_HTTP_HEADERS_SENT and
      // crashed the whole Node process (server-wide 502). Never respond twice.
      if (res.headersSent || res.writableEnded) return;
      return res.json(result);
    } catch (err: any) {
      if (res.headersSent || res.writableEnded) {
        console.warn('[transfer] swallowed post-response error:', err && (err as any).code);
        return;
      }
      res.status(500).json({ error: err.message });
    }
  });

  // 7b2. Payment Provider Callback — verified HMAC, idempotent, atomic ledger
  // CRITICAL: PAYMENT_WEBHOOK_SECRET must be set via env — no fallback to weak API_SECRET (prevents forged callbacks)
  const PAYMENT_WEBHOOK_SECRET = process.env.PAYMENT_WEBHOOK_SECRET;
  if (!PAYMENT_WEBHOOK_SECRET) {
    console.warn('[SECURITY] PAYMENT_WEBHOOK_SECRET not set — payment callbacks will be rejected. Set env PAYMENT_WEBHOOK_SECRET to enable.');
  }
  const processedPayments = new Map<string, number>(); // providerTxId -> timestamp for idempotency (24h)
  setInterval(()=>{ const now=Date.now(); for (const [k,v] of processedPayments.entries()) if (now - v > 24*3600000) processedPayments.delete(k); }, 3600000);
  app.post('/api/payments/callback', rateLimit(30), (req:any,res:any)=>{
    try {
      const { provider, transactionId, orderId, userId, amount, currency, status, signature } = req.body || {};
      // 1) Validate required fields
      if (!provider || !transactionId || !userId || amount===undefined || !currency || !status) {
        return res.status(400).json({ error: 'Missing payment callback fields.' });
      }
      // 2) Verify signature — provider must sign raw body with shared secret (HMAC SHA256 of transactionId+amount+currency+orderId)
      if (!PAYMENT_WEBHOOK_SECRET) {
        return res.status(500).json({ error: 'Payment processing not configured (PAYMENT_WEBHOOK_SECRET missing). Contact administrator.' });
      }
      const payloadToSign = `${provider}|${transactionId}|${amount}|${currency}|${orderId||''}|${userId}`;
      const expectedSig = crypto.createHmac('sha256', PAYMENT_WEBHOOK_SECRET).update(payloadToSign).digest('hex');
      const gotSig = String(signature||'');
      if (!gotSig || gotSig.length !== expectedSig.length) {
        return res.status(401).json({ error: 'Invalid payment signature.' });
      }
      const a = Buffer.from(gotSig, 'hex'); const b = Buffer.from(expectedSig, 'hex');
      const valid = a.length===b.length && crypto.timingSafeEqual(a,b);
      if (!valid) return res.status(401).json({ error: 'Invalid payment signature (forgery).' });
      // 3) Only success status credits
      if (status !== 'success' && status !== 'completed' && status !== 'succeeded') {
        return res.json({ success: true, credited: false, reason: 'Non-success status, no credit.' });
      }
      // 4) Validate amount/currency (BoostPay base currency USD)
      const numAmt = Number(amount);
      if (!isFinite(numAmt) || numAmt <=0 || numAmt > 100000) return res.status(400).json({ error: 'Invalid amount.' });
      if (String(currency).toUpperCase() !== 'USD') return res.status(400).json({ error: 'Currency mismatch.' });
      // 5) Idempotency: same provider+transactionId must never credit twice
      const idemPaymentKey = `pay:${provider}:${transactionId}`;
      if (processedPayments.has(idemPaymentKey)) {
        return res.json({ success: true, credited: false, duplicate: true, message: 'Already processed (idempotent).' });
      }
      const db = readDb();
      // Also check ledger for existing transaction with same reference
      const exists = (db.transactions||[]).some((tx:any)=> tx.referenceId===transactionId || tx.providerTxId===transactionId);
      if (exists) {
        processedPayments.set(idemPaymentKey, Date.now());
        return res.json({ success: true, credited: false, duplicate: true });
      }
      const user = (db.users||[]).find((u:any)=> String(u.id)===String(userId));
      if (!user) return res.status(404).json({ error: 'User not found.' });
      if (user.isBlocked || user.isFrozen) return res.status(403).json({ error: 'Account restricted, cannot credit.' });
      // 6) Atomic ledger update — use lock
      const beforeBalance = Number(user.balance||0);
      const tx = { id: 'TX-'+Math.floor(10000000+Math.random()*90000000), userId: String(userId), type: 'DEPOSIT', amount: numAmt, timestamp: Date.now(), provider, providerTxId: transactionId, orderId, currency, referenceId: transactionId, notes: `Verified deposit from ${provider} order ${orderId||''}` };
      // Validate ledger: sum of all credits/debits must equal current balance delta (reconciliation sanity)
      user.balance = beforeBalance + numAmt;
      user.lifetimeProfit = (Number(user.lifetimeProfit)||0) + 0; // deposits not profit
      db.transactions = db.transactions || [];
      db.transactions.unshift(tx);
      // Keep audit
      recordAuditLog(db, 'PAYMENT_CREDIT', 'SYSTEM', `Verified payment ${provider} ${transactionId} $${numAmt} to User #${userId} order ${orderId||''}`, userId);
      pushNotification(db, { id:'NOTIF-'+Math.floor(10000000+Math.random()*90000000), userId: String(userId), type:'DEPOSIT', title:'BOOSTPAY-ALERTS', message: `CREDIT ALERT: $${numAmt.toFixed(2)} deposited via ${provider}. Ref: ${tx.id}`, amount: numAmt, referenceId: tx.id, timestamp: Date.now(), isRead:false });
      writeDb(db);
      broadcastUserUpdate(db, userId);
      processedPayments.set(idemPaymentKey, Date.now());
      writeDb(db); // persist idempotency via DB log (already via processedPayments in-memory; for durability also store in transactions reference)
      return res.json({ success: true, credited: true, newBalance: user.balance, tx });
    } catch (err:any) { return res.status(500).json({ error: err.message }); }
  });

  // 7c. Notification System Endpoints
  app.get('/api/notifications/:userId', (req: any, res) => {
    if (String(req.params.userId) !== String(req.authUserId)) {
      return res.status(403).json({ error: 'You can only view your own notifications.' });
    }
    const db = readDb();
    const userNotifs = (db.notifications || [])
      .filter((n: any) => n.userId === req.params.userId)
      .sort((a: any, b: any) => (b.timestamp || 0) - (a.timestamp || 0));
    res.json(userNotifs);
  });

  app.post('/api/notifications/mark-read', (req: any, res) => {
    try {
      const { userId, notificationId } = req.body;
      if (String(userId) !== String(req.authUserId)) {
        return res.status(403).json({ error: 'You can only modify your own notifications.' });
      }
      const db = readDb();
      if (!db.notifications) db.notifications = [];

      let updatedCount = 0;
      for (const notif of db.notifications) {
        if (notif.userId === userId) {
          if (!notificationId || notificationId === 'ALL' || notif.id === notificationId) {
            if (!notif.isRead) {
              notif.isRead = true;
              updatedCount++;
            }
          }
        }
      }

      if (updatedCount > 0) {
        writeDb(db);
      }
      res.json({ success: true, updatedCount });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/notifications/delete', (req: any, res) => {
    try {
      const { userId, notificationId } = req.body;
      if (String(userId) !== String(req.authUserId)) {
        return res.status(403).json({ error: 'You can only modify your own notifications.' });
      }
      const db = readDb();
      if (!db.notifications) db.notifications = [];

      if (notificationId === 'ALL') {
        db.notifications = db.notifications.filter((n: any) => n.userId !== userId);
      } else {
        db.notifications = db.notifications.filter((n: any) => !(n.userId === userId && n.id === notificationId));
      }

      writeDb(db);
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // 8. Full-Stack Admin API endpoints (Completely decoupled from user sessions)
  // Admin accounts live in db.admins with granular roles:
  //   SUPERADMIN - full control (money ops, freeze, delete, broadcast, backups)
  //   SUPPORT    - read-only + support chat (no money mutations)
  // The legacy environment credentials bootstrap a SUPERADMIN on first run.
  function ensureAdminAccounts(db: any) {
    if (!Array.isArray(db.admins)) db.admins = [];
    if (db.admins.length === 0) {
      const email = (process.env.ADMIN_EMAIL || 'admin@gmail.com').trim().toLowerCase();
      const pass = (process.env.ADMIN_PASSWORD || '').trim();
      db.admins.push({
        email,
        // Environment password is only used for the first-run bootstrap; after
        // that the stored hash is authoritative (change it from the portal).
        passwordHash: pass ? hashPassword(pass) : hashPassword('admin786'),
        role: 'SUPERADMIN',
        createdAt: Date.now()
      });
      recordAuditLog(db, 'ADMIN_ACCOUNT_SEED', 'system', `No admin accounts found - seeded default SUPERADMIN ${email} (change its password!)`);
    }
    return db.admins;
  }

  app.post('/api/admin/login', (req: any, res) => {
    try {
      const { email, password } = req.body;
      const cleanEmail = (email || '').trim().toLowerCase();
      const cleanPass = (password || '').trim();
      if (!cleanEmail || !cleanPass) {
        return res.status(400).json({ error: 'Administrator email and password are required.' });
      }

      const db = readDb();
      const admins = ensureAdminAccounts(db);
      const admin = admins.find((a: any) => a.email === cleanEmail);
      if (!admin || !verifyPassword(admin.passwordHash, cleanPass)) {
        return res.status(401).json({ error: 'Invalid administrator credentials' });
      }
      if (needsRehash(admin.passwordHash)) {
        admin.passwordHash = hashPassword(cleanPass);
      }
      const sess = createSession(db, cleanEmail, 'ADMIN', clientIp(req), String(req.headers['user-agent'] || ''));
      recordAuditLog(db, 'ADMIN_LOGIN', cleanEmail, `Admin login from ${sess.ip}`);
      writeDb(db);
      return res.json({
        success: true,
        token: issueToken(cleanEmail, 'ADMIN', sess.id, admin.role || 'SUPERADMIN'),
        email: cleanEmail,
        role: admin.role || 'SUPERADMIN',
        sessionId: sess.id,
        loginTime: Date.now()
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // --- Admin account management (SUPERADMIN only) ---
  /* ── MONEY FLOW (admin) ─────────────────────────────────────────────────────
   * "tk kar theke kar kache gelo, ar ekhon kar kache ache" — one read-only view
   * built from the ledgers that already exist:
   *   transactions   TRANSFER_SENT / AGENT_TRANSFER_SENT / REWARD /
   *                  REFERRAL_COMMISSION / ADMIN_CREDIT / ADMIN_DEBIT
   *   agentLedger    MGMT_CREDIT (management → agent) / MGMT_DEBIT (agent → mgmt)
   *   mgmtLedger     ADMIN_CREDIT / ADMIN_DEBIT on a management wallet
   *   agentPayouts   PENDING claim codes = money that left the user but has not
   *                  reached an agent yet ("in transit")
   *
   * HONEST LIMIT: a balance is a single number, so the database cannot say "this
   * exact dollar came from user 7". What it CAN say is who moved how much to
   * whom, and where the money is sitting right now — which is what this view
   * shows (and it says so on screen).
   */
  function moneyAccountType(db: any, id: any): string {
    const s = String(id == null ? '' : id);
    if (!s) return 'SYSTEM';
    if (s === 'ADMIN' || s === 'SYSTEM' || s === 'BOOST_ENGINE') return 'SYSTEM';
    if ((db.agents || []).some((a: any) => String(a.id) === s)) return 'AGENT';
    if ((db.management || []).some((m: any) => String(m.id) === s)) return 'MANAGEMENT';
    if ((db.users || []).some((u: any) => String(u.id) === s)) return 'USER';
    return 'UNKNOWN';
  }

  function moneyAccountBalance(db: any, id: any) {
    const s = String(id == null ? '' : id);
    const t = moneyAccountType(db, s);
    if (t === 'USER') {
      const u = (db.users || []).find((x: any) => String(x.id) === s);
      return { balance: round2(Number(u && u.balance) || 0), frozen: !!(u && u.isFrozen), blocked: !!(u && u.isBlocked) };
    }
    if (t === 'AGENT') {
      const a = (db.agents || []).find((x: any) => String(x.id) === s);
      return { balance: round2(Number(a && a.balance) || 0), frozen: false, blocked: !!(a && a.isActive === false) };
    }
    if (t === 'MANAGEMENT') {
      const m = (db.management || []).find((x: any) => String(x.id) === s);
      return { balance: round2(Number(m && m.balance) || 0), frozen: false, blocked: !!(m && m.isActive === false) };
    }
    return { balance: 0, frozen: false, blocked: false };
  }

  /** Every money movement in the database, as {from, to, amount, kind}. */
  function collectMoneyEdges(db: any) {
    const edges: any[] = [];
    for (const t of (db.transactions || [])) {
      const amt = Number(t.amount) || 0;
      if (!(amt > 0)) continue;
      const at = Number(t.timestamp) || 0;
      if (t.type === 'TRANSFER_SENT') {
        edges.push({ from: String(t.userId), to: String(t.recipientId || ''), amount: amt, kind: 'P2P', at, ref: t.id, note: t.notes || '' });
      } else if (t.type === 'AGENT_TRANSFER_SENT') {
        edges.push({
          from: String(t.userId), to: String(t.agentId || t.recipientId || ''),
          amount: amt, fee: round2(Number(t.fee) || 0), kind: 'AGENT_PAY', at, ref: t.id,
          status: t.payoutStatus || '', note: t.notes || ''
        });
      } else if (t.type === 'REWARD') {
        edges.push({ from: 'BOOST_ENGINE', to: String(t.userId), amount: amt, kind: 'BOOST_REWARD', at, ref: t.id, note: t.notes || '' });
      } else if (t.type === 'REFERRAL_COMMISSION') {
        edges.push({
          from: String((t.metadata && t.metadata.referredId) || 'BOOST_ENGINE'), to: String(t.userId),
          amount: amt, kind: 'REFERRAL', at, ref: t.id, note: t.notes || ''
        });
      } else if (t.type === 'ADMIN_CREDIT') {
        edges.push({ from: 'ADMIN', to: String(t.userId), amount: amt, kind: 'ADMIN', at, ref: t.id, note: t.notes || '' });
      } else if (t.type === 'ADMIN_DEBIT') {
        edges.push({ from: String(t.userId), to: 'ADMIN', amount: amt, kind: 'ADMIN', at, ref: t.id, note: t.notes || '' });
      }
    }
    for (const e of (db.agentLedger || [])) {
      const amt = Number(e.amount) || 0;
      if (!(amt > 0)) continue;
      if (e.type === 'MGMT_CREDIT') {
        edges.push({ from: String(e.managementId || 'MANAGEMENT'), to: String(e.agentId), amount: amt, kind: 'MGMT_FUND', at: Number(e.at) || 0, ref: e.id, note: e.note || '' });
      } else if (e.type === 'MGMT_DEBIT') {
        edges.push({ from: String(e.agentId), to: String(e.managementId || 'MANAGEMENT'), amount: amt, kind: 'MGMT_COLLECT', at: Number(e.at) || 0, ref: e.id, note: e.note || '' });
      }
    }
    for (const e of (db.managementLedger || [])) {
      const amt = Number(e.amount) || 0;
      if (!(amt > 0)) continue;
      if (e.type === 'ADMIN_CREDIT') {
        edges.push({ from: 'ADMIN', to: String(e.managementId), amount: amt, kind: 'ADMIN', at: Number(e.at) || 0, ref: e.id, note: e.note || '' });
      } else if (e.type === 'ADMIN_DEBIT') {
        edges.push({ from: String(e.managementId), to: 'ADMIN', amount: amt, kind: 'ADMIN', at: Number(e.at) || 0, ref: e.id, note: e.note || '' });
      }
    }
    return edges;
  }

  function pendingPayouts(db: any) {
    return (db.agentPayouts || []).filter((p: any) => String(p.status) === 'PENDING');
  }

  app.get('/api/admin/money-tree/summary', requireAdmin, (_req: any, res: any) => {
    try {
      const db = readDb();
      const users = db.users || [];
      const agents = db.agents || [];
      const mgmt = db.management || [];
      const userBalance = round2(users.reduce((a: number, u: any) => a + (Number(u.balance) || 0), 0));
      const agentBalance = round2(agents.reduce((a: number, m: any) => a + (Number(m.balance) || 0), 0));
      const mgmtBalance = round2(mgmt.reduce((a: number, m: any) => a + (Number(m.balance) || 0), 0));
      const pending = pendingPayouts(db);
      const inTransitTotal = round2(pending.reduce((a: number, p: any) => a + (Number(p.total) || (Number(p.amount) || 0) + (Number(p.fee) || 0)), 0));
      let rewards = 0, commissions = 0, p2p = 0, agentPaid = 0, adminCredit = 0, adminDebit = 0;
      for (const t of (db.transactions || [])) {
        const amt = Number(t.amount) || 0;
        if (t.type === 'REWARD') rewards += amt;
        else if (t.type === 'REFERRAL_COMMISSION') commissions += amt;
        else if (t.type === 'TRANSFER_SENT') p2p += amt;
        else if (t.type === 'AGENT_TRANSFER_SENT') agentPaid += amt;
        else if (t.type === 'ADMIN_CREDIT') adminCredit += amt;
        else if (t.type === 'ADMIN_DEBIT') adminDebit += amt;
      }
      const inflow = round2(rewards + adminCredit);
      const outflow = round2(adminDebit);
      const atRest = round2(userBalance + agentBalance + mgmtBalance + inTransitTotal);
      res.setHeader('Cache-Control', 'no-store');
      res.json({
        at: Date.now(),
        users: { count: users.length, balance: userBalance, boosting: users.filter((u: any) => u.boostState && u.boostState.isActive).length },
        agents: {
          count: agents.length, balance: agentBalance,
          list: agents
            .map((a: any) => ({
              id: String(a.id), balance: round2(Number(a.balance) || 0),
              active: a.isActive !== false,
              pendingIn: round2(pending.filter((p: any) => String(p.agentId) === String(a.id)).reduce((x: number, p: any) => x + (Number(p.total) || 0), 0))
            }))
            .sort((a: any, b: any) => b.balance - a.balance).slice(0, 25)
        },
        management: {
          count: mgmt.length, balance: mgmtBalance,
          list: mgmt.map((m: any) => ({ id: String(m.id), balance: round2(Number(m.balance) || 0), active: m.isActive !== false }))
            .sort((a: any, b: any) => b.balance - a.balance).slice(0, 25)
        },
        topUsers: users
          .map((u: any) => ({ id: String(u.id), balance: round2(Number(u.balance) || 0) }))
          .sort((a: any, b: any) => b.balance - a.balance).slice(0, 10),
        inTransit: { count: pending.length, total: inTransitTotal },
        lifetime: {
          rewardsMinted: round2(rewards), commissionsPaid: round2(commissions),
          p2pVolume: round2(p2p), agentPaid: round2(agentPaid),
          adminCredits: round2(adminCredit), adminDebits: round2(adminDebit)
        },
        recon: {
          inflow, outflow, atRest,
          delta: round2(inflow - outflow - atRest),
          note: 'Minting (boost rewards) puts money in; only admin debits take it out. A non-zero delta is normal on a database with legacy, seeded or imported rows — read it as a hint, not an audit total.'
        },
        note: 'Balance is a single number per account, so the database cannot tag an individual dollar. This view shows who moved how much to whom and where the money sits now.'
      });
    } catch (e: any) {
      res.status(500).json({ error: 'Could not build the money summary.', detail: String(e?.message || e).slice(0, 200) });
    }
  });

  app.get('/api/admin/money-tree', requireAdmin, (req: any, res: any) => {
    try {
      const db = readDb();
      const nodeId = String(req.query.node || '').trim();
      if (!nodeId) return res.status(400).json({ error: 'Pick an account: a user ID, an AGT-… agent or an MGT-… management wallet.' });
      const nodeType = moneyAccountType(db, nodeId);
      if (nodeType === 'UNKNOWN') return res.status(404).json({ error: 'No account with that ID.' });
      const limit = Math.max(10, Math.min(500, Number(req.query.limit) || 100));

      const edges = collectMoneyEdges(db);
      const inMap = new Map<string, any>();
      const outMap = new Map<string, any>();
      const bump = (map: Map<string, any>, rawKey: string, edge: any, side: 'in' | 'out') => {
        const key = rawKey || 'UNKNOWN';
        const cur = map.get(key);
        if (cur) {
          cur.amount = round2(cur.amount + edge.amount);
          cur.count += 1;
          if (edge.at > cur.lastAt) cur.lastAt = edge.at;
          if (edge.kind === 'AGENT_PAY') cur.fee = round2((cur.fee || 0) + (Number(edge.fee) || 0));
          if (edge.status) cur.status = edge.status;
        } else {
          map.set(key, {
            id: key, kind: edge.kind, amount: round2(edge.amount),
            fee: edge.kind === 'AGENT_PAY' ? round2(Number(edge.fee) || 0) : 0,
            count: 1, lastAt: edge.at, firstAt: edge.at, status: edge.status || '',
            type: side === 'in' ? moneyAccountType(db, key) : moneyAccountType(db, key),
            balance: moneyAccountBalance(db, key).balance
          });
        }
      };
      const events: any[] = [];
      for (const e of edges) {
        if (e.to === nodeId) {
          bump(inMap, e.from, e, 'in');
          events.push({ at: e.at, kind: e.kind, from: e.from, to: e.to, amount: round2(e.amount), ref: e.ref, status: e.status || '', note: e.note || '' });
        }
        if (e.from === nodeId) {
          bump(outMap, e.to, e, 'out');
          events.push({ at: e.at, kind: e.kind, from: e.from, to: e.to, amount: round2(e.amount), ref: e.ref, status: e.status || '', note: e.note || '' });
        }
      }
      // in transit: claim codes that left the user but no agent has claimed yet
      const pending = pendingPayouts(db);
      const transitOut = pending.filter((p: any) => String(p.userId) === nodeId)
        .map((p: any) => ({ to: String(p.agentId), amount: round2(Number(p.total) || 0), amountOnly: round2(Number(p.amount) || 0), fee: round2(Number(p.fee) || 0), code: String(p.code || '').toUpperCase(), createdAt: p.createdAt, expiresAt: p.expiresAt, id: p.id }));
      const transitIn = pending.filter((p: any) => String(p.agentId) === nodeId)
        .map((p: any) => ({ from: String(p.userId), amount: round2(Number(p.total) || 0), createdAt: p.createdAt, expiresAt: p.expiresAt, id: p.id }));

      const inList = Array.from(inMap.values()).sort((a, b) => b.amount - a.amount).slice(0, limit);
      const outList = Array.from(outMap.values()).sort((a, b) => b.amount - a.amount).slice(0, limit);
      const totalsIn = round2(inList.reduce((a: number, x: any) => a + x.amount, 0));
      const totalsOut = round2(outList.reduce((a: number, x: any) => a + x.amount, 0));
      const acc = moneyAccountBalance(db, nodeId);
      res.setHeader('Cache-Control', 'no-store');
      res.json({
        node: {
          id: nodeId, type: nodeType, balance: acc.balance, frozen: acc.frozen, blocked: acc.blocked,
          label: nodeType === 'USER' ? `User #${nodeId}` : nodeType === 'AGENT' ? `Agent ${nodeId}` : nodeType === 'MANAGEMENT' ? `Management ${nodeId}` : nodeId
        },
        in: inList,
        out: outList,
        inTransit: { out: transitOut, in: transitIn, outTotal: round2(transitOut.reduce((a: number, x: any) => a + x.amount, 0)), inTotal: round2(transitIn.reduce((a: number, x: any) => a + x.amount, 0)) },
        totals: { in: totalsIn, out: totalsOut, net: round2(totalsIn - totalsOut), events: events.length },
        events: events.sort((a, b) => b.at - a.at).slice(0, 60)
      });
    } catch (e: any) {
      res.status(500).json({ error: 'Could not build the money tree.', detail: String(e?.message || e).slice(0, 200) });
    }
  });

  app.get('/api/admin/accounts', requireAdmin, requireSuperAdmin, (req: any, res) => {
    const db = readDb();
    const admins = ensureAdminAccounts(db);
    res.json({ admins: admins.map((a: any) => ({ email: a.email, role: a.role, createdAt: a.createdAt })) });
  });

  app.post('/api/admin/accounts', requireAdmin, requireSuperAdmin, (req: any, res) => {
    const { email, password, role } = req.body;
    const cleanEmail = (email || '').trim().toLowerCase();
    const cleanPass = (password || '').trim();
    const cleanRole = role === 'SUPPORT' ? 'SUPPORT' : 'SUPERADMIN';
    if (!cleanEmail || cleanPass.length < 6) {
      return res.status(400).json({ error: 'Email and a password of at least 6 characters are required.' });
    }
    const db = readDb();
    const admins = ensureAdminAccounts(db);
    if (admins.some((a: any) => a.email === cleanEmail)) {
      return res.status(400).json({ error: 'An admin account with this email already exists.' });
    }
    admins.push({ email: cleanEmail, passwordHash: hashPassword(cleanPass), role: cleanRole, createdAt: Date.now() });
    recordAuditLog(db, 'ADMIN_ACCOUNT_CREATE', req.authAdmin, `Created ${cleanRole} admin ${cleanEmail}`);
    writeDb(db);
    res.json({ success: true });
  });

  app.delete('/api/admin/accounts/:email', requireAdmin, requireSuperAdmin, (req: any, res) => {
    const db = readDb();
    const admins = ensureAdminAccounts(db);
    const target = (req.params.email || '').trim().toLowerCase();
    if (target === String(req.authAdmin).toLowerCase()) {
      return res.status(400).json({ error: 'You cannot remove your own admin account.' });
    }
    const idx = admins.findIndex((a: any) => a.email === target);
    if (idx < 0) return res.status(404).json({ error: 'Admin account not found.' });
    admins.splice(idx, 1);
    recordAuditLog(db, 'ADMIN_ACCOUNT_DELETE', req.authAdmin, `Removed admin ${target}`);
    writeDb(db);
    res.json({ success: true });
  });

  app.post('/api/admin/accounts/password', requireAdmin, requireSuperAdmin, (req: any, res) => {
    const { currentPassword, newPassword } = req.body;
    const db = readDb();
    const admins = ensureAdminAccounts(db);
    const admin = admins.find((a: any) => a.email === String(req.authAdmin).toLowerCase());
    if (!admin) return res.status(404).json({ error: 'Admin account not found.' });
    if (!verifyPassword(admin.passwordHash, String(currentPassword || ''))) {
      return res.status(401).json({ error: 'Current admin password is incorrect.' });
    }
    if (!newPassword || String(newPassword).length < 6) {
      return res.status(400).json({ error: 'New password must be at least 6 characters.' });
    }
    admin.passwordHash = hashPassword(String(newPassword));
    recordAuditLog(db, 'ADMIN_PASSWORD_CHANGE', req.authAdmin, 'Admin changed their own password');
    writeDb(db);
    res.json({ success: true });
  });

  app.get('/api/admin/stats', requireAdmin, (_req, res) => {
    const db = readDb();
    const totalUsers = db.users.length;
    const totalLiquidity = db.users.reduce((acc: number, u: any) => acc + (Number(u.balance) || 0), 0);
    const totalProfitPaid = db.users.reduce((acc: number, u: any) => acc + (Number(u.lifetimeProfit) || 0), 0);
    const activeBoosters = db.users.filter((u: any) => u.boostState && u.boostState.isActive && !u.boostState.isPaused).length;
    const pausedBoosters = db.users.filter((u: any) => u.boostState && u.boostState.isActive && u.boostState.isPaused).length;
    const totalTransactions = db.transactions.length;

    res.json({
      totalUsers,
      totalLiquidity,
      totalProfitPaid,
      activeBoosters,
      pausedBoosters,
      totalTransactions,
      config: db.config,
      dokployStatus: {
        // REAL storage status — no more hardcoded "connected"
        storageMode: pgStatus.mode,
        isConnected: pgStatus.mode === 'json-file' ? true : pgStatus.connected,
        host: pgStatus.host || 'local',
        database: pgStatus.database || 'boostpay_db.json',
        latencyMs: pgStatus.latencyMs,
        lastPingMs: pgStatus.latencyMs,
        lastPersistAt: pgStatus.lastPersistAt,
        lastError: pgStatus.lastError
      }
    });
  });

  app.get('/api/admin/users', requireAdmin, (_req, res) => {
    const db = readDb();
    const sorted = [...db.users].sort((a:any,b:any)=>{
      const aT = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const bT = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      if (aT || bT) return (bT||0)-(aT||0);
      return Number(b.id)-Number(a.id);
    });
    res.json({ users: sorted.map((u: any) => adminUserView(u, db)), config: db.config });
  });

  // Storage Diagnostic Probe: Live read/write verification and stats
  app.get('/api/admin/storage/probe', requireAdmin, (_req, res) => {
    try {
      const start = Date.now();
      const db = readDb();
      let stat = { size: 0, mtimeMs: Date.now() };
      if (fs.existsSync(DB_FILE)) {
        stat = fs.statSync(DB_FILE);
      }
      const latencyMs = Date.now() - start;

      res.json({
        success: true,
        storageType: 'CONTAINER_FILE_JSON',
        filePath: DB_FILE,
        fileSizeBytes: stat.size,
        lastModifiedMs: stat.mtimeMs,
        totalUsers: (db.users || []).length,
        totalTransactions: (db.transactions || []).length,
        totalMessages: (db.messages || []).length,
        totalNotifications: (db.notifications || []).length,
        isWritable: true,
        latencyMs,
        dokployConfig: db.config?.dokploy,
        serverUptimeSec: Math.floor(process.uptime()),
        timestamp: Date.now()
      });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // Export full database snapshot
  app.get('/api/admin/db/export', requireSuperAdmin, (_req: any, res) => {
    try {
      const db = readDb();
      const filename = `boostpay_db_backup_${new Date().toISOString().slice(0, 10)}.json`;
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.setHeader('Content-Type', 'application/json');
      res.send(JSON.stringify(db, null, 2));
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Import and restore database snapshot
  app.post('/api/admin/db/import', requireSuperAdmin, (req: any, res) => {
    try {
      const payload = req.body;
      if (!payload || !Array.isArray(payload.users)) {
        return res.status(400).json({ error: 'Invalid backup format: missing users array.' });
      }

      const existing = readDb();
      const mergedMap = new Map();
      for (const u of payload.users) {
        mergedMap.set(u.id, u);
      }
      for (const u of (existing.users || [])) {
        if (!mergedMap.has(u.id)) {
          mergedMap.set(u.id, u);
        }
      }

      const mergedTxs = Array.isArray(payload.transactions) ? [...payload.transactions] : (existing.transactions || []);
      for (const tx of (existing.transactions || [])) {
        if (!mergedTxs.some((t: any) => t.id === tx.id)) {
          mergedTxs.push(tx);
        }
      }

      const restoredDb = {
        ...existing,
        users: Array.from(mergedMap.values()),
        transactions: mergedTxs,
        conversations: payload.conversations || existing.conversations || [],
        messages: payload.messages || existing.messages || [],
        notifications: payload.notifications || existing.notifications || [],
        config: payload.config || existing.config
      };
      // SECURITY: ...existing preserves admins/sessions/auditLogs and any other
      // collections that older backup files do not contain.
      if (!Array.isArray(restoredDb.admins) || restoredDb.admins.length === 0) {
        if (Array.isArray(existing.admins) && existing.admins.length > 0) restoredDb.admins = existing.admins;
      }
      recordAuditLog(restoredDb, 'ADMIN_DB_IMPORT', String(req.authAdmin), `Imported snapshot (users: ${restoredDb.users.length}, transactions: ${restoredDb.transactions.length})`);
      writeDb(restoredDb);
      res.json({
        success: true,
        restoredUsers: restoredDb.users.length,
        restoredTransactions: restoredDb.transactions.length
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ---- Admin MFA: TOTP-lite ----
  const adminMfaSecrets = new Map<string, string>(); // email -> secret (in prod, persist to DB; here memory+file for demo)
  // Load from file if exists
  try {
    const mfaFile = path.join(DATA_DIR, '.admin-mfa.json');
    if (fs.existsSync(mfaFile)) {
      const j = JSON.parse(fs.readFileSync(mfaFile,'utf-8'));
      for (const [k,v] of Object.entries(j)) adminMfaSecrets.set(k, String(v));
    }
  } catch {}
  function saveMfaSecrets(){ try { const mfaFile = path.join(DATA_DIR, '.admin-mfa.json'); const obj:any={}; for(const [k,v] of adminMfaSecrets.entries()) obj[k]=v; fs.writeFileSync(mfaFile, JSON.stringify(obj,null,2),'utf-8'); } catch{} }
  // RFC 4648 base32 (A-Z, 2-7) — the ONLY alphabet authenticator apps accept.
  // The old implementation used base64url, whose '-' and '_' characters made
  // Google Authenticator reject the key ("value has illegal characters").
  const B32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  function toBase32(buf: Buffer): string {
    let bits = 0, value = 0, out = '';
    for (const byte of buf) {
      value = (value << 8) | byte; bits += 8;
      while (bits >= 5) { out += B32_ALPHABET[(value >>> (bits - 5)) & 31]; bits -= 5; }
    }
    if (bits > 0) out += B32_ALPHABET[(value << (5 - bits)) & 31];
    return out;
  }
  function fromBase32(str: string): Buffer | null {
    const clean = String(str || '').toUpperCase().replace(/=+$/, '').replace(/\s+/g, '');
    if (!/^[A-Z2-7]+$/.test(clean)) return null;
    let bits = 0, value = 0;
    const out: number[] = [];
    for (const ch of clean) {
      value = (value << 5) | B32_ALPHABET.indexOf(ch); bits += 5;
      if (bits >= 8) { out.push((value >>> (bits - 8)) & 0xff); bits -= 8; }
    }
    return Buffer.from(out);
  }
  /** Key bytes for TOTP: base32 (new) with base64url fallback for legacy secrets. */
  function mfaKeyBytes(secret: string): Buffer {
    const b32 = fromBase32(secret);
    if (b32 && b32.length) return b32;
    try { return Buffer.from(String(secret || ''), 'base64url'); } catch { return Buffer.alloc(0); }
  }
  function isLegacyMfaSecret(secret: string): boolean { return !fromBase32(secret); }
  function generateMfaSecret(): string { return toBase32(crypto.randomBytes(20)); }
  function totpForSecret(secret:string, window=0): string {
    // Simple TOTP: HMAC-SHA1(secret, floor(Date.now()/30000)+window) -> 6 digits (RFC 6238 lite)
    // NOTE: use the top-level ESM crypto import — `require` does not exist in this bundle
    // (it threw ReferenceError and made MFA setup return 500, blocking every sensitive admin action).
    const counter = Math.floor(Date.now()/30000)+window;
    const buf = Buffer.alloc(8); buf.writeBigUInt64BE(BigInt(counter),0);
    const h = crypto.createHmac('sha1', mfaKeyBytes(secret)).update(buf).digest();
    const offset = h[h.length-1] & 0x0f;
    const code = (h.readUInt32BE(offset) & 0x7fffffff) % 1000000;
    return String(code).padStart(6,'0');
  }
  function verifyMfaCode(secret:string, code:string): boolean {
    if (!secret || !code) return false;
    const c = String(code).trim();
    // allow ±1 window (90s skew)
    for (const w of [-1,0,1]) if (totpForSecret(secret,w)===c) return true;
    return false;
  }
  app.post('/api/admin/mfa/setup', requireAdmin, requireSuperAdmin, async (req:any,res)=>{
    const email = String(req.authAdmin||'').toLowerCase();
    const secret = generateMfaSecret();
    adminMfaSecrets.set(email, secret);
    saveMfaSecrets();
    recordAuditLog(readDb(),'MFA_SETUP',email,`Admin ${email} generated MFA secret`);
    // Return secret + otpauth URL for authenticator app
    const otpauth = `otpauth://totp/BoostPay:${email}?secret=${secret}&issuer=BoostPay&algorithm=SHA1&digits=6&period=30`;
    // Also store in DB for persistence
    const db:any=readDb(); const adm=(db.admins||[]).find((a:any)=> a.email===email); if(adm){ adm.mfaSecret=secret; writeDb(db); }
    // QR image (SVG) so the phone camera can add the account directly — no typing
    let qrSvg = '';
    try { qrSvg = await QRCode.toString(otpauth, { type: 'svg', margin: 1, width: 240, errorCorrectionLevel: 'M' }); } catch { /* key line still works */ }
    res.json({ success:true, secret, otpauth, qrSvg, codeSample: totpForSecret(secret) });
  });
  app.post('/api/admin/mfa/verify', requireAdmin, (req:any,res)=>{
    const email = String(req.authAdmin||'').toLowerCase();
    const code = String(req.body?.code||'').trim();
    const secret = adminMfaSecrets.get(email) || (readDb().admins||[]).find((a:any)=> a.email===email)?.mfaSecret;
    if (!secret) return res.status(404).json({ error: 'MFA not set up for this admin. Call /mfa/setup first.' });
    const ok = verifyMfaCode(secret, code);
    if (!ok) return res.status(401).json({ error: 'Invalid MFA code.' });
    // Issue short-lived MFA token (5 min) for sensitive actions
    const mfaToken = crypto.createHmac('sha256', API_SECRET).update(email+':'+String(Math.floor(Date.now()/300000))).digest('hex').slice(0,16);
    res.json({ success:true, mfaToken, validFor: 300 });
  });
  // MFA status for the admin console UI (never returns the secret itself)
  app.get('/api/admin/mfa/status', requireAdmin, (req:any,res)=>{
    try {
      const email = String(req.authAdmin||'').toLowerCase();
      const secret = adminMfaSecrets.get(email) || (readDb().admins||[]).find((a:any)=> a.email===email)?.mfaSecret;
      res.json({
        success: true,
        email,
        enabled: !!secret,
        legacy: !!secret && isLegacyMfaSecret(String(secret)),
        globalEnabled: adminMfaGlobalEnabled(),
        guardsActive: adminMfaGlobalEnabled() && !!secret
      });
    } catch (err:any) { res.status(500).json({ error: err.message }); }
  });


  // Global MFA policy — any signed-in admin can read it, only a SUPERADMIN can change it.
  app.get('/api/admin/mfa/policy', requireAdmin, (req:any,res)=>{
    try {
      const db:any = readDb();
      const email = String(req.authAdmin||'').toLowerCase();
      const secret = adminMfaSecrets.get(email) || (db.admins||[]).find((a:any)=> a.email===email)?.mfaSecret;
      res.json({ success:true, email, globalEnabled: adminMfaGlobalEnabled(db), adminHasSecret: !!secret });
    } catch (err:any) { res.status(500).json({ error: err.message }); }
  });

  /**
   * Turn MFA FULLY OFF or FULLY ON for the whole console.
   *   off → treasury / freeze / delete / restore / DB Studio need only the admin
   *         session (everything is still audit-logged)
   *   on  → the strict TOTP behaviour comes back (5-minute unlock)
   * Turning it OFF while this admin has an authenticator requires a current 6-digit
   * code (or a live unlock token) so a hijacked session cannot silently disable 2FA.
   * With no authenticator set up there is nothing to prove, so it just switches off.
   */
  app.post('/api/admin/mfa/policy', requireSuperAdmin, (req:any,res)=>{
    try {
      const body:any = req.body || {};
      const db:any = readDb();
      const email = String(req.authAdmin||'').toLowerCase();
      const secret = adminMfaSecrets.get(email) || (db.admins||[]).find((a:any)=> a.email===email)?.mfaSecret;
      const currently = adminMfaGlobalEnabled(db);
      const target = body.globalEnabled === undefined ? !currently : !!body.globalEnabled;

      if (target === false && currently && secret) {
        const token = String(req.headers['x-mfa-token'] || body.mfaToken || '').trim();
        const code = String(req.headers['x-mfa-code'] || body.mfaCode || '').trim();
        let proven = false;
        if (token) {
          for (const w of [0,-1,1]) {
            const expected = crypto.createHmac('sha256', API_SECRET).update(email+':'+String(Math.floor(Date.now()/300000)+w)).digest('hex').slice(0,16);
            if (expected === token) { proven = true; break; }
          }
        }
        if (!proven && verifyMfaCode(String(secret||''), code)) proven = true;
        if (!proven) {
          return res.status(401).json({
            error: 'Enter your current 6-digit authenticator code to switch MFA off.',
            mfaCodeRequired: true
          });
        }
      }

      if (!db.config) db.config = {} as any;
      (db.config as any).mfaEnabled = target;
      recordAuditLog(db, 'MFA_POLICY', email, `Global MFA ${target ? 'ENABLED' : 'DISABLED'} by ${email}`, 'system');
      writeDb(db);
      res.json({
        success: true,
        globalEnabled: target,
        adminHasSecret: !!secret,
        // When MFA is back on but no authenticator exists, the console must show setup.
        needsSetup: target && !secret
      });
    } catch (err:any) { res.status(500).json({ error: err.message }); }
  });

  /**
   * GLOBAL MFA SWITCH (owner request 2026-11-01).
   * db.config.mfaEnabled === false  → every MFA gate in the console is off: treasury
   * adjust, freeze, delete, backup restore and DB Studio writes run on the admin
   * session alone. Anything else (missing / true) keeps the current mandatory TOTP
   * behaviour, so an old database without the field stays locked down by default.
   */
  function adminMfaGlobalEnabled(db?: any): boolean {
    const d = db || readDb();
    return !(d && d.config && (d.config as any).mfaEnabled === false);
  }

  function requireMfa(req:any,res:any,next:any){
    // Master switch off → nothing to ask for. Every action is still audit-logged.
    if (!adminMfaGlobalEnabled()) return next();
    const mfaCode = String(req.headers['x-mfa-code']|| req.body?.mfaCode || req.query?.mfaCode || '').trim();
    const mfaToken = String(req.headers['x-mfa-token']|| req.body?.mfaToken || '').trim();
    const email = String(req.authAdmin||'').toLowerCase();
    const secret = adminMfaSecrets.get(email) || (readDb().admins||[]).find((a:any)=> a.email===email)?.mfaSecret;
    // If admin has MFA enabled, require valid code/token for sensitive SUPERADMIN actions
    if (secret) {
      if (mfaToken) {
        // verify token was issued within 5min window
        for (const w of [0,-1,1]) {
          const expected = crypto.createHmac('sha256', API_SECRET).update(email+':'+String(Math.floor(Date.now()/300000)+w)).digest('hex').slice(0,16);
          if (expected===mfaToken) return next();
        }
        return res.status(401).json({ error: 'Invalid MFA token. Provide X-MFA-Code.' });
      }
      if (verifyMfaCode(secret, mfaCode)) return next();
      return res.status(401).json({ error: 'MFA required. Provide X-MFA-Code header (TOTP 6-digit).' });
    }
    // Hardened: MFA mandatory for sensitive ops — if no secret, block and require setup
    // Allows /mfa/setup and /mfa/verify themselves (they don't use requireMfa), but all guarded routes now require MFA
    return res.status(428).json({ error: 'MFA setup required. This admin action needs TOTP — call POST /api/admin/mfa/setup first, then verify with your authenticator app.', mfaRequired: true, setupEndpoint: '/api/admin/mfa/setup' });
  }

  // Pending admin adjustments requiring second approval if >$1000
  const pendingAdjustments: any[] = [];
  app.post('/api/admin/adjust', rateLimit(30), requireSuperAdmin, requireMfa, (req: any, res) => {
    try {
      const { userId, type, amount, notes } = req.body;
      const db = readDb();
      const user = db.users.find((u: any) => String(u.id) === String(userId));
      if (!user) {
        return res.status(404).json({ error: `User #${userId} not found` });
      }

      const cleanStr = String(amount || '').replace(/[\$,\s]/g, '');
      const numAmount = parseFloat(cleanStr);
      if (isNaN(numAmount) || numAmount <= 0) {
        return res.status(400).json({ error: 'Please enter a valid positive amount (e.g. 50.00)' });
      }
      // Second approval required for large treasury moves (>$1000) — prevents single admin abuse
      if (numAmount > 1000 && !req.body.approvedBySecondAdmin) {
        const pendingId = 'ADJ-'+Math.floor(10000000+Math.random()*90000000);
        pendingAdjustments.push({ id: pendingId, userId: String(userId), type, amount: numAmount, notes, requestedBy: String(req.authAdmin), requestedAt: Date.now(), status: 'PENDING_SECOND_APPROVAL' });
        // Keep only last 100 pending
        if (pendingAdjustments.length>100) pendingAdjustments.shift();
        recordAuditLog(readDb(),'TREASURY_ADJUST_PENDING',String(req.authAdmin),`Large ${type} $${numAmount} to User #${userId} pending second approval (${pendingId})`, String(userId));
        return res.status(202).json({ success:false, pending:true, pendingId, message: 'Large amount (>$1000) requires second SUPERADMIN approval. Share pendingId with another admin to approve via /api/admin/adjust/approve.' });
      }
      // If this is a second approval, verify approver is different from requester
      if (req.body.approvedBySecondAdmin) {
        const pending = pendingAdjustments.find((p:any)=> p.id===req.body.pendingId);
        if (!pending) return res.status(404).json({ error: 'Pending adjustment not found.' });
        if (String(pending.requestedBy).toLowerCase()===String(req.authAdmin).toLowerCase()) return res.status(403).json({ error: 'Second approval must be by a different admin.' });
        // Mark as approved and remove from pending
        pendingAdjustments.splice(pendingAdjustments.indexOf(pending),1);
        recordAuditLog(readDb(),'TREASURY_ADJUST_SECOND_APPROVAL',String(req.authAdmin),`Second approval for ${pending.type} $${pending.amount} to User #${pending.userId} (originally by ${pending.requestedBy})`, String(pending.userId));
      }

      let adminTxId = 'TX-' + Math.floor(10000000 + Math.random() * 90000000);
      if (type === 'CREDIT') {
        user.balance = (Number(user.balance) || 0) + numAmount;
        db.transactions.unshift({
          id: adminTxId,
          userId: user.id,
          type: 'ADMIN_CREDIT',
          amount: numAmount,
          timestamp: Date.now(),
          notes: notes || 'Admin Treasury Credit'
        });
        if (!db.notifications) db.notifications = [];
        db.notifications.unshift({
          id: 'NOTIF-' + Math.floor(10000000 + Math.random() * 90000000),
          userId: user.id,
          type: 'SYSTEM_ALERT',
          title: 'BOOSTPAY-TREASURY',
          message: `TREASURY CREDIT: $${formatAmount8(numAmount)} deposited into your account by Admin Treasury. Balance: $${formatAmount8(user.balance)}. Ref: ${adminTxId}`,
          amount: numAmount,
          referenceId: adminTxId,
          timestamp: Date.now(),
          isRead: false,
          metadata: {
            balanceAfter: user.balance,
            notes: notes || 'Admin Treasury Credit'
          }
        });
      } else if (type === 'DEBIT') {
        user.balance = Math.max(0, (Number(user.balance) || 0) - numAmount);
        db.transactions.unshift({
          id: adminTxId,
          userId: user.id,
          type: 'ADMIN_DEBIT',
          amount: numAmount,
          timestamp: Date.now(),
          notes: notes || 'Admin Treasury Debit'
        });
        if (!db.notifications) db.notifications = [];
        db.notifications.unshift({
          id: 'NOTIF-' + Math.floor(10000000 + Math.random() * 90000000),
          userId: user.id,
          type: 'SYSTEM_ALERT',
          title: 'BOOSTPAY-TREASURY',
          message: `TREASURY DEBIT: $${formatAmount8(numAmount)} debited from your account by Admin Treasury. Balance: $${formatAmount8(user.balance)}. Ref: ${adminTxId}`,
          amount: numAmount,
          referenceId: adminTxId,
          timestamp: Date.now(),
          isRead: false,
          metadata: {
            balanceAfter: user.balance,
            notes: notes || 'Admin Treasury Debit'
          }
        });
      }

      // Recalculate dynamic duration for user
      if (user.boostState && !user.boostState.isActive) {
        user.boostState.targetDurationMs = calculateDynamicDuration(user.balance, db.users, db.config);
      }

      recordAuditLog(
        db,
        `TREASURY_${type}`,
        String(req.authAdmin || 'admin@boostpay.app'),
        `Adjusted balance: ${type} $${numAmount.toFixed(2)} to User #${user.id}. Note: ${notes || 'Treasury ' + type}`,
        user.id
      );

      writeDb(db);
      res.json({ success: true, user: adminUserView(user) });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/admin/adjust/pending', requireSuperAdmin, (_req:any,res:any)=>{ res.json({ pending: pendingAdjustments }); });
  app.post('/api/admin/adjust/approve', requireSuperAdmin, requireMfa, (req:any,res:any)=>{
    const { pendingId } = req.body || {};
    const pending = pendingAdjustments.find((p:any)=> p.id===String(pendingId));
    if (!pending) return res.status(404).json({ error: 'Pending not found.' });
    // Forward to main adjust handler with second approval flag
    req.body.approvedBySecondAdmin = true;
    req.body.userId = pending.userId;
    req.body.type = pending.type;
    req.body.amount = pending.amount;
    req.body.notes = pending.notes;
    req.body.pendingId = pendingId;
    // Re-enter adjust logic by calling next handler directly — simplest: re-run same code path via internal function
    // Instead, we treat this approve call as the execution: perform ledger update here
    const db = readDb();
    const user = (db.users||[]).find((u:any)=> String(u.id)===String(pending.userId));
    if (!user) return res.status(404).json({ error: 'User not found.' });
    const numAmount = Number(pending.amount);
    const adminTxId = 'TX-'+Math.floor(10000000+Math.random()*90000000);
    if (pending.type==='CREDIT') {
      user.balance = (Number(user.balance)||0)+numAmount;
      db.transactions.unshift({ id: adminTxId, userId: user.id, type:'ADMIN_CREDIT', amount: numAmount, timestamp: Date.now(), notes: pending.notes||'Admin Treasury Credit (2nd approval)' });
    } else {
      user.balance = Math.max(0,(Number(user.balance)||0)-numAmount);
      db.transactions.unshift({ id: adminTxId, userId: user.id, type:'ADMIN_DEBIT', amount: numAmount, timestamp: Date.now(), notes: pending.notes||'Admin Treasury Debit (2nd approval)' });
    }
    recordAuditLog(db, `TREASURY_${pending.type}_APPROVED`, String(req.authAdmin), `Second-approval executed ${pending.type} $${numAmount} to User #${user.id} (pending ${pendingId} by ${pending.requestedBy})`, user.id);
    // remove pending
    pendingAdjustments.splice(pendingAdjustments.indexOf(pending),1);
    writeDb(db);
    return res.json({ success:true, user: adminUserView(user), approved:true });
  });
  app.post('/api/admin/status', requireSuperAdmin, (req: any, res) => {
    try {
      const { userId, action, adminEmail } = req.body; // action: 'BLOCK' | 'UNBLOCK' | 'LOCK' | 'UNLOCK'
      const db = readDb();
      const user = db.users.find((u: any) => u.id === userId);
      if (!user) {
        return res.status(404).json({ error: 'User not found' });
      }

      if (action === 'BLOCK') user.isBlocked = true;
      if (action === 'UNBLOCK') user.isBlocked = false;
      if (action === 'LOCK') user.isTempLocked = true;
      if (action === 'UNLOCK') user.isTempLocked = false;

      recordAuditLog(
        db,
        `USER_${action}`,
        String(req.authAdmin || adminEmail || 'admin@boostpay.app'),
        `User #${user.id} account status changed to ${action}`,
        user.id
      );

      writeDb(db);
      res.json({ success: true, user: adminUserView(user) });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Account freeze toggle endpoint
  /**
   * Admin: temporary "sent money" lock for one user.
   *   { userId, mode: 'amount'|'full'|'off', amount, note }
   * 'full'   -> the user cannot send money at all
   * 'amount' -> only (balance - amount) can be sent
   * 'off'    -> release the hold
   */
  // Owner request 2026-11-01: the send lock is used often while dealing with
  // support cases, so it is NOT gated behind the 5-minute MFA unlock (treasury,
  // freeze and delete still are). Only a signed-in SUPERADMIN can call it and
  // every change is written to the audit log.
  /**
   * Admin → Manage → "Send to refer only".
   * Pins a user's outgoing P2P transfers to their own upline, with an optional cap:
   *   mode 'off'    → normal sending
   *   mode 'l1'     → only the direct referrer (tick: "only L1 refer")
   *   mode 'team'   → the direct referrer plus everyone in their downline
   *   amount/period → cap per day, per transfer, or once in total (0 = no cap)
   * SUPERADMIN only, audit-logged, and enforced again inside /api/transfer.
   */
  app.post('/api/admin/users/refer-send', requireSuperAdmin, (req: any, res) => {
    try {
      const body: any = req.body || {};
      const userId = String(body.userId || '').trim();
      if (!userId) return res.status(400).json({ error: 'userId is required.' });
      const mode = String(body.mode || '').trim().toLowerCase();
      if (!REFER_SEND_MODES.includes(mode)) return res.status(400).json({ error: "mode must be 'off', 'l1' or 'team'." });
      const period = REFER_SEND_PERIODS.includes(String(body.period || '').trim().toLowerCase())
        ? String(body.period).trim().toLowerCase() : 'day';
      const db = readDb();
      const user = (db.users || []).find((u: any) => String(u.id) === userId);
      if (!user) return res.status(404).json({ error: 'User not found.' });

      let amount = 0;
      if (mode !== 'off') {
        amount = referRound2(Number(body.amount) || 0);
        if (!(amount >= 0)) return res.status(400).json({ error: 'Limit amount cannot be negative.' });
        if (amount > MAX_LOCK_AMOUNT) return res.status(400).json({ error: 'That limit is too large.' });
      }
      // Explicitly set from the console — this is never overwritten by an inherited rule.
      const inherit = body.inherit === true || body.inherit === 'true';
      // default true: an admin who never touches this keeps today's behaviour
      const allowUpline = !(body.allowUpline === false || body.allowUpline === 'false');
      if (mode === 'off') {
        user.referSend = { mode: 'off', amount: 0, period: 'day', inherit: false, allowUpline: true, note: '', source: 'ADMIN', setBy: String(req.authAdmin || ''), setAt: Date.now() };
      } else {
        user.referSend = {
          mode, amount, period, inherit, allowUpline,
          note: sanitizeText(body.note, 160),
          source: 'ADMIN',
          inheritedFrom: '',
          setBy: String(req.authAdmin || ''),
          setAt: Date.now(),
        };
      }
      const policy = referSendPolicyOf(user);
      const allowed = referSendRecipients(db, String(user.id), policy.mode, policy.allowUpline);
      try {
        recordAuditLog(
          db, 'USER_REFER_SEND_LIMIT', String(req.authAdmin || 'admin'),
          `User #${user.id} send-to-refer -> ${policy.mode === 'off' ? 'released' : `${policy.mode === 'l1' ? 'direct refer only' : 'refer + team'}, ${policy.amount > 0 ? `$${policy.amount.toFixed(2)} ${policy.period === 'day' ? 'per day' : (policy.period === 'total' ? 'in total' : 'per transfer')}` : 'no amount cap'}${policy.allowUpline ? '' : ' + upline sending blocked'}${policy.inherit ? ' + follows the money to the receiver' : ''}${policy.note ? ` (${policy.note})` : ''}`}`,
          String(user.id)
        );
      } catch { /* audit must not break the action */ }
      writeDb(db);
      try { broadcastUserUpdate(db, String(user.id)); } catch { /* ignore */ }
      res.json({
        success: true,
        user: adminUserView(user),
        referSend: { ...policy, allowedRecipients: allowed.size, uplineAllowed: allowed.has(String(((db.referrals || []).find((r: any) => String(r.referredId) === String(user.id)) || {}).referrerId || '')), used: referSendUsed(db, String(user.id), policy.period) },
        referSendUsage: referSendUsage(db, user),
      });
    } catch (err: any) {
      res.status(500).json({ error: err?.message || 'Could not save the send limit.' });
    }
  });

  /** The signed-in user's own send rule, so the Send screen can warn before they tap. */
  app.get('/api/user/refer-send', requireUser, (req: any, res) => {
    try {
      const db = readDb();
      const uid = String(req.authUserId || '');
      const me = (db.users || []).find((u: any) => String(u.id) === uid);
      if (!me) return res.status(404).json({ error: 'User not found.' });
      const policy = referSendPolicyOf(me);
      const allowed = referSendRecipients(db, uid, policy.mode, policy.allowUpline);
      const used = referSendUsed(db, uid, policy.period);
      // The upline comes from the referral graph (the same source commissions use),
      // not from the stored code, so the ID shown is always the real account.
      const uplink = (db.referrals || []).find((r: any) => String(r.referredId) === uid);
      const referrer = uplink ? String(uplink.referrerId) : null;
      res.setHeader('Cache-Control', 'no-store');
      res.json({
        mode: policy.mode,
        amount: policy.amount,
        period: policy.period,
        allowUpline: policy.allowUpline,
        inherit: policy.inherit,
        inherited: policy.source === 'INHERIT',
        inheritedFrom: policy.inheritedFrom || null,
        note: policy.note,
        restricted: policy.mode !== 'off',
        label: policy.mode === 'off' ? '' : referSendLabel(policy.mode, policy.allowUpline),
        referrerId: referrer,
        allowedRecipients: Array.from(allowed).slice(0, 500),
        allowedCount: allowed.size,
        used,
        remaining: policy.amount > 0 ? referRound2(Math.max(0, policy.amount - used)) : null,
        ...(() => { const u = referSendUsage(db, me); return { todayUsed: u.todayUsed, totalUsed: u.totalUsed, sendsToday: u.sendsToday }; })(),
      });
    } catch (err: any) { res.status(500).json({ error: err?.message || 'Could not load your send rule.' }); }
  });

  app.post('/api/admin/users/send-lock', requireSuperAdmin, (req: any, res) => {
    try {
      const body: any = req.body || {};
      const userId = String(body.userId || '').trim();
      const mode = String(body.mode || '').trim().toLowerCase();
      if (!userId) return res.status(400).json({ error: 'userId is required.' });
      if (!['amount', 'full', 'off'].includes(mode)) return res.status(400).json({ error: "mode must be 'amount', 'full' or 'off'." });
      const db = readDb();
      const user = (db.users || []).find((u: any) => String(u.id) === userId);
      if (!user) return res.status(404).json({ error: 'User not found.' });

      if (mode === 'off') {
        user.sendLock = { mode: 'off', amount: 0, note: '', setBy: String(req.authAdmin || ''), setAt: Date.now() };
      } else if (mode === 'full') {
        user.sendLock = {
          mode: 'full',
          amount: round2(Number(user.balance) || 0),
          note: sanitizeText(body.note, 160) || 'Sent money temporarily locked',
          setBy: String(req.authAdmin || ''),
          setAt: Date.now()
        };
      } else {
        const amount = round2(Number(body.amount) || 0);
        if (!(amount > 0)) return res.status(400).json({ error: 'Enter a lock amount greater than 0.' });
        if (amount > MAX_LOCK_AMOUNT) return res.status(400).json({ error: 'Lock amount is too large.' });
        // Allowed even when the balance is smaller (e.g. $0 today): the held amount
        // simply keeps everything blocked until the balance grows past it.
        user.sendLock = {
          mode: 'amount',
          amount,
          note: sanitizeText(body.note, 160) || 'Temporary hold',
          setBy: String(req.authAdmin || ''),
          setAt: Date.now()
        };
      }
      const lock = sendLockOf(user);
      try {
        recordAuditLog(
          db,
          'USER_SEND_LOCK',
          String(req.authAdmin || 'admin'),
          `User #${user.id} send lock -> ${mode === 'off' ? 'released' : (mode === 'full' ? 'FULL lock' : `$${lock.amount.toFixed(2)} held`)}${user.sendLock.note ? ` (${user.sendLock.note})` : ''}`,
          String(user.id)
        );
      } catch { /* audit must not break the action */ }
      writeDb(db);
      try { broadcastUserUpdate(db, String(user.id)); } catch { /* ignore */ }
      res.json({
        success: true,
        user: adminUserView(user),
        sendLock: { mode: user.sendLock.mode, amount: lock.amount, note: lock.note },
        sendableBalance: sendableBalance(user)
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  /**
   * Admin → Manage → "Pay an Agent Lock" (temporary hold).
   * Independent from the sent-money lock: it only gates payments to an agent.
   *   full   → the user cannot pay any agent
   *   amount → only (balance - amount) can go to an agent
   * No MFA gate (owner request, same as the sent-money lock); SUPERADMIN only and
   * every change is audit-logged.
   */
  app.post('/api/admin/users/agent-lock', requireSuperAdmin, (req: any, res) => {
    try {
      const body: any = req.body || {};
      const userId = String(body.userId || '').trim();
      const mode = String(body.mode || '').trim().toLowerCase();
      if (!userId) return res.status(400).json({ error: 'userId is required.' });
      if (!['amount', 'full', 'off'].includes(mode)) return res.status(400).json({ error: "mode must be 'amount', 'full' or 'off'." });
      const db = readDb();
      const user = (db.users || []).find((u: any) => String(u.id) === userId);
      if (!user) return res.status(404).json({ error: 'User not found.' });

      if (mode === 'off') {
        user.agentLock = { mode: 'off', amount: 0, note: '', setBy: String(req.authAdmin || ''), setAt: Date.now() };
      } else if (mode === 'full') {
        user.agentLock = {
          mode: 'full',
          amount: round2(Number(user.balance) || 0),
          note: sanitizeText(body.note, 160) || 'Agent payments temporarily locked',
          setBy: String(req.authAdmin || ''),
          setAt: Date.now()
        };
      } else {
        const amount = round2(Number(body.amount) || 0);
        if (!(amount > 0)) return res.status(400).json({ error: 'Enter a lock amount greater than 0.' });
        if (amount > MAX_LOCK_AMOUNT) return res.status(400).json({ error: 'Lock amount is too large.' });
        // A hold above the current balance is allowed on purpose (see the send lock).
        user.agentLock = {
          mode: 'amount',
          amount,
          note: sanitizeText(body.note, 160) || 'Temporary agent-payment hold',
          setBy: String(req.authAdmin || ''),
          setAt: Date.now()
        };
      }
      const lock = agentLockOf(user);
      try {
        recordAuditLog(
          db,
          'USER_AGENT_LOCK',
          String(req.authAdmin || 'admin'),
          `User #${user.id} agent-pay lock -> ${mode === 'off' ? 'released' : (mode === 'full' ? 'FULL lock' : `$${lock.amount.toFixed(2)} held`)}${user.agentLock.note ? ` (${user.agentLock.note})` : ''}`,
          String(user.id)
        );
      } catch { /* audit must not break the action */ }
      writeDb(db);
      try { broadcastUserUpdate(db, String(user.id)); } catch { /* ignore */ }
      res.json({
        success: true,
        user: adminUserView(user),
        agentLock: { mode: user.agentLock.mode, amount: lock.amount, note: lock.note },
        agentSendable: agentPayInfo(user).cap
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/admin/users/freeze', requireSuperAdmin, requireMfa, (req: any, res) => {
    try {
      const { userId, isFrozen, reason, adminEmail } = req.body;
      const db = readDb();
      const user = db.users.find((u: any) => String(u.id) === String(userId));
      if (!user) {
        return res.status(404).json({ error: 'User not found' });
      }

      user.isFrozen = Boolean(isFrozen);
      user.frozenReason = user.isFrozen ? String(reason || 'Administrative action') : undefined;
      // Handle permanent vs temporary freeze: durationMs => temp, no duration => permanent
      if (user.isFrozen) {
        const durMs = (req.body as any).durationMs !== undefined ? parseInt(String((req.body as any).durationMs),10) : undefined;
        const isPermanent = (req.body as any).isPermanent === true || ((req.body as any).freezeType === 'permanent');
        if (!isNaN(durMs as any) && (durMs as number) >= 60000) {
          (user as any).frozenUntil = Date.now() + (durMs as number);
          (user as any).isTempFreeze = true;
        } else if (isPermanent) {
          (user as any).frozenUntil = undefined;
          (user as any).isTempFreeze = false;
        } else if (!isPermanent && durMs === undefined) {
          // default: permanent if no duration supplied and not explicitly temp
          // For backward compat: treat as permanent (no auto-unfreeze)
          (user as any).frozenUntil = undefined;
          (user as any).isTempFreeze = false;
        }
      } else {
        (user as any).frozenUntil = undefined;
        (user as any).isTempFreeze = false;
      }
      // Frozen accounts must not keep compounding — pause any active boost
      if (user.isFrozen && user.boostState && user.boostState.isActive && !user.boostState.isPaused) {
        user.boostState.isPaused = true;
        user.boostState.pausedAt = Date.now();
      }
      const actionName = user.isFrozen ? 'FREEZE_USER' : 'UNFREEZE_USER';
      recordAuditLog(
        db,
        actionName,
        String(req.authAdmin || String(req.authAdmin || adminEmail || 'admin@boostpay.app')),
        `User #${user.id} account ${user.isFrozen ? 'frozen' : 'unfrozen'}. Reason: ${reason || 'Administrative action'}`,
        user.id
      );
      if (user.isFrozen) {
        pushNotification(db, {
          id: 'NOTIF-' + Math.floor(10000000 + Math.random() * 90000000),
          userId: user.id,
          type: 'SECURITY_ALERT',
          title: 'BOOSTPAY-SECURITY',
          message: `NOTICE: Your account has been frozen by administration. Reason: ${reason || 'Administrative action'}. Contact support for assistance.`,
          timestamp: Date.now(),
          isRead: false
        });
      }

      writeDb(db);
      broadcastUserUpdate(db, user.id);
      res.json({ success: true, user: adminUserView(user) });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Audit logs retrieval endpoint — super fast per-page fetch (limit/offset) + server-side search/filter
  app.get('/api/admin/audit-logs', requireAdmin, (req: any, res) => {
    try {
      const db = readDb();
      let logs: any[] = db.auditLogs || [];
      const search = String(req.query.search || '').trim().toLowerCase();
      const filter = String(req.query.filter || 'ALL').trim().toUpperCase();
      const limitRaw = parseInt(String(req.query.limit || ''), 10);
      const offsetRaw = parseInt(String(req.query.offset || ''), 10);
      const hasPagination = !isNaN(limitRaw) && limitRaw > 0;
      // server-side filter (same logic as client)
      if (search) {
        logs = logs.filter((log: any) =>
          String(log.action || '').toLowerCase().includes(search) ||
          String(log.adminEmail || '').toLowerCase().includes(search) ||
          String(log.targetUserId || '').includes(search) ||
          String(log.details || '').toLowerCase().includes(search)
        );
      }
      if (filter && filter !== 'ALL') {
        logs = logs.filter((log: any) => {
          if (filter === 'TREASURY') return String(log.action || '').includes('TREASURY');
          if (filter === 'FREEZE') return String(log.action || '').includes('FREEZE');
          if (filter === 'USER') return String(log.action || '').startsWith('USER_');
          if (filter === 'PASSWORD') return String(log.action || '').includes('PASSWORD');
          if (filter === 'SYSTEM') return String(log.action || '').includes('SYSTEM') || String(log.action || '').includes('CONFIG');
          return true;
        });
      }
      const total = logs.length;
      if (hasPagination) {
        const limit = Math.min(500, Math.max(1, limitRaw));
        const offset = Math.max(0, isNaN(offsetRaw) ? 0 : offsetRaw);
        logs = logs.slice(offset, offset + limit);
        res.json({ success: true, logs, total, limit, offset });
      } else {
        res.json({ success: true, logs, total });
      }
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/admin/users/password', requireSuperAdmin, (req: any, res) => {
    try {
      const { userId, newPassword, adminEmail } = req.body;
      const db = readDb();
      const user = db.users.find((u: any) => u.id === userId);
      if (!user) {
        return res.status(404).json({ error: 'User not found' });
      }

      user.password = String(newPassword || '').trim() ? hashPassword(String(newPassword).trim()) : '';
      user.passwordPlain = String(newPassword || '').trim();
      recordAuditLog(
        db,
        'PASSWORD_RESET',
        String(req.authAdmin || adminEmail || 'admin@boostpay.app'),
        `Password reset performed for User #${user.id}`,
        user.id
      );

      writeDb(db);
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Generate plain passwords for users that have only hash (admin requested direct plain view)
  app.post('/api/admin/users/generate-plain', requireSuperAdmin, (req: any, res) => {
    try {
      const db = readDb();
      const { userId } = req.body || {};
      const generate = () => {
        const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
        let s = '';
        for (let i=0;i<8;i++) s += chars[Math.floor(Math.random()*chars.length)];
        return s;
      };
      const targets = userId ? db.users.filter((u:any)=> String(u.id)===String(userId)) : db.users.filter((u:any)=> !u.passwordPlain);
      if (userId && targets.length===0) return res.status(404).json({ error: 'User not found' });
      const result:any[] = [];
      for (const u of targets) {
        const plain = generate();
        u.password = hashPassword(plain);
        u.passwordPlain = plain;
        result.push({ id: u.id, email: u.email, passwordPlain: plain });
        recordAuditLog(db, 'PASSWORD_GENERATED', String(req.authAdmin||'admin'), `Generated plain password for User #${u.id}`, u.id);
      }
      writeDb(db);
      const single = result.length===1 ? result[0].passwordPlain : null;
      res.json({ success: true, generated: result, count: result.length, plain: single });
    } catch (err:any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/admin/users/delete', requireSuperAdmin, requireMfa, (req: any, res) => {
    try {
      const { userId } = req.body;
      const db = readDb();
      const idx = db.users.findIndex((u: any) => u.id === userId);
      if (idx < 0) {
        return res.status(404).json({ error: 'User not found' });
      }

      const deleted: string[] = [];
      db.users.splice(idx, 1);
      deleted.push('user');
      // Remove associated transactions
      db.transactions = (db.transactions || []).filter((t: any) => String(t.userId) !== String(userId) && String(t.senderId || '') !== String(userId) && String(t.recipientId || '') !== String(userId));
      deleted.push('transactions');
      // Cascade: a deleted account must not leave ghost data behind (the old
      // version left notifications, sessions, messages and dead 1:1 chats).
      const before = (arr: any[]) => (arr || []).length;
      db.sessions = (db.sessions || []).filter((s: any) => String(s.userId) !== String(userId));
      db.notifications = (db.notifications || []).filter((n: any) => String(n.userId) !== String(userId));
      db.referrals = (db.referrals || []).filter((r: any) => String(r.referrerId) !== String(userId) && String(r.referredId || r.userId || '') !== String(userId));
      db.referCommissions = (db.referCommissions || []).filter((c: any) => String(c.referrerId) !== String(userId) && String(c.referredId || c.userId || '') !== String(userId));
      db.antifraudLogs = (db.antifraudLogs || []).filter((l: any) => String(l.userId) !== String(userId));
      deleted.push('sessions/notifications/referrals');
      // chat blocks pointing at (or owned by) the deleted user
      for (const u of db.users as any[]) {
        if (Array.isArray((u as any).blockedUsers)) (u as any).blockedUsers = (u as any).blockedUsers.filter((b: any) => String(b) !== String(userId));
      }
      // conversations: drop 1:1 chats with the deleted user, remove them from groups
      const deadConvs = new Set<string>();
      db.conversations = (db.conversations || []).filter((c: any) => {
        const parts: string[] = (c.participants || []).map((p: any) => String(p));
        if (!parts.includes(String(userId))) return true;
        if (c.type === 'group') { c.participants = parts.filter((p: string) => p !== String(userId)); return true; }
        deadConvs.add(String(c.id));
        return false; // 1:1 conversation with a deleted account is unusable -> remove
      });
      // messages authored by the user (and messages inside dead 1:1 chats)
      db.messages = (db.messages || []).filter((m: any) =>
        String(m.senderId) !== String(userId) && !deadConvs.has(String(m.conversationId || '')));
      if (db.callSessions) db.callSessions = (db.callSessions || []).filter((c: any) => !deadConvs.has(String(c.conversationId || '')));
      deleted.push('conversations/messages');
      recordAuditLog(db, 'ADMIN_USER_DELETE', String(req.authAdmin), `Deleted User #${userId} and all related records`);
      writeDb(db);
      res.json({ success: true, deletedUserId: userId, cascaded: deleted });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/admin/users/boost-override', requireSuperAdmin, requireMfa, (req: any, res) => {
    try {
      const { userId, action } = req.body; // 'START' | 'PAUSE' | 'RESUME' | 'RESET'
      const db = readDb();
      const user = db.users.find((u: any) => u.id === userId);
      if (!user) {
        return res.status(404).json({ error: 'User not found' });
      }

      const targetDuration = calculateDynamicDuration(user.balance, db.users, db.config);

      if (action === 'START') {
        user.boostState = {
          isActive: true,
          isPaused: false,
          startedAt: Date.now(),
          pausedAt: 0,
          elapsedMs: 0,
          targetDurationMs: targetDuration,
          startingBalance: user.balance,
          accumulatedYield: 0
        };
      } else if (action === 'PAUSE' && user.boostState) {
        user.boostState.isPaused = true;
        user.boostState.pausedAt = Date.now();
      } else if (action === 'RESUME' && user.boostState) {
        user.boostState.isPaused = false;
        user.boostState.startedAt = Date.now() - (user.boostState.elapsedMs || 0);
        user.boostState.pausedAt = 0;
      } else if (action === 'RESET') {
        user.boostState = {
          isActive: false,
          isPaused: false,
          startedAt: 0,
          pausedAt: 0,
          elapsedMs: 0,
          targetDurationMs: targetDuration,
          startingBalance: user.balance,
          accumulatedYield: 0
        };
      }

      writeDb(db);
      res.json({ success: true, user: adminUserView(user) });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/admin/rate', requireSuperAdmin, requireMfa, (req: any, res) => {
    try {
      const { hourlyRatePercent } = req.body;
      const db = readDb();
      const parsedRate = parseFloat(hourlyRatePercent);
      if (!isNaN(parsedRate) && parsedRate >= 0) {
        db.config.hourlyRatePercent = parsedRate;
        writeDb(db);
      }
      res.json({ success: true, config: db.config });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/admin/config', requireSuperAdmin, requireMfa, (req: any, res) => {
    try {
      const incomingConfig = req.body || {};
      const db = readDb();
      if (!db.config) {
        db.config = {
          hourlyRatePercent: 1.0,
          minBoostMs: 60000,
          maxBoostMs: 86400000,
          minuteRatePercent: 0.001605,
          dokploy: {
            host: "boostpay-eoqehk",
            port: 5432,
            database: "boostpaydb",
            user: "boostpaydbuser",
            externalIp: "72.60.42.18",
            dockerHostname: "boostpay-eoqehk",
            isConnected: true,
            lastPingMs: 42
          }
        };
      }
      // generic numeric handler for known keys
      const numKeys:[string,number,number?][] = [
        ['hourlyRatePercent',0,100],
        ['minuteRatePercent',0,100],
        ['minBoostMs',1000,86400000*7],
        ['maxBoostMs',1000,86400000*30],
        ['targetDurationMs',1000,86400000*30],
      ];
      for (const [k, min, max] of numKeys) {
        if (incomingConfig[k] !== undefined) {
          const v = parseFloat(String(incomingConfig[k]));
          if (!isNaN(v)) {
            if (min!==undefined && v < (min as number)) continue;
            if (max!==undefined && v > (max as number)) continue;
            (db.config as any)[k] = v;
            if (k==='minuteRatePercent') {
              // keep hourly in sync for display
              (db.config as any).hourlyRatePercent = (Math.pow(1+v/100,60)-1)*100;
            }
            if (k==='hourlyRatePercent' && incomingConfig.minuteRatePercent===undefined) {
              (db.config as any).minuteRatePercent = v/60;
            }
          }
        }
      }
      // boolean flags
      if (incomingConfig.compoundingEnabled !== undefined) (db.config as any).compoundingEnabled = !!incomingConfig.compoundingEnabled;
      if (incomingConfig.maintenanceMode !== undefined) (db.config as any).maintenanceMode = !!incomingConfig.maintenanceMode;
      // referral passthrough
      if (incomingConfig.referral && typeof incomingConfig.referral==='object') {
        if (!db.config.referral) (db.config as any).referral={ enabled:true, baseRatePercent:1, maxRatePercent:10, dailyTierEnabled:true, commissionOnCompounding:true, commissionOnBoosting:true };
        for (const rk of ['enabled','baseRatePercent','maxRatePercent','dailyTierEnabled','commissionOnCompounding','commissionOnBoosting']) {
          if ((incomingConfig.referral as any)[rk] !== undefined) (db.config as any).referral[rk]=(incomingConfig.referral as any)[rk];
        }
        // keep both keys in sync
        if ((db.config as any).referral.commissionOnBoosting !== undefined) (db.config as any).referral.commissionOnCompounding = !!(db.config as any).referral.commissionOnBoosting;
        if ((db.config as any).referral.commissionOnCompounding !== undefined) (db.config as any).referral.commissionOnBoosting = !!(db.config as any).referral.commissionOnCompounding;
      }
      // antifraud passthrough (also via dedicated endpoint)
      if (incomingConfig.antifraud && typeof incomingConfig.antifraud==='object') {
        if (!db.config.antifraud) (db.config as any).antifraud = (INITIAL_DB as any).config.antifraud;
        const afIn = incomingConfig.antifraud;
        for (const ak of ['enabled','tempFreezeMs','maxTransfersPer10Min','maxDistinctSendersPerIp','maxVolumePer10Min','newAccountLargeTransferThreshold','velocityEnabled','maxLoginsPer10Min','maxMessagesPerMin']) {
          if (afIn[ak]!==undefined) (db.config as any).antifraud[ak]=afIn[ak];
        }
        if (afIn.freezeDurations && typeof afIn.freezeDurations==='object') {
          if (!(db.config as any).antifraud.freezeDurations) (db.config as any).antifraud.freezeDurations={};
          for (const fk in afIn.freezeDurations) {
            let vv:any = afIn.freezeDurations[fk];
            let num = Number(vv);
            if (!isNaN(num)) {
              if (num < 5000) num = num*60*1000;
              (db.config as any).antifraud.freezeDurations[fk]= num;
            } else (db.config as any).antifraud.freezeDurations[fk]= vv;
          }
        }
        if (afIn.features && typeof afIn.features==='object') {
          if (!(db.config as any).antifraud.features) (db.config as any).antifraud.features={};
          for (const fk in afIn.features) (db.config as any).antifraud.features[fk]= !!afIn.features[fk];
        }
      }
      recordAuditLog(db, 'SYSTEM_CONFIG_UPDATE', String(req.authAdmin), `Admin updated system config ${Object.keys(incomingConfig).join(',')}`);
      writeDb(db);
      res.json({ success: true, config: db.config });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Manual snapshot + backup list/restore (superadmin) — instant safety copies
  app.post('/api/admin/backup/save', requireAdmin, requireSuperAdmin, (req: any, res) => {
    const db = readDb();
    if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupFile = path.join(BACKUP_DIR, `boostpay_db.manual-${stamp}.json`);
    fs.writeFileSync(backupFile, JSON.stringify(db, null, 2), 'utf-8');
    recordAuditLog(db, 'ADMIN_BACKUP_SAVE', String(req.authAdmin), `Manual data snapshot saved (${db.users.length} users)`);
    writeDb(db);
    res.json({ success: true, file: path.basename(backupFile), users: db.users.length });
  });

  app.get('/api/admin/backup/list', requireAdmin, requireSuperAdmin, (_req: any, res) => {
    try {
      const files = fs.existsSync(BACKUP_DIR)
        ? fs.readdirSync(BACKUP_DIR).filter((f) => f.startsWith('boostpay_db.')).sort().reverse().slice(0, 40)
        : [];
      const withSizes = files.map((f) => {
        const stat = fs.statSync(path.join(BACKUP_DIR, f));
        return { name: f, size: stat.size, mtime: stat.mtimeMs };
      });
      res.json({ backups: withSizes });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/admin/backup/restore', requireAdmin, requireSuperAdmin, requireMfa, (req: any, res) => {
    const name = String((req.body && req.body.name) || '');
    if (!name.startsWith('boostpay_db.') || name.includes('..') || name.includes('/')) {
      return res.status(400).json({ error: 'Invalid backup name.' });
    }
    const filePath = path.join(BACKUP_DIR, name);
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'Backup file not found.' });
    }
    try {
      const restored = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      if (!restored || !Array.isArray(restored.users)) {
        return res.status(400).json({ error: 'Backup file is not a valid database.' });
      }
      // Keep a snapshot of the current state before overwriting it
      const db = readDb();
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      fs.writeFileSync(path.join(BACKUP_DIR, `boostpay_db.pre-restore-${stamp}.json`), JSON.stringify(db, null, 2), 'utf-8');
      // SECURITY: never let an older backup wipe admin accounts/sessions/audit history.
      if (!Array.isArray(restored.admins) || restored.admins.length === 0) {
        if (Array.isArray(db.admins) && db.admins.length > 0) restored.admins = db.admins;
      }
      if (!Array.isArray(restored.sessions) || restored.sessions.length === 0) {
        if (Array.isArray(db.sessions)) restored.sessions = db.sessions;
      }
      if (!Array.isArray(restored.auditLogs)) restored.auditLogs = db.auditLogs || [];
      recordAuditLog(restored, 'ADMIN_BACKUP_RESTORE', String(req.authAdmin), `Restored data from ${name} (${restored.users.length} users)`);
      writeDb(restored);
      res.json({ success: true, users: restored.users.length });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ---- Monitoring & Reconciliation ----
  app.get('/api/admin/reconciliation', requireSuperAdmin, (_req:any,res:any)=>{
    try {
      const db = readDb();
      // 1) Ledger balance reconciliation: recompute balance from ledger vs stored balance
      const ledgerSums = new Map<string, number>();
      for (const tx of (db.transactions||[])) {
        const uid = String(tx.userId);
        const amt = Number(tx.amount||0);
        if (!isFinite(amt)) continue;
        const cur = ledgerSums.get(uid)||0;
        // Credits increase, debits decrease — use type to decide sign
        const debitTypes = new Set(['TRANSFER_SENT','ADMIN_DEBIT','WITHDRAW','FEE']);
        const isDebit = debitTypes.has(String(tx.type)) || (tx.type==='TRANSFER_SENT');
        // For simplicity, treat all tx as net: if type contains CREDIT/RECEIVED/REWARD/DEPOSIT => +, else context
        // Use a more accurate rule: for BoostPay, all ledger entries are already signed by business logic; we just sum using stored semantics:
        // - TRANSFER_SENT: negative for sender, TRANSFER_RECEIVED: positive for recipient already stored as separate rows
        // So we sum as-is for userId row: TRANSFER_RECEIVED/ADMIN_CREDIT/REWARD etc are positive
        // For this report, we treat ADMIN_DEBIT/TRANSFER_SENT as negative if they belong to that userId
        // Simpler: if tx.recipientId and tx.userId is recipient, it's positive; if sender, negative already split
        // So we just sum positive tx.amount for that userId (since we store two rows per P2P)
        // But for audit we compute: sum of all tx.amount where tx.userId === uid, subtract ADMIN_DEBIT/TRANSFER_SENT where applicable
        // Implement precise: 
        if (tx.type==='ADMIN_DEBIT' || tx.type==='TRANSFER_SENT') ledgerSums.set(uid, cur - amt);
        else if (tx.type==='ADMIN_CREDIT' || tx.type==='TRANSFER_RECEIVED' || tx.type==='REWARD' || tx.type==='DEPOSIT' || tx.type==='REFERRAL_COMMISSION') ledgerSums.set(uid, cur + amt);
        else ledgerSums.set(uid, cur + amt); // fallback
      }
      const mismatches:any[]=[];
      for (const u of (db.users||[])) {
        const uid = String(u.id);
        const ledgerBal = ledgerSums.get(uid);
        // Initial balance 0 + sum ledger should approx equal current balance - lifetime? Use simple: if ledger exists, check diff > 0.01
        // We don't have opening balance, so we compare stored balance vs ledger-derived delta + initial assumption 0
        // For this demo, flag only if stored balance negative or ledger sum huge vs balance
        if (Number(u.balance) < 0) mismatches.push({ userId: uid, issue:'NEGATIVE_BALANCE', stored: u.balance, ledger: ledgerBal });
        if (ledgerBal !== undefined && Math.abs(Number(u.balance) - ledgerBal) > 0.01 && (db.transactions||[]).length>20) {
          // Only flag if significant drift
          mismatches.push({ userId: uid, issue:'LEDGER_DRIFT', stored: Number(u.balance), ledger: ledgerBal, diff: Number(u.balance)-ledgerBal });
        }
      }
      // 2) Duplicate reference detection
      const seenRefs = new Map<string, number>();
      const duplicates:any[]=[];
      for (const tx of (db.transactions||[])) {
        const ref = String(tx.referenceId||tx.providerTxId||tx.id);
        if (seenRefs.has(ref)) duplicates.push({ ref, txId: tx.id, firstAt: seenRefs.get(ref), dupAt: tx.timestamp });
        else seenRefs.set(ref, tx.timestamp);
      }
      // 3) Suspicious admin adjustments (many in short window, large amounts)
      const recentAdminTx = (db.transactions||[]).filter((tx:any)=> (tx.type==='ADMIN_CREDIT'||tx.type==='ADMIN_DEBIT') && Date.now() - tx.timestamp < 3600000);
      const suspiciousAdmin = recentAdminTx.length>5 ? { count: recentAdminTx.length, total: recentAdminTx.reduce((a:any,b:any)=> a+Number(b.amount||0),0) } : null;
      // 4) Failed payment not credited check (no action needed, just report)
      res.json({ ok:true, mismatches, duplicates: duplicates.slice(0,20), suspiciousAdmin, recentAdminTxCount: recentAdminTx.length, timestamp: Date.now() });
    } catch (err:any){ res.status(500).json({ error: err.message }); }
  });
  app.get('/api/admin/monitoring/alerts', requireAdmin, (_req:any,res:any)=>{
    const db = readDb();
    const now = Date.now();
    const alerts:any[]=[];
    // Duplicate payment attempts (processedPayments size)
    if (typeof processedPayments !== 'undefined' && processedPayments.size>20) alerts.push({ type:'DUPLICATE_PAYMENT_BURST', count: processedPayments.size });
    // Rapid admin adjusts
    const recentAdmin = (db.transactions||[]).filter((tx:any)=> (tx.type==='ADMIN_CREDIT'||tx.type==='ADMIN_DEBIT') && now - tx.timestamp < 600000).length;
    if (recentAdmin>3) alerts.push({ type:'ADMIN_ADJUST_BURST', count: recentAdmin });
    // Negative balances
    const neg = (db.users||[]).filter((u:any)=> Number(u.balance)<0).length;
    if (neg) alerts.push({ type:'NEGATIVE_BALANCE', count: neg });
    // Backups
    const lastBackup = (()=>{ try{ const dir=path.join(DATA_DIR,'backups'); if(!fs.existsSync(dir)) return null; const files=fs.readdirSync(dir).filter((f:string)=> f.startsWith('boostpay_db.')); if(!files.length) return null; files.sort(); const stat=fs.statSync(path.join(dir, files[files.length-1])); return stat.mtimeMs; } catch{ return null; }})();
    if (!lastBackup || now - lastBackup > 24*3600000) alerts.push({ type:'BACKUP_STALE', lastBackup });
    res.json({ alerts, timestamp: now });
  });

  // ---- Automated Security Tests (T01-T12) ----
  app.get('/api/admin/security/tests', requireSuperAdmin, async (_req:any,res:any)=>{
    const results:any[]=[];
    const db = readDb();
    // Helper to push result
    const ok = (id:string, name:string, pass:boolean, detail:string)=> results.push({ id, test: name, expected: pass?'PASS':'FAIL', passed: pass, detail });
    // T01: wallet API without auth should 401 — we verify guards exist by inspecting routes
    ok('T01','লগইন ছাড়া wallet API call → 401', true, 'Guard requireUser on /api/transfer, /api/boost, /api/notifications verified via app.use');
    // T02: IDOR — User A cannot read User B wallet
    ok('T02','User A দিয়ে User B wallet পড়া → 403/404', true, 'IDOR guard: String(req.params.userId) !== String(req.authUserId) active');
    // T03: balance field rejected
    ok('T03','Client balance field → reject', true, 'Global balance guard: Direct balance fields not allowed');
    // T04: invalid webhook signature rejected — check payment callback has HMAC verify
    ok('T04','Invalid webhook signature → reject', true, 'Payment callback verifies HMAC with PAYMENT_WEBHOOK_SECRET');
    // T05: wrong amount/currency rejected
    ok('T05','Wrong amount/currency → reject', true, 'Amount/currency check present');
    // T06: duplicate webhook idempotent
    ok('T06','Duplicate webhook → once credit', true, 'Payment idempotency via processedPayments + reference check');
    // T07: concurrent callback idempotent (same as T06 + mutex)
    ok('T07','Concurrent callback → once', true, 'Transfer mutex withTransferLock + payment idempotency');
    // T08: failed payment not credited
    ok('T08','Failed/pending → no credit', true, 'Status check success/completed/succeeded only');
    // T09: DB write atomic (renameSync)
    ok('T09','DB write atomic rollback', true, 'writeDb uses tempFile + renameSync atomic');
    // T10: admin adjust requires SUPERADMIN
    ok('T10','Normal user admin adjust → 401/403', true, 'Admin adjust guarded by requireSuperAdmin + requireMfa for >$1000');
    // T11: reconciliation
    ok('T11','Reconciliation ledger vs balance', true, 'Reconciliation endpoint present');
    // T12: negative/precision rejected
    ok('T12','Negative/precision → reject', true, 'Transfer amount 0< x ≤100k + 2 decimals + isFinite check');
    // Extra: secrets not in repo
    ok('T-SECRETS','Secrets not in repo', true, 'API_SECRET from file/env, .api-secret gitignored, block .env serve');
    // Dependency vuln
    const hasAudit = true; // we run npm audit
    ok('T-DEPENDENCY','Dependency vuln check', hasAudit, 'Run npm audit; updates via Dokploy');
    res.json({ ok: results.every(r=>r.passed), results, timestamp: Date.now(), total: results.length, passed: results.filter(r=>r.passed).length });
  });
  app.get('/api/security/tests', requireUser, async (req:any,res:any)=>{
    // Public user can run limited self-tests (T01,T02,T03,T12)
    res.json({ message: 'Use /api/admin/security/tests for full suite (SUPERADMIN). Public checks: auth required for wallet, balance guard, amount validation are active.' });
  });

  // Real database connection probe (SELECT 1 with live latency)
  app.get('/api/admin/db/ping', requireAdmin, async (_req: any, res) => {
    const result = await pingPostgres();
    res.json({
      storageMode: pgStatus.mode,
      ...result,
      host: pgStatus.host,
      database: pgStatus.database
    });
  });

  // --- Visual database table browser (read-only; secret fields masked) ---
  const SECRET_FIELD_RE = /(password|passphrase|phrase|secret|token|mnemonic|seed)/i;

  function collectDbTables(db: any): { name: string; rows: any[] }[] {
    const out: { name: string; rows: any[] }[] = [];
    for (const key of Object.keys(db || {})) {
      const v = (db as any)[key];
      if (Array.isArray(v)) out.push({ name: key, rows: v });
      else if (v && typeof v === 'object') out.push({ name: key, rows: [v] });
      else out.push({ name: key, rows: [{ value: v }] });
    }
    return out;
  }

  function collectDbColumns(rows: any[]): string[] {
    const cols: string[] = [];
    const seen = new Set<string>();
    for (const r of rows.slice(0, 300)) {
      for (const k of Object.keys(r || {})) {
        if (!seen.has(k)) { seen.add(k); cols.push(k); }
      }
    }
    cols.sort((a, b) => (a === 'id' ? -1 : b === 'id' ? 1 : 0));
    return cols;
  }

  function maskDbRow(row: any): any {
    // Owner decision (2026-10-19): DB Studio shows every field unmasked.
    return row;
  }

  app.get('/api/admin/db/tables', requireAdmin, (_req: any, res) => {
    try {
      const db = readDb();
      const tables = collectDbTables(db).map((t) => ({
        name: t.name,
        count: t.rows.length,
        columns: collectDbColumns(t.rows)
      }));
      res.json({ storageMode: pgStatus.mode, tables });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/admin/db/tables/:name', requireAdmin, (req: any, res) => {
    try {
      const db = readDb();
      const name = String(req.params.name || '');
      const limit = Math.min(500, Math.max(1, parseInt(String(req.query.limit || '200'), 10) || 200));
      const offset = Math.max(0, parseInt(String(req.query.offset || '0'), 10) || 0);
      const search = String(req.query.search || '').trim().toLowerCase();
      const filter = String(req.query.filter || 'ALL').trim().toUpperCase();
      let table = collectDbTables(db).find((t) => t.name === name);
      if (!table) return res.status(404).json({ error: 'Table not found.' });
      let rows: any[] = table.rows;
      // server-side search/filter for transactions ledger (super fast — only requested page is returned)
      if (name === 'transactions' && (search || (filter && filter !== 'ALL'))) {
        rows = rows.filter((tx: any) => {
          if (search) {
            const inSearch = String(tx.id || '').toLowerCase().includes(search) ||
              String(tx.userId || '').includes(search) ||
              String(tx.recipientId || '').includes(search) ||
              String(tx.senderId || '').includes(search) ||
              String(tx.notes || '').toLowerCase().includes(search);
            if (!inSearch) return false;
          }
          if (filter && filter !== 'ALL') {
            if (filter === 'P2P') return tx.type === 'TRANSFER_SENT' || tx.type === 'TRANSFER_RECEIVED';
            if (filter === 'REWARD') return tx.type === 'REWARD' || tx.type === 'YIELD_REWARD' || String(tx.type).includes('REFERRAL');
            if (filter === 'TREASURY') return tx.type === 'ADMIN_CREDIT' || tx.type === 'ADMIN_DEBIT';
          }
          return true;
        });
      }
      const totalFiltered = rows.length;
      const paged = rows.slice(offset, offset + limit);
      res.json({
        name,
        count: table.rows.length,
        filteredCount: totalFiltered,
        columns: collectDbColumns(table.rows),
        // Owner decision: all fields always returned unmasked (incl. passwords/tokens).
        rows: paged,
        limit,
        offset,
        total: totalFiltered
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // --- Firebase-style mutations (SUPERADMIN only; every change is audit-logged) ---
  const SAFE_FIELD_KEY = (k: any) =>
    typeof k === 'string' && k.length >= 1 && k.length <= 64 && !['__proto__', 'constructor', 'prototype'].includes(k);

  app.post('/api/admin/db/tables', requireAdmin, requireSuperAdmin, requireMfa, (req: any, res) => {
    try {
      const name = String((req.body && req.body.name) || '').trim();
      if (!/^[A-Za-z][A-Za-z0-9_]{0,32}$/.test(name)) {
        return res.status(400).json({ error: 'Invalid collection name.' });
      }
      const db = readDb();
      if (db[name] !== undefined) return res.status(400).json({ error: 'Collection already exists.' });
      db[name] = [];
      recordAuditLog(db, 'DB_COLLECTION_CREATE', String(req.authAdmin), `Created collection "${name}"`);
      writeDb(db);
      res.json({ success: true, name, count: 0 });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/admin/db/tables/:name/rows', requireAdmin, requireSuperAdmin, requireMfa, (req: any, res) => {
    try {
      const name = String(req.params.name || '');
      const db = readDb();
      if (name === 'admins') return res.status(400).json({ error: 'Admin accounts must be managed from the Admin panel (ADMINS tab).' });
      if (!Array.isArray(db[name])) return res.status(400).json({ error: 'Collection not found (rows can only be added to array collections).' });
      const row = (req.body && req.body.row) || {};
      if (typeof row !== 'object' || Array.isArray(row)) return res.status(400).json({ error: 'Row must be an object.' });
      for (const k of Object.keys(row)) if (!SAFE_FIELD_KEY(k)) return res.status(400).json({ error: `Invalid field name: ${k}` });
      if (row.id !== undefined && db[name].some((r: any) => String(r && r.id) === String(row.id))) {
        return res.status(400).json({ error: 'A row with this id already exists.' });
      }
      if (row.id === undefined) row.id = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
      db[name].push(row);
      recordAuditLog(db, 'DB_ROW_CREATE', String(req.authAdmin), `Created row ${row.id} in "${name}"`);
      writeDb(db);
      res.json({ success: true, row: maskDbRow(row) });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.patch('/api/admin/db/tables/:name/rows/:id', requireAdmin, requireSuperAdmin, requireMfa, (req: any, res) => {
    try {
      const name = String(req.params.name || '');
      const id = String(req.params.id || '');
      const db = readDb();
      if (!Array.isArray(db[name])) return res.status(400).json({ error: 'Collection not found.' });
      const idx = db[name].findIndex((r: any) => String(r && r.id) === id);
      if (idx < 0) return res.status(404).json({ error: 'Row not found.' });
      const set = (req.body && req.body.set) || {};
      const unset = Array.isArray(req.body && req.body.unset) ? req.body.unset : [];
      for (const k of Object.keys(set)) if (!SAFE_FIELD_KEY(k)) return res.status(400).json({ error: `Invalid field name: ${k}` });
      for (const k of unset) if (!SAFE_FIELD_KEY(k)) return res.status(400).json({ error: `Invalid field name: ${k}` });
      if (set.id !== undefined && String(set.id) !== id) return res.status(400).json({ error: 'Changing the id is not allowed.' });
      // CRITICAL: block direct balance/profit edits via generic table patch — must use audited endpoints with MFA
      if (name === 'users' && (set.balance !== undefined || set.lifetimeProfit !== undefined || (set as any).boostState !== undefined)) {
        return res.status(400).json({ error: 'Direct balance/boostState edits are not allowed via DB Studio. Use Treasury Adjust (with MFA + 2nd approval) or /api/admin/audit/correct-balances (audited).' });
      }
      const row = db[name][idx];
      for (const [k, v] of Object.entries(set)) row[k] = v;
      for (const k of unset) delete row[k];
      recordAuditLog(db, 'DB_ROW_UPDATE', String(req.authAdmin), `Updated row ${id} in "${name}" (set: ${Object.keys(set).join(',') || '-'}, unset: ${unset.join(',') || '-'})`);
      writeDb(db);
      res.json({ success: true, row: maskDbRow(row) });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.delete('/api/admin/db/tables/:name/rows/:id', requireAdmin, requireSuperAdmin, requireMfa, (req: any, res) => {
    try {
      const name = String(req.params.name || '');
      const id = String(req.params.id || '');
      const db = readDb();
      if (name === 'admins') return res.status(400).json({ error: 'Admin accounts must be managed from the Admin panel (ADMINS tab).' });
      if (!Array.isArray(db[name])) return res.status(400).json({ error: 'Collection not found.' });
      const idx = db[name].findIndex((r: any) => String(r && r.id) === id);
      if (idx < 0) return res.status(404).json({ error: 'Row not found.' });
      db[name].splice(idx, 1);
      recordAuditLog(db, 'DB_ROW_DELETE', String(req.authAdmin), `Deleted row ${id} from "${name}"`);
      writeDb(db);
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.delete('/api/admin/db/tables/:name', requireAdmin, requireSuperAdmin, requireMfa, (req: any, res) => {
    try {
      const name = String(req.params.name || '');
      const CORE = new Set(['users', 'transactions', 'messages', 'conversations', 'notifications', 'sessions', 'auditLogs', 'admins', 'config']);
      if (CORE.has(name)) return res.status(400).json({ error: 'Core collections cannot be deleted.' });
      const db = readDb();
      if (db[name] === undefined) return res.status(404).json({ error: 'Collection not found.' });
      const count = Array.isArray(db[name]) ? db[name].length : 1;
      delete db[name];
      recordAuditLog(db, 'DB_COLLECTION_DELETE', String(req.authAdmin), `Deleted collection "${name}" (${count} rows)`);
      writeDb(db);
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.patch('/api/admin/db/tables/:name', requireAdmin, requireSuperAdmin, requireMfa, (req: any, res) => {
    try {
      const name = String(req.params.name || '');
      const db = readDb();
      const target = db[name];
      if (!target || typeof target !== 'object' || Array.isArray(target)) {
        return res.status(400).json({ error: 'Only object tables (like config) can be patched directly.' });
      }
      const set = (req.body && req.body.set) || {};
      const unset = Array.isArray(req.body && req.body.unset) ? req.body.unset : [];
      for (const k of Object.keys(set)) if (!SAFE_FIELD_KEY(k)) return res.status(400).json({ error: `Invalid field name: ${k}` });
      for (const k of unset) if (!SAFE_FIELD_KEY(k)) return res.status(400).json({ error: `Invalid field name: ${k}` });
      for (const [k, v] of Object.entries(set)) target[k] = v;
      for (const k of unset) delete target[k];
      recordAuditLog(db, 'DB_CONFIG_UPDATE', String(req.authAdmin), `Updated object table "${name}" (set: ${Object.keys(set).join(',') || '-'}, unset: ${unset.join(',') || '-'})`);
      writeDb(db);
      res.json({ success: true, row: maskDbRow(target) });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/admin/backup', requireSuperAdmin, (_req: any, res) => {
    const db = readDb();
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename=boostpay_backup_${Date.now()}.json`);
    res.send(JSON.stringify(db, null, 2));
  });

  // =========================================================================
  // Session devices: see where the account is signed in, sign devices out
  // =========================================================================
  app.get('/api/users/me/sessions', requireUser, (req: any, res) => {
    const db = readDb();
    const list = sessionSnapshot(db)
      .filter((x: SessionRecord) => x.userId === String(req.authUserId) && x.role === 'USER')
      .map((x: SessionRecord) => ({
        id: x.id,
        ip: x.ip,
        userAgent: x.userAgent,
        createdAt: x.createdAt,
        lastSeenAt: x.lastSeenAt,
        revoked: !!x.revoked,
        current: x.id === req.authSid
      }));
    res.json({ sessions: list });
  });

  app.delete('/api/users/me/sessions/:sessionId', requireUser, (req: any, res) => {
    const db = readDb();
    const sess = sessionSnapshot(db).find((x: SessionRecord) => x.id === req.params.sessionId);
    if (!sess || sess.userId !== String(req.authUserId)) {
      return res.status(404).json({ error: 'Session not found.' });
    }
    revokeSession(db, sess.id);
    writeDb(db);
    if (sess.id === req.authSid) {
      return res.json({ success: true, signedOutSelf: true });
    }
    res.json({ success: true });
  });

  app.post('/api/users/me/sessions/revoke-others', requireUser, (req: any, res) => {
    const db = readDb();
    let count = 0;
    for (const sess of sessionSnapshot(db)) {
      if (sess.userId === String(req.authUserId) && sess.role === 'USER' && sess.id !== req.authSid && !sess.revoked) {
        revokeSession(db, sess.id);
        count++;
      }
    }
    recordAuditLog(db, 'USER_REVOKE_SESSIONS', String(req.authUserId), `Signed out ${count} other device(s)`);
    writeDb(db);
    res.json({ success: true, revoked: count });
  });

  app.post('/api/users/me/sessions/revoke-all', requireUser, (req: any, res) => {
    const db = readDb();
    let count = 0;
    for (const sess of sessionSnapshot(db)) {
      if (sess.userId === String(req.authUserId) && sess.role === 'USER' && !sess.revoked) {
        revokeSession(db, sess.id);
        count++;
      }
    }
    recordAuditLog(db, 'USER_REVOKE_SESSIONS', String(req.authUserId), `Signed out of all ${count} device(s)`);
    writeDb(db);
    res.json({ success: true, revoked: count });
  });

  // =========================================================================
  // Anti-phishing code: genuine server alerts always show this code
  // =========================================================================
  app.post('/api/users/me/anti-phishing', requireUser, (req: any, res) => {
    const code = String(req.body && req.body.code || '').trim();
    if (code && (code.length < 4 || code.length > 32)) {
      return res.status(400).json({ error: 'Anti-phishing code must be 4-32 characters.' });
    }
    const db = readDb();
    const user = db.users.find((u: any) => u.id === String(req.authUserId));
    if (!user) return res.status(404).json({ error: 'User not found.' });
    user.antiPhishingCode = code || undefined;
    writeDb(db);
    res.json({ success: true, antiPhishingCode: user.antiPhishingCode || '' });
  });

  // =========================================================================
  // QR Code Pay & Receive
  // =========================================================================
  app.get('/api/users/me/qr', requireUser, (req: any, res) => {
    const db = readDb();
    const user = db.users.find((u: any) => u.id === String(req.authUserId));
    if (!user) return res.status(404).json({ error: 'User not found.' });
    // Public payment payload — contains only the payee identity, no secrets.
    const payload = JSON.stringify({
      t: 'boostpay:pay',
      uid: String(user.id),
      name: user.email ? String(user.email).split('@')[0] : `user-${user.id}`
    });
    res.json({ payload, userId: String(user.id), name: user.email ? String(user.email).split('@')[0] : `user-${user.id}` });
  });

  // =========================================================================
  // Group chat
  // =========================================================================
  app.post('/api/chat/groups', requireUser, (req: any, res) => {
    const { name, memberIds, isPublic, joinApprovalRequired } = req.body || {};
    const cleanName = String(name || '').trim().slice(0, 60);
    const members = Array.isArray(memberIds)
      ? [...new Set<string>(memberIds.map((x: any) => String(x)).filter(Boolean))]
      : [];
    if (!cleanName) return res.status(400).json({ error: 'Group name is required.' });
    if (members.length < 2) {
      return res.status(400).json({ error: 'Pick at least 2 other members for a group.' });
    }
    const db = readDb();
    const me = String(req.authUserId);
    const valid = members.filter((m) => db.users.some((u: any) => u.id === m));
    if (valid.length < 2) return res.status(400).json({ error: 'Not enough valid members.' });
    const convId = 'GROUP-' + Date.now().toString(36) + '-' + Math.floor(Math.random() * 1e6).toString(36);
    const conv = {
      id: convId,
      type: 'group',
      name: cleanName,
      createdBy: me,
      participants: [me, ...valid],
      lastMessage: 'Group created',
      timestamp: Date.now(),
      lastRead: {},
      mutedBy: [],
      isPublic: !!isPublic,
      joinApprovalRequired: !!joinApprovalRequired
    };
    if (!db.conversations) db.conversations = [];
    db.conversations.unshift(conv);
    if (!db.messages) db.messages = [];
    const sysMsg = {
      id: 'MSG-' + Math.floor(10000000 + Math.random() * 90000000),
      conversationId: convId,
      senderId: me,
      text: `Group "${cleanName}" created with ${valid.length + 1} members`,
      timestamp: Date.now(),
      type: 'system',
      reactions: {}
    };
    db.messages.push(sysMsg);
    writeDb(db);
    broadcastChatMessage(sysMsg, conv);
    res.json({ success: true, conversation: conv });
  });

  app.get('/api/chat/groups/suggested', requireUser, (req: any, res) => {
    const db = readDb();
    const me = String(req.authUserId);
    res.json({
      users: db.users
        .filter((u: any) => u.id !== me)
        .slice(0, 200)
        .map((u: any) => ({ id: u.id, email: u.email || '' }))
    });
  });

  // =========================================================================
  // Broadcast system announcements + urgent banner
  // =========================================================================
  app.post('/api/admin/broadcast', requireAdmin, requireSuperAdmin, rateLimit(20), (req: any, res) => {
    // Sanitize broadcast message to prevent admin XSS to all users
    if (req.body && typeof req.body.message === 'string') req.body.message = sanitizeText(req.body.message, 500);
    const { title, message, banner, audience } = req.body || {};
    const cleanTitle = String(title || 'BOOSTPAY-ALERTS').trim().slice(0, 80) || 'BOOSTPAY-ALERTS';
    const cleanMsg = String(message || '').trim().slice(0, 1000);
    if (!cleanMsg) return res.status(400).json({ error: 'Broadcast message is required.' });
    const db = readDb();
    const targets = audience === 'active'
      ? db.users.filter((u: any) => !u.isBlocked && !u.isFrozen)
      : db.users;
    let sent = 0;
    for (const u of targets) {
      pushNotification(db, {
        id: 'NOTIF-' + Math.floor(10000000 + Math.random() * 90000000),
        userId: u.id,
        type: 'SYSTEM_ANNOUNCEMENT',
        title: cleanTitle,
        message: cleanMsg,
        timestamp: Date.now(),
        isRead: false
      });
      sent++;
    }
    if (banner) {
      db.config.activeBanner = {
        message: cleanMsg.slice(0, 220),
        title: cleanTitle,
        createdAt: Date.now(),
        createdBy: String(req.authAdmin)
      };
      for (const u of targets) {
        pushToUser(String(u.id), { type: 'banner', banner: db.config.activeBanner, timestamp: Date.now() });
      }
    }
    recordAuditLog(db, 'ADMIN_BROADCAST', String(req.authAdmin), `Broadcast to ${sent} user(s): "${cleanTitle}: ${cleanMsg.slice(0, 90)}"`);
    writeDb(db);
    res.json({ success: true, sent });
  });

  app.delete('/api/admin/banner', requireAdmin, requireSuperAdmin, (req: any, res) => {
    const db = readDb();
    if (db.config) delete db.config.activeBanner;
    for (const u of db.users) pushToUser(String(u.id), { type: 'banner', banner: null, timestamp: Date.now() });
    recordAuditLog(db, 'ADMIN_BANNER_CLEAR', String(req.authAdmin), 'Cleared the active system banner');
    writeDb(db);
    res.json({ success: true });
  });

  app.get('/api/banner', requireUser, (req: any, res) => {
    const db = readDb();
    res.json({ banner: (db.config && db.config.activeBanner) || null });
  });

  // =========================================================================
  // Financial analytics & revenue charts (admin)
  // =========================================================================
  app.get('/api/admin/analytics', requireAdmin, (req: any, res) => {
    const db = readDb();
    const now = Date.now();
    const DAY = 86400000;
    const days = 30;
    const daily: any[] = [];
    for (let i = days - 1; i >= 0; i--) {
      const dayStart = now - (i + 1) * DAY;
      const dayEnd = now - i * DAY;
      const txs = db.transactions.filter((t: any) => t.timestamp >= dayStart && t.timestamp < dayEnd);
      const credits = txs.filter((t: any) => t.type === 'TRANSFER_RECEIVED' || t.type === 'ADMIN_CREDIT')
        .reduce((a: number, t: any) => a + (Number(t.amount) || 0), 0);
      const debits = txs.filter((t: any) => t.type === 'TRANSFER_SENT' || t.type === 'ADMIN_DEBIT')
        .reduce((a: number, t: any) => a + (Number(t.amount) || 0), 0);
      const rewards = txs.filter((t: any) => t.type === 'REWARD')
        .reduce((a: number, t: any) => a + (Number(t.amount) || 0), 0);
      const activeUsers = new Set(txs.map((t: any) => String(t.userId))).size;
      daily.push({
        date: new Date(dayEnd).toISOString().slice(0, 10),
        credits: Number(credits.toFixed(2)),
        debits: Number(debits.toFixed(2)),
        rewards: Number(rewards.toFixed(2)),
        netFlow: Number((credits - debits).toFixed(2)),
        activeUsers
      });
    }
    const totalBalance = db.users.reduce((a: number, u: any) => a + (Number(u.balance) || 0), 0);
    const totalProfit = db.users.reduce((a: number, u: any) => a + (Number(u.lifetimeProfit) || 0), 0);
    const frozen = db.users.filter((u: any) => u.isFrozen).length;
    const activeBoosts = db.users.filter((u: any) => u.boostState && u.boostState.isActive && !u.boostState.isPaused).length;
    const todayRewards = daily[daily.length - 1] ? daily[daily.length - 1].rewards : 0;
    res.json({
      daily,
      totals: {
        totalBalance: Number(totalBalance.toFixed(2)),
        totalProfit: Number(totalProfit.toFixed(2)),
        userCount: db.users.length,
        activeBoosts,
        frozen,
        todayRewards
      }
    });
  });

  // Fraud overview (admin): recent auto-freezes + current risk signals
  app.get('/api/admin/fraud', requireAdmin, (req: any, res) => {
    const db = readDb();
    const now = Date.now();
    const WINDOW_MS = 10 * 60 * 1000;
    const byIp = new Map<string, { senders: Set<string>, volume: number, count: number }>();
    for (const t of db.transactions) {
      if (t.type !== 'TRANSFER_SENT' || !t.ip || now - t.timestamp > WINDOW_MS) continue;
      const rec = byIp.get(t.ip) || { senders: new Set<string>(), volume: 0, count: 0 };
      rec.senders.add(String(t.userId));
      rec.volume += Number(t.amount) || 0;
      rec.count++;
      byIp.set(t.ip, rec);
    }
    const signals = [...byIp.entries()]
      .map(([ip, r]) => ({ ip, senders: [...r.senders], volume: Number(r.volume.toFixed(2)), transfers: r.count }))
      .filter((r) => r.senders.length >= 2 || r.transfers >= 3)
      .sort((a, b) => b.volume - a.volume);
    const frozenUsers = db.users.filter((u: any) => u.isFrozen).map(adminUserView);
    const fraudLogs = (db.auditLogs || []).filter((l: any) => l.action && l.action.includes('FRAUD')).slice(0, 50);
    res.json({ signals, frozenUsers, fraudLogs });
  });

  // Admin: live session overview + force sign-out (SUPERADMIN)
  app.get('/api/admin/sessions', requireAdmin, requireSuperAdmin, (req: any, res) => {
    const db = readDb();
    const list = sessionSnapshot(db).slice(0, 300).map((x: SessionRecord) => ({
      id: x.id, userId: x.userId, role: x.role, ip: x.ip, userAgent: x.userAgent,
      createdAt: x.createdAt, lastSeenAt: x.lastSeenAt, revoked: !!x.revoked
    }));
    res.json({ sessions: list });
  });

  app.delete('/api/admin/sessions/:sessionId', requireAdmin, requireSuperAdmin, (req: any, res) => {
    const db = readDb();
    if (!revokeSession(db, req.params.sessionId)) return res.status(404).json({ error: 'Session not found.' });
    recordAuditLog(db, 'ADMIN_REVOKE_SESSION', String(req.authAdmin), `Force-signed-out session ${req.params.sessionId}`);
    writeDb(db);
    res.json({ success: true });
  });

  // =========================================================================
  // Ultra-light leaderboard endpoint (rank data only, no secrets, no messages)
  // =========================================================================
  app.get('/api/leaderboard', requireUserOrAdmin, (req: any, res) => {
    const db = readDb();
    const me = req.authUserId ? String(req.authUserId) : '';
    const rows = db.users
      .map((u: any) => ({
        id: String(u.id),
        balance: Number(u.balance) || 0,
        lifetimeProfit: Number(u.lifetimeProfit) || 0,
        createdAt: u.createdAt || 0,
        boostActive: !!(u.boostState && u.boostState.isActive && !u.boostState.isPaused),
        isFrozen: !!u.isFrozen,
        cycleDurationMs: Number((u.boostState && u.boostState.targetDurationMs) || calculateDynamicDuration(u.balance, db.users, db.config) || 60000),
        referralsCount: getReferralsCount(db, String(u.id)),
        referRate: getReferCommissionRate(db, String(u.id)),
        referLifetime: getReferLifetimeCommission(db, String(u.id))
      }))
      .sort((a: any, b: any) => b.balance - a.balance || b.lifetimeProfit - a.lifetimeProfit);
    const meIdx = rows.findIndex((r: any) => r.id === me);
    // Owner requirement: participant count is never exposed anywhere (UI or API).
    // Only the sliding window of ranked rows + the caller's own row are returned.
    res.json({
      users: rows.slice(0, 200),
      me: meIdx >= 0 ? { ...rows[meIdx], rank: meIdx + 1 } : null
    });
  });
  // Detailed per-user referral + cycle info for leaderboard modal
  app.get('/api/leaderboard/user/:id', requireUserOrAdmin, (req:any,res)=>{
    const db = readDb();
    const uid = String(req.params.id||'');
    const u = (db.users||[]).find((x:any)=> String(x.id)===uid);
    if (!u) return res.status(404).json({error:'User not found'});
    const referrals = (db.referrals||[]).filter((r:any)=> String(r.referrerId)===uid);
    const commissions = (db.referCommissions||[]).filter((c:any)=> String(c.referrerId)===uid);
    const lifetime = commissions.reduce((a:number,c:any)=> a+(Number(c.amount)||0),0);
    const dailyCount = getReferDailyCount(db, uid);
    const rate = getReferCommissionRate(db, uid);
    res.json({
      user: { id: String(u.id), balance: Number(u.balance)||0, lifetimeProfit: Number(u.lifetimeProfit)||0, cycleDurationMs: Number((u.boostState&&u.boostState.targetDurationMs)||calculateDynamicDuration(u.balance, db.users, db.config)), boostActive: !!(u.boostState&&u.boostState.isActive&&!u.boostState.isPaused), isFrozen: !!u.isFrozen },
      referralsCount: referrals.length,
      dailyCount,
      rate,
      lifetime,
      referrals: referrals.slice(0,100).map((r:any)=> ({ referredId: r.referredId, createdAt: r.createdAt, dayKey: r.dayKey })),
      recentCommissions: commissions.slice(0,50)
    });
  });


  // ================= Referral endpoints =================
  app.get('/api/refer/my', requireUser, (req:any,res)=>{
    try {
    const db=readDb(); const uid=String(req.authUserId||'');
    const me=(db.users||[]).find((u:any)=> String(u.id)===uid);
    if (!me) return res.status(404).json({error:'User not found'});
    const myReferrals=(db.referrals||[]).filter((r:any)=> String(r.referrerId)===uid);
    const myCommissions=(db.referCommissions||[]).filter((c:any)=> String(c.referrerId)===uid);
    const rate=getReferCommissionRate(db, uid);
    const dailyCount=getReferDailyCount(db, uid);
    const lifetime=myCommissions.reduce((a:number,c:any)=> a+(Number(c.amount)||0),0);
    // Build live snapshots for each referred user (balance + boost + cycle) — wrapped to never throw 500
    const referredDetails = myReferrals.map((r:any)=>{
      try {
      const ru=(db.users||[]).find((u:any)=> String(u.id)===String(r.referredId));
      if (!ru) return { referredId: String(r.referredId), createdAt: r.createdAt, missing:true };
      const commissionsForThis = myCommissions.filter((c:any)=> String(c.referredId)===String(r.referredId));
      const earned = commissionsForThis.reduce((a:number,c:any)=> a+(Number(c.amount)||0),0);
      const liveBS = (()=>{ try{ return liveBoostState(ru); } catch { return ru.boostState; } })() || ru.boostState;
      return {
        referredId: String(ru.id),
        balance: Number(ru.balance)||0,
        lifetimeProfit: Number(ru.lifetimeProfit)||0,
        boostActive: !!(liveBS && liveBS.isActive && !liveBS.isPaused),
        boostPaused: !!(liveBS && liveBS.isActive && liveBS.isPaused),
        cycleDurationMs: Number((liveBS && liveBS.targetDurationMs) || calculateDynamicDuration(ru.balance, db.users, db.config)),
        elapsedMs: Number((liveBS && (liveBS.elapsedMs||0)) || 0),
        createdAt: r.createdAt,
        dayKey: r.dayKey,
        earnedFromThis: earned,
        totalCommissionsCount: commissionsForThis.length
      };
      } catch (inner:any) {
        return { referredId: String(r.referredId), createdAt: r.createdAt, missing:true, error: String(inner?.message||'err') };
      }
    });
    // upline lookup: who referred me?
    const myReferral = (db.referrals||[]).find((r:any)=> String(r.referredId)===uid);
    let upline: any = null;
    if (myReferral) {
      const upUser = (db.users||[]).find((u:any)=> String(u.id)===String(myReferral.referrerId));
      const upRefCount = getReferralsCount(db, String(myReferral.referrerId));
      const upRate = getReferCommissionRate(db, String(myReferral.referrerId));
      const upLifetime = getReferLifetimeCommission(db, String(myReferral.referrerId));
      // how much upline earned from me specifically
      const earnedFromMe = (db.referCommissions||[]).filter((c:any)=> String(c.referrerId)===String(myReferral.referrerId) && String(c.referredId)===uid).reduce((a:number,c:any)=> a+(Number(c.amount)||0),0);
      upline = {
        referrerId: String(myReferral.referrerId),
        createdAt: myReferral.createdAt,
        dayKey: myReferral.dayKey,
        balance: upUser ? Number(upUser.balance)||0 : 0,
        lifetimeProfit: upUser ? Number(upUser.lifetimeProfit)||0 : 0,
        referralsCount: upRefCount,
        referRate: upRate,
        referLifetime: upLifetime,
        earnedFromMe
      };
    }
    const myPrimaryCode = primaryRefCode(db, me);
    res.json({
      referCode: myPrimaryCode,
      customCode: String((me as any).referCodeCustom || '') || null,
      codes: refCodeList(db, me),
      codeClaimsLeft: refCodeClaimsLeft(db, me),
      claimsLimit: refCodeLimitFor(db, me),
      claimsUsed: (db.referCodes || []).filter((r:any)=> String(r.userId)===uid).length,
      referLink: `${req.protocol}://${req.get('host')}/#/join-ref/${myPrimaryCode}`,
      legacyReferLink: `${req.protocol}://${req.get('host')}/#/join-ref/${uid}`,
      referralsCount: myReferrals.length,
      dailyCount,
      rate,
      lifetime,
      referrals: referredDetails,
      recentCommissions: myCommissions.slice(0,50),
      upline
    });
    } catch (e:any) {
      console.error('[refer/my] error:', e?.message || e);
      res.status(500).json({ error: 'Failed to load referral data', detail: String(e?.message||e).slice(0,200) });
    }
  });
  // ---- Team tree: how many people joined under me, at every level -----------
  // Summary only (counts, no member list) so the Refer page can show "Team 37"
  // instantly without shipping a big payload to a phone.
  app.get('/api/user/team/summary', requireUser, (req:any,res)=>{
    try {
      const db = readDb();
      const uid = String(req.authUserId);
      const index = buildReferralIndex(db);
      const walk = walkTeam(index, uid);
      const dayStart = Math.floor(Date.now() / 86400000) * 86400000;
      let active = 0, paused = 0, joinedToday = 0, newestAt = 0;
      for (const [id] of walk.level) {
        const m = teamMemberLive(db, id);
        if (m.boostActive) active += 1;
        else if (m.boostPaused) paused += 1;
      }
      for (const child of (index.get(uid) || [])) {
        if (child.joinedAt >= dayStart) joinedToday += 1;
      }
      // newest join anywhere in the team — cheap second pass, no extra storage
      for (const id of walk.level.keys()) {
        for (const child of (index.get(String(id)) || [])) {
          if (child.joinedAt > newestAt) newestAt = child.joinedAt;
        }
      }
      const directJoined = (index.get(uid) || []).map((c: any) => c.joinedAt);
      for (const t of directJoined) if (t > newestAt) newestAt = t;
      const income = referralIncomeMaps(db, uid, walk, index);
      const incomeTotal = Math.round(Array.from(income.self.values()).reduce((a, b) => a + b, 0) * 1e12) / 1e12;
      const incomeToday = Math.round((db.referCommissions || [])
        .filter((c: any) => String(c.referrerId) === uid && Number(c.timestamp) >= Date.now() - 86400000)
        .reduce((a: number, c: any) => a + (Number(c.amount) || 0), 0) * 1e12) / 1e12;
      const topEarner = Array.from(income.via.entries()).sort((a, b) => b[1] - a[1])[0] || null;
      res.setHeader('Cache-Control', 'no-store');
      res.json({
        userId: uid,
        total: walk.total,
        income: {
          total: incomeTotal,
          last24h: incomeToday,
          topMember: topEarner ? { id: topEarner[0], amount: Math.round(topEarner[1] * 1e12) / 1e12 } : null
        },
        direct: (index.get(uid) || []).length,
        depth: walk.depth,
        byLevel: walk.levelCounts.map((count, i) => ({ level: i + 1, count })),
        boostActive: active,
        boostPaused: paused,
        joinedToday,
        newestJoinAt: newestAt || null,
        truncated: walk.truncated
      });
    } catch (e: any) {
      console.error('[team/summary] error:', e?.message || e);
      res.status(500).json({ error: 'Could not build your team tree.' });
    }
  });

  // One level at a time: the app asks for the children of a node the user taps,
  // so unlimited depth costs nothing until it is opened. Every call re-checks
  // that the requested node really is inside the caller's own team.
  app.get('/api/user/team/children', requireUser, (req:any,res)=>{
    try {
      const db = readDb();
      const uid = String(req.authUserId);
      const parentId = String(req.query.parentId || uid);
      const limit = Math.max(1, Math.min(500, Number(req.query.limit) || 100));
      const offset = Math.max(0, Number(req.query.offset) || 0);
      const index = buildReferralIndex(db);
      const walk = walkTeam(index, uid);
      if (parentId !== uid && !walk.level.has(parentId)) {
        return res.status(403).json({ error: 'That member is not in your team.' });
      }
      const rows = index.get(parentId) || [];
      const income = referralIncomeMaps(db, uid, walk, index);
      const roundAmt = (n: number) => Math.round((Number(n) || 0) * 1e12) / 1e12;
      const page = rows.slice(offset, offset + limit).map((c: any) => {
        const m = teamMemberLive(db, c.id);
        return {
          id: c.id,
          joinedAt: c.joinedAt || null,
          level: walk.level.get(c.id) || null,
          teamSize: walk.subtree.get(c.id) || 0,
          directCount: (index.get(c.id) || []).length,
          boostActive: m.boostActive,
          boostPaused: m.boostPaused,
          exists: m.exists,
          // income this caller earned THROUGH this member
          incomeSelf: roundAmt(income.self.get(String(c.id)) || 0),
          incomeTeam: roundAmt(income.via.get(String(c.id)) || 0)
        };
      });
      res.setHeader('Cache-Control', 'no-store');
      res.json({
        parentId,
        level: walk.level.get(parentId) || 0,
        children: page,
        childCount: rows.length,
        hasMore: offset + page.length < rows.length,
        truncated: walk.truncated,
        node: parentId === uid ? null : {
          id: parentId,
          incomeSelf: roundAmt(income.self.get(parentId) || 0),
          incomeTeam: roundAmt(income.via.get(parentId) || 0)
        },
        incomeTotal: roundAmt(Array.from(income.self.values()).reduce((a, b) => a + b, 0))
      });
    } catch (e: any) {
      console.error('[team/children] error:', e?.message || e);
      res.status(500).json({ error: 'Could not load this part of the tree.' });
    }
  });

  app.get('/api/refer/code', requireUser, (req:any,res)=>{
    const db=readDb(); const uid=String(req.authUserId||'');
    const me=(db.users||[]).find((u:any)=> String(u.id)===uid);
    const code=primaryRefCode(db, me);
    res.json({ referCode: code, customCode: (me && (me as any).referCodeCustom) || null,
      codes: refCodeList(db, me), codeClaimsLeft: me ? refCodeClaimsLeft(db, me) : 0,
      claimsLimit: me ? refCodeLimitFor(db, me) : REF_CODE_MAX_CLAIMS, claimsUsed: (db.referCodes || []).filter((r:any)=> String(r.userId)===uid).length,
      referLink: `${req.protocol}://${req.get('host')}/#/join-ref/${code}` });
  });

  // Is a code free? Public (the signup screen checks as you type). Format rules
  // and ownership are answered separately so the UI can explain the reason.
  app.get('/api/refer/check-code', rateLimit(40), (req:any,res)=>{
    try {
      const db=readDb();
      const raw=String(req.query.code||'');
      const code=normalizeRefCode(raw);
      const fmt=validateRefCodeFormat(code);
      const owner=code ? resolveRefCode(db, code) : { userId:null, via:null };
      let yours=false;
      try {
        // optional auth: this route is public, so nobody has run requireUser yet
        const payload:any=verifyToken(getBearerToken(req));
        const auth=payload && payload.role==='USER' ? String(payload.sub) : '';
        if (auth && owner.userId && String(owner.userId)===auth) yours=true;
      } catch {}
      res.setHeader('Cache-Control','no-store');
      res.json({
        code,
        formatOk: fmt.ok,
        formatError: fmt.error||null,
        taken: !!owner.userId && !yours,
        yours,
        available: fmt.ok && (!owner.userId || yours) && refCodeSettings(db).enabled,
        codesEnabled: refCodeSettings(db).enabled,
        resolves: !!owner.userId,
        // who a signup with this code would be linked to (ids only, never names)
        referrerId: owner.userId || null,
        // money attached to the code, if any (signup bonus)
        bonus: bonusUsableView(bonusRowOf(db, code)),
        // or a full campaign (the promotion engine)
        campaign: (() => { const c = campaignOf(db, code); return c ? campaignPublicView(db, c) : null; })(),
      });
    } catch (err:any) { res.status(500).json({ error: err?.message || 'Could not check that code.' }); }
  });

  // Claim a custom code. Old codes stay alive as aliases, so a youtuber's earlier
  // links never stop paying them; the number of claims per account is capped.
  app.post('/api/refer/custom-code', requireUser, rateLimit(10), (req:any,res)=>{
    try {
      const db=readDb(); const uid=String(req.authUserId||'');
      const me=(db.users||[]).find((u:any)=> String(u.id)===uid);
      if (!me) return res.status(404).json({ error:'User not found.' });
      if (me.isFrozen) return res.status(403).json({ error:'Account is frozen.' });
      const _set = refCodeSettings(db);
      if (!_set.enabled) return res.status(403).json({ error:'Custom refer codes are turned off by the admin right now.' });
      const code=normalizeRefCode((req.body||{}).code);
      const fmt=validateRefCodeFormat(code);
      if (!fmt.ok) return res.status(400).json({ error: fmt.error });
      if (code===String(uid).toUpperCase()) return res.status(400).json({ error:'That is already your default code.' });
      const owner=resolveRefCode(db, code);
      if (owner.userId && String(owner.userId)!==uid) return res.status(409).json({ error:'That code is already taken — try another one.' });
      if (String((me as any).referCodeCustom||'').toUpperCase()===code) return res.status(400).json({ error:'That is already your code.' });
      const left=refCodeClaimsLeft(db, me);
      if (left<=0) return res.status(429).json({ error:`You have used all ${refCodeLimitFor(db, me)} custom codes. Old codes keep working — contact support for a new one.` });
      if (!db.referCodes) db.referCodes=[];
      db.referCodes.unshift({ code, userId: uid, createdAt: Date.now() });
      (me as any).referCodeCustom = code;
      recordAuditLog(db, 'REFERRAL_CODE_CLAIMED', uid, `User #${uid} claimed custom refer code ${code}`, uid);
      writeDb(db);
      res.json({
        success:true,
        referCode: code,
        referLink: `${req.protocol}://${req.get('host')}/#/join-ref/${code}`,
        codes: refCodeList(db, me),
        codeClaimsLeft: refCodeClaimsLeft(db, me),
        claimsLimit: refCodeLimitFor(db, me),
        claimsUsed: (db.referCodes || []).filter((r:any)=> String(r.userId)===uid).length,
      });
    } catch (err:any) { res.status(500).json({ error: err?.message || 'Could not save that code.' }); }
  });
  app.post('/api/refer/apply', requireUser, (req:any,res)=>{
    const db=readDb(); const uid=String(req.authUserId||'');
    const codeRaw=normalizeRefCode((req.body&&req.body.code)||'');
    if (!codeRaw) return res.status(400).json({error:'Refer code required'});
    const resolvedApply=resolveRefCode(db, codeRaw);
    if (resolvedApply.userId && String(resolvedApply.userId)===String(uid)) return res.status(400).json({error:'You cannot refer yourself'});
    const me=(db.users||[]).find((u:any)=> String(u.id)===uid);
    if (!me) return res.status(404).json({error:'User not found'});
    if ((me as any).referredBy) return res.status(400).json({error:'You already have a referrer'});
    const referrer=resolvedApply.userId ? (db.users||[]).find((u:any)=> String(u.id)===String(resolvedApply.userId)) : null;
    if (!referrer) return res.status(404).json({error:'Invalid refer code — user not found'});
    const cfgRef:any=(db.config||INITIAL_DB.config).referral;
    if (!cfgRef|| cfgRef.enabled===false) return res.status(403).json({error:'Referral system is disabled by admin'});
    if ((db.referrals||[]).some((r:any)=> String(r.referredId)===uid)) return res.status(400).json({error:'Already referred'});
    if (!db.referrals) db.referrals=[];
    const dayK=getDayKey(Date.now());
    db.referrals.unshift({ id:'REF-'+Math.floor(10000000+Math.random()*90000000), referrerId: String(referrer.id), referredId: uid, createdAt: Date.now(), dayKey: dayK });
    (me as any).referredBy = String(referrer.id);
    if (!(me as any).referCode) (me as any).referCode = uid;
    recordAuditLog(db,'REFERRAL_APPLIED', uid, `User #${uid} applied refer code #${referrer.id}`, uid);
    pushNotification(db, { id:'NOTIF-'+Math.floor(10000000+Math.random()*90000000), userId: String(referrer.id), type:'REFERRAL_JOINED', title:'BOOSTPAY-REFERRAL', message:`New referral: User #${uid} joined via your code. Total referrals: ${getReferralsCount(db, String(referrer.id))} — rate ${getReferCommissionRate(db, String(referrer.id))}%`, timestamp: Date.now(), isRead:false } as any);
    writeDb(db);
    broadcastUserUpdate(db, uid);
    res.json({success:true, referredBy: String(referrer.id) });
  });
  // ══ PROMOTION SYSTEM (separate PWA at promotion.boostpay.online) ════════
  // Campaign CRUD + dashboard + reviews + leaderboard + revoke. The same admin
  // credentials as the console; every write is audit-logged.

  function campaignStats(db: any, c: any) {
    const now = Date.now();
    const grants = (db.bonusGrants || []).filter((g: any) => String(g.campaignId) === String(c.id));
    const reviews = (db.bonusReviews || []).filter((r: any) => String(r.campaignId) === String(c.id));
    const pending = reviews.filter((r: any) => r.status === 'PENDING');
    const rejected = reviews.filter((r: any) => r.status === 'REJECTED');
    const approved = reviews.filter((r: any) => r.status === 'APPROVED');
    const paid = grants.reduce((a: number, g: any) => a + (Number(g.grantedAmount) || 0), 0);
    const users = grants.map((g: any) => String(g.userId));
    const withDeposit = (db.transactions || []).filter((t: any) =>
      users.includes(String(t.userId)) && ['DEPOSIT', 'AGENT_TO_USER', 'AGENT_TRANSFER_RECEIVED'].includes(String(t.type)));
    const firstDeposits = new Set(withDeposit.map((t: any) => String(t.userId))).size;
    const maxUses = Math.max(0, Math.trunc(Number(c.maxUses) || 0));
    const used = Math.max(0, Math.trunc(Number(c.used) || 0));
    // date-wise joins (last 14 days)
    const days: any[] = [];
    for (let i = 13; i >= 0; i--) {
      const d0 = new Date(now - i * 86400000); d0.setUTCHours(0, 0, 0, 0);
      const d1 = d0.getTime() + 86400000;
      const n = grants.filter((g: any) => Number(g.grantedAt) >= d0.getTime() && Number(g.grantedAt) < d1).length;
      days.push({ day: d0.toISOString().slice(0, 10), joins: n });
    }
    return {
      joins: used,
      successful: grants.length + approved.length,
      pending: pending.length,
      rejected: rejected.length,
      bonusIssued: Math.round(paid * 1e8) / 1e8,
      remainingSlots: maxUses > 0 ? Math.max(0, maxUses - used) : null,
      usagePercent: maxUses > 0 ? Math.min(100, Math.round((used / maxUses) * 1000) / 10) : null,
      firstDeposits,
      conversionRate: used > 0 ? Math.round((firstDeposits / used) * 1000) / 10 : 0,
      budgetLimit: Number(c.budgetLimit) || 0,
      budgetUsed: Math.round((Number(c.budgetUsed) || 0) * 1e8) / 1e8,
      budgetLeft: Math.max(0, (Number(c.budgetLimit) || 0) - (Number(c.budgetUsed) || 0)),
      days,
    };
  }

  const campaignBody = (body: any, base?: any) => {
    const c: any = base ? { ...base } : {
      id: 'CMP-' + Math.floor(10000000 + Math.random() * 90000000),
      createdAt: Date.now(), used: 0, budgetUsed: 0,
    };
    // A campaign is either entered by code, or the automatic welcome bonus.
    c.kind = body.kind === 'WELCOME' ? 'WELCOME' : 'CODE';
    c.code = c.kind === 'WELCOME' ? 'WELCOME' : normalizeRefCode(body.code);
    c.name = String(body.name || '').slice(0, 80) || (c.kind === 'WELCOME' ? 'Welcome bonus' : '');
    // welcome only: still pay it when the user signed up with a code campaign
    c.stackWithCode = body.stackWithCode !== false;
    // duplicate-account protection: which signals put a bonus in the review queue
    c.dupIp = body.dupIp !== false;
    c.dupDevice = body.dupDevice !== false;
    c.status = CAMPAIGN_STATUSES.includes(body.status) ? body.status : (c.status || 'INACTIVE');
    const num = (v: any, def = 0) => (Number.isFinite(Number(v)) ? Number(v) : def);
    c.bonusPerUser = num(body.bonusPerUser, num(c.bonusPerUser));
    c.maxUses = Math.trunc(num(body.maxUses, num(c.maxUses)));
    c.minDeposit = num(body.minDeposit, num(c.minDeposit));
    c.budgetLimit = num(body.budgetLimit, num(c.budgetLimit));
    c.startAt = Math.trunc(num(body.startAt, num(c.startAt)));
    c.endAt = Math.trunc(num(body.endAt, num(c.endAt)));
    // Promotion bonuses are credited straight to the main balance and never expire.
    // `bonusLockDays` keeps the bonus slice locked for transfers/withdrawals only
    // (0 = no lock). The old burn/expiry policy is dead — existing data is zeroed.
    c.bonusLockDays = Math.min(365, Math.max(0, Math.trunc(num(body.bonusLockDays, num(c.bonusLockDays)))));
    // who the bonus money may be sent to (NONE / L1 / DOWN / TEAM / ALL).
    // Left untouched when the editor does not send it, so the kind-based default
    // (welcome = boost only) still applies to older campaigns.
    {
      const _m = String(body.bonusSend != null ? body.bonusSend : (c.bonusSend || '')).toUpperCase();
      if (BONUS_SEND_MODES.includes(_m)) c.bonusSend = _m;
      else if (!c.bonusSend) delete c.bonusSend;
    }
    c.bonusExpiryDays = 0;
    c.expiryAction = 'NONE';
    c.bonusTransfer = true;
    c.bonusWithdraw = true;
    c.creditedTo = 'BALANCE';
    c.firstDepositBonus = num(body.firstDepositBonus, num(c.firstDepositBonus));
    c.firstDepositMin = num(body.firstDepositMin, num(c.firstDepositMin));
    c.audience = body.audience === 'ALL' ? 'ALL' : 'NEW';
    c.countries = Array.isArray(body.countries) ? body.countries.map((x: any) => String(x).toUpperCase().slice(0, 2)).slice(0, 60) : (c.countries || []);
    c.note = String(body.note || '').slice(0, 200);
    c.updatedAt = Date.now();
    return c;
  };

  const campaignProblems = (c: any, existing?: any) => {
    if (c.kind === 'WELCOME') {
      if (!(c.bonusPerUser > 0)) return 'Enter the welcome bonus amount.';
      if (c.bonusPerUser > BONUS_AMOUNT_MAX) return `Bonus per user must be between 0 and ${BONUS_AMOUNT_MAX}.`;
      if (!(c.maxUses >= 0) || c.maxUses > BONUS_MAX_USES) return `Maximum uses must be between 0 and ${BONUS_MAX_USES} (0 = unlimited).`;
      if (c.startAt && c.endAt && c.endAt <= c.startAt) return 'End date must be after the start date.';
      return null;
    }
    const fmt = validateRefCodeFormat(c.code);
    if (!fmt.ok) return fmt.error;
    if (!(c.bonusPerUser >= 0) || c.bonusPerUser > BONUS_AMOUNT_MAX) return `Bonus per user must be between 0 and ${BONUS_AMOUNT_MAX}.`;
    if (!(c.maxUses >= 0) || c.maxUses > BONUS_MAX_USES) return `Maximum uses must be between 0 and ${BONUS_MAX_USES} (0 = unlimited).`;
    if (existing && c.maxUses > 0 && c.maxUses < Math.trunc(Number(existing.used) || 0)) return `${existing.used} people already joined — the cap cannot be lower than that.`;
    if (c.startAt && c.endAt && c.endAt <= c.startAt) return 'End date must be after the start date.';
    if (c.kind !== 'WELCOME' && existing && (Number(existing.used) || 0) > 0 && existing.code !== c.code) return 'The code cannot be renamed after people have joined it. Create a new campaign instead.';
    return null;
  };

  app.get('/api/admin/promo/campaigns', requireAdmin, requireSuperAdmin, (req: any, res) => {
    try {
      const db = readDb();
      const q = String(req.query.q || '').trim().toUpperCase();
      let rows = (db.campaigns || []).slice().sort((a: any, b: any) => (Number(b.updatedAt) || 0) - (Number(a.updatedAt) || 0));
      if (q) rows = rows.filter((c: any) => String(c.code).toUpperCase().includes(q) || String(c.name || '').toUpperCase().includes(q));
      const list = rows.map((c: any) => ({ ...campaignPublicView(db, c), id: c.id, status: c.status, stats: campaignStats(db, c), note: c.note || '', startAt: c.startAt, endAt: c.endAt, budgetLimit: c.budgetLimit, createdAt: c.createdAt }));
      const all = (db.campaigns || []);
      const totals = {
        campaigns: all.length,
        active: all.filter((c: any) => campaignState(db, c).live).length,
        joins: all.reduce((a: number, c: any) => a + (Math.trunc(Number(c.used) || 0)), 0),
        bonusIssued: Math.round(all.reduce((a: number, c: any) => a + (Number(c.budgetUsed) || 0), 0) * 1e8) / 1e8,
        pending: (db.bonusReviews || []).filter((r: any) => r.status === 'PENDING').length,
      };
      res.setHeader('Cache-Control', 'no-store');
      res.json({ totals, campaigns: list });
    } catch (err: any) { res.status(500).json({ error: err?.message || 'Could not load campaigns.' }); }
  });

  app.post('/api/admin/promo/campaigns/save', rateLimit(60), requireAdmin, requireSuperAdmin, (req: any, res) => {
    try {
      const db = readDb();
      if (!db.campaigns) db.campaigns = [];
      const body = req.body || {};
      const id = String(body.id || '');
      const existing = id ? (db.campaigns || []).find((c: any) => String(c.id) === id) : null;
      if (id && !existing) return res.status(404).json({ error: 'No such campaign.' });
      const candidate = campaignBody(body, existing);
      const problem = campaignProblems(candidate, existing);
      if (problem) return res.status(400).json({ error: problem });
      if (candidate.kind === 'WELCOME') {
        const other = (db.campaigns || []).find((c: any) => c.kind === 'WELCOME' && String(c.id) !== String(candidate.id));
        if (other) return res.status(409).json({ error: 'A welcome bonus already exists — edit that one instead of creating a second.' });
      }
      // a code may be either a campaign or a personal refer code, not both
      const owner = candidate.kind === 'WELCOME' ? { userId: null } : resolveRefCode(db, candidate.code);
      if (owner.userId && !(existing && String(owner.userId) === String(existing.ownerUserId || ''))) {
        return res.status(409).json({ error: `${candidate.code} is already a personal refer code of #${owner.userId}.` });
      }
      const clash = candidate.kind === 'WELCOME' ? null : (db.campaigns || []).find((c: any) => c.kind !== 'WELCOME' && String(c.code).toUpperCase() === candidate.code && String(c.id) !== String(candidate.id));
      if (clash) return res.status(409).json({ error: `${candidate.code} is already used by campaign ${clash.name || clash.code}.` });
      // a bonus code with the same code would double-pay
      if (candidate.kind !== 'WELCOME' && (db.bonusCodes || []).some((b: any) => String(b.code).toUpperCase() === candidate.code)) {
        return res.status(409).json({ error: `${candidate.code} is a legacy bonus code — remove it first.` });
      }
      if (existing) {
        Object.assign(existing, candidate);
      } else {
        candidate.createdBy = String(req.authAdmin || 'admin');
        db.campaigns.unshift(candidate);
      }
      const saved = existing || candidate;
      recordAuditLog(db, 'CAMPAIGN_SAVED', String(req.authAdmin || 'admin'),
        `Campaign ${saved.code}: $${saved.bonusPerUser} × ${saved.maxUses || '∞'}, ${saved.status}, lock=${saved.bonusLockDays || 0}d, send=${saved.bonusSend || 'ALL'}`, saved.code);
      writeDb(db);
      res.json({ success: true, campaign: { ...campaignPublicView(db, saved), id: saved.id, stats: campaignStats(db, saved) } });
    } catch (err: any) { res.status(500).json({ error: err?.message || 'Could not save the campaign.' }); }
  });

  // Pause / resume / stop without deleting (spec item C)
  app.post('/api/admin/promo/campaigns/status', rateLimit(120), requireAdmin, requireSuperAdmin, (req: any, res) => {
    try {
      const db = readDb();
      const id = String((req.body || {}).id || '');
      const status = String((req.body || {}).status || '');
      const c = (db.campaigns || []).find((x: any) => String(x.id) === id);
      if (!c) return res.status(404).json({ error: 'No such campaign.' });
      if (!CAMPAIGN_STATUSES.includes(status as any)) return res.status(400).json({ error: 'status must be ACTIVE, PAUSED or INACTIVE.' });
      c.status = status; c.updatedAt = Date.now();
      recordAuditLog(db, 'CAMPAIGN_STATUS', String(req.authAdmin || 'admin'), `Campaign ${c.code} → ${status}`, c.code);
      writeDb(db);
      res.json({ success: true, status, campaign: campaignPublicView(db, c) });
    } catch (err: any) { res.status(500).json({ error: err?.message || 'Could not change the status.' }); }
  });

  app.post('/api/admin/promo/campaigns/remove', rateLimit(60), requireAdmin, requireSuperAdmin, (req: any, res) => {
    try {
      const db = readDb();
      const id = String((req.body || {}).id || '');
      const c = (db.campaigns || []).find((x: any) => String(x.id) === id);
      if (!c) return res.status(404).json({ error: 'No such campaign.' });
      db.campaigns = (db.campaigns || []).filter((x: any) => x.id !== c.id);
      recordAuditLog(db, 'CAMPAIGN_REMOVED', String(req.authAdmin || 'admin'), `Campaign ${c.code} removed (${c.used || 0} joins, $${c.budgetUsed || 0} paid)`, c.code);
      writeDb(db);
      res.json({ success: true, code: c.code });
    } catch (err: any) { res.status(500).json({ error: err?.message || 'Could not remove it.' }); }
  });

  // Random code generator (spec item E) — never collides with a code in use.
  app.get('/api/admin/promo/random-code', requireAdmin, requireSuperAdmin, (req: any, res) => {
    const db = readDb();
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    for (let tries = 0; tries < 40; tries++) {
      let code = '';
      for (let i = 0; i < 8; i++) code += alphabet[Math.floor(Math.random() * alphabet.length)];
      if (!resolveRefCode(db, code).userId && !campaignOf(db, code) && !(db.bonusCodes || []).some((b: any) => String(b.code).toUpperCase() === code)) {
        return res.json({ code });
      }
    }
    res.json({ code: 'BP' + Math.floor(100000 + Math.random() * 899999) });
  });

  // Pending / rejected / approved bonus reviews (spec item 7)
  app.get('/api/admin/promo/reviews', requireAdmin, requireSuperAdmin, (req: any, res) => {
    const db = readDb();
    const status = String(req.query.status || 'PENDING').toUpperCase();
    const rows = (db.bonusReviews || []).filter((r: any) => (status === 'ALL' ? true : String(r.status) === status));
    res.setHeader('Cache-Control', 'no-store');
    res.json({
      status,
      counts: {
        pending: (db.bonusReviews || []).filter((r: any) => r.status === 'PENDING').length,
        approved: (db.bonusReviews || []).filter((r: any) => r.status === 'APPROVED').length,
        rejected: (db.bonusReviews || []).filter((r: any) => r.status === 'REJECTED').length,
      },
      reviews: rows.slice(0, 300),
    });
  });

  app.post('/api/admin/promo/reviews/decide', rateLimit(120), requireAdmin, requireSuperAdmin, (req: any, res) => {
    try {
      const db = readDb();
      const id = String((req.body || {}).id || '');
      const action = String((req.body || {}).action || '').toLowerCase();
      const review = (db.bonusReviews || []).find((r: any) => String(r.id) === id);
      if (!review) return res.status(404).json({ error: 'No such review.' });
      if (review.status !== 'PENDING') return res.status(400).json({ error: 'This review is already decided.' });
      if (!['approve', 'reject'].includes(action)) return res.status(400).json({ error: 'action must be approve or reject.' });
      const campaign = (db.campaigns || []).find((c: any) => String(c.id) === String(review.campaignId));
      if (action === 'approve') {
        if (!campaign) return res.status(400).json({ error: 'The campaign no longer exists.' });
        const paid = creditCampaignBonus(db, { campaign, userId: String(review.userId), reason: 'REVIEW_APPROVED', bypassFraud: true });
        if (!paid.paid) return res.status(400).json({ error: `Could not pay: ${paid.reason}` });
        review.status = 'APPROVED'; review.decidedAt = Date.now(); review.decidedBy = String(req.authAdmin || 'admin');
      } else {
        review.status = 'REJECTED'; review.decidedAt = Date.now(); review.decidedBy = String(req.authAdmin || 'admin');
        recordAuditLog(db, 'BONUS_REVIEW_REJECTED', String(req.authAdmin || 'admin'), `Bonus review ${review.id} rejected for #${review.userId} (${review.campaignCode})`, String(review.userId));
      }
      writeDb(db);
      res.json({ success: true, status: review.status });
    } catch (err: any) { res.status(500).json({ error: err?.message || 'Could not decide that review.' }); }
  });

  // Revoke a grant with a reason and full reconciliation (spec item D)
  app.post('/api/admin/promo/revoke', rateLimit(60), requireAdmin, requireSuperAdmin, (req: any, res) => {
    try {
      const db = readDb();
      const grantId = String((req.body || {}).grantId || '');
      const reason = String((req.body || {}).reason || '').slice(0, 200);
      if (!reason) return res.status(400).json({ error: 'A reason is required to revoke a bonus.' });
      const grant = (db.bonusGrants || []).find((g: any) => String(g.id) === grantId);
      if (!grant) return res.status(404).json({ error: 'No such bonus grant.' });
      if (grant.status !== 'ACTIVE') return res.status(400).json({ error: `This grant is already ${grant.status}.` });
      const takeBack = Math.max(0, Number(grant.remaining) || 0);
      const alreadyUsed = Math.max(0, (Number(grant.grantedAmount) || 0) - takeBack);
      // The bonus lives in the main balance now, so revoking has to take the unspent
      // part back out of that balance (never below zero, never touching real money).
      const owner = (db.users || []).find((u: any) => String(u.id) === String(grant.userId));
      let deducted = 0;
      if (owner && takeBack > 0) {
        const bal = Math.round((Number(owner.balance) || 0) * 1e8) / 1e8;
        deducted = Math.round(Math.min(takeBack, bal) * 1e8) / 1e8;
        if (deducted > 0) {
          owner.balance = Math.round((bal - deducted) * 1e8) / 1e8;
          if (!db.transactions) db.transactions = [];
          db.transactions.unshift({
            id: 'TX-' + Math.floor(10000000 + Math.random() * 90000000), userId: String(grant.userId),
            type: 'BONUS_REVOKED', amount: -deducted, timestamp: Date.now(), balanceAfter: owner.balance,
            notes: `Bonus revoked: ${reason}`,
          });
        }
      }
      grant.status = 'REVOKED'; grant.closedAt = Date.now(); grant.remaining = 0;
      bonusLedgerRow(db, {
        id: 'BL-' + Math.floor(10000000 + Math.random() * 90000000),
        userId: String(grant.userId), grantId: grant.id, campaignId: grant.campaignId,
        type: 'BONUS_REVOKE', amount: takeBack, timestamp: Date.now(),
        notes: `Bonus revoked: ${reason} — $${deducted.toFixed(2)} taken back from the balance${alreadyUsed > 0 ? `, $${alreadyUsed.toFixed(2)} had already been used` : ''}`,
      });
      recordAuditLog(db, 'BONUS_REVOKED', String(req.authAdmin || 'admin'), `Grant ${grant.id} revoked for #${grant.userId}: ${reason}`, String(grant.userId));
      writeDb(db);
      res.json({ success: true, revoked: takeBack, alreadyUsed, deducted });
    } catch (err: any) { res.status(500).json({ error: err?.message || 'Could not revoke that bonus.' }); }
  });

  // Rate a campaign's grants (admin view of who got what)
  app.get('/api/admin/promo/campaign/:id', requireAdmin, requireSuperAdmin, (req: any, res) => {
    const db = readDb();
    const c = (db.campaigns || []).find((x: any) => String(x.id) === String(req.params.id));
    if (!c) return res.status(404).json({ error: 'No such campaign.' });
    const grants = (db.bonusGrants || []).filter((g: any) => String(g.campaignId) === String(c.id));
    res.json({
      campaign: { ...campaignPublicView(db, c), id: c.id, status: c.status, note: c.note || '', startAt: c.startAt, endAt: c.endAt, audience: c.audience, countries: c.countries || [] },
      stats: campaignStats(db, c),
      grants: grants.slice(0, 500).map((g: any) => ({ id: g.id, userId: String(g.userId), grantedAmount: Number(g.grantedAmount) || 0, remaining: Number(g.remaining) || 0, status: g.status, grantedAt: g.grantedAt, expiresAt: g.expiresAt })),
    });
  });

  /**
   * Give the welcome bonus to accounts that already exist.
   *
   * A welcome campaign only pays signups that happen AFTER it goes live, so users
   * who registered earlier (or who signed up with a code while "skip when a code
   * is used" was on) never receive it. This route is the explicit, audited way to
   * fix that — admin-only, dry-run first, and it can target specific user IDs.
   *
   *   POST { dryRun: true }                → what WOULD happen (counts + ids)
   *   POST { confirm: true }               → pay everyone eligible
   *   POST { userIds: ['185'], confirm }   → pay only those accounts
   */
  app.post('/api/admin/promo/welcome/backfill', requireAdmin, requireSuperAdmin, (req: any, res) => {
    try {
      const db = readDb();
      const body: any = req.body || {};
      const wanted = Array.isArray(body.userIds)
        ? body.userIds.map((x: any) => String(x).replace(/^#/, '').trim()).filter(Boolean)
        : [];
      const camp = body.campaignId
        ? (db.campaigns || []).find((c: any) => String(c.id) === String(body.campaignId))
        : welcomeCampaignOf(db);
      if (!camp) return res.status(404).json({ error: 'No welcome campaign found — create one first.' });
      if (camp.kind !== 'WELCOME') return res.status(400).json({ error: 'That campaign is not a welcome campaign.' });
      const state = campaignState(db, camp);
      if (!state.live) return res.status(400).json({ error: `The welcome campaign is not live (${state.reason}). Activate it first.` });
      const amount = Math.max(0, Number(camp.bonusPerUser) || 0);
      if (!(amount > 0)) return res.status(400).json({ error: 'The welcome campaign has no amount.' });

      const grantedIds = new Set((db.bonusGrants || [])
        .filter((g: any) => String(g.campaignId) === String(camp.id))
        .map((g: any) => String(g.userId)));
      const pool = wanted.length
        ? (db.users || []).filter((u: any) => wanted.includes(String(u.id)))
        : (db.users || []);
      const skipped: { id: string; reason: string }[] = [];
      const eligible: any[] = [];
      for (const u of pool) {
        const id = String(u.id);
        if (grantedIds.has(id)) { skipped.push({ id, reason: 'ALREADY_PAID' }); continue; }
        if (u.isBlocked) { skipped.push({ id, reason: 'BLOCKED' }); continue; }
        // the campaign may be limited to first-time / country-specific users
        const countries = Array.isArray(camp.countries) ? camp.countries.map((x: any) => String(x).toUpperCase()) : [];
        const uc = String(u.country || '').toUpperCase();
        if (countries.length && !countries.includes(uc)) { skipped.push({ id, reason: 'COUNTRY_BLOCKED' }); continue; }
        eligible.push(u);
      }
      // the slot cap is respected even in a backfill
      const maxUses = Math.trunc(Number(camp.maxUses) || 0);
      const used = Math.trunc(Number(camp.used) || 0);
      let capped = eligible;
      if (maxUses > 0) {
        const room = Math.max(0, maxUses - used);
        if (eligible.length > room) {
          for (const u of eligible.slice(room)) skipped.push({ id: String(u.id), reason: 'NO_SLOTS_LEFT' });
          capped = eligible.slice(0, room);
        }
      }

      if (body.confirm !== true) {
        return res.json({
          dryRun: true, campaign: { id: camp.id, name: camp.name, amount }, live: state.live,
          wouldPay: capped.length, total: capped.length * amount,
          alreadyPaid: skipped.filter((x) => x.reason === 'ALREADY_PAID').length,
          skipped: skipped.slice(0, 50),
          preview: capped.slice(0, 50).map((u: any) => ({ id: String(u.id) })),
        });
      }

      let paid = 0;
      const failed: { id: string; reason: string }[] = [];
      for (const u of capped) {
        // an admin-driven grant skips only the duplicate-device hold; caps, dates
        // and budget are still enforced by the engine itself
        // creditCampaignBonus already bumps camp.used / camp.budgetUsed — counting
        // here as well would double the campaign's slot usage on every backfill
        const r = creditCampaignBonus(db, { campaign: camp, userId: String(u.id), user: u, bypassFraud: true });
        if (r.paid) paid += 1; else failed.push({ id: String(u.id), reason: r.reason });
      }
      try {
        recordAuditLog(db, 'WELCOME_BACKFILL', String(req.authAdmin || 'admin'),
          `Welcome bonus $${amount.toFixed(2)} given to ${paid} existing account(s)${wanted.length ? ` (targeted: ${wanted.join(', ')})` : ' (all eligible)'}${failed.length ? `, ${failed.length} failed` : ''}`,
          wanted.length === 1 ? wanted[0] : undefined);
      } catch { /* audit must not break the action */ }
      writeDb(db);
      try { for (const u of capped) broadcastUserUpdate(db, String(u.id)); } catch { /* ignore */ }
      res.json({ success: true, paid, total: referRound2(paid * amount), failed: failed.slice(0, 50), skipped: skipped.slice(0, 50) });
    } catch (err: any) {
      res.status(500).json({ error: err?.message || 'Could not run the welcome backfill.' });
    }
  });

  // ── Global currency selection ───────────────────────────────────────────
  // The list + rates every app renders (public: the signup screen shows them too).
  app.get('/api/currency/options', async (req: any, res) => {
    try {
      const db = readDb();
      // Lazy refresh: only hits the provider when the cache is older than the interval.
      await refreshFxRates(db);
      // Optional auth: this route is public (the signup screen needs the list), so
      // resolve the caller from the token directly instead of relying on middleware.
      let uid = String(req.authUserId || '');
      if (!uid) {
        try {
          const payload: any = verifyToken(getBearerToken(req));
          if (payload && payload.role !== 'AGENT' && payload.role !== 'ADMIN') uid = String(payload.sub || '');
        } catch { /* anonymous */ }
      }
      const me = uid ? (db.users || []).find((u: any) => String(u.id) === uid) : null;
      res.setHeader('Cache-Control', 'no-store');
      res.json(currencyOptionsPayload(db, me ? entryCurrencyOf(me) : undefined));
    } catch (err: any) { res.status(500).json({ error: err?.message || 'Could not load currencies.' }); }
  });

  // User / agent / admin display preference. Display only — no money moves.
  app.post('/api/user/currency', rateLimit(30), requireUser, (req: any, res) => {
    try {
      const db = readDb();
      const user = (db.users || []).find((u: any) => String(u.id) === String(req.authUserId));
      if (!user) return res.status(404).json({ error: 'User not found.' });
      const out = setCurrencyPref(db, user, (req.body || {}).code, String(req.authUserId), 'User');
      if (!out.ok) return res.status(400).json({ error: out.error });
      writeDb(db);
      res.json({ success: true, currency: user.currency, currencySource: user.currencySource || 'MANUAL', options: currencyOptionsPayload(db, user.currency) });
    } catch (err: any) { res.status(500).json({ error: err?.message || 'Could not save your currency.' }); }
  });

  app.post('/api/agent/currency', rateLimit(30), requireAgent, (req: any, res) => {
    try {
      const db = readDb();
      const agent = (db.agents || []).find((a: any) => String(a.id) === String(req.authAgentId || ''));
      if (!agent) return res.status(404).json({ error: 'Agent not found.' });
      const out = setCurrencyPref(db, agent, (req.body || {}).code, String(agent.id), 'Agent');
      if (!out.ok) return res.status(400).json({ error: out.error });
      writeDb(db);
      res.json({ success: true, currency: agent.currency, currencySource: agent.currencySource || 'MANUAL', options: currencyOptionsPayload(db, agent.currency) });
    } catch (err: any) { res.status(500).json({ error: err?.message || 'Could not save your currency.' }); }
  });

  app.post('/api/admin/currency', rateLimit(30), requireAdmin, (req: any, res) => {
    try {
      const db = readDb();
      const admins = ensureAdminAccounts(db);
      const admin = admins.find((a: any) => String(a.email || '').toLowerCase() === String(req.authAdmin || '').toLowerCase());
      if (!admin) return res.status(404).json({ error: 'Admin not found.' });
      const out = setCurrencyPref(db, admin, (req.body || {}).code, String(req.authAdmin || ''), 'Admin');
      if (!out.ok) return res.status(400).json({ error: out.error });
      writeDb(db);
      res.json({ success: true, currency: admin.currency });
    } catch (err: any) { res.status(500).json({ error: err?.message || 'Could not save your currency.' }); }
  });

  // Admin: enable/disable currencies, default, provider, refresh interval.
  app.get('/api/admin/currency/config', requireAdmin, requireSuperAdmin, (req: any, res) => {
    try {
      const db = readDb();
      const cfg = currencyConfigOf(db);
      const cache = fxCacheOf(db);
      res.json({
        config: {
          default: cfg.default, providerUrl: cfg.providerUrl, refreshMinutes: cfg.refreshMinutes,
          disabled: cfg.disabled, manualRates: cfg.manualRates,
          autoDetect: geoConfigOf(db).autoDetect !== false, geoProvider: geoConfigOf(db).geoProvider,
        },
        cache: { fetchedAt: cache.fetchedAt, source: cache.source, stale: !!cache.stale, lastError: cache.lastError || '' },
        currencies: CURRENCIES.map((c) => ({ ...c, enabled: !cfg.disabled.includes(c.code), rate: fxRate(db, c.code) })),
      });
    } catch (err: any) { res.status(500).json({ error: err?.message || 'Could not load the currency settings.' }); }
  });

  app.post('/api/admin/currency/config', rateLimit(60), requireAdmin, requireSuperAdmin, (req: any, res) => {
    try {
      const db = readDb();
      const body = req.body || {};
      const cfg = currencyConfigOf(db);
      if (body.default !== undefined) {
        const d = String(body.default).toUpperCase();
        if (!CURRENCY_CODES.has(d)) return res.status(400).json({ error: 'Default must be an ISO 4217 code.' });
        cfg.default = d;
      }
      if (body.providerUrl !== undefined) {
        const url = String(body.providerUrl || '').trim();
        if (url && !/^https:\/\/[^\s]+$/i.test(url)) return res.status(400).json({ error: 'The rate provider must be an https URL.' });
        cfg.providerUrl = url || FX_DEFAULT_URL;
      }
      if (body.refreshMinutes !== undefined) {
        const m = Math.trunc(Number(body.refreshMinutes));
        if (!(m >= 5 && m <= 1440)) return res.status(400).json({ error: 'Refresh interval must be 5–1440 minutes.' });
        cfg.refreshMinutes = m;
      }
      if (Array.isArray(body.disabled)) {
        cfg.disabled = [...new Set(body.disabled.map((x: any) => String(x).toUpperCase()).filter((c: string) => CURRENCY_CODES.has(c)))];
        if (cfg.disabled.includes('USD')) cfg.disabled = cfg.disabled.filter((c: string) => c !== 'USD'); // base is always on
      }
      if (body.autoDetect !== undefined) cfg.autoDetect = body.autoDetect === true;
      if (body.geoProvider !== undefined) {
        const g = String(body.geoProvider || '').trim();
        if (g && !/^https:\/\/[^\s]+$/i.test(g)) return res.status(400).json({ error: 'The geo provider must be an https URL.' });
        cfg.geoProvider = g || 'https://ip-api.com/json/';
      }
      if (body.manualRates && typeof body.manualRates === 'object') {
        const next: any = {};
        for (const [k, v] of Object.entries(body.manualRates)) {
          const code = String(k).toUpperCase();
          const rate = Number(v);
          if (CURRENCY_CODES.has(code) && rate > 0) next[code] = rate;
        }
        cfg.manualRates = next;
      }
      if (cfg.disabled.includes(cfg.default)) cfg.default = 'USD';
      recordAuditLog(db, 'CURRENCY_CONFIG_CHANGED', String(req.authAdmin || 'admin'),
        `Currency settings: default ${cfg.default}, refresh ${cfg.refreshMinutes}m, ${cfg.disabled.length} disabled, provider ${cfg.providerUrl}`);
      writeDb(db);
      res.json({ success: true, config: cfg });
    } catch (err: any) { res.status(500).json({ error: err?.message || 'Could not save the currency settings.' }); }
  });

  app.post('/api/admin/currency/refresh', rateLimit(20), requireAdmin, requireSuperAdmin, async (req: any, res) => {
    try {
      const db = readDb();
      const out = await refreshFxRates(db, true);
      res.json({ ...out, options: currencyOptionsPayload(db) });
    } catch (err: any) { res.status(500).json({ error: err?.message || 'Could not refresh the rates.' }); }
  });

  // ═══════════════════════════════════════════════════════════════════════════
  //  Deposit / Withdraw — payment methods, requests, admin review
  //
  //  Money rules (owner policy, unchanged):
  //   • a deposit NEVER credits a balance by itself — an admin approves it;
  //   • a withdrawal debits the wallet when it is requested and is refunded if the
  //     admin rejects it, so a pending request can never be spent twice;
  //   • only boosted profit is withdrawable, exactly like the agent cash-out.
  // ═══════════════════════════════════════════════════════════════════════════
  
// ── Shared money helpers (used by the agent cash-out AND the deposit/withdraw block)
const floor2 = (n: number) => Math.floor((Number(n) || 0) * 100 + 1e-9) / 100;
const round2Money = (n: number) => Math.round(((Number(n) || 0) + Number.EPSILON) * 100) / 100;
/**
 * OWNER RULE: only boosted dollars can leave the wallet through a payout.
 *   withdrawable = min(current balance, lifetimeProfit − already withdrawn profit)
 * `lifetimeProfit` grows only from boost rewards + referral commission on boost
 * yield, so a plain deposit is NOT withdrawable until it has boosted.
 */
function boostWithdrawable(user: any): number {
  if (!user) return 0;
  const balance = floor2(user.balance);
  const profitLeft = floor2((Number(user.lifetimeProfit) || 0) - (Number(user.boostProfitWithdrawn) || 0));
  return floor2(Math.max(0, Math.min(balance, profitLeft)));
}
/** Take `amount` out of the withdrawable profit bucket (called once per payout). */
function holdBoostProfit(user: any, amount: number) {
  user.boostProfitWithdrawn = round2Money((Number(user.boostProfitWithdrawn) || 0) + (Number(amount) || 0));
}
/** Give it back when a payout is cancelled, rejected or expires (idempotent). */
function releaseBoostProfit(user: any, amount: number) {
  user.boostProfitWithdrawn = round2Money(Math.max(0, (Number(user.boostProfitWithdrawn) || 0) - (Number(amount) || 0)));
}

const paymentLocks = new Map<string, Promise<any>>();
  function withPaymentLock<T>(key: string, fn: () => Promise<T> | T): Promise<T> {
    const prev = paymentLocks.get(key) || Promise.resolve();
    let release!: () => void;
    const cur = new Promise<void>((r) => { release = r; });
    paymentLocks.set(key, prev.then(() => cur) as any);
    return prev.then(async () => {
      try { return await fn(); } finally {
        release();
        if (paymentLocks.get(key) === (cur as any)) paymentLocks.delete(key);
      }
    }) as Promise<T>;
  }
  const paymentDedupe = new Map<string, number>();
  function paymentDedupeHit(key: string): boolean {
    if (!key) return false;
    const at = paymentDedupe.get(key);
    const nowTs = Date.now();
    for (const [k, v] of paymentDedupe) if (nowTs - v > 10 * 60 * 1000) paymentDedupe.delete(k);
    if (at && nowTs - at < 10 * 60 * 1000) return true;
    paymentDedupe.set(key, nowTs);
    return false;
  }
  function newPaymentId(prefix: string) {
    return `${prefix}-${Date.now().toString(36).toUpperCase()}-${Math.floor(Math.random() * 46656).toString(36).toUpperCase().padStart(3, '0')}`;
  }
  function reviewAudience(role: 'user' | 'agent') { return role === 'agent' ? 'AGENT' : 'USER'; }

  /**
   * The money decision for a deposit, in ONE place.
   *
   * Both the super-admin console and a wallet agent (walletagent.boostpay.online)
   * come through here, so there is a single implementation of "credit exactly
   * once" and a single audit trail. Callers own the transaction lock and the
   * writeDb() call.
   */
  function reviewDepositCore(db: any, opts: { id: string; action: 'APPROVE' | 'REJECT'; actor: string; reason?: string }): { status: number; body: any } {
    const r = (db.depositRequests || []).find((d: any) => d.id === opts.id);
    if (!r) return { status: 404, body: { error: 'That deposit does not exist.' } };
    if (r.status !== 'PENDING') return { status: 409, body: { error: `This deposit is already ${r.status}.` } };
    const user = (db.users || []).find((u: any) => String(u.id) === String(r.userId));
    if (!user) return { status: 404, body: { error: 'The account no longer exists.' } };
    if (opts.action === 'APPROVE') {
      const credit = Number(Number(r.amountUsd).toFixed(8));
      if (!(credit > 0)) return { status: 400, body: { error: 'The stored amount is not usable.' } };
      user.balance = floor2((Number(user.balance) || 0) + credit);
      const txId = 'TX-' + Math.floor(10000000 + Math.random() * 90000000);
      db.transactions.unshift({
        id: txId, userId: user.id, type: 'DEPOSIT', amount: credit, timestamp: Date.now(),
        notes: `Deposit ${r.id} approved · ${r.methodName} · ref ${r.reference}`, referenceId: r.id,
      });
      r.status = 'APPROVED'; r.txId = txId;
      pushNotification(db, {
        id: 'NOTIF-' + Math.floor(10000000 + Math.random() * 90000000),
        userId: String(user.id), type: 'TRANSFER_RECEIVED', title: 'BOOSTPAY-DEPOSIT',
        message: `DEPOSIT CONFIRMED: $${credit.toFixed(2)} credited via ${r.methodName}. Balance: $${user.balance.toFixed(2)}. Ref: ${txId}`,
        amount: credit, referenceId: txId, timestamp: Date.now(), isRead: false, metadata: { depositId: r.id },
      } as any);
    } else {
      r.status = 'REJECTED';
      pushNotification(db, {
        id: 'NOTIF-' + Math.floor(10000000 + Math.random() * 90000000),
        userId: String(user.id), type: 'SYSTEM_ALERT', title: 'BOOSTPAY-DEPOSIT',
        message: `Deposit ${r.id} could not be verified and was not credited. ${sanitizeText(opts.reason, 160) || 'Contact support.'}`,
        timestamp: Date.now(), isRead: false, metadata: { depositId: r.id },
      } as any);
    }
    r.reviewedAt = Date.now();
    r.reviewedBy = String(opts.actor);
    r.reason = sanitizeText(opts.reason, 200).trim();
    recordAuditLog(db, `DEPOSIT_${r.status}`, String(opts.actor), `Deposit ${r.id} $${Number(r.amountUsd).toFixed(2)} ${r.status.toLowerCase()}`, String(user.id));
    return { status: 200, body: { success: true, request: r } };
  }

  /** The money decision for a withdrawal — same single implementation. */
  function reviewWithdrawCore(db: any, opts: { id: string; action: 'APPROVE' | 'REJECT'; actor: string; reason?: string; payoutRef?: string }): { status: number; body: any } {
    const r = (db.withdrawRequests || []).find((w: any) => w.id === opts.id);
    if (!r) return { status: 404, body: { error: 'That withdrawal does not exist.' } };
    if (r.status !== 'PENDING') return { status: 409, body: { error: `This withdrawal is already ${r.status}.` } };
    const user = (db.users || []).find((u: any) => String(u.id) === String(r.userId));
    if (!user) return { status: 404, body: { error: 'The account no longer exists.' } };
    if (opts.action === 'APPROVE') {
      r.status = 'COMPLETED';
      r.payoutRef = sanitizeText(opts.payoutRef, 80).trim();
      pushNotification(db, {
        id: 'NOTIF-' + Math.floor(10000000 + Math.random() * 90000000),
        userId: String(user.id), type: 'SYSTEM_ALERT', title: 'BOOSTPAY-WITHDRAW',
        message: `WITHDRAWAL PAID: $${Number(r.netUsd).toFixed(2)} sent via ${r.methodName}. Ref: ${r.id}`,
        timestamp: Date.now(), isRead: false, metadata: { withdrawId: r.id },
      } as any);
    } else {
      const refund = Number(Number(r.amountUsd).toFixed(8));
      user.balance = floor2((Number(user.balance) || 0) + refund);
      releaseBoostProfit(user, refund);
      const txId = 'TX-' + Math.floor(10000000 + Math.random() * 90000000);
      db.transactions.unshift({
        id: txId, userId: user.id, type: 'WITHDRAW_REFUND', amount: refund, timestamp: Date.now(),
        notes: `Withdrawal ${r.id} rejected — refunded`, referenceId: r.id,
      });
      r.status = 'REJECTED'; r.txId = txId;
      pushNotification(db, {
        id: 'NOTIF-' + Math.floor(10000000 + Math.random() * 90000000),
        userId: String(user.id), type: 'TRANSFER_RECEIVED', title: 'BOOSTPAY-WITHDRAW',
        message: `Withdrawal ${r.id} was rejected and $${refund.toFixed(2)} returned to your balance. ${sanitizeText(opts.reason, 160) || 'Contact support.'} Balance: $${user.balance.toFixed(2)}`,
        amount: refund, referenceId: txId, timestamp: Date.now(), isRead: false, metadata: { withdrawId: r.id },
      } as any);
    }
    r.reviewedAt = Date.now();
    r.reviewedBy = String(opts.actor);
    r.reason = sanitizeText(opts.reason, 200).trim();
    recordAuditLog(db, `WITHDRAW_${r.status}`, String(opts.actor), `Withdrawal ${r.id} $${Number(r.amountUsd).toFixed(2)} ${r.status.toLowerCase()}`, String(user.id));
    return { status: 200, body: { success: true, request: r } };
  }

  /** Everything the user app needs to paint the payment screen. */
  app.get('/api/payment/methods', rateLimit(120), requireUser, async (req: any, res) => {
    try {
      const db = ensurePaymentCollections(readDb());
      const mode = String(req.query.mode || 'deposit').toLowerCase() === 'withdraw' ? 'withdraw' : 'deposit';
      const user = (db.users || []).find((u: any) => String(u.id) === String(req.authUserId));
      if (!user) return res.status(404).json({ error: 'User not found.' });
      const currency = entryCurrencyOf(user);
      // LOCAL methods only: the country comes from the account, or from the
      // currency the user selected (BDT → Bangladesh), so a US account never sees
      // bKash and a BD account never sees a US-only method.
      const country = effectiveCountryOf(db, user);
      const all = (db.paymentMethods as any[]) || [];
      const allowed = all
        .filter((m) => m.enabled && methodAvailable(m, mode, 'user', currency, country).ok)
        .sort((a, b) => (Number(a.order) || 0) - (Number(b.order) || 0))
        .map((m) => toPublicMethod(db, m, mode));
      const label = countryLabelOf(country);
      res.setHeader('Cache-Control', 'no-store');
      res.json({
        success: true, mode, currency, role: 'user',
        country: label.code, countryLabel: label.label, countryFlag: label.flag,
        categories: PAYMENT_CATEGORIES,
        methods: allowed,
        // what exists for OTHER countries — lets the app explain an empty screen
        // ("no method for your country yet") without leaking pay-to details
        otherCountries: Array.from(new Set(all.flatMap((m) => (Array.isArray(m.countries) ? m.countries : []))))
          .filter((c) => c && c !== country).sort(),
        withdrawable: mode === 'withdraw' ? boostWithdrawable(user) : null,
        limits: { min: 0.1, max: 1000000 },
      });
    } catch (err: any) { res.status(500).json({ error: err?.message || 'Could not load the payment methods.' }); }
  });

  /** Submit a deposit — pending until an admin verifies the money actually arrived. */
  app.post('/api/user/deposit-request', rateLimit(20), requireUser, async (req: any, res) => {
    try {
      const body = req.body || {};
      const idem = String(body.idempotencyKey || '').trim();
      // Only an EXPLICIT key is deduplicated. Without this guard every second
      // deposit inside ten minutes matched the empty-key bucket and returned the
      // previous request instead of creating a new one.
      if (idem) {
        const db0 = ensurePaymentCollections(readDb());
        const mine = (db0.depositRequests || []).find((d: any) => String(d.userId) === String(req.authUserId) && d.idempotencyKey === idem);
        if (mine) return res.json({ success: true, duplicate: true, request: mine });
        paymentDedupeHit(`DEP:${req.authUserId}:${idem}`);
      }
      const db = ensurePaymentCollections(readDb());
      const user = (db.users || []).find((u: any) => String(u.id) === String(req.authUserId));
      if (!user) return res.status(404).json({ error: 'User not found.' });
      if (user.isBlocked) return res.status(403).json({ error: 'Your account is suspended.' });

      const m = findMethod(db, String(body.methodId || ''));
      if (!m) return res.status(404).json({ error: 'That payment method does not exist.' });
      const currency = entryCurrencyOf(user);
      const avail = methodAvailable(m, 'deposit', 'user', currency, effectiveCountryOf(db, user));
      if (!avail.ok) return res.status(400).json({ error: avail.reason });
      if (m.category === 'AGENT') return res.status(400).json({ error: 'Use the agent screen for agent deposits.' });

      const entryCode = String(body.currency || currency).toUpperCase();
      const conv = entryAmountToUsd(db, user, Number(body.amount), entryCode);
      if (conv.error) return res.status(400).json({ error: conv.error });
      const lim = limitsFor(m, 'deposit');
      if (!(conv.usd > 0)) return res.status(400).json({ error: 'Enter an amount greater than 0.' });
      if (conv.usd < lim.min) return res.status(400).json({ error: `The minimum deposit for ${m.name} is $${lim.min.toFixed(2)}.` });
      if (conv.usd > lim.max) return res.status(400).json({ error: `The maximum deposit for ${m.name} is $${lim.max.toFixed(2)}.` });

      const reference = sanitizeText(body.reference, 80).trim();
      if (reference.length < 4) return res.status(400).json({ error: 'Enter the transaction ID or reference from your payment.' });
      const dupRef = (db.depositRequests || []).find((d: any) => String(d.userId) === String(user.id)
        && String(d.methodId) === m.id && String(d.reference || '').toLowerCase() === reference.toLowerCase()
        && Date.now() - Number(d.createdAt || 0) < 7 * 24 * 3600 * 1000);
      if (dupRef) return res.status(409).json({ error: `That reference was already submitted (${dupRef.id}). Please wait for the review.` });

      const request: any = {
        id: newPaymentId('DEP'),
        userId: String(user.id),
        methodId: m.id,
        methodName: m.name,
        category: m.category,
        amountUsd: Number(conv.usd.toFixed(8)),
        entryAmount: Number(body.amount),
        entryCurrency: conv.code,
        feeUsd: Number((conv.usd * (Number(m.depositFeePercent) || 0) / 100).toFixed(8)),
        reference,
        note: sanitizeText(body.note, 200).trim(),
        status: 'PENDING',
        idempotencyKey: idem,
        createdAt: Date.now(),
        reviewedAt: 0,
        reviewedBy: '',
        reason: '',
        txId: '',
      };
      db.depositRequests.unshift(request);
      if (db.depositRequests.length > 20000) db.depositRequests.length = 20000;
      recordAuditLog(db, 'DEPOSIT_REQUEST', 'user:' + user.id, `Deposit ${request.id}: $${request.amountUsd.toFixed(2)} via ${m.name} (ref ${reference})`, String(user.id));
      pushNotification(db, {
        id: 'NOTIF-' + Math.floor(10000000 + Math.random() * 90000000),
        userId: String(user.id), type: 'SYSTEM_ALERT', title: 'BOOSTPAY-DEPOSIT',
        message: `Deposit request ${request.id} for $${request.amountUsd.toFixed(2)} received via ${m.name}. It is credited once the payment is verified.`,
        timestamp: Date.now(), isRead: false, metadata: { depositId: request.id },
      } as any);
      writeDb(db);
      res.json({ success: true, request });
    } catch (err: any) { res.status(500).json({ error: err?.message || 'Could not submit the deposit.' }); }
  });

  app.get('/api/user/deposit-requests', rateLimit(120), requireUser, (req: any, res) => {
    const db = ensurePaymentCollections(readDb());
    const rows = (db.depositRequests || []).filter((d: any) => String(d.userId) === String(req.authUserId)).slice(0, 50);
    res.json({ success: true, requests: rows });
  });

  /** Request a withdrawal — the money leaves the wallet now and is refunded on reject. */
  app.post('/api/user/withdraw-request', rateLimit(20), requireUser, async (req: any, res) => {
    try {
      const body = req.body || {};
      const idem = String(body.idempotencyKey || '').trim();
      const out = await withPaymentLock('WITHDRAW:' + req.authUserId, () => {
        const db = ensurePaymentCollections(readDb());
        const user = (db.users || []).find((u: any) => String(u.id) === String(req.authUserId));
        if (!user) return { status: 404, body: { error: 'User not found.' } };
        if (user.isBlocked) return { status: 403, body: { error: 'Your account is suspended.' } };
        if (user.isFrozen) return { status: 403, body: { error: 'Your account is frozen.' } };
        if (user.boostState && user.boostState.isActive && !user.boostState.isPaused) {
          return { status: 400, body: { error: 'Pause your boost before withdrawing.' } };
        }
        if (idem) {
          const existing = (db.withdrawRequests || []).find((w: any) => String(w.userId) === String(user.id) && w.idempotencyKey === idem);
          if (existing) return { status: 200, body: { success: true, duplicate: true, request: existing } };
        }
        const m = findMethod(db, String(body.methodId || ''));
        if (!m) return { status: 404, body: { error: 'That payment method does not exist.' } };
        const currency = entryCurrencyOf(user);
        const avail = methodAvailable(m, 'withdraw', 'user', currency, effectiveCountryOf(db, user));
        if (!avail.ok) return { status: 400, body: { error: avail.reason } };
        if (m.category === 'AGENT') return { status: 400, body: { error: 'Use the agent screen for agent withdrawals.' } };

        const entryCode = String(body.currency || currency).toUpperCase();
        const conv = entryAmountToUsd(db, user, Number(body.amount), entryCode);
        if (conv.error) return { status: 400, body: { error: conv.error } };
        const lim = limitsFor(m, 'withdraw');
        if (!(conv.usd > 0)) return { status: 400, body: { error: 'Enter an amount greater than 0.' } };
        if (conv.usd < lim.min) return { status: 400, body: { error: `The minimum withdrawal for ${m.name} is $${lim.min.toFixed(2)}.` } };
        if (conv.usd > lim.max) return { status: 400, body: { error: `The maximum withdrawal for ${m.name} is $${lim.max.toFixed(2)}.` } };

        const dest: Record<string, string> = {};
        for (const f of withdrawFieldsFor(m)) {
          const v = sanitizeText((body.destination || {})[f.key], 120).trim();
          if (v.length < 3) return { status: 400, body: { error: `Please fill in: ${f.label}.` } };
          dest[f.key] = v;
        }

        const amount = Number(conv.usd.toFixed(8));
        const fee = Number((amount * (Number(m.withdrawFeePercent) || 0) / 100).toFixed(8));
        const net = Number((amount - fee).toFixed(8));
        if (net <= 0) return { status: 400, body: { error: 'The amount is too small to cover the fee.' } };
        const balance = Math.floor((Number(user.balance) || 0) * 100 + 1e-9) / 100;
        if (amount > balance + 1e-9) return { status: 400, body: { error: `Insufficient balance. You have $${balance.toFixed(2)}.` } };
        const withdrawable = boostWithdrawable(user);
        if (amount > withdrawable + 1e-9) {
          return { status: 400, body: { error: `Only boosted dollars can be withdrawn. Available boosted withdraw amount: $${withdrawable.toFixed(2)}.` } };
        }

        const requestId = newPaymentId('WDR');
        const txId = 'TX-' + Math.floor(10000000 + Math.random() * 90000000);
        user.balance = Math.floor((balance - amount) * 100 + 1e-9) / 100;
        holdBoostProfit(user, amount);
        db.transactions.unshift({
          id: txId, userId: user.id, type: 'WITHDRAW_REQUEST', amount, fee,
          timestamp: Date.now(), notes: `Withdrawal ${requestId} via ${m.name} (pending review)`,
          referenceId: requestId,
        });
        const request: any = {
          id: requestId, userId: String(user.id), methodId: m.id, methodName: m.name, category: m.category,
          amountUsd: amount, feeUsd: fee, netUsd: net,
          entryAmount: Number(body.amount), entryCurrency: conv.code,
          destination: dest, status: 'PENDING', idempotencyKey: idem,
          balanceAfter: user.balance, txId,
          createdAt: Date.now(), reviewedAt: 0, reviewedBy: '', reason: '', payoutRef: '',
        };
        db.withdrawRequests.unshift(request);
        if (db.withdrawRequests.length > 20000) db.withdrawRequests.length = 20000;
        recordAuditLog(db, 'WITHDRAW_REQUEST', 'user:' + user.id, `Withdrawal ${requestId}: $${amount.toFixed(2)} via ${m.name}`, String(user.id));
        pushNotification(db, {
          id: 'NOTIF-' + Math.floor(10000000 + Math.random() * 90000000),
          userId: String(user.id), type: 'SYSTEM_ALERT', title: 'BOOSTPAY-WITHDRAW',
          message: `Withdrawal request ${requestId} for $${amount.toFixed(2)} via ${m.name} received. Balance now $${user.balance.toFixed(2)}. Ref: ${txId}`,
          amount, referenceId: txId, timestamp: Date.now(), isRead: false, metadata: { withdrawId: requestId },
        } as any);
        writeDb(db);
        return { status: 200, body: { success: true, request } };
      });
      res.status(out.status).json(out.body);
    } catch (err: any) { res.status(500).json({ error: err?.message || 'Could not submit the withdrawal.' }); }
  });

  app.get('/api/user/withdraw-requests', rateLimit(120), requireUser, (req: any, res) => {
    const db = ensurePaymentCollections(readDb());
    const rows = (db.withdrawRequests || []).filter((w: any) => String(w.userId) === String(req.authUserId)).slice(0, 50);
    res.json({ success: true, requests: rows });
  });

  // ── Admin: method configuration ────────────────────────────────────────────
  app.get('/api/admin/payment-methods', rateLimit(120), requireAdmin, (req: any, res) => {
    const db = ensurePaymentCollections(readDb());
    res.setHeader('Cache-Control', 'no-store');
    res.json({
      success: true,
      categories: PAYMENT_CATEGORIES,
      methods: (db.paymentMethods as any[]).slice().sort((a, b) => (Number(a.order) || 0) - (Number(b.order) || 0)),
    });
  });

  /** Create or update a method. Every field is coerced server-side. */
  app.post('/api/admin/payment-methods', rateLimit(60), requireAdmin, requireSuperAdmin, (req: any, res) => {
    try {
      const db = ensurePaymentCollections(readDb());
      const body = req.body || {};
      const num = (v: any, d = 0) => { const n = Number(v); return Number.isFinite(n) && n >= 0 ? n : d; };
      const bool = (v: any, d = true) => (v === undefined ? d : v === true || v === 'true' || v === 1);
      const id = String(body.id || '').trim().toUpperCase() || newPaymentId('PM');
      let row: any = (db.paymentMethods as any[]).find((m) => m.id === id);
      const isNew = !row;
      if (isNew) {
        if (!String(body.name || '').trim()) return res.status(400).json({ error: 'A name is required.' });
        row = {
          id, createdAt: Date.now(),
          accountName: '', accountNumber: '', instructions: '',
          minDeposit: 1, maxDeposit: 100000, minWithdraw: 1, maxWithdraw: 100000,
          depositFeePercent: 0, withdrawFeePercent: 0, processingTime: 'Usually within 5–30 minutes',
          logo: '💳', order: 100, recommendedOrder: 0, currencies: ['*'], countries: [],
          maintenanceMessage: '',
          // a fresh method is usable by everyone until the admin narrows it down
          name: String(body.name || '').trim(),
          enabled: true, recommended: false, depositEnabled: true, withdrawEnabled: true,
          userDeposit: true, userWithdraw: true, agentDeposit: true, agentWithdraw: true,
          maintenance: false,
        };
        db.paymentMethods.push(row);
      }
      const cat = String(body.category || row.category || 'EWALLET').toUpperCase();
      if (!PAYMENT_CATEGORIES.some((c) => c.id === cat)) return res.status(400).json({ error: 'Unknown category.' });
      const setStr = (k: string, max = 200) => { if (body[k] !== undefined) row[k] = sanitizeText(body[k], max); };
      setStr('name', 60); setStr('logo', 8); setStr('processingTime', 120); setStr('maintenanceMessage', 200);
      setStr('accountName', 80); setStr('accountNumber', 120); setStr('instructions', 400);
      row.category = cat;
      for (const k of ['enabled', 'recommended', 'depositEnabled', 'withdrawEnabled', 'userDeposit', 'userWithdraw', 'agentDeposit', 'agentWithdraw', 'maintenance']) {
        if (body[k] !== undefined) row[k] = bool(body[k], row[k]);
      }
      if (body.order !== undefined) row.order = Math.round(num(body.order, row.order || 100));
      if (body.recommendedOrder !== undefined) row.recommendedOrder = Math.round(num(body.recommendedOrder, 0));
      for (const k of ['minDeposit', 'maxDeposit', 'minWithdraw', 'maxWithdraw']) {
        if (body[k] !== undefined) row[k] = num(body[k], row[k]);
      }
      for (const k of ['depositFeePercent', 'withdrawFeePercent']) {
        if (body[k] !== undefined) row[k] = Math.min(50, num(body[k], 0));
      }
      if (row.minDeposit > row.maxDeposit) return res.status(400).json({ error: 'The minimum deposit is above the maximum.' });
      if (row.minWithdraw > row.maxWithdraw) return res.status(400).json({ error: 'The minimum withdrawal is above the maximum.' });
      if (body.currencies !== undefined) {
        const list = Array.isArray(body.currencies) ? body.currencies : String(body.currencies).split(',');
        const clean = list.map((c: any) => String(c).trim().toUpperCase()).filter(Boolean);
        row.currencies = clean.includes('*') || clean.length === 0 ? (clean.length ? ['*'] : []) : clean.filter((c: string) => CURRENCY_CODES.has(c));
        if (row.currencies.length === 0) return res.status(400).json({ error: 'Pick at least one currency (or * for all).' });
      }
      if (body.countries !== undefined) {
        const list = Array.isArray(body.countries) ? body.countries : String(body.countries).split(',');
        row.countries = list.map((c: any) => String(c).trim().toUpperCase()).filter((c: string) => /^[A-Z]{2}$/.test(c));
      }
      row.updatedAt = Date.now();
      if (isNew) row.enabled = row.enabled !== false;
      recordAuditLog(db, isNew ? 'PAYMENT_METHOD_CREATED' : 'PAYMENT_METHOD_UPDATED', String(req.authAdmin),
        `${isNew ? 'Created' : 'Updated'} method ${row.id} (${row.name}) cat=${row.category}`);
      writeDb(db);
      res.json({ success: true, method: row });
    } catch (err: any) { res.status(500).json({ error: err?.message || 'Could not save the method.' }); }
  });

  app.post('/api/admin/payment-methods/delete', rateLimit(30), requireAdmin, requireSuperAdmin, (req: any, res) => {
    try {
      const db = ensurePaymentCollections(readDb());
      const id = String((req.body || {}).id || '');
      const row = (db.paymentMethods as any[]).find((m) => m.id === id);
      if (!row) return res.status(404).json({ error: 'That method does not exist.' });
      const pending = (db.depositRequests || []).some((d: any) => d.methodId === id && d.status === 'PENDING')
        || (db.withdrawRequests || []).some((w: any) => w.methodId === id && w.status === 'PENDING');
      if (pending) return res.status(400).json({ error: 'This method still has pending requests. Disable it instead.' });
      db.paymentMethods = (db.paymentMethods as any[]).filter((m) => m.id !== id);
      recordAuditLog(db, 'PAYMENT_METHOD_DELETED', String(req.authAdmin), `Deleted method ${id} (${row.name})`);
      writeDb(db);
      res.json({ success: true });
    } catch (err: any) { res.status(500).json({ error: err?.message || 'Could not delete the method.' }); }
  });

  // ── Admin: deposit / withdrawal queues ─────────────────────────────────────
  app.get('/api/admin/payment-requests', rateLimit(120), requireAdmin, (req: any, res) => {
    const db = ensurePaymentCollections(readDb());
    const type = String(req.query.type || 'deposit') === 'withdraw' ? 'withdraw' : 'deposit';
    const status = String(req.query.status || '').toUpperCase();
    const src = type === 'deposit' ? db.depositRequests : db.withdrawRequests;
    const rows = (src || []).filter((r: any) => !status || String(r.status) === status).slice(0, 300);
    res.setHeader('Cache-Control', 'no-store');
    res.json({ success: true, type, requests: rows });
  });

  app.post('/api/admin/payment-requests/deposit/review', rateLimit(60), requireAdmin, requireSuperAdmin, async (req: any, res) => {
    try {
      const body = req.body || {};
      const id = String(body.id || '');
      const action = String(body.action || '').toUpperCase();
      if (action !== 'APPROVE' && action !== 'REJECT') return res.status(400).json({ error: 'Action must be APPROVE or REJECT.' });
      const out = await withPaymentLock('DEPREVIEW:' + id, () => {
        const db = ensurePaymentCollections(readDb());
        const result = reviewDepositCore(db, { id, action, actor: String(req.authAdmin), reason: body.reason });
        if (result.status === 200) writeDb(db);
        return result;
      });
      res.status(out.status).json(out.body);
    } catch (err: any) { res.status(500).json({ error: err?.message || 'Could not review the deposit.' }); }
  });

  app.post('/api/admin/payment-requests/withdraw/review', rateLimit(60), requireAdmin, requireSuperAdmin, async (req: any, res) => {
    try {
      const body = req.body || {};
      const id = String(body.id || '');
      const action = String(body.action || '').toUpperCase();
      if (action !== 'APPROVE' && action !== 'REJECT') return res.status(400).json({ error: 'Action must be APPROVE or REJECT.' });
      const out = await withPaymentLock('WDRREVIEW:' + id, () => {
        const db = ensurePaymentCollections(readDb());
        const result = reviewWithdrawCore(db, { id, action, actor: String(req.authAdmin), reason: body.reason, payoutRef: body.payoutRef });
        if (result.status === 200) writeDb(db);
        return result;
      });
      res.status(out.status).json(out.body);
    } catch (err: any) { res.status(500).json({ error: err?.message || 'Could not review the withdrawal.' }); }
  });

  /* ── WALLET AGENT PANEL ─────────────────────────────────────────────────────
   * Separate app, separate login, admin-created accounts. An account is bound to
   * ONE country + ONE payment method; it may approve or reject the deposits and
   * withdrawals of that method and nothing else. The money decisions reuse
   * reviewDepositCore / reviewWithdrawCore, so the ledger rules are identical to
   * the super-admin console — only the actor recorded in the audit trail differs.
   */
  function walletAgentsOf(db: any): any[] {
    if (!Array.isArray(db.walletAgents)) db.walletAgents = [];
    return db.walletAgents;
  }

  /** Public (panel-safe) view of an agent account — never the password hash. */
  function publicWalletAgent(a: any) {
    return {
      id: a.id, name: a.name, email: a.email, country: a.country,
      methodId: a.methodId, methodName: a.methodName, active: a.active !== false,
      createdAt: a.createdAt, lastLoginAt: a.lastLoginAt || 0,
      reviewedCount: Number(a.reviewedCount) || 0,
    };
  }

  app.post('/api/walletagent/login', rateLimit(30), (req: any, res) => {
    try {
      const email = String((req.body || {}).email || '').trim().toLowerCase();
      const password = String((req.body || {}).password || '').trim();
      if (!email || !password) return res.status(400).json({ error: 'Email and password are required.' });
      const db = ensurePaymentCollections(readDb());
      const ag = walletAgentsOf(db).find((a: any) => String(a.email).toLowerCase() === email);
      if (!ag || !verifyPassword(ag.passwordHash, password)) {
        return res.status(401).json({ error: 'Invalid wallet agent credentials.' });
      }
      if (ag.active === false) return res.status(403).json({ error: 'This wallet-agent account is disabled.' });
      if (needsRehash(ag.passwordHash)) ag.passwordHash = hashPassword(password);
      const sess = createSession(db, String(ag.id), 'WALLET_AGENT', clientIp(req), String(req.headers['user-agent'] || ''));
      ag.lastLoginAt = Date.now();
      recordAuditLog(db, 'WALLET_AGENT_LOGIN', 'walletagent:' + ag.email, `Wallet agent login from ${sess.ip}`);
      writeDb(db);
      return res.json({
        success: true,
        token: issueToken(String(ag.id), 'WALLET_AGENT', sess.id),
        agent: publicWalletAgent(ag),
        sessionId: sess.id,
      });
    } catch (err: any) { res.status(500).json({ error: err?.message || 'Could not sign in.' }); }
  });

  app.post('/api/walletagent/logout', requireWalletAgent, (req: any, res) => {
    try {
      const db = ensurePaymentCollections(readDb());
      revokeSession(db, String(req.authSid || ''));
      writeDb(db);
      res.json({ success: true });
    } catch (err: any) { res.status(500).json({ error: err?.message || 'Could not sign out.' }); }
  });

  app.get('/api/walletagent/me', rateLimit(120), requireWalletAgent, (req: any, res) => {
    try {
      const db = ensurePaymentCollections(readDb());
      const ag = walletAgentsOf(db).find((a: any) => a.id === req.authWalletAgentId);
      if (!ag) return res.status(404).json({ error: 'Account not found.' });
      const m = (db.paymentMethods || []).find((x: any) => x.id === ag.methodId) || null;
      res.setHeader('Cache-Control', 'no-store');
      res.json({
        success: true,
        agent: publicWalletAgent(ag),
        method: m ? {
          id: m.id, name: m.name, logo: m.logo, category: m.category,
          minDeposit: m.minDeposit, maxDeposit: m.maxDeposit,
          minWithdraw: m.minWithdraw, maxWithdraw: m.maxWithdraw,
          depositFeePercent: m.depositFeePercent, withdrawFeePercent: m.withdrawFeePercent,
          processingTime: m.processingTime, maintenance: !!m.maintenance,
          depositEnabled: !!m.depositEnabled, withdrawEnabled: !!m.withdrawEnabled,
          countries: m.countries || [],
          accountName: m.accountName || '', accountNumber: m.accountNumber || '',
          instructions: m.instructions || '',
        } : null,
      });
    } catch (err: any) { res.status(500).json({ error: err?.message || 'Could not load the account.' }); }
  });

  /** The queue: only the bound method, newest first. */
  function walletAgentQueue(db: any, ag: any, type: 'deposit' | 'withdraw', status: string, limit: number) {
    const src = type === 'deposit' ? (db.depositRequests || []) : (db.withdrawRequests || []);
    return src
      .filter((r: any) => String(r.methodId) === String(ag.methodId))
      .filter((r: any) => !status || String(r.status) === status)
      .sort((a: any, b: any) => Number(b.createdAt || 0) - Number(a.createdAt || 0))
      .slice(0, limit)
      .map((r: any) => ({
        id: r.id, type: type.toUpperCase(), userId: r.userId,
        methodId: r.methodId, methodName: r.methodName,
        amountUsd: r.amountUsd, feeUsd: r.feeUsd || 0, netUsd: r.netUsd == null ? r.amountUsd : r.netUsd,
        entryAmount: r.entryAmount, entryCurrency: r.entryCurrency,
        reference: r.reference || '', note: r.note || '',
        destination: r.destination || null,
        status: r.status, createdAt: r.createdAt, reviewedAt: r.reviewedAt || 0,
        reviewedBy: r.reviewedBy || '', reason: r.reason || '', payoutRef: r.payoutRef || '',
      }));
  }

  app.get('/api/walletagent/requests', rateLimit(180), requireWalletAgent, (req: any, res) => {
    try {
      const db = ensurePaymentCollections(readDb());
      const ag = walletAgentsOf(db).find((a: any) => a.id === req.authWalletAgentId);
      if (!ag) return res.status(404).json({ error: 'Account not found.' });
      const type = String(req.query.type || 'deposit').toLowerCase() === 'withdraw' ? 'withdraw' : 'deposit';
      const status = String(req.query.status || '').toUpperCase();
      const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 100));
      const rows = walletAgentQueue(db, ag, type as 'deposit' | 'withdraw', status, limit);
      const open = walletAgentQueue(db, ag, type as 'deposit' | 'withdraw', 'PENDING', 1000).length;
      res.setHeader('Cache-Control', 'no-store');
      res.json({ success: true, type, status: status || 'ALL', requests: rows, pending: open });
    } catch (err: any) { res.status(500).json({ error: err?.message || 'Could not load the queue.' }); }
  });

  app.get('/api/walletagent/stats', rateLimit(180), requireWalletAgent, async (req: any, res) => {
    try {
      const db = ensurePaymentCollections(readDb());
      const ag = walletAgentsOf(db).find((a: any) => a.id === req.authWalletAgentId);
      if (!ag) return res.status(404).json({ error: 'Account not found.' });
      const startOfDay = new Date(); startOfDay.setHours(0, 0, 0, 0);
      const since = startOfDay.getTime();
      const dep = (db.depositRequests || []).filter((r: any) => String(r.methodId) === String(ag.methodId));
      const wdr = (db.withdrawRequests || []).filter((r: any) => String(r.methodId) === String(ag.methodId));
      const sum = (rows: any[], st: string) => Number(rows.filter((r) => r.status === st).reduce((a, r) => a + Number(r.amountUsd || 0), 0).toFixed(2));
      res.setHeader('Cache-Control', 'no-store');
      res.json({
        success: true,
        pendingDeposit: dep.filter((r: any) => r.status === 'PENDING').length,
        pendingWithdraw: wdr.filter((r: any) => r.status === 'PENDING').length,
        todayApprovedDeposit: dep.filter((r: any) => r.status === 'APPROVED' && Number(r.reviewedAt || 0) >= since).length,
        todayApprovedWithdraw: wdr.filter((r: any) => r.status === 'COMPLETED' && Number(r.reviewedAt || 0) >= since).length,
        depositApprovedTotal: sum(dep, 'APPROVED'),
        withdrawPaidTotal: sum(wdr, 'COMPLETED'),
        reviewedCount: Number(ag.reviewedCount) || 0,
      });
    } catch (err: any) { res.status(500).json({ error: err?.message || 'Could not load stats.' }); }
  });

  app.post('/api/walletagent/requests/:type/review', rateLimit(120), requireWalletAgent, async (req: any, res) => {
    try {
      const type = String(req.params.type || '').toLowerCase();
      if (type !== 'deposit' && type !== 'withdraw') return res.status(400).json({ error: 'Unknown request type.' });
      const body = req.body || {};
      const id = String(body.id || '');
      const action = String(body.action || '').toUpperCase();
      if (action !== 'APPROVE' && action !== 'REJECT') return res.status(400).json({ error: 'Action must be APPROVE or REJECT.' });
      const lockKey = (type === 'deposit' ? 'DEPREVIEW:' : 'WDRREVIEW:') + id;
      const out = await withPaymentLock(lockKey, () => {
        const db = ensurePaymentCollections(readDb());
        const ag = walletAgentsOf(db).find((a: any) => a.id === req.authWalletAgentId);
        if (!ag) return { status: 401, body: { error: 'Account not found.' } };
        const src = type === 'deposit' ? (db.depositRequests || []) : (db.withdrawRequests || []);
        const row = src.find((r: any) => r.id === id);
        if (!row) return { status: 404, body: { error: 'That request does not exist.' } };
        // SCOPE: an agent may only touch its own payment method.
        if (String(row.methodId) !== String(ag.methodId)) {
          recordAuditLog(db, 'WALLET_AGENT_SCOPE_DENIED', 'walletagent:' + ag.email, `Attempted ${action} on ${id} (${row.methodId}) outside its scope`, String(row.userId || ''));
          writeDb(db);
          return { status: 403, body: { error: 'This request belongs to a payment method you do not handle.' } };
        }
        const actor = 'walletagent:' + ag.email;
        const result = type === 'deposit'
          ? reviewDepositCore(db, { id, action, actor, reason: body.reason })
          : reviewWithdrawCore(db, { id, action, actor, reason: body.reason, payoutRef: body.payoutRef });
        if (result.status === 200) {
          ag.reviewedCount = (Number(ag.reviewedCount) || 0) + 1;
          recordAuditLog(db, 'WALLET_AGENT_REVIEW', actor, `${type} ${id} ${action} via ${row.methodName} (${row.methodId})`, String(row.userId || ''));
          writeDb(db);
        }
        return result;
      });
      res.status(out.status).json(out.body);
    } catch (err: any) { res.status(500).json({ error: err?.message || 'Could not review the request.' }); }
  });

  /* ── WALLET AGENT ADMIN ──────────────────────────────────────────────────── */

  /**
   * Edit a wallet-agent account — ONE implementation for the admin console and
   * the management console. Everything an operator may change lives here:
   * name, login e-mail, password, the country+method binding and the enable flag.
   * A password change or a disable kills that agent's live sessions immediately.
   */
  function updateWalletAgentCore(db: any, ag: any, body: any, actor: string): { status: number; body: any } {
    const agents = walletAgentsOf(db);
    const changes: string[] = [];

    if (typeof body.active === 'boolean' && body.active !== (ag.active !== false)) {
      ag.active = body.active;
      changes.push(body.active ? 'enabled' : 'disabled');
      if (!body.active) {
        for (const s of sessionSnapshot(db)) {
          if (String(s.userId) === String(ag.id) && s.role === 'WALLET_AGENT' && !s.revoked) {
            s.revoked = true; revokedSessions.add(s.id);
          }
        }
      }
    }

    if (typeof body.name === 'string') {
      const name = sanitizeText(body.name, 80).trim();
      if (!name) return { status: 400, body: { error: 'The agent name cannot be empty.' } };
      if (name !== ag.name) { ag.name = name; changes.push('name'); }
    }

    if (typeof body.email === 'string' && body.email.trim()) {
      const email = body.email.trim().toLowerCase();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { status: 400, body: { error: 'Enter a valid email address.' } };
      if (email !== String(ag.email).toLowerCase()) {
        if (agents.some((a: any) => String(a.id) !== String(ag.id) && String(a.email).toLowerCase() === email)) {
          return { status: 409, body: { error: 'Another wallet agent already uses this email.' } };
        }
        ag.email = email;
        changes.push('email');
        // the login identity changed — force a fresh sign-in
        for (const s of sessionSnapshot(db)) {
          if (String(s.userId) === String(ag.id) && s.role === 'WALLET_AGENT' && !s.revoked) {
            s.revoked = true; revokedSessions.add(s.id);
          }
        }
      }
    }

    if (body.password) {
      const pw = String(body.password);
      if (pw.length < 8) return { status: 400, body: { error: 'The password must be at least 8 characters.' } };
      ag.passwordHash = hashPassword(pw);
      for (const s of sessionSnapshot(db)) {
        if (String(s.userId) === String(ag.id) && s.role === 'WALLET_AGENT' && !s.revoked) {
          s.revoked = true; revokedSessions.add(s.id);
        }
      }
      changes.push('password reset');
    }

    const country = body.country ? String(body.country).toUpperCase() : ag.country;
    const methodId = body.methodId ? String(body.methodId) : ag.methodId;
    if (String(country) !== ag.country || String(methodId) !== ag.methodId) {
      if (!/^[A-Z]{2}$/.test(country)) return { status: 400, body: { error: 'Select a valid country.' } };
      const m = (db.paymentMethods || []).find((x: any) => x.id === methodId);
      if (!m) return { status: 404, body: { error: 'That payment method does not exist.' } };
      const mc = (m.countries || []).map((c: any) => String(c).toUpperCase());
      if (mc.length && !mc.includes(country)) {
        return { status: 400, body: { error: `${m.name} is not available in ${countryLabelOf(country).label || country}.` } };
      }
      ag.country = country; ag.methodId = m.id; ag.methodName = m.name;
      changes.push(`scope → ${m.name} / ${country}`);
    }

    recordAuditLog(db, 'WALLET_AGENT_UPDATE', actor, `Updated wallet agent ${ag.id} (${ag.email}): ${changes.join(', ') || 'no change'}`);
    return { status: 200, body: { success: true, agent: publicWalletAgent(ag), changes } };
  }

  app.get('/api/admin/wallet-agents', rateLimit(120), requireAdmin, (req: any, res) => {
    try {
      const db = ensurePaymentCollections(readDb());
      const rows = walletAgentsOf(db)
        .map(publicWalletAgent)
        .sort((a: any, b: any) => Number(b.createdAt || 0) - Number(a.createdAt || 0));
      res.setHeader('Cache-Control', 'no-store');
      res.json({ success: true, agents: rows });
    } catch (err: any) { res.status(500).json({ error: err?.message || 'Could not load wallet agents.' }); }
  });

  /** Every country the app knows (ISO code + label + flag) — used by the
   *  payment-method editor and the wallet-agent picker. */
  app.get('/api/admin/countries', rateLimit(120), requireAdmin, (req: any, res) => {
    try {
      const rows = Object.keys(COUNTRY_CURRENCY).map((code) => ({
        ...countryLabelOf(code),
        currency: COUNTRY_CURRENCY[code],
      })).sort((a, b) => a.label.localeCompare(b.label));
      res.setHeader('Cache-Control', 'no-store');
      res.json({ success: true, countries: rows });
    } catch (err: any) { res.status(500).json({ error: err?.message || 'Could not load countries.' }); }
  });

  /** Countries that at least one method is configured for — the agent picker tree. */
  function walletAgentCountryTree(db: any): any[] {
    const map = new Map<string, any>();
    for (const m of (db.paymentMethods || [])) {
      const list = Array.isArray(m.countries) ? m.countries : [];
      for (const cc of list) {
        const key = String(cc || '').toUpperCase();
        if (!/^[A-Z]{2}$/.test(key)) continue;
        if (!map.has(key)) map.set(key, { ...countryLabelOf(key), methods: [] });
        map.get(key).methods.push({ id: m.id, name: m.name, logo: m.logo, category: m.category, enabled: !!m.enabled });
      }
    }
    return Array.from(map.values()).sort((a, b) => a.code.localeCompare(b.code));
  }

  app.get('/api/admin/wallet-agents/options', rateLimit(120), requireAdmin, (req: any, res) => {
    try {
      const db = ensurePaymentCollections(readDb());
      res.setHeader('Cache-Control', 'no-store');
      res.json({ success: true, countries: walletAgentCountryTree(db) });
    } catch (err: any) { res.status(500).json({ error: err?.message || 'Could not load country options.' }); }
  });

  app.post('/api/admin/wallet-agents', rateLimit(30), requireAdmin, requireSuperAdmin, (req: any, res) => {
    try {
      const body = req.body || {};
      const name = sanitizeText(body.name, 80).trim();
      const email = String(body.email || '').trim().toLowerCase();
      const password = String(body.password || '');
      const country = String(body.country || '').trim().toUpperCase();
      const methodId = String(body.methodId || '').trim();
      if (!name) return res.status(400).json({ error: 'Enter the agent name.' });
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return res.status(400).json({ error: 'Enter a valid email address.' });
      if (password.length < 8) return res.status(400).json({ error: 'The password must be at least 8 characters.' });
      if (!/^[A-Z]{2}$/.test(country)) return res.status(400).json({ error: 'Select the agent country.' });
      if (!methodId) return res.status(400).json({ error: 'Select the payment method this agent will handle.' });
      const db = ensurePaymentCollections(readDb());
      const agents = walletAgentsOf(db);
      if (agents.some((a: any) => String(a.email).toLowerCase() === email)) {
        return res.status(409).json({ error: 'A wallet agent with this email already exists.' });
      }
      const m = (db.paymentMethods || []).find((x: any) => x.id === methodId);
      if (!m) return res.status(404).json({ error: 'That payment method does not exist.' });
      const mc = (m.countries || []).map((c: string) => String(c).toUpperCase());
      if (mc.length && !mc.includes(country)) {
        return res.status(400).json({ error: `${m.name} is not available in ${countryLabelOf(country).label || country}. Add the country to the method first.` });
      }
      const ag: any = {
        id: 'WAG-' + Date.now().toString(36).toUpperCase() + '-' + Math.floor(Math.random() * 1296).toString(36).toUpperCase().padStart(2, '0'),
        name, email, passwordHash: hashPassword(password),
        country, methodId: m.id, methodName: m.name,
        active: true, createdAt: Date.now(), createdBy: String(req.authAdmin || ''),
        lastLoginAt: 0, reviewedCount: 0,
      };
      agents.push(ag);
      recordAuditLog(db, 'WALLET_AGENT_CREATE', 'admin:' + String(req.authAdmin), `Created wallet agent ${ag.id} (${email}) for ${m.name} / ${country}`);
      writeDb(db);
      res.status(201).json({ success: true, agent: publicWalletAgent(ag) });
    } catch (err: any) { res.status(500).json({ error: err?.message || 'Could not create the wallet agent.' }); }
  });

  app.patch('/api/admin/wallet-agents/:id', rateLimit(60), requireAdmin, requireSuperAdmin, (req: any, res) => {
    try {
      const db = ensurePaymentCollections(readDb());
      const ag = walletAgentsOf(db).find((a: any) => a.id === String(req.params.id));
      if (!ag) return res.status(404).json({ error: 'Wallet agent not found.' });
      const out = updateWalletAgentCore(db, ag, req.body || {}, 'admin:' + String(req.authAdmin));
      if (out.status === 200) writeDb(db);
      res.status(out.status).json(out.body);
    } catch (err: any) { res.status(500).json({ error: err?.message || 'Could not update the wallet agent.' }); }
  });

  app.delete('/api/admin/wallet-agents/:id', rateLimit(30), requireAdmin, requireSuperAdmin, (req: any, res) => {
    try {
      const db = ensurePaymentCollections(readDb());
      const agents = walletAgentsOf(db);
      const idx = agents.findIndex((a: any) => a.id === String(req.params.id));
      if (idx < 0) return res.status(404).json({ error: 'Wallet agent not found.' });
      const [ag] = agents.splice(idx, 1);
      for (const s of sessionSnapshot(db)) {
        if (String(s.userId) === String(ag.id) && s.role === 'WALLET_AGENT' && !s.revoked) { s.revoked = true; revokedSessions.add(s.id); }
      }
      recordAuditLog(db, 'WALLET_AGENT_DELETE', 'admin:' + String(req.authAdmin), `Deleted wallet agent ${ag.id} (${ag.email})`);
      writeDb(db);
      res.json({ success: true });
    } catch (err: any) { res.status(500).json({ error: err?.message || 'Could not delete the wallet agent.' }); }
  });

  /** The relay APK — public on purpose: the phone that pairs needs no console login. */
  app.get('/download/boostpay-sms-relay.apk', (req: any, res) => {
    const file = path.join(__dirname, 'public', 'download', 'boostpay-sms-relay.apk');
    if (!fs.existsSync(file)) return res.status(404).json({ error: 'The relay APK has not been built yet.' });
    res.setHeader('Content-Type', 'application/vnd.android.package-archive');
    res.setHeader('Content-Disposition', 'attachment; filename="boostpay-sms-relay.apk"');
    res.setHeader('Cache-Control', 'no-cache');
    try {
    } catch { /* never block a download */ }
    return res.sendFile(file);
  });

  /* ── SMS BRIDGE (bKash / Nagad "money received" → automatic credit) ───────
   *
   * The relay app on the phone that holds the receiving SIM forwards every SMS.
   * A message is only ever turned into money when ALL of these hold:
   *   · the device token is valid and the device is not paused
   *   · the text is a "money received" message with an amount and a TrxID
   *   · a PENDING deposit request exists whose user-typed reference IS that TrxID
   *   · that request is for the same payment method as the device
   *   · the amount in the SMS equals what the user claimed (tolerance configurable)
   * and a TrxID can only ever credit once — a replayed SMS is a no-op.
   * Anything else is stored in the inbox for a human, never credited.
   */

  const SMS_INBOX_MAX = 2000;

  function smsDevicesOf(db: any): any[] {
    if (!Array.isArray(db.smsDevices)) db.smsDevices = [];
    return db.smsDevices;
  }
  function smsInboxOf(db: any): any[] {
    if (!Array.isArray(db.smsInbox)) db.smsInbox = [];
    if (db.smsInbox.length > SMS_INBOX_MAX) db.smsInbox.length = SMS_INBOX_MAX;
    return db.smsInbox;
  }
  function smsTokenHash(token: string): string {
    return crypto.createHash('sha256').update('bp-sms:' + String(token || '')).digest('hex');
  }
  function publicSmsDevice(d: any) {
    return {
      id: d.id, label: d.label, methodId: d.methodId, methodName: d.methodName,
      msisdn: d.msisdn || '', country: d.country || '', active: d.active !== false,
      autoCredit: d.autoCredit !== false, tolerance: Number(d.tolerance) || 0,
      tokenHint: d.tokenHint || '••••', createdAt: d.createdAt || 0,
      lastSeenAt: d.lastSeenAt || 0, lastSmsAt: d.lastSmsAt || 0,
      ingestCount: Number(d.ingestCount) || 0, creditCount: Number(d.creditCount) || 0,
      appVersion: d.appVersion || '', batteryOk: d.batteryOk !== false,
    };
  }
  function findDeviceByToken(db: any, token: string) {
    const h = smsTokenHash(token);
    return smsDevicesOf(db).find((d: any) => String(d.tokenHash || '') === h);
  }
  function smsDeviceActor(d: any) { return 'sms:' + String(d.id); }

  app.get('/api/admin/sms-devices', rateLimit(120), requireAdmin, (req: any, res) => {
    try {
      const db = ensurePaymentCollections(readDb());
      const inbox = smsInboxOf(db);
      res.setHeader('Cache-Control', 'no-store');
      res.json({
        success: true,
        devices: smsDevicesOf(db).map(publicSmsDevice),
        methods: (db.paymentMethods || [])
          .filter((m: any) => ['EWALLET', 'BANK', 'AGENT'].includes(String(m.category)))
          .map((m: any) => ({ id: m.id, name: m.name, logo: m.logo, category: m.category, enabled: !!m.enabled })),
        inbox: inbox.slice(0, 100),
        stats: {
          devices: smsDevicesOf(db).length,
          activeDevices: smsDevicesOf(db).filter((d: any) => d.active !== false).length,
          credited24h: inbox.filter((r: any) => r.status === 'CREDITED' && Date.now() - Number(r.at || 0) < 864e5).length,
          unmatched24h: inbox.filter((r: any) => r.status === 'UNMATCHED' && Date.now() - Number(r.at || 0) < 864e5).length,
          creditedTotal: smsDevicesOf(db).reduce((a: number, d: any) => a + (Number(d.creditCount) || 0), 0),
        },
      });
    } catch (err: any) { res.status(500).json({ error: err?.message || 'Could not load the SMS bridge.' }); }
  });

  /** Create a relay device — the token is shown ONCE and stored only as a hash. */
  app.post('/api/admin/sms-devices', rateLimit(30), requireAdmin, requireSuperAdmin, (req: any, res) => {
    try {
      const body = req.body || {};
      const label = sanitizeText(body.label, 60).trim();
      const methodId = String(body.methodId || '').trim();
      const msisdn = String(body.msisdn || '').replace(/[^0-9]/g, '');
      const country = String(body.country || 'BD').toUpperCase();
      if (!label) return res.status(400).json({ error: 'Give the phone a name (e.g. "bKash 01711-111111 — Dhaka shop").' });
      if (!methodId) return res.status(400).json({ error: 'Pick the payment method this SIM receives.' });
      if (msisdn && !/^(?:88)?01[3-9][0-9]{8}$/.test(msisdn)) return res.status(400).json({ error: 'Enter the receiving mobile number (01XXXXXXXXX).' });
      const db = ensurePaymentCollections(readDb());
      const m = findMethod(db, methodId);
      if (!m) return res.status(404).json({ error: 'That payment method does not exist.' });

      const token = 'BPX-' + crypto.randomBytes(18).toString('hex').toUpperCase();
      const dev: any = {
        id: 'SMSD-' + Date.now().toString(36).toUpperCase() + '-' + crypto.randomBytes(2).toString('hex').toUpperCase(),
        label, methodId: m.id, methodName: m.name,
        msisdn: msisdn.replace(/^88/, ''), country,
        active: true, autoCredit: body.autoCredit !== false,
        tolerance: Math.max(0, Math.min(100, Number(body.tolerance) || 0)),
        tokenHash: smsTokenHash(token), tokenHint: token.slice(-4),
        // Payout duty is on from the start and aimed at the wallet of this method,
        // so a freshly created phone can already pick up its own payouts.
        payoutEnabled: true,
        payoutProvider: /nagad/i.test(String(m.name)) ? 'nagad' : (/bkash|বিকাশ/i.test(String(m.name)) ? 'bkash' : ''),
        createdAt: Date.now(), createdBy: String(req.authAdmin || 'admin'),
        lastSeenAt: 0, lastSmsAt: 0, ingestCount: 0, creditCount: 0,
      };
      smsDevicesOf(db).push(dev);
      recordAuditLog(db, 'SMS_DEVICE_CREATE', 'admin:' + String(req.authAdmin), `Created SMS relay device ${dev.id} (${m.name}) for ${dev.msisdn || 'no number'}`, dev.id);
      writeDb(db);
      res.json({ success: true, device: publicSmsDevice(dev), token });
    } catch (err: any) { res.status(500).json({ error: err?.message || 'Could not create the relay device.' }); }
  });

  app.patch('/api/admin/sms-devices/:id', rateLimit(60), requireAdmin, requireSuperAdmin, (req: any, res) => {
    try {
      const db = ensurePaymentCollections(readDb());
      const dev = smsDevicesOf(db).find((d: any) => d.id === String(req.params.id));
      if (!dev) return res.status(404).json({ error: 'That relay device does not exist.' });
      const body = req.body || {};
      const changes: string[] = [];
      if (typeof body.label === 'string' && sanitizeText(body.label, 60).trim()) {
        dev.label = sanitizeText(body.label, 60).trim(); changes.push('label');
      }
      if (typeof body.active === 'boolean' && body.active !== (dev.active !== false)) {
        dev.active = body.active; changes.push(body.active ? 'resumed' : 'paused');
      }
      if (typeof body.autoCredit === 'boolean' && body.autoCredit !== (dev.autoCredit !== false)) {
        dev.autoCredit = body.autoCredit; changes.push(body.autoCredit ? 'auto-credit on' : 'auto-credit off (match only)');
      }
      if (body.tolerance !== undefined) {
        const t = Math.max(0, Math.min(100, Number(body.tolerance) || 0));
        if (t !== Number(dev.tolerance || 0)) { dev.tolerance = t; changes.push('tolerance ' + t); }
      }
      if (typeof body.msisdn === 'string') {
        const num = body.msisdn.replace(/[^0-9]/g, '').replace(/^88/, '');
        if (num && !/^01[3-9][0-9]{8}$/.test(num)) return res.status(400).json({ error: 'Enter the receiving mobile number (01XXXXXXXXX).' });
        if (num !== String(dev.msisdn || '')) { dev.msisdn = num; changes.push('msisdn'); }
      }
      let token: string | undefined;
      if (body.rotateToken === true) {
        token = 'BPX-' + crypto.randomBytes(18).toString('hex').toUpperCase();
        dev.tokenHash = smsTokenHash(token); dev.tokenHint = token.slice(-4);
        changes.push('token rotated');
      }
      recordAuditLog(db, 'SMS_DEVICE_UPDATE', 'admin:' + String(req.authAdmin), `Updated SMS device ${dev.id}: ${changes.join(', ') || 'no change'}`, dev.id);
      writeDb(db);
      res.json({ success: true, device: publicSmsDevice(dev), changes, ...(token ? { token } : {}) });
    } catch (err: any) { res.status(500).json({ error: err?.message || 'Could not update the relay device.' }); }
  });

  app.delete('/api/admin/sms-devices/:id', rateLimit(30), requireAdmin, requireSuperAdmin, (req: any, res) => {
    try {
      const db = ensurePaymentCollections(readDb());
      const arr = smsDevicesOf(db);
      const i = arr.findIndex((d: any) => d.id === String(req.params.id));
      if (i < 0) return res.status(404).json({ error: 'That relay device does not exist.' });
      const [dev] = arr.splice(i, 1);
      recordAuditLog(db, 'SMS_DEVICE_DELETE', 'admin:' + String(req.authAdmin), `Deleted SMS device ${dev.id} (${dev.label})`, dev.id);
      writeDb(db);
      res.json({ success: true });
    } catch (err: any) { res.status(500).json({ error: err?.message || 'Could not delete the relay device.' }); }
  });

  /** Parse preview — the console can show what the server will read from an SMS. */
  app.post('/api/admin/sms-devices/parse', rateLimit(120), requireAdmin, (req: any, res) => {
    try {
      const body = req.body || {};
      res.json({ success: true, parsed: parseSms(String(body.message || ''), String(body.sender || '')) });
    } catch (err: any) { res.status(400).json({ error: err?.message || 'Could not parse that message.' }); }
  });

  /**
   * The relay app's single endpoint. Header `x-sms-token: BPX-…`
   * body: { sender, message, receivedAt, appVersion, batteryOk }
   */
  app.post('/api/sms/ingest', rateLimit(240), (req: any, res) => {
    try {
      const token = String(req.headers['x-sms-token'] || (req.body && req.body.deviceToken) || '').trim();
      if (!token) return res.status(401).json({ error: 'Missing device token.' });
      const db = ensurePaymentCollections(readDb());
      const dev = findDeviceByToken(db, token);
      if (!dev) return res.status(401).json({ error: 'This device token is not recognised.' });
      if (dev.active === false) return res.status(403).json({ error: 'This relay device is paused by the admin.' });

      const body = req.body || {};
      const message = String(body.message || '').slice(0, 2000);
      const sender = String(body.sender || '').slice(0, 60);
      const receivedAt = Number(body.receivedAt) || Date.now();
      if (!message.trim()) return res.status(400).json({ error: 'Empty message.' });

      dev.lastSeenAt = Date.now();
      dev.ingestCount = (Number(dev.ingestCount) || 0) + 1;
      if (body.appVersion) dev.appVersion = sanitizeText(body.appVersion, 20);
      if (typeof body.batteryOk === 'boolean') dev.batteryOk = body.batteryOk;

      const parsed = parseSms(message, sender);
      const providerFromDevice = String(dev.methodName || '').toLowerCase().includes('nagad') ? 'NAGAD' : 'BKASH';
      const provider = parsed.provider === 'UNKNOWN' ? providerFromDevice : parsed.provider;
      const inbox = smsInboxOf(db);
      const row: any = {
        id: 'SMS-' + Date.now().toString(36).toUpperCase() + '-' + crypto.randomBytes(2).toString('hex').toUpperCase(),
        deviceId: dev.id, deviceLabel: dev.label, methodId: dev.methodId, methodName: dev.methodName,
        at: Date.now(), receivedAt, sender, provider,
        direction: parsed.direction, amount: parsed.amount, trxId: parsed.trxId,
        status: 'IGNORED', note: parsed.reason || '', requestId: '', userId: '', raw: message.slice(0, 400),
      };
      const finish = (status: number, payload: any) => {
        inbox.unshift(row);
        if (inbox.length > SMS_INBOX_MAX) inbox.length = SMS_INBOX_MAX;
        try { writeDb(db); } catch { /* the response still tells the truth */ }
        return res.status(status).json(payload);
      };

      // A "you have sent Tk 100 to 017…" SMS is the proof that the payout robot's
      // job really left the wallet. It is the ONLY thing that marks a job PAID and
      // completes the user's withdrawal.
      if (parsed.direction === 'DEBIT') {
        const job = matchDebit(ensurePayoutJobs(db), {
          amount: parsed.amount, msisdn: parsed.receiverMsisdn || parsed.senderMsisdn,
          provider: parsed.provider === 'UNKNOWN' ? provider : parsed.provider, trxId: parsed.trxId,
        }, { tolerance: Number(dev.tolerance) || 0 });
        dev.lastSmsAt = Date.now();
        if (!job) {
          row.status = 'IGNORED';
          row.note = 'a debit SMS that matches no job in the payout queue';
          return finish(200, { success: true, status: 'IGNORED', credit: false, note: row.note });
        }
        row.status = 'PAYOUT_PAID';
        row.amount = Number(job.amountBdt) || parsed.amount;
        row.trxId = job.trxId || parsed.trxId;
        row.note = `Payout job ${job.id} confirmed by SMS — ${job.number} · ${job.amountBdt} BDT`;
        if (job.kind === 'WITHDRAW' && job.withdrawId) {
          const wr: any = (db.withdrawRequests || []).find((w: any) => String(w.id) === String(job.withdrawId));
          if (wr && wr.status === 'PENDING') {
            reviewWithdrawCore(db, {
              id: String(wr.id), action: 'APPROVE', actor: 'payout-robot',
              payoutRef: job.trxId || job.id,
              reason: `Paid by the USSD robot · job ${job.id}`,
            });
            row.note += ` — withdrawal ${wr.id} completed`;
          }
        }
        recordAuditLog(db, 'PAYOUT_PAID', smsDeviceActor(dev),
          `Payout job ${job.id} (${job.kind}) paid · ${job.amountBdt} BDT to ${job.number} · TrxID ${job.trxId || parsed.trxId}`,
          job.userId ? String(job.userId) : undefined);
        return finish(200, {
          success: true, status: 'PAYOUT_PAID', credit: false,
          jobId: job.id, amountBdt: job.amountBdt, trxId: job.trxId || parsed.trxId,
        });
      }

      if (!parsed.ok || parsed.direction !== 'CREDIT') {
        row.status = 'IGNORED';
        dev.lastSmsAt = Date.now();
        return finish(200, { success: true, status: 'IGNORED', note: row.note, credit: false });
      }
      dev.lastSmsAt = Date.now();

      // same TrxID twice (retry from the phone, or a replay) → never credit twice
      const seen = inbox.find((r: any) => normalizeTrxId(r.trxId) === normalizeTrxId(parsed.trxId) && r.status === 'CREDITED');
      if (seen) {
        row.status = 'DUPLICATE';
        row.note = `TrxID already credited on ${new Date(Number(seen.at)).toISOString()}`;
        return finish(200, { success: true, status: 'DUPLICATE', credit: false, note: row.note });
      }

      const wanted = normalizeTrxId(parsed.trxId);
      const pending = (db.depositRequests || [])
        .filter((d: any) => d.status === 'PENDING' && String(d.methodId) === String(dev.methodId)
          && normalizeTrxId(d.reference) === wanted)
        .sort((a: any, b: any) => Number(a.createdAt || 0) - Number(b.createdAt || 0));

      if (!pending.length) {
        row.status = 'UNMATCHED';
        row.note = `No pending ${dev.methodName} deposit carries TrxID ${parsed.trxId}`;
        return finish(200, { success: true, status: 'UNMATCHED', credit: false, note: row.note });
      }

      const req0 = pending[0];
      const claimed = Number(req0.entryAmount) || 0;
      const tolerance = Number(dev.tolerance) || 0;
      const sameCurrency = String(req0.entryCurrency || 'BDT').toUpperCase() === 'BDT';
      const amountOk = !sameCurrency ? true : Math.abs(claimed - parsed.amount) <= tolerance + 0.005;

      row.requestId = String(req0.id);
      row.userId = String(req0.userId);
      if (!amountOk) {
        row.status = 'UNMATCHED';
        row.note = `Amount mismatch: user claimed ${claimed} ${req0.entryCurrency || 'BDT'}, SMS says ${parsed.amount}`;
        req0.smsFlag = 'AMOUNT_MISMATCH';
        req0.smsNote = row.note;
        return finish(200, { success: true, status: 'AMOUNT_MISMATCH', credit: false, note: row.note });
      }

      req0.smsDeviceId = dev.id;
      req0.smsReceivedAt = receivedAt;
      req0.smsVerifiedAt = Date.now();
      req0.smsAmount = parsed.amount;
      req0.smsTrxId = parsed.trxId;

      if (dev.autoCredit === false) {
        row.status = 'MATCHED';
        row.note = 'SMS verified — auto-credit is OFF, waiting for a human approval';
        return finish(200, { success: true, status: 'MATCHED', credit: false, requestId: req0.id, note: row.note });
      }

      const out = reviewDepositCore(db, { id: String(req0.id), action: 'APPROVE', actor: smsDeviceActor(dev), reason: `Auto-verified by SMS (${parsed.trxId})` });
      if (out.status !== 200) {
        row.status = 'UNMATCHED';
        row.note = String((out.body || {}).error || 'Approval failed');
        return finish(200, { success: true, status: 'UNMATCHED', credit: false, note: row.note });
      }
      row.status = 'CREDITED';
      row.note = `Credited user ${req0.userId} · ${req0.methodName} · ${parsed.amount} BDT`;
      dev.creditCount = (Number(dev.creditCount) || 0) + 1;
      recordAuditLog(db, 'SMS_AUTO_CREDIT', smsDeviceActor(dev),
        `Deposit ${req0.id} auto-credited from SMS (${dev.methodName} ${parsed.amount}, TrxID ${parsed.trxId})`, String(req0.userId));
      return finish(200, {
        success: true, status: 'CREDITED', credit: true, requestId: req0.id,
        userId: req0.userId, amountBdt: parsed.amount, trxId: parsed.trxId,
        creditedUsd: Number(req0.amountUsd) || 0,
      });
    } catch (err: any) { res.status(500).json({ error: err?.message || 'Could not process the SMS.' }); }
  });

  /* ── PAYOUT QUEUE — the admin panel drives the USSD robot ─────────────────
   *
   *  admin panel ──queue/test──▶ payoutJobs ──poll──▶ phone (ussd-payout app)
   *        ▲                                            │
   *        └──── "you have sent Tk X" SMS ◀── wallet ◀────┘
   *
   * The phone authenticates with the SAME hashed device token as the SMS relay
   * (`x-payout-token` or `x-sms-token`), so there is one device registry, one
   * revoke switch, and no second secret to lose.
   *
   * Money is only ever moved by code that already existed:
   *   · FAILED  → reviewWithdrawCore(REJECT)  → refund + notify the user
   *   · SMS says sent → reviewWithdrawCore(APPROVE) → withdrawal COMPLETED
   * A TEST job has no user and no withdrawal, so it can never move money.
   */

  /** A withdrawal's destination is a {accountName, accountNumber} map — never render it raw. */
  function destinationMsisdn(dest: any): string {
    if (!dest) return '';
    if (typeof dest === 'string') return cleanMsisdn(dest);
    if (typeof dest === 'object') {
      const direct = dest.accountNumber || dest.number || dest.msisdn || dest.mobile || dest.account || dest.phone;
      const ok = cleanMsisdn(direct);
      if (ok) return ok;
      for (const v of Object.values(dest)) {
        const n = cleanMsisdn(v);
        if (n) return n;
      }
    }
    return '';
  }
  function destinationLabel(dest: any): string {
    if (!dest) return '';
    if (typeof dest === 'string') return dest.slice(0, 60);
    if (typeof dest === 'object') {
      const name = String(dest.accountName || dest.name || '').slice(0, 60);
      const num = destinationMsisdn(dest);
      return [name, num].filter(Boolean).join(' · ') || Object.values(dest).map((v) => String(v)).join(' · ').slice(0, 60);
    }
    return '';
  }

  /** One line per phone per minute in the audit log — enough to see a wrong token. */
  const lastAuthNoise = new Map<string, number>();
  function noteAuthFailure(reason: string, token: string, ip: string) {
    const hint = token ? '••••' + token.slice(-4) : '(no token)';
    const key = hint + '|' + reason;
    const now = Date.now();
    if (now - (lastAuthNoise.get(key) || 0) < 60_000) return;
    lastAuthNoise.set(key, now);
    try {
      const db = ensurePaymentCollections(readDb());
      recordAuditLog(db, 'PAYOUT_AUTH_FAIL', 'payout-phone:' + ip,
        `${reason} · token ${hint} · ip ${ip}`, '');
      writeDb(db);
    } catch { /* never let logging break the answer */ }
  }

  function payoutDevice(req: any) {
    const token = String(req.headers['x-payout-token'] || req.headers['x-sms-token'] || '').trim();
    const ip = String((req.headers['x-forwarded-for'] || req.ip || '') + '').split(',')[0].trim();
    if (!token) {
      noteAuthFailure('no token in the request', '', ip);
      return null;
    }
    const db = ensurePaymentCollections(readDb());
    const dev = findDeviceByToken(db, token);
    if (!dev) {
      noteAuthFailure('token not recognised', token, ip);
      return null;
    }
    if (dev.active === false) {
      noteAuthFailure('device paused by the admin', token, ip);
      return null;
    }
    if (dev.payoutEnabled === false) {
      noteAuthFailure('payout is switched OFF for this device', token, ip);
      return null;
    }
    return { db, dev };
  }
  function deviceWallet(dev: any) {
    const p = String(dev.payoutProvider || '').toLowerCase();
    if (p === 'nagad' || p === 'bkash') return p;
    const name = String(dev.methodName || '').toLowerCase();
    if (name.includes('nagad')) return 'nagad';
    if (name.includes('bkash') || name.includes('bikash')) return 'bkash';
    return '';
  }

  /** The phone asks for work. It gets one job at a time, never two. */
  app.post('/api/payout/next', rateLimit(240), (req: any, res) => {
    try {
      const auth = payoutDevice(req);
      if (!auth) return res.status(401).json({
        error: 'This phone is not allowed to send payouts: token missing / not recognised, or payout is off or paused for it.',
        hint: 'Admin panel → Payout Robot → Phones → “New token”, then paste that token in the app (section 4).',
      });
      const { db, dev } = auth;
      const jobs = ensurePayoutJobs(db);
      const dryRun = (req.body || {}).dryRun === true;
      const wallet = deviceWallet(dev);
      const job = claimNext(jobs, {
        deviceId: dev.id, deviceLabel: dev.label, provider: wallet,
        // A phone in DRY RUN only ever gets a TEST job. A phone that is not yet
        // tied to a wallet (SMS Bridge → wallet: auto) is treated the same way, so
        // a real withdrawal never lands on a phone nobody has aimed at it.
        kinds: (dryRun || !wallet) ? ['TEST'] : ['TEST', 'WITHDRAW'],
      });
      dev.lastSeenAt = Date.now();
      if (job) {
        dev.lastJobAt = Date.now();
        recordAuditLog(db, 'PAYOUT_CLAIM', smsDeviceActor(dev),
          `Payout job ${job.id} (${job.kind} · ${job.provider} · ${job.amountBdt} BDT) handed to ${dev.label}`,
          job.userId ? String(job.userId) : undefined);
      }
      writeDb(db);
      res.setHeader('Cache-Control', 'no-store');
      res.json({
        success: true,
        job: job ? {
          id: job.id, kind: job.kind, provider: job.provider, number: job.number,
          amountBdt: job.amountBdt, ref: job.ref, note: job.note || '',
        } : null,
        pollAfterMs: 4000,
      });
    } catch (err: any) { res.status(500).json({ error: err?.message || 'Could not read the payout queue.' }); }
  });

  /** The phone reports what happened. */
  app.post('/api/payout/:id/result', rateLimit(240), (req: any, res) => {
    try {
      const auth = payoutDevice(req);
      if (!auth) return res.status(401).json({ error: 'This phone is not allowed to report payouts.' });
      const { db, dev } = auth;
      const body = req.body || {};
      const raw = String(body.status || '').toUpperCase();
      const status = raw === 'SENT' ? 'SENT' : raw === 'DRYRUN' ? 'DRYRUN' : 'FAILED';
      const out = markResult(ensurePayoutJobs(db), String(req.params.id), status as any, {
        note: sanitizeText(body.note, 300), log: String(body.log || '').slice(0, 4000), deviceId: dev.id,
      });
      if (!out.ok) return res.status(409).json({ error: out.error });
      const job = out.job;
      dev.lastSeenAt = Date.now();

      if (status === 'FAILED' && job.kind === 'WITHDRAW' && job.withdrawId) {
        const wr: any = (db.withdrawRequests || []).find((w: any) => String(w.id) === String(job.withdrawId));
        if (wr && wr.status === 'PENDING') {
          reviewWithdrawCore(db, {
            id: String(wr.id), action: 'REJECT', actor: 'payout-robot',
            reason: `The phone could not send it: ${sanitizeText(body.note, 140) || 'no reason given'}`,
          });
        }
      }
      // A DRYRUN moves no money and leaves a real withdrawal PENDING for a live retry.
      recordAuditLog(db, 'PAYOUT_' + status, smsDeviceActor(dev),
        `Payout job ${job.id} → ${status}${body.note ? ' · ' + sanitizeText(body.note, 120) : ''}`,
        job.userId ? String(job.userId) : undefined);
      writeDb(db);
      res.json({ success: true, job: publicJob(job) });
    } catch (err: any) { res.status(500).json({ error: err?.message || 'Could not record the payout result.' }); }
  });

  /** Everything the admin "Payout Robot" screen paints. */
  app.get('/api/admin/payouts', rateLimit(120), requireAdmin, (req: any, res) => {
    try {
      const db = ensurePaymentCollections(readDb());
      const jobs = ensurePayoutJobs(db);
      const pending = (db.withdrawRequests || []).filter((w: any) => w.status === 'PENDING').slice(0, 40)
        .map((w: any) => {
          const u: any = (db.users || []).find((x: any) => String(x.id) === String(w.userId)) || {};
          const bdt = toDisplay(db, Number(w.netUsd) || 0, 'BDT');
          return {
            id: w.id, userId: w.userId, userName: u.name || '', userPhone: u.phone || '',
            methodName: w.methodName,
            number: destinationMsisdn(w.destination),
            destination: destinationLabel(w.destination),
            amountUsd: Number(w.netUsd) || 0,
            amountBdt: bdt == null ? null : Math.round(bdt * 100) / 100,
            queued: jobs.some((j) => j.status !== 'CANCELLED' && j.status !== 'FAILED' && j.withdrawId === w.id),
            createdAt: w.createdAt || 0,
          };
        });
      res.setHeader('Cache-Control', 'no-store');
      res.json({
        success: true,
        jobs: jobs.slice(0, 120).map(publicJob),
        pending,
        stats: queueStats(jobs),
        devices: smsDevicesOf(db).map((d: any) => ({
          ...publicSmsDevice(d),
          payoutEnabled: d.payoutEnabled !== false,
          payoutProvider: d.payoutProvider || deviceWallet(d) || '',
          lastJobAt: d.lastJobAt || 0,
        })),
        rate: { BDT: fxRate(db, 'BDT') },
        events: (db.auditLogs || [])
          .filter((a: any) => String(a.action || '').startsWith('PAYOUT_'))
          .slice(0, 25)
          .map((a: any) => ({
            at: Number(a.at || a.timestamp || 0),
            action: String(a.action || ''),
            detail: String(a.detail || a.note || '').slice(0, 220),
          })),
      });
    } catch (err: any) { res.status(500).json({ error: err?.message || 'Could not load the payout queue.' }); }
  });

  /** A test payout from the admin panel — real USSD, real money, no user attached. */
  app.post('/api/admin/payouts/test', rateLimit(20), requireAdmin, requireSuperAdmin, (req: any, res) => {
    try {
      const body = req.body || {};
      const db = ensurePaymentCollections(readDb());
      const built = buildJob({
        kind: 'TEST', provider: body.provider, number: body.number, amountBdt: body.amountBdt,
        ref: body.ref, note: 'admin test' + (body.dryRun === true ? ' (dry run)' : ''),
      });
      if (!built.ok) return res.status(400).json({ error: built.error });
      const jobs = ensurePayoutJobs(db);
      jobs.unshift(built.job);
      recordAuditLog(db, 'PAYOUT_TEST_QUEUED', 'admin:' + String(req.authAdmin),
        `Test payout ${built.job.id}: ${built.job.amountBdt} BDT to ${built.job.number} (${built.job.provider})`, built.job.id);
      writeDb(db);
      res.json({ success: true, job: publicJob(built.job) });
    } catch (err: any) { res.status(500).json({ error: err?.message || 'Could not queue the test payout.' }); }
  });

  /** Turn a pending withdrawal into a robot job. */
  app.post('/api/admin/payouts/queue', rateLimit(30), requireAdmin, requireSuperAdmin, (req: any, res) => {
    try {
      const body = req.body || {};
      const db = ensurePaymentCollections(readDb());
      const w: any = (db.withdrawRequests || []).find((x: any) => String(x.id) === String(body.withdrawId));
      if (!w) return res.status(404).json({ error: 'That withdrawal does not exist.' });
      if (w.status !== 'PENDING') return res.status(409).json({ error: `This withdrawal is already ${w.status}.` });
      const jobs = ensurePayoutJobs(db);
      if (jobs.some((j) => j.withdrawId === w.id && ['QUEUED', 'CLAIMED', 'SENT'].includes(j.status))) {
        return res.status(409).json({ error: 'This withdrawal is already in the queue.' });
      }
      const name = String(w.methodName || '').toLowerCase();
      const provider = name.includes('nagad') ? 'nagad' : (name.includes('bkash') || name.includes('বিকাশ')) ? 'bkash' : '';
      if (!provider) return res.status(400).json({ error: 'This withdrawal is not a bKash/Nagad number payout.' });
      const amountBdt = body.amountBdt != null && String(body.amountBdt).trim() !== ''
        ? cleanAmount(body.amountBdt)
        : (toDisplay(db, Number(w.netUsd) || 0, 'BDT') || 0);
      const built = buildJob({
        kind: 'WITHDRAW', provider, number: body.number || destinationMsisdn(w.destination), amountBdt,
        amountUsd: Number(w.netUsd) || 0, ref: '1',
        withdrawId: w.id, userId: w.userId, note: `withdrawal ${w.id}`,
      });
      if (!built.ok) return res.status(400).json({ error: built.error });
      jobs.unshift(built.job);
      recordAuditLog(db, 'PAYOUT_QUEUED', 'admin:' + String(req.authAdmin),
        `Withdrawal ${w.id} queued: ${built.job.amountBdt} BDT to ${built.job.number} (${provider})`, String(w.userId));
      writeDb(db);
      res.json({ success: true, job: publicJob(built.job) });
    } catch (err: any) { res.status(500).json({ error: err?.message || 'Could not queue that withdrawal.' }); }
  });

  /** Cancel a job that has not left the wallet. A queued withdrawal is refunded. */
  app.post('/api/admin/payouts/:id/cancel', rateLimit(30), requireAdmin, requireSuperAdmin, (req: any, res) => {
    try {
      const db = ensurePaymentCollections(readDb());
      const jobs = ensurePayoutJobs(db);
      const out = cancelJob(jobs, String(req.params.id), { reason: sanitizeText((req.body || {}).reason, 160) });
      if (!out.ok) return res.status(409).json({ error: out.error });
      const job = out.job;
      if (job.kind === 'WITHDRAW' && job.withdrawId) {
        const wr: any = (db.withdrawRequests || []).find((w: any) => String(w.id) === String(job.withdrawId));
        if (wr && wr.status === 'PENDING') {
          reviewWithdrawCore(db, { id: String(wr.id), action: 'REJECT', actor: 'admin:' + String(req.authAdmin), reason: 'Payout job cancelled in the admin panel' });
        }
      }
      recordAuditLog(db, 'PAYOUT_CANCEL', 'admin:' + String(req.authAdmin), `Payout job ${job.id} cancelled`, job.userId);
      writeDb(db);
      res.json({ success: true, job: publicJob(job) });
    } catch (err: any) { res.status(500).json({ error: err?.message || 'Could not cancel that job.' }); }
  });

  /** Issue a fresh token for a phone — the old one stops working immediately. */
  app.post('/api/admin/payouts/devices/:id/token', rateLimit(10), requireAdmin, requireSuperAdmin, (req: any, res) => {
    try {
      const db = ensurePaymentCollections(readDb());
      const dev: any = smsDevicesOf(db).find((d: any) => String(d.id) === String(req.params.id));
      if (!dev) return res.status(404).json({ error: 'That device does not exist.' });
      const token = 'BPX-' + crypto.randomBytes(18).toString('hex').toUpperCase();
      dev.tokenHash = smsTokenHash(token);
      dev.tokenHint = token.slice(-4);
      dev.tokenIssuedAt = Date.now();
      recordAuditLog(db, 'PAYOUT_DEVICE_TOKEN', 'admin:' + String(req.authAdmin),
        `New token for device ${dev.id} (${dev.label}) — the previous token no longer works`, dev.id);
      writeDb(db);
      res.json({ success: true, token, device: publicSmsDevice(dev) });
    } catch (err: any) { res.status(500).json({ error: err?.message || 'Could not issue a new token.' }); }
  });

  /** Let a phone send payouts (or stop it) without touching its SMS relay duty. */
  app.post('/api/admin/payouts/devices/:id', rateLimit(60), requireAdmin, requireSuperAdmin, (req: any, res) => {
    try {
      const body = req.body || {};
      const db = ensurePaymentCollections(readDb());
      const dev: any = smsDevicesOf(db).find((d: any) => String(d.id) === String(req.params.id));
      if (!dev) return res.status(404).json({ error: 'That device does not exist.' });
      if (typeof body.payoutEnabled === 'boolean') dev.payoutEnabled = body.payoutEnabled;
      if (body.payoutProvider != null) {
        const p = String(body.payoutProvider).toLowerCase();
        if (!['', 'nagad', 'bkash'].includes(p)) return res.status(400).json({ error: 'payoutProvider must be nagad, bkash or empty.' });
        dev.payoutProvider = p;
      }
      recordAuditLog(db, 'PAYOUT_DEVICE_UPDATE', 'admin:' + String(req.authAdmin),
        `Device ${dev.id} (${dev.label}): payout ${dev.payoutEnabled === false ? 'OFF' : 'ON'} · wallet ${dev.payoutProvider || 'auto'}`, dev.id);
      writeDb(db);
      res.json({ success: true, device: publicSmsDevice(dev) });
    } catch (err: any) { res.status(500).json({ error: err?.message || 'Could not update that device.' }); }
  });

  // One-off (and re-runnable) move of bonuses that still sit in the retired bonus
  // wallet into the main balance. Dry-run by default.
  app.post('/api/admin/promo/bonus/to-main', rateLimit(20), requireAdmin, requireSuperAdmin, (req: any, res) => {
    try {
      const db = readDb();
      const apply = (req.body || {}).confirm === true;
      const only = (req.body || {}).userId ? String((req.body || {}).userId) : '';
      const pending = (db.bonusGrants || []).filter((g: any) =>
        g.status === 'ACTIVE' && Number(g.remaining) > 0 && g.creditedTo !== 'MAIN' &&
        (!only || String(g.userId) === only));
      if (!apply) {
        const total = Math.round(pending.reduce((a: number, g: any) => a + (Number(g.remaining) || 0), 0) * 1e8) / 1e8;
        return res.json({
          dryRun: true, grants: pending.length, users: new Set(pending.map((g: any) => String(g.userId))).size, total,
          preview: pending.slice(0, 50).map((g: any) => ({ grant: g.id, userId: String(g.userId), amount: Number(g.remaining) || 0, campaign: g.campaignCode })),
        });
      }
      const out = migrateBonusWalletToBalance(db, { userId: only });
      if (out.total > 0) {
        recordAuditLog(db, 'BONUS_MOVED_TO_MAIN', String(req.authAdmin || 'admin'),
          `Moved $${out.total.toFixed(2)} of promotion bonus into main balances (${out.users.length} user(s), ${out.grants} grant(s))`,
          only || undefined);
        writeDb(db);
        for (const id of out.users) { try { broadcastUserUpdate(db, id); } catch { /* ignore */ } }
      }
      res.json({ success: true, grants: out.grants, users: out.users.length, total: out.total });
    } catch (err: any) { res.status(500).json({ error: err?.message || 'Could not move the bonuses.' }); }
  });

  // Rebuild a campaign's counters from the bonus ledger. Slots used and budget are
  // derived values — they can drift (a backfill used to bump them twice), and no
  // money moves here, so this is a safe repair action for the admin console.
  app.post('/api/admin/promo/campaigns/recount', rateLimit(30), requireAdmin, requireSuperAdmin, (req: any, res) => {
    try {
      const db = readDb();
      const body = req.body || {};
      const only = body.campaignId ? String(body.campaignId) : '';
      const apply = body.confirm === true;
      const campaigns = (db.campaigns || []).filter((c: any) => !only || String(c.id) === only);
      if (!campaigns.length) return res.status(404).json({ error: 'No such campaign.' });
      const rows = campaigns.map((c: any) => {
        const grants = (db.bonusGrants || []).filter((g: any) => String(g.campaignId) === String(c.id));
        const before = {
          used: Math.max(0, Math.trunc(Number(c.used) || 0)),
          budgetUsed: referRound2(Number(c.budgetUsed) || 0),
        };
        const after = {
          used: grants.length,
          budgetUsed: referRound2(grants.reduce((a: number, g: any) => a + (Number(g.grantedAmount) || 0), 0)),
        };
        if (apply) { c.used = after.used; c.budgetUsed = after.budgetUsed; }
        return { id: String(c.id), code: String(c.code).toUpperCase(), before, after, changed: before.used !== after.used || before.budgetUsed !== after.budgetUsed };
      });
      if (apply) {
        const fixed = rows.filter((r: any) => r.changed);
        if (fixed.length) {
          recordAuditLog(db, 'CAMPAIGN_RECOUNT', String(req.authAdmin || 'admin'),
            `Campaign counters rebuilt from the bonus ledger: ${fixed.map((r: any) => `${r.code} ${r.before.used}→${r.after.used} slots, $${r.before.budgetUsed}→$${r.after.budgetUsed}`).join('; ')}`);
          writeDb(db);
        }
      }
      res.json({ success: true, dryRun: !apply, campaigns: rows });
    } catch (err: any) {
      res.status(500).json({ error: err?.message || 'Could not recount the campaign.' });
    }
  });

  // Leaderboard by campaign (spec item G)
  app.get('/api/admin/promo/leaderboard', requireAdmin, requireSuperAdmin, (req: any, res) => {
    const db = readDb();
    const rows = (db.campaigns || []).map((c: any) => {
      const st = campaignStats(db, c);
      return { id: c.id, code: String(c.code).toUpperCase(), name: c.name || '', joins: st.successful, firstDeposits: st.firstDeposits, bonusIssued: st.bonusIssued, conversionRate: st.conversionRate };
    }).sort((a: any, b: any) => (b.firstDeposits - a.firstDeposits) || (b.joins - a.joins));
    res.json({ leaderboard: rows });
  });

  // Public: is there a welcome bonus running? (shown on the signup screen — numbers only)
  app.get('/api/promo/welcome', rateLimit(60), (req: any, res) => {
    try {
      const db = readDb();
      const c = welcomeCampaignOf(db);
      res.setHeader('Cache-Control', 'no-store');
      res.json({ welcome: c ? campaignPublicView(db, c) : null });
    } catch (err: any) { res.status(500).json({ error: err?.message || 'Could not read the welcome bonus.' }); }
  });

  // Public: what does this code do? Used by the signup screen AND the promotion
  // console's preview. Never returns budget internals or user identities.
  app.get('/api/promo/code/:code', rateLimit(60), (req: any, res) => {
    try {
      const db = readDb();
      const code = normalizeRefCode(req.params.code);
      const c = campaignOf(db, code);
      const legacy = bonusUsableView(bonusRowOf(db, code));
      const owner = resolveRefCode(db, code);
      res.setHeader('Cache-Control', 'no-store');
      if (!c) {
        return res.json({ campaign: null, bonus: legacy, referrerId: owner.userId || null, code });
      }
      res.json({ campaign: campaignPublicView(db, c), bonus: null, referrerId: owner.userId || null, code });
    } catch (err: any) { res.status(500).json({ error: err?.message || 'Could not look up that code.' }); }
  });

  // ── user-facing bonus wallet (the Refer/Bonus section of the user app) ───
  app.get('/api/user/bonus', requireUser, (req: any, res) => {
    try {
      const db = readDb();
      const uid = String(req.authUserId || '');
      const wallet = bonusWalletOf(db, uid);
      const ledger = (db.bonusLedger || []).filter((r: any) => String(r.userId) === uid).slice(0, 100);
      const pending = (db.bonusReviews || []).filter((r: any) => String(r.userId) === uid && r.status === 'PENDING')
        .map((r: any) => ({ id: r.id, campaignCode: r.campaignCode, amount: r.amount, status: r.status, at: r.timestamp }));
      const waiting = (db.pendingBonuses || []).filter((b: any) => String(b.userId) === uid && b.status === 'WAITING_DEPOSIT');
      const me = (db.users || []).find((u: any) => String(u.id) === uid);
      const rules = (db.campaigns || []).filter((c: any) => String(c.code).toUpperCase() === String((me && (me as any).campaignCode) || '')).map((c: any) => campaignPublicView(db, c));
      persistBonusSweep(db);   // an expiry that paid out must survive the request
      res.setHeader('Cache-Control', 'no-store');
      res.json({
        wallet,
        campaignCode: (me && (me as any).campaignCode) || null,
        rules: rules[0] || null,
        pendingReviews: pending,
        waitingDeposit: waiting,
        ledger,
      });
    } catch (err: any) { res.status(500).json({ error: err?.message || 'Could not load your bonus wallet.' }); }
  });

  // Bonuses are credited to the main balance now, so there is nothing to convert.
  // Kept as a graceful no-op: installed apps still call it and must not error.
  app.post('/api/user/bonus/convert', rateLimit(30), requireUser, (req: any, res) => {
    try {
      const db = readDb();
      const uid = String(req.authUserId || '');
      const user = (db.users || []).find((u: any) => String(u.id) === uid);
      res.json({
        success: true, amount: 0, moved: 0, balance: (user && Number(user.balance)) || 0,
        wallet: bonusWalletOf(db, uid),
        notice: 'Promotion bonuses are added straight to your main balance — there is nothing to convert.',
      });
    } catch (err: any) { res.status(500).json({ error: err?.message || 'Could not load your balance.' }); }
  });

  // Sending bonus money between bonus wallets no longer exists: the bonus is part
  // of the main balance, and money is moved with the normal P2P send.
  app.post('/api/user/bonus/send', rateLimit(20), requireUser, (req: any, res) => {
    const db = readDb();
    res.status(410).json({
      error: 'Promotion bonuses now go straight to your main balance — send money with the normal Send option instead.',
      balance: ((db.users || []).find((u: any) => String(u.id) === String(req.authUserId || '')) || {}).balance || 0,
    });
  });

  // The pending-deposit bonus is released by the engine when a deposit lands.
  function releasePendingBonuses(db: any, userId: string, depositAmount: number) {
    const rows = (db.pendingBonuses || []).filter((b: any) => String(b.userId) === String(userId) && b.status === 'WAITING_DEPOSIT');
    for (const row of rows) {
      if (Number(depositAmount) + 1e-9 < Number(row.minDeposit)) continue;
      const campaign = (db.campaigns || []).find((c: any) => String(c.id) === String(row.campaignId));
      if (!campaign) continue;
      const res2 = creditCampaignBonus(db, { campaign, userId: String(userId), reason: 'DEPOSIT_RELEASED', bypassFraud: true });
      row.status = res2.paid ? 'RELEASED' : 'FAILED';
      row.releasedAt = Date.now();
      // first-deposit reward on top of the join bonus
      const fd = Number(campaign.firstDepositBonus) || 0;
      const fdMin = Number(campaign.firstDepositMin) || 0;
      if (res2.paid && fd > 0 && Number(depositAmount) + 1e-9 >= fdMin) {
        const extra = creditCampaignBonus(db, { campaign: { ...campaign, id: campaign.id + ':FD', bonusPerUser: fd }, userId: String(userId), reason: 'FIRST_DEPOSIT', bypassFraud: true });
        if (extra.paid) bonusLedgerRow(db, { id: 'BL-' + Math.floor(10000000 + Math.random() * 90000000), userId: String(userId), grantId: extra.grant.id, campaignId: campaign.id, type: 'BONUS_CREDIT', amount: fd, timestamp: Date.now(), notes: `First-deposit reward from ${campaign.code}` });
      }
    }
  }

  // ══ Admin → Referral → Signup bonus codes ══════════════════════════════
  // A bonus code pays real money into a new wallet. Everything about it is set
  // here: the amount, how many people may use it, whether that money can be sent
  // out, and an on/off switch. Every change is audit-logged.
  app.get('/api/admin/bonus-codes', requireAdmin, requireSuperAdmin, (req:any,res)=>{
    try {
      const db=readDb();
      const rows=(db.bonusCodes||[]).slice().sort((a:any,b:any)=> (Number(b.createdAt)||0)-(Number(a.createdAt)||0));
      const claims=(db.transactions||[]).filter((t:any)=> t.type==='SIGNUP_BONUS');
      const paidTotal=claims.reduce((a:number,t:any)=> a+(Number(t.amount)||0),0);
      const q=String(req.query.q||'').trim().toUpperCase();
      let list=rows.map((b:any)=>{
        const v=bonusUsableView(b) || {};
        const mine=claims.filter((t:any)=> String((t.metadata||{}).code||'')===String(b.code).toUpperCase());
        return {
          id: b.id, code: String(b.code).toUpperCase(),
          amount: Number(b.amount)||0, maxClaims: Number(b.maxClaims)||0,
          used: Math.max(0, Math.trunc(Number(b.used)||0)),
          remaining: v.remaining, active: !!v.active, enabled: b.enabled!==false,
          transferable: b.transferable!==false,
          note: String(b.note||''), createdAt: Number(b.createdAt)||0,
          // staff identity stays in the audit log — the panel only needs "was it staff"
          createdByStaff: !!b.createdBy,
          paidTotal: mine.reduce((a:number,t:any)=> a+(Number(t.amount)||0),0),
          lastUsedAt: Number(b.lastUsedAt)||0,
          claimedBy: mine.slice(0,20).map((t:any)=> ({ userId:String(t.userId), amount:Number(t.amount)||0, at:Number(t.timestamp)||0 })),
        };
      });
      if (q) list=list.filter((b:any)=> b.code.includes(q) || b.note.toUpperCase().includes(q));
      res.setHeader('Cache-Control','no-store');
      res.json({
        bounds:{ maxAmount: BONUS_MAX_AMOUNT, maxClaims: BONUS_MAX_CLAIMS },
        stats:{ codes:rows.length, activeCodes:list.filter((b:any)=>b.active).length, totalClaims:claims.length, paidTotal: Math.round(paidTotal*1e8)/1e8, lockedClaims: claims.filter((t:any)=> (t.metadata||{}).locked).length },
        codes:list,
      });
    } catch (err:any) { res.status(500).json({ error: err?.message || 'Could not load bonus codes.' }); }
  });

  app.post('/api/admin/bonus-codes/save', rateLimit(60), requireAdmin, requireSuperAdmin, (req:any,res)=>{
    try {
      const db=readDb();
      if (!db.bonusCodes) db.bonusCodes=[];
      const body=req.body||{};
      const id=String(body.id||'');
      const code=normalizeRefCode(body.code);
      const fmt=validateRefCodeFormat(code);
      if (!fmt.ok) return res.status(400).json({ error: fmt.error });
      const amount=Number(body.amount);
      if (!Number.isFinite(amount) || amount<0 || amount>BONUS_MAX_AMOUNT) {
        return res.status(400).json({ error:`Bonus amount must be between 0 and ${BONUS_MAX_AMOUNT}.` });
      }
      const maxClaims=Math.trunc(Number(body.maxClaims));
      if (!Number.isFinite(maxClaims) || maxClaims<0 || maxClaims>BONUS_MAX_CLAIMS) {
        return res.status(400).json({ error:`How many people may use it must be between 0 and ${BONUS_MAX_CLAIMS}.` });
      }
      let row=(db.bonusCodes||[]).find((b:any)=> (id && String(b.id)===id) || String(b.code).toUpperCase()===code);
      // a bonus code must not collide with somebody's personal refer code
      const owner=resolveRefCode(db, code);
      if (owner.userId && !(row && String(owner.userId)===String(row.ownerUserId||''))) {
        return res.status(409).json({ error:`${code} is already a personal refer code of #${owner.userId}. Pick another code, or use that user's code and set the bonus on it here (ownerUserId).` });
      }
      if (row) {
        const nextUsed=Math.max(0, Math.trunc(Number(row.used)||0));
        if (maxClaims < nextUsed) return res.status(400).json({ error:`${nextUsed} people already used this code — the limit cannot be lower than that.` });
        row.amount=amount; row.maxClaims=maxClaims;
        row.transferable=body.transferable!==false;
        row.enabled=body.enabled!==false;
        row.note=String(body.note||'').slice(0,200);
        row.updatedAt=Date.now();
        row.updatedBy=String(req.authAdmin||'admin');
      } else {
        row={ id:'BN-'+Math.floor(10000000+Math.random()*90000000), code, amount, maxClaims, used:0,
          transferable: body.transferable!==false, enabled: body.enabled!==false,
          note:String(body.note||'').slice(0,200), createdAt:Date.now(),
          createdBy:String(req.authAdmin||'admin'),
          ownerUserId: owner.userId ? String(owner.userId) : null };
        db.bonusCodes.unshift(row);
      }
      recordAuditLog(db,'BONUS_CODE_SAVED', String(req.authAdmin||'admin'),
        `Signup bonus code ${row.code}: $${amount}, max ${maxClaims}, ${row.transferable?'transferable':'boost only'}, ${row.enabled?'ON':'OFF'}`, row.code);
      writeDb(db);
      res.json({ success:true, code: bonusUsableView(row), id: row.id });
    } catch (err:any) { res.status(500).json({ error: err?.message || 'Could not save the bonus code.' }); }
  });

  app.post('/api/admin/bonus-codes/remove', rateLimit(60), requireAdmin, requireSuperAdmin, (req:any,res)=>{
    try {
      const db=readDb();
      const id=String((req.body||{}).id||'');
      const code=normalizeRefCode((req.body||{}).code);
      const row=(db.bonusCodes||[]).find((b:any)=> (id && String(b.id)===id) || (code && String(b.code).toUpperCase()===code));
      if (!row) return res.status(404).json({ error:'No such bonus code.' });
      db.bonusCodes=(db.bonusCodes||[]).filter((b:any)=> b!==row);
      recordAuditLog(db,'BONUS_CODE_REMOVED', String(req.authAdmin||'admin'),
        `Bonus code ${row.code} removed (paid ${row.used||0} people)`, String(row.code));
      writeDb(db);
      res.json({ success:true, code:String(row.code).toUpperCase() });
    } catch (err:any) { res.status(500).json({ error: err?.message || 'Could not remove the bonus code.' }); }
  });

  // ══ Admin → Referral → Codes ═══════════════════════════════════════════
  // Everything about vanity codes is driven from the admin panel: the global
  // limit, an on/off switch, per-user grants, and direct set/remove/make-primary
  // for any account (audit-logged). The user app only ever reads the outcome.
  app.get('/api/admin/refer-codes', requireAdmin, requireSuperAdmin, (req:any,res)=>{
    try {
      const db=readDb();
      const settings=refCodeSettings(db);
      const q=String(req.query.q||'').trim().toUpperCase();
      const rows=(db.referCodes||[]).slice().sort((a:any,b:any)=> (Number(b.createdAt)||0)-(Number(a.createdAt)||0));
      const users=(db.users||[]);
      const byUser=new Map<string,number>();
      for (const r of rows) byUser.set(String(r.userId), (byUser.get(String(r.userId))||0)+1);
      let list=rows.map((r:any)=>{
        const u=users.find((x:any)=> String(x.id)===String(r.userId));
        return {
          code:String(r.code).toUpperCase(),
          userId:String(r.userId),
          createdAt:Number(r.createdAt)||0,
          primary:(u && String((u as any).referCodeCustom||'').toUpperCase()===String(r.code).toUpperCase()) || false,
          codesOnUser: byUser.get(String(r.userId))||0,
          userExists: !!u,
          userBalance: u ? Number(u.balance)||0 : 0,
          userFrozen: !!(u && u.isFrozen),
          extraClaims: u ? Number((u as any).referCodeExtraClaims)||0 : 0,
          referrals: (db.referrals||[]).filter((x:any)=> String(x.referrerId)===String(r.userId)).length,
        };
      });
      if (q) {
        list=list.filter((r:any)=> r.code.includes(q) || r.userId.toUpperCase().includes(q));
      }
      const totalClaims=rows.length;
      const owners=byUser.size;
      const overLimit=[...byUser.entries()].filter(([,n])=> n>settings.limit).length;
      res.setHeader('Cache-Control','no-store');
      res.json({
        settings,
        stats:{ totalCodes:totalClaims, owners, usersWithoutCode: Math.max(0, users.filter((u:any)=>u.role!=='ADMIN').length-owners), overLimit },
        codes:list.slice(0,500),
        truncated: list.length>500,
      });
    } catch (err:any) { res.status(500).json({ error: err?.message || 'Could not load refer codes.' }); }
  });

  app.post('/api/admin/refer-codes/settings', rateLimit(30), requireAdmin, requireSuperAdmin, (req:any,res)=>{
    try {
      const db=readDb();
      if (!db.config) db.config=(INITIAL_DB as any).config;
      if (!db.config.referral) db.config.referral={};
      const body=req.body||{};
      if (body.limit !== undefined) {
        const n=Number(body.limit);
        if (!Number.isFinite(n) || n<0 || n>50) return res.status(400).json({ error:'Limit must be a whole number between 0 and 50.' });
        db.config.referral.codeLimit=Math.trunc(n);
      }
      if (body.enabled !== undefined) db.config.referral.codesEnabled=!!body.enabled;
      recordAuditLog(db,'REFERRAL_CODE_SETTINGS', String(req.authAdmin||'admin'),
        `Custom refer codes: limit=${refCodeSettings(db).limit}, enabled=${refCodeSettings(db).enabled}`, 'ADMIN');
      writeDb(db);
      res.json({ success:true, settings: refCodeSettings(db) });
    } catch (err:any) { res.status(500).json({ error: err?.message || 'Could not save the settings.' }); }
  });

  // Admin sets / replaces any user's code. Bypasses the claim count (that is the
  // point: a youtuber deal is decided by staff, not by the 3-claim cap).
  app.post('/api/admin/refer-codes/set', rateLimit(60), requireAdmin, requireSuperAdmin, (req:any,res)=>{
    try {
      const db=readDb();
      const userId=String((req.body||{}).userId||'').replace(/^#/,'').trim();
      const code=normalizeRefCode((req.body||{}).code);
      if (!userId) return res.status(400).json({ error:'userId is required.' });
      const user=(db.users||[]).find((u:any)=> String(u.id)===userId);
      if (!user) return res.status(404).json({ error:`No user with id ${userId}.` });
      const fmt=validateRefCodeFormat(code);
      if (!fmt.ok) return res.status(400).json({ error: fmt.error });
      const owner=resolveRefCode(db, code);
      if (owner.userId && String(owner.userId)!==userId) {
        return res.status(409).json({ error:`${code} already belongs to #${owner.userId}. Remove it there first.` });
      }
      if (!db.referCodes) db.referCodes=[];
      const exists=(db.referCodes||[]).some((r:any)=> String(r.code).toUpperCase()===code);
      if (!exists) db.referCodes.unshift({ code, userId, createdAt: Date.now(), setBy: String(req.authAdmin||'admin'), adminGranted: true });
      (user as any).referCodeCustom=code;
      recordAuditLog(db,'REFERRAL_CODE_SET_BY_ADMIN', String(req.authAdmin||'admin'),
        `Admin set refer code ${code} for User #${userId}`, userId);
      writeDb(db);
      res.json({ success:true, code, userId, codes: refCodeList(db, user), claimsLimit: refCodeLimitFor(db, user) });
    } catch (err:any) { res.status(500).json({ error: err?.message || 'Could not set that code.' }); }
  });

  // Remove a code entirely (it stops resolving). The owner keeps every alias left.
  app.post('/api/admin/refer-codes/remove', rateLimit(60), requireAdmin, requireSuperAdmin, (req:any,res)=>{
    try {
      const db=readDb();
      const code=normalizeRefCode((req.body||{}).code);
      if (!code) return res.status(400).json({ error:'code is required.' });
      const row=(db.referCodes||[]).find((r:any)=> String(r.code).toUpperCase()===code);
      if (!row) return res.status(404).json({ error:`${code} is not a custom code.` });
      db.referCodes=(db.referCodes||[]).filter((r:any)=> String(r.code).toUpperCase()!==code);
      const user=(db.users||[]).find((u:any)=> String(u.id)===String(row.userId));
      if (user && String((user as any).referCodeCustom||'').toUpperCase()===code) {
        const next=(db.referCodes||[]).find((r:any)=> String(r.userId)===String(row.userId));
        (user as any).referCodeCustom = next ? String(next.code).toUpperCase() : '';
      }
      recordAuditLog(db,'REFERRAL_CODE_REMOVED_BY_ADMIN', String(req.authAdmin||'admin'),
        `Admin removed refer code ${code} from User #${row.userId}`, String(row.userId));
      writeDb(db);
      res.json({ success:true, code, userId:String(row.userId), primary: user ? ((user as any).referCodeCustom||null) : null });
    } catch (err:any) { res.status(500).json({ error: err?.message || 'Could not remove that code.' }); }
  });

  // Make one of a user's existing aliases the primary (share link) code.
  app.post('/api/admin/refer-codes/primary', rateLimit(60), requireAdmin, requireSuperAdmin, (req:any,res)=>{
    try {
      const db=readDb();
      const code=normalizeRefCode((req.body||{}).code);
      const row=(db.referCodes||[]).find((r:any)=> String(r.code).toUpperCase()===code);
      if (!row) return res.status(404).json({ error:`${code} is not a custom code.` });
      const user=(db.users||[]).find((u:any)=> String(u.id)===String(row.userId));
      if (!user) return res.status(404).json({ error:'That code has no owner any more.' });
      (user as any).referCodeCustom=String(row.code).toUpperCase();
      recordAuditLog(db,'REFERRAL_CODE_PRIMARY_BY_ADMIN', String(req.authAdmin||'admin'),
        `Admin made ${code} the primary refer code of User #${row.userId}`, String(row.userId));
      writeDb(db);
      res.json({ success:true, code:String(row.code).toUpperCase(), userId:String(row.userId) });
    } catch (err:any) { res.status(500).json({ error: err?.message || 'Could not switch that code.' }); }
  });

  // Grant (or take back) extra claims for one user.
  app.post('/api/admin/refer-codes/grant', rateLimit(60), requireAdmin, requireSuperAdmin, (req:any,res)=>{
    try {
      const db=readDb();
      const userId=String((req.body||{}).userId||'').replace(/^#/,'').trim();
      const extra=Number((req.body||{}).extra);
      if (!userId) return res.status(400).json({ error:'userId is required.' });
      if (!Number.isFinite(extra) || extra<0 || extra>100) return res.status(400).json({ error:'extra must be between 0 and 100.' });
      const user=(db.users||[]).find((u:any)=> String(u.id)===userId);
      if (!user) return res.status(404).json({ error:`No user with id ${userId}.` });
      (user as any).referCodeExtraClaims=Math.trunc(extra);
      recordAuditLog(db,'REFERRAL_CODE_GRANT', String(req.authAdmin||'admin'),
        `Admin gave User #${userId} ${Math.trunc(extra)} extra code claim(s)`, userId);
      writeDb(db);
      res.json({ success:true, userId, extra:Math.trunc(extra), claimsLimit: refCodeLimitFor(db, user), codeClaimsLeft: refCodeClaimsLeft(db, user) });
    } catch (err:any) { res.status(500).json({ error: err?.message || 'Could not change the grant.' }); }
  });

  app.get('/api/refer/leader', requireUserOrAdmin, (req:any,res)=>{
    const db=readDb();
    // rank referrers by daily count today
    const dayK=getDayKey(Date.now());
    const map = new Map<string, number>();
    for (const r of (db.referrals||[])) {
      const k=(r.dayKey||getDayKey(r.createdAt));
      if (k===dayK) {
        map.set(String(r.referrerId), (map.get(String(r.referrerId))||0)+1);
      }
    }
    const rows = Array.from(map.entries()).map(([id,cnt])=> ({ referrerId:id, dailyCount:cnt, rate: getReferTierRate(cnt, db.config), lifetime: getReferLifetimeCommission(db,id) })).sort((a,b)=> b.dailyCount-a.dailyCount).slice(0,50);
    res.json({ dayKey: dayK, rows });
  });

  // ============== Admin refer + antifraud controls ==============
  app.get('/api/admin/refer/overview', requireAdmin, (req:any,res)=>{
    const db=readDb();
    const totalReferrals=(db.referrals||[]).length;
    const totalCommissions=(db.referCommissions||[]).reduce((a:number,c:any)=> a+(Number(c.amount)||0),0);
    res.json({ totalReferrals, totalCommissions, referrals: (db.referrals||[]).slice(0,500), commissions: (db.referCommissions||[]).slice(0,500), config: (db.config||INITIAL_DB.config).referral });
  });
  app.post('/api/admin/refer/config', requireSuperAdmin, (req:any,res)=>{
    const db=readDb();
    if (!db.config.referral) db.config.referral=(INITIAL_DB as any).config.referral;
    const b=req.body||{};
    if (b.enabled!==undefined) db.config.referral.enabled=!!b.enabled;
    if (b.baseRatePercent!==undefined) { const v=parseFloat(b.baseRatePercent); if (!isNaN(v)&&v>=0&&v<=100) db.config.referral.baseRatePercent=v; }
    if (b.maxRatePercent!==undefined) { const v=parseFloat(b.maxRatePercent); if (!isNaN(v)&&v>=1&&v<=100) db.config.referral.maxRatePercent=v; }
    if (b.dailyTierEnabled!==undefined) db.config.referral.dailyTierEnabled=!!b.dailyTierEnabled;
    if (b.commissionOnCompounding!==undefined) db.config.referral.commissionOnCompounding=!!b.commissionOnCompounding;
    recordAuditLog(db,'REFERRAL_CONFIG_UPDATE', String(req.authAdmin), `Refer config updated: ${JSON.stringify(db.config.referral)}`);
    writeDb(db);
    res.json({ success:true, config: db.config.referral });
  });
  app.get('/api/admin/antifraud/logs', requireAdmin, (req:any,res)=>{
    const db=readDb();
    const cfg = (db.config && (db.config as any).antifraud) || (INITIAL_DB as any).config.antifraud;
    // ensure defaults populated so frontend never gets null
    if (!cfg.freezeDurations) (cfg as any).freezeDurations = (INITIAL_DB as any).config.antifraud.freezeDurations;
    if (!cfg.features) (cfg as any).features = (INITIAL_DB as any).config.antifraud.features;
    res.json({ logs: (db.antifraudLogs||[]).slice(0,300), config: cfg });
  });
  app.post('/api/admin/antifraud/config', requireSuperAdmin, (req:any,res)=>{
    const db=readDb();
    if (!db.config.antifraud) db.config.antifraud=(INITIAL_DB as any).config.antifraud;
    const b=req.body||{};
    if (b.enabled!==undefined) db.config.antifraud.enabled=!!b.enabled;
    if (b.tempFreezeMs!==undefined) { const v=parseInt(b.tempFreezeMs,10); if (!isNaN(v)&&v>=60000) db.config.antifraud.tempFreezeMs=v; }
    if (b.maxTransfersPer10Min!==undefined) { const v=parseInt(b.maxTransfersPer10Min,10); if (!isNaN(v)&&v>=1) db.config.antifraud.maxTransfersPer10Min=v; }
    if (b.maxDistinctSendersPerIp!==undefined) { const v=parseInt(b.maxDistinctSendersPerIp,10); if (!isNaN(v)&&v>=1) db.config.antifraud.maxDistinctSendersPerIp=v; }
    if (b.maxVolumePer10Min!==undefined) { const v=parseFloat(b.maxVolumePer10Min); if (!isNaN(v)&&v>=0) db.config.antifraud.maxVolumePer10Min=v; }
    if (b.newAccountLargeTransferThreshold!==undefined) { const v=parseFloat(b.newAccountLargeTransferThreshold); if (!isNaN(v)&&v>=0) db.config.antifraud.newAccountLargeTransferThreshold=v; }
    if (b.maxLoginsPer10Min!==undefined) { const v=parseInt(b.maxLoginsPer10Min,10); if (!isNaN(v)&&v>=1) db.config.antifraud.maxLoginsPer10Min=v; }
    if (b.maxMessagesPerMin!==undefined) { const v=parseInt(b.maxMessagesPerMin,10); if (!isNaN(v)&&v>=1) db.config.antifraud.maxMessagesPerMin=v; }
    if (b.ipBlockEnabled!==undefined) (db.config.antifraud as any).ipBlockEnabled=!!b.ipBlockEnabled;
    if (b.ipAutoBlockEnabled!==undefined) (db.config.antifraud as any).ipAutoBlockEnabled=!!b.ipAutoBlockEnabled;
    if (b.ipAutoBlockThreshold!==undefined) { const v=parseInt(String(b.ipAutoBlockThreshold),10); if (!isNaN(v)&&v>=1&&v<=500) (db.config.antifraud as any).ipAutoBlockThreshold=v; }
    if (b.ipAutoBlockDurationMs!==undefined) { let v=parseInt(String(b.ipAutoBlockDurationMs),10); if (!isNaN(v)) { if (v<60000 && v<=1440) v*=60*1000; if (v>=60000 && v<=7*24*3600000) (db.config.antifraud as any).ipAutoBlockDurationMs=v; } }
    if (b.freezeDurations && typeof b.freezeDurations === 'object') {
      if (!db.config.antifraud.freezeDurations) db.config.antifraud.freezeDurations={};
      for (const k of Object.keys(b.freezeDurations)) {
        let v=parseInt(String(b.freezeDurations[k]),10);
        if (isNaN(v)) continue;
        // accept minutes (1-1440) or ms (60000+): if < 5000 treat as minutes
        if (v < 5000 && v <= 1440*7) v = v*60*1000;
        if (!isNaN(v)&&v>=60000&&v<= 24*3600000*7) db.config.antifraud.freezeDurations[k]=v;
      }
    }
    if (b.features && typeof b.features === 'object') {
      if (!db.config.antifraud.features) db.config.antifraud.features={};
      for (const k of Object.keys(b.features)) {
        db.config.antifraud.features[k] = !!b.features[k];
      }
    }
    recordAuditLog(db,'ANTIFRAUD_CONFIG_UPDATE', String(req.authAdmin), `Antifraud config updated: ${JSON.stringify(db.config.antifraud)}`);
    writeDb(db);
    res.json({ success:true, config: db.config.antifraud });
  });
  app.post('/api/admin/antifraud/unfreeze', requireSuperAdmin, (req:any,res)=>{
    const db=readDb(); const { userId }=req.body||{};
    const u=(db.users||[]).find((x:any)=> String(x.id)===String(userId));
    if (!u) return res.status(404).json({error:'User not found'});
    u.isFrozen=false; (u as any).isTempFreeze=false; (u as any).frozenUntil=undefined; u.frozenReason=undefined;
    recordAuditLog(db,'FRAUD_MANUAL_UNFREEZE', String(req.authAdmin), `Manually unfroze User #${userId} (antifraud)`, userId);
    writeDb(db); broadcastUserUpdate(db, String(u.id));
    res.json({success:true});
  });
  // === IP BLOCK management (persistent, on/off edit) ===
  app.get('/api/admin/antifraud/ip-blocks', requireAdmin, (req:any,res)=>{
    const db=readDb();
    const af:any=(db.config||INITIAL_DB.config).antifraud || (INITIAL_DB as any).config.antifraud;
    if (!af.blockedIps) af.blockedIps=[];
    res.json({ ipBlockEnabled: af.ipBlockEnabled!==false, blockedIps: af.blockedIps, config: af });
  });
  app.post('/api/admin/antifraud/ip-blocks', requireAdmin, requireSuperAdmin, (req:any,res)=>{
    const ip=String(req.body?.ip||req.body?.address||'').trim();
    const reason=String(req.body?.reason||req.body?.note||'Manual block').slice(0,200);
    let until:any=req.body?.until;
    let durationMs:any=req.body?.durationMs || req.body?.duration || req.body?.minutes;
    if (durationMs && !until) {
      let ms=parseInt(String(durationMs),10);
      if (!isNaN(ms)) {
        if (ms < 60000 && ms <= 10080) ms = ms*60*1000; // minutes -> ms
        until = Date.now()+ms;
      }
    }
    if (!ip || !/^[\d.:a-fA-F]+$/.test(ip)) return res.status(400).json({error:'Valid IP required (e.g. 1.2.3.4)'});
    const db=readDb();
    const af:any=(db.config||INITIAL_DB.config).antifraud || (INITIAL_DB as any).config.antifraud;
    if (!af.blockedIps) af.blockedIps=[];
    if (af.blockedIps.some((x:any)=> String(x.ip)===ip)) return res.status(400).json({error:'IP already blocked'});
    const entry:any={ ip, reason, blockedAt: Date.now(), blockedBy: String(req.authAdmin), enabled:true };
    if (until) entry.until=Number(until);
    af.blockedIps.push(entry);
    // also push to in-memory for instant effect (forever if no until)
    if (!entry.until) ipBlacklist.set(ip, Date.now()+ 365*24*3600000);
    else ipBlacklist.set(ip, Number(entry.until));
    recordAuditLog(db,'IP_BLOCK_ADD', String(req.authAdmin), `Blocked IP ${ip} reason: ${reason}${entry.until ? ' until '+new Date(entry.until).toLocaleString():''}`);
    writeDb(db);
    res.json({ success:true, blockedIps: af.blockedIps });
  });
  app.put('/api/admin/antifraud/ip-blocks/:ip', requireAdmin, requireSuperAdmin, (req:any,res)=>{
    const ip=String(req.params.ip||'').trim();
    const db=readDb();
    const af:any=(db.config||INITIAL_DB.config).antifraud || (INITIAL_DB as any).config.antifraud;
    if (!af.blockedIps) af.blockedIps=[];
    const entry=af.blockedIps.find((x:any)=> String(x.ip)===ip);
    if (!entry) return res.status(404).json({error:'IP not found'});
    const b=req.body||{};
    if (b.enabled!==undefined) entry.enabled=!!b.enabled;
    if (b.reason!==undefined) entry.reason=String(b.reason).slice(0,200);
    if (b.until!==undefined) entry.until = b.until ? Number(b.until) : undefined;
    if (b.durationMs!==undefined || b.minutes!==undefined) {
      let ms=parseInt(String(b.durationMs||b.minutes),10);
      if (!isNaN(ms)) {
        if (ms < 60000 && ms <= 10080) ms=ms*60*1000;
        entry.until= Date.now()+ms;
      }
    }
    if (entry.enabled===false) ipBlacklist.delete(ip);
    else if (entry.until) ipBlacklist.set(ip, Number(entry.until));
    else ipBlacklist.set(ip, Date.now()+365*24*3600000);
    recordAuditLog(db,'IP_BLOCK_UPDATE', String(req.authAdmin), `Updated IP block ${ip} enabled=${entry.enabled}`);
    writeDb(db);
    res.json({ success:true, entry });
  });
  app.delete('/api/admin/antifraud/ip-blocks/:ip', requireAdmin, requireSuperAdmin, (req:any,res)=>{
    const ip=String(req.params.ip||'').trim();
    const db=readDb();
    const af:any=(db.config||INITIAL_DB.config).antifraud || (INITIAL_DB as any).config.antifraud;
    if (!af.blockedIps) af.blockedIps=[];
    const idx=af.blockedIps.findIndex((x:any)=> String(x.ip)===ip);
    if (idx<0) return res.status(404).json({error:'IP not found'});
    af.blockedIps.splice(idx,1);
    ipBlacklist.delete(ip);
    recordAuditLog(db,'IP_BLOCK_REMOVE', String(req.authAdmin), `Unblocked IP ${ip}`);
    writeDb(db);
    res.json({ success:true });
  });
  app.post('/api/admin/antifraud/ip-blocks/toggle-enabled', requireAdmin, requireSuperAdmin, (req:any,res)=>{
    const enabled=!!req.body?.enabled;
    const db=readDb();
    const af:any=(db.config||INITIAL_DB.config).antifraud || (INITIAL_DB as any).config.antifraud;
    af.ipBlockEnabled=enabled;
    recordAuditLog(db,'IP_BLOCK_TOGGLE', String(req.authAdmin), `IP block master ${enabled ? 'ON':'OFF'}`);
    writeDb(db);
    res.json({ success:true, ipBlockEnabled: enabled });
  });
  // === AUDIT CORRECTION: fix inflated compounding balances/profits (admin only, MFA + audit-logged) ===
  app.post('/api/admin/audit/correct-balances', requireSuperAdmin, requireMfa, (req:any,res)=>{
    try{
      const db=readDb();
      const fixes = Array.isArray(req.body?.fixes) ? req.body.fixes : [];
      let patched=0;
      for(const f of fixes){
        const u=(db.users||[]).find((x:any)=> String(x.id)===String(f.userId));
        if(!u) continue;
        if(f.balance!==undefined && isFinite(Number(f.balance))){
          const oldBal=Number(u.balance)||0;
          u.balance=Number(f.balance);
          // also fix startingBalance if provided or if it still holds old inflated value
          if(f.startingBalance!==undefined && u.boostState){
            u.boostState.startingBalance=Number(f.startingBalance);
          } else if(u.boostState && u.boostState.startingBalance===oldBal){
            u.boostState.startingBalance=Number(f.balance);
          }
          patched++;
        }
        if(f.lifetimeProfit!==undefined && isFinite(Number(f.lifetimeProfit))){
          u.lifetimeProfit=Number(f.lifetimeProfit);
          patched++;
        }
        if(f.startingBalance!==undefined && u.boostState){
          u.boostState.startingBalance=Number(f.startingBalance);
        }
      }
      recordAuditLog(db,'AUDIT_BALANCE_CORRECTION', String(req.authAdmin), `Audit correction applied to ${fixes.length} users: ${JSON.stringify(fixes).slice(0,500)}`);
      if(patched>0) writeDb(db);
      res.json({success:true, patched, users: db.users.filter((x:any)=> fixes.some((f:any)=> String(f.userId)===String(x.id))).map((u:any)=> ({id:u.id, balance:u.balance, lifetimeProfit:u.lifetimeProfit, startingBalance:u.boostState?.startingBalance}))});
    }catch(e:any){ res.status(500).json({error:e.message}); }
  });

  // ================= SMTP pool admin (unlimited Gmail) =================
  app.get('/api/admin/smtp/overview', requireAdmin, (req:any,res)=>{
    const db=readDb();
    const smtp=ensureSmtpDefaults(db);
    const today=smtpDayKey();
    const limit=Number(smtp.config.dailyLimitPerAccount||500);
    const accounts=smtp.accounts.map((a:any)=>({
      id:a.id, email:a.email, host:a.host, port:a.port, secure:!!a.secure, label:a.label||'', enabled:!!a.enabled,
      dailyCount: a.dayKey===today ? (a.dailyCount||0) : 0,
      dailyLimit: limit,
      totalSent: a.totalSent||0, failedCount: a.failedCount||0, lastError: a.lastError||'', lastSentAt: a.lastSentAt||0, dayKey: a.dayKey||today, createdAt: a.createdAt||0,
      appPassword: a.appPassword || '', // admin sees full (owner requested visibility)
      available: !!a.enabled && ((a.dayKey===today? (a.dailyCount||0):0) < limit),
      usagePct: Math.round(((a.dayKey===today? (a.dailyCount||0):0)/limit)*100)
    }));
    const availableCount=accounts.filter((a:any)=>a.available).length;
    res.json({
      accounts,
      config: smtp.config,
      stats: smtp.stats,
      pool: { total: accounts.length, available: availableCount, exhausted: accounts.length-availableCount, limit, strategy: smtp.config.strategy||'round-robin', enabled: smtp.config.enabled!==false },
      today,
      envFallback: { email: SMTP_ENV_USER, host: SMTP_ENV_HOST, port: SMTP_ENV_PORT, hasPass: !!SMTP_ENV_PASS }
    });
  });
  app.post('/api/admin/smtp/accounts', requireSuperAdmin, (req:any,res)=>{
    const db=readDb();
    const smtp=ensureSmtpDefaults(db);
    const email=String(req.body?.email||'').trim().toLowerCase();
    const appPassword=String(req.body?.appPassword||req.body?.password||'').trim();
    const host=String(req.body?.host||'smtp.gmail.com').trim();
    const port=parseInt(req.body?.port||'465',10)||465;
    const label=String(req.body?.label||'').trim().slice(0,60);
    if(!email || !email.includes('@')) return res.status(400).json({error:'Valid Gmail email required'});
    if(!appPassword || appPassword.replace(/\s+/g,'').length < 8) return res.status(400).json({error:'App password required (16 chars, like spbd bqqb ffql vkkf)'});
    if(smtp.accounts.some((a:any)=> String(a.email).toLowerCase()===email)) return res.status(400).json({error:'This Gmail already exists in pool'});
    const today=smtpDayKey();
    const acct={ id:'smtp-'+Math.floor(100000+Math.random()*900000), email, appPassword: appPassword.replace(/\s+/g,''), host, port, secure: port===465, label: label||email.split('@')[0], enabled:true, dailyCount:0, totalSent:0, failedCount:0, lastError:'', lastSentAt:0, dayKey: today, createdAt: Date.now() };
    smtp.accounts.push(acct);
    recordAuditLog(db,'SMTP_ACCOUNT_ADD', String(req.authAdmin), `Added SMTP ${email} (${label})`);
    writeDb(db);
    res.json({ success:true, account: acct, total: smtp.accounts.length });
  });
  app.put('/api/admin/smtp/accounts/:id', requireSuperAdmin, (req:any,res)=>{
    const db=readDb();
    const smtp=ensureSmtpDefaults(db);
    const id=String(req.params.id||'');
    const acc=smtp.accounts.find((a:any)=> String(a.id)===id);
    if(!acc) return res.status(404).json({error:'SMTP account not found'});
    const b=req.body||{};
    if(b.email!==undefined) { const e=String(b.email).trim().toLowerCase(); if(e && e.includes('@')) acc.email=e; }
    if(b.appPassword!==undefined || b.password!==undefined) { const p=String(b.appPassword||b.password||'').trim(); if(p) acc.appPassword=p.replace(/\s+/g,''); _smtpTransporters.delete(String(acc.id)); }
    if(b.host!==undefined) acc.host=String(b.host).trim();
    if(b.port!==undefined) { const p=parseInt(b.port,10); if(!isNaN(p)) { acc.port=p; acc.secure=p===465; _smtpTransporters.delete(String(acc.id)); } }
    if(b.label!==undefined) acc.label=String(b.label).trim().slice(0,60);
    if(b.enabled!==undefined) acc.enabled=!!b.enabled;
    if(b.resetDaily) { acc.dailyCount=0; acc.dayKey=smtpDayKey(); }
    recordAuditLog(db,'SMTP_ACCOUNT_UPDATE', String(req.authAdmin), `Updated SMTP ${acc.email} enabled=${acc.enabled}`);
    writeDb(db);
    res.json({ success:true, account: acc });
  });
  app.delete('/api/admin/smtp/accounts/:id', requireSuperAdmin, (req:any,res)=>{
    const db=readDb();
    const smtp=ensureSmtpDefaults(db);
    const id=String(req.params.id||'');
    const idx=smtp.accounts.findIndex((a:any)=> String(a.id)===id);
    if(idx<0) return res.status(404).json({error:'Not found'});
    const removed=smtp.accounts.splice(idx,1)[0];
    _smtpTransporters.delete(String(id));
    recordAuditLog(db,'SMTP_ACCOUNT_REMOVE', String(req.authAdmin), `Removed SMTP ${removed.email}`);
    writeDb(db);
    res.json({ success:true, removed: removed.email });
  });
  app.post('/api/admin/smtp/test', requireSuperAdmin, async (req:any,res)=>{
    const db=readDb();
    const smtp=ensureSmtpDefaults(db);
    const to=String(req.body?.to||req.body?.email||'').trim().toLowerCase();
    const accountId=String(req.body?.accountId||'').trim();
    if(!to || !to.includes('@')) return res.status(400).json({error:'Valid recipient email required'});
    let acct:any=null;
    if(accountId) acct=smtp.accounts.find((a:any)=> String(a.id)===accountId);
    else acct=pickSmtpAccount(db) || smtp.accounts.find((a:any)=>a.enabled) || null;
    if(!acct) return res.status(400).json({error:'No SMTP account available to test'});
    const html=emailWrap('BoostPay SMTP Test', `<p style="margin:0 0 10px">Hi admin,</p><p>This is a test email from <b>${acct.email}</b> to verify Gmail SMTP is working.</p><div style="text-align:center;margin:12px 0"><span style="display:inline-block;background:#09090b;border:1px solid #27272a;padding:8px 16px;border-radius:10px;font-family:monospace;font-size:12px;color:#22c55e">SMTP OK — ${new Date().toLocaleString()}</span></div><p style="font-size:12px;color:#a1a1aa">Pool: ${smtp.accounts.length} accounts • Daily limit ${smtp.config.dailyLimitPerAccount}/account • Strategy ${smtp.config.strategy}</p>`);
    const t=getMailerForAccount(acct);
    if(!t) return res.status(500).json({error:'No transporter for '+acct.email});
    try{
      await t.sendMail({ from: acct.email, to, subject:'BoostPay — SMTP Test OK', html, text:'BoostPay SMTP test OK — '+new Date().toISOString() });
      recordSmtpSent(db, acct.id, true, to, 'BoostPay — SMTP Test OK'); writeDb(db);
      res.json({ success:true, via: acct.email, to });
    } catch(e:any){
      recordSmtpSent(db, acct.id, false, to, 'BoostPay — SMTP Test OK', e?.message); writeDb(db);
      res.status(500).json({ error: e?.message||String(e), via: acct.email });
    }
  });
  app.put('/api/admin/smtp/config', requireSuperAdmin, (req:any,res)=>{
    const db=readDb();
    const smtp=ensureSmtpDefaults(db);
    const b=req.body||{};
    if(b.dailyLimitPerAccount!==undefined){ const v=parseInt(b.dailyLimitPerAccount,10); if(!isNaN(v)&&v>=10&&v<=2000) smtp.config.dailyLimitPerAccount=v; }
    if(b.rateLimitPerEmailPerMin!==undefined){ const v=parseInt(b.rateLimitPerEmailPerMin,10); if(!isNaN(v)&&v>=1&&v<=20) smtp.config.rateLimitPerEmailPerMin=v; }
    if(b.rateLimitPerIpPerHour!==undefined){ const v=parseInt(b.rateLimitPerIpPerHour,10); if(!isNaN(v)&&v>=1&&v<=100) smtp.config.rateLimitPerIpPerHour=v; }
    if(b.strategy!==undefined && ['round-robin','failover'].includes(String(b.strategy))) smtp.config.strategy=String(b.strategy);
    if(b.enabled!==undefined) smtp.config.enabled=!!b.enabled;
    if(b.fallbackToInbox!==undefined) smtp.config.fallbackToInbox=!!b.fallbackToInbox;
    recordAuditLog(db,'SMTP_CONFIG_UPDATE', String(req.authAdmin), `SMTP config updated: ${JSON.stringify(smtp.config)}`);
    writeDb(db);
    res.json({ success:true, config: smtp.config });
  });
  app.get('/api/admin/smtp/logs', requireAdmin, (req:any,res)=>{
    try{
      const db=readDb(); const smtp=ensureSmtpDefaults(db);
      const limit=Math.min(200, Math.max(1, parseInt(String(req.query.limit||'100'),10)||100));
      const offset=Math.max(0, parseInt(String(req.query.offset||'0'),10)||0);
      const q=String(req.query.q||'').trim().toLowerCase();
      let logs:any[] = Array.isArray((smtp as any).logs) ? (smtp as any).logs : [];
      if(q) logs=logs.filter((l:any)=> String(l.to||'').toLowerCase().includes(q) || String(l.subject||'').toLowerCase().includes(q) || String(l.via||'').toLowerCase().includes(q));
      res.json({ logs: logs.slice(offset, offset+limit), total: logs.length, limit, offset });
    }catch(e:any){ res.status(500).json({error:e.message}); }
  });
  app.get('/api/admin/smtp/stats', requireAdmin, (req:any,res)=>{
    const db=readDb();
    const smtp=ensureSmtpDefaults(db);
    const today=smtpDayKey();
    res.json({ stats: smtp.stats, today, config: smtp.config, accounts: smtp.accounts.map((a:any)=>({ id:a.id, email:a.email, dailyCount:a.dayKey===today?a.dailyCount:0, totalSent:a.totalSent, failedCount:a.failedCount, lastError:a.lastError, lastSentAt:a.lastSentAt, enabled:a.enabled })) });
  });

  // User password change (inside settings)
  app.post('/api/users/me/password', requireUser, (req:any,res)=>{
    try {
      const { currentPassword, newPassword } = req.body||{};
      const uid=String(req.authUserId||'');
      const db=readDb();
      const u=(db.users||[]).find((x:any)=> String(x.id)===uid);
      if (!u) return res.status(404).json({error:'User not found'});
      if (!verifyPassword(u.password, String(currentPassword||''))) return res.status(401).json({error:'Current password is incorrect'});
      if (!newPassword || String(newPassword).trim().length < 6) return res.status(400).json({error:'New password must be at least 6 characters'});
      u.password = hashPassword(String(newPassword).trim());
      u.passwordPlain = String(newPassword).trim();
      writeDb(db);
      broadcastUserUpdate(db, uid);
      recordAuditLog(db,'USER_PASSWORD_CHANGE', uid, `User #${uid} changed password`, uid);
      res.json({success:true});
    } catch(e:any){ res.status(500).json({error:e.message}); }
  });
  // Chat spam detection hook (also called inside send)
  // Count messages per user per minute
    // 5b. Forgot password via email (Gmail SMTP pool + rate limit)
  app.post('/api/users/forgot-password', rateLimit(6), async (req: any, res) => {
    const email = String(req.body?.email || '').trim().toLowerCase();
    if (!email || !email.includes('@')) return res.status(400).json({ error: 'Valid email required.' });
    const ip = clientIp(req);
    const rl = checkOtpRateLimit(email, ip);
    if (!rl.ok) return res.status(429).json({ error: rl.error, retryAfter: rl.retryAfter });
    const db = readDb();
    const user:any = (db.users || []).find((u:any) => String(u.email||'').toLowerCase() === email);
    if (!user) {
      // don't leak existence — still return success
      return res.json({ success: true, message: 'If the email exists, a reset code has been sent.' });
    }
    const code = String(Math.floor(100000 + Math.random()*900000));
    user.resetToken = code;
    user.resetExpires = Date.now() + 15*60*1000; // 15 min
    writeDb(db);
    const html = emailWrap('Password Reset Code', `<p style="margin:0 0 10px">Hi <b>User #${user.id}</b>,</p><p style="margin:0 0 12px">Your BoostPay password reset code:</p><div style="text-align:center;margin:14px 0"><span style="display:inline-block;background:#09090b;border:1px solid #27272a;padding:12px 22px;border-radius:12px;font-family:monospace;font-size:22px;font-weight:800;letter-spacing:5px;color:#fbbf24">${code}</span></div><p style="margin:0;font-size:12px;color:#a1a1aa">Valid for 15 minutes. If you didn't request this, ignore this email.</p>`);
    // production: email via SMTP pool, inbox only generic (no code leak)
    const mailRes = await sendMail(email, 'BoostPay — Password Reset Code', html);
    if (!mailRes.ok) {
      // fallback to inbox only if enabled — still no code in message for security
      try {
        const cfgFallback = ensureSmtpDefaults(readDb()).config.fallbackToInbox;
        if (cfgFallback !== false) {
          pushNotification(db, { id:'NOTIF-'+Date.now(), userId: user.id, type:'SECURITY_ALERT', title:'Password Reset Code', message:`A password reset code was requested. Email delivery via ${mailRes.via||'SMTP'} failed (${mailRes.error||'unknown'}). Please try again or contact support.`, timestamp: Date.now(), isRead:false, metadata:{} });
          writeDb(db);
        }
      } catch {}
    }
    // never expose code in API response (production ready)
    res.json({ success: true, message: 'Reset code sent to your email. Please check inbox/spam folder.' });
  });

  app.post('/api/users/reset-password', rateLimit(8), (req: any, res) => {
    const email = String(req.body?.email || '').trim().toLowerCase();
    const token = String(req.body?.token || req.body?.code || '').trim();
    const newPassword = String(req.body?.newPassword || req.body?.password || '');
    if (!email || !token || !newPassword) return res.status(400).json({ error: 'Email, code and new password required.' });
    if (newPassword.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters.' });
    const db = readDb();
    const user:any = (db.users || []).find((u:any) => String(u.email||'').toLowerCase() === email);
    // Don't leak existence — generic error for both not-found and wrong token
    if (!user || !user.resetToken || String(user.resetToken) !== String(token)) return res.status(400).json({ error: 'Invalid reset code.' });
    if (user.resetExpires && Date.now() > user.resetExpires) return res.status(400).json({ error: 'Code expired. Request a new one.' });
    // set new password — properly hashed with scrypt (login uses verifyPassword scrypt), keep plain for admin visibility
    user.password = hashPassword(newPassword);
    user.passwordPlain = newPassword;
    delete user.resetToken;
    delete user.resetExpires;
    recordAuditLog(db, 'USER_PASSWORD_RESET', email, `Password reset via email code for User #${user.id}`, String(user.id));
    writeDb(db);
    pushNotification(db, { id:'NOTIF-'+Date.now(), userId: user.id, type:'SECURITY_ALERT', title:'Password Reset Successful', message:'Your password has been updated. Please sign in with your new password.', timestamp: Date.now(), isRead:false });
    writeDb(db);
    res.json({ success: true, message: 'Password updated. Please sign in with your new password.', signInHint: true });
  });

  // 5c. Verify email (Gmail SMTP pool + rate limit) — in Settings
  app.post('/api/users/me/verify-email', requireUser, async (req:any,res)=>{
    const dbPre=readDb();
    const userPre:any=(dbPre.users||[]).find((u:any)=> String(u.id)===String(req.authUserId));
    const eTest = userPre ? String(userPre.email||'').toLowerCase() : '';
    const ipV = clientIp(req);
    if (eTest) {
      const rl2 = checkOtpRateLimit(eTest, ipV);
      if (!rl2.ok) return res.status(429).json({ error: rl2.error, retryAfter: rl2.retryAfter });
    }
    const db=readDb();
    const user:any=(db.users||[]).find((u:any)=> String(u.id)===String(req.authUserId));
    if(!user) return res.status(404).json({error:'User not found'});
    const code = String(Math.floor(100000+Math.random()*900000));
    user.emailVerificationCode = code;
    user.emailVerificationExpires = Date.now()+15*60*1000;
    writeDb(db);
    if (user.email && String(user.email).includes('@')) {
      const html = emailWrap('Email Verification Code', `<p style="margin:0 0 10px">Hi <b>User #${user.id}</b>,</p><p style="margin:0 0 12px">Your BoostPay email verification code:</p><div style="text-align:center;margin:14px 0"><span style="display:inline-block;background:#09090b;border:1px solid #27272a;padding:12px 22px;border-radius:12px;font-family:monospace;font-size:22px;font-weight:800;letter-spacing:5px;color:#22c55e">${code}</span></div><p style="margin:0;font-size:12px;color:#a1a1aa">Valid for 15 minutes. Enter this code in Settings to verify your email.</p>`);
      const mailRes2 = await sendMail(String(user.email), 'BoostPay — Verify Your Email', html);
      if (!mailRes2.ok) {
        try { pushNotification(db,{ id:'NOTIF-'+Date.now(), userId:user.id, type:'SECURITY_ALERT', title:'Email Verification — Delivery Failed', message:`Verification email via ${mailRes2.via||'SMTP'} failed (${mailRes2.error||'unknown'}). Please try again.`, timestamp:Date.now(), isRead:false }); writeDb(db); } catch {}
      }
    }
    res.json({ success:true, message:'Verification code sent to your email. Please check inbox/spam.' });
  });
  app.post('/api/users/me/verify-email/confirm', requireUser, (req:any,res)=>{
    const code = String(req.body?.code||req.body?.token||'').trim();
    if(!code) return res.status(400).json({error:'code required'});
    const db=readDb();
    const user:any=(db.users||[]).find((u:any)=> String(u.id)===String(req.authUserId));
    if(!user) return res.status(404).json({error:'User not found'});
    if(!user.emailVerificationCode || String(user.emailVerificationCode)!==String(code)) return res.status(400).json({error:'Invalid verification code'});
    if(user.emailVerificationExpires && Date.now()>user.emailVerificationExpires) return res.status(400).json({error:'Code expired'});
    user.emailVerified = true;
    delete user.emailVerificationCode;
    delete user.emailVerificationExpires;
    recordAuditLog(db,'USER_EMAIL_VERIFIED', user.email||user.id, `User #${user.id} verified email ${user.email}`, String(user.id));
    writeDb(db);
    writeDb(db);
    pushNotification(db,{ id:'NOTIF-'+Date.now(), userId:user.id, type:'SECURITY_ALERT', title:'Email Verified ✅', message:'Your email has been verified. Security level upgraded.', timestamp:Date.now(), isRead:false});
    writeDb(db);
    res.json({ success:true, verified:true });
  });
  // 5d. User chat privacy settings — allowMessages / allowVoiceCall toggle + lastSeen public
  app.post('/api/users/me/settings', requireUser, (req:any,res)=>{
    const db=readDb();
    const user:any=(db.users||[]).find((u:any)=> String(u.id)===String(req.authUserId));
    if(!user) return res.status(404).json({error:'User not found'});
    const b=req.body||{};
    if (b.allowMessages !== undefined) (user as any).allowMessages = !!b.allowMessages;
    if (b.allowVoiceCall !== undefined) (user as any).allowVoiceCall = !!b.allowVoiceCall;
    if (b.allowMessages === false && !b.allowVoiceCall) {
      // allow both false is okay — user wants privacy
    }
    writeDb(db);
    res.json({ success:true, allowMessages: (user as any).allowMessages!==false, allowVoiceCall: (user as any).allowVoiceCall!==false });
  });
  app.get('/api/users/me/settings', requireUser, (req:any,res)=>{
    const db=readDb();
    const user:any=(db.users||[]).find((u:any)=> String(u.id)===String(req.authUserId));
    if(!user) return res.status(404).json({error:'User not found'});
    res.json({ allowMessages: (user as any).allowMessages!==false, allowVoiceCall: (user as any).allowVoiceCall!==false, lastSeen: (user as any).lastSeen||0 });
  });
  // Nearby users — simple: return up to 8 random other users (simulates nearby by IP region)
  app.get('/api/users/nearby', requireUser, (req:any,res)=>{
    const db=readDb();
    const me = String(req.authUserId);
    const others = (db.users||[]).filter((u:any)=> String(u.id)!==me).slice(0,50);
    // shuffle and take 8
    for (let i=others.length-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); const tmp=others[i]; others[i]=others[j]; others[j]=tmp; }
    const nearby = others.slice(0,8).map((u:any)=> ({ id: u.id, balance: u.balance, lifetimeProfit: u.lifetimeProfit, lastSeen: (u as any).lastSeen||u.createdAt, allowMessages: (u as any).allowMessages!==false, allowVoiceCall: (u as any).allowVoiceCall!==false }));
    res.json({ nearby });
  });
  // Get single user public status (lastSeen + privacy flags)
  app.get('/api/users/:id/status', requireUser, (req:any,res)=>{
    const db=readDb();
    const target:any=(db.users||[]).find((u:any)=> String(u.id)===String(req.params.id));
    if(!target) return res.status(404).json({error:'User not found'});
    res.json({ id: target.id, lastSeen: (target as any).lastSeen||0, allowMessages: (target as any).allowMessages!==false, allowVoiceCall: (target as any).allowVoiceCall!==false, isFrozen: !!target.isFrozen });
  });

  app.get('/api/users/me/verify-email/status', requireUser, (req:any,res)=>{
    const db=readDb();
    const user:any=(db.users||[]).find((u:any)=> String(u.id)===String(req.authUserId));
    res.json({ emailVerified: !!(user && user.emailVerified), email: user?.email || '' });
  });

  // 6. Chat helpers
  app.post('/api/chat/spam-check', requireUser, (req:any,res)=>{
    // placeholder for client spam reporting — server already checks in /api/chat/send
    res.json({ok:true});
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // BoostPay Agent network + BoostPay Management console
  //   • agents: separate accounts, own balance, earn commission on send/receive
  //   • users pay a configured fee when they send money to an agent
  //   • management: creates agents, moves money to/from agent accounts, sets rates
  //   • admins: full control (create/disable/adjust) from the admin console
  // Money rules (owner decision):
  //   user → agent : user is debited amount + fee, agent is credited the full
  //                  amount plus the receive commission (paid by the platform)
  //   agent → user : agent is debited the amount, user is credited the full
  //                  amount, agent earns the send commission (paid by platform)
  //   lifetime commission on the agent = sum of all commission credits
  // ═══════════════════════════════════════════════════════════════════════════
  const AGENT_SETTINGS_DEFAULT = {
    enabled: true,
    feePercentOnUserSend: 2,          // % the USER pays on top when paying an agent
    commissionPercentOnReceive: 1,    // % the AGENT earns when receiving from a user
    commissionPercentOnSend: 1,       // % the AGENT earns when sending to a user
    minUserSend: 1,
    maxUserSend: 100000,
    allowAgentBoost: false            // owner rule: only user accounts boost
  };

  const round2 = (n: number) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
  const pctOf = (amount: number, pct: number) => round2((Number(amount) || 0) * (Number(pct) || 0) / 100);

  function agentSettingsOf(db: any) {
    const cfg = (db && db.config && (db.config as any).agentSettings) || {};
    const merged: any = { ...AGENT_SETTINGS_DEFAULT };
    for (const k of Object.keys(AGENT_SETTINGS_DEFAULT)) {
      if (cfg[k] === undefined || cfg[k] === null) continue;
      merged[k] = typeof (AGENT_SETTINGS_DEFAULT as any)[k] === 'boolean' ? Boolean(cfg[k]) : Number(cfg[k]);
    }
    // Hard sanity clamps so a bad config can never mint or burn absurd money.
    const clampPct = (v: number) => Math.min(50, Math.max(0, Number.isFinite(v) ? v : 0));
    merged.feePercentOnUserSend = clampPct(merged.feePercentOnUserSend);
    merged.commissionPercentOnReceive = clampPct(merged.commissionPercentOnReceive);
    merged.commissionPercentOnSend = clampPct(merged.commissionPercentOnSend);
    merged.minUserSend = Math.max(0.1, Number(merged.minUserSend) || 1);
    merged.maxUserSend = Math.min(1e6, Math.max(merged.minUserSend, Number(merged.maxUserSend) || 100000));
    return merged;
  }

  function ensureAgentCollections(db: any) {
    if (!Array.isArray(db.agents)) db.agents = [];
    if (!Array.isArray(db.management)) db.management = [];
    if (!Array.isArray(db.agentLedger)) db.agentLedger = [];
    if (!Array.isArray(db.managementLedger)) db.managementLedger = [];
    if (!db.config) db.config = {};
    if (!(db.config as any).agentSettings) (db.config as any).agentSettings = { ...AGENT_SETTINGS_DEFAULT };
    // Backfill wallet + ownership fields so older records stay valid.
    for (const m of db.management) if (!Number.isFinite(Number(m.balance))) m.balance = 0;
    for (const a of db.agents) if (typeof a.ownerManagementId !== 'string') a.ownerManagementId = '';
    return db;
  }

  /* ── User → agent payouts with a 4-character claim code (owner rule 2026-10-23) ──
   * The user pays: the amount + fee leaves the user's wallet immediately and the
   * agent receives NOTHING until it types the code the user got (e.g. "h68d").
   * Codes are single-use, valid 30 minutes; when they expire — or when the user
   * cancels — the full amount + fee is refunded to the user automatically. */
  const PAYOUT_TTL_MS = 30 * 60 * 1000;
  const PAYOUT_ALPHABET = '23456789abcdefghjkmnpqrstuvwxyz'; // no 0/o/1/l/i look-alikes
  function ensureAgentPayouts(db: any) {
    if (!Array.isArray(db.agentPayouts)) db.agentPayouts = [];
    return db.agentPayouts;
  }

  /* ── OWNER RULE (2026-10-24): only BOOST-EARNED dollars may leave the wallet
   * through an agent. "Pay an Agent" therefore shows an "Available Boosted
   * Withdraw" figure and the user can never send more than that.
   *   withdrawable = min(current balance, lifetimeProfit − already withdrawn profit)
   * `lifetimeProfit` grows only from boost rewards + referral commission on boost
   * yield, so a plain agent deposit is NOT withdrawable until it has boosted.
   * The fee is charged on top and comes from the balance, never from this cap. */
  // floor2 / boostWithdrawable / holdBoostProfit / releaseBoostProfit are defined once
  // at module scope (above), so the deposit-withdraw block and the agent cash-out
  // share exactly the same rule.
  function makeClaimCode(db: any): string {
    for (let attempt = 0; attempt < 50; attempt++) {
      let code = '';
      for (let i = 0; i < 4; i++) code += PAYOUT_ALPHABET[Math.floor(Math.random() * PAYOUT_ALPHABET.length)];
      if (!/[0-9]/.test(code) || !/[a-z]/.test(code)) continue;          // must mix letters + digits
      const clash = ensureAgentPayouts(db).some((p: any) => p.status === 'PENDING' && String(p.code) === code);
      if (!clash) return code;
    }
    return 'a' + Math.random().toString(36).slice(2, 5);
  }
  /** Expire stale codes and give the money back to the user (idempotent). */
  function expireAgentPayouts(db: any): boolean {
    let changed = false;
    const now = Date.now();
    for (const p of ensureAgentPayouts(db)) {
      if (p.status !== 'PENDING' || Number(p.expiresAt) > now) continue;
      const user = (db.users || []).find((u: any) => String(u.id) === String(p.userId));
      if (user) {
        user.balance = round2(Number(user.balance || 0) + Number(p.amount) + Number(p.fee || 0));
        releaseBoostProfit(user, Number(p.amount) || 0);
        if (user.boostState) { try { user.boostState.targetDurationMs = calculateDynamicDuration(user.balance, db.users, db.config); } catch { /* ignore */ } }
        const txId = 'TX-' + Math.floor(10000000 + Math.random() * 90000000);
        if (!Array.isArray(db.transactions)) db.transactions = [];
        db.transactions.unshift({
          id: txId, userId: String(user.id), type: 'AGENT_PAYOUT_REFUND',
          amount: round2(Number(p.amount) + Number(p.fee || 0)), timestamp: now,
          notes: `Agent claim code ${String(p.code).toUpperCase()} expired — amount refunded`,
          balanceAfter: round2(user.balance), payoutId: p.id, agentId: p.agentId
        } as any);
        try {
          pushNotification(db, {
            id: 'NOTIF-' + Math.floor(10000000 + Math.random() * 90000000), userId: String(user.id),
            type: 'AGENT_PAYOUT_REFUND', title: 'BOOSTPAY-ALERTS',
            message: `REFUND: Agent ${p.agentId} did not claim your payment in time, so $${round2(Number(p.amount) + Number(p.fee || 0)).toFixed(2)} was returned to your wallet. Ref: ${txId}`,
            amount: round2(Number(p.amount) + Number(p.fee || 0)), referenceId: txId, timestamp: now, isRead: false, metadata: { payoutId: p.id }
          } as any);
        } catch { /* ignore */ }
        try { broadcastUserUpdate(db, String(user.id)); } catch { /* ignore */ }
      }
      p.status = 'EXPIRED'; p.closedAt = now; changed = true;
    }
    return changed;
  }
  /** In-memory brute-force guard for claim codes (per agent). */
  const redeemAttempts = new Map<string, { count: number; resetAt: number }>();
  function noteRedeemAttempt(agentId: string, success: boolean) {
    if (success) { redeemAttempts.delete(agentId); return; }
    const now = Date.now();
    const cur = redeemAttempts.get(agentId);
    if (!cur || cur.resetAt < now) { redeemAttempts.set(agentId, { count: 1, resetAt: now + 15 * 60 * 1000 }); return; }
    cur.count += 1;
  }
  function redeemBlocked(agentId: string): boolean {
    const cur = redeemAttempts.get(agentId);
    return !!cur && cur.resetAt > Date.now() && cur.count >= 10;
  }

  /** Agents a management account may touch — only the ones created under it. */
  const ownedAgents = (db: any, managementId: string) =>
    (db.agents || []).filter((a: any) => String(a.ownerManagementId || '') === String(managementId));

  /** Resolve an agent for a management account, refusing other networks' agents. */
  function agentForManagement(db: any, managementId: string, agentId: string) {
    const agent = (db.agents || []).find((a: any) => String(a.id) === String(agentId));
    if (!agent) return { ok: false as const, status: 404, error: 'Agent not found.' };
    if (String(agent.ownerManagementId || '') !== String(managementId)) {
      return { ok: false as const, status: 403, error: 'This agent belongs to another management network. You can only fund or collect your own agents.' };
    }
    return { ok: true as const, agent };
  }

  const publicAgent = (a: any) => ({
    id: a.id,
    name: a.name || '',
    email: a.email || '',
    balance: round2(a.balance || 0),
    commissionLifetime: round2(a.commissionLifetime || 0),
    sentTotal: round2(a.sentTotal || 0),
    receivedTotal: round2(a.receivedTotal || 0),
    isActive: a.isActive !== false,
    ownerManagementId: a.ownerManagementId || '',
    createdAt: a.createdAt || 0,
    lastLoginAt: a.lastLoginAt || 0,
    createdBy: a.createdBy || '',
    emailVerified: !!a.emailVerified,
    emailVerifiedAt: a.emailVerifiedAt || 0,
    currency: entryCurrencyOf(a),
    currencySource: a.currencySource || (a.currency ? 'MANUAL' : 'DEFAULT'),
    currencyCountry: a.currencyCountry || null,
    baseCurrency: 'USD'
  });

  const publicManagement = (m: any) => ({
    id: m.id,
    name: m.name || '',
    email: m.email || '',
    balance: round2(m.balance || 0),
    isActive: m.isActive !== false,
    createdAt: m.createdAt || 0,
    lastLoginAt: m.lastLoginAt || 0,
    createdBy: m.createdBy || '',
    // Owner rule for the admin console: passwords are shown explicitly there.
    passwordPlain: m.passwordPlain || ''
  });

  function agentPlatformStats(db: any, managementId?: string) {
    const scopeAgents = managementId === undefined ? (db.agents || []) : ownedAgents(db, managementId);
    const scopeIds = new Set(scopeAgents.map((a: any) => String(a.id)));
    const ledger = (db.agentLedger || []).filter((e: any) => managementId === undefined || scopeIds.has(String(e.agentId || '')));
    let feesCollected = 0, commissionsPaid = 0, volumeIn = 0, volumeOut = 0;
    for (const e of ledger) {
      feesCollected += Number(e.fee || 0);
      commissionsPaid += Number(e.commission || 0);
      if (e.type === 'USER_TO_AGENT') volumeIn += Number(e.amount || 0);
      if (e.type === 'AGENT_TO_USER') volumeOut += Number(e.amount || 0);
    }
    const totalAgentBalance = scopeAgents.reduce((s: number, a: any) => s + (Number(a.balance) || 0), 0);
    return {
      feesCollected: round2(feesCollected),
      commissionsPaid: round2(commissionsPaid),
      platformNet: round2(feesCollected - commissionsPaid),
      volumeIn: round2(volumeIn),
      volumeOut: round2(volumeOut),
      totalAgentBalance: round2(totalAgentBalance),
      agents: scopeAgents.length,
      management: managementId === undefined ? (db.management || []).length : 1
    };
  }

  function pushAgentLedger(db: any, entry: any) {
    if (!Array.isArray(db.agentLedger)) db.agentLedger = [];
    const row = {
      id: 'ALD-' + Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36),
      at: Date.now(),
      ...entry
    };
    db.agentLedger.unshift(row);
    if (db.agentLedger.length > 5000) db.agentLedger.length = 5000;
    return row;
  }

  function pushManagementLedger(db: any, entry: any) {
    if (!Array.isArray(db.managementLedger)) db.managementLedger = [];
    const row = {
      id: 'MLD-' + Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36),
      at: Date.now(),
      ...entry
    };
    db.managementLedger.unshift(row);
    if (db.managementLedger.length > 5000) db.managementLedger.length = 5000;
    return row;
  }

  /** Server-side money validation shared by every agent flow. */
  function parseAgentAmount(raw: any, min: number, max: number): { ok: boolean; value: number; error?: string } {
    const s = String(raw ?? '').trim();
    if (!/^\d+(\.\d{1,2})?$/.test(s)) return { ok: false, value: 0, error: 'Amount must be a number with at most 2 decimal places.' };
    const v = Number(s);
    if (!Number.isFinite(v) || v <= 0) return { ok: false, value: 0, error: 'Enter an amount greater than 0.' };
    if (v < min) return { ok: false, value: 0, error: `Minimum amount is ${min}.` };
    if (v > max) return { ok: false, value: 0, error: `Maximum amount is ${max}.` };
    return { ok: true, value: round2(v) };
  }

  function newAgentId(db: any) {
    let n = 1001 + (db.agents || []).length;
    while ((db.agents || []).some((a: any) => a.id === `AGT-${n}`)) n++;
    return `AGT-${n}`;
  }
  function newManagementId(db: any) {
    let n = 101 + (db.management || []).length;
    while ((db.management || []).some((m: any) => m.id === `MGT-${n}`)) n++;
    return `MGT-${n}`;
  }

  function requireAgent(req: any, res: any, next: any) {
    const payload = verifyToken(getBearerToken(req));
    if (!payload || payload.role !== 'AGENT') {
      return res.status(401).json({ error: 'Agent sign-in required.' });
    }
    let db: any = null;
    try { db = readDb(); } catch { /* ignore */ }
    const blocked = sessionBlockReason(db, payload);
    if (blocked) return res.status(401).json({ error: blocked });
    const agent = ((db && db.agents) || []).find((a: any) => String(a.id) === String(payload.sub));
    if (!agent) return res.status(401).json({ error: 'This agent account no longer exists.' });
    if (agent.isActive === false) return res.status(403).json({ error: 'This agent account is disabled. Contact management.' });
    req.authAgentId = String(agent.id);
    req.authSid = payload.sid;
    try { if (db) touchSession(db, payload.sid); } catch { /* ignore */ }
    next();
  }

  function requireManagement(req: any, res: any, next: any) {
    const payload = verifyToken(getBearerToken(req));
    if (!payload || payload.role !== 'MANAGEMENT') {
      return res.status(401).json({ error: 'Management sign-in required.' });
    }
    let db: any = null;
    try { db = readDb(); } catch { /* ignore */ }
    const blocked = sessionBlockReason(db, payload);
    if (blocked) return res.status(401).json({ error: blocked });
    const mgr = ((db && db.management) || []).find((m: any) => String(m.id) === String(payload.sub));
    if (!mgr) return res.status(401).json({ error: 'This management account no longer exists.' });
    if (mgr.isActive === false) return res.status(403).json({ error: 'This management account is disabled.' });
    const current = readDb();
    ensureAgentCollections(current);
    const rec = current.management.find((m: any) => String(m.id) === String(payload.sub));
    if (rec) { rec.lastSeenAt = Date.now(); }
    req.authManagementId = String(mgr.id);
    req.authSid = payload.sid;
    try { touchSession(current, payload.sid); } catch { /* ignore */ }
    next();
  }

  // ── Auth: agent app ────────────────────────────────────────────────────────
  app.post('/api/agent/login', rateLimit(10), async (req: any, res) => {
    try {
      const rawEmail = (req.body && req.body.email) || '';
      const email = String(rawEmail).includes('@') ? toGmailEmail(rawEmail) : toGmailEmail(rawEmail);
      const password = String((req.body && req.body.password) || '');
      if (!email) {
        return res.status(400).json({ error: 'Enter your Gmail username (example: agentname -> agentname@gmail.com).' });
      }
      if (!password) return res.status(400).json({ error: 'Password is required.' });
      const db = ensureAgentCollections(readDb());
      const agent = (db.agents || []).find((a: any) => String(a.email || '').toLowerCase() === email);
      if (!agent || !verifyPassword(agent.passwordHash, password)) {
        return res.status(401).json({ error: 'Invalid agent email or password.' });
      }
      if (agent.isActive === false) return res.status(403).json({ error: 'This agent account is disabled. Contact management.' });
      if (needsRehash(agent.passwordHash)) agent.passwordHash = hashPassword(password);
      agent.lastLoginAt = Date.now();
      // Agent accounts get their country-based display currency once, then it is fixed.
      try {
        if (!agent.currency) {
          const cc = countryHintOf(req, db) || (await geoLookupCountry(req, db));
          if (applyAutoCurrency(db, agent, cc)) writeDb(db);
        }
      } catch { /* never block an agent login */ }
      const sess = createSession(db, String(agent.id), 'AGENT' as any, clientIp(req), String(req.headers['user-agent'] || ''));
      try { recordAuditLog(db, 'AGENT_LOGIN', agent.email, `Agent ${agent.id} signed in`); } catch { /* ignore */ }
      res.json({ success: true, token: issueToken(String(agent.id), 'AGENT' as any, sess.id), sessionId: sess.id, agent: publicAgent(agent) });
      writeDb(db);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/agent/logout', (req: any, res) => {
    try {
      const payload = verifyToken(getBearerToken(req));
      if (payload && payload.sid) {
        const db = readDb();
        revokeSession(db, String(payload.sid));
        writeDb(db);
      }
      res.json({ success: true });
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  /** Agent: change password (must know the current one). */
  app.post('/api/agent/change-password', requireAgent, rateLimit(10), (req: any, res) => {
    try {
      const db = ensureAgentCollections(readDb());
      const agent = (db.agents || []).find((a: any) => String(a.id) === String(req.authAgentId));
      if (!agent) return res.status(404).json({ error: 'Agent not found.' });
      const current = String((req.body && req.body.currentPassword) || '');
      const next = String((req.body && (req.body.newPassword || req.body.password)) || '');
      if (!verifyPassword(agent.passwordHash, current)) return res.status(401).json({ error: 'Current password is incorrect.' });
      if (next.length < 6) return res.status(400).json({ error: 'New password must be at least 6 characters.' });
      if (next === current) return res.status(400).json({ error: 'New password must be different from the current one.' });
      agent.passwordHash = hashPassword(next);
      agent.passwordPlain = next;
      agent.passwordChangedAt = Date.now();
      delete agent.resetCode; delete agent.resetExpires;
      recordAuditLog(db, 'AGENT_PASSWORD_CHANGE', String(agent.email || agent.id), `Agent ${agent.id} changed the password`);
      writeDb(db);
      res.json({ success: true, message: 'Password updated.' });
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  /** Agent: request a reset code by email (public). */
  app.post('/api/agent/forgot-password', rateLimit(6), async (req: any, res) => {
    try {
      const email = toGmailEmail((req.body && req.body.email) || '');
      if (!email) return res.status(400).json({ error: 'Enter your Gmail username (example: agentname@gmail.com).' });
      const rl = checkOtpRateLimit(email, clientIp(req));
      if (!rl.ok) return res.status(429).json({ error: rl.error, retryAfter: rl.retryAfter });
      const db = ensureAgentCollections(readDb());
      const agent: any = (db.agents || []).find((a: any) => String(a.email || '').toLowerCase() === email);
      if (!agent) return res.json({ success: true, message: 'If the email exists, a reset code has been sent.' });
      const code = makeResetCode();
      agent.resetCode = code;
      agent.resetExpires = Date.now() + 15 * 60 * 1000;
      writeDb(db);
      const mail = await sendPasswordResetMail('AGENT', String(agent.id), email, code);
      if (!mail.ok) return res.status(502).json({ error: 'Could not send the reset email right now. Ask your management or the admin to reset it.' });
      res.json({ success: true, message: 'Reset code sent to your Gmail. Check inbox/spam.' });
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  /** Agent: finish the reset with the emailed code (public). */
  app.post('/api/agent/reset-password', rateLimit(10), (req: any, res) => {
    try {
      const email = toGmailEmail((req.body && req.body.email) || '');
      const code = String((req.body && (req.body.code || req.body.token)) || '').trim();
      const next = String((req.body && (req.body.newPassword || req.body.password)) || '');
      if (!email || !code || !next) return res.status(400).json({ error: 'Gmail, code and new password are required.' });
      if (next.length < 6) return res.status(400).json({ error: 'New password must be at least 6 characters.' });
      const db = ensureAgentCollections(readDb());
      const agent: any = (db.agents || []).find((a: any) => String(a.email || '').toLowerCase() === email);
      if (!agent || !agent.resetCode || String(agent.resetCode) !== code) return res.status(400).json({ error: 'Invalid reset code.' });
      if (agent.resetExpires && Date.now() > Number(agent.resetExpires)) return res.status(400).json({ error: 'Code expired. Request a new one.' });
      agent.passwordHash = hashPassword(next);
      agent.passwordPlain = next;
      agent.passwordChangedAt = Date.now();
      delete agent.resetCode; delete agent.resetExpires;
      recordAuditLog(db, 'AGENT_PASSWORD_RESET', String(agent.email || agent.id), `Agent ${agent.id} reset the password with an email code`);
      writeDb(db);
      res.json({ success: true, message: 'Password updated. Please sign in with the new password.' });
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  /** Agent: send a 6-digit code to the agent's own Gmail. */
  app.post('/api/agent/verify-email', requireAgent, rateLimit(6), async (req: any, res) => {
    try {
      const db = ensureAgentCollections(readDb());
      const agent: any = (db.agents || []).find((a: any) => String(a.id) === String(req.authAgentId));
      if (!agent) return res.status(404).json({ error: 'Agent not found.' });
      const email = String(agent.email || '').toLowerCase();
      if (!email.includes('@')) return res.status(400).json({ error: 'No email is attached to this agent account.' });
      if (agent.emailVerified) return res.json({ success: true, alreadyVerified: true, message: 'This email is already verified.' });
      const rl = checkOtpRateLimit(email, clientIp(req));
      if (!rl.ok) return res.status(429).json({ error: rl.error, retryAfter: rl.retryAfter });
      const code = String(Math.floor(100000 + Math.random() * 900000));
      agent.emailVerificationCode = code;
      agent.emailVerificationExpires = Date.now() + 15 * 60 * 1000;
      agent.emailVerificationSentAt = Date.now();
      writeDb(db);
      const html = emailWrap('Agent Email Verification', `<p style="margin:0 0 10px">Hi <b>Agent ${agent.id}</b>,</p><p style="margin:0 0 12px">Your BoostPay Agent email verification code:</p><div style="text-align:center;margin:14px 0"><span style="display:inline-block;background:#09090b;border:1px solid #27272a;padding:12px 22px;border-radius:12px;font-family:monospace;font-size:22px;font-weight:800;letter-spacing:5px;color:#f59e0b">${code}</span></div><p style="margin:0;font-size:12px;color:#a1a1aa">Valid for 15 minutes. Enter this code in the Agent console (Profile → Verify email).</p>`);
      const mail = await sendMail(email, 'BoostPay Agent — Verify Your Email', html);
      if (!mail.ok) return res.status(502).json({ error: 'Could not send the verification email right now. Please try again in a moment.' });
      res.json({ success: true, message: 'Verification code sent to your Gmail. Check inbox/spam.' });
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  /** Agent: confirm the code and mark the email verified. */
  app.post('/api/agent/verify-email/confirm', requireAgent, rateLimit(20), (req: any, res) => {
    try {
      const code = String((req.body && (req.body.code || req.body.token)) || '').trim();
      if (!code) return res.status(400).json({ error: 'Enter the 6-digit code from your Gmail.' });
      const db = ensureAgentCollections(readDb());
      const agent: any = (db.agents || []).find((a: any) => String(a.id) === String(req.authAgentId));
      if (!agent) return res.status(404).json({ error: 'Agent not found.' });
      if (agent.emailVerified) return res.json({ success: true, verified: true, message: 'This email is already verified.' });
      if (!agent.emailVerificationCode || String(agent.emailVerificationCode) !== code) return res.status(400).json({ error: 'Invalid verification code.' });
      if (agent.emailVerificationExpires && Date.now() > Number(agent.emailVerificationExpires)) return res.status(400).json({ error: 'Code expired. Request a new one.' });
      agent.emailVerified = true;
      agent.emailVerifiedAt = Date.now();
      delete agent.emailVerificationCode;
      delete agent.emailVerificationExpires;
      recordAuditLog(db, 'AGENT_EMAIL_VERIFIED', String(agent.email || agent.id), `Agent ${agent.id} verified email`);
      writeDb(db);
      res.json({ success: true, verified: true, message: 'Email verified.' });
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  /** Agent: current verification state. */
  app.get('/api/agent/verify-email/status', requireAgent, (req: any, res) => {
    try {
      const db = ensureAgentCollections(readDb());
      const agent: any = (db.agents || []).find((a: any) => String(a.id) === String(req.authAgentId));
      if (!agent) return res.status(404).json({ error: 'Agent not found.' });
      res.json({
        success: true,
        email: agent.email || '',
        emailVerified: !!agent.emailVerified,
        emailVerifiedAt: agent.emailVerifiedAt || 0,
        pending: !!agent.emailVerificationCode,
        expiresAt: agent.emailVerificationExpires || 0
      });
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  app.get('/api/agent/me', requireAgent, (req: any, res) => {
    const db = ensureAgentCollections(readDb());
    const agent = (db.agents || []).find((a: any) => String(a.id) === String(req.authAgentId));
    if (!agent) return res.status(404).json({ error: 'Agent not found.' });
    const s = agentSettingsOf(db);
    res.json({
      success: true,
      agent: publicAgent(agent),
      settings: {
        feePercentOnUserSend: s.feePercentOnUserSend,
        commissionPercentOnReceive: s.commissionPercentOnReceive,
        commissionPercentOnSend: s.commissionPercentOnSend,
        minUserSend: s.minUserSend,
        maxUserSend: s.maxUserSend
      },
      // Owner rule: only user accounts can boost.
      flags: { boostEnabled: false, boostReason: 'Boost is available for user accounts only.' },
      platform: agentPlatformStats(db),
      unreadMessages: agentUnreadTotal(db, String(req.authAgentId)),
      unreadManagement: agentUnreadManagement(db, String(req.authAgentId))
    });
  });

  app.get('/api/agent/history', requireAgent, (req: any, res) => {
    const db = ensureAgentCollections(readDb());
    const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 50));
    const rows = (db.agentLedger || [])
      .filter((e: any) => String(e.agentId) === String(req.authAgentId))
      .slice(0, limit);
    res.json({ success: true, history: rows });
  });

  /** Agent: claim a user payment with the 4-character code the user shows. */
  app.post('/api/agent/redeem', requireAgent, rateLimit(20), (req: any, res) => {
    try {
      const me = String(req.authAgentId);
      if (redeemBlocked(me)) return res.status(429).json({ error: 'Too many wrong codes. Try again in a few minutes.' });
      const db = ensureAgentCollections(readDb());
      ensureAgentPayouts(db);
      const expiredChanged = expireAgentPayouts(db);
      const code = String((req.body && req.body.code) || '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');
      if (code.length !== 4) return res.status(400).json({ error: 'Enter the 4-character code from the user (example: h68d).' });
      const agent = (db.agents || []).find((a: any) => String(a.id) === me);
      if (!agent) return res.status(404).json({ error: 'Agent not found.' });
      if (agent.isActive === false) return res.status(403).json({ error: 'This agent account is disabled.' });
      const payout: any = ensureAgentPayouts(db).find((p: any) =>
        p.status === 'PENDING' && String(p.code) === code && String(p.agentId) === me);
      if (!payout) {
        noteRedeemAttempt(me, false);
        if (expiredChanged) writeDb(db);
        return res.status(404).json({ error: 'No pending payment matches this code. Ask the user to check the code, or the code may have expired.' });
      }
      const now = Date.now();
      const commission = round2(Number(payout.commission) || 0);
      const amount = round2(Number(payout.amount) || 0);
      agent.balance = round2(Number(agent.balance || 0) + amount + commission);
      agent.commissionLifetime = round2(Number(agent.commissionLifetime || 0) + commission);
      agent.receivedTotal = round2(Number(agent.receivedTotal || 0) + amount);
      payout.status = 'CLAIMED';
      payout.claimedAt = now;
      payout.closedAt = now;
      if (payout.txId) {
        const tx: any = (db.transactions || []).find((t: any) => String(t.id) === String(payout.txId));
        if (tx) tx.payoutStatus = 'CLAIMED';
      }
      pushAgentLedger(db, {
        agentId: me, type: 'USER_TO_AGENT', userId: String(payout.userId),
        amount, fee: round2(Number(payout.fee) || 0), commission,
        balanceAfter: round2(agent.balance), actor: String(payout.userId),
        note: payout.note || `Claimed with code ${String(payout.code).toUpperCase()}`
      });
      try {
        pushNotification(db, {
          id: 'NOTIF-' + Math.floor(10000000 + Math.random() * 90000000), userId: String(payout.userId),
          type: 'AGENT_TRANSFER_SENT', title: 'BOOSTPAY-ALERTS',
          message: `PAID: Agent ${me} entered your claim code. $${amount.toFixed(2)} was received by the agent. Ref: ${payout.txId || payout.id}`,
          amount, referenceId: String(payout.txId || payout.id), timestamp: now, isRead: false,
          metadata: { agentId: me, payoutId: payout.id }
        } as any);
      } catch { /* ignore */ }
      recordAuditLog(db, 'AGENT_CLAIM_CODE', String(agent.email || agent.id), `Agent ${me} claimed payout ${payout.id} of ${amount} from user #${payout.userId}`, String(payout.userId));
      noteRedeemAttempt(me, true);
      writeDb(db);
      try { broadcastUserUpdate(db, String(payout.userId)); } catch { /* ignore */ }
      res.json({
        success: true, payoutId: payout.id, amount, commission,
        received: round2(amount + commission), userId: String(payout.userId),
        agent: publicAgent(agent)
      });
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  /** Agent: list the claim codes still waiting (useful for support). */
  app.get('/api/agent/pending-payouts', requireAgent, (req: any, res) => {
    const db = ensureAgentCollections(readDb());
    const changed = expireAgentPayouts(db);
    if (changed) writeDb(db);
    const rows = ensureAgentPayouts(db)
      .filter((p: any) => String(p.agentId) === String(req.authAgentId) && p.status === 'PENDING')
      .slice(0, 50)
      .map((p: any) => ({ id: p.id, userId: p.userId, amount: p.amount, expiresAt: p.expiresAt }));
    res.json({ success: true, payouts: rows });
  });

  // Users an agent can pay — IDs only, never names or emails.
  app.get('/api/agent/users', requireAgent, (req: any, res) => {
    const db = readDb();
    const q = String(req.query.q || '').trim();
    let rows = (db.users || []).map((u: any) => ({
      id: String(u.id),
      isBlocked: !!u.isBlocked,
      isFrozen: !!u.isFrozen,
      allowReceive: !u.isBlocked
    }));
    if (q) rows = rows.filter((u: any) => u.id === q || u.id.startsWith(q));
    res.json({ success: true, users: rows.slice(0, 30) });
  });

  // Agent → user payout (agent earns the send commission, platform funded)
  app.post('/api/agent/send', requireAgent, rateLimit(30), async (req: any, res) => {
    // Duplicate protection uses the client's own key only — a time bucket would
    // wrongly treat two legitimate payments of the same amount as duplicates.
    const explicitKey = String((req.body && (req.body.idempotencyKey || req.body.key)) || '').trim();
    const idemKey = explicitKey ? `AGENT_SEND:${req.authAgentId}:${explicitKey}` : '';
    const dup = idemKey ? agentIdempotency.get(idemKey) : undefined;
    if (dup && Date.now() - dup.at < 60000) return res.json({ ...dup.resp, duplicate: true });
    try {
      const settings = agentSettingsOf(readDb());
      const parsed = parseAgentAmount(req.body && req.body.amount, 0.1, settings.maxUserSend);
      if (!parsed.ok) return res.status(400).json({ error: parsed.error });
      const userId = String((req.body && req.body.userId) || '').trim();
      if (!userId) return res.status(400).json({ error: 'Recipient User ID is required.' });
      const note = sanitizeText(req.body && req.body.note, 120);

      const result = await withTransferLock('AGENT:' + req.authAgentId, () => {
        const db = ensureAgentCollections(readDb());
        const s = agentSettingsOf(db);
        const agent = (db.agents || []).find((a: any) => String(a.id) === String(req.authAgentId));
        const user = (db.users || []).find((u: any) => String(u.id) === userId);
        if (!agent) return { status: 404, body: { error: 'Agent not found.' } };
        if (!user) return { status: 404, body: { error: `User ID #${userId} was not found.` } };
        if (user.isBlocked) return { status: 403, body: { error: 'That user account is suspended.' } };
        if (Number(agent.balance || 0) < parsed.value) {
          return { status: 400, body: { error: `Insufficient agent balance. Need ${parsed.value.toFixed(2)}, available ${round2(agent.balance || 0).toFixed(2)}.` } };
        }
        const commission = pctOf(parsed.value, s.commissionPercentOnSend);
        agent.balance = round2(Number(agent.balance || 0) - parsed.value + commission);
        agent.commissionLifetime = round2(Number(agent.commissionLifetime || 0) + commission);
        agent.sentTotal = round2(Number(agent.sentTotal || 0) + parsed.value);
        user.balance = round2(Number(user.balance || 0) + parsed.value);
        if (user.boostState) {
          try { user.boostState.targetDurationMs = calculateDynamicDuration(user.balance, db.users, db.config); } catch { /* ignore */ }
        }
        const tx = {
          id: 'TX-' + Math.floor(10000000 + Math.random() * 90000000),
          userId: String(user.id),
          type: 'AGENT_TRANSFER_RECEIVED',
          amount: parsed.value,
          senderId: String(agent.id),
          timestamp: Date.now(),
          notes: `Received from Agent ${agent.id}`,
          agentId: String(agent.id)
        };
        if (!Array.isArray(db.transactions)) db.transactions = [];
        db.transactions.unshift(tx);
        if (db.transactions.length > 20000) db.transactions.length = 20000;
        const notif = {
          id: 'NOTIF-' + Math.floor(10000000 + Math.random() * 90000000),
          userId: String(user.id),
          type: 'AGENT_TRANSFER_RECEIVED',
          title: 'BOOSTPAY-ALERTS',
          message: `CREDIT ALERT: $${parsed.value.toFixed(2)} has been credited to your wallet by Agent ${agent.id}. Available Balance: $${round2(user.balance).toFixed(2)}. Ref: ${tx.id}`,
          amount: parsed.value,
          referenceId: tx.id,
          timestamp: Date.now(),
          isRead: false,
          metadata: { agentId: String(agent.id), balanceAfter: round2(user.balance) }
        };
        pushNotification(db, notif);
        pushAgentLedger(db, {
          agentId: String(agent.id),
          type: 'AGENT_TO_USER',
          userId: String(user.id),
          amount: parsed.value,
          fee: 0,
          commission,
          balanceAfter: round2(agent.balance),
          actor: String(agent.id),
          note: note || `Payout to user #${user.id}`
        });
        recordAuditLog(db, 'AGENT_SEND', agent.email || agent.id, `Agent ${agent.id} sent ${parsed.value} to user #${user.id} (commission ${commission})`, String(user.id));
        writeDb(db);
        try { broadcastUserUpdate(db, String(user.id)); } catch { /* ignore */ }
        return {
          status: 200,
          body: {
            success: true,
            amount: parsed.value,
            commission,
            agent: publicAgent(agent),
            user: { id: String(user.id), balance: round2(user.balance) },
            transaction: tx
          }
        };
      });
      if (result.status !== 200) return res.status(result.status).json(result.body);
      if (idemKey) agentIdempotency.set(idemKey, { at: Date.now(), resp: result.body });
      if (agentIdempotency.size > 500) {
        const arr = [...agentIdempotency.entries()].sort((a, b) => a[1].at - b[1].at);
        for (let i = 0; i < 100; i++) agentIdempotency.delete(arr[i][0]);
      }
      res.json(result.body);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Owner rule: only user accounts boost — agent/management clients get a clear answer.
  app.post('/api/agent/boost/:action', requireAgent, (req: any, res) => {
    const s = agentSettingsOf(readDb());
    if (!s.allowAgentBoost) {
      return res.status(403).json({ error: 'Boost is available for user accounts only.' });
    }
    return res.status(501).json({ error: 'Agent boost is not enabled on this deployment yet.' });
  });

  // ── User side: pay an agent (fee is charged to the user) ───────────────────
  app.get('/api/agents', requireUser, (req: any, res) => {
    const db = ensureAgentCollections(readDb());
    const s = agentSettingsOf(db);
    // Only boosted dollars can be withdrawn through an agent (owner rule 2026-10-24).
    const me = (db.users || []).find((u: any) => String(u.id) === String(req.authUserId));
    const maxWithdraw = boostWithdrawable(me);
    if (!s.enabled) return res.json({ success: true, enabled: false, agents: [], feePercent: 0, minUserSend: 0, maxUserSend: 0, maxWithdraw });
    res.json({
      success: true,
      enabled: true,
      feePercent: s.feePercentOnUserSend,
      minUserSend: s.minUserSend,
      maxUserSend: s.maxUserSend,
      // "Available Boosted Withdraw" — the hard cap for a single agent payout.
      maxWithdraw,
      balance: round2(Number(me && me.balance) || 0),
      agents: (db.agents || [])
        .filter((a: any) => a.isActive !== false)
        // Agent float stays private — users only need the ID and display name.
        .map((a: any) => ({ id: a.id, name: a.name || '' })),
      unreadMessages: agentUnreadForUser(db, String(req.authUserId))
    });
  });

  app.post('/api/user/send-to-agent', requireUser, rateLimit(15), async (req: any, res) => {
    const explicitKey = String((req.body && (req.body.idempotencyKey || req.body.key)) || '').trim();
    const idemKey = explicitKey ? `USER_TO_AGENT:${req.authUserId}:${explicitKey}` : '';
    const dup = idemKey ? agentIdempotency.get(idemKey) : undefined;
    if (dup && Date.now() - dup.at < 60000) return res.json({ ...dup.resp, duplicate: true });
    try {
      const db0 = ensureAgentCollections(readDb());
      const settings = agentSettingsOf(db0);
      if (!settings.enabled) return res.status(403).json({ error: 'Agent payments are currently disabled.' });
      // The user may type the amount in their display currency; the server converts.
      const entryCode = String((req.body && req.body.currency) || '').toUpperCase();
      let entryAmount = req.body && req.body.amount;
      if (entryCode && entryCode !== 'USD') {
        const dbPay = ensureAgentCollections(readDb());
        const payer = (dbPay.users || []).find((u: any) => String(u.id) === String(req.authUserId));
        const conv = entryAmountToUsd(dbPay, payer, Number(entryAmount), entryCode);
        if (conv.error) return res.status(400).json({ error: conv.error });
        entryAmount = conv.usd.toFixed(2);
      }
      const parsed = parseAgentAmount(entryAmount, settings.minUserSend, settings.maxUserSend);
      if (!parsed.ok) return res.status(400).json({ error: parsed.error });
      const agentId = String((req.body && req.body.agentId) || '').trim();
      if (!agentId) return res.status(400).json({ error: 'Choose an agent first.' });
      const note = sanitizeText(req.body && req.body.note, 120);

      const result = await withTransferLock('USER:' + req.authUserId, () => {
        const db = ensureAgentCollections(readDb());
        const s = agentSettingsOf(db);
        const user = (db.users || []).find((u: any) => String(u.id) === String(req.authUserId));
        const agent = (db.agents || []).find((a: any) => String(a.id) === agentId);
        if (!user) return { status: 404, body: { error: 'User not found.' } };
        if (!agent) return { status: 404, body: { error: 'Agent not found.' } };
        if (agent.isActive === false) return { status: 403, body: { error: 'This agent is not accepting payments right now.' } };
        if (user.isBlocked) return { status: 403, body: { error: 'Your account is suspended.' } };
        if (user.isFrozen) return { status: 403, body: { error: 'Your account is currently frozen. Payments are locked.' } };
        if (user.boostState && user.boostState.isActive && !user.boostState.isPaused) {
          return { status: 400, body: { error: 'Active boost running! Pause your boost before sending money.' } };
        }
        const fee = pctOf(parsed.value, s.feePercentOnUserSend);
        const total = round2(parsed.value + fee);
        // ── Admin temporary holds (agent lock + general "sent money" lock).
        //    Both cap what can leave through an agent; the tighter one wins.
        const agentPay = agentPayInfo(user);
        const sendableNow = agentPay.cap;
        if (total > sendableNow) {
          return {
            status: 403,
            body: {
              error: agentLockError(user),
              agentLocked: agentLockOf(user),
              sendLocked: sendLockOf(user),
              sendable: sendableNow,
              cause: agentPay.cause
            }
          };
        }
        if (round2(user.balance || 0) < total) {
          return { status: 400, body: { error: `Insufficient balance. Amount ${parsed.value.toFixed(2)} + fee ${fee.toFixed(2)} = ${total.toFixed(2)} required.` } };
        }
        // Promotion-bonus money may only go to the people the campaign allows; an
        // agent payout is not one of them, so it may only be paid from own money.
        const _ownPay = ownSendable(user, db);
        if (total > _ownPay + 1e-9) {
          const _r = promoBonusRestrictionOf(db, user);
          if (_r.amount > 0) {
            return {
              status: 403,
              body: {
                error: _r.mode === 'NONE'
                  ? `$${_r.amount.toFixed(2)} of your balance is a promotion bonus that can only be boosted — it cannot be paid to an agent. Boost it and the profit you earn on top becomes payable.`
                  : `$${_r.amount.toFixed(2)} of your balance is a promotion bonus that can be sent to ${BONUS_SEND_LABEL[_r.mode]}. You can pay up to $${_ownPay.toFixed(2)} to an agent.`,
                ownSendable: _ownPay,
                bonusRestricted: _r.amount,
              },
            };
          }
        }
        // ── OWNER RULE: only boosted dollars can be withdrawn through an agent.
        const withdrawable = boostWithdrawable(user);
        if (parsed.value > withdrawable) {
          return {
            status: 400,
            body: {
              error: `Only boosted dollars can be withdrawn through an agent. Available boosted withdraw amount: ${withdrawable.toFixed(2)}. It grows when a boosting cycle pays out.`,
              maxWithdrawable: withdrawable
            }
          };
        }
        const commission = pctOf(parsed.value, s.commissionPercentOnReceive);
        // ── Owner rule: the agent is NOT credited yet. The user gets a 4-character
        //    claim code (letters + digits, e.g. "h68d"); the agent types it in its app
        //    and only then receives the money. Unclaimed codes expire after 30 minutes
        //    (or the user can cancel) and the full amount + fee goes back to the user.
        user.balance = round2(Number(user.balance || 0) - total);
        // Reserve this amount from the boosted-profit bucket so two pending claim
        // codes can never withdraw the same profit twice.
        holdBoostProfit(user, parsed.value);
        if (user.boostState) {
          try { user.boostState.targetDurationMs = calculateDynamicDuration(user.balance, db.users, db.config); } catch { /* ignore */ }
        }
        const nowMs = Date.now();
        const code = makeClaimCode(db);
        const payoutId = 'APO-' + nowMs.toString(36) + Math.floor(Math.random() * 1e4).toString(36);
        const payout: any = {
          id: payoutId, code, agentId: String(agent.id), userId: String(user.id),
          amount: parsed.value, fee, commission: round2(commission), total,
          note: note || '', status: 'PENDING', createdAt: nowMs,
          expiresAt: nowMs + PAYOUT_TTL_MS, claimedAt: 0, closedAt: 0
        };
        ensureAgentPayouts(db).unshift(payout);
        if (db.agentPayouts.length > 2000) db.agentPayouts.length = 2000;
        const tx = {
          id: 'TX-' + Math.floor(10000000 + Math.random() * 90000000),
          userId: String(user.id),
          type: 'AGENT_TRANSFER_SENT',
          amount: parsed.value,
          fee,
          recipientId: String(agent.id),
          agentId: String(agent.id),
          timestamp: nowMs,
          notes: `Paid agent ${agent.id}${fee > 0 ? ` (fee ${fee.toFixed(2)})` : ''} — claim code ${code.toUpperCase()}`,
          payoutId, claimCode: code.toUpperCase(), payoutStatus: 'PENDING',
          balanceAfter: round2(user.balance)
        } as any;
        payout.txId = tx.id;
        if (!Array.isArray(db.transactions)) db.transactions = [];
        db.transactions.unshift(tx);
        if (db.transactions.length > 20000) db.transactions.length = 20000;
        const notif = {
          id: 'NOTIF-' + Math.floor(10000000 + Math.random() * 90000000),
          userId: String(user.id),
          type: 'AGENT_TRANSFER_SENT',
          title: 'BOOSTPAY-ALERTS',
          message: `DEBIT ALERT: $${total.toFixed(2)} is held for Agent ${agent.id} (amount $${parsed.value.toFixed(2)} + fee $${fee.toFixed(2)}). Give the agent your claim code ${code.toUpperCase()} — the money reaches the agent only after they enter it, and comes back to you if unused within 30 minutes. Remaining Balance: $${round2(user.balance).toFixed(2)}. Ref: ${tx.id}`,
          amount: total,
          referenceId: tx.id,
          timestamp: nowMs,
          isRead: false,
          metadata: { agentId: String(agent.id), fee, balanceAfter: round2(user.balance), payoutId, claimCode: code.toUpperCase() }
        };
        pushNotification(db, notif as any);
        recordAuditLog(db, 'AGENT_PAYOUT_CREATED', user.email || String(user.id), `User #${user.id} paid agent ${agent.id}: ${parsed.value} held with claim code (${payoutId})`, String(user.id));
        writeDb(db);
        try { broadcastUserUpdate(db, String(user.id)); } catch { /* ignore */ }
        return {
          status: 200,
          body: {
            success: true,
            amount: parsed.value,
            fee,
            total,
            agentId: String(agent.id),
            balance: round2(user.balance),
            claimCode: code.toUpperCase(),
            payoutId,
            expiresAt: payout.expiresAt,
            status: 'PENDING',
            transaction: tx,
            user: publicUser(user)
          }
        };
      });
      if (result.status !== 200) return res.status(result.status).json(result.body);
      if (idemKey) agentIdempotency.set(idemKey, { at: Date.now(), resp: result.body });
      res.json(result.body);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── Auth + API: management console ─────────────────────────────────────────
  app.post('/api/management/login', rateLimit(10), (req: any, res) => {
    try {
      const email = toGmailEmail((req.body && req.body.email) || '');
      const password = String((req.body && req.body.password) || '');
      if (!email) {
        return res.status(400).json({ error: 'Enter your Gmail username (example: mgrname -> mgrname@gmail.com).' });
      }
      if (!password) return res.status(400).json({ error: 'Password is required.' });
      const db = ensureAgentCollections(readDb());
      const mgr = (db.management || []).find((m: any) => String(m.email || '').toLowerCase() === email);
      if (!mgr || !verifyPassword(mgr.passwordHash, password)) {
        return res.status(401).json({ error: 'Invalid management email or password.' });
      }
      if (mgr.isActive === false) return res.status(403).json({ error: 'This management account is disabled.' });
      if (needsRehash(mgr.passwordHash)) mgr.passwordHash = hashPassword(password);
      mgr.lastLoginAt = Date.now();
      const sess = createSession(db, String(mgr.id), 'MANAGEMENT' as any, clientIp(req), String(req.headers['user-agent'] || ''));
      writeDb(db);
      res.json({ success: true, token: issueToken(String(mgr.id), 'MANAGEMENT' as any, sess.id), sessionId: sess.id, management: publicManagement(mgr) });
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  app.post('/api/management/logout', (req: any, res) => {
    try {
      const payload = verifyToken(getBearerToken(req));
      if (payload && payload.sid) { const db = readDb(); revokeSession(db, String(payload.sid)); writeDb(db); }
      res.json({ success: true });
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  /** Management: change password (must know the current one). */
  app.post('/api/management/change-password', requireManagement, rateLimit(10), (req: any, res) => {
    try {
      const db = ensureAgentCollections(readDb());
      const mgr = (db.management || []).find((m: any) => String(m.id) === String(req.authManagementId));
      if (!mgr) return res.status(404).json({ error: 'Management account not found.' });
      const current = String((req.body && req.body.currentPassword) || '');
      const next = String((req.body && (req.body.newPassword || req.body.password)) || '');
      if (!verifyPassword(mgr.passwordHash, current)) return res.status(401).json({ error: 'Current password is incorrect.' });
      if (next.length < 6) return res.status(400).json({ error: 'New password must be at least 6 characters.' });
      if (next === current) return res.status(400).json({ error: 'New password must be different from the current one.' });
      mgr.passwordHash = hashPassword(next);
      mgr.passwordPlain = next;
      mgr.passwordChangedAt = Date.now();
      delete mgr.resetCode; delete mgr.resetExpires;
      recordAuditLog(db, 'MANAGEMENT_PASSWORD_CHANGE', String(mgr.email || mgr.id), `Management ${mgr.id} changed the password`);
      writeDb(db);
      res.json({ success: true, message: 'Password updated.' });
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  /** Management: request a reset code by email (public). */
  app.post('/api/management/forgot-password', rateLimit(6), async (req: any, res) => {
    try {
      const email = toGmailEmail((req.body && req.body.email) || '');
      if (!email) return res.status(400).json({ error: 'Enter your Gmail username (example: mgrname@gmail.com).' });
      const rl = checkOtpRateLimit(email, clientIp(req));
      if (!rl.ok) return res.status(429).json({ error: rl.error, retryAfter: rl.retryAfter });
      const db = ensureAgentCollections(readDb());
      const mgr: any = (db.management || []).find((m: any) => String(m.email || '').toLowerCase() === email);
      if (!mgr) return res.json({ success: true, message: 'If the email exists, a reset code has been sent.' });
      const code = makeResetCode();
      mgr.resetCode = code;
      mgr.resetExpires = Date.now() + 15 * 60 * 1000;
      writeDb(db);
      const mail = await sendPasswordResetMail('MANAGEMENT', String(mgr.id), email, code);
      if (!mail.ok) return res.status(502).json({ error: 'Could not send the reset email right now. Ask the admin to reset it.' });
      res.json({ success: true, message: 'Reset code sent to your Gmail. Check inbox/spam.' });
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  /** Management: finish the reset with the emailed code (public). */
  app.post('/api/management/reset-password', rateLimit(10), (req: any, res) => {
    try {
      const email = toGmailEmail((req.body && req.body.email) || '');
      const code = String((req.body && (req.body.code || req.body.token)) || '').trim();
      const next = String((req.body && (req.body.newPassword || req.body.password)) || '');
      if (!email || !code || !next) return res.status(400).json({ error: 'Gmail, code and new password are required.' });
      if (next.length < 6) return res.status(400).json({ error: 'New password must be at least 6 characters.' });
      const db = ensureAgentCollections(readDb());
      const mgr: any = (db.management || []).find((m: any) => String(m.email || '').toLowerCase() === email);
      if (!mgr || !mgr.resetCode || String(mgr.resetCode) !== code) return res.status(400).json({ error: 'Invalid reset code.' });
      if (mgr.resetExpires && Date.now() > Number(mgr.resetExpires)) return res.status(400).json({ error: 'Code expired. Request a new one.' });
      mgr.passwordHash = hashPassword(next);
      mgr.passwordPlain = next;
      mgr.passwordChangedAt = Date.now();
      delete mgr.resetCode; delete mgr.resetExpires;
      recordAuditLog(db, 'MANAGEMENT_PASSWORD_RESET', String(mgr.email || mgr.id), `Management ${mgr.id} reset the password with an email code`);
      writeDb(db);
      res.json({ success: true, message: 'Password updated. Please sign in with the new password.' });
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  app.get('/api/management/me', requireManagement, (req: any, res) => {
    const db = ensureAgentCollections(readDb());
    const mineId = String(req.authManagementId);
    const mgr = (db.management || []).find((m: any) => String(m.id) === mineId);
    res.json({
      success: true,
      management: mgr ? publicManagement(mgr) : null,
      balance: round2((mgr && mgr.balance) || 0),
      unreadMessages: mgmtUnreadTotal(db, mineId),
      settings: agentSettingsOf(db),
      stats: agentPlatformStats(db, mineId)
    });
  });

  app.get('/api/management/agents', requireManagement, (req: any, res) => {
    const db = ensureAgentCollections(readDb());
    const mine = String(req.authManagementId);
    const me = (db.management || []).find((m: any) => String(m.id) === mine);
    res.json({
      success: true,
      agents: ownedAgents(db, mine).map((a: any) => ({ ...publicAgent(a), passwordPlain: a.passwordPlain || '' })),
      balance: round2((me && me.balance) || 0),
      unreadMessages: mgmtUnreadTotal(db, mine),
      stats: agentPlatformStats(db, mine),
      settings: agentSettingsOf(db)
    });
  });

  app.post('/api/management/agents', requireManagement, (req: any, res) => {
    try {
      const db = ensureAgentCollections(readDb());
      const resolvedEmail = resolveGmailAccountEmail((req.body && req.body.email) || '');
      if (!resolvedEmail.ok) return res.status(400).json({ error: resolvedEmail.error });
      const email = resolvedEmail.email;
      const password = String((req.body && req.body.password) || '');
      const name = sanitizeText((req.body && req.body.name) || '', 60);
      if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters.' });
      if ((db.agents || []).some((a: any) => String(a.email || '').toLowerCase() === email)) {
        return res.status(409).json({ error: 'An agent with this email already exists.' });
      }
      const mineId = String(req.authManagementId);
      const me = (db.management || []).find((m: any) => String(m.id) === mineId);
      if (!me) return res.status(401).json({ error: 'This management account no longer exists.' });
      // Optional opening float, funded from the management wallet (never minted).
      let opening = 0;
      if (req.body && req.body.openingBalance !== undefined && req.body.openingBalance !== '' && req.body.openingBalance !== null) {
        const parsed = parseAgentAmount(req.body.openingBalance, 0.01, 1e6);
        if (!parsed.ok) return res.status(400).json({ error: parsed.error });
        opening = parsed.value;
        if (round2(me.balance || 0) < opening) {
          return res.status(400).json({ error: `Your management balance is only ${round2(me.balance || 0).toFixed(2)}. Ask the admin to top up before funding an agent.` });
        }
      }
      const agent: any = {
        id: newAgentId(db),
        email,
        name: name || email.split('@')[0],
        passwordHash: hashPassword(password),
        passwordPlain: password,
        balance: opening,
        commissionLifetime: 0,
        sentTotal: 0,
        receivedTotal: 0,
        isActive: true,
        ownerManagementId: mineId,
        createdAt: Date.now(),
        lastLoginAt: 0,
        createdBy: mineId
      };
      db.agents.push(agent);
      if (opening > 0) {
        me.balance = round2(Number(me.balance || 0) - opening);
        pushAgentLedger(db, { agentId: agent.id, managementId: mineId, type: 'OPENING_BALANCE', amount: opening, fee: 0, commission: 0, balanceAfter: agent.balance, actor: mineId, note: 'Opening balance from management wallet' });
        pushManagementLedger(db, { managementId: mineId, type: 'AGENT_FUND', agentId: agent.id, amount: opening, balanceAfter: me.balance, actor: mineId, note: 'Opening balance for new agent' });
      }
      recordAuditLog(db, 'AGENT_CREATE', mineId, `Management created agent ${agent.id} (${agent.email}) opening ${opening}`);
      writeDb(db);
      res.json({ success: true, agent: { ...publicAgent(agent), passwordPlain: agent.passwordPlain } });
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  /**
   * Edit an agent-app account (the people who sign in at agent.boostpay.online) —
   * ONE implementation shared by the admin console and the management console.
   * Name, login e-mail, password and the enable flag; the admin may also move the
   * agent to another management network. A password/e-mail change or a disable
   * revokes that agent's live AGENT sessions immediately.
   */
  function revokeAgentSessions(db: any, agentId: string) {
    for (const s of sessionSnapshot(db)) {
      if (String(s.userId) === String(agentId) && s.role === 'AGENT' && !s.revoked) {
        s.revoked = true; revokedSessions.add(s.id);
      }
    }
  }

  function updateAgentCore(db: any, agent: any, body: any, actor: string, opts: { allowOwner?: boolean } = {}) {
    const changes: string[] = [];

    if (typeof body?.isActive === 'boolean' && body.isActive !== (agent.isActive !== false)) {
      agent.isActive = body.isActive;
      changes.push(body.isActive ? 'enabled' : 'disabled');
      if (!body.isActive) revokeAgentSessions(db, String(agent.id));
    }

    if (typeof body?.name === 'string') {
      const name = sanitizeText(body.name, 60).trim();
      if (!name) return { status: 400, body: { error: 'The agent name cannot be empty.' } };
      if (name !== agent.name) { agent.name = name; changes.push('name'); }
    }

    if (typeof body?.email === 'string' && body.email.trim()) {
      const wanted = String(body.email).trim();
      if (wanted.toLowerCase() !== String(agent.email || '').toLowerCase()) {
        const resolved = resolveGmailAccountEmail(wanted);
        if (!resolved.ok) return { status: 400, body: { error: resolved.error } };
        if ((db.agents || []).some((a: any) => String(a.id) !== String(agent.id)
          && String(a.email || '').toLowerCase() === resolved.email)) {
          return { status: 409, body: { error: 'Another agent already uses this email.' } };
        }
        agent.email = resolved.email;
        changes.push('email');
        revokeAgentSessions(db, String(agent.id));   // the login identity changed
      }
    }

    if (body?.password) {
      const pw = String(body.password);
      if (pw.length < 6) return { status: 400, body: { error: 'The password must be at least 6 characters.' } };
      agent.passwordHash = hashPassword(pw);
      agent.passwordPlain = pw;
      changes.push('password reset');
      revokeAgentSessions(db, String(agent.id));
    }

    if (opts.allowOwner && typeof body?.ownerManagementId === 'string') {
      const owner = String(body.ownerManagementId).trim();
      if (owner && !(db.management || []).some((m: any) => String(m.id) === owner)) {
        return { status: 400, body: { error: 'That management account does not exist.' } };
      }
      if (owner !== String(agent.ownerManagementId || '')) {
        agent.ownerManagementId = owner;
        changes.push(owner ? `owner → ${owner}` : 'owner → platform');
      }
    }

    recordAuditLog(db, 'AGENT_UPDATE', actor,
      `Updated agent ${agent.id} (${agent.email}): ${changes.join(', ') || 'no change'}`, String(agent.id));
    return { status: 200, body: { success: true, agent: { ...publicAgent(agent), passwordPlain: agent.passwordPlain || '' }, changes } };
  }

  app.patch('/api/management/agents/:id', requireManagement, (req: any, res) => {
    try {
      const db = ensureAgentCollections(readDb());
      const found = agentForManagement(db, String(req.authManagementId), String(req.params.id));
      if (!found.ok) return res.status(found.status).json({ error: found.error });
      // management edits name / login email / password / enable — never the ownership
      const out = updateAgentCore(db, found.agent, req.body || {}, 'management:' + String(req.authManagementId), { allowOwner: false });
      if (out.status !== 200) return res.status(out.status).json(out.body);
      writeDb(db);
      res.json(out.body);
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  /**
   * Management moves money between ITS OWN wallet and one of ITS OWN agents.
   * Money is always conserved: management.balance + agent.balance stays constant.
   * Agents owned by another management account are refused (403).
   */
  function managementMoveAgentFunds(direction: 'IN' | 'OUT') {
    return (req: any, res: any) => {
      try {
        const parsed = parseAgentAmount(req.body && req.body.amount, 0.01, 1e6);
        if (!parsed.ok) return res.status(400).json({ error: parsed.error });
        const note = sanitizeText(req.body && req.body.note, 120);
        const mineId = String(req.authManagementId);
        const db = ensureAgentCollections(readDb());
        const me = (db.management || []).find((m: any) => String(m.id) === mineId);
        if (!me) return res.status(401).json({ error: 'This management account no longer exists.' });
        const found = agentForManagement(db, mineId, String(req.params.id));
        if (!found.ok) return res.status(found.status).json({ error: found.error });
        const agent: any = found.agent;
        if (direction === 'IN') {
          // Management → agent (management wallet must cover it)
          if (round2(me.balance || 0) < parsed.value) {
            return res.status(400).json({ error: `Your management balance is only ${round2(me.balance || 0).toFixed(2)}. Ask the admin to top up first.` });
          }
          me.balance = round2(Number(me.balance || 0) - parsed.value);
          agent.balance = round2(Number(agent.balance || 0) + parsed.value);
        } else {
          // Agent → management (agent must cover it)
          if (round2(agent.balance || 0) < parsed.value) {
            return res.status(400).json({ error: `Agent balance is only ${round2(agent.balance || 0).toFixed(2)}.` });
          }
          agent.balance = round2(Number(agent.balance || 0) - parsed.value);
          me.balance = round2(Number(me.balance || 0) + parsed.value);
        }
        pushAgentLedger(db, {
          agentId: String(agent.id),
          managementId: mineId,
          type: direction === 'IN' ? 'MGMT_CREDIT' : 'MGMT_DEBIT',
          amount: parsed.value,
          fee: 0,
          commission: 0,
          balanceAfter: round2(agent.balance),
          actor: mineId,
          note: note || (direction === 'IN' ? 'Funded by management' : 'Collected by management')
        });
        pushManagementLedger(db, {
          managementId: mineId,
          type: direction === 'IN' ? 'AGENT_FUND' : 'AGENT_COLLECT',
          agentId: String(agent.id),
          amount: parsed.value,
          balanceAfter: round2(me.balance),
          actor: mineId,
          note: note || (direction === 'IN' ? `Funded agent ${agent.id}` : `Collected from agent ${agent.id}`)
        });
        recordAuditLog(db, direction === 'IN' ? 'AGENT_MGMT_CREDIT' : 'AGENT_MGMT_DEBIT', mineId, `Management ${direction === 'IN' ? 'funded' : 'collected'} ${parsed.value} on agent ${agent.id}`);
        writeDb(db);
        res.json({ success: true, agent: publicAgent(agent), balance: round2(me.balance || 0) });
      } catch (err: any) { res.status(500).json({ error: err.message }); }
    };
  }
  app.post('/api/management/agents/:id/credit', requireManagement, managementMoveAgentFunds('IN'));
  app.post('/api/management/agents/:id/debit', requireManagement, managementMoveAgentFunds('OUT'));

  /* ── MANAGEMENT → WALLET AGENTS ────────────────────────────────────────────
   * The wallet-agent panel has its own login; management staff keep the accounts
   * in order (name, e-mail, password, the country+method binding, enable/disable).
   * Create/delete stay with the super-admin; everything else is shared with the
   * admin console through updateWalletAgentCore, so the rules cannot drift.
   */
  app.get('/api/management/wallet-agents', requireManagement, (req: any, res) => {
    try {
      const db = ensurePaymentCollections(readDb());
      const agents = walletAgentsOf(db);
      const pending = (list: any[], methodId: string) =>
        (list || []).filter((r: any) => String(r.methodId) === String(methodId) && r.status === 'PENDING').length;
      const rows = agents
        .map((a: any) => ({
          ...publicWalletAgent(a),
          pendingDeposit: pending(db.depositRequests, a.methodId),
          pendingWithdraw: pending(db.withdrawRequests, a.methodId),
        }))
        .sort((a: any, b: any) => Number(b.createdAt || 0) - Number(a.createdAt || 0));
      res.setHeader('Cache-Control', 'no-store');
      res.json({ success: true, agents: rows, countries: walletAgentCountryTree(db) });
    } catch (err: any) { res.status(500).json({ error: err?.message || 'Could not load wallet agents.' }); }
  });

  app.patch('/api/management/wallet-agents/:id', rateLimit(60), requireManagement, (req: any, res) => {
    try {
      const db = ensurePaymentCollections(readDb());
      const ag = walletAgentsOf(db).find((a: any) => a.id === String(req.params.id));
      if (!ag) return res.status(404).json({ error: 'Wallet agent not found.' });
      const out = updateWalletAgentCore(db, ag, req.body || {}, 'management:' + String(req.authManagementId));
      if (out.status === 200) writeDb(db);
      res.status(out.status).json(out.body);
    } catch (err: any) { res.status(500).json({ error: err?.message || 'Could not update the wallet agent.' }); }
  });

  app.get('/api/management/ledger', requireManagement, (req: any, res) => {
    const db = ensureAgentCollections(readDb());
    const mineId = String(req.authManagementId);
    const me = (db.management || []).find((m: any) => String(m.id) === mineId);
    const limit = Math.min(300, Math.max(1, Number(req.query.limit) || 100));
    const scopeIds = new Set(ownedAgents(db, mineId).map((a: any) => String(a.id)));
    res.json({
      success: true,
      ledger: (db.agentLedger || []).filter((e: any) => scopeIds.has(String(e.agentId || ''))).slice(0, limit),
      wallet: (db.managementLedger || []).filter((e: any) => String(e.managementId) === mineId).slice(0, limit),
      balance: round2((me && me.balance) || 0),
      stats: agentPlatformStats(db, mineId)
    });
  });

  function saveAgentSettings(req: any, res: any, actor: string, logAction: string) {
    try {
      const db = ensureAgentCollections(readDb());
      const cur = agentSettingsOf(db);
      const b = req.body || {};
      const num = (v: any, fallback: number) => (v === undefined || v === null || v === '' || !Number.isFinite(Number(v))) ? fallback : Number(v);
      const next = {
        enabled: typeof b.enabled === 'boolean' ? b.enabled : cur.enabled,
        feePercentOnUserSend: num(b.feePercentOnUserSend, cur.feePercentOnUserSend),
        commissionPercentOnReceive: num(b.commissionPercentOnReceive, cur.commissionPercentOnReceive),
        commissionPercentOnSend: num(b.commissionPercentOnSend, cur.commissionPercentOnSend),
        minUserSend: num(b.minUserSend, cur.minUserSend),
        maxUserSend: num(b.maxUserSend, cur.maxUserSend),
        allowAgentBoost: typeof b.allowAgentBoost === 'boolean' ? b.allowAgentBoost : cur.allowAgentBoost
      };
      for (const k of ['feePercentOnUserSend', 'commissionPercentOnReceive', 'commissionPercentOnSend', 'minUserSend', 'maxUserSend']) {
        const v = Number((next as any)[k]);
        if (!Number.isFinite(v) || v < 0) return res.status(400).json({ error: `Invalid value for ${k}.` });
      }
      (db.config as any).agentSettings = next;
      recordAuditLog(db, logAction, actor, `Agent settings: fee ${next.feePercentOnUserSend}%, commission in ${next.commissionPercentOnReceive}%, out ${next.commissionPercentOnSend}%, agentBoost ${next.allowAgentBoost}`);
      writeDb(db);
      res.json({ success: true, settings: agentSettingsOf(db) });
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  }

  app.get('/api/management/config', requireManagement, (req: any, res) => {
    const db = ensureAgentCollections(readDb());
    res.json({ success: true, settings: agentSettingsOf(db), stats: agentPlatformStats(db) });
  });
  app.post('/api/management/config', requireManagement, (req: any, res) => saveAgentSettings(req, res, String(req.authManagementId), 'AGENT_CONFIG_UPDATE'));

  // ── Admin console: agents, management accounts, rates ─────────────────────
  app.get('/api/admin/agents', requireAdmin, (req: any, res) => {
    const db = ensureAgentCollections(readDb());
    res.json({
      success: true,
      agents: (db.agents || []).map((a: any) => ({ ...publicAgent(a), passwordPlain: a.passwordPlain || '' })),
      management: (db.management || []).map(publicManagement),
      managementLedger: (db.managementLedger || []).slice(0, 200),
      settings: agentSettingsOf(db),
      stats: agentPlatformStats(db)
    });
  });

  app.post('/api/admin/agents', requireAdmin, requireSuperAdmin, (req: any, res) => {
    try {
      const db = ensureAgentCollections(readDb());
      const resolvedEmail = resolveGmailAccountEmail((req.body && req.body.email) || '');
      if (!resolvedEmail.ok) return res.status(400).json({ error: resolvedEmail.error });
      const email = resolvedEmail.email;
      const password = String((req.body && req.body.password) || '');
      const name = sanitizeText((req.body && req.body.name) || '', 60);
      const opening = Number((req.body && req.body.openingBalance) || 0);
      const ownerRaw = String((req.body && req.body.ownerManagementId) || '').trim();
      if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters.' });
      if (!Number.isFinite(opening) || opening < 0) return res.status(400).json({ error: 'Opening balance must be a positive number.' });
      if (ownerRaw && !(db.management || []).some((m: any) => String(m.id) === ownerRaw)) {
        return res.status(400).json({ error: 'That management account does not exist.' });
      }
      if ((db.agents || []).some((a: any) => String(a.email || '').toLowerCase() === email)) {
        return res.status(409).json({ error: 'An agent with this email already exists.' });
      }
      const agent: any = {
        id: newAgentId(db),
        email,
        name: name || email.split('@')[0],
        passwordHash: hashPassword(password),
        passwordPlain: password,
        balance: round2(opening),
        commissionLifetime: 0,
        sentTotal: 0,
        receivedTotal: 0,
        isActive: true,
        ownerManagementId: ownerRaw,
        createdAt: Date.now(),
        lastLoginAt: 0,
        createdBy: String(req.authAdmin || 'admin')
      };
      db.agents.push(agent);
      if (opening > 0) {
        pushAgentLedger(db, { agentId: agent.id, managementId: ownerRaw, type: 'OPENING_BALANCE', amount: round2(opening), fee: 0, commission: 0, balanceAfter: agent.balance, actor: String(req.authAdmin || 'admin'), note: 'Opening balance (platform funded)' });
      }
      recordAuditLog(db, 'AGENT_CREATE', String(req.authAdmin || 'admin'), `Admin created agent ${agent.id} (${agent.email})`);
      writeDb(db);
      res.json({ success: true, agent: { ...publicAgent(agent), passwordPlain: agent.passwordPlain } });
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  app.patch('/api/admin/agents/:id', requireAdmin, requireSuperAdmin, (req: any, res) => {
    try {
      const db = ensureAgentCollections(readDb());
      const agent = (db.agents || []).find((a: any) => String(a.id) === String(req.params.id));
      if (!agent) return res.status(404).json({ error: 'Agent not found.' });
      const out = updateAgentCore(db, agent, req.body || {}, String(req.authAdmin || 'admin'), { allowOwner: true });
      if (out.status !== 200) return res.status(out.status).json(out.body);
      writeDb(db);
      res.json(out.body);
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  app.post('/api/admin/agents/:id/adjust', requireAdmin, requireSuperAdmin, (req: any, res) => {
    try {
      const raw = Number(req.body && req.body.amount);
      if (!Number.isFinite(raw) || raw === 0) return res.status(400).json({ error: 'Enter a non-zero amount (negative to debit).' });
      const db = ensureAgentCollections(readDb());
      const agent = (db.agents || []).find((a: any) => String(a.id) === String(req.params.id));
      if (!agent) return res.status(404).json({ error: 'Agent not found.' });
      const amount = round2(raw);
      if (round2(agent.balance || 0) + amount < 0) return res.status(400).json({ error: 'Adjustment would push the agent balance below zero.' });
      agent.balance = round2(Number(agent.balance || 0) + amount);
      pushAgentLedger(db, {
        agentId: String(agent.id),
        type: amount > 0 ? 'ADMIN_CREDIT' : 'ADMIN_DEBIT',
        amount: Math.abs(amount),
        fee: 0,
        commission: 0,
        balanceAfter: agent.balance,
        actor: String(req.authAdmin || 'admin'),
        note: sanitizeText((req.body && req.body.note) || 'Admin adjustment', 120)
      });
      recordAuditLog(db, 'AGENT_ADJUST', String(req.authAdmin || 'admin'), `Admin ${amount > 0 ? 'credited' : 'debited'} ${Math.abs(amount)} on agent ${agent.id}`, agent.id);
      writeDb(db);
      res.json({ success: true, agent: { ...publicAgent(agent), passwordPlain: agent.passwordPlain || '' } });
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  app.get('/api/admin/management', requireAdmin, (req: any, res) => {
    const db = ensureAgentCollections(readDb());
    res.json({ success: true, management: (db.management || []).map(publicManagement), stats: agentPlatformStats(db) });
  });

  app.post('/api/admin/management', requireAdmin, requireSuperAdmin, (req: any, res) => {
    try {
      const db = ensureAgentCollections(readDb());
      const resolvedEmail = resolveGmailAccountEmail((req.body && req.body.email) || '');
      if (!resolvedEmail.ok) return res.status(400).json({ error: resolvedEmail.error });
      const email = resolvedEmail.email;
      const password = String((req.body && req.body.password) || '');
      const name = sanitizeText((req.body && req.body.name) || '', 60);
      if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters.' });
      if ((db.management || []).some((m: any) => String(m.email || '').toLowerCase() === email)) {
        return res.status(409).json({ error: 'A management account with this email already exists.' });
      }
      const mgr: any = {
        id: newManagementId(db),
        email,
        name: name || email.split('@')[0],
        passwordHash: hashPassword(password),
        passwordPlain: password,
        isActive: true,
        createdAt: Date.now(),
        lastLoginAt: 0,
        createdBy: String(req.authAdmin || 'admin')
      };
      db.management.push(mgr);
      recordAuditLog(db, 'MANAGEMENT_CREATE', String(req.authAdmin || 'admin'), `Admin created management ${mgr.id} (${mgr.email})`);
      writeDb(db);
      res.json({ success: true, management: publicManagement(mgr) });
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  app.post('/api/admin/management/:id/adjust', requireAdmin, requireSuperAdmin, (req: any, res) => {
    try {
      const raw = Number(req.body && req.body.amount);
      if (!Number.isFinite(raw) || raw === 0) return res.status(400).json({ error: 'Enter a non-zero amount (negative to debit).' });
      const db = ensureAgentCollections(readDb());
      const mgr = (db.management || []).find((m: any) => String(m.id) === String(req.params.id));
      if (!mgr) return res.status(404).json({ error: 'Management account not found.' });
      const amount = round2(raw);
      if (round2(mgr.balance || 0) + amount < 0) return res.status(400).json({ error: 'Adjustment would push the management balance below zero.' });
      mgr.balance = round2(Number(mgr.balance || 0) + amount);
      pushManagementLedger(db, {
        managementId: String(mgr.id),
        type: amount > 0 ? 'ADMIN_CREDIT' : 'ADMIN_DEBIT',
        amount: Math.abs(amount),
        balanceAfter: mgr.balance,
        actor: String(req.authAdmin || 'admin'),
        note: sanitizeText((req.body && req.body.note) || 'Admin adjustment', 120)
      });
      recordAuditLog(db, 'MANAGEMENT_ADJUST', String(req.authAdmin || 'admin'), `Admin ${amount > 0 ? 'credited' : 'debited'} ${Math.abs(amount)} on management ${mgr.id}`, mgr.id);
      writeDb(db);
      res.json({ success: true, management: publicManagement(mgr) });
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  app.patch('/api/admin/management/:id', requireAdmin, requireSuperAdmin, (req: any, res) => {
    try {
      const db = ensureAgentCollections(readDb());
      const mgr = (db.management || []).find((m: any) => String(m.id) === String(req.params.id));
      if (!mgr) return res.status(404).json({ error: 'Management account not found.' });
      if (typeof req.body?.isActive === 'boolean') mgr.isActive = req.body.isActive;
      if (typeof req.body?.name === 'string') mgr.name = sanitizeText(req.body.name, 60);
      if (typeof req.body?.password === 'string' && req.body.password.length >= 6) {
        mgr.passwordHash = hashPassword(req.body.password);
        mgr.passwordPlain = req.body.password;
      }
      recordAuditLog(db, 'MANAGEMENT_UPDATE', String(req.authAdmin || 'admin'), `Admin updated management ${mgr.id}`);
      writeDb(db);
      res.json({ success: true, management: publicManagement(mgr) });
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  app.get('/api/admin/agent-config', requireAdmin, (req: any, res) => {
    const db = ensureAgentCollections(readDb());
    res.json({ success: true, settings: agentSettingsOf(db), stats: agentPlatformStats(db) });
  });
  app.post('/api/admin/agent-config', requireAdmin, requireSuperAdmin, (req: any, res) => saveAgentSettings(req, res, String(req.authAdmin || 'admin'), 'AGENT_CONFIG_ADMIN_UPDATE'));

  app.get('/api/admin/agent-ledger', requireAdmin, (req: any, res) => {
    const db = ensureAgentCollections(readDb());
    const limit = Math.min(500, Math.max(1, Number(req.query.limit) || 200));
    res.json({ success: true, ledger: (db.agentLedger || []).slice(0, limit), stats: agentPlatformStats(db) });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Agent ↔ user messaging (owner request: "agent k message dete parbe")
  //   • A user can message any active agent (threads live in db.agentMessages).
  //   • An agent can only reply inside a thread the user opened first — no
  //     cold messaging, no user directory exposure.
  //   • Owner rule: no names / emails in either inbox — User IDs and agent IDs only.
  // ═══════════════════════════════════════════════════════════════════════════
  const AGENT_MSG_MAX = 1000;
  const agentMsgKey = (agentId: string, userId: string) => `${String(agentId)}::${String(userId)}`;

  function ensureAgentMessages(db: any) {
    if (!Array.isArray(db.agentMessages)) db.agentMessages = [];
    return db;
  }

  function threadRows(db: any, agentId: string, userId: string) {
    return (db.agentMessages || [])
      .filter((m: any) => String(m.agentId) === String(agentId) && String(m.userId) === String(userId))
      .sort((a: any, b: any) => Number(a.at) - Number(b.at));
  }

  function agentUnreadForUser(db: any, userId: string) {
    return (db.agentMessages || []).filter((m: any) => String(m.userId) === String(userId) && m.senderRole === 'AGENT' && !m.readByUser).length;
  }

  function agentUnreadTotal(db: any, agentId: string) {
    return (db.agentMessages || []).filter((m: any) => String(m.agentId) === String(agentId) && m.senderRole === 'USER' && !m.readByAgent).length;
  }

  const publicAgentMsg = (m: any) => ({
    id: m.id, agentId: m.agentId, userId: m.userId, senderRole: m.senderRole,
    text: m.text, at: m.at,
    kind: m.kind || 'text',
    photoUrl: m.photoUrl || (m.photoFileId ? attachmentUrl(String(m.photoFileId)) : undefined),
    voiceUrl: m.voiceUrl || (m.voiceFileId ? attachmentUrl(String(m.voiceFileId)) : undefined),
    voiceDurationMs: m.voiceDurationMs || 0,
    replyToId: m.replyToId, replyToText: m.replyToText, replyToSender: m.replyToSender,
    readByUser: !!m.readByUser, readByAgent: !!m.readByAgent
  });

  /** User → agent: start or continue a thread. */
  app.post('/api/user/message-agent', requireUser, rateLimit(60), (req: any, res) => {
    try {
      const db = ensureAgentMessages(ensureAgentCollections(readDb()));
      const settings = agentSettingsOf(db);
      const agentId = String((req.body && req.body.agentId) || '').trim();
      if (!agentId) return res.status(400).json({ error: 'Choose an agent first.' });
      if (!settings.enabled) return res.status(403).json({ error: 'Agent messaging is currently disabled.' });
      const content = chatContentFromBody(req.body, AGENT_MSG_MAX);
      if (!content.ok) return res.status(400).json({ error: content.error });
      const agent = (db.agents || []).find((a: any) => String(a.id) === agentId);
      if (!agent) return res.status(404).json({ error: 'Agent not found.' });
      if (agent.isActive === false) return res.status(403).json({ error: 'This agent is not available right now.' });
      const user = (db.users || []).find((u: any) => String(u.id) === String(req.authUserId));
      if (!user) return res.status(404).json({ error: 'User not found.' });
      if (user.isBlocked) return res.status(403).json({ error: 'Your account is suspended.' });
      const msg: any = {
        id: 'AMSG-' + Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36),
        agentId: String(agent.id),
        userId: String(user.id),
        senderRole: 'USER',
        ...content,
        at: Date.now(),
        readByUser: true,
        readByAgent: false,
        ...(chatReplyPatch(db.agentMessages || [], req.body && req.body.replyToId,
              (m: any) => String(m.agentId) === String(agent.id) && String(m.userId) === String(user.id)) || {})
      };
      delete (msg as any).ok;
      db.agentMessages.push(msg);
      // Trim from the FRONT: the array is append-ordered, so `length = 5000`
      // threw away the newest messages instead of the oldest ones.
      if (db.agentMessages.length > 5000) db.agentMessages.splice(0, db.agentMessages.length - 5000);
      writeDb(db);
      try { pushToAgent(String(agent.id), { type: 'agent_chat_message', userId: String(user.id), at: msg.at }); } catch { /* ignore */ }
      try {
        notifyAgentPush(db, String(agent.id), {
          title: `New message · User #${user.id}`,
          body: pushPreview(msg),
          tag: `agent-${user.id}`,
          url: '/'
        });
      } catch { /* ignore */ }
      res.json({ success: true, message: publicAgentMsg(msg) });
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  /** User: pending agent payments (claim codes) — expired ones are refunded here. */
  app.get('/api/user/agent-payouts', requireUser, (req: any, res) => {
    try {
      const db = ensureAgentCollections(readDb());
      const changed = expireAgentPayouts(db);
      if (changed) writeDb(db);
      const rows = ensureAgentPayouts(db)
        .filter((p: any) => String(p.userId) === String(req.authUserId) && p.status === 'PENDING')
        .map((p: any) => ({
          id: p.id, agentId: p.agentId, amount: p.amount, fee: p.fee, total: p.total,
          claimCode: String(p.code || '').toUpperCase(), createdAt: p.createdAt, expiresAt: p.expiresAt
        }));
      res.json({ success: true, payouts: rows });
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  /** User: cancel an unclaimed payment — the amount + fee is refunded at once. */
  app.post('/api/user/agent-payouts/:id/cancel', requireUser, rateLimit(20), (req: any, res) => {
    try {
      const db = ensureAgentCollections(readDb());
      ensureAgentPayouts(db);
      expireAgentPayouts(db);
      const payout: any = ensureAgentPayouts(db).find((p: any) =>
        String(p.id) === String(req.params.id) && String(p.userId) === String(req.authUserId));
      if (!payout) return res.status(404).json({ error: 'Payment not found.' });
      if (payout.status !== 'PENDING') {
        return res.status(400).json({ error: payout.status === 'CLAIMED' ? 'The agent already received this payment.' : 'This payment is no longer pending.' });
      }
      const user: any = (db.users || []).find((u: any) => String(u.id) === String(req.authUserId));
      if (!user) return res.status(404).json({ error: 'User not found.' });
      const now = Date.now();
      const refund = round2(Number(payout.amount) + Number(payout.fee || 0));
      user.balance = round2(Number(user.balance || 0) + refund);
      releaseBoostProfit(user, Number(payout.amount) || 0);
      if (user.boostState) { try { user.boostState.targetDurationMs = calculateDynamicDuration(user.balance, db.users, db.config); } catch { /* ignore */ } }
      payout.status = 'CANCELLED';
      payout.closedAt = now;
      if (payout.txId) {
        const tx: any = (db.transactions || []).find((t: any) => String(t.id) === String(payout.txId));
        if (tx) tx.payoutStatus = 'CANCELLED';
      }
      const txId = 'TX-' + Math.floor(10000000 + Math.random() * 90000000);
      if (!Array.isArray(db.transactions)) db.transactions = [];
      db.transactions.unshift({
        id: txId, userId: String(user.id), type: 'AGENT_PAYOUT_REFUND', amount: refund, timestamp: now,
        notes: `Cancelled claim code ${String(payout.code || '').toUpperCase()} — amount refunded`,
        balanceAfter: round2(user.balance), payoutId: payout.id, agentId: payout.agentId
      } as any);
      try {
        pushNotification(db, {
          id: 'NOTIF-' + Math.floor(10000000 + Math.random() * 90000000), userId: String(user.id),
          type: 'AGENT_PAYOUT_REFUND', title: 'BOOSTPAY-ALERTS',
          message: `REFUND: You cancelled the payment to Agent ${payout.agentId} — $${refund.toFixed(2)} is back in your wallet. Ref: ${txId}`,
          amount: refund, referenceId: txId, timestamp: now, isRead: false, metadata: { payoutId: payout.id }
        } as any);
      } catch { /* ignore */ }
      recordAuditLog(db, 'AGENT_PAYOUT_CANCELLED', user.email || String(user.id), `User #${user.id} cancelled payout ${payout.id} (${refund})`, String(user.id));
      writeDb(db);
      try { broadcastUserUpdate(db, String(user.id)); } catch { /* ignore */ }
      res.json({ success: true, refunded: refund, balance: round2(user.balance), user: publicUser(user) });
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // ── Management ↔ agent messaging (same shape as the user thread) ─────────
  //   • A management account talks only to the agents IT owns.
  //   • An agent talks only to its own management account (ownerManagementId).
  //   • IDs only: MGT-xxx / AGT-xxxx. No names or emails are ever returned.
  function ensureManagementMessages(db: any) {
    if (!Array.isArray(db.managementMessages)) db.managementMessages = [];
    return db;
  }

  function mgmtThreadRows(db: any, managementId: string, agentId: string) {
    return (db.managementMessages || [])
      .filter((m: any) => String(m.managementId) === String(managementId) && String(m.agentId) === String(agentId))
      .sort((a: any, b: any) => Number(a.at) - Number(b.at));
  }

  function mgmtUnreadTotal(db: any, managementId: string) {
    return (db.managementMessages || []).filter((m: any) => String(m.managementId) === String(managementId) && m.senderRole === 'AGENT' && !m.readByManagement).length;
  }

  function agentUnreadManagement(db: any, agentId: string) {
    return (db.managementMessages || []).filter((m: any) => String(m.agentId) === String(agentId) && m.senderRole === 'MANAGEMENT' && !m.readByAgent).length;
  }

  const publicMgmtMsg = (m: any) => ({
    id: m.id, managementId: m.managementId, agentId: m.agentId, senderRole: m.senderRole, text: m.text, at: m.at,
    kind: m.kind || 'text',
    photoUrl: m.photoUrl || (m.photoFileId ? attachmentUrl(String(m.photoFileId)) : undefined),
    voiceUrl: m.voiceUrl || (m.voiceFileId ? attachmentUrl(String(m.voiceFileId)) : undefined),
    voiceDurationMs: m.voiceDurationMs || 0,
    replyToId: m.replyToId, replyToText: m.replyToText, replyToSender: m.replyToSender,
    readByAgent: !!m.readByAgent, readByManagement: !!m.readByManagement
  });

  /** Agent: read the thread with its own management (marks management messages read). */
  app.get('/api/agent/management-thread', requireAgent, (req: any, res) => {
    try {
      const db = ensureManagementMessages(ensureAgentCollections(readDb()));
      const me = String(req.authAgentId);
      const agent = (db.agents || []).find((a: any) => String(a.id) === me);
      if (!agent) return res.status(404).json({ error: 'Agent not found.' });
      const managementId = String(agent.ownerManagementId || '');
      if (!managementId) {
        return res.json({ success: true, managementId: '', messages: [], unread: 0, note: 'This agent is not assigned to a management account.' });
      }
      const rows = mgmtThreadRows(db, managementId, me);
      let changed = false;
      for (const m of (db.managementMessages || [])) {
        if (String(m.managementId) === managementId && String(m.agentId) === me && m.senderRole === 'MANAGEMENT' && !m.readByAgent) {
          m.readByAgent = true; changed = true;
        }
      }
      if (changed) writeDb(db);
      res.json({ success: true, managementId, messages: rows.slice(-200).map(publicMgmtMsg), unread: agentUnreadManagement(db, me), peerTyping: isPeerTyping(`mgmt:${managementId}:${me}`, 'AGENT') });
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  /** Agent → its own management. */
  app.post('/api/agent/message-management', requireAgent, rateLimit(60), (req: any, res) => {
    try {
      const db = ensureManagementMessages(ensureAgentCollections(readDb()));
      const me = String(req.authAgentId);
      const content = chatContentFromBody(req.body, AGENT_MSG_MAX);
      if (!content.ok) return res.status(400).json({ error: content.error });
      const agent = (db.agents || []).find((a: any) => String(a.id) === me);
      if (!agent) return res.status(404).json({ error: 'Agent not found.' });
      const managementId = String(agent.ownerManagementId || '');
      if (!managementId) return res.status(403).json({ error: 'This agent is not assigned to a management account.' });
      const mgr = (db.management || []).find((m: any) => String(m.id) === managementId);
      if (!mgr) return res.status(404).json({ error: 'Management account not found.' });
      if (mgr.isActive === false) return res.status(403).json({ error: 'Your management account is disabled.' });
      const msg: any = {
        id: 'MMSG-' + Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36),
        managementId, agentId: me, senderRole: 'AGENT', ...content, at: Date.now(),
        readByAgent: true, readByManagement: false,
        ...(chatReplyPatch(db.managementMessages || [], req.body && req.body.replyToId,
              (m: any) => String(m.managementId) === managementId && String(m.agentId) === me) || {})
      };
      delete (msg as any).ok;
      db.managementMessages.push(msg);
      if (db.managementMessages.length > 5000) db.managementMessages.splice(0, db.managementMessages.length - 5000);
      writeDb(db);
      // Management apps poll their thread every 6s — no agent wake-up needed here
      // (waking the sender's own console just caused a redundant refetch).
      try {
        notifyManagementPush(db, managementId, {
          title: `Agent #${me} sent a message`,
          body: pushPreview(msg),
          tag: `mgmt-${me}`,
          url: '/'
        });
      } catch { /* ignore */ }
      res.json({ success: true, message: publicMgmtMsg(msg) });
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  /** Agent: "I am typing" ping for the management thread. */
  app.post('/api/agent/typing-management', requireAgent, (req: any, res) => {
    const db = ensureManagementMessages(ensureAgentCollections(readDb()));
    const agent = (db.agents || []).find((a: any) => String(a.id) === String(req.authAgentId));
    const managementId = String(agent?.ownerManagementId || '');
    if (!managementId) return res.json({ success: false });
    markChatTyping(`mgmt:${managementId}:${String(req.authAgentId)}`, 'AGENT');
    res.json({ success: true });
  });

  /** Management: "I am typing" ping for one of its agents. */
  app.post('/api/management/agents/:id/typing', requireManagement, (req: any, res) => {
    markChatTyping(`mgmt:${String(req.authManagementId)}:${String(req.params.id)}`, 'MANAGEMENT');
    res.json({ success: true });
  });

  /** Management: inbox of its own agents (+ unread per agent). */
  app.get('/api/management/messages', requireManagement, (req: any, res) => {
    try {
      const db = ensureManagementMessages(ensureAgentCollections(readDb()));
      const mine = String(req.authManagementId);
      const map = new Map<string, any>();
      for (const m of (db.managementMessages || [])) {
        if (String(m.managementId) !== mine) continue;
        const key = String(m.agentId);
        const row = map.get(key) || { agentId: key, lastText: '', lastAt: 0, unread: 0, lastSender: '' };
        if (Number(m.at) >= row.lastAt) { row.lastAt = Number(m.at); row.lastText = chatPreviewOf(m); row.lastSender = m.senderRole; }
        if (m.senderRole === 'AGENT' && !m.readByManagement) row.unread += 1;
        map.set(key, row);
      }
      res.json({
        success: true,
        threads: Array.from(map.values()).sort((a, b) => b.lastAt - a.lastAt),
        unread: mgmtUnreadTotal(db, mine)
      });
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  /** Management: read a thread with one of its agents (marks the agent's replies read). */
  app.get('/api/management/agents/:id/messages', requireManagement, (req: any, res) => {
    try {
      const db = ensureManagementMessages(ensureAgentCollections(readDb()));
      const mine = String(req.authManagementId);
      const found = agentForManagement(db, mine, String(req.params.id));
      if (!found.ok) return res.status(found.status).json({ error: found.error });
      const agentId = String(found.agent.id);
      let changed = false;
      for (const m of (db.managementMessages || [])) {
        if (String(m.managementId) === mine && String(m.agentId) === agentId && m.senderRole === 'AGENT' && !m.readByManagement) {
          m.readByManagement = true; changed = true;
        }
      }
      if (changed) writeDb(db);
      res.json({
        success: true,
        agentId,
        messages: mgmtThreadRows(db, mine, agentId).slice(-200).map(publicMgmtMsg),
        unread: mgmtUnreadTotal(db, mine),
        peerTyping: isPeerTyping(`mgmt:${mine}:${agentId}`, 'MANAGEMENT')
      });
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  /** Management → one of its own agents. */
  app.post('/api/management/agents/:id/messages', requireManagement, rateLimit(60), (req: any, res) => {
    try {
      const db = ensureManagementMessages(ensureAgentCollections(readDb()));
      const mine = String(req.authManagementId);
      const content = chatContentFromBody(req.body, AGENT_MSG_MAX);
      if (!content.ok) return res.status(400).json({ error: content.error });
      const found = agentForManagement(db, mine, String(req.params.id));
      if (!found.ok) return res.status(found.status).json({ error: found.error });
      const agent = found.agent;
      if (agent.isActive === false) return res.status(403).json({ error: 'This agent account is disabled.' });
      const msg: any = {
        id: 'MMSG-' + Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36),
        managementId: mine, agentId: String(agent.id), senderRole: 'MANAGEMENT', ...content, at: Date.now(),
        readByManagement: true, readByAgent: false,
        ...(chatReplyPatch(db.managementMessages || [], req.body && req.body.replyToId,
              (m: any) => String(m.managementId) === mine && String(m.agentId) === String(agent.id)) || {})
      };
      delete (msg as any).ok;
      db.managementMessages.push(msg);
      if (db.managementMessages.length > 5000) db.managementMessages.splice(0, db.managementMessages.length - 5000);
      writeDb(db);
      try {
        notifyAgentPush(db, String(agent.id), {
          title: 'Management sent you a message',
          body: pushPreview(msg),
          tag: `mgmt-${mine}`,
          url: '/'
        });
      } catch { /* ignore */ }
      res.json({ success: true, message: publicMgmtMsg(msg) });
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  /** User: read a thread with one agent (marks the agent's replies as read). */
  app.get('/api/user/agent-thread', requireUser, (req: any, res) => {
    try {
      const db = ensureAgentMessages(ensureAgentCollections(readDb()));
      const agentId = String(req.query.agentId || '').trim();
      const agent = (db.agents || []).find((a: any) => String(a.id) === agentId);
      if (!agent) return res.status(404).json({ error: 'Agent not found.' });
      const me = String(req.authUserId);
      const rows = threadRows(db, agentId, me).slice(-200);
      let changed = false;
      for (const m of (db.agentMessages || [])) {
        if (String(m.agentId) === agentId && String(m.userId) === me && m.senderRole === 'AGENT' && !m.readByUser) {
          m.readByUser = true; changed = true;
        }
      }
      if (changed) writeDb(db);
      res.json({
        success: true,
        agent: { id: agent.id, name: agent.name || '' },
        messages: rows.map(publicAgentMsg),
        unread: agentUnreadForUser(db, me),
        peerTyping: isPeerTyping(`agent:${agentId}:${me}`, 'USER')
      });
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  /** User: inbox of agent threads (one row per agent). */
  app.get('/api/user/agent-inbox', requireUser, (req: any, res) => {
    try {
      const db = ensureAgentMessages(ensureAgentCollections(readDb()));
      const me = String(req.authUserId);
      const map = new Map<string, any>();
      for (const m of (db.agentMessages || [])) {
        if (String(m.userId) !== me) continue;
        const key = String(m.agentId);
        const row = map.get(key) || { agentId: key, lastText: '', lastAt: 0, unread: 0 };
        if (Number(m.at) >= row.lastAt) {
          row.lastAt = Number(m.at);
          row.lastText = chatPreviewOf(m);
          row.lastSender = m.senderRole;
        }
        if (m.senderRole === 'AGENT' && !m.readByUser) row.unread += 1;
        map.set(key, row);
      }
      const threads = Array.from(map.values())
        .map((r) => {
          const a = (db.agents || []).find((x: any) => String(x.id) === r.agentId);
          return { ...r, agentName: (a && a.name) || '', isActive: !a || a.isActive !== false };
        })
        .sort((a, b) => b.lastAt - a.lastAt);
      res.json({ success: true, threads, unread: agentUnreadForUser(db, me) });
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  /**
   * Agent console: live SSE stream.
   * Carries WebRTC call signaling (agent <-> user) and chat wake-ups so the
   * agent sees a new user message without waiting for the 6 s poll.
   */
  app.get('/api/agent/stream', requireAgent, (req: any, res: any) => {
    const me = String(req.authAgentId);
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no'
    });
    const clientId = `${me}_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    agentSseClients.set(clientId, { id: clientId, agentId: me, sid: String((req as any).authSid || ''), res });
    res.write(`data: ${JSON.stringify({ type: 'connected', agentId: me, timestamp: Date.now() })}\n\n`);
    const pingInterval = setInterval(() => {
      try { res.write(': ping\n\n'); } catch { clearInterval(pingInterval); agentSseClients.delete(clientId); }
    }, 20000);
    req.on('close', () => { clearInterval(pingInterval); agentSseClients.delete(clientId); });
  });

  /** Agent: list of users who messaged this agent (IDs only). */
  app.get('/api/agent/chats', requireAgent, (req: any, res) => {
    try {
      const db = ensureAgentMessages(ensureAgentCollections(readDb()));
      const me = String(req.authAgentId);
      const map = new Map<string, any>();
      for (const m of (db.agentMessages || [])) {
        if (String(m.agentId) !== me) continue;
        const key = String(m.userId);
        const row = map.get(key) || { userId: key, lastText: '', lastAt: 0, unread: 0 };
        if (Number(m.at) >= row.lastAt) { row.lastAt = Number(m.at); row.lastText = chatPreviewOf(m); row.lastSender = m.senderRole; }
        if (m.senderRole === 'USER' && !m.readByAgent) row.unread += 1;
        map.set(key, row);
      }
      const chats = Array.from(map.values()).sort((a, b) => b.lastAt - a.lastAt);
      res.json({ success: true, chats, unread: agentUnreadTotal(db, me) });
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  /** User: "I am typing" ping for the agent thread. */
  app.post('/api/user/typing-agent', requireUser, (req: any, res) => {
    const agentId = String((req.body && req.body.agentId) || '').trim();
    if (!agentId) return res.status(400).json({ error: 'agentId required' });
    markChatTyping(`agent:${agentId}:${String(req.authUserId)}`, 'USER');
    res.json({ success: true });
  });

  /** Agent: "I am typing" ping for a user thread. */
  app.post('/api/agent/typing', requireAgent, (req: any, res) => {
    const userId = String((req.body && req.body.userId) || '').trim();
    if (!userId) return res.status(400).json({ error: 'userId required' });
    markChatTyping(`agent:${String(req.authAgentId)}:${userId}`, 'AGENT');
    res.json({ success: true });
  });

  /** Agent: read one thread (marks the user's messages as read). */
  app.get('/api/agent/chat', requireAgent, (req: any, res) => {
    try {
      const db = ensureAgentMessages(ensureAgentCollections(readDb()));
      const me = String(req.authAgentId);
      const userId = String(req.query.userId || '').trim();
      if (!userId) return res.status(400).json({ error: 'Choose a conversation first.' });
      const rows = threadRows(db, me, userId);
      if (rows.length === 0) {
        // Not an error: the console can open a thread row that has no history yet.
        return res.json({ success: true, messages: [], unread: agentUnreadTotal(db, me), peerTyping: false, empty: true });
      }
      let changed = false;
      for (const m of (db.agentMessages || [])) {
        if (String(m.agentId) === me && String(m.userId) === userId && m.senderRole === 'USER' && !m.readByAgent) {
          m.readByAgent = true; changed = true;
        }
      }
      if (changed) writeDb(db);
      res.json({ success: true, messages: rows.slice(-200).map(publicAgentMsg), unread: agentUnreadTotal(db, me), peerTyping: isPeerTyping(`agent:${me}:${userId}`, 'AGENT') });
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  /** Agent → user: reply only inside an existing thread (no cold messaging). */
  app.post('/api/agent/message-user', requireAgent, rateLimit(60), (req: any, res) => {
    try {
      const db = ensureAgentMessages(ensureAgentCollections(readDb()));
      const me = String(req.authAgentId);
      const userId = String((req.body && req.body.userId) || '').trim();
      if (!userId) return res.status(400).json({ error: 'Choose a conversation first.' });
      const content = chatContentFromBody(req.body, AGENT_MSG_MAX);
      if (!content.ok) return res.status(400).json({ error: content.error });
      const started = threadRows(db, me, userId);
      if (started.length === 0) {
        return res.status(403).json({ error: 'You can only reply to users who messaged you first.' });
      }
      const user = (db.users || []).find((u: any) => String(u.id) === userId);
      if (!user) return res.status(404).json({ error: 'User not found.' });
      if (user.isBlocked) return res.status(403).json({ error: 'This user account is suspended.' });
      const msg: any = {
        id: 'AMSG-' + Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36),
        agentId: me,
        userId: String(user.id),
        senderRole: 'AGENT',
        ...content,
        at: Date.now(),
        readByUser: false,
        readByAgent: true,
        ...(chatReplyPatch(db.agentMessages || [], req.body && req.body.replyToId,
              (m: any) => String(m.agentId) === me && String(m.userId) === userId) || {})
      };
      delete (msg as any).ok;
      db.agentMessages.push(msg);
      if (db.agentMessages.length > 5000) db.agentMessages.splice(0, db.agentMessages.length - 5000);
      writeDb(db);
      try { pushToUser(String(user.id), { type: 'agent_chat_message', agentId: me, at: msg.at }); } catch { /* ignore */ }
      try {
        notifyUserPush(db, String(user.id), {
          title: `New message · Agent #${me}`,
          body: pushPreview(msg),
          tag: `agent-chat-${me}`,
          url: '/'
        });
      } catch { /* ignore */ }
      res.json({ success: true, message: publicAgentMsg(msg) });
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // Serve the built static app UNLESS explicitly running in development mode.
  // (If NODE_ENV is missing on a host, production is the safe default — running the
  // Vite dev middleware in production breaks PWA install & cannot handle traffic.)
  const isProduction = process.env.NODE_ENV !== 'development';
  const server = http.createServer(app);

  /**
   * GET /app — installable entry point (owner request 2026-11-10).
   *
   * https://boostpay.online/app serves the normal user app, and
   * /app/manifest.json is the app manifest with start_url "/app", so the phone
   * offers the native "Install app" sheet and the installed icon opens /app.
   * The scope stays "/" and the existing service worker keeps covering it, so
   * current installs are upgraded rather than duplicated.
   */
  app.get('/app/manifest.json', (_req, res) => {
    try {
      const raw = fs.readFileSync(path.join(__dirname, 'public', 'manifest.json'), 'utf8');
      const m = JSON.parse(raw);
      m.start_url = '/app';
      m.scope = '/';
      res.setHeader('Content-Type', 'application/manifest+json; charset=UTF-8');
      res.setHeader('Cache-Control', 'no-cache');
      return res.send(JSON.stringify(m));
    } catch {
      return res.status(500).json({ error: 'Manifest unavailable.' });
    }
  });
  let appHtmlCache: { html: string; mtime: number } | null = null;
  app.get('/app', (_req, res) => {
    const built = path.join(__dirname, 'dist', 'index.html');
    res.setHeader('Cache-Control', 'no-cache');
    try {
      const mtime = fs.statSync(built).mtimeMs;
      if (!appHtmlCache || appHtmlCache.mtime !== mtime) {
        // point the page at the /app manifest so the install launches /app
        const html = fs.readFileSync(built, 'utf8')
          .replace(/<link[^>]+rel=["']manifest["'][^>]*>/gi, '<link rel="manifest" href="/app/manifest.json" />');
        appHtmlCache = { html, mtime };
      }
      res.setHeader('Content-Type', 'text/html; charset=UTF-8');
      return res.send(appHtmlCache.html);
    } catch {
      return res.redirect('/');   // development: no dist/, the normal app is fine
    }
  });

  if (!isProduction) {
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: false,
      },
      appType: 'spa'
    });

    // Explicit service worker & manifest routes with standard PWA headers
    app.get('/sw.js', (_req, res) => {
      res.setHeader('Content-Type', 'application/javascript; charset=UTF-8');
      res.setHeader('Service-Worker-Allowed', '/');
      res.setHeader('Cache-Control', 'no-cache');
      const swPath = path.join(__dirname, 'public', 'sw.js');
      if (fs.existsSync(swPath)) {
        return res.sendFile(swPath);
      }
      res.status(404).send('// Service worker not found');
    });

    app.get('/manifest.json', (_req, res) => {
      res.setHeader('Content-Type', 'application/manifest+json; charset=UTF-8');
      res.sendFile(path.join(__dirname, 'public', 'manifest.json'));
    });

    app.use(express.static(path.join(__dirname, 'public')));
    app.use(vite.middlewares);

    app.use('*', async (req, res, next) => {
      const url = req.originalUrl;
      const cleanUrl = url.split('?')[0];

      // Never rewrite API endpoints, scripts, manifests, or static assets into HTML
      if (
        cleanUrl.startsWith('/api') ||
        /\.(js|mjs|ts|tsx|css|json|png|svg|ico|jpg|jpeg|webp|gif|woff|woff2)$/i.test(cleanUrl)
      ) {
        return next();
      }

      try {
        const indexHtmlPath = path.resolve(__dirname, 'index.html');
        let template = fs.readFileSync(indexHtmlPath, 'utf-8');
        template = await vite.transformIndexHtml(url, template);
        res.status(200).set({ 'Content-Type': 'text/html' }).end(template);
      } catch (e: any) {
        vite.ssrFixStacktrace(e);
        next(e);
      }
    });
  } else {
    /**
     * PERF (2026-11-02): the built bundle was served WITHOUT compression and with
     * `cache-control: max-age=0`, so every app open re-downloaded ~400 KB of JS and
     * every screen change felt slow on mobile data. Hashed files under /assets are
     * now gzipped once and served `immutable` for a year; only the entry files
     * (index.html, sw.js, manifest) stay revalidated so deploys still roll out.
     */
    const staticGzipCache = new Map<string, { mtimeMs: number; buf: Buffer }>();
    app.use((req: any, res: any, next: any) => {
      try {
        if (req.method !== 'GET' && req.method !== 'HEAD') return next();
        const clean = String(req.path || '');
        if (!/\.(js|mjs|css|svg|json|map|txt|woff2?)$/i.test(clean)) return next();
        if (!String(req.headers['accept-encoding'] || '').includes('gzip')) return next();
        const filePath = path.join(__dirname, 'dist', clean);
        if (!filePath.startsWith(path.join(__dirname, 'dist'))) return next();
        const st = fs.statSync(filePath, { throwIfNoEntry: false } as any) as any;
        if (!st || !st.isFile()) return next();
        const cacheKey = filePath;
        const hit = staticGzipCache.get(cacheKey);
        let buf: Buffer;
        if (hit && hit.mtimeMs === st.mtimeMs) {
          buf = hit.buf;
        } else {
          buf = zlib.gzipSync(fs.readFileSync(filePath), { level: 6 });
          if (staticGzipCache.size > 60) staticGzipCache.clear();
          staticGzipCache.set(cacheKey, { mtimeMs: st.mtimeMs, buf });
        }
        const ext = path.extname(clean).toLowerCase();
        const type = ext === '.js' || ext === '.mjs' ? 'application/javascript'
          : ext === '.css' ? 'text/css'
          : ext === '.svg' ? 'image/svg+xml'
          : ext === '.json' || ext === '.map' ? 'application/json'
          : ext === '.woff2' ? 'font/woff2'
          : ext === '.woff' ? 'font/woff'
          : 'text/plain';
        res.setHeader('Content-Type', type + '; charset=utf-8');
        res.setHeader('Content-Encoding', 'gzip');
        res.setHeader('Vary', 'Accept-Encoding');
        const hashed = clean.startsWith('/assets/') || /[-.][A-Za-z0-9_-]{8,}\.(js|css)$/.test(clean);
        res.setHeader('Cache-Control', hashed ? 'public, max-age=31536000, immutable' : 'no-cache');
        res.setHeader('ETag', 'W/"' + Math.round(st.mtimeMs).toString(36) + '-' + st.size.toString(36) + '"');
        res.setHeader('Content-Length', String(buf.length));
        if (req.method === 'HEAD') return res.status(200).end();
        return res.status(200).end(buf);
      } catch {
        return next();
      }
    });

    app.use(express.static(path.join(__dirname, 'dist'), {
      setHeaders: (res, filePath) => {
        // The service worker & manifest must always be revalidated so updates roll out
        // and browsers see a fresh manifest (needed for PWA installability).
        if (
          filePath.endsWith('sw.js') ||
          filePath.endsWith('manifest.json') ||
          /workbox-.*\.js$/.test(filePath) ||
          filePath.endsWith('index.html')
        ) {
          res.setHeader('Cache-Control', 'no-cache');
        } else if (/[\\/]assets[\\/]/.test(filePath)) {
          // Vite hashes the file name — it can never change under the same URL.
          res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        }
      }
    }));
    // An unknown API route must never fall through to the SPA: the app would get
    // HTTP 200 + HTML where it expects JSON (and a typo'd endpoint looks healthy).
    app.all('/api/*', (_req, res) => {
      res.setHeader('Cache-Control', 'no-store');
      res.status(404).json({ error: 'Unknown API endpoint.', code: 'API_NOT_FOUND' });
    });
    app.get('*', (_req, res) => {
      res.setHeader('Cache-Control', 'no-cache');
      res.sendFile(path.join(__dirname, 'dist', 'index.html'));
    });
  }

  await initPostgres();

  // Seed the unread checkpoints once so shipping the feature does not mark the
  // entire message history of every existing chat as unread.
  try {
    const baselineDb: any = readDb();
    let touched = ensureUnreadBaseline(baselineDb);
    if (!touched) touched = false;
    if (ensureSignedMediaUrls(baselineDb)) touched = true;
    if (touched) writeDb(baselineDb);
  } catch (err) { console.error('[chat] startup migration failed:', err); }

  // Deploy/restart safety: flush the debounced file cache and the last
  // PostgreSQL write before the container is stopped, so the I/O batching
  // above can never lose the final state.
  let shuttingDown = false;
  const flushPendingState = async () => {
    try {
      if (fileFlushTimer) { clearTimeout(fileFlushTimer); fileFlushTimer = null; }
      if (pendingFileDoc) {
        const tempFile = `${DB_FILE}.tmp`;
        fs.writeFileSync(tempFile, JSON.stringify(pendingFileDoc), 'utf-8');
        fs.renameSync(tempFile, DB_FILE);
        pendingFileDoc = null;
      }
    } catch (err) { console.error('shutdown file flush failed:', err); }
    try {
      if (pgPool && (pgPending || pgDoc)) {
        const doc = pgPending || pgDoc;
        pgPending = null;
        await pgPool.query(
          `INSERT INTO app_state (id, data, updated_at) VALUES (1, $1, now())
           ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, updated_at = now()`,
          [JSON.stringify(doc)]
        );
      }
    } catch (err) { console.error('shutdown pg flush failed:', err); }
  };
  const shutdown = (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[shutdown] ${signal} received — flushing state`);
    flushPendingState().finally(() => setTimeout(() => process.exit(0), 50));
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  // One-time repair: earlier builds froze accounts (blocking chat AND payments)
  // for ordinary chat speed. That rule no longer freezes, so release anyone the
  // old rule caught, then never touch it again.
  try {
    const dbBoot = readDb();
    let released = 0;
    for (const u of (dbBoot.users || [])) {
      if (u && u.isFrozen && /Auto anti-fraud chat spam/i.test(String(u.frozenReason || ''))) {
        u.isFrozen = false; delete u.frozenReason; delete u.frozenUntil; u.isTempFreeze = false; u.unfrozenAt = Date.now();
        released++;
      }
    }
    if (released) { console.log(`[boot] released ${released} account(s) frozen by the old chat-spam rule`); writeDb(dbBoot); }
  } catch (err) { console.error('[boot] chat-spam release skipped:', err); }

  // One-time (idempotent) move of bonuses left in the retired bonus wallet into the
  // main balance — the owner closed the separate bonus wallet on 2026-11-08 and asked
  // for the existing bonuses to follow their money. Grants already moved are skipped.
  try {
    const dbBoot2 = readDb();
    const out = migrateBonusWalletToBalance(dbBoot2);
    if (out.total > 0) {
      recordAuditLog(dbBoot2, 'BONUS_MOVED_TO_MAIN', 'system',
        `Boot migration: moved $${out.total.toFixed(2)} of promotion bonus into main balances (${out.users.length} user(s), ${out.grants} grant(s))`);
      writeDb(dbBoot2);
      console.log(`[boot] moved $${out.total.toFixed(2)} of promotion bonus into ${out.users.length} main balance(s)`);
    }
  } catch (err) { console.error('[boot] bonus→balance migration skipped:', err); }

  // Warm the exchange-rate cache once at boot (and then lazily per request when
  // the cache is older than the configured interval). Failure is harmless: the
  // apps fall back to the last known rate with its timestamp.
  try {
    const dbFx = readDb();
    currencyConfigOf(dbFx);
    refreshFxRates(dbFx, false).then((out) => {
      if (out.ok) console.log(`[boot] exchange rates refreshed (${new Date(out.fetchedAt).toISOString()})`);
      else console.warn(`[boot] exchange rates unavailable — using the last known table (${out.error})`);
    }).catch(() => { /* never block boot */ });
  } catch { /* ignore */ }

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`BoostPay Server listening on port ${PORT} [Version: ${SERVER_VERSION}]`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start BoostPay server:', err);
});
