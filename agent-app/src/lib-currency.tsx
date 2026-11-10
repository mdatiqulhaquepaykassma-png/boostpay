/**
 * Agent display currency. Amounts in the agent wallet stay USD; this only converts
 * what is shown, using the server's cached rates (never a client-side rate).
 */
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

export type CurrencyRow = {
  code: string; name: string; symbol: string; flag: string; country: string;
  decimals: number; enabled: boolean; rate: number;
};
type Options = { base: string; default: string; selected: string; refreshedAt: number; ageMinutes: number; stale: boolean; currencies: CurrencyRow[] };

type Ctx = {
  options: Options | null;
  currency: CurrencyRow | null;
  setCurrency: (code: string) => Promise<boolean>;
  fmt: (usd: number, opts?: { decimals?: number; withSymbol?: boolean }) => string;
  money: (usd: number) => string;
  rateNote: () => string;
};

const Ctx = createContext<Ctx | null>(null);

function authHeaders(): Record<string, string> {
  const t = localStorage.getItem('bpa_token_v1') || localStorage.getItem('agent_token') || '';
  return t ? { authorization: `Bearer ${t}` } : {};
}

export function CurrencyProvider({ children, token }: { children: React.ReactNode; token?: string | null }) {
  const [options, setOptions] = useState<Options | null>(null);

  const reload = useCallback(async () => {
    try {
      const r = await fetch('/api/currency/options', { headers: authHeaders() });
      if (!r.ok) return;
      const j = (await r.json()) as Options;
      if (j && Array.isArray(j.currencies)) setOptions(j);
    } catch { /* keep the last table */ }
  }, []);

  useEffect(() => { void reload(); }, [reload, token]);
  useEffect(() => { const id = setInterval(() => { void reload(); }, 10 * 60 * 1000); return () => clearInterval(id); }, [reload]);

  const currency = useMemo(() => {
    if (!options) return null;
    return options.currencies.find((c) => c.code === options.selected) || options.currencies.find((c) => c.code === 'USD') || null;
  }, [options]);

  const setCurrency = useCallback(async (code: string) => {
    try {
      const r = await fetch('/api/agent/currency', {
        method: 'POST', headers: { 'content-type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ code }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) return false;
      if (j.options) setOptions(j.options as Options); else await reload();
      return true;
    } catch { return false; }
  }, [reload]);

  const fmt = useCallback((usd: number, opts?: { decimals?: number; withSymbol?: boolean }) => {
    const cur = currency;
    const rate = cur && cur.rate > 0 ? cur.rate : 1;
    const dec = opts?.decimals ?? (cur ? cur.decimals : 2);
    const body = ((Number(usd) || 0) * rate).toLocaleString('en-US', { minimumFractionDigits: Math.min(dec, 8), maximumFractionDigits: Math.min(dec, 8) });
    return opts?.withSymbol === false ? body : `${cur ? cur.symbol : '$'}${body}`;
  }, [currency]);

  const money = useCallback((usd: number) => {
    const cur = currency;
    if (!cur || cur.code === 'USD') return (Number(usd) || 0).toFixed(2);
    return `≈ ${cur.symbol}${fmt(usd, { decimals: cur.decimals })}`;
  }, [currency, fmt]);

  const rateNote = useCallback(() => {
    if (!options || !currency || currency.code === 'USD') return '';
    const when = options.refreshedAt ? new Date(options.refreshedAt).toLocaleString() : 'not yet';
    return `1 USD = ${currency.rate.toLocaleString('en-US', { maximumFractionDigits: 4 })} ${currency.code}${options.stale ? ' (last known rate)' : ''} · updated ${when}`;
  }, [options, currency]);

  return <Ctx.Provider value={{ options, currency, setCurrency, fmt, money, rateNote }}>{children}</Ctx.Provider>;
}

export function useCurrency(): Ctx {
  const c = useContext(Ctx);
  if (c) return c;
  return {
    options: null,
    currency: { code: 'USD', name: 'US Dollar', symbol: '$', flag: '🇺🇸', country: 'United States', decimals: 2, enabled: true, rate: 1 },
    setCurrency: async () => false,
    fmt: (usd: number) => (Number(usd) || 0).toFixed(2),
    money: (usd: number) => (Number(usd) || 0).toFixed(2),
    rateNote: () => '',
  };
}
