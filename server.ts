import express from 'express';
import http from 'http';
import fs from 'fs';
import path from 'path';
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

function readDb() {
  try {
    if (!fs.existsSync(DB_FILE)) {
      fs.writeFileSync(DB_FILE, JSON.stringify(INITIAL_DB, null, 2), 'utf-8');
      return INITIAL_DB;
    }
    const raw = fs.readFileSync(DB_FILE, 'utf-8');
    const parsed = JSON.parse(raw);
    if (!parsed.users) parsed.users = INITIAL_DB.users;
    if (!parsed.transactions) parsed.transactions = INITIAL_DB.transactions;
    if (!parsed.conversations) parsed.conversations = [];
    if (!parsed.messages) parsed.messages = [];
    if (!parsed.notifications) parsed.notifications = INITIAL_DB.notifications || [];
    if (!parsed.config) parsed.config = INITIAL_DB.config;
    if (!parsed.auditLogs) parsed.auditLogs = INITIAL_DB.auditLogs || [];

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

function writeDb(data: any) {
  try {
    const tempFile = `${DB_FILE}.tmp`;
    fs.writeFileSync(tempFile, JSON.stringify(data, null, 2), 'utf-8');
    fs.renameSync(tempFile, DB_FILE);
  } catch (err) {
    console.error('Error writing db file:', err);
  }
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
          const yieldNotif = {
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
          };
          if (!db.notifications) db.notifications = [];
          db.notifications.unshift(yieldNotif);

          // Calculate new duration based on latest balance
          const nextDuration = calculateDynamicDuration(user.balance, db.users, config);

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
        } else {
          user.boostState.elapsedMs = elapsed;
          const startingBal = Number(user.boostState.startingBalance ?? user.balance);
          user.boostState.accumulatedYield = ratePerMs > 0
            ? (elapsed * ratePerMs < 1e-5
                ? startingBal * elapsed * ratePerMs
                : startingBal * Math.expm1(elapsed * Math.log1p(ratePerMs)))
            : 0;
          updated = true;
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

  // 3. Database snapshot
  app.get('/api/db', (_req, res) => {
    const db = readDb();
    res.json(db);
  });

  // 4. Single-user fetch endpoint (fast, keeps session synced without large payload)
  app.get('/api/users/:id', (req, res) => {
    const db = readDb();
    const user = db.users.find((u: any) => u.id === req.params.id);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    const userTxs = (db.transactions || []).filter((t: any) => t.userId === user.id);
    const userNotifs = (db.notifications || []).filter((n: any) => n.userId === user.id);
    res.json({ user, transactions: userTxs, notifications: userNotifs });
  });

  // 5. User registration & restoration endpoint
  app.post('/api/users/register', (req, res) => {
    try {
      const { id, email, phrase, password, balance, lifetimeProfit, boostState, createdAt } = req.body;
      const db = readDb();
      
      const cleanEmail = email ? email.trim().toLowerCase() : '';
      const cleanPhrase = phrase ? phrase.trim().toLowerCase() : '';

      // Check if email already belongs to an existing user
      if (cleanEmail) {
        const emailConflict = db.users.find((u: any) => u.email && u.email.toLowerCase() === cleanEmail);
        if (emailConflict) {
          return res.status(400).json({ error: 'An account with this email address already exists. Please sign in.' });
        }
      }

      // If restoring a legacy user by ID
      let userId = id ? (LEGACY_USER_ID_MAP[id] || id) : '';
      if (userId) {
        const existing = db.users.find((u: any) => u.id === userId || (cleanPhrase && u.phrase === cleanPhrase));
        if (existing) {
          if (cleanEmail && !existing.email) existing.email = cleanEmail;
          if (balance !== undefined && Number(balance) > (Number(existing.balance) || 0)) {
            existing.balance = Number(balance);
          }
          if (lifetimeProfit !== undefined && Number(lifetimeProfit) > (Number(existing.lifetimeProfit) || 0)) {
            existing.lifetimeProfit = Number(lifetimeProfit);
          }
          writeDb(db);
          return res.json({ success: true, user: existing, restored: true });
        }
      }

      // New registration: strictly allocate next serial ID (1, 2, 3...)
      userId = getNextSequentialUserId(db.users);

      const initialDuration = calculateDynamicDuration(balance !== undefined ? Number(balance) : 0, db.users, db.config);
      const newUser = {
        id: userId,
        email: cleanEmail || `user${userId}@boostpay.app`,
        balance: balance !== undefined ? Number(balance) : 0,
        lifetimeProfit: lifetimeProfit !== undefined ? Number(lifetimeProfit) : 0,
        password: (password || '').trim(),
        createdAt: createdAt || Date.now(),
        boostState: boostState || {
          isActive: false,
          isPaused: false,
          startedAt: 0,
          pausedAt: 0,
          elapsedMs: 0,
          targetDurationMs: initialDuration,
          startingBalance: balance !== undefined ? Number(balance) : 0,
          accumulatedYield: 0
        }
      };

      db.users.push(newUser);
      writeDb(db);
      res.json({ success: true, user: newUser });
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
      const user = db.users.find((u: any) => u.email && u.email.toLowerCase() === cleanEmail);

      if (!user) {
        return res.status(404).json({ error: 'No account found with this email address. Please create an account.' });
      }

      if (user.password && user.password !== password.trim()) {
        return res.status(401).json({ error: 'Incorrect password for this account. Please try again.' });
      }

      if (user.isBlocked) {
        return res.status(403).json({ error: 'This account has been suspended by system administrator.' });
      }

      if (user.isTempLocked) {
        return res.status(403).json({ error: 'Account is temporarily locked. Contact support.' });
      }

      res.json({ success: true, user });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // 6. Direct Server-Side Boost Endpoints (authoritative state!)
  app.post('/api/boost/start', (req, res) => {
    try {
      const { userId } = req.body;
      const db = readDb();
      const user = db.users.find((u: any) => u.id === userId);
      if (!user) {
        return res.status(404).json({ error: 'User not found' });
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
      res.json({ success: true, user });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/boost/pause', (req, res) => {
    try {
      const { userId } = req.body;
      const db = readDb();
      const user = db.users.find((u: any) => u.id === userId);
      if (!user || !user.boostState) {
        return res.status(404).json({ error: 'User not found' });
      }

      user.boostState.isPaused = true;
      user.boostState.pausedAt = Date.now();
      writeDb(db);
      res.json({ success: true, user });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/boost/resume', (req, res) => {
    try {
      const { userId } = req.body;
      const db = readDb();
      const user = db.users.find((u: any) => u.id === userId);
      if (!user || !user.boostState) {
        return res.status(404).json({ error: 'User not found' });
      }

      user.boostState.isPaused = false;
      user.boostState.startedAt = Date.now() - (user.boostState.elapsedMs || 0);
      user.boostState.pausedAt = 0;
      writeDb(db);
      res.json({ success: true, user });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/boost/status/:userId', (req, res) => {
    const db = readDb();
    const user = db.users.find((u: any) => u.id === req.params.userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    res.json({
      user,
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

      // Merge users safely rather than blind overwrite
      let mergedUsers = [...current.users];
      if (Array.isArray(incoming.users)) {
        for (const incUser of incoming.users) {
          const idx = mergedUsers.findIndex(u => u.id === incUser.id);
          if (idx >= 0) {
            // Preserve active server boostState if running on server
            // Authoritative server balance is STRICTLY preserved; client sync cannot overwrite balance
            const serverUser = mergedUsers[idx];
            mergedUsers[idx] = {
              ...incUser,
              boostState: (serverUser.boostState && serverUser.boostState.isActive) ? serverUser.boostState : incUser.boostState,
              balance: serverUser.balance !== undefined ? Number(serverUser.balance) : Number(incUser.balance || 0)
            };
          } else {
            mergedUsers.push(incUser);
          }
        }
      }

      const transactionsToSave = Array.isArray(incoming.transactions) && incoming.transactions.length > 0
        ? incoming.transactions
        : current.transactions;

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

      const notificationsToSave = Array.isArray(incoming.notifications)
        ? incoming.notifications
        : (current.notifications || []);

      const configToSave = incoming.config || current.config;

      const updatedDb = {
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
  app.get('/api/chat/stream', (req, res) => {
    const userId = (req.query.userId as string) || '';
    if (!userId) {
      return res.status(400).send('userId is required');
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

  app.get('/api/chat/messages', (req, res) => {
    const userId = (req.query.userId as string) || '';
    const conversationId = (req.query.conversationId as string) || '';
    const db = readDb();

    let userConvs = db.conversations || [];
    let userMsgs = db.messages || [];

    if (userId && userId !== 'ADMIN_SUPPORT') {
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

  app.post('/api/chat/send', (req, res) => {
    try {
      const { senderId, senderRole, recipientId, text } = req.body;
      const cleanText = (text || '').trim();
      const cleanSender = String(senderId || '').trim();
      const cleanRecipient = String(recipientId || '').trim();

      if (!cleanText) {
        return res.status(400).json({ error: 'Message cannot be empty.' });
      }
      if (!cleanSender) {
        return res.status(400).json({ error: 'Sender ID is required.' });
      }
      if (!cleanRecipient) {
        return res.status(400).json({ error: 'Recipient ID is required.' });
      }

      const db = readDb();
      if (!db.conversations) db.conversations = [];
      if (!db.messages) db.messages = [];

      // Determine canonical conversation ID & participants
      let convId = '';
      let participants: string[] = [];

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
        // Also check if any existing conversation matches both participants
        conv = db.conversations.find((c: any) =>
          Array.isArray(c.participants) &&
          c.participants.length === participants.length &&
          participants.every((p: string) => c.participants.includes(p))
        );
      }

      if (!conv) {
        conv = {
          id: convId,
          participants,
          lastMessage: cleanText,
          lastMessageAt: now
        };
        db.conversations.unshift(conv);
      } else {
        conv.lastMessage = cleanText;
        conv.lastMessageAt = now;
      }

      const newMsg = {
        id: `MSG-${now}-${Math.random().toString(36).substring(2, 7)}`,
        conversationId: conv.id,
        senderId: cleanSender,
        senderRole: senderRole || (cleanSender === 'ADMIN_SUPPORT' ? 'ADMIN' : 'USER'),
        text: cleanText,
        timestamp: now
      };

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

  app.post('/api/chat/react', (req, res) => {
    try {
      const { messageId, userId, emoji } = req.body;
      const cleanMsgId = String(messageId || '').trim();
      const cleanUserId = String(userId || '').trim();
      const cleanEmoji = String(emoji || '').trim();

      if (!cleanMsgId || !cleanUserId || !cleanEmoji) {
        return res.status(400).json({ error: 'messageId, userId, and emoji are required.' });
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

  // 7b. Server-Authoritative Instant P2P Transfer with SMS Notifications
  app.post('/api/transfer', (req, res) => {
    try {
      const { senderId, recipientId, amount } = req.body;
      const numAmount = parseFloat(amount);
      if (isNaN(numAmount) || numAmount <= 0) {
        return res.status(400).json({ error: 'Please enter a valid transfer amount.' });
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

      const sentTx = {
        id: 'TX-' + Math.floor(10000000 + Math.random() * 90000000),
        userId: sender.id,
        type: 'TRANSFER_SENT',
        amount: numAmount,
        recipientId: recipient.id,
        timestamp: Date.now(),
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

      if (!db.notifications) db.notifications = [];
      db.notifications.unshift(recvNotif);
      db.notifications.unshift(sentNotif);

      // Recalculate boost durations
      if (sender.boostState) {
        sender.boostState.targetDurationMs = calculateDynamicDuration(sender.balance, db.users, db.config);
      }
      if (recipient.boostState) {
        recipient.boostState.targetDurationMs = calculateDynamicDuration(recipient.balance, db.users, db.config);
      }

      writeDb(db);
      res.json({ success: true, sender, recipient, sentTx, recvTx, recvNotif, sentNotif });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // 7c. Notification System Endpoints
  app.get('/api/notifications/:userId', (req, res) => {
    const db = readDb();
    const userNotifs = (db.notifications || [])
      .filter((n: any) => n.userId === req.params.userId)
      .sort((a: any, b: any) => (b.timestamp || 0) - (a.timestamp || 0));
    res.json(userNotifs);
  });

  app.post('/api/notifications/mark-read', (req, res) => {
    try {
      const { userId, notificationId } = req.body;
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

  app.post('/api/notifications/delete', (req, res) => {
    try {
      const { userId, notificationId } = req.body;
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
  app.post('/api/admin/login', (req, res) => {
    try {
      const { email, password } = req.body;
      const cleanEmail = (email || '').trim().toLowerCase();
      const cleanPass = (password || '').trim();

      if (cleanEmail === 'admin@gmail.com' && (cleanPass === '123456' || cleanPass === 'admin786')) {
        const token = 'admin_sess_' + Date.now() + '_' + Math.random().toString(36).substring(2, 9);
        return res.json({
          success: true,
          token,
          email: 'admin@gmail.com',
          role: 'SUPER_ADMIN',
          loginTime: Date.now()
        });
      }
      return res.status(401).json({ error: 'Invalid administrator credentials' });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
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
        host: db.config?.dokploy?.host || 'boostpay-eoqehk',
        port: db.config?.dokploy?.port || 5432,
        database: db.config?.dokploy?.database || 'boostpaydb',
        isConnected: true,
        lastPingMs: 28
      }
    });
  });

  app.get('/api/admin/users', (_req, res) => {
    const db = readDb();
    res.json({ users: db.users, config: db.config });
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
  app.get('/api/admin/db/export', (_req, res) => {
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
  app.post('/api/admin/db/import', (req, res) => {
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
        users: Array.from(mergedMap.values()),
        transactions: mergedTxs,
        conversations: payload.conversations || existing.conversations || [],
        messages: payload.messages || existing.messages || [],
        notifications: payload.notifications || existing.notifications || [],
        config: payload.config || existing.config
      };

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

  app.post('/api/admin/adjust', (req, res) => {
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
        req.body.adminEmail || 'admin@boostpay.app',
        `Adjusted balance: ${type} $${numAmount.toFixed(2)} to User #${user.id}. Note: ${notes || 'Treasury ' + type}`,
        user.id
      );

      writeDb(db);
      res.json({ success: true, user });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/admin/status', (req, res) => {
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
        adminEmail || 'admin@boostpay.app',
        `User #${user.id} account status changed to ${action}`,
        user.id
      );

      writeDb(db);
      res.json({ success: true, user });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Account freeze toggle endpoint
  app.post('/api/admin/users/freeze', (req, res) => {
    try {
      const { userId, isFrozen, reason, adminEmail } = req.body;
      const db = readDb();
      const user = db.users.find((u: any) => String(u.id) === String(userId));
      if (!user) {
        return res.status(404).json({ error: 'User not found' });
      }

      user.isFrozen = Boolean(isFrozen);
      const actionName = user.isFrozen ? 'FREEZE_USER' : 'UNFREEZE_USER';
      recordAuditLog(
        db,
        actionName,
        adminEmail || 'admin@boostpay.app',
        `User #${user.id} account ${user.isFrozen ? 'frozen' : 'unfrozen'}. Reason: ${reason || 'Administrative action'}`,
        user.id
      );

      writeDb(db);
      res.json({ success: true, user });
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

  app.post('/api/admin/users/password', (req, res) => {
    try {
      const { userId, newPassword, adminEmail } = req.body;
      const db = readDb();
      const user = db.users.find((u: any) => u.id === userId);
      if (!user) {
        return res.status(404).json({ error: 'User not found' });
      }

      user.password = newPassword.trim();
      recordAuditLog(
        db,
        'PASSWORD_RESET',
        adminEmail || 'admin@boostpay.app',
        `Password reset performed for User #${user.id}`,
        user.id
      );

      writeDb(db);
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/admin/users/delete', (req, res) => {
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

  app.post('/api/admin/users/boost-override', (req, res) => {
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
      res.json({ success: true, user });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/admin/rate', (req, res) => {
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

  app.post('/api/admin/config', (req, res) => {
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

  app.get('/api/admin/backup', (_req, res) => {
    const db = readDb();
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename=boostpay_backup_${Date.now()}.json`);
    res.send(JSON.stringify(db, null, 2));
  });

  const isProduction = process.env.NODE_ENV === 'production';
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
    app.use(express.static(path.join(__dirname, 'dist')));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(__dirname, 'dist', 'index.html'));
    });
  }

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`BoostPay Server listening on port ${PORT} [Version: ${SERVER_VERSION}]`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start BoostPay server:', err);
});
