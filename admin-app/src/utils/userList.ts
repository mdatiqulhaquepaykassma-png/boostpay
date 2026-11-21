import type { User } from '../types';
import { formatPrecisionAmount } from './format';

export type UserListFilter =
  | 'ALL'
  | 'HIGH_BALANCE'
  | 'ACTIVE'
  | 'BOOSTING'
  | 'PAUSED'
  | 'FROZEN'
  | 'BLOCKED'
  | 'IDLE';

const textOf = (value: unknown): string => String(value ?? '').trim();

function finiteNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const normalized = typeof value === 'string' ? value.trim().replace(/[$,\s]/g, '') : value;
  if (normalized === '') return null;
  const number = Number(normalized);
  return Number.isFinite(number) ? number : null;
}

function searchableFields(user: User): string[] {
  const record = user as unknown as Record<string, unknown>;
  const id = textOf(record.id);
  const balance = finiteNumber(record.balance);
  const profit = finiteNumber(record.lifetimeProfit);
  const createdAt = finiteNumber(record.createdAt);
  const fields = [
    id,
    id ? `#${id}` : '',
    id ? `user ${id}` : '',
    textOf(record.email),
    id ? `user${id}@boostpay.app` : '',
    textOf(record.phrase),
    textOf(record.name),
    textOf(record.fullName),
    textOf(record.username),
    textOf(record.phone),
    textOf(record.phoneNumber),
    textOf(record.mobile),
    record.isBlocked ? 'blocked suspended' : '',
    record.isFrozen ? 'frozen' : '',
    !record.isBlocked && !record.isFrozen ? 'active' : '',
  ];

  if (balance !== null) {
    const formatted = formatPrecisionAmount(balance, 8);
    fields.push(String(balance), balance.toFixed(2), balance.toFixed(8), formatted, `$${formatted}`);
  }
  if (profit !== null) {
    const formatted = formatPrecisionAmount(profit, 8);
    fields.push(String(profit), profit.toFixed(2), profit.toFixed(8), formatted);
  }

  const boost = record.boostState as Record<string, unknown> | undefined;
  if (boost?.isActive) fields.push(boost.isPaused ? 'paused' : 'boosting boost active');
  else fields.push('idle');

  if (createdAt !== null && createdAt > 0) {
    const date = new Date(createdAt);
    if (Number.isFinite(date.getTime())) {
      fields.push(date.toISOString().slice(0, 10), String(date.getFullYear()), date.toLocaleDateString());
    }
  }

  return fields.map(value => value.toLowerCase()).filter(Boolean);
}

function matchesSearch(user: User, searchTerm: string): boolean {
  const tokens = textOf(searchTerm).toLowerCase().split(/\s+/).filter(Boolean);
  if (!tokens.length) return true;
  const fields = searchableFields(user);

  // Every typed word must match some searchable field. This permits useful
  // multi-part searches such as "user #42" while remaining forgiving about
  // currency symbols, commas, whitespace, ID prefixes, and letter case.
  return tokens.every(token => {
    const variants = new Set([
      token,
      token.replace(/^#+/, ''),
      token.replace(/[$,\s]/g, ''),
      token.replace(/^#+/, '').replace(/[$,\s]/g, ''),
    ].filter(Boolean));
    return fields.some(field => {
      const compactField = field.replace(/[$,\s]/g, '');
      return [...variants].some(variant => field.includes(variant) || compactField.includes(variant));
    });
  });
}

function createdAtMs(value: unknown): number {
  const numeric = finiteNumber(value);
  if (numeric !== null) return numeric > 0 ? numeric : 0;
  const parsed = Date.parse(textOf(value));
  return Number.isFinite(parsed) ? parsed : 0;
}

function newestFirst(a: User, b: User): number {
  const dateDiff = createdAtMs(b.createdAt) - createdAtMs(a.createdAt);
  if (dateDiff !== 0) return dateDiff;
  return textOf(b.id).localeCompare(textOf(a.id), undefined, { numeric: true, sensitivity: 'base' });
}

function highestBalanceFirst(a: User, b: User): number {
  const aBalance = finiteNumber((a as unknown as Record<string, unknown>).balance) ?? 0;
  const bBalance = finiteNumber((b as unknown as Record<string, unknown>).balance) ?? 0;
  if (aBalance !== bBalance) return bBalance > aBalance ? 1 : -1;
  return newestFirst(a, b);
}

export function filterAdminUsers(
  users: readonly User[],
  searchTerm: string,
  filter: UserListFilter,
): User[] {
  const safeUsers = (Array.isArray(users) ? users : []).filter(
    (user): user is User => !!user && typeof user === 'object',
  );

  return safeUsers
    .filter(user => {
      const record = user as unknown as Record<string, unknown>;
      const balance = finiteNumber(record.balance) ?? 0;
      const boost = record.boostState as Record<string, unknown> | undefined;
      const isBoostActive = !!boost?.isActive;
      const isPaused = isBoostActive && !!boost?.isPaused;

      if (!matchesSearch(user, searchTerm)) return false;
      switch (filter) {
        case 'HIGH_BALANCE': return balance >= 10;
        case 'ACTIVE': return !record.isFrozen && !record.isBlocked;
        case 'BOOSTING': return isBoostActive && !isPaused;
        case 'PAUSED': return isPaused;
        case 'FROZEN': return !!record.isFrozen;
        case 'BLOCKED': return !!record.isBlocked;
        case 'IDLE': return !isBoostActive;
        case 'ALL':
        default: return true;
      }
    })
    .sort(highestBalanceFirst);
}
