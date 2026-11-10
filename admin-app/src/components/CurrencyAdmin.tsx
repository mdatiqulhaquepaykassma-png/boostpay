/**
 * Admin → Currency.
 *
 * The wallet and the ledger are always USD; this screen decides how money is
 * *shown*: which currencies are offered, the default for new accounts, and the
 * exchange-rate provider the server uses (cached, with the last known table kept
 * when the provider is down).
 */
import React, { useEffect, useMemo, useState } from 'react';

type Row = { code: string; name: string; symbol: string; flag: string; country: string; decimals: number; enabled: boolean; rate: number };
type Cfg = {
  config: { default: string; providerUrl: string; refreshMinutes: number; disabled: string[]; manualRates: Record<string, number> };
  cache: { fetchedAt: number; source: string; stale: boolean; lastError: string };
  currencies: Row[];
};

function authHeaders(): Record<string, string> {
  const t = localStorage.getItem('admin_token') || localStorage.getItem('token') || '';
  return { 'content-type': 'application/json', ...(t ? { authorization: `Bearer ${t}` } : {}) };
}

export const CurrencyAdmin: React.FC = () => {
  const [data, setData] = useState<Cfg | null>(null);
  const [q, setQ] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [provider, setProvider] = useState('');
  const [refresh, setRefresh] = useState(60);
  const [def, setDef] = useState('USD');
  const [disabled, setDisabled] = useState<string[]>([]);

  const load = async () => {
    try {
      const r = await fetch('/api/admin/currency/config', { headers: authHeaders() });
      if (!r.ok) { setNote(`Could not load (HTTP ${r.status}).`); return; }
      const j = (await r.json()) as Cfg;
      setData(j);
      setProvider(j.config.providerUrl);
      setRefresh(j.config.refreshMinutes);
      setDef(j.config.default);
      setDisabled(j.config.disabled || []);
    } catch { setNote('Network error.'); }
  };

  useEffect(() => { void load(); }, []);

  const save = async (patch: any) => {
    setBusy(true);
    try {
      const r = await fetch('/api/admin/currency/config', {
        method: 'POST', headers: authHeaders(), body: JSON.stringify(patch),
      });
      const j = await r.json().catch(() => ({}));
      setNote(r.ok ? 'Saved.' : (j.error || `HTTP ${r.status}`));
      if (r.ok) await load();
    } catch { setNote('Network error.'); }
    setBusy(false);
  };

  const refreshNow = async () => {
    setBusy(true);
    try {
      const r = await fetch('/api/admin/currency/refresh', { method: 'POST', headers: authHeaders(), body: '{}' });
      const j = await r.json().catch(() => ({}));
      setNote(j.ok ? `Rates refreshed (${new Date(j.fetchedAt).toLocaleString()}).` : `Provider failed: ${j.error || 'unknown'} — the last known rates are still in use.`);
      await load();
    } catch { setNote('Network error.'); }
    setBusy(false);
  };

  const rows = useMemo(() => {
    const list = data?.currencies || [];
    const n = q.trim().toLowerCase();
    if (!n) return list;
    return list.filter((c) => c.code.toLowerCase().includes(n) || c.name.toLowerCase().includes(n) || c.country.toLowerCase().includes(n));
  }, [data, q]);

  const toggle = (code: string) => {
    if (code === 'USD') { setNote('USD is the base currency and always stays enabled.'); return; }
    const next = disabled.includes(code) ? disabled.filter((c) => c !== code) : [...disabled, code];
    setDisabled(next);
    void save({ disabled: next });
  };

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-zinc-800 bg-zinc-950/60 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-sm font-black text-white">Currency display</h3>
            <p className="mt-0.5 text-[11px] text-zinc-500">
              Wallets, the ledger and every transaction stay in <span className="font-mono text-zinc-300">USD</span>. A user or agent only picks how the money is shown.
            </p>
          </div>
          <button onClick={() => void refreshNow()} disabled={busy} className="rounded-lg border border-zinc-700 px-3 py-1.5 text-[11px] font-bold text-zinc-200 hover:bg-zinc-900 disabled:opacity-50">
            Refresh rates now
          </button>
        </div>

        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          <label className="text-[11px] text-zinc-400">
            Default currency (new accounts)
            <select value={def} onChange={(e) => { setDef(e.target.value); void save({ default: e.target.value }); }}
              className="mt-1 w-full rounded-lg border border-zinc-800 bg-zinc-950 px-2 py-1.5 text-[11px] text-zinc-200">
              {(data?.currencies || []).filter((c) => c.enabled).map((c) => (
                <option key={c.code} value={c.code}>{c.flag} {c.code} — {c.name}</option>
              ))}
            </select>
          </label>
          <label className="text-[11px] text-zinc-400">
            Refresh every (minutes)
            <input type="number" min={5} max={1440} value={refresh} onChange={(e) => setRefresh(Number(e.target.value))}
              onBlur={() => void save({ refreshMinutes: refresh })}
              className="mt-1 w-full rounded-lg border border-zinc-800 bg-zinc-950 px-2 py-1.5 text-[11px] text-zinc-200" />
          </label>
          <label className="text-[11px] text-zinc-400">
            Rate provider (USD base)
            <input value={provider} onChange={(e) => setProvider(e.target.value)} onBlur={() => void save({ providerUrl: provider })}
              className="mt-1 w-full rounded-lg border border-zinc-800 bg-zinc-950 px-2 py-1.5 font-mono text-[10px] text-zinc-200" />
          </label>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-3 text-[10px]">
          <span className={`rounded-full px-2 py-0.5 font-bold ${data?.cache.stale ? 'bg-amber-500/15 text-amber-300' : 'bg-emerald-500/15 text-emerald-300'}`}>
            {data?.cache.stale ? 'last known rates' : 'rates fresh'}
          </span>
          <span className="text-zinc-500">Updated: {data?.cache.fetchedAt ? new Date(data.cache.fetchedAt).toLocaleString() : 'never'}</span>
          {data?.cache.lastError ? <span className="text-rose-400">Provider error: {data.cache.lastError}</span> : null}
        </div>
        {note && <div className="mt-2 text-[11px] text-amber-300">{note}</div>}
      </div>

      <div className="rounded-2xl border border-zinc-800 bg-zinc-950/60 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-black text-white">Supported currencies</h3>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search code, name or country"
            className="rounded-lg border border-zinc-800 bg-zinc-950 px-2 py-1.5 text-[11px] text-zinc-200 placeholder:text-zinc-600" />
        </div>
        <div className="mt-2 max-h-[420px] overflow-y-auto">
          <table className="w-full text-left text-[11px]">
            <thead className="sticky top-0 bg-zinc-950 text-[10px] uppercase tracking-wider text-zinc-500">
              <tr><th className="py-1.5">Currency</th><th>Symbol</th><th>Rate (1 USD)</th><th className="text-right">Shown</th></tr>
            </thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.code} className="border-t border-zinc-900">
                  <td className="py-1.5 text-zinc-300">{c.flag} {c.country} <span className="font-mono text-zinc-500">{c.code}</span></td>
                  <td className="font-mono text-zinc-400">{c.symbol}</td>
                  <td className="font-mono text-zinc-400">{c.code === 'USD' ? '1' : (c.rate || 0).toLocaleString('en-US', { maximumFractionDigits: 4 })}</td>
                  <td className="text-right">
                    <button disabled={busy || c.code === 'USD'} onClick={() => toggle(c.code)}
                      className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${c.code === 'USD' ? 'bg-zinc-800 text-zinc-500' : c.enabled ? 'bg-emerald-500/15 text-emerald-300' : 'bg-zinc-800 text-zinc-400'} disabled:opacity-60`}>
                      {c.code === 'USD' ? 'base' : c.enabled ? 'enabled' : 'disabled'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-[10px] text-zinc-600">Disabled currencies disappear from every selector. USD is the base and cannot be disabled.</p>
      </div>
    </div>
  );
};

export default CurrencyAdmin;
