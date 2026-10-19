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
      tempFreezeMs: 3600000, // 1h temporary freeze
      maxTransfersPer10Min: 5,
      maxDistinctSendersPerIp: 3,
      maxVolumePer10Min: 500,
      newAccountLargeTransferThreshold: 100, // new account <24h + transfer >100 => flag
      velocityEnabled: true
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
  if (cfg.referral.dailyTierEnabled !== false) {
    const cnt = getReferDailyCount(db, referrerId, getDayKey(now));
    return getReferTierRate(cnt, cfg);
  }
  return Number(cfg.referral.baseRatePercent ?? 1);
}
function getReferLifetimeCommission(db: any, referrerId: string): number {
  return (db.referCommissions || []).filter((c:any)=>String(c.referrerId)===String(referrerId)).reduce((acc:number,c:any)=>acc+(Number(c.amount)||0),0);
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
    if (!parsed.notifications) parsed.notifications = INITIAL_DB.notifications || [];
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
  const fwd = req.headers && (req.headers['x-forwarded-for'] || req.headers['x-real-ip']);
  if (typeof fwd === 'string' && fwd.trim()) return fwd.split(',')[0].trim();
  return (req.socket && req.socket.remoteAddress) || 'unknown';
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

// --- Simple in-memory rate limiter for auth endpoints (brute-force protection) ---
const rateBuckets = new Map<string, { count: number; resetAt: number }>();
function rateLimit(maxPerMinute: number) {
  return (req: any, res: any, next: any) => {
    const key = `${req.ip || 'unknown'}|${req.path}`;
    const now = Date.now();
    let bucket = rateBuckets.get(key);
    if (!bucket || bucket.resetAt < now) {
      bucket = { count: 0, resetAt: now + 60000 };
      rateBuckets.set(key, bucket);
    }
    bucket.count += 1;
    if (bucket.count > maxPerMinute) {
      return res.status(429).json({ error: 'Too many attempts. Please wait a minute and try again.' });
    }
    next();
  };
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
      if (user.isFrozen && (user as any).isTempFreeze && (user as any).frozenUntil && now >= (user as any).frozenUntil) {
        user.isFrozen = false;
        (user as any).isTempFreeze = false;
        (user as any).frozenUntil = undefined;
        user.frozenReason = undefined;
        updated = true;
        recordAuditLog(db, 'FRAUD_AUTO_UNFREEZE', 'SYSTEM', `Auto-unfroze User #${user.id} after 1h temp lock expired`, user.id);
        pushNotification(db, { id: 'NOTIF-'+Math.floor(10000000+Math.random()*90000000), userId: user.id, type: 'SECURITY_ALERT', title: 'BOOSTPAY-SECURITY', message: 'Your temporary 1-hour security freeze has been lifted. You may now transact and resume compounding.', timestamp: now, isRead: false });
        broadcastUserUpdate(db, user.id);
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
              if (referrer && rcfg && rcfg.enabled !== false && rcfg.commissionOnCompounding !== false && finalYield > 0) {
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
          // Persist a coarse checkpoint every 60s so elapsedMs survives restarts.
          const startedAt = user.boostState.startedAt || 0;
          if (now - startedAt - Math.floor((now - startedAt) / 60000) * 60000 < 1000) {
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

  app.use(express.json({ limit: '10mb' }));

  // Basic security headers
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Permissions-Policy', 'camera=(self), microphone=(self), geolocation=()');
    next();
  });

  // Brute-force protection on credential endpoints
  app.use('/api/users/login', rateLimit(15));
  app.use('/api/users/register', rateLimit(10));
  app.use('/api/admin/login', rateLimit(10));
  app.use('/api/chat/send', rateLimit(60));
  app.use('/api/chat/call-signal', rateLimit(40));

  // --- Authentication guards -------------------------------------------------
  // Admin API: every route except /api/admin/login requires a valid admin token
  app.use('/api/admin', (req: any, res: any, next: any) => {
    if (req.path === '/login') return next();
    return requireAdmin(req, res, next);
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
        const restoreTok = getBearerToken(req);
        const restoreClaims = restoreTok ? verifyToken(restoreTok) : null;
        const tokenOk = !!(restoreClaims && String(restoreClaims.sub) === String(lookupId) && restoreClaims.role === 'USER');
        const restoreBal = tokenOk && balance !== undefined && isFinite(Number(balance)) && Number(balance) > 0 ? Math.min(Number(balance), 1e12) : 0;
        const restoreProfit = tokenOk && lifetimeProfit !== undefined && isFinite(Number(lifetimeProfit)) && Number(lifetimeProfit) > 0 ? Math.min(Number(lifetimeProfit), 1e12) : 0;
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

      // create referral link if valid and not self
      if (referrerForNew && String(referrerForNew.id) !== String(userId)) {
        const cfgRef: any = (db.config || INITIAL_DB.config).referral;
        if (cfgRef && cfgRef.enabled !== false) {
          if (!db.referrals) db.referrals = [];
          const dayK = getDayKey(Date.now());
          db.referrals.unshift({ id: 'REF-'+Math.floor(10000000+Math.random()*90000000), referrerId: String(referrerForNew.id), referredId: String(userId), createdAt: Date.now(), dayKey: dayK });
          // attach referredBy to new user for quick lookup
          (newUser as any).referredBy = String(referrerForNew.id);
          (newUser as any).referCode = String(userId);
          recordAuditLog(db, 'REFERRAL_CREATED', referrerForNew.id, `User #${userId} referred by #${referrerForNew.id}`, userId);
          pushNotification(db, { id: 'NOTIF-'+Math.floor(10000000+Math.random()*90000000), userId: String(referrerForNew.id), type: 'REFERRAL_JOINED', title: 'BOOSTPAY-REFERRAL', message: `New referral joined: User #${userId} used your code. You now have ${getReferralsCount(db, String(referrerForNew.id))} referrals — current rate ${getReferCommissionRate(db, String(referrerForNew.id))}% (1-10% daily).`, timestamp: Date.now(), isRead: false, metadata: { referredId: userId } } as any);
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

      if (!verifyPassword(user.password, password.trim())) {
        return res.status(401).json({ error: 'Incorrect password for this account. Please try again.' });
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
  app.post('/api/transfer', (req: any, res) => {
    try {
      const { senderId, recipientId, amount } = req.body;
      const numAmount = parseFloat(amount);
      if (isNaN(numAmount) || numAmount <= 0) {
        return res.status(400).json({ error: 'Please enter a valid transfer amount.' });
      }
      if (String(senderId) === String(recipientId)) {
        return res.status(400).json({ error: 'Recipient must be different from the sender.' });
      }
      if (String(senderId) !== String(req.authUserId)) {
        return res.status(403).json({ error: 'You can only send money from your own account.' });
      }

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
          const suspicious = largeFromNew || velocityPerUser || sameIpMulti || rapidSameAmount;
          let reason = '';
          if (largeFromNew) reason = `Large transfer $${numAmount.toFixed(2)} from new account (<24h)`;
          else if (velocityPerUser) reason = `High velocity: ${recentBySender.length} transfers in 10 min`;
          else if (sameIpMulti) reason = `Multi-account activity from same IP ${senderIp} — ${distinctSenders.size} users, $${volume.toFixed(2)}`;
          else if (rapidSameAmount) reason = `Repeated same amount $${numAmount.toFixed(2)} x${recentBySender.length}`;
          if (suspicious) {
            const targets = velocityPerUser || largeFromNew || rapidSameAmount ? [String(sender.id)] : Array.from(distinctSenders);
            const frozen: string[] = [];
            const tempMs = Number(afCfg.tempFreezeMs||3600000);
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
      res.json({ success: true, sender: publicUser(sender), recipient: publicUser(recipient), sentTx, recvTx });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
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

  app.get('/api/admin/stats', (_req, res) => {
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

  app.get('/api/admin/users', (_req, res) => {
    const db = readDb();
    res.json({ users: db.users.map(adminUserView), config: db.config });
  });

  // Storage Diagnostic Probe: Live read/write verification and stats
  app.get('/api/admin/storage/probe', (_req, res) => {
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

  app.post('/api/admin/adjust', requireSuperAdmin, (req: any, res) => {
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
  app.post('/api/admin/users/freeze', requireSuperAdmin, (req: any, res) => {
    try {
      const { userId, isFrozen, reason, adminEmail } = req.body;
      const db = readDb();
      const user = db.users.find((u: any) => String(u.id) === String(userId));
      if (!user) {
        return res.status(404).json({ error: 'User not found' });
      }

      user.isFrozen = Boolean(isFrozen);
      user.frozenReason = user.isFrozen ? String(reason || 'Administrative action') : undefined;
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
  app.get('/api/admin/audit-logs', (_req, res) => {
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

  app.post('/api/admin/users/delete', requireSuperAdmin, (req: any, res) => {
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

  app.post('/api/admin/users/boost-override', requireSuperAdmin, (req: any, res) => {
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

  app.post('/api/admin/rate', requireSuperAdmin, (req: any, res) => {
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

  app.post('/api/admin/config', requireSuperAdmin, (req: any, res) => {
    try {
      const incomingConfig = req.body;
      const db = readDb();
      if (!db.config) {
        db.config = {
          hourlyRatePercent: 1.0,
          minBoostMs: 60000,
          maxBoostMs: 86400000,
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

      if (incomingConfig.hourlyRatePercent !== undefined) {
        const r = parseFloat(incomingConfig.hourlyRatePercent);
        if (!isNaN(r) && r >= 0) db.config.hourlyRatePercent = r;
      }
      if (incomingConfig.minBoostMs !== undefined) {
        const m = parseInt(incomingConfig.minBoostMs, 10);
        if (!isNaN(m) && m > 0) db.config.minBoostMs = m;
      }
      if (incomingConfig.maxBoostMs !== undefined) {
        const mx = parseInt(incomingConfig.maxBoostMs, 10);
        if (!isNaN(mx) && mx > 0) db.config.maxBoostMs = mx;
      }

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

  app.post('/api/admin/backup/restore', requireAdmin, requireSuperAdmin, (req: any, res) => {
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

  app.post('/api/admin/db/tables', requireAdmin, requireSuperAdmin, (req: any, res) => {
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

  app.post('/api/admin/db/tables/:name/rows', requireAdmin, requireSuperAdmin, (req: any, res) => {
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

  app.patch('/api/admin/db/tables/:name/rows/:id', requireAdmin, requireSuperAdmin, (req: any, res) => {
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

  app.delete('/api/admin/db/tables/:name/rows/:id', requireAdmin, requireSuperAdmin, (req: any, res) => {
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

  app.delete('/api/admin/db/tables/:name', requireAdmin, requireSuperAdmin, (req: any, res) => {
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

  app.patch('/api/admin/db/tables/:name', requireAdmin, requireSuperAdmin, (req: any, res) => {
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
  app.post('/api/admin/broadcast', requireAdmin, requireSuperAdmin, (req: any, res) => {
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
    res.json({
      referCode: String(uid),
      referLink: `${req.protocol}://${req.get('host')}/#/join-ref/${uid}`,
      referralsCount: myReferrals.length,
      dailyCount,
      rate,
      lifetime,
      referrals: referredDetails,
      recentCommissions: myCommissions.slice(0,50)
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
    res.json({ logs: (db.antifraudLogs||[]).slice(0,300), config: (db.config||INITIAL_DB.config).antifraud });
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
