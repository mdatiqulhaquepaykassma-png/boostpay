/**
 * Admin → Payments.
 *
 * Three things in one screen: the method catalogue (add / edit / enable / disable /
 * recommended / audience / limits / currencies / maintenance), the deposit queue and
 * the withdrawal queue. Nothing here credits money on its own — an admin decision
 * does, and every decision is written to the audit log by the server.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { BoostPayStore } from '../services/store';

type Cat = { id: string; label: string; icon: string };
type Method = {
  id: string; name: string; logo: string; category: string;
  enabled: boolean; recommended: boolean; recommendedOrder: number; order: number;
  depositEnabled: boolean; withdrawEnabled: boolean;
  userDeposit: boolean; userWithdraw: boolean; agentDeposit: boolean; agentWithdraw: boolean;
  currencies: string[]; countries: string[];
  minDeposit: number; maxDeposit: number; minWithdraw: number; maxWithdraw: number;
  depositFeePercent: number; withdrawFeePercent: number;
  processingTime: string; maintenance: boolean; maintenanceMessage: string;
  accountName: string; accountNumber: string; instructions: string;
  createdAt: number; updatedAt: number;
};
type DepReq = {
  id: string; userId: string; methodId: string; methodName: string; amountUsd: number; entryAmount: number;
  entryCurrency: string; reference: string; note?: string; status: string; createdAt: number;
  sourceAgentId?: string; reviewedBy?: string; reason?: string;
};
type WdrReq = {
  id: string; userId: string; methodId: string; methodName: string; amountUsd: number; feeUsd: number; netUsd: number;
  entryAmount: number; entryCurrency: string; destination: Record<string, string>; status: string; createdAt: number;
  sourceType?: 'PAYMENT_METHOD' | 'CASH_AGENT'; channel?: string; agentId?: string; totalUsd?: number; expiresAt?: number;
  reviewedBy?: string; reason?: string; payoutRef?: string;
};
type WithdrawalPolicy = {
  methodCapsEnabled: boolean; agentCapsEnabled: boolean;
  singleMethodUnlimited: boolean; singleAgentUnlimited: boolean;
};
type PolicyMethod = {
  id: string; name: string; category: string; enabled: boolean; withdrawEnabled: boolean;
  minWithdraw: number; maxWithdraw: number; withdrawFeePercent: number;
  withdrawFields: Array<{ key: string; label: string; placeholder: string }>;
};
type WalletAgentOption = { id: string; name: string; methodId: string; methodName: string; country: string; active: boolean };
type CashAgentOption = { id: string; name: string; active: boolean };
type EditSourceAgent = { id: string; name: string; availableUsd: number; unlimited: boolean };

/**
 * Auth for the payment endpoints.
 *
 * BUG (fixed 2026-11-10): this screen used to hunt for the user-app token
 * (`boostpay_auth_token_v1`), but the admin console keeps ITS session in
 * `boostpay_admin_session_v4`, so every call went out without a token and the
 * server answered 401 — which is why withdrawal requests never appeared in the
 * admin panel. The console's own store already knows where the token lives and
 * also attaches the short-lived MFA headers, so use that.
 */
function authHeaders(): Record<string, string> {
  try {
    const h = BoostPayStore.adminAuthHeaders();
    return { ...h };
  } catch {
    return { 'content-type': 'application/json' };
  }
}

const money = (n: number) => `$${(Number(n) || 0).toFixed(2)}`;
const when = (ts: number) => new Date(Number(ts) || 0).toLocaleString();

const Toggle: React.FC<{ on: boolean; onChange: (v: boolean) => void; label?: string; disabled?: boolean }> = ({ on, onChange, label, disabled }) => (
  <button
    type="button"
    disabled={disabled}
    onClick={() => onChange(!on)}
    className={`flex items-center gap-1.5 rounded-full border px-2 py-1 text-[9px] font-bold transition ${
      on ? 'border-emerald-500/40 bg-emerald-500/15 text-emerald-300' : 'border-zinc-700 bg-zinc-900 text-zinc-500'
    } ${disabled ? 'opacity-50' : ''}`}
  >
    <span className={`h-1.5 w-1.5 rounded-full ${on ? 'bg-emerald-400' : 'bg-zinc-600'}`} />
    {label || (on ? 'on' : 'off')}
  </button>
);

export const PaymentAdmin: React.FC = () => {
  const [tab, setTab] = useState<'METHODS' | 'DEPOSITS' | 'WITHDRAWALS' | 'POLICY'>('METHODS');
  const [cats, setCats] = useState<Cat[]>([]);
  const [methods, setMethods] = useState<Method[]>([]);
  const [deps, setDeps] = useState<DepReq[]>([]);
  const [wdrs, setWdrs] = useState<WdrReq[]>([]);
  const [statusFilter, setStatusFilter] = useState('PENDING');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState('');
  const [editing, setEditing] = useState<Partial<Method> | null>(null);
  const [policy, setPolicy] = useState<WithdrawalPolicy>({ methodCapsEnabled: true, agentCapsEnabled: true, singleMethodUnlimited: true, singleAgentUnlimited: true });
  const [policyMethods, setPolicyMethods] = useState<PolicyMethod[]>([]);
  const [walletAgentOptions, setWalletAgentOptions] = useState<WalletAgentOption[]>([]);
  const [cashAgentOptions, setCashAgentOptions] = useState<CashAgentOption[]>([]);
  const [editingDeposit, setEditingDeposit] = useState<DepReq | null>(null);
  const [depositDraft, setDepositDraft] = useState({ methodId: '', sourceAgentId: '', amountUsd: 0 });
  const [editingWithdrawal, setEditingWithdrawal] = useState<WdrReq | null>(null);
  const [withdrawDraft, setWithdrawDraft] = useState<any>({});
  const [editSourceAgents, setEditSourceAgents] = useState<EditSourceAgent[]>([]);
  const [q, setQ] = useState('');
  const [counts, setCounts] = useState<{ deposit: number; withdraw: number }>({ deposit: 0, withdraw: 0 });
  // country picker source for the method editor (ISO code + label + flag)
  const [countryOpts, setCountryOpts] = useState<{ code: string; label: string; flag: string }[]>([]);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const r = await fetch('/api/admin/countries', { headers: authHeaders() });
        if (!r.ok) return;
        const j = await r.json();
        if (alive && Array.isArray(j.countries)) setCountryOpts(j.countries);
      } catch { /* the picker falls back to the chip list */ }
    })();
    return () => { alive = false; };
  }, []);

  const loadMethods = useCallback(async () => {
    try {
      const r = await fetch('/api/admin/payment-methods', { headers: authHeaders() });
      if (!r.ok) { setNote(`Could not load the methods (HTTP ${r.status}).`); return; }
      const j = await r.json();
      setMethods(Array.isArray(j.methods) ? j.methods : []);
      setCats(Array.isArray(j.categories) ? j.categories : []);
    } catch { setNote('Could not load the methods.'); }
  }, []);

  const loadPolicy = useCallback(async () => {
    try {
      const r = await fetch('/api/admin/withdrawal-policy', { headers: authHeaders() });
      if (!r.ok) return;
      const j = await r.json();
      if (j.policy) setPolicy(j.policy);
      setPolicyMethods(Array.isArray(j.methods) ? j.methods : []);
      setWalletAgentOptions(Array.isArray(j.walletAgents) ? j.walletAgents : []);
      setCashAgentOptions(Array.isArray(j.cashAgents) ? j.cashAgents : []);
    } catch { /* the source-rule editor stays available after a refresh */ }
  }, []);

  const loadQueue = useCallback(async (kind: 'deposit' | 'withdraw') => {
    try {
      const r = await fetch(`/api/admin/payment-requests?type=${kind}&status=${statusFilter}`, { headers: authHeaders() });
      if (!r.ok) return;
      const j = await r.json();
      if (kind === 'deposit') setDeps(Array.isArray(j.requests) ? j.requests : []);
      else setWdrs(Array.isArray(j.requests) ? j.requests : []);
    } catch { /* ignore */ }
  }, [statusFilter]);

  /** How many requests are waiting — shown on the queue tabs, so a new
   *  withdrawal is visible from the Payments landing tab without hunting. */
  const loadCounts = useCallback(async () => {
    try {
      const [d, w] = await Promise.all([
        fetch('/api/admin/payment-requests?type=deposit&status=PENDING', { headers: authHeaders() }),
        fetch('/api/admin/payment-requests?type=withdraw&status=PENDING', { headers: authHeaders() })
      ]);
      if (!d.ok || !w.ok) return;
      const dj = await d.json(); const wj = await w.json();
      setCounts({
        deposit: Array.isArray(dj.requests) ? dj.requests.length : 0,
        withdraw: Array.isArray(wj.requests) ? wj.requests.length : 0
      });
    } catch { /* the counter is a convenience */ }
  }, []);

  useEffect(() => { void loadMethods(); void loadCounts(); void loadPolicy(); }, [loadMethods, loadCounts, loadPolicy]);
  useEffect(() => {
    if (tab === 'DEPOSITS') void loadQueue('deposit');
    if (tab === 'WITHDRAWALS') void loadQueue('withdraw');
    if (tab === 'POLICY') void loadPolicy();
    if (tab !== 'METHODS') void loadCounts();
  }, [tab, loadQueue, loadCounts, loadPolicy]);

  // Live queue: a withdrawal submitted while this screen is open must appear by
  // itself (owner report: "withdraw request admin panel e jacche na").
  useEffect(() => {
    const id = window.setInterval(() => {
      void loadCounts();
      if (tab === 'DEPOSITS') void loadQueue('deposit');
      if (tab === 'WITHDRAWALS') void loadQueue('withdraw');
    }, 15000);
    return () => window.clearInterval(id);
  }, [tab, loadCounts, loadQueue]);

  const save = async (patch: Partial<Method>) => {
    setBusy(String(patch.id || 'new'));
    setNote('');
    try {
      const r = await fetch('/api/admin/payment-methods', { method: 'POST', headers: authHeaders(), body: JSON.stringify(patch) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j?.error || 'Could not save.');
      setNote(`Saved ${patch.name || patch.id}.`);
      await loadMethods();
    } catch (e: any) { setNote(e?.message || 'Could not save.'); }
    finally { setBusy(''); }
  };

  const remove = async (id: string) => {
    if (!confirm('Delete this payment method? Disabling it keeps its history readable.')) return;
    setBusy(id);
    try {
      const r = await fetch('/api/admin/payment-methods/delete', { method: 'POST', headers: authHeaders(), body: JSON.stringify({ id }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j?.error || 'Could not delete.');
      setNote('Deleted.');
      await loadMethods();
    } catch (e: any) { setNote(e?.message || 'Could not delete.'); }
    finally { setBusy(''); }
  };

  const review = async (kind: 'deposit' | 'withdraw', id: string, action: 'APPROVE' | 'REJECT') => {
    const body: any = { id, action };
    if (action === 'REJECT' || kind === 'withdraw') {
      const reason = prompt(action === 'REJECT' ? 'Reason for the user (optional)' : 'Payout reference (optional)') || '';
      if (kind === 'withdraw' && action === 'APPROVE') body.payoutRef = reason;
      else body.reason = reason;
    }
    setBusy(id);
    setNote('');
    try {
      const r = await fetch(`/api/admin/payment-requests/${kind}/review`, { method: 'POST', headers: authHeaders(), body: JSON.stringify(body) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j?.error || 'Could not review.');
      setNote(`${kind} ${id} ${action === 'APPROVE' ? (kind === 'deposit' ? 'credited' : 'marked paid') : 'rejected'}.`);
      await loadQueue(kind);
    } catch (e: any) { setNote(e?.message || 'Could not review.'); }
    finally { setBusy(''); }
  };

  const savePolicy = async (patch: Partial<WithdrawalPolicy>) => {
    setBusy('policy'); setNote('');
    try {
      const r = await fetch('/api/admin/withdrawal-policy', { method: 'POST', headers: authHeaders(), body: JSON.stringify(patch) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j?.error || 'Could not save withdrawal policy.');
      setPolicy(j.policy);
      setNote('Withdrawal source rules saved and audit-logged.');
    } catch (e: any) { setNote(e?.message || 'Could not save withdrawal policy.'); }
    finally { setBusy(''); }
  };

  const beginDepositEdit = (d: DepReq) => {
    setEditingDeposit(d);
    setDepositDraft({ methodId: d.methodId, sourceAgentId: d.sourceAgentId || '', amountUsd: Number(d.amountUsd) || 0 });
  };

  const saveDepositEdit = async () => {
    if (!editingDeposit) return;
    setBusy(editingDeposit.id); setNote('');
    try {
      const body: any = { id: editingDeposit.id, methodId: depositDraft.methodId, sourceAgentId: depositDraft.sourceAgentId };
      if (Math.abs(Number(depositDraft.amountUsd) - Number(editingDeposit.amountUsd)) > 1e-8) body.amountUsd = Number(depositDraft.amountUsd);
      const r = await fetch('/api/admin/payment-requests/deposit', {
        method: 'PATCH', headers: authHeaders(), body: JSON.stringify(body),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j?.error || 'Could not update deposit source.');
      setNote(j.unchanged ? 'No deposit changes to save.' : 'Deposit source updated. Any approved amount correction was applied to the user balance and audit-logged.');
      setEditingDeposit(null);
      await Promise.all([loadQueue('deposit'), loadPolicy()]);
    } catch (e: any) { setNote(e?.message || 'Could not update deposit source.'); }
    finally { setBusy(''); }
  };

  const loadEditSourceAgents = async (userId: string, methodId: string) => {
    try {
      const r = await fetch(`/api/admin/withdrawal-sources?userId=${encodeURIComponent(userId)}&methodId=${encodeURIComponent(methodId)}`, { headers: authHeaders() });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j?.error || 'Could not load source agents.');
      setEditSourceAgents(Array.isArray(j.walletAgents) ? j.walletAgents : []);
    } catch { setEditSourceAgents([]); }
  };

  const beginWithdrawalEdit = async (w: WdrReq) => {
    setEditingWithdrawal(w);
    setWithdrawDraft({
      id: w.id, sourceType: w.sourceType || 'PAYMENT_METHOD', methodId: w.methodId,
      agentId: w.agentId || '', amountUsd: Number(w.amountUsd) || 0,
      destination: { ...(w.destination || {}) },
    });
    if (w.sourceType !== 'CASH_AGENT') await loadEditSourceAgents(w.userId, w.methodId);
    else setEditSourceAgents([]);
  };

  const saveWithdrawalEdit = async () => {
    if (!editingWithdrawal) return;
    setBusy(editingWithdrawal.id); setNote('');
    try {
      const body: any = { id: editingWithdrawal.id, agentId: withdrawDraft.agentId };
      if (Math.abs(Number(withdrawDraft.amountUsd) - Number(editingWithdrawal.amountUsd)) > 1e-8) body.amountUsd = Number(withdrawDraft.amountUsd);
      if (editingWithdrawal.sourceType !== 'CASH_AGENT') {
        body.methodId = withdrawDraft.methodId;
        body.destination = withdrawDraft.destination;
      }
      const r = await fetch('/api/admin/payment-requests/withdraw', { method: 'PATCH', headers: authHeaders(), body: JSON.stringify(body) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j?.error || 'Could not edit withdrawal.');
      setNote(j.unchanged ? 'No withdrawal changes to save.' : 'Pending withdrawal updated. Balance, boosted-profit hold and source caps were reconciled and the change was audit-logged.');
      setEditingWithdrawal(null);
      await loadQueue('withdraw');
    } catch (e: any) { setNote(e?.message || 'Could not edit withdrawal.'); }
    finally { setBusy(''); }
  };

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return methods;
    return methods.filter((m) => `${m.id} ${m.name} ${m.category}`.toLowerCase().includes(needle));
  }, [methods, q]);

  const shown = editing || {};
  const set = (k: keyof Method, v: any) => setEditing((e) => ({ ...(e || {}), [k]: v }));

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-1.5">
        {(['METHODS', 'DEPOSITS', 'WITHDRAWALS', 'POLICY'] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)}
            className={`rounded-lg px-2.5 py-1.5 text-[10px] font-bold ${tab === t ? 'bg-amber-500 text-zinc-950' : 'bg-zinc-900 text-zinc-400 hover:bg-zinc-800'}`}>
            {t === 'METHODS' ? 'Payment methods' : t === 'DEPOSITS' ? 'Deposit queue' : t === 'WITHDRAWALS' ? 'Withdraw queue' : 'Withdrawal rules'}
            {(t === 'DEPOSITS' || t === 'WITHDRAWALS') && (t === 'DEPOSITS' ? counts.deposit : counts.withdraw) > 0 && (
              <span className="ml-1 rounded-full bg-rose-500 px-1.5 py-[1px] text-[9px] font-black text-white">
                {t === 'DEPOSITS' ? counts.deposit : counts.withdraw}
              </span>
            )}
          </button>
        ))}
        {tab === 'METHODS' && (
          <button onClick={() => setEditing({ id: '', name: '', category: 'EWALLET', currencies: ['*'], minDeposit: 1, maxDeposit: 100000, minWithdraw: 1, maxWithdraw: 100000 })}
            className="ml-auto rounded-lg border border-amber-500/40 px-2.5 py-1.5 text-[10px] font-bold text-amber-300 hover:bg-amber-500/10">
            + Add method
          </button>
        )}
      </div>

      {note && <div className="rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-[10px] text-zinc-300">{note}</div>}

      {tab === 'METHODS' && (
        <>
          <div className="flex items-center gap-2">
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search method, id or category"
              className="flex-1 rounded-lg border border-zinc-800 bg-zinc-950 px-2.5 py-1.5 text-[10px] text-zinc-200" />
            <button onClick={() => void loadMethods()} className="rounded-lg border border-zinc-700 px-2 py-1.5 text-[10px] text-zinc-400">Refresh</button>
          </div>

          <div className="space-y-1.5">
            {filtered.map((m) => (
              <div key={m.id} className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-2.5">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-amber-400 text-[10px] font-black text-zinc-950">
                    {/^(https?:|data:image\/)/i.test(String(m.logo || '')) ? 'IMG' : (String(m.name || '').match(/[A-Za-z0-9]+/g) || ['•']).slice(0, 2).map((w: string) => w[0].toUpperCase()).join('')}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[11px] font-bold text-zinc-100">{m.name || '(no name)'}</div>
                    <div className="font-mono text-[9px] text-zinc-500">{m.id} · {m.category} · order {m.order} · {m.currencies.join(',') || 'none'}</div>
                  </div>
                  <Toggle on={m.enabled} onChange={(v) => void save({ ...m, enabled: v })} label="enabled" />
                  <Toggle on={m.recommended} onChange={(v) => void save({ ...m, recommended: v })} label="★" />
                  <button onClick={() => setEditing({ ...m })} className="rounded-lg border border-zinc-700 px-2 py-1 text-[9px] font-bold text-zinc-300">Edit</button>
                  <button onClick={() => void remove(m.id)} className="rounded-lg border border-rose-500/40 px-2 py-1 text-[9px] font-bold text-rose-300">Del</button>
                </div>
                <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                  <Toggle on={m.depositEnabled} onChange={(v) => void save({ ...m, depositEnabled: v })} label="deposit" />
                  <Toggle on={m.withdrawEnabled} onChange={(v) => void save({ ...m, withdrawEnabled: v })} label="withdraw" />
                  <Toggle on={m.userDeposit} onChange={(v) => void save({ ...m, userDeposit: v })} label="user dep" />
                  <Toggle on={m.userWithdraw} onChange={(v) => void save({ ...m, userWithdraw: v })} label="user wdr" />
                  <Toggle on={m.agentDeposit} onChange={(v) => void save({ ...m, agentDeposit: v })} label="agent dep" />
                  <Toggle on={m.agentWithdraw} onChange={(v) => void save({ ...m, agentWithdraw: v })} label="agent wdr" />
                  <Toggle on={m.maintenance} onChange={(v) => void save({ ...m, maintenance: v })} label="maintenance" />
                  {m.accountNumber
                    ? <span className="rounded-full bg-emerald-500/10 px-1.5 py-1 text-[8px] font-bold text-emerald-300">acct ✓</span>
                    : <span className="rounded-full bg-amber-500/10 px-1.5 py-1 text-[8px] font-bold text-amber-300">no account</span>}
                  <span className="text-[9px] text-zinc-500">dep {money(m.minDeposit)}–{money(m.maxDeposit)} · wdr {money(m.minWithdraw)}–{money(m.maxWithdraw)}</span>
                </div>
              </div>
            ))}
            {filtered.length === 0 && <div className="rounded-xl border border-zinc-800 p-3 text-[10px] text-zinc-500">No method matches.</div>}
          </div>
        </>
      )}

      {tab === 'POLICY' && (
        <div className="space-y-3 rounded-xl border border-zinc-800 bg-zinc-900/50 p-3">
          <div>
            <div className="text-[12px] font-black text-zinc-100">Withdrawal source limits</div>
            <p className="mt-1 text-[10px] leading-relaxed text-zinc-500">
              These rules cap withdrawals by verified deposits. They do not replace the existing boosted-profit-only rule, wallet balance, method limits, fees, or payout checks. A pending withdrawal reserves its source amount until it is paid or refunded.
            </p>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <div className="rounded-xl border border-zinc-800 bg-zinc-950/70 p-3">
              <div className="text-[10px] font-bold text-zinc-200">Payment-method source cap</div>
              <p className="my-1.5 text-[9px] leading-relaxed text-zinc-500">A withdrawal via a payment method is limited by approved deposits via that same method.</p>
              <Toggle on={policy.methodCapsEnabled} onChange={(v) => void savePolicy({ methodCapsEnabled: v })} label={policy.methodCapsEnabled ? 'cap on' : 'cap off'} disabled={busy === 'policy'} />
            </div>
            <div className="rounded-xl border border-zinc-800 bg-zinc-950/70 p-3">
              <div className="text-[10px] font-bold text-zinc-200">Agent source cap</div>
              <p className="my-1.5 text-[9px] leading-relaxed text-zinc-500">Wallet-agent deposits and cash-agent deposits are tracked separately by agent ID. Payouts reserve against the chosen agent.</p>
              <Toggle on={policy.agentCapsEnabled} onChange={(v) => void savePolicy({ agentCapsEnabled: v })} label={policy.agentCapsEnabled ? 'cap on' : 'cap off'} disabled={busy === 'policy'} />
            </div>
            <div className="rounded-xl border border-zinc-800 bg-zinc-950/70 p-3">
              <div className="text-[10px] font-bold text-zinc-200">Single payment-method exception</div>
              <p className="my-1.5 text-[9px] leading-relaxed text-zinc-500">If the user has approved deposits through only one method, the method cap is removed only for withdrawals to that same method.</p>
              <Toggle on={policy.singleMethodUnlimited} onChange={(v) => void savePolicy({ singleMethodUnlimited: v })} label={policy.singleMethodUnlimited ? 'exception on' : 'exception off'} disabled={busy === 'policy'} />
            </div>
            <div className="rounded-xl border border-zinc-800 bg-zinc-950/70 p-3">
              <div className="text-[10px] font-bold text-zinc-200">Single-agent exception</div>
              <p className="my-1.5 text-[9px] leading-relaxed text-zinc-500">If the user has deposited through only one agent, the agent cap is removed only for withdrawals to that same agent.</p>
              <Toggle on={policy.singleAgentUnlimited} onChange={(v) => void savePolicy({ singleAgentUnlimited: v })} label={policy.singleAgentUnlimited ? 'exception on' : 'exception off'} disabled={busy === 'policy'} />
            </div>
          </div>
          <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-2 text-[9px] leading-relaxed text-amber-100/80">
            “Unlimited” here means no deposit-source cap for that single matching source; boosted-profit availability, wallet balance, the payment method’s configured max, and all other checks still apply. Every policy change is audit-logged.
          </div>
        </div>
      )}

      {(tab === 'DEPOSITS' || tab === 'WITHDRAWALS') && (
        <>
          <div className="flex items-center gap-1.5">
            {['PENDING', 'APPROVED', 'REJECTED', 'COMPLETED', 'CANCELLED', 'EXPIRED', ''].map((s) => (
              <button key={s || 'ALL'} onClick={() => setStatusFilter(s)}
                className={`rounded-lg px-2 py-1 text-[9px] font-bold ${statusFilter === s ? 'bg-zinc-100 text-zinc-950' : 'bg-zinc-900 text-zinc-400'}`}>
                {s || 'ALL'}
              </button>
            ))}
            <button onClick={() => void loadQueue(tab === 'DEPOSITS' ? 'deposit' : 'withdraw')} className="ml-auto rounded-lg border border-zinc-700 px-2 py-1 text-[9px] text-zinc-400">Refresh</button>
          </div>

          {tab === 'DEPOSITS' && (
            <div className="space-y-1.5">
              {deps.map((d) => (
                <div key={d.id} className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-2.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="text-[11px] font-bold text-zinc-100">{money(d.amountUsd)} · {d.methodName}</div>
                      <div className="truncate font-mono text-[9px] text-zinc-500">
                        {d.id} · user #{d.userId} · typed {d.entryAmount} {d.entryCurrency} · ref {d.reference}
                      </div>
                      <div className="text-[9px] text-zinc-600">{when(d.createdAt)}{d.sourceAgentId ? ` · wallet agent ${d.sourceAgentId}` : ''}{d.note ? ` · ${d.note}` : ''}{d.reason ? ` · ${d.reason}` : ''}</div>
                    </div>
                    {['PENDING', 'APPROVED'].includes(d.status) && (
                      <button disabled={busy === d.id} onClick={() => beginDepositEdit(d)}
                        className="rounded-lg border border-sky-500/40 px-2 py-1 text-[9px] font-bold text-sky-200 disabled:opacity-50">Edit source</button>
                    )}
                    <span className="rounded-full border border-zinc-700 px-1.5 py-0.5 text-[8px] font-bold text-zinc-300">{d.status}</span>
                    {d.status === 'PENDING' && (
                      <>
                        <button disabled={busy === d.id} onClick={() => void review('deposit', d.id, 'APPROVE')}
                          className="rounded-lg bg-emerald-500 px-2 py-1 text-[9px] font-black text-zinc-950 disabled:opacity-50">Credit</button>
                        <button disabled={busy === d.id} onClick={() => void review('deposit', d.id, 'REJECT')}
                          className="rounded-lg border border-rose-500/40 px-2 py-1 text-[9px] font-bold text-rose-300 disabled:opacity-50">Reject</button>
                      </>
                    )}
                  </div>
                </div>
              ))}
              {deps.length === 0 && <div className="rounded-xl border border-zinc-800 p-3 text-[10px] text-zinc-500">No deposit requests in this view.</div>}
            </div>
          )}

          {tab === 'WITHDRAWALS' && (
            <div className="space-y-1.5">
              {wdrs.map((w) => (
                <div key={w.id} className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-2.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="text-[11px] font-bold text-zinc-100">{money(w.amountUsd)} · {w.methodName}</div>
                      <div className="truncate font-mono text-[9px] text-zinc-500">
                        {w.id} · user #{w.userId} · net {money(w.netUsd)} · fee {money(w.feeUsd)}{w.agentId ? ` · agent ${w.agentId}` : ''}
                      </div>
                      <div className="truncate text-[9px] text-zinc-400">
                        {Object.entries(w.destination || {}).map(([k, v]) => `${k}: ${v}`).join(' · ')}
                      </div>
                      <div className="text-[9px] text-zinc-600">{when(w.createdAt)}{w.reason ? ` · ${w.reason}` : ''}{w.payoutRef ? ` · payout ${w.payoutRef}` : ''}</div>
                    </div>
                    {w.status === 'PENDING' && (
                      <button disabled={busy === w.id} onClick={() => beginWithdrawalEdit(w)}
                        className="rounded-lg border border-sky-500/40 px-2 py-1 text-[9px] font-bold text-sky-200 disabled:opacity-50">Edit</button>
                    )}
                    <span className="rounded-full border border-zinc-700 px-1.5 py-0.5 text-[8px] font-bold text-zinc-300">{w.status}</span>
                    {w.status === 'PENDING' && w.sourceType !== 'CASH_AGENT' && (
                      <>
                        <button disabled={busy === w.id} onClick={() => void review('withdraw', w.id, 'APPROVE')}
                          className="rounded-lg bg-emerald-500 px-2 py-1 text-[9px] font-black text-zinc-950 disabled:opacity-50">Mark paid</button>
                        <button disabled={busy === w.id} onClick={() => void review('withdraw', w.id, 'REJECT')}
                          className="rounded-lg border border-rose-500/40 px-2 py-1 text-[9px] font-bold text-rose-300 disabled:opacity-50">Reject + refund</button>
                      </>
                    )}
                  </div>
                </div>
              ))}
              {wdrs.length === 0 && (
                <div className="rounded-xl border border-zinc-800 p-3 text-[10px] text-zinc-500">
                  No withdrawal requests in this view. New requests appear here automatically within 15 seconds.
                </div>
              )}
            </div>
          )}
        </>
      )}

      {editingDeposit && (
        <div className="fixed inset-0 z-[90] flex items-end justify-center bg-black/70 p-0 sm:items-center sm:p-4" onClick={() => setEditingDeposit(null)}>
          <div className="max-h-[92vh] w-full max-w-xl overflow-y-auto rounded-t-3xl border border-zinc-700 bg-zinc-950 p-4 sm:rounded-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between">
              <div>
                <div className="text-[12px] font-bold text-white">Edit deposit source · {editingDeposit.id}</div>
                <div className="text-[9px] text-zinc-500">User #{editingDeposit.userId} · {editingDeposit.status}</div>
              </div>
              <button onClick={() => setEditingDeposit(null)} className="text-[10px] text-zinc-400">Close</button>
            </div>
            <div className="grid gap-2">
              <label className="text-[9px] text-zinc-400">Payment method
                <select value={depositDraft.methodId} onChange={(e) => setDepositDraft((d) => ({ ...d, methodId: e.target.value, sourceAgentId: '' }))}
                  className="mt-1 w-full rounded-lg border border-zinc-800 bg-zinc-900 px-2 py-2 text-[11px] text-zinc-100">
                  {methods.filter((m) => m.category !== 'AGENT').map((m) => <option key={m.id} value={m.id}>{m.name} · {m.id}</option>)}
                </select>
              </label>
              <label className="text-[9px] text-zinc-400">Wallet agent source (optional)
                <select value={depositDraft.sourceAgentId} onChange={(e) => setDepositDraft((d) => ({ ...d, sourceAgentId: e.target.value }))}
                  className="mt-1 w-full rounded-lg border border-zinc-800 bg-zinc-900 px-2 py-2 text-[11px] text-zinc-100">
                  <option value="">No wallet-agent source / Admin handled</option>
                  {walletAgentOptions.filter((a) => a.methodId === depositDraft.methodId).map((a) => (
                    <option key={a.id} value={a.id}>{a.name || a.id} · {a.id}{a.active ? '' : ' (disabled)'}</option>
                  ))}
                </select>
              </label>
              <label className="text-[9px] text-zinc-400">Credited amount (USD)
                <input type="number" min="0.01" step="0.01" value={depositDraft.amountUsd}
                  onChange={(e) => setDepositDraft((d) => ({ ...d, amountUsd: Number(e.target.value) }))}
                  className="mt-1 w-full rounded-lg border border-zinc-800 bg-zinc-900 px-2 py-2 font-mono text-[12px] text-zinc-100" />
              </label>
              <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-2 text-[9px] leading-relaxed text-amber-100/80">
                {editingDeposit.status === 'APPROVED'
                  ? 'Changing an approved deposit amount also adjusts the user’s wallet balance and linked ledger record. A reduction is rejected if the current balance cannot cover it. The correction is audit-logged.'
                  : 'This amount is the value that will be credited if the pending deposit is approved. Method, source-agent and amount changes are audit-logged.'}
              </div>
            </div>
            <div className="mt-3 flex gap-2">
              <button onClick={() => void saveDepositEdit()} disabled={busy === editingDeposit.id}
                className="h-10 flex-1 rounded-xl bg-amber-500 text-[11px] font-black text-zinc-950 disabled:opacity-50">Save source</button>
              <button onClick={() => setEditingDeposit(null)} className="h-10 rounded-xl border border-zinc-700 px-3 text-[11px] text-zinc-300">Cancel</button>
            </div>
          </div>
        </div>
      )}

      {editingWithdrawal && (
        <div className="fixed inset-0 z-[90] flex items-end justify-center bg-black/70 p-0 sm:items-center sm:p-4" onClick={() => setEditingWithdrawal(null)}>
          <div className="max-h-[92vh] w-full max-w-xl overflow-y-auto rounded-t-3xl border border-zinc-700 bg-zinc-950 p-4 sm:rounded-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between">
              <div>
                <div className="text-[12px] font-bold text-white">Edit pending withdrawal · {editingWithdrawal.id}</div>
                <div className="text-[9px] text-zinc-500">User #{editingWithdrawal.userId} · {editingWithdrawal.sourceType === 'CASH_AGENT' ? 'Cash-agent claim' : 'Payment-method request'}</div>
              </div>
              <button onClick={() => setEditingWithdrawal(null)} className="text-[10px] text-zinc-400">Close</button>
            </div>
            <div className="grid gap-2">
              {editingWithdrawal.sourceType === 'CASH_AGENT' ? (
                <>
                  <label className="text-[9px] text-zinc-400">Cash agent
                    <select value={withdrawDraft.agentId || ''} onChange={(e) => setWithdrawDraft((d: any) => ({ ...d, agentId: e.target.value }))}
                      className="mt-1 w-full rounded-lg border border-zinc-800 bg-zinc-900 px-2 py-2 text-[11px] text-zinc-100">
                      {cashAgentOptions.map((a) => <option key={a.id} value={a.id} disabled={!a.active}>{a.name || a.id} · {a.id}{a.active ? '' : ' (disabled)'}</option>)}
                    </select>
                  </label>
                  <label className="text-[9px] text-zinc-400">Cash handover amount (USD)
                    <input type="number" min="0.01" step="0.01" value={Number(withdrawDraft.amountUsd) || 0}
                      onChange={(e) => setWithdrawDraft((d: any) => ({ ...d, amountUsd: Number(e.target.value) }))}
                      className="mt-1 w-full rounded-lg border border-zinc-800 bg-zinc-900 px-2 py-2 font-mono text-[12px] text-zinc-100" />
                  </label>
                  <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-2 text-[9px] leading-relaxed text-amber-100/80">
                    Saving changes the reserved wallet amount and boosted-profit hold as needed, checks the new agent source cap, and issues a new claim code with a fresh 30-minute expiry. The previous code stops working.
                  </div>
                </>
              ) : (
                <>
                  <label className="text-[9px] text-zinc-400">Payment method
                    <select value={withdrawDraft.methodId || ''} onChange={(e) => {
                      const methodId = e.target.value;
                      setWithdrawDraft((d: any) => ({ ...d, methodId, agentId: '', destination: { ...d.destination } }));
                      if (editingWithdrawal) void loadEditSourceAgents(editingWithdrawal.userId, methodId);
                    }}
                      className="mt-1 w-full rounded-lg border border-zinc-800 bg-zinc-900 px-2 py-2 text-[11px] text-zinc-100">
                      {policyMethods.filter((m) => m.category !== 'AGENT').map((m) => <option key={m.id} value={m.id}>{m.name} · {m.id}</option>)}
                    </select>
                  </label>
                  <label className="text-[9px] text-zinc-400">Wallet agent (when the user deposited through one)
                    <select value={withdrawDraft.agentId || ''} onChange={(e) => setWithdrawDraft((d: any) => ({ ...d, agentId: e.target.value }))}
                      className="mt-1 w-full rounded-lg border border-zinc-800 bg-zinc-900 px-2 py-2 text-[11px] text-zinc-100">
                      <option value="">No assigned wallet agent</option>
                      {editSourceAgents.map((a) => (
                        <option key={a.id} value={a.id} disabled={!a.unlimited && a.availableUsd <= 0}>
                          {a.name || a.id} · {a.id} · {a.unlimited ? 'unlimited source cap' : `${money(a.availableUsd)} remaining`}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="text-[9px] text-zinc-400">Withdrawal amount (USD)
                    <input type="number" min="0.01" step="0.01" value={Number(withdrawDraft.amountUsd) || 0}
                      onChange={(e) => setWithdrawDraft((d: any) => ({ ...d, amountUsd: Number(e.target.value) }))}
                      className="mt-1 w-full rounded-lg border border-zinc-800 bg-zinc-900 px-2 py-2 font-mono text-[12px] text-zinc-100" />
                  </label>
                  {(policyMethods.find((m) => m.id === withdrawDraft.methodId)?.withdrawFields || []).map((field) => (
                    <label key={field.key} className="text-[9px] text-zinc-400">{field.label}
                      <input value={withdrawDraft.destination?.[field.key] || ''}
                        onChange={(e) => setWithdrawDraft((d: any) => ({ ...d, destination: { ...(d.destination || {}), [field.key]: e.target.value } }))}
                        placeholder={field.placeholder}
                        className="mt-1 w-full rounded-lg border border-zinc-800 bg-zinc-900 px-2 py-2 text-[11px] text-zinc-100" />
                    </label>
                  ))}
                  <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-2 text-[9px] leading-relaxed text-amber-100/80">
                    Saving reconciles the debited balance and boosted-profit hold, recalculates method fees, validates source caps and required payout fields, and audit-logs the change. Edits are allowed only while pending.
                  </div>
                </>
              )}
            </div>
            <div className="mt-3 flex gap-2">
              <button onClick={() => void saveWithdrawalEdit()} disabled={busy === editingWithdrawal.id}
                className="h-10 flex-1 rounded-xl bg-amber-500 text-[11px] font-black text-zinc-950 disabled:opacity-50">Save withdrawal</button>
              <button onClick={() => setEditingWithdrawal(null)} className="h-10 rounded-xl border border-zinc-700 px-3 text-[11px] text-zinc-300">Cancel</button>
            </div>
          </div>
        </div>
      )}

      {editing && (
        <div className="fixed inset-0 z-[80] flex items-end justify-center bg-black/70 p-0 sm:items-center sm:p-4" onClick={() => setEditing(null)}>
          <div className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-t-3xl border border-zinc-700 bg-zinc-950 p-4 sm:rounded-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-2 flex items-center justify-between">
              <div className="text-[12px] font-bold text-white">{editing.id ? `Edit ${editing.id}` : 'New payment method'}</div>
              <button onClick={() => setEditing(null)} className="text-[10px] text-zinc-400">Close</button>
            </div>

            <div className="grid gap-2 sm:grid-cols-2">
              <label className="text-[9px] text-zinc-400">Name
                <input value={String(shown.name || '')} onChange={(e) => set('name', e.target.value)}
                  className="mt-1 w-full rounded-lg border border-zinc-800 bg-zinc-900 px-2 py-1.5 text-[11px] text-zinc-100" />
              </label>
              <label className="text-[9px] text-zinc-400">ID (auto if empty)
                <input value={String(shown.id || '')} onChange={(e) => set('id', e.target.value.toUpperCase())} disabled={!!methods.find((m) => m.id === editing.id)}
                  className="mt-1 w-full rounded-lg border border-zinc-800 bg-zinc-900 px-2 py-1.5 font-mono text-[10px] text-zinc-100 disabled:opacity-60" />
              </label>
              <label className="text-[9px] text-zinc-400">Logo image URL (blank = initials)
                <input value={String(shown.logo || '')} onChange={(e) => set('logo', e.target.value)} maxLength={300}
                  className="mt-1 w-full rounded-lg border border-zinc-800 bg-zinc-900 px-2 py-1.5 text-[11px] text-zinc-100" />
              </label>
              <label className="text-[9px] text-zinc-400">Category
                <select value={String(shown.category || 'EWALLET')} onChange={(e) => set('category', e.target.value)}
                  className="mt-1 w-full rounded-lg border border-zinc-800 bg-zinc-900 px-2 py-1.5 text-[11px] text-zinc-100">
                  {(cats.length ? cats : [{ id: 'EWALLET', label: 'E-Wallets', icon: '' }, { id: 'BANK', label: 'Internet Banking', icon: '' }, { id: 'CRYPTO', label: 'Cryptocurrency', icon: '' }, { id: 'AGENT', label: 'Telegram Agent', icon: '' }])
                    .map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
                </select>
              </label>
              <label className="text-[9px] text-zinc-400">Display order
                <input type="number" value={Number(shown.order ?? 100)} onChange={(e) => set('order', Number(e.target.value))}
                  className="mt-1 w-full rounded-lg border border-zinc-800 bg-zinc-900 px-2 py-1.5 text-[11px] text-zinc-100" />
              </label>
              <label className="text-[9px] text-zinc-400">Recommended order
                <input type="number" value={Number(shown.recommendedOrder ?? 0)} onChange={(e) => set('recommendedOrder', Number(e.target.value))}
                  className="mt-1 w-full rounded-lg border border-zinc-800 bg-zinc-900 px-2 py-1.5 text-[11px] text-zinc-100" />
              </label>
              <label className="text-[9px] text-zinc-400">Processing time
                <input value={String(shown.processingTime || '')} onChange={(e) => set('processingTime', e.target.value)}
                  className="mt-1 w-full rounded-lg border border-zinc-800 bg-zinc-900 px-2 py-1.5 text-[11px] text-zinc-100" />
              </label>
              <label className="text-[9px] text-zinc-400">Currencies (* for all, or BDT,USD)
                <input value={(shown.currencies || []).join(',')} onChange={(e) => set('currencies', e.target.value.split(',').map((s) => s.trim().toUpperCase()).filter(Boolean))}
                  className="mt-1 w-full rounded-lg border border-zinc-800 bg-zinc-900 px-2 py-1.5 font-mono text-[10px] text-zinc-100" />
              </label>
              <div className="text-[9px] text-zinc-400 sm:col-span-2">
                Countries where this method is offered
                <div className="mt-1 flex flex-wrap items-center gap-1">
                  {(shown.countries || []).length === 0 ? (
                    <span className="rounded-full border border-zinc-700 bg-zinc-900 px-2 py-0.5 text-[10px] text-zinc-300">
                      Every country
                    </span>
                  ) : (shown.countries || []).map((cc) => (
                    <span key={cc} className="inline-flex items-center gap-1 rounded-full border border-amber-700/60 bg-amber-500/10 px-2 py-0.5 text-[10px] font-bold text-amber-200">
                      {countryOpts.find((c) => c.code === cc)?.flag || ''} {cc} {countryOpts.find((c) => c.code === cc)?.label || ''}
                      <button type="button" onClick={() => set('countries', (shown.countries || []).filter((x) => x !== cc))}
                        className="text-amber-300/70 hover:text-rose-300">×</button>
                    </span>
                  ))}
                </div>
                <div className="mt-1 flex gap-1">
                  <select value="" onChange={(e) => {
                    const cc = e.target.value;
                    if (cc && !(shown.countries || []).includes(cc)) set('countries', [...(shown.countries || []), cc]);
                  }} className="w-full rounded-lg border border-zinc-800 bg-zinc-900 px-2 py-1.5 text-[10px] text-zinc-100">
                    <option value="">+ Add a country…</option>
                    {countryOpts.filter((c) => !(shown.countries || []).includes(c.code)).map((c) => (
                      <option key={c.code} value={c.code}>{c.flag} {c.code} — {c.label}</option>
                    ))}
                  </select>
                  {(shown.countries || []).length > 0 ? (
                    <button type="button" onClick={() => set('countries', [])}
                      className="shrink-0 rounded-lg border border-zinc-700 px-2 py-1 text-[10px] font-bold text-zinc-300">All</button>
                  ) : null}
                </div>
                <div className="mt-0.5 text-[9px] leading-relaxed text-zinc-600">
                  A user only sees the methods of their own country (from the currency they picked). Empty = shown everywhere.
                </div>
              </div>
              {(['minDeposit', 'maxDeposit', 'minWithdraw', 'maxWithdraw', 'depositFeePercent', 'withdrawFeePercent'] as const).map((k) => (
                <label key={k} className="text-[9px] text-zinc-400">{k}
                  <input type="number" step="0.01" value={Number((shown as any)[k] ?? 0)} onChange={(e) => set(k, Number(e.target.value))}
                    className="mt-1 w-full rounded-lg border border-zinc-800 bg-zinc-900 px-2 py-1.5 text-[11px] text-zinc-100" />
                </label>
              ))}
              <label className="text-[9px] text-zinc-400">Account name (deposit)
                <input value={String(shown.accountName || '')} onChange={(e) => set('accountName', e.target.value)}
                  className="mt-1 w-full rounded-lg border border-zinc-800 bg-zinc-900 px-2 py-1.5 text-[11px] text-zinc-100" />
              </label>
              <label className="text-[9px] text-zinc-400">Account / wallet number (deposit)
                <input value={String(shown.accountNumber || '')} onChange={(e) => set('accountNumber', e.target.value)}
                  className="mt-1 w-full rounded-lg border border-zinc-800 bg-zinc-900 px-2 py-1.5 font-mono text-[11px] text-zinc-100" />
              </label>
              <label className="text-[9px] text-zinc-400 sm:col-span-2">Instructions shown to the user
                <textarea value={String(shown.instructions || '')} onChange={(e) => set('instructions', e.target.value)} rows={2}
                  className="mt-1 w-full rounded-lg border border-zinc-800 bg-zinc-900 px-2 py-1.5 text-[11px] text-zinc-100" />
              </label>
              <label className="text-[9px] text-zinc-400 sm:col-span-2">Maintenance message
                <input value={String(shown.maintenanceMessage || '')} onChange={(e) => set('maintenanceMessage', e.target.value)}
                  className="mt-1 w-full rounded-lg border border-zinc-800 bg-zinc-900 px-2 py-1.5 text-[11px] text-zinc-100" />
              </label>
            </div>

            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {([['enabled', 'enabled'], ['recommended', '★ recommended'], ['depositEnabled', 'deposit'], ['withdrawEnabled', 'withdraw'],
                ['userDeposit', 'user deposit'], ['userWithdraw', 'user withdraw'], ['agentDeposit', 'agent deposit'], ['agentWithdraw', 'agent withdraw'],
                ['maintenance', 'maintenance']] as const).map(([k, label]) => (
                <Toggle key={k} on={!!(shown as any)[k]} label={label} onChange={(v) => set(k, v)} />
              ))}
            </div>

            <div className="mt-3 flex gap-2">
              <button
                onClick={() => { void save({ ...(editing as Method) }); setEditing(null); }}
                className="h-10 flex-1 rounded-xl bg-amber-500 text-[11px] font-black text-zinc-950 disabled:opacity-50"
                disabled={busy === String(editing.id || 'new')}
              >
                Save
              </button>
              <button onClick={() => setEditing(null)} className="h-10 rounded-xl border border-zinc-700 px-3 text-[11px] text-zinc-300">Cancel</button>
            </div>
            <p className="mt-2 text-[9px] leading-relaxed text-zinc-600">
              A method only accepts deposits once its account number is filled in. Recommended is a display position only — the method
              stays in its own category and is never duplicated.
            </p>
          </div>
        </div>
      )}
    </div>
  );
};

export default PaymentAdmin;
