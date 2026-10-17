import { FC, useEffect, useState } from 'react';
import { ArrowDownLeft, X, ExternalLink, Sparkles, ShieldCheck } from 'lucide-react';
import { ToastData } from '../services/store';

interface ToastItemProps {
  toast: ToastData;
  onDismiss: (id: string) => void;
  onViewInbox: (referenceId?: string) => void;
}

const ToastItem: FC<ToastItemProps> = ({ toast, onDismiss, onViewInbox }) => {
  const [progress, setProgress] = useState(100);

  useEffect(() => {
    const duration = 4500;
    const intervalTime = 50;
    const step = (intervalTime / duration) * 100;

    const timer = setInterval(() => {
      setProgress((prev) => {
        if (prev <= step) {
          clearInterval(timer);
          onDismiss(toast.id);
          return 0;
        }
        return prev - step;
      });
    }, intervalTime);

    return () => clearInterval(timer);
  }, [toast.id, onDismiss]);

  const isCredit = toast.type === 'TRANSFER_RECEIVED';
  const isYield = toast.type === 'YIELD_REWARD';

  return (
    <div
      role="alert"
      className="relative overflow-hidden w-full rounded-2xl border border-emerald-500/30 bg-zinc-900/95 p-3.5 shadow-2xl backdrop-blur-md transition-all duration-300 hover:border-emerald-500/50"
    >
      <div className="flex items-start gap-3">
        {/* Status Icon */}
        <div className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-emerald-500/30 bg-emerald-500/15 text-emerald-400">
          {isCredit ? (
            <ArrowDownLeft className="h-5 w-5 stroke-[2.5]" />
          ) : isYield ? (
            <Sparkles className="h-5 w-5 text-amber-400 stroke-[2.2]" />
          ) : (
            <ShieldCheck className="h-5 w-5 text-zinc-300 stroke-[2]" />
          )}
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0 pr-1">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] font-semibold tracking-wider text-emerald-400/90 uppercase font-mono">
              {isCredit ? 'P2P Transfer Received' : isYield ? 'Yield Reward' : toast.title}
            </span>
            {toast.amount !== undefined && (
              <span className="font-mono font-bold text-sm text-emerald-400 tabular-nums">
                +{Number(toast.amount).toLocaleString('en-US', { style: 'currency', currency: 'USD' })}
              </span>
            )}
          </div>

          <p className="mt-0.5 text-xs text-zinc-200 font-medium truncate">
            {toast.senderId ? `From Peer #${toast.senderId}` : toast.message}
          </p>

          <div className="mt-1 flex items-center justify-between text-[11px] text-zinc-400 font-mono">
            <span>Ref: {toast.referenceId || toast.id.slice(0, 11)}</span>
            <button
              onClick={() => onViewInbox(toast.referenceId)}
              className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-400 hover:text-emerald-300 transition-colors cursor-pointer py-0.5 px-1.5 rounded hover:bg-emerald-500/10"
            >
              <span>View</span>
              <ExternalLink className="w-3 h-3" />
            </button>
          </div>
        </div>

        {/* Dismiss Button */}
        <button
          onClick={() => onDismiss(toast.id)}
          aria-label="Dismiss notification"
          className="shrink-0 -mr-1 -mt-1 p-1 text-zinc-400 hover:text-zinc-100 transition-colors rounded-lg hover:bg-zinc-800 cursor-pointer min-w-[32px] min-h-[32px] flex items-center justify-center"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Subtle Auto-Dismiss Progress Bar */}
      <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-zinc-800">
        <div
          className="h-full bg-emerald-500 transition-all duration-75 ease-linear"
          style={{ width: `${progress}%` }}
        />
      </div>
    </div>
  );
};

interface FloatingToastContainerProps {
  toasts: ToastData[];
  onDismiss: (id: string) => void;
  onViewInbox: (referenceId?: string) => void;
}

export const FloatingToastContainer: FC<FloatingToastContainerProps> = ({
  toasts,
  onDismiss,
  onViewInbox
}) => {
  if (toasts.length === 0) return null;

  return (
    <div className="fixed top-4 left-0 right-0 z-50 pointer-events-none px-4 flex flex-col items-center gap-2 max-w-md mx-auto">
      {toasts.map((toast) => (
        <div key={toast.id} className="w-full pointer-events-auto animate-in slide-in-from-top-3 duration-200">
          <ToastItem
            toast={toast}
            onDismiss={onDismiss}
            onViewInbox={onViewInbox}
          />
        </div>
      ))}
    </div>
  );
};
