import { FC, useState } from 'react';
import { ArrowUpRight, ArrowDownLeft, Zap, ShieldAlert, X, Clock, Copy, Check, ChevronDown } from 'lucide-react';
import { Transaction } from '../types';
import { copyToClipboard } from '../services/store';
import { formatPrecisionAmount } from '../utils/format';

interface Props {
  transactions: Transaction[];
  userId: string;
}

export const RecentTransactionsSection: FC<Props> = ({ transactions, userId }) => {
  const [selectedTx, setSelectedTx] = useState<Transaction | null>(null);
  const [copiedTx, setCopiedTx] = useState(false);
  const [visibleCount, setVisibleCount] = useState(5);

  const userTxs = transactions
    .filter(t => t.userId === userId)
    .sort((a, b) => b.timestamp - a.timestamp);

  const displayedTxs = userTxs.slice(0, visibleCount);

  const getTxDetails = (tx: Transaction) => {
    switch (tx.type) {
      case 'REWARD':
        return {
          label: 'Reward',
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
        return {
          label: 'Transaction',
          icon: Zap,
          color: 'text-zinc-400 bg-zinc-800 border-zinc-700',
          amountSign: '',
          amountColor: 'text-zinc-200'
        };
    }
  };

  return (
    <div className="rounded-2xl border border-zinc-800 bg-zinc-900/80 p-5 shadow-xl">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Clock className="w-4 h-4 text-zinc-400" />
          <h3 className="font-bold text-sm text-white">Recent Transactions</h3>
        </div>
        <span className="text-[11px] font-mono text-zinc-500">
          Showing {displayedTxs.length} of {userTxs.length}
        </span>
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

        {userTxs.length === 0 && (
          <div className="py-8 text-center text-xs text-zinc-500 border border-dashed border-zinc-800 rounded-xl">
            No transactions recorded yet. Complete a boost cycle or receive a transfer to see history.
          </div>
        )}

        {/* Load More Button */}
        {userTxs.length > displayedTxs.length && (
          <div className="pt-2 text-center">
            <button
              onClick={() => setVisibleCount(prev => prev + 5)}
              className="w-full rounded-xl border border-zinc-800 bg-zinc-950 py-2.5 text-xs font-semibold text-zinc-300 hover:bg-zinc-900 hover:text-white transition flex items-center justify-center gap-1.5 cursor-pointer"
            >
              Load More <ChevronDown className="w-3.5 h-3.5 text-zinc-400" />
            </button>
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
};
