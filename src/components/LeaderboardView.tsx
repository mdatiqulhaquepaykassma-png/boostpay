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
  X
} from 'lucide-react';
import { BoostPayStore, copyToClipboard } from '../services/store';
import { User } from '../types';
import { formatPrecisionAmount } from '../utils/format';

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

const UserRow = React.memo(({ u, rank, isMe, rankChanges, onSelectPeerForChat, copyId, copiedId, getRankBadge }: UserRowProps) => {
  const emailHandle = u.email ? (u.email.includes('@') ? u.email.split('@')[0] : u.email) : '';

  return (
    <div
      className={`flex items-center justify-between rounded-2xl border p-3.5 transition-all duration-300 ease-in-out ${
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
            {emailHandle && (
              <span className="text-[11px] text-zinc-400 font-sans truncate max-w-[100px] sm:max-w-[140px]" title={u.email}>
                {emailHandle}
              </span>
            )}
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
              onClick={() => copyId(u.id)}
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
              onClick={() => onSelectPeerForChat(u.id)}
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
            targetDurationMs: 60000,
            startingBalance: u.balance,
            accumulatedYield: 0
          }
        }));

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
            placeholder="Search participants by ID (#1, 2) or name / email..."
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
            <span>
              Showing <strong className="text-amber-400">{filteredUsers.length}</strong> of {users.length} participants
            </span>
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
        <div className="text-xs text-zinc-500 font-mono">
          Total Participants: <span className="text-white font-bold">{users.length}</span>
        </div>
      </div>

      {/* Current User's Rank Spotlight Card */}
      <div className="rounded-3xl border border-amber-500/30 bg-gradient-to-r from-amber-500/10 via-zinc-900/90 to-zinc-900/90 p-4 sm:p-5 shadow-xl">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 sm:h-12 sm:w-12 items-center justify-center rounded-2xl bg-amber-500 text-zinc-950 font-black text-base sm:text-lg shadow-lg shadow-amber-500/20 shrink-0">
              #{currentUserRank > 0 ? currentUserRank : '-'}
            </div>
            <div className="min-w-0">
              <span className="text-[11px] text-amber-400 font-mono uppercase tracking-wider block font-semibold">
                Your Current Standing
              </span>
              <div className="flex items-center gap-2 mt-0.5">
                <span className="text-sm font-bold text-white font-mono">#{myUser.id}</span>
                <span className="text-[11px] text-zinc-400">(You)</span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-6 self-start sm:self-center font-mono">
            <div>
              <span className="text-[10px] text-zinc-500 block font-sans">Balance</span>
              <span className="text-xs sm:text-sm font-bold text-white">${formatPrecisionAmount(myUser.balance, 8)}</span>
            </div>
            <div>
              <span className="text-[10px] text-zinc-500 block font-sans">Lifetime Profit</span>
              <span className="text-xs sm:text-sm font-bold text-emerald-400">+${formatPrecisionAmount(myUser.lifetimeProfit, 8)}</span>
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
          {filteredUsers.length > 0 ? (
            filteredUsers.map((u, idx) => (
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
              />
            ))
          ) : (
            <div className="py-12 flex flex-col items-center justify-center text-center p-6 border border-dashed border-zinc-800 rounded-2xl">
              <div className="h-10 w-10 rounded-2xl bg-zinc-800/80 flex items-center justify-center text-zinc-500 mb-2">
                <Search className="w-5 h-5" />
              </div>
              <h4 className="text-xs font-bold text-zinc-300">No participants found</h4>
              <p className="text-[11px] text-zinc-500 mt-1 max-w-xs">
                No users match &ldquo;{searchQuery}&rdquo;. Try searching by User ID (e.g. #1) or name/email.
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
      </div>
    </div>
  );
};
