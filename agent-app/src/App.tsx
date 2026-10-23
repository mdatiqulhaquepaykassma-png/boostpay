import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowDownLeft, ArrowUpRight, BadgeCheck, Banknote, Check, ChevronRight, CircleDollarSign,
  Copy, History, Home, LogOut, Lock, Send, Sparkles, User, Wallet, X, Zap
} from 'lucide-react';

/* ── API client ─────────────────────────────────────────────────────────── */
const TOKEN_KEY = 'bpa_token_v1';
const AGENT_KEY = 'bpa_agent_v1';

type Agent = {
  id: string; name: string; email: string; balance: number; commissionLifetime: number;
  sentTotal: number; receivedTotal: number; isActive: boolean; createdAt: number;
};
type Settings = {
  feePercentOnUserSend: number; commissionPercentOnReceive: number;
  commissionPercentOnSend: number; minUserSend: number; maxUserSend: number;
};
type LedgerRow = {
  id: string; at: number; type: string; amount: number; fee: number; commission: number;
  balanceAfter: number; userId?: string; note?: string; actor?: string;
};

const money = (n: number) => (Number.isFinite(Number(n)) ? Number(n) : 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const timeAgo = (ts: number) => {
  const d = Math.max(0, Date.now() - ts) / 1000;
  if (d < 60) return 'just now';
  if (d < 3600) return `${Math.floor(d / 60)}m ago`;
  if (d < 86400) return `${Math.floor(d / 3600)}h ago`;
  return `${Math.floor(d / 86400)}d ago`;
};

class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) { super(message); this.status = status; }
}

async function api<T = any>(path: string, opts: { method?: string; body?: any } = {}): Promise<T> {
  const token = localStorage.getItem(TOKEN_KEY) || '';
  const res = await fetch(path, {
    method: opts.method || 'GET',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: opts.body ? JSON.stringify(opts.body) : undefined
  });
  let data: any = null;
  try { data = await res.json(); } catch { /* empty body */ }
  if (res.status === 401) {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(AGENT_KEY);
    window.dispatchEvent(new Event('bpa:signed-out'));
    throw new ApiError(data?.error || 'Session expired. Please sign in again.', 401);
  }
  if (!res.ok) throw new ApiError(data?.error || `Request failed (${res.status})`, res.status);
  return data as T;
}

/* ── small UI atoms ─────────────────────────────────────────────────────── */
const Card: React.FC<{ children: React.ReactNode; className?: string }> = ({ children, className = '' }) => (
  <div className={`rounded-3xl border border-zinc-800/90 bg-zinc-900/60 p-4 ${className}`}>{children}</div>
);

const Field: React.FC<{ label: string; children: React.ReactNode; hint?: string }> = ({ label, children, hint }) => (
  <label className="block">
    <span className="mb-1.5 block text-[10px] font-bold uppercase tracking-wider text-zinc-400">{label}</span>
    {children}
    {hint ? <span className="mt-1 block text-[10px] text-zinc-500">{hint}</span> : null}
  </label>
);

const inputCls = 'w-full rounded-2xl border border-zinc-800 bg-zinc-950 px-4 py-3 text-sm text-white placeholder-zinc-600 outline-none focus:border-amber-500/70';

const Toast: React.FC<{ toast: { type: 'ok' | 'err'; text: string } | null; onClose: () => void }> = ({ toast, onClose }) => {
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(onClose, 3200);
    return () => clearTimeout(t);
  }, [toast, onClose]);
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
const LoginScreen: React.FC<{ onDone: (agent: Agent) => void; toast: (t: { type: 'ok' | 'err'; text: string }) => void }> = ({ onDone, toast }) => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const res = await api<{ token: string; agent: Agent }>('/api/agent/login', { method: 'POST', body: { email: email.trim(), password } });
      localStorage.setItem(TOKEN_KEY, res.token);
      localStorage.setItem(AGENT_KEY, JSON.stringify(res.agent));
      toast({ type: 'ok', text: `Welcome back, ${res.agent.name || res.agent.id}` });
      onDone(res.agent);
    } catch (err: any) {
      setError(err?.message || 'Sign in failed.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-screen flex-col justify-center px-5">
      <div className="mx-auto w-full max-w-[430px]">
        <div className="mb-8 flex flex-col items-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-3xl bg-amber-500 shadow-lg shadow-amber-500/25">
            <Zap className="h-8 w-8 text-zinc-950" />
          </div>
          <h1 className="mt-4 text-xl font-black tracking-tight text-white">BoostPay Agent</h1>
          <p className="mt-1 text-[11px] font-medium text-zinc-500">Agent console — mobile only</p>
        </div>
        <form onSubmit={submit} className="space-y-3">
          <Field label="Agent email">
            <input className={inputCls} type="email" autoComplete="email" placeholder="agent@boostpay.online" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </Field>
          <Field label="Password">
            <input className={inputCls} type="password" autoComplete="current-password" placeholder="••••••••" value={password} onChange={(e) => setPassword(e.target.value)} required />
          </Field>
          {error ? <div className="rounded-2xl border border-red-500/40 bg-red-500/10 px-3 py-2 text-[11px] font-semibold text-red-200">{error}</div> : null}
          <button type="submit" disabled={busy} className="mt-2 flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-amber-500 text-sm font-black text-zinc-950 transition active:scale-[0.99] disabled:opacity-60">
            {busy ? 'Signing in…' : 'Sign in'}
            {!busy && <ChevronRight className="h-4 w-4" />}
          </button>
        </form>
        <p className="mt-6 text-center text-[10px] leading-relaxed text-zinc-600">
          Agent accounts are created by BoostPay Management.<br />Only the latest device stays signed in.
        </p>
      </div>
    </div>
  );
};

/* ── home ───────────────────────────────────────────────────────────────── */
const HomeScreen: React.FC<{
  agent: Agent; settings: Settings; platform: any; onCopy: (v: string) => void; onGoto: (t: Tab) => void;
}> = ({ agent, settings, platform, onCopy, onGoto }) => (
  <div className="space-y-3">
    <div className="relative overflow-hidden rounded-3xl border border-amber-500/30 bg-gradient-to-br from-amber-500/20 via-zinc-900 to-zinc-950 p-5">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-bold uppercase tracking-wider text-amber-300/90">Available balance</span>
        <button onClick={() => onCopy(agent.id)} className="flex items-center gap-1 rounded-full border border-zinc-700 bg-zinc-950/70 px-2 py-1 text-[10px] font-mono font-bold text-zinc-300">
          {agent.id} <Copy className="h-3 w-3" />
        </button>
      </div>
      <div className="mt-2 flex items-end gap-1">
        <span className="text-3xl font-black tracking-tight text-white">${money(agent.balance)}</span>
      </div>
      <div className="mt-4 flex gap-2">
        <button onClick={() => onGoto('SEND')} className="flex h-10 flex-1 items-center justify-center gap-1.5 rounded-2xl bg-zinc-100 text-[11px] font-black text-zinc-950 active:scale-[0.99]">
          <Send className="h-3.5 w-3.5" /> Send to user
        </button>
        <button onClick={() => onGoto('RECEIVE')} className="flex h-10 flex-1 items-center justify-center gap-1.5 rounded-2xl border border-zinc-700 bg-zinc-900 text-[11px] font-bold text-zinc-200 active:scale-[0.99]">
          <ArrowDownLeft className="h-3.5 w-3.5 text-emerald-400" /> Receive
        </button>
      </div>
    </div>

    <Card className="border-emerald-500/25 bg-emerald-500/[0.07]">
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-emerald-300">
            <Sparkles className="h-3 w-3" /> Lifetime commission
          </div>
          <div className="mt-1 text-2xl font-black text-white">${money(agent.commissionLifetime)}</div>
        </div>
        <div className="rounded-2xl bg-emerald-500/15 p-3"><CircleDollarSign className="h-6 w-6 text-emerald-400" /></div>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2 text-[10px] font-semibold">
        <div className="rounded-xl bg-zinc-950/60 px-2.5 py-2">
          <div className="text-zinc-500">Receive commission</div>
          <div className="text-white">{settings.commissionPercentOnReceive}%</div>
        </div>
        <div className="rounded-xl bg-zinc-950/60 px-2.5 py-2">
          <div className="text-zinc-500">Send commission</div>
          <div className="text-white">{settings.commissionPercentOnSend}%</div>
        </div>
      </div>
    </Card>

    <div className="grid grid-cols-2 gap-3">
      <Card>
        <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-zinc-500"><ArrowDownLeft className="h-3 w-3 text-emerald-400" /> Received</div>
        <div className="mt-1.5 text-lg font-black text-white">${money(agent.receivedTotal)}</div>
      </Card>
      <Card>
        <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-zinc-500"><ArrowUpRight className="h-3 w-3 text-amber-400" /> Sent</div>
        <div className="mt-1.5 text-lg font-black text-white">${money(agent.sentTotal)}</div>
      </Card>
    </div>

    <Card>
      <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-wider text-zinc-400"><Lock className="h-3 w-3" /> Boost</div>
      <p className="mt-1.5 text-[11px] leading-relaxed text-zinc-500">
        Boost is available for <span className="font-semibold text-zinc-300">user accounts only</span>. Agent and management accounts cannot start a boost.
      </p>
    </Card>

    {platform ? (
      <Card>
        <div className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">Network</div>
        <div className="mt-2 space-y-1.5 text-[11px]">
          <div className="flex justify-between"><span className="text-zinc-500">Active agents</span><span className="font-semibold text-white">{platform.agents}</span></div>
          <div className="flex justify-between"><span className="text-zinc-500">Volume in (all agents)</span><span className="font-semibold text-white">${money(platform.volumeIn)}</span></div>
          <div className="flex justify-between"><span className="text-zinc-500">Volume out (all agents)</span><span className="font-semibold text-white">${money(platform.volumeOut)}</span></div>
        </div>
      </Card>
    ) : null}
  </div>
);

/* ── send to user ───────────────────────────────────────────────────────── */
const SendScreen: React.FC<{
  agent: Agent; settings: Settings; onSent: (agent: Agent) => void; toast: (t: any) => void;
}> = ({ agent, settings, onSent, toast }) => {
  const [userId, setUserId] = useState('');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [receipt, setReceipt] = useState<{ amount: number; commission: number; userId: string; txId: string } | null>(null);

  const numAmount = Number(amount || 0);
  const commission = useMemo(() => Math.round((numAmount * settings.commissionPercentOnSend / 100) * 100) / 100, [numAmount, settings.commissionPercentOnSend]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!/^\d+(\.\d{1,2})?$/.test(amount.trim())) { setError('Enter an amount with at most 2 decimals.'); return; }
    setBusy(true);
    try {
      const res = await api<any>('/api/agent/send', { method: 'POST', body: { userId: userId.trim(), amount: amount.trim(), note: note.trim(), idempotencyKey: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}` } });
      setReceipt({ amount: res.amount, commission: res.commission, userId: res.user?.id || userId.trim(), txId: res.transaction?.id || '' });
      onSent(res.agent);
      toast({ type: 'ok', text: `$${money(res.amount)} sent to user #${res.user?.id || userId}` });
      setAmount(''); setNote('');
    } catch (err: any) {
      setError(err?.message || 'Transfer failed.');
    } finally {
      setBusy(false);
    }
  };

  if (receipt) {
    return (
      <div className="space-y-3">
        <Card className="border-emerald-500/30 bg-emerald-500/[0.07] text-center">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-emerald-500/20"><Check className="h-7 w-7 text-emerald-400" /></div>
          <div className="mt-3 text-lg font-black text-white">Sent successfully</div>
          <div className="mt-1 text-3xl font-black text-emerald-300">${money(receipt.amount)}</div>
          <div className="mt-1 text-[11px] text-zinc-400">to user #{receipt.userId}</div>
          <div className="mt-4 space-y-1.5 rounded-2xl bg-zinc-950/60 p-3 text-left text-[11px]">
            <div className="flex justify-between"><span className="text-zinc-500">Commission earned ({settings.commissionPercentOnSend}%)</span><span className="font-bold text-emerald-300">+${money(receipt.commission)}</span></div>
            <div className="flex justify-between"><span className="text-zinc-500">Reference</span><span className="font-mono text-zinc-300">{receipt.txId}</span></div>
            <div className="flex justify-between"><span className="text-zinc-500">Agent balance</span><span className="font-bold text-white">${money(agent.balance)}</span></div>
          </div>
        </Card>
        <button onClick={() => setReceipt(null)} className="h-12 w-full rounded-2xl bg-amber-500 text-sm font-black text-zinc-950 active:scale-[0.99]">Send another</button>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <Card>
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">Agent balance</span>
          <span className="text-sm font-black text-white">${money(agent.balance)}</span>
        </div>
      </Card>
      <Field label="Recipient User ID" hint="Only numeric User IDs — names and emails are never shown.">
        <input className={inputCls} inputMode="numeric" placeholder="e.g. 100000" value={userId} onChange={(e) => setUserId(e.target.value)} required />
      </Field>
      <Field label="Amount (USD)">
        <input className={inputCls} inputMode="decimal" placeholder="0.00" value={amount} onChange={(e) => setAmount(e.target.value)} required />
      </Field>
      <Field label="Note (optional)">
        <input className={inputCls} placeholder="Cash handover, bank deposit…" value={note} onChange={(e) => setNote(e.target.value)} />
      </Field>
      <div className="rounded-2xl border border-zinc-800 bg-zinc-950/70 p-3 text-[11px]">
        <div className="flex justify-between py-0.5"><span className="text-zinc-500">You send</span><span className="font-semibold text-white">${money(numAmount)}</span></div>
        <div className="flex justify-between py-0.5"><span className="text-zinc-500">Commission ({settings.commissionPercentOnSend}%)</span><span className="font-semibold text-emerald-400">+${money(commission)}</span></div>
        <div className="mt-1 flex justify-between border-t border-zinc-800 pt-1.5"><span className="text-zinc-400">Balance after</span><span className="font-black text-white">${money(agent.balance - numAmount + commission)}</span></div>
      </div>
      {error ? <div className="rounded-2xl border border-red-500/40 bg-red-500/10 px-3 py-2 text-[11px] font-semibold text-red-200">{error}</div> : null}
      <button type="submit" disabled={busy} className="flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-amber-500 text-sm font-black text-zinc-950 active:scale-[0.99] disabled:opacity-60">
        <Send className="h-4 w-4" /> {busy ? 'Sending…' : 'Send money to user'}
      </button>
    </form>
  );
};

/* ── receive ────────────────────────────────────────────────────────────── */
const ReceiveScreen: React.FC<{ agent: Agent; settings: Settings; onCopy: (v: string) => void; history: LedgerRow[] }> = ({ agent, settings, onCopy, history }) => {
  const incoming = history.filter((h) => h.type === 'USER_TO_AGENT');
  return (
    <div className="space-y-3">
      <Card className="border-emerald-500/25 bg-emerald-500/[0.06] text-center">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-500/20"><ArrowDownLeft className="h-6 w-6 text-emerald-400" /></div>
        <div className="mt-2 text-sm font-black text-white">Receive from users</div>
        <p className="mt-1 text-[11px] leading-relaxed text-zinc-400">Share your Agent ID. Users pay you from the BoostPay app — the user pays a {settings.feePercentOnUserSend}% fee and you earn {settings.commissionPercentOnReceive}% commission.</p>
        <button onClick={() => onCopy(agent.id)} className="mt-3 inline-flex items-center gap-2 rounded-2xl border border-zinc-700 bg-zinc-950 px-4 py-2.5 font-mono text-sm font-bold text-white">
          {agent.id} <Copy className="h-3.5 w-3.5 text-zinc-400" />
        </button>
        <div className="mt-3 grid grid-cols-2 gap-2 text-[10px] font-semibold">
          <div className="rounded-xl bg-zinc-950/70 px-2 py-2"><div className="text-zinc-500">User fee</div><div className="text-white">{settings.feePercentOnUserSend}%</div></div>
          <div className="rounded-xl bg-zinc-950/70 px-2 py-2"><div className="text-zinc-500">Your commission</div><div className="text-emerald-300">{settings.commissionPercentOnReceive}%</div></div>
        </div>
      </Card>
      <Card>
        <div className="mb-2 flex items-center justify-between">
          <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">Recent incoming</span>
          <span className="text-[10px] font-bold text-emerald-400">${money(agent.receivedTotal)} total</span>
        </div>
        {incoming.length === 0 ? (
          <p className="py-4 text-center text-[11px] text-zinc-600">No incoming payments yet.</p>
        ) : (
          <div className="divide-y divide-zinc-800/70">
            {incoming.slice(0, 12).map((h) => (
              <div key={h.id} className="flex items-center justify-between py-2">
                <div>
                  <div className="text-[11px] font-semibold text-white">User #{h.userId}</div>
                  <div className="text-[9px] text-zinc-500">{timeAgo(h.at)}</div>
                </div>
                <div className="text-right">
                  <div className="text-[11px] font-black text-emerald-400">+${money(h.amount)}</div>
                  {h.commission > 0 ? <div className="text-[9px] text-zinc-500">+{money(h.commission)} comm.</div> : null}
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
};

/* ── history ────────────────────────────────────────────────────────────── */
const labelFor = (t: string) => ({
  USER_TO_AGENT: 'Received from user',
  AGENT_TO_USER: 'Sent to user',
  MGMT_CREDIT: 'Funded by management',
  MGMT_DEBIT: 'Collected by management',
  ADMIN_CREDIT: 'Admin credit',
  ADMIN_DEBIT: 'Admin debit',
  OPENING_BALANCE: 'Opening balance'
} as Record<string, string>)[t] || t;

const HistoryScreen: React.FC<{ rows: LedgerRow[]; loading: boolean }> = ({ rows, loading }) => (
  <div className="space-y-3">
    <Card>
      <div className="mb-2 text-[10px] font-bold uppercase tracking-wider text-zinc-500">Transaction history</div>
      {loading ? (
        <p className="py-6 text-center text-[11px] text-zinc-600">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="py-6 text-center text-[11px] text-zinc-600">No transactions yet.</p>
      ) : (
        <div className="divide-y divide-zinc-800/70">
          {rows.map((r) => {
            const credit = ['USER_TO_AGENT', 'MGMT_CREDIT', 'ADMIN_CREDIT', 'OPENING_BALANCE'].includes(r.type);
            return (
              <div key={r.id} className="flex items-start justify-between gap-2 py-2.5">
                <div className="flex min-w-0 items-start gap-2">
                  <div className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-xl ${credit ? 'bg-emerald-500/15 text-emerald-400' : 'bg-amber-500/15 text-amber-400'}`}>
                    {credit ? <ArrowDownLeft className="h-3.5 w-3.5" /> : <ArrowUpRight className="h-3.5 w-3.5" />}
                  </div>
                  <div className="min-w-0">
                    <div className="truncate text-[11px] font-semibold text-white">{labelFor(r.type)}</div>
                    <div className="truncate text-[9px] text-zinc-500">{r.userId ? `User #${r.userId} · ` : ''}{timeAgo(r.at)}</div>
                    {r.fee > 0 ? <div className="text-[9px] text-zinc-600">User fee ${money(r.fee)}</div> : null}
                  </div>
                </div>
                <div className="shrink-0 text-right">
                  <div className={`text-[11px] font-black ${credit ? 'text-emerald-400' : 'text-amber-400'}`}>{credit ? '+' : '-'}${money(r.amount)}</div>
                  <div className="text-[9px] text-zinc-500">bal ${money(r.balanceAfter)}</div>
                  {r.commission > 0 ? <div className="text-[9px] font-semibold text-emerald-400/90">+{money(r.commission)} comm.</div> : null}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </Card>
  </div>
);

/* ── profile ────────────────────────────────────────────────────────────── */
const ProfileScreen: React.FC<{ agent: Agent; settings: Settings; onLogout: () => void }> = ({ agent, settings, onLogout }) => (
  <div className="space-y-3">
    <Card>
      <div className="flex items-center gap-3">
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-amber-500/15 text-lg font-black text-amber-400">{(agent.name || agent.id).slice(0, 1).toUpperCase()}</div>
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 truncate text-sm font-black text-white">{agent.name || agent.id} <BadgeCheck className="h-3.5 w-3.5 text-emerald-400" /></div>
          <div className="truncate text-[11px] text-zinc-500">Agent · {agent.id}</div>
        </div>
      </div>
      <div className="mt-3 space-y-1.5 text-[11px]">
        <div className="flex justify-between"><span className="text-zinc-500">Email</span><span className="font-semibold text-zinc-200">{agent.email}</span></div>
        <div className="flex justify-between"><span className="text-zinc-500">Balance</span><span className="font-black text-white">${money(agent.balance)}</span></div>
        <div className="flex justify-between"><span className="text-zinc-500">Lifetime commission</span><span className="font-black text-emerald-400">${money(agent.commissionLifetime)}</span></div>
        <div className="flex justify-between"><span className="text-zinc-500">User fee (paid by user)</span><span className="font-semibold text-zinc-200">{settings.feePercentOnUserSend}%</span></div>
        <div className="flex justify-between"><span className="text-zinc-500">Commission on receive</span><span className="font-semibold text-zinc-200">{settings.commissionPercentOnReceive}%</span></div>
        <div className="flex justify-between"><span className="text-zinc-500">Commission on send</span><span className="font-semibold text-zinc-200">{settings.commissionPercentOnSend}%</span></div>
      </div>
    </Card>
    <button onClick={onLogout} className="flex h-12 w-full items-center justify-center gap-2 rounded-2xl border border-red-500/30 bg-red-500/10 text-sm font-bold text-red-300 active:scale-[0.99]">
      <LogOut className="h-4 w-4" /> Sign out
    </button>
    <p className="pb-2 text-center text-[9px] leading-relaxed text-zinc-600">BoostPay Agent · mobile only · only the latest signed-in device stays active</p>
  </div>
);

/* ── app shell ──────────────────────────────────────────────────────────── */
type Tab = 'HOME' | 'SEND' | 'RECEIVE' | 'HISTORY' | 'PROFILE';

export default function App() {
  const [agent, setAgent] = useState<Agent | null>(() => {
    try { const raw = localStorage.getItem(AGENT_KEY); return raw ? JSON.parse(raw) : null; } catch { return null; }
  });
  const [token, setToken] = useState<string>(() => localStorage.getItem(TOKEN_KEY) || '');
  const [settings, setSettings] = useState<Settings>({ feePercentOnUserSend: 2, commissionPercentOnReceive: 1, commissionPercentOnSend: 1, minUserSend: 1, maxUserSend: 100000 });
  const [platform, setPlatform] = useState<any>(null);
  const [history, setHistory] = useState<LedgerRow[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [tab, setTab] = useState<Tab>('HOME');
  const [toastState, setToastState] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const toast = useCallback((t: { type: 'ok' | 'err'; text: string }) => setToastState(t), []);

  const refresh = useCallback(async () => {
    if (!localStorage.getItem(TOKEN_KEY)) return;
    try {
      const res = await api<any>('/api/agent/me');
      setAgent(res.agent);
      localStorage.setItem(AGENT_KEY, JSON.stringify(res.agent));
      setSettings(res.settings);
      setPlatform(res.platform);
    } catch { /* handled by api() on 401 */ }
  }, []);

  const loadHistory = useCallback(async () => {
    setLoadingHistory(true);
    try {
      const res = await api<any>('/api/agent/history?limit=100');
      setHistory(res.history || []);
    } catch { /* ignore */ } finally { setLoadingHistory(false); }
  }, []);

  useEffect(() => {
    const onSignedOut = () => { setAgent(null); setToken(''); };
    window.addEventListener('bpa:signed-out', onSignedOut);
    return () => window.removeEventListener('bpa:signed-out', onSignedOut);
  }, []);

  useEffect(() => {
    if (!token) return;
    void refresh();
    void loadHistory();
    const iv = window.setInterval(() => { void refresh(); void loadHistory(); }, 20000);
    return () => window.clearInterval(iv);
  }, [token, refresh, loadHistory]);

  useEffect(() => {
    if (!token) return;
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(() => {});
    }
  }, [token]);

  const copy = useCallback(async (v: string) => {
    try { await navigator.clipboard.writeText(v); toast({ type: 'ok', text: `Copied ${v}` }); }
    catch { toast({ type: 'err', text: `Copy failed — ${v}` }); }
  }, [toast]);

  const logout = async () => {
    try { await api('/api/agent/logout', { method: 'POST' }); } catch { /* ignore */ }
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(AGENT_KEY);
    setAgent(null);
    setToken('');
  };

  if (!token || !agent) {
    return (
      <>
        <Toast toast={toastState} onClose={() => setToastState(null)} />
        <LoginScreen
          toast={toast}
          onDone={(a) => { setAgent(a); setToken(localStorage.getItem(TOKEN_KEY) || ''); }}
        />
      </>
    );
  }

  const tabs: Array<{ id: Tab; label: string; icon: any }> = [
    { id: 'HOME', label: 'Home', icon: Home },
    { id: 'SEND', label: 'Send', icon: Send },
    { id: 'RECEIVE', label: 'Receive', icon: ArrowDownLeft },
    { id: 'HISTORY', label: 'History', icon: History },
    { id: 'PROFILE', label: 'Profile', icon: User }
  ];

  return (
    <div className="min-h-screen bg-zinc-950 text-white">
      <Toast toast={toastState} onClose={() => setToastState(null)} />
      <div className="mx-auto flex min-h-screen w-full max-w-[430px] flex-col">
        <header className="safe-pt sticky top-0 z-20 flex items-center justify-between border-b border-zinc-800/70 bg-zinc-950/95 px-4 py-3 backdrop-blur">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-amber-500"><Zap className="h-4 w-4 text-zinc-950" /></div>
            <div>
              <div className="text-[13px] font-black leading-none text-white">BoostPay <span className="text-amber-400">Agent</span></div>
              <div className="mt-0.5 text-[9px] font-medium text-zinc-500">{agent.id} · {agent.name || 'Agent'}</div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1 text-[10px] font-bold text-emerald-300">${money(agent.balance)}</div>
            <button onClick={() => setTab('PROFILE')} className="flex h-8 w-8 items-center justify-center rounded-full border border-zinc-800 bg-zinc-900 text-zinc-400"><Wallet className="h-4 w-4" /></button>
          </div>
        </header>

        <main className="flex-1 px-4 py-4 pb-24">
          {tab === 'HOME' && <HomeScreen agent={agent} settings={settings} platform={platform} onCopy={copy} onGoto={setTab} />}
          {tab === 'SEND' && (
            <SendScreen
              agent={agent}
              settings={settings}
              toast={toast}
              onSent={(a) => { setAgent(a); void loadHistory(); void refresh(); }}
            />
          )}
          {tab === 'RECEIVE' && <ReceiveScreen agent={agent} settings={settings} onCopy={copy} history={history} />}
          {tab === 'HISTORY' && <HistoryScreen rows={history} loading={loadingHistory} />}
          {tab === 'PROFILE' && <ProfileScreen agent={agent} settings={settings} onLogout={logout} />}
        </main>

        <nav className="safe-pb fixed inset-x-0 bottom-0 z-30 mx-auto w-full max-w-[430px] border-t border-zinc-800 bg-zinc-950/97 backdrop-blur">
          <div className="flex items-stretch justify-between px-1 py-1.5">
            {tabs.map((t) => {
              const Icon = t.icon;
              const active = tab === t.id;
              return (
                <button key={t.id} onClick={() => setTab(t.id)} className={`flex flex-1 flex-col items-center gap-1 rounded-xl py-1.5 transition ${active ? 'text-amber-400' : 'text-zinc-500'}`}>
                  <Icon className={`h-4.5 w-4.5 ${active ? 'h-5 w-5' : 'h-5 w-5'}`} />
                  <span className="text-[9px] font-bold tracking-wide">{t.label}</span>
                </button>
              );
            })}
          </div>
        </nav>
      </div>
    </div>
  );
}
