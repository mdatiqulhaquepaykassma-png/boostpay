import assert from 'node:assert/strict';
import test from 'node:test';
import { filterAdminUsers } from '../src/utils/userList.ts';
import { BoostPayStore } from '../src/services/store.ts';

const user = (overrides = {}) => ({
  id: '1',
  email: 'one@example.com',
  balance: 0,
  lifetimeProfit: 0,
  createdAt: 1_700_000_000_000,
  isBlocked: false,
  isFrozen: false,
  boostState: {
    isActive: false,
    isPaused: false,
    startedAt: 0,
    pausedAt: 0,
    elapsedMs: 0,
    targetDurationMs: 60_000,
    startingBalance: 0,
    accumulatedYield: 0,
  },
  ...overrides,
  boostState: {
    isActive: false,
    isPaused: false,
    startedAt: 0,
    pausedAt: 0,
    elapsedMs: 0,
    targetDurationMs: 60_000,
    startingBalance: 0,
    accumulatedYield: 0,
    ...(overrides.boostState || {}),
  },
});

const ids = users => users.map(item => String(item.id));

test('search normalizes numeric IDs, ID prefixes, and formatted balances', () => {
  const numericIdUser = user({ id: 42, balance: 1234.5 });
  assert.deepEqual(ids(filterAdminUsers([numericIdUser], '42', 'ALL')), ['42']);
  assert.deepEqual(ids(filterAdminUsers([numericIdUser], ' #42 ', 'ALL')), ['42']);
  assert.deepEqual(ids(filterAdminUsers([numericIdUser], 'user #42', 'ALL')), ['42']);
  assert.deepEqual(ids(filterAdminUsers([numericIdUser], '$1,234.50', 'ALL')), ['42']);
  assert.deepEqual(ids(filterAdminUsers([user({ id: '43', balance: ' $1,234.50 ' })], '1234.5', 'ALL')), ['43']);
});

test('search is case-insensitive across email, phrase, name, phone, and displayed fallback email', () => {
  const account = user({
    id: '7',
    email: 'CaseSensitive@Example.com',
    phrase: 'River Stone Lantern',
    name: 'Jordan Lee',
    phone: '+880 1712 345678',
  });
  const fallbackEmailAccount = user({ id: '19', email: '' });

  assert.deepEqual(ids(filterAdminUsers([account], 'casesensitive@example.COM', 'ALL')), ['7']);
  assert.deepEqual(ids(filterAdminUsers([account], 'stone', 'ALL')), ['7']);
  assert.deepEqual(ids(filterAdminUsers([account], 'jordan 1712', 'ALL')), ['7']);
  assert.deepEqual(ids(filterAdminUsers([fallbackEmailAccount], 'user19@boostpay.app', 'ALL')), ['19']);
});

test('all query words must match, and blank/whitespace searches return all users', () => {
  const account = user({ id: '9', email: 'jane@example.com', balance: 125 });
  assert.deepEqual(ids(filterAdminUsers([account], 'jane 125', 'ALL')), ['9']);
  assert.deepEqual(filterAdminUsers([account], 'jane missing', 'ALL'), []);
  assert.deepEqual(ids(filterAdminUsers([account], '   ', 'ALL')), ['9']);
});

test('status filters distinguish active, paused, frozen, blocked, and idle accounts', () => {
  const active = user({ id: '1', balance: 10 });
  const paused = user({ id: '2', boostState: { isActive: true, isPaused: true } });
  const boosting = user({ id: '3', boostState: { isActive: true, isPaused: false } });
  const frozen = user({ id: '4', isFrozen: true });
  const blocked = user({ id: '5', isBlocked: true });
  const idle = user({ id: '6' });
  const users = [active, paused, boosting, frozen, blocked, idle];

  assert.deepEqual(ids(filterAdminUsers(users, '', 'ACTIVE')), ['1', '6', '3', '2']);
  assert.deepEqual(ids(filterAdminUsers(users, '', 'BOOSTING')), ['3']);
  assert.deepEqual(ids(filterAdminUsers(users, '', 'PAUSED')), ['2']);
  assert.deepEqual(ids(filterAdminUsers(users, '', 'FROZEN')), ['4']);
  assert.deepEqual(ids(filterAdminUsers(users, '', 'BLOCKED')), ['5']);
  assert.deepEqual(ids(filterAdminUsers(users, '', 'IDLE')), ['1', '6', '5', '4']);
  assert.deepEqual(ids(filterAdminUsers(users, 'active', 'ALL')), ['1', '6', '3', '2']);
  assert.deepEqual(ids(filterAdminUsers(users, 'frozen', 'ALL')), ['4']);
});

test('puts the highest balances first in the full list and the high-balance filter', () => {
  const users = [
    user({ id: '9', balance: 25, createdAt: 500 }),
    user({ id: '2', balance: 1000, createdAt: 100 }),
    user({ id: '3', balance: '$1,250.00', createdAt: 50 }),
    user({ id: '4', balance: 25, createdAt: 700 }),
  ];
  const originalOrder = ids(users);

  assert.deepEqual(ids(filterAdminUsers(users, '', 'ALL')), ['3', '2', '4', '9']);
  assert.deepEqual(ids(filterAdminUsers(users, '', 'HIGH_BALANCE')), ['3', '2', '4', '9']);
  assert.deepEqual(ids(users), originalOrder);
});

test('sorts newest first with numeric ID tie-breaks when balances are equal, without mutating the source list', () => {
  const original = [
    user({ id: '2', createdAt: 100 }),
    user({ id: '10', createdAt: 200 }),
    user({ id: '3', createdAt: 200 }),
  ];
  const result = filterAdminUsers(original, '', 'ALL');
  assert.deepEqual(ids(result), ['10', '3', '2']);
  assert.deepEqual(ids(original), ['2', '10', '3']);
});

test('handles missing fields and invalid list values without throwing', () => {
  assert.deepEqual(filterAdminUsers(null, '', 'ALL'), []);
  assert.deepEqual(ids(filterAdminUsers([null, {}, { id: 77 }], '77', 'ALL')), ['77']);
});

test('server user caching writes local storage without posting a full sync', () => {
  const originalStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const originalFetch = globalThis.fetch;
  const values = new Map();
  let fetchCalls = 0;

  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: { setItem: (key, value) => values.set(key, value) },
  });
  globalThis.fetch = async () => {
    fetchCalls += 1;
    throw new Error('cacheUsers must not call fetch');
  };

  try {
    const users = [user({ id: '11' })];
    BoostPayStore.cacheUsers(users);
    assert.deepEqual(JSON.parse(values.get('boostpay_users_v4')), users);
    assert.deepEqual(JSON.parse(values.get('boostpay_users')), users);
    assert.equal(fetchCalls, 0);
  } finally {
    if (originalStorage) Object.defineProperty(globalThis, 'localStorage', originalStorage);
    else delete globalThis.localStorage;
    globalThis.fetch = originalFetch;
  }
});
