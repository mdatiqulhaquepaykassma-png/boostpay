import { FC, useCallback, useEffect, useMemo, useState } from 'react';
import {
  Users, Plus, Check, X, RefreshCw, KeyRound, Eye, EyeOff, Settings2, Landmark,
  ArrowDownLeft, ArrowUpRight, UserCog, Copy, CircleDollarSign, ShieldCheck
} from 'lucide-react';
import { BoostPayStore, copyToClipboard } from '../services/store';

type Agent = {
  id: string; name: string; email: string; balance: number; commissionLifetime: number;
  sentTotal: number; receivedTotal: number; isActive: boolean; createdAt: number; passwordPlain?: string;
  ownerManagementId?: string;
};
type Mgmt = { id: string; name: string; email: string; balance: number; isActive: boolean; createdAt: number; passwordPlain?: string };
type Settings = {
  enabled: boolean; feePercentOnUserSend: number; commissionPercentOnReceive: number;
  commissionPercentOnSend: number; minUserSend: number; maxUserSend: number; allowAgentBoost: boolean;
};
type Stats = {
  feesCollected: number; commissionsPaid: number; platformNet: number; volumeIn: number;
  volumeOut: number; totalAgentBalance: number; agents: number; management: number;
};

const money = (n: number) => (Number.isFinite(Number(n)) ? Number(n) : 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const inputCls = 'w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2.5 text-xs text-white placeholder-zinc-600 outline-none focus:border-amber-500/60';

const Card: FC<{ children: React.ReactNode; className?: string }> = ({ children, className = '' }) => (
  <div className={`rounded-2xl border border-zinc-800 bg-zinc-900/70 p-4 ${className}`}>{children}</div>
);

const StatBox: FC<{ label: string; value: string; tone?: string }> = ({ label, value, tone = 'text-white' }) => (
  <div className="rounded-xl border border-zinc-800 bg-zinc-950/70 px-3 py-2.5">
    <div className="text-[9px] font-bold uppercase tracking-wider text-zinc-500">{label}</div>
    <div className={`mt-0.5 text-sm font-black ${tone}`}>{value}</div>
  </div>
);

export const AgentAdminView: FC = () => {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [management, setManagement] = useState<Mgmt[]>([]);
  const [settings, setSettings] = useState<Settings>({
    enabled: true, feePercentOnUserSend: 2, commissionPercentOnReceive: 1,
    commissionPercentOnSend: 1, minUserSend: 1, maxUserSend: 100000, allowAgentBoost: false
  });
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<'AGENTS' | 'MANAGEMENT' | 'SETTINGS'>('AGENTS');
  const [toast, setToast] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const [showPw, setShowPw] = useState<Record<string, boolean>>({});
  const [adjusting, setAdjusting] = useState<{ id: string; amount: string; note: string } | null>(null);

  const [newAgent, setNewAgent] = useState({ name: '', email: '', password: '', openingBalance: '', ownerManagementId: '' });
  const [mgmtAdjust, setMgmtAdjust] = useState<{ id: string; amount: string; note: string } | null>(null);
  const [newMgmt, setNewMgmt] = useState({ name: '', email: '', password: '' });

  const notify = useCallback((type: 'ok' | 'err', text: string) => {
    setToast({ type, text });
    window.setTimeout(() => setToast(null), 3500);
  }, []);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/agents', { headers: BoostPayStore.adminAuthHeaders() });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || 'Failed to load agent data.');
      setAgents(json.agents || []);
      setManagement(json.management || []);
      setSettings(json.settings);
      setStats(json.stats || null);
    } catch (err: any) {
      notify('err', err?.message || 'Failed to load.');
    } finally {
      setLoading(false);
    }
  }, [notify]);

  useEffect(() => { void load(); }, [load]);

  const createAgent = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const res = await fetch('/api/admin/agents', {
        method: 'POST',
        headers: BoostPayStore.adminAuthHeaders(),
        body: JSON.stringify({
          name: newAgent.name.trim(), email: newAgent.email.trim(), password: newAgent.password,
          openingBalance: newAgent.openingBalance ? Number(newAgent.openingBalance) : 0,
          ownerManagementId: newAgent.ownerManagementId || ''
        })
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || 'Create failed.');
      notify('ok', `Agent ${json.agent.id} created`);
      setNewAgent({ name: '', email: '', password: '', openingBalance: '', ownerManagementId: '' });
      void load();
    } catch (err: any) { notify('err', err?.message || 'Create failed.'); }
    finally { setBusy(false); }
  };

  const createMgmt = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const res = await fetch('/api/admin/management', {
        method: 'POST',
        headers: BoostPayStore.adminAuthHeaders(),
        body: JSON.stringify({ name: newMgmt.name.trim(), email: newMgmt.email.trim(), password: newMgmt.password })
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || 'Create failed.');
      notify('ok', `Management ${json.management.id} created`);
      setNewMgmt({ name: '', email: '', password: '' });
      void load();
    } catch (err: any) { notify('err', err?.message || 'Create failed.'); }
    finally { setBusy(false); }
  };

  const patchAgent = async (id: string, patch: Record<string, any>) => {
    try {
      const res = await fetch(`/api/admin/agents/${id}`, {
        method: 'PATCH', headers: BoostPayStore.adminAuthHeaders(), body: JSON.stringify(patch)
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || 'Update failed.');
      notify('ok', `${id} updated`);
      void load();
    } catch (err: any) { notify('err', err?.message || 'Update failed.'); }
  };

  const patchMgmt = async (id: string, patch: Record<string, any>) => {
    try {
      const res = await fetch(`/api/admin/management/${id}`, {
        method: 'PATCH', headers: BoostPayStore.adminAuthHeaders(), body: JSON.stringify(patch)
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || 'Update failed.');
      notify('ok', `${id} updated`);
      void load();
    } catch (err: any) { notify('err', err?.message || 'Update failed.'); }
  };

  const submitAdjust = async () => {
    if (!adjusting) return;
    const amount = Number(adjusting.amount);
    if (!Number.isFinite(amount) || amount === 0) { notify('err', 'Enter a non-zero amount.'); return; }
    try {
      const res = await fetch(`/api/admin/agents/${adjusting.id}/adjust`, {
        method: 'POST', headers: BoostPayStore.adminAuthHeaders(),
        body: JSON.stringify({ amount, note: adjusting.note })
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || 'Adjustment failed.');
      notify('ok', `Adjustment applied on ${adjusting.id}`);
      setAdjusting(null);
      void load();
    } catch (err: any) { notify('err', err?.message || 'Adjustment failed.'); }
  };

  const submitMgmtAdjust = async () => {
    if (!mgmtAdjust) return;
    const amount = Number(mgmtAdjust.amount);
    if (!Number.isFinite(amount) || amount === 0) { notify('err', 'Enter a non-zero amount.'); return; }
    try {
      const res = await fetch(`/api/admin/management/${mgmtAdjust.id}/adjust`, {
        method: 'POST', headers: BoostPayStore.adminAuthHeaders(),
        body: JSON.stringify({ amount, note: mgmtAdjust.note })
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || 'Adjustment failed.');
      notify('ok', `Wallet updated for ${mgmtAdjust.id}`);
      setMgmtAdjust(null);
      void load();
    } catch (err: any) { notify('err', err?.message || 'Adjustment failed.'); }
  };

  const saveSettings = async () => {
    setBusy(true);
    try {
      const res = await fetch('/api/admin/agent-config', {
        method: 'POST', headers: BoostPayStore.adminAuthHeaders(), body: JSON.stringify(settings)
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || 'Save failed.');
      setSettings(json.settings);
      notify('ok', 'Agent settings saved');
    } catch (err: any) { notify('err', err?.message || 'Save failed.'); }
    finally { setBusy(false); }
  };

  const net = useMemo(() => stats?.platformNet ?? 0, [stats]);

  return (
    <div className="space-y-3">
      {toast ? (
        <div className={`flex items-start gap-2 rounded-xl border px-3 py-2.5 text-[11px] font-semibold ${toast.type === 'ok' ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200' : 'border-red-500/40 bg-red-500/10 text-red-200'}`}>
          {toast.type === 'ok' ? <Check className="mt-0.5 h-3.5 w-3.5" /> : <X className="mt-0.5 h-3.5 w-3.5" />}
          <span>{toast.text}</span>
        </div>
      ) : null}

      <Card>
        <div className="flex items-center justify-between">
          <div>
            <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-amber-400"><Landmark className="h-3 w-3" /> Agent network</div>
            <div className="mt-1 text-sm font-black text-white">BoostPay Agent · Management</div>
          </div>
          <button onClick={() => { setLoading(true); void load(); }} className="rounded-xl border border-zinc-800 bg-zinc-950 p-2 text-zinc-400 hover:text-white" title="Refresh">
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <StatBox label="Agents" value={String(stats?.agents ?? agents.length)} />
          <StatBox label="Agent float" value={`$${money(stats?.totalAgentBalance || 0)}`} />
          <StatBox label="Mgmt wallets" value={`$${money(management.reduce((s2, m) => s2 + Number(m.balance || 0), 0))}`} tone="text-cyan-300" />
          <StatBox label="Fees collected" value={`$${money(stats?.feesCollected || 0)}`} tone="text-amber-300" />
          <StatBox label="Commissions paid" value={`$${money(stats?.commissionsPaid || 0)}`} tone="text-emerald-300" />
        </div>
        <div className="mt-2 grid grid-cols-3 gap-2">
          <StatBox label="Volume in" value={`$${money(stats?.volumeIn || 0)}`} />
          <StatBox label="Volume out" value={`$${money(stats?.volumeOut || 0)}`} />
          <StatBox label="Platform net" value={`$${money(net)}`} tone={net >= 0 ? 'text-emerald-300' : 'text-red-300'} />
        </div>
      </Card>

      <div className="flex gap-2">
        {([
          { id: 'AGENTS', label: 'Agents', icon: Users },
          { id: 'MANAGEMENT', label: 'Management', icon: UserCog },
          { id: 'SETTINGS', label: 'Rates & Config', icon: Settings2 }
        ] as const).map((t) => {
          const Icon = t.icon;
          const active = tab === t.id;
          return (
            <button key={t.id} onClick={() => setTab(t.id as any)}
              className={`flex flex-1 items-center justify-center gap-1.5 rounded-xl px-2 py-2 text-[11px] font-bold transition ${active ? 'bg-amber-500 text-zinc-950' : 'border border-zinc-800 bg-zinc-950 text-zinc-400 hover:text-zinc-200'}`}>
              <Icon className="h-3.5 w-3.5" /> {t.label}
            </button>
          );
        })}
      </div>

      {tab === 'AGENTS' && (
        <>
          <Card>
            <div className="mb-2 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-zinc-400"><Plus className="h-3 w-3" /> Create agent account</div>
            <form onSubmit={createAgent} className="grid grid-cols-1 gap-2 sm:grid-cols-4">
              <input className={inputCls} placeholder="Agent name" value={newAgent.name} onChange={(e) => setNewAgent({ ...newAgent, name: e.target.value })} />
              <input className={inputCls} type="email" placeholder="agent@email.com" value={newAgent.email} onChange={(e) => setNewAgent({ ...newAgent, email: e.target.value })} required />
              <input className={inputCls} placeholder="Password (min 6)" value={newAgent.password} onChange={(e) => setNewAgent({ ...newAgent, password: e.target.value })} required />
              <div className="flex gap-2">
                <input className={inputCls} placeholder="Opening $" value={newAgent.openingBalance} onChange={(e) => setNewAgent({ ...newAgent, openingBalance: e.target.value })} />
                <button type="submit" disabled={busy} className="shrink-0 rounded-xl bg-amber-500 px-3 text-[11px] font-black text-zinc-950 disabled:opacity-60">Create</button>
              </div>
              <select
                className={`${inputCls} sm:col-span-4`}
                value={newAgent.ownerManagementId}
                onChange={(e) => setNewAgent({ ...newAgent, ownerManagementId: e.target.value })}
              >
                <option value="">Owner: none (platform agent — only admin can fund)</option>
                {management.map((m) => <option key={m.id} value={m.id}>Owner: {m.id}{m.name ? ` — ${m.name}` : ''}</option>)}
              </select>
            </form>
            <p className="mt-2 text-[9px] leading-relaxed text-zinc-500">
              Only the owning management account can fund or collect this agent. Platform agents are funded by the admin only.
              Opening balance here is funded by the platform.
            </p>
          </Card>

          {agents.length === 0 ? (
            <Card><p className="py-6 text-center text-[11px] text-zinc-500">{loading ? 'Loading…' : 'No agents yet.'}</p></Card>
          ) : agents.map((a) => (
            <Card key={a.id}>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5 text-xs font-black text-white">
                    {a.name || a.id}
                    <span className={`rounded-full px-1.5 py-0.5 text-[8px] font-bold ${a.isActive ? 'bg-emerald-500/15 text-emerald-300' : 'bg-red-500/15 text-red-300'}`}>{a.isActive ? 'ACTIVE' : 'DISABLED'}</span>
                  </div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-2 text-[9px] font-mono text-zinc-500">
                    <span>{a.id}</span><span>·</span><span>{a.email}</span>
                    <button onClick={() => copyToClipboard(a.id)} className="text-zinc-600 hover:text-zinc-300"><Copy className="h-2.5 w-2.5" /></button>
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[9px]">
                    <span className={`rounded-full px-1.5 py-0.5 font-bold ${a.ownerManagementId ? 'bg-cyan-500/15 text-cyan-300' : 'bg-zinc-800 text-zinc-400'}`}>
                      {a.ownerManagementId ? `owned by ${a.ownerManagementId}` : 'platform agent'}
                    </span>
                    <select
                      className="rounded-lg border border-zinc-800 bg-zinc-950 px-1.5 py-0.5 text-[9px] text-zinc-300 outline-none"
                      value={a.ownerManagementId || ''}
                      onChange={(e) => void patchAgent(a.id, { ownerManagementId: e.target.value })}
                    >
                      <option value="">Reassign → platform</option>
                      {management.map((m) => <option key={m.id} value={m.id}>Reassign → {m.id}</option>)}
                    </select>
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-sm font-black text-white">${money(a.balance)}</div>
                  <div className="text-[9px] text-emerald-400">lifetime ${money(a.commissionLifetime)}</div>
                </div>
              </div>

              <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
                <StatBox label="Received" value={`$${money(a.receivedTotal)}`} />
                <StatBox label="Sent" value={`$${money(a.sentTotal)}`} />
                <StatBox label="User fee" value={`${settings.feePercentOnUserSend}%`} />
                <StatBox label="Commission" value={`${settings.commissionPercentOnReceive}% / ${settings.commissionPercentOnSend}%`} />
              </div>

              <div className="mt-2 flex items-center justify-between rounded-xl border border-zinc-800 bg-zinc-950 px-2.5 py-1.5">
                <div className="flex items-center gap-1.5 font-mono text-[10px] text-zinc-400">
                  <KeyRound className="h-3 w-3 text-zinc-600" />
                  {showPw[a.id] ? (a.passwordPlain || '—') : '••••••••'}
                </div>
                <div className="flex items-center gap-1">
                  <button onClick={() => setShowPw((p) => ({ ...p, [a.id]: !p[a.id] }))} className="rounded-lg border border-zinc-800 p-1.5 text-zinc-400 hover:text-white" title="Show password">
                    {showPw[a.id] ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
                  </button>
                  <button onClick={() => {
                    const np = window.prompt(`New password for ${a.id} (min 6 characters)`);
                    if (np && np.length >= 6) void patchAgent(a.id, { password: np });
                  }} className="rounded-lg border border-zinc-800 px-2 py-1 text-[9px] font-bold text-zinc-300 hover:text-white">Reset</button>
                </div>
              </div>

              <div className="mt-2 flex flex-wrap gap-2">
                <button onClick={() => setAdjusting({ id: a.id, amount: '', note: '' })} className="flex items-center gap-1 rounded-lg border border-zinc-800 bg-zinc-950 px-2.5 py-1.5 text-[10px] font-bold text-zinc-300 hover:border-amber-500/40 hover:text-amber-300">
                  <CircleDollarSign className="h-3 w-3" /> Adjust balance
                </button>
                <button onClick={() => void patchAgent(a.id, { isActive: !a.isActive })} className={`flex items-center gap-1 rounded-lg border px-2.5 py-1.5 text-[10px] font-bold ${a.isActive ? 'border-red-500/30 bg-red-500/10 text-red-300' : 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'}`}>
                  {a.isActive ? <X className="h-3 w-3" /> : <Check className="h-3 w-3" />} {a.isActive ? 'Disable' : 'Enable'}
                </button>
              </div>

              {adjusting && adjusting.id === a.id ? (
                <div className="mt-2 flex flex-wrap items-end gap-2 rounded-xl border border-amber-500/30 bg-amber-500/5 p-2">
                  <div className="flex-1 min-w-[110px]">
                    <div className="mb-1 text-[9px] font-bold uppercase tracking-wider text-zinc-500">Amount (negative = debit)</div>
                    <input className={inputCls} placeholder="-50 or 25" value={adjusting.amount} onChange={(e) => setAdjusting({ ...adjusting, amount: e.target.value })} />
                  </div>
                  <div className="flex-1 min-w-[110px]">
                    <div className="mb-1 text-[9px] font-bold uppercase tracking-wider text-zinc-500">Note</div>
                    <input className={inputCls} placeholder="Reason" value={adjusting.note} onChange={(e) => setAdjusting({ ...adjusting, note: e.target.value })} />
                  </div>
                  <button onClick={() => void submitAdjust()} className="rounded-xl bg-amber-500 px-3 py-2 text-[11px] font-black text-zinc-950">Apply</button>
                  <button onClick={() => setAdjusting(null)} className="rounded-xl border border-zinc-800 px-3 py-2 text-[11px] font-bold text-zinc-400">Cancel</button>
                </div>
              ) : null}
            </Card>
          ))}
        </>
      )}

      {tab === 'MANAGEMENT' && (
        <>
          <Card>
            <div className="mb-2 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-zinc-400"><Plus className="h-3 w-3" /> Create management account</div>
            <form onSubmit={createMgmt} className="grid grid-cols-1 gap-2 sm:grid-cols-4">
              <input className={inputCls} placeholder="Management name" value={newMgmt.name} onChange={(e) => setNewMgmt({ ...newMgmt, name: e.target.value })} />
              <input className={inputCls} type="email" placeholder="management@email.com" value={newMgmt.email} onChange={(e) => setNewMgmt({ ...newMgmt, email: e.target.value })} required />
              <input className={inputCls} placeholder="Password (min 6)" value={newMgmt.password} onChange={(e) => setNewMgmt({ ...newMgmt, password: e.target.value })} required />
              <button type="submit" disabled={busy} className="rounded-xl bg-amber-500 px-3 py-2 text-[11px] font-black text-zinc-950 disabled:opacity-60">Create</button>
            </form>
            <p className="mt-2 text-[9px] leading-relaxed text-zinc-500">
              Management accounts sign in at BoostPay Management, create their own agents, and fund/collect ONLY those agents.
              Top up a management wallet here (Adjust wallet) so it can distribute float to its own agents.
            </p>
          </Card>

          {management.length === 0 ? (
            <Card><p className="py-6 text-center text-[11px] text-zinc-500">No management accounts yet.</p></Card>
          ) : management.map((m) => (
            <Card key={m.id}>
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5 text-xs font-black text-white">
                    {m.name || m.id}
                    <span className={`rounded-full px-1.5 py-0.5 text-[8px] font-bold ${m.isActive ? 'bg-cyan-500/15 text-cyan-300' : 'bg-red-500/15 text-red-300'}`}>{m.isActive ? 'ACTIVE' : 'DISABLED'}</span>
                  </div>
                  <div className="mt-0.5 text-[9px] font-mono text-zinc-500">{m.id} · {m.email}</div>
                  <div className="mt-1 flex items-center gap-2 text-[9px]">
                    <span className="rounded-full bg-cyan-500/15 px-1.5 py-0.5 font-bold text-cyan-300">wallet ${money(m.balance || 0)}</span>
                    <span className="rounded-full bg-zinc-800 px-1.5 py-0.5 font-bold text-zinc-400">
                      {agents.filter((a) => a.ownerManagementId === m.id).length} agents
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <span className="rounded-lg border border-zinc-800 bg-zinc-950 px-2 py-1 font-mono text-[10px] text-zinc-400">{showPw[m.id] ? (m.passwordPlain || '—') : '••••'}</span>
                  <button onClick={() => setShowPw((p) => ({ ...p, [m.id]: !p[m.id] }))} className="rounded-lg border border-zinc-800 p-1.5 text-zinc-400 hover:text-white">
                    {showPw[m.id] ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
                  </button>
                  <button onClick={() => void patchMgmt(m.id, { isActive: !m.isActive })} className={`rounded-lg border px-2 py-1 text-[9px] font-bold ${m.isActive ? 'border-red-500/30 bg-red-500/10 text-red-300' : 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'}`}>
                    {m.isActive ? 'Disable' : 'Enable'}
                  </button>
                </div>
              </div>
              <div className="mt-2 flex flex-wrap gap-2">
                <button onClick={() => setMgmtAdjust({ id: m.id, amount: '', note: '' })} className="flex items-center gap-1 rounded-lg border border-zinc-800 bg-zinc-950 px-2.5 py-1.5 text-[10px] font-bold text-zinc-300 hover:border-amber-500/40 hover:text-amber-300">
                  <CircleDollarSign className="h-3 w-3" /> Adjust wallet
                </button>
              </div>
              {mgmtAdjust && mgmtAdjust.id === m.id ? (
                <div className="mt-2 flex flex-wrap items-end gap-2 rounded-xl border border-amber-500/30 bg-amber-500/5 p-2">
                  <div className="min-w-[110px] flex-1">
                    <div className="mb-1 text-[9px] font-bold uppercase tracking-wider text-zinc-500">Amount (negative = debit)</div>
                    <input className={inputCls} placeholder="-50 or 25" value={mgmtAdjust.amount} onChange={(e) => setMgmtAdjust({ ...mgmtAdjust, amount: e.target.value })} />
                  </div>
                  <div className="min-w-[110px] flex-1">
                    <div className="mb-1 text-[9px] font-bold uppercase tracking-wider text-zinc-500">Note</div>
                    <input className={inputCls} placeholder="Reason" value={mgmtAdjust.note} onChange={(e) => setMgmtAdjust({ ...mgmtAdjust, note: e.target.value })} />
                  </div>
                  <button onClick={() => void submitMgmtAdjust()} className="rounded-xl bg-amber-500 px-3 py-2 text-[11px] font-black text-zinc-950">Apply</button>
                  <button onClick={() => setMgmtAdjust(null)} className="rounded-xl border border-zinc-800 px-3 py-2 text-[11px] font-bold text-zinc-400">Cancel</button>
                </div>
              ) : null}
            </Card>
          ))}
        </>
      )}

      {tab === 'SETTINGS' && (
        <Card>
          <div className="mb-3 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-zinc-400"><Settings2 className="h-3 w-3" /> Agent fee &amp; commission</div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="mb-1 block text-[9px] font-bold uppercase tracking-wider text-zinc-500">User → Agent fee (%) — paid by user</span>
              <input className={inputCls} type="number" step="0.01" value={settings.feePercentOnUserSend} onChange={(e) => setSettings({ ...settings, feePercentOnUserSend: Number(e.target.value) })} />
            </label>
            <label className="block">
              <span className="mb-1 block text-[9px] font-bold uppercase tracking-wider text-zinc-500">Agent commission on receive (%)</span>
              <input className={inputCls} type="number" step="0.01" value={settings.commissionPercentOnReceive} onChange={(e) => setSettings({ ...settings, commissionPercentOnReceive: Number(e.target.value) })} />
            </label>
            <label className="block">
              <span className="mb-1 block text-[9px] font-bold uppercase tracking-wider text-zinc-500">Agent commission on send (%)</span>
              <input className={inputCls} type="number" step="0.01" value={settings.commissionPercentOnSend} onChange={(e) => setSettings({ ...settings, commissionPercentOnSend: Number(e.target.value) })} />
            </label>
            <div className="grid grid-cols-2 gap-2">
              <label className="block">
                <span className="mb-1 block text-[9px] font-bold uppercase tracking-wider text-zinc-500">Min user payment</span>
                <input className={inputCls} type="number" value={settings.minUserSend} onChange={(e) => setSettings({ ...settings, minUserSend: Number(e.target.value) })} />
              </label>
              <label className="block">
                <span className="mb-1 block text-[9px] font-bold uppercase tracking-wider text-zinc-500">Max user payment</span>
                <input className={inputCls} type="number" value={settings.maxUserSend} onChange={(e) => setSettings({ ...settings, maxUserSend: Number(e.target.value) })} />
              </label>
            </div>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <button onClick={() => setSettings({ ...settings, enabled: !settings.enabled })} className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-[11px] font-bold ${settings.enabled ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300' : 'border-zinc-800 bg-zinc-950 text-zinc-400'}`}>
              <ArrowDownLeft className="h-3 w-3" /> {settings.enabled ? 'Agent payments ON' : 'Agent payments OFF'}
            </button>
            <div className="flex items-center gap-2 rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-[11px] font-bold text-zinc-400">
              <ShieldCheck className="h-3 w-3 text-zinc-500" /> Agent boost: users only
            </div>
            <button onClick={() => void saveSettings()} disabled={busy} className="ml-auto rounded-xl bg-amber-500 px-4 py-2 text-[11px] font-black text-zinc-950 disabled:opacity-60">
              {busy ? 'Saving…' : 'Save settings'}
            </button>
          </div>
          <div className="mt-3 rounded-xl border border-zinc-800 bg-zinc-950 p-3 text-[10px] leading-relaxed text-zinc-500">
            <div className="mb-1 font-bold uppercase tracking-wider text-zinc-400">Money rules</div>
            User pays agent → user is debited amount + {settings.feePercentOnUserSend}% fee, agent receives the full amount plus {settings.commissionPercentOnReceive}% commission (funded by platform).<br />
            Agent pays user → agent is debited the amount, user receives the full amount, agent earns {settings.commissionPercentOnSend}% commission (funded by platform).<br />
            Lifetime commission on the agent = sum of all commission credits.
          </div>
        </Card>
      )}

      {tab === 'AGENTS' && (
        <Card>
          <div className="text-[10px] font-bold uppercase tracking-wider text-zinc-400">How agents use the app</div>
          <ul className="mt-1.5 space-y-1 text-[10px] leading-relaxed text-zinc-500">
            <li>• Agents sign in at the BoostPay Agent app (mobile only) with the email and password created here.</li>
            <li>• They can send money to any User ID and share their Agent ID to receive money from users.</li>
            <li>• Boost is disabled for agents — only user accounts can boost.</li>
          </ul>
        </Card>
      )}
    </div>
  );
};

export default AgentAdminView;
