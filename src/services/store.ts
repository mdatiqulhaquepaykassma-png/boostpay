import { User, Transaction, Conversation, Message, SystemConfig, InboxNotification } from '../types';
import { copyToClipboard as clipboardHelper } from '../utils/clipboard';

const STORAGE_USERS = 'boostpay_users_v4';
const STORAGE_CURRENT_USER = 'boostpay_current_user_v4';
const STORAGE_CURRENT_USER_ID = 'boostpay_current_user_id_v4';
const STORAGE_ADMIN_SESSION = 'boostpay_admin_session_v4';
const STORAGE_TRANSACTIONS = 'boostpay_transactions_v4';
const STORAGE_CONVERSATIONS = 'boostpay_conversations_v4';
const STORAGE_MESSAGES = 'boostpay_messages_v4';
const STORAGE_NOTIFICATIONS = 'boostpay_notifications_v4';
const STORAGE_CONFIG = 'boostpay_config_v4';

export interface ToastData {
  id: string;
  type: 'TRANSFER_RECEIVED' | 'TRANSFER_SENT' | 'YIELD_REWARD' | 'SYSTEM_ALERT' | 'CHAT_MESSAGE';
  title: string;
  amount?: number;
  senderId?: string;
  referenceId?: string;
  conversationId?: string;
  timestamp: number;
  message: string;
}

// Legacy keys for seamless migration and zero-logout upgrade
const LEGACY_USER_KEYS = [
  'boostpay_current_user_v4',
  'boostpay_current_user',
  'boostpay_auth_user',
  'boostpay_user',
  'boostpay_current_user_v3'
];

const LEGACY_USER_ID_KEYS = [
  'boostpay_current_user_id_v4',
  'boostpay_current_user_id',
  'boostpay_user_id'
];

export interface AdminSession {
  isLoggedIn: boolean;
  email: string;
  token: string;
  loginTime: number;
}

export const MNEMONIC_WORDS = [
  'alpha', 'beacon', 'crypto', 'dynamic', 'ember', 'falcon',
  'galaxy', 'harbor', 'impact', 'jupiter', 'kinetic', 'legacy',
  'matrix', 'nebula', 'orbit', 'plasma', 'quantum', 'ripple',
  'stellar', 'titan', 'uranus', 'vertex', 'zenith', 'vector'
];

export function generateMnemonic(): string {
  const words: string[] = [];
  for (let i = 0; i < 12; i++) {
    const idx = Math.floor(Math.random() * MNEMONIC_WORDS.length);
    words.push(MNEMONIC_WORDS[idx]);
  }
  return words.join(' ');
}

export const LEGACY_USER_MAP: Record<string, string> = {
  '849201': '1',
  '223344': '2'
};

export function getNextSequentialUserId(existingUsers?: User[]): string {
  const users = existingUsers || BoostPayStore.getUsers();
  if (!users || !Array.isArray(users) || users.length === 0) return '1';
  const numericIds = users
    .map(u => parseInt(u.id, 10))
    .filter(num => !isNaN(num) && num > 0 && num < 100000);
  if (numericIds.length === 0) return '1';
  return (Math.max(...numericIds) + 1).toString();
}

export function generateNumericId(existingUsers?: User[]): string {
  return getNextSequentialUserId(existingUsers);
}

/**
 * Foolproof clipboard copy function supporting modern browsers,
 * iframes, mobile WebViews, and desktop.
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  return clipboardHelper(text);
}

export function getDefaultConfig(): SystemConfig {
  return {
    hourlyRatePercent: 1.0,
    minBoostMs: 60 * 1000, // 1 minute
    maxBoostMs: 24 * 60 * 60 * 1000, // 24 hours
    dokploy: {
      host: 'boostpay-eoqehk',
      port: 5432,
      database: 'boostpaydb',
      user: 'boostpaydbuser',
      externalIp: '72.60.42.18',
      dockerHostname: 'boostpay-eoqehk',
      isConnected: true,
      lastPingMs: 42
    }
  };
}

export class BoostPayStore {
  private static isSyncing = false;
  private static toastListeners: ((toast: ToastData) => void)[] = [];
  private static seenNotificationIds = new Set<string>();
  private static hasSeededInitialHistory = false;

  /**
   * Initialize and smart-merge with server database
   * Never overwrites or logs out the local user!
   */
  static async initSync(): Promise<void> {
    try {
      const res = await fetch('/api/db');
      if (res.ok) {
        const data = await res.json();
        
        // Smart non-destructive merge users
        if (data.users && Array.isArray(data.users)) {
          const localUsers = this.getUsers();
          const mergedMap = new Map<string, User>();

          // 1. Populate with server users
          for (const serverU of data.users) {
            mergedMap.set(serverU.id, serverU);
          }

          // 2. Intelligently merge local users (preserve secrets, credentials & higher balances)
          let needsPushToServer = false;
          for (const localU of localUsers) {
            if (mergedMap.has(localU.id)) {
              const serverU = mergedMap.get(localU.id)!;
              const mergedUser: User = {
                ...serverU,
                phrase: localU.phrase || serverU.phrase,
                password: localU.password || serverU.password,
                balance: Math.max(Number(serverU.balance) || 0, Number(localU.balance) || 0),
                lifetimeProfit: Math.max(Number(serverU.lifetimeProfit) || 0, Number(localU.lifetimeProfit) || 0),
                boostState: (serverU.boostState && serverU.boostState.isActive)
                  ? serverU.boostState
                  : (localU.boostState || serverU.boostState)
              };
              mergedMap.set(localU.id, mergedUser);
            } else {
              // Local user missing on server (e.g. after container redeploy): self-heal!
              mergedMap.set(localU.id, localU);
              needsPushToServer = true;
              fetch('/api/users/register', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  id: localU.id,
                  phrase: localU.phrase,
                  password: localU.password,
                  balance: localU.balance,
                  lifetimeProfit: localU.lifetimeProfit,
                  boostState: localU.boostState,
                  createdAt: localU.createdAt
                })
              }).catch(() => {});
            }
          }

          const mergedUsers = Array.from(mergedMap.values());
          localStorage.setItem(STORAGE_USERS, JSON.stringify(mergedUsers));
          localStorage.setItem('boostpay_users', JSON.stringify(mergedUsers));

          if (needsPushToServer) {
            setTimeout(() => this.pushToServer(), 300);
          }
        }

        // Smart merge transactions
        if (data.transactions && Array.isArray(data.transactions)) {
          const localTxs = this.getTransactions();
          const mergedTxs = [...data.transactions];
          let addedTxs = false;
          for (const ltx of localTxs) {
            if (!mergedTxs.some(t => t.id === ltx.id)) {
              mergedTxs.push(ltx);
              addedTxs = true;
            }
          }
          localStorage.setItem(STORAGE_TRANSACTIONS, JSON.stringify(mergedTxs));
          if (addedTxs) {
            setTimeout(() => this.pushToServer(), 500);
          }
        }

        if (data.conversations && Array.isArray(data.conversations)) {
          localStorage.setItem(STORAGE_CONVERSATIONS, JSON.stringify(data.conversations));
        }

        if (data.messages && Array.isArray(data.messages)) {
          localStorage.setItem(STORAGE_MESSAGES, JSON.stringify(data.messages));
        }

        if (data.notifications && Array.isArray(data.notifications)) {
          const localNotifs = this.getNotifications();
          const mergedNotifs = [...data.notifications];
          for (const ln of localNotifs) {
            if (!mergedNotifs.some(n => n.id === ln.id)) {
              mergedNotifs.push(ln);
            }
          }
          localStorage.setItem(STORAGE_NOTIFICATIONS, JSON.stringify(mergedNotifs));

          // Seed seen notifications on initial load
          if (!this.hasSeededInitialHistory) {
            for (const n of mergedNotifs) {
              this.seenNotificationIds.add(n.id);
            }
            if (data.transactions) {
              for (const t of data.transactions) {
                this.seenNotificationIds.add(t.id);
              }
            }
            this.hasSeededInitialHistory = true;
          }
        }

        if (data.config) {
          localStorage.setItem(STORAGE_CONFIG, JSON.stringify(data.config));
        }

        // Refresh current user session from merged data without resetting
        const curUser = this.getCurrentUser();
        if (curUser) {
          const fresh = this.getUsers().find(u => u.id === curUser.id);
          if (fresh) {
            const preserved: User = {
              ...fresh,
              phrase: curUser.phrase || fresh.phrase,
              password: curUser.password || fresh.password
            };
            this.setCurrentUser(preserved);
          }
        }
      }
    } catch {
      // Offline fallback: keep existing local cache
    }
  }

  /**
   * Push local state to persistent server database
   */
  static async pushToServer(): Promise<void> {
    if (this.isSyncing) return;
    this.isSyncing = true;
    try {
      await fetch('/api/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          users: this.getUsers(),
          transactions: this.getTransactions(),
          conversations: this.getConversations(),
          messages: this.getMessages(),
          notifications: this.getNotifications(),
          config: this.getConfig()
        })
      });
    } catch {
      // Background retry on next tick
    } finally {
      this.isSyncing = false;
    }
  }

  /**
   * Fetch all users from server and update local storage
   */
  static async syncAllUsers(): Promise<User[]> {
    try {
      const res = await fetch('/api/db');
      if (res.ok) {
        const data = await res.json();
        if (data.users && Array.isArray(data.users)) {
          localStorage.setItem(STORAGE_USERS, JSON.stringify(data.users));
          localStorage.setItem('boostpay_users', JSON.stringify(data.users));
          return data.users;
        }
      }
    } catch (err) {
      console.warn('syncAllUsers network error:', err);
    }
    return this.getUsers();
  }

  private static chatEventSource: EventSource | null = null;
  private static activeStreamUserId: string | null = null;

  /**
   * Generates a stable canonical conversation ID regardless of which user started the chat:
   * e.g. User 1 and User 2 -> CONV-1-2
   * e.g. User 2 and Admin Support -> CONV-2-ADMIN_SUPPORT
   */
  static getCanonicalConversationId(userA: string, userB: string): string {
    const cleanA = String(userA || '').trim();
    const cleanB = String(userB || '').trim();
    if (cleanA === 'ADMIN_SUPPORT' || cleanB === 'ADMIN_SUPPORT') {
      const peer = cleanA === 'ADMIN_SUPPORT' ? cleanB : cleanA;
      return `CONV-${peer}-ADMIN_SUPPORT`;
    }
    const sorted = [cleanA, cleanB].sort((a, b) =>
      a.localeCompare(b, undefined, { numeric: true })
    );
    return `CONV-${sorted[0]}-${sorted[1]}`;
  }

  /**
   * Initializes real-time Server-Sent Events (SSE) chat connection for a user or admin
   */
  static initChatStream(userId: string): () => void {
    if (!userId) return () => {};

    // Don't recreate if already streaming for this exact user
    if (this.chatEventSource && this.activeStreamUserId === userId) {
      return () => {};
    }

    if (this.chatEventSource) {
      this.chatEventSource.close();
      this.chatEventSource = null;
    }

    this.activeStreamUserId = userId;
    let isTerminated = false;

    const connect = () => {
      if (isTerminated) return;
      try {
        const es = new EventSource(`/api/chat/stream?userId=${encodeURIComponent(userId)}`);
        this.chatEventSource = es;

        es.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data);
            if (data.type === 'chat_message' && data.message && data.conversation) {
              const incomingMsg: Message = data.message;
              const incomingConv: Conversation = data.conversation;

              // 1. Update local messages non-destructively
              const msgs = this.getMessages();
              if (!msgs.some(m => m.id === incomingMsg.id)) {
                msgs.push(incomingMsg);
                localStorage.setItem(STORAGE_MESSAGES, JSON.stringify(msgs));
              }

              // 2. Update local conversations
              const convs = this.getConversations();
              const cIdx = convs.findIndex(c => c.id === incomingConv.id);
              if (cIdx >= 0) {
                convs[cIdx] = { ...convs[cIdx], ...incomingConv };
              } else {
                convs.unshift(incomingConv);
              }
              localStorage.setItem(STORAGE_CONVERSATIONS, JSON.stringify(convs));

              // 3. Notify chat listeners immediately
              this.triggerChatUpdate(convs, msgs);

              // 4. Trigger incoming toast alert if message is from a peer or support
              if (incomingMsg.senderId !== userId) {
                const isFromAdmin = incomingMsg.senderId === 'ADMIN_SUPPORT' || incomingMsg.senderRole === 'ADMIN';
                this.triggerToast({
                  id: incomingMsg.id,
                  type: 'CHAT_MESSAGE',
                  title: isFromAdmin ? 'Verified Support' : `User #${incomingMsg.senderId}`,
                  senderId: incomingMsg.senderId,
                  conversationId: incomingConv.id,
                  timestamp: incomingMsg.timestamp,
                  message: incomingMsg.text
                });
              }
            } else if (data.type === 'reaction_update' && data.messageId) {
              const msgs = this.getMessages();
              const idx = msgs.findIndex(m => m.id === data.messageId);
              if (idx >= 0) {
                msgs[idx] = { ...msgs[idx], reactions: data.reactions };
                localStorage.setItem(STORAGE_MESSAGES, JSON.stringify(msgs));
                this.triggerChatUpdate(this.getConversations(), msgs);
              }
            }
          } catch (e) {
            console.warn('Error parsing SSE event data:', e);
          }
        };

        es.onerror = () => {
          if (!isTerminated) {
            es.close();
            this.chatEventSource = null;
            // Auto reconnect after 2.5s
            setTimeout(() => {
              if (!isTerminated) connect();
            }, 2500);
          }
        };
      } catch (err) {
        console.warn('SSE stream error:', err);
      }
    };

    connect();

    return () => {
      isTerminated = true;
      if (this.chatEventSource) {
        this.chatEventSource.close();
        this.chatEventSource = null;
      }
      this.activeStreamUserId = null;
    };
  }

  /**
   * Toggle emoji reaction on a message
   */
  static async toggleMessageReaction(
    messageId: string,
    emoji: string,
    userId: string
  ): Promise<{ success: boolean; reactions?: Record<string, string[]> }> {
    const msgs = this.getMessages();
    const idx = msgs.findIndex(m => m.id === messageId);
    let updatedReactions: Record<string, string[]> = {};

    if (idx >= 0) {
      const msg = msgs[idx];
      const reactions = { ...(msg.reactions || {}) };
      const currentList: string[] = Array.isArray(reactions[emoji]) ? [...reactions[emoji]] : [];
      if (currentList.includes(userId)) {
        reactions[emoji] = currentList.filter(id => id !== userId);
        if (reactions[emoji].length === 0) delete reactions[emoji];
      } else {
        reactions[emoji] = [...currentList, userId];
      }
      msgs[idx] = { ...msg, reactions };
      localStorage.setItem(STORAGE_MESSAGES, JSON.stringify(msgs));
      this.triggerChatUpdate(this.getConversations(), msgs);
      updatedReactions = reactions;
    }

    try {
      const res = await fetch('/api/chat/react', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messageId, userId, emoji })
      });
      if (res.ok) {
        const data = await res.json();
        return { success: true, reactions: data.reactions };
      }
    } catch {
      // Keep optimistic
    }
    return { success: true, reactions: updatedReactions };
  }

  /**
   * Atomic message sender invoking authoritative /api/chat/send
   */
  static async sendChatMessage(
    recipientId: string,
    text: string,
    senderRole?: 'USER' | 'ADMIN'
  ): Promise<{ success: boolean; message?: Message; conversation?: Conversation; error?: string }> {
    const cur = this.getCurrentUser();
    const senderId = senderRole === 'ADMIN' ? 'ADMIN_SUPPORT' : (cur?.id || '1');
    const role = senderRole || (senderId === 'ADMIN_SUPPORT' ? 'ADMIN' : 'USER');

    const cleanText = text.trim();
    if (!cleanText) return { success: false, error: 'Message cannot be empty' };

    const convId = this.getCanonicalConversationId(senderId, recipientId);
    const now = Date.now();

    // Optimistic message
    const optimisticMsg: Message = {
      id: `MSG-OPT-${now}-${Math.random().toString(36).substring(2, 6)}`,
      conversationId: convId,
      senderId,
      senderRole: role,
      text: cleanText,
      timestamp: now
    };

    // Save optimistically locally
    const localMsgs = this.getMessages();
    localMsgs.push(optimisticMsg);
    localStorage.setItem(STORAGE_MESSAGES, JSON.stringify(localMsgs));

    const localConvs = this.getConversations();
    const cIdx = localConvs.findIndex(c => c.id === convId);
    let updatedConv: Conversation;
    if (cIdx >= 0) {
      localConvs[cIdx].lastMessage = cleanText;
      localConvs[cIdx].lastMessageAt = now;
      updatedConv = localConvs[cIdx];
    } else {
      updatedConv = {
        id: convId,
        participants: senderId === 'ADMIN_SUPPORT'
          ? [recipientId, 'ADMIN_SUPPORT']
          : [senderId, recipientId].sort((a, b) => a.localeCompare(b, undefined, { numeric: true })),
        lastMessage: cleanText,
        lastMessageAt: now
      };
      localConvs.unshift(updatedConv);
    }
    localStorage.setItem(STORAGE_CONVERSATIONS, JSON.stringify(localConvs));
    this.triggerChatUpdate(localConvs, localMsgs);

    try {
      const res = await fetch('/api/chat/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          senderId,
          senderRole: role,
          recipientId,
          text: cleanText
        })
      });

      if (res.ok) {
        const data = await res.json();
        if (data.message) {
          // Replace optimistic message with confirmed server message
          const refreshedMsgs = this.getMessages().map(m =>
            m.id === optimisticMsg.id ? data.message : m
          );
          localStorage.setItem(STORAGE_MESSAGES, JSON.stringify(refreshedMsgs));
          const refreshedConvs = this.getConversations().map(c =>
            c.id === convId ? { ...c, ...data.conversation } : c
          );
          localStorage.setItem(STORAGE_CONVERSATIONS, JSON.stringify(refreshedConvs));
          this.triggerChatUpdate(refreshedConvs, refreshedMsgs);
          return { success: true, message: data.message, conversation: data.conversation };
        }
      }
      return { success: true, message: optimisticMsg, conversation: updatedConv };
    } catch {
      // Offline fallback: keep optimistic message
      return { success: true, message: optimisticMsg, conversation: updatedConv };
    }
  }

  /**
   * Fetch conversations and messages from server real-time without full database bloat
   */
  static async syncChatState(userId?: string): Promise<{ conversations: Conversation[], messages: Message[] }> {
    try {
      const query = userId ? `?userId=${encodeURIComponent(userId)}` : '';
      const res = await fetch(`/api/chat/messages${query}`);
      if (res.ok) {
        const data = await res.json();
        const incomingConvs: Conversation[] = data.conversations || [];
        const incomingMsgs: Message[] = data.messages || [];

        // Merge incoming messages non-destructively
        const localMsgs = this.getMessages();
        const msgMap = new Map<string, Message>();
        for (const m of localMsgs) msgMap.set(m.id, m);
        for (const m of incomingMsgs) msgMap.set(m.id, m);
        const mergedMsgs = Array.from(msgMap.values()).sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
        localStorage.setItem(STORAGE_MESSAGES, JSON.stringify(mergedMsgs));

        // Merge incoming conversations non-destructively
        const localConvs = this.getConversations();
        const convMap = new Map<string, Conversation>();
        for (const c of localConvs) convMap.set(c.id, c);
        for (const c of incomingConvs) {
          if (!convMap.has(c.id)) {
            convMap.set(c.id, c);
          } else {
            const cur = convMap.get(c.id)!;
            if ((c.lastMessageAt || 0) >= (cur.lastMessageAt || 0)) {
              convMap.set(c.id, { ...cur, ...c });
            }
          }
        }
        const mergedConvs = Array.from(convMap.values()).sort((a, b) => (b.lastMessageAt || 0) - (a.lastMessageAt || 0));
        localStorage.setItem(STORAGE_CONVERSATIONS, JSON.stringify(mergedConvs));

        this.triggerChatUpdate(mergedConvs, mergedMsgs);
        return {
          conversations: mergedConvs,
          messages: mergedMsgs
        };
      }
    } catch (err) {
      console.warn('syncChatState network error:', err);
    }
    const conversations = this.getConversations();
    const messages = this.getMessages();
    this.triggerChatUpdate(conversations, messages);
    return {
      conversations,
      messages
    };
  }

  static getUsers(): User[] {
    const raw = localStorage.getItem(STORAGE_USERS) || localStorage.getItem('boostpay_users');
    if (!raw) return [];
    try {
      const parsed: User[] = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      let needsSave = false;
      const migrated = parsed.map(u => {
        if (LEGACY_USER_MAP[u.id]) {
          needsSave = true;
          return { ...u, id: LEGACY_USER_MAP[u.id] };
        }
        return u;
      });
      if (needsSave) {
        localStorage.setItem(STORAGE_USERS, JSON.stringify(migrated));
        localStorage.setItem('boostpay_users', JSON.stringify(migrated));
      }
      return migrated;
    } catch {
      return [];
    }
  }

  static saveUsers(users: User[]): void {
    localStorage.setItem(STORAGE_USERS, JSON.stringify(users));
    localStorage.setItem('boostpay_users', JSON.stringify(users));
    this.pushToServer();
  }

  /**
   * Synchronous, instant session retriever - NEVER resets or logs out on reload!
   * Checks primary storage key, fallback legacy keys, and stored User ID.
   */
  static getCurrentUser(): User | null {
    // 1. Try primary storage key
    let raw = localStorage.getItem(STORAGE_CURRENT_USER);

    // 2. Fallback to legacy keys
    if (!raw) {
      for (const k of LEGACY_USER_KEYS) {
        const val = localStorage.getItem(k);
        if (val) {
          raw = val;
          localStorage.setItem(STORAGE_CURRENT_USER, val);
          break;
        }
      }
    }

    if (raw) {
      try {
        const parsed: User = JSON.parse(raw);
        if (parsed && parsed.id) {
          if (LEGACY_USER_MAP[parsed.id]) {
            parsed.id = LEGACY_USER_MAP[parsed.id];
            localStorage.setItem(STORAGE_CURRENT_USER, JSON.stringify(parsed));
            localStorage.setItem(STORAGE_CURRENT_USER_ID, parsed.id);
          }
          // Merge with freshest user from collection
          const users = this.getUsers();
          const fresh = users.find(u => u.id === parsed.id);
          if (fresh) {
            return {
              ...fresh,
              phrase: fresh.phrase || parsed.phrase,
              password: fresh.password || parsed.password
            };
          }
          return parsed;
        }
      } catch {
        // Fall through to ID-based lookup
      }
    }

    // 3. Fallback: check stored user ID
    for (const idKey of LEGACY_USER_ID_KEYS) {
      let curId = localStorage.getItem(idKey);
      if (curId) {
        if (LEGACY_USER_MAP[curId]) {
          curId = LEGACY_USER_MAP[curId];
          localStorage.setItem(idKey, curId);
        }
        const users = this.getUsers();
        const user = users.find(u => u.id === curId);
        if (user) {
          localStorage.setItem(STORAGE_CURRENT_USER, JSON.stringify(user));
          localStorage.setItem(STORAGE_CURRENT_USER_ID, user.id);
          return user;
        }
      }
    }

    return null;
  }

  /**
   * Sets current user session both by object and by ID across multiple keys
   */
  static setCurrentUser(user: User | null): void {
    if (!user) {
      localStorage.removeItem(STORAGE_CURRENT_USER);
      localStorage.removeItem(STORAGE_CURRENT_USER_ID);
      for (const k of LEGACY_USER_KEYS) localStorage.removeItem(k);
      for (const k of LEGACY_USER_ID_KEYS) localStorage.removeItem(k);
    } else {
      const serialized = JSON.stringify(user);
      localStorage.setItem(STORAGE_CURRENT_USER, serialized);
      localStorage.setItem(STORAGE_CURRENT_USER_ID, user.id);
      localStorage.setItem('boostpay_current_user', serialized);
      localStorage.setItem('boostpay_user_id', user.id);

      // Ensure user is also saved in users array
      const users = this.getUsers();
      const idx = users.findIndex(u => u.id === user.id);
      if (idx >= 0) {
        users[idx] = { ...users[idx], ...user };
      } else {
        users.push(user);
      }
      localStorage.setItem(STORAGE_USERS, JSON.stringify(users));
      localStorage.setItem('boostpay_users', JSON.stringify(users));
    }
  }

  /**
   * Admin session management: completely decoupled from user state!
   * Persists across page reload and reboots.
   */
  static getAdminSession(): AdminSession | null {
    try {
      const raw = localStorage.getItem(STORAGE_ADMIN_SESSION);
      if (!raw) return null;
      const parsed: AdminSession = JSON.parse(raw);
      if (parsed && parsed.isLoggedIn) {
        return parsed;
      }
      return null;
    } catch {
      return null;
    }
  }

  static setAdminSession(emailOrSession: string | Partial<AdminSession>): AdminSession {
    const session: AdminSession = typeof emailOrSession === 'string'
      ? {
          isLoggedIn: true,
          email: emailOrSession,
          token: 'admin_tok_' + Date.now() + '_' + Math.random().toString(36).substring(2, 9),
          loginTime: Date.now()
        }
      : {
          isLoggedIn: true,
          email: emailOrSession.email || 'admin@gmail.com',
          token: emailOrSession.token || ('admin_tok_' + Date.now()),
          loginTime: emailOrSession.loginTime || Date.now()
        };

    localStorage.setItem(STORAGE_ADMIN_SESSION, JSON.stringify(session));
    return session;
  }

  static clearAdminSession(): void {
    localStorage.removeItem(STORAGE_ADMIN_SESSION);
  }

  /**
   * Authoritative Admin Balance Adjustment (Credit / Debit)
   */
  static async adminAdjustBalance(
    userId: string,
    type: 'CREDIT' | 'DEBIT',
    amount: number,
    notes?: string
  ): Promise<{ success: boolean; user?: User; error?: string }> {
    try {
      const res = await fetch('/api/admin/adjust', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, type, amount, notes })
      });

      const data = await res.json();
      if (res.ok && data.user) {
        const users = this.getUsers();
        const idx = users.findIndex(u => String(u.id) === String(userId));
        if (idx >= 0) {
          users[idx] = data.user;
          localStorage.setItem(STORAGE_USERS, JSON.stringify(users));
          localStorage.setItem('boostpay_users', JSON.stringify(users));
        }

        const cur = this.getCurrentUser();
        if (cur && String(cur.id) === String(userId)) {
          this.setCurrentUser(data.user);
        }

        return { success: true, user: data.user };
      }
      return { success: false, error: data.error || 'Server rejected balance adjustment' };
    } catch (err: any) {
      return { success: false, error: err.message || 'Network error during balance adjustment' };
    }
  }

  /**
   * Real-time server sync for a single user (keeps boost state and balance 100% accurate)
   */
  static async syncUserFromServer(userId: string): Promise<User | null> {
    try {
      const res = await fetch(`/api/users/${userId}`);
      if (res.ok) {
        const data = await res.json();
        if (data.user) {
          const freshUser: User = data.user;
          // Update in local users array
          const users = this.getUsers();
          const idx = users.findIndex(u => u.id === userId);
          if (idx >= 0) {
            users[idx] = freshUser;
          } else {
            users.push(freshUser);
          }
          localStorage.setItem(STORAGE_USERS, JSON.stringify(users));

          // If this is current user, update session
          const curId = localStorage.getItem(STORAGE_CURRENT_USER_ID);
          if (curId === userId) {
            this.setCurrentUser(freshUser);
          }

          // If notifications returned, update and check for real-time alerts
          if (data.notifications && Array.isArray(data.notifications)) {
            const allNotifs = this.getNotifications();
            let hasNewNotifs = false;

            for (const n of data.notifications) {
              if (!allNotifs.some(existing => existing.id === n.id)) {
                allNotifs.unshift(n);
                hasNewNotifs = true;
              }

              // Real-time transfer toast alert check!
              if (this.hasSeededInitialHistory && !this.seenNotificationIds.has(n.id)) {
                this.seenNotificationIds.add(n.id);
                if (n.type === 'TRANSFER_RECEIVED') {
                  this.triggerToast({
                    id: n.id,
                    type: 'TRANSFER_RECEIVED',
                    title: 'Funds Received',
                    amount: n.amount,
                    senderId: n.metadata?.senderId,
                    referenceId: n.referenceId,
                    timestamp: n.timestamp,
                    message: n.message
                  });
                }
              } else if (!this.hasSeededInitialHistory) {
                this.seenNotificationIds.add(n.id);
              }
            }

            if (hasNewNotifs) {
              localStorage.setItem(STORAGE_NOTIFICATIONS, JSON.stringify(allNotifs));
            }
          }

          // If transactions returned, update and check for newly received transfers
          if (data.transactions && Array.isArray(data.transactions)) {
            const allTxs = this.getTransactions();
            let hasNewTxs = false;

            for (const t of data.transactions) {
              if (!allTxs.some(existing => existing.id === t.id)) {
                allTxs.unshift(t);
                hasNewTxs = true;

                // If this is an incoming transfer and we already seeded history, trigger toast!
                if (this.hasSeededInitialHistory && t.type === 'TRANSFER_RECEIVED' && !this.seenNotificationIds.has(t.id)) {
                  this.seenNotificationIds.add(t.id);
                  this.triggerToast({
                    id: t.id,
                    type: 'TRANSFER_RECEIVED',
                    title: 'Funds Received',
                    amount: t.amount,
                    senderId: t.senderId,
                    referenceId: t.id,
                    timestamp: t.timestamp,
                    message: `Received $${Number(t.amount).toFixed(2)} from #${t.senderId || 'Peer'}`
                  });
                }
              } else {
                this.seenNotificationIds.add(t.id);
              }
            }

            if (hasNewTxs) {
              localStorage.setItem(STORAGE_TRANSACTIONS, JSON.stringify(allTxs));
            }
          }

          if (!this.hasSeededInitialHistory) {
            this.hasSeededInitialHistory = true;
          }

          return freshUser;
        }
      }
    } catch {
      // Return local cache on network error
    }
    return this.getCurrentUser();
  }

  /**
   * Start 24/7 background boost directly on the server
   */
  static async startServerBoost(userId: string): Promise<User | null> {
    try {
      const res = await fetch('/api/boost/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId })
      });
      if (res.ok) {
        const data = await res.json();
        if (data.user) {
          this.saveSingleUser(data.user);
          return data.user;
        }
      }
    } catch (err) {
      console.warn('startServerBoost network error:', err);
    }

    // Local fallback
    const users = this.getUsers();
    const user = users.find(u => u.id === userId);
    if (!user || user.balance <= 0) return null;

    const targetDuration = this.calculateDynamicDuration(user.balance, users);
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
    this.saveUsers(users);
    this.setCurrentUser(user);
    return user;
  }

  /**
   * Pause boost on the server
   */
  static async pauseServerBoost(userId: string): Promise<User | null> {
    try {
      const res = await fetch('/api/boost/pause', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId })
      });
      if (res.ok) {
        const data = await res.json();
        if (data.user) {
          this.saveSingleUser(data.user);
          return data.user;
        }
      }
    } catch (err) {
      console.warn('pauseServerBoost network error:', err);
    }

    const users = this.getUsers();
    const user = users.find(u => u.id === userId);
    if (!user) return null;
    user.boostState.isPaused = true;
    user.boostState.pausedAt = Date.now();
    this.saveUsers(users);
    this.setCurrentUser(user);
    return user;
  }

  /**
   * Resume boost on the server
   */
  static async resumeServerBoost(userId: string): Promise<User | null> {
    try {
      const res = await fetch('/api/boost/resume', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId })
      });
      if (res.ok) {
        const data = await res.json();
        if (data.user) {
          this.saveSingleUser(data.user);
          return data.user;
        }
      }
    } catch (err) {
      console.warn('resumeServerBoost network error:', err);
    }

    const users = this.getUsers();
    const user = users.find(u => u.id === userId);
    if (!user) return null;
    user.boostState.isPaused = false;
    user.boostState.startedAt = Date.now() - (user.boostState.elapsedMs || 0);
    this.saveUsers(users);
    this.setCurrentUser(user);
    return user;
  }

  private static saveSingleUser(user: User): void {
    const users = this.getUsers();
    const idx = users.findIndex(u => u.id === user.id);
    if (idx >= 0) {
      users[idx] = user;
    } else {
      users.push(user);
    }
    localStorage.setItem(STORAGE_USERS, JSON.stringify(users));
    const curId = localStorage.getItem(STORAGE_CURRENT_USER_ID);
    if (curId === user.id) {
      this.setCurrentUser(user);
    }
  }

  static getConfig(): SystemConfig {
    const raw = localStorage.getItem(STORAGE_CONFIG);
    if (!raw) return getDefaultConfig();
    try {
      return JSON.parse(raw);
    } catch {
      return getDefaultConfig();
    }
  }

  static saveConfig(config: SystemConfig): void {
    localStorage.setItem(STORAGE_CONFIG, JSON.stringify(config));
    this.pushToServer();
  }

  static getTransactions(): Transaction[] {
    const raw = localStorage.getItem(STORAGE_TRANSACTIONS);
    if (!raw) return [];
    try {
      const list: Transaction[] = JSON.parse(raw);
      if (!Array.isArray(list)) return [];
      let changed = false;
      const migrated = list.map(t => {
        let tChanged = false;
        let uId = t.userId;
        let sId = t.senderId;
        let rId = t.recipientId;
        let notes = t.notes;
        if (LEGACY_USER_MAP[uId]) { uId = LEGACY_USER_MAP[uId]; tChanged = true; }
        if (sId && LEGACY_USER_MAP[sId]) { sId = LEGACY_USER_MAP[sId]; tChanged = true; }
        if (rId && LEGACY_USER_MAP[rId]) { rId = LEGACY_USER_MAP[rId]; tChanged = true; }
        if (notes && (notes.includes('#849201') || notes.includes('#223344'))) {
          notes = notes.replace('#849201', '#1').replace('#223344', '#2');
          tChanged = true;
        }
        if (tChanged) {
          changed = true;
          return { ...t, userId: uId, senderId: sId, recipientId: rId, notes };
        }
        return t;
      });
      if (changed) {
        localStorage.setItem(STORAGE_TRANSACTIONS, JSON.stringify(migrated));
      }
      return migrated;
    } catch {
      return [];
    }
  }

  static saveTransactions(txs: Transaction[]): void {
    localStorage.setItem(STORAGE_TRANSACTIONS, JSON.stringify(txs));
    this.pushToServer();
  }

  static getConversations(): Conversation[] {
    const raw = localStorage.getItem(STORAGE_CONVERSATIONS);
    if (!raw) return [];
    try {
      return JSON.parse(raw);
    } catch {
      return [];
    }
  }

  static saveConversations(convs: Conversation[]): void {
    localStorage.setItem(STORAGE_CONVERSATIONS, JSON.stringify(convs));
    this.pushToServer();
  }

  static getMessages(): Message[] {
    const raw = localStorage.getItem(STORAGE_MESSAGES);
    if (!raw) return [];
    try {
      return JSON.parse(raw);
    } catch {
      return [];
    }
  }

  static saveMessages(msgs: Message[]): void {
    localStorage.setItem(STORAGE_MESSAGES, JSON.stringify(msgs));
    this.pushToServer();
  }

  /**
   * Calculates the dynamic duration in milliseconds based on relative balance rank:
   * "jar balance sobcheye besi tar 24 gonta , jar balance kom tar min 1 min"
   * Highest balance in the system receives 24 hours (86,400,000 ms).
   * Lowest balance receives 1 minute (60,000 ms).
   */
  static calculateDynamicDuration(userBalance: number, users: User[]): number {
    const config = this.getConfig();
    const minMs = config.minBoostMs || 60000; // 1 minute
    const maxMs = config.maxBoostMs || 86400000; // 24 hours

    const numBal = Number(userBalance) || 0;

    if (!users || users.length <= 1) {
      if (numBal <= 0) return minMs;
      if (numBal >= 1000) return maxMs;
      return Math.round(minMs + (numBal / 1000) * (maxMs - minMs));
    }

    const balances = users.map(u => Number(u.balance) || 0);
    const minBal = Math.min(...balances);
    const maxBal = Math.max(...balances);

    if (maxBal === minBal) {
      return numBal > 0 ? maxMs : minMs;
    }

    const clamped = Math.max(minBal, Math.min(maxBal, numBal));
    const ratio = (clamped - minBal) / (maxBal - minBal);
    return Math.round(minMs + ratio * (maxMs - minMs));
  }

  /**
   * Create new user with email, sequential numeric ID & password
  /**
   * Register a new user with Email and Password
   * Server assigns next sequential numeric ID starting from 1 (1, 2, 3...)
   */
  static async registerUser(email: string, password?: string): Promise<User> {
    const cleanEmail = email.trim().toLowerCase();
    const cleanPass = password?.trim() || '';

    // Fast local validation
    const localUsers = this.getUsers();
    const existingLocal = localUsers.find(u => u.email && u.email.toLowerCase() === cleanEmail);
    if (existingLocal) {
      throw new Error('An account with this email address already exists. Please sign in.');
    }

    try {
      const res = await fetch('/api/users/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: cleanEmail,
          password: cleanPass
        })
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        throw new Error(data.error || 'Registration failed.');
      }

      if (data.user) {
        const newUser: User = data.user;
        const currentUsers = this.getUsers().filter(u => u.id !== newUser.id);
        currentUsers.push(newUser);
        this.saveUsers(currentUsers);
        this.setCurrentUser(newUser);
        return newUser;
      }
    } catch (err: any) {
      if (err.message && (err.message.includes('already exists') || err.message.includes('Registration failed'))) {
        throw err;
      }
      console.warn('Backend offline fallback for registration:', err);
    }

    // Offline local fallback
    const numericId = getNextSequentialUserId(localUsers);
    const initialDuration = this.calculateDynamicDuration(0, localUsers);

    const newUser: User = {
      id: numericId,
      email: cleanEmail,
      balance: 0,
      lifetimeProfit: 0,
      password: cleanPass,
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

    localUsers.push(newUser);
    this.saveUsers(localUsers);
    this.setCurrentUser(newUser);
    return newUser;
  }

  /**
   * Login using only Email and Password
   */
  static async loginUser(email: string, password?: string): Promise<{ success: boolean; user?: User; error?: string }> {
    const cleanEmail = email.trim().toLowerCase();
    const cleanPass = password?.trim() || '';

    if (!cleanEmail) {
      return { success: false, error: 'Please enter your email address.' };
    }
    if (!cleanPass) {
      return { success: false, error: 'Please enter your password.' };
    }

    // 1. Authoritative Server-Side Login
    try {
      const res = await fetch('/api/users/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: cleanEmail, password: cleanPass })
      });

      const data = await res.json().catch(() => ({}));

      if (res.ok && data.user) {
        const user: User = data.user;
        // Cache user locally
        const localUsers = this.getUsers().filter(u => u.id !== user.id);
        localUsers.push(user);
        this.saveUsers(localUsers);
        this.setCurrentUser(user);
        this.syncUserFromServer(user.id);
        return { success: true, user };
      }

      if (!res.ok && data.error) {
        return { success: false, error: data.error };
      }
    } catch {
      // Offline fallback
    }

    // 2. Offline Fallback from local store
    const users = this.getUsers();
    const user = users.find(u => u.email && u.email.toLowerCase() === cleanEmail);

    if (!user) {
      return { success: false, error: 'No account found with this email address. Please create an account.' };
    }

    // Verify password
    if (user.password && user.password !== cleanPass) {
      return { success: false, error: 'Incorrect password for this account. Please try again.' };
    }

    if (user.isBlocked) {
      return { success: false, error: 'This account has been suspended by system administrator.' };
    }

    if (user.isTempLocked) {
      return { success: false, error: 'Account is temporarily locked. Contact support.' };
    }

    this.setCurrentUser(user);
    this.syncUserFromServer(user.id);
    return { success: true, user };
  }

  /**
   * Add a transaction to history and update user balance
   */
  static addTransaction(tx: Omit<Transaction, 'id' | 'timestamp'>): Transaction {
    const transactions = this.getTransactions();
    const newTx: Transaction = {
      ...tx,
      id: 'TX-' + Math.floor(10000000 + Math.random() * 90000000),
      timestamp: Date.now()
    };
    transactions.unshift(newTx);
    this.saveTransactions(transactions);
    return newTx;
  }

  static addTransactionRecord(tx: Transaction): void {
    const transactions = this.getTransactions();
    if (!transactions.some(t => t.id === tx.id)) {
      transactions.unshift(tx);
      this.saveTransactions(transactions);
    }
  }

  // --- Notification & Real-Time Alert Engine ---

  private static chatListeners: ((conversations: Conversation[], messages: Message[]) => void)[] = [];

  static subscribeToChat(listener: (conversations: Conversation[], messages: Message[]) => void): () => void {
    this.chatListeners.push(listener);
    return () => {
      this.chatListeners = this.chatListeners.filter(l => l !== listener);
    };
  }

  static triggerChatUpdate(conversations: Conversation[], messages: Message[]): void {
    for (const listener of this.chatListeners) {
      try {
        listener(conversations, messages);
      } catch (e) {
        console.warn('Chat listener execution error:', e);
      }
    }
  }

  static onToastNotification(listener: (toast: ToastData) => void): () => void {
    this.toastListeners.push(listener);
    return () => {
      this.toastListeners = this.toastListeners.filter(l => l !== listener);
    };
  }

  static triggerToast(toast: ToastData): void {
    for (const listener of this.toastListeners) {
      try {
        listener(toast);
      } catch (e) {
        console.warn('Toast listener execution note:', e);
      }
    }
  }

  static getNotifications(userId?: string): InboxNotification[] {
    const raw = localStorage.getItem(STORAGE_NOTIFICATIONS);
    if (!raw) return [];
    try {
      const list: InboxNotification[] = JSON.parse(raw);
      if (!Array.isArray(list)) return [];
      let changed = false;
      const targetUserId = userId ? (LEGACY_USER_MAP[userId] || userId) : undefined;
      const migrated = list.map(n => {
        let nChanged = false;
        let uId = n.userId;
        let msg = n.message;
        let meta = n.metadata;
        if (LEGACY_USER_MAP[uId]) { uId = LEGACY_USER_MAP[uId]; nChanged = true; }
        if (meta && meta.senderId && LEGACY_USER_MAP[meta.senderId]) {
          meta = { ...meta, senderId: LEGACY_USER_MAP[meta.senderId] };
          nChanged = true;
        }
        if (meta && meta.recipientId && LEGACY_USER_MAP[meta.recipientId]) {
          meta = { ...meta, recipientId: LEGACY_USER_MAP[meta.recipientId] };
          nChanged = true;
        }
        if (msg && (msg.includes('#849201') || msg.includes('#223344'))) {
          msg = msg.replace(/#849201/g, '#1').replace(/#223344/g, '#2');
          nChanged = true;
        }
        if (nChanged) {
          changed = true;
          return { ...n, userId: uId, message: msg, metadata: meta };
        }
        return n;
      });
      if (changed) {
        localStorage.setItem(STORAGE_NOTIFICATIONS, JSON.stringify(migrated));
      }
      if (targetUserId) {
        return migrated
          .filter(n => n.userId === targetUserId)
          .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
      }
      return migrated.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
    } catch {
      return [];
    }
  }

  static saveNotifications(notifications: InboxNotification[]): void {
    localStorage.setItem(STORAGE_NOTIFICATIONS, JSON.stringify(notifications));
    this.pushToServer();
  }

  static addNotification(notif: InboxNotification): void {
    const all = this.getNotifications();
    if (!all.some(n => n.id === notif.id)) {
      all.unshift(notif);
      this.saveNotifications(all);
    }
  }

  static getUnreadNotificationCount(userId: string): number {
    const userNotifs = this.getNotifications(userId);
    return userNotifs.filter(n => !n.isRead).length;
  }

  static async markNotificationAsRead(userId: string, notifId?: string): Promise<void> {
    const all = this.getNotifications();
    for (const n of all) {
      if (n.userId === userId) {
        if (!notifId || notifId === 'ALL' || n.id === notifId) {
          n.isRead = true;
        }
      }
    }
    this.saveNotifications(all);

    try {
      await fetch('/api/notifications/mark-read', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, notificationId: notifId || 'ALL' })
      });
    } catch {}
  }

  static async deleteNotification(userId: string, notifId: string): Promise<void> {
    let all = this.getNotifications();
    if (notifId === 'ALL') {
      all = all.filter(n => n.userId !== userId);
    } else {
      all = all.filter(n => !(n.userId === userId && n.id === notifId));
    }
    this.saveNotifications(all);

    try {
      await fetch('/api/notifications/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, notificationId: notifId })
      });
    } catch {}
  }

  // --- Database Storage Health, Export & Disaster Recovery ---

  static async probeDatabaseStorage(): Promise<any> {
    try {
      const res = await fetch('/api/admin/storage/probe');
      if (res.ok) {
        return await res.json();
      }
    } catch (err) {
      console.warn('probeDatabaseStorage network error:', err);
    }
    return {
      success: false,
      storageType: 'LOCAL_FALLBACK',
      totalUsers: this.getUsers().length,
      totalTransactions: this.getTransactions().length,
      totalNotifications: this.getNotifications().length,
      isWritable: true,
      latencyMs: 0
    };
  }

  static async exportDatabase(): Promise<Blob | null> {
    try {
      const res = await fetch('/api/admin/db/export');
      if (res.ok) {
        return await res.blob();
      }
    } catch (err) {
      console.warn('exportDatabase network error:', err);
    }

    // Fallback: package from local storage
    const fallbackDb = {
      users: this.getUsers(),
      transactions: this.getTransactions(),
      conversations: this.getConversations(),
      messages: this.getMessages(),
      notifications: this.getNotifications(),
      config: this.getConfig(),
      exportedAt: Date.now()
    };
    return new Blob([JSON.stringify(fallbackDb, null, 2)], { type: 'application/json' });
  }

  static async importDatabase(data: any): Promise<{ success: boolean; restoredUsers?: number; error?: string }> {
    try {
      const res = await fetch('/api/admin/db/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      });
      if (res.ok) {
        const result = await res.json();
        // Refresh local cache with imported data
        await this.initSync();
        return result;
      } else {
        const err = await res.json().catch(() => null);
        return { success: false, error: err?.error || 'Failed to restore database.' };
      }
    } catch (err: any) {
      // Local fallback restore
      if (data && Array.isArray(data.users)) {
        this.saveUsers(data.users);
        if (data.transactions) this.saveTransactions(data.transactions);
        if (data.conversations) this.saveConversations(data.conversations);
        if (data.messages) this.saveMessages(data.messages);
        if (data.notifications) this.saveNotifications(data.notifications);
        if (data.config) this.saveConfig(data.config);
        return { success: true, restoredUsers: data.users.length };
      }
      return { success: false, error: err.message || 'Error importing database.' };
    }
  }
}
