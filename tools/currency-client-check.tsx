/**
 * Regression check for the display-currency client (user app).
 *
 * The bug this guards against: the picker read the bearer token from a key the
 * app never writes (`boostpay_token`), so POST /api/user/currency went out
 * unauthenticated, the server answered 401, and the global "any 401 while signed
 * in = session expired" handler bounced the user to the login screen.
 *
 * Run:   ./node_modules/.bin/tsx tools/currency-client-check.tsx
 */
import React from 'react';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { renderToString } from 'react-dom/server';
import { CurrencyProvider, useCurrency, convertAmount, convertPrice, convertText } from '../src/lib/currency';

let pass = 0, fail = 0;
function ck(name: string, ok: boolean, detail: string) {
  if (ok) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name} — ${detail}`); }
}

// ── a browser-ish environment ────────────────────────────────────────────────
const store = new Map<string, string>();
(globalThis as any).localStorage = {
  getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
  setItem: (k: string, v: string) => { store.set(k, String(v)); },
  removeItem: (k: string) => { store.delete(k); },
};

type Call = { url: string; auth: string; body: string };
let calls: Call[] = [];
(globalThis as any).fetch = async (url: string, init: any = {}) => {
  calls.push({ url: String(url), auth: String((init.headers || {}).authorization || ''), body: String(init.body || '') });
  return { ok: true, status: 200, json: async () => ({ success: true, currency: 'GBP', options: { base: 'USD', default: 'USD', selected: 'GBP', refreshedAt: 0, ageMinutes: 0, stale: false, refreshMinutes: 60, currencies: [] } }) };
};

// capture the context the real WalletView would use
let ctx: ReturnType<typeof useCurrency> | null = null;
function Probe() { ctx = useCurrency(); return null; }

async function main() {
  store.clear();
  calls = [];
  renderToString(React.createElement(CurrencyProvider, null, React.createElement(Probe)));
  ck('the provider renders', !!ctx, 'no context');

  // 1. signed in — the token lives under the key the store actually writes
  store.set('boostpay_auth_token_v1', 'tok123');
  calls = [];
  const ok = await ctx!.setCurrency('GBP');
  const post = calls.find((c) => c.url === '/api/user/currency');
  ck('choosing a currency posts to /api/user/currency', !!post, JSON.stringify(calls));
  ck('the request carries the real session token', post?.auth === 'Bearer tok123', `auth=${post?.auth}`);
  ck('the choice is sent as JSON', post?.body.includes('"GBP"') === true, `body=${post?.body}`);
  ck('a successful save returns true', ok === true, String(ok));

  // 2. signed out — never fire the call (a 401 would bounce to login)
  store.clear();
  calls = [];
  const ok2 = await ctx!.setCurrency('EUR');
  ck('with no session the call is skipped entirely', calls.length === 0, JSON.stringify(calls));
  ck('and the picker is told it failed', ok2 === false, String(ok2));

  // 3. legacy key still honoured for old sessions
  store.set('boostpay_token', 'legacy-tok');
  calls = [];
  await ctx!.setCurrency('JPY');
  const legacy = calls.find((c) => c.url === '/api/user/currency');
  ck('an older session key still authenticates', legacy?.auth === 'Bearer legacy-tok', `auth=${legacy?.auth}`);

  // 4. display helpers convert every amount, not just the wallet header
  const BDT = { code: 'BDT', name: 'Bangladeshi Taka', symbol: '৳', flag: '🇧🇩', country: 'Bangladesh', decimals: 2, enabled: true, rate: 100 };
  const USD = { code: 'USD', name: 'US Dollar', symbol: '$', flag: '🇺🇸', country: 'United States', decimals: 2, enabled: true, rate: 1 };
  ck('price(1) shows taka, not dollars', convertPrice(1, BDT) === '≈ ৳100.00', convertPrice(1, BDT));
  ck('price keeps micro-profit precision', convertPrice(0.00000125, BDT) === '≈ ৳0.000125', convertPrice(0.00000125, BDT));
  ck('amount() converts without a symbol', convertAmount(12.5, BDT) === '1,250.00', convertAmount(12.5, BDT));
  ck('a micro amount keeps at least 2 decimals', convertAmount(0, BDT) === '0.00', convertAmount(0, BDT));
  ck('USD still reads as dollars', convertPrice(12.5, USD) === '$12.50', convertPrice(12.5, USD));
  // the symbol must appear exactly once — it used to be glued on twice in the
  // balance header and in the send modal ("≈ ৳৳1,234.56")
  const once = (s2: string, sym: string) => s2.split(sym).length - 1 === 1;
  ck('price() prints the symbol exactly once', once(convertPrice(1234.56, BDT), '৳'), convertPrice(1234.56, BDT));
  ck('price() USD prints the dollar sign exactly once', once(convertPrice(12.5, USD), '$'), convertPrice(12.5, USD));
  ck('a server notification is rewritten into taka',
    convertText('CREDIT ALERT: $12.50 credited. Ref: ABC', BDT) === 'CREDIT ALERT: ৳1,250.00 credited. Ref: ABC',
    convertText('CREDIT ALERT: $12.50 credited. Ref: ABC', BDT));
  ck('a multi-amount sentence converts every figure',
    convertText('$1.00 sent, $0.25 fee, $0.75 left', BDT) === '৳100.00 sent, ৳25.00 fee, ৳75.00 left',
    convertText('$1.00 sent, $0.25 fee, $0.75 left', BDT));
  ck('text without dollars is untouched', convertText('Ref: ABC', BDT) === 'Ref: ABC', convertText('Ref: ABC', BDT));
  ck('USD leaves notification text alone', convertText('$12.50 credited', USD) === '$12.50 credited', convertText('$12.50 credited', USD));

  // 5. source audit — no user-app screen may still print a hard-coded dollar figure
  const dir = join(process.cwd(), 'src', 'components');
  const ALLOWED = [
    // the USD base line printed *under* the converted balance, on purpose
    'WalletView.tsx: $${formatPrecisionAmount(currentTotal, 8)} USD in your wallet',
    // the transaction row keeps the USD original in small print when converted
    'PaginatedTransactionsView.tsx / RecentTransactionsSection.tsx: USD reference line',
  ];
  const offenders: string[] = [];
  /** Lines that legitimately mention USD: the base-currency reference line, the
   *  "which currency am I typing in" branch, and explanatory comments. */
  const ALLOW = [
    /^\s*(\/\/|\*|\/\*)/,                 // comment
    /\.code !== 'USD'/,                      // converted-vs-USD branch
    /=== 'USD'/,                             // entry-currency branch
    /USD in your wallet/,                    // the intentionally kept USD base line
    /`\$\$\{formatPrecisionAmount\(tx\.amount, 8\)\} USD`/, // small USD reference under a converted row
    /stored in USD|converts to USD/,         // prose
    /^\s*\{\/\*/,                          // JSX comment
    /suffix="USD"/,                          // USD branch of the balance ticker
    /suffix=\{currency\?\.code \|\| 'USD'\}/, // ticker default when no table is loaded
    /title=\{/,                                // prose tooltip
    /\|\| 'USD'/,                              // fallback label, not a money figure
  ];
  for (const f of readdirSync(dir)) {
    if (!f.endsWith('.tsx')) continue;
    if (f === 'SmoothNumericTicker.tsx') continue; // prefix/suffix come from the caller
    const src = readFileSync(join(dir, f), 'utf8');
    src.split('\n').forEach((line, i) => {
      if (/className=/.test(line)) return;
      if (ALLOW.some((re) => re.test(line))) return;
      const hitsDollar = /\$\$\{|([>+\-:( ])\$\{?[0-9]|`\$\{?[0-9]/.test(line);
      const hitsUsdLabel = /\bUSD\b/.test(line);
      if (hitsDollar || hitsUsdLabel) offenders.push(`${f}:${i + 1}: ${line.trim().slice(0, 110)}`);
    });
  }
  const doubled: string[] = [];
  for (const f of readdirSync(dir)) {
    if (!f.endsWith('.tsx')) continue;
    const src = readFileSync(join(dir, f), 'utf8');
    src.split('\n').forEach((line, i) => {
      // `${currency.symbol}${fmt(...)}` / `{currency.symbol}{price(...)}`: the helper already prints it
      if (/\$\{\s*(currency|c|cur)\??\.symbol\s*\}\$\{\s*(fmt|price|money)\s*\(/.test(line)
        || /\{\s*currency\??\.symbol\s*\}\{\s*(fmt|price|money)\s*\(/.test(line)) {
        doubled.push(`${f}:${i + 1}: ${line.trim().slice(0, 100)}`);
      }
    });
  }
  ck('no screen stacks the currency symbol on top of fmt()/price()', doubled.length === 0, doubled.join(' | '), 'HIGH');

  ck('no user-app screen still prints a hard-coded dollar amount', offenders.length === 0,
    offenders.slice(0, 8).join(' | '), 'HIGH');

  console.log(`\nRESULT ${pass} pass / ${fail} fail`);
  if (fail) process.exit(1);
}
void main();
