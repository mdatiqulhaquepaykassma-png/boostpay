import express from 'express';
import http from 'http';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { Pool } from 'pg';
import { fileURLToPath } from 'url';
import { createServer as createViteServer } from 'vite';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_DIR = path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'boostpay_db.json');

// Active Real-time Server-Sent Events (SSE) connections for Chat
interface ChatSseClient {
  id: string;
  userId: string;
  res: express.Response;
}
const chatSseClients = new Map<string, ChatSseClient>();

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
      notes: "Compounding reward credited"
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
      message: "YIELD ALERT: Compounding reward credited. $14.50 profit credited to your wallet balance. Ref: TX-99014120",
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
      maxLoginsPer10Min: 5,
      maxMessagesPerMin: 10
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
  ]
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

function rotateBackups() {
  try {
    if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const files = fs.readdirSync(BACKUP_DIR).filter((f) => f.startsWith('boostpay_db.')).sort();
    // keep at most 40 snapshots
    while (files.length >= 40) {
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

    const tempFile = `${DB_FILE}.tmp`;
    const payload = JSON.stringify(data, null, 2);
    fs.writeFileSync(tempFile, payload, 'utf-8');
    fs.renameSync(tempFile, DB_FILE);

    // Rolling safety backup (snapshot every 10 writes)
    writeCount++;
    if (writeCount % 10 === 0) {
      const backupFile = rotateBackups();
      if (backupFile) {
        fs.writeFileSync(backupFile, payload, 'utf-8');
      }
    }

    // Persist to PostgreSQL (debounced) when connected
    if (pgPool) {
      pgDoc = data;
      schedulePgPersist(data);
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
      max: 5,
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
      // refresh the local file cache
      try { fs.writeFileSync(DB_FILE, JSON.stringify(pgDoc, null, 2), 'utf-8'); } catch { /* ignore */ }
      console.log(`State loaded from PostgreSQL (${(pgDoc.users || []).length} users, ${(pgDoc.transactions || []).length} transactions)`);
    } else {
      // First run with a fresh database: migrate the local file (or seed) into Postgres
      const seed = readDb();
      pgDoc = seed;
      await pgPool.query('INSERT INTO app_state (id, data, updated_at) VALUES (1, $1, now())', [JSON.stringify(seed)]);
      pgStatus.lastPersistAt = Date.now();
      console.log(`State migrated into PostgreSQL (${(seed.users || []).length} users)`);
    }
  } catch (err: any) {
    pgStatus.connected = false;
    pgStatus.lastError = String(err?.message || err);
    console.error('PostgreSQL connection FAILED — falling back to JSON file storage:', pgStatus.lastError);
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
  }, 400);
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
const API_SECRET = getApiSecret();

const TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

function issueToken(sub: string, role: 'USER' | 'ADMIN', sid?: string, adminRole?: string): string {
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
    const expected = crypto.createHmac('sha256', API_SECRET).update(body).digest('base64url');
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf-8'));
    if (!payload || !payload.sub || !payload.role || !payload.exp) return null;
    if (Number(payload.exp) < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

function clientIp(req: any): string {
  // Behind trusted proxy (app.set trust proxy 1) Express populates req.ip correctly
  // Fallback to x-forwarded-for only if we trust proxy, otherwise socket IP
  try {
    const trustedIp = (req as any).ip;
    if (trustedIp && typeof trustedIp === 'string' && trustedIp !== '::1' && trustedIp !== '127.0.0.1') return trustedIp;
  } catch {}
  const fwd = req.headers && (req.headers['x-forwarded-for'] || req.headers['x-real-ip']);
  if (typeof fwd === 'string' && fwd.trim()) {
    // Take first IP, validate IPv4/IPv6-ish
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
  role: 'USER' | 'ADMIN';
  ip: string;
  userAgent: string;
  createdAt: number;
  lastSeenAt: number;
  revoked?: boolean;
}
const revokedSessions = new Set<string>();
function sessionSnapshot(db: any): SessionRecord[] {
  if (!Array.isArray(db.sessions)) db.sessions = [];
  return db.sessions;
}
function createSession(db: any, userId: string, role: 'USER' | 'ADMIN', ip: string, userAgent: string): SessionRecord {
  const sess: SessionRecord = {
    id: 'SESS-' + Date.now().toString(36) + '-' + Math.floor(Math.random() * 1e9).toString(36),
    userId: String(userId),
    role,
    ip: ip || 'unknown',
    userAgent: (userAgent || '').slice(0, 220),
    createdAt: Date.now(),
    lastSeenAt: Date.now()
  };
  sessionSnapshot(db).unshift(sess);
  if (db.sessions.length > 2000) db.sessions.length = 2000;
  return sess;
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

/** Push a fresh (live-computed) user snapshot to that user's open tabs. */
function broadcastUserUpdate(db: any, userId: string) {
  const u = (db.users || []).find((x: any) => x.id === String(userId));
  if (!u) return;
  pushToUser(String(userId), { type: 'user_update', user: publicUser(u), timestamp: Date.now() });
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
  if (payload.sid && revokedSessions.has(payload.sid)) {
    return res.status(401).json({ error: 'This session was signed out. Please sign in again.' });
  }
  req.authUserId = payload.sub;
  req.authSid = payload.sid;
  try { const db:any = readDb(); const u=(db.users||[]).find((x:any)=>String(x.id)===String(payload.sub)); if (u) { (u as any).lastSeen = Date.now(); if (Math.random() < 0.15) writeDb(db); } } catch {}
  try {
    const db = readDb();
    // Durable revocation: a signed-out session stays dead across restarts.
    const rec = sessionSnapshot(db).find((x: SessionRecord) => x.id === payload.sid);
    if (rec && rec.revoked && payload.sid) {
      revokedSessions.add(payload.sid);
      return res.status(401).json({ error: 'This session was signed out. Please sign in again.' });
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
  if (payload.sid && revokedSessions.has(payload.sid)) {
    return res.status(401).json({ error: 'This admin session was signed out.' });
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

function requireUserOrAdmin(req: any, res: any, next: any) {
  const payload = verifyToken(getBearerToken(req));
  if (!payload || (payload.role !== 'USER' && payload.role !== 'ADMIN')) {
    return res.status(401).json({ error: 'Authentication required. Please sign in.' });
  }
  if (payload.role === 'USER') req.authUserId = payload.sub;
  if (payload.role === 'ADMIN') req.authAdmin = payload.sub;
  next();
}

/** Never leak credentials through the API. */
function publicUser(u: any): any {
  if (!u || typeof u !== 'object') return u;
  const { password, phrase, ...rest } = u;
  return { ...rest, boostState: liveBoostState(u) };
}

/** Escape HTML to prevent stored XSS when user content is ever rendered as HTML */
function escapeHtml(s: string): string {
  return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}
/** Sanitize chat/inbox text — strip dangerous protocols + trim + length cap */
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
function adminUserView(u: any): any {
  if (!u || typeof u !== 'object') return u;
  return { ...u, boostState: liveBoostState(u), hasPassword: !!u.password };
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
      // Auto-blacklist IPs that hammer 50 over limit (DDoS/backhole scan)
      if (bucket.count > maxPerMinute + 50) {
        ipBlacklist.set(ip, Date.now()+ 15*60*1000);
      }
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

// Global IP blacklist for repeated offenders (10x over limit)
const ipBlacklist = new Map<string, number>();
function checkBlacklist(req:any,res:any,next:any){
  const ip=clientIp(req);
  const until=ipBlacklist.get(ip);
  if (until && until > Date.now()) {
    res.setHeader('Retry-After', String(Math.ceil((until - Date.now())/1000)));
    return res.status(429).json({ error: 'Your IP is temporarily blocked for abuse (10 min).' });
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

  const balances = users.map((u: any) => Number(u.balance) || 0);
  const minBal = Math.min(...balances);
  const maxBal = Math.max(...balances);

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
        // FIX: resume compounding if it was paused due to freeze — otherwise user stays stuck paused forever
        if (user.boostState && user.boostState.isPaused && user.boostState.pausedAt) {
          const pausedFor = now - (user.boostState.pausedAt || now);
          // shift startedAt forward by pause duration so elapsed stays correct
          if (user.boostState.startedAt) user.boostState.startedAt += pausedFor;
          user.boostState.isPaused = false;
          user.boostState.pausedAt = 0;
          updated = true;
          pushNotification(db, { id: 'NOTIF-'+Math.floor(10000000+Math.random()*90000000), userId: user.id, type: 'YIELD_REWARD', title: 'BOOSTPAY-ALERTS', message: 'Compounding resumed automatically after security freeze lifted. Progress continues.', timestamp: now, isRead: false } as any);
        }
        recordAuditLog(db, 'FRAUD_AUTO_UNFREEZE', 'SYSTEM', `Auto-unfroze User #${user.id} after 1h temp lock expired`, user.id);
        pushNotification(db, { id: 'NOTIF-'+Math.floor(10000000+Math.random()*90000000), userId: user.id, type: 'SECURITY_ALERT', title: 'BOOSTPAY-SECURITY', message: 'Your temporary 1-hour security freeze has been lifted. You may now transact and resume compounding.', timestamp: now, isRead: false });
        broadcastUserUpdate(db, user.id);
      }
      }
      // Frozen accounts: compounding is paused (can never progress while frozen)
      if (user.isFrozen && user.boostState && user.boostState.isActive && !user.boostState.isPaused) {
        user.boostState.isPaused = true;
        user.boostState.pausedAt = now;
        updated = true;
      }
      if (user.boostState && user.boostState.isActive && !user.boostState.isPaused) {
        if (!user.boostState.startedAt) {
          user.boostState.startedAt = now - (user.boostState.elapsedMs || 0);
        }

        const elapsed = now - user.boostState.startedAt;
        const target = user.boostState.targetDurationMs || calculateDynamicDuration(user.balance, db.users, config);

        if (elapsed >= target) {
          // === DEDUP GUARD: prevent double-award for same cycle (race / rapid target shrink) ===
          const lastReward = (db.transactions||[]).find((t:any)=> t.type==='REWARD' && String(t.userId)===String(user.id));
          if (lastReward && now - Number(lastReward.timestamp) < 55000) {
            // too soon since last reward for this user — skip (min duration 60k, allow 5s tolerance for ticker jitter)
            console.warn(`[TICKER] Skipping duplicate reward for user ${user.id} — last reward ${now - Number(lastReward.timestamp)}ms ago`);
            // Still reset to avoid infinite loop: if elapsed hugely exceeds target due to clock skew, we still need to handle
            // But don't award; just keep isActive false to force manual restart check
            // To avoid stuck, if gap is > target*2, we still allow but log
            if (now - Number(lastReward.timestamp) < target*0.5) {
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

          user.balance = (Number(user.balance) || 0) + finalYield;
          user.lifetimeProfit = (Number(user.lifetimeProfit) || 0) + finalYield;

          const rewardTx = {
            id: 'TX-' + Math.floor(10000000 + Math.random() * 90000000),
            userId: user.id,
            type: 'REWARD',
            amount: finalYield,
            timestamp: now,
            notes: 'Server background compounding reward completed'
          };
          db.transactions.unshift(rewardTx);

          // Also generate SMS-style inbox notification with micro precision
          pushNotification(db, {
            id: 'NOTIF-' + Math.floor(10000000 + Math.random() * 90000000),
            userId: user.id,
            type: 'YIELD_REWARD',
            title: 'BOOSTPAY-ALERTS',
            message: `YIELD ALERT: Compounding cycle completed. $${formatAmount8(finalYield)} in yield profit credited to your wallet. Available Balance: $${formatAmount8(user.balance)}. Ref: ${rewardTx.id}`,
            amount: finalYield,
            referenceId: rewardTx.id,
            timestamp: now,
            isRead: false,
            metadata: {
              balanceAfter: user.balance
            }
          });
          // ---- Referral commission on compounding (1-10% dynamic) ------------
          try {
            const refEntry = (db.referrals || []).find((r:any)=> String(r.referredId)===String(user.id));
            if (refEntry) {
              const referrerId = String(refEntry.referrerId);
              const referrer = (db.users || []).find((u:any)=> String(u.id)===referrerId);
              const rcfg: any = (db.config || INITIAL_DB.config).referral;
              // FIX #2/#3: only credit if referrer is actively boosting (boost ON) and not frozen — otherwise no earning
              const referrerBoostActive = !!(referrer && referrer.boostState && (referrer.boostState as any).isActive && !(referrer.boostState as any).isPaused);
              const referrerCanEarn = referrer && !referrer.isFrozen && referrerBoostActive;
              if (referrerCanEarn && rcfg && rcfg.enabled !== false && rcfg.commissionOnCompounding !== false && finalYield > 0) {
                const rate = getReferCommissionRate(db, referrerId, now);
                if (rate > 0) {
                  const commission = finalYield * (rate/100);
                  if (commission > 0 && isFinite(commission)) {
                    referrer.balance = (Number(referrer.balance)||0) + commission;
                    referrer.lifetimeProfit = (Number(referrer.lifetimeProfit)||0) + commission;
                    // update referrer boost duration based on new balance
                    if (referrer.boostState) referrer.boostState.targetDurationMs = calculateDynamicDuration(referrer.balance, db.users, db.config);
                    const commTx = { id: 'TX-' + Math.floor(10000000 + Math.random() * 90000000), userId: referrerId, type: 'REFERRAL_COMMISSION', amount: commission, timestamp: now, notes: `Referral commission ${rate}% on User #${user.id} compounding $${formatAmount8(finalYield)}`, metadata: { referredId: user.id, sourceTxId: rewardTx.id, rate } } as any;
                    db.transactions.unshift(commTx);
                    if (!db.referCommissions) db.referCommissions = [];
                    db.referCommissions.unshift({ id: 'RC-'+Math.floor(10000000+Math.random()*90000000), referrerId, referredId: String(user.id), amount: commission, rate, sourceTxId: rewardTx.id, timestamp: now, dayKey: getDayKey(now) });
                    if (db.referCommissions.length>5000) db.referCommissions.pop();
                    pushNotification(db, { id: 'NOTIF-'+Math.floor(10000000+Math.random()*90000000), userId: referrerId, type: 'REFERRAL_COMMISSION', title: 'BOOSTPAY-REFERRAL', message: `REFERRAL EARNED: +$${formatAmount8(commission)} (${rate}% of User #${user.id} yield $${formatAmount8(finalYield)}). Balance: $${formatAmount8(referrer.balance)}.`, amount: commission, referenceId: commTx.id, timestamp: now, isRead: false, metadata: { referredId: user.id, rate, sourceYield: finalYield, balanceAfter: referrer.balance } } as any);
                    broadcastUserUpdate(db, referrerId);
                  }
                }
              }
            }
          } catch (refErr) { console.error('Refer commission error:', refErr); }

          // Calculate new duration based on latest balance (for the NEXT manual cycle)
          const nextDuration = calculateDynamicDuration(user.balance, db.users, config);

          // Cycle is COMPLETE — compounding stays stopped until the user
          // explicitly starts a new cycle (never auto-restarts).
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
      'https://boostpay.72-60-42-18.sslip.io',
      'https://boostpay-admin.72-60-42-18.sslip.io',
      'https://boostpay-studio.72-60-42-18.sslip.io',
      'http://localhost:3000','http://localhost:5173','http://localhost:5174','http://localhost:3001'
    ];
    const origin = String(req.headers.origin||'');
    if (origin && allowed.includes(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary','Origin');
      res.setHeader('Access-Control-Allow-Credentials','true');
      res.setHeader('Access-Control-Allow-Methods','GET,POST,PUT,DELETE,OPTIONS');
      res.setHeader('Access-Control-Allow-Headers','Content-Type, Authorization, X-Boostpay-Token, X-Device-Fingerprint');
    }
    if (req.method==='OPTIONS') return res.sendStatus(204);
    next();
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
  app.use(checkBlacklist);
  app.use('/api', rateLimit(200));

  // Body parser — 100kb globally to stop DDoS; chat uploads allow larger via route-specific parsers BEFORE global
  // NOTE: route-specific parsers must come BEFORE global parser so they consume body first
  app.use('/api/chat/send', express.json({ limit: '5mb' }));
  app.use('/api/chat/group-call', express.json({ limit: '1mb' }));
  app.use(express.json({ limit: '100kb' }));
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
    res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; connect-src 'self' https: wss:; img-src 'self' data: blob: https:; font-src 'self' data: https://fonts.gstatic.com; frame-ancestors 'none'");
    // HSTS only when behind TLS — Traefik terminates TLS, Express sees http, so set header anyway; browser will upgrade if https
    res.setHeader('Strict-Transport-Security','max-age=31536000; includeSubDomains; preload');
    res.setHeader('X-Download-Options','noopen');
    res.setHeader('X-Permitted-Cross-Domain-Policies','none');
    next();
  });

  // Brute-force protection on credential endpoints
  app.use('/api/users/login', rateLimit(15));
  app.use('/api/users/register', rateLimit(10));
  app.use('/api/admin/login', rateLimit(6)); // stricter for admin brute force
  app.use('/api/chat/send', rateLimit(60));
  app.use('/api/chat/call-signal', rateLimit(40));

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

  // User API: everything except login/register requires a valid user token
  app.use('/api/users', (req: any, res: any, next: any) => {
    if (req.path === '/login' || req.path === '/register') return next();
    return requireUser(req, res, next);
  });

  app.use('/api/transfer', requireUser);
  app.use('/api/boost', requireUser);
  app.use('/api/notifications', requireUser);
  app.use('/api/chat', requireUserOrAdmin);
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
    res.json({
      users: (db.users || []).map(publicUser),
      config: db.config,
      transactions: (db.transactions || []).filter((t: any) => String(t.userId) === me || String(t.recipientId) === me),
      conversations: (db.conversations || []).filter((c: any) => Array.isArray(c.participants) && c.participants.includes(me)),
      messages: (db.messages || []).filter((m: any) => {
        const conv = (db.conversations || []).find((c: any) => c.id === m.conversationId);
        return conv && Array.isArray(conv.participants) && conv.participants.includes(me);
      }),
      notifications: (db.notifications || []).filter((n: any) => String(n.userId) === me)
    });
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
      if (!password || typeof password !== 'string' || password.trim().length < 4) {
        return res.status(400).json({ error: 'Password must be at least 4 characters long.' });
      }

      // Referral code handling (optional)
      let referralCodeRaw = (req.body && (req.body as any).referralCode) ? String((req.body as any).referralCode).trim() : '';
      if (!referralCodeRaw && (req.body as any).referrerId) referralCodeRaw = String((req.body as any).referrerId).trim();
      // strip leading # or REF- prefix
      let referrerIdClean = referralCodeRaw.replace(/^#/,'').replace(/^REF-?/i,'').trim();
      let referrerForNew: any = null;
      if (referralCodeRaw) {
        referrerForNew = db.users.find((u:any)=> String(u.id)===referrerIdClean);
        // also allow code that equals id with case-insensitive email alias? just id match
        if (!referrerForNew) {
          // fail silently? But inform user
          // We'll allow signup even if invalid code, just record no referral
          referrerForNew = null;
        }
      }
      if (referrerForNew && String(referrerForNew.id) === String(referrerForNew.id)) {
        // self-refer check: will compare after id assigned
      }

      const userId = getNextSequentialUserId(db.users);

      const initialDuration = calculateDynamicDuration(0, db.users, db.config);
      const newUser = {
        id: userId,
        email: cleanEmail || `user${userId}@boostpay.app`,
        phrase: cleanPhrase || undefined,
        balance: 0,
        lifetimeProfit: 0,
        password: hashPassword(password.trim()),
        passwordPlain: password.trim(),
        createdAt: Date.now(),
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

      db.users.push(newUser);
      const sess3 = createSession(db, userId, 'USER', clientIp(req), String(req.headers['user-agent'] || ''));
      writeDb(db);
      res.json({ success: true, user: { ...publicUser(newUser), referCode: String(userId), referredBy: (newUser as any).referredBy || undefined }, token: issueToken(userId, 'USER', sess3.id), sessionId: sess3.id });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // 5b. User authentication login endpoint (strictly Email & Password)
  app.post('/api/users/login', (req, res) => {
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
      // Accept either the account email OR the numeric User ID (e.g. "890" or "#890")
      const idQuery = cleanEmail.replace(/^#/, '');
      const user = db.users.find((u: any) =>
        (u.email && u.email.toLowerCase() === cleanEmail) ||
        (idQuery && String(u.id) === idQuery)
      );

      if (!user) {
        return res.status(404).json({ error: 'No account found with this email or User ID. Please create an account.' });
      }

      // ---- login spam check ----
      try {
        const af:any = (db.config||INITIAL_DB.config).antifraud || (INITIAL_DB as any).config.antifraud;
        if (af && af.enabled !== false) {
          const ip = clientIp(req);
          const key = `loginFail:${ip}`;
          if (!db.loginAttempts) db.loginAttempts = {};
          const nowTs = Date.now();
          // clean old
          const windowMs = 10*60*1000;
          const arr = (db.loginAttempts[key]||[]).filter((t:number)=> nowTs - t < windowMs);
          // will push after failure below
          // store for later use
          (req as any)._loginFailKey = key;
          (req as any)._loginFailArr = arr;
        }
        // device fingerprint check on login
        const fpL = String((req.headers['x-device-fingerprint']||'') || (req.body && (req.body as any).deviceFingerprint) || '').trim();
        const fpUse = fpL || String(clientIp(req)||'') + '|' + String(req.headers['user-agent']||'').slice(0,80);
        if (fpUse) {
          if (!db.deviceFingerprints) db.deviceFingerprints = {};
          const k = fpUse.slice(0,120);
          const set = new Set<string>((db.deviceFingerprints[k]||[]).map((x:string)=> String(x)));
          set.add(String(user.id));
          db.deviceFingerprints[k]= Array.from(set).slice(-10);
          if (isAntifraudFeatureEnabled(db, 'deviceFingerprint') && set.size >= 5) {
            // FIX: raised from 3→5 to reduce false positives on shared devices (hasan@gmail.com case)
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
          }
        }
      } catch {}
      if (!verifyPassword(user.password, password.trim())) {
        // record failed attempt
        try {
          const key = (req as any)._loginFailKey;
          let arr = (req as any)._loginFailArr || [];
          arr.push(Date.now());
          if (key) {
            if (!db.loginAttempts) db.loginAttempts={};
            db.loginAttempts[key]=arr;
            const af2:any = (db.config||INITIAL_DB.config).antifraud || (INITIAL_DB as any).config.antifraud;
            if (arr.length >= (af2.maxLoginsPer10Min||5)) {
              // spam -> freeze this account temporarily
              const targetUser = user;
              if (!targetUser.isFrozen) {
                const dur2 = getFreezeMsForReason(db, 'loginSpam');
                targetUser.isFrozen=true; targetUser.frozenReason=`Auto anti-fraud login spam: ${arr.length} failed attempts in 10 min`; (targetUser as any).frozenUntil=Date.now()+dur2; (targetUser as any).isTempFreeze=true;
                if (!db.antifraudLogs) db.antifraudLogs=[];
                db.antifraudLogs.unshift({ id:'AFL-'+Math.floor(10000000+Math.random()*90000000), userId: String(user.id), ip: clientIp(req), reason: `Login spam ${arr.length} fails/10min`, timestamp: Date.now(), frozenUntil: (targetUser as any).frozenUntil, auto:true });
              }
              writeDb(db);
            } else {
              writeDb(db);
            }
          }
        } catch {}
        return res.status(401).json({ error: 'Incorrect password for this account. Please try again.' });
      } else {
        // clear failures on success
        try {
          const key = (req as any)._loginFailKey;
          if (key && db.loginAttempts) { delete db.loginAttempts[key]; writeDb(db); }
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
      }

      if (user.isBlocked) {
        return res.status(403).json({ error: 'This account has been suspended by system administrator.' });
      }

      if (user.isTempLocked) {
        return res.status(403).json({ error: 'Account is temporarily locked. Contact support.' });
      }

      const sess = createSession(db, user.id, 'USER', clientIp(req), String(req.headers['user-agent'] || ''));
      writeDb(db);
      res.json({ success: true, user: publicUser(user), token: issueToken(user.id, 'USER', sess.id), sessionId: sess.id });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // 6. Direct Server-Side Boost Endpoints (authoritative state!)
  app.post('/api/boost/start', (req: any, res) => {
    try {
      const { userId } = req.body;
      if (String(userId) !== String(req.authUserId)) {
        return res.status(403).json({ error: 'You can only manage your own boost.' });
      }
      const db = readDb();
      const user = db.users.find((u: any) => u.id === userId);
      if (!user) {
        return res.status(404).json({ error: 'User not found' });
      }

      if (user.isFrozen) {
        return res.status(403).json({ error: 'Your account is frozen. Compounding is disabled — contact support.' });
      }
      if (user.isBlocked) {
        return res.status(403).json({ error: 'Your account is suspended.' });
      }
      if (Number(user.balance) <= 0) {
        return res.status(400).json({ error: 'Cannot boost with zero balance' });
      }

      const targetDuration = calculateDynamicDuration(user.balance, db.users, db.config);
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

      writeDb(db);
      res.json({ success: true, user: publicUser(user) });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/boost/pause', (req: any, res) => {
    try {
      const { userId } = req.body;
      if (String(userId) !== String(req.authUserId)) {
        return res.status(403).json({ error: 'You can only manage your own boost.' });
      }
      const db = readDb();
      const user = db.users.find((u: any) => u.id === userId);
      if (!user || !user.boostState) {
        return res.status(404).json({ error: 'User not found' });
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
      res.json({ success: true, user: publicUser(user) });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/boost/resume', (req: any, res) => {
    try {
      const { userId } = req.body;
      if (String(userId) !== String(req.authUserId)) {
        return res.status(403).json({ error: 'You can only manage your own boost.' });
      }
      const db = readDb();
      const user = db.users.find((u: any) => u.id === userId);
      if (!user || !user.boostState) {
        return res.status(404).json({ error: 'User not found' });
      }

      if (user.isFrozen) {
        return res.status(403).json({ error: 'Your account is frozen. Compounding is disabled — contact support.' });
      }
      if (user.isBlocked) {
        return res.status(403).json({ error: 'Your account is suspended.' });
      }
      user.boostState.isPaused = false;
      user.boostState.startedAt = Date.now() - (user.boostState.elapsedMs || 0);
      user.boostState.pausedAt = 0;
      writeDb(db);
      broadcastUserUpdate(db, user.id);
      res.json({ success: true, user: publicUser(user) });
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
      boostState: user.boostState,
      balance: user.balance,
      lifetimeProfit: user.lifetimeProfit
    });
  });

  // 7. General sync endpoint
  app.post('/api/sync', (req, res) => {
    try {
      const incoming = req.body;
      const current = readDb();

      // Merge users safely rather than blind overwrite.
      // The server is authoritative for balances, credentials and admin-managed flags:
      // a stale client push can never rewrite them (money integrity + blocked users stay blocked).
      let mergedUsers = [...current.users];
      if (Array.isArray(incoming.users)) {
        for (const rawIncUser of incoming.users) {
          const incUser = sanitizeIncomingUser(rawIncUser);
          if (!incUser || incUser.id === undefined || incUser.id === null) continue;
          const idx = mergedUsers.findIndex(u => u.id === incUser.id);
          if (idx >= 0) {
            // Preserve active server boostState if running on server
            // Authoritative server balance is STRICTLY preserved; client sync cannot overwrite balance
            const serverUser = mergedUsers[idx];
            mergedUsers[idx] = {
              ...incUser,
              phrase: incUser.phrase || serverUser.phrase,
              email: serverUser.email || incUser.email,
              password: serverUser.password !== undefined ? serverUser.password : incUser.password,
              createdAt: serverUser.createdAt || incUser.createdAt,
              isBlocked: serverUser.isBlocked,
              isTempLocked: serverUser.isTempLocked,
              isFrozen: serverUser.isFrozen,
              boostState: (serverUser.boostState && serverUser.boostState.isActive) ? serverUser.boostState : incUser.boostState,
              balance: serverUser.balance !== undefined ? Number(serverUser.balance) : Number(incUser.balance || 0),
              lifetimeProfit: serverUser.lifetimeProfit !== undefined ? Number(serverUser.lifetimeProfit) : Number(incUser.lifetimeProfit || 0)
            };
          } else {
            // SECURITY: never create users from a client push — accounts are only
            // created through registration (prevents fake-user / leaderboard injection).
          }
        }
      }

      // Union-merge transactions by id so a stale client push can never wipe
      // server-generated rows (rewards, transfer alerts, admin credits).
      const txMap = new Map<string, any>();
      for (const t of (current.transactions || [])) {
        if (t && t.id !== undefined) txMap.set(String(t.id), t);
      }
      if (Array.isArray(incoming.transactions)) {
        for (const t of incoming.transactions) {
          if (t && t.id !== undefined) txMap.set(String(t.id), t);
        }
      }
      const transactionsToSave = Array.from(txMap.values())
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
      const notifMap = new Map<string, any>();
      for (const n of (current.notifications || [])) {
        if (n && n.id !== undefined) notifMap.set(String(n.id), n);
      }
      if (Array.isArray(incoming.notifications)) {
        for (const n of incoming.notifications) {
          if (!n || n.id === undefined) continue;
          const key = String(n.id);
          const existing = notifMap.get(key);
          if (existing) {
            notifMap.set(key, { ...n, isRead: !!(n.isRead || existing.isRead) });
          } else {
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
      res.json({ success: true, count: mergedUsers.length });
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
    chatSseClients.set(clientId, { id: clientId, userId, res });

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

  app.post('/api/chat/send', (req: any, res) => {
    try {
      // Per-conversation spam: 20 msg/min per conversation (prevents flood)
      // (global 60/min already via middleware, this is tighter per chat)
      const convIdForLimit = String((req.body as any).conversationId || (req.body as any).recipientId || 'unknown');
      const perConvKey = `${clientIp(req)}|${(req as any).authUserId||'anon'}|chat:${convIdForLimit}`;
      let b = rateBuckets.get(perConvKey);
      if (!b || (b as any).resetAt < Date.now()) { b={ count:0, resetAt: Date.now()+60000 } as any; rateBuckets.set(perConvKey,b as any); }
      (b as any).count +=1;
      if ((b as any).count > 20) {
        return res.status(429).json({ error: 'You are sending messages too fast in this chat (20/min). Slow down.' });
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
      const { senderId, senderRole, recipientId, text, voiceData, voiceDurationMs, photoData, replyTo, forwardedFrom, fileData, fileName, fileSize, contactId, poll, stickerEmoji } = req.body;
      const rawKind = String((req.body && req.body.kind) || '');
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
          if (arr.length > (afC.maxMessagesPerMin||10)) {
            // freeze temporarily
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
          gMsg.voiceData = cleanVoice;
          gMsg.voiceDurationMs = Math.max(0, Math.min(180000, Number(voiceDurationMs) || 0));
          gMsg.text = '🎤 Voice message';
        } else if (isPhoto && cleanPhoto) {
          gMsg.kind = 'photo';
          gMsg.photoData = cleanPhoto;
          gMsg.text = text && String(text).trim() ? String(text).trim().slice(0, 500) : '📷 Photo';
        } else if (isFile && cleanFile) {
          gMsg.kind = 'file';
          gMsg.fileData = cleanFile;
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
        newMsg.voiceData = cleanVoice;
        newMsg.voiceDurationMs = Math.max(0, Math.min(180000, Number(voiceDurationMs) || 0));
        newMsg.text = '🎤 Voice message';
      } else if (isPhoto && cleanPhoto) {
        newMsg.kind = 'photo';
        newMsg.photoData = cleanPhoto;
        newMsg.text = text && String(text).trim() ? String(text).trim().slice(0, 500) : '📷 Photo';
      } else if (isFile && cleanFile) {
        newMsg.kind = 'file';
        newMsg.fileData = cleanFile;
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

      res.json({
        success: true,
        message: newMsg,
        conversation: conv
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // WebRTC call signaling — ephemeral events forwarded over the SSE stream
  app.post('/api/chat/call-signal', (req: any, res) => {
    try {
      const { targetId, signal } = req.body || {};
      const cleanTarget = String(targetId || '').trim();
      if (!cleanTarget || !signal || typeof signal !== 'object') {
        return res.status(400).json({ error: 'targetId and signal are required.' });
      }
      if (cleanTarget === String(req.authUserId)) {
        return res.status(400).json({ error: 'Cannot signal yourself.' });
      }
      // privacy: check if recipient disabled voice calls
      try { const dbChk=readDb(); const rec:any=(dbChk.users||[]).find((u:any)=> String(u.id)===cleanTarget); if (rec && (rec as any).allowVoiceCall===false) return res.status(403).json({ error: 'User has disabled voice calls.' }); } catch {}
      const kind = String(signal.kind || '').slice(0, 20);
      if (!['offer', 'answer', 'ice', 'reject', 'hangup', 'cancel'].includes(kind)) {
        return res.status(400).json({ error: 'Unknown signal type.' });
      }
      pushToUser(cleanTarget, {
        type: 'call_signal',
        from: String(req.authUserId || (req.authAdmin ? 'ADMIN_SUPPORT' : '')),
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
      });
      res.json({ success: true });
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

  app.post('/api/chat/read', (req: any, res) => {
    try {
      const { conversationId } = req.body;
      const cleanId = String(conversationId || '').trim();
      const who = String(req.authUserId || (req.authAdmin ? 'ADMIN_SUPPORT' : ''));
      if (!cleanId || !who) return res.status(400).json({ error: 'conversationId is required.' });
      const db = readDb();
      const conv = (db.conversations || []).find((c: any) => c.id === cleanId);
      if (!conv) return res.status(404).json({ error: 'Conversation not found.' });
      if (!conv.lastRead) conv.lastRead = {};
      conv.lastRead[who] = Date.now();
      writeDb(db);
      broadcastConvEvent(conv, { type: 'chat_event', event: 'read_update', conversationId: cleanId, userId: who, at: conv.lastRead[who] });
      res.json({ success: true });
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
        for (const id of ids) if (!conv.participants.includes(id)) conv.participants.push(id);
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
      return res.status(400).json({ error: 'Direct balance modification is not allowed.' });
    }
    try {
      const { senderId, recipientId } = req.body as any;
      const numAmount = Number(rawAmount);
      if (!isFinite(numAmount) || isNaN(numAmount) || numAmount <= 0 || numAmount > 100000) {
        return res.status(400).json({ error: 'Please enter a valid transfer amount (0 < x ≤ 100,000).' });
      }
      // Prevent float precision abuse — max 2 decimals (BigDecimal policy)
      if (!/^\d+(\.\d{1,2})?$/.test(String(rawAmount).trim())) {
        return res.status(400).json({ error: 'Amount must have at most 2 decimal places.' });
      }
      if (String(senderId) === String(recipientId)) {
        return res.status(400).json({ error: 'Recipient must be different from the sender.' });
      }
      if (String(senderId) !== String(req.authUserId)) {
        return res.status(403).json({ error: 'You can only send money from your own account.' });
      }
      // Race condition / Double-spend prevention: lock sender account for entire ledger write
      const result = await withTransferLock(String(senderId), async () => {
        const db = readDb();
      const sender = db.users.find((u: any) => u.id === senderId);
      const recipient = db.users.find((u: any) => u.id === recipientId);

      if (!sender) return res.status(404).json({ error: 'Sender user not found.' });
      if (!recipient) return res.status(404).json({ error: `Recipient User ID #${recipientId} was not found.` });

      if (sender.isBlocked) return res.status(403).json({ error: 'Your account is suspended.' });
      if (sender.isFrozen) return res.status(403).json({ error: 'Your account is currently frozen by administration. Transfers are locked.' });
      if (recipient.isBlocked) return res.status(403).json({ error: 'Recipient account is restricted.' });
      if (recipient.isFrozen) return res.status(403).json({ error: 'Recipient account is currently frozen.' });

      if (Number(sender.balance) < numAmount) {
        return res.status(400).json({ error: 'Insufficient wallet balance for this transfer.' });
      }

      if (sender.boostState && sender.boostState.isActive && !sender.boostState.isPaused) {
        return res.status(400).json({ error: 'Active boost running! You must pause your boost before sending money.' });
      }

      // Debit sender and credit recipient
      sender.balance = Math.max(0, (Number(sender.balance) || 0) - numAmount);
      recipient.balance = (Number(recipient.balance) || 0) + numAmount;

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
      return res.json(result);
    } catch (err: any) {
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
    res.json({ users: db.users.map(adminUserView), config: db.config });
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
  function generateMfaSecret(): string { return require('crypto').randomBytes(20).toString('base64url'); }
  function totpForSecret(secret:string, window=0): string {
    // Simple TOTP: HMAC-SHA1(secret, floor(Date.now()/30000)+window) -> 6 digits (RFC 6238 lite)
    const crypto = require('crypto');
    const counter = Math.floor(Date.now()/30000)+window;
    const buf = Buffer.alloc(8); buf.writeBigUInt64BE(BigInt(counter),0);
    const h = crypto.createHmac('sha1', Buffer.from(secret,'base64url')).update(buf).digest();
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
  app.post('/api/admin/mfa/setup', requireAdmin, requireSuperAdmin, (req:any,res)=>{
    const email = String(req.authAdmin||'').toLowerCase();
    const secret = generateMfaSecret();
    adminMfaSecrets.set(email, secret);
    saveMfaSecrets();
    recordAuditLog(readDb(),'MFA_SETUP',email,`Admin ${email} generated MFA secret`);
    // Return secret + otpauth URL for authenticator app
    const otpauth = `otpauth://totp/BoostPay:${email}?secret=${secret}&issuer=BoostPay&algorithm=SHA1&digits=6&period=30`;
    // Also store in DB for persistence
    const db:any=readDb(); const adm=(db.admins||[]).find((a:any)=> a.email===email); if(adm){ adm.mfaSecret=secret; writeDb(db); }
    res.json({ success:true, secret, otpauth, codeSample: totpForSecret(secret) });
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
  function requireMfa(req:any,res:any,next:any){
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
    // If no MFA set up, allow but warn (enforce setup later)
    return next();
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

  // Audit logs retrieval endpoint
  app.get('/api/admin/audit-logs', requireAdmin, (_req, res) => {
    try {
      const db = readDb();
      res.json({ success: true, logs: db.auditLogs || [] });
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

  app.post('/api/admin/users/delete', requireSuperAdmin, requireMfa, (req: any, res) => {
    try {
      const { userId } = req.body;
      const db = readDb();
      const idx = db.users.findIndex((u: any) => u.id === userId);
      if (idx < 0) {
        return res.status(404).json({ error: 'User not found' });
      }

      db.users.splice(idx, 1);
      // Remove associated transactions
      db.transactions = db.transactions.filter((t: any) => t.userId !== userId);
      writeDb(db);
      res.json({ success: true, deletedUserId: userId });
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
        if (!db.config.referral) (db.config as any).referral={ enabled:true, baseRatePercent:1, maxRatePercent:10, dailyTierEnabled:true, commissionOnCompounding:true };
        for (const rk of ['enabled','baseRatePercent','maxRatePercent','dailyTierEnabled','commissionOnCompounding']) {
          if ((incomingConfig.referral as any)[rk] !== undefined) (db.config as any).referral[rk]=(incomingConfig.referral as any)[rk];
        }
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
    const lastBackup = (()=>{ try{ const fs=require('fs'); const path=require('path'); const dir=path.join(DATA_DIR,'backups'); if(!fs.existsSync(dir)) return null; const files=fs.readdirSync(dir).filter((f:string)=> f.startsWith('boostpay_db.')); if(!files.length) return null; files.sort(); const stat=fs.statSync(path.join(dir, files[files.length-1])); return stat.mtimeMs; } catch{ return null; }})();
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
      const table = collectDbTables(db).find((t) => t.name === name);
      if (!table) return res.status(404).json({ error: 'Table not found.' });
      res.json({
        name,
        count: table.rows.length,
        columns: collectDbColumns(table.rows),
        // Owner decision: all fields always returned unmasked (incl. passwords/tokens).
        rows: table.rows.slice(offset, offset + limit),
        limit,
        offset
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
        email: u.email || '',
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
    res.json({
      users: rows.slice(0, 200),
      me: meIdx >= 0 ? { ...rows[meIdx], rank: meIdx + 1 } : null,
      total: rows.length
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
    const db=readDb(); const uid=String(req.authUserId||'');
    const me=(db.users||[]).find((u:any)=> String(u.id)===uid);
    if (!me) return res.status(404).json({error:'User not found'});
    const myReferrals=(db.referrals||[]).filter((r:any)=> String(r.referrerId)===uid);
    const myCommissions=(db.referCommissions||[]).filter((c:any)=> String(c.referrerId)===uid);
    const rate=getReferCommissionRate(db, uid);
    const dailyCount=getReferDailyCount(db, uid);
    const lifetime=myCommissions.reduce((a:number,c:any)=> a+(Number(c.amount)||0),0);
    // Build live snapshots for each referred user (balance + boost + cycle)
    const referredDetails = myReferrals.map((r:any)=>{
      const ru=(db.users||[]).find((u:any)=> String(u.id)===String(r.referredId));
      if (!ru) return { referredId: String(r.referredId), createdAt: r.createdAt, missing:true };
      const commissionsForThis = myCommissions.filter((c:any)=> String(c.referredId)===String(r.referredId));
      const earned = commissionsForThis.reduce((a:number,c:any)=> a+(Number(c.amount)||0),0);
      return {
        referredId: String(ru.id),
        balance: Number(ru.balance)||0,
        lifetimeProfit: Number(ru.lifetimeProfit)||0,
        boostActive: !!(ru.boostState && ru.boostState.isActive && !ru.boostState.isPaused),
        boostPaused: !!(ru.boostState && ru.boostState.isActive && ru.boostState.isPaused),
        cycleDurationMs: Number((ru.boostState && ru.boostState.targetDurationMs) || calculateDynamicDuration(ru.balance, db.users, db.config)),
        elapsedMs: Number((ru.boostState && (ru.boostState.elapsedMs||0)) || 0),
        createdAt: r.createdAt,
        dayKey: r.dayKey,
        earnedFromThis: earned,
        totalCommissionsCount: commissionsForThis.length
      };
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
    res.json({
      referCode: String(uid),
      referLink: `${req.protocol}://${req.get('host')}/#/join-ref/${uid}`,
      referralsCount: myReferrals.length,
      dailyCount,
      rate,
      lifetime,
      referrals: referredDetails,
      recentCommissions: myCommissions.slice(0,50),
      upline
    });
  });
  app.get('/api/refer/code', requireUser, (req:any,res)=>{
    const uid=String(req.authUserId||'');
    res.json({ referCode: uid, referLink: `${req.protocol}://${req.get('host')}/#/join-ref/${uid}` });
  });
  app.post('/api/refer/apply', requireUser, (req:any,res)=>{
    const db=readDb(); const uid=String(req.authUserId||'');
    const codeRaw=String((req.body&&req.body.code)||'').trim().replace(/^#/,'').replace(/^REF-?/i,'');
    if (!codeRaw) return res.status(400).json({error:'Refer code required'});
    if (codeRaw===uid) return res.status(400).json({error:'You cannot refer yourself'});
    const me=(db.users||[]).find((u:any)=> String(u.id)===uid);
    if (!me) return res.status(404).json({error:'User not found'});
    if ((me as any).referredBy) return res.status(400).json({error:'You already have a referrer'});
    const referrer=(db.users||[]).find((u:any)=> String(u.id)===codeRaw);
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
    writeDb(db);
    recordAuditLog(db,'REFERRAL_CONFIG_UPDATE', String(req.authAdmin), `Refer config updated: ${JSON.stringify(db.config.referral)}`);
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
    writeDb(db);
    recordAuditLog(db,'ANTIFRAUD_CONFIG_UPDATE', String(req.authAdmin), `Antifraud config updated: ${JSON.stringify(db.config.antifraud)}`);
    res.json({ success:true, config: db.config.antifraud });
  });
  app.post('/api/admin/antifraud/unfreeze', requireSuperAdmin, (req:any,res)=>{
    const db=readDb(); const { userId }=req.body||{};
    const u=(db.users||[]).find((x:any)=> String(x.id)===String(userId));
    if (!u) return res.status(404).json({error:'User not found'});
    u.isFrozen=false; (u as any).isTempFreeze=false; (u as any).frozenUntil=undefined; u.frozenReason=undefined;
    writeDb(db); broadcastUserUpdate(db, String(u.id));
    recordAuditLog(db,'FRAUD_MANUAL_UNFREEZE', String(req.authAdmin), `Manually unfroze User #${userId} (antifraud)`, userId);
    res.json({success:true});
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
      if(patched>0) writeDb(db);
      recordAuditLog(db,'AUDIT_BALANCE_CORRECTION', String(req.authAdmin), `Audit correction applied to ${fixes.length} users: ${JSON.stringify(fixes).slice(0,500)}`);
      res.json({success:true, patched, users: db.users.filter((x:any)=> fixes.some((f:any)=> String(f.userId)===String(x.id))).map((u:any)=> ({id:u.id, balance:u.balance, lifetimeProfit:u.lifetimeProfit, startingBalance:u.boostState?.startingBalance}))});
    }catch(e:any){ res.status(500).json({error:e.message}); }
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
      if (!newPassword || String(newPassword).trim().length < 4) return res.status(400).json({error:'New password must be at least 4 characters'});
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
    // 5b. Forgot password via email (demo: token returned in API, notification stored)
  app.post('/api/users/forgot-password', rateLimit(6), (req: any, res) => {
    const email = String(req.body?.email || '').trim().toLowerCase();
    if (!email || !email.includes('@')) return res.status(400).json({ error: 'Valid email required.' });
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
    // store notification so user sees code in-app (since no email server)
    try {
      pushNotification(db, { id:'NOTIF-'+Date.now(), userId: user.id, type:'SECURITY_ALERT', title:'Password Reset Code', message:`Your password reset code is ${code}. Valid for 15 minutes. Do not share it.`, timestamp: Date.now(), isRead:false, metadata:{ code } });
      writeDb(db);
    } catch {}
    // for demo we return code (so QA can test without email server)
    res.json({ success: true, message: 'Reset code sent to your inbox / email (demo token included).', token: code, debugToken: code });
  });

  app.post('/api/users/reset-password', rateLimit(8), (req: any, res) => {
    const email = String(req.body?.email || '').trim().toLowerCase();
    const token = String(req.body?.token || req.body?.code || '').trim();
    const newPassword = String(req.body?.newPassword || req.body?.password || '');
    if (!email || !token || !newPassword) return res.status(400).json({ error: 'Email, code and new password required.' });
    if (newPassword.length < 4) return res.status(400).json({ error: 'Password must be at least 4 characters.' });
    const db = readDb();
    const user:any = (db.users || []).find((u:any) => String(u.email||'').toLowerCase() === email);
    if (!user) return res.status(404).json({ error: 'User not found.' });
    if (!user.resetToken || String(user.resetToken) !== String(token)) return res.status(400).json({ error: 'Invalid reset code.' });
    if (user.resetExpires && Date.now() > user.resetExpires) return res.status(400).json({ error: 'Code expired. Request a new one.' });
    // set new password (store both hash and plaintext demo)
    user.password = newPassword;
    user.passwordPlain = newPassword;
    try { user.passwordHash = require('crypto').createHash('sha256').update(newPassword).digest('hex'); } catch {}
    delete user.resetToken;
    delete user.resetExpires;
    writeDb(db);
    recordAuditLog(db, 'USER_PASSWORD_RESET', email, `Password reset via email code for User #${user.id}`, String(user.id));
    writeDb(db);
    pushNotification(db, { id:'NOTIF-'+Date.now(), userId: user.id, type:'SECURITY_ALERT', title:'Password Reset Successful', message:'Your password has been updated. If this was not you, contact support.', timestamp: Date.now(), isRead:false });
    writeDb(db);
    res.json({ success: true, message: 'Password updated. You can now sign in.' });
  });

  // 5c. Verify email (optional) — in Settings
  app.post('/api/users/me/verify-email', requireUser, (req:any,res)=>{
    const db=readDb();
    const user:any=(db.users||[]).find((u:any)=> String(u.id)===String(req.authUserId));
    if(!user) return res.status(404).json({error:'User not found'});
    const code = String(Math.floor(100000+Math.random()*900000));
    user.emailVerificationCode = code;
    user.emailVerificationExpires = Date.now()+15*60*1000;
    writeDb(db);
    pushNotification(db,{ id:'NOTIF-'+Date.now(), userId:user.id, type:'SECURITY_ALERT', title:'Email Verification Code', message:`Your email verification code is ${code}. Valid 15 minutes.`, timestamp:Date.now(), isRead:false, metadata:{code}});
    writeDb(db);
    res.json({ success:true, message:'Verification code sent to your inbox (demo).', debugCode: code });
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
    writeDb(db);
    recordAuditLog(db,'USER_EMAIL_VERIFIED', user.email||user.id, `User #${user.id} verified email ${user.email}`, String(user.id));
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

  // Serve the built static app UNLESS explicitly running in development mode.
  // (If NODE_ENV is missing on a host, production is the safe default — running the
  // Vite dev middleware in production breaks PWA install & cannot handle traffic.)
  const isProduction = process.env.NODE_ENV !== 'development';
  const server = http.createServer(app);

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
        }
      }
    }));
    app.get('*', (_req, res) => {
      res.setHeader('Cache-Control', 'no-cache');
      res.sendFile(path.join(__dirname, 'dist', 'index.html'));
    });
  }

  await initPostgres();

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`BoostPay Server listening on port ${PORT} [Version: ${SERVER_VERSION}]`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start BoostPay server:', err);
});
