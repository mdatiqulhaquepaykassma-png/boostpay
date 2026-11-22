import { FC, useCallback, useEffect, useState } from 'react';
import { AlertTriangle, Eye, EyeOff, Loader2, RefreshCw, Save, ShieldCheck, Store } from 'lucide-react';
import { BoostPayStore } from '../services/store';

type MethodControl = {
  id: string;
  name: string;
  category: string;
  enabled: boolean;
  withdrawEnabled: boolean;
  userWithdraw: boolean;
  hidden: boolean;
  canSetCap: boolean;
  creditedUsd: number;
  reservedUsd: number;
  adminCapUsd: number | null;
  effectiveAvailableUsd: number;
  effectiveUnlimited: boolean;
  capEnabled: boolean;
};

type CashAgent = {
  id: string; name: string; active: boolean; sourceCapEnabled?: boolean;
  sourceDepositedUsd?: number; sourceAvailableUsd?: number; sourceUnlimited?: boolean;
};
type Controls = { hiddenMethodIds: string[]; methodCapOverridesUsd: Record<string, number>; preferredCashAgentId: string; fixedCashAgentId: string };

const money = (value: number) => `$${(Number.isFinite(Number(value)) ? Number(value) : 0).toFixed(2)}`;

export const UserWithdrawalControlsCard: FC<{ userId: string; className?: string }> = ({ userId, className = '' }) => {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [methods, setMethods] = useState<MethodControl[]>([]);
  const [cashAgents, setCashAgents] = useState<CashAgent[]>([]);
  const [hiddenMethodIds, setHiddenMethodIds] = useState<string[]>([]);
  const [capDraft, setCapDraft] = useState<Record<string, string>>({});
  const [preferredCashAgentId, setPreferredCashAgentId] = useState('');
  const [forceCashAgent, setForceCashAgent] = useState(false);
  const [globalMethodCapsEnabled, setGlobalMethodCapsEnabled] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = useCallback(async (quiet = false) => {
    if (!quiet) { setLoading(true); setError(''); setNotice(''); }
    try {
      const res = await fetch(`/api/admin/users/${encodeURIComponent(userId)}/withdrawal-controls`, {
        headers: BoostPayStore.adminAuthHeaders(),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) throw new Error(json?.error || `Could not load withdrawal controls (HTTP ${res.status}).`);
      const rows: MethodControl[] = Array.isArray(json?.methods) ? json.methods : [];
      const controls: Controls = json?.controls || { hiddenMethodIds: [], methodCapOverridesUsd: {}, preferredCashAgentId: '', fixedCashAgentId: '' };
      setMethods(rows);
      setCashAgents(Array.isArray(json?.cashAgents) ? json.cashAgents : []);
      setHiddenMethodIds(Array.isArray(controls.hiddenMethodIds) ? controls.hiddenMethodIds : []);
      const caps: Record<string, string> = {};
      for (const row of rows) {
        if (row.canSetCap && row.adminCapUsd !== null && row.adminCapUsd !== undefined) caps[row.id] = String(row.adminCapUsd);
      }
      setCapDraft(caps);
      setPreferredCashAgentId(String(controls.preferredCashAgentId || controls.fixedCashAgentId || ''));
      setForceCashAgent(!!controls.fixedCashAgentId);
      setGlobalMethodCapsEnabled(json?.globalMethodCapsEnabled !== false);
    } catch (err: any) {
      setError(err?.message || 'Could not load withdrawal controls.');
    } finally {
      if (!quiet) setLoading(false);
    }
  }, [userId]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const onUpdated = (event: Event) => {
      const detail = (event as CustomEvent<{ userId?: string }>).detail;
      if (String(detail?.userId || '') === String(userId)) void load(true);
    };
    window.addEventListener('boostpay:user-withdrawal-controls-updated', onUpdated);
    return () => window.removeEventListener('boostpay:user-withdrawal-controls-updated', onUpdated);
  }, [load, userId]);

  const handleSave = async () => {
    setError(''); setNotice('');
    const methodCapOverridesUsd: Record<string, number> = {};
    for (const method of methods) {
      if (!method.canSetCap) continue;
      const raw = String(capDraft[method.id] ?? '').trim();
      if (!raw) continue; // blank removes any Admin-only reduction for this method
      const value = Number(raw);
      const source = Number(method.creditedUsd) || 0;
      if (!Number.isFinite(value) || value < 0) {
        setError(`Enter a valid non-negative cap for ${method.name}.`);
        return;
      }
      if (Number(value.toFixed(8)) > Number(source.toFixed(8))) {
        setError(`${method.name} cannot be capped above its ${money(source)} credited deposit source.`);
        return;
      }
      methodCapOverridesUsd[method.id] = Number(value.toFixed(8));
    }

    if (forceCashAgent && !preferredCashAgentId) {
      setError('Choose a Cash Agent before requiring it for future withdrawals.');
      return;
    }

    setSaving(true);
    try {
      const res = await fetch(`/api/admin/users/${encodeURIComponent(userId)}/withdrawal-controls`, {
        method: 'POST',
        headers: BoostPayStore.adminAuthHeaders(),
        body: JSON.stringify({
          hiddenMethodIds,
          methodCapOverridesUsd,
          preferredCashAgentId,
          fixedCashAgentId: forceCashAgent ? preferredCashAgentId : '',
        }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) throw new Error(json?.error || `Could not save withdrawal controls (HTTP ${res.status}).`);
      setNotice('Saved. These controls apply only to this user; existing pending Cash Agent requests are unchanged.');
      await load(true);
      window.dispatchEvent(new CustomEvent('boostpay:user-withdrawal-controls-updated', { detail: { userId: String(userId) } }));
    } catch (err: any) {
      setError(err?.message || 'Could not save withdrawal controls.');
    } finally {
      setSaving(false);
    }
  };

  const toggleHidden = (methodId: string, hidden: boolean) => {
    setHiddenMethodIds((prev) => hidden
      ? Array.from(new Set([...prev, methodId]))
      : prev.filter((id) => id !== methodId));
  };

  return (
    <section className={`rounded-2xl border border-violet-500/25 bg-zinc-950 p-4 space-y-3 ${className}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h4 className="flex items-center gap-2 text-xs font-bold text-white">
            <ShieldCheck className="h-4 w-4 text-violet-300" /> Per-user withdrawal controls
          </h4>
          <p className="mt-1 text-[10px] leading-relaxed text-zinc-400">
            Visibility and source caps here affect User #{userId} only. Caps are lifetime totals and can never exceed credited deposits for that method.
          </p>
        </div>
        <button type="button" onClick={() => void load()} disabled={loading || saving}
          className="rounded-lg border border-zinc-700 bg-zinc-900 p-2 text-zinc-400 hover:text-white disabled:opacity-50" title="Refresh controls">
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {error && <div className="flex items-start gap-2 rounded-xl border border-rose-500/30 bg-rose-500/10 p-2.5 text-[10px] font-semibold text-rose-200"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />{error}</div>}
      {notice && <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-2.5 text-[10px] font-semibold text-emerald-200">{notice}</div>}

      <div className="rounded-xl border border-zinc-800 bg-zinc-900/70 p-3 space-y-2">
        <div className="flex items-center gap-2 text-[11px] font-bold text-zinc-100"><Store className="h-3.5 w-3.5 text-emerald-300" /> Future Cash Agent payout handler</div>
        <label className="block">
          <span className="mb-1 block text-[9px] uppercase tracking-wider text-zinc-500">Suggested Cash Agent (AGT)</span>
          <select value={preferredCashAgentId} onChange={(e) => setPreferredCashAgentId(e.target.value)} disabled={loading || saving}
            className="w-full rounded-xl border border-zinc-700 bg-zinc-950 px-3 py-2 text-[11px] text-white outline-none focus:border-emerald-500/60 disabled:opacity-60">
            <option value="">No preference — let the user choose an eligible agent</option>
            {cashAgents.map((agent) => (
              <option key={agent.id} value={agent.id}>
                {agent.name} · {agent.id}{agent.active ? '' : ' · inactive'}{agent.sourceCapEnabled ? ` · ${agent.sourceUnlimited ? 'unlimited' : money(Number(agent.sourceAvailableUsd) || 0) + ' source left'}` : ''}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-start gap-2 rounded-lg border border-zinc-800 bg-zinc-950 px-2.5 py-2 text-[9px] text-zinc-300">
          <input type="checkbox" checked={forceCashAgent} onChange={(e) => setForceCashAgent(e.target.checked)} disabled={loading || saving || !preferredCashAgentId}
            className="mt-0.5 accent-emerald-400" />
          <span><b className="text-amber-200">Require this agent</b> — users cannot switch to another Cash Agent for new withdrawals.</span>
        </label>
        <p className="text-[9px] leading-relaxed text-zinc-500">
          The suggested agent is preselected but may be changed by the user unless required. Existing pending requests are not reassigned. The current AGT deposit-source match and cap still apply; this does not change Wallet Agent (WAG) deposit attribution.
        </p>
      </div>

      <div className="flex items-center justify-between gap-2">
        <div>
          <div className="text-[11px] font-bold text-zinc-100">Withdrawal methods</div>
          <div className="text-[9px] text-zinc-500">Hiding does not affect deposits or global method settings.</div>
        </div>
        {!globalMethodCapsEnabled && <span className="rounded-full border border-amber-500/20 bg-amber-500/10 px-2 py-1 text-[8px] text-amber-200">Global source caps off</span>}
      </div>

      {loading ? (
        <div className="flex items-center justify-center gap-2 py-8 text-[10px] text-zinc-500"><Loader2 className="h-4 w-4 animate-spin" />Loading credited source data…</div>
      ) : (
        <div className="max-h-[360px] space-y-2 overflow-y-auto pr-1">
          {methods.map((method) => {
            const isHidden = hiddenMethodIds.includes(method.id);
            const source = Number(method.creditedUsd) || 0;
            const capValue = String(capDraft[method.id] ?? '');
            const overSource = capValue.trim() !== '' && Number.isFinite(Number(capValue))
              && Number(Number(capValue).toFixed(8)) > Number(source.toFixed(8));
            return (
              <div key={method.id} className={`rounded-xl border p-2.5 ${isHidden ? 'border-rose-500/20 bg-rose-500/[0.035]' : 'border-zinc-800 bg-zinc-900/50'}`}>
                <div className="flex items-start gap-2">
                  <button type="button" role="switch" aria-checked={!isHidden} disabled={saving}
                    onClick={() => toggleHidden(method.id, !isHidden)}
                    className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border ${isHidden ? 'border-rose-500/30 bg-rose-500/10 text-rose-300' : 'border-emerald-500/25 bg-emerald-500/10 text-emerald-300'}`}
                    title={isHidden ? 'Hidden for this user' : 'Visible to this user'}>
                    {isHidden ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                  </button>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="truncate text-[10px] font-bold text-zinc-100">{method.name}</span>
                      <span className="font-mono text-[8px] text-zinc-600">{method.id}</span>
                      {isHidden && <span className="rounded-full bg-rose-500/10 px-1.5 py-0.5 text-[8px] text-rose-300">hidden</span>}
                      {(!method.enabled || !method.withdrawEnabled || !method.userWithdraw) && <span className="rounded-full bg-zinc-800 px-1.5 py-0.5 text-[8px] text-zinc-500">globally unavailable</span>}
                    </div>
                    <div className="mt-1 grid grid-cols-2 gap-x-3 gap-y-0.5 text-[9px]">
                      <span className="text-zinc-500">Credited source <b className="font-mono text-zinc-300">{money(source)}</b></span>
                      <span className="text-zinc-500">Already reserved <b className="font-mono text-zinc-300">{money(method.reservedUsd)}</b></span>
                      <span className="text-zinc-500">Remaining now <b className="font-mono text-emerald-300">{method.effectiveUnlimited ? 'single-source exception' : money(method.effectiveAvailableUsd)}</b></span>
                      <span className="text-zinc-500">Source match <b className="text-zinc-300">{method.category}</b></span>
                    </div>
                  </div>
                </div>

                <div className="mt-2 flex items-center gap-2 border-t border-zinc-800/80 pt-2">
                  <span className="min-w-[96px] text-[9px] font-semibold text-zinc-400">Admin lifetime cap</span>
                  {method.canSetCap ? (
                    <input type="number" min="0" max={source} step="0.00000001" value={capValue}
                      onChange={(e) => setCapDraft((prev) => ({ ...prev, [method.id]: e.target.value }))}
                      disabled={saving}
                      placeholder="No extra cap"
                      className={`min-w-0 flex-1 rounded-lg border bg-zinc-950 px-2.5 py-1.5 font-mono text-[10px] text-white outline-none ${overSource ? 'border-rose-500/60' : 'border-zinc-700 focus:border-violet-400/60'}`} />
                  ) : (
                    <span className="flex-1 rounded-lg border border-zinc-800 bg-zinc-950 px-2.5 py-1.5 text-[9px] text-zinc-600">Cash Agent limits use AGT source controls</span>
                  )}
                  {method.canSetCap && capValue.trim() && <span className="font-mono text-[8px] text-zinc-500">max {money(source)}</span>}
                </div>
                {method.canSetCap && capValue.trim() && !overSource && (
                  <p className="mt-1 pl-[104px] text-[8px] text-violet-200/70">This sets the maximum cumulative withdrawal through this payment method; current pending/completed requests count toward it.</p>
                )}
              </div>
            );
          })}
          {methods.length === 0 && <div className="rounded-xl border border-zinc-800 p-4 text-center text-[10px] text-zinc-500">No payment methods are configured.</div>}
        </div>
      )}

      <div className="flex justify-end border-t border-zinc-800 pt-3">
        <button type="button" onClick={() => void handleSave()} disabled={loading || saving}
          className="flex items-center gap-2 rounded-xl bg-violet-400 px-4 py-2.5 text-[10px] font-black text-zinc-950 transition hover:bg-violet-300 disabled:cursor-not-allowed disabled:opacity-50">
          {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
          {saving ? 'Saving…' : 'Save withdrawal controls'}
        </button>
      </div>
    </section>
  );
};
