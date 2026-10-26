// BoostPay staging load generator — node 20, no dependencies.
// Every virtual user gets its own token AND its own X-Forwarded-For IP, so the
// server's per-IP/per-user rate limiters behave like real distinct devices
// (one shared IP would just measure the 429 limiter).
// env: BASE, SECRET, USERS
import http from 'node:http';
import crypto from 'node:crypto';

const BASE = new URL(process.env.BASE || 'http://bp-staging:3999');
const SECRET = process.env.SECRET || 'staging-secret';
const USERS = Number(process.env.USERS || 2000);
const agent = new http.Agent({ keepAlive: true, maxSockets: 6000 });
const uid = n => `U${String(n).padStart(5, '0')}`;
const ipFor = n => `10.${(n >> 16) & 255}.${(n >> 8) & 255}.${(n % 254) + 1}`;

const toks = new Map();
function tok(n) {
  n = ((n - 1) % USERS) + 1;
  let t = toks.get(n);
  if (!t) {
    const payload = { sub: uid(n), role: 'USER', exp: Date.now() + 6 * 3600 * 1000, sid: `SESS-LT${n}` };
    const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
    t = `${body}.${crypto.createHmac('sha256', SECRET).update(body).digest('base64url')}`;
    toks.set(n, t);
  }
  return t;
}

function req(method, path, { user = 1, body, gzip = true, stream = false } = {}) {
  const data = body === undefined ? null : Buffer.from(JSON.stringify(body));
  const headers = { 'authorization': `Bearer ${tok(user)}`, 'x-forwarded-for': ipFor(user) };
  if (gzip) headers['accept-encoding'] = 'gzip';
  if (data) { headers['content-type'] = 'application/json'; headers['content-length'] = data.length; }
  const t0 = process.hrtime.bigint();
  return new Promise(resolve => {
    const r = http.request({ host: BASE.hostname, port: BASE.port, method, path, headers, agent }, res => {
      let n = 0; const chunks = [];
      res.on('data', c => { n += c.length; if (!stream && n < 4e5) chunks.push(c); });
      res.on('end', () => resolve({ status: res.statusCode, ms: Number(process.hrtime.bigint() - t0) / 1e6,
        bytes: n, body: Buffer.concat(chunks).toString().slice(0, 200) }));
      if (stream) resolve({ status: res.statusCode, ms: 0, bytes: 0, res });
    });
    r.on('error', e => resolve({ status: 0, ms: Number(process.hrtime.bigint() - t0) / 1e6, bytes: 0, body: String(e.message) }));
    r.setTimeout(30000, () => r.destroy(new Error('timeout')));
    if (data) r.write(data);
    r.end();
  });
}

const pct = (a, p) => (a.length ? a[Math.min(a.length - 1, Math.floor(a.length * p))] : 0);
function report(label, ms, st, bytes, wall) {
  ms.sort((x, y) => x - y);
  const n = ms.length, ok = st[200] || 0;
  const errs = Object.entries(st).filter(([s]) => s !== '200').map(([s, c]) => `${s}:${c}`).join(' ') || '-';
  console.log(`${label} | ${(n / wall).toFixed(0)} req/s | n=${n} ok=${ok} | p50 ${pct(ms, .5).toFixed(1)} ` +
    `p95 ${pct(ms, .95).toFixed(1)} p99 ${pct(ms, .99).toFixed(0)} | ${(bytes / Math.max(1, n) / 1024).toFixed(1)} KB | errs ${errs}`);
  return { rps: n / wall, p50: pct(ms, .5), p95: pct(ms, .95), ok, errs };
}

let rr = 1;                       // round-robin user cursor: spreads the load over the whole base
const nextUser = () => ((rr = (rr % USERS) + 1));

async function ladder(label, makeReq, conc, secs) {
  const ms = [], st = {}; let bytes = 0;
  const t0 = Date.now(), end = t0 + secs * 1000;
  await Promise.all(Array.from({ length: conc }, async (_, w) => {
    while (Date.now() < end) {
      const r = await makeReq(w);
      ms.push(r.ms); st[r.status] = (st[r.status] || 0) + 1; bytes += r.bytes;
    }
  }));
  return report(`  ${label} c=${conc}`, ms, st, bytes, (Date.now() - t0) / 1000);
}

const [scenario, ...args] = process.argv.slice(2);
const num = i => Number(args[i]);

if (scenario === 'read') {                       // throughput ceiling, user rotated per request
  const [path, concs, secs] = [args[0], args[1].split(',').map(Number), num(2)];
  for (const c of concs) await ladder(`GET ${path}`,
    () => req('GET', path, { user: nextUser() }), c, secs);
} else if (scenario === 'post') {
  const [path, concs, secs] = [args[0], args[1].split(',').map(Number), num(2)];
  for (const c of concs) await ladder(`POST ${path}`, () => req('POST', path, { user: nextUser(), body: {} }), c, secs);
} else if (scenario === 'session') {             // realistic mobile devices, real poll intervals
  const [N, secs] = [num(0), num(1)];
  const ms = [], st = {}; let bytes = 0; let last = 0;
  const t0 = Date.now(), end = t0 + secs * 1000;
  const plan = [[0, 4000, 'GET', '/api/db'], [1, 20000, 'POST', '/api/sync'],
                [2, 6000, 'GET', '/api/chat/messages?conversationId=CONV-U00001-U00002'],
                [3, 15000, 'GET', '/api/leaderboard']];
  await Promise.all(Array.from({ length: N }, async (_, w) => {
    const user = w + 1;
    const due = plan.map(([, every]) => Date.now() + Math.random() * every);
    while (Date.now() < end) {
      const now = Date.now();
      let did = false;
      for (let k = 0; k < plan.length; k++) {
        if (now < due[k]) continue;
        const [, every, m, path] = plan[k];
        due[k] = now + every * (0.9 + Math.random() * 0.2);
        const r = m === 'POST' && path === '/api/sync'
          ? await req('POST', path, { user, body: { users: [{ id: uid(user) }] } })
          : await req(m, path, { user });
        ms.push(r.ms); st[r.status] = (st[r.status] || 0) + 1; bytes += r.bytes; last = r.status;
        did = true;
      }
      if (!did) await new Promise(r => setTimeout(r, 120));
    }
  }));
  report(`SESSION devices=${N}`, ms, st, bytes, (Date.now() - t0) / 1000);
} else if (scenario === 'sse') {                 // long-lived chat streams
  const [concs, secs] = [args[0].split(',').map(Number), num(1)];
  for (const c of concs) {
    const streams = []; let opened = 0, failed = 0; const st = {};
    await Promise.all(Array.from({ length: c }, (_, w) => new Promise(res => {
      const user = (w % USERS) + 1;
      const t0 = process.hrtime.bigint();
      const r = http.request({ host: BASE.hostname, port: BASE.port,
        path: `/api/chat/stream?userId=${uid(user)}`,
        headers: { authorization: `Bearer ${tok(user)}`, 'x-forwarded-for': ipFor(user), accept: 'text/event-stream' }, agent },
        resp => {
          if (resp.statusCode !== 200) { failed++; st[resp.statusCode] = (st[resp.statusCode] || 0) + 1; resp.resume(); return res(); }
          opened++; streams.push(resp); res();
        });
      r.on('error', () => { failed++; st[0] = (st[0] || 0) + 1; res(); });
      r.setTimeout(120000, () => {});
      r.end();
    })));
    await new Promise(r => setTimeout(r, secs * 1000));
    const h = await req('GET', '/api/health', { user: 1999, gzip: false });
    console.log(`  SSE c=${c}: opened ${opened} failed ${failed} ${JSON.stringify(st)} | held ${secs}s | health while open=${h.status}`);
    for (const s of streams) s.destroy();
    await new Promise(r => setTimeout(r, 2000));
  }
} else if (scenario === 'write') {               // transfer storm, exactness checked afterwards
  const [n, conc] = [num(0), num(1)];
  const ms = [], st = {}; let bytes = 0, next = 1; const t0 = Date.now();
  await Promise.all(Array.from({ length: conc }, async () => {
    while (next <= n) {
      const i = next++; const me = ((i - 1) % (USERS - 1)) + 1, peer = USERS;
      const r = await req('POST', '/api/transfer', { user: me, body: { senderId: uid(me), recipientId: uid(peer), amount: process.env.AMT || '0.1' } });
      ms.push(r.ms); st[r.status] = (st[r.status] || 0) + 1; bytes += r.bytes;
      if (r.status !== 200 && (st[r.status] || 0) < 3) console.log('    err', r.status, r.body.slice(0, 140));
    }
  }));
  report(`WRITE transfers n=${n}`, ms, st, bytes, (Date.now() - t0) / 1000);
} else if (scenario === 'post-n' ) {             // chat send storm
  const [n, conc] = [num(0), num(1)];
  const ms = [], st = {}; let bytes = 0, next = 1; const t0 = Date.now();
  await Promise.all(Array.from({ length: conc }, async () => {
    while (next <= n) {
      const i = next++; const me = ((i - 1) % (USERS - 1)) + 1, peer = (me % (USERS - 1)) + 1;
      const r = await req('POST', '/api/chat/send', { user: me, body: { senderId: uid(me), recipientId: uid(peer), text: 'staging load message' } });
      ms.push(r.ms); st[r.status] = (st[r.status] || 0) + 1; bytes += r.bytes;
      if (r.status !== 200 && (st[r.status] || 0) < 3) console.log('    err', r.status, r.body.slice(0, 140));
    }
  }));
  report(`CHAT send n=${n}`, ms, st, bytes, (Date.now() - t0) / 1000);
} else if (scenario === 'login') {
  const [n, conc] = [num(0), num(1)];
  const ms = [], st = {}; let bytes = 0, next = 1; const t0 = Date.now();
  await Promise.all(Array.from({ length: conc }, async () => {
    while (next <= n) {
      const i = next++;
      const r = await req('POST', '/api/users/login', { user: i, gzip: false,
        body: { email: `s${String(i).padStart(5, '0')}@gmail.com`, password: 'Staging123!' } });
      ms.push(r.ms); st[r.status] = (st[r.status] || 0) + 1; bytes += r.bytes;
    }
  }));
  report(`LOGIN n=${n}`, ms, st, bytes, (Date.now() - t0) / 1000);
} else if (scenario === 'boost') {
  const K = num(0); let ok = 0; const st = {};
  for (let i = 1; i <= K; i++) {
    const r = await req('POST', '/api/boost/start', { user: i, body: { userId: uid(i) } });
    if (r.status === 200) ok++; else { st[r.status] = (st[r.status] || 0) + 1; if (st[r.status] < 3) console.log(' err', r.status, r.body.slice(0, 160)); }
  }
  console.log(`BOOST start ok=${ok} errs=${JSON.stringify(st)}`);
} else console.log('usage: read|post|session|sse|write|post-n|login|boost ...');
agent.destroy();
