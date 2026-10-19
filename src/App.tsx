/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect, useMemo } from 'react';
import { Wallet, Trophy, MessageSquare, Inbox, Download } from 'lucide-react';
import { BoostPayStore, ToastData } from './services/store';
import { User, SystemConfig } from './types';
import { Navbar } from './components/Navbar';
import { AuthGate } from './components/AuthGate';
import { WalletView } from './components/WalletView';
import { LeaderboardView } from './components/LeaderboardView';

import { MessengerView } from './components/MessengerView';
import { InboxView } from './components/InboxView';
import { FloatingToastContainer } from './components/FloatingToast';
import { PWAInstallHelp } from './components/PWAInstallHelp';
import { usePWAInstall } from './hooks/usePWAInstall';
import { P2PTransferModal } from './components/P2PTransferModal';
import { WalletSkeleton } from './components/WalletSkeleton';
import { SecurityModal } from './components/SecurityModal';
import { QRPayModal } from './components/QRPayModal';
import { CallManager } from './components/CallOverlay';
import { AlertTriangle, X, QrCode } from 'lucide-react';

export default function App() {
  const [currentUser, setCurrentUser] = useState<User | null>(() => BoostPayStore.getCurrentUser());
  const [isInitialSyncing, setIsInitialSyncing] = useState<boolean>(true);
  const [isSecurityOpen, setIsSecurityOpen] = useState(false);
  const [isQROpen, setIsQROpen] = useState(false);
  const [qrPrefill, setQrPrefill] = useState<{ userId: string; name?: string } | null>(null);
  const [systemBanner, setSystemBanner] = useState<{ message: string; title?: string } | null>(null);
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

  // Initialize backend sync without logging out the user
  useEffect(() => {
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

  // Realtime SSE profile updates (instant) + slow authoritative fallback poll
  useEffect(() => {
    if (!currentUser) return;

    const unsubUser = BoostPayStore.onUserUpdate((fresh) => {
      setCurrentUser((prev) => {
        if (!prev) return fresh;
        if (
          prev.balance !== fresh.balance ||
          prev.lifetimeProfit !== fresh.lifetimeProfit ||
          prev.boostState.isActive !== fresh.boostState.isActive ||
          prev.boostState.isPaused !== fresh.boostState.isPaused ||
          prev.boostState.startingBalance !== fresh.boostState.startingBalance ||
          prev.boostState.targetDurationMs !== fresh.boostState.targetDurationMs ||
          prev.isFrozen !== fresh.isFrozen
        ) {
          return fresh;
        }
        return prev;
      });
    });

    const unsubBanner = BoostPayStore.onBanner((banner) => setSystemBanner(banner));

    const refreshState = async () => {
      const unread = BoostPayStore.getUnreadNotificationCount(currentUser.id);
      setUnreadNotifCount((prev) => (prev !== unread ? unread : prev));
      const synced = await BoostPayStore.syncUserFromServer(currentUser.id);
      if (synced) {
        setCurrentUser((prev) => {
          if (!prev) return synced;
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
    BoostPayStore.getBanner().then(setSystemBanner);
    // SSE pushes changes instantly; this poll is only a 15s safety net (was 1s).
    const interval = setInterval(refreshState, 15000);
    return () => {
      unsubUser();
      unsubBanner();
      clearInterval(interval);
    };
  }, [currentUser?.id]);

  const handleLogout = () => {
    BoostPayStore.setCurrentUser(null);
    setCurrentUser(null);
    setActiveTab('WALLET');
    setChatTargetPeerId(null);
  };

  // Install entry lives in the bottom nav for browser users only —
  // inside the installed PWA there is no install UI at all.
  const { isInstalled, install: promptPwaInstall } = usePWAInstall();

  // Session expiry: any API 401 while logged in bounces to the login screen
  useEffect(() => {
    const origFetch = window.fetch.bind(window);
    window.fetch = ((...args: Parameters<typeof fetch>) => {
      return origFetch(...args).then((res) => {
        try {
          const url = String((args[0] as any)?.url || args[0] || '');
          const isAuthCall = /\/api\/(users\/)?(login|register)/.test(url);
          if (res.status === 401 && !isAuthCall && url.includes('/api/')) {
            if (BoostPayStore.getCurrentUser()) {
              BoostPayStore.setCurrentUser(null);
              setCurrentUser(null);
              BoostPayStore.triggerToast({
                id: 'session-expired',
                type: 'ERROR',
                title: 'Session expired',
                message: 'Please sign in again.'
              } as any);
            }
          }
        } catch { /* never break the response */ }
        return res;
      });
    }) as typeof window.fetch;
    return () => { window.fetch = origFetch; };
  }, []);

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
    <div className="h-[100dvh] overflow-hidden bg-zinc-950 text-zinc-100 flex flex-col font-sans antialiased pt-[env(safe-area-inset-top)]">
      {/* Real-Time Floating Toast Alerts Container */}
      {/* PWA manual install guidance (iOS / Android / iframe fallback) */}
      <PWAInstallHelp />

      {/* Security Center modal (anti-phishing code + session devices) */}
      {currentUser && (
        <SecurityModal
          isOpen={isSecurityOpen}
          onClose={() => setIsSecurityOpen(false)}
          currentUser={currentUser}
          onUserUpdated={(u) => setCurrentUser({ ...u })}
        />
      )}

      {/* 1:1 voice/video calling (WebRTC) */}
      {currentUser && <CallManager currentUser={currentUser} />}

      {/* QR Pay modal (personal code + scanner) */}
      {currentUser && (
        <QRPayModal
          isOpen={isQROpen}
          onClose={() => setIsQROpen(false)}
          currentUser={currentUser}
          onScannedPayee={(userId, name) => {
            setQrPrefill({ userId, name });
            setIsSendMoneyOpen(true);
          }}
        />
      )}

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

      {!currentUser ? (
        /* 2. AUTHENTICATION GATE */
        <div className="flex-1 flex flex-col justify-center">
          <AuthGate onLoginUser={handleUserLogin} />
        </div>
      ) : (
        /* 3. LOGGED-IN MAIN USER INTERFACE */
        <div className={`flex-1 min-h-0 flex flex-col max-w-md w-full mx-auto ${activeTab === 'MESSENGER' ? 'h-[100dvh] max-h-screen overflow-hidden pb-[calc(58px+env(safe-area-inset-bottom))]' : 'pb-[calc(5rem+env(safe-area-inset-bottom))]'}`}>
          <Navbar onLogout={handleLogout} />

          {/* Urgent system banner (admin broadcasts) */}
          {systemBanner && (
            <div className="mx-4 mt-3 flex items-start gap-2.5 rounded-2xl border border-amber-500/40 bg-amber-500/10 px-3.5 py-2.5">
              <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
              <div className="flex-1 min-w-0">
                {systemBanner.title && (
                  <p className="text-[10px] font-bold uppercase tracking-wider text-amber-400">{systemBanner.title}</p>
                )}
                <p className="text-[11px] leading-relaxed text-amber-100 break-words">{systemBanner.message}</p>
              </div>
              <button
                onClick={() => setSystemBanner(null)}
                className="rounded-lg p-1 text-amber-400/70 hover:text-amber-300 hover:bg-amber-500/10 transition cursor-pointer"
                title="Dismiss"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          )}

          <main className={`flex-1 min-h-0 ${activeTab === 'MESSENGER' ? 'flex flex-col overflow-hidden' : 'overflow-y-auto overscroll-contain'}`}>
            {activeTab === 'WALLET' && (
              isInitialSyncing ? (
                <WalletSkeleton />
              ) : (
                <WalletView
                  user={currentUser}
                  onUpdateUser={(updated: User) => setCurrentUser({ ...updated })}
                  onOpenSendMoney={() => setIsSendMoneyOpen(true)}
                  onOpenQR={() => setIsQROpen(true)}
                  onOpenSecurity={() => setIsSecurityOpen(true)}
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
            <div className={`max-w-md mx-auto grid items-center gap-1 ${isInstalled ? 'grid-cols-4' : 'grid-cols-5'}`}>
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

              {/* 5. Install (browser only — hidden inside the installed PWA) */}
              {!isInstalled && (
                <button
                  onClick={() => { void promptPwaInstall(); }}
                  className="flex flex-col items-center justify-center gap-1 text-[11px] font-medium transition cursor-pointer min-h-[44px] text-zinc-500 hover:text-amber-400"
                  title="Install BoostPay app"
                >
                  <Download className="w-5 h-5 stroke-[2.2]" />
                  <span>Install</span>
                </button>
              )}

            </div>
          </nav>
        </div>
      )}

      {/* P2P Transfer Modal */}
      {currentUser && (
        <P2PTransferModal
          isOpen={isSendMoneyOpen}
          onClose={() => { setIsSendMoneyOpen(false); setQrPrefill(null); }}
          currentUser={currentUser}
          onSuccess={(updated) => {
            setCurrentUser({ ...updated });
          }}
          recipientPrefill={qrPrefill}
          onOpenQR={() => { setIsSendMoneyOpen(false); setIsQROpen(true); }}
        />
      )}

    </div>
  );
}
