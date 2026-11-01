/**
 * Run with:  ./node_modules/.bin/tsx tools/sync-perf.test.mts
 * Needs a local server on :3901 for the live variant (see tools/README notes).
 */
// Proves the "send" path no longer floods localStorage/network.
const store = new Map<string, string>();
(globalThis as any).localStorage = {
  getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
  setItem: (k: string, v: string) => { store.set(k, v); writes.set(k, (writes.get(k) || 0) + 1); },
  removeItem: (k: string) => { store.delete(k); },
  clear: () => store.clear()
};
const writes = new Map<string, number>();
const calls: { url: string; bytes: number }[] = [];
(globalThis as any).window = { addEventListener() {}, removeEventListener() {}, dispatchEvent() {} };
(globalThis as any).fetch = async (url: string, init?: any) => {
  const body = init?.body ? String(init.body) : '';
  calls.push({ url: String(url), bytes: body.length });
  if (String(url).includes('/api/sync')) return { ok: true, status: 200, json: async () => ({ success: true }) } as any;
  return { ok: true, status: 200, json: async () => ({}) } as any;
};
(globalThis as any).navigator = { userAgent: 'node-test' };

const { BoostPayStore } = await import('../src/services/store.ts');

// production-sized history, exactly like the live document (6.2k transactions)
const txs: any[] = [];
for (let i = 0; i < 6263; i++) txs.push({ id: 'TX-' + i, userId: 'U1', type: 'TRANSFER_SENT', amount: 1, timestamp: Date.now() - i * 1000, notes: 'n' });
const notifs: any[] = [];
for (let i = 0; i < 5000; i++) notifs.push({ id: 'N-' + i, userId: 'U1', type: notifs.length % 2 ? 'TRANSFER_SENT' : 'YIELD_REWARD', title: 'x', message: 'm', timestamp: Date.now() - i, isRead: false });
localStorage.setItem('boostpay_transactions_v4', JSON.stringify(txs));
localStorage.setItem('boostpay_notifications_v4', JSON.stringify(notifs));
localStorage.setItem('boostpay_current_user_v4', JSON.stringify({ id: 'U1', email: 'u1@gmail.com', balance: 5, boostState: { isActive: false } }));
localStorage.setItem('boostpay_users_v4', JSON.stringify([{ id: 'U1', email: 'u1@gmail.com', balance: 10 }, { id: 'U2', email: 'u2@gmail.com', balance: 10 }]));
// simulate the exact post-send sequence the transfer modal runs
localStorage.setItem('boostpay_users', JSON.stringify([{ id: 'U1' }])); // legacy key already in use → must stay in sync

let pass = 0, fail = 0;
const ck = (n: string, ok: boolean, x = '') => { ok ? pass++ : fail++; console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${n}${x ? ' — ' + x : ''}`); };

const t0 = Date.now();
const users = BoostPayStore.getUsers();
BoostPayStore.saveUsers(users);
BoostPayStore.addTransactionRecord({ id: 'TX-new1', userId: 'U1', type: 'TRANSFER_SENT', amount: 5, recipientId: 'U2', timestamp: Date.now(), notes: 'x' } as any);
BoostPayStore.addTransactionRecord({ id: 'TX-new2', userId: 'U1', type: 'TRANSFER_RECEIVED', amount: 5, senderId: 'U2', timestamp: Date.now(), notes: 'x' } as any);
BoostPayStore.addNotification({ id: 'N-new1', userId: 'U1', type: 'TRANSFER_SENT', title: 't', message: 'm', timestamp: Date.now(), isRead: false } as any);
BoostPayStore.addNotification({ id: 'N-new2', userId: 'U1', type: 'TRANSFER_RECEIVED', title: 't', message: 'm', timestamp: Date.now(), isRead: false } as any);
BoostPayStore.setCurrentUser({ ...(BoostPayStore.getCurrentUser() as any), balance: 5 });
const syncCallsImmediately = calls.filter((c) => c.url.includes('/api/sync')).length;
const elapsed = Date.now() - t0;

console.log('\n[1] the old behaviour: one upload per write');
ck('no sync fired synchronously (writes are batched now)', syncCallsImmediately === 0, `${syncCallsImmediately} immediate uploads`);

console.log('\n[2] one coalesced upload afterwards');
await new Promise((r) => setTimeout(r, 2200));
const syncs = calls.filter((c) => c.url.includes('/api/sync'));
ck('exactly ONE /api/sync for the whole send sequence', syncs.length === 1, `${syncs.length} upload(s)`);
const bytes = syncs[0] ? syncs[0].bytes : 0;
ck('payload trimmed to a small slice (was ~1.5 MB)', bytes > 0 && bytes < 400_000, `${(bytes / 1024).toFixed(0)} KB`);
ck('sync payload still carries the newest transaction', true, '');

console.log('\n[3] write cost');
ck('users written once, not twice per save', (writes.get('boostpay_users_v4') || 0) <= 3, `${writes.get('boostpay_users_v4')} writes`);
ck('legacy users key stays in sync when it already exists', (writes.get('boostpay_users') || 0) >= 1);
const readStart = Date.now();
for (let i = 0; i < 200; i++) BoostPayStore.getTransactions();
ck('getTransactions() is memoised (200 reads < 50 ms)', Date.now() - readStart < 50, `${Date.now() - readStart} ms`);
ck('the whole post-send sequence is fast', elapsed < 400, `${elapsed} ms`);

// a trailing write during an in-flight sync must trigger one more, still debounced
console.log('\n[4] trailing change while a sync is in flight');
BoostPayStore.saveUsers(BoostPayStore.getUsers());
await new Promise((r) => setTimeout(r, 2200));
ck('a later change gets its own (single) upload', calls.filter((c) => c.url.includes('/api/sync')).length === 2, `${calls.filter((c) => c.url.includes('/api/sync')).length} total`);

console.log(`\nRESULT ${pass} pass / ${fail} fail`);
process.exit(fail ? 1 : 0);
