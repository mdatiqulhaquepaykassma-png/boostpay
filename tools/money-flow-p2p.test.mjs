import assert from 'node:assert/strict';
import test from 'node:test';

import { listP2PTransfers } from '../admin-money-flow.ts';

const transactions = [
  { id: 'TX-10', type: 'TRANSFER_SENT', userId: '1', recipientId: '10', amount: 12.345, timestamp: 200 },
  { id: 'TX-11', type: 'TRANSFER_SENT', userId: '2', recipientId: '3', amount: 5, timestamp: 300 },
  { id: 'TX-12', type: 'TRANSFER_RECEIVED', userId: '3', senderId: '2', amount: 5, timestamp: 300 },
  { id: 'TX-13', type: 'ADMIN_CREDIT', userId: '3', amount: 50, timestamp: 400 },
  { id: 'TX-14', type: 'TRANSFER_SENT', userId: '3', recipientId: '', amount: 2, timestamp: 500 },
  { id: 'TX-15', type: 'TRANSFER_SENT', userId: '10', recipientId: '1', amount: 0, timestamp: 600 },
];

test('lists one positive debit-side row per completed P2P transfer, newest first', () => {
  const result = listP2PTransfers(transactions);
  assert.equal(result.total, 2);
  assert.equal(result.limit, 100);
  assert.deepEqual(result.items.map(({ id, senderId, recipientId, amount }) => ({ id, senderId, recipientId, amount })), [
    { id: 'TX-11', senderId: '2', recipientId: '3', amount: 5 },
    { id: 'TX-10', senderId: '1', recipientId: '10', amount: 12.35 },
  ]);
});

test('filters exact sender and recipient IDs and accepts an optional hash prefix', () => {
  assert.deepEqual(listP2PTransfers(transactions, { senderId: ' #1 ' }).items.map((row) => row.id), ['TX-10']);
  assert.deepEqual(listP2PTransfers(transactions, { recipientId: '#3' }).items.map((row) => row.id), ['TX-11']);
  assert.deepEqual(listP2PTransfers(transactions, { senderId: '1', recipientId: '3' }).items, []);
});

test('limits results after filtering and caps the requested page size', () => {
  const limited = listP2PTransfers(transactions, { limit: 1 });
  assert.equal(limited.total, 2);
  assert.equal(limited.items.length, 1);
  assert.equal(limited.items[0].id, 'TX-11');
  assert.equal(listP2PTransfers(transactions, { limit: 10_000 }).limit, 500);
});
