import React, { FC, useState, useEffect, useMemo, memo } from 'react';
import {
  ArrowUpRight,
  ArrowDownLeft,
  Zap,
  ShieldAlert,
  Search,
  ChevronLeft,
  ChevronRight,
  Copy,
  Check,
  X,
  Clock,
  Filter,
  ArrowUpDown
} from 'lucide-react';
import { Transaction } from '../types';
import { BoostPayStore, copyToClipboard } from '../services/store';
import { formatPrecisionAmount } from '../utils/format';

interface Props {
  transactions: Transaction[];
  userId: string;
}

export const PaginatedTransactionsView: FC<Props> = memo(({ transactions: initialTransactions, userId }) => {
  const [liveTransactions, setLiveTransactions] = useState<Transaction[]>(() => {
    return initialTransactions && initialTransactions.length > 0
      ? initialTransactions
      : BoostPayStore.getTransactions();
  });

  useEffect(() => {
    if (initialTransactions && initialTransactions.length > 0) {
      setLiveTransactions(initialTransactions);
    }
  }, [initialTransactions]);

  useEffect(() => {
    const interval = setInterval(() => {
      const fresh = BoostPayStore.getTransactions();
      setLiveTransactions((prev) => {
        if (prev.length !== fresh.length) return fresh;
        if (fresh[0] && prev[0] && (fresh[0].id !== prev[0].id || fresh[0].amount !== prev[0].amount)) return fresh;
        return prev;
      });
    }, 2000);
    return () => clearInterval(interval);
  }, []);

  const [filterType, setFilterType] = useState<'ALL' | 'P2P' | 'YIELD' | 'REFERRAL' | 'ADMIN'>('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [selectedTx, setSelectedTx] = useState<Transaction | null>(null);
  const [copiedTxId, setCopiedTxId] = useState<string | null>(null);

  const pageSize = 8;

  // FIX: show ALL transaction types including REWARD — user complained only REWARD shown in recent, but paginated hid REWARD
  const userTransactions = useMemo(() => {
    return liveTransactions
      .filter((t) => t.userId === userId)
      .sort((a, b) => b.timestamp - a.timestamp);
  }, [liveTransactions, userId]);

  // Counts for tabs
  const counts = useMemo(() => {
    return {
      all: userTransactions.length,
      p2p: userTransactions.filter((t) => t.type === 'TRANSFER_SENT' || t.type === 'TRANSFER_RECEIVED').length,
      yield: userTransactions.filter((t) => String(t.type).includes('REWARD')).length,
      referral: userTransactions.filter((t) => String(t.type).includes('REFERRAL')).length,
      admin: userTransactions.filter((t) => t.type === 'ADMIN_CREDIT' || t.type === 'ADMIN_DEBIT').length
    };
  }, [userTransactions]);

  // Volume sums
  const volumes = useMemo(() => {
    let inflow = 0;
    let outflow = 0;
    userTransactions.forEach((t) => {
      if (t.type === 'REWARD' || t.type === 'TRANSFER_RECEIVED' || t.type === 'ADMIN_CREDIT' || t.type === 'AGENT_TRANSFER_RECEIVED') {
        inflow += Number(t.amount) || 0;
      } else if (t.type === 'TRANSFER_SENT' || t.type === 'ADMIN_DEBIT' || t.type === 'AGENT_TRANSFER_SENT') {
        outflow += Number(t.amount) || 0;
      }
    });
    return { inflow, outflow };
  }, [userTransactions]);

  // Filtered transactions
  const filteredList = useMemo(() => {
    return userTransactions.filter((t) => {
      // 1. Type filter
      if (filterType === 'P2P' && !(t.type === 'TRANSFER_SENT' || t.type === 'TRANSFER_RECEIVED')) {
        return false;
      }
      if (filterType === 'YIELD' && !String(t.type).includes('REWARD')) {
        return false;
      }
      if (filterType === 'REFERRAL' && !String(t.type).includes('REFERRAL')) {
        return false;
      }
      if (filterType === 'ADMIN' && !(t.type === 'ADMIN_CREDIT' || t.type === 'ADMIN_DEBIT')) {
        return false;
      }

      // 2. Search query
      if (searchQuery.trim()) {
        const query = searchQuery.trim().toLowerCase();
        const matchesId = t.id.toLowerCase().includes(query);
        const matchesNotes = (t.notes || '').toLowerCase().includes(query);
        const matchesSender = (t.senderId || '').toLowerCase().includes(query);
        const matchesRecipient = (t.recipientId || '').toLowerCase().includes(query);
        const matchesType = t.type.toLowerCase().includes(query);
        return matchesId || matchesNotes || matchesSender || matchesRecipient || matchesType;
      }

      return true;
    });
  }, [userTransactions, filterType, searchQuery]);

  // Pagination calculation
  const totalPages = Math.max(1, Math.ceil(filteredList.length / pageSize));
  const effectivePage = Math.min(currentPage, totalPages);
  const startIndex = (effectivePage - 1) * pageSize;
  const paginatedList = filteredList.slice(startIndex, startIndex + pageSize);

  const handleCopyId = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const ok = await copyToClipboard(id);
    if (ok) {
      setCopiedTxId(id);
      setTimeout(() => setCopiedTxId(null), 2000);
    }
  };

  const getTxConfig = (tx: Transaction) => {
    switch (tx.type) {
      case 'REFERRAL_COMMISSION':
        return {
          label: `Refer from #${(tx as any).metadata?.referredId || (tx as any).senderId || 'Peer'} ${(tx as any).metadata?.rate ? `(${ (tx as any).metadata.rate }%)` : ''}`.trim(),
          badge: 'Refer Bonus',
          icon: Zap,
          iconBg: 'bg-amber-500/15 border-amber-500/30 text-amber-400',
          amountSign: '+',
          amountColor: 'text-amber-400'
        };
      case 'REWARD':
        return {
          label: 'Boosting Yield',
          badge: 'Yield Reward',
          icon: Zap,
          iconBg: 'bg-amber-500/15 border-amber-500/30 text-amber-400',
          amountSign: '+',
          amountColor: 'text-amber-400'
        };
      case 'TRANSFER_SENT':
        return {
          label: `Sent to #${tx.recipientId || 'Peer'}`,
          badge: 'P2P Sent',
          icon: ArrowUpRight,
          iconBg: 'bg-rose-500/15 border-rose-500/30 text-rose-400',
          amountSign: '-',
          amountColor: 'text-rose-400'
        };
      case 'TRANSFER_RECEIVED':
        return {
          label: `Received from #${tx.senderId || 'Peer'}`,
          badge: 'P2P Received',
          icon: ArrowDownLeft,
          iconBg: 'bg-emerald-500/15 border-emerald-500/30 text-emerald-400',
          amountSign: '+',
          amountColor: 'text-emerald-400'
        };
      case 'ADMIN_CREDIT':
        return {
          label: 'Treasury Deposit',
          badge: 'Admin Credit',
          icon: Zap,
          iconBg: 'bg-sky-500/15 border-sky-500/30 text-sky-400',
          amountSign: '+',
          amountColor: 'text-sky-400'
        };
      case 'ADMIN_DEBIT':
        return {
          label: 'Treasury Deduction',
          badge: 'Admin Debit',
          icon: ShieldAlert,
          iconBg: 'bg-red-500/15 border-red-500/30 text-red-400',
          amountSign: '-',
          amountColor: 'text-red-400'
        };
      default:
        return {
          label: 'Transaction',
          badge: 'Activity',
          icon: Clock,
          iconBg: 'bg-zinc-800 border-zinc-700 text-zinc-300',
          amountSign: '',
          amountColor: 'text-zinc-200'
        };
    }
  };

  return (
    <div className="space-y-4">
      {/* Overview Inflow / Outflow Summary Banner */}
      <div className="grid grid-cols-2 gap-2.5">
        <div className="rounded-2xl border border-emerald-500/20 bg-emerald-950/20 p-3.5 flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-500/20 text-emerald-400">
            <ArrowDownLeft className="w-5 h-5" />
          </div>
          <div>
            <span className="text-[10px] text-zinc-400 uppercase font-mono block">Total Received</span>
            <span className="text-sm font-bold text-emerald-400 font-mono">
              +${formatPrecisionAmount(volumes.inflow, 2)}
            </span>
          </div>
        </div>

        <div className="rounded-2xl border border-rose-500/20 bg-rose-950/20 p-3.5 flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-rose-500/20 text-rose-400">
            <ArrowUpRight className="w-5 h-5" />
          </div>
          <div>
            <span className="text-[10px] text-zinc-400 uppercase font-mono block">Total Sent</span>
            <span className="text-sm font-bold text-rose-400 font-mono">
              -${formatPrecisionAmount(volumes.outflow, 2)}
            </span>
          </div>
        </div>
      </div>

      {/* Main Container Card */}
      <div className="rounded-3xl border border-zinc-800 bg-zinc-900/90 p-4 shadow-xl space-y-3.5">
        {/* Section Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Clock className="w-4 h-4 text-amber-400" />
            <h3 className="font-bold text-sm text-white">Transaction History</h3>
          </div>
          <span className="text-xs font-mono text-zinc-400">
            {filteredList.length} {filteredList.length === 1 ? 'record' : 'records'}
          </span>
        </div>

        {/* Filter Tabs — now includes YIELD + REFERRAL per recent fix */}
        <div className="grid grid-cols-5 gap-1 p-1 bg-zinc-950 rounded-2xl border border-zinc-800/80">
          <button
            onClick={() => { setFilterType('ALL'); setCurrentPage(1); }}
            className={`py-2 px-1 text-[11px] font-semibold rounded-xl transition cursor-pointer text-center truncate ${
              filterType === 'ALL'
                ? 'bg-zinc-800 text-amber-400 font-bold shadow-sm'
                : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            All ({counts.all})
          </button>
          <button
            onClick={() => { setFilterType('P2P'); setCurrentPage(1); }}
            className={`py-2 px-1 text-[11px] font-semibold rounded-xl transition cursor-pointer text-center truncate ${
              filterType === 'P2P'
                ? 'bg-zinc-800 text-amber-400 font-bold shadow-sm'
                : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            P2P ({counts.p2p})
          </button>
          <button
            onClick={() => { setFilterType('YIELD'); setCurrentPage(1); }}
            className={`py-2 px-1 text-[11px] font-semibold rounded-xl transition cursor-pointer text-center truncate ${
              filterType === 'YIELD'
                ? 'bg-zinc-800 text-amber-400 font-bold shadow-sm'
                : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            Yield ({counts.yield})
          </button>
          <button
            onClick={() => { setFilterType('REFERRAL'); setCurrentPage(1); }}
            className={`py-2 px-1 text-[11px] font-semibold rounded-xl transition cursor-pointer text-center truncate ${
              filterType === 'REFERRAL'
                ? 'bg-zinc-800 text-amber-400 font-bold shadow-sm'
                : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            Refer ({counts.referral})
          </button>
          <button
            onClick={() => { setFilterType('ADMIN'); setCurrentPage(1); }}
            className={`py-2 px-1 text-[11px] font-semibold rounded-xl transition cursor-pointer text-center truncate ${
              filterType === 'ADMIN'
                ? 'bg-zinc-800 text-amber-400 font-bold shadow-sm'
                : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            Admin ({counts.admin})
          </button>
        </div>

        {/* Search Bar */}
        <div className="relative">
          <Search className="absolute left-3.5 top-3 w-3.5 h-3.5 text-zinc-500" />
          <input
            type="text"
            placeholder="Search by Ref ID (TX-...), Peer #, or note..."
            value={searchQuery}
            onChange={(e) => { setSearchQuery(e.target.value); setCurrentPage(1); }}
            className="w-full h-10 rounded-xl border border-zinc-800 bg-zinc-950 pl-9 pr-8 text-xs text-zinc-200 placeholder-zinc-500 focus:border-amber-500 focus:outline-none font-mono"
          />
          {searchQuery && (
            <button
              onClick={() => { setSearchQuery(''); setCurrentPage(1); }}
              className="absolute right-2.5 top-2.5 text-zinc-400 hover:text-zinc-200 p-0.5 cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* Scrollable Paginated Transactions List */}
        <div className="space-y-2 min-h-[300px] max-h-[500px] overflow-y-auto pr-1">
          {paginatedList.length > 0 ? (
            paginatedList.map((tx) => {
              const cfg = getTxConfig(tx);
              const Icon = cfg.icon;
              return (
                <div
                  key={tx.id}
                  onClick={() => setSelectedTx(tx)}
                  className="w-full flex items-center justify-between rounded-2xl border border-zinc-800/80 bg-zinc-950/70 p-3 hover:border-zinc-700 hover:bg-zinc-950 transition cursor-pointer group"
                >
                  <div className="flex items-center gap-3 min-w-0 pr-2">
                    <div className={`h-10 w-10 rounded-xl flex items-center justify-center shrink-0 border ${cfg.iconBg}`}>
                      <Icon className="w-5 h-5 stroke-[2.2]" />
                    </div>

                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="text-xs font-semibold text-zinc-100 truncate">
                          {cfg.label}
                        </span>
                        <span className="text-[10px] px-1.5 py-0.2 rounded font-mono bg-zinc-800 text-zinc-400">
                          {cfg.badge}
                        </span>
                      </div>

                      <div className="flex items-center gap-2 mt-0.5 text-[10px] text-zinc-500 font-mono">
                        <span className="truncate">{new Date(tx.timestamp).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
                        <span>·</span>
                        <span className="text-zinc-400 truncate">{tx.id}</span>
                        <button
                          onClick={(e) => handleCopyId(tx.id, e)}
                          className="hover:text-amber-400 p-0.5"
                          title="Copy TX ID"
                        >
                          {copiedTxId === tx.id ? (
                            <Check className="w-3 h-3 text-emerald-400" />
                          ) : (
                            <Copy className="w-3 h-3" />
                          )}
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* Formatted Amount */}
                  <div className="text-right shrink-0 font-mono">
                    <span className={`text-xs sm:text-sm font-bold ${cfg.amountColor}`}>
                      {cfg.amountSign}${formatPrecisionAmount(tx.amount, 8)}
                    </span>
                    <span className="text-[9px] text-zinc-500 block font-sans">USD</span>
                  </div>
                </div>
              );
            })
          ) : (
            <div className="h-56 flex flex-col items-center justify-center text-center p-6 border border-dashed border-zinc-800 rounded-2xl">
              <div className="h-10 w-10 rounded-2xl bg-zinc-800/80 flex items-center justify-center text-zinc-500 mb-2">
                <Clock className="w-5 h-5" />
              </div>
              <h4 className="text-xs font-bold text-zinc-300">No transactions found</h4>
              <p className="text-[11px] text-zinc-500 mt-1 max-w-xs">
                {searchQuery
                  ? `No transactions matching "${searchQuery}".`
                  : 'Your transfers and boosting yields will appear here.'}
              </p>
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery('')}
                  className="mt-3 text-xs text-amber-400 hover:underline font-mono cursor-pointer"
                >
                  Clear search
                </button>
              )}
            </div>
          )}
        </div>

        {/* Pagination Navigation Footer */}
        {filteredList.length > 0 && (
          <div className="pt-2 border-t border-zinc-800/80 flex items-center justify-between text-xs text-zinc-400 font-mono">
            <span>
              Showing {startIndex + 1}–{Math.min(startIndex + pageSize, filteredList.length)} of {filteredList.length}
            </span>

            <div className="flex items-center gap-1.5">
              <button
                onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                disabled={effectivePage <= 1}
                className="h-9 px-3 rounded-xl border border-zinc-800 bg-zinc-950 text-zinc-300 hover:bg-zinc-800 hover:text-white disabled:opacity-30 disabled:hover:bg-zinc-950 disabled:hover:text-zinc-300 transition flex items-center gap-1 cursor-pointer font-sans text-xs"
              >
                <ChevronLeft className="w-4 h-4" />
                <span>Prev</span>
              </button>

              <span className="px-2 font-bold text-white">
                {effectivePage}/{totalPages}
              </span>

              <button
                onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                disabled={effectivePage >= totalPages}
                className="h-9 px-3 rounded-xl border border-zinc-800 bg-zinc-950 text-zinc-300 hover:bg-zinc-800 hover:text-white disabled:opacity-30 disabled:hover:bg-zinc-950 disabled:hover:text-zinc-300 transition flex items-center gap-1 cursor-pointer font-sans text-xs"
              >
                <span>Next</span>
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Transaction Details Modal */}
      {selectedTx && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md p-4 animate-in fade-in duration-150">
          <div className="relative w-full max-w-sm rounded-3xl border border-zinc-800 bg-zinc-900/95 p-6 shadow-2xl text-zinc-100">
            <div className="flex items-center justify-between pb-3 border-b border-zinc-800">
              <h3 className="font-bold text-sm text-white flex items-center gap-2">
                <Clock className="w-4 h-4 text-amber-400" /> Transaction Details
              </h3>
              <button
                onClick={() => setSelectedTx(null)}
                className="text-zinc-400 hover:text-white p-1 rounded-lg hover:bg-zinc-800 transition cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="mt-4 space-y-2.5 text-xs font-mono">
              <div className="flex justify-between py-1 border-b border-zinc-800/60">
                <span className="text-zinc-500">Amount:</span>
                <span className={`text-base font-bold ${getTxConfig(selectedTx).amountColor}`}>
                  {getTxConfig(selectedTx).amountSign}${formatPrecisionAmount(selectedTx.amount, 8)} USD
                </span>
              </div>
              <div className="flex justify-between py-1 border-b border-zinc-800/60 items-center">
                <span className="text-zinc-500">Transaction ID:</span>
                <button
                  onClick={(e) => handleCopyId(selectedTx.id, e)}
                  className="flex items-center gap-1 text-zinc-200 hover:text-white cursor-pointer"
                >
                  <span>{selectedTx.id}</span>
                  {copiedTxId === selectedTx.id ? (
                    <Check className="w-3 h-3 text-emerald-400" />
                  ) : (
                    <Copy className="w-3 h-3 text-zinc-500" />
                  )}
                </button>
              </div>
              <div className="flex justify-between py-1 border-b border-zinc-800/60">
                <span className="text-zinc-500">Type:</span>
                <span className="text-amber-400 font-bold">{selectedTx.type}</span>
              </div>
              <div className="flex justify-between py-1 border-b border-zinc-800/60">
                <span className="text-zinc-500">Timestamp:</span>
                <span className="text-zinc-200">{new Date(selectedTx.timestamp).toLocaleString()}</span>
              </div>
              {(selectedTx as any).boostStartAt && (
                <div className="flex justify-between py-1 border-b border-zinc-800/60">
                  <span className="text-zinc-500">Boost Start:</span>
                  <span className="text-emerald-300">{new Date((selectedTx as any).boostStartAt).toLocaleString()}</span>
                </div>
              )}
              {(selectedTx as any).boostEndAt && (
                <div className="flex justify-between py-1 border-b border-zinc-800/60">
                  <span className="text-zinc-500">Boost End:</span>
                  <span className="text-amber-300">{new Date((selectedTx as any).boostEndAt).toLocaleString()}</span>
                </div>
              )}
              {(selectedTx as any).boostDurationMs && (
                <div className="flex justify-between py-1 border-b border-zinc-800/60">
                  <span className="text-zinc-500">Duration:</span>
                  <span className="text-zinc-200">{Math.round(Number((selectedTx as any).boostDurationMs)/1000)}s ({(Number((selectedTx as any).boostDurationMs)/60000).toFixed(1)} min)</span>
                </div>
              )}
              {selectedTx.type === "REWARD" && !(selectedTx as any).boostStartAt && (
                <div className="flex justify-between py-1 border-b border-zinc-800/40 opacity-60">
                  <span className="text-zinc-500">Boost Start:</span>
                  <span className="text-zinc-400 text-xs">Legacy record — start time not stored (created before 21 Oct 2026)</span>
                </div>
              )}
              {selectedTx.type === "REWARD" && !(selectedTx as any).boostEndAt && (
                <div className="flex justify-between py-1 border-b border-zinc-800/40 opacity-60">
                  <span className="text-zinc-500">Boost End:</span>
                  <span className="text-zinc-400">{new Date(selectedTx.timestamp).toLocaleString()} (credited at)</span>
                </div>
              )}
              {selectedTx.recipientId && (
                <div className="flex justify-between py-1 border-b border-zinc-800/60">
                  <span className="text-zinc-500">Recipient ID:</span>
                  <span className="text-zinc-200">#{selectedTx.recipientId}</span>
                </div>
              )}
              {selectedTx.senderId && (
                <div className="flex justify-between py-1 border-b border-zinc-800/60">
                  <span className="text-zinc-500">Sender ID:</span>
                  <span className="text-zinc-200">#{selectedTx.senderId}</span>
                </div>
              )}
              {selectedTx.notes && (
                <div className="py-1">
                  <span className="text-zinc-500 block mb-1">Notes:</span>
                  <p className="rounded-xl bg-zinc-950 p-2 text-zinc-300 font-sans text-xs border border-zinc-800">
                    {selectedTx.notes}
                  </p>
                </div>
              )}
            </div>

            <div className="mt-5">
              <button
                onClick={() => setSelectedTx(null)}
                className="w-full h-10 rounded-xl bg-zinc-800 text-xs font-semibold text-zinc-100 hover:bg-zinc-700 transition cursor-pointer"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
});

PaginatedTransactionsView.displayName = 'PaginatedTransactionsView';
