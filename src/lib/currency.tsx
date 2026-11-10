/**
 * Display currency for the user app.
 *
 * Every amount in BoostPay is USD in the wallet and the ledger. This context only
 * converts *what is shown*: the rates come from the server (which caches them and
 * keeps the last known table when the provider is down), and the client never
 * sends a converted figure back — entry amounts are converted server-side.
 */
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

export type CurrencyRow = {
  code: string; name: string; symbol: string; flag: string; country: string;
  decimals: number; enabled: boolean; rate: number;
};

type Options = {
  base: string; default: string; selected: string;
  refreshedAt: number; ageMinutes: number; stale: boolean;
  refreshMinutes: number; currencies: CurrencyRow[];
};

type Ctx = {
  options: Options | null;
  currency: CurrencyRow | null;
  setCurrency: (code: string) => Promise<boolean>;
  /** Format a USD amount in the selected display currency. */
  fmt: (usd: number, opts?: { decimals?: number; withSymbol?: boolean }) => string;
  /** "≈ ৳1,028.16" style label, USD shown as-is when the currency is USD. */
  money: (usd: number) => string;
  /** Rate line under a converted amount. */
  rateNote: () => string;
  reload: () => Promise<void>;
};

const CurrencyCtx = createContext<Ctx | null>(null);

/**
 * The user app keeps its API token in `boostpay_auth_token_v1` (see
 * services/store.ts → STORAGE_AUTH_TOKEN). Reading the wrong key here meant the
 * preference POST went out unauthenticated, the server answered 401, and the
 * global "any 401 = session expired" handler signed the user out mid-tap.
 * The old names are kept as fallbacks only.
 */
const TOKEN_KEYS = ['boostpay_auth_token_v1', 'boostpay_token', 'token'];

function authToken(): string {
  for (const k of TOKEN_KEYS) {
    const v = localStorage.getItem(k);
    if (v) return v;
  }
  return '';
}

function authHeaders(): Record<string, string> {
  const t = authToken();
  return t ? { authorization: `Bearer ${t}` } : {};
}

export function CurrencyProvider({ children, token }: { children: React.ReactNode; token?: string | null }) {
  const [options, setOptions] = useState<Options | null>(null);

  const reload = useCallback(async () => {
    try {
      const r = await fetch('/api/currency/options', { headers: { ...authHeaders() } });
      if (!r.ok) return;
      const j = (await r.json()) as Options;
      if (j && Array.isArray(j.currencies)) setOptions(j);
    } catch { /* offline — keep whatever we had */ }
  }, []);

  useEffect(() => { void reload(); }, [reload, token]);
  // refresh the rate table every 10 minutes while the app is open
  useEffect(() => {
    const id = setInterval(() => { void reload(); }, 10 * 60 * 1000);
    return () => clearInterval(id);
  }, [reload]);

  const currency = useMemo(() => {
    if (!options) return null;
    return options.currencies.find((c) => c.code === options.selected)
      || options.currencies.find((c) => c.code === 'USD')
      || null;
  }, [options]);

  const setCurrency = useCallback(async (code: string) => {
    try {
      // Signed out: never fire the call — a 401 would bounce the app to login.
      if (!authToken()) return false;
      const r = await fetch('/api/user/currency', {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ code }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) return false;
      if (j.options) setOptions(j.options as Options);
      else await reload();
      return true;
    } catch { return false; }
  }, [reload]);

  const fmt = useCallback((usd: number, opts?: { decimals?: number; withSymbol?: boolean }) => {
    const amount = Number(usd) || 0;
    const cur = currency;
    const rate = cur && cur.rate > 0 ? cur.rate : 1;
    const value = amount * rate;
    const dec = opts?.decimals ?? (cur ? cur.decimals : 2);
    const body = value.toLocaleString('en-US', { minimumFractionDigits: Math.min(dec, 8), maximumFractionDigits: Math.min(dec, 8) });
    if (opts?.withSymbol === false) return body;
    return `${cur ? cur.symbol : '$'}${body}`;
  }, [currency]);

  const money = useCallback((usd: number) => {
    const cur = currency;
    if (!cur || cur.code === 'USD') return `$${(Number(usd) || 0).toFixed(2)}`;
    return `≈ ${cur.symbol}${fmt(usd, { decimals: cur.decimals })}`;
  }, [currency, fmt]);

  const rateNote = useCallback(() => {
    if (!options || !currency || currency.code === 'USD') return '';
    const when = options.refreshedAt ? new Date(options.refreshedAt).toLocaleString() : 'not yet';
    return `1 USD = ${currency.rate.toLocaleString('en-US', { maximumFractionDigits: 4 })} ${currency.code}${options.stale ? ' (last known rate)' : ''} · updated ${when}`;
  }, [options, currency]);

  const value: Ctx = { options, currency, setCurrency, fmt, money, rateNote, reload };
  return <CurrencyCtx.Provider value={value}>{children}</CurrencyCtx.Provider>;
}

export function useCurrency(): Ctx {
  const ctx = useContext(CurrencyCtx);
  if (ctx) return ctx;
  // Outside the provider (rare, e.g. a modal rendered elsewhere): stay in USD.
  return {
    options: null,
    currency: { code: 'USD', name: 'US Dollar', symbol: '$', flag: '🇺🇸', country: 'United States', decimals: 2, enabled: true, rate: 1 },
    setCurrency: async () => false,
    fmt: (usd: number) => (Number(usd) || 0).toFixed(2),
    money: (usd: number) => `$${(Number(usd) || 0).toFixed(2)}`,
    rateNote: () => '',
    reload: async () => {},
  };
}
