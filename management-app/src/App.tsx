import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ArrowDownLeft, ArrowUpRight, Building2, Check, ChevronRight, CircleDollarSign, Coins,
  Copy, History, Home, Landmark, LogOut, MessageSquare, Plus, Save, Send, Settings2, ShieldCheck, User, Users, X
} from 'lucide-react';

/* ── API client ─────────────────────────────────────────────────────────── */
const TOKEN_KEY = 'bpm_token_v1';
const MGR_KEY = 'bpm_manager_v1';

type Mgmt = { id: string; name: string; email: string; balance: number; isActive: boolean };
type AgentRow = {
  id: string; name: string; email: string; balance: number; commissionLifetime: number;
  sentTotal: number; receivedTotal: number; isActive: boolean; createdAt: number; passwordPlain?: string;
};
type Settings = {
  enabled: boolean; feePercentOnUserSend: number; commissionPercentOnReceive: number;
  commissionPercentOnSend: number; minUserSend: number; maxUserSend: number; allowAgentBoost: boolean;
};
type Stats = {
  feesCollected: number; commissionsPaid: number; platformNet: number; volumeIn: number;
  volumeOut: number; totalAgentBalance: number; agents: number; management: number;
};
type LedgerRow = { id: string; at: number; type: string; amount: number; fee: number; commission: number; balanceAfter: number; agentId: string; userId?: string; note?: string };
type WalletRow = { id: string; at: number; type: string; amount: number; balanceAfter: number; agentId?: string; note?: string };
type MsgRow = { id: string; managementId: string; agentId: string; senderRole: 'MANAGEMENT' | 'AGENT'; text: string; at: number };
type MsgThread = { agentId: string; lastText: string; lastAt: number; unread: number; lastSender: string };

const money = (n: number) => (Number.isFinite(Number(n)) ? Number(n) : 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const timeAgo = (ts: number) => {
  const d = Math.max(0, Date.now() - ts) / 1000;
  if (d < 60) return 'just now';
  if (d < 3600) return `${Math.floor(d / 60)}m ago`;
  if (d < 86400) return `${Math.floor(d / 3600)}h ago`;
  return `${Math.floor(d / 86400)}d ago`;
};

class ApiError extends Error { status: number; constructor(m: string, s: number) { super(m); this.status = s; } }

async function api<T = any>(path: string, opts: { method?: string; body?: any } = {}): Promise<T> {
  const token = localStorage.getItem(TOKEN_KEY) || '';
  const res = await fetch(path, {
    method: opts.method || 'GET',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: opts.body ? JSON.stringify(opts.body) : undefined
  });
  let data: any = null;
  try { data = await res.json(); } catch { /* ignore */ }
  if (res.status === 401) {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(MGR_KEY);
    window.dispatchEvent(new Event('bpm:signed-out'));
    throw new ApiError(data?.error || 'Session expired. Please sign in again.', 401);
  }
  if (!res.ok) throw new ApiError(data?.error || `Request failed (${res.status})`, res.status);
  return data as T;
}

const Card: React.FC<{ children: React.ReactNode; className?: string }> = ({ children, className = '' }) => (
  <div className={`rounded-3xl border border-zinc-800/90 bg-zinc-900/60 p-4 ${className}`}>{children}</div>
);
const inputCls = 'w-full rounded-2xl border border-zinc-800 bg-zinc-950 px-3.5 py-3 text-sm text-white placeholder-zinc-600 outline-none focus:border-cyan-500/70';
const Field: React.FC<{ label: string; children: React.ReactNode; hint?: string }> = ({ label, children, hint }) => (
  <label className="block">
    <span className="mb-1.5 block text-[10px] font-bold uppercase tracking-wider text-zinc-400">{label}</span>
    {children}
    {hint ? <span className="mt-1 block text-[10px] text-zinc-500">{hint}</span> : null}
  </label>
);

const Toast: React.FC<{ toast: { type: 'ok' | 'err'; text: string } | null; onClose: () => void }> = ({ toast, onClose }) => {
  useEffect(() => { if (!toast) return; const t = setTimeout(onClose, 3200); return () => clearTimeout(t); }, [toast, onClose]);
  if (!toast) return null;
  return (
    <div className="fixed inset-x-0 top-3 z-50 mx-auto w-full max-w-[430px] px-4">
      <div className={`flex items-start gap-2 rounded-2xl border px-3.5 py-3 text-xs font-semibold shadow-2xl ${toast.type === 'ok' ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200' : 'border-red-500/40 bg-red-500/10 text-red-200'}`}>
        {toast.type === 'ok' ? <Check className="mt-0.5 h-4 w-4 shrink-0" /> : <X className="mt-0.5 h-4 w-4 shrink-0" />}
        <span className="flex-1">{toast.text}</span>
      </div>
    </div>
  );
};

/* ── login ──────────────────────────────────────────────────────────────── */
const Login: React.FC<{ onDone: (m: Mgmt) => void; toast: (t: any) => void }> = ({ onDone, toast }) => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setError(''); setBusy(true);
    try {
      const res = await api<{ token: string; management: Mgmt }>('/api/management/login', { method: 'POST', body: { email: email.trim(), password } });
      localStorage.setItem(TOKEN_KEY, res.token);
      localStorage.setItem(MGR_KEY, JSON.stringify(res.management));
      toast({ type: 'ok', text: `Welcome, ${res.management.name || res.management.id}` });
      onDone(res.management);
    } catch (err: any) { setError(err?.message || 'Sign in failed.'); } finally { setBusy(false); }
  };
  return (
    <div className="flex min-h-screen flex-col justify-center px-5">
      <div className="mx-auto w-full max-w-[430px]">
        <div className="mb-8 flex flex-col items-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-3xl bg-cyan-500 shadow-lg shadow-cyan-500/25"><Landmark className="h-8 w-8 text-zinc-950" /></div>
          <h1 className="mt-4 text-xl font-black tracking-tight text-white">BoostPay Management</h1>
          <p className="mt-1 text-[11px] font-medium text-zinc-500">Agent network control — mobile only</p>
        </div>
        <form onSubmit={submit} className="space-y-3">
          <Field label="Management email"><input className={inputCls} type="email" autoComplete="email" placeholder="management@boostpay.online" value={email} onChange={(e) => setEmail(e.target.value)} required /></Field>
          <Field label="Password"><input className={inputCls} type="password" autoComplete="current-password" placeholder="••••••••" value={password} onChange={(e) => setPassword(e.target.value)} required /></Field>
          {error ? <div className="rounded-2xl border border-red-500/40 bg-red-500/10 px-3 py-2 text-[11px] font-semibold text-red-200">{error}</div> : null}
          <button type="submit" disabled={busy} className="mt-2 flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-cyan-500 text-sm font-black text-zinc-950 active:scale-[0.99] disabled:opacity-60">
            {busy ? 'Signing in…' : 'Sign in'} {!busy && <ChevronRight className="h-4 w-4" />}
          </button>
        </form>
        <p className="mt-6 text-center text-[10px] leading-relaxed text-zinc-600">Management accounts are created from the BoostPay admin console.</p>
      </div>
    </div>
  );
};

/* ── agent detail sheet ─────────────────────────────────────────────────── */
const AgentSheet: React.FC<{
  agent: AgentRow; mgmtBalance: number; onClose: () => void; onChanged: () => void; toast: (t: any) => void;
}> = ({ agent, mgmtBalance, onClose, onChanged, toast }) => {
  const [mode, setMode] = useState<'CREDIT' | 'DEBIT'>('CREDIT');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [showPw, setShowPw] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setError('');
    if (!/^\d+(\.\d{1,2})?$/.test(amount.trim())) { setError('Enter an amount with at most 2 decimals.'); return; }
    if (mode === 'CREDIT' && Number(amount) > mgmtBalance) { setError(`Your management balance is only $${money(mgmtBalance)}. Ask the admin to top up first.`); return; }
    if (mode === 'DEBIT' && Number(amount) > agent.balance) { setError(`Agent balance is only $${money(agent.balance)}.`); return; }
    setBusy(true);
    try {
      const path = mode === 'CREDIT' ? `/api/management/agents/${agent.id}/credit` : `/api/management/agents/${agent.id}/debit`;
      await api(path, { method: 'POST', body: { amount: amount.trim(), note: note.trim() } });
      toast({ type: 'ok', text: `${mode === 'CREDIT' ? 'Funded' : 'Collected'} $${money(Number(amount))} — ${agent.id}` });
      setAmount(''); setNote(''); onChanged();
    } catch (err: any) { setError(err?.message || 'Failed.'); } finally { setBusy(false); }
  };

  const toggleActive = async () => {
    try {
      await api(`/api/management/agents/${agent.id}`, { method: 'PATCH', body: { isActive: !agent.isActive } });
      toast({ type: 'ok', text: `${agent.id} ${agent.isActive ? 'disabled' : 'enabled'}` });
      onChanged();
    } catch (err: any) { toast({ type: 'err', text: err?.message || 'Failed.' }); }
  };

  return (
    <div className="fixed inset-0 z-40 flex flex-col justify-end">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <div className="relative mx-auto w-full max-w-[430px] rounded-t-3xl border border-zinc-800 bg-zinc-900 p-4 pb-6">
        <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-zinc-700" />
        <div className="flex items-start justify-between">
          <div>
            <div className="text-sm font-black text-white">{agent.name || agent.id}</div>
            <div className="text-[10px] font-mono text-zinc-500">{agent.id} · {agent.email}</div>
          </div>
          <button onClick={onClose} className="rounded-xl border border-zinc-800 bg-zinc-950 p-2 text-zinc-400"><X className="h-4 w-4" /></button>
        </div>
        <div className="mt-3 grid grid-cols-3 gap-2 text-center text-[10px]">
          <div className="rounded-xl bg-zinc-950/70 px-2 py-2"><div className="text-zinc-500">Balance</div><div className="font-black text-white">${money(agent.balance)}</div></div>
          <div className="rounded-xl bg-zinc-950/70 px-2 py-2"><div className="text-zinc-500">Commission</div><div className="font-black text-emerald-300">${money(agent.commissionLifetime)}</div></div>
          <div className="rounded-xl bg-zinc-950/70 px-2 py-2"><div className="text-zinc-500">Status</div><div className={`font-black ${agent.isActive ? 'text-emerald-400' : 'text-red-400'}`}>{agent.isActive ? 'Active' : 'Disabled'}</div></div>
        </div>
        <div className="mt-3 flex items-center justify-between rounded-xl border border-zinc-800 bg-zinc-950/80 px-3 py-2 text-[10px]">
          <span className="text-zinc-500">Your management wallet</span>
          <span className="font-black text-cyan-300">${money(mgmtBalance)}</span>
        </div>
        <div className="mt-2 flex gap-2">
          <button onClick={() => setMode('CREDIT')} className={`flex h-9 flex-1 items-center justify-center gap-1.5 rounded-xl text-[11px] font-bold ${mode === 'CREDIT' ? 'bg-cyan-500 text-zinc-950' : 'border border-zinc-800 bg-zinc-950 text-zinc-300'}`}><ArrowDownLeft className="h-3.5 w-3.5" /> Fund agent</button>
          <button onClick={() => setMode('DEBIT')} className={`flex h-9 flex-1 items-center justify-center gap-1.5 rounded-xl text-[11px] font-bold ${mode === 'DEBIT' ? 'bg-amber-500 text-zinc-950' : 'border border-zinc-800 bg-zinc-950 text-zinc-300'}`}><ArrowUpRight className="h-3.5 w-3.5" /> Collect</button>
        </div>
        <form onSubmit={submit} className="mt-3 space-y-2">
          <input className={inputCls} inputMode="decimal" placeholder="Amount (USD)" value={amount} onChange={(e) => setAmount(e.target.value)} required />
          <input className={inputCls} placeholder="Note (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
          {error ? <div className="rounded-xl border border-red-500/40 bg-red-500/10 px-3 py-2 text-[11px] font-semibold text-red-200">{error}</div> : null}
          <button type="submit" disabled={busy} className="flex h-11 w-full items-center justify-center gap-2 rounded-2xl bg-cyan-500 text-xs font-black text-zinc-950 disabled:opacity-60">
            <Send className="h-3.5 w-3.5" /> {busy ? 'Processing…' : mode === 'CREDIT' ? 'Send to agent' : 'Receive from agent'}
          </button>
        </form>
        <div className="mt-3 flex items-center justify-between rounded-2xl border border-zinc-800 bg-zinc-950 px-3 py-2.5">
          <div>
            <div className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">Agent password</div>
            <div className="font-mono text-[11px] text-zinc-300">{showPw ? (agent.passwordPlain || '—') : '••••••••'}</div>
          </div>
          <button onClick={() => setShowPw((v) => !v)} className="rounded-xl border border-zinc-800 px-2.5 py-1.5 text-[10px] font-bold text-zinc-300">{showPw ? 'Hide' : 'Show'}</button>
        </div>
        <button onClick={toggleActive} className={`mt-2 h-10 w-full rounded-2xl border text-[11px] font-bold ${agent.isActive ? 'border-red-500/30 bg-red-500/10 text-red-300' : 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'}`}>
          {agent.isActive ? 'Disable agent account' : 'Enable agent account'}
        </button>
      </div>
    </div>
  );
};

/* ── create agent ───────────────────────────────────────────────────────── */
const CreateAgentSheet: React.FC<{ mgmtBalance: number; onClose: () => void; onCreated: (a: AgentRow) => void; toast: (t: any) => void }> = ({ mgmtBalance, onClose, onCreated, toast }) => {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [opening, setOpening] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setError(''); setBusy(true);
    try {
      const res = await api<{ agent: AgentRow }>('/api/management/agents', {
        method: 'POST',
        body: { name: name.trim(), email: email.trim(), password, ...(opening.trim() ? { openingBalance: opening.trim() } : {}) }
      });
      toast({ type: 'ok', text: `Agent ${res.agent.id} created` });
      onCreated(res.agent);
      onClose();
    } catch (err: any) { setError(err?.message || 'Failed.'); } finally { setBusy(false); }
  };
  return (
    <div className="fixed inset-0 z-40 flex flex-col justify-end">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <div className="relative mx-auto w-full max-w-[430px] rounded-t-3xl border border-zinc-800 bg-zinc-900 p-4 pb-6">
        <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-zinc-700" />
        <div className="flex items-center justify-between">
          <div className="text-sm font-black text-white">Create agent account</div>
          <button onClick={onClose} className="rounded-xl border border-zinc-800 bg-zinc-950 p-2 text-zinc-400"><X className="h-4 w-4" /></button>
        </div>
        <form onSubmit={submit} className="mt-3 space-y-2">
          <input className={inputCls} placeholder="Agent name (e.g. Dhaka Point)" value={name} onChange={(e) => setName(e.target.value)} />
          <input className={inputCls} type="email" placeholder="Agent email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          <input className={inputCls} type="text" placeholder="Password (min 6 characters)" value={password} onChange={(e) => setPassword(e.target.value)} required />
          <input className={inputCls} inputMode="decimal" placeholder={`Opening balance from your wallet (max $${money(mgmtBalance)}) — optional`} value={opening} onChange={(e) => setOpening(e.target.value)} />
          {error ? <div className="rounded-xl border border-red-500/40 bg-red-500/10 px-3 py-2 text-[11px] font-semibold text-red-200">{error}</div> : null}
          <button type="submit" disabled={busy} className="flex h-11 w-full items-center justify-center gap-2 rounded-2xl bg-cyan-500 text-xs font-black text-zinc-950 disabled:opacity-60">
            <Plus className="h-3.5 w-3.5" /> {busy ? 'Creating…' : 'Create agent'}
          </button>
        </form>
        <p className="mt-2 text-center text-[9px] leading-relaxed text-zinc-600">
          This agent belongs to your management network. Any opening balance is deducted from your wallet (${money(mgmtBalance)} available).
          Agent accounts can sign in at the BoostPay Agent app only.
        </p>
      </div>
    </div>
  );
};

/* ── agent chat (management ↔ its own agents) ───────────────────────────── */
const ChatSheet: React.FC<{ agent: AgentRow; onClose: () => void; onRead: () => void; toast: (t: any) => void }> = ({ agent, onClose, onRead, toast }) => {
  const [msgs, setMsgs] = useState<MsgRow[]>([]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(true);
  const listRef = useRef<HTMLDivElement | null>(null);

  const load = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    try {
      const res = await api<{ messages: MsgRow[] }>(`/api/management/agents/${agent.id}/messages`);
      setMsgs(res.messages || []);
      setErr('');
      onRead();
    } catch (e: any) { if (!quiet) setErr(e?.message || 'Could not load the conversation.'); }
    finally { if (!quiet) setLoading(false); }
  }, [agent.id, onRead]);

  useEffect(() => {
    void load();
    const iv = window.setInterval(() => { void load(true); }, 8000);
    return () => window.clearInterval(iv);
  }, [load]);

  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [msgs.length]);

  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!text.trim()) return;
    setBusy(true); setErr('');
    try {
      const res = await api<{ message: MsgRow }>(`/api/management/agents/${agent.id}/messages`, { method: 'POST', body: { text: text.trim() } });
      setMsgs((prev) => [...prev, res.message]);
      setText('');
    } catch (e2: any) { setErr(e2?.message || 'Message could not be sent.'); }
    finally { setBusy(false); }
  };

  return (
    <div className="fixed inset-0 z-40 flex flex-col justify-end">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <div className="relative mx-auto flex h-[80vh] w-full max-w-[430px] flex-col rounded-t-3xl border border-zinc-800 bg-zinc-900">
        <div className="flex items-center justify-between border-b border-zinc-800 px-4 py-3">
          <div className="min-w-0">
            <div className="truncate text-sm font-black text-white">{agent.name || agent.id}</div>
            <div className="font-mono text-[9px] text-zinc-500">{agent.id}</div>
          </div>
          <button onClick={onClose} className="rounded-xl border border-zinc-800 bg-zinc-950 p-2 text-zinc-400"><X className="h-4 w-4" /></button>
        </div>

        <div ref={listRef} className="flex-1 space-y-2 overflow-y-auto overscroll-contain px-3 py-3">
          {loading ? (
            <p className="py-8 text-center text-[11px] text-zinc-500">Loading…</p>
          ) : msgs.length === 0 ? (
            <div className="mt-6 rounded-2xl border border-zinc-800 bg-zinc-950/70 p-4 text-center">
              <MessageSquare className="mx-auto h-5 w-5 text-zinc-600" />
              <p className="mt-2 text-[11px] font-semibold text-zinc-300">No messages yet</p>
              <p className="mt-1 text-[10px] leading-relaxed text-zinc-500">Send instructions, float notices or a collection request. Only this agent sees this thread.</p>
            </div>
          ) : msgs.map((m) => {
            const mine = m.senderRole === 'MANAGEMENT';
            return (
              <div key={m.id} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[82%] rounded-2xl border px-3 py-2 text-[12px] leading-relaxed ${mine ? 'border-cyan-500/25 bg-cyan-500/15 text-cyan-50' : 'border-zinc-700/70 bg-zinc-800 text-zinc-100'}`}>
                  <div className="whitespace-pre-wrap break-words">{m.text}</div>
                  <div className={`mt-1 text-right text-[8px] ${mine ? 'text-cyan-200/60' : 'text-zinc-500'}`}>{timeAgo(m.at)}</div>
                </div>
              </div>
            );
          })}
        </div>

        {err ? <div className="mx-3 mb-2 rounded-xl border border-red-500/40 bg-red-500/10 px-3 py-2 text-[11px] font-semibold text-red-200">{err}</div> : null}

        <form onSubmit={send} className="flex items-end gap-2 border-t border-zinc-800 bg-zinc-950/80 px-3 py-2.5">
          <input
            value={text}
            onChange={(e) => setText(e.target.value.slice(0, 1000))}
            placeholder="Message this agent…"
            className="min-w-0 flex-1 rounded-2xl border border-zinc-800 bg-zinc-900 px-3.5 py-2.5 text-[12px] text-white placeholder-zinc-600 outline-none focus:border-cyan-500/60"
          />
          <button type="submit" disabled={busy || !text.trim()} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-cyan-500 text-zinc-950 disabled:opacity-40">
            <Send className="h-4 w-4" />
          </button>
        </form>
      </div>
    </div>
  );
};

/* ── app ────────────────────────────────────────────────────────────────── */
type Tab = 'HOME' | 'AGENTS' | 'MESSAGES' | 'CONFIG' | 'HISTORY' | 'PROFILE';

export default function App() {
  const [mgr, setMgr] = useState<Mgmt | null>(() => {
    try { const raw = localStorage.getItem(MGR_KEY); return raw ? JSON.parse(raw) : null; } catch { return null; }
  });
  const [token, setToken] = useState(localStorage.getItem(TOKEN_KEY) || '');
  const [agents, setAgents] = useState<AgentRow[]>([]);
  const [settings, setSettings] = useState<Settings>({ enabled: true, feePercentOnUserSend: 2, commissionPercentOnReceive: 1, commissionPercentOnSend: 1, minUserSend: 1, maxUserSend: 100000, allowAgentBoost: false });
  const [stats, setStats] = useState<Stats | null>(null);
  const [ledger, setLedger] = useState<LedgerRow[]>([]);
  const [wallet, setWallet] = useState<WalletRow[]>([]);
  const [threads, setThreads] = useState<MsgThread[]>([]);
  const [msgUnread, setMsgUnread] = useState(0);
  const [chatAgent, setChatAgent] = useState<AgentRow | null>(null);
  const [balance, setBalance] = useState(0);
  const [tab, setTab] = useState<Tab>('HOME');
  const [selected, setSelected] = useState<AgentRow | null>(null);
  const [creating, setCreating] = useState(false);
  const [busyCfg, setBusyCfg] = useState(false);
  const [toastState, setToastState] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const toast = useCallback((t: any) => setToastState(t), []);

  const loadAll = useCallback(async () => {
    if (!localStorage.getItem(TOKEN_KEY)) return;
    try {
      const [a, me, l, msg] = await Promise.all([
        api<any>('/api/management/agents'),
        api<any>('/api/management/me'),
        api<any>('/api/management/ledger?limit=150'),
        api<any>('/api/management/messages')
      ]);
      setAgents(a.agents || []); setSettings(a.settings || settings); setStats(a.stats || null);
      if (me.management) { setMgr(me.management); localStorage.setItem(MGR_KEY, JSON.stringify(me.management)); }
      setBalance(Number(me.balance ?? a.balance ?? me.management?.balance ?? 0));
      setLedger(l.ledger || []);
      setWallet(l.wallet || []);
      setThreads(msg.threads || []);
      setMsgUnread(Number(msg.unread) || 0);
    } catch { /* 401 handled in api() */ }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const onOut = () => { setMgr(null); setToken(''); };
    window.addEventListener('bpm:signed-out', onOut);
    return () => window.removeEventListener('bpm:signed-out', onOut);
  }, []);

  useEffect(() => {
    if (!token) return;
    void loadAll();
    const iv = window.setInterval(loadAll, 25000);
    return () => window.clearInterval(iv);
  }, [token, loadAll]);

  const saveConfig = async (patch: Partial<Settings>) => {
    setBusyCfg(true);
    try {
      const res = await api<{ settings: Settings }>('/api/management/config', { method: 'POST', body: { ...settings, ...patch } });
      setSettings(res.settings);
      toast({ type: 'ok', text: 'Settings saved' });
      void loadAll();
    } catch (err: any) { toast({ type: 'err', text: err?.message || 'Save failed.' }); }
    finally { setBusyCfg(false); }
  };

  const logout = async () => {
    try { await api('/api/management/logout', { method: 'POST' }); } catch { /* ignore */ }
    localStorage.removeItem(TOKEN_KEY); localStorage.removeItem(MGR_KEY);
    setMgr(null); setToken('');
  };

  const copy = async (v: string) => {
    try { await navigator.clipboard.writeText(v); toast({ type: 'ok', text: `Copied ${v}` }); }
    catch { toast({ type: 'err', text: v }); }
  };

  if (!token || !mgr) {
    return (<><Toast toast={toastState} onClose={() => setToastState(null)} /><Login toast={toast} onDone={(m) => { setMgr(m); setToken(localStorage.getItem(TOKEN_KEY) || ''); }} /></>);
  }

  const tabs: Array<{ id: Tab; label: string; icon: any }> = [
    { id: 'HOME', label: 'Home', icon: Home },
    { id: 'AGENTS', label: 'Agents', icon: Users },
    { id: 'MESSAGES', label: 'Chats', icon: MessageSquare },
    { id: 'CONFIG', label: 'Config', icon: Settings2 },
    { id: 'HISTORY', label: 'History', icon: History },
    { id: 'PROFILE', label: 'Profile', icon: User }
  ];

  return (
    <div className="min-h-screen bg-zinc-950 text-white">
      <Toast toast={toastState} onClose={() => setToastState(null)} />
      <div className="mx-auto flex min-h-screen w-full max-w-[430px] flex-col">
        <header className="safe-pt sticky top-0 z-20 flex items-center justify-between border-b border-zinc-800/70 bg-zinc-950/95 px-4 py-3 backdrop-blur">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-cyan-500"><Landmark className="h-4 w-4 text-zinc-950" /></div>
            <div>
              <div className="text-[13px] font-black leading-none text-white">BoostPay <span className="text-cyan-400">Management</span></div>
              <div className="mt-0.5 text-[9px] font-medium text-zinc-500">{mgr.id} · {mgr.name || 'Management'}</div>
            </div>
          </div>
          <div className="rounded-full border border-cyan-500/30 bg-cyan-500/10 px-2.5 py-1 text-[10px] font-bold text-cyan-300">{stats?.agents ?? agents.length} agents</div>
        </header>

        <main className="flex-1 px-4 py-4 pb-24">
          {tab === 'HOME' && (
            <div className="space-y-3">
              <div className="rounded-3xl border border-cyan-500/30 bg-gradient-to-br from-cyan-500/20 via-zinc-900 to-zinc-950 p-5">
                <div className="text-[10px] font-bold uppercase tracking-wider text-cyan-300/90">My management wallet</div>
                <div className="mt-1 text-3xl font-black text-white">${money(balance)}</div>
                <div className="mt-1 text-[9px] font-semibold text-zinc-400">Funded by the admin · you distribute this to your own agents</div>
                <div className="mt-3 grid grid-cols-2 gap-2 text-[10px] font-semibold">
                  <div className="rounded-xl bg-zinc-950/60 px-2.5 py-2"><div className="text-zinc-500">Fees collected</div><div className="text-white">${money(stats?.feesCollected || 0)}</div></div>
                  <div className="rounded-xl bg-zinc-950/60 px-2.5 py-2"><div className="text-zinc-500">Commissions paid</div><div className="text-white">${money(stats?.commissionsPaid || 0)}</div></div>
                </div>
                <div className="mt-2 flex items-center justify-between rounded-xl bg-zinc-950/60 px-2.5 py-2 text-[10px] font-semibold">
                  <span className="text-zinc-500">My agents' float</span>
                  <span className="text-white">${money(stats?.totalAgentBalance || 0)}</span>
                </div>
                <div className="mt-2 flex items-center justify-between rounded-xl bg-zinc-950/60 px-2.5 py-2 text-[10px] font-semibold">
                  <span className="text-zinc-500">Platform net (fees − commission)</span>
                  <span className={(stats?.platformNet || 0) >= 0 ? 'text-emerald-300' : 'text-red-300'}>${money(stats?.platformNet || 0)}</span>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <Card>
                  <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-zinc-500"><ArrowDownLeft className="h-3 w-3 text-emerald-400" /> Volume in</div>
                  <div className="mt-1.5 text-lg font-black text-white">${money(stats?.volumeIn || 0)}</div>
                </Card>
                <Card>
                  <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-zinc-500"><ArrowUpRight className="h-3 w-3 text-amber-400" /> Volume out</div>
                  <div className="mt-1.5 text-lg font-black text-white">${money(stats?.volumeOut || 0)}</div>
                </Card>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <button onClick={() => setCreating(true)} className="flex h-20 flex-col items-center justify-center gap-1 rounded-3xl border border-cyan-500/30 bg-cyan-500/10 text-[11px] font-bold text-cyan-200 active:scale-[0.99]">
                  <Plus className="h-5 w-5" /> Create agent
                </button>
                <button onClick={() => setTab('AGENTS')} className="flex h-20 flex-col items-center justify-center gap-1 rounded-3xl border border-zinc-800 bg-zinc-900/60 text-[11px] font-bold text-zinc-300 active:scale-[0.99]">
                  <Users className="h-5 w-5" /> Manage agents
                </button>
              </div>

              <Card>
                <div className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">Current rates</div>
                <div className="mt-2 space-y-1.5 text-[11px]">
                  <div className="flex justify-between"><span className="text-zinc-500">User → agent fee (paid by user)</span><span className="font-bold text-white">{settings.feePercentOnUserSend}%</span></div>
                  <div className="flex justify-between"><span className="text-zinc-500">Agent commission on receive</span><span className="font-bold text-emerald-300">{settings.commissionPercentOnReceive}%</span></div>
                  <div className="flex justify-between"><span className="text-zinc-500">Agent commission on send</span><span className="font-bold text-emerald-300">{settings.commissionPercentOnSend}%</span></div>
                  <div className="flex justify-between"><span className="text-zinc-500">Agent boost</span><span className="font-bold text-zinc-400">Users only</span></div>
                </div>
                <button onClick={() => setTab('CONFIG')} className="mt-2 flex h-9 w-full items-center justify-center gap-1.5 rounded-xl border border-zinc-800 bg-zinc-950 text-[11px] font-bold text-zinc-300"><Settings2 className="h-3.5 w-3.5" /> Edit configuration</button>
              </Card>
            </div>
          )}

          {tab === 'AGENTS' && (
            <div className="space-y-3">
              <button onClick={() => setCreating(true)} className="flex h-11 w-full items-center justify-center gap-2 rounded-2xl bg-cyan-500 text-xs font-black text-zinc-950 active:scale-[0.99]"><Plus className="h-4 w-4" /> Create agent account</button>
              <div className="flex items-center justify-between rounded-2xl border border-zinc-800 bg-zinc-900/60 px-3 py-2.5 text-[10px]">
                <span className="text-zinc-500">My wallet</span>
                <span className="font-black text-cyan-300">${money(balance)}</span>
              </div>
              <p className="px-1 text-[9px] leading-relaxed text-zinc-600">Only agents created under your management are listed. You cannot fund or collect another management's agents.</p>
              {agents.length === 0 ? (
                <Card><p className="py-6 text-center text-[11px] text-zinc-600">No agents yet. Create the first one.</p></Card>
              ) : agents.map((a) => (
                <button key={a.id} onClick={() => setSelected(a)} className="flex w-full items-center gap-3 rounded-2xl border border-zinc-800 bg-zinc-900/60 p-3 text-left active:scale-[0.995]">
                  <div className={`flex h-10 w-10 items-center justify-center rounded-2xl text-sm font-black ${a.isActive ? 'bg-cyan-500/15 text-cyan-300' : 'bg-zinc-800 text-zinc-500'}`}>{(a.name || a.id).slice(0, 1).toUpperCase()}</div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[12px] font-bold text-white">{a.name || a.id}</div>
                    <div className="truncate text-[9px] font-mono text-zinc-500">{a.id} · {a.isActive ? 'active' : 'disabled'}</div>
                  </div>
                  <div className="shrink-0 text-right">
                    <div className="text-[12px] font-black text-white">${money(a.balance)}</div>
                    <div className="text-[9px] text-emerald-400/90">${money(a.commissionLifetime)} comm.</div>
                  </div>
                </button>
              ))}
            </div>
          )}

          {tab === 'MESSAGES' && (
            <div className="space-y-3">
              <Card>
                <div className="mb-2 flex items-center justify-between">
                  <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-zinc-500"><MessageSquare className="h-3 w-3" /> Agent chats</div>
                  <span className="text-[9px] text-zinc-600">{agents.length} agent{agents.length === 1 ? '' : 's'}</span>
                </div>
                {agents.length === 0 ? (
                  <p className="py-6 text-center text-[11px] text-zinc-600">No agents yet. Create one first.</p>
                ) : (
                  <div className="divide-y divide-zinc-800/70">
                    {[...agents]
                      .sort((a, b) => (threads.find((t) => t.agentId === b.id)?.lastAt || 0) - (threads.find((t) => t.agentId === a.id)?.lastAt || 0))
                      .map((a) => {
                        const t = threads.find((x) => x.agentId === a.id);
                        return (
                          <button key={a.id} onClick={() => setChatAgent(a)} className="flex w-full items-center gap-2.5 py-2.5 text-left">
                            <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl text-[11px] font-black ${a.isActive ? 'bg-cyan-500/15 text-cyan-300' : 'bg-zinc-800 text-zinc-500'}`}>{(a.name || a.id).slice(0, 1).toUpperCase()}</div>
                            <div className="min-w-0 flex-1">
                              <div className="truncate text-[11px] font-bold text-white">{a.name || a.id}</div>
                              <div className="truncate text-[9.5px] text-zinc-500">{t ? (t.lastSender === 'MANAGEMENT' ? 'You: ' : '') + t.lastText : 'Tap to start a chat'}</div>
                            </div>
                            <div className="shrink-0 text-right">
                              {t ? <div className="text-[8.5px] text-zinc-600">{timeAgo(t.lastAt)}</div> : null}
                              {t && t.unread > 0 ? <div className="mt-0.5 inline-flex min-w-4 items-center justify-center rounded-full bg-cyan-500 px-1 text-[9px] font-black text-zinc-950">{t.unread > 9 ? '9+' : t.unread}</div> : null}
                            </div>
                          </button>
                        );
                      })}
                  </div>
                )}
              </Card>
              <p className="px-1 text-center text-[9px] leading-relaxed text-zinc-600">You can chat only with agents created under your management. IDs only — no user names or emails.</p>
            </div>
          )}

          {tab === 'CONFIG' && (
            <div className="space-y-3">
              <Card>
                <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-zinc-500"><Settings2 className="h-3 w-3" /> Agent network configuration</div>
                <div className="mt-3 space-y-3">
                  <Field label="User → Agent fee (%)" hint="Charged to the USER on top of the amount they send.">
                    <input className={inputCls} inputMode="decimal" type="number" step="0.01" value={settings.feePercentOnUserSend} onChange={(e) => setSettings({ ...settings, feePercentOnUserSend: Number(e.target.value) })} />
                  </Field>
                  <Field label="Agent commission on receive (%)" hint="Credited to the agent by the platform.">
                    <input className={inputCls} inputMode="decimal" type="number" step="0.01" value={settings.commissionPercentOnReceive} onChange={(e) => setSettings({ ...settings, commissionPercentOnReceive: Number(e.target.value) })} />
                  </Field>
                  <Field label="Agent commission on send (%)" hint="Credited to the agent by the platform.">
                    <input className={inputCls} inputMode="decimal" type="number" step="0.01" value={settings.commissionPercentOnSend} onChange={(e) => setSettings({ ...settings, commissionPercentOnSend: Number(e.target.value) })} />
                  </Field>
                  <div className="grid grid-cols-2 gap-2">
                    <Field label="Min user payment"><input className={inputCls} inputMode="decimal" type="number" value={settings.minUserSend} onChange={(e) => setSettings({ ...settings, minUserSend: Number(e.target.value) })} /></Field>
                    <Field label="Max user payment"><input className={inputCls} inputMode="decimal" type="number" value={settings.maxUserSend} onChange={(e) => setSettings({ ...settings, maxUserSend: Number(e.target.value) })} /></Field>
                  </div>
                  <div className="flex items-center justify-between rounded-2xl border border-zinc-800 bg-zinc-950 px-3 py-2.5">
                    <div>
                      <div className="text-[11px] font-bold text-white">Agent payments enabled</div>
                      <div className="text-[9px] text-zinc-500">Off = no new user → agent payments</div>
                    </div>
                    <button onClick={() => setSettings({ ...settings, enabled: !settings.enabled })} className={`h-7 w-12 rounded-full transition ${settings.enabled ? 'bg-emerald-500' : 'bg-zinc-700'}`}>
                      <span className={`block h-5 w-5 translate-y-[-0.5px] rounded-full bg-white transition ${settings.enabled ? 'translate-x-6' : 'translate-x-1'}`} />
                    </button>
                  </div>
                  <div className="flex items-center justify-between rounded-2xl border border-zinc-800 bg-zinc-950 px-3 py-2.5">
                    <div>
                      <div className="text-[11px] font-bold text-white">Agent boost</div>
                      <div className="text-[9px] text-zinc-500">Owner rule: only user accounts can boost</div>
                    </div>
                    <span className="rounded-full border border-zinc-700 px-2 py-1 text-[9px] font-bold text-zinc-400">Users only</span>
                  </div>
                  <button onClick={() => void saveConfig({})} disabled={busyCfg} className="flex h-11 w-full items-center justify-center gap-2 rounded-2xl bg-cyan-500 text-xs font-black text-zinc-950 disabled:opacity-60">
                    <Save className="h-4 w-4" /> {busyCfg ? 'Saving…' : 'Save configuration'}
                  </button>
                </div>
              </Card>
              <Card>
                <div className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">How it works</div>
                <ul className="mt-2 space-y-1.5 text-[10px] leading-relaxed text-zinc-400">
                  <li>• User pays an agent: user is debited amount + fee; agent receives the full amount plus receive commission.</li>
                  <li>• Agent pays a user: agent is debited the amount; the user receives the full amount; agent earns send commission.</li>
                  <li>• Lifetime commission = total of all commission credits on the agent account.</li>
                </ul>
              </Card>
            </div>
          )}

          {tab === 'HISTORY' && (
            <div className="space-y-3">
            <Card>
              <div className="mb-2 text-[10px] font-bold uppercase tracking-wider text-zinc-500">My wallet movements</div>
              {wallet.length === 0 ? (
                <p className="py-4 text-center text-[11px] text-zinc-600">No wallet movements yet.</p>
              ) : (
                <div className="divide-y divide-zinc-800/70">
                  {wallet.map((r) => {
                    const credit = ['ADMIN_CREDIT', 'AGENT_COLLECT'].includes(r.type);
                    return (
                      <div key={r.id} className="flex items-start justify-between py-2.5">
                        <div className="min-w-0">
                          <div className="truncate text-[11px] font-semibold text-white">{r.type.replaceAll('_', ' ')}</div>
                          <div className="truncate text-[9px] text-zinc-500">{r.agentId ? `${r.agentId} · ` : ''}{timeAgo(r.at)}{r.note ? ` · ${r.note}` : ''}</div>
                        </div>
                        <div className="shrink-0 text-right">
                          <div className={`text-[11px] font-black ${credit ? 'text-emerald-400' : 'text-amber-400'}`}>{credit ? '+' : '−'}${money(r.amount)}</div>
                          <div className="text-[9px] text-zinc-500">bal ${money(r.balanceAfter)}</div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </Card>
            <Card>
              <div className="mb-2 text-[10px] font-bold uppercase tracking-wider text-zinc-500">Network ledger</div>
              {ledger.length === 0 ? (
                <p className="py-6 text-center text-[11px] text-zinc-600">No movements yet.</p>
              ) : (
                <div className="divide-y divide-zinc-800/70">
                  {ledger.map((r) => {
                    const credit = ['USER_TO_AGENT', 'MGMT_CREDIT', 'ADMIN_CREDIT', 'OPENING_BALANCE'].includes(r.type);
                    return (
                      <div key={r.id} className="flex items-start justify-between py-2.5">
                        <div className="min-w-0">
                          <div className="truncate text-[11px] font-semibold text-white">{r.type.replaceAll('_', ' ')}</div>
                          <div className="truncate text-[9px] text-zinc-500">{r.agentId}{r.userId ? ` · user #${r.userId}` : ''} · {timeAgo(r.at)}</div>
                        </div>
                        <div className="shrink-0 text-right">
                          <div className={`text-[11px] font-black ${credit ? 'text-emerald-400' : 'text-amber-400'}`}>${money(r.amount)}</div>
                          {r.fee > 0 ? <div className="text-[9px] text-zinc-500">fee {money(r.fee)}</div> : null}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </Card>
            </div>
          )}

          {tab === 'PROFILE' && (
            <div className="space-y-3">
              <Card>
                <div className="flex items-center gap-3">
                  <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-cyan-500/15 text-lg font-black text-cyan-300">{(mgr.name || mgr.id).slice(0, 1).toUpperCase()}</div>
                  <div className="min-w-0">
                    <div className="truncate text-sm font-black text-white">{mgr.name || mgr.id}</div>
                    <div className="truncate text-[11px] text-zinc-500">Management · {mgr.id}</div>
                  </div>
                </div>
                <div className="mt-3 space-y-1.5 text-[11px]">
                  <div className="flex justify-between"><span className="text-zinc-500">Email</span><span className="font-semibold text-zinc-200">{mgr.email}</span></div>
                  <div className="flex justify-between"><span className="text-zinc-500">My wallet</span><span className="font-black text-cyan-300">${money(balance)}</span></div>
                  <div className="flex justify-between"><span className="text-zinc-500">My agents</span><span className="font-semibold text-zinc-200">{agents.length}</span></div>
                  <div className="flex justify-between"><span className="text-zinc-500">Total agent float</span><span className="font-black text-white">${money(stats?.totalAgentBalance || 0)}</span></div>
                </div>
              </Card>
              <button onClick={() => void copy(mgr.id)} className="flex h-11 w-full items-center justify-center gap-2 rounded-2xl border border-zinc-800 bg-zinc-900 text-[11px] font-bold text-zinc-300"><Copy className="h-3.5 w-3.5" /> Copy my management ID</button>
              <button onClick={logout} className="flex h-12 w-full items-center justify-center gap-2 rounded-2xl border border-red-500/30 bg-red-500/10 text-sm font-bold text-red-300">
                <LogOut className="h-4 w-4" /> Sign out
              </button>
              <p className="pb-2 text-center text-[9px] leading-relaxed text-zinc-600">BoostPay Management · mobile only · only the latest signed-in device stays active</p>
            </div>
          )}
        </main>

        <nav className="safe-pb fixed inset-x-0 bottom-0 z-30 mx-auto w-full max-w-[430px] border-t border-zinc-800 bg-zinc-950/97 backdrop-blur">
          <div className="flex items-stretch justify-between px-1 py-1.5">
            {tabs.map((t) => {
              const Icon = t.icon;
              const active = tab === t.id;
              return (
                <button key={t.id} onClick={() => setTab(t.id)} className={`relative flex flex-1 flex-col items-center gap-1 rounded-xl py-1.5 transition ${active ? 'text-cyan-400' : 'text-zinc-500'}`}>
                  <Icon className="h-5 w-5" />
                  {t.id === 'MESSAGES' && msgUnread > 0 ? (
                    <span className="absolute right-1/2 top-0.5 -mr-4 flex h-4 min-w-4 items-center justify-center rounded-full bg-cyan-500 px-1 text-[9px] font-black text-zinc-950">{msgUnread > 9 ? '9+' : msgUnread}</span>
                  ) : null}
                  <span className="text-[9px] font-bold tracking-wide">{t.label}</span>
                </button>
              );
            })}
          </div>
        </nav>
      </div>

      {selected ? (
        <AgentSheet
          agent={selected}
          mgmtBalance={balance}
          onClose={() => setSelected(null)}
          toast={toast}
          onChanged={() => { void loadAll(); }}
        />
      ) : null}
      {chatAgent ? <ChatSheet agent={chatAgent} onClose={() => setChatAgent(null)} onRead={() => { void loadAll(); }} toast={toast} /> : null}
      {creating ? <CreateAgentSheet mgmtBalance={balance} onClose={() => setCreating(false)} toast={toast} onCreated={() => { void loadAll(); }} /> : null}
    </div>
  );
}
