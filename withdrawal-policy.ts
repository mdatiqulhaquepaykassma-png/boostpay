/**
 * Deposit-source withdrawal limits.
 *
 * The wallet balance / boosted-profit rules still decide whether a user has
 * money available to withdraw. This module adds a second, independent ceiling:
 * the amount of approved deposits attributed to the selected payment method
 * and/or agent, less pending and completed withdrawals already charged to that
 * source.
 *
 * Source records:
 *  - payment-method deposits: approved depositRequests and explicitly tagged
 *    DEPOSIT ledger rows (the latter are not double-counted when they belong to
 *    a depositRequest);
 *  - wallet-agent deposits: the same approved request, attributed to the
 *    Wallet Agent who reviewed it (or an Admin-assigned sourceAgentId);
 *  - cash-agent deposits: AGENT_TRANSFER_RECEIVED ledger rows.
 */

export type WithdrawalPolicy = {
  methodCapsEnabled: boolean;
  agentCapsEnabled: boolean;
  singleMethodUnlimited: boolean;
  singleAgentUnlimited: boolean;
};

export const DEFAULT_WITHDRAWAL_POLICY: WithdrawalPolicy = {
  methodCapsEnabled: true,
  agentCapsEnabled: true,
  singleMethodUnlimited: true,
  singleAgentUnlimited: true,
};

export type SourceLimit = {
  enabled: boolean;
  unlimited: boolean;
  depositedUsd: number;
  reservedUsd: number;
  availableUsd: number;
};

const round8 = (n: number) => Number((Number.isFinite(n) ? n : 0).toFixed(8));
const keyOf = (v: any) => String(v ?? '').trim();
const amountOf = (v: any) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : 0;
};

export function normalizeWithdrawalPolicy(value: any): WithdrawalPolicy {
  const src = value && typeof value === 'object' ? value : {};
  const bool = (key: keyof WithdrawalPolicy) => src[key] === undefined
    ? DEFAULT_WITHDRAWAL_POLICY[key]
    : src[key] === true || src[key] === 1 || src[key] === 'true';
  return {
    methodCapsEnabled: bool('methodCapsEnabled'),
    agentCapsEnabled: bool('agentCapsEnabled'),
    singleMethodUnlimited: bool('singleMethodUnlimited'),
    singleAgentUnlimited: bool('singleAgentUnlimited'),
  };
}

/** Add missing defaults without touching any other payment metadata. */
export function ensureWithdrawalPolicy(db: any): WithdrawalPolicy {
  if (!db.paymentMeta || typeof db.paymentMeta !== 'object' || Array.isArray(db.paymentMeta)) {
    db.paymentMeta = { version: 1 };
  }
  const policy = normalizeWithdrawalPolicy(db.paymentMeta.withdrawalPolicy);
  db.paymentMeta.withdrawalPolicy = policy;
  return policy;
}

function addAmount(map: Map<string, number>, id: any, value: any) {
  const key = keyOf(id);
  const amount = amountOf(value);
  if (!key || amount <= 0) return;
  map.set(key, round8((map.get(key) || 0) + amount));
}

function walletAgentIdFromReview(db: any, row: any): string {
  const explicit = keyOf(row?.sourceAgentId || row?.agentId);
  if (explicit) return explicit;
  const reviewer = keyOf(row?.reviewedBy);
  const prefix = 'walletagent:';
  if (!reviewer.toLowerCase().startsWith(prefix)) return '';
  const email = reviewer.slice(prefix.length).trim().toLowerCase();
  if (!email) return '';
  const agent = (Array.isArray(db?.walletAgents) ? db.walletAgents : [])
    .find((a: any) => String(a.email || '').trim().toLowerCase() === email);
  return agent ? keyOf(agent.id) : '';
}

export type DepositSources = {
  methods: Map<string, number>;
  agents: Map<string, number>;
  /** Wallet-agent source amounts, keyed by payment method, then wallet-agent ID. */
  walletAgentsByMethod: Map<string, Map<string, number>>;
};

/**
 * Collect only money that has actually been credited. Requests that are pending
 * or rejected do not create source allowance. A linked transaction is skipped
 * because the approved request is the canonical source row.
 */
export function collectDepositSources(db: any, userId: any): DepositSources {
  const uid = keyOf(userId);
  const methods = new Map<string, number>();
  const agents = new Map<string, number>();
  const walletAgentsByMethod = new Map<string, Map<string, number>>();
  const creditedRequestIds = new Set<string>();
  const linkedTransactionIds = new Set<string>();
  const requests = Array.isArray(db?.depositRequests) ? db.depositRequests : [];

  const addWalletAgentMethodSource = (methodId: string, agentId: string, amount: number) => {
    if (!isWalletAgentId(agentId)) return;
    let byAgent = walletAgentsByMethod.get(methodId);
    if (!byAgent) {
      byAgent = new Map<string, number>();
      walletAgentsByMethod.set(methodId, byAgent);
    }
    addAmount(byAgent, agentId, amount);
  };

  for (const row of requests) {
    if (keyOf(row.userId) !== uid) continue;
    if (!['APPROVED', 'COMPLETED', 'CREDITED'].includes(String(row.status || '').toUpperCase())) continue;
    const methodId = keyOf(row.methodId);
    const amount = amountOf(row.amountUsd);
    if (!methodId || amount <= 0) continue;
    addAmount(methods, methodId, amount);
    const sourceAgentId = walletAgentIdFromReview(db, row);
    if (sourceAgentId) {
      addAmount(agents, sourceAgentId, amount);
      addWalletAgentMethodSource(methodId, sourceAgentId, amount);
    }
    if (row.id) creditedRequestIds.add(keyOf(row.id));
    if (row.txId) linkedTransactionIds.add(keyOf(row.txId));
  }

  const transactions = Array.isArray(db?.transactions) ? db.transactions : [];
  for (const tx of transactions) {
    if (keyOf(tx.userId) !== uid) continue;
    const type = String(tx.type || '').toUpperCase();
    if (type === 'AGENT_TRANSFER_RECEIVED') {
      const agentId = keyOf(tx.agentId || tx.senderId || tx.metadata?.agentId);
      if (agentId) addAmount(agents, agentId, tx.amount);
      continue;
    }
    if (type !== 'DEPOSIT') continue;
    const status = String(tx.status || '').toUpperCase();
    // A legacy DEPOSIT row without a status is treated as credited (older
    // successful callbacks had no status field), but explicit non-success rows
    // must never create withdrawal allowance.
    if (status && !['CREDITED', 'APPROVED', 'COMPLETED', 'SUCCESS', 'SUCCEEDED', 'SUCCESSFUL'].includes(status)) continue;
    if (linkedTransactionIds.has(keyOf(tx.id))) continue;
    const linkedDepositId = keyOf(tx.metadata?.depositId || tx.depositId || '');
    if (linkedDepositId && creditedRequestIds.has(linkedDepositId)) continue;
    if (creditedRequestIds.has(keyOf(tx.referenceId))) continue;
    const methodId = keyOf(tx.methodId || tx.metadata?.methodId);
    if (!methodId) continue; // do not guess a source for legacy/unattributed deposits
    addAmount(methods, methodId, tx.amount);
    const agentId = keyOf(tx.sourceAgentId || tx.agentId || tx.metadata?.sourceAgentId || tx.metadata?.agentId);
    if (agentId) {
      addAmount(agents, agentId, tx.amount);
      addWalletAgentMethodSource(methodId, agentId, amountOf(tx.amount));
    }
  }

  return { methods, agents, walletAgentsByMethod };
}

function isCommittedWithdrawal(row: any): boolean {
  return ['PENDING', 'COMPLETED'].includes(String(row?.status || '').toUpperCase());
}

function methodSourceLimitFromSources(
  db: any,
  userId: any,
  methodId: any,
  opts: { excludeWithdrawId?: any },
  sources: DepositSources,
  policy: WithdrawalPolicy,
): SourceLimit {
  const id = keyOf(methodId);
  const depositedUsd = sources.methods.get(id) || 0;
  const soleMethod = sources.methods.size === 1 && sources.methods.has(id);
  const unlimited = policy.singleMethodUnlimited && soleMethod;
  const excluded = keyOf(opts.excludeWithdrawId);
  const withdrawals = Array.isArray(db?.withdrawRequests) ? db.withdrawRequests : [];
  const reservedUsd = round8(withdrawals.reduce((sum: number, row: any) => {
    if (keyOf(row.userId) !== keyOf(userId) || keyOf(row.methodId) !== id) return sum;
    if (excluded && keyOf(row.id) === excluded) return sum;
    return isCommittedWithdrawal(row) ? sum + amountOf(row.amountUsd) : sum;
  }, 0));
  return {
    enabled: policy.methodCapsEnabled,
    unlimited,
    depositedUsd,
    reservedUsd,
    availableUsd: round8(Math.max(0, depositedUsd - reservedUsd)),
  };
}

export function methodSourceLimit(
  db: any,
  userId: any,
  methodId: any,
  opts: { excludeWithdrawId?: any } = {},
): SourceLimit {
  const policy = ensureWithdrawalPolicy(db);
  return methodSourceLimitFromSources(db, userId, methodId, opts, collectDepositSources(db, userId), policy);
}

function agentSourceLimitFromSources(
  db: any,
  userId: any,
  agentId: any,
  opts: { excludeWithdrawId?: any },
  sources: DepositSources,
  policy: WithdrawalPolicy,
): SourceLimit {
  const id = keyOf(agentId);
  const depositedUsd = sources.agents.get(id) || 0;
  const soleAgent = sources.agents.size === 1 && sources.agents.has(id);
  const unlimited = policy.singleAgentUnlimited && soleAgent;
  const excluded = keyOf(opts.excludeWithdrawId);
  const paymentWithdrawals = Array.isArray(db?.withdrawRequests) ? db.withdrawRequests : [];
  const cashPayouts = Array.isArray(db?.agentPayouts) ? db.agentPayouts : [];
  const paymentReserved = paymentWithdrawals.reduce((sum: number, row: any) => {
    if (keyOf(row.userId) !== keyOf(userId) || keyOf(row.agentId) !== id) return sum;
    if (excluded && keyOf(row.id) === excluded) return sum;
    return isCommittedWithdrawal(row) ? sum + amountOf(row.amountUsd) : sum;
  }, 0);
  const cashReserved = cashPayouts.reduce((sum: number, row: any) => {
    if (keyOf(row.userId) !== keyOf(userId) || keyOf(row.agentId) !== id) return sum;
    if (excluded && keyOf(row.id) === excluded) return sum;
    return ['PENDING', 'CLAIMED'].includes(String(row.status || '').toUpperCase())
      ? sum + amountOf(row.amount)
      : sum;
  }, 0);
  return {
    enabled: policy.agentCapsEnabled,
    unlimited,
    depositedUsd,
    reservedUsd: round8(paymentReserved + cashReserved),
    availableUsd: round8(Math.max(0, depositedUsd - paymentReserved - cashReserved)),
  };
}

export function agentSourceLimit(
  db: any,
  userId: any,
  agentId: any,
  opts: { excludeWithdrawId?: any } = {},
): SourceLimit {
  const policy = ensureWithdrawalPolicy(db);
  return agentSourceLimitFromSources(db, userId, agentId, opts, collectDepositSources(db, userId), policy);
}

export type WithdrawalAgentOption = {
  id: string;
  name: string;
  availableUsd: number;
  unlimited: boolean;
};

/** Wallet Agents that have source deposits for this user's selected method. */
function walletAgentOptionsFromSources(
  db: any,
  userId: any,
  methodId: any,
  sources: DepositSources,
  policy: WithdrawalPolicy,
  opts: { excludeWithdrawId?: any } = {},
): WithdrawalAgentOption[] {
  const byAgent = sources.walletAgentsByMethod.get(keyOf(methodId)) || new Map<string, number>();
  const walletAgents = Array.isArray(db?.walletAgents) ? db.walletAgents : [];
  const options: WithdrawalAgentOption[] = [];
  for (const [id, amount] of byAgent) {
    if (!isWalletAgentId(id) || amount <= 0) continue;
    const agent = walletAgents.find((a: any) => keyOf(a.id) === id);
    if (!agent || keyOf(agent.methodId) !== keyOf(methodId) || agent.active === false) continue;
    const limit = agentSourceLimitFromSources(db, userId, id, opts, sources, policy);
    options.push({ id, name: keyOf(agent.name) || id, availableUsd: limit.availableUsd, unlimited: limit.unlimited });
  }
  return options.sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
}

export function walletAgentOptionsForMethod(db: any, userId: any, methodId: any): WithdrawalAgentOption[] {
  const policy = ensureWithdrawalPolicy(db);
  const sources = collectDepositSources(db, userId);
  return walletAgentOptionsFromSources(db, userId, methodId, sources, policy);
}

/** Returns a structured view used by the user app and by Admin edit validation. */
export function methodWithdrawalSourceInfo(db: any, userId: any, methodId: any, excludeWithdrawId?: any) {
  const policy = ensureWithdrawalPolicy(db);
  const sources = collectDepositSources(db, userId);
  const method = methodSourceLimitFromSources(db, userId, methodId, { excludeWithdrawId }, sources, policy);
  const walletAgentSources = sources.walletAgentsByMethod.get(keyOf(methodId));
  const walletAgents = walletAgentOptionsFromSources(db, userId, methodId, sources, policy, { excludeWithdrawId });
  return {
    methodCapEnabled: policy.methodCapsEnabled,
    agentCapEnabled: policy.agentCapsEnabled,
    methodAvailableUsd: method.availableUsd,
    methodUnlimited: method.unlimited,
    methodDepositedUsd: method.depositedUsd,
    methodReservedUsd: method.reservedUsd,
    walletAgents,
    // Keep requiring the original source even if that wallet-agent account has
    // been disabled or removed. Otherwise an empty eligible-agent list used to
    // turn into a method-only withdrawal and bypass the agent cap.
    agentRequired: policy.agentCapsEnabled && !!walletAgentSources && Array.from(walletAgentSources.values()).some((amount) => amount > 0),
  };
}

/**
 * Whether a configured withdrawal channel can be offered to this user.
 * Source enforcement still runs again when the request is submitted; this only
 * prevents showing methods/agents that have no matching deposit source.
 */
export function withdrawalMethodAvailability(
  db: any,
  userId: any,
  method: any,
): { available: boolean; sourcePolicy?: ReturnType<typeof methodWithdrawalSourceInfo> } {
  const policy = ensureWithdrawalPolicy(db);
  if (String(method?.category || '').toUpperCase() === 'AGENT') {
    if (!policy.agentCapsEnabled) return { available: true };
    const sources = collectDepositSources(db, userId);
    const cashAgents = Array.isArray(db?.agents) ? db.agents : [];
    const available = cashAgents.some((agent: any) => {
      const id = keyOf(agent.id);
      if (!isCashAgentId(id) || agent.isActive === false) return false;
      const limit = agentSourceLimitFromSources(db, userId, id, {}, sources, policy);
      return limit.depositedUsd > 0 && (limit.unlimited || limit.availableUsd > 0);
    });
    return { available };
  }

  const sourcePolicy = methodWithdrawalSourceInfo(db, userId, method?.id);
  if (policy.methodCapsEnabled && sourcePolicy.methodDepositedUsd <= 0) {
    return { available: false, sourcePolicy };
  }
  if (policy.methodCapsEnabled && !sourcePolicy.methodUnlimited && sourcePolicy.methodAvailableUsd <= 0) {
    return { available: false, sourcePolicy };
  }
  if (policy.agentCapsEnabled && sourcePolicy.agentRequired
    && !sourcePolicy.walletAgents.some((agent) => agent.unlimited || agent.availableUsd > 0)) {
    return { available: false, sourcePolicy };
  }
  return { available: true, sourcePolicy };
}

export function isWithdrawalMethodAvailable(db: any, userId: any, method: any): boolean {
  return withdrawalMethodAvailability(db, userId, method).available;
}

export function isCashAgentId(id: any): boolean {
  return /^AGT-/i.test(keyOf(id));
}

export function isWalletAgentId(id: any): boolean {
  return /^WAG-/i.test(keyOf(id));
}
