/**
 * Searchable currency dropdown: flag + country + code + symbol, with a search box.
 * Used above the user ID chip on the balance card (owner request 2026-11-08).
 */
import React, { useMemo, useState } from 'react';
import { ChevronDown, Search, X } from 'lucide-react';
import { useCurrency } from '../lib/currency';

export default function CurrencyPicker({ compact = false }: { compact?: boolean }) {
  const { options, currency, setCurrency, rateNote } = useCurrency();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const list = useMemo(() => {
    const rows = (options?.currencies || []).filter((c) => c.enabled);
    const needle = q.trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter((c) =>
      c.code.toLowerCase().includes(needle)
      || c.name.toLowerCase().includes(needle)
      || c.country.toLowerCase().includes(needle)
      || c.symbol.includes(q.trim()));
  }, [options, q]);

  const pick = async (code: string) => {
    setBusy(true); setErr('');
    const ok = await setCurrency(code);
    setBusy(false);
    if (ok) { setOpen(false); setQ(''); }
    else setErr('Could not save. Please try again.');
  };

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className={`flex w-full items-center justify-between gap-2 rounded-xl border border-zinc-800 bg-zinc-950/80 px-2.5 py-1.5 text-[11px] text-zinc-300 hover:border-amber-500/40 active:scale-[0.99] transition ${compact ? '' : 'mb-1'}`}
        title="Display currency — your wallet stays in USD"
      >
        <span className="flex items-center gap-1.5 truncate">
          <span className="text-[13px] leading-none">{currency?.flag || '🌐'}</span>
          <span className="font-mono">{currency?.code || 'USD'}</span>
          <span className="text-zinc-500">{currency?.symbol}</span>
          <span className="truncate text-zinc-500">{currency?.country}</span>
        </span>
        <ChevronDown className={`h-3 w-3 shrink-0 text-zinc-500 transition ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="absolute left-0 right-0 z-50 mt-1 max-h-[300px] overflow-hidden rounded-xl border border-zinc-800 bg-zinc-950 shadow-2xl">
          <div className="flex items-center gap-1.5 border-b border-zinc-800 px-2 py-1.5">
            <Search className="h-3 w-3 text-zinc-500" />
            <input
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search country, code or symbol"
              className="min-w-0 flex-1 bg-transparent text-[11px] text-zinc-200 outline-none placeholder:text-zinc-600"
            />
            <button onClick={() => { setOpen(false); setQ(''); }} className="text-zinc-500 hover:text-zinc-300">
              <X className="h-3 w-3" />
            </button>
          </div>
          <div className="max-h-[240px] overflow-y-auto">
            {list.length === 0 && <div className="px-2 py-3 text-center text-[10px] text-zinc-500">No currency matches.</div>}
            {list.map((c) => (
              <button
                key={c.code}
                disabled={busy}
                onClick={() => void pick(c.code)}
                className={`flex w-full items-center justify-between gap-2 px-2 py-1.5 text-left text-[11px] hover:bg-zinc-900 ${c.code === currency?.code ? 'bg-amber-500/10' : ''}`}
              >
                <span className="flex min-w-0 items-center gap-1.5">
                  <span className="text-[13px] leading-none">{c.flag}</span>
                  <span className="truncate text-zinc-300">{c.country}</span>
                  <span className="font-mono text-zinc-500">{c.code}</span>
                </span>
                <span className="shrink-0 font-mono text-zinc-400">{c.symbol}</span>
              </button>
            ))}
          </div>
          {err && <div className="border-t border-zinc-800 px-2 py-1 text-[10px] text-red-400">{err}</div>}
          {rateNote() && (
            <div className="border-t border-zinc-800 px-2 py-1 text-[9px] leading-relaxed text-zinc-500">{rateNote()}</div>
          )}
          <div className="border-t border-zinc-800 px-2 py-1 text-[9px] text-zinc-600">
            Display only — your wallet, sends and boosts stay in USD.
          </div>
        </div>
      )}
    </div>
  );
}
