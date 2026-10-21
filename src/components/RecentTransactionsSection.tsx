import React, { FC, useState, useEffect, memo } from 'react';
import { ArrowUpRight, ArrowDownLeft, Zap, ShieldAlert, X, Clock, Copy, Check, ChevronDown } from 'lucide-react';
import { Transaction } from '../types';
import { BoostPayStore, copyToClipboard } from '../services/store';
import { formatPrecisionAmount } from '../utils/format';

interface Props {
  transactions: Transaction[];
  userId: string;
  onViewAllTransactions?: () => void;
}

type FilterTab = 'ALL' | 'REWARD' | 'P2P' | 'REFERRAL';

export const RecentTransactionsSection: FC<Props> = memo(({ transactions, userId, onViewAllTransactions }) => {
  const [selectedTx, setSelectedTx] = useState<Transaction | null>(null);
  const [copiedTx, setCopiedTx] = useState(false);
  const [currentPage, setCurrentPage] = useState(0);
  const pageSize = 5;
  const [filterTab, setFilterTab] = useState<FilterTab>('ALL');
  const [liveTransactions, setLiveTransactions] = useState<Transaction[]>(()=> transactions && transactions.length ? transactions : BoostPayStore.getTransactions());
  useEffect(()=>{ if (transactions && transactions.length) setLiveTransactions(transactions); }, [transactions]);
  useEffect(()=>{
    const id=setInterval(()=>{
      const fresh=BoostPayStore.getTransactions();
      setLiveTransactions(prev=>{
        if (prev.length!==fresh.length) return fresh;
        if (fresh[0] && prev[0] && (fresh[0].id!==prev[0].id || fresh[0].amount!==prev[0].amount)) return fresh;
        return prev;
      });
    },2000);
    return ()=>clearInterval(id);
  },[]);

  // FIX: only show transactions where userId matches — prevents sent+received duplicate for same transfer
  const userTxs = liveTransactions
    .filter(t => String((t as any).userId) === String(userId))
    .sort((a, b) => b.timestamp - a.timestamp);

  // counts for filter tabs
  const counts = {
    all: userTxs.length,
    reward: userTxs.filter(t => String(t.type).includes('REWARD')).length,
    p2p: userTxs.filter(t => t.type === 'TRANSFER_SENT' || t.type === 'TRANSFER_RECEIVED').length,
    referral: userTxs.filter(t => String(t.type).includes('REFERRAL')).length,
  };

  const filteredTxs = userTxs.filter(t => {
    if (filterTab === 'REWARD') return String(t.type).includes('REWARD');
    if (filterTab === 'P2P') return t.type === 'TRANSFER_SENT' || t.type === 'TRANSFER_RECEIVED';
    if (filterTab === 'REFERRAL') return String(t.type).includes('REFERRAL');
    return true;
  });

  const totalPages = Math.max(1, Math.ceil(filteredTxs.length / pageSize));
  const safePage = Math.min(currentPage, Math.max(0, totalPages-1));
  const start = safePage * pageSize;
  const displayedTxs = filteredTxs.slice(start, start+pageSize);

  const handleTab = (tab: FilterTab) => {
    setFilterTab(tab);
    setCurrentPage(0);
  };

  const getTxDetails = (tx: Transaction) => {
    if (String(tx.type).includes('REWARD')) {
      return {
        label: 'Boosting Reward',
        icon: Zap,
        color: 'text-amber-400 bg-amber-500/10 border-amber-500/20',
        amountSign: '+',
        amountColor: 'text-amber-400'
      };
    }
    switch (tx.type) {
      case 'REFERRAL_COMMISSION':
        return {
          label: `Refer from #${(tx as any).metadata?.referredId || tx.senderId || '—'} ${(tx as any).metadata?.rate ? `(${ (tx as any).metadata.rate }%)` : ''}`.trim(),
          icon: Zap,
          color: 'text-amber-400 bg-amber-500/10 border-amber-500/20',
          amountSign: '+',
          amountColor: 'text-amber-400'
        };
      case 'TRANSFER_SENT':
        return {
          label: `Sent to #${tx.recipientId}`,
          icon: ArrowUpRight,
          color: 'text-red-400 bg-red-500/10 border-red-500/20',
          amountSign: '-',
          amountColor: 'text-red-400'
        };
      case 'TRANSFER_RECEIVED':
        return {
          label: `Received from #${tx.senderId}`,
          icon: ArrowDownLeft,
          color: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20',
          amountSign: '+',
          amountColor: 'text-emerald-400'
        };
      case 'ADMIN_CREDIT':
        return {
          label: 'Admin Credit',
          icon: Zap,
          color: 'text-sky-400 bg-sky-500/10 border-sky-500/20',
          amountSign: '+',
          amountColor: 'text-sky-400'
        };
      case 'ADMIN_DEBIT':
        return {
          label: 'Admin Debit',
          icon: ShieldAlert,
          color: 'text-rose-400 bg-rose-500/10 border-rose-500/20',
          amountSign: '-',
          amountColor: 'text-rose-400'
        };
      default:
        if (String(tx.type).includes('REFERRAL')) return { label: `Refer ${String(tx.type)}`, icon: Zap, color: 'text-amber-400 bg-amber-500/10 border-amber-500/20', amountSign: '+', amountColor: 'text-amber-400' };
        if (String(tx.type).includes('TRANSFER')) return { label: String(tx.type), icon: Zap, color: 'text-sky-400 bg-sky-500/10 border-sky-500/20', amountSign: (tx as any).amount >0 ? '+' : '-', amountColor: 'text-sky-400' };
        return {
          label: String(tx.type || 'Transaction').replace(/_/g,' '),
          icon: Zap,
          color: 'text-zinc-300 bg-zinc-800 border-zinc-700',
          amountSign: (tx as any).amount >=0 ? '+' : '',
          amountColor: 'text-zinc-200'
        };
    }
  };

  return (
    <div className="rounded-2xl border border-zinc-800 bg-zinc-900/80 p-5 shadow-xl">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Clock className="w-4 h-4 text-zinc-400" />
          <h3 className="font-bold text-sm text-white">Recent Transactions</h3>
        </div>
        {onViewAllTransactions ? (
          <button
            onClick={onViewAllTransactions}
            className="text-xs text-amber-400 hover:text-amber-300 font-semibold flex items-center gap-1 cursor-pointer transition"
          >
            All History →
          </button>
        ) : (
          <span className="text-[11px] font-mono text-zinc-500">
            {filteredTxs.length===0 ? 'No records' : `${start+1}–${Math.min(start+pageSize, filteredTxs.length)} of ${filteredTxs.length}`}
          </span>
        )}
      </div>

      {/* Filter tabs — fix: user can now see P2P vs Reward separately instead of only Reward flooding */}
      <div className="grid grid-cols-4 gap-1 p-1 bg-zinc-950 rounded-2xl border border-zinc-800/80 mb-3">
        <button onClick={()=>handleTab('ALL')} className={`py-1.5 text-[10px] font-bold rounded-xl transition cursor-pointer truncate ${filterTab==='ALL'?'bg-zinc-800 text-amber-400':'text-zinc-400 hover:text-zinc-200'}`}>All ({counts.all})</button>
        <button onClick={()=>handleTab('REWARD')} className={`py-1.5 text-[10px] font-bold rounded-xl transition cursor-pointer truncate ${filterTab==='REWARD'?'bg-zinc-800 text-amber-400':'text-zinc-400 hover:text-zinc-200'}`}>Reward ({counts.reward})</button>
        <button onClick={()=>handleTab('P2P')} className={`py-1.5 text-[10px] font-bold rounded-xl transition cursor-pointer truncate ${filterTab==='P2P'?'bg-zinc-800 text-amber-400':'text-zinc-400 hover:text-zinc-200'}`}>P2P ({counts.p2p})</button>
        <button onClick={()=>handleTab('REFERRAL')} className={`py-1.5 text-[10px] font-bold rounded-xl transition cursor-pointer truncate ${filterTab==='REFERRAL'?'bg-zinc-800 text-amber-400':'text-zinc-400 hover:text-zinc-200'}`}>Refer ({counts.referral})</button>
      </div>

      <div className="space-y-2">
        {displayedTxs.map((tx) => {
          const detail = getTxDetails(tx);
          const Icon = detail.icon;

          return (
            <button
              key={tx.id}
              onClick={() => setSelectedTx(tx)}
              className="w-full flex items-center justify-between rounded-xl border border-zinc-800/80 bg-zinc-950/50 p-3 hover:border-zinc-700 hover:bg-zinc-950 transition text-left cursor-pointer"
            >
              <div className="flex items-center gap-3">
                <div className={`rounded-xl p-2 border ${detail.color}`}>
                  <Icon className="w-4 h-4" />
                </div>
                <div>
                  <div className="text-xs font-semibold text-zinc-200">{detail.label}</div>
                  <div className="text-[10px] font-mono text-zinc-500">
                    {new Date(tx.timestamp).toLocaleString([], {
                      month: 'short',
                      day: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit'
                    })}
                  </div>
                </div>
              </div>

              <div className="text-right">
                <div className={`text-xs font-bold font-mono ${detail.amountColor}`}>
                  {detail.amountSign}${formatPrecisionAmount(tx.amount, 8)}
                </div>
                <div className="text-[10px] text-zinc-500 font-mono">USD</div>
              </div>
            </button>
          );
        })}

        {filteredTxs.length === 0 && (
          <div className="py-8 text-center text-xs text-zinc-500 border border-dashed border-zinc-800 rounded-xl">
            {filterTab==='P2P' ? 'No P2P transfers yet. Send money to a peer to see history.' : filterTab==='REWARD' ? 'No boosting rewards yet. Start boost to earn.' : filterTab==='REFERRAL' ? 'No referral commissions yet. Invite friends.' : 'No transactions recorded yet. Complete a boost cycle or receive a transfer to see history.'}
          </div>
        )}

        {/* Pagination — prevents crush: only 5 rendered at a time, Load More hides previous */}
        {filteredTxs.length > 0 && (
          <div className="pt-2 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <button
                onClick={() => setCurrentPage(p=> Math.max(0, p-1))}
                disabled={safePage===0}
                className="flex-1 rounded-xl border border-zinc-800 bg-zinc-950 py-2.5 text-xs font-semibold text-zinc-300 hover:bg-zinc-900 hover:text-white disabled:opacity-40 disabled:cursor-not-allowed transition flex items-center justify-center gap-1.5 cursor-pointer"
              >
                ← Load Previous
              </button>
              <span className="text-[11px] font-mono text-zinc-500 shrink-0">{safePage+1}/{totalPages}</span>
              <button
                onClick={() => setCurrentPage(p=> Math.min(totalPages-1, p+1))}
                disabled={safePage>=totalPages-1}
                className="flex-1 rounded-xl border border-zinc-800 bg-zinc-950 py-2.5 text-xs font-semibold text-zinc-300 hover:bg-zinc-900 hover:text-white disabled:opacity-40 disabled:cursor-not-allowed transition flex items-center justify-center gap-1.5 cursor-pointer"
              >
                Load More <ChevronDown className="w-3.5 h-3.5 text-zinc-400" />
              </button>
            </div>
            {onViewAllTransactions && (
              <button
                onClick={onViewAllTransactions}
                className="w-full rounded-xl border border-zinc-800 bg-zinc-950/60 py-2 text-xs font-semibold text-amber-400 hover:bg-zinc-900 transition flex items-center justify-center gap-1.5 cursor-pointer"
              >
                Open Full Paginated Transactions Tab →
              </button>
            )}
          </div>
        )}
      </div>

      {/* Transaction Detail Modal */}
      {selectedTx && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
          <div className="relative w-full max-w-sm rounded-2xl border border-zinc-700 bg-zinc-900 p-5 shadow-2xl text-zinc-100">
            <button
              onClick={() => setSelectedTx(null)}
              className="absolute top-4 right-4 rounded-lg p-1 text-zinc-400 hover:bg-zinc-800 hover:text-white transition cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>

            <div className="text-center pb-3 border-b border-zinc-800 mb-3">
              <span className="text-[11px] font-mono text-zinc-400 uppercase">Transaction Details</span>
              <div className="text-2xl font-black font-mono text-white mt-1">
                ${formatPrecisionAmount(selectedTx.amount, 8)} <span className="text-xs font-sans text-zinc-400">USD</span>
              </div>
            </div>

            <div className="space-y-2.5 text-xs font-mono">
              <div className="flex justify-between items-center py-1 border-b border-zinc-800/60">
                <span className="text-zinc-500">Transaction ID:</span>
                <button
                  onClick={async () => {
                    const ok = await copyToClipboard(selectedTx.id);
                    if (ok) {
                      setCopiedTx(true);
                      setTimeout(() => setCopiedTx(false), 2000);
                    }
                  }}
                  className="flex items-center gap-1.5 text-zinc-200 hover:text-white cursor-pointer"
                  title="Copy Transaction ID"
                >
                  <span>{selectedTx.id}</span>
                  {copiedTx ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3 text-zinc-500" />}
                </button>
              </div>
              <div className="flex justify-between py-1 border-b border-zinc-800/60">
                <span className="text-zinc-500">Type:</span>
                <span className="text-amber-400 font-bold">{selectedTx.type}</span>
              </div>
              <div className="flex justify-between py-1 border-b border-zinc-800/60">
                <span className="text-zinc-500">Date & Time:</span>
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
                  <span className="text-zinc-400 text-xs">Legacy — not stored</span>
                </div>
              )}
              {selectedTx.type === "REWARD" && !(selectedTx as any).boostEndAt && (
                <div className="flex justify-between py-1 border-b border-zinc-800/40 opacity-60">
                  <span className="text-zinc-500">Boost End:</span>
                  <span className="text-zinc-400">{new Date(selectedTx.timestamp).toLocaleString()} (credited)</span>
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
                  <p className="rounded bg-zinc-950 p-2 text-zinc-300 font-sans text-[11px]">{selectedTx.notes}</p>
                </div>
              )}
            </div>

            <div className="mt-4">
              <button
                onClick={() => setSelectedTx(null)}
                className="w-full rounded-xl bg-zinc-800 py-2 text-xs font-semibold text-zinc-100 hover:bg-zinc-700 transition cursor-pointer"
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

RecentTransactionsSection.displayName = 'RecentTransactionsSection';
