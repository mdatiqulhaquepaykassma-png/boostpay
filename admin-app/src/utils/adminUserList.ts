export type AdminUserFilter = 'ALL' | 'HIGH_BALANCE' | 'ACTIVE' | 'BOOSTING' | 'FROZEN' | 'BLOCKED' | 'IDLE';

type AdminUserRow = {
  id: string | number;
  email?: string;
  phrase?: string;
  balance?: number;
  createdAt?: number | string;
  isFrozen?: boolean;
  isBlocked?: boolean;
  boostState?: { isActive?: boolean; isPaused?: boolean };
};

function createdAtMs(user: AdminUserRow): number {
  const value = Number.isFinite(Number(user.createdAt))
    ? Number(user.createdAt)
    : new Date(String(user.createdAt || '')).getTime();
  return Number.isFinite(value) ? value : 0;
}

function compareNewest(a: AdminUserRow, b: AdminUserRow): number {
  const byCreated = createdAtMs(b) - createdAtMs(a);
  if (byCreated) return byCreated;
  const aId = Number(a.id), bId = Number(b.id);
  if (Number.isFinite(aId) && Number.isFinite(bId)) return bId - aId;
  return String(b.id).localeCompare(String(a.id));
}

/** Exact numeric ID matching, newest-first default, and balance-descending high-balance view. */
export function filterAndSortAdminUsers<T extends AdminUserRow>(
  users: readonly T[],
  searchTerm: string,
  userFilter: AdminUserFilter,
): T[] {
  const rawSearch = String(searchTerm || '').trim();
  const query = rawSearch.replace(/^#/, '').trim();
  const exactIdQuery = /^\d+$/.test(query);

  const sorted = [...users].sort((a, b) => {
    if (userFilter === 'HIGH_BALANCE') {
      const byBalance = (Number(b.balance) || 0) - (Number(a.balance) || 0);
      if (byBalance) return byBalance;
    }
    return compareNewest(a, b);
  });

  return sorted.filter((user) => {
    if (query) {
      if (exactIdQuery) {
        // A numeric search is an ID lookup, never a substring match against
        // another user's ID (or against unrelated balance fields).
        if (String(user.id) !== query) return false;
      } else {
        const lower = query.toLowerCase();
        const matchesOtherField =
          String(user.email || '').toLowerCase().includes(lower) ||
          String(user.phrase || '').toLowerCase().includes(lower) ||
          String(user.balance ?? '').includes(query);
        if (!matchesOtherField) return false;
      }
    }

    if (userFilter === 'HIGH_BALANCE') return Number(user.balance) >= 10;
    if (userFilter === 'ACTIVE') return !user.isFrozen && !user.isBlocked;
    if (userFilter === 'BOOSTING') return !!user.boostState?.isActive;
    if (userFilter === 'FROZEN') return !!user.isFrozen;
    if (userFilter === 'BLOCKED') return !!user.isBlocked;
    if (userFilter === 'IDLE') return !user.boostState?.isActive;
    return true;
  });
}
