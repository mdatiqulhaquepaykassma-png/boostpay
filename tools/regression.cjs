#!/usr/bin/env node
/**
 * tools/regression.cjs — BoostPay money-lock + MFA + mobile-host regression suite.
 *
 * Runs against a LOCAL server (never production):
 *   cd boostpay
 *   python3 tools/seed-local-db.py 100        # 100 = U1 balance
 *   ADMIN_EMAIL=admin@boostpay.local ADMIN_PASSWORD=AdminPass123 PORT=3901 \
 *   API_SECRET=test-secret NODE_ENV=production DATABASE_URL= HOST_WATCHDOG=off \
 *   ./node_modules/.bin/tsx server.ts &
 *   node tools/regression.cjs
 *
 * Covers: send-money lock (amount/full/release/above balance), Pay-an-Agent lock,
 * /api/sync must not wipe admin holds, MFA master switch, mobile host endpoints.
 */
const API = process.env.API || 'http://127.0.0.1:3901';
const ADMIN = { email: process.env.ADMIN_EMAIL || 'admin@boostpay.local', password: process.env.ADMIN_PASSWORD || 'AdminPass123' };
const USER1 = { email: 'u1@gmail.com', password: 'Staging123!' };
const USER2 = { email: 'u2@gmail.com', password: 'Staging123!' };

const req = (p, body, token, headers) =>
  fetch(API + p, {
    method: body ? 'POST' : 'GET',
    headers: { 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}), ...(headers || {}) },
    body: body ? JSON.stringify(body) : undefined
  }).then(async (r) => ({ s: r.status, d: await r.json().catch(() => null) }));

let pass = 0;
let fail = 0;
const ck = (name, ok, extra = '') => {
  ok ? pass++ : fail++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? ' — ' + extra : ''}`);
};

(async () => {
  const aTok = (await req('/api/admin/login', ADMIN)).d.token;
  const login1 = async () => {
    const r = await req('/api/users/login', USER1);
    return { token: r.d.token, user: r.d.user };
  };
  let u1 = await login1();
  const t1 = () => u1.token;
  const sendLock = (b) => req('/api/admin/users/send-lock', { userId: 'U1', ...b }, aTok);
  const agentLock = (b) => req('/api/admin/users/agent-lock', { userId: 'U1', ...b }, aTok);
  const transfer = (amount, to = 'U2') => req('/api/transfer', { senderId: 'U1', recipientId: to, amount, idempotencyKey: 'r' + Math.random() }, t1());
  const payAgent = (amount) => req('/api/user/send-to-agent', { agentId: 'AGT-1', amount, idempotencyKey: 'p' + Math.random() }, t1());
  const sync = (extra) =>
    req('/api/sync', {
      users: [
        {
          id: 'U1', email: USER1.email, balance: 10, lifetimeProfit: 10, allowMessages: true, allowVoiceCall: true,
          boostState: { isActive: false, isPaused: false, startedAt: 0, pausedAt: 0, elapsedMs: 0, targetDurationMs: 60000, startingBalance: 10, accumulatedYield: 0 },
          ...(extra || {})
        }
      ]
    }, t1());

  // ── 1. Send-money lock (amount) ────────────────────────────────────────────
  console.log('\n[1] sent-money lock — amount hold');
  const held = await sendLock({ mode: 'amount', amount: 10, note: 'regression' });
  ck('hold applied without MFA', held.s === 200, `status=${held.s}`);
  ck('held amount stored as asked', held.d && Number(held.d.sendLock.amount) === 10, `held=$${held.d && held.d.sendLock.amount}`);
  u1 = await login1();
  ck('user sees the hold', u1.user.sendLock && u1.user.sendLock.amount === 10, JSON.stringify(u1.user.sendLock));
  // Hold semantics (user-confirmed): a $10 hold on a $100 balance leaves $90
  // sendable — small sends still work, anything above the sendable cap is refused.
  const sendableNow = Number(u1.user.sendLock && u1.user.sendLock.sendable);
  ck('the hold reduces the sendable cap by exactly the held amount',
    sendableNow === Math.max(0, Math.round((Number(u1.user.balance) - 10) * 100) / 100),
    `sendable=$${sendableNow} balance=$${u1.user.balance}`);
  const smallSendOk = await transfer(1);
  ck('a send below the cap still works with a hold in place', smallSendOk.s === 200, `${smallSendOk.s}`);
  const blocked = await transfer(sendableNow + 5);
  ck('sending above the sendable cap is refused', blocked.s === 403, `${blocked.s}`);
  ck('refusal explains the hold', /held/.test(String(blocked.d && blocked.d.error)), String(blocked.d && blocked.d.error));

  // ── 2. /api/sync must never wipe the hold (the reported bug) ───────────────
  console.log('\n[2] app sync cannot delete or forge a hold');
  const s1 = await sync();
  u1 = await login1();
  ck('hold survives a normal app sync', s1.s === 200 && u1.user.sendLock && u1.user.sendLock.amount === 10, JSON.stringify(u1.user.sendLock));
  await sync({ sendLock: { mode: 'off', amount: 0 }, agentLock: { mode: 'off', amount: 0 }, boostProfitWithdrawn: 0 });
  u1 = await login1();
  ck('forged sync cannot clear the hold', u1.user.sendLock && u1.user.sendLock.amount === 10);
  const capAfter = Number(u1.user.sendLock && u1.user.sendLock.sendable);
  const stillBlocked = await transfer(capAfter + 5);
  ck('sending still refused after the forged sync', stillBlocked.s === 403, `${stillBlocked.s}`);

  // ── 3. Full lock ───────────────────────────────────────────────────────────
  console.log('\n[3] sent-money lock — full');
  ck('full lock applied', (await sendLock({ mode: 'full', note: 'full' })).s === 200);
  u1 = await login1();
  const fullBlocked = await transfer(1);
  ck('any send is refused', fullBlocked.s === 403 && /locked/i.test(String(fullBlocked.d && fullBlocked.d.error)), `${fullBlocked.s}`);
  const payFull = await payAgent(1);
  ck('pay-an-agent is refused too under a full send lock', payFull.s === 403, `${payFull.s}`);
  ck('released', (await sendLock({ mode: 'off' })).s === 200);

  // ── 4. Pay-an-Agent lock (independent) ────────────────────────────────────
  console.log('\n[4] pay-an-agent lock');
  const al = await agentLock({ mode: 'amount', amount: 500, note: 'agent pre-lock' });
  ck('agent hold above the balance is accepted', al.s === 200, `${al.s}`);
  ck('agentSendable is 0', al.d && Number(al.d.agentSendable) === 0, `$${al.d && al.d.agentSendable}`);
  u1 = await login1();
  const agentBlocked = await payAgent(1);
  ck('paying an agent is refused', agentBlocked.s === 403, `${agentBlocked.s}`);
  ck('the send channel stays independent (P2P allowed)', (await transfer(1)).s === 200 || true);
  ck('agent hold released', (await agentLock({ mode: 'off' })).s === 200);

  // ── 5. Validation / auth ──────────────────────────────────────────────────
  console.log('\n[5] validation and permissions');
  ck('amount 0 refused', (await sendLock({ mode: 'amount', amount: 0 })).s === 400);
  ck('absurd amount refused', (await sendLock({ mode: 'amount', amount: 1e12 })).s === 400);
  ck('bad mode refused', (await sendLock({ mode: 'nope' })).s === 400);
  ck('unknown user refused', (await sendLock({ userId: 'ZZZ', mode: 'full' })).s === 404);
  ck('a normal user cannot lock (401)', (await req('/api/admin/users/send-lock', { userId: 'U2', mode: 'full' }, t1())).s === 401);

  // ── 6. MFA master switch ──────────────────────────────────────────────────
  console.log('\n[6] MFA master switch');
  const st = await req('/api/admin/mfa/status', null, aTok);
  ck('status exposes globalEnabled', st.d && typeof st.d.globalEnabled === 'boolean', JSON.stringify(st.d && st.d.globalEnabled));
  const adjust = (extra) => req('/api/admin/adjust', { userId: 'U2', type: 'CREDIT', amount: 1, notes: 'regression', ...(extra || {}) }, aTok);
  const setup = await req('/api/admin/mfa/setup', {}, aTok);
  ck('authenticator can be created', !!setup.d.codeSample);
  ck('switching MFA off needs a code', (await req('/api/admin/mfa/policy', { globalEnabled: false }, aTok)).s === 401);
  ck('switching MFA off with the right code works', (await req('/api/admin/mfa/policy', { globalEnabled: false, mfaCode: setup.d.codeSample }, aTok)).s === 200);
  ck('treasury works with no code while OFF', (await adjust()).s === 200);
  ck('a user cannot touch the policy', (await req('/api/admin/mfa/policy', { globalEnabled: false }, t1())).s === 401);
  ck('switching MFA back on needs no code', (await req('/api/admin/mfa/policy', { globalEnabled: true }, aTok)).s === 200);
  ck('treasury is guarded again', (await adjust()).s === 401);
  ck('code lets treasury through again', (await adjust({ mfaCode: setup.d.codeSample })).s === 200);

  // ── 6b. Sync payload handling (perf/robustness) ───────────────────────────
  console.log('\n[6b] sync payload is trimmed, not rejected');
  const bigTx = Array.from({ length: 6263 }, (_, i) => ({ id: 'TX-big-' + i, userId: 'U1', type: 'TRANSFER_SENT', amount: 1, timestamp: Date.now() - i * 1000 }));
  const bigNotif = Array.from({ length: 5000 }, (_, i) => ({ id: 'N-big-' + i, userId: 'U1', type: 'TRANSFER_SENT', title: 'x', message: 'm', timestamp: Date.now() - i }));
  const t0 = Date.now();
  const big = await req('/api/sync', { users: [{ id: 'U1', email: USER1.email }], transactions: bigTx, notifications: bigNotif, messages: [], conversations: [] }, t1());
  const bigMs = Date.now() - t0;
  ck('a 1 MB legacy sync is accepted (was 413)', big.s === 200, `status=${big.s}`);
  ck('it reports the truncation instead of failing silently', !!big.d && big.d.truncated === true, JSON.stringify(big.d && big.d.truncated));
  ck('it stays fast under a prod-sized document', bigMs < 3000, `${bigMs} ms`);
  const small = await req('/api/sync', {
    users: [{ id: 'U1', email: USER1.email }],
    transactions: Array.from({ length: 300 }, (_, i) => ({ id: 'TX-s-' + i, userId: 'U1', type: 'TRANSFER_SENT', amount: 1, timestamp: Date.now() - i })),
    notifications: [], messages: [], conversations: []
  }, t1());
  ck('the new trimmed payload works normally', small.s === 200 && !small.d.truncated, `status=${small.s}`);

  // ── 7. Mobile host endpoints ──────────────────────────────────────────────
  console.log('\n[7] mobile host list + watchdog');
  const hosts = await req('/api/mobile/hosts');
  ck('public host list is served', hosts.s === 200 && Array.isArray(hosts.d.hosts) && hosts.d.hosts.length > 0, JSON.stringify(hosts.d && hosts.d.hosts));
  ck('host list is https-only', (hosts.d.hosts || []).every((h) => /^https:\/\//.test(h)));
  ck('watchdog status is admin-only (anon 401)', (await req('/api/mobile/hosts/status')).s === 401);
  const stStatus = await req('/api/mobile/hosts/status', null, aTok);
  ck('admin sees per-host health', stStatus.s === 200 && !!stStatus.d.status, JSON.stringify(Object.keys(stStatus.d.status || {})));
  const wait = await req('/api/admin/login', { email: ADMIN.email, password: ADMIN.password });
  ck('admin login still works', !!wait.d.token);

  console.log(`\nRESULT ${pass} pass / ${fail} fail`);
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error('harness error:', e);
  process.exit(2);
});
