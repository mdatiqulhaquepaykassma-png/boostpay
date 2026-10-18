/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect } from 'react';
import { Wallet, Trophy, MessageSquare, Download, ExternalLink, Inbox } from 'lucide-react';
import { BoostPayStore, ToastData } from './services/store';
import { User, SystemConfig } from './types';
import { Navbar } from './components/Navbar';
import { AuthGate } from './components/AuthGate';
import { WalletView } from './components/WalletView';
import { LeaderboardView } from './components/LeaderboardView';
import { AdminPortal } from './components/AdminPortal';
import { MessengerView } from './components/MessengerView';
import { InboxView } from './components/InboxView';
import { FloatingToastContainer } from './components/FloatingToast';
import { PWAInstallHelp } from './components/PWAInstallHelp';
import { P2PTransferModal } from './components/P2PTransferModal';
import { WalletSkeleton } from './components/WalletSkeleton';
import { usePWAInstall } from './hooks/usePWAInstall';

export default function App() {
  const [currentUser, setCurrentUser] = useState<User | null>(() => BoostPayStore.getCurrentUser());
  const [isInitialSyncing, setIsInitialSyncing] = useState<boolean>(true);
  const [isOnAdminRoute, setIsOnAdminRoute] = useState<boolean>(() => {
    const path = window.location.pathname.toLowerCase();
    const hash = window.location.hash.toLowerCase();
    return path === '/admin' || path.startsWith('/admin/') || hash === '#/admin' || hash === '#admin';
  });
  const [activeTab, setActiveTab] = useState<'WALLET' | 'LEADERBOARD' | 'INBOX' | 'MESSENGER'>('WALLET');
  const [chatTargetPeerId, setChatTargetPeerId] = useState<string | null>(null);

  // Real-time floating toasts state
  const [toasts, setToasts] = useState<ToastData[]>([]);
  const [unreadNotifCount, setUnreadNotifCount] = useState<number>(0);
  const [hasUnreadChat, setHasUnreadChat] = useState<boolean>(false);

  // Modals state
  const [isSendMoneyOpen, setIsSendMoneyOpen] = useState(false);

  // System config state
  const [config, setConfig] = useState<SystemConfig>(BoostPayStore.getConfig());

  // PWA install hook & state
  const { isInstallable, isInstalled, isInstallLoading, justInstalled, install, openApp } = usePWAInstall();

  const handleBottomInstallClick = async () => {
    await install();
  };

  // Listen to /admin URL route changes
  useEffect(() => {
    const checkAdminRoute = () => {
      const path = window.location.pathname.toLowerCase();
      const hash = window.location.hash.toLowerCase();
      const isAdminPath = path === '/admin' || path.startsWith('/admin/') || hash === '#/admin' || hash === '#admin';
      setIsOnAdminRoute(isAdminPath);
    };

    checkAdminRoute();
    window.addEventListener('popstate', checkAdminRoute);
    window.addEventListener('hashchange', checkAdminRoute);

    // Initialize backend sync without logging out the user
    BoostPayStore.initSync()
      .then(async () => {
        const freshUser = BoostPayStore.getCurrentUser();
        if (freshUser) {
          setCurrentUser(freshUser);
          // Refresh single user boost status from authoritative backend
          const synced = await BoostPayStore.syncUserFromServer(freshUser.id);
          if (synced) setCurrentUser(synced);
        }
        setConfig(BoostPayStore.getConfig());
        setIsInitialSyncing(false);
      })
      .catch(() => {
        setIsInitialSyncing(false);
      });

    return () => {
      window.removeEventListener('popstate', checkAdminRoute);
      window.removeEventListener('hashchange', checkAdminRoute);
    };
  }, []);

  // Listen for real-time incoming transfer toasts (chat popups disabled)
  useEffect(() => {
    const unsubscribe = BoostPayStore.onToastNotification((newToast) => {
      if (newToast.type !== 'CHAT_MESSAGE') {
        setToasts((prev) => [newToast, ...prev]);
      }
    });
    return unsubscribe;
  }, []);

  // Listen for real-time chat updates to toggle unread badge on Chat tab
  useEffect(() => {
    const unsubChat = BoostPayStore.subscribeToChat((_convs, msgs) => {
      if (activeTab !== 'MESSENGER' && currentUser?.id) {
        const last = msgs[msgs.length - 1];
        if (last && last.senderId !== currentUser.id) {
          setHasUnreadChat(true);
        }
      }
    });
    return unsubChat;
  }, [activeTab, currentUser?.id]);

  // Connect user to real-time chat SSE stream
  useEffect(() => {
    if (!currentUser?.id) return;
    const unsubChat = BoostPayStore.initChatStream(currentUser.id);
    return () => {
      unsubChat();
    };
  }, [currentUser?.id]);

  // Periodic authoritative background synchronization with change-guarded updates
  useEffect(() => {
    if (!currentUser) return;

    const refreshState = async () => {
      const unread = BoostPayStore.getUnreadNotificationCount(currentUser.id);
      setUnreadNotifCount((prev) => (prev !== unread ? unread : prev));

      const synced = await BoostPayStore.syncUserFromServer(currentUser.id);
      if (synced) {
        setCurrentUser((prev) => {
          if (!prev) return synced;
          // Only trigger React state update if key values actually changed
          if (
            prev.balance !== synced.balance ||
            prev.lifetimeProfit !== synced.lifetimeProfit ||
            prev.boostState.isActive !== synced.boostState.isActive ||
            prev.boostState.isPaused !== synced.boostState.isPaused ||
            prev.boostState.startingBalance !== synced.boostState.startingBalance ||
            prev.boostState.targetDurationMs !== synced.boostState.targetDurationMs
          ) {
            return synced;
          }
          return prev;
        });
      }
    };

    refreshState();
    const interval = setInterval(refreshState, 1000);
    return () => clearInterval(interval);
  }, [currentUser?.id]);

  const handleExitAdmin = () => {
    setIsOnAdminRoute(false);
    if (window.location.pathname.startsWith('/admin')) {
      window.history.pushState({}, '', '/');
    }
    if (window.location.hash.includes('admin')) {
      window.location.hash = '';
    }
  };

  const handleEnterAdmin = () => {
    setIsOnAdminRoute(true);
    if (!window.location.pathname.startsWith('/admin')) {
      window.history.pushState({}, '', '/admin');
    }
  };

  const handleLogout = () => {
    BoostPayStore.setCurrentUser(null);
    setCurrentUser(null);
    setActiveTab('WALLET');
    setChatTargetPeerId(null);
  };

  const handleUserLogin = (user: User) => {
    BoostPayStore.setCurrentUser(user);
    setCurrentUser(user);
    setActiveTab('WALLET');
  };

  const handleOpenPeerChatFromLeaderboard = (peerId: string) => {
    setChatTargetPeerId(peerId);
    setActiveTab('MESSENGER');
  };

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 flex flex-col font-sans antialiased pt-[env(safe-area-inset-top)]">
      {/* Real-Time Floating Toast Alerts Container */}
      {/* PWA manual install guidance (iOS / Android / iframe fallback) */}
      <PWAInstallHelp />

      <FloatingToastContainer
        toasts={toasts}
        onDismiss={(id) => setToasts((prev) => prev.filter((t) => t.id !== id))}
        onViewInbox={() => {
          setActiveTab('INBOX');
          setToasts([]);
        }}
        onOpenChat={(peerId) => {
          if (peerId) {
            setChatTargetPeerId(peerId);
          }
          setActiveTab('MESSENGER');
          setHasUnreadChat(false);
          setToasts([]);
        }}
      />

      {/* 1. COMPLETELY INDEPENDENT FULL-STACK ADMIN PORTAL (/admin or #admin) */}
      {isOnAdminRoute ? (
        <AdminPortal onBack={handleExitAdmin} />
      ) : !currentUser ? (
        /* 2. AUTHENTICATION GATE */
        <div className="flex-1 flex flex-col justify-center">
          <AuthGate onLoginUser={handleUserLogin} />
        </div>
      ) : (
        /* 3. LOGGED-IN MAIN USER INTERFACE */
        <div className={`flex-1 flex flex-col max-w-md w-full mx-auto ${activeTab === 'MESSENGER' ? 'h-[100dvh] max-h-screen overflow-hidden pb-[calc(58px+env(safe-area-inset-bottom))]' : 'pb-[calc(5rem+env(safe-area-inset-bottom))]'}`}>
          <Navbar
            user={currentUser}
            isAdmin={false}
            onLogout={handleLogout}
          />

          <main className={`flex-1 ${activeTab === 'MESSENGER' ? 'flex flex-col min-h-0 overflow-hidden' : 'overflow-y-auto'}`}>
            {activeTab === 'WALLET' && (
              isInitialSyncing ? (
                <WalletSkeleton />
              ) : (
                <WalletView
                  user={currentUser}
                  onUpdateUser={(updated: User) => setCurrentUser({ ...updated })}
                  onOpenSendMoney={() => setIsSendMoneyOpen(true)}
                  config={config}
                />
              )
            )}

            {activeTab === 'LEADERBOARD' && (
              <LeaderboardView
                currentUserId={currentUser.id}
                onSelectPeerForChat={handleOpenPeerChatFromLeaderboard}
              />
            )}

            {activeTab === 'INBOX' && (
              <InboxView userId={currentUser.id} />
            )}

            {activeTab === 'MESSENGER' && (
              <MessengerView
                currentUser={currentUser}
                initialPeerId={chatTargetPeerId}
              />
            )}
          </main>


          {/* FIXED BOTTOM NAVIGATION BAR */}
          <nav className="fixed bottom-0 left-0 right-0 z-40 border-t border-zinc-800 bg-zinc-950/95 backdrop-blur-md px-3 pt-1.5 pb-[calc(0.375rem+env(safe-area-inset-bottom))]">
            <div className="max-w-md mx-auto grid grid-cols-5 items-center gap-1">
              {/* 1. Wallet Tab */}
              <button
                onClick={() => setActiveTab('WALLET')}
                className={`flex flex-col items-center justify-center gap-1 text-[11px] font-medium transition cursor-pointer min-h-[44px] ${
                  activeTab === 'WALLET' ? 'text-amber-400 font-bold' : 'text-zinc-500 hover:text-zinc-300'
                }`}
              >
                <Wallet className="w-5 h-5 stroke-[2.2]" />
                <span>Wallet</span>
              </button>

              {/* 2. Leaderboard Tab */}
              <button
                onClick={() => setActiveTab('LEADERBOARD')}
                className={`flex flex-col items-center justify-center gap-1 text-[11px] font-medium transition cursor-pointer min-h-[44px] ${
                  activeTab === 'LEADERBOARD' ? 'text-amber-400 font-bold' : 'text-zinc-500 hover:text-zinc-300'
                }`}
              >
                <Trophy className="w-5 h-5 stroke-[2.2]" />
                <span>Leaders</span>
              </button>

              {/* 3. SMS Inbox Tab */}
              <button
                onClick={() => {
                  setActiveTab('INBOX');
                  // Clear unread count optimistically
                  if (currentUser) {
                    BoostPayStore.markNotificationAsRead(currentUser.id, 'ALL');
                    setUnreadNotifCount(0);
                  }
                }}
                className={`relative flex flex-col items-center justify-center gap-1 text-[11px] font-medium transition cursor-pointer min-h-[44px] ${
                  activeTab === 'INBOX' ? 'text-amber-400 font-bold' : 'text-zinc-500 hover:text-zinc-300'
                }`}
              >
                <div className="relative">
                  <Inbox className="w-5 h-5 stroke-[2.2]" />
                  {unreadNotifCount > 0 && (
                    <span className="absolute -top-1.5 -right-2 flex h-3.5 min-w-[14px] items-center justify-center rounded-full bg-amber-500 px-1 text-[9px] font-bold text-zinc-950 font-mono shadow-sm">
                      {unreadNotifCount > 9 ? '9+' : unreadNotifCount}
                    </span>
                  )}
                </div>
                <span>Inbox</span>
              </button>

              {/* 4. Messenger Tab */}
              <button
                onClick={() => {
                  setActiveTab('MESSENGER');
                  setHasUnreadChat(false);
                }}
                className={`relative flex flex-col items-center justify-center gap-1 text-[11px] font-medium transition cursor-pointer min-h-[44px] ${
                  activeTab === 'MESSENGER' ? 'text-amber-400 font-bold' : 'text-zinc-500 hover:text-zinc-300'
                }`}
              >
                <div className="relative">
                  <MessageSquare className="w-5 h-5 stroke-[2.2]" />
                  {hasUnreadChat && activeTab !== 'MESSENGER' && (
                    <span className="absolute -top-1 -right-1 flex h-2.5 w-2.5 rounded-full bg-amber-400 ring-2 ring-zinc-950" />
                  )}
                </div>
                <span>Chat</span>
              </button>

              {/* 5. Install / Open App Action */}
              <div className="flex flex-col items-center justify-center min-h-[44px]">
                {isInstalled || justInstalled ? (
                  <button
                    onClick={openApp}
                    className="flex flex-col items-center justify-center gap-1 text-[11px] text-emerald-400 font-bold hover:text-emerald-300 transition cursor-pointer min-h-[44px]"
                    title="Open installed BoostPay app"
                  >
                    <ExternalLink className="w-5 h-5" />
                    <span>Open</span>
                  </button>
                ) : (
                  <button
                    onClick={handleBottomInstallClick}
                    disabled={isInstallLoading}
                    className="flex flex-col items-center justify-center gap-1 text-[11px] font-bold text-amber-400 hover:text-amber-300 active:scale-95 transition cursor-pointer min-h-[44px]"
                    title="Install BoostPay"
                  >
                    {isInstallLoading ? (
                      <div className="h-5 w-5 rounded-full border-2 border-amber-400 border-t-transparent animate-spin" />
                    ) : (
                      <Download className="w-5 h-5 stroke-[2.5]" />
                    )}
                    <span>Install</span>
                  </button>
                )}
              </div>
            </div>
          </nav>
        </div>
      )}

      {/* P2P Transfer Modal */}
      {currentUser && (
        <P2PTransferModal
          isOpen={isSendMoneyOpen}
          onClose={() => setIsSendMoneyOpen(false)}
          currentUser={currentUser}
          onSuccess={(updated) => {
            setCurrentUser({ ...updated });
          }}
        />
      )}

    </div>
  );
}
