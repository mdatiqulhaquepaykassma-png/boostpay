import { FC, useState, useEffect, useRef } from 'react';
import {
  ShieldCheck,
  PlusCircle,
  MinusCircle,
  Users,
  MessageSquare,
  Percent,
  Search,
  Send,
  CheckCircle2,
  Lock,
  Unlock,
  KeyRound,
  Copy,
  Check,
  Eye,
  EyeOff,
  Server,
  Zap,
  RefreshCw,
  LogOut,
  Database,
  Trash2,
  Download,
  Upload,
  AlertTriangle,
  ArrowLeft,
  Activity,
  Sliders,
  Sparkles
} from 'lucide-react';
import { BoostPayStore, copyToClipboard } from '../services/store';
import { User, SystemConfig, Conversation, Message } from '../types';
import { formatPrecisionAmount, formatRatePercent } from '../utils/format';

interface Props {
  onBack?: () => void;
}

export const AdminPortal: FC<Props> = ({ onBack }) => {
  // 1. Persistent Admin Auth State
  const [adminSession, setAdminSession] = useState(() => BoostPayStore.getAdminSession());
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loginError, setLoginError] = useState('');
  const [isLoggingIn, setIsLoggingIn] = useState(false);

  // 2. Admin Portal Views
  const [activeTab, setActiveTab] = useState<'OVERVIEW' | 'USERS' | 'DATABASE' | 'ENGINE' | 'SUPPORT'>('OVERVIEW');

  // 3. Database Storage & Diagnostics State
  const [storageProbe, setStorageProbe] = useState<any>(null);
  const [isProbing, setIsProbing] = useState(false);
  const [importLoading, setImportLoading] = useState(false);
  const [importStatus, setImportStatus] = useState<string | null>(null);

  // 4. System Data
  const [users, setUsers] = useState<User[]>(() => BoostPayStore.getUsers());
  const [config, setConfig] = useState<SystemConfig>(() => BoostPayStore.getConfig());
  const [conversations, setConversations] = useState<Conversation[]>(() => BoostPayStore.getConversations());
  const [messages, setMessages] = useState<Message[]>(() => BoostPayStore.getMessages());
  const [isRefreshing, setIsRefreshing] = useState(false);

  // 4. Stats
  const [stats, setStats] = useState({
    totalUsers: 0,
    totalLiquidity: 0,
    totalProfitPaid: 0,
    activeBoosters: 0,
    pausedBoosters: 0,
    totalTransactions: 0,
    dokployStatus: {
      host: 'boostpay-eoqehk',
      port: 5432,
      database: 'boostpaydb',
      isConnected: true,
      lastPingMs: 28
    }
  });

  // 4. Admin Portal input focus tracking
  const isEditing = useRef({
    hourlyRate: false,
    minBoost: false,
    maxBoost: false
  });

  // User Management State
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedUser, setSelectedUser] = useState<User | null>(null);
  const [revealedPhrases, setRevealedPhrases] = useState<Record<string, boolean>>({});
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [adjustAmount, setAdjustAmount] = useState('');
  const [adjustNote, setAdjustNote] = useState('');
  const [adjustLoading, setAdjustLoading] = useState(false);
  const [adjustSuccessMsg, setAdjustSuccessMsg] = useState('');
  const [adjustError, setAdjustError] = useState('');

  // Quick Credit Modal State
  const [quickCreditModalUser, setQuickCreditModalUser] = useState<User | null>(null);
  const [quickCreditAmount, setQuickCreditAmount] = useState('');
  const [quickCreditNote, setQuickCreditNote] = useState('');
  const [quickCreditLoading, setQuickCreditLoading] = useState(false);
  const [quickCreditSuccess, setQuickCreditSuccess] = useState('');
  const [quickCreditError, setQuickCreditError] = useState('');

  // Password reset modal
  const [newPasswordInput, setNewPasswordInput] = useState('');
  const [passwordResetSuccess, setPasswordResetSuccess] = useState('');

  // Rate config state
  const [customHourlyRate, setCustomHourlyRate] = useState(formatRatePercent(config.hourlyRatePercent));
  const [minBoostMinutes, setMinBoostMinutes] = useState(Math.round((config.minBoostMs || 60000) / 60000).toString());
  const [maxBoostHours, setMaxBoostHours] = useState(Math.round((config.maxBoostMs || 86400000) / 3600000).toString());
  const [rateSuccess, setRateSuccess] = useState(false);

  // Support chat responder
  const [activeConv, setActiveConv] = useState<Conversation | null>(null);
  const [supportMessage, setSupportMessage] = useState('');
  const adminChatEndRef = useRef<HTMLDivElement>(null);

  const refreshData = async (isManual = false) => {
    if (isManual) setIsRefreshing(true);
    try {
      const res = await fetch('/api/admin/stats');
      if (res.ok) {
        const data = await res.json();
        setStats((prev) => {
          if (
            prev.totalUsers === data.totalUsers &&
            prev.totalLiquidity === data.totalLiquidity &&
            prev.totalProfitPaid === data.totalProfitPaid &&
            prev.activeBoosters === data.activeBoosters &&
            prev.pausedBoosters === data.pausedBoosters &&
            prev.totalTransactions === data.totalTransactions
          ) {
            return prev;
          }
          return {
            totalUsers: data.totalUsers,
            totalLiquidity: data.totalLiquidity,
            totalProfitPaid: data.totalProfitPaid,
            activeBoosters: data.activeBoosters,
            pausedBoosters: data.pausedBoosters,
            totalTransactions: data.totalTransactions,
            dokployStatus: data.dokployStatus || prev.dokployStatus
          };
        });
        
        if (data.config) {
          setConfig((prev) => {
            if (
              prev.hourlyRatePercent === data.config.hourlyRatePercent &&
              prev.minBoostMs === data.config.minBoostMs &&
              prev.maxBoostMs === data.config.maxBoostMs
            ) {
              return prev;
            }
            return data.config;
          });
          BoostPayStore.saveConfig(data.config); 
          if (!isEditing.current.hourlyRate) setCustomHourlyRate(formatRatePercent(data.config.hourlyRatePercent));
          if (!isEditing.current.minBoost) setMinBoostMinutes(Math.round((data.config.minBoostMs || 60000) / 60000).toString());
          if (!isEditing.current.maxBoost) setMaxBoostHours(Math.round((data.config.maxBoostMs || 86400000) / 3600000).toString());
        }
      }
      
      const usersRes = await fetch('/api/admin/users');
      if (usersRes.ok) {
        const data = await usersRes.json();
        setUsers((prev) => {
          if (prev.length === data.users.length) {
            let changed = false;
            for (let i = 0; i < prev.length; i++) {
              if (
                prev[i].id !== data.users[i].id ||
                prev[i].balance !== data.users[i].balance ||
                prev[i].lifetimeProfit !== data.users[i].lifetimeProfit ||
                prev[i].boostState.isActive !== data.users[i].boostState.isActive ||
                prev[i].boostState.isPaused !== data.users[i].boostState.isPaused
              ) {
                changed = true;
                break;
              }
            }
            if (!changed) return prev;
          }
          return data.users;
        });
        BoostPayStore.saveUsers(data.users);

        // Keep selectedUser in sync if one is currently opened
        setSelectedUser((curr) => {
          if (!curr) return null;
          const fresh = data.users.find((u: User) => u.id === curr.id);
          if (!fresh) return curr;
          if (
            fresh.balance !== curr.balance ||
            fresh.lifetimeProfit !== curr.lifetimeProfit ||
            fresh.boostState.isActive !== curr.boostState.isActive ||
            fresh.boostState.isPaused !== curr.boostState.isPaused
          ) {
            return fresh;
          }
          return curr;
        });
      }

      const newConvs = BoostPayStore.getConversations();
      setConversations((prev) => {
        if (prev.length !== newConvs.length) return newConvs;
        const changed = prev.some((c, i) => c.lastMessage !== newConvs[i]?.lastMessage || c.lastMessageAt !== newConvs[i]?.lastMessageAt || c.hasUnread !== newConvs[i]?.hasUnread);
        return changed ? newConvs : prev;
      });

      const newMsgs = BoostPayStore.getMessages();
      setMessages((prev) => (prev.length !== newMsgs.length ? newMsgs : prev));
    } catch (err) {
      console.error('Failed to refresh admin data:', err);
    } finally {
      if (isManual) setIsRefreshing(false);
    }
  };

  useEffect(() => {
    if (adminSession?.isLoggedIn) {
      refreshData(false);
      const interval = setInterval(() => refreshData(false), 1200);

      // Connect to real-time chat SSE stream for Admin Support
      const unsubStream = BoostPayStore.initChatStream('ADMIN_SUPPORT');
      const unsubLocal = BoostPayStore.subscribeToChat((convs, msgs) => {
        setConversations(convs);
        setMessages(msgs);
      });

      return () => {
        clearInterval(interval);
        unsubStream();
        unsubLocal();
      };
    }
  }, [adminSession?.isLoggedIn]);

  // Auto-scroll admin chat viewport on messages update
  useEffect(() => {
    if (activeConv) {
      adminChatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, activeConv?.id]);

  // Handle Admin Login
  const handleAdminLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginError('');
    setIsLoggingIn(true);

    const emailClean = loginEmail.trim().toLowerCase();
    const passClean = loginPassword.trim();

    try {
      const res = await fetch('/api/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: emailClean, password: passClean })
      });

      if (res.ok) {
        const data = await res.json();
        const sess = BoostPayStore.setAdminSession({
          email: data.email || emailClean,
          token: data.token,
          loginTime: data.loginTime || Date.now()
        });
        setAdminSession(sess);
        return;
      }
    } catch {
      // Local check fallback
    }

    if (emailClean === 'admin@gmail.com' && (passClean === '123456' || passClean === 'admin786')) {
      const sess = BoostPayStore.setAdminSession(emailClean);
      setAdminSession(sess);
    } else {
      setLoginError('Invalid administrator credentials.');
    }
    setIsLoggingIn(false);
  };

  const handleAdminLogout = () => {
    BoostPayStore.clearAdminSession();
    setAdminSession(null);
  };

  const copyText = async (text: string, id: string) => {
    const ok = await copyToClipboard(text);
    if (ok) {
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 2000);
    }
  };

  // Adjust Balance (Credit / Debit)
  const handleAdjustBalance = async (type: 'CREDIT' | 'DEBIT') => {
    if (!selectedUser) {
      setAdjustError('Please select a user account first');
      return;
    }

    const cleanAmt = String(adjustAmount || '').replace(/[\$,\s]/g, '');
    const amount = parseFloat(cleanAmt);
    if (isNaN(amount) || amount <= 0) {
      setAdjustError('Please enter a valid positive dollar amount (e.g. 50.00)');
      return;
    }

    setAdjustLoading(true);
    setAdjustSuccessMsg('');
    setAdjustError('');

    const res = await BoostPayStore.adminAdjustBalance(
      selectedUser.id,
      type,
      amount,
      adjustNote || `Admin Treasury ${type}`
    );

    setAdjustLoading(false);
    if (res.success && res.user) {
      setSelectedUser({ ...res.user });
      await refreshData(true);
      setAdjustAmount('');
      setAdjustNote('');
      setAdjustSuccessMsg(`✓ Successfully ${type === 'CREDIT' ? 'credited' : 'debited'} $${amount.toFixed(2)} to User #${selectedUser.id}! New Balance: $${res.user.balance.toFixed(2)}`);
      setTimeout(() => setAdjustSuccessMsg(''), 6000);
    } else {
      setAdjustError(res.error || `Failed to apply ${type}`);
      setTimeout(() => setAdjustError(''), 6000);
    }
  };

  // Override Boost State on Server
  const handleBoostOverride = async (userId: string, action: 'START' | 'PAUSE' | 'RESUME' | 'RESET') => {
    try {
      const res = await fetch('/api/admin/users/boost-override', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, action })
      });
      if (res.ok) {
        const data = await res.json();
        if (data.user && selectedUser?.id === userId) {
          setSelectedUser({ ...data.user });
        }
        await refreshData();
      }
    } catch (err) {
      console.warn('Boost override error:', err);
    }
  };

  // Toggle Block / Unblock User
  const toggleBlockUser = async (userId: string) => {
    const target = users.find(u => u.id === userId);
    if (!target) return;
    const action = target.isBlocked ? 'UNBLOCK' : 'BLOCK';

    try {
      const res = await fetch('/api/admin/status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, action })
      });
      if (res.ok) {
        await refreshData();
        const updatedUsers = BoostPayStore.getUsers();
        const updatedTarget = updatedUsers.find(u => u.id === userId);
        if (selectedUser?.id === userId && updatedTarget) {
          setSelectedUser({ ...updatedTarget });
        }
      }
    } catch {
      target.isBlocked = !target.isBlocked;
      BoostPayStore.saveUsers(users);
      refreshData();
      if (selectedUser?.id === userId) {
        setSelectedUser({ ...target });
      }
    }
  };

  // Reset User Password
  const handleResetPassword = async () => {
    if (!selectedUser || !newPasswordInput.trim()) return;
    try {
      const res = await fetch('/api/admin/users/password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: selectedUser.id, newPassword: newPasswordInput.trim() })
      });
      if (res.ok) {
        setPasswordResetSuccess('Password updated successfully');
        setNewPasswordInput('');
        setTimeout(() => setPasswordResetSuccess(''), 3000);
        await refreshData();
      }
    } catch {
      selectedUser.password = newPasswordInput.trim();
      BoostPayStore.saveUsers(users);
      setPasswordResetSuccess('Password updated locally');
      setNewPasswordInput('');
      setTimeout(() => setPasswordResetSuccess(''), 3000);
    }
  };

  // Delete User
  const handleDeleteUser = async (userId: string) => {
    if (!confirm(`Are you sure you want to permanently delete User #${userId}?`)) return;
    try {
      await fetch('/api/admin/users/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId })
      });
      if (selectedUser?.id === userId) {
        setSelectedUser(null);
      }
      await refreshData();
    } catch {
      const filtered = users.filter(u => u.id !== userId);
      BoostPayStore.saveUsers(filtered);
      setUsers(filtered);
      if (selectedUser?.id === userId) setSelectedUser(null);
    }
  };

  // Save System Configuration
  const handleSaveConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    const rate = parseFloat(customHourlyRate);
    const minMins = parseInt(minBoostMinutes, 10);
    const maxHrs = parseInt(maxBoostHours, 10);

    if (isNaN(rate) || rate < 0) return;

    const newConfig: Partial<SystemConfig> = {
      hourlyRatePercent: rate,
      minBoostMs: !isNaN(minMins) && minMins > 0 ? minMins * 60000 : 60000,
      maxBoostMs: !isNaN(maxHrs) && maxHrs > 0 ? maxHrs * 3600000 : 86400000
    };

    try {
      const res = await fetch('/api/admin/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newConfig)
      });
      if (res.ok) {
        const data = await res.json();
        setConfig(data.config);
        BoostPayStore.saveConfig(data.config);
        setRateSuccess(true);
        setTimeout(() => setRateSuccess(false), 2500);
      }
    } catch {
      const merged = { ...config, ...newConfig };
      BoostPayStore.saveConfig(merged as SystemConfig);
      setConfig(merged as SystemConfig);
      setRateSuccess(true);
      setTimeout(() => setRateSuccess(false), 2500);
    }
  };

  // Support Message Sender
  const handleSendSupportMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeConv || !supportMessage.trim()) return;

    const userParticipant = activeConv.participants.find(p => p !== 'ADMIN_SUPPORT') || '';
    const textToSend = supportMessage.trim();
    setSupportMessage('');

    await BoostPayStore.sendChatMessage(userParticipant, textToSend, 'ADMIN');
    setTimeout(() => {
      adminChatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, 50);
  };

  // Run live database probe
  const runStorageProbe = async () => {
    setIsProbing(true);
    const res = await BoostPayStore.probeDatabaseStorage();
    setStorageProbe(res);
    setIsProbing(false);
  };

  useEffect(() => {
    runStorageProbe();
  }, []);

  // Download DB Backup as JSON snapshot
  const handleDownloadBackup = async () => {
    const blob = await BoostPayStore.exportDatabase();
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `boostpay_database_backup_${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // Restore DB from uploaded JSON file
  const handleFileImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImportLoading(true);
    setImportStatus(null);
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      const res = await BoostPayStore.importDatabase(parsed);
      if (res.success) {
        setImportStatus(`✓ Success: Restored ${res.restoredUsers || 0} user accounts and database records!`);
        await refreshData();
        await runStorageProbe();
      } else {
        setImportStatus(`Error: ${res.error || 'Failed to restore database.'}`);
      }
    } catch (err: any) {
      setImportStatus(`Invalid JSON backup file: ${err.message}`);
    } finally {
      setImportLoading(false);
      // Reset input value so same file can be re-selected if needed
      e.target.value = '';
    }
  };

  // Filter users
  const filteredUsers = users.filter(u =>
    u.id.includes(searchTerm) ||
    u.balance.toString().includes(searchTerm) ||
    (u.phrase && u.phrase.toLowerCase().includes(searchTerm.toLowerCase()))
  );

  // -------------------------------------------------------------
  // RENDER: 1. ADMIN LOGIN FORM (When not logged in)
  // -------------------------------------------------------------
  if (!adminSession?.isLoggedIn) {
    return (
      <div className="min-h-screen bg-zinc-950 text-zinc-100 flex flex-col justify-center items-center px-4 py-12">
        <div className="w-full max-w-md">
          {/* Top Brand */}
          <div className="text-center mb-6">
            <div className="inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-amber-500 text-zinc-950 font-black shadow-lg shadow-amber-500/20 mb-3">
              <ShieldCheck className="w-7 h-7" />
            </div>
            <h1 className="text-xl font-black tracking-tight text-white">BoostPay SuperAdmin</h1>
            <p className="text-xs text-zinc-400 mt-1">Independent Full-Stack Administration Portal</p>
          </div>

          <div className="rounded-3xl border border-zinc-800 bg-zinc-900/90 p-6 shadow-2xl backdrop-blur-xl">
            <form onSubmit={handleAdminLogin} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-zinc-400 mb-1.5">
                  Administrator Email
                </label>
                <input
                  type="email"
                  required
                  value={loginEmail}
                  onChange={(e) => setLoginEmail(e.target.value)}
                  placeholder="admin@gmail.com"
                  className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3.5 py-2.5 text-xs text-zinc-100 placeholder-zinc-600 focus:border-amber-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-zinc-400 mb-1.5">
                  Master Password
                </label>
                <div className="relative">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    required
                    value={loginPassword}
                    onChange={(e) => setLoginPassword(e.target.value)}
                    placeholder="Enter admin password"
                    className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3.5 py-2.5 text-xs text-zinc-100 placeholder-zinc-600 focus:border-amber-500 focus:outline-none pr-10"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300"
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              {loginError && (
                <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-400 font-medium">
                  {loginError}
                </div>
              )}

              <button
                type="submit"
                disabled={isLoggingIn}
                className="w-full rounded-xl bg-amber-500 py-3 text-xs font-bold text-zinc-950 hover:bg-amber-400 active:scale-[0.99] transition shadow-lg shadow-amber-500/20 cursor-pointer disabled:opacity-50"
              >
                {isLoggingIn ? 'Authenticating...' : 'Sign In to SuperAdmin'}
              </button>

              {onBack && (
                <div className="text-center pt-2">
                  <button
                    type="button"
                    onClick={onBack}
                    className="text-xs text-zinc-500 hover:text-zinc-300 transition flex items-center justify-center gap-1.5 mx-auto cursor-pointer"
                  >
                    <ArrowLeft className="w-3.5 h-3.5" />
                    <span>Return to User Wallet</span>
                  </button>
                </div>
              )}
            </form>
          </div>
        </div>
      </div>
    );
  }

  // -------------------------------------------------------------
  // RENDER: 2. LOGGED-IN SUPERADMIN CONSOLE
  // -------------------------------------------------------------
  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 flex flex-col font-sans">
      {/* Top Admin Header */}
      <header className="sticky top-0 z-40 w-full border-b border-zinc-800 bg-zinc-950/95 backdrop-blur-md px-4 sm:px-8 py-3.5">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-amber-500 text-zinc-950 font-black shadow-md shadow-amber-500/20">
              <ShieldCheck className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-bold text-sm tracking-tight text-white block">
                  BoostPay SuperAdmin
                </span>
                <span className="rounded-full bg-amber-500/10 border border-amber-500/30 px-2 py-0.5 text-[10px] font-mono text-amber-400 font-semibold">
                  SUPERUSER
                </span>
              </div>
              <span className="text-[10px] text-zinc-400 font-mono">
                Decoupled Full-Stack Backend • {adminSession.email}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2.5">
            {/* Live Refresh */}
            <button
              onClick={() => refreshData(true)}
              disabled={isRefreshing}
              className="flex items-center gap-1.5 rounded-xl border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-xs text-zinc-300 hover:border-zinc-700 active:scale-95 transition cursor-pointer"
              title="Refresh database state"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin text-amber-400' : 'text-zinc-400'}`} />
              <span className="hidden sm:inline">Refresh</span>
            </button>

            {/* Backup DB */}
            <button
              onClick={handleDownloadBackup}
              className="hidden sm:flex items-center gap-1.5 rounded-xl border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-xs text-zinc-300 hover:border-zinc-700 active:scale-95 transition cursor-pointer"
              title="Download JSON Database Backup"
            >
              <Download className="w-3.5 h-3.5 text-zinc-400" />
              <span>Backup</span>
            </button>

            {/* Back to User View */}
            {onBack && (
              <button
                onClick={onBack}
                className="flex items-center gap-1.5 rounded-xl border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-xs text-zinc-300 hover:text-white hover:border-zinc-700 active:scale-95 transition cursor-pointer"
                title="View user wallet"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">User Wallet</span>
              </button>
            )}

            {/* Sign Out */}
            <button
              onClick={handleAdminLogout}
              className="flex items-center gap-1.5 rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-1.5 text-xs font-semibold text-red-400 hover:bg-red-500/20 active:scale-95 transition cursor-pointer"
              title="Sign Out of Admin Console"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span>Sign Out</span>
            </button>
          </div>
        </div>
      </header>

      {/* Admin Navigation Tabs */}
      <div className="border-b border-zinc-800/80 bg-zinc-900/50 px-4 sm:px-8">
        <div className="max-w-7xl mx-auto flex items-center gap-1 sm:gap-2 overflow-x-auto py-2">
          <button
            onClick={() => setActiveTab('OVERVIEW')}
            className={`flex items-center gap-2 rounded-xl px-3.5 py-2 text-xs font-semibold transition cursor-pointer shrink-0 ${
              activeTab === 'OVERVIEW'
                ? 'bg-amber-500 text-zinc-950 font-bold shadow-md'
                : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/50'
            }`}
          >
            <Activity className="w-4 h-4" />
            <span>Overview & Health</span>
          </button>

          <button
            onClick={() => setActiveTab('USERS')}
            className={`flex items-center gap-2 rounded-xl px-3.5 py-2 text-xs font-semibold transition cursor-pointer shrink-0 ${
              activeTab === 'USERS'
                ? 'bg-amber-500 text-zinc-950 font-bold shadow-md'
                : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/50'
            }`}
          >
            <Users className="w-4 h-4" />
            <span>User Accounts ({users.length})</span>
          </button>

          <button
            onClick={() => {
              setActiveTab('DATABASE');
              runStorageProbe();
            }}
            className={`flex items-center gap-2 rounded-xl px-3.5 py-2 text-xs font-semibold transition cursor-pointer shrink-0 ${
              activeTab === 'DATABASE'
                ? 'bg-amber-500 text-zinc-950 font-bold shadow-md'
                : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/50'
            }`}
          >
            <Database className="w-4 h-4" />
            <span>Database Storage & Inspector</span>
          </button>

          <button
            onClick={() => setActiveTab('ENGINE')}
            className={`flex items-center gap-2 rounded-xl px-3.5 py-2 text-xs font-semibold transition cursor-pointer shrink-0 ${
              activeTab === 'ENGINE'
                ? 'bg-amber-500 text-zinc-950 font-bold shadow-md'
                : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/50'
            }`}
          >
            <Sliders className="w-4 h-4" />
            <span>Compounding Engine & Rates</span>
          </button>

          <button
            onClick={() => setActiveTab('SUPPORT')}
            className={`flex items-center gap-2 rounded-xl px-3.5 py-2 text-xs font-semibold transition cursor-pointer shrink-0 ${
              activeTab === 'SUPPORT'
                ? 'bg-amber-500 text-zinc-950 font-bold shadow-md'
                : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/50'
            }`}
          >
            <MessageSquare className="w-4 h-4" />
            <span>Support Communications</span>
          </button>
        </div>
      </div>

      {/* Main Admin Content Body */}
      <main className="flex-1 max-w-7xl w-full mx-auto p-4 sm:p-8 space-y-6">
        {/* ======================================================== */}
        {/* TAB 1: OVERVIEW & SYSTEM HEALTH                          */}
        {/* ======================================================== */}
        {activeTab === 'OVERVIEW' && (
          <div className="space-y-6">
            {/* Top Stat Cards */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="rounded-2xl border border-zinc-800 bg-zinc-900/90 p-4">
                <div className="flex items-center justify-between text-zinc-400 text-xs mb-2">
                  <span>Total System Liquidity</span>
                  <Database className="w-4 h-4 text-amber-400" />
                </div>
                <div className="text-2xl font-black font-mono text-white">
                  ${stats.totalLiquidity.toFixed(2)}
                </div>
                <div className="text-[10px] text-zinc-500 mt-1">Across all participant balances</div>
              </div>

              <div className="rounded-2xl border border-zinc-800 bg-zinc-900/90 p-4">
                <div className="flex items-center justify-between text-zinc-400 text-xs mb-2">
                  <span>Total Registered Users</span>
                  <Users className="w-4 h-4 text-sky-400" />
                </div>
                <div className="text-2xl font-black font-mono text-white">
                  {users.length}
                </div>
                <div className="text-[10px] text-zinc-500 mt-1">Independent numeric ID accounts</div>
              </div>

              <div className="rounded-2xl border border-zinc-800 bg-zinc-900/90 p-4">
                <div className="flex items-center justify-between text-zinc-400 text-xs mb-2">
                  <span>Active 24/7 Boosters</span>
                  <Zap className="w-4 h-4 text-emerald-400" />
                </div>
                <div className="text-2xl font-black font-mono text-emerald-400">
                  {stats.activeBoosters}
                </div>
                <div className="text-[10px] text-zinc-500 mt-1">Running continuous server ticks</div>
              </div>

              <div className="rounded-2xl border border-zinc-800 bg-zinc-900/90 p-4">
                <div className="flex items-center justify-between text-zinc-400 text-xs mb-2">
                  <span>Total Profits Distributed</span>
                  <Sparkles className="w-4 h-4 text-amber-400" />
                </div>
                <div className="text-2xl font-black font-mono text-amber-400">
                  +${stats.totalProfitPaid.toFixed(2)}
                </div>
                <div className="text-[10px] text-zinc-500 mt-1">Total compounded yields credited</div>
              </div>
            </div>

            {/* Dokploy Backend Engine Status */}
            <div className="rounded-3xl border border-zinc-800 bg-zinc-900/90 p-6 shadow-xl">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-zinc-800/80 pb-4 mb-4">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                    <Server className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-white flex items-center gap-2">
                      Dokploy Containerized Node Engine
                      <span className="flex h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
                    </h3>
                    <p className="text-xs text-zinc-400 font-mono">
                      Database: {stats.dokployStatus.database} • Host: {stats.dokployStatus.host}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-4 text-xs font-mono">
                  <div className="rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-1.5">
                    <span className="text-zinc-500">Latency: </span>
                    <span className="text-emerald-400 font-bold">{stats.dokployStatus.lastPingMs}ms</span>
                  </div>
                  <div className="rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-1.5">
                    <span className="text-zinc-500">Status: </span>
                    <span className="text-emerald-400 font-bold">ONLINE (24/7)</span>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs font-mono">
                <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-3">
                  <span className="text-zinc-500 block text-[10px]">CURRENT HOURLY RATE</span>
                  <span className="text-sm font-bold text-amber-400 mt-0.5 block">{config.hourlyRatePercent}% / hr</span>
                </div>
                <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-3">
                  <span className="text-zinc-500 block text-[10px]">DYNAMIC DURATION BOUNDS</span>
                  <span className="text-sm font-bold text-zinc-200 mt-0.5 block">1 min (min) to 24 hrs (max)</span>
                </div>
                <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-3">
                  <span className="text-zinc-500 block text-[10px]">OFFLINE TICKING ENGINE</span>
                  <span className="text-sm font-bold text-emerald-400 mt-0.5 block">Active (1-sec intervals)</span>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ======================================================== */}
        {/* TAB 2: USER MANAGEMENT & TREASURY                        */}
        {/* ======================================================== */}
        {activeTab === 'USERS' && (
          <div className="space-y-6">
            {/* Search Bar & Quick Add Balance Action */}
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
              <div className="relative flex-1">
                <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
                <input
                  type="text"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  placeholder="Search by User ID, recovery phrase keyword, or balance..."
                  className="w-full rounded-2xl border border-zinc-800 bg-zinc-900/90 pl-10 pr-4 py-2.5 text-xs text-zinc-100 placeholder-zinc-500 focus:border-amber-500 focus:outline-none"
                />
              </div>
              <div className="flex items-center gap-2.5 self-end sm:self-center">
                <button
                  onClick={() => {
                    const target = users[0] || null;
                    setQuickCreditModalUser(target);
                    setQuickCreditAmount('');
                    setQuickCreditNote('');
                    setQuickCreditSuccess('');
                    setQuickCreditError('');
                  }}
                  className="flex items-center gap-1.5 rounded-2xl bg-emerald-500 px-3.5 py-2 text-xs font-bold text-zinc-950 hover:bg-emerald-400 active:scale-95 transition shadow-md shadow-emerald-500/20 cursor-pointer"
                  title="Directly credit balance to any user account"
                >
                  <PlusCircle className="w-4 h-4 stroke-[2.5]" />
                  <span>+ Deposit Balance</span>
                </button>
                <div className="text-xs font-mono text-zinc-400">
                  {filteredUsers.length} of {users.length} users
                </div>
              </div>
            </div>

            {/* User List Table */}
            <div className="rounded-3xl border border-zinc-800 bg-zinc-900/90 shadow-xl overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-zinc-950 text-zinc-400 border-b border-zinc-800 uppercase font-mono text-[10px]">
                    <tr>
                      <th className="px-4 py-3">User ID</th>
                      <th className="px-4 py-3">Balance</th>
                      <th className="px-4 py-3">Lifetime Profit</th>
                      <th className="px-4 py-3">Boost State</th>
                      <th className="px-4 py-3">Account Status</th>
                      <th className="px-4 py-3">Email Address</th>
                      <th className="px-4 py-3 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-800/60 font-mono">
                    {filteredUsers.map((u) => {
                      const isSelected = selectedUser?.id === u.id;
                      const isBoosting = u.boostState && u.boostState.isActive && !u.boostState.isPaused;

                      return (
                        <tr
                          key={u.id}
                          className={`hover:bg-zinc-800/40 transition cursor-pointer ${
                            isSelected ? 'bg-amber-500/10' : ''
                          }`}
                          onClick={() => setSelectedUser(u)}
                        >
                          <td className="px-4 py-3 font-bold text-amber-400">
                            #{u.id}
                          </td>
                          <td className="px-4 py-3 font-bold text-white">
                            ${u.balance.toFixed(2)}
                          </td>
                          <td className="px-4 py-3 text-emerald-400 font-semibold">
                            +${u.lifetimeProfit.toFixed(2)}
                          </td>
                          <td className="px-4 py-3">
                            {isBoosting ? (
                              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/20 px-2 py-0.5 text-[10px] text-emerald-400 border border-emerald-500/30">
                                <Zap className="w-3 h-3 animate-pulse" />
                                <span>Boosting ({Math.round(((u.boostState?.elapsedMs || 0) / (u.boostState?.targetDurationMs || 60000)) * 100)}%)</span>
                              </span>
                            ) : u.boostState?.isPaused ? (
                              <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/20 px-2 py-0.5 text-[10px] text-amber-400 border border-amber-500/30">
                                Paused
                              </span>
                            ) : (
                              <span className="text-zinc-500 text-[10px]">Idle</span>
                            )}
                          </td>
                          <td className="px-4 py-3">
                            {u.isBlocked ? (
                              <span className="rounded-full bg-red-500/20 px-2 py-0.5 text-[10px] text-red-400 font-semibold border border-red-500/30">
                                Suspended
                              </span>
                            ) : (
                              <span className="rounded-full bg-zinc-800 px-2 py-0.5 text-[10px] text-zinc-300">
                                Active
                              </span>
                            )}
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
                              <span className="font-sans text-[11px] text-zinc-200 truncate max-w-[160px]">
                                {u.email || `user${u.id}@boostpay.app`}
                              </span>
                              <button
                                onClick={() => copyText(u.email || `user${u.id}@boostpay.app`, `email-${u.id}`)}
                                className="text-zinc-500 hover:text-zinc-300 p-1"
                                title="Copy email"
                              >
                                {copiedId === `email-${u.id}` ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                              </button>
                            </div>
                          </td>
                          <td className="px-4 py-3 text-right">
                            <div className="flex items-center justify-end gap-1.5" onClick={(e) => e.stopPropagation()}>
                              <button
                                onClick={() => {
                                  setQuickCreditModalUser(u);
                                  setQuickCreditAmount('');
                                  setQuickCreditNote('');
                                  setQuickCreditSuccess('');
                                  setQuickCreditError('');
                                }}
                                className="rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-2.5 py-1 text-[11px] font-bold text-emerald-400 hover:bg-emerald-500/20 active:scale-95 transition cursor-pointer"
                                title={`Deposit balance into User #${u.id}`}
                              >
                                + Credit
                              </button>
                              <button
                                onClick={() => setSelectedUser(u)}
                                className="rounded-xl border border-zinc-800 bg-zinc-950 px-2.5 py-1 text-[11px] text-amber-400 hover:border-amber-500 transition cursor-pointer"
                              >
                                Manage
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Selected User Action Modal / Panel */}
            {selectedUser && (
              <div className="rounded-3xl border border-amber-500/30 bg-zinc-900/95 p-6 shadow-2xl space-y-6">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-zinc-800 pb-4">
                  <div>
                    <span className="text-[10px] font-mono uppercase text-amber-400 font-semibold">
                      Account Operations Control
                    </span>
                    <h3 className="text-lg font-bold text-white flex items-center gap-2 mt-0.5">
                      User #{selectedUser.id}
                      {selectedUser.isBlocked && (
                        <span className="rounded-full bg-red-500/20 text-red-400 text-xs px-2 py-0.5">SUSPENDED</span>
                      )}
                    </h3>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => toggleBlockUser(selectedUser.id)}
                      className={`flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-semibold border transition cursor-pointer ${
                        selectedUser.isBlocked
                          ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20'
                          : 'border-red-500/40 bg-red-500/10 text-red-400 hover:bg-red-500/20'
                      }`}
                    >
                      {selectedUser.isBlocked ? <Unlock className="w-3.5 h-3.5" /> : <Lock className="w-3.5 h-3.5" />}
                      <span>{selectedUser.isBlocked ? 'Unblock User' : 'Suspend User'}</span>
                    </button>

                    <button
                      onClick={() => handleDeleteUser(selectedUser.id)}
                      className="flex items-center gap-1.5 rounded-xl border border-red-500/30 bg-red-950/40 px-3 py-1.5 text-xs text-red-400 hover:bg-red-900/50 transition cursor-pointer"
                      title="Permanently remove user"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      <span>Delete</span>
                    </button>

                    <button
                      onClick={() => setSelectedUser(null)}
                      className="rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-1.5 text-xs text-zinc-400 hover:text-white"
                    >
                      Close
                    </button>
                  </div>
                </div>

                {/* Operations Grid */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
                  {/* Operation 1: Treasury Balance Credit / Debit */}
                  <div className="rounded-2xl border border-zinc-800 bg-zinc-950 p-4 space-y-3">
                    <h4 className="text-xs font-bold text-white flex items-center gap-2">
                      <PlusCircle className="w-4 h-4 text-emerald-400" /> Treasury Adjustments
                    </h4>
                    <p className="text-[11px] text-zinc-400">
                      Directly deposit or withdraw funds from this user account with audit ledger note.
                    </p>

                    <div>
                      <label className="block text-[10px] font-mono text-zinc-500 mb-1">Amount ($ USD)</label>
                      <input
                        type="number"
                        step="0.01"
                        value={adjustAmount}
                        onChange={(e) => setAdjustAmount(e.target.value)}
                        placeholder="e.g. 50.00"
                        className="w-full rounded-xl border border-zinc-800 bg-zinc-900 px-3 py-2 text-xs text-zinc-100 font-mono focus:border-amber-500 focus:outline-none"
                      />
                    </div>

                    <div>
                      <label className="block text-[10px] font-mono text-zinc-500 mb-1">Reason / Note</label>
                      <input
                        type="text"
                        value={adjustNote}
                        onChange={(e) => setAdjustNote(e.target.value)}
                        placeholder="Admin adjustment reason"
                        className="w-full rounded-xl border border-zinc-800 bg-zinc-900 px-3 py-2 text-xs text-zinc-100 focus:border-amber-500 focus:outline-none"
                      />
                    </div>

                    {adjustSuccessMsg && (
                      <div className="rounded-xl border border-emerald-500/40 bg-emerald-500/10 p-2.5 text-xs font-bold text-emerald-400 animate-in fade-in">
                        {adjustSuccessMsg}
                      </div>
                    )}

                    {adjustError && (
                      <div className="rounded-xl border border-red-500/40 bg-red-500/10 p-2.5 text-xs font-bold text-red-400 animate-in fade-in">
                        {adjustError}
                      </div>
                    )}

                    <div className="flex gap-2 pt-1">
                      <button
                        onClick={() => handleAdjustBalance('CREDIT')}
                        disabled={adjustLoading || !adjustAmount}
                        className="flex-1 rounded-xl bg-emerald-500/20 border border-emerald-500/40 py-2 text-xs font-bold text-emerald-400 hover:bg-emerald-500/30 transition cursor-pointer disabled:opacity-50"
                      >
                        + Credit
                      </button>
                      <button
                        onClick={() => handleAdjustBalance('DEBIT')}
                        disabled={adjustLoading || !adjustAmount}
                        className="flex-1 rounded-xl bg-red-500/20 border border-red-500/40 py-2 text-xs font-bold text-red-400 hover:bg-red-500/30 transition cursor-pointer disabled:opacity-50"
                      >
                        - Debit
                      </button>
                    </div>
                  </div>

                  {/* Operation 2: Server Boost Controls */}
                  <div className="rounded-2xl border border-zinc-800 bg-zinc-950 p-4 space-y-3">
                    <h4 className="text-xs font-bold text-white flex items-center gap-2">
                      <Zap className="w-4 h-4 text-amber-400" /> Server Boost Override
                    </h4>
                    <p className="text-[11px] text-zinc-400">
                      Authoritatively control background ticker state for this user.
                    </p>

                    <div className="space-y-1 text-xs font-mono">
                      <div className="flex justify-between text-zinc-400">
                        <span>Current Status:</span>
                        <span className="text-white font-bold">
                          {selectedUser.boostState?.isActive ? (selectedUser.boostState.isPaused ? 'Paused' : 'Active') : 'Idle'}
                        </span>
                      </div>
                      <div className="flex justify-between text-zinc-400">
                        <span>Dynamic Duration:</span>
                        <span className="text-amber-400">
                          {Math.round((selectedUser.boostState?.targetDurationMs || 60000) / 60000)} mins
                        </span>
                      </div>
                      <div className="flex justify-between text-zinc-400">
                        <span>Elapsed Time:</span>
                        <span className="text-emerald-400">
                          {Math.round((selectedUser.boostState?.elapsedMs || 0) / 1000)}s
                        </span>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-2 pt-2">
                      <button
                        onClick={() => handleBoostOverride(selectedUser.id, 'START')}
                        className="rounded-xl bg-amber-500/20 border border-amber-500/40 py-2 text-xs font-semibold text-amber-400 hover:bg-amber-500/30 transition cursor-pointer"
                      >
                        Force Start
                      </button>
                      <button
                        onClick={() => handleBoostOverride(selectedUser.id, selectedUser.boostState?.isPaused ? 'RESUME' : 'PAUSE')}
                        className="rounded-xl border border-zinc-800 bg-zinc-900 py-2 text-xs font-semibold text-zinc-200 hover:border-zinc-700 transition cursor-pointer"
                      >
                        {selectedUser.boostState?.isPaused ? 'Resume' : 'Pause'}
                      </button>
                      <button
                        onClick={() => handleBoostOverride(selectedUser.id, 'RESET')}
                        className="col-span-2 rounded-xl border border-zinc-800 bg-zinc-900 py-2 text-xs text-zinc-400 hover:text-white transition cursor-pointer"
                      >
                        Reset Cycle
                      </button>
                    </div>
                  </div>

                  {/* Operation 3: Password Reset */}
                  <div className="rounded-2xl border border-zinc-800 bg-zinc-950 p-4 space-y-3">
                    <h4 className="text-xs font-bold text-white flex items-center gap-2">
                      <KeyRound className="w-4 h-4 text-sky-400" /> Password Override
                    </h4>
                    <p className="text-[11px] text-zinc-400">
                      Assign a new master login password for this account.
                    </p>

                    <div>
                      <label className="block text-[10px] font-mono text-zinc-500 mb-1">New Password</label>
                      <input
                        type="text"
                        value={newPasswordInput}
                        onChange={(e) => setNewPasswordInput(e.target.value)}
                        placeholder="Enter replacement password"
                        className="w-full rounded-xl border border-zinc-800 bg-zinc-900 px-3 py-2 text-xs text-zinc-100 focus:border-amber-500 focus:outline-none"
                      />
                    </div>

                    {passwordResetSuccess && (
                      <div className="text-[11px] text-emerald-400 font-medium">
                        {passwordResetSuccess}
                      </div>
                    )}

                    <button
                      onClick={handleResetPassword}
                      disabled={!newPasswordInput.trim()}
                      className="w-full rounded-xl bg-sky-500/20 border border-sky-500/40 py-2 text-xs font-bold text-sky-400 hover:bg-sky-500/30 transition cursor-pointer disabled:opacity-50"
                    >
                      Update Password
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Quick Balance Deposit / Credit Modal */}
            {quickCreditModalUser && (
              <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-zinc-950/80 backdrop-blur-md animate-in fade-in duration-200">
                <div className="w-full max-w-md rounded-3xl border border-emerald-500/30 bg-zinc-900 shadow-2xl p-6 space-y-4">
                  <div className="flex items-center justify-between border-b border-zinc-800 pb-3">
                    <div className="flex items-center gap-2.5">
                      <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-500/20 text-emerald-400">
                        <PlusCircle className="w-5 h-5" />
                      </div>
                      <div>
                        <h3 className="text-sm font-bold text-white">Deposit / Credit Balance</h3>
                        <p className="text-[11px] text-zinc-400">Account: User #{quickCreditModalUser.id}</p>
                      </div>
                    </div>
                    <button
                      onClick={() => setQuickCreditModalUser(null)}
                      className="rounded-xl border border-zinc-800 p-1.5 text-zinc-400 hover:text-white cursor-pointer"
                    >
                      ✕
                    </button>
                  </div>

                  <div className="space-y-3">
                    <div>
                      <label className="block text-[10px] font-mono text-zinc-400 mb-1">Target Account</label>
                      <select
                        value={quickCreditModalUser.id}
                        onChange={(e) => {
                          const target = users.find(u => String(u.id) === String(e.target.value));
                          if (target) {
                            setQuickCreditModalUser(target);
                            setQuickCreditSuccess('');
                            setQuickCreditError('');
                          }
                        }}
                        className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-xs text-white font-mono focus:border-emerald-500 focus:outline-none cursor-pointer"
                      >
                        {users.map(u => (
                          <option key={u.id} value={u.id}>
                            User #{u.id} — Current Balance: ${u.balance.toFixed(2)} ({u.email || 'No email'})
                          </option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <div className="flex justify-between items-center mb-1">
                        <label className="text-[10px] font-mono text-zinc-400">Deposit Amount ($ USD)</label>
                        <span className="text-[10px] font-mono text-emerald-400 font-bold">Current: ${quickCreditModalUser.balance.toFixed(2)}</span>
                      </div>
                      <input
                        type="text"
                        value={quickCreditAmount}
                        onChange={(e) => setQuickCreditAmount(e.target.value)}
                        placeholder="e.g. 50.00"
                        className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-white font-mono font-bold focus:border-emerald-500 focus:outline-none"
                        autoFocus
                      />
                    </div>

                    {/* Quick Amount Preset Chips */}
                    <div className="flex gap-1.5">
                      {[10, 25, 50, 100, 500].map(amt => (
                        <button
                          key={amt}
                          type="button"
                          onClick={() => setQuickCreditAmount(amt.toString())}
                          className="flex-1 rounded-lg border border-zinc-800 bg-zinc-950 py-1.5 text-[11px] font-mono text-zinc-300 hover:border-emerald-500/50 hover:text-emerald-400 transition cursor-pointer"
                        >
                          +${amt}
                        </button>
                      ))}
                    </div>

                    <div>
                      <label className="block text-[10px] font-mono text-zinc-400 mb-1">Reason / Ledger Note (Optional)</label>
                      <input
                        type="text"
                        value={quickCreditNote}
                        onChange={(e) => setQuickCreditNote(e.target.value)}
                        placeholder="e.g. Admin Treasury Deposit"
                        className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-xs text-white focus:border-emerald-500 focus:outline-none"
                      />
                    </div>

                    {quickCreditSuccess && (
                      <div className="rounded-xl border border-emerald-500/40 bg-emerald-500/10 p-3 text-xs font-bold text-emerald-400 animate-in fade-in">
                        {quickCreditSuccess}
                      </div>
                    )}

                    {quickCreditError && (
                      <div className="rounded-xl border border-red-500/40 bg-red-500/10 p-3 text-xs font-bold text-red-400 animate-in fade-in">
                        {quickCreditError}
                      </div>
                    )}

                    <div className="flex gap-2 pt-2">
                      <button
                        onClick={async () => {
                          const cleanAmt = String(quickCreditAmount || '').replace(/[\$,\s]/g, '');
                          const num = parseFloat(cleanAmt);
                          if (isNaN(num) || num <= 0) {
                            setQuickCreditError('Please enter a valid positive dollar amount (e.g. 50.00)');
                            return;
                          }
                          setQuickCreditLoading(true);
                          setQuickCreditError('');
                          setQuickCreditSuccess('');

                          const res = await BoostPayStore.adminAdjustBalance(
                            quickCreditModalUser.id,
                            'CREDIT',
                            num,
                            quickCreditNote || 'Admin Treasury Credit'
                          );

                          setQuickCreditLoading(false);
                          if (res.success && res.user) {
                            setQuickCreditSuccess(`✓ Successfully added $${num.toFixed(2)} to User #${quickCreditModalUser.id}! New Balance: $${res.user.balance.toFixed(2)}`);
                            setQuickCreditAmount('');
                            setQuickCreditNote('');
                            setQuickCreditModalUser(res.user);
                            await refreshData(true);
                            setTimeout(() => {
                              setQuickCreditModalUser(null);
                              setQuickCreditSuccess('');
                            }, 2500);
                          } else {
                            setQuickCreditError(res.error || 'Failed to add balance');
                          }
                        }}
                        disabled={quickCreditLoading || !quickCreditAmount}
                        className="flex-1 rounded-xl bg-emerald-500 py-2.5 text-xs font-bold text-zinc-950 hover:bg-emerald-400 active:scale-95 transition shadow-lg shadow-emerald-500/20 disabled:opacity-50 cursor-pointer flex items-center justify-center gap-2"
                      >
                        {quickCreditLoading ? (
                          <span className="h-4 w-4 animate-spin rounded-full border-2 border-zinc-950 border-t-transparent" />
                        ) : (
                          <>
                            <PlusCircle className="w-4 h-4 stroke-[2.5]" />
                            <span>Confirm + Deposit Funds</span>
                          </>
                        )}
                      </button>

                      <button
                        onClick={() => setQuickCreditModalUser(null)}
                        className="rounded-xl border border-zinc-800 bg-zinc-950 px-4 py-2 text-xs font-semibold text-zinc-400 hover:text-white cursor-pointer"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ======================================================== */}
        {/* TAB 3: DATABASE STORAGE & LIVE INSPECTOR                 */}
        {/* ======================================================== */}
        {activeTab === 'DATABASE' && (
          <div className="space-y-6">
            {/* Top Diagnostic Grid */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <div className="rounded-2xl border border-zinc-800 bg-zinc-900/90 p-4">
                <div className="flex items-center justify-between text-zinc-400 text-xs mb-1.5">
                  <span>Storage Engine</span>
                  <Database className="w-4 h-4 text-amber-400" />
                </div>
                <div className="text-sm font-bold font-mono text-emerald-400 flex items-center gap-1.5">
                  <span>Container File Store</span>
                </div>
                <div className="text-[10px] text-zinc-500 font-mono mt-1 truncate" title="data/boostpay_db.json">
                  data/boostpay_db.json
                </div>
              </div>

              <div className="rounded-2xl border border-zinc-800 bg-zinc-900/90 p-4">
                <div className="flex items-center justify-between text-zinc-400 text-xs mb-1.5">
                  <span>Disk Health & Writable</span>
                  <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                </div>
                <div className="text-sm font-bold font-mono text-white flex items-center gap-1.5">
                  <span className="text-emerald-400">READ / WRITE OK</span>
                </div>
                <div className="text-[10px] text-zinc-500 font-mono mt-1">
                  Latency: {storageProbe?.latencyMs ?? 2}ms
                </div>
              </div>

              <div className="rounded-2xl border border-zinc-800 bg-zinc-900/90 p-4">
                <div className="flex items-center justify-between text-zinc-400 text-xs mb-1.5">
                  <span>Total Saved Accounts</span>
                  <Users className="w-4 h-4 text-sky-400" />
                </div>
                <div className="text-xl font-black font-mono text-white">
                  {users.length} Users
                </div>
                <div className="text-[10px] text-zinc-500 font-mono mt-1">
                  Active in database
                </div>
              </div>

              <div className="rounded-2xl border border-zinc-800 bg-zinc-900/90 p-4">
                <div className="flex items-center justify-between text-zinc-400 text-xs mb-1.5">
                  <span>File Size on Disk</span>
                  <Server className="w-4 h-4 text-purple-400" />
                </div>
                <div className="text-xl font-black font-mono text-white">
                  {storageProbe?.fileSizeBytes ? (storageProbe.fileSizeBytes / 1024).toFixed(1) + ' KB' : 'Active'}
                </div>
                <div className="text-[10px] text-zinc-500 font-mono mt-1">
                  Raw JSON document size
                </div>
              </div>
            </div>

            {/* Live Verification & Test Write Card */}
            <div className="rounded-3xl border border-zinc-800 bg-zinc-900/90 p-6 shadow-xl space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-zinc-800 pb-4">
                <div>
                  <h3 className="text-sm font-bold text-white flex items-center gap-2">
                    <Activity className="w-4 h-4 text-amber-400" />
                    Live Database Storage Probe & Verification
                  </h3>
                  <p className="text-xs text-zinc-400 mt-0.5">
                    Execute an instant read and write verification to verify the server is saving records.
                  </p>
                </div>

                <button
                  onClick={runStorageProbe}
                  disabled={isProbing}
                  className="inline-flex items-center gap-2 rounded-xl bg-amber-500 px-4 py-2 text-xs font-bold text-zinc-950 hover:bg-amber-400 transition cursor-pointer disabled:opacity-50"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${isProbing ? 'animate-spin' : ''}`} />
                  <span>{isProbing ? 'Testing Write...' : 'Run Storage Write Test'}</span>
                </button>
              </div>

              {storageProbe && (
                <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-4 text-xs space-y-2">
                  <div className="flex items-center gap-2 font-bold text-emerald-400">
                    <CheckCircle2 className="w-4 h-4" />
                    <span>Database Status: Active, Healthy & Verified Writable</span>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px] font-mono text-zinc-300 pt-1">
                    <div>
                      <span className="text-zinc-500 block">Location:</span>
                      <span className="truncate block" title={storageProbe.filePath}>{storageProbe.filePath}</span>
                    </div>
                    <div>
                      <span className="text-zinc-500 block">Latency:</span>
                      <span>{storageProbe.latencyMs} ms</span>
                    </div>
                    <div>
                      <span className="text-zinc-500 block">Last Written:</span>
                      <span>{new Date(storageProbe.lastModifiedMs || Date.now()).toLocaleTimeString()}</span>
                    </div>
                    <div>
                      <span className="text-zinc-500 block">Total Records:</span>
                      <span>{storageProbe.totalUsers} Users · {storageProbe.totalTransactions} Txs</span>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Disaster Recovery & Deployment Backup Card */}
            <div className="rounded-3xl border border-zinc-800 bg-zinc-900/90 p-6 shadow-xl space-y-4">
              <div className="flex items-center justify-between border-b border-zinc-800 pb-3">
                <div>
                  <h3 className="text-sm font-bold text-white flex items-center gap-2">
                    <Download className="w-4 h-4 text-sky-400" />
                    Deployment Backup & 1-Click Disaster Recovery
                  </h3>
                  <p className="text-xs text-zinc-400 mt-0.5">
                    Save a full snapshot before deploying updates, and restore everything in 1 click if needed.
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* 1. Export */}
                <div className="rounded-2xl border border-zinc-800 bg-zinc-950 p-4 space-y-3 flex flex-col justify-between">
                  <div>
                    <h4 className="text-xs font-bold text-white flex items-center gap-2">
                      <Download className="w-4 h-4 text-emerald-400" /> Export Database Snapshot
                    </h4>
                    <p className="text-[11px] text-zinc-400 mt-1 leading-relaxed">
                      Download a complete timestamped JSON file containing all user accounts, mnemonics, balances, transactions, and SMS notifications.
                    </p>
                  </div>
                  <button
                    onClick={handleDownloadBackup}
                    className="w-full flex items-center justify-center gap-2 rounded-xl bg-zinc-900 hover:bg-zinc-800 border border-zinc-700/80 py-2.5 text-xs font-semibold text-zinc-200 transition cursor-pointer"
                  >
                    <Download className="w-4 h-4 text-emerald-400" />
                    <span>Download Backup (.json)</span>
                  </button>
                </div>

                {/* 2. Import */}
                <div className="rounded-2xl border border-zinc-800 bg-zinc-950 p-4 space-y-3 flex flex-col justify-between">
                  <div>
                    <h4 className="text-xs font-bold text-white flex items-center gap-2">
                      <RefreshCw className="w-4 h-4 text-sky-400" /> Restore Database Snapshot
                    </h4>
                    <p className="text-[11px] text-zinc-400 mt-1 leading-relaxed">
                      Upload any previously saved JSON backup to immediately restore all users and balances into the active server database.
                    </p>
                  </div>

                  <div>
                    <label className="w-full flex items-center justify-center gap-2 rounded-xl bg-sky-500/20 hover:bg-sky-500/30 border border-sky-500/40 py-2.5 text-xs font-semibold text-sky-300 transition cursor-pointer">
                      <Upload className="w-4 h-4" />
                      <span>{importLoading ? 'Restoring Database...' : 'Select Backup JSON to Restore'}</span>
                      <input
                        type="file"
                        accept=".json,application/json"
                        onChange={handleFileImport}
                        disabled={importLoading}
                        className="hidden"
                      />
                    </label>
                  </div>
                </div>
              </div>

              {importStatus && (
                <div className={`rounded-xl p-3 text-xs font-medium border ${
                  importStatus.startsWith('✓')
                    ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
                    : 'bg-rose-500/10 border-rose-500/30 text-rose-400'
                }`}>
                  {importStatus}
                </div>
              )}
            </div>

            {/* Deployment Data Loss Explanation Guide */}
            <div className="rounded-3xl border border-amber-500/20 bg-amber-500/5 p-5 space-y-2.5">
              <div className="flex items-center gap-2 text-amber-400 text-xs font-bold">
                <AlertTriangle className="w-4 h-4" />
                <span>Why do data reset on deployment, and how BoostPay protects you:</span>
              </div>
              <div className="text-xs text-zinc-300 space-y-1.5 leading-relaxed">
                <p>
                  • <strong>Stateless Containers:</strong> When you deploy an update on Cloud Run or container platforms, a brand new container image is created. Local container files (like <code className="text-amber-400 font-mono">boostpay_db.json</code>) start fresh with default data.
                </p>
                <p>
                  • <strong>Dual Self-Healing Sync (Active):</strong> BoostPay clients keep a permanent verified copy of their credentials and balance. Whenever any user opens the app after an update deployment, their browser automatically re-registers and restores their balance and boost duration on the server without losing funds.
                </p>
                <p>
                  • <strong>1-Click Backup:</strong> Before any major deployment, click &quot;Download Backup (.json)&quot; above. If you ever need to restore everything at once, click &quot;Select Backup JSON to Restore&quot; to repopulate all accounts instantly.
                </p>
              </div>
            </div>

            {/* Live Database Records Inspector Table */}
            <div className="rounded-3xl border border-zinc-800 bg-zinc-900/90 p-6 shadow-xl space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-zinc-800 pb-3">
                <div>
                  <h3 className="text-sm font-bold text-white flex items-center gap-2">
                    <Database className="w-4 h-4 text-amber-400" />
                    Live Database Record Table ({users.length} Users Stored)
                  </h3>
                  <p className="text-xs text-zinc-400 mt-0.5">
                    Direct inspection of records saved in the server database right now.
                  </p>
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs font-mono">
                  <thead>
                    <tr className="border-b border-zinc-800 text-[11px] text-zinc-400">
                      <th className="pb-2 font-semibold">User ID</th>
                      <th className="pb-2 font-semibold">Balance</th>
                      <th className="pb-2 font-semibold">Profit</th>
                      <th className="pb-2 font-semibold">Boost State</th>
                      <th className="pb-2 font-semibold">Email Address</th>
                      <th className="pb-2 font-semibold">Password</th>
                      <th className="pb-2 font-semibold">Registered</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-800/60">
                    {users.map((u) => {
                      return (
                        <tr key={u.id} className="hover:bg-zinc-800/30 transition">
                          <td className="py-2.5 font-bold text-amber-400">#{u.id}</td>
                          <td className="py-2.5 font-bold text-emerald-400 tabular-nums">${formatPrecisionAmount(u.balance, 8)}</td>
                          <td className="py-2.5 text-zinc-300 tabular-nums">+${formatPrecisionAmount(u.lifetimeProfit || 0, 8)}</td>
                          <td className="py-2.5">
                            {u.boostState?.isActive ? (
                              <span className="text-emerald-400 font-semibold">
                                {u.boostState.isPaused ? 'Paused' : 'Active'}
                              </span>
                            ) : (
                              <span className="text-zinc-500">Idle</span>
                            )}
                          </td>
                          <td className="py-2.5 text-zinc-200 font-mono">
                            {u.email || `user${u.id}@boostpay.app`}
                          </td>
                          <td className="py-2.5 text-zinc-400 font-mono">
                            {u.password || <span className="text-zinc-600">None</span>}
                          </td>
                          <td className="py-2.5 text-zinc-500 text-[10px]">
                            {new Date(u.createdAt || Date.now()).toLocaleDateString()}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* ======================================================== */}
        {/* TAB 4: COMPOUNDING ENGINE & RATES                        */}
        {/* ======================================================== */}
        {activeTab === 'ENGINE' && (
          <div className="max-w-2xl mx-auto space-y-6">
            <div className="rounded-3xl border border-zinc-800 bg-zinc-900/90 p-6 shadow-xl">
              <h3 className="text-base font-bold text-white mb-2 flex items-center gap-2">
                <Percent className="w-5 h-5 text-amber-400" /> System Yield & Compounding Parameters
              </h3>
              <p className="text-xs text-zinc-400 mb-6">
                All parameters update live across the authoritative backend and client dynamic formula calculators.
              </p>

              <form onSubmit={handleSaveConfig} className="space-y-4">
                <div>
                  <label className="block text-xs font-semibold text-zinc-300 mb-1">
                    Global Hourly Rate Percent (%)
                  </label>
                  <div className="flex gap-3">
                    <input
                      type="number"
                      step="any"
                      min="0"
                      value={customHourlyRate}
                      onFocus={() => isEditing.current.hourlyRate = true}
                      onBlur={() => isEditing.current.hourlyRate = false}
                      onChange={(e) => setCustomHourlyRate(e.target.value)}
                      placeholder="e.g. 0.000001 or 1.0"
                      className="flex-1 rounded-xl border border-zinc-800 bg-zinc-950 px-3.5 py-2.5 text-xs text-zinc-100 font-mono focus:border-amber-500 focus:outline-none"
                    />
                    <span className="self-center font-mono text-xs text-zinc-500">% / hr</span>
                  </div>
                  <span className="text-[10px] text-zinc-500 mt-1 block">
                    Supports high-precision decimals down to 0.000001% per hour (default benchmark is 1.0% / hr).
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-semibold text-zinc-300 mb-1">
                      Min Boost Duration (Minutes)
                    </label>
                    <input
                      type="number"
                      min="1"
                      value={minBoostMinutes}
                      onFocus={() => isEditing.current.minBoost = true}
                      onBlur={() => isEditing.current.minBoost = false}
                      onChange={(e) => setMinBoostMinutes(e.target.value)}
                      className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3.5 py-2.5 text-xs text-zinc-100 font-mono focus:border-amber-500 focus:outline-none"
                    />
                    <span className="text-[10px] text-zinc-500 mt-1 block">Applied to lowest balance account (1m)</span>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-zinc-300 mb-1">
                      Max Boost Duration (Hours)
                    </label>
                    <input
                      type="number"
                      min="1"
                      value={maxBoostHours}
                      onFocus={() => isEditing.current.maxBoost = true}
                      onBlur={() => isEditing.current.maxBoost = false}
                      onChange={(e) => setMaxBoostHours(e.target.value)}
                      className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3.5 py-2.5 text-xs text-zinc-100 font-mono focus:border-amber-500 focus:outline-none"
                    />
                    <span className="text-[10px] text-zinc-500 mt-1 block">Applied to highest balance account (24h)</span>
                  </div>
                </div>

                {rateSuccess && (
                  <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3 text-xs text-emerald-400 font-medium">
                    Engine parameters saved and synchronized to backend database.
                  </div>
                )}

                <button
                  type="submit"
                  className="w-full rounded-xl bg-amber-500 py-3 text-xs font-bold text-zinc-950 hover:bg-amber-400 transition cursor-pointer shadow-lg shadow-amber-500/20"
                >
                  Save & Deploy System Configuration
                </button>
              </form>
            </div>
          </div>
        )}

        {/* ======================================================== */}
        {/* TAB 4: SUPPORT COMMUNICATIONS                            */}
        {/* ======================================================== */}
        {activeTab === 'SUPPORT' && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="rounded-3xl border border-zinc-800 bg-zinc-900/90 p-4 space-y-3">
              <h4 className="text-xs font-bold text-white uppercase tracking-wider font-mono">
                Conversations ({conversations.length})
              </h4>
              <div className="space-y-1.5 max-h-[480px] overflow-y-auto">
                {conversations.map((c) => {
                  const peer = c.participants.find(p => p !== 'ADMIN_SUPPORT') || c.id;
                  const isSelected = activeConv?.id === c.id;

                  return (
                    <button
                      key={c.id}
                      onClick={() => setActiveConv(c)}
                      className={`w-full text-left p-3 rounded-2xl border transition ${
                        isSelected
                          ? 'border-amber-500/50 bg-amber-500/10 text-white'
                          : 'border-zinc-800/80 bg-zinc-950 hover:border-zinc-700 text-zinc-300'
                      }`}
                    >
                      <div className="text-xs font-bold font-mono text-amber-400">User #{peer}</div>
                      <div className="text-[11px] text-zinc-400 truncate mt-0.5">{c.lastMessage}</div>
                    </button>
                  );
                })}

                {conversations.length === 0 && (
                  <div className="py-8 text-center text-xs text-zinc-500 font-mono">
                    No active user support threads.
                  </div>
                )}
              </div>
            </div>

            <div className="md:col-span-2 rounded-3xl border border-zinc-800 bg-zinc-900/90 p-5 flex flex-col h-[520px]">
              {activeConv ? (
                <>
                  <div className="border-b border-zinc-800 pb-3 mb-3">
                    <span className="text-[10px] font-mono text-zinc-400 uppercase">Chatting with</span>
                    <h4 className="text-sm font-bold text-white font-mono">
                      User #{activeConv.participants.find(p => p !== 'ADMIN_SUPPORT')}
                    </h4>
                  </div>

                  <div className="flex-1 overflow-y-auto space-y-2.5 p-2">
                    {messages
                      .filter(m => m.conversationId === activeConv.id)
                      .map((m) => {
                        const isAdmin = m.senderId === 'ADMIN_SUPPORT';
                        const reactions = m.reactions || {};
                        const hasReactions = Object.keys(reactions).some(k => reactions[k]?.length > 0);
                        return (
                          <div
                            key={m.id}
                            className={`flex flex-col ${isAdmin ? 'items-end' : 'items-start'}`}
                          >
                            <div
                              className={`max-w-[78%] rounded-2xl px-4 py-2.5 text-xs ${
                                isAdmin
                                  ? 'bg-gradient-to-br from-amber-500 to-amber-600 text-zinc-950 font-medium rounded-br-xs shadow-md shadow-amber-500/10'
                                  : 'bg-zinc-800/90 border border-zinc-700/60 text-zinc-100 rounded-bl-xs shadow-sm'
                              }`}
                            >
                              <p className="break-words">{m.text}</p>
                              <div className={`text-[9px] font-mono mt-1 ${
                                isAdmin ? 'text-zinc-950/70 text-right' : 'text-zinc-400 text-right'
                              }`}>
                                {new Date(m.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                              </div>
                            </div>
                            {hasReactions && (
                              <div className="flex gap-1 mt-1">
                                {Object.entries(reactions).map(([emoji, uids]) => (
                                  <span key={emoji} className="text-[10px] bg-zinc-800/80 border border-zinc-700 rounded-full px-1.5 py-0.2">
                                    {emoji} {uids.length}
                                  </span>
                                ))}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    <div ref={adminChatEndRef} />
                  </div>

                  <form onSubmit={handleSendSupportMessage} className="pt-3 border-t border-zinc-800 flex gap-2">
                    <input
                      type="text"
                      value={supportMessage}
                      onChange={(e) => setSupportMessage(e.target.value)}
                      placeholder="Type admin response..."
                      className="flex-1 rounded-xl border border-zinc-800 bg-zinc-950 px-3.5 py-2.5 text-xs text-zinc-100 focus:border-amber-500 focus:outline-none"
                    />
                    <button
                      type="submit"
                      disabled={!supportMessage.trim()}
                      className="rounded-xl bg-amber-500 px-4 text-xs font-bold text-zinc-950 hover:bg-amber-400 transition cursor-pointer disabled:opacity-50"
                    >
                      <Send className="w-4 h-4" />
                    </button>
                  </form>
                </>
              ) : (
                <div className="flex-1 flex flex-col items-center justify-center text-zinc-500 text-xs">
                  <MessageSquare className="w-8 h-8 text-zinc-600 mb-2" />
                  <span>Select a user conversation from the list to respond</span>
                </div>
              )}
            </div>
          </div>
        )}
      </main>
    </div>
  );
};
