import { FC, useCallback, useEffect, useState } from 'react';
import {
  Ticket, Search, RefreshCw, Loader2, Save, Trash2, Star, Plus, ShieldCheck, AlertTriangle, Power, Gift
} from 'lucide-react';
import { BoostPayStore } from '../services/store';

const BoostPayAdminHeaders = () => BoostPayStore.adminAuthHeaders();

/**
 * ReferCodesView — admin: "custom refer code er sob setting ami hate kori".
 *
 * One screen for everything about vanity refer codes:
 *   • global settings  — how many codes a user may claim, and an on/off switch
 *   • every claimed code — searchable by code or user id, with owner, primary
 *     flag, referral count and any admin grant
 *   • manual control   — set/replace a code for any user, remove a code, make an
 *     alias primary, or grant a single user extra claims (youtuber deals)
 *
 * Ids only, never names — the admin panel follows the same rule as the user app.
 * Every write is audit-logged by the server (`REFERRAL_CODE_*`).
 */

type Settings = { limit: number; enabled: boolean; maxLength: number };
type CodeRow = {
  code: string; userId: string; createdAt: number; primary: boolean;
  codesOnUser: number; userExists: boolean; userBalance: number; userFrozen: boolean;
  extraClaims: number; referrals: number;
};
type Payload = {
  settings: Settings;
  stats: { totalCodes: number; owners: number; usersWithoutCode: number; overLimit: number };
  codes: CodeRow[];
  truncated: boolean;
};

type BonusRow = {
  id: string; code: string; amount: number; maxClaims: number; used: number; remaining: number;
  active: boolean; enabled: boolean; transferable: boolean; note: string;
  createdAt: number; paidTotal: number; lastUsedAt: number;
  claimedBy: { userId: string; amount: number; at: number }[];
};
type BonusPayload = {
  bounds: { maxAmount: number; maxClaims: number };
  stats: { codes: number; activeCodes: number; totalClaims: number; paidTotal: number; lockedClaims: number };
  codes: BonusRow[];
};

const when = (ts: number): string => {
  if (!ts) return '—';
  const d = new Date(ts);
  const diff = Date.now() - ts;
  if (diff < 60000) return 'just now';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  return d.toLocaleDateString();
};

const money = (n: number): string => {
  const v = Number(n) || 0;
  if (v === 0) return '$0';
  if (v < 1) return '$' + v.toFixed(3);
  return '$' + v.toFixed(2);
};

export const ReferCodesView: FC = () => {
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [note, setNote] = useState('');
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState('');

  // settings form
  const [limit, setLimit] = useState('3');
  const [enabled, setEnabled] = useState(true);

  // manual actions
  const [setUser, setSetUser] = useState('');
  const [setCode, setSetCode] = useState('');
  const [grantUser, setGrantUser] = useState('');
  const [grantExtra, setGrantExtra] = useState('2');

  // signup bonus codes
  const [bonus, setBonus] = useState<BonusPayload | null>(null);
  const [bCode, setBCode] = useState('');
  const [bAmount, setBAmount] = useState('5');
  const [bMax, setBMax] = useState('100');
  const [bTransferable, setBTransferable] = useState(true);
  const [bEnabled, setBEnabled] = useState(true);
  const [bNote, setBNote] = useState('');
  const [bEditId, setBEditId] = useState('');

  const load = useCallback(async (query?: string) => {
    setLoading(true);
    try {
      const url = `/api/admin/refer-codes${query ? `?q=${encodeURIComponent(query)}` : ''}`;
      const r = await fetch(url, { headers: BoostPayStore.adminAuthHeaders() });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error || `HTTP ${r.status}`);
      setData(j);
      setLimit(String(j.settings?.limit ?? 3));
      setEnabled(j.settings?.enabled !== false);
      setErr('');
    } catch (e: any) {
      setErr(e?.message || 'Could not load refer codes.');
    } finally {
      setLoading(false);
    }
  }, []);

  const loadBonus = useCallback(async () => {
    try {
      const r = await fetch('/api/admin/bonus-codes', { headers: BoostPayStore.adminAuthHeaders() });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error || `HTTP ${r.status}`);
      setBonus(j);
    } catch (e: any) {
      setErr(e?.message || 'Could not load bonus codes.');
    }
  }, []);

  useEffect(() => { void load(); void loadBonus(); }, [load, loadBonus]);

  const call = async (path: string, body: any, okMsg: string) => {
    setBusy(path); setErr(''); setNote('');
    try {
      const r = await fetch(path, {
        method: 'POST',
        headers: BoostPayStore.adminAuthHeaders(),
        body: JSON.stringify(body),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j?.error || `HTTP ${r.status}`);
      setNote(okMsg);
      await load(q);
      setTimeout(() => setNote(''), 4000);
      return j;
    } catch (e: any) {
      setErr(e?.message || 'Action failed.');
      return null;
    } finally {
      setBusy('');
    }
  };

  const saveSettings = () => call('/api/admin/refer-codes/settings', { limit: Number(limit), enabled }, 'Settings saved.');
  const doSet = () => call('/api/admin/refer-codes/set', { userId: setUser, code: setCode }, `Set ${setCode.toUpperCase()} for #${setUser}.`)
    .then((j) => { if (j) { setSetCode(''); setSetUser(''); } });
  const doRemove = (code: string) => {
    if (!confirm(`Remove ${code}? Anyone using this code will no longer be linked. The owner keeps their other codes.`)) return;
    void call('/api/admin/refer-codes/remove', { code }, `Removed ${code}.`);
  };
  const doPrimary = (code: string) => void call('/api/admin/refer-codes/primary', { code }, `${code} is now the primary code.`);
  const doGrant = () => call('/api/admin/refer-codes/grant', { userId: grantUser, extra: Number(grantExtra) }, `#${grantUser} can claim ${grantExtra} extra code(s).`)
    .then((j) => { if (j) setGrantUser(''); });

  const saveBonus = async () => {
    setBusy('/bonus/save'); setErr(''); setNote('');
    try {
      const r = await fetch('/api/admin/bonus-codes/save', {
        method: 'POST',
        headers: BoostPayAdminHeaders(),
        body: JSON.stringify({
          id: bEditId || undefined,
          code: bCode,
          amount: Number(bAmount),
          maxClaims: Number(bMax),
          transferable: bTransferable,
          enabled: bEnabled,
          note: bNote,
        }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j?.error || `HTTP ${r.status}`);
      setNote(`Bonus code ${j.code?.code || bCode.toUpperCase()} saved.`);
      setBCode(''); setBEditId(''); setBNote('');
      await loadBonus();
      setTimeout(() => setNote(''), 4000);
    } catch (e: any) {
      setErr(e?.message || 'Could not save the bonus code.');
    } finally { setBusy(''); }
  };

  const removeBonus = async (row: BonusRow) => {
    if (!confirm(`Remove bonus code ${row.code}? People who already got the bonus keep their money; the code stops paying.`)) return;
    setBusy('/bonus/remove'); setErr(''); setNote('');
    try {
      const r = await fetch('/api/admin/bonus-codes/remove', {
        method: 'POST', headers: BoostPayAdminHeaders(), body: JSON.stringify({ id: row.id }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j?.error || `HTTP ${r.status}`);
      setNote(`Removed ${row.code}.`);
      await loadBonus();
    } catch (e: any) { setErr(e?.message || 'Could not remove it.'); }
    finally { setBusy(''); }
  };

  const editBonus = (row: BonusRow) => {
    setBEditId(row.id); setBCode(row.code); setBAmount(String(row.amount));
    setBMax(String(row.maxClaims)); setBTransferable(row.transferable);
    setBEnabled(row.enabled); setBNote(row.note);
  };

  const card = 'rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4';
  const stat = (label: string, value: string, tint = 'text-white') => (
    <div className="rounded-xl border border-zinc-800 bg-zinc-950/60 px-3 py-2">
      <div className="text-[9px] font-bold uppercase tracking-wider text-zinc-500">{label}</div>
      <div className={`mt-0.5 font-mono text-sm font-bold ${tint}`}>{value}</div>
    </div>
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h2 className="flex items-center gap-2 text-sm font-bold text-white"><Ticket className="h-4 w-4 text-amber-400" /> Refer codes</h2>
          <p className="mt-0.5 text-[11px] text-zinc-500">Custom (vanity) refer codes — limits, on/off, and manual control per user. Ids only.</p>
        </div>
        <button onClick={() => void load(q)} className="flex items-center gap-1.5 rounded-xl border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-[11px] font-semibold text-zinc-300 hover:text-white">
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />} Refresh
        </button>
      </div>

      {err && <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-[11px] text-rose-300">{err}</div>}
      {note && <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-[11px] text-emerald-300">✓ {note}</div>}

      {data && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {stat('Custom codes', String(data.stats.totalCodes))}
          {stat('Users with a code', String(data.stats.owners))}
          {stat('Users without', String(data.stats.usersWithoutCode), 'text-zinc-400')}
          {stat('Over the limit', String(data.stats.overLimit), data.stats.overLimit > 0 ? 'text-amber-300' : 'text-zinc-400')}
        </div>
      )}

      {/* ── Signup bonus codes ───────────────────────────────────────────── */}
      <div className={card}>
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-emerald-400">
            <Gift className="h-3.5 w-3.5" /> Signup bonus codes
          </div>
          {bonus && (
            <div className="flex flex-wrap items-center gap-2 font-mono text-[10px] text-zinc-400">
              <span>{bonus.stats.activeCodes} active</span>
              <span className="text-zinc-600">·</span>
              <span>{bonus.stats.totalClaims} joined</span>
              <span className="text-zinc-600">·</span>
              <span className="text-emerald-300">{money(bonus.stats.paidTotal)} paid</span>
              {bonus.stats.lockedClaims > 0 && <span className="text-amber-300">· {bonus.stats.lockedClaims} boost-only</span>}
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-end gap-2">
          <label className="text-[11px] text-zinc-400">
            Code
            <input value={bCode} onChange={(e) => setBCode(e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, '').slice(0, 16))}
              placeholder="YT2026"
              className="mt-1 block w-32 rounded-xl border border-zinc-700 bg-zinc-950 px-3 py-2 font-mono text-sm text-white focus:border-emerald-500 focus:outline-none" />
          </label>
          <label className="text-[11px] text-zinc-400">
            Bonus $
            <input value={bAmount} onChange={(e) => setBAmount(e.target.value.replace(/[^0-9.]/g, '').slice(0, 10))}
              inputMode="decimal"
              className="mt-1 block w-24 rounded-xl border border-zinc-700 bg-zinc-950 px-3 py-2 font-mono text-sm text-white focus:border-emerald-500 focus:outline-none" />
          </label>
          <label className="text-[11px] text-zinc-400">
            How many people
            <input value={bMax} onChange={(e) => setBMax(e.target.value.replace(/[^0-9]/g, '').slice(0, 7))}
              inputMode="numeric"
              className="mt-1 block w-24 rounded-xl border border-zinc-700 bg-zinc-950 px-3 py-2 font-mono text-sm text-white focus:border-emerald-500 focus:outline-none" />
          </label>
          <button onClick={() => setBTransferable((v) => !v)}
            className={`rounded-xl border px-3 py-2 text-[11px] font-bold ${bTransferable ? 'border-sky-500/40 bg-sky-500/10 text-sky-300' : 'border-amber-500/40 bg-amber-500/10 text-amber-300'}`}>
            {bTransferable ? 'Transferable' : 'Boost only'}
          </button>
          <button onClick={() => setBEnabled((v) => !v)}
            className={`rounded-xl border px-3 py-2 text-[11px] font-bold ${bEnabled ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300' : 'border-zinc-700 bg-zinc-900 text-zinc-400'}`}>
            {bEnabled ? 'ON' : 'OFF'}
          </button>
          <button onClick={() => void saveBonus()} disabled={!bCode || busy === '/bonus/save'}
            className="flex items-center gap-1.5 rounded-xl bg-emerald-500 px-3 py-2 text-[11px] font-black text-zinc-950 hover:bg-emerald-400 disabled:opacity-40">
            {busy === '/bonus/save' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />} {bEditId ? 'Update' : 'Create'}
          </button>
          {bEditId && (
            <button onClick={() => { setBEditId(''); setBCode(''); }} className="rounded-xl border border-zinc-700 px-2.5 py-2 text-[11px] text-zinc-400">Cancel</button>
          )}
        </div>
        <input value={bNote} onChange={(e) => setBNote(e.target.value.slice(0, 200))} placeholder="note (internal, e.g. 'TechGuru collab Nov')"
          className="mt-2 w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-1.5 text-[11px] text-zinc-300 focus:border-emerald-500 focus:outline-none" />
        <p className="mt-1.5 text-[10px] leading-relaxed text-zinc-500">
          Join with this code ⇒ new wallet is credited instantly. <b className="text-sky-300">Transferable</b> = the money works like any balance.
          <b className="text-amber-300"> Boost only</b> = it compounds but cannot be sent, paid to an agent or withdrawn (profit on top of it is spendable).
          The cap counts people, not dollars. Existing code holders keep their money if you remove the code.
        </p>

        {bonus && bonus.codes.length === 0 && (
          <div className="mt-3 rounded-xl border border-zinc-800 bg-zinc-950/60 py-6 text-center text-[11px] text-zinc-500">No bonus codes yet — create one above.</div>
        )}
        {bonus && bonus.codes.length > 0 && (
          <div className="mt-3 space-y-1.5">
            {bonus.codes.map((row) => (
              <div key={row.id} className="rounded-xl border border-zinc-800 bg-zinc-950/60 px-2.5 py-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-lg bg-zinc-800 px-2 py-0.5 font-mono text-xs font-bold text-white">{row.code}</span>
                  <span className="font-mono text-xs font-bold text-emerald-300">{money(row.amount)}</span>
                  <span className={`rounded-full px-1.5 py-0.5 text-[9px] font-bold ${row.transferable ? 'bg-sky-500/15 text-sky-300' : 'bg-amber-500/15 text-amber-300'}`}>
                    {row.transferable ? 'transferable' : 'boost only'}
                  </span>
                  {!row.enabled && <span className="rounded-full bg-zinc-800 px-1.5 py-0.5 text-[9px] font-bold text-zinc-400">OFF</span>}
                  {row.active && <span className="rounded-full bg-emerald-500/15 px-1.5 py-0.5 text-[9px] font-bold text-emerald-300">ACTIVE</span>}
                  <span className="font-mono text-[10px] text-zinc-400">{row.used}/{row.maxClaims} used</span>
                  <span className="font-mono text-[10px] text-zinc-500">{money(row.paidTotal)} paid</span>
                  {row.note && <span className="text-[10px] text-zinc-600">{row.note}</span>}
                  <span className="ml-auto flex items-center gap-1">
                    <button onClick={() => editBonus(row)} title="Edit"
                      className="rounded-lg border border-zinc-700 p-1.5 text-zinc-400 hover:text-emerald-300">
                      <Star className="h-3.5 w-3.5" />
                    </button>
                    <button onClick={() => void removeBonus(row)} disabled={busy === '/bonus/remove'} title="Remove"
                      className="rounded-lg border border-zinc-700 p-1.5 text-zinc-400 hover:text-rose-300 disabled:opacity-40">
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </span>
                </div>
                {row.claimedBy.length > 0 && (
                  <div className="mt-1 flex flex-wrap gap-1">
                    {row.claimedBy.map((c) => (
                      <span key={c.userId + c.at} className="rounded-full bg-zinc-900 px-1.5 py-0.5 font-mono text-[9px] text-zinc-500">
                        #{c.userId} {money(c.amount)}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* global settings */}
      <div className={card}>
        <div className="mb-2 flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-amber-400">
          <ShieldCheck className="h-3.5 w-3.5" /> Global settings
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-[11px] text-zinc-400">
            Codes per user (lifetime)
            <input
              value={limit}
              onChange={(e) => setLimit(e.target.value.replace(/[^0-9]/g, '').slice(0, 2))}
              inputMode="numeric"
              className="mt-1 block w-24 rounded-xl border border-zinc-700 bg-zinc-950 px-3 py-2 font-mono text-sm text-white focus:border-amber-500 focus:outline-none"
            />
          </label>
          <button
            onClick={() => setEnabled((v) => !v)}
            className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-[11px] font-bold ${enabled ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300' : 'border-zinc-700 bg-zinc-900 text-zinc-400'}`}
          >
            <Power className="h-3.5 w-3.5" /> Custom codes {enabled ? 'ON' : 'OFF'}
          </button>
          <button
            onClick={() => void saveSettings()}
            disabled={busy.includes('/settings')}
            className="flex items-center gap-1.5 rounded-xl bg-amber-500 px-3 py-2 text-[11px] font-black text-zinc-950 hover:bg-amber-400 disabled:opacity-50"
          >
            {busy.includes('/settings') ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />} Save
          </button>
          <p className="w-full text-[10px] leading-relaxed text-zinc-500">
            0 = users can only keep their number id. OFF = claiming is blocked (existing codes keep working, links never break).
            Changing the limit never deletes a code that already exists.
          </p>
        </div>
      </div>

      {/* manual actions */}
      <div className="grid gap-3 lg:grid-cols-2">
        <div className={card}>
          <div className="mb-2 flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-sky-400">
            <Plus className="h-3.5 w-3.5" /> Set a code for a user
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <label className="text-[11px] text-zinc-400">
              User id
              <input value={setUser} onChange={(e) => setSetUser(e.target.value.replace(/[^0-9A-Za-z]/g, '').slice(0, 12))}
                placeholder="12"
                className="mt-1 block w-24 rounded-xl border border-zinc-700 bg-zinc-950 px-3 py-2 font-mono text-sm text-white focus:border-amber-500 focus:outline-none" />
            </label>
            <label className="text-[11px] text-zinc-400">
              Code
              <input value={setCode} onChange={(e) => setSetCode(e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, '').slice(0, 16))}
                placeholder="MRBEAST"
                className="mt-1 block w-36 rounded-xl border border-zinc-700 bg-zinc-950 px-3 py-2 font-mono text-sm text-white focus:border-amber-500 focus:outline-none" />
            </label>
            <button onClick={() => void doSet()} disabled={!setUser || !setCode || busy.includes('/set')}
              className="rounded-xl bg-sky-500 px-3 py-2 text-[11px] font-black text-zinc-950 hover:bg-sky-400 disabled:opacity-40">
              Set
            </button>
          </div>
          <p className="mt-2 text-[10px] text-zinc-500">Bypasses the claim limit. Taken codes must be removed from their owner first.</p>
        </div>

        <div className={card}>
          <div className="mb-2 flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-violet-400">
            <AlertTriangle className="h-3.5 w-3.5" /> Grant extra claims
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <label className="text-[11px] text-zinc-400">
              User id
              <input value={grantUser} onChange={(e) => setGrantUser(e.target.value.replace(/[^0-9A-Za-z]/g, '').slice(0, 12))}
                placeholder="12"
                className="mt-1 block w-24 rounded-xl border border-zinc-700 bg-zinc-950 px-3 py-2 font-mono text-sm text-white focus:border-amber-500 focus:outline-none" />
            </label>
            <label className="text-[11px] text-zinc-400">
              Extra
              <input value={grantExtra} onChange={(e) => setGrantExtra(e.target.value.replace(/[^0-9]/g, '').slice(0, 3))}
                inputMode="numeric"
                className="mt-1 block w-20 rounded-xl border border-zinc-700 bg-zinc-950 px-3 py-2 font-mono text-sm text-white focus:border-amber-500 focus:outline-none" />
            </label>
            <button onClick={() => void doGrant()} disabled={!grantUser || busy.includes('/grant')}
              className="rounded-xl bg-violet-500 px-3 py-2 text-[11px] font-black text-zinc-950 hover:bg-violet-400 disabled:opacity-40">
              Grant
            </button>
          </div>
          <p className="mt-2 text-[10px] text-zinc-500">Adds to the global limit for that one account (0 = back to normal). Audit-logged.</p>
        </div>
      </div>

      {/* the list */}
      <div className={card}>
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-zinc-300">
            <Ticket className="h-3.5 w-3.5" /> Claimed codes
          </div>
          <div className="flex items-center gap-2">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-500" />
              <input value={q} onChange={(e) => setQ(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') void load(q); }}
                placeholder="code or user id"
                className="w-40 rounded-xl border border-zinc-700 bg-zinc-950 py-1.5 pl-8 pr-2 font-mono text-[11px] text-white focus:border-amber-500 focus:outline-none" />
            </div>
            <button onClick={() => void load(q)} className="rounded-xl border border-zinc-700 px-2.5 py-1.5 text-[11px] text-zinc-300 hover:text-white">Search</button>
          </div>
        </div>

        {loading && !data && <div className="py-8 text-center text-[11px] text-zinc-500"><Loader2 className="mx-auto mb-2 h-4 w-4 animate-spin" /> loading…</div>}
        {data && data.codes.length === 0 && (
          <div className="py-8 text-center text-[11px] text-zinc-500">No custom codes yet — users can create one on their Refer page, or set one above.</div>
        )}

        {data && data.codes.length > 0 && (
          <div className="space-y-1.5">
            {data.codes.map((c) => (
              <div key={c.code} className="flex flex-wrap items-center gap-2 rounded-xl border border-zinc-800 bg-zinc-950/60 px-2.5 py-2">
                <span className="rounded-lg bg-zinc-800 px-2 py-0.5 font-mono text-xs font-bold text-white">{c.code}</span>
                {c.primary && <span className="rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[9px] font-bold text-amber-300">PRIMARY</span>}
                {c.extraClaims > 0 && <span className="rounded-full bg-violet-500/15 px-1.5 py-0.5 text-[9px] font-bold text-violet-300">+{c.extraClaims} grant</span>}
                {c.userFrozen && <span className="rounded-full bg-rose-500/15 px-1.5 py-0.5 text-[9px] font-bold text-rose-300">FROZEN</span>}
                <span className="font-mono text-[11px] text-zinc-400">#{c.userId}</span>
                {!c.userExists && <span className="text-[9px] text-rose-400">owner deleted</span>}
                <span className="font-mono text-[10px] text-zinc-600">{money(c.userBalance)}</span>
                <span className="text-[10px] text-zinc-500">{c.referrals} ref</span>
                <span className="text-[10px] text-zinc-600">{when(c.createdAt)}</span>
                <span className="ml-auto flex items-center gap-1">
                  {!c.primary && (
                    <button onClick={() => void doPrimary(c.code)} disabled={busy.includes('/primary')} title="Make primary"
                      className="rounded-lg border border-zinc-700 p-1.5 text-zinc-400 hover:text-amber-300 disabled:opacity-40">
                      <Star className="h-3.5 w-3.5" />
                    </button>
                  )}
                  <button onClick={() => doRemove(c.code)} disabled={busy.includes('/remove')} title="Remove"
                    className="rounded-lg border border-zinc-700 p-1.5 text-zinc-400 hover:text-rose-300 disabled:opacity-40">
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </span>
              </div>
            ))}
            {data.truncated && <p className="pt-1 text-center text-[10px] text-zinc-600">Showing the newest 500 — search to narrow down.</p>}
          </div>
        )}
      </div>
    </div>
  );
};

export default ReferCodesView;
