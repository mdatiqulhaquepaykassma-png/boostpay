/**
 * tools/bootstrap.test.mts — slim bootstrap + incremental delta (needs a local server)
 *   python3 tools/seed-local-db.py 100   (or the prod-scale seed)
 *   server on :3901, then:  ./node_modules/.bin/tsx tools/bootstrap.test.mts
 */
const API = process.env.API || 'http://127.0.0.1:3901';
const store = new Map<string, string>();
const writes: Record<string, number> = {};
(globalThis as any).localStorage = {
  getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
  setItem: (k: string, v: string) => { store.set(k, v); writes[k] = (writes[k] || 0) + 1; },
  removeItem: (k: string) => { store.delete(k); },
  clear: () => store.clear()
};
(globalThis as any).window = { addEventListener() {}, removeEventListener() {}, dispatchEvent() {} };
(globalThis as any).navigator = { userAgent: 'node-test' };
const realFetch = globalThis.fetch;
let fetchedUrls: string[] = [];
(globalThis as any).fetch = async (url: string, init?: any) => {
  const full = String(url).startsWith('/') ? API + url : String(url);
  fetchedUrls.push(full.replace(API, ''));
  return realFetch(full, init);
};

const login = async () => {
  const r = await realFetch(API + '/api/users/login', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'u1@gmail.com', password: 'Staging123!' })
  });
  return r.json() as any;
};

let pass = 0, fail = 0;
const ck = (n: string, ok: boolean, x = '') => { ok ? pass++ : fail++; console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${n}${x ? ' — ' + x : ''}`); };

const auth = await login();
const H = { authorization: 'Bearer ' + auth.token };

const bytes = async (path: string) => {
  const r = await realFetch(API + path, { headers: { ...H, 'accept-encoding': 'gzip' } });
  const buf = Buffer.from(await r.arrayBuffer());
  return { size: buf.length, json: JSON.parse(buf.toString('utf8')) };
};

console.log('\n[1] payload size');
const full = await bytes('/api/db');
const slim = await bytes('/api/db?slim=1');
const dir = await bytes('/api/db?slim=1&only=users');
ck('slim bootstrap is much smaller than the full payload', slim.size * 5 < full.size, `${(full.size / 1024).toFixed(0)} KB → ${(slim.size / 1024).toFixed(1)} KB (${(full.size / slim.size).toFixed(1)}x smaller)`);
ck('directory-only refresh is small', dir.size < 45_000, `${(dir.size / 1024).toFixed(1)} KB`);
ck('directory-only carries the users, not the streams', Array.isArray(dir.json.users) && dir.json.users.length > 1 && dir.json.transactions.length === 0 && dir.json.notifications.length === 0);

console.log('\n[2] window + cursors');
ck('slim marks itself', slim.json.slim === true);
ck('transactions windowed', slim.json.transactions.length <= 120, `${slim.json.transactions.length} rows`);
ck('notifications windowed', slim.json.notifications.length <= 120, `${slim.json.notifications.length} rows`);
ck('messages windowed', slim.json.messages.length <= 300, `${slim.json.messages.length} rows`);
ck('cursors returned', !!slim.json.cursors && Number(slim.json.cursors.transactions) > 0, JSON.stringify(slim.json.cursors));

console.log('\n[3] incremental delta');
const since = slim.json.cursors.transactions;
// The cursor deliberately steps back 60 s (SLIM_CURSOR_SLACK_MS) so a row written
// on another device while the previous request was in flight is re-sent instead of
// lost. So an immediate re-poll returns only that small overlap — never history.
const empty = await bytes('/api/db?slim=1&since=' + since);
ck('nothing new → only the tiny overlap window comes back',
  empty.json.transactions.length <= 5 && empty.json.notifications.length <= 5,
  `${empty.json.transactions.length} tx / ${empty.json.notifications.length} notif`);
const fullHistory = slim.json.transactions.length;
ck('the overlap is a fraction of the window, not the history', empty.json.transactions.length < Math.max(1, fullHistory / 10), `${empty.json.transactions.length} vs window ${fullHistory}`);
const send = await realFetch(API + '/api/transfer', {
  method: 'POST', headers: { 'content-type': 'application/json', ...H },
  body: JSON.stringify({ senderId: 'U1', recipientId: 'U2', amount: 0.5, idempotencyKey: 'boot' + Date.now() })
});
ck('a real send succeeds', send.ok, `status=${send.status}`);
const delta = await bytes('/api/db?slim=1&since=' + since);
ck('delta carries exactly the new rows', delta.json.transactions.length >= 1 && delta.json.transactions.length <= 3, `${delta.json.transactions.length} tx`);
ck('delta (with directory) is compact', delta.size < 45000, `${(delta.size / 1024).toFixed(1)} KB`);
const stream = await bytes('/api/db?slim=1&since=' + since + '&only=stream');
ck('stream-poll mode is even smaller (no directory, no config)', stream.size < 3000, `${(stream.size / 1024).toFixed(1)} KB`);
ck('stream mode still returns my own record', !!stream.json.me && !!stream.json.me.id, JSON.stringify(stream.json.me && { id: stream.json.me.id, balance: stream.json.me.balance }));

console.log('\n[4] the app merges instead of replacing (no history loss)');
localStorage.setItem('boostpay_auth_token_v1', auth.token);
localStorage.setItem('boostpay_current_user_v4', JSON.stringify(auth.user));
localStorage.setItem('boostpay_users_v4', JSON.stringify([auth.user]));
// pretend this phone already holds 4 000 old transactions that the slim window does NOT contain
const oldTx = Array.from({ length: 4000 }, (_, i) => ({ id: 'TX-local-' + i, userId: 'U1', type: 'TRANSFER_SENT', amount: 1, timestamp: Date.now() - (i + 500) * 60000, notes: 'old' }));
localStorage.setItem('boostpay_transactions_v4', JSON.stringify(oldTx));
const oldMsgs = Array.from({ length: 900 }, (_, i) => ({ id: 'M-local-' + i, conversationId: 'C1', senderId: 'U1', recipientId: 'U2', text: 'old', timestamp: Date.now() - (i + 500) * 60000 }));
localStorage.setItem('boostpay_messages_v4', JSON.stringify(oldMsgs));

const { BoostPayStore } = await import('../src/services/store.ts');
fetchedUrls = [];
await BoostPayStore.initSync();
const afterTx = BoostPayStore.getTransactions();
const afterMsgs = JSON.parse(localStorage.getItem('boostpay_messages_v4') || '[]');
ck('initSync used the slim endpoint', fetchedUrls.some((u) => u.includes('/api/db?slim=1')), fetchedUrls.join(' '));
ck('local history survives (4000 old + new rows)', afterTx.length >= 4000, `${afterTx.length} rows`);
ck('server rows were merged in', afterTx.some((t: any) => String(t.id).startsWith('TX-') && !String(t.id).startsWith('TX-local-')), 'yes');
const ids = afterTx.map((t: any) => String(t.id));
ck('merging is by id — no duplicate rows pile up', new Set(ids).size === ids.length, `${ids.length - new Set(ids).size} dups`);
ck('chat history survives too', afterMsgs.length >= 900, `${afterMsgs.length} messages`);
ck('a sync cursor is stored for next launch', Number(localStorage.getItem('boostpay_sync_cursor_v1') || 0) > 0, localStorage.getItem('boostpay_sync_cursor_v1') || '');

fetchedUrls = [];
await Promise.all([BoostPayStore.initSync(), BoostPayStore.initSync(), BoostPayStore.initSync()]);
ck('three simultaneous startup calls → ONE download', fetchedUrls.filter((u) => u.includes('/api/db')).length === 1, fetchedUrls.join(' '));

console.log(`\nRESULT ${pass} pass / ${fail} fail`);
process.exit(fail ? 1 : 0);
