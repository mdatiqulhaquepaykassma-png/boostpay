/**
 * Admin → Payments.
 *
 * Three things in one screen: the method catalogue (add / edit / enable / disable /
 * recommended / audience / limits / currencies / maintenance), the deposit queue and
 * the withdrawal queue. Nothing here credits money on its own — an admin decision
 * does, and every decision is written to the audit log by the server.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';

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
  entryCurrency: string; reference: string; note?: string; status: string; createdAt: number; reviewedBy?: string; reason?: string;
};
type WdrReq = {
  id: string; userId: string; methodId: string; methodName: string; amountUsd: number; feeUsd: number; netUsd: number;
  entryAmount: number; entryCurrency: string; destination: Record<string, string>; status: string; createdAt: number;
  reviewedBy?: string; reason?: string; payoutRef?: string;
};

const TOKEN_KEYS = ['boostpay_auth_token_v1', 'admin_token', 'token'];
function authHeaders(): Record<string, string> {
  let t = '';
  for (const k of TOKEN_KEYS) { const v = localStorage.getItem(k); if (v) { t = v; break; } }
  return { 'content-type': 'application/json', ...(t ? { authorization: `Bearer ${t}` } : {}) };
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
  const [tab, setTab] = useState<'METHODS' | 'DEPOSITS' | 'WITHDRAWALS'>('METHODS');
  const [cats, setCats] = useState<Cat[]>([]);
  const [methods, setMethods] = useState<Method[]>([]);
  const [deps, setDeps] = useState<DepReq[]>([]);
  const [wdrs, setWdrs] = useState<WdrReq[]>([]);
  const [statusFilter, setStatusFilter] = useState('PENDING');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState('');
  const [editing, setEditing] = useState<Partial<Method> | null>(null);
  const [q, setQ] = useState('');

  const loadMethods = useCallback(async () => {
    try {
      const r = await fetch('/api/admin/payment-methods', { headers: authHeaders() });
      if (!r.ok) { setNote(`Could not load the methods (HTTP ${r.status}).`); return; }
      const j = await r.json();
      setMethods(Array.isArray(j.methods) ? j.methods : []);
      setCats(Array.isArray(j.categories) ? j.categories : []);
    } catch { setNote('Could not load the methods.'); }
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

  useEffect(() => { void loadMethods(); }, [loadMethods]);
  useEffect(() => {
    if (tab === 'DEPOSITS') void loadQueue('deposit');
    if (tab === 'WITHDRAWALS') void loadQueue('withdraw');
  }, [tab, loadQueue]);

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
        {(['METHODS', 'DEPOSITS', 'WITHDRAWALS'] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)}
            className={`rounded-lg px-2.5 py-1.5 text-[10px] font-bold ${tab === t ? 'bg-amber-500 text-zinc-950' : 'bg-zinc-900 text-zinc-400 hover:bg-zinc-800'}`}>
            {t === 'METHODS' ? 'Payment methods' : t === 'DEPOSITS' ? 'Deposit queue' : 'Withdraw queue'}
          </button>
        ))}
        <button onClick={() => setEditing({ id: '', name: '', category: 'EWALLET', currencies: ['*'], minDeposit: 1, maxDeposit: 100000, minWithdraw: 1, maxWithdraw: 100000 })}
          className="ml-auto rounded-lg border border-amber-500/40 px-2.5 py-1.5 text-[10px] font-bold text-amber-300 hover:bg-amber-500/10">
          + Add method
        </button>
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

      {(tab === 'DEPOSITS' || tab === 'WITHDRAWALS') && (
        <>
          <div className="flex items-center gap-1.5">
            {['PENDING', 'APPROVED', 'REJECTED', 'COMPLETED', ''].map((s) => (
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
                      <div className="text-[9px] text-zinc-600">{when(d.createdAt)}{d.note ? ` · ${d.note}` : ''}{d.reason ? ` · ${d.reason}` : ''}</div>
                    </div>
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
                        {w.id} · user #{w.userId} · net {money(w.netUsd)} · fee {money(w.feeUsd)}
                      </div>
                      <div className="truncate text-[9px] text-zinc-400">
                        {Object.entries(w.destination || {}).map(([k, v]) => `${k}: ${v}`).join(' · ')}
                      </div>
                      <div className="text-[9px] text-zinc-600">{when(w.createdAt)}{w.reason ? ` · ${w.reason}` : ''}{w.payoutRef ? ` · payout ${w.payoutRef}` : ''}</div>
                    </div>
                    <span className="rounded-full border border-zinc-700 px-1.5 py-0.5 text-[8px] font-bold text-zinc-300">{w.status}</span>
                    {w.status === 'PENDING' && (
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
              {wdrs.length === 0 && <div className="rounded-xl border border-zinc-800 p-3 text-[10px] text-zinc-500">No withdrawal requests in this view.</div>}
            </div>
          )}
        </>
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
              <label className="text-[9px] text-zinc-400">Country restriction (BD,IN — empty = all)
                <input value={(shown.countries || []).join(',')} onChange={(e) => set('countries', e.target.value.split(',').map((s) => s.trim().toUpperCase()).filter(Boolean))}
                  className="mt-1 w-full rounded-lg border border-zinc-800 bg-zinc-900 px-2 py-1.5 font-mono text-[10px] text-zinc-100" />
              </label>
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
