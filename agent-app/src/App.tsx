import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowDownLeft, ArrowUpRight, BadgeCheck, Banknote, Check, ChevronRight, CircleDollarSign,
  Copy, History, Home, Image as ImageIcon, KeyRound, LogOut, Lock, MailCheck, MessageSquare, Mic, Phone,
  Receipt, Search, Send, ShieldCheck, Sparkles, Ticket, User, UserRound, Video, Wallet, X, Zap
} from 'lucide-react';
import { ChatComposer, ChatList, chatDay, ChatMessageLike, ChatSendPayload } from './ChatKit';
import { AgentCallManager, startCallTo } from './CallOverlay';

/* ── API client ─────────────────────────────────────────────────────────── */
const TOKEN_KEY = 'bpa_token_v1';
const AGENT_KEY = 'bpa_agent_v1';

type Agent = {
  id: string; name: string; email: string; balance: number; commissionLifetime: number;
  sentTotal: number; receivedTotal: number; isActive: boolean; createdAt: number;
  emailVerified?: boolean; emailVerifiedAt?: number; ownerManagementId?: string;
};
type Settings = {
  feePercentOnUserSend: number; commissionPercentOnReceive: number;
  commissionPercentOnSend: number; minUserSend: number; maxUserSend: number;
};
type ChatRow = { userId: string; lastText: string; lastAt: number; unread: number; lastSender?: string };
type ChatMsg = ChatMessageLike & { agentId?: string; userId?: string };
type MgmtMsg = ChatMessageLike & { managementId?: string; agentId?: string };
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

/* ── login (same Gmail rule as the user app) ────────────────────────────── */
const gmailLocal = (v: string) => {
  let s = String(v || '').trim().toLowerCase().replace(/\s+/g, '');
  let prev = '';
  while (prev !== s) {
    prev = s;
    s = s.replace(/@gmail\.com$/, '').replace(/\.gmail\.com$/, '').replace(/gmail\.com$/, '')
         .replace(/@gmailcom$/, '').replace(/\.gmailcom$/, '').replace(/gmailcom$/, '');
  }
  return s.split('@')[0].replace(/[@.]+$/g, '').replace(/[^a-z0-9._]/g, '');
};

const LoginScreen: React.FC<{ onDone: (agent: Agent) => void; toast: (t: { type: 'ok' | 'err'; text: string }) => void }> = ({ onDone, toast }) => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [mode, setMode] = useState<'LOGIN' | 'FORGOT' | 'RESET'>('LOGIN');
  const [resetEmail, setResetEmail] = useState('');
  const [resetCode, setResetCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [info, setInfo] = useState('');
  const [showPw, setShowPw] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(''); setInfo('');
    const local = gmailLocal(email);
    if (!local) { setError('Enter your Gmail username (example: agentname → agentname@gmail.com)'); return; }
    setBusy(true);
    try {
      const res = await api<{ token: string; agent: Agent }>('/api/agent/login', { method: 'POST', body: { email: local, password } });
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

  const requestCode = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(''); setInfo('');
    const local = gmailLocal(resetEmail);
    if (!local) { setError('Enter your Gmail username (example: agentname)'); return; }
    setBusy(true);
    try {
      const res: any = await api('/api/agent/forgot-password', { method: 'POST', body: { email: local } });
      setInfo(res?.message || `Reset code sent to ${local}@gmail.com`);
      setMode('RESET');
    } catch (err: any) {
      setError(err?.message || 'Could not send the reset code.');
    } finally { setBusy(false); }
  };

  const submitReset = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(''); setInfo('');
    const local = gmailLocal(resetEmail);
    if (!resetCode.trim()) { setError('Enter the 6-digit code from your Gmail.'); return; }
    if (newPassword.length < 6) { setError('New password must be at least 6 characters.'); return; }
    setBusy(true);
    try {
      await api('/api/agent/reset-password', { method: 'POST', body: { email: local, code: resetCode.trim(), newPassword } });
      toast({ type: 'ok', text: 'Password updated — please sign in.' });
      setEmail(local); setPassword(''); setMode('LOGIN'); setResetCode(''); setNewPassword('');
      setInfo('Password updated. Sign in with your new password.');
    } catch (err: any) {
      setError(err?.message || 'Reset failed.');
    } finally { setBusy(false); }
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

        {mode === 'LOGIN' ? (
          <form onSubmit={submit} className="space-y-3">
            <Field label="Gmail username" hint="Only @gmail.com — type the part before @ (example: agentname)">
              <div className="flex items-center gap-1.5 rounded-2xl border border-zinc-800 bg-zinc-950 px-4 focus-within:border-amber-500/70">
                <input
                  className="min-w-0 flex-1 bg-transparent py-3 text-sm text-white placeholder-zinc-600 outline-none"
                  autoComplete="username" placeholder="agentname" value={email}
                  onChange={(e) => setEmail(gmailLocal(e.target.value))} required
                />
                <span className="shrink-0 text-[12px] font-semibold text-zinc-500">@gmail.com</span>
              </div>
            </Field>
            <Field label="Password">
              <div className="flex items-center gap-1.5 rounded-2xl border border-zinc-800 bg-zinc-950 px-4 focus-within:border-amber-500/70">
                <input
                  className="min-w-0 flex-1 bg-transparent py-3 text-sm text-white placeholder-zinc-600 outline-none"
                  type={showPw ? 'text' : 'password'} autoComplete="current-password" placeholder="••••••••"
                  value={password} onChange={(e) => setPassword(e.target.value)} required
                />
                <button type="button" onClick={() => setShowPw((v) => !v)} className="shrink-0 text-[10px] font-bold text-zinc-500">{showPw ? 'HIDE' : 'SHOW'}</button>
              </div>
            </Field>
            {error ? <div className="rounded-2xl border border-red-500/40 bg-red-500/10 px-3 py-2 text-[11px] font-semibold text-red-200">{error}</div> : null}
            {info ? <div className="rounded-2xl border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-[11px] font-semibold text-emerald-200">{info}</div> : null}
            <button type="submit" disabled={busy} className="mt-2 flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-amber-500 text-sm font-black text-zinc-950 transition active:scale-[0.99] disabled:opacity-60">
              {busy ? 'Signing in…' : 'Sign in'}
              {!busy && <ChevronRight className="h-4 w-4" />}
            </button>
            <button type="button" onClick={() => { setMode('FORGOT'); setResetEmail(email); setError(''); setInfo(''); }} className="w-full text-center text-[11px] font-bold text-amber-400/90">Forgot password?</button>
          </form>
        ) : mode === 'FORGOT' ? (
          <form onSubmit={requestCode} className="space-y-3">
            <Field label="Gmail username" hint="We email a 6-digit reset code to your Gmail.">
              <div className="flex items-center gap-1.5 rounded-2xl border border-zinc-800 bg-zinc-950 px-4 focus-within:border-amber-500/70">
                <input className="min-w-0 flex-1 bg-transparent py-3 text-sm text-white placeholder-zinc-600 outline-none" placeholder="agentname" value={resetEmail} onChange={(e) => setResetEmail(gmailLocal(e.target.value))} required />
                <span className="shrink-0 text-[12px] font-semibold text-zinc-500">@gmail.com</span>
              </div>
            </Field>
            {error ? <div className="rounded-2xl border border-red-500/40 bg-red-500/10 px-3 py-2 text-[11px] font-semibold text-red-200">{error}</div> : null}
            <button type="submit" disabled={busy} className="flex h-12 w-full items-center justify-center rounded-2xl bg-amber-500 text-sm font-black text-zinc-950 disabled:opacity-60">{busy ? 'Sending…' : 'Send reset code'}</button>
            <button type="button" onClick={() => { setMode('LOGIN'); setError(''); }} className="w-full text-center text-[11px] font-bold text-zinc-400">Back to sign in</button>
          </form>
        ) : (
          <form onSubmit={submitReset} className="space-y-3">
            <Field label="6-digit code" hint={`Sent to ${gmailLocal(resetEmail)}@gmail.com — check inbox/spam.`}>
              <input className={inputCls} inputMode="numeric" maxLength={6} placeholder="123456" value={resetCode} onChange={(e) => setResetCode(e.target.value.replace(/[^0-9]/g, '').slice(0, 6))} required />
            </Field>
            <Field label="New password">
              <input className={inputCls} type="password" placeholder="At least 6 characters" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} required />
            </Field>
            {error ? <div className="rounded-2xl border border-red-500/40 bg-red-500/10 px-3 py-2 text-[11px] font-semibold text-red-200">{error}</div> : null}
            <button type="submit" disabled={busy} className="flex h-12 w-full items-center justify-center rounded-2xl bg-amber-500 text-sm font-black text-zinc-950 disabled:opacity-60">{busy ? 'Updating…' : 'Set new password'}</button>
            <button type="button" onClick={() => { setMode('FORGOT'); setError(''); }} className="w-full text-center text-[11px] font-bold text-zinc-400">Resend code</button>
          </form>
        )}

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
const ReceiveScreen: React.FC<{
  agent: Agent; settings: Settings; onCopy: (v: string) => void; history: LedgerRow[];
  toast: (t: { type: 'ok' | 'err'; text: string }) => void; onRedeemed: () => void;
}> = ({ agent, settings, onCopy, history, toast, onRedeemed }) => {
  const incoming = history.filter((h) => h.type === 'USER_TO_AGENT');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [done, setDone] = useState<{ amount: number; commission: number; userId: string } | null>(null);

  const redeem = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(''); setDone(null);
    const clean = code.trim().toLowerCase().replace(/[^a-z0-9]/g, '');
    if (clean.length !== 4) { setErr('Enter the 4-character code from the user (example: h68d).'); return; }
    setBusy(true);
    try {
      const res = await api<any>('/api/agent/redeem', { method: 'POST', body: { code: clean } });
      setDone({ amount: Number(res.amount) || 0, commission: Number(res.commission) || 0, userId: String(res.userId || '') });
      setCode('');
      toast({ type: 'ok', text: `Received $${money(res.amount)} from User #${res.userId}` });
      onRedeemed();
    } catch (e2: any) {
      setErr(e2?.message || 'Could not claim this code.');
    } finally { setBusy(false); }
  };

  return (
    <div className="space-y-3">
      <Card className="border-amber-500/30 bg-amber-500/[0.06]">
        <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-wider text-amber-300"><Ticket className="h-3.5 w-3.5" /> Claim a user payment</div>
        <p className="mt-1.5 text-[11px] leading-relaxed text-zinc-400">
          The user pays you in their app and gets a <b className="text-white">4-character code</b> (letters + digits, e.g. h68d).
          Enter it here — the money lands in your balance only after you claim it. Codes expire in 30 minutes and the user can cancel any time.
        </p>
        <form onSubmit={redeem} className="mt-3 flex items-center gap-2">
          <input
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/[^a-zA-Z0-9]/g, '').slice(0, 4).toLowerCase())}
            placeholder="h68d"
            className="min-w-0 flex-1 rounded-2xl border border-zinc-800 bg-zinc-950 px-4 py-3 text-center font-mono text-lg font-black tracking-[0.35em] text-white placeholder-zinc-700 outline-none focus:border-amber-500/60"
          />
          <button type="submit" disabled={busy || code.length !== 4} className="flex h-12 shrink-0 items-center justify-center rounded-2xl bg-amber-500 px-4 text-xs font-black text-zinc-950 disabled:opacity-40">
            {busy ? '…' : 'Receive'}
          </button>
        </form>
        {err ? <div className="mt-2 rounded-xl border border-red-500/40 bg-red-500/10 px-3 py-2 text-[10.5px] font-semibold text-red-200">{err}</div> : null}
        {done ? (
          <div className="mt-2 rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-[10.5px] font-semibold text-emerald-200">
            Received ${money(done.amount)} from User #{done.userId}{done.commission > 0 ? ` (+$${money(done.commission)} commission)` : ''} — new balance ${money(agent.balance)}.
          </div>
        ) : null}
      </Card>
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

/* ── messages (user ↔ agent) ────────────────────────────────────────────── */
const clockTime = (ts: number) => new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
const dayTime = (ts: number) => {
  const d = new Date(ts);
  if (d.toDateString() === new Date().toDateString()) return clockTime(ts);
  return `${d.toLocaleDateString([], { day: '2-digit', month: 'short' })} · ${clockTime(ts)}`;
};

const ChatsScreen: React.FC<{
  chats: ChatRow[]; loading: boolean; toast: (t: { type: 'ok' | 'err'; text: string }) => void; onRead: () => void;
  managementId?: string; managementUnread?: number; onManagementRead?: () => void;
}> = ({ chats, loading, toast, onRead, managementId, managementUnread = 0, onManagementRead }) => {
  const [openUser, setOpenUser] = useState<string | null>(null);
  const [view, setView] = useState<'LIST' | 'MANAGEMENT'>('LIST');
  const [q, setQ] = useState('');
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [peerTyping, setPeerTyping] = useState(false);
  const [threadErr, setThreadErr] = useState('');
  const [threadLoading, setThreadLoading] = useState(false);
  const listRef = useRef<HTMLDivElement | null>(null);

  const [mgmtMsgs, setMgmtMsgs] = useState<MgmtMsg[]>([]);
  const [mgmtTyping, setMgmtTyping] = useState(false);
  const [mgmtErr, setMgmtErr] = useState('');
  const [mgmtId, setMgmtId] = useState(managementId || '');
  const [mgmtLoading, setMgmtLoading] = useState(false);
  // Refs keep the polling effects from re-subscribing on every parent render
  // (previously that produced a self-sustaining request loop).
  const onReadRef = useRef(onRead);
  const onMgmtReadRef = useRef(onManagementRead);
  useEffect(() => { onReadRef.current = onRead; }, [onRead]);
  useEffect(() => { onMgmtReadRef.current = onManagementRead; }, [onManagementRead]);

  /* ── agent ↔ user ───────────────────────────────────────────────────── */
  const loadThread = useCallback(async (userId: string, quiet = false) => {
    if (!quiet) setThreadLoading(true);
    try {
      const res = await api<any>(`/api/agent/chat?userId=${encodeURIComponent(userId)}`);
      setMessages(res.messages || []);
      setPeerTyping(!!res.peerTyping);
      setThreadErr('');
      try { onReadRef.current(); } catch { /* ignore */ }
    } catch (err: any) { if (!quiet) setThreadErr(err?.message || 'Could not open the conversation.'); }
    finally { if (!quiet) setThreadLoading(false); }
  }, []);

  useEffect(() => {
    if (!openUser) return;
    setMessages([]); setThreadErr(''); setPeerTyping(false);
    void loadThread(openUser);
    const iv = window.setInterval(() => { void loadThread(openUser, true); }, 6000);
    return () => window.clearInterval(iv);
  }, [openUser, loadThread]);

  const sendUser = async (payload: ChatSendPayload) => {
    if (!openUser) return;
    setThreadErr('');
    const res = await api<any>('/api/agent/message-user', { method: 'POST', body: { userId: openUser, ...payload } });
    setMessages((prev) => (prev.some((m) => m.id === res.message.id) ? prev : [...prev, res.message]));
  };
  const typingToUser = () => { if (openUser) void api('/api/agent/typing', { method: 'POST', body: { userId: openUser } }).catch(() => {}); };

  /* ── agent ↔ management ─────────────────────────────────────────────── */
  const loadManagement = useCallback(async (quiet = false) => {
    if (!quiet) setMgmtLoading(true);
    try {
      const res = await api<any>('/api/agent/management-thread');
      setMgmtMsgs(res.messages || []);
      setMgmtId(res.managementId || '');
      setMgmtTyping(!!res.peerTyping);
      setMgmtErr(res.note || '');
      try { onMgmtReadRef.current?.(); } catch { /* ignore */ }
    } catch (err: any) { if (!quiet) setMgmtErr(err?.message || 'Could not load the management thread.'); }
    finally { if (!quiet) setMgmtLoading(false); }
  }, []);

  useEffect(() => {
    if (view !== 'MANAGEMENT') return;
    void loadManagement();
    const iv = window.setInterval(() => { void loadManagement(true); }, 6000);
    return () => window.clearInterval(iv);
  }, [view, loadManagement]);

  // Live wake-up from the agent SSE stream (new user message / management reply):
  // refresh whatever the agent is currently looking at, without waiting for the poll.
  useEffect(() => {
    const onWake = () => {
      try { onReadRef.current(); } catch { /* ignore */ }
      if (openUser) void loadThread(openUser, true);
      if (view === 'MANAGEMENT') void loadManagement(true);
    };
    window.addEventListener('boostpay:agent-chat-wake', onWake as EventListener);
    return () => window.removeEventListener('boostpay:agent-chat-wake', onWake as EventListener);
  }, [openUser, view, loadThread, loadManagement]);

  const sendManagement = async (payload: ChatSendPayload) => {
    setMgmtErr('');
    const res = await api<any>('/api/agent/message-management', { method: 'POST', body: payload });
    setMgmtMsgs((prev) => (prev.some((m) => m.id === res.message.id) ? prev : [...prev, res.message]));
  };
  const typingToManagement = () => { void api('/api/agent/typing-management', { method: 'POST', body: {} }).catch(() => {}); };

  /* ── thread header (shared by both threads) ─────────────────────────── */
  const ThreadHeader: React.FC<{
    title: string; subtitle: string; initials: string; onBack: () => void;
    onCall?: () => void; onVideo?: () => void;
  }> = ({ title, subtitle, initials, onBack, onCall, onVideo }) => (
    <div className="flex shrink-0 items-center gap-2 rounded-2xl border border-zinc-800 bg-zinc-900/70 px-2 py-1.5">
      <button onClick={onBack} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border border-zinc-800 bg-zinc-950 text-zinc-400 active:scale-95">
        <ChevronRight className="h-4 w-4 rotate-180" />
      </button>
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-amber-500/15 text-[11px] font-black text-amber-300">{initials}</div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[12px] font-black leading-tight text-white">{title}</div>
        <div className={`truncate text-[9px] ${/typing/.test(subtitle) ? 'font-semibold text-amber-300' : 'text-zinc-500'}`}>{subtitle}</div>
      </div>
      {onCall ? (
        <button onClick={onCall} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border border-amber-500/40 bg-amber-500/10 text-amber-300 active:scale-95" title="Voice call">
          <Phone className="h-4 w-4" />
        </button>
      ) : null}
      {onVideo ? (
        <button onClick={onVideo} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border border-amber-500/40 bg-amber-500/10 text-amber-300 active:scale-95" title="Video call">
          <Video className="h-4 w-4" />
        </button>
      ) : null}
    </div>
  );

  /* ── management thread ──────────────────────────────────────────────── */
  if (view === 'MANAGEMENT') {
    return (
      <div className="flex min-h-0 flex-1 flex-col gap-2">
        <ThreadHeader
          title="Management"
          subtitle={mgmtTyping ? 'typing…' : (mgmtId || managementId || 'Not assigned')}
          initials="M"
          onBack={() => { setView('LIST'); onRead(); }}
        />
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-950/50">
          <ChatList
            messages={mgmtMsgs}
            myRole="AGENT"
            accent="amber"
            scope="agent-management"
            peerReadKey="readByManagement"
            loading={mgmtLoading}
            emptyTitle="No messages yet"
            emptyHint="Ask your management about float, limits or a collection. Only your management account sees this thread."
            className="min-h-0 flex-1 space-y-2 px-2.5 py-2"
          />
          {mgmtErr ? <div className="mx-2.5 mb-1.5 rounded-xl border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-[10.5px] font-semibold text-amber-200">{mgmtErr}</div> : null}
          <div className="shrink-0">
            <ChatComposer
              accent="amber"
              scope="agent-management"
              placeholder="Message your management…"
              onSend={sendManagement}
              onTyping={typingToManagement}
              onError={(m) => { setMgmtErr(m); toast({ type: 'err', text: m }); }}
            />
          </div>
        </div>
      </div>
    );
  }

  /* ── agent ↔ user thread ────────────────────────────────────────────── */
  if (openUser) {
    return (
      <div className="flex min-h-0 flex-1 flex-col gap-2">
        <ThreadHeader
          title={`User #${openUser}`}
          subtitle={peerTyping ? 'typing…' : 'Only this user sees your reply'}
          initials="U"
          onBack={() => { setOpenUser(null); onRead(); }}
          onCall={() => startCallTo(openUser, `User #${openUser}`, 'audio')}
          onVideo={() => startCallTo(openUser, `User #${openUser}`, 'video')}
        />
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-950/50">
          <ChatList
            messages={messages}
            myRole="AGENT"
            accent="amber"
            scope={`agent-user-${openUser}`}
            peerReadKey="readByUser"
            loading={threadLoading && messages.length === 0}
            emptyTitle="No messages yet"
            emptyHint="Say hello. You can send text, photos and voice notes — the user gets them instantly."
            className="min-h-0 flex-1 space-y-2 px-2.5 py-2"
            listRef={listRef}
          />
          {threadErr ? <div className="mx-2.5 mb-1.5 rounded-xl border border-red-500/40 bg-red-500/10 px-3 py-2 text-[10.5px] font-semibold text-red-200">{threadErr}</div> : null}
          <div className="shrink-0">
            <ChatComposer
              accent="amber"
              scope={`agent-user-${openUser}`}
              placeholder="Reply to this user…"
              onSend={sendUser}
              onTyping={typingToUser}
              onError={(m) => { setThreadErr(m); toast({ type: 'err', text: m }); }}
            />
          </div>
        </div>
      </div>
    );
  }

  /* ── conversation list ──────────────────────────────────────────────── */
  const term = q.trim().toLowerCase();
  const visibleChats = term ? chats.filter((c) => `${c.userId} ${c.lastText || ''}`.toLowerCase().includes(term)) : chats;
  const totalUnread = chats.reduce((n, c) => n + (c.unread > 0 ? c.unread : 0), 0) + managementUnread;
  const previewIcon = (text: string) => {
    if (/^photo$/i.test(text)) return <ImageIcon className="h-3 w-3" />;
    if (/^voice message$/i.test(text)) return <Mic className="h-3 w-3" />;
    return null;
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <div className="flex shrink-0 items-center gap-2 rounded-2xl border border-zinc-800 bg-zinc-900/70 px-3 py-2">
        <Search className="h-3.5 w-3.5 shrink-0 text-zinc-500" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search User # or message…"
          className="min-w-0 flex-1 bg-transparent text-[11.5px] text-white placeholder-zinc-600 outline-none"
        />
        {q ? <button onClick={() => setQ('')} className="shrink-0 text-zinc-500"><X className="h-3.5 w-3.5" /></button> : null}
      </div>

      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto overscroll-contain pb-1">
        <div className="overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-900/50">
          <button onClick={() => setView('MANAGEMENT')} className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left active:bg-zinc-800/40">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-amber-500/15 text-amber-300"><CircleDollarSign className="h-4 w-4" /></div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-[11.5px] font-bold text-white">Management</div>
              <div className="truncate text-[9.5px] text-zinc-500">{managementId ? 'Float, limits and collections' : 'No management account assigned yet'}</div>
            </div>
            {managementUnread > 0 ? (
              <span className="shrink-0 rounded-full bg-amber-500 px-1.5 py-0.5 text-[9px] font-black text-zinc-950">{managementUnread > 9 ? '9+' : managementUnread}</span>
            ) : <ChevronRight className="h-4 w-4 shrink-0 text-zinc-600" />}
          </button>
        </div>

        <div className="overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-900/50">
          <div className="flex items-center justify-between border-b border-zinc-800/70 px-3 py-2">
            <span className="flex items-center gap-1.5 text-[9.5px] font-bold uppercase tracking-wider text-zinc-500"><MessageSquare className="h-3 w-3" /> User messages</span>
            <span className="text-[9px] font-semibold text-zinc-600">{totalUnread > 0 ? `${totalUnread} unread` : `${chats.length} chat${chats.length === 1 ? '' : 's'}`}</span>
          </div>
          {loading && chats.length === 0 ? (
            <p className="py-8 text-center text-[11px] text-zinc-600">Loading conversations…</p>
          ) : visibleChats.length === 0 ? (
            <div className="px-4 py-8 text-center">
              <MessageSquare className="mx-auto h-5 w-5 text-zinc-700" />
              <p className="mt-2 text-[11px] font-semibold text-zinc-400">{term ? 'No conversation matches that search.' : 'No user has messaged you yet.'}</p>
              <p className="mt-1 text-[9.5px] leading-relaxed text-zinc-600">{term ? 'Try a different User # or word.' : 'Users start the chat from their app: Pay an Agent → Message.'}</p>
            </div>
          ) : (
            <div className="divide-y divide-zinc-800/60">
              {visibleChats.map((c) => (
                <button key={c.userId} onClick={() => void setOpenUser(c.userId)} className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left active:bg-zinc-800/40">
                  <div className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-zinc-800 text-zinc-300">
                    <UserRound className="h-4 w-4" />
                    {c.unread > 0 ? <span className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full border-2 border-zinc-900 bg-amber-400" /> : null}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[11.5px] font-bold text-white">User #{c.userId}</div>
                    <div className="flex items-center gap-1 truncate text-[9.5px] text-zinc-500">
                      {previewIcon(c.lastText)}
                      <span className="truncate">{(c.lastSender === 'AGENT' ? 'You: ' : '') + (c.lastText || 'No messages yet')}</span>
                    </div>
                  </div>
                  <div className="shrink-0 text-right">
                    <div className="text-[8.5px] text-zinc-600">{c.lastAt ? timeAgo(c.lastAt) : ''}</div>
                    {c.unread > 0 ? (
                      <div className="mt-0.5 inline-flex min-w-4 items-center justify-center rounded-full bg-amber-500 px-1 text-[9px] font-black text-zinc-950">{c.unread > 9 ? '9+' : c.unread}</div>
                    ) : null}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        <p className="px-2 text-center text-[9px] leading-relaxed text-zinc-600">
          You can only reply to users who messaged you first. No user names or emails are shown — User IDs only.
        </p>
      </div>
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

const HistoryScreen: React.FC<{ rows: LedgerRow[]; loading: boolean }> = ({ rows, loading }) => {
  const [open, setOpen] = useState<LedgerRow | null>(null);
  const [q, setQ] = useState('');
  const creditOf = (t: string) => ['USER_TO_AGENT', 'MGMT_CREDIT', 'ADMIN_CREDIT', 'OPENING_BALANCE'].includes(t);
  const list = q.trim()
    ? rows.filter((r) => `${r.type} ${r.userId || ''} ${r.note || ''} ${r.id}`.toLowerCase().includes(q.trim().toLowerCase()))
    : rows;

  return (
    <div className="space-y-3">
      <Card>
        <div className="mb-2 flex items-center justify-between">
          <div className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">Transaction history</div>
          <span className="text-[9px] text-zinc-600">{rows.length} rows</span>
        </div>
        <div className="mb-2 flex items-center gap-2 rounded-2xl border border-zinc-800 bg-zinc-950 px-3 py-2">
          <Search className="h-3.5 w-3.5 text-zinc-500" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search type, User #, note or TX id" className="min-w-0 flex-1 bg-transparent text-[11px] text-white placeholder-zinc-600 outline-none" />
        </div>
        {loading ? (
          <p className="py-6 text-center text-[11px] text-zinc-600">Loading…</p>
        ) : list.length === 0 ? (
          <p className="py-6 text-center text-[11px] text-zinc-600">No transactions yet.</p>
        ) : (
          <div className="divide-y divide-zinc-800/70">
            {list.map((r) => {
              const credit = creditOf(r.type);
              return (
                <button key={r.id} onClick={() => setOpen(r)} className="flex w-full items-start justify-between gap-2 py-2.5 text-left active:bg-zinc-800/30">
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
                </button>
              );
            })}
          </div>
        )}
      </Card>

      {open ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 p-0 backdrop-blur-sm" onClick={() => setOpen(null)}>
          <div className="w-full max-w-[430px] rounded-t-3xl border border-zinc-800 bg-zinc-900 p-4 pb-6" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-start justify-between">
              <div>
                <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-zinc-500"><Receipt className="h-3.5 w-3.5" /> Transaction details</div>
                <div className="mt-1 text-sm font-black text-white">{labelFor(open.type)}</div>
              </div>
              <button onClick={() => setOpen(null)} className="rounded-xl border border-zinc-800 bg-zinc-950 p-2 text-zinc-400"><X className="h-4 w-4" /></button>
            </div>

            <div className="mb-3 rounded-2xl border border-zinc-800 bg-zinc-950/70 p-3 text-center">
              <div className={`text-2xl font-black ${creditOf(open.type) ? 'text-emerald-400' : 'text-amber-400'}`}>{creditOf(open.type) ? '+' : '-'}${money(open.amount)}</div>
              <div className="mt-0.5 text-[9px] font-semibold uppercase tracking-wider text-zinc-500">{creditOf(open.type) ? 'Credited' : 'Debited'}</div>
            </div>

            <div className="space-y-1.5 text-[11px]">
              {[
                ['Status', 'Completed'],
                ['Date', new Date(open.at).toLocaleString()],
                ['Reference', open.id],
                ['Type code', open.type],
                ['User', open.userId ? `User #${open.userId}` : '—'],
                ['Actor', open.actor ? String(open.actor) : '—'],
                ['Amount', `$${money(open.amount)}`],
                ['User fee', `$${money(open.fee || 0)}`],
                ['Agent commission', `$${money(open.commission || 0)}`],
                ['Balance after', `$${money(open.balanceAfter)}`],
                ['Note', open.note || '—']
              ].map(([k, v]) => (
                <div key={String(k)} className="flex items-start justify-between gap-3 border-b border-zinc-800/60 pb-1.5 last:border-0">
                  <span className="shrink-0 text-zinc-500">{k}</span>
                  <span className="break-all text-right font-semibold text-zinc-200">{String(v)}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
};

/* ── profile + password change ──────────────────────────────────────────── */
/* ── email verification ─────────────────────────────────────────────────── */
const EmailVerifyCard: React.FC<{ agent: Agent; toast: (t: { type: 'ok' | 'err'; text: string }) => void; onVerified?: () => void }> = ({ agent, toast, onVerified }) => {
  const [verified, setVerified] = useState<boolean>(!!agent.emailVerified);
  const [sent, setSent] = useState(false);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [note, setNote] = useState('');

  useEffect(() => {
    let alive = true;
    void api<any>('/api/agent/verify-email/status')
      .then((r) => { if (alive) { setVerified(!!r.emailVerified); setSent(!!r.pending); } })
      .catch(() => { /* not fatal */ });
    return () => { alive = false; };
  }, []);

  const sendCode = async () => {
    setErr(''); setNote(''); setBusy(true);
    try {
      const r = await api<any>('/api/agent/verify-email', { method: 'POST', body: {} });
      if (r?.alreadyVerified) { setVerified(true); onVerified?.(); }
      else { setSent(true); setNote(`Code sent to ${agent.email}. Check inbox and spam.`); }
      toast({ type: 'ok', text: 'Verification code sent to your Gmail' });
    } catch (e: any) { setErr(e?.message || 'Could not send the code.'); }
    finally { setBusy(false); }
  };

  const confirmCode = async (e: React.FormEvent) => {
    e.preventDefault();
    const c = code.replace(/\D/g, '').slice(0, 6);
    if (c.length !== 6) { setErr('Enter the 6-digit code from your Gmail.'); return; }
    setErr(''); setNote(''); setBusy(true);
    try {
      await api('/api/agent/verify-email/confirm', { method: 'POST', body: { code: c } });
      setVerified(true); setSent(false); setCode('');
      onVerified?.();
      toast({ type: 'ok', text: 'Email verified' });
    } catch (e2: any) { setErr(e2?.message || 'Could not verify the code.'); }
    finally { setBusy(false); }
  };

  return (
    <Card>
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-2 text-[11px] font-bold text-white"><MailCheck className="h-4 w-4 text-amber-400" /> Email verification</span>
        {verified ? (
          <span className="flex items-center gap-1 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[9px] font-black text-emerald-300"><ShieldCheck className="h-3 w-3" /> Verified</span>
        ) : (
          <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[9px] font-black text-amber-300">Not verified</span>
        )}
      </div>
      <p className="mt-1.5 text-[10px] leading-relaxed text-zinc-500">
        {verified
          ? 'Your Gmail is confirmed. You can use it for password reset and management contact.'
          : `Verify ${agent.email} with a 6-digit code. A verified Gmail is required for password reset.`}
      </p>

      {!verified ? (
        sent ? (
          <form onSubmit={confirmCode} className="mt-2.5 space-y-2">
            <input
              className={inputCls}
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder="6-digit code"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
            />
            {err ? <div className="rounded-xl border border-red-500/40 bg-red-500/10 px-3 py-2 text-[10.5px] font-semibold text-red-200">{err}</div> : null}
            {note ? <div className="rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-[10.5px] font-semibold text-emerald-200">{note}</div> : null}
            <div className="flex gap-2">
              <button type="submit" disabled={busy} className="flex h-10 flex-1 items-center justify-center rounded-2xl bg-amber-500 text-[11px] font-black text-zinc-950 disabled:opacity-60">{busy ? 'Checking…' : 'Verify email'}</button>
              <button type="button" onClick={() => void sendCode()} disabled={busy} className="h-10 rounded-2xl border border-zinc-700 px-3 text-[10px] font-bold text-zinc-300 disabled:opacity-60">Resend</button>
            </div>
          </form>
        ) : (
          <div className="mt-2.5 space-y-2">
            {err ? <div className="rounded-xl border border-red-500/40 bg-red-500/10 px-3 py-2 text-[10.5px] font-semibold text-red-200">{err}</div> : null}
            <button onClick={() => void sendCode()} disabled={busy} className="flex h-10 w-full items-center justify-center gap-2 rounded-2xl bg-amber-500 text-[11px] font-black text-zinc-950 disabled:opacity-60">
              <MailCheck className="h-4 w-4" /> {busy ? 'Sending…' : 'Send code to my Gmail'}
            </button>
          </div>
        )
      ) : null}
    </Card>
  );
};

const ProfileScreen: React.FC<{ agent: Agent; settings: Settings; onLogout: () => void; toast: (t: { type: 'ok' | 'err'; text: string }) => void; onRefresh?: () => void }> = ({ agent, settings, onLogout, toast, onRefresh }) => {
  const [openPw, setOpenPw] = useState(false);
  const [cur, setCur] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const changePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr('');
    if (next.length < 6) { setErr('New password must be at least 6 characters.'); return; }
    if (next !== confirm) { setErr('The two new passwords do not match.'); return; }
    setBusy(true);
    try {
      await api('/api/agent/change-password', { method: 'POST', body: { currentPassword: cur, newPassword: next } });
      toast({ type: 'ok', text: 'Password updated' });
      setOpenPw(false); setCur(''); setNext(''); setConfirm('');
    } catch (e2: any) { setErr(e2?.message || 'Could not change the password.'); }
    finally { setBusy(false); }
  };

  return (
    <div className="space-y-3">
      <Card>
        <div className="flex items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-amber-500/15 text-lg font-black text-amber-400">{(agent.name || agent.id).slice(0, 1).toUpperCase()}</div>
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 truncate text-sm font-black text-white">{agent.name || agent.id} <BadgeCheck className={`h-3.5 w-3.5 ${agent.emailVerified ? 'text-emerald-400' : 'text-zinc-600'}`} /></div>
            <div className="truncate text-[11px] text-zinc-500">Agent · {agent.id}</div>
          </div>
        </div>
        <div className="mt-3 space-y-1.5 text-[11px]">
          <div className="flex items-center justify-between"><span className="text-zinc-500">Email</span><span className="flex items-center gap-1 font-semibold text-zinc-200">{agent.email}{agent.emailVerified ? <BadgeCheck className="h-3 w-3 text-emerald-400" /> : null}</span></div>
          <div className="flex justify-between"><span className="text-zinc-500">Balance</span><span className="font-black text-white">${money(agent.balance)}</span></div>
          <div className="flex justify-between"><span className="text-zinc-500">Lifetime commission</span><span className="font-black text-emerald-400">${money(agent.commissionLifetime)}</span></div>
          <div className="flex justify-between"><span className="text-zinc-500">User fee (paid by user)</span><span className="font-semibold text-zinc-200">{settings.feePercentOnUserSend}%</span></div>
          <div className="flex justify-between"><span className="text-zinc-500">Commission on receive</span><span className="font-semibold text-zinc-200">{settings.commissionPercentOnReceive}%</span></div>
          <div className="flex justify-between"><span className="text-zinc-500">Commission on send</span><span className="font-semibold text-zinc-200">{settings.commissionPercentOnSend}%</span></div>
        </div>
      </Card>

      <EmailVerifyCard agent={agent} toast={toast} onVerified={onRefresh} />

      <Card>
        <button onClick={() => { setOpenPw((v) => !v); setErr(''); }} className="flex w-full items-center justify-between">
          <span className="flex items-center gap-2 text-[11px] font-bold text-white"><KeyRound className="h-4 w-4 text-amber-400" /> Change password</span>
          <ChevronRight className={`h-4 w-4 text-zinc-500 transition ${openPw ? 'rotate-90' : ''}`} />
        </button>
        {openPw ? (
          <form onSubmit={changePassword} className="mt-3 space-y-2">
            <input className={inputCls} type="password" placeholder="Current password" value={cur} onChange={(e) => setCur(e.target.value)} required />
            <input className={inputCls} type="password" placeholder="New password (min 6)" value={next} onChange={(e) => setNext(e.target.value)} required />
            <input className={inputCls} type="password" placeholder="Confirm new password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required />
            {err ? <div className="rounded-xl border border-red-500/40 bg-red-500/10 px-3 py-2 text-[10.5px] font-semibold text-red-200">{err}</div> : null}
            <button type="submit" disabled={busy} className="flex h-11 w-full items-center justify-center rounded-2xl bg-amber-500 text-xs font-black text-zinc-950 disabled:opacity-60">{busy ? 'Saving…' : 'Update password'}</button>
            <p className="text-center text-[9px] leading-relaxed text-zinc-600">Forgot the current password? Sign out and use “Forgot password?” with your Gmail.</p>
          </form>
        ) : null}
      </Card>

      <button onClick={onLogout} className="flex h-12 w-full items-center justify-center gap-2 rounded-2xl border border-red-500/30 bg-red-500/10 text-sm font-bold text-red-300 active:scale-[0.99]">
        <LogOut className="h-4 w-4" /> Sign out
      </button>
      <p className="pb-2 text-center text-[9px] leading-relaxed text-zinc-600">BoostPay Agent · mobile only · only the latest signed-in device stays active</p>
    </div>
  );
};

/* ── app shell ──────────────────────────────────────────────────────────── */
type Tab = 'HOME' | 'SEND' | 'RECEIVE' | 'CHATS' | 'HISTORY' | 'PROFILE';

export default function App() {
  const [agent, setAgent] = useState<Agent | null>(() => {
    try { const raw = localStorage.getItem(AGENT_KEY); return raw ? JSON.parse(raw) : null; } catch { return null; }
  });
  const [token, setToken] = useState<string>(() => localStorage.getItem(TOKEN_KEY) || '');
  const [settings, setSettings] = useState<Settings>({ feePercentOnUserSend: 2, commissionPercentOnReceive: 1, commissionPercentOnSend: 1, minUserSend: 1, maxUserSend: 100000 });
  const [platform, setPlatform] = useState<any>(null);
  const [history, setHistory] = useState<LedgerRow[]>([]);
  const [chats, setChats] = useState<ChatRow[]>([]);
  const [chatUnread, setChatUnread] = useState(0);
  const [mgmtUnread, setMgmtUnread] = useState(0);
  const [loadingChats, setLoadingChats] = useState(false);
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
      setMgmtUnread(Number(res.unreadManagement) || 0);
    } catch { /* handled by api() on 401 */ }
  }, []);

  const loadHistory = useCallback(async () => {
    setLoadingHistory(true);
    try {
      const res = await api<any>('/api/agent/history?limit=100');
      setHistory(res.history || []);
    } catch { /* ignore */ } finally { setLoadingHistory(false); }
  }, []);

  const loadChats = useCallback(async (quiet = false) => {
    if (!quiet) setLoadingChats(true);
    try {
      const res = await api<any>('/api/agent/chats');
      setChats(res.chats || []);
      setChatUnread(Number(res.unread) || 0);
    } catch { /* ignore */ } finally { if (!quiet) setLoadingChats(false); }
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
    void loadChats();
    const iv = window.setInterval(() => { void refresh(); void loadHistory(); void loadChats(); }, 20000);
    return () => window.clearInterval(iv);
  }, [token, refresh, loadHistory, loadChats]);

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
    { id: 'CHATS', label: 'Chats', icon: MessageSquare },
    { id: 'HISTORY', label: 'History', icon: History },
    { id: 'PROFILE', label: 'Profile', icon: User }
  ];

  return (
    <div className="min-h-[100dvh] bg-zinc-950 text-white">
      <Toast toast={toastState} onClose={() => setToastState(null)} />
      {/* 1:1 voice/video calls with users + live chat wake-ups */}
      <AgentCallManager agentId={agent.id} onChatWake={() => { void loadChats(); }} />
      <div className="mx-auto flex h-[100dvh] min-h-[100dvh] w-full max-w-[430px] flex-col overflow-hidden">
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

        <main className={tab === 'CHATS'
            ? 'flex min-h-0 flex-1 flex-col overflow-hidden px-3 pb-[calc(env(safe-area-inset-bottom,0px)+72px)] pt-3'
            : 'min-h-0 flex-1 overflow-y-auto px-4 pb-24 pt-4'}>
          {tab === 'HOME' && <HomeScreen agent={agent} settings={settings} platform={platform} onCopy={copy} onGoto={setTab} />}
          {tab === 'SEND' && (
            <SendScreen
              agent={agent}
              settings={settings}
              toast={toast}
              onSent={(a) => { setAgent(a); void loadHistory(); void refresh(); }}
            />
          )}
          {tab === 'RECEIVE' && <ReceiveScreen agent={agent} settings={settings} onCopy={copy} history={history} toast={toast} onRedeemed={() => { void refresh(); void loadHistory(); }} />}
          {tab === 'CHATS' && (
            <ChatsScreen
              chats={chats}
              loading={loadingChats}
              toast={toast}
              onRead={() => void loadChats(true)}
              managementId={(agent as any).ownerManagementId || ''}
              managementUnread={mgmtUnread}
              onManagementRead={() => { void refresh(); }}
            />
          )}
          {tab === 'HISTORY' && <HistoryScreen rows={history} loading={loadingHistory} />}
          {tab === 'PROFILE' && <ProfileScreen agent={agent} settings={settings} onLogout={logout} toast={toast} onRefresh={() => void refresh()} />}
        </main>

        <nav className="safe-pb fixed inset-x-0 bottom-0 z-30 mx-auto w-full max-w-[430px] border-t border-zinc-800 bg-zinc-950/97 backdrop-blur">
          <div className="flex items-stretch justify-between px-1 py-1.5">
            {tabs.map((t) => {
              const Icon = t.icon;
              const active = tab === t.id;
              return (
                <button key={t.id} onClick={() => setTab(t.id)} className={`relative flex flex-1 flex-col items-center gap-1 rounded-xl py-1.5 transition ${active ? 'text-amber-400' : 'text-zinc-500'}`}>
                  <Icon className="h-5 w-5" />
                  {t.id === 'CHATS' && (chatUnread + mgmtUnread) > 0 ? (
                    <span className="absolute right-1/2 top-0.5 -mr-4 flex h-4 min-w-4 items-center justify-center rounded-full bg-amber-500 px-1 text-[9px] font-black text-zinc-950">{(chatUnread + mgmtUnread) > 9 ? '9+' : chatUnread + mgmtUnread}</span>
                  ) : null}
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
