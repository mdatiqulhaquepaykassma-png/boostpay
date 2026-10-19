export interface User {
  id: string; // Pure sequential numeric ID starting from 1 (e.g. "1", "2")
  email: string; // User email address
  antiPhishingCode?: string; // Shown in every genuine server alert
  frozenReason?: string;
  balance: number; // Main balance in USD
  lifetimeProfit: number;
  phrase?: string; // Optional legacy 12-word recovery mnemonic
  password?: string; // Account security password
  createdAt: number;
  isBlocked?: boolean;
  isFrozen?: boolean; // Account freeze prevents P2P transfers
  isTempLocked?: boolean;
  boostState: {
    isActive: boolean;
    isPaused: boolean;
    startedAt: number;
    pausedAt: number;
    elapsedMs: number;
    targetDurationMs: number; // Dynamic based on relative balance (1m - 24h)
    startingBalance: number;
    accumulatedYield: number; // Accrued reward
    justCompletedReward?: number; // Set by server when a compounding cycle finishes
  };
}

export type BoostState = User['boostState'];

export type TransactionType = 'REWARD' | 'TRANSFER_SENT' | 'TRANSFER_RECEIVED' | 'ADMIN_CREDIT' | 'ADMIN_DEBIT';

export interface Transaction {
  id: string;
  userId: string;
  type: TransactionType;
  amount: number;
  timestamp: number;
  recipientId?: string;
  senderId?: string;
  notes?: string;
  conversationId?: string;
}

export interface Message {
  id: string;
  conversationId: string;
  senderId: string; // numeric ID or 'ADMIN_SUPPORT'
  senderRole: 'USER' | 'ADMIN';
  text: string;
  timestamp: number;
  reactions?: Record<string, string[]>; // emoji -> userIds
  kind?: 'text' | 'call' | 'voice'; // call-history / voice-note entries
  callInfo?: {
    media?: 'audio' | 'video';
    outcome?: 'completed' | 'missed' | 'declined';
    durationMs?: number;
  };
  voiceData?: string;
  voiceDurationMs?: number;
}

export interface Conversation {
  id: string; // Format: "CONV-XXXXXX" or "GROUP-XXXXXX"
  type?: 'dm' | 'group';
  name?: string; // Group display name
  createdBy?: string;
  participants: string[]; // [userId1, userId2], [userId, 'ADMIN_SUPPORT'] or group members
  lastMessage: string;
  lastMessageAt?: number;
  timestamp?: number;
  hasUnread?: boolean;
}

export interface SessionDevice {
  id: string;
  ip: string;
  userAgent: string;
  createdAt: number;
  lastSeenAt: number;
  revoked?: boolean;
  current?: boolean;
}

export interface SystemBanner {
  message: string;
  title?: string;
  createdAt: number;
  createdBy?: string;
}

export interface LeaderboardRow {
  id: string;
  email: string;
  balance: number;
  lifetimeProfit: number;
  createdAt: number;
  boostActive?: boolean;
  isFrozen?: boolean;
  rank?: number;
}

export type NotificationType =
  | 'TRANSFER_RECEIVED'
  | 'TRANSFER_SENT'
  | 'YIELD_REWARD'
  | 'SYSTEM_ALERT'
  | 'SYSTEM_ANNOUNCEMENT'
  | 'SECURITY_ALERT';

export interface InboxNotification {
  id: string; // e.g. "NOTIF-748921"
  userId: string;
  type: NotificationType;
  title: string;
  message: string;
  amount?: number;
  referenceId?: string;
  timestamp: number;
  isRead: boolean;
  metadata?: {
    senderId?: string;
    recipientId?: string;
    balanceAfter?: number;
    notes?: string;
  };
}

export interface DokployConfig {
  host: string;
  port: number;
  database: string;
  user: string;
  externalIp: string;
  dockerHostname: string;
  isConnected: boolean;
  lastPingMs: number;
}

export interface SystemConfig {
  minuteRatePercent: number; // 0.001605% per minute
  hourlyRatePercent?: number; // Equivalent or legacy rate
  minBoostMs: number; // 60,000 ms (1 minute)
  maxBoostMs: number; // 86,400,000 ms (24 hours)
  dokploy: DokployConfig;
}

export interface AuditLog {
  id: string;
  action: string;
  adminEmail: string;
  targetUserId?: string;
  details: string;
  timestamp: number;
}


