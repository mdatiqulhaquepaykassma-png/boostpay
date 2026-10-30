// Thin API client for the BoostPay support console.
// Every call goes to /api/* on this app's own origin and is proxied to the main
// BoostPay API (see server.ts), exactly like the admin/agent consoles do.

const TOKEN_KEY = 'bpsup_token';
const EMAIL_KEY = 'bpsup_email';
const ROLE_KEY = 'bpsup_role';

export type SupportMessage = {
  id: string;
  conversationId: string;
  senderId: string;
  senderRole?: string;
  text?: string;
  timestamp: number;
  kind?: 'photo' | 'voice' | 'file' | 'call';
  photoUrl?: string;
  photoFileId?: string;
  voiceUrl?: string;
  voiceFileId?: string;
  voiceDurationMs?: number;
  deleted?: boolean;
};

export type SupportConversation = {
  id: string;
  participants: string[];
  lastMessage?: string;
  lastMessageAt?: number;
  lastRead?: Record<string, number>;
};

export const auth = {
  token: () => localStorage.getItem(TOKEN_KEY),
  email: () => localStorage.getItem(EMAIL_KEY),
  role: () => localStorage.getItem(ROLE_KEY),
  save(token: string, email: string, role: string) {
    localStorage.setItem(TOKEN_KEY, token);
    localStorage.setItem(EMAIL_KEY, email);
    localStorage.setItem(ROLE_KEY, role);
  },
  clear() {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(EMAIL_KEY);
    localStorage.removeItem(ROLE_KEY);
  },
};

function headers(extra?: Record<string, string>): Record<string, string> {
  const h: Record<string, string> = { ...(extra || {}) };
  const t = auth.token();
  if (t) h['authorization'] = `Bearer ${t}`;
  return h;
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, init);
  const data = await res.json().catch(() => null);
  if (res.status === 401 || res.status === 403) {
    // Session died (or was revoked by a login elsewhere) — drop it and let App show the login.
    auth.clear();
    throw Object.assign(new Error((data && data.error) || 'Session expired. Please sign in again.'), { code: res.status });
  }
  if (res.status === 429) {
    throw new Error('Too many attempts — please wait a minute and try again.');
  }
  if (!res.ok) throw new Error((data && data.error) || `Request failed (${res.status})`);
  return data as T;
}

export async function login(email: string, password: string): Promise<{ email: string; role: string }> {
  const data = await call<{ success: boolean; token: string; email: string; role: string; error?: string }>('/api/admin/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  // Only staff accounts may open the support inbox (SUPPORT replies, SUPERADMIN oversees).
  const role = String(data.role || '').toUpperCase();
  if (!data.token || (role !== 'SUPPORT' && role !== 'SUPERADMIN' && role !== 'ADMIN')) {
    throw new Error('This console is for support staff accounts only.');
  }
  auth.save(data.token, data.email || email, role);
  return { email: data.email || email, role };
}

export type InboxPayload = { conversations: SupportConversation[]; messages: SupportMessage[] };

/** Everything the support mailbox holds — conversations + messages. */
export function fetchInbox(): Promise<InboxPayload> {
  return call<InboxPayload>('/api/chat/messages?userId=ADMIN_SUPPORT', { headers: headers() });
}

export function sendReply(toUserId: string, text: string) {
  return call<{ success: boolean; message?: SupportMessage }>('/api/chat/send', {
    method: 'POST',
    headers: headers({ 'content-type': 'application/json' }),
    body: JSON.stringify({ senderId: 'ADMIN_SUPPORT', recipientId: toUserId, text }),
  });
}

export function markRead(conversationId: string) {
  return call<{ success: boolean }>('/api/chat/read', {
    method: 'POST',
    headers: headers({ 'content-type': 'application/json' }),
    body: JSON.stringify({ conversationId }),
  }).catch(() => ({ success: false }));
}

/** Live feed: new user messages arrive instantly (SSE, token via query because
 *  EventSource cannot send headers — the server explicitly supports ?token=). */
export function openStream(onEvent: (payload: any) => void): () => void {
  const token = auth.token();
  if (!token || typeof EventSource === 'undefined') return () => {};
  const url = `/api/chat/stream?userId=ADMIN_SUPPORT&token=${encodeURIComponent(token)}`;
  const es = new EventSource(url);
  es.onmessage = (ev) => {
    try {
      onEvent(JSON.parse(ev.data));
    } catch {
      /* ignore malformed frames */
    }
  };
  es.onerror = () => {
    /* the browser retries on its own */
  };
  return () => es.close();
}

/** Attachments live behind the API (or as data URIs for older messages). */
export function mediaUrl(msg: SupportMessage): string | null {
  if (msg.photoUrl) return msg.photoUrl;
  if (msg.photoFileId) return `/api/chat/file/${msg.photoFileId}`;
  if (msg.voiceUrl) return msg.voiceUrl;
  if (msg.voiceFileId) return `/api/chat/file/${msg.voiceFileId}`;
  return null;
}
