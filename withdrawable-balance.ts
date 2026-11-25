/** Shared payout-eligibility math and audited Admin adjustment primitive. */

export type WithdrawableAdjustmentType = 'CREDIT' | 'DEBIT';

const floor2 = (value: any) => Math.floor((Number(value) || 0) * 100 + 1e-9) / 100;
const round8 = (value: number) => Number(value.toFixed(8));

/**
 * Boosted profit is payout-eligible; Admin-authorized adjustments are an
 * explicit addition/subtraction to that eligibility ceiling. The wallet
 * balance remains the other ceiling, so eligibility can never exceed it.
 */
export function boostWithdrawable(user: any): number {
  if (!user) return 0;
  const balance = floor2(user.balance);
  const profitLeft = floor2(
    (Number(user.lifetimeProfit) || 0) -
    (Number(user.boostProfitWithdrawn) || 0) +
    (Number(user.adminWithdrawableAdjustment) || 0)
  );
  return floor2(Math.max(0, Math.min(balance, profitLeft)));
}

/**
 * Apply the wallet and payout-eligibility sides together. Amounts are USD to
 * cents; debits larger than the current wallet are rejected instead of being
 * silently truncated (which would desynchronize the two buckets).
 */
export function applyAdminWithdrawableAdjustment(
  user: any,
  type: WithdrawableAdjustmentType,
  rawAmount: any,
): { ok: true; amount: number; balance: number; withdrawableBalance: number } | { ok: false; error: string } {
  if (!user || typeof user !== 'object') return { ok: false, error: 'User not found.' };
  if (type !== 'CREDIT' && type !== 'DEBIT') return { ok: false, error: 'Adjustment type must be CREDIT or DEBIT.' };

  const amount = Number(rawAmount);
  if (!Number.isFinite(amount) || amount <= 0) {
    return { ok: false, error: 'Enter a valid positive amount.' };
  }
  const cents = Math.round(amount * 100);
  if (!Number.isSafeInteger(cents) || Math.abs(amount - cents / 100) > 1e-9) {
    return { ok: false, error: 'Amount must be a valid USD value with no more than two decimal places.' };
  }
  const normalizedAmount = cents / 100;
  const currentBalanceValue = Number(user.balance);
  const currentBalance = Number.isFinite(currentBalanceValue) ? Math.max(0, currentBalanceValue) : 0;
  if (type === 'DEBIT' && normalizedAmount > currentBalance + 1e-8) {
    return { ok: false, error: 'Debit cannot exceed the user’s current wallet balance.' };
  }

  const walletDelta = type === 'CREDIT' ? normalizedAmount : -normalizedAmount;
  const currentAdjustmentValue = Number(user.adminWithdrawableAdjustment);
  const currentAdjustment = Number.isFinite(currentAdjustmentValue) ? currentAdjustmentValue : 0;
  const rawProfitLeft = (Number(user.lifetimeProfit) || 0) - (Number(user.boostProfitWithdrawn) || 0);
  const adjustedProfitLeft = rawProfitLeft + currentAdjustment;
  // A credit creates fresh eligibility even when earlier payouts put the legacy
  // boosted-profit bucket below zero; normalize that deficit before adding it.
  // A debit consumes only currently eligible dollars, never a future-earnings debt.
  const eligibilityDelta = type === 'CREDIT'
    ? normalizedAmount + Math.max(0, -adjustedProfitLeft)
    : -Math.min(normalizedAmount, boostWithdrawable(user));
  user.balance = round8(Math.max(0, currentBalance + walletDelta));
  user.adminWithdrawableAdjustment = round8(currentAdjustment + eligibilityDelta);

  return {
    ok: true,
    amount: normalizedAmount,
    balance: user.balance,
    withdrawableBalance: boostWithdrawable(user),
  };
}
