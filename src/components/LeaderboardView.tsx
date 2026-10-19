import React, { FC, useState, useEffect, useRef, memo, useMemo } from 'react';
import {
  Trophy,
  MessageSquare,
  ShieldAlert,
  TrendingUp,
  Copy,
  Check,
  Sparkles,
  Award,
  ArrowUp,
  ArrowDown,
  Minus,
  Search,
  X,
  ChevronLeft,
  ChevronRight
} from 'lucide-react';
import { BoostPayStore, copyToClipboard } from '../services/store';
import { User } from '../types';
import { formatPrecisionAmount } from '../utils/format';

function formatDuration(ms:number): string {
  const totalSecs = Math.max(0, Math.floor(ms/1000));
  const h=Math.floor(totalSecs/3600);
  const m=Math.floor((totalSecs%3600)/60);
  const sec=totalSecs%60;
  if(h>0) return `${h}h ${m}m ${sec}s`;
  if(m>0) return `${m}m ${sec}s`;
  return `${sec}s`;
}

interface Props {
  currentUser?: User;
  currentUserId?: string;
  onSelectPeerForChat: (peerId: string) => void;
}

interface UserRowProps {
  u: User;
  rank: number;
  isMe: boolean;
  rankChanges: Map<string, number>;
  onSelectPeerForChat: (peerId: string) => void;
  copyId: (id: string) => Promise<void>;
  copiedId: string | null;
  getRankBadge: (rank: number) => React.ReactNode;
}

const UserRow = React.memo(({ u, rank, isMe, rankChanges, onSelectPeerForChat, copyId, copiedId, getRankBadge, onOpenDetail }: UserRowProps & { onOpenDetail: (id:string)=>void }) => {

  return (
    <div
      onClick={()=> onOpenDetail(u.id)}
      className={`flex items-center justify-between rounded-2xl border p-3.5 transition-all duration-300 ease-in-out cursor-pointer ${
        isMe
          ? 'border-amber-500/40 bg-amber-500/5 shadow-lg shadow-amber-500/5'
          : 'border-zinc-800/80 bg-zinc-950/60 hover:border-zinc-700 hover:bg-zinc-950'
      }`}
    >
      <div className="flex items-center gap-3 min-w-0 pr-2">
        {getRankBadge(rank)}
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 font-mono text-xs flex-wrap">
            <span className={`font-bold ${isMe ? 'text-amber-400' : 'text-zinc-200'}`}>
              #{u.id}
            </span>

            {isMe && (
              <span className="text-[10px] bg-amber-500/20 text-amber-400 px-1.5 py-0.2 rounded font-sans font-medium">
                You
              </span>
            )}
            {(() => {
              const change = rankChanges.get(u.id) || 0;
              if (change > 0) {
                return (
                  <span className="flex items-center text-[10px] bg-emerald-500/20 text-emerald-400 px-1.5 py-0.5 rounded-full font-mono font-bold">
                    <ArrowUp className="w-3 h-3 mr-0.5" />+{change}
                  </span>
                );
              }
              if (change < 0) {
                return (
                  <span className="flex items-center text-[10px] bg-rose-500/20 text-rose-400 px-1.5 py-0.5 rounded-full font-mono font-bold">
                    <ArrowDown className="w-3 h-3 mr-0.5" />{change}
                  </span>
                );
              }
              return null;
            })()}
            <button
              onClick={(e)=> { e.stopPropagation(); copyId(u.id); }}
              className="text-zinc-500 hover:text-zinc-300 p-0.5 transition cursor-pointer"
              title="Copy User ID"
            >
              {copiedId === u.id ? (
                <Check className="w-3 h-3 text-emerald-400" />
              ) : (
                <Copy className="w-3 h-3" />
              )}
            </button>
          </div>
          <div className="flex items-center gap-2 mt-0.5 flex-wrap">
            <span className="text-[10px] text-zinc-500 font-mono truncate">
              Cycle: {formatDuration((u as any)._cycleDurationMs || 60000)}
            </span>
            <span className="text-[10px] bg-zinc-800 text-zinc-400 px-1.5 py-0.2 rounded-full font-mono">
              Refer: {(u as any)._referralsCount||0} • {(u as any)._referRate||0}%
            </span>
          </div>
          <span className="text-[10px] text-zinc-500 font-mono sm:hidden block truncate">
            Profit: +${formatPrecisionAmount(u.lifetimeProfit, 8)}
          </span>
        </div>
      </div>

      <div className="flex items-center gap-3 sm:gap-8 font-mono shrink-0">
        <div className="hidden sm:block text-right">
          <span className="text-xs font-semibold text-emerald-400">
            +${formatPrecisionAmount(u.lifetimeProfit, 8)}
          </span>
          <span className="text-[10px] text-zinc-500 block font-sans">Yield</span>
        </div>
        <div className="text-right">
          <span className="text-xs sm:text-sm font-bold text-white">
            ${formatPrecisionAmount(u.balance, 8)}
          </span>
          <span className="text-[10px] text-zinc-500 block font-sans">USD</span>
        </div>
        <div className="w-14 sm:w-16 flex justify-end">
          {isMe ? (
            <span className="text-[11px] text-zinc-600 font-sans italic py-1 select-none">
              Self
            </span>
          ) : (
            <button
              onClick={(e)=> { e.stopPropagation(); onSelectPeerForChat(u.id); }}
              className="flex items-center gap-1 rounded-xl bg-zinc-800 hover:bg-amber-500 hover:text-zinc-950 px-2.5 py-1.5 text-xs text-zinc-200 transition font-medium active:scale-95 shadow-sm cursor-pointer"
              title={`Message User #${u.id}`}
            >
              <MessageSquare className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Chat</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
});

UserRow.displayName = 'UserRow';

export const LeaderboardView: FC<Props> = ({ currentUser: userProp, currentUserId, onSelectPeerForChat }) => {
  const [users, setUsers] = useState<User[]>(() => {
    const all = BoostPayStore.getUsers();
    return [...all].sort((a, b) => b.balance - a.balance || b.lifetimeProfit - a.lifetimeProfit);
  });

  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [listPage, setListPage] = useState(0); // sliding window of 10 rows
  const [selectedDetail, setSelectedDetail] = useState<any | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const prevRanksRef = useRef<Map<string, number>>(new Map());
  const [rankChanges, setRankChanges] = useState<Map<string, number>>(new Map());

  useEffect(() => {
    let active = true;

    // Lightweight /api/leaderboard endpoint (no secrets, no chat payload) — fast polling
    const poll = async () => {
      while (active) {
        const data = await BoostPayStore.fetchLeaderboard();
        if (!active) break;
        const sorted: User[] = (data.users || []).map((u: any) => ({
          ...u,
          boostState: {
            isActive: !!u.boostActive,
            isPaused: false,
            startedAt: 0,
            pausedAt: 0,
            elapsedMs: 0,
            targetDurationMs: Number(u.cycleDurationMs || 60000),
            startingBalance: u.balance,
            accumulatedYield: 0
          },
          // attach referral meta for UI
          _cycleDurationMs: Number(u.cycleDurationMs || 60000),
          _referralsCount: Number(u.referralsCount || 0),
          _referRate: Number(u.referRate || 0),
          _referLifetime: Number(u.referLifetime || 0)
        } as any));

        const newChanges = new Map<string, number>();
        sorted.forEach((u, newIdx) => {
          const oldRank = prevRanksRef.current.get(u.id);
          const newRank = newIdx + 1;
          const diff = oldRank !== undefined ? oldRank - newRank : 0;
          newChanges.set(u.id, diff);
          prevRanksRef.current.set(u.id, newRank);
        });

        setUsers((prevUsers) => {
          if (prevUsers.length !== sorted.length) return sorted;
          let changed = false;
          for (let i = 0; i < sorted.length; i++) {
            if (
              prevUsers[i].id !== sorted[i].id ||
              prevUsers[i].balance !== sorted[i].balance ||
              prevUsers[i].lifetimeProfit !== sorted[i].lifetimeProfit
            ) {
              changed = true;
              break;
            }
          }
          if (changed) {
            setRankChanges(newChanges);
            return sorted;
          }
          return prevUsers;
        });

        await new Promise(r => setTimeout(r, 5000));
      }
    };

    poll();
    return () => { active = false; };
  }, []);

  const effectiveUserId = userProp?.id || currentUserId || '';
  
  const myUser = useMemo(() => users.find(u => u.id === effectiveUserId) || userProp || {
    id: effectiveUserId,
    email: '',
    balance: 0,
    lifetimeProfit: 0,
    createdAt: Date.now(),
    boostState: {
      isActive: false,
      isPaused: false,
      startedAt: 0,
      pausedAt: 0,
      elapsedMs: 0,
      targetDurationMs: 60000,
      startingBalance: 0,
      accumulatedYield: 0
    }
  }, [users, effectiveUserId, userProp]);

  const copyId = async (id: string) => {
    const ok = await copyToClipboard(id);
    if (ok) {
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 2000);
    }
  };

  // Map of global ranks based on authoritative sorted list
  const globalRankMap = useMemo(() => {
    const map = new Map<string, number>();
    users.forEach((u, i) => map.set(u.id, i + 1));
    return map;
  }, [users]);

  const currentUserRank = useMemo(() => globalRankMap.get(effectiveUserId) || 0, [globalRankMap, effectiveUserId]);

  // Filtered users matching search query by name, email, or user ID
  const filteredUsers = useMemo(() => {
    const q = searchQuery.trim().toLowerCase().replace(/^#/, '');
    if (!q) return users;
    return users.filter(u => {
      const matchId = u.id.toLowerCase().includes(q);
      const matchEmail = (u.email || '').toLowerCase().includes(q);
      const matchName = (u as any).name ? String((u as any).name).toLowerCase().includes(q) : false;
      return matchId || matchEmail || matchName;
    });
  }, [users, searchQuery]);

  // Telegram-style paging: a moving window of 10 rows (previous 10 hide when loading next)
  const PAGE_SIZE = 10;
  const pagedUsers = useMemo(
    () => filteredUsers.slice(listPage * PAGE_SIZE, listPage * PAGE_SIZE + PAGE_SIZE),
    [filteredUsers, listPage]
  );
  const hasNextPage = (listPage + 1) * PAGE_SIZE < filteredUsers.length;

  // Reset to first page whenever the search filter changes
  useEffect(() => {
    setListPage(0);
  }, [searchQuery]);

  const getRankBadge = useMemo(() => (rank: number) => {
    if (rank === 1) {
      return (
        <span className="flex h-7 w-7 items-center justify-center rounded-xl bg-amber-500/20 text-amber-400 font-bold text-xs border border-amber-500/30 shrink-0">
          <Award className="w-4 h-4" />
        </span>
      );
    }
    if (rank === 2) {
      return (
        <span className="flex h-7 w-7 items-center justify-center rounded-xl bg-zinc-400/20 text-zinc-300 font-bold text-xs border border-zinc-400/30 shrink-0">
          2
        </span>
      );
    }
    if (rank === 3) {
      return (
        <span className="flex h-7 w-7 items-center justify-center rounded-xl bg-amber-700/20 text-amber-600 font-bold text-xs border border-amber-700/30 shrink-0">
          3
        </span>
      );
    }
    return (
      <span className="flex h-7 w-7 items-center justify-center rounded-xl bg-zinc-900 text-zinc-500 font-mono text-xs border border-zinc-800 shrink-0">
        {rank}
      </span>
    );
  }, []);

  return (
    <div className="w-full max-w-4xl mx-auto px-4 py-4 space-y-4 text-zinc-100">
      {/* 1. STICKY SEARCH BAR AT TOP OF LEADERBOARD VIEW */}
      <div className="sticky top-0 z-20 bg-zinc-950/95 backdrop-blur-md pt-1 pb-3 -mx-4 px-4 border-b border-zinc-800/80 shadow-md">
        <div className="relative flex items-center">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500 pointer-events-none" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search participants by ID (#1, 2)..."
            className="w-full h-11 rounded-2xl border border-zinc-800 bg-zinc-900/90 pl-10 pr-10 text-xs text-zinc-100 placeholder-zinc-500 focus:border-amber-500/80 focus:ring-1 focus:ring-amber-500/40 focus:outline-none font-mono transition"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-white p-1 rounded-lg hover:bg-zinc-800 transition cursor-pointer"
              title="Clear search"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        {searchQuery && (
          <div className="flex items-center justify-between mt-2 px-1 text-[11px] font-mono text-zinc-400">
            <span>Search results</span>
            <button
              onClick={() => setSearchQuery('')}
              className="text-amber-400 hover:underline cursor-pointer font-sans"
            >
              Clear filter
            </button>
          </div>
        )}
      </div>

      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-zinc-800 pb-3">
        <div>
          <h1 className="text-lg font-bold text-white flex items-center gap-2">
            <Trophy className="w-5 h-5 text-amber-400" /> Community Leaderboard
          </h1>
          <p className="text-xs text-zinc-400 mt-0.5">
            Real-time balance ranking & peer discovery
          </p>
        </div>
      </div>

      {/* Current User's Rank Spotlight Card — redesigned premium */}
      <div className="relative overflow-hidden rounded-[28px] border border-zinc-800 bg-zinc-900 shadow-2xl">
        <div className="pointer-events-none absolute -top-20 left-1/2 h-40 w-[120%] -translate-x-1/2 rounded-full bg-amber-500/[0.06] blur-3xl" />
        <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-amber-500/40 to-transparent" />
        <div className="relative p-5">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-amber-500 text-zinc-950 font-black text-lg shadow-lg shadow-amber-500/25 shrink-0">
                #{currentUserRank > 0 ? currentUserRank : '-'}
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-amber-400">Your Standing</span>
                </div>
                <div className="mt-1 flex items-center gap-2">
                  <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-2.5 py-1 text-xs font-mono font-bold text-amber-300">#{myUser.id}</span>
                  <span className="text-[11px] font-medium text-zinc-400">You</span>
                </div>
              </div>
            </div>
          </div>
          <div className="mt-4 grid grid-cols-2 gap-3">
            <div className="rounded-2xl border border-zinc-800 bg-zinc-950/70 p-3">
              <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" /> Balance
              </div>
              <div className="mt-1 font-mono text-sm font-bold text-white truncate">${formatPrecisionAmount(myUser.balance, 8)}</div>
              <div className="text-[10px] font-mono text-zinc-500">USD</div>
            </div>
            <div className="rounded-2xl border border-amber-500/20 bg-amber-500/5 p-3">
              <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-amber-400/80">
                <Sparkles className="w-3 h-3 text-amber-400" /> Profit
              </div>
              <div className="mt-1 font-mono text-sm font-bold text-emerald-400 truncate">+${formatPrecisionAmount(myUser.lifetimeProfit, 8)}</div>
              <div className="text-[10px] font-mono text-zinc-500">Lifetime</div>
            </div>
          </div>
        </div>
      </div>

      {/* Safety Advisory Banner */}
      <div className="rounded-2xl border border-zinc-800 bg-zinc-950/80 px-3.5 py-2.5 flex items-center gap-2.5 text-xs text-zinc-400">
        <ShieldAlert className="w-4 h-4 text-amber-400 shrink-0" />
        <p className="leading-relaxed text-[11px]">
          Be mindful when communicating with peers. Never share your recovery credentials or passwords with anyone.
        </p>
      </div>

      {/* Leaderboard List */}
      <div className="rounded-3xl border border-zinc-800 bg-zinc-900/90 p-4 sm:p-5 shadow-xl">
        <div className="flex items-center justify-between mb-3 text-xs text-zinc-400 font-medium">
          <span>Rank & User ID</span>
          <div className="flex items-center gap-4 sm:gap-8">
            <span className="hidden sm:inline">Lifetime Profit</span>
            <span>Balance</span>
            <span className="w-14 sm:w-16 text-right">Action</span>
          </div>
        </div>

        <div className="space-y-2.5">
          {pagedUsers.length > 0 ? (
            pagedUsers.map((u, idx) => (
              <UserRow
                key={u.id}
                u={u}
                rank={globalRankMap.get(u.id) || (idx + 1)}
                isMe={u.id === effectiveUserId}
                rankChanges={rankChanges}
                onSelectPeerForChat={onSelectPeerForChat}
                copyId={copyId}
                copiedId={copiedId}
                getRankBadge={getRankBadge}
                onOpenDetail={async (id:string)=>{
                  setDetailLoading(true);
                  setSelectedDetail({ id, ...(users.find(x=> x.id===id) as any) });
                  const d = await BoostPayStore.getLeaderboardUserDetail(id);
                  if (d) setSelectedDetail(d);
                  setDetailLoading(false);
                }}
              />
            ))
          ) : (
            <div className="py-12 flex flex-col items-center justify-center text-center p-6 border border-dashed border-zinc-800 rounded-2xl">
              <div className="h-10 w-10 rounded-2xl bg-zinc-800/80 flex items-center justify-center text-zinc-500 mb-2">
                <Search className="w-5 h-5" />
              </div>
              <h4 className="text-xs font-bold text-zinc-300">No participants found</h4>
              <p className="text-[11px] text-zinc-500 mt-1 max-w-xs">
                No users match &ldquo;{searchQuery}&rdquo;. Try searching by User ID (e.g. #1).
              </p>
              <button
                onClick={() => setSearchQuery('')}
                className="mt-3 text-xs text-amber-400 hover:underline font-mono cursor-pointer"
              >
                Clear filter
              </button>
            </div>
          )}
        </div>

        {/* Detail modal for refer + cycle */}
        {selectedDetail && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-zinc-950/80 backdrop-blur-md" onClick={()=> setSelectedDetail(null)}>
            <div onClick={(e)=> e.stopPropagation()} className="w-full max-w-md rounded-3xl border border-zinc-800 bg-zinc-900 p-5 shadow-2xl space-y-3 max-h-[80vh] overflow-y-auto">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-bold text-white">User #{selectedDetail.user?.id || selectedDetail.id} — Full Details</h3>
                <button onClick={()=> setSelectedDetail(null)} className="rounded-xl border border-zinc-800 bg-zinc-950 p-1.5 text-zinc-400 hover:text-white cursor-pointer"><X className="w-4 h-4"/></button>
              </div>
              {detailLoading ? <p className="text-xs text-zinc-500">Loading...</p> : (
                <>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="rounded-2xl border border-zinc-800 bg-zinc-950 p-3">
                      <div className="text-[10px] uppercase tracking-wider text-zinc-500 font-semibold">Cycle Duration</div>
                      <div className="font-mono text-sm font-bold text-amber-400">{formatDuration(Number(selectedDetail.user?.cycleDurationMs || selectedDetail.cycleDurationMs || 0))}</div>
                    </div>
                    <div className="rounded-2xl border border-amber-500/20 bg-amber-500/10 p-3">
                      <div className="text-[10px] uppercase tracking-wider text-amber-400 font-semibold">Refer Count</div>
                      <div className="font-mono text-sm font-bold text-white">{selectedDetail.referralsCount ?? selectedDetail._referralsCount ?? 0} users</div>
                    </div>
                    <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/10 p-3">
                      <div className="text-[10px] uppercase tracking-wider text-emerald-400 font-semibold">Current Rate</div>
                      <div className="font-mono text-sm font-bold text-emerald-400">{selectedDetail.rate ?? selectedDetail._referRate ?? 0}% (1-10% daily)</div>
                    </div>
                    <div className="rounded-2xl border border-zinc-800 bg-zinc-900 p-3">
                      <div className="text-[10px] uppercase tracking-wider text-zinc-500 font-semibold">Lifetime Referral Earned</div>
                      <div className="font-mono text-sm font-bold text-white">+${formatPrecisionAmount(Number(selectedDetail.lifetime ?? selectedDetail._referLifetime ?? 0),8)}</div>
                    </div>
                  </div>
                  <div className="rounded-2xl border border-zinc-800 bg-zinc-950 p-3">
                    <div className="text-[11px] font-semibold text-zinc-400">Balance & Profit</div>
                    <div className="font-mono text-xs text-white">Balance: ${formatPrecisionAmount(Number(selectedDetail.user?.balance ?? 0),8)} • Profit: +${formatPrecisionAmount(Number(selectedDetail.user?.lifetimeProfit ?? 0),8)}</div>
                  </div>
                  {selectedDetail.recentCommissions && selectedDetail.recentCommissions.length>0 && (
                    <div className="space-y-1.5">
                      <div className="text-[11px] font-bold text-zinc-300">Recent refer earnings</div>
                      {selectedDetail.recentCommissions.slice(0,5).map((c:any)=>(
                        <div key={c.id} className="flex justify-between rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-xs font-mono">
                          <span className="text-emerald-400">+${formatPrecisionAmount(c.amount,8)}</span>
                          <span className="text-zinc-500">{c.rate}% from #{c.referredId}</span>
                        </div>
                      ))}
                    </div>
                  )}
                  {selectedDetail.referrals && (
                    <div className="text-[10px] text-zinc-500">Daily joins this UTC cycle: {selectedDetail.dailyCount ?? '-'} — tier auto 1-10%.</div>
                  )}
                  <button onClick={()=> { setSelectedDetail(null); if (selectedDetail.user?.id) onSelectPeerForChat(String(selectedDetail.user.id)); }} className="w-full rounded-xl bg-amber-500 py-2.5 text-xs font-bold text-zinc-950 hover:bg-amber-400 cursor-pointer">Chat with #{selectedDetail.user?.id || selectedDetail.id}</button>
                </>
              )}
            </div>
          </div>
        )}

        {/* Sliding-window paging: Load More shows the NEXT 10 (current 10 hide) */}
        {filteredUsers.length > PAGE_SIZE && (
          <div className="flex items-center justify-between gap-2 pt-1">
            <button
              onClick={() => setListPage((p) => Math.max(0, p - 1))}
              disabled={listPage === 0}
              className={`flex-1 min-h-[44px] rounded-2xl border text-xs font-bold transition flex items-center justify-center gap-1.5 cursor-pointer ${
                listPage === 0
                  ? 'border-zinc-800 bg-zinc-950 text-zinc-600 cursor-not-allowed'
                  : 'border-zinc-700 bg-zinc-800/80 text-zinc-100 hover:bg-zinc-700 active:scale-[0.98]'
              }`}
            >
              <ChevronLeft className="w-4 h-4" />
              Load Previous
            </button>
            <button
              onClick={() => setListPage((p) => p + 1)}
              disabled={!hasNextPage}
              className={`flex-1 min-h-[44px] rounded-2xl border text-xs font-bold transition flex items-center justify-center gap-1.5 cursor-pointer ${
                !hasNextPage
                  ? 'border-zinc-800 bg-zinc-950 text-zinc-600 cursor-not-allowed'
                  : 'border-amber-500/40 bg-amber-500/15 text-amber-300 hover:bg-amber-500/25 active:scale-[0.98]'
              }`}
            >
              Load More
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
