import React, { FC, useState, useEffect, useRef, memo, useMemo } from 'react';
import { Trophy, MessageSquare, ShieldAlert, TrendingUp, Copy, Check, Sparkles, Award, ArrowUp, ArrowDown, Minus } from 'lucide-react';
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
  idx: number;
  isMe: boolean;
  rankChanges: Map<string, number>;
  onSelectPeerForChat: (peerId: string) => void;
  copyId: (id: string) => Promise<void>;
  copiedId: string | null;
  getRankBadge: (rank: number) => React.ReactNode;
}

const UserRow = React.memo(({ u, idx, isMe, rankChanges, onSelectPeerForChat, copyId, copiedId, getRankBadge }: UserRowProps) => {
  const rank = idx + 1;
  return (
    <div
      className={`flex items-center justify-between rounded-2xl border p-3.5 transition-all duration-500 ease-in-out ${
        isMe
          ? 'border-amber-500/40 bg-amber-500/5 shadow-lg shadow-amber-500/5'
          : 'border-zinc-800/80 bg-zinc-950/60 hover:border-zinc-700 hover:bg-zinc-950'
      }`}
    >
      <div className="flex items-center gap-3">
        {getRankBadge(rank)}
        <div>
          <div className="flex items-center gap-1.5 font-mono text-xs">
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
                  <span className="flex items-center text-[10px] bg-emerald-500/20 text-emerald-400 px-1.5 py-0.5 rounded-full font-mono font-bold animate-pulse">
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
              className="text-zinc-500 hover:text-zinc-300 p-0.5 transition"
              title="Copy User ID"
            >
              {copiedId === u.id ? (
                <Check className="w-3 h-3 text-emerald-400" />
              ) : (
                <Copy className="w-3 h-3" />
              )}
            </button>
          </div>
          <span className="text-[10px] text-zinc-500 font-mono sm:hidden">
            Profit: +${formatPrecisionAmount(u.lifetimeProfit, 8)}
          </span>
        </div>
      </div>
      <div className="flex items-center gap-4 sm:gap-8 font-mono">
        <div className="hidden sm:block text-right">
          <span className="text-xs font-semibold text-emerald-400">
            +${formatPrecisionAmount(u.lifetimeProfit, 8)}
          </span>
          <span className="text-[10px] text-zinc-500 block">Yield</span>
        </div>
        <div className="text-right">
          <span className="text-xs sm:text-sm font-bold text-white">
            ${formatPrecisionAmount(u.balance, 8)}
          </span>
          <span className="text-[10px] text-zinc-500 block font-sans">USD</span>
        </div>
        <div className="w-16 flex justify-end">
          {isMe ? (
            <span className="text-[11px] text-zinc-600 font-sans italic py-1 px-2 select-none">
              Self
            </span>
          ) : (
            <button
              onClick={() => onSelectPeerForChat(u.id)}
              className="flex items-center gap-1 rounded-xl bg-zinc-800 hover:bg-amber-500 hover:text-zinc-950 px-2.5 py-1.5 text-xs text-zinc-200 transition font-medium active:scale-95 shadow-sm"
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

export const LeaderboardView: FC<Props> = ({ currentUser: userProp, currentUserId, onSelectPeerForChat }) => {
  const [users, setUsers] = useState<User[]>(() => {
    const all = BoostPayStore.getUsers();
    return [...all].sort((a, b) => b.balance - a.balance || b.lifetimeProfit - a.lifetimeProfit);
  });

  const [copiedId, setCopiedId] = useState<string | null>(null);

  const prevRanksRef = useRef<Map<string, number>>(new Map());
  const [rankChanges, setRankChanges] = useState<Map<string, number>>(new Map());

  useEffect(() => {
    let active = true;

    const poll = async () => {
      while (active) {
        const all = await BoostPayStore.syncAllUsers();
        const sorted = [...all].sort((a, b) => b.balance - a.balance || b.lifetimeProfit - a.lifetimeProfit);
        
        const newChanges = new Map<string, number>();
        sorted.forEach((u, newIdx) => {
          const oldRank = prevRanksRef.current.get(u.id);
          const newRank = newIdx + 1;
          if (oldRank !== undefined) {
            newChanges.set(u.id, oldRank - newRank); // positive = moved up, negative = moved down
          } else {
            newChanges.set(u.id, 0);
          }
          prevRanksRef.current.set(u.id, newRank);
        });

        setRankChanges(newChanges);
        setUsers(sorted);
        
        await new Promise(r => setTimeout(r, 500));
      }
    };

    poll();
    return () => { active = false; };
  }, []);

  const effectiveUserId = userProp?.id || currentUserId || '';
  
  const myUser = useMemo(() => users.find(u => u.id === effectiveUserId) || userProp || {
    id: effectiveUserId,
    balance: 0,
    lifetimeProfit: 0
  }, [users, effectiveUserId, userProp]);

  const copyId = async (id: string) => {
    const ok = await copyToClipboard(id);
    if (ok) {
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 2000);
    }
  };

  const currentUserRank = useMemo(() => users.findIndex(u => u.id === effectiveUserId) + 1, [users, effectiveUserId]);

  const getRankBadge = useMemo(() => (rank: number) => {
    if (rank === 1) {
      return (
        <span className="flex h-7 w-7 items-center justify-center rounded-xl bg-amber-500/20 text-amber-400 font-bold text-xs border border-amber-500/30">
          <Award className="w-4 h-4" />
        </span>
      );
    }
    if (rank === 2) {
      return (
        <span className="flex h-7 w-7 items-center justify-center rounded-xl bg-zinc-400/20 text-zinc-300 font-bold text-xs border border-zinc-400/30">
          2
        </span>
      );
    }
    if (rank === 3) {
      return (
        <span className="flex h-7 w-7 items-center justify-center rounded-xl bg-amber-700/20 text-amber-600 font-bold text-xs border border-amber-700/30">
          3
        </span>
      );
    }
    return (
      <span className="flex h-7 w-7 items-center justify-center rounded-xl bg-zinc-900 text-zinc-500 font-mono text-xs border border-zinc-800">
        {rank}
      </span>
    );
  }, []);

  return (
    <div className="w-full max-w-4xl mx-auto px-4 py-6 space-y-5 text-zinc-100">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-zinc-800 pb-4">
        <div>
          <h1 className="text-xl font-bold text-white flex items-center gap-2">
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
      <div className="rounded-3xl border border-amber-500/30 bg-gradient-to-r from-amber-500/10 via-zinc-900/90 to-zinc-900/90 p-5 shadow-xl">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-amber-500 text-zinc-950 font-black text-lg shadow-lg shadow-amber-500/20">
              #{currentUserRank > 0 ? currentUserRank : '-'}
            </div>
            <div>
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
              <span className="text-[10px] text-zinc-500 block">Balance</span>
              <span className="text-sm font-bold text-white">${formatPrecisionAmount(myUser.balance, 8)}</span>
            </div>
            <div>
              <span className="text-[10px] text-zinc-500 block">Lifetime Profit</span>
              <span className="text-sm font-bold text-emerald-400">+${formatPrecisionAmount(myUser.lifetimeProfit, 8)}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Safety Advisory Banner */}
      <div className="rounded-2xl border border-zinc-800 bg-zinc-950/80 px-4 py-3 flex items-center gap-3 text-xs text-zinc-400">
        <ShieldAlert className="w-4 h-4 text-amber-400 shrink-0" />
        <p className="leading-relaxed">
          Be mindful when communicating with peers. Never share your 12-word recovery seed phrase or account passwords with anyone.
        </p>
      </div>

      {/* Leaderboard List */}
      <div className="rounded-3xl border border-zinc-800 bg-zinc-900/90 p-5 shadow-xl">
        <div className="flex items-center justify-between mb-4 text-xs text-zinc-400 font-medium">
          <span>Rank & User ID</span>
          <div className="flex items-center gap-8">
            <span className="hidden sm:inline">Lifetime Profit</span>
            <span>Balance</span>
            <span className="w-16 text-right">Action</span>
          </div>
        </div>

        <div className="space-y-2.5">
          {users.map((u, idx) => (
            <UserRow
              key={u.id}
              u={u}
              idx={idx}
              isMe={u.id === effectiveUserId}
              rankChanges={rankChanges}
              onSelectPeerForChat={onSelectPeerForChat}
              copyId={copyId}
              copiedId={copiedId}
              getRankBadge={getRankBadge}
            />
          ))}
        </div>
      </div>
    </div>
  );
};
