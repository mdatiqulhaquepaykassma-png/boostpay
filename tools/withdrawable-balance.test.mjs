import assert from 'node:assert/strict';
import test from 'node:test';
import { applyAdminWithdrawableAdjustment, boostWithdrawable } from '../withdrawable-balance.ts';

test('withdrawable credit increases both wallet and payout eligibility by the same amount', () => {
  const user = { balance: 100, lifetimeProfit: 50, boostProfitWithdrawn: 0 };
  assert.equal(boostWithdrawable(user), 50);

  const result = applyAdminWithdrawableAdjustment(user, 'CREDIT', 12.35);
  assert.deepEqual(result, { ok: true, amount: 12.35, balance: 112.35, withdrawableBalance: 62.35 });
  assert.equal(user.adminWithdrawableAdjustment, 12.35);
});

test('withdrawable debit reduces both wallet and payout eligibility by the same amount', () => {
  const user = { balance: 100, lifetimeProfit: 80, boostProfitWithdrawn: 0 };
  assert.equal(boostWithdrawable(user), 80);

  const result = applyAdminWithdrawableAdjustment(user, 'DEBIT', 20.25);
  assert.deepEqual(result, { ok: true, amount: 20.25, balance: 79.75, withdrawableBalance: 59.75 });
  assert.equal(user.adminWithdrawableAdjustment, -20.25);
});

test('payout eligibility remains capped by wallet balance, including after credit', () => {
  const user = { balance: 40, lifetimeProfit: 500, boostProfitWithdrawn: 0 };
  assert.equal(boostWithdrawable(user), 40);
  const result = applyAdminWithdrawableAdjustment(user, 'CREDIT', 10);
  assert.equal(result.ok, true);
  assert.equal(result.balance, 50);
  assert.equal(result.withdrawableBalance, 50);
});

test('admin credit remains payout-eligible after the boosted-profit bucket was already withdrawn', () => {
  const user = { balance: 10, lifetimeProfit: 0, boostProfitWithdrawn: 100 };
  assert.equal(boostWithdrawable(user), 0);

  const result = applyAdminWithdrawableAdjustment(user, 'CREDIT', 10);
  assert.equal(result.ok, true);
  assert.equal(result.balance, 20);
  assert.equal(result.withdrawableBalance, 10);

  // A later payout consumes the eligibility added by the Admin credit.
  user.balance = 15;
  user.boostProfitWithdrawn += 5;
  assert.equal(boostWithdrawable(user), 5);
});

test('debit cannot create a hidden eligibility deficit when nothing is withdrawable', () => {
  const user = { balance: 100, lifetimeProfit: 0, boostProfitWithdrawn: 0 };
  const result = applyAdminWithdrawableAdjustment(user, 'DEBIT', 10);
  assert.equal(result.ok, true);
  assert.equal(result.balance, 90);
  assert.equal(result.withdrawableBalance, 0);
  assert.equal(user.adminWithdrawableAdjustment, 0);

  // New boost profit remains eligible rather than first repaying the Admin debit.
  user.lifetimeProfit = 10;
  assert.equal(boostWithdrawable(user), 10);
});

test('a debit larger than available withdrawable consumes only the eligible amount', () => {
  const user = { balance: 100, lifetimeProfit: 20, boostProfitWithdrawn: 0 };
  const result = applyAdminWithdrawableAdjustment(user, 'DEBIT', 50);
  assert.equal(result.ok, true);
  assert.equal(result.balance, 50);
  assert.equal(result.withdrawableBalance, 0);
  assert.equal(user.adminWithdrawableAdjustment, -20);

  // Subsequent earnings are eligible; no extra negative balance is carried.
  user.lifetimeProfit = 30;
  assert.equal(boostWithdrawable(user), 10);
});

test('an over-balance debit is rejected atomically', () => {
  const user = { balance: 10, lifetimeProfit: 10, boostProfitWithdrawn: 0 };
  const before = structuredClone(user);
  const result = applyAdminWithdrawableAdjustment(user, 'DEBIT', 10.01);
  assert.equal(result.ok, false);
  assert.match(result.error, /cannot exceed/i);
  assert.deepEqual(user, before);
});

test('invalid types and non-cent amounts do not mutate the user', () => {
  const user = { balance: 10, lifetimeProfit: 10 };
  assert.equal(applyAdminWithdrawableAdjustment(user, 'REFUND', 1).ok, false);
  assert.equal(applyAdminWithdrawableAdjustment(user, 'CREDIT', 1.001).ok, false);
  assert.deepEqual(user, { balance: 10, lifetimeProfit: 10 });
});
