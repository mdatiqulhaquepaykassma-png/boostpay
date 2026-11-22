import assert from 'node:assert/strict';
import test from 'node:test';

import { filterAndSortAdminUsers } from '../admin-app/src/utils/adminUserList.ts';

const users = [
  { id: '115', email: 'first@example.com', balance: 500, createdAt: 300 },
  { id: '15', email: 'second@example.com', balance: 20, createdAt: 100 },
  { id: '215', email: 'third@example.com', balance: 120, createdAt: 200 },
  { id: '9', email: 'fourth@example.com', balance: 120, createdAt: 400 },
];

test('numeric searches match an exact user ID only, with optional hash prefix', () => {
  assert.deepEqual(filterAndSortAdminUsers(users, '15', 'ALL').map((u) => u.id), ['15']);
  assert.deepEqual(filterAndSortAdminUsers(users, '#15 ', 'ALL').map((u) => u.id), ['15']);
  assert.deepEqual(filterAndSortAdminUsers(users, '5', 'ALL'), []);
});

test('All filter orders newest-created user first and uses descending ID as the tie-breaker', () => {
  assert.deepEqual(filterAndSortAdminUsers(users, '', 'ALL').map((u) => u.id), ['9', '115', '215', '15']);
});

test('High Balance filter keeps qualifying accounts and sorts highest balance first', () => {
  assert.deepEqual(filterAndSortAdminUsers(users, '', 'HIGH_BALANCE').map((u) => u.id), ['115', '9', '215', '15']);
});

test('non-numeric searches still match email, phrase, and balance text', () => {
  const withPhrase = [{ ...users[1], balance: 20.5, phrase: 'orange river seed' }];
  assert.equal(filterAndSortAdminUsers(withPhrase, 'SECOND@EXAMPLE', 'ALL').length, 1);
  assert.equal(filterAndSortAdminUsers(withPhrase, 'orange river', 'ALL').length, 1);
  assert.equal(filterAndSortAdminUsers(withPhrase, '20', 'ALL').length, 0);
  assert.equal(filterAndSortAdminUsers(withPhrase, '20.5', 'ALL').length, 1);
});
