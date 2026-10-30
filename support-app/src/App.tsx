import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  auth,
  fetchInbox,
  login,
  markRead,
  mediaUrl,
  openStream,
  sendReply,
  type SupportConversation,
  type SupportMessage,
} from './api';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const SUPPORT_ID = 'ADMIN_SUPPORT';

type Thread = {
  peerId: string;
  conversationId: string;
  messages: SupportMessage[];
  lastUserMessage?: SupportMessage;
  lastMessage?: SupportMessage;
  unread: number;
};

function timeAgo(ts?: number): string {
  if (!ts) return '';
  const diff = Date.now() - ts;
  if (diff < 60_000) return 'now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h`;
  const d = new Date(ts);
  return `${d.getDate()}/${d.getMonth() + 1}`;
}

function clock(ts: number): string {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** Support threads only: a real user wrote to support. Agent/management channels
 *  and pure outbound broadcasts are excluded, which is exactly what this console is for. */
function isUserSupportConversation(conv: SupportConversation): { ok: boolean; peerId: string } {
  const parts = (conv.participants || []).map(String);
  if (!parts.includes(SUPPORT_ID)) return { ok: false, peerId: '' };
  const peers = parts.filter((p) => p !== SUPPORT_ID);
  if (peers.length !== 1) return { ok: false, peerId: '' };   // groups / multi-party are not support DMs
  const peer = peers[0];
  if (/^(AGENT|MGMT|MANAGEMENT|ADMIN|SUPPORT)/i.test(peer)) return { ok: false, peerId: '' };
  if (!String(conv.id || '').toUpperCase().endsWith('ADMIN_SUPPORT')) return { ok: false, peerId: '' };
  return { ok: true, peerId: peer };
}

function buildThreads(conversations: SupportConversation[], messages: SupportMessage[]): Thread[] {
  const byConv = new Map<string, SupportMessage[]>();
  for (const m of messages) {
    if (!m || m.deleted) continue;
    const arr = byConv.get(m.conversationId);
    if (arr) arr.push(m);
    else byConv.set(m.conversationId, [m]);
  }
  const out: Thread[] = [];
  for (const conv of conversations) {
    const { ok, peerId } = isUserSupportConversation(conv);
    if (!ok) continue;
    const list = (byConv.get(conv.id) || []).sort((a, b) => a.timestamp - b.timestamp);
    const fromUser = list.filter((m) => String(m.senderId) === peerId);
    if (fromUser.length === 0) continue;                    // only threads the USER actually wrote in
    const lastUserMessage = fromUser[fromUser.length - 1];
    const readAt = Number((conv.lastRead || {})[SUPPORT_ID] || 0);
    const unread = fromUser.filter((m) => Number(m.timestamp) > readAt).length;
    out.push({ peerId, conversationId: conv.id, messages: list, lastUserMessage, lastMessage: list[list.length - 1], unread });
  }
  return out.sort((a, b) => (b.lastUserMessage?.timestamp || 0) - (a.lastUserMessage?.timestamp || 0));
}

// ---------------------------------------------------------------------------
// Login
// ---------------------------------------------------------------------------
function LoginScreen({ onDone }: { onDone: () => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await login(email.trim(), password);
      onDone();
    } catch (err: any) {
      setError(err?.message || 'Could not sign in.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-dvh flex items-center justify-center px-5 py-10">
      <form onSubmit={submit} className="w-full max-w-sm rounded-3xl border border-zinc-800 bg-zinc-900/80 p-6 shadow-2xl">
        <div className="flex items-center gap-3">
          <img src="/icon.svg" alt="" className="h-11 w-11 rounded-2xl" />
          <div>
            <h1 className="text-base font-bold text-white">BoostPay Support</h1>
            <p className="text-[11px] text-zinc-400">User messages to support land here</p>
          </div>
        </div>

        <label className="mt-6 block text-[11px] font-semibold uppercase tracking-wider text-zinc-400">Staff email</label>
        <input
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          type="email"
          autoComplete="username"
          placeholder="support@…"
          className="mt-1.5 w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2.5 text-sm text-white outline-none focus:border-amber-500/60"
        />

        <label className="mt-4 block text-[11px] font-semibold uppercase tracking-wider text-zinc-400">Password</label>
        <input
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          type="password"
          autoComplete="current-password"
          placeholder="••••••••"
          className="mt-1.5 w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2.5 text-sm text-white outline-none focus:border-amber-500/60"
        />

        {error && <p className="mt-3 rounded-xl border border-red-500/30 bg-red-950/40 px-3 py-2 text-[11px] text-red-200">{error}</p>}

        <button
          type="submit"
          disabled={busy || !email || !password}
          className="mt-5 h-11 w-full rounded-2xl bg-amber-500 text-xs font-bold text-zinc-950 disabled:opacity-50"
        >
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
        <p className="mt-3 text-center text-[10px] leading-relaxed text-zinc-500">
          Support staff accounts only. Ask an admin to create a SUPPORT account in the admin console.
        </p>
      </form>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Message bubble
// ---------------------------------------------------------------------------
function Bubble({ msg, mine }: { msg: SupportMessage; mine: boolean }) {
  const url = mediaUrl(msg);
  const isPhoto = msg.kind === 'photo';
  const isVoice = msg.kind === 'voice';
  return (
    <div className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`max-w-[78%] rounded-2xl px-3 py-2 text-sm shadow ${
          mine ? 'bg-amber-500 text-zinc-950' : 'bg-zinc-800 text-zinc-100'
        }`}
      >
        {isPhoto && url ? (
          <a href={url} target="_blank" rel="noreferrer">
            <img src={url} alt="Photo" className="max-h-56 w-auto rounded-xl" />
          </a>
        ) : isVoice && url ? (
          <div className="flex flex-col gap-1">
            <audio controls src={url} className="h-9 w-56 max-w-full" />
            {!!msg.voiceDurationMs && (
              <span className={`text-[10px] ${mine ? 'text-zinc-800/80' : 'text-zinc-400'}`}>
                🎤 {Math.round((msg.voiceDurationMs || 0) / 1000)}s
              </span>
            )}
          </div>
        ) : (
          <p className="whitespace-pre-wrap break-words">{msg.text || ''}</p>
        )}
        <div className={`mt-1 text-right text-[10px] ${mine ? 'text-zinc-800/70' : 'text-zinc-500'}`}>{clock(msg.timestamp)}</div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Thread view
// ---------------------------------------------------------------------------
function ThreadView({ thread, onBack, onSent }: { thread: Thread; onBack: () => void; onSent: () => void }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const endRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' });
    markRead(thread.conversationId);
  }, [thread.conversationId, thread.messages.length]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const body = text.trim();
    if (!body || busy) return;
    setBusy(true);
    setError('');
    try {
      await sendReply(thread.peerId, body);
      setText('');
      onSent();
    } catch (err: any) {
      setError(err?.message || 'Message not sent.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="sticky top-0 z-10 flex items-center gap-2 border-b border-zinc-800 bg-zinc-950/95 px-3 py-3 backdrop-blur">
        <button onClick={onBack} className="rounded-xl px-2 py-1 text-lg leading-none text-zinc-300 hover:text-white md:hidden">
          ‹
        </button>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-bold text-white">User #{thread.peerId}</div>
          <div className="text-[10px] text-zinc-500">Support conversation</div>
        </div>
        <button
          onClick={() => {
            navigator.clipboard?.writeText(thread.peerId).then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            });
          }}
          className="rounded-xl border border-zinc-700 px-2.5 py-1 text-[10px] font-semibold text-zinc-300"
        >
          {copied ? 'Copied' : 'Copy ID'}
        </button>
      </header>

      <div className="flex-1 space-y-2 px-3 py-4">
        {thread.messages.map((m) => (
          <Bubble key={m.id} msg={m} mine={String(m.senderId) === SUPPORT_ID} />
        ))}
        <div ref={endRef} />
      </div>

      <form onSubmit={submit} className="sticky bottom-0 border-t border-zinc-800 bg-zinc-950/95 px-3 py-2.5 pb-[max(10px,env(safe-area-inset-bottom))] backdrop-blur">
        {error && <p className="mb-1.5 text-[11px] text-red-300">{error}</p>}
        <div className="flex items-end gap-2">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={1}
            placeholder="Reply to user…"
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void submit(e as any);
              }
            }}
            className="max-h-28 min-h-[42px] flex-1 resize-y rounded-2xl border border-zinc-800 bg-zinc-900 px-3 py-2.5 text-sm text-white outline-none focus:border-amber-500/60"
          />
          <button
            type="submit"
            disabled={busy || !text.trim()}
            className="h-[42px] rounded-2xl bg-amber-500 px-4 text-xs font-bold text-zinc-950 disabled:opacity-50"
          >
            {busy ? '…' : 'Send'}
          </button>
        </div>
      </form>
    </div>
  );
}

// ---------------------------------------------------------------------------
// App
// ---------------------------------------------------------------------------
export default function App() {
  const [signedIn, setSignedIn] = useState<boolean>(() => !!auth.token());
  const [threads, setThreads] = useState<Thread[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [activeId, setActiveId] = useState<string>('');

  const load = useCallback(async () => {
    try {
      const data = await fetchInbox();
      setThreads(buildThreads(data.conversations || [], data.messages || []));
      setError('');
    } catch (err: any) {
      if (err?.code === 401 || err?.code === 403) {
        setSignedIn(false);
      } else {
        setError(err?.message || 'Could not load the inbox.');
      }
    } finally {
      setLoading(false);
    }
  }, []);

  // initial load + live feed + slow safety poll
  useEffect(() => {
    if (!signedIn) return;
    let alive = true;
    setLoading(true);
    void load();
    const close = openStream((payload) => {
      // Any user message (or read receipt) can change the inbox; a refresh keeps it simple and exact.
      if (payload && (payload.type === 'chat_message' || payload.type === 'chat_event')) {
        if (alive) void load();
      }
    });
    const poll = window.setInterval(() => {
      if (document.visibilityState === 'visible') void load();
    }, 20000);
    return () => {
      alive = false;
      close();
      window.clearInterval(poll);
    };
  }, [signedIn, load]);

  const filtered = useMemo(() => {
    const q = query.trim().replace(/^#/, '').toLowerCase();
    if (!q) return threads;
    return threads.filter((t) => t.peerId.toLowerCase().includes(q));
  }, [threads, query]);

  const active = threads.find((t) => t.conversationId === activeId);

  const signOut = () => {
    auth.clear();
    setSignedIn(false);
    setThreads([]);
    setActiveId('');
  };

  if (!signedIn) return <LoginScreen onDone={() => setSignedIn(true)} />;

  if (active) {
    return (
      <ThreadView
        thread={active}
        onBack={() => setActiveId('')}
        onSent={() => {
          void load();
        }}
      />
    );
  }

  const totalUnread = threads.reduce((n, t) => n + t.unread, 0);

  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-10 border-b border-zinc-800 bg-zinc-950/95 px-4 py-3 backdrop-blur">
        <div className="flex items-center gap-3">
          <img src="/icon.svg" alt="" className="h-9 w-9 rounded-xl" />
          <div className="min-w-0 flex-1">
            <h1 className="text-sm font-bold text-white">
              Support inbox
              {totalUnread > 0 && (
                <span className="ml-2 rounded-full bg-amber-500 px-1.5 py-0.5 text-[10px] font-bold text-zinc-950">{totalUnread}</span>
              )}
            </h1>
            <p className="truncate text-[10px] text-zinc-500">
              {auth.email()} · {auth.role()}
            </p>
          </div>
          <button onClick={signOut} className="rounded-xl border border-zinc-700 px-2.5 py-1.5 text-[10px] font-semibold text-zinc-300">
            Sign out
          </button>
        </div>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search user ID…"
          className="mt-3 w-full rounded-xl border border-zinc-800 bg-zinc-900 px-3 py-2 text-xs text-white outline-none focus:border-amber-500/60"
        />
      </header>

      {error && <p className="mx-4 mt-3 rounded-xl border border-red-500/30 bg-red-950/40 px-3 py-2 text-[11px] text-red-200">{error}</p>}

      {loading && threads.length === 0 && <p className="px-4 py-8 text-center text-xs text-zinc-500">Loading messages…</p>}

      {!loading && threads.length === 0 && (
        <div className="px-6 py-16 text-center">
          <p className="text-sm font-semibold text-zinc-300">No user messages yet</p>
          <p className="mt-1 text-[11px] leading-relaxed text-zinc-500">
            When a user taps Support in the app, the conversation appears here instantly.
          </p>
        </div>
      )}

      <ul className="divide-y divide-zinc-800/70">
        {filtered.map((t) => (
          <li key={t.conversationId}>
            <button onClick={() => setActiveId(t.conversationId)} className="flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-zinc-900/60">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-zinc-800 text-[11px] font-bold text-amber-400">
                {t.peerId.slice(0, 2).toUpperCase()}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="truncate text-xs font-bold text-white">User #{t.peerId}</span>
                  <span className="shrink-0 text-[10px] text-zinc-500">{timeAgo(t.lastUserMessage?.timestamp)}</span>
                </div>
                <p className="mt-0.5 truncate text-[11px] text-zinc-400">
                  <span className="text-zinc-500">User: </span>
                  {t.lastUserMessage?.kind === 'photo'
                    ? '📷 Photo'
                    : t.lastUserMessage?.kind === 'voice'
                    ? '🎤 Voice message'
                    : t.lastUserMessage?.text || ''}
                </p>
                {t.lastMessage && String(t.lastMessage.senderId) === SUPPORT_ID && (
                  <p className="truncate text-[10px] text-zinc-600">You: {t.lastMessage.text}</p>
                )}
              </div>
              {t.unread > 0 && (
                <span className="mt-1 shrink-0 rounded-full bg-amber-500 px-1.5 py-0.5 text-[10px] font-bold text-zinc-950">{t.unread}</span>
              )}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
