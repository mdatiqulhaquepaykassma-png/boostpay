import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const handlers = {};
const cache = new Map();
let network = async () => { throw new TypeError('network failed'); };
const listeners = { location: { origin: 'https://boostpay.online' }, addEventListener: (name, cb) => { handlers[name] = cb; } };
const context = {
  self: listeners, URL, Response, AbortController, setTimeout, clearTimeout,
  caches: { open: async () => ({ put: async (key, val) => cache.set(key, val), match: async key => cache.get(key)?.clone() }) },
  fetch: (...args) => network(...args),
};
vm.runInNewContext(readFileSync('public/pwa-navigation.js', 'utf8'), context);
const html = () => new Response('<html><link rel="manifest" href="/app/manifest.json" />working shell</html>', { headers: { 'content-type': 'text/html' } });
const request = (path, mode='navigate', method='GET', origin='https://boostpay.online') => ({ url: origin + path, method, mode });
async function navigate(req) {
  let promise;
  handlers.fetch({ request: req, respondWith: p => { promise = p; }, waitUntil: () => {} });
  return promise ? await promise : null;
}
network = async () => html();
let install;
handlers.install({ waitUntil: p => { install = p; } });
await install;
assert(cache.has('/app')); console.log('PASS install primes /app shell');
network = async () => { throw new TypeError('network failed'); };
let r = await navigate(request('/app'));
assert.equal(r.status, 200); assert((await r.text()).includes('/app/manifest.json')); console.log('PASS installed /app opens cached shell on network failure');
assert(await navigate(request('/api/health', 'cors')) === null); assert(await navigate(request('/api/send', 'cors', 'POST')) === null); console.log('PASS API and payment requests not intercepted');
network = async () => new Response('gateway error', { status: 502 });
r = await navigate(request('/app'));
assert.equal(r.status, 200); console.log('PASS cached shell on temporary server error');
network = async () => new Response('<html>challenge</html>', { headers: { 'content-type': 'text/html' } });
await navigate(request('/app')); network = async () => { throw new Error('offline'); };
r = await navigate(request('/app')); assert((await r.text()).includes('working shell')); console.log('PASS challenge response cannot poison cached shell');
cache.clear(); r = await navigate(request('/app')); assert.equal(r.status, 503); assert((await r.text()).includes('Transactions require a live connection.')); console.log('PASS first-visit offline fallback is explicit and safe');
assert(await navigate(request('/other')) === null); assert(await navigate(request('/app', 'navigate', 'GET', 'https://other.example')) === null); console.log('PASS unrelated navigations unaffected');
