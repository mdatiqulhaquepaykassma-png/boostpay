import { FC, useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronRight, Zap, Layers, RefreshCw, MessageCircle, CornerDownRight, X } from 'lucide-react';
import { BoostPayStore } from '../services/store';

/**
 * ReferralTree — the user's whole team, but it does NOT live on the Refer page.
 *
 * The Refer page only shows one small card ("Team 7 · L1 3 · L2 3 · L3 1").
 * Tapping that card opens a full-height sheet with the complete tree, where each
 * member can be opened to see their own team — unlimited depth, one level at a
 * time so a big team never has to load all at once.
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
  const [sheet, setSheet] = useState(false);

  // parentId -> its direct members (loaded the moment that branch is opened)
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

  // The root branch loads the first time the sheet is opened — the Refer page
  // itself never fetches a member list, so it stays light.
  useEffect(() => {
    if (sheet && summary?.userId && !branches[summary.userId] && !busy[summary.userId]) {
      void loadBranch(summary.userId);
    }
  }, [sheet, summary?.userId, branches, busy, loadBranch]);

  const toggle = useCallback((id: string) => {
    setOpen(prev => {
      const next = { ...prev, [id]: !prev[id] };
      if (next[id] && !branches[id]) void loadBranch(id);
      return next;
    });
  }, [branches, loadBranch]);

  const message = useCallback((id: string) => {
    setSheet(false);
    onMessageUser?.(id);
  }, [onMessageUser]);

  /* ── compact card on the Refer page ─────────────────────────────────────── */
  if (loading && !summary) {
    return <div className="h-14 animate-pulse rounded-2xl border border-zinc-800 bg-zinc-900/80" />;
  }

  if (!summary) {
    return (
      <div className="rounded-2xl border border-zinc-800 bg-zinc-900/90 px-3 py-2.5">
        <p className="text-[11px] text-zinc-400">Team tree unavailable{err ? ` — ${err}` : ''}.</p>
        <button onClick={() => void loadSummary()} className="mt-1.5 rounded-lg border border-zinc-700 bg-zinc-950 px-2.5 py-1 text-[10px] font-semibold text-zinc-300 cursor-pointer">
          Retry
        </button>
      </div>
    );
  }

  const levels = (summary.byLevel || []).filter(l => l.count > 0);

  if (summary.total === 0) {
    return (
      <div className="rounded-2xl border border-zinc-800 bg-zinc-900/90 px-3 py-2.5">
        <div className="flex items-center gap-2">
          <Layers className="h-3.5 w-3.5 text-amber-400" />
          <span className="text-xs font-bold text-white">My Team Tree</span>
          <span className="ml-auto font-mono text-[11px] text-zinc-500">0</span>
        </div>
        <p className="mt-1 text-[10px] text-zinc-500">Share your refer link — everyone who joins under you appears here, at every level.</p>
      </div>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setSheet(true)}
        className="w-full rounded-2xl border border-amber-500/25 bg-gradient-to-r from-amber-500/10 to-zinc-900/90 px-3 py-2.5 text-left cursor-pointer active:scale-[0.995] transition"
        title="Open the full team list"
      >
        <div className="flex items-center gap-2">
          <Layers className="h-4 w-4 shrink-0 text-amber-400" />
          <span className="text-xs font-bold text-white">My Team Tree</span>
          <span className="rounded-full bg-amber-500/20 px-2 py-0.5 font-mono text-[10px] font-black text-amber-200">{summary.total}</span>
          <span className="ml-auto flex items-center gap-1 text-[10px] font-semibold text-amber-300">
            Full list <ChevronRight className="h-3.5 w-3.5" />
          </span>
        </div>
        <div className="mt-1 flex items-center gap-1.5 overflow-hidden">
          <span className="font-mono text-[10px] text-zinc-400">
            {levels.map(l => `L${l.level} ${l.count}`).join(' · ') || 'no members yet'}
          </span>
          {summary.boostActive > 0 && (
            <span className="ml-auto shrink-0 rounded-full bg-emerald-500/15 px-1.5 py-0.5 text-[9px] font-bold text-emerald-300">
              {summary.boostActive} boosting
            </span>
          )}
          {summary.joinedToday > 0 && (
            <span className="shrink-0 rounded-full bg-emerald-500/10 px-1.5 py-0.5 text-[9px] font-bold text-emerald-300">+{summary.joinedToday} today</span>
          )}
        </div>
      </button>

      {/* ── full list sheet ─────────────────────────────────────────────────── */}
      {/* Portal: the sheet is mounted on <body>, otherwise the fixed bottom nav
          (a sibling with its own stacking context) paints on top of it. */}
      {sheet && createPortal((
        <div className="fixed inset-0 z-[140] flex items-end justify-center bg-black/80 backdrop-blur-sm sm:items-center" onClick={() => setSheet(false)}>
          <div
            onClick={e => e.stopPropagation()}
            className="flex h-[92vh] w-full max-w-md flex-col rounded-t-3xl border border-zinc-800 bg-zinc-900 sm:h-[85vh] sm:rounded-3xl"
          >
            {/* header */}
            <div className="flex items-center gap-2 border-b border-zinc-800 px-4 py-3">
              <Layers className="h-4 w-4 text-amber-400" />
              <div className="min-w-0">
                <div className="text-sm font-bold text-white">My Team Tree</div>
                <div className="font-mono text-[10px] text-zinc-500">{summary.total} members · {summary.depth} levels</div>
              </div>
              <button
                onClick={() => void loadSummary()}
                className="ml-auto rounded-lg border border-zinc-800 bg-zinc-950 p-1.5 text-zinc-400 cursor-pointer"
                title="Refresh"
              >
                <RefreshCw className="h-3.5 w-3.5" />
              </button>
              <button onClick={() => setSheet(false)} className="rounded-lg border border-zinc-800 bg-zinc-950 p-1.5 text-zinc-400 cursor-pointer" title="Close">
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* summary strip */}
            <div className="grid grid-cols-4 gap-1.5 px-3 pt-2.5">
              <Stat label="Total" value={summary.total} tone="amber" />
              <Stat label="Direct" value={summary.direct} />
              <Stat label="Depth" value={summary.depth} />
              <Stat label="Boosting" value={summary.boostActive} tone="emerald" />
            </div>
            {levels.length > 0 && (
              <div className="flex flex-wrap gap-1.5 px-3 pt-2">
                {levels.map(l => (
                  <span key={l.level} className="rounded-full border border-zinc-800 bg-zinc-950 px-2 py-0.5 font-mono text-[10px] text-zinc-300">
                    L{l.level} <span className="font-bold text-amber-300">{l.count}</span>
                  </span>
                ))}
              </div>
            )}

            {/* the tree — scrolls inside the sheet */}
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-2.5 pb-[calc(1rem+env(safe-area-inset-bottom))]">
              <div className="flex items-center gap-2 rounded-xl border border-amber-500/25 bg-amber-500/10 px-2.5 py-2">
                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-amber-500 font-mono text-[9px] font-black text-zinc-950">YOU</span>
                <span className="font-mono text-xs font-bold text-amber-200">#{summary.userId}</span>
                <span className="ml-auto rounded-full bg-amber-500/20 px-2 py-0.5 font-mono text-[10px] font-bold text-amber-200">team {summary.total}</span>
              </div>

              <div className="space-y-1">
                <TreeNodeList
                  parentId={summary.userId}
                  depth={0}
                  branches={branches}
                  counts={counts}
                  open={open}
                  busy={busy}
                  onToggle={toggle}
                  onLoadMore={(id) => void loadBranch(id, branches[id]?.length || 0)}
                  onMessageUser={message}
                />
              </div>

              {summary.truncated && (
                <p className="mt-2 rounded-xl border border-amber-500/30 bg-amber-500/10 px-2 py-1.5 text-[10px] text-amber-300">
                  Team is very large — counts above 50 000 members are abbreviated.
                </p>
              )}
              {err && <p className="mt-2 text-[10px] text-red-400">{err}</p>}
              <p className="mt-3 text-[10px] leading-relaxed text-zinc-500">
                Everyone who joined with your code — or with the code of someone in your team — is listed here, unlimited levels.
                Tap a member with › to open their own team.
              </p>
            </div>
          </div>
        </div>
      ), document.body)}
    </>
  );
};

const Stat: FC<{ label: string; value: number; tone?: 'amber' | 'emerald' }> = ({ label, value, tone }) => (
  <div className={`rounded-xl border p-2 ${tone === 'amber' ? 'border-amber-500/25 bg-amber-500/10' : tone === 'emerald' ? 'border-emerald-500/20 bg-emerald-500/5' : 'border-zinc-800 bg-zinc-950'}`}>
    <div className="text-[8px] font-semibold uppercase tracking-wider text-zinc-500">{label}</div>
    <div className={`font-mono text-sm font-black ${tone === 'amber' ? 'text-amber-300' : tone === 'emerald' ? 'text-emerald-300' : 'text-white'}`}>{value}</div>
  </div>
);

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
              className={`mt-1 flex items-center gap-1.5 rounded-xl border border-zinc-800/80 bg-zinc-950 px-2 py-2 ${canOpen ? 'cursor-pointer active:bg-zinc-900' : ''}`}
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
      {depth === 0 && rowList.length > 0 && (
        <p className="mt-1.5 flex items-center gap-1 pl-1 text-[10px] text-zinc-600">
          <Zap className="h-3 w-3 text-amber-500/60" /> tap a member with › to open their team
        </p>
      )}
    </div>
  );
};

export default ReferralTree;
