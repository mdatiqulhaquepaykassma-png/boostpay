import { FC, useState, useEffect, useMemo } from 'react';
import { 
  Inbox, 
  CheckCheck, 
  Trash2, 
  Copy, 
  Check, 
  ArrowDownLeft, 
  ArrowUpRight, 
  Sparkles, 
  ShieldAlert, 
  RotateCw,
  Search
} from 'lucide-react';
import { BoostPayStore, copyToClipboard } from '../services/store';
import { InboxNotification, NotificationType } from '../types';
import { formatPrecisionAmount } from '../utils/format';

interface Props {
  userId: string;
  initialFilter?: string | null;
}

type FilterCategory = 'ALL' | 'CREDITS' | 'DEBITS' | 'REWARDS' | 'SYSTEM';

export const InboxView: FC<Props> = ({ userId }) => {
  const [notifications, setNotifications] = useState<InboxNotification[]>(() => 
    BoostPayStore.getNotifications(userId)
  );
  const [activeFilter, setActiveFilter] = useState<FilterCategory>('ALL');
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [isRefreshing, setIsRefreshing] = useState(false);

  const loadNotifications = () => {
    const list = BoostPayStore.getNotifications(userId);
    setNotifications((prev) => {
      if (prev.length !== list.length) return list;
      const changed = prev.some((n, i) => n.id !== list[i]?.id || n.isRead !== list[i]?.isRead);
      return changed ? list : prev;
    });
  };

  useEffect(() => {
    loadNotifications();
    const interval = setInterval(loadNotifications, 1000);
    return () => clearInterval(interval);
  }, [userId]);

  const handleMarkAllRead = async () => {
    await BoostPayStore.markNotificationAsRead(userId, 'ALL');
    loadNotifications();
  };

  const handleMarkSingleRead = async (notifId: string) => {
    await BoostPayStore.markNotificationAsRead(userId, notifId);
    loadNotifications();
  };

  const handleDelete = async (notifId: string) => {
    await BoostPayStore.deleteNotification(userId, notifId);
    loadNotifications();
  };

  const handleCopyRef = async (ref: string, notifId: string) => {
    const ok = await copyToClipboard(ref);
    if (ok) {
      setCopiedId(notifId);
      setTimeout(() => setCopiedId(null), 1800);
    }
  };

  const handleRefresh = async () => {
    setIsRefreshing(true);
    await BoostPayStore.syncUserFromServer(userId);
    loadNotifications();
    setTimeout(() => setIsRefreshing(false), 400);
  };

  const filteredNotifications = useMemo(() => {
    return notifications.filter((n) => {
      // Category filter
      if (activeFilter === 'CREDITS' && n.type !== 'TRANSFER_RECEIVED') return false;
      if (activeFilter === 'DEBITS' && n.type !== 'TRANSFER_SENT') return false;
      if (activeFilter === 'REWARDS' && n.type !== 'YIELD_REWARD') return false;
      if (activeFilter === 'SYSTEM' && n.type !== 'SYSTEM_ALERT') return false;

      // Search query
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchesMsg = n.message.toLowerCase().includes(q);
        const matchesRef = n.referenceId?.toLowerCase().includes(q);
        const matchesTitle = n.title.toLowerCase().includes(q);
        if (!matchesMsg && !matchesRef && !matchesTitle) return false;
      }

      return true;
    });
  }, [notifications, activeFilter, searchQuery]);

  const unreadCount = useMemo(() => {
    return notifications.filter(n => !n.isRead).length;
  }, [notifications]);

  const formatTimestamp = (ts: number): string => {
    const diff = Date.now() - ts;
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'Just now';
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    const d = new Date(ts);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  };

  const getIconForType = (type: NotificationType) => {
    switch (type) {
      case 'TRANSFER_RECEIVED':
        return <ArrowDownLeft className="w-4 h-4 text-emerald-400 stroke-[2.5]" />;
      case 'TRANSFER_SENT':
        return <ArrowUpRight className="w-4 h-4 text-rose-400 stroke-[2.5]" />;
      case 'YIELD_REWARD':
        return <Sparkles className="w-4 h-4 text-amber-400 stroke-[2.2]" />;
      case 'SYSTEM_ALERT':
      default:
        return <ShieldAlert className="w-4 h-4 text-cyan-400 stroke-[2]" />;
    }
  };

  return (
    <div className="space-y-4 px-4 py-3 animate-in fade-in duration-150">
      {/* Header bar */}
      <div className="flex items-center justify-between gap-3 border-b border-zinc-800 pb-3">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-lg font-bold tracking-tight text-zinc-100">SMS Inbox</h1>
            {unreadCount > 0 && (
              <span className="font-mono text-[11px] font-bold text-amber-400 bg-amber-500/15 border border-amber-500/30 px-2 py-0.5 rounded-md">
                {unreadCount} unread
              </span>
            )}
          </div>
          <p className="text-xs text-zinc-400 mt-0.5">
            Real-time transaction receipts & official account alerts
          </p>
        </div>

        <div className="flex items-center gap-1.5">
          <button
            onClick={handleRefresh}
            title="Refresh inbox"
            disabled={isRefreshing}
            className="p-2 rounded-xl text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/80 transition cursor-pointer min-h-[40px] min-w-[40px] flex items-center justify-center"
          >
            <RotateCw className={`w-4 h-4 ${isRefreshing ? 'animate-spin text-amber-400' : ''}`} />
          </button>

          {unreadCount > 0 && (
            <button
              onClick={handleMarkAllRead}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold bg-zinc-800 hover:bg-zinc-700 text-zinc-200 transition cursor-pointer min-h-[40px]"
            >
              <CheckCheck className="w-3.5 h-3.5 text-emerald-400" />
              <span>Mark all read</span>
            </button>
          )}
        </div>
      </div>

      {/* Search Input */}
      <div className="relative">
        <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search by reference, sender ID, or text..."
          className="w-full bg-zinc-900 border border-zinc-800 rounded-xl pl-9 pr-3 py-2 text-xs text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-amber-400/60 transition"
        />
        {searchQuery && (
          <button
            onClick={() => setSearchQuery('')}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-zinc-500 hover:text-zinc-300"
          >
            Clear
          </button>
        )}
      </div>

      {/* Segmented Filter Controls */}
      <div className="flex items-center gap-1 p-1 bg-zinc-900/90 rounded-xl border border-zinc-800/80 overflow-x-auto no-scrollbar">
        {(
          [
            { id: 'ALL', label: 'All' },
            { id: 'CREDITS', label: 'Credits' },
            { id: 'DEBITS', label: 'Debits' },
            { id: 'REWARDS', label: 'Yields' },
            { id: 'SYSTEM', label: 'System' }
          ] as const
        ).map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveFilter(tab.id)}
            className={`flex-1 min-w-[62px] px-2.5 py-1.5 text-xs font-medium rounded-lg transition-colors whitespace-nowrap cursor-pointer ${
              activeFilter === tab.id
                ? 'bg-zinc-800 text-amber-400 shadow-sm font-semibold'
                : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Notifications List */}
      {filteredNotifications.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-zinc-800 bg-zinc-900/30 p-8 text-center my-6">
          <div className="w-12 h-12 rounded-2xl bg-zinc-800/80 border border-zinc-700/50 flex items-center justify-center mx-auto mb-3 text-zinc-500">
            <Inbox className="w-6 h-6 stroke-[1.8]" />
          </div>
          <h3 className="text-sm font-semibold text-zinc-300">No notifications found</h3>
          <p className="text-xs text-zinc-500 mt-1 max-w-xs mx-auto">
            {searchQuery
              ? 'No notifications matched your search query.'
              : 'Incoming transfers, yield credits, and system announcements will appear here in real-time.'}
          </p>
        </div>
      ) : (
        <div className="space-y-2.5">
          {filteredNotifications.map((notif) => {
            const isCredit = notif.type === 'TRANSFER_RECEIVED';
            const isDebit = notif.type === 'TRANSFER_SENT';
            const isYield = notif.type === 'YIELD_REWARD';

            return (
              <div
                key={notif.id}
                onClick={() => !notif.isRead && handleMarkSingleRead(notif.id)}
                className={`relative rounded-2xl border p-3.5 transition-all ${
                  notif.isRead
                    ? 'border-zinc-800/80 bg-zinc-900/60'
                    : 'border-amber-500/30 bg-zinc-900/90 shadow-md ring-1 ring-amber-500/20'
                }`}
              >
                {/* Header row: Sender telecom ID · Timestamp */}
                <div className="flex items-center justify-between gap-2 mb-2">
                  <div className="flex items-center gap-2 text-xs">
                    <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-zinc-800 border border-zinc-700/60">
                      {getIconForType(notif.type)}
                    </span>
                    <span className="font-mono font-bold text-zinc-300 text-[11px] tracking-wide">
                      {notif.title || 'BOOSTPAY-ALERTS'}
                    </span>
                    <span className="text-zinc-600 font-mono" aria-hidden="true">·</span>
                    <span className="text-zinc-500 text-[11px] font-mono tabular-nums">
                      {formatTimestamp(notif.timestamp)}
                    </span>
                  </div>

                  {!notif.isRead && (
                    <span className="text-[10px] font-semibold text-amber-400 font-mono">
                      NEW
                    </span>
                  )}
                </div>

                {/* SMS Body */}
                <p className="text-xs font-mono text-zinc-200 leading-relaxed pl-1 border-l-2 border-zinc-800 py-0.5">
                  {notif.message}
                </p>

                {/* Bottom Receipt Bar */}
                <div className="mt-3 pt-2.5 border-t border-zinc-800/80 flex items-center justify-between gap-2 text-[11px]">
                  {/* Reference & Copy */}
                  <div className="flex items-center gap-1.5 text-zinc-400 font-mono">
                    <span className="text-zinc-500">Ref:</span>
                    <span className="text-zinc-300">{notif.referenceId || notif.id}</span>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleCopyRef(notif.referenceId || notif.id, notif.id);
                      }}
                      className="p-1 hover:text-amber-400 transition cursor-pointer"
                      title="Copy reference code"
                    >
                      {copiedId === notif.id ? (
                        <Check className="w-3.5 h-3.5 text-emerald-400" />
                      ) : (
                        <Copy className="w-3.5 h-3.5" />
                      )}
                    </button>
                  </div>

                  {/* Right side amount & delete */}
                  <div className="flex items-center gap-2">
                    {notif.amount !== undefined && (
                      <span
                        className={`font-mono font-bold text-xs tabular-nums ${
                          isCredit || isYield
                            ? 'text-emerald-400'
                            : isDebit
                            ? 'text-rose-400'
                            : 'text-zinc-300'
                        }`}
                      >
                        {isCredit || isYield ? '+' : isDebit ? '-' : ''}$
                        {formatPrecisionAmount(notif.amount, 8)}
                      </span>
                    )}

                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDelete(notif.id);
                      }}
                      className="p-1 text-zinc-500 hover:text-rose-400 transition cursor-pointer"
                      title="Delete notification"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
