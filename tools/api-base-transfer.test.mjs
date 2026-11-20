import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const source = readFileSync(new URL('../public/api-base.js', import.meta.url), 'utf8');
let transferPosts = 0, getCalls = 0;
const storage = new Map();
const win = { Capacitor: { isNativePlatform: () => true }, fetch: async (url, init = {}) => {
  if (url.endsWith('/api/health')) return { ok: true };
  if (url.endsWith('/api/mobile/hosts')) return { ok: true, json: async () => ({ hosts: ['https://management.boostpay.online', 'https://boostpay.online'] }) };
  if (url.endsWith('/api/transfer') && init.method === 'POST') { transferPosts++; throw new Error('lost response'); }
  if (url.endsWith('/api/example')) { getCalls++; if (getCalls === 1) throw new Error('network error'); return { ok: true }; }
  return { ok: true };
}};
const context = { window: win, location: {protocol:'https:', hostname:'localhost', port:''}, localStorage: {getItem: k => storage.get(k), setItem: (k,v) => storage.set(k,v)}, AbortController, setTimeout, clearTimeout, Promise, console };
vm.runInNewContext(source, context);
await win.__BP_READY__;
await assert.rejects(win.fetch('/api/transfer', { method:'POST', body:'{}' }), /lost response/);
assert.equal(transferPosts, 1, 'a lost transfer response must never trigger failover replay');
await win.fetch('/api/example');
assert.equal(getCalls, 2, 'safe read still uses host failover');
console.log('PASS Android API host failover never automatically replays a transfer POST; GET still fails over');
