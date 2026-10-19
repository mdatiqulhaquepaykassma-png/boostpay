export interface User {
  id: string; // Pure sequential numeric ID starting from 1 (e.g. "1", "2")
  email: string; // User email address
  antiPhishingCode?: string; // Shown in every genuine server alert
  frozenReason?: string;
  frozenAt?: number;
  frozenUntil?: number;
  isTempFreeze?: boolean;
  referCode?: string;
  referredBy?: string; // referrer user id
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

export type TransactionType = 'REWARD' | 'TRANSFER_SENT' | 'TRANSFER_RECEIVED' | 'ADMIN_CREDIT' | 'ADMIN_DEBIT' | 'REFERRAL_COMMISSION';

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
  metadata?: Record<string, any>;
}

export interface Message {
  id: string;
  conversationId: string;
  senderId: string; // numeric ID or 'ADMIN_SUPPORT'
  senderRole: 'USER' | 'ADMIN';
  text: string;
  timestamp: number;
  reactions?: Record<string, string[]>; // emoji -> userIds
  /** 'call' renders as a centered call-history row (Telegram style). */
  kind?: 'text' | 'call' | 'voice' | 'photo' | 'file' | 'contact' | 'poll' | 'sticker';
  callInfo?: {
    media: 'audio' | 'video';
    outcome: 'completed' | 'missed' | 'declined';
    durationMs: number;
  };
  /** 'voice' renders as an in-chat voice note bubble. */
  voiceData?: string;
  voiceDurationMs?: number;
  /** 'photo' renders as an image bubble. */
  photoData?: string;
  /** 'file' renders as a downloadable document bubble. */
  fileData?: string;
  fileName?: string;
  fileSize?: number;
  /** 'contact' renders as a shared contact card. */
  contactId?: string;
  /** 'poll' renders as a votable poll. */
  poll?: {
    question: string;
    options: { text: string; votes: string[] }[];
    closed?: boolean;
  };
  /** 'sticker' renders as a big emoji sticker. */
  stickerEmoji?: string;
  replyTo?: { id: string; text: string; senderId: string };
  forwardedFrom?: string;
  editedAt?: number;
  pinned?: boolean;
  deleted?: boolean;
}

export interface Conversation {
  id: string; // Format: "CONV-XXXXXX" or "GROUP-XXXXXX"
  type?: 'dm' | 'group';
  name?: string; // Group display name
  createdBy?: string;
  lastRead?: Record<string, number>;
  mutedBy?: string[];
  members?: string[];
  participants: string[]; // [userId1, userId2], [userId, 'ADMIN_SUPPORT'] or group members
  /** Group discovery & joining (Telegram-style). */
  isPublic?: boolean;
  joinApprovalRequired?: boolean;
  inviteToken?: string;
  joinRequests?: { userId: string; at: number }[];
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
  cycleDurationMs?: number;
  referralsCount?: number;
  referRate?: number;
  referLifetime?: number;
  rank?: number;
}

export type NotificationType =
  | 'TRANSFER_RECEIVED'
  | 'TRANSFER_SENT'
  | 'YIELD_REWARD'
  | 'SYSTEM_ALERT'
  | 'SYSTEM_ANNOUNCEMENT'
  | 'SECURITY_ALERT'
  | 'REFERRAL_COMMISSION'
  | 'REFERRAL_JOINED';

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
  referral?: {
    enabled: boolean;
    baseRatePercent: number;
    maxRatePercent: number;
    dailyTierEnabled: boolean;
    commissionOnCompounding: boolean;
  };
  antifraud?: {
    enabled: boolean;
    tempFreezeMs: number;
    maxTransfersPer10Min: number;
    maxDistinctSendersPerIp: number;
    maxVolumePer10Min: number;
    newAccountLargeTransferThreshold: number;
    velocityEnabled: boolean;
  };
}

export interface ReferralRecord {
  id: string;
  referrerId: string;
  referredId: string;
  createdAt: number;
  dayKey: string;
}
export interface ReferCommissionRecord {
  id: string;
  referrerId: string;
  referredId: string;
  amount: number;
  rate: number;
  sourceTxId: string;
  timestamp: number;
  dayKey: string;
}

export interface AuditLog {
  id: string;
  action: string;
  adminEmail: string;
  targetUserId?: string;
  details: string;
  timestamp: number;
}


