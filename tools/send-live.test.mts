/**
 * Run with:  ./node_modules/.bin/tsx tools/send-live.test.mts
 * Needs a local server on :3901 for the live variant (see tools/README notes).
 */
// End-to-end against the LOCAL server: does the real user path still work, and is it fast?
const store = new Map<string, string>();
(globalThis as any).localStorage = {
  getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
  setItem: (k: string, v: string) => { store.set(k, v); },
  removeItem: (k: string) => { store.delete(k); },
  clear: () => store.clear()
};
(globalThis as any).window = { addEventListener() {}, removeEventListener() {}, dispatchEvent() {} };
(globalThis as any).navigator = { userAgent: 'node-test' };
const API = 'http://127.0.0.1:3901';
const realFetch = globalThis.fetch;

const login = async () => {
  const r = await realFetch(API + '/api/users/login', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'u1@gmail.com', password: 'Staging123!' })
  });
  return r.json() as any;
};

const { BoostPayStore } = await import('../src/services/store.ts');

let pass = 0, fail = 0;
const ck = (n: string, ok: boolean, x = '') => { ok ? pass++ : fail++; console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${n}${x ? ' — ' + x : ''}`); };

const auth = await login();
localStorage.setItem('boostpay_auth_token_v1', auth.token);
localStorage.setItem('boostpay_current_user_v4', JSON.stringify(auth.user));
localStorage.setItem('boostpay_users_v4', JSON.stringify([auth.user]));
// prod-sized local history on the phone
const txs: any[] = [];
for (let i = 0; i < 6263; i++) txs.push({ id: 'TX-old-' + i, userId: 'U1', type: 'TRANSFER_SENT', amount: 1, timestamp: Date.now() - i * 1000, notes: 'n' });
localStorage.setItem('boostpay_transactions_v4', JSON.stringify(txs));
localStorage.setItem('boostpay_notifications_v4', JSON.stringify(Array.from({ length: 5000 }, (_, i) => ({ id: 'N-old-' + i, userId: 'U1', type: 'TRANSFER_SENT', title: 'x', message: 'm', timestamp: Date.now() - i, isRead: false }))));

// count + measure the real /api/sync calls the app makes
const syncs: { ms: number; bytes: number; status: number }[] = [];
(globalThis as any).fetch = async (url: string, init?: any) => {
  const started = Date.now();
  const res: any = await realFetch(String(url).startsWith('/') ? API + url : url, init);
  if (String(url).includes('/api/sync')) {
    syncs.push({ ms: Date.now() - started, bytes: init?.body ? String(init.body).length : 0, status: res.status });
  }
  return res;
};

const t0 = Date.now();
const users = BoostPayStore.getUsers();
BoostPayStore.saveUsers(users);
BoostPayStore.addTransactionRecord({ id: 'TX-live1', userId: 'U1', type: 'TRANSFER_SENT', amount: 0.5, recipientId: 'U2', timestamp: Date.now(), notes: 'x' } as any);
BoostPayStore.addNotification({ id: 'N-live1', userId: 'U1', type: 'TRANSFER_SENT', title: 't', message: 'm', timestamp: Date.now(), isRead: false } as any);
BoostPayStore.setCurrentUser({ ...(BoostPayStore.getCurrentUser() as any), balance: Number(auth.user.balance) });
const uiMs = Date.now() - t0;
ck('the UI-side work after a send is instant', uiMs < 300, `${uiMs} ms`);

await new Promise((r) => setTimeout(r, 2500));
ck('only ONE upload happened', syncs.length === 1, `${syncs.length} upload(s)`);
ck('the upload was accepted (no more 413)', syncs[0]?.status === 200, `status=${syncs[0]?.status}`);
ck('upload stayed small', (syncs[0]?.bytes || 0) < 400_000, `${((syncs[0]?.bytes || 0) / 1024).toFixed(0)} KB`);
ck('upload finished quickly', (syncs[0]?.ms || 9999) < 1500, `${syncs[0]?.ms} ms`);

// and a real transfer still works + how long the server takes
const before = (BoostPayStore.getCurrentUser() as any).balance;
const res: any = await realFetch(API + '/api/transfer', {
  method: 'POST',
  headers: { 'content-type': 'application/json', authorization: 'Bearer ' + auth.token },
  body: JSON.stringify({ senderId: 'U1', recipientId: 'U2', amount: 0.5, idempotencyKey: 'live' + Date.now() })
});
const t = Date.now();
const body = await res.json().catch(() => ({}));
const ms = Date.now() - t;
ck('a real P2P send still succeeds', res.ok && !!body.success, `status=${res.status} ${body.error || ''}`);

console.log(`\nRESULT ${pass} pass / ${fail} fail`);
process.exit(fail ? 1 : 0);
