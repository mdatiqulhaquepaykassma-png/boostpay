import { User, Transaction, Conversation, Message, SystemConfig, InboxNotification, AuditLog, SessionDevice } from '../types';
import { copyToClipboard as clipboardHelper } from '../utils/clipboard';

const STORAGE_USERS = 'boostpay_users_v4';
const STORAGE_CURRENT_USER = 'boostpay_current_user_v4';
const STORAGE_CURRENT_USER_ID = 'boostpay_current_user_id_v4';
const STORAGE_AUTH_TOKEN = 'boostpay_auth_token_v1';
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
    minuteRatePercent: 0.001605, // 0.001605% per minute
    hourlyRatePercent: 0.09634, // ~0.0963% equivalent per hour
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
      const res = await fetch('/api/db', { headers: this.authHeaders() });
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
                headers: this.authHeaders(),
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
        headers: this.authHeaders(),
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
      const res = await fetch('/api/db', { headers: this.authHeaders() });
      if (res.ok) {
        const data = await res.json();
        if (data.users && Array.isArray(data.users)) {
          // Preserve local secrets (password/phrase) that the server strips
          const locals = this.getUsers();
          const merged = data.users.map((u: User) => {
            const local = locals.find((l: User) => l.id === u.id);
            return this.mergeServerUser(u, local || null);
          });
          localStorage.setItem(STORAGE_USERS, JSON.stringify(merged));
          localStorage.setItem('boostpay_users', JSON.stringify(merged));
          return merged;
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
  // ---- Typing indicator listeners ----
  private static typingListeners: Array<(ev: { conversationId: string; userId: string; timestamp: number }) => void> = [];

  static onTyping(cb: (ev: { conversationId: string; userId: string; timestamp: number }) => void): () => void {
    this.typingListeners.push(cb);
    return () => {
      this.typingListeners = this.typingListeners.filter((fn) => fn !== cb);
    };
  }

  /** Apply realtime chat mutations pushed from the server (edit/delete/pin/read/group). */
  private static handleChatEvent(data: any): void {
    const ev = String(data.event || '');
    const msgs = this.getMessages();
    const convs = this.getConversations();
    let msgsChanged = false;
    let convsChanged = false;

    if (ev === 'message_edited') {
      const idx = msgs.findIndex((m) => m.id === data.messageId);
      if (idx >= 0) {
        msgs[idx] = { ...msgs[idx], text: data.text, editedAt: data.editedAt };
        msgsChanged = true;
      }
    } else if (ev === 'message_deleted') {
      const idx = msgs.findIndex((m) => m.id === data.messageId);
      if (idx >= 0) {
        msgs[idx] = { ...msgs[idx], deleted: true, text: '🚫 Message deleted', kind: 'text' } as any;
        delete (msgs[idx] as any).voiceData;
        delete (msgs[idx] as any).photoData;
        msgsChanged = true;
      }
    } else if (ev === 'message_pinned') {
      const idx = msgs.findIndex((m) => m.id === data.messageId);
      if (idx >= 0) {
        msgs[idx] = { ...msgs[idx], pinned: data.pinned };
        msgsChanged = true;
      }
    } else if (ev === 'read_update') {
      const idx = convs.findIndex((c) => c.id === data.conversationId);
      if (idx >= 0) {
        convs[idx] = { ...convs[idx], lastRead: { ...(convs[idx].lastRead || {}), [data.userId]: data.at } } as any;
        convsChanged = true;
      }
    } else if (ev === 'poll_updated') {
      const idx = msgs.findIndex((m) => m.id === data.messageId);
      if (idx >= 0) {
        msgs[idx] = { ...msgs[idx], poll: data.poll } as any;
        msgsChanged = true;
      }
    } else if (ev === 'group_call') {
      for (const cb of this.groupCallListeners) {
        try { cb(data); } catch { /* listener error */ }
      }
    } else if (ev === 'conversation_updated' && data.conversation) {
      const idx = convs.findIndex((c) => c.id === data.conversation.id);
      if (idx >= 0) {
        convs[idx] = { ...convs[idx], ...data.conversation };
        convsChanged = true;
      } else {
        convs.unshift(data.conversation);
        convsChanged = true;
      }
    }

    if (msgsChanged) localStorage.setItem(STORAGE_MESSAGES, JSON.stringify(msgs));
    if (convsChanged) localStorage.setItem(STORAGE_CONVERSATIONS, JSON.stringify(convs));
    if (msgsChanged || convsChanged) this.triggerChatUpdate(convs, msgs);
  }

  static async editMessage(messageId: string, text: string): Promise<boolean> {
    try {
      const res = await fetch('/api/chat/message/edit', {
        method: 'POST',
        headers: this.authHeaders(),
        body: JSON.stringify({ messageId, text })
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  static async deleteMessage(messageId: string): Promise<boolean> {
    try {
      const res = await fetch('/api/chat/message/delete', {
        method: 'POST',
        headers: this.authHeaders(),
        body: JSON.stringify({ messageId })
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  static async togglePin(messageId: string, pinned: boolean): Promise<boolean> {
    try {
      const res = await fetch('/api/chat/pin', {
        method: 'POST',
        headers: this.authHeaders(),
        body: JSON.stringify({ messageId, pinned })
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  static async markConversationRead(conversationId: string): Promise<void> {
    try {
      await fetch('/api/chat/read', {
        method: 'POST',
        headers: this.authHeaders(),
        body: JSON.stringify({ conversationId })
      });
    } catch { /* offline */ }
  }

  static async sendTyping(conversationId: string): Promise<void> {
    try {
      await fetch('/api/chat/typing', {
        method: 'POST',
        headers: this.authHeaders(),
        body: JSON.stringify({ conversationId })
      });
    } catch { /* offline */ }
  }

  static async setConversationMute(conversationId: string, muted: boolean): Promise<boolean> {
    try {
      const res = await fetch('/api/chat/mute', {
        method: 'POST',
        headers: this.authHeaders(),
        body: JSON.stringify({ conversationId, muted })
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  static async updateConversation(conversationId: string, changes: { name?: string; addMembers?: string[]; removeMembers?: string[] }): Promise<boolean> {
    try {
      const res = await fetch('/api/chat/conversation/update', {
        method: 'POST',
        headers: this.authHeaders(),
        body: JSON.stringify({ conversationId, ...changes })
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  static async leaveConversation(conversationId: string): Promise<boolean> {
    try {
      const res = await fetch('/api/chat/conversation/leave', {
        method: 'POST',
        headers: this.authHeaders(),
        body: JSON.stringify({ conversationId })
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  static async getPresence(): Promise<string[]> {
    try {
      const res = await fetch('/api/chat/presence', { headers: this.authHeaders() });
      if (res.ok) {
        const data = await res.json();
        return Array.isArray(data.online) ? data.online : [];
      }
    } catch { /* offline */ }
    return [];
  }

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
        const streamToken = this.getAuthToken();
        const es = new EventSource(`/api/chat/stream?userId=${encodeURIComponent(userId)}${streamToken ? `&token=${encodeURIComponent(streamToken)}` : ''}`);
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

              // 3. Notify chat listeners immediately (unread badge on tab bar)
              this.triggerChatUpdate(convs, msgs);
            } else if (data.type === 'reaction_update' && data.messageId) {
              const msgs = this.getMessages();
              const idx = msgs.findIndex(m => m.id === data.messageId);
              if (idx >= 0) {
                msgs[idx] = { ...msgs[idx], reactions: data.reactions };
                localStorage.setItem(STORAGE_MESSAGES, JSON.stringify(msgs));
                this.triggerChatUpdate(this.getConversations(), msgs);
              }
            } else if (data.type === 'user_update' && data.user) {
              // Authoritative realtime profile/balance/boost update
              this.mergeRealtimeUser(data.user);
            } else if (data.type === 'notification' && data.notification) {
              const notifs = this.getNotifications();
              if (!notifs.some(n => n.id === data.notification.id)) {
                notifs.unshift(data.notification);
                localStorage.setItem(STORAGE_NOTIFICATIONS, JSON.stringify(notifs));
              }
              // Toast exactly once per notification id (SSE + poll both deliver)
              if (!this.seenNotificationIds.has(data.notification.id)) {
                this.seenNotificationIds.add(data.notification.id);
                this.triggerToast({
                  id: data.notification.id,
                  type: data.notification.type === 'TRANSFER_RECEIVED' ? 'TRANSFER_IN' : 'INFO',
                  title: data.notification.title || 'BoostPay Alert',
                  message: data.notification.message || ''
                } as any);
              }
            } else if (data.type === 'banner') {
              this.triggerBanner(data.banner || null);
            } else if (data.type === 'boost_cycle_complete') {
              this.triggerToast({
                id: 'toast-cyc-' + Date.now(),
                type: 'SUCCESS',
                title: 'Compounding Cycle Complete',
                message: `Yield reward of $${Number(data.reward || 0).toFixed(8)} was credited to your wallet.`
              } as any);
            } else if (data.type === 'typing' && data.conversationId) {
              for (const cb of this.typingListeners) {
                try { cb({ conversationId: data.conversationId, userId: data.userId, timestamp: data.timestamp }); } catch { /* ignore */ }
              }
            } else if (data.type === 'chat_event' && data.event) {
              this.handleChatEvent(data);
            } else if (data.type === 'call_signal' && data.signal) {
              for (const cb of this.callSignalListeners) {
                try { cb({ from: String(data.from || ''), signal: data.signal }); } catch { /* listener error */ }
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
        headers: this.authHeaders(),
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
    senderRole?: 'USER' | 'ADMIN',
    callInfo?: Message['callInfo'],
    voice?: { data: string; durationMs: number },
    extra?: {
      replyTo?: { id: string; text: string; senderId: string } | null;
      photoData?: string;
      forwardedFrom?: string;
      fileData?: string;
      fileName?: string;
      fileSize?: number;
      contactId?: string;
      poll?: { question: string; options: { text: string; votes: string[] }[] };
      stickerEmoji?: string;
    }
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
      timestamp: now,
      ...(callInfo ? { kind: 'call' as const, callInfo } : {}),
      ...(voice ? { kind: 'voice' as const, voiceData: voice.data, voiceDurationMs: voice.durationMs, text: '🎤 Voice message' } : {}),
      ...(extra?.photoData ? { kind: 'photo' as const, photoData: extra.photoData, text: text || '📷 Photo' } : {}),
      ...(extra?.fileData ? { kind: 'file' as const, fileData: extra.fileData, fileName: extra.fileName, fileSize: extra.fileSize, text: text || `📎 ${extra.fileName || 'file'}` } : {}),
      ...(extra?.contactId ? { kind: 'contact' as const, contactId: extra.contactId, text: text || '👤 Contact card' } : {}),
      ...(extra?.poll ? { kind: 'poll' as const, poll: extra.poll, text: text || `📊 Poll: ${extra.poll.question}` } : {}),
      ...(extra?.stickerEmoji ? { kind: 'sticker' as const, stickerEmoji: extra.stickerEmoji, text: extra.stickerEmoji } : {}),
      ...(extra?.replyTo ? { replyTo: extra.replyTo } : {}),
      ...(extra?.forwardedFrom ? { forwardedFrom: extra.forwardedFrom } : {})
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
        headers: this.authHeaders(),
        body: JSON.stringify({
          senderId,
          senderRole: role,
          recipientId,
          text: cleanText,
          ...(callInfo ? { kind: 'call', callInfo } : {}),
          ...(voice ? { kind: 'voice', voiceData: voice.data, voiceDurationMs: voice.durationMs } : {}),
          ...(extra?.photoData ? { kind: 'photo', photoData: extra.photoData } : {}),
          ...(extra?.fileData ? { kind: 'file', fileData: extra.fileData, fileName: extra.fileName, fileSize: extra.fileSize } : {}),
          ...(extra?.contactId ? { kind: 'contact', contactId: extra.contactId } : {}),
          ...(extra?.poll ? { kind: 'poll', poll: extra.poll } : {}),
          ...(extra?.stickerEmoji ? { kind: 'sticker', stickerEmoji: extra.stickerEmoji } : {}),
          ...(extra?.replyTo ? { replyTo: extra.replyTo } : {}),
          ...(extra?.forwardedFrom ? { forwardedFrom: extra.forwardedFrom } : {})
        })
      });

      if (res.ok) {
        const data = await res.json();
        if (data.message) {
          // Replace optimistic message with confirmed server message, and drop
          // any SSE-delivered copy so the same message never renders twice.
          const seenIds = new Set<string>();
          const refreshedMsgs = this.getMessages().map(m =>
            m.id === optimisticMsg.id ? data.message : m
          ).filter((m: any) => {
            if (!m || seenIds.has(m.id)) return false;
            seenIds.add(m.id);
            return true;
          });
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
      const res = await fetch(`/api/chat/messages${query}`, { headers: this.authHeaders() });
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
      this.setAuthToken(null);
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




  // --- Session tokens (sent as `Authorization: Bearer <token>` on API calls) ---

  static getAuthToken(): string | null {
    return localStorage.getItem(STORAGE_AUTH_TOKEN);
  }

  static setAuthToken(token: string | null | undefined): void {
    if (token) {
      localStorage.setItem(STORAGE_AUTH_TOKEN, token);
    } else {
      localStorage.removeItem(STORAGE_AUTH_TOKEN);
    }
  }

  /** Headers for endpoints that require a signed user token. */
  static authHeaders(): Record<string, string> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    const tok = this.getAuthToken();
    if (tok) headers['Authorization'] = `Bearer ${tok}`;
    return headers;
  }


  /** The server strips credentials from responses — keep any local secrets. */
  private static mergeServerUser(serverUser: User, localUser?: User | null): User {
    return {
      ...serverUser,
      phrase: serverUser.phrase || (localUser ? localUser.phrase : undefined),
      password: serverUser.password || (localUser ? localUser.password : undefined)
    };
  }




  /**
   * Real-time server sync for a single user (keeps boost state and balance 100% accurate)
   */
  static async syncUserFromServer(userId: string): Promise<User | null> {
    try {
      const res = await fetch(`/api/users/${userId}`, { headers: this.authHeaders() });
      if (res.ok) {
        const data = await res.json();
        if (data.user) {
          // Server responses omit credentials — preserve any local secrets
          const users = this.getUsers();
          const idx = users.findIndex(u => u.id === userId);
          const freshUser: User = this.mergeServerUser(data.user, idx >= 0 ? users[idx] : this.getCurrentUser());
          // Update in local users array
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
        headers: this.authHeaders(),
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
        headers: this.authHeaders(),
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
        headers: this.authHeaders(),
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
      users[idx] = this.mergeServerUser(user, users[idx]);
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
      const parsed: SystemConfig = JSON.parse(raw);
      if (parsed && parsed.minuteRatePercent === undefined) {
        parsed.minuteRatePercent = 0.001605;
        parsed.hourlyRatePercent = 0.09634;
        localStorage.setItem(STORAGE_CONFIG, JSON.stringify(parsed));
      }
      return parsed;
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
        headers: this.authHeaders(),
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
        // Server strips credentials from responses — keep the typed password locally for offline use
        const newUser: User = { ...data.user, password: cleanPass };
        this.setAuthToken(data.token);
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
        // Server strips credentials from responses — keep the typed password locally for offline use
        const user: User = { ...data.user, password: cleanPass };
        this.setAuthToken(data.token);
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
  private static userListeners: ((user: User) => void)[] = [];
  private static bannerListeners: ((banner: any | null) => void)[] = [];

  /** Merge a realtime server user into local caches and notify subscribers. */
  static mergeRealtimeUser(serverUser: User): void {
    if (!serverUser || !serverUser.id) return;
    const users = this.getUsers();
    const idx = users.findIndex(u => u.id === serverUser.id);
    const merged = this.mergeServerUser(serverUser, idx >= 0 ? users[idx] : null);
    if (idx >= 0) {
      users[idx] = merged;
    } else {
      users.push(merged);
    }
    localStorage.setItem(STORAGE_USERS, JSON.stringify(users));
    const curId = localStorage.getItem(STORAGE_CURRENT_USER_ID);
    if (curId === String(serverUser.id)) {
      const cur = this.getCurrentUser();
      const next = this.mergeServerUser(serverUser, cur);
      localStorage.setItem(STORAGE_CURRENT_USER, JSON.stringify(next));
      for (const listener of this.userListeners) {
        try { listener(next); } catch (e) { console.warn('User listener error:', e); }
      }
    }
  }

  static onUserUpdate(listener: (user: User) => void): () => void {
    this.userListeners.push(listener);
    return () => {
      this.userListeners = this.userListeners.filter(l => l !== listener);
    };
  }

  static onBanner(listener: (banner: any | null) => void): () => void {
    this.bannerListeners.push(listener);
    return () => {
      this.bannerListeners = this.bannerListeners.filter(l => l !== listener);
    };
  }

  static triggerBanner(banner: any | null): void {
    for (const listener of this.bannerListeners) {
      try { listener(banner); } catch (e) { console.warn('Banner listener error:', e); }
    }
  }

  // --- Sessions / anti-phishing / QR / groups / leaderboard / banner APIs ---

  static async fetchLeaderboard(): Promise<{ users: any[]; me: any | null; total: number }> {
    try {
      const res = await fetch('/api/leaderboard', { headers: this.authHeaders() });
      if (res.ok) return await res.json();
    } catch (e) {
      console.warn('fetchLeaderboard error:', e);
    }
    return { users: [], me: null, total: 0 };
  }

  static async getSessions(): Promise<SessionDevice[]> {
    try {
      const res = await fetch('/api/users/me/sessions', { headers: this.authHeaders() });
      if (res.ok) {
        const data = await res.json();
        return data.sessions || [];
      }
    } catch (e) { console.warn('getSessions error:', e); }
    return [];
  }

  static async revokeSession(sessionId: string): Promise<boolean> {
    try {
      const res = await fetch(`/api/users/me/sessions/${encodeURIComponent(sessionId)}`, {
        method: 'DELETE',
        headers: this.authHeaders()
      });
      return res.ok;
    } catch { return false; }
  }

  static async revokeOtherSessions(): Promise<number> {
    try {
      const res = await fetch('/api/users/me/sessions/revoke-others', {
        method: 'POST',
        headers: this.authHeaders()
      });
      if (res.ok) {
        const data = await res.json();
        return data.revoked || 0;
      }
    } catch { /* ignore */ }
    return 0;
  }

  static async revokeAllSessions(): Promise<number> {
    try {
      const res = await fetch('/api/users/me/sessions/revoke-all', {
        method: 'POST',
        headers: this.authHeaders()
      });
      if (res.ok) {
        const data = await res.json();
        return data.revoked || 0;
      }
    } catch { /* ignore */ }
    return 0;
  }

  // --- WebRTC call signaling (ephemeral, rides the SSE stream) ---
  private static callSignalListeners: ((ev: { from: string; signal: any }) => void)[] = [];
  private static groupCallListeners: ((ev: any) => void)[] = [];

  /** Live group-call room events (started/joined/left/ended). */
  static onGroupCall(listener: (ev: any) => void): () => void {
    this.groupCallListeners.push(listener);
    return () => {
      this.groupCallListeners = this.groupCallListeners.filter((l) => l !== listener);
    };
  }

  // ── Telegram-style group features ──
  static async discoverGroups(): Promise<{ id: string; name: string; memberCount: number; joinApprovalRequired: boolean }[]> {
    try {
      const res = await fetch('/api/chat/groups/discover', { headers: this.authHeaders() });
      const data = await res.json().catch(() => ({}));
      return res.ok ? (data.groups || []) : [];
    } catch { return []; }
  }

  static async groupInvite(conversationId: string): Promise<{ token: string; url: string } | null> {
    try {
      const res = await fetch('/api/chat/group/invite', {
        method: 'POST',
        headers: this.authHeaders(),
        body: JSON.stringify({ conversationId })
      });
      const data = await res.json().catch(() => ({}));
      return res.ok ? { token: data.token, url: data.url } : null;
    } catch { return null; }
  }

  static async groupJoin(opts: { token?: string; conversationId?: string }): Promise<{ ok: boolean; pending?: boolean; conversation?: any; error?: string }> {
    try {
      const res = await fetch('/api/chat/group/join', {
        method: 'POST',
        headers: this.authHeaders(),
        body: JSON.stringify(opts)
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return { ok: false, error: data.error || 'Failed to join group.' };
      return { ok: true, pending: !!data.pending, conversation: data.conversation };
    } catch { return { ok: false, error: 'Network error.' }; }
  }

  static async groupRequestResolve(conversationId: string, userId: string, approve: boolean): Promise<boolean> {
    try {
      const res = await fetch('/api/chat/group/requests', {
        method: 'POST',
        headers: this.authHeaders(),
        body: JSON.stringify({ conversationId, userId, approve })
      });
      return res.ok;
    } catch { return false; }
  }

  static async groupPrivacy(conversationId: string, isPublic: boolean, joinApprovalRequired: boolean): Promise<boolean> {
    try {
      const res = await fetch('/api/chat/group/privacy', {
        method: 'POST',
        headers: this.authHeaders(),
        body: JSON.stringify({ conversationId, isPublic, joinApprovalRequired })
      });
      return res.ok;
    } catch { return false; }
  }

  static async pollVote(messageId: string, optionIndex: number): Promise<any | null> {
    try {
      const res = await fetch('/api/chat/poll/vote', {
        method: 'POST',
        headers: this.authHeaders(),
        body: JSON.stringify({ messageId, optionIndex })
      });
      const data = await res.json().catch(() => ({}));
      return res.ok ? (data.poll || null) : null;
    } catch { return null; }
  }

  // ── Group voice calls (mesh) ──
  static async gcStart(conversationId: string): Promise<any | null> {
    try {
      const res = await fetch('/api/chat/group-call/start', {
        method: 'POST',
        headers: this.authHeaders(),
        body: JSON.stringify({ conversationId })
      });
      const data = await res.json().catch(() => ({}));
      return res.ok ? (data.call || null) : null;
    } catch { return null; }
  }

  static async gcJoin(conversationId: string, callId: string): Promise<any | null> {
    try {
      const res = await fetch('/api/chat/group-call/join', {
        method: 'POST',
        headers: this.authHeaders(),
        body: JSON.stringify({ conversationId, callId })
      });
      const data = await res.json().catch(() => ({}));
      return res.ok ? (data.call || null) : null;
    } catch { return null; }
  }

  static async gcLeave(conversationId: string): Promise<void> {
    try {
      await fetch('/api/chat/group-call/leave', {
        method: 'POST',
        headers: this.authHeaders(),
        body: JSON.stringify({ conversationId })
      });
    } catch { /* ignore */ }
  }

  static async gcState(conversationId: string): Promise<any | null> {
    try {
      const res = await fetch(`/api/chat/group-call/state?conversationId=${encodeURIComponent(conversationId)}`, { headers: this.authHeaders() });
      const data = await res.json().catch(() => ({}));
      return res.ok ? (data.call || null) : null;
    } catch { return null; }
  }

  static onCallSignal(listener: (ev: { from: string; signal: any }) => void): () => void {
    this.callSignalListeners.push(listener);
    return () => {
      this.callSignalListeners = this.callSignalListeners.filter((l) => l !== listener);
    };
  }

  static async sendCallSignal(targetId: string, signal: any): Promise<boolean> {
    try {
      const res = await fetch('/api/chat/call-signal', {
        method: 'POST',
        headers: this.authHeaders(),
        body: JSON.stringify({ targetId, signal })
      });
      return res.ok;
    } catch { return false; }
  }

  static async setAntiPhishingCode(code: string): Promise<string> {
    const res = await fetch('/api/users/me/anti-phishing', {
      method: 'POST',
      headers: this.authHeaders(),
      body: JSON.stringify({ code })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Failed to save anti-phishing code.');
    return data.antiPhishingCode || '';
  }

  static async getQRPayload(): Promise<{ payload: string; userId: string; name: string }> {
    const res = await fetch('/api/users/me/qr', { headers: this.authHeaders() });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Failed to load QR payload.');
    return data;
  }

  static async createGroup(name: string, memberIds: string[]): Promise<Conversation> {
    const res = await fetch('/api/chat/groups', {
      method: 'POST',
      headers: this.authHeaders(),
      body: JSON.stringify({ name, memberIds })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Failed to create group.');
    const convs = this.getConversations();
    if (!convs.some(c => c.id === data.conversation.id)) {
      convs.unshift(data.conversation);
      localStorage.setItem(STORAGE_CONVERSATIONS, JSON.stringify(convs));
      this.triggerChatUpdate(convs, this.getMessages());
    }
    return data.conversation;
  }

  static async getGroupSuggestions(): Promise<{ id: string; email: string }[]> {
    try {
      const res = await fetch('/api/chat/groups/suggested', { headers: this.authHeaders() });
      if (res.ok) {
        const data = await res.json();
        return data.users || [];
      }
    } catch { /* ignore */ }
    return [];
  }


  static async getBanner(): Promise<any | null> {
    try {
      const res = await fetch('/api/banner', { headers: this.authHeaders() });
      if (res.ok) {
        const data = await res.json();
        return data.banner || null;
      }
    } catch { /* ignore */ }
    return null;
  }



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

  static triggerToast(toast: ToastData | string): void {
    const data: ToastData = typeof toast === 'string'
      ? {
          id: `T-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          type: 'SYSTEM_ALERT',
          title: 'Notice',
          message: toast,
          timestamp: Date.now()
        }
      : toast;
    for (const listener of this.toastListeners) {
      try {
        listener(data);
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
        headers: this.authHeaders(),
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
        headers: this.authHeaders(),
        body: JSON.stringify({ userId, notificationId: notifId })
      });
    } catch {}
  }

  // --- Database Storage Health, Export & Disaster Recovery ---



}
