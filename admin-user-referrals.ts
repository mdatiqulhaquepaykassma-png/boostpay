export interface ReferralCohortStats {
  count: number;
  sameIpDevice: number;
  depositors: number;
  activeBoosters: number;
}

export interface AdminReferralStats {
  /** Direct children of this user in the referral graph. */
  direct: ReferralCohortStats;
  /** All unique descendants at every level; includes direct referrals. */
  team: ReferralCohortStats;
}

export type AdminReferralStatsMap = Map<string, AdminReferralStats>;

const emptyCohort = (): ReferralCohortStats => ({
  count: 0,
  sameIpDevice: 0,
  depositors: 0,
  activeBoosters: 0,
});

function cleanId(value: unknown): string {
  return value == null ? '' : String(value).trim();
}

function cleanSignal(value: unknown): string {
  const signal = String(value ?? '').trim().toLowerCase();
  if (!signal || signal === 'unknown' || signal === 'n/a' || signal === 'none' || signal === 'null') return '';
  return signal;
}

function isConfirmedStatus(value: unknown): boolean {
  const status = String(value ?? '').trim().toUpperCase();
  return ['APPROVED', 'CREDITED', 'COMPLETED', 'SUCCESS', 'PAID'].includes(status);
}

function isIdLessThan(a: string, b: string): number {
  const an = Number(a), bn = Number(b);
  if (Number.isFinite(an) && Number.isFinite(bn) && an !== bn) return an - bn;
  return a.localeCompare(b);
}

/**
 * Aggregate referral counts for every account in one graph pass.
 *
 * A referral account should have one referrer. Duplicate rows for the same
 * parent/child pair are ignored; if bad imported data gives a child multiple
 * parents, the first row is used for team-tree aggregation. Cycles are broken
 * deterministically so admin list rendering cannot loop or double-count them.
 * Direct counts still reflect the distinct recorded parent/child links.
 *
 * `sameIpDevice` is a review signal, not proof of fraud. It counts a referral
 * edge whose two accounts share a recorded signup IP, signup device ID, or
 * login device fingerprint. Raw IPs/fingerprints are never returned.
 */
export function buildAdminReferralStats(
  db: any,
  activeBoostIds?: ReadonlySet<string>,
): AdminReferralStatsMap {
  const users: any[] = Array.isArray(db?.users) ? db.users : [];
  const usersById = new Map<string, any>();
  const nodes = new Set<string>();
  for (const user of users) {
    const id = cleanId(user?.id);
    if (!id) continue;
    usersById.set(id, user);
    nodes.add(id);
  }

  const directEdgesByParent = new Map<string, { parentId: string; childId: string }[]>();
  const seenEdgeKeys = new Set<string>();
  const selectedEdgeByChild = new Map<string, { parentId: string; childId: string }>();
  for (const referral of (Array.isArray(db?.referrals) ? db.referrals : [])) {
    const parentId = cleanId(referral?.referrerId);
    const childId = cleanId(referral?.referredId);
    if (!parentId || !childId || parentId === childId) continue;

    const edgeKey = `${parentId}\u0000${childId}`;
    if (seenEdgeKeys.has(edgeKey)) continue;
    seenEdgeKeys.add(edgeKey);
    const edge = { parentId, childId };
    const siblings = directEdgesByParent.get(parentId);
    if (siblings) siblings.push(edge); else directEdgesByParent.set(parentId, [edge]);
    nodes.add(parentId);
    nodes.add(childId);

    // The referral graph is intended to be a tree (one parent per account).
    // Keep the first recorded edge for the team-tree view if imported data is
    // inconsistent; direct-link metrics above retain each distinct edge.
    if (!selectedEdgeByChild.has(childId)) selectedEdgeByChild.set(childId, edge);
  }

  const deposits = new Set<string>();
  for (const request of (Array.isArray(db?.depositRequests) ? db.depositRequests : [])) {
    if (!isConfirmedStatus(request?.status)) continue;
    const id = cleanId(request?.userId);
    if (id) deposits.add(id);
  }
  for (const tx of (Array.isArray(db?.transactions) ? db.transactions : [])) {
    if (String(tx?.type || '').toUpperCase() !== 'DEPOSIT') continue;
    // Legacy credited DEPOSIT rows may not carry a status; only explicit
    // pending/rejected rows are excluded in that case.
    const status = String(tx?.status ?? tx?.metadata?.status ?? '').trim().toUpperCase();
    if (['PENDING', 'REJECTED', 'FAILED', 'CANCELLED', 'CANCELED', 'EXPIRED'].includes(status)) continue;
    const id = cleanId(tx?.userId);
    if (id) deposits.add(id);
  }

  const deviceKeysByUser = new Map<string, Set<string>>();
  const addDeviceKey = (userId: string, key: string) => {
    if (!userId || !key) return;
    const keys = deviceKeysByUser.get(userId);
    if (keys) keys.add(key); else deviceKeysByUser.set(userId, new Set([key]));
  };
  for (const user of users) {
    const id = cleanId(user?.id);
    const device = cleanSignal(user?.signupDevice);
    if (id && device) addDeviceKey(id, `signup-device:${device}`);
  }
  const fingerprints = db?.deviceFingerprints;
  if (fingerprints && typeof fingerprints === 'object' && !Array.isArray(fingerprints)) {
    for (const [rawFingerprint, rawIds] of Object.entries(fingerprints)) {
      const fingerprint = cleanSignal(rawFingerprint);
      if (!fingerprint || !Array.isArray(rawIds)) continue;
      for (const rawId of rawIds) addDeviceKey(cleanId(rawId), `fingerprint:${fingerprint}`);
    }
  }

  const edgeSharesIdentity = (edge: { parentId: string; childId: string }): boolean => {
    const parent = usersById.get(edge.parentId);
    const child = usersById.get(edge.childId);
    if (!parent || !child) return false;

    const parentIp = cleanSignal(parent.signupIp);
    const childIp = cleanSignal(child.signupIp);
    if (parentIp && childIp && parentIp === childIp) return true;

    const parentKeys = deviceKeysByUser.get(edge.parentId);
    const childKeys = deviceKeysByUser.get(edge.childId);
    if (!parentKeys || !childKeys) return false;
    for (const key of parentKeys) if (childKeys.has(key)) return true;
    return false;
  };

  const suspiciousEdges = new Set<string>();
  for (const edge of seenEdgeKeys) {
    const [parentId, childId] = edge.split('\u0000');
    if (edgeSharesIdentity({ parentId, childId })) suspiciousEdges.add(edge);
  }
  const edgeKeyOf = (parentId: string, childId: string) => `${parentId}\u0000${childId}`;

  // Pick one parent per child and remove cycles before building the forest.
  const parentByChild = new Map<string, string>();
  for (const [childId, edge] of selectedEdgeByChild) parentByChild.set(childId, edge.parentId);
  const completed = new Set<string>();
  for (const start of nodes) {
    if (completed.has(start)) continue;
    const path: string[] = [];
    const position = new Map<string, number>();
    let current: string | undefined = start;
    while (current && !completed.has(current) && !position.has(current)) {
      position.set(current, path.length);
      path.push(current);
      current = parentByChild.get(current);
    }
    if (current && position.has(current)) {
      const cycle = path.slice(position.get(current)!);
      const breakChild = [...cycle].sort((a, b) => {
        const aCreated = Number(usersById.get(a)?.createdAt) || Number.POSITIVE_INFINITY;
        const bCreated = Number(usersById.get(b)?.createdAt) || Number.POSITIVE_INFINITY;
        return aCreated - bCreated || isIdLessThan(a, b);
      })[0];
      if (breakChild) parentByChild.delete(breakChild);
    }
    for (const id of path) completed.add(id);
  }

  const childrenByParent = new Map<string, string[]>();
  for (const [childId, parentId] of parentByChild) {
    const children = childrenByParent.get(parentId);
    if (children) children.push(childId); else childrenByParent.set(parentId, [childId]);
  }

  const compareNodes = (a: string, b: string) => {
    const aCreated = Number(usersById.get(a)?.createdAt) || 0;
    const bCreated = Number(usersById.get(b)?.createdAt) || 0;
    return aCreated - bCreated || isIdLessThan(a, b);
  };
  const orderedNodes = Array.from(nodes).sort(compareNodes);
  const roots = orderedNodes.filter(id => !parentByChild.has(id));
  const visited = new Set<string>();
  const traversal: string[] = [];
  for (const root of roots) {
    const stack = [root];
    while (stack.length) {
      const id = stack.pop()!;
      if (visited.has(id)) continue;
      visited.add(id);
      traversal.push(id);
      const children = childrenByParent.get(id) || [];
      for (let i = children.length - 1; i >= 0; i--) stack.push(children[i]);
    }
  }
  // Defensive fallback for any malformed component left disconnected above.
  for (const id of orderedNodes) {
    if (visited.has(id)) continue;
    visited.add(id);
    traversal.push(id);
  }

  const active = (id: string): boolean => {
    if (activeBoostIds) return activeBoostIds.has(id);
    const user = usersById.get(id);
    return !!(user?.boostState?.isActive && !user.boostState.isPaused);
  };
  const statsById = new Map<string, AdminReferralStats>();
  for (let i = traversal.length - 1; i >= 0; i--) {
    const id = traversal[i];
    const directEdges = directEdgesByParent.get(id) || [];
    const direct = emptyCohort();
    direct.count = directEdges.length;
    for (const edge of directEdges) {
      if (suspiciousEdges.has(edgeKeyOf(edge.parentId, edge.childId))) direct.sameIpDevice++;
      if (deposits.has(edge.childId)) direct.depositors++;
      if (active(edge.childId)) direct.activeBoosters++;
    }

    const team = emptyCohort();
    for (const childId of (childrenByParent.get(id) || [])) {
      const childStats = statsById.get(childId);
      team.count += 1 + (childStats?.team.count || 0);
      const edge = selectedEdgeByChild.get(childId);
      if (edge && suspiciousEdges.has(edgeKeyOf(edge.parentId, edge.childId))) team.sameIpDevice++;
      team.sameIpDevice += childStats?.team.sameIpDevice || 0;
      if (deposits.has(childId)) team.depositors++;
      team.depositors += childStats?.team.depositors || 0;
      if (active(childId)) team.activeBoosters++;
      team.activeBoosters += childStats?.team.activeBoosters || 0;
    }
    statsById.set(id, { direct, team });
  }

  return statsById;
}
