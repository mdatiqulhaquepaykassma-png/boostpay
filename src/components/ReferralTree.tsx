import { FC, useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronRight, Users, Zap, Layers, Activity, RefreshCw, MessageCircle, CornerDownRight } from 'lucide-react';
import { BoostPayStore } from '../services/store';

/**
 * ReferralTree — the whole team under one user, at every level.
 *
 *   · "Team 37"  = everyone who joined under this user, unlimited depth
 *   · each row can be opened to see that member's own team, one level at a time
 *   · a member row prints how many people sit under THAT member
 *
 * Only IDs are shown (never names or emails), and the server re-checks on every
 * expansion that the branch really belongs to the caller.
 */

type Summary = {
  userId: string;
  total: number;
  direct: number;
  depth: number;
  byLevel: { level: number; count: number }[];
  boostActive: number;
  boostPaused: number;
  joinedToday: number;
  newestJoinAt: number | null;
  truncated?: boolean;
};

type Member = {
  id: string;
  joinedAt: number | null;
  level: number | null;
  teamSize: number;
  directCount: number;
  boostActive: boolean;
  boostPaused: boolean;
  exists?: boolean;
};

const since = (ts: number | null | undefined): string => {
  if (!ts) return '';
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(ts).toLocaleDateString();
};

export const ReferralTree: FC<{ onMessageUser?: (id: string) => void }> = ({ onMessageUser }) => {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  // parentId -> its direct members (loaded the moment a node is opened)
  const [branches, setBranches] = useState<Record<string, Member[]>>({});
  const [counts, setCounts] = useState<Record<string, { childCount: number; hasMore: boolean }>>({});
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState<Record<string, boolean>>({});

  const loadSummary = useCallback(async () => {
    try {
      setErr(null);
      const d = await BoostPayStore.getTeamSummary();
      setSummary(d);
    } catch (e: any) {
      setErr(e?.message || 'Could not load your team.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void loadSummary(); }, [loadSummary]);


  const loadBranch = useCallback(async (parentId: string, offset = 0) => {
    setBusy(b => ({ ...b, [parentId]: true }));
    try {
      const d = await BoostPayStore.getTeamChildren(parentId, { offset, limit: 100 });
      if (!d) return;
      setBranches(prev => ({
        ...prev,
        [parentId]: offset === 0 ? (d.children || []) : [...(prev[parentId] || []), ...(d.children || [])]
      }));
      setCounts(prev => ({ ...prev, [parentId]: { childCount: d.childCount || 0, hasMore: !!d.hasMore } }));
    } catch (e: any) {
      setErr(e?.message || 'Could not load this branch.');
    } finally {
      setBusy(b => ({ ...b, [parentId]: false }));
    }
  }, []);

  // The root branch (my direct members) is what the tree opens with.
  useEffect(() => {
    if (summary?.userId && !branches[summary.userId] && !busy[summary.userId]) {
      void loadBranch(summary.userId);
    }
  }, [summary?.userId, branches, busy, loadBranch]);

  const toggle = useCallback((id: string) => {
    setOpen(prev => {
      const next = { ...prev, [id]: !prev[id] };
      if (next[id] && !branches[id]) void loadBranch(id);
      return next;
    });
  }, [branches, loadBranch]);

  const levelChips = useMemo(() => (summary?.byLevel || []).filter(l => l.count > 0), [summary]);

  if (loading && !summary) {
    return (
      <div className="rounded-3xl border border-zinc-800 bg-zinc-900/90 p-4">
        <div className="h-4 w-32 animate-pulse rounded bg-zinc-800" />
        <div className="mt-3 h-10 animate-pulse rounded-2xl bg-zinc-800/60" />
      </div>
    );
  }

  if (!summary) {
    return (
      <div className="rounded-3xl border border-zinc-800 bg-zinc-900/90 p-4">
        <p className="text-xs text-zinc-400">Team tree unavailable{err ? ` — ${err}` : ''}.</p>
        <button onClick={() => void loadSummary()} className="mt-2 rounded-xl border border-zinc-700 bg-zinc-950 px-3 py-1.5 text-[11px] font-semibold text-zinc-300 cursor-pointer">
          Retry
        </button>
      </div>
    );
  }

  const hasTeam = summary.total > 0;

  return (
    <div className="rounded-3xl border border-zinc-800 bg-zinc-900/90 p-4 shadow-xl">
      {/* header */}
      <div className="flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-sm font-bold text-white">
          <Layers className="h-4 w-4 text-amber-400" /> My Team Tree
        </h3>
        <button
          onClick={() => void loadSummary()}
          className="flex items-center gap-1 rounded-lg border border-zinc-800 bg-zinc-950 px-2 py-1 text-[10px] font-semibold text-zinc-400 hover:text-zinc-200 cursor-pointer"
          title="Refresh team counts"
        >
          <RefreshCw className="h-3 w-3" /> Refresh
        </button>
      </div>

      {/* headline numbers — total team at every level */}
      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <div className="rounded-2xl border border-amber-500/25 bg-amber-500/10 p-2.5">
          <div className="flex items-center gap-1 text-[9px] font-semibold uppercase tracking-wider text-amber-400">
            <Users className="h-3 w-3" /> Total Team
          </div>
          <div className="mt-0.5 font-mono text-lg font-black text-amber-300">{summary.total}</div>
          <div className="text-[9px] text-zinc-500">all levels</div>
        </div>
        <div className="rounded-2xl border border-zinc-800 bg-zinc-950 p-2.5">
          <div className="text-[9px] font-semibold uppercase tracking-wider text-zinc-500">Direct</div>
          <div className="mt-0.5 font-mono text-lg font-bold text-white">{summary.direct}</div>
          <div className="text-[9px] text-zinc-500">level 1</div>
        </div>
        <div className="rounded-2xl border border-zinc-800 bg-zinc-950 p-2.5">
          <div className="text-[9px] font-semibold uppercase tracking-wider text-zinc-500">Depth</div>
          <div className="mt-0.5 font-mono text-lg font-bold text-white">{summary.depth}</div>
          <div className="text-[9px] text-zinc-500">levels deep</div>
        </div>
        <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/5 p-2.5">
          <div className="flex items-center gap-1 text-[9px] font-semibold uppercase tracking-wider text-emerald-400">
            <Activity className="h-3 w-3" /> Boosting
          </div>
          <div className="mt-0.5 font-mono text-lg font-bold text-emerald-300">{summary.boostActive}</div>
          <div className="text-[9px] text-zinc-500">{summary.boostPaused > 0 ? `${summary.boostPaused} paused` : 'right now'}</div>
        </div>
      </div>

      {/* per-level counts: L1 12 · L2 5 · L3 2 … */}
      {levelChips.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {levelChips.map(l => (
            <span key={l.level} className="rounded-full border border-zinc-800 bg-zinc-950 px-2 py-0.5 font-mono text-[10px] text-zinc-300">
              L{l.level} <span className="font-bold text-amber-300">{l.count}</span>
            </span>
          ))}
          {summary.joinedToday > 0 && (
            <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold text-emerald-300">
              +{summary.joinedToday} today
            </span>
          )}
        </div>
      )}

      {/* the tree itself */}
      <div className="mt-3">
        {!hasTeam ? (
          <div className="rounded-2xl border border-dashed border-zinc-800 p-5 text-center">
            <Users className="mx-auto mb-2 h-6 w-6 text-zinc-600" />
            <p className="text-xs font-bold text-zinc-400">Your team is empty</p>
            <p className="mt-1 text-[11px] text-zinc-500">Share your refer link — everyone who joins under you shows up here, at every level.</p>
          </div>
        ) : (
          <div className="space-y-1">
            {/* root */}
            <div className="flex items-center gap-2 rounded-xl border border-amber-500/25 bg-amber-500/10 px-2.5 py-2">
              <span className="flex h-5 w-5 items-center justify-center rounded-full bg-amber-500 font-mono text-[9px] font-black text-zinc-950">YOU</span>
              <span className="font-mono text-xs font-bold text-amber-200">#{summary.userId}</span>
              <span className="ml-auto rounded-full bg-amber-500/20 px-2 py-0.5 font-mono text-[10px] font-bold text-amber-200">
                team {summary.total}
              </span>
            </div>

            <TreeNodeList
              parentId={summary.userId}
              depth={0}
              branches={branches}
              counts={counts}
              open={open}
              busy={busy}
              onToggle={toggle}
              onLoadMore={(id) => void loadBranch(id, branches[id]?.length || 0)}
              onMessageUser={onMessageUser}
            />
          </div>
        )}
      </div>

      {summary.truncated && (
        <p className="mt-2 rounded-xl border border-amber-500/30 bg-amber-500/10 px-2 py-1.5 text-[10px] text-amber-300">
          Your team is very large — counts above {50000} members are abbreviated.
        </p>
      )}
      {err && <p className="mt-2 text-[10px] text-red-400">{err}</p>}

      <p className="mt-3 text-[10px] leading-relaxed text-zinc-500">
        Anyone who joins with your code — or with the code of someone in your team — is counted here, unlimited levels.
        Tap a member to open their own team.
      </p>
    </div>
  );
};

/* ── recursive rows ─────────────────────────────────────────────────────────── */

const TreeNodeList: FC<{
  parentId: string;
  depth: number;
  branches: Record<string, Member[]>;
  counts: Record<string, { childCount: number; hasMore: boolean }>;
  open: Record<string, boolean>;
  busy: Record<string, boolean>;
  onToggle: (id: string) => void;
  onLoadMore: (id: string) => void;
  onMessageUser?: (id: string) => void;
}> = ({ parentId, depth, branches, counts, open, busy, onToggle, onLoadMore, onMessageUser }) => {
  const rowList = branches[parentId];
  if (!rowList) {
    return (
      <div className="flex items-center gap-2 py-1.5 pl-6 text-[10px] text-zinc-500">
        <span className="h-3 w-3 animate-spin rounded-full border-2 border-zinc-600 border-t-transparent" /> loading…
      </div>
    );
  }
  if (!rowList.length) {
    return <div className="py-1.5 pl-6 text-[10px] text-zinc-600">no members under this one</div>;
  }
  const c = counts[parentId];
  return (
    <div className={depth === 0 ? 'mt-1' : ''}>
      {rowList.map(m => {
        const isOpen = !!open[m.id];
        const indent = Math.min(depth, 6) * 14;
        const canOpen = m.directCount > 0;
        return (
          <div key={m.id}>
            <div
              className={`flex items-center gap-1.5 rounded-xl border border-zinc-800/80 bg-zinc-950 px-2 py-1.5 ${canOpen ? 'cursor-pointer active:bg-zinc-900' : ''}`}
              style={{ marginLeft: indent }}
              onClick={() => { if (canOpen) onToggle(m.id); }}
            >
              {canOpen ? (
                <ChevronRight className={`h-3.5 w-3.5 shrink-0 text-zinc-500 transition-transform ${isOpen ? 'rotate-90' : ''}`} />
              ) : (
                <CornerDownRight className="h-3.5 w-3.5 shrink-0 text-zinc-700" />
              )}
              <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${m.boostActive ? 'bg-emerald-400' : m.boostPaused ? 'bg-amber-400' : 'bg-zinc-600'}`} />
              <span className="font-mono text-[11px] font-bold text-zinc-200">#{m.id}</span>
              <span className="rounded-full bg-zinc-800/80 px-1.5 py-0.5 font-mono text-[9px] font-semibold text-zinc-400">
                L{m.level ?? '?'}
              </span>
              <span className="ml-auto flex items-center gap-1.5">
                {m.teamSize > 0 && (
                  <span className="rounded-full border border-amber-500/25 bg-amber-500/10 px-1.5 py-0.5 font-mono text-[9px] font-bold text-amber-300" title="people under this member">
                    team {m.teamSize}
                  </span>
                )}
                <span className="text-[9px] text-zinc-600">{since(m.joinedAt)}</span>
                {onMessageUser && (
                  <button
                    onClick={(e) => { e.stopPropagation(); onMessageUser(m.id); }}
                    className="rounded-lg bg-amber-500/10 p-1 text-amber-300 cursor-pointer"
                    title={`Message #${m.id}`}
                  >
                    <MessageCircle className="h-3 w-3" />
                  </button>
                )}
              </span>
            </div>
            {isOpen && canOpen && (
              <div className="mt-0.5">
                <TreeNodeList
                  parentId={m.id}
                  depth={depth + 1}
                  branches={branches}
                  counts={counts}
                  open={open}
                  busy={busy}
                  onToggle={onToggle}
                  onLoadMore={onLoadMore}
                  onMessageUser={onMessageUser}
                />
              </div>
            )}
          </div>
        );
      })}
      {c?.hasMore && (
        <button
          onClick={() => onLoadMore(parentId)}
          disabled={!!busy[parentId]}
          className="mt-1 w-full rounded-xl border border-zinc-800 bg-zinc-950 py-1.5 text-[10px] font-semibold text-zinc-400 disabled:opacity-50 cursor-pointer"
          style={{ marginLeft: Math.min(depth, 6) * 14 }}
        >
          {busy[parentId] ? 'Loading…' : `Load more (${rowList.length}/${c.childCount})`}
        </button>
      )}
      {depth === 0 && rowList.length > 0 && !c?.hasMore && (
        <p className="mt-1.5 flex items-center gap-1 pl-1 text-[10px] text-zinc-600">
          <Zap className="h-3 w-3 text-amber-500/60" /> tap a member with › to open their team
        </p>
      )}
    </div>
  );
};

export default ReferralTree;
