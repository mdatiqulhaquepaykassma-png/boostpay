import { FC, useEffect, useState } from 'react';
import { ArrowDownLeft, X, ExternalLink, Sparkles, ShieldCheck, MessageSquare } from 'lucide-react';
import { ToastData } from '../services/store';

interface ToastItemProps {
  toast: ToastData;
  onDismiss: (id: string) => void;
  onViewInbox: (referenceId?: string) => void;
  onOpenChat?: (peerId?: string, convId?: string) => void;
}

const ToastItem: FC<ToastItemProps> = ({ toast, onDismiss, onViewInbox, onOpenChat }) => {
  const [progress, setProgress] = useState(100);

  useEffect(() => {
    const duration = toast.type === 'CHAT_MESSAGE' ? 5500 : 4500;
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
  }, [toast.id, toast.type, onDismiss]);

  const isCredit = toast.type === 'TRANSFER_RECEIVED';
  const isYield = toast.type === 'YIELD_REWARD';
  const isChat = toast.type === 'CHAT_MESSAGE';

  return (
    <div
      role="alert"
      className={`relative overflow-hidden w-full rounded-2xl border bg-zinc-900/95 p-3.5 shadow-2xl backdrop-blur-md transition-all duration-300 ${
        isChat
          ? 'border-amber-500/40 hover:border-amber-500/60 shadow-amber-500/10'
          : 'border-emerald-500/30 hover:border-emerald-500/50'
      }`}
    >
      <div className="flex items-start gap-3">
        {/* Status Icon */}
        <div className={`mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border ${
          isChat
            ? 'border-amber-500/30 bg-amber-500/15 text-amber-400'
            : isCredit
            ? 'border-emerald-500/30 bg-emerald-500/15 text-emerald-400'
            : isYield
            ? 'border-amber-500/30 bg-amber-500/15 text-amber-400'
            : 'border-sky-500/30 bg-sky-500/15 text-sky-400'
        }`}>
          {isChat ? (
            <MessageSquare className="h-5 w-5 text-amber-400 stroke-[2.2]" />
          ) : isCredit ? (
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
            <span className={`text-[11px] font-semibold tracking-wider uppercase font-mono ${
              isChat ? 'text-amber-400' : 'text-emerald-400/90'
            }`}>
              {isChat ? toast.title : isCredit ? 'P2P Transfer Received' : isYield ? 'Yield Reward' : toast.title}
            </span>
            {toast.amount !== undefined && (
              <span className="font-mono font-bold text-sm text-emerald-400 tabular-nums">
                +{Number(toast.amount).toLocaleString('en-US', { style: 'currency', currency: 'USD' })}
              </span>
            )}
          </div>

          <p className="mt-0.5 text-xs text-zinc-200 font-medium truncate">
            {toast.message}
          </p>

          <div className="mt-1.5 flex items-center justify-between text-[11px] text-zinc-400 font-mono">
            <span>{isChat ? (toast.senderId ? `From #${toast.senderId}` : 'Instant Chat') : `Ref: ${toast.referenceId || toast.id.slice(0, 11)}`}</span>
            {isChat ? (
              <button
                onClick={() => {
                  onDismiss(toast.id);
                  onOpenChat?.(toast.senderId, toast.conversationId);
                }}
                className="inline-flex items-center gap-1 text-[11px] font-bold text-amber-400 hover:text-amber-300 transition-colors cursor-pointer py-1 px-2.5 rounded-lg bg-amber-500/15 hover:bg-amber-500/25 border border-amber-500/30"
              >
                <span>Reply</span>
                <ExternalLink className="w-3 h-3" />
              </button>
            ) : (
              <button
                onClick={() => onViewInbox(toast.referenceId)}
                className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-400 hover:text-emerald-300 transition-colors cursor-pointer py-0.5 px-1.5 rounded hover:bg-emerald-500/10"
              >
                <span>View</span>
                <ExternalLink className="w-3 h-3" />
              </button>
            )}
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
          className={`h-full transition-all duration-75 ease-linear ${isChat ? 'bg-amber-500' : 'bg-emerald-500'}`}
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
  onOpenChat?: (peerId?: string, convId?: string) => void;
}

export const FloatingToastContainer: FC<FloatingToastContainerProps> = ({
  toasts,
  onDismiss,
  onViewInbox,
  onOpenChat
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
            onOpenChat={onOpenChat}
          />
        </div>
      ))}
    </div>
  );
};
