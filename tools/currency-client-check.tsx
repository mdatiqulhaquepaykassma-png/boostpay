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
import { renderToString } from 'react-dom/server';
import { CurrencyProvider, useCurrency } from '../src/lib/currency';

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

  console.log(`\nRESULT ${pass} pass / ${fail} fail`);
  if (fail) process.exit(1);
}
void main();
