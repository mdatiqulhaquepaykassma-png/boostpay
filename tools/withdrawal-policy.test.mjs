import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_WITHDRAWAL_POLICY,
  agentSourceLimit,
  collectDepositSources,
  methodSourceLimit,
  methodWithdrawalSourceInfo,
  isWithdrawalMethodAvailable,
} from '../withdrawal-policy.ts';

function fixture(overrides = {}) {
  return {
    paymentMeta: { withdrawalPolicy: { ...DEFAULT_WITHDRAWAL_POLICY } },
    walletAgents: [
      { id: 'WAG-A', name: 'Wallet A', methodId: 'PM-A', active: true },
      { id: 'WAG-B', name: 'Wallet B', methodId: 'PM-A', active: true },
    ],
    users: [{ id: 'u1', balance: 500 }],
    depositRequests: [],
    withdrawRequests: [],
    agentPayouts: [],
    transactions: [],
    ...overrides,
  };
}

const approvedDeposit = (id, methodId, amountUsd, sourceAgentId = '') => ({
  id, userId: 'u1', methodId, amountUsd, sourceAgentId, status: 'APPROVED', txId: `TX-${id}`,
});

const withdrawal = (id, methodId, amountUsd, status = 'PENDING', agentId = '') => ({
  id, userId: 'u1', methodId, amountUsd, status, agentId,
});

test('collects only credited deposits and does not double-count their linked ledger rows', () => {
  const db = fixture({
    depositRequests: [
      approvedDeposit('D1', 'PM-A', 100, 'WAG-A'),
      { ...approvedDeposit('D2', 'PM-A', 900, 'WAG-B'), status: 'PENDING' },
      { ...approvedDeposit('D3', 'PM-B', 800), status: 'REJECTED' },
    ],
    transactions: [
      { id: 'TX-D1', userId: 'u1', type: 'DEPOSIT', amount: 100, methodId: 'PM-A', metadata: { depositId: 'D1' } },
      { id: 'TX-OLD', userId: 'u1', type: 'DEPOSIT', amount: 25, metadata: { methodId: 'PM-B' } },
      { id: 'TX-PENDING', userId: 'u1', type: 'DEPOSIT', status: 'PENDING', amount: 500, methodId: 'PM-C' },
      { id: 'TX-FAILED', userId: 'u1', type: 'DEPOSIT', status: 'FAILED', amount: 600, methodId: 'PM-D' },
      { id: 'TX-CASH', userId: 'u1', type: 'AGENT_TRANSFER_RECEIVED', amount: 30, agentId: 'AGT-1001' },
      { id: 'TX-OTHER', userId: 'u2', type: 'AGENT_TRANSFER_RECEIVED', amount: 999, agentId: 'AGT-1001' },
    ],
  });
  const sources = collectDepositSources(db, 'u1');
  assert.equal(sources.methods.get('PM-A'), 100);
  assert.equal(sources.methods.get('PM-B'), 25);
  assert.equal(sources.methods.has('PM-C'), false, 'a pending legacy ledger row must not create source allowance');
  assert.equal(sources.methods.has('PM-D'), false, 'a failed legacy ledger row must not create source allowance');
  assert.equal(sources.agents.get('WAG-A'), 100);
  assert.equal(sources.agents.has('WAG-B'), false);
  assert.equal(sources.agents.get('AGT-1001'), 30);
});

test('method and agent limits are independent and reserve pending/completed payouts', () => {
  const db = fixture({
    paymentMeta: { withdrawalPolicy: { ...DEFAULT_WITHDRAWAL_POLICY, singleMethodUnlimited: false, singleAgentUnlimited: false } },
    depositRequests: [
      approvedDeposit('D1', 'PM-A', 100, 'WAG-A'),
      approvedDeposit('D2', 'PM-A', 40, 'WAG-B'),
    ],
    withdrawRequests: [
      withdrawal('W1', 'PM-A', 20, 'PENDING', 'WAG-A'),
      withdrawal('W2', 'PM-A', 30, 'COMPLETED', 'WAG-B'),
      withdrawal('W3', 'PM-A', 99, 'REJECTED', 'WAG-A'),
    ],
    agentPayouts: [
      { id: 'APO-1', userId: 'u1', agentId: 'AGT-1001', amount: 8, status: 'PENDING' },
      { id: 'APO-2', userId: 'u1', agentId: 'AGT-1001', amount: 9, status: 'CANCELLED' },
    ],
    transactions: [
      { id: 'TX-CASH', userId: 'u1', type: 'AGENT_TRANSFER_RECEIVED', amount: 25, agentId: 'AGT-1001' },
    ],
  });

  assert.deepEqual(methodSourceLimit(db, 'u1', 'PM-A'), {
    enabled: true, unlimited: false, depositedUsd: 140, reservedUsd: 50, availableUsd: 90,
  });
  assert.equal(agentSourceLimit(db, 'u1', 'WAG-A').availableUsd, 80);
  assert.equal(agentSourceLimit(db, 'u1', 'WAG-B').availableUsd, 10);
  assert.equal(agentSourceLimit(db, 'u1', 'AGT-1001').availableUsd, 17);
  assert.equal(methodSourceLimit(db, 'u1', 'PM-A', { excludeWithdrawId: 'W1' }).availableUsd, 110);
  assert.equal(agentSourceLimit(db, 'u1', 'WAG-A', { excludeWithdrawId: 'W1' }).availableUsd, 100);
});

test('single-source exceptions apply only to the matching sole source', () => {
  const db = fixture({
    depositRequests: [approvedDeposit('D1', 'PM-A', 12)],
    transactions: [{ id: 'TX-CASH', userId: 'u1', type: 'AGENT_TRANSFER_RECEIVED', amount: 8, agentId: 'AGT-1001' }],
  });
  assert.equal(methodSourceLimit(db, 'u1', 'PM-A').unlimited, true);
  assert.equal(methodSourceLimit(db, 'u1', 'PM-B').unlimited, false);
  assert.equal(agentSourceLimit(db, 'u1', 'WAG-A').unlimited, false);
  assert.equal(agentSourceLimit(db, 'u1', 'AGT-1001').unlimited, true);
  const walletAgentOnly = fixture({ depositRequests: [approvedDeposit('DW', 'PM-A', 12, 'WAG-A')] });
  assert.equal(agentSourceLimit(walletAgentOnly, 'u1', 'WAG-A').unlimited, true);

  db.depositRequests.push(approvedDeposit('D2', 'PM-B', 5));
  assert.equal(methodSourceLimit(db, 'u1', 'PM-A').unlimited, false);
  assert.equal(methodSourceLimit(db, 'u1', 'PM-A').availableUsd, 12);

  db.transactions.push({ id: 'TX-CASH-2', userId: 'u1', type: 'AGENT_TRANSFER_RECEIVED', amount: 1, agentId: 'AGT-1002' });
  assert.equal(agentSourceLimit(db, 'u1', 'AGT-1001').unlimited, false);
  assert.equal(agentSourceLimit(db, 'u1', 'AGT-1001').availableUsd, 8);
});

test('wallet-agent options are limited to the selected method and source agents', () => {
  const db = fixture({
    paymentMeta: { withdrawalPolicy: { ...DEFAULT_WITHDRAWAL_POLICY, singleAgentUnlimited: false } },
    depositRequests: [
      approvedDeposit('D1', 'PM-A', 50, 'WAG-A'),
      approvedDeposit('D2', 'PM-A', 20, 'WAG-B'),
      approvedDeposit('D3', 'PM-B', 30, 'WAG-OTHER'),
    ],
    walletAgents: [
      { id: 'WAG-A', name: 'Wallet A', methodId: 'PM-A', active: true },
      { id: 'WAG-B', name: 'Wallet B', methodId: 'PM-A', active: true },
      { id: 'WAG-OTHER', name: 'Other method', methodId: 'PM-B', active: true },
    ],
  });
  const info = methodWithdrawalSourceInfo(db, 'u1', 'PM-A');
  assert.equal(info.agentRequired, true);
  assert.deepEqual(info.walletAgents.map((x) => x.id), ['WAG-A', 'WAG-B']);
  assert.equal(info.methodAvailableUsd, 70);
});

test('withdrawal catalogue is limited to matching method and cash-agent sources', () => {
  const db = fixture({
    paymentMeta: { withdrawalPolicy: { ...DEFAULT_WITHDRAWAL_POLICY, singleMethodUnlimited: false, singleAgentUnlimited: false } },
    agents: [{ id: 'AGT-1001', name: 'Cash A', isActive: true }],
  });
  const methodA = { id: 'PM-A', category: 'EWALLET' };
  const methodB = { id: 'PM-B', category: 'BANK' };
  const cashMethod = { id: 'PM-TG-AGENT', category: 'AGENT' };

  assert.equal(isWithdrawalMethodAvailable(db, 'u1', methodA), false);
  assert.equal(isWithdrawalMethodAvailable(db, 'u1', cashMethod), false);
  db.depositRequests.push(approvedDeposit('D1', 'PM-A', 50));
  assert.equal(isWithdrawalMethodAvailable(db, 'u1', methodA), true);
  assert.equal(isWithdrawalMethodAvailable(db, 'u1', methodB), false);

  db.transactions.push({ id: 'TX-CASH', userId: 'u1', type: 'AGENT_TRANSFER_RECEIVED', amount: 30, agentId: 'AGT-1001' });
  assert.equal(isWithdrawalMethodAvailable(db, 'u1', cashMethod), true);
  db.agentPayouts.push({ id: 'APO-1', userId: 'u1', agentId: 'AGT-1001', amount: 30, status: 'PENDING' });
  assert.equal(isWithdrawalMethodAvailable(db, 'u1', cashMethod), false, 'fully reserved cash-agent source is not offered');
  db.agents[0].isActive = false;
  assert.equal(isWithdrawalMethodAvailable(db, 'u1', cashMethod), false, 'inactive cash agents are not offered');

  db.paymentMeta.withdrawalPolicy.agentCapsEnabled = false;
  assert.equal(isWithdrawalMethodAvailable(db, 'u1', cashMethod), true, 'Admin can intentionally turn off agent-source enforcement');
});

test('a disabled wallet agent remains required and cannot fall back to method-only payout', () => {
  const db = fixture({
    walletAgents: [{ id: 'WAG-A', name: 'Wallet A', methodId: 'PM-A', active: false }],
    depositRequests: [approvedDeposit('D1', 'PM-A', 40, 'WAG-A')],
  });
  const info = methodWithdrawalSourceInfo(db, 'u1', 'PM-A');
  assert.equal(info.agentRequired, true);
  assert.deepEqual(info.walletAgents, []);
  assert.equal(isWithdrawalMethodAvailable(db, 'u1', { id: 'PM-A', category: 'EWALLET' }), false);
});

test('disabling caps disables enforcement without changing the measured source totals', () => {
  const db = fixture({
    paymentMeta: { withdrawalPolicy: { methodCapsEnabled: false, agentCapsEnabled: false } },
    depositRequests: [approvedDeposit('D1', 'PM-A', 5, 'WAG-A')],
  });
  assert.equal(methodSourceLimit(db, 'u1', 'PM-A').enabled, false);
  assert.equal(agentSourceLimit(db, 'u1', 'WAG-A').enabled, false);
  assert.equal(methodSourceLimit(db, 'u1', 'PM-A').availableUsd, 5);
});
