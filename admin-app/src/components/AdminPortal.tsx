import { FC, useState, useEffect, useRef } from 'react';
import {
  ShieldCheck,
  PlusCircle,
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
  Snowflake,
  FileText,
  ArrowRightLeft,
  ShieldAlert,
  Clock,
  BarChart3,
  Radio,
  Users2,
  Phone,
  Video,
  Mic,
  Play,
  Pause,
  X,
  Mail
} from 'lucide-react';
import { BoostPayStore, copyToClipboard } from '../services/store';
import { CallManager, startCallTo } from './CallOverlay';
import { AnalyticsDashboard, BroadcastView, FraudView, AdminAccountsView, DatabaseBrowser, ReferAdminView, AdminSystemSettingsView, SmtpAdminView } from './AdminExtraViews';
import { User, SystemConfig, Conversation, Message, AuditLog, Transaction } from '../types';
import { formatPrecisionAmount, formatRatePercent, formatCompoundingRateDual } from '../utils/format';

interface Props {
  onBack?: () => void;
}

const VoiceNotePlayer: FC<{ data: string; durationMs?: number }> = ({ data, durationMs }) => {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const total = Math.max(1, Math.round((durationMs || 0) / 1000));
  const toggle = () => {
    const el = audioRef.current;
    if (!el) return;
    if (el.paused) { el.play().then(() => setPlaying(true)).catch(() => {}); }
    else { el.pause(); setPlaying(false); }
  };
  return (
    <div className="flex items-center gap-2 min-w-[150px]">
      <button type="button" onClick={toggle} className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-amber-500/20 text-amber-400 cursor-pointer">
        {playing ? <Pause className="w-3 h-3" /> : <Play className="w-3 h-3" />}
      </button>
      <div className="flex-1">
        <div className="h-1 rounded-full bg-zinc-700 overflow-hidden">
          <div className="h-full bg-amber-400 transition-all" style={{ width: playing ? '100%' : '0%', transition: 'width 3s linear' }} />
        </div>
        <div className="text-[9px] font-mono text-zinc-400 mt-0.5">{Math.floor(total / 60)}:{String(Math.floor(total % 60)).padStart(2, '0')}</div>
      </div>
      <audio ref={audioRef} src={data} preload="metadata" onEnded={() => setPlaying(false)} className="hidden" />
    </div>
  );
};

const MobileBottomNav: FC<{ activeTab: string; setActiveTab: (t: any) => void; usersCount: number; txCount: number }> = ({ activeTab, setActiveTab, usersCount, txCount }) => {
  const items: Array<{ id: string; label: string; icon: any; badge?: number }> = [
    { id: 'OVERVIEW', label: 'Home', icon: Activity },
    { id: 'USERS', label: 'Users', icon: Users, badge: usersCount },
    { id: 'TRANSACTIONS', label: 'Ledger', icon: ArrowRightLeft, badge: txCount },
    { id: 'SUPPORT', label: 'Support', icon: MessageSquare },
    { id: 'MORE', label: 'More', icon: Sliders },
  ];
  const [showMore, setShowMore] = useState(false);
  const moreTabs = [
    { id: 'ANALYTICS', label: 'Analytics', icon: BarChart3 },
    { id: 'AUDIT', label: 'Audit Log', icon: FileText },
    { id: 'FRAUD', label: 'Anti-Fraud', icon: ShieldAlert },
    { id: 'REFER', label: 'Referral', icon: Users },
    { id: 'SMTP', label: 'Email/SMTP', icon: Mail },
    { id: 'SETTINGS', label: 'Settings', icon: Sliders },
    { id: 'BROADCAST', label: 'Broadcast', icon: Radio },
    { id: 'DATABASE', label: 'Database', icon: Database },
    { id: 'ENGINE', label: 'Engine', icon: Zap },
    { id: 'ADMINS', label: 'Admins', icon: Users2 },
  ];
  return (
    <>
      <div className="lg:hidden fixed bottom-0 left-0 right-0 z-40 border-t border-zinc-800 bg-zinc-950/95 mobile-bottom-nav">
        <div className="flex items-center justify-around px-1 py-1">
          {items.map(it => {
            const Icon = it.icon;
            const isActive = activeTab === it.id || (it.id === 'MORE' && moreTabs.some(m => m.id === activeTab));
            const isMore = it.id === 'MORE';
            return (
              <button
                key={it.id}
                onClick={() => isMore ? setShowMore(true) : setActiveTab(it.id)}
                className={`relative flex flex-col items-center gap-0.5 rounded-xl px-3 py-1.5 min-w-[56px] transition ${isActive ? 'text-amber-400' : 'text-zinc-500 hover:text-zinc-300'}`}
              >
                {isActive && <span className="absolute -top-1 left-1/2 -translate-x-1/2 h-0.5 w-6 rounded-full bg-amber-500" />}
                <span className={`flex h-6 w-6 items-center justify-center rounded-lg ${isActive ? 'bg-amber-500 text-zinc-950' : 'bg-zinc-900'}`}>
                  <Icon className="w-3.5 h-3.5" />
                </span>
                <span className="text-[9px] font-semibold leading-none">{it.label}</span>
                {it.badge !== undefined && it.badge > 0 && <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 rounded-full bg-amber-500 px-1 text-[9px] font-bold text-zinc-950 flex items-center justify-center">{it.badge > 99 ? '99+' : it.badge}</span>}
              </button>
            );
          })}
        </div>
      </div>
      {showMore && (
        <div className="lg:hidden fixed inset-0 z-50 flex flex-col justify-end">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setShowMore(false)} />
          <div className="relative rounded-t-3xl border border-zinc-800 bg-zinc-900 p-4 pb-8 safe-pb max-h-[70vh] overflow-y-auto">
            <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-zinc-700" />
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-bold text-white">All Sections</h3>
              <button onClick={() => setShowMore(false)} className="rounded-xl border border-zinc-800 bg-zinc-950 p-2 text-zinc-400"><X className="w-4 h-4" /></button>
            </div>
            <div className="grid grid-cols-3 gap-2">
              {moreTabs.map(m => {
                const Icon = m.icon;
                const active = activeTab === m.id;
                return (
                  <button
                    key={m.id}
                    onClick={() => { setActiveTab(m.id as any); setShowMore(false); window.scrollTo({ top: 0, behavior: 'smooth' }); }}
                    className={`flex flex-col items-center gap-1.5 rounded-2xl border p-3 text-xs font-semibold transition ${active ? 'border-amber-500 bg-amber-500 text-zinc-950' : 'border-zinc-800 bg-zinc-950 text-zinc-300 hover:border-zinc-700'}`}
                  >
                    <Icon className="w-5 h-5" />
                    <span className="text-[11px] leading-tight text-center">{m.label}</span>
                  </button>
                );
              })}
            </div>
            <p className="text-center text-[10px] text-zinc-500 mt-3">Tap any section to switch — easy one-hand use on Android</p>
          </div>
        </div>
      )}
    </>
  );
};

export const AdminPortal: FC<Props> = ({ onBack }) => {
  // 1. Persistent Admin Auth State (Role-Bounded Non-Superuser)
  const [adminSession, setAdminSession] = useState(() => BoostPayStore.getAdminSession());
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loginError, setLoginError] = useState('');
  const [isLoggingIn, setIsLoggingIn] = useState(false);

  // 2. Admin Portal Views
  const [activeTab, setActiveTab] = useState<'OVERVIEW' | 'ANALYTICS' | 'USERS' | 'AUDIT' | 'TRANSACTIONS' | 'BROADCAST' | 'FRAUD' | 'REFER' | 'SMTP' | 'SETTINGS' | 'DATABASE' | 'ENGINE' | 'SUPPORT' | 'ADMINS'>('OVERVIEW');

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
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>(() => BoostPayStore.getTransactions());
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Stats
  const [stats, setStats] = useState({
    totalUsers: 0,
    totalLiquidity: 0,
    totalProfitPaid: 0,
    activeBoosters: 0,
    pausedBoosters: 0,
    totalTransactions: 0,
    dokployStatus: {
      storageMode: 'json-file' as 'postgres' | 'json-file',
      host: 'local',
      database: 'boostpay_db.json',
      isConnected: true,
      latencyMs: 0,
      lastPingMs: 0,
      lastError: ''
    }
  });
  const [dbPing, setDbPing] = useState<{ ok: boolean; latencyMs: number; error?: string; storageMode?: string } | null>(null);
  const [isPinging, setIsPinging] = useState(false);

  // Admin Portal input focus tracking
  const isEditing = useRef({
    hourlyRate: false,
    minBoost: false,
    maxBoost: false
  });

  // User Management State
  const [searchTerm, setSearchTerm] = useState('');
  const [userFilter, setUserFilter] = useState<'ALL'|'HIGH_BALANCE'|'ACTIVE'|'BOOSTING'|'FROZEN'|'BLOCKED'|'IDLE'>('ALL');
  const [selectedUser, setSelectedUser] = useState<User | null>(null);
  const [mobileUserTab, setMobileUserTab] = useState<'INFO'|'MONEY'|'BOOST'|'SECURITY'>('INFO');
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

  // Freeze Modal State
  const [freezeModalUser, setFreezeModalUser] = useState<User | null>(null);
  const [freezeReason, setFreezeReason] = useState('');
  const [freezeLoading, setFreezeLoading] = useState(false);
  const [freezeType, setFreezeType] = useState<'permanent'|'temporary'>('permanent');
  const [freezeDurationMin, setFreezeDurationMin] = useState('60');

  // Password reset modal
  const [newPasswordInput, setNewPasswordInput] = useState('');
  const [passwordResetSuccess, setPasswordResetSuccess] = useState('');

  // Audit Logs State
  const [auditSearch, setAuditSearch] = useState('');
  const [auditFilter, setAuditFilter] = useState<'ALL' | 'TREASURY' | 'FREEZE' | 'USER' | 'PASSWORD' | 'SYSTEM'>('ALL');

  // Transactions Tab State
  const [txSearch, setTxSearch] = useState('');
  const [txFilter, setTxFilter] = useState<'ALL' | 'P2P' | 'REWARD' | 'TREASURY'>('ALL');

  // Rate config state
  const [customMinuteRate, setCustomMinuteRate] = useState(
    formatRatePercent(config.minuteRatePercent !== undefined ? config.minuteRatePercent : (config.hourlyRatePercent ? config.hourlyRatePercent / 60 : 0.001605))
  );
  const [minBoostMinutes, setMinBoostMinutes] = useState(Math.round((config.minBoostMs || 60000) / 60000).toString());
  const [maxBoostHours, setMaxBoostHours] = useState(Math.round((config.maxBoostMs || 86400000) / 3600000).toString());
  const [rateSuccess, setRateSuccess] = useState(false);

  // Support chat responder
  const [activeConv, setActiveConv] = useState<Conversation | null>(null);
  const [supportMessage, setSupportMessage] = useState('');
  const [isRecording, setIsRecording] = useState(false);
  const [recSeconds, setRecSeconds] = useState(0);
  const recMediaRef = useRef<MediaRecorder | null>(null);
  const recChunksRef = useRef<Blob[]>([]);
  const recTimerRef = useRef<number | null>(null);
  const adminChatEndRef = useRef<HTMLDivElement>(null);

  // Fast refresh — only loads stats + current tab (not all collections at once)
  const refreshData = async (isManual = false) => {
    if (isManual) setIsRefreshing(true);
    try {
      await refreshStatsOnly();
      await refreshTabData(activeTab);
    } catch (err) {
      console.error('Failed to refresh admin data:', err);
    } finally {
      if (isManual) setIsRefreshing(false);
    }
  };

  const refreshStatsOnly = async () => {
    try {
      const res = await fetch('/api/admin/stats', { headers: BoostPayStore.adminAuthHeaders() });
      if (res.ok) {
        const data = await res.json();
        setStats(prev=> (prev.totalUsers===data.totalUsers&&prev.totalLiquidity===data.totalLiquidity&&prev.totalProfitPaid===data.totalProfitPaid&&prev.activeBoosters===data.activeBoosters&&prev.pausedBoosters===data.pausedBoosters&&prev.totalTransactions===data.totalTransactions) ? prev : { totalUsers:data.totalUsers, totalLiquidity:data.totalLiquidity, totalProfitPaid:data.totalProfitPaid, activeBoosters:data.activeBoosters, pausedBoosters:data.pausedBoosters, totalTransactions:data.totalTransactions, dokployStatus:data.dokployStatus||prev.dokployStatus });
        if (data.config) { setConfig(prev=> (prev.minuteRatePercent===data.config.minuteRatePercent&&prev.hourlyRatePercent===data.config.hourlyRatePercent&&prev.minBoostMs===data.config.minBoostMs&&prev.maxBoostMs===data.config.maxBoostMs) ? prev : data.config); }
      }
    } catch {}
  };
  const refreshTabData = async (tab:string) => {
    try {
      if (tab==='USERS' || tab==='OVERVIEW') {
        const r=await fetch('/api/admin/users', { headers: BoostPayStore.adminAuthHeaders() });
        if(r.ok){ const d=await r.json(); setUsers(d.users); BoostPayStore.saveUsers(d.users); }
      }
      if (tab==='AUDIT') { const logs=await BoostPayStore.getAuditLogs(); if(logs) setAuditLogs(logs); }
      if (tab==='TRANSACTIONS') { try{ const dbRes=await fetch('/api/db',{headers:BoostPayStore.adminAuthHeaders()}); if(dbRes.ok){ const dbData=await dbRes.json(); if(Array.isArray(dbData.transactions) && dbData.transactions.length) setTransactions(dbData.transactions); else { // fallback to tables API for empty ledger fix
          const tb=await fetch('/api/admin/db/tables/transactions',{headers:BoostPayStore.adminAuthHeaders()}); if(tb.ok){ const td=await tb.json(); if(Array.isArray(td.rows)) setTransactions(td.rows); }
        } } else { const tb2=await fetch('/api/admin/db/tables/transactions',{headers:BoostPayStore.adminAuthHeaders()}); if(tb2.ok){ const td2=await tb2.json(); if(Array.isArray(td2.rows)) setTransactions(td2.rows); } } }catch{} }
      if (tab==='SUPPORT' || tab==='OVERVIEW') { await BoostPayStore.syncChatState('ADMIN_SUPPORT'); setConversations(BoostPayStore.getConversations()); setMessages(BoostPayStore.getMessages()); }
    } catch(e){ console.warn('Tab refresh failed',e); }
  };
  useEffect(()=>{ if(adminSession?.isLoggedIn) { refreshTabData(activeTab); setUsersPage(0); setTxPage(0); } },[activeTab, adminSession?.isLoggedIn]);
  // Realtime: poll stats every 8s + current tab data every 5s (realtime without heavy all-at-once load)
  // + reset pagination when filters change
  useEffect(()=>{ if(selectedUser) setMobileUserTab('INFO'); }, [selectedUser?.id]);
  useEffect(()=>{
    if (searchTerm || userFilter) setUsersPage(0);
  }, [searchTerm, userFilter]);
  useEffect(()=>{
    if (txSearch || txFilter) setTxPage(0);
  }, [txSearch, txFilter]);
  useEffect(() => {
    if (adminSession?.isLoggedIn) {
      refreshStatsOnly();
      refreshTabData(activeTab);
      const statsInterval = setInterval(() => refreshStatsOnly(), 8000);
      const tabInterval = setInterval(() => refreshTabData(activeTab), 5000);

      // Connect to real-time chat SSE stream for Admin Support (also carries user_update for realtime)
      const unsubStream = BoostPayStore.initChatStream('ADMIN_SUPPORT');
      const unsubLocal = BoostPayStore.subscribeToChat((convs, msgs) => {
        setConversations(convs);
        setMessages(msgs);
      });
      const unsubRealtime = BoostPayStore.onAdminRealtime((evt:any)=>{
        if (evt.type==='user_update' && evt.adminUser) {
          setUsers(prev=>{
            const id = String(evt.adminUser.id);
            const idx = prev.findIndex(u=>String(u.id)===id);
            if (idx>=0) { const c=[...prev]; c[idx]=evt.adminUser; // keep newest-first sort
              return c.sort((a:any,b:any)=>{ const aT=a.createdAt?new Date(a.createdAt).getTime():0; const bT=b.createdAt?new Date(b.createdAt).getTime():0; if(aT||bT) return (bT||0)-(aT||0); return Number(b.id)-Number(a.id);});
            } else {
              // new user → prepend (newest on top)
              return [evt.adminUser, ...prev];
            }
          });
          setSelectedUser(curr=> curr && String(curr.id)===String(evt.adminUser.id) ? evt.adminUser : curr);
        }
        if (evt.type==='user_update' && evt.user && !evt.adminUser) {
          // fallback: if only publicUser, merge minimally
          setUsers(prev=>{
            const id=String(evt.user.id);
            const idx=prev.findIndex(u=>String(u.id)===id);
            if(idx>=0){ const c=[...prev]; c[idx]={...c[idx], ...evt.user, balance: evt.user.balance ?? c[idx].balance, isFrozen: evt.user.isFrozen ?? c[idx].isFrozen, boostState: evt.user.boostState ?? c[idx].boostState }; return c; }
            return prev;
          });
        }
        if (evt.type==='stats_invalidate') {
          refreshStatsOnly();
          if (activeTab==='TRANSACTIONS') refreshTabData('TRANSACTIONS');
        }
      });

      return () => {
        clearInterval(statsInterval);
        clearInterval(tabInterval);
        unsubStream();
        unsubLocal();
        unsubRealtime();
      };
    }
  }, [adminSession?.isLoggedIn, activeTab]);

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
          loginTime: data.loginTime || Date.now(),
          role: data.role === 'SUPPORT' ? 'SUPPORT' : 'SUPERADMIN'
        });
        setAdminSession(sess);
        return;
      }
      // SECURITY: never fall back to hardcoded credentials in the client bundle
      setLoginError('Invalid administrator credentials.');
    } catch {
      setLoginError('Cannot reach the server. Please try again.');
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

  // Toggle Account Freeze
  const handleConfirmFreezeToggle = async () => {
    if (!freezeModalUser) return;
    setFreezeLoading(true);
    const newFreezeStatus = !freezeModalUser.isFrozen;
    const durationMs = freezeType==='temporary' ? (parseInt(freezeDurationMin,10)||60)*60000 : undefined;
    const res = await BoostPayStore.adminToggleFreezeUser(
      freezeModalUser.id,
      newFreezeStatus,
      freezeReason.trim() || (newFreezeStatus ? 'Administrative security freeze' : 'Account unfreezing by admin'),
      adminSession?.email,
      { isPermanent: freezeType==='permanent', durationMs }
    );
    setFreezeLoading(false);
    if (res.success && res.user) {
      await refreshData(true);
      if (selectedUser?.id === freezeModalUser.id) {
        setSelectedUser({ ...res.user });
      }
      setFreezeModalUser(null);
      setFreezeReason('');
    } else {
      alert(res.error || 'Failed to update account freeze state.');
    }
  };

  // Override Boost State on Server
  const handleBoostOverride = async (userId: string, action: 'START' | 'PAUSE' | 'RESUME' | 'RESET') => {
    try {
      const res = await fetch('/api/admin/users/boost-override', {
        method: 'POST',
        headers: BoostPayStore.adminAuthHeaders(),
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
        headers: BoostPayStore.adminAuthHeaders(),
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
        headers: BoostPayStore.adminAuthHeaders(),
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
        headers: BoostPayStore.adminAuthHeaders(),
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
    const minuteRate = parseFloat(customMinuteRate);
    const minMins = parseInt(minBoostMinutes, 10);
    const maxHrs = parseInt(maxBoostHours, 10);

    if (isNaN(minuteRate) || minuteRate < 0) {
      alert('Please enter a valid compounding rate percentage per minute (e.g. 0.001605)');
      return;
    }
    if (isNaN(minMins) || minMins < 1) {
      alert('Min boost duration must be at least 1 minute');
      return;
    }
    if (isNaN(maxHrs) || maxHrs < 1) {
      alert('Max boost duration must be at least 1 hour');
      return;
    }

    const newConfig: SystemConfig = {
      minuteRatePercent: minuteRate,
      hourlyRatePercent: (Math.pow(1 + minuteRate / 100, 60) - 1) * 100,
      minBoostMs: minMins * 60000,
      maxBoostMs: maxHrs * 3600000,
      dokploy: config.dokploy
    };

    try {
      const res = await fetch('/api/admin/config', {
        method: 'POST',
        headers: BoostPayStore.adminAuthHeaders(),
        body: JSON.stringify(newConfig)
      });
      if (res.ok) {
        setConfig(newConfig);
        BoostPayStore.saveConfig(newConfig);
        setRateSuccess(true);
        setTimeout(() => setRateSuccess(false), 3000);
        await refreshData();
      }
    } catch (err) {
      console.warn('Config save error:', err);
    }
  };

  // Send Support Message
  const handleSendSupportMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeConv || !supportMessage.trim()) return;

    const peerId = activeConv.participants.find(p => p !== 'ADMIN_SUPPORT');
    if (!peerId) return;

    const res = await BoostPayStore.sendChatMessage(peerId, supportMessage.trim(), 'ADMIN');
    if (res.success) {
      setSupportMessage('');
      await refreshData();
    }
  };

  // ---- Voice notes (admin side) ----
  const stopRecordingCleanup = () => {
    if (recTimerRef.current) { clearInterval(recTimerRef.current); recTimerRef.current = null; }
    try { recMediaRef.current?.stream.getTracks().forEach(t => t.stop()); } catch { /* noop */ }
    recMediaRef.current = null;
    setIsRecording(false);
    setRecSeconds(0);
  };

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4']
        .find((t) => (window as any).MediaRecorder && MediaRecorder.isTypeSupported(t)) || '';
      const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      recChunksRef.current = [];
      rec.ondataavailable = (e) => { if (e.data && e.data.size > 0) recChunksRef.current.push(e.data); };
      rec.start();
      recMediaRef.current = rec;
      setIsRecording(true);
      setRecSeconds(0);
      recTimerRef.current = window.setInterval(() => setRecSeconds(s => s + 1), 1000);
    } catch {
      window.alert('Allow microphone access to record voice messages.');
    }
  };

  const cancelRecording = () => {
    try { recMediaRef.current?.stop(); } catch { /* noop */ }
    recChunksRef.current = [];
    stopRecordingCleanup();
  };

  const sendRecording = async () => {
    const rec = recMediaRef.current;
    if (!rec || !activeConv) return;
    const chunks = recChunksRef.current;
    const ms = recSeconds * 1000;
    const peerId = activeConv.participants.find(p => p !== 'ADMIN_SUPPORT');
    if (!peerId) return;
    rec.onstop = async () => {
      stopRecordingCleanup();
      if (!chunks.length) return;
      const blob = new Blob(chunks, { type: chunks[0].type || 'audio/webm' });
      if (blob.size > 2 * 1024 * 1024) { window.alert('Voice message too long (max 2 minutes).'); return; }
      const reader = new FileReader();
      reader.onloadend = async () => {
        const dataUrl = String(reader.result || '');
        if (!dataUrl.startsWith('data:audio/')) return;
        await BoostPayStore.sendChatMessage(peerId, '🎤 Voice message', 'ADMIN', undefined, { data: dataUrl, durationMs: ms });
        await refreshData();
      };
      reader.readAsDataURL(blob);
    };
    try { rec.stop(); } catch { stopRecordingCleanup(); }
  };

  // Real database connection ping (SELECT 1)
  const runDbPing = async () => {
    setIsPinging(true);
    try {
      const res = await fetch('/api/admin/db/ping', { headers: BoostPayStore.adminAuthHeaders() });
      const data = await res.json();
      setDbPing(data);
    } catch (e: any) {
      setDbPing({ ok: false, latencyMs: 0, error: e.message || 'Ping failed' });
    } finally {
      setIsPinging(false);
    }
  };

  // Run Database Storage Health Probe
  const runStorageProbe = async () => {
    setIsProbing(true);
    try {
      const data = await BoostPayStore.probeDatabaseStorage();
      setStorageProbe(data);
    } catch (err) {
      console.warn('Storage probe error:', err);
    } finally {
      setIsProbing(false);
    }
  };

  // Export JSON Database Snapshot
  const handleDownloadBackup = async () => {
    try {
      const blob = await BoostPayStore.exportDatabase();
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `boostpay_db_backup_${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.warn('Backup download failed:', err);
    }
  };

  // Restore JSON Database Snapshot
  const handleFileImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!confirm('Warning: Restoring a database backup will merge records into the live database. Proceed?')) {
      e.target.value = '';
      return;
    }

    setImportLoading(true);
    setImportStatus(null);

    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      const res = await BoostPayStore.importDatabase(parsed);
      if (res.success) {
        setImportStatus(`✓ Database restored successfully! (${res.restoredUsers || 0} user accounts verified)`);
        await refreshData(true);
        runStorageProbe();
      } else {
        setImportStatus(`Error: ${res.error || 'Failed to restore backup'}`);
      }
    } catch (err: any) {
      setImportStatus(`Parse error: Invalid JSON file (${err.message})`);
    } finally {
      setImportLoading(false);
      e.target.value = '';
    }
  };

  // Filter + sort users — newest on top, with status filters
  const filteredUsers = [...users]
    .sort((a: any, b: any) => {
      const aT = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const bT = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      if (aT && bT) return bT - aT;
      if (aT || bT) return bT - aT;
      // fallback: numeric id desc (newer id = newer user)
      return Number(b.id) - Number(a.id);
    })
    .filter(u => {
      const matchesSearch =
        !searchTerm ||
        u.id.includes(searchTerm) ||
        u.balance.toString().includes(searchTerm) ||
        (u.email && u.email.toLowerCase().includes(searchTerm.toLowerCase())) ||
        (u.phrase && u.phrase.toLowerCase().includes(searchTerm.toLowerCase()));
      if (!matchesSearch) return false;
      if (userFilter === 'ALL') return true;
      if (userFilter === 'HIGH_BALANCE') return Number(u.balance) >= 10;
      if (userFilter === 'ACTIVE') return !u.isFrozen && !u.isBlocked;
      if (userFilter === 'BOOSTING') return !!u.boostState?.isActive;
      if (userFilter === 'FROZEN') return !!u.isFrozen;
      if (userFilter === 'BLOCKED') return !!u.isBlocked;
      if (userFilter === 'IDLE') return !u.boostState?.isActive;
      return true;
    });

  // Lazy load notice for admin — all data not loaded at once, paginated per tab
  // Filter Audit Logs
  const filteredAuditLogs = auditLogs.filter(log => {
    const matchesSearch =
      log.action.toLowerCase().includes(auditSearch.toLowerCase()) ||
      log.adminEmail.toLowerCase().includes(auditSearch.toLowerCase()) ||
      (log.targetUserId && log.targetUserId.includes(auditSearch)) ||
      log.details.toLowerCase().includes(auditSearch.toLowerCase());

    if (!matchesSearch) return false;
    if (auditFilter === 'ALL') return true;
    if (auditFilter === 'TREASURY') return log.action.includes('TREASURY');
    if (auditFilter === 'FREEZE') return log.action.includes('FREEZE');
    if (auditFilter === 'USER') return log.action.startsWith('USER_');
    if (auditFilter === 'PASSWORD') return log.action.includes('PASSWORD');
    if (auditFilter === 'SYSTEM') return log.action.includes('SYSTEM') || log.action.includes('CONFIG');
    return true;
  });

  const [usersPage, setUsersPage] = useState(0);
  const usersPageSize = 25;
  const paginatedUsers = filteredUsers.slice(usersPage*usersPageSize, (usersPage+1)*usersPageSize);
  const totalUsersPages = Math.max(1, Math.ceil(filteredUsers.length / usersPageSize));
  // Filter Transactions — with pagination to avoid loading all at once
  const [txPage, setTxPage] = useState(0);
  const txPageSize = 25;
  const filteredTransactions = transactions.filter(tx => {
    const matchesSearch =
      tx.id.toLowerCase().includes(txSearch.toLowerCase()) ||
      tx.userId.includes(txSearch) ||
      (tx.recipientId && tx.recipientId.includes(txSearch)) ||
      (tx.senderId && tx.senderId.includes(txSearch)) ||
      (tx.notes && tx.notes.toLowerCase().includes(txSearch.toLowerCase()));

    if (!matchesSearch) return false;
    if (txFilter === 'ALL') return true;
    if (txFilter === 'P2P') return tx.type === 'TRANSFER_SENT' || tx.type === 'TRANSFER_RECEIVED';
    if (txFilter === 'REWARD') return tx.type === 'REWARD' || tx.type === 'YIELD_REWARD' || String(tx.type).includes('REFERRAL');
    if (txFilter === 'TREASURY') return tx.type === 'ADMIN_CREDIT' || tx.type === 'ADMIN_DEBIT';
    return true;
  });
  const paginatedTransactions = filteredTransactions.slice(txPage*txPageSize, (txPage+1)*txPageSize);
  const totalTxPages = Math.max(1, Math.ceil(filteredTransactions.length / txPageSize));

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
            <h1 className="text-xl font-black tracking-tight text-white">BoostPay Admin Portal</h1>
            <p className="text-xs text-zinc-400 mt-1">Role-Bounded Administrative Console (Direct Route)</p>
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
                {isLoggingIn ? 'Authenticating...' : 'Sign In to Admin Portal'}
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
  // RENDER: 2. LOGGED-IN ADMIN CONSOLE (ROLE-BOUNDED)
  // -------------------------------------------------------------
  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 font-sans">
      {/* Real-time audio/video call manager for the Admin Support mailbox */}
      <CallManager currentUser={{ id: 'ADMIN_SUPPORT' }} senderRole="ADMIN" />
      {/* Top Admin Header — polished responsive */}
      <header className="sticky top-0 z-40 w-full border-b border-zinc-800 bg-zinc-950/90 backdrop-blur-xl">
        <div className="max-w-7xl mx-auto flex items-center justify-between gap-3 px-4 sm:px-6 lg:px-8 py-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-amber-500 text-zinc-950 font-black shadow-md shadow-amber-500/20">
              <ShieldCheck className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-bold text-[13px] sm:text-sm tracking-tight text-white">
                  BoostPay Admin
                </span>
                <span className="hidden sm:inline-flex rounded-full bg-emerald-500/10 border border-emerald-500/30 px-2 py-0.5 text-[10px] font-mono text-emerald-400 font-semibold">
                  ROLE_ADMIN
                </span>
                <span className="inline-flex sm:hidden rounded-full bg-amber-500 px-2 py-0.5 text-[10px] font-bold text-zinc-950">ADMIN</span>
              </div>
              <span className="block truncate text-[10px] sm:text-[11px] text-zinc-400 font-mono">
                {adminSession.email}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
            <button
              onClick={() => refreshData(true)}
              disabled={isRefreshing}
              className="flex h-9 w-9 sm:w-auto items-center justify-center sm:gap-1.5 rounded-xl border border-zinc-800 bg-zinc-900 px-2.5 sm:px-3 py-1.5 text-xs text-zinc-300 hover:border-zinc-700 hover:bg-zinc-800 active:scale-95 transition cursor-pointer"
              title="Refresh database state"
            >
              <RefreshCw className={`w-3.5 h-3.5 shrink-0 ${isRefreshing ? 'animate-spin text-amber-400' : 'text-zinc-400'}`} />
              <span className="hidden sm:inline">Refresh</span>
            </button>

            <button
              onClick={handleDownloadBackup}
              className="hidden lg:flex items-center gap-1.5 rounded-xl border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-xs text-zinc-300 hover:border-zinc-700 hover:bg-zinc-800 active:scale-95 transition cursor-pointer"
              title="Download JSON Database Backup"
            >
              <Download className="w-3.5 h-3.5 text-zinc-400" />
              <span>Backup</span>
            </button>

            {onBack && (
              <button
                onClick={onBack}
                className="flex h-9 w-9 sm:w-auto items-center justify-center sm:gap-1.5 rounded-xl border border-zinc-800 bg-zinc-900 px-2.5 sm:px-3 py-1.5 text-xs text-zinc-300 hover:text-white hover:border-zinc-700 active:scale-95 transition cursor-pointer"
                title="View user wallet"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Wallet</span>
              </button>
            )}

            <button
              onClick={handleAdminLogout}
              className="flex h-9 w-9 sm:w-auto items-center justify-center sm:gap-1.5 rounded-xl border border-red-500/30 bg-red-500/10 px-2.5 sm:px-3 py-1.5 text-xs font-semibold text-red-400 hover:bg-red-500/20 active:scale-95 transition cursor-pointer"
              title="Sign Out of Admin Console"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Sign Out</span>
            </button>
          </div>
        </div>
      </header>

      {/* Admin Navigation Tabs — desktop only, mobile uses bottom nav */}
      <div className="hidden lg:block sticky top-[61px] z-30 border-b border-zinc-800/80 bg-zinc-950/80 backdrop-blur-md">
        <div className="relative max-w-7xl mx-auto">
          <div className="pointer-events-none absolute left-0 top-0 bottom-0 w-6 bg-gradient-to-r from-zinc-950 to-transparent z-10 hidden sm:block" />
          <div className="pointer-events-none absolute right-0 top-0 bottom-0 w-6 bg-gradient-to-l from-zinc-950 to-transparent z-10 hidden sm:block" />
          <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar snap-x px-4 sm:px-6 lg:px-8 py-2.5">

          <button
            onClick={() => setActiveTab('OVERVIEW')}
            className={`flex items-center gap-1.5 sm:gap-2 rounded-xl px-3 sm:px-3.5 py-2 text-[11px] sm:text-xs font-semibold transition cursor-pointer shrink-0 snap-start whitespace-nowrap ${
              activeTab === 'OVERVIEW'
                ? 'bg-amber-500 text-zinc-950 font-bold shadow-md'
                : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/50'
            }`}
          >
            <Activity className="w-4 h-4" />
            <span>Overview & Health</span>
          </button>

          <button
            onClick={() => setActiveTab('ANALYTICS')}
            className={`flex items-center gap-1.5 sm:gap-2 rounded-xl px-3 sm:px-3.5 py-2 text-[11px] sm:text-xs font-semibold transition cursor-pointer shrink-0 snap-start whitespace-nowrap ${
              activeTab === 'ANALYTICS'
                ? 'bg-amber-500 text-zinc-950 font-bold shadow-md'
                : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/50'
            }`}
          >
            <BarChart3 className="w-4 h-4" />
            <span>Financial Analytics</span>
          </button>

          <button
            onClick={() => setActiveTab('USERS')}
            className={`flex items-center gap-1.5 sm:gap-2 rounded-xl px-3 sm:px-3.5 py-2 text-[11px] sm:text-xs font-semibold transition cursor-pointer shrink-0 snap-start whitespace-nowrap ${
              activeTab === 'USERS'
                ? 'bg-amber-500 text-zinc-950 font-bold shadow-md'
                : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/50'
            }`}
          >
            <Users className="w-4 h-4" />
            <span>User Accounts ({users.length})</span>
          </button>

          <button
            onClick={() => setActiveTab('AUDIT')}
            className={`flex items-center gap-1.5 sm:gap-2 rounded-xl px-3 sm:px-3.5 py-2 text-[11px] sm:text-xs font-semibold transition cursor-pointer shrink-0 snap-start whitespace-nowrap ${
              activeTab === 'AUDIT'
                ? 'bg-amber-500 text-zinc-950 font-bold shadow-md'
                : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/50'
            }`}
          >
            <FileText className="w-4 h-4" />
            <span>Audit Action Log ({auditLogs.length})</span>
          </button>

          <button
            onClick={() => setActiveTab('TRANSACTIONS')}
            className={`flex items-center gap-1.5 sm:gap-2 rounded-xl px-3 sm:px-3.5 py-2 text-[11px] sm:text-xs font-semibold transition cursor-pointer shrink-0 snap-start whitespace-nowrap ${
              activeTab === 'TRANSACTIONS'
                ? 'bg-amber-500 text-zinc-950 font-bold shadow-md'
                : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/50'
            }`}
          >
            <ArrowRightLeft className="w-4 h-4" />
            <span>Transactions Ledger ({transactions.length})</span>
          </button>

          <button
            onClick={() => setActiveTab('FRAUD')}
            className={`flex items-center gap-1.5 sm:gap-2 rounded-xl px-3 sm:px-3.5 py-2 text-[11px] sm:text-xs font-semibold transition cursor-pointer shrink-0 snap-start whitespace-nowrap ${
              activeTab === 'FRAUD'
                ? 'bg-amber-500 text-zinc-950 font-bold shadow-md'
                : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/50'
            }`}
          >
            <ShieldAlert className="w-4 h-4" />
            <span>Anti-Fraud</span>
          </button>

          <button
            onClick={() => setActiveTab('REFER')}
            className={`flex items-center gap-1.5 sm:gap-2 rounded-xl px-3 sm:px-3.5 py-2 text-[11px] sm:text-xs font-semibold transition cursor-pointer shrink-0 snap-start whitespace-nowrap ${
              activeTab === 'REFER'
                ? 'bg-amber-500 text-zinc-950 font-bold shadow-md'
                : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/50'
            }`}
          >
            <Users className="w-4 h-4" />
            <span>Referral</span>
          </button>

          <button
            onClick={() => setActiveTab('SMTP')}
            className={`flex items-center gap-1.5 sm:gap-2 rounded-xl px-3 sm:px-3.5 py-2 text-[11px] sm:text-xs font-semibold transition cursor-pointer shrink-0 snap-start whitespace-nowrap ${
              activeTab === 'SMTP'
                ? 'bg-sky-500 text-white font-bold shadow-md'
                : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/50'
            }`}
          >
            <Mail className="w-4 h-4" />
            <span>Email / SMTP</span>
          </button>

          <button
            onClick={() => setActiveTab('SETTINGS')}
            className={`flex items-center gap-1.5 sm:gap-2 rounded-xl px-3 sm:px-3.5 py-2 text-[11px] sm:text-xs font-semibold transition cursor-pointer shrink-0 snap-start whitespace-nowrap ${
              activeTab === 'SETTINGS'
                ? 'bg-amber-500 text-zinc-950 font-bold shadow-md'
                : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/50'
            }`}
          >
            <Sliders className="w-4 h-4" />
            <span>All Settings</span>
          </button>

          <button
            onClick={() => setActiveTab('BROADCAST')}
            className={`flex items-center gap-1.5 sm:gap-2 rounded-xl px-3 sm:px-3.5 py-2 text-[11px] sm:text-xs font-semibold transition cursor-pointer shrink-0 snap-start whitespace-nowrap ${
              activeTab === 'BROADCAST'
                ? 'bg-amber-500 text-zinc-950 font-bold shadow-md'
                : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/50'
            }`}
          >
            <Radio className="w-4 h-4" />
            <span>Broadcast</span>
          </button>

          <button
            onClick={() => {
              setActiveTab('DATABASE');
              runStorageProbe();
            }}
            className={`flex items-center gap-1.5 sm:gap-2 rounded-xl px-3 sm:px-3.5 py-2 text-[11px] sm:text-xs font-semibold transition cursor-pointer shrink-0 snap-start whitespace-nowrap ${
              activeTab === 'DATABASE'
                ? 'bg-amber-500 text-zinc-950 font-bold shadow-md'
                : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/50'
            }`}
          >
            <Database className="w-4 h-4" />
            <span>Database Storage</span>
          </button>

          <button
            onClick={() => setActiveTab('ENGINE')}
            className={`flex items-center gap-1.5 sm:gap-2 rounded-xl px-3 sm:px-3.5 py-2 text-[11px] sm:text-xs font-semibold transition cursor-pointer shrink-0 snap-start whitespace-nowrap ${
              activeTab === 'ENGINE'
                ? 'bg-amber-500 text-zinc-950 font-bold shadow-md'
                : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/50'
            }`}
          >
            <Sliders className="w-4 h-4" />
            <span>Compounding Engine</span>
          </button>

          <button
            onClick={() => setActiveTab('SUPPORT')}
            className={`flex items-center gap-1.5 sm:gap-2 rounded-xl px-3 sm:px-3.5 py-2 text-[11px] sm:text-xs font-semibold transition cursor-pointer shrink-0 snap-start whitespace-nowrap ${
              activeTab === 'SUPPORT'
                ? 'bg-amber-500 text-zinc-950 font-bold shadow-md'
                : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/50'
            }`}
          >
            <MessageSquare className="w-4 h-4" />
            <span>Support Communications</span>
          </button>

          <button
            onClick={() => setActiveTab('ADMINS')}
            className={`flex items-center gap-1.5 sm:gap-2 rounded-xl px-3 sm:px-3.5 py-2 text-[11px] sm:text-xs font-semibold transition cursor-pointer shrink-0 snap-start whitespace-nowrap ${
              activeTab === 'ADMINS'
                ? 'bg-amber-500 text-zinc-950 font-bold shadow-md'
                : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/50'
            }`}
          >
            <Users2 className="w-4 h-4" />
            <span>Admin Roles</span>
          </button>
        </div>
        </div>
      </div>

      {/* Main Admin Content Body — polished spacing + max-width */}
      <style>{` .admin-tab-active { background: #f59e0b; color: #09090b; font-weight: 700; box-shadow: 0 4px 12px rgba(245,158,11,0.25); } `}</style>
      <main className="w-full max-w-7xl mx-auto p-3 sm:p-6 lg:p-8 space-y-4 sm:space-y-6 safe-pb pb-20 lg:pb-8">
        {activeTab === 'ANALYTICS' && <AnalyticsDashboard />}
        {activeTab === 'BROADCAST' && <BroadcastView />}
        {activeTab === 'FRAUD' && <FraudView />}
        {activeTab === 'REFER' && <ReferAdminView />}
        {activeTab === 'SMTP' && <SmtpAdminView />}
        {activeTab === 'SETTINGS' && <AdminSystemSettingsView />}
        {activeTab === 'ADMINS' && (
          <AdminAccountsView
            myEmail={(adminSession && adminSession.email) || ''}
            myRole={(adminSession && adminSession.role) || 'SUPERADMIN'}
          />
        )}
        {/* ======================================================== */}
        {/* TAB 1: OVERVIEW & SYSTEM HEALTH                          */}
        {/* ======================================================== */}
        {activeTab === 'OVERVIEW' && (
          <div className="space-y-6">
            {/* Top Stat Cards — polished responsive: 1 col mobile → 2 tablet → 4 desktop */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
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
                  <span>Active Compounding</span>
                  <Zap className="w-4 h-4 text-emerald-400" />
                </div>
                <div className="text-2xl font-black font-mono text-emerald-400">
                  {stats.activeBoosters}
                </div>
                <div className="text-[10px] text-zinc-500 mt-1">{stats.pausedBoosters} cycles paused</div>
              </div>

              <div className="rounded-2xl border border-zinc-800 bg-zinc-900/90 p-4">
                <div className="flex items-center justify-between text-zinc-400 text-xs mb-2">
                  <span>Total Yield Paid</span>
                  <Percent className="w-4 h-4 text-amber-400" />
                </div>
                <div className="text-2xl font-black font-mono text-white">
                  ${stats.totalProfitPaid.toFixed(2)}
                </div>
                <div className="text-[10px] text-zinc-500 mt-1">{stats.totalTransactions} transactions recorded</div>
              </div>
            </div>

            {/* Quick Actions & Security Status */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
              <div className="rounded-2xl border border-zinc-800 bg-zinc-900/90 p-5 space-y-3">
                <div className="flex items-center justify-between">
                  <h4 className="text-xs font-bold uppercase tracking-wider font-mono text-zinc-400">Security Architecture</h4>
                  <ShieldCheck className="w-4 h-4 text-emerald-400" />
                </div>
                <div className="space-y-2 text-xs">
                  <div className="flex justify-between items-center py-1 border-b border-zinc-800/60">
                    <span className="text-zinc-400">Role Boundary</span>
                    <span className="font-mono text-emerald-400 font-bold">ROLE_ADMIN (Non-Superuser)</span>
                  </div>
                  <div className="flex justify-between items-center py-1 border-b border-zinc-800/60">
                    <span className="text-zinc-400">Audit Logging</span>
                    <span className="font-mono text-emerald-400">Active & Tamper-Evident</span>
                  </div>
                  <div className="flex justify-between items-center py-1">
                    <span className="text-zinc-400">Account Freeze Engine</span>
                    <span className="font-mono text-sky-400">Ready</span>
                  </div>
                </div>
              </div>

              <div className="rounded-2xl border border-zinc-800 bg-zinc-900/90 p-5 space-y-3">
                <div className="flex items-center justify-between">
                  <h4 className="text-xs font-bold uppercase tracking-wider font-mono text-zinc-400">Compounding Engine</h4>
                  <Percent className="w-4 h-4 text-amber-400" />
                </div>
                <div className="space-y-2 text-xs">
                  <div className="flex justify-between items-center py-1 border-b border-zinc-800/60">
                    <span className="text-zinc-400">Minute Rate</span>
                    <span className="font-mono text-amber-400 font-bold">{config.minuteRatePercent || 0.001605}% / min</span>
                  </div>
                  <div className="flex justify-between items-center py-1 border-b border-zinc-800/60">
                    <span className="text-zinc-400">Hourly Equivalent</span>
                    <span className="font-mono text-zinc-200">~{((Math.pow(1 + (config.minuteRatePercent || 0.001605) / 100, 60) - 1) * 100).toFixed(4)}% / hr</span>
                  </div>
                  <div className="flex justify-between items-center py-1">
                    <span className="text-zinc-400">Dynamic Boost Window</span>
                    <span className="font-mono text-zinc-300">1m – 24h</span>
                  </div>
                </div>
              </div>

              {/* Real Database Storage Status (no fake indicators) */}
              <div className="rounded-2xl border border-zinc-800 bg-zinc-900/90 p-5 space-y-3">
                <div className="flex items-center justify-between">
                  <h4 className="text-xs font-bold uppercase tracking-wider font-mono text-zinc-400">Database Storage</h4>
                  <Database className={`w-4 h-4 ${stats.dokployStatus.storageMode === 'postgres' && stats.dokployStatus.isConnected ? 'text-emerald-400' : 'text-amber-400'}`} />
                </div>
                <div className="space-y-2 text-xs">
                  <div className="flex justify-between items-center py-1 border-b border-zinc-800/60">
                    <span className="text-zinc-400">Storage Mode</span>
                    <span className={`font-mono font-bold ${stats.dokployStatus.storageMode === 'postgres' ? 'text-emerald-400' : 'text-amber-400'}`}>
                      {stats.dokployStatus.storageMode === 'postgres' ? 'PostgreSQL' : 'JSON File (local)'}
                    </span>
                  </div>
                  <div className="flex justify-between items-center py-1 border-b border-zinc-800/60">
                    <span className="text-zinc-400">Status</span>
                    <span className={`font-mono font-bold ${stats.dokployStatus.isConnected ? 'text-emerald-400' : 'text-rose-400'}`}>
                      {stats.dokployStatus.isConnected ? 'Connected' : 'Disconnected'}
                    </span>
                  </div>
                  <div className="flex justify-between items-center py-1 border-b border-zinc-800/60">
                    <span className="text-zinc-400">Host / Database</span>
                    <span className="font-mono text-zinc-300 truncate max-w-[160px]">{stats.dokployStatus.host} · {stats.dokployStatus.database}</span>
                  </div>
                  {stats.dokployStatus.storageMode === 'postgres' && (
                    <div className="flex justify-between items-center py-1">
                      <span className="text-zinc-400">Connection</span>
                      <button
                        onClick={runDbPing}
                        disabled={isPinging}
                        className="flex items-center gap-1.5 rounded-lg border border-zinc-800 bg-zinc-950 px-2.5 py-1 text-[10px] font-mono text-zinc-300 hover:border-amber-500/50 hover:text-amber-400 cursor-pointer active:scale-95 transition disabled:opacity-50"
                      >
                        {isPinging ? 'Pinging…' : dbPing ? (dbPing.ok ? `✓ ${dbPing.latencyMs}ms` : '✗ Error') : 'Test Connection'}
                      </button>
                    </div>
                  )}
                  {stats.dokployStatus.storageMode !== 'postgres' && (
                    <p className="text-[10px] text-amber-400/80 leading-relaxed pt-1">
                      Set the DATABASE_URL environment variable in Dokploy to switch to PostgreSQL (data survives redeploys).
                    </p>
                  )}
                  {stats.dokployStatus.lastError && (
                    <p className="text-[10px] text-rose-400 leading-relaxed truncate" title={stats.dokployStatus.lastError}>
                      Error: {stats.dokployStatus.lastError}
                    </p>
                  )}
                </div>
              </div>

              <div className="rounded-2xl border border-zinc-800 bg-zinc-900/90 p-5 space-y-3">
                <div className="flex items-center justify-between">
                  <h4 className="text-xs font-bold uppercase tracking-wider font-mono text-zinc-400">Recent Audit Activities</h4>
                  <FileText className="w-4 h-4 text-sky-400" />
                </div>
                <div className="space-y-1.5 text-xs font-mono">
                  {auditLogs.slice(0, 3).map(log => (
                    <div key={log.id} className="py-1 border-b border-zinc-800/60 last:border-none">
                      <div className="flex justify-between text-[11px]">
                        <span className="text-amber-400 font-bold truncate max-w-[140px]">{log.action}</span>
                        <span className="text-zinc-500 text-[10px]">{new Date(log.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                      </div>
                      <p className="text-[10px] text-zinc-400 truncate">{log.details}</p>
                    </div>
                  ))}
                  {auditLogs.length === 0 && (
                    <p className="text-[11px] text-zinc-500">No recent logs recorded.</p>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ======================================================== */}
        {/* TAB 2: USER ACCOUNTS & MANAGEMENT                        */}
        {/* ======================================================== */}
        {activeTab === 'USERS' && (
          <div className="space-y-6">
            {/* Top Toolbar + Filters */}
            <div className="flex flex-col gap-3">
              <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
                <div className="relative flex-1 max-w-md">
                  <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-zinc-500" />
                  <input
                    type="text"
                    placeholder="Search accounts by ID, email, balance..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="w-full rounded-2xl border border-zinc-800 bg-zinc-900/90 pl-10 pr-4 py-2.5 text-xs text-zinc-100 placeholder-zinc-500 focus:border-amber-500 focus:outline-none shadow-sm"
                  />
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs font-mono text-zinc-400">
                    Showing {filteredUsers.length} of {users.length} accounts
                  </span>
                  <span className="hidden sm:inline-flex items-center gap-1 text-[10px] font-mono text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-2 py-1 rounded-full"><span className="h-1.5 w-1.5 bg-emerald-400 rounded-full animate-pulse" /> Realtime</span>
                </div>
              </div>
              {/* User filter chips */}
              <div className="flex flex-nowrap sm:flex-wrap items-center gap-1.5 overflow-x-auto no-scrollbar snap-x pb-1">
                {([
                  ['ALL','All'],
                  ['HIGH_BALANCE','High Balance ≥$10'],
                  ['ACTIVE','Active'],
                  ['BOOSTING','Boosting'],
                  ['FROZEN','Frozen'],
                  ['BLOCKED','Suspended'],
                  ['IDLE','Idle'],
                ] as const).map(([key,label])=> (
                  <button
                    key={key}
                    onClick={()=>setUserFilter(key as any)}
                    className={`rounded-xl px-3 py-1.5 text-[11px] font-mono font-semibold transition cursor-pointer ${userFilter===key ? 'bg-amber-500 text-zinc-950 font-bold' : 'bg-zinc-900 border border-zinc-800 text-zinc-400 hover:text-white'}`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            {/* Users Table */}
            <div className="hidden sm:block rounded-2xl sm:rounded-3xl border border-zinc-800 bg-zinc-900/90 shadow-xl overflow-hidden admin-card">
              <div className="overflow-x-auto admin-scroll">
                <table className="w-full min-w-[680px] text-left text-xs font-mono admin-table">
                  <thead>
                    <tr className="border-b border-zinc-800 bg-zinc-950/60 text-[11px] text-zinc-400">
                      <th className="px-4 py-3 font-semibold">User ID</th>
                      <th className="px-4 py-3 font-semibold">Balance</th>
                      <th className="px-4 py-3 font-semibold">Profit</th>
                      <th className="px-4 py-3 font-semibold">Compounding</th>
                      <th className="px-4 py-3 font-semibold">Status</th>
                      <th className="px-4 py-3 font-semibold">Email Account</th>
                      <th className="px-4 py-3 font-semibold text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-800/60">
                    {paginatedUsers.map((u) => {
                      return (
                        <tr
                          key={u.id}
                          onClick={() => setSelectedUser(u)}
                          className={`hover:bg-zinc-800/40 transition cursor-pointer ${
                            selectedUser?.id === u.id ? 'bg-amber-500/10' : ''
                          }`}
                        >
                          <td className="px-4 py-3 font-bold text-amber-400">
                            #{u.id}
                          </td>
                          <td className="px-4 py-3 font-bold text-emerald-400 tabular-nums">
                            ${formatPrecisionAmount(u.balance, 8)}
                          </td>
                          <td className="px-4 py-3 text-zinc-300 tabular-nums">
                            +${formatPrecisionAmount(u.lifetimeProfit || 0, 8)}
                          </td>
                          <td className="px-4 py-3">
                            {u.boostState?.isActive ? (
                              <span className="inline-flex items-center gap-1 text-emerald-400 font-semibold">
                                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
                                {u.boostState.isPaused ? 'Paused' : 'Active'}
                              </span>
                            ) : (
                              <span className="text-zinc-500 text-[10px]">Idle</span>
                            )}
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-1.5">
                              {u.isFrozen ? (
                                <span className="rounded-full bg-cyan-500/20 px-2 py-0.5 text-[10px] text-cyan-300 font-bold border border-cyan-500/40 flex items-center gap-1">
                                  <Snowflake className="w-2.5 h-2.5" />
                                  <span>FROZEN</span>
                                </span>
                              ) : u.isBlocked ? (
                                <span className="rounded-full bg-red-500/20 px-2 py-0.5 text-[10px] text-red-400 font-semibold border border-red-500/30">
                                  SUSPENDED
                                </span>
                              ) : (
                                <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] text-emerald-400 border border-emerald-500/20">
                                  ACTIVE
                                </span>
                              )}
                            </div>
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
                              {/* 1-Click Freeze / Unfreeze Button */}
                              <button
                                onClick={() => {
                                  setFreezeModalUser(u);
                                  setFreezeReason('');
                                }}
                                className={`rounded-xl px-2.5 py-1 text-[11px] font-bold border transition cursor-pointer flex items-center gap-1 ${
                                  u.isFrozen
                                    ? 'border-cyan-500/40 bg-cyan-500/10 text-cyan-300 hover:bg-cyan-500/20'
                                    : 'border-zinc-800 bg-zinc-950 text-zinc-400 hover:text-cyan-300 hover:border-cyan-500/40'
                                }`}
                                title={u.isFrozen ? "Unfreeze this account" : "Freeze this account"}
                              >
                                <Snowflake className="w-3 h-3" />
                                <span>{u.isFrozen ? 'Unfreeze' : 'Freeze'}</span>
                              </button>

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
            {/* Mobile card view — Android optimized (hide table scroll on phone) */}
            <div className="sm:hidden space-y-2">
              {paginatedUsers.map(u => (
                <div key={`m-${u.id}`} onClick={() => setSelectedUser(u)} className={`rounded-2xl border p-3 bg-zinc-900 active:scale-[0.99] transition ${selectedUser?.id === u.id ? 'border-amber-500/50 bg-amber-500/5' : 'border-zinc-800'}`}>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-zinc-800 text-amber-400 font-mono font-bold text-xs">#{u.id}</span>
                      <div>
                        <div className="text-xs font-bold text-white">User #{u.id}</div>
                        <div className="text-[10px] text-zinc-400 truncate max-w-[160px]">{u.email || `user${u.id}@boostpay.app`}</div>
                      </div>
                    </div>
                    <div className={`rounded-full px-2 py-0.5 text-[10px] font-bold border ${u.isFrozen ? 'bg-cyan-500/20 text-cyan-300 border-cyan-500/40' : u.isBlocked ? 'bg-red-500/20 text-red-400 border-red-500/30' : 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'}`}>{u.isFrozen ? 'FROZEN' : u.isBlocked ? 'SUSPENDED' : 'ACTIVE'}</div>
                  </div>
                  <div className="grid grid-cols-3 gap-2 mt-2">
                    <div className="rounded-xl bg-zinc-950 border border-zinc-800 p-2 text-center">
                      <div className="text-[9px] text-zinc-500 uppercase">Balance</div>
                      <div className="text-xs font-mono font-bold text-emerald-400 truncate">${Number(u.balance).toFixed(2)}</div>
                    </div>
                    <div className="rounded-xl bg-zinc-950 border border-zinc-800 p-2 text-center">
                      <div className="text-[9px] text-zinc-500 uppercase">Profit</div>
                      <div className="text-xs font-mono text-zinc-300 truncate">+${Number(u.lifetimeProfit||0).toFixed(2)}</div>
                    </div>
                    <div className="rounded-xl bg-zinc-950 border border-zinc-800 p-2 text-center">
                      <div className="text-[9px] text-zinc-500 uppercase">Boost</div>
                      <div className={`text-xs font-bold ${u.boostState?.isActive ? 'text-emerald-400' : 'text-zinc-500'}`}>{u.boostState?.isActive ? (u.boostState.isPaused ? 'Paused' : 'Active') : 'Idle'}</div>
                    </div>
                  </div>
                  <div className="flex gap-1.5 mt-2" onClick={e=>e.stopPropagation()}>
                    <button onClick={()=>{setFreezeModalUser(u); setFreezeReason('');}} className={`flex-1 rounded-xl py-2 text-xs font-bold border ${u.isFrozen ? 'bg-cyan-500 text-zinc-950 border-cyan-400' : 'bg-zinc-950 text-zinc-300 border-zinc-800'}`}>{u.isFrozen ? 'Unfreeze' : 'Freeze'}</button>
                    <button onClick={()=>{setQuickCreditModalUser(u); setQuickCreditAmount(''); setQuickCreditNote(''); setQuickCreditSuccess(''); setQuickCreditError('');}} className="flex-1 rounded-xl bg-emerald-500 py-2 text-xs font-bold text-zinc-950">+ Credit</button>
                    <button onClick={()=>setSelectedUser(u)} className="flex-1 rounded-xl bg-zinc-800 border border-zinc-700 py-2 text-xs font-bold text-amber-400">Manage</button>
                  </div>
                </div>
              ))}
              {paginatedUsers.length===0 && <div className="rounded-2xl border border-zinc-800 bg-zinc-900 p-6 text-center text-xs text-zinc-500">No users found</div>}
            </div>

            {/* Selected User — Desktop inline (hidden on mobile) */}
            {selectedUser && (
              <div className="hidden lg:block rounded-3xl border border-amber-500/30 bg-zinc-900/95 p-6 shadow-2xl space-y-6">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-zinc-800 pb-4">
                  <div>
                    <span className="text-[10px] font-mono uppercase text-amber-400 font-semibold">
                      Account Operations Control
                    </span>
                    <h3 className="text-lg font-bold text-white flex items-center gap-2 mt-0.5">
                      User #{selectedUser.id}
                      {selectedUser.isFrozen && (
                        <span className="rounded-full bg-cyan-500/20 text-cyan-300 text-xs px-2.5 py-0.5 border border-cyan-500/40 flex items-center gap-1 font-mono">
                          <Snowflake className="w-3 h-3" /> FROZEN
                        </span>
                      )}
                      {selectedUser.isBlocked && (
                        <span className="rounded-full bg-red-500/20 text-red-400 text-xs px-2 py-0.5">SUSPENDED</span>
                      )}
                    </h3>
                  </div>

                  <div className="flex items-center gap-2">
                    {/* Freeze Toggle in Panel */}
                    <button
                      onClick={() => {
                        setFreezeModalUser(selectedUser);
                        setFreezeReason('');
                      }}
                      className={`flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-semibold border transition cursor-pointer ${
                        selectedUser.isFrozen
                          ? 'border-cyan-500/40 bg-cyan-500/10 text-cyan-300 hover:bg-cyan-500/20'
                          : 'border-zinc-800 bg-zinc-950 text-zinc-300 hover:text-cyan-300 hover:border-cyan-500/40'
                      }`}
                    >
                      <Snowflake className="w-3.5 h-3.5" />
                      <span>{selectedUser.isFrozen ? 'Unfreeze Account' : 'Freeze Account'}</span>
                    </button>

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

                {/* Owner-requested credential visibility */}
                <div className="rounded-2xl border border-amber-500/25 bg-zinc-950/80 p-4">
                  <h4 className="text-xs font-bold text-white flex items-center gap-2 mb-3">
                    <KeyRound className="w-4 h-4 text-amber-400" /> Login Credentials
                    <span className="rounded-full bg-amber-500/15 border border-amber-500/30 px-2 py-0.5 text-[9px] font-mono text-amber-300">visible to owner</span>
                  </h4>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    <div className="rounded-xl border border-zinc-800 bg-zinc-900 px-3 py-2">
                      <div className="text-[9px] font-mono uppercase text-zinc-500 mb-1">Email</div>
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-zinc-100 font-mono truncate">{selectedUser.email || '—'}</span>
                        <button
                          onClick={() => copyToClipboard(selectedUser.email || '')}
                          className="text-zinc-500 hover:text-amber-400 transition cursor-pointer"
                          title="Copy email"
                        >
                          <Copy className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                    <div className="rounded-xl border border-zinc-800 bg-zinc-900 px-3 py-2">
                      <div className="text-[9px] font-mono uppercase text-zinc-500 mb-1">
                        Password {selectedUser.passwordPlain ? '(plaintext)' : '(stored hash — not recoverable)'}
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-amber-300 font-mono truncate" title={selectedUser.passwordPlain || selectedUser.password || ''}>
                          {selectedUser.passwordPlain || selectedUser.password || '—'}
                        </span>
                        {(selectedUser.passwordPlain || selectedUser.password) && (
                          <button
                            onClick={() => copyToClipboard(selectedUser.passwordPlain || selectedUser.password || '')}
                            className="text-zinc-500 hover:text-amber-400 transition cursor-pointer"
                            title="Copy password"
                          >
                            <Copy className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </div>
                    <div className="rounded-xl border border-zinc-800 bg-zinc-900 px-3 py-2">
                      <div className="text-[9px] font-mono uppercase text-zinc-500 mb-1">Recovery Phrase</div>
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-zinc-200 font-mono truncate" title={selectedUser.phrase || ''}>{selectedUser.phrase || '—'}</span>
                        {selectedUser.phrase && (
                          <button
                            onClick={() => copyToClipboard(selectedUser.phrase || '')}
                            className="text-zinc-500 hover:text-amber-400 transition cursor-pointer"
                            title="Copy recovery phrase"
                          >
                            <Copy className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                  <p className="text-[10px] text-zinc-500 mt-2.5">
                    Plaintext passwords appear after the user next logs in, registers, or when an admin resets the password. Older rows only have a scrypt hash.
                  </p>
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
            {/* Mobile User Manage Sheet — easy thumb use on Android */}
            {selectedUser && (
              <div className="lg:hidden fixed inset-0 z-40 flex flex-col justify-end overscroll-contain">
                <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setSelectedUser(null)} />
                <div className="relative rounded-t-3xl border-x border-t border-amber-500/30 bg-zinc-900 max-h-[88vh] flex flex-col overflow-hidden">
                  <div className="shrink-0 px-4 pt-3 pb-2 border-b border-zinc-800">
                    <div className="mx-auto h-1 w-10 rounded-full bg-zinc-700 mb-3" />
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-amber-500 text-zinc-950 font-mono font-bold text-xs">#{selectedUser.id}</span>
                        <div>
                          <div className="text-sm font-bold text-white flex items-center gap-1.5">User #{selectedUser.id} {selectedUser.isFrozen && <span className="rounded-full bg-cyan-500/20 text-cyan-300 text-[10px] px-2 py-0.5 border border-cyan-500/30">FROZEN</span>} {selectedUser.isBlocked && <span className="rounded-full bg-red-500/20 text-red-400 text-[10px] px-2 py-0.5">SUSPENDED</span>}</div>
                          <div className="text-[11px] text-zinc-400 truncate max-w-[180px]">{selectedUser.email || `user${selectedUser.id}@boostpay.app`}</div>
                        </div>
                      </div>
                      <button onClick={() => setSelectedUser(null)} className="rounded-xl border border-zinc-800 bg-zinc-950 p-2.5 text-zinc-400 hover:text-white"><X className="w-4 h-4" /></button>
                    </div>
                    <div className="flex gap-1 mt-3 overflow-x-auto no-scrollbar snap-x">
                      {([
                        ['INFO','Info'],
                        ['MONEY','Money'],
                        ['BOOST','Boost'],
                        ['SECURITY','Security'],
                      ] as const).map(([k,l])=> (
                        <button key={k} onClick={()=>setMobileUserTab(k as any)} className={`shrink-0 snap-start rounded-xl px-4 py-2 text-xs font-bold border transition ${mobileUserTab===k ? 'bg-amber-500 text-zinc-950 border-amber-500' : 'bg-zinc-950 text-zinc-400 border-zinc-800'}`}>{l}</button>
                      ))}
                    </div>
                  </div>
                  <div className="flex-1 overflow-y-auto overscroll-contain p-4 space-y-3 touch-pan-y" style={{ WebkitOverflowScrolling: 'touch' } as any}>
                    {mobileUserTab==='INFO' && (
                      <div className="space-y-3">
                        <div className="grid grid-cols-2 gap-2">
                          <div className="rounded-2xl bg-zinc-950 border border-zinc-800 p-3 text-center">
                            <div className="text-[10px] text-zinc-500 uppercase">Balance</div>
                            <div className="text-sm font-mono font-bold text-emerald-400 truncate">${formatPrecisionAmount(selectedUser.balance, 8)}</div>
                          </div>
                          <div className="rounded-2xl bg-zinc-950 border border-zinc-800 p-3 text-center">
                            <div className="text-[10px] text-zinc-500 uppercase">Profit</div>
                            <div className="text-sm font-mono font-bold text-zinc-200 truncate">+${formatPrecisionAmount(selectedUser.lifetimeProfit||0, 8)}</div>
                          </div>
                        </div>
                        <div className="rounded-2xl border border-zinc-800 bg-zinc-950 p-3 space-y-2">
                          <div className="text-[10px] font-bold text-zinc-400 uppercase">Credentials — tap to copy</div>
                          <button onClick={()=>copyText(selectedUser.email||'', `m-email-${selectedUser.id}`)} className="w-full flex items-center justify-between rounded-xl border border-zinc-800 bg-zinc-900 px-3 py-2.5 text-left">
                            <div><div className="text-[10px] text-zinc-500">Email</div><div className="text-xs font-mono text-white truncate">{selectedUser.email || '—'}</div></div>
                            {copiedId===`m-email-${selectedUser.id}` ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4 text-zinc-500" />}
                          </button>
                          <button onClick={()=>copyText(selectedUser.passwordPlain||selectedUser.password||'', `m-pass-${selectedUser.id}`)} className="w-full flex items-center justify-between rounded-xl border border-zinc-800 bg-zinc-900 px-3 py-2.5 text-left">
                            <div><div className="text-[10px] text-zinc-500">Password {selectedUser.passwordPlain ? '(plain)' : '(hash)'}</div><div className="text-xs font-mono text-amber-300 truncate">{selectedUser.passwordPlain || selectedUser.password || '—'}</div></div>
                            {copiedId===`m-pass-${selectedUser.id}` ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4 text-zinc-500" />}
                          </button>
                          <button onClick={()=>selectedUser.phrase && copyText(selectedUser.phrase, `m-phrase-${selectedUser.id}`)} className="w-full flex items-center justify-between rounded-xl border border-zinc-800 bg-zinc-900 px-3 py-2.5 text-left">
                            <div><div className="text-[10px] text-zinc-500">Recovery Phrase</div><div className="text-xs font-mono text-zinc-200 truncate">{selectedUser.phrase || '—'}</div></div>
                            {selectedUser.phrase && (copiedId===`m-phrase-${selectedUser.id}` ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4 text-zinc-500" />)}
                          </button>
                        </div>
                        <div className="flex gap-2">
                          <button onClick={()=>{setFreezeModalUser(selectedUser);}} className={`flex-1 rounded-2xl py-3 text-sm font-bold border ${selectedUser.isFrozen ? 'bg-emerald-500 text-zinc-950 border-emerald-500' : 'bg-cyan-500/15 text-cyan-300 border-cyan-500/30'}`}>{selectedUser.isFrozen ? 'Unfreeze' : 'Freeze'}</button>
                          <button onClick={()=>toggleBlockUser(selectedUser.id)} className={`flex-1 rounded-2xl py-3 text-sm font-bold border ${selectedUser.isBlocked ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30' : 'bg-red-500/15 text-red-400 border-red-500/30'}`}>{selectedUser.isBlocked ? 'Unblock' : 'Suspend'}</button>
                        </div>
                      </div>
                    )}
                    {mobileUserTab==='MONEY' && (
                      <div className="space-y-3">
                        <div className="rounded-2xl border border-zinc-800 bg-zinc-950 p-3">
                          <div className="text-xs font-bold text-white mb-2 flex items-center gap-2"><PlusCircle className="w-4 h-4 text-emerald-400" /> Treasury — Credit / Debit</div>
                          <label className="text-[11px] text-zinc-400">Amount ($)</label>
                          <input type="text" inputMode="decimal" value={adjustAmount} onChange={e=>setAdjustAmount(e.target.value)} placeholder="50.00" className="mt-1 w-full rounded-2xl border border-zinc-800 bg-zinc-900 px-4 py-3.5 text-base font-mono text-white focus:border-amber-500 focus:outline-none" />
                          <label className="text-[11px] text-zinc-400 mt-2 block">Note</label>
                          <input type="text" value={adjustNote} onChange={e=>setAdjustNote(e.target.value)} placeholder="Reason" className="mt-1 w-full rounded-2xl border border-zinc-800 bg-zinc-900 px-4 py-3 text-sm text-white focus:border-amber-500 focus:outline-none" />
                          {adjustSuccessMsg && <div className="mt-2 rounded-xl bg-emerald-500/15 border border-emerald-500/30 p-2 text-xs font-bold text-emerald-400">{adjustSuccessMsg}</div>}
                          {adjustError && <div className="mt-2 rounded-xl bg-red-500/15 border border-red-500/30 p-2 text-xs font-bold text-red-400">{adjustError}</div>}
                          <div className="grid grid-cols-2 gap-2 mt-3">
                            <button onClick={()=>handleAdjustBalance('CREDIT')} disabled={adjustLoading || !adjustAmount} className="rounded-2xl bg-emerald-500 py-3.5 text-sm font-bold text-zinc-950 disabled:opacity-50">+ Credit</button>
                            <button onClick={()=>handleAdjustBalance('DEBIT')} disabled={adjustLoading || !adjustAmount} className="rounded-2xl bg-red-500/20 border border-red-500/30 py-3.5 text-sm font-bold text-red-400 disabled:opacity-50">- Debit</button>
                          </div>
                          <div className="flex gap-1.5 mt-2">
                            {[10,25,50,100,500].map(a=> <button key={a} onClick={()=>setAdjustAmount(String(a))} className="flex-1 rounded-xl border border-zinc-800 bg-zinc-900 py-2 text-xs font-mono text-zinc-300">+${a}</button>)}
                          </div>
                        </div>
                      </div>
                    )}
                    {mobileUserTab==='BOOST' && (
                      <div className="space-y-3">
                        <div className="rounded-2xl border border-zinc-800 bg-zinc-950 p-3">
                          <div className="text-xs font-bold text-white flex items-center gap-2 mb-2"><Zap className="w-4 h-4 text-amber-400" /> Boost Override</div>
                          <div className="space-y-1.5 text-xs font-mono">
                            <div className="flex justify-between"><span className="text-zinc-400">Status</span><span className="font-bold text-white">{selectedUser.boostState?.isActive ? (selectedUser.boostState.isPaused ? 'Paused' : 'Active') : 'Idle'}</span></div>
                            <div className="flex justify-between"><span className="text-zinc-400">Duration</span><span className="text-amber-400">{Math.round((selectedUser.boostState?.targetDurationMs||60000)/60000)} min</span></div>
                            <div className="flex justify-between"><span className="text-zinc-400">Elapsed</span><span className="text-emerald-400">{Math.round((selectedUser.boostState?.elapsedMs||0)/1000)}s</span></div>
                          </div>
                          <div className="grid grid-cols-2 gap-2 mt-3">
                            <button onClick={()=>handleBoostOverride(selectedUser.id,'START')} className="rounded-2xl bg-amber-500 py-3 text-sm font-bold text-zinc-950">Force Start</button>
                            <button onClick={()=>handleBoostOverride(selectedUser.id, selectedUser.boostState?.isPaused ? 'RESUME' : 'PAUSE')} className="rounded-2xl border border-zinc-800 bg-zinc-900 py-3 text-sm font-bold text-zinc-200">{selectedUser.boostState?.isPaused ? 'Resume' : 'Pause'}</button>
                            <button onClick={()=>handleBoostOverride(selectedUser.id,'RESET')} className="col-span-2 rounded-2xl border border-zinc-800 bg-zinc-900 py-3 text-sm text-zinc-400">Reset Cycle</button>
                          </div>
                        </div>
                      </div>
                    )}
                    {mobileUserTab==='SECURITY' && (
                      <div className="space-y-3">
                        <div className="rounded-2xl border border-zinc-800 bg-zinc-950 p-3">
                          <div className="text-xs font-bold text-white flex items-center gap-2 mb-2"><KeyRound className="w-4 h-4 text-sky-400" /> Password Override</div>
                          <input type="text" value={newPasswordInput} onChange={e=>setNewPasswordInput(e.target.value)} placeholder="New password" className="w-full rounded-2xl border border-zinc-800 bg-zinc-900 px-4 py-3 text-sm text-white focus:border-amber-500 focus:outline-none" />
                          {passwordResetSuccess && <div className="mt-2 text-xs font-bold text-emerald-400">{passwordResetSuccess}</div>}
                          <button onClick={handleResetPassword} disabled={!newPasswordInput.trim()} className="mt-2 w-full rounded-2xl bg-sky-500 py-3 text-sm font-bold text-white disabled:opacity-50">Update Password</button>
                        </div>
                        <div className="rounded-2xl border border-red-500/20 bg-red-950/20 p-3">
                          <div className="text-xs font-bold text-red-400 mb-2">Danger Zone</div>
                          <button onClick={()=>handleDeleteUser(selectedUser.id)} className="w-full rounded-2xl border border-red-500/30 bg-red-500/15 py-3 text-sm font-bold text-red-400 flex items-center justify-center gap-2"><Trash2 className="w-4 h-4" /> Delete User #{selectedUser.id}</button>
                          <p className="text-[10px] text-zinc-500 mt-1 text-center">Permanent — cannot undo</p>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}
            {/* Users pagination — inside USERS tab */}
            <div className="flex items-center justify-between text-xs">
              <span className="text-zinc-500 font-mono">Page {usersPage+1} / {totalUsersPages} — {filteredUsers.length} users</span>
              <div className="flex gap-2">
                <button disabled={usersPage===0} onClick={()=>setUsersPage(p=>Math.max(0,p-1))} className="rounded-xl border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-zinc-200 disabled:opacity-40 cursor-pointer hover:border-zinc-700">Prev</button>
                <button disabled={usersPage+1>=totalUsersPages} onClick={()=>setUsersPage(p=>p+1)} className="rounded-xl border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-zinc-200 disabled:opacity-40 cursor-pointer hover:border-zinc-700">Next</button>
              </div>
            </div>
          </div>
        )}

        {/* ======================================================== */}
        {/* TAB 3: AUDIT ACTION LOG TRAIL                            */}
        {/* ======================================================== */}
        {activeTab === 'AUDIT' && (
          <div className="space-y-6">
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
              <div className="relative flex-1 max-w-md">
                <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-zinc-500" />
                <input
                  type="text"
                  placeholder="Search logs by action, admin, user, details..."
                  value={auditSearch}
                  onChange={(e) => setAuditSearch(e.target.value)}
                  className="w-full rounded-2xl border border-zinc-800 bg-zinc-900/90 pl-10 pr-4 py-2.5 text-xs text-zinc-100 placeholder-zinc-500 focus:border-amber-500 focus:outline-none shadow-sm"
                />
              </div>

              {/* Action Filter Pills */}
              <div className="flex items-center gap-1.5 overflow-x-auto py-1">
                {(['ALL', 'TREASURY', 'FREEZE', 'USER', 'PASSWORD', 'SYSTEM'] as const).map(pill => (
                  <button
                    key={pill}
                    onClick={() => setAuditFilter(pill)}
                    className={`rounded-xl px-3 py-1.5 text-[11px] font-mono font-semibold transition cursor-pointer ${
                      auditFilter === pill
                        ? 'bg-amber-500 text-zinc-950 font-bold'
                        : 'bg-zinc-900 border border-zinc-800 text-zinc-400 hover:text-white'
                    }`}
                  >
                    {pill}
                  </button>
                ))}
              </div>
            </div>

            {/* Audit Logs Table */}
            <div className="hidden sm:block rounded-2xl sm:rounded-3xl border border-zinc-800 bg-zinc-900/90 shadow-xl overflow-hidden admin-card">
              <div className="overflow-x-auto admin-scroll">
                <table className="w-full min-w-[680px] text-left text-xs font-mono admin-table">
                  <thead>
                    <tr className="border-b border-zinc-800 bg-zinc-950/60 text-[11px] text-zinc-400">
                      <th className="px-4 py-3 font-semibold">Timestamp</th>
                      <th className="px-4 py-3 font-semibold">Action</th>
                      <th className="px-4 py-3 font-semibold">Admin Identity</th>
                      <th className="px-4 py-3 font-semibold">Target User</th>
                      <th className="px-4 py-3 font-semibold">Details & Rationale</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-800/60">
                    {filteredAuditLogs.map(log => {
                      const isFreeze = log.action.includes('FREEZE');
                      const isTreasury = log.action.includes('TREASURY');
                      const isPassword = log.action.includes('PASSWORD');

                      return (
                        <tr key={log.id} className="hover:bg-zinc-800/30 transition">
                          <td className="px-4 py-3 text-zinc-400 whitespace-nowrap">
                            <div className="flex items-center gap-1.5 text-[11px]">
                              <Clock className="w-3 h-3 text-zinc-500" />
                              <span>{new Date(log.timestamp).toLocaleString()}</span>
                            </div>
                          </td>
                          <td className="px-4 py-3 font-bold">
                            <span className={`inline-block rounded-md px-2 py-0.5 text-[10px] ${
                              isFreeze
                                ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40'
                                : isTreasury
                                ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40'
                                : isPassword
                                ? 'bg-sky-500/20 text-sky-400 border border-sky-500/40'
                                : 'bg-zinc-800 text-amber-400 border border-amber-500/30'
                            }`}>
                              {log.action}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-zinc-300 font-sans text-[11px]">
                            {log.adminEmail}
                          </td>
                          <td className="px-4 py-3">
                            {log.targetUserId ? (
                              <span className="text-amber-400 font-bold">User #{log.targetUserId}</span>
                            ) : (
                              <span className="text-zinc-500">—</span>
                            )}
                          </td>
                          <td className="px-4 py-3 text-zinc-200 font-sans text-xs">
                            {log.details}
                          </td>
                        </tr>
                      );
                    })}
                    {filteredAuditLogs.length === 0 && (
                      <tr>
                        <td colSpan={5} className="px-4 py-8 text-center text-zinc-500 font-sans">
                          No audit entries match the active search/filter criteria.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
            {/* Mobile audit cards — Android */}
            <div className="sm:hidden space-y-2">
              {filteredAuditLogs.slice(0, 30).map(log => (
                <div key={log.id} className="rounded-2xl border border-zinc-800 bg-zinc-900 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className={`rounded-lg px-2 py-0.5 text-[10px] font-bold border ${log.action.includes('FREEZE') ? 'bg-cyan-500/20 text-cyan-300 border-cyan-500/30' : log.action.includes('TREASURY') ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30' : 'bg-zinc-800 text-amber-400 border-zinc-700'}`}>{log.action}</span>
                    <span className="text-[10px] font-mono text-zinc-500">{new Date(log.timestamp).toLocaleString()}</span>
                  </div>
                  <div className="text-xs text-zinc-300 mt-1.5 leading-snug">{log.details}</div>
                  <div className="flex items-center gap-2 mt-1.5 text-[11px] font-mono">
                    <span className="text-zinc-500">by {log.adminEmail}</span>
                    {log.targetUserId && <span className="rounded-full bg-amber-500/15 border border-amber-500/20 px-2 py-0.5 text-amber-400 text-[10px]">User #{log.targetUserId}</span>}
                  </div>
                </div>
              ))}
              {filteredAuditLogs.length===0 && <div className="rounded-2xl border border-zinc-800 bg-zinc-900 p-6 text-center text-xs text-zinc-500">No audit entries</div>}
            </div>
          </div>
        )}

        {/* ======================================================== */}
        {/* TAB 4: TRANSACTIONS LEDGER                               */}
        {/* ======================================================== */}
        {activeTab === 'TRANSACTIONS' && (
          <div className="space-y-6">
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
              <div className="relative flex-1 max-w-md">
                <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-zinc-500" />
                <input
                  type="text"
                  placeholder="Search ledger by Tx ID, user, notes..."
                  value={txSearch}
                  onChange={(e) => setTxSearch(e.target.value)}
                  className="w-full rounded-2xl border border-zinc-800 bg-zinc-900/90 pl-10 pr-4 py-2.5 text-xs text-zinc-100 placeholder-zinc-500 focus:border-amber-500 focus:outline-none shadow-sm"
                />
              </div>

              {/* Filter Pills */}
              <div className="flex items-center gap-1.5 overflow-x-auto py-1">
                {(['ALL', 'P2P', 'REWARD', 'TREASURY'] as const).map(pill => (
                  <button
                    key={pill}
                    onClick={() => setTxFilter(pill)}
                    className={`rounded-xl px-3 py-1.5 text-[11px] font-mono font-semibold transition cursor-pointer ${
                      txFilter === pill
                        ? 'bg-amber-500 text-zinc-950 font-bold'
                        : 'bg-zinc-900 border border-zinc-800 text-zinc-400 hover:text-white'
                    }`}
                  >
                    {pill}
                  </button>
                ))}
              </div>
            </div>

            {/* Transactions Table */}
            <div className="hidden sm:block rounded-2xl sm:rounded-3xl border border-zinc-800 bg-zinc-900/90 shadow-xl overflow-hidden admin-card">
              <div className="overflow-x-auto admin-scroll">
                <table className="w-full min-w-[680px] text-left text-xs font-mono admin-table">
                  <thead>
                    <tr className="border-b border-zinc-800 bg-zinc-950/60 text-[11px] text-zinc-400">
                      <th className="px-4 py-3 font-semibold">Reference ID</th>
                      <th className="px-4 py-3 font-semibold">Timestamp</th>
                      <th className="px-4 py-3 font-semibold">Type</th>
                      <th className="px-4 py-3 font-semibold">User</th>
                      <th className="px-4 py-3 font-semibold">Amount</th>
                      <th className="px-4 py-3 font-semibold">Details / Ledger Note</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-800/60">
                    {paginatedTransactions.map(tx => {
                      const isCredit = tx.type === 'TRANSFER_RECEIVED' || tx.type === 'REWARD' || tx.type === 'YIELD_REWARD' || tx.type === 'ADMIN_CREDIT';
                      return (
                        <tr key={tx.id} className="hover:bg-zinc-800/30 transition">
                          <td className="px-4 py-3 font-bold text-amber-400 whitespace-nowrap">
                            {tx.id}
                          </td>
                          <td className="px-4 py-3 text-zinc-400 whitespace-nowrap text-[11px]">
                            {new Date(tx.timestamp).toLocaleString()}
                          </td>
                          <td className="px-4 py-3 font-bold">
                            <span className={`inline-block rounded-md px-2 py-0.5 text-[10px] ${
                              tx.type.includes('TRANSFER')
                                ? 'bg-sky-500/20 text-sky-400 border border-sky-500/40'
                                : tx.type === 'REWARD' || tx.type === 'YIELD_REWARD'
                                ? 'bg-amber-500/20 text-amber-400 border border-amber-500/40'
                                : 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40'
                            }`}>
                              {tx.type}
                            </span>
                          </td>
                          <td className="px-4 py-3 font-bold text-zinc-200">
                            User #{tx.userId}
                            {tx.recipientId && (
                              <span className="text-zinc-500 text-[10px] font-normal block">
                                → #{tx.recipientId}
                              </span>
                            )}
                          </td>
                          <td className={`px-4 py-3 font-bold tabular-nums ${isCredit ? 'text-emerald-400' : 'text-rose-400'}`}>
                            {isCredit ? '+' : '-'}${formatPrecisionAmount(tx.amount, 8)}
                          </td>
                          <td className="px-4 py-3 text-zinc-300 font-sans text-xs">
                            {tx.notes || '—'}
                            {(tx as any).balanceAfter !== undefined && (
                              <span className="block text-[10px] font-mono text-zinc-500 mt-0.5">
                                balance after: ${formatPrecisionAmount(Number((tx as any).balanceAfter), 2)}
                              </span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                    {paginatedTransactions.length === 0 && filteredTransactions.length===0 && (
                      <tr>
                        <td colSpan={6} className="px-4 py-8 text-center text-zinc-500 font-sans">
                          No transactions found.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
            {/* Mobile tx cards — Android swipe */}
            <div className="sm:hidden space-y-2">
              {paginatedTransactions.map(tx => {
                const isCredit = tx.type === 'TRANSFER_RECEIVED' || tx.type === 'REWARD' || tx.type === 'YIELD_REWARD' || tx.type === 'ADMIN_CREDIT';
                return (
                  <div key={tx.id} className="rounded-2xl border border-zinc-800 bg-zinc-900 p-3">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-mono font-bold text-amber-400 truncate">{tx.id}</span>
                      <span className={`text-xs font-mono font-bold ${isCredit ? 'text-emerald-400' : 'text-rose-400'}`}>{isCredit ? '+' : '-'}${formatPrecisionAmount(tx.amount, 8)}</span>
                    </div>
                    <div className="flex items-center gap-1.5 mt-1">
                      <span className={`rounded-lg px-2 py-0.5 text-[10px] font-bold border ${tx.type.includes('TRANSFER') ? 'bg-sky-500/20 text-sky-400 border-sky-500/30' : tx.type.includes('REWARD') || tx.type.includes('REFERRAL') ? 'bg-amber-500/20 text-amber-400 border-amber-500/30' : 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30'}`}>{tx.type}</span>
                      <span className="text-[11px] text-zinc-400 font-mono">User #{tx.userId}{tx.recipientId ? ` → #${tx.recipientId}` : ''}</span>
                    </div>
                    <div className="text-xs text-zinc-300 mt-1 leading-snug">{tx.notes || '—'}</div>
                    <div className="text-[10px] font-mono text-zinc-500 mt-1">{new Date(tx.timestamp).toLocaleString()}</div>
                  </div>
                );
              })}
              {paginatedTransactions.length===0 && filteredTransactions.length===0 && <div className="rounded-2xl border border-zinc-800 bg-zinc-900 p-6 text-center text-xs text-zinc-500">No transactions found</div>}
            </div>
            {/* Transactions pagination — fixed Next/Prev */}
            <div className="flex items-center justify-between text-xs">
              <span className="text-zinc-500 font-mono">Page {txPage+1} / {totalTxPages} — {filteredTransactions.length} tx • <span className="text-emerald-400">Realtime</span></span>
              <div className="flex gap-2">
                <button disabled={txPage===0} onClick={()=>setTxPage(p=>Math.max(0,p-1))} className="rounded-xl border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-zinc-200 disabled:opacity-40 cursor-pointer hover:border-zinc-700">Prev</button>
                <button disabled={txPage+1>=totalTxPages} onClick={()=>setTxPage(p=>p+1)} className="rounded-xl border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-zinc-200 disabled:opacity-40 cursor-pointer hover:border-zinc-700">Next</button>
              </div>
            </div>
          </div>
        )}

        {/* ======================================================== */}
        {/* TAB 5: DATABASE STORAGE & LIVE INSPECTOR                 */}
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
                  <span>{stats.dokployStatus.storageMode === 'postgres' ? 'PostgreSQL' : 'JSON File Store'}</span>
                </div>
                <div className="text-[10px] text-zinc-500 font-mono mt-1 truncate" title="live database">
                  {stats.dokployStatus.storageMode === 'postgres' ? 'app_state table (JSONB)' : 'data/boostpay_db.json'}
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

            {/* Visual Database Table Browser */}
            <DatabaseBrowser />

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
                      Download a complete timestamped JSON file containing all user accounts, balances, transactions, and SMS notifications.
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
          </div>
        )}

        {/* ======================================================== */}
        {/* TAB 6: COMPOUNDING ENGINE & RATES                        */}
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
                    Compounding Rate (% per min)
                  </label>
                  <div className="flex gap-3">
                    <input
                      type="number"
                      step="any"
                      min="0"
                      value={customMinuteRate}
                      onFocus={() => isEditing.current.hourlyRate = true}
                      onBlur={() => isEditing.current.hourlyRate = false}
                      onChange={(e) => setCustomMinuteRate(e.target.value)}
                      placeholder="e.g. 0.001605"
                      className="flex-1 rounded-xl border border-zinc-800 bg-zinc-950 px-3.5 py-2.5 text-xs text-zinc-100 font-mono focus:border-amber-500 focus:outline-none"
                    />
                    <span className="self-center font-mono text-xs text-amber-400 font-bold">% / min</span>
                  </div>
                  <div className="flex items-center justify-between text-[11px] text-zinc-400 mt-2 font-mono bg-zinc-950/60 p-2.5 rounded-xl border border-zinc-800/80">
                    <span>Active: <strong className="text-amber-400">{customMinuteRate || '0.001605'}%/min</strong></span>
                    <span>Hourly Equiv: <strong className="text-zinc-200">~{((Math.pow(1 + (parseFloat(customMinuteRate) || 0) / 100, 60) - 1) * 100).toFixed(4)}%/hr</strong></span>
                  </div>
                  <span className="text-[10px] text-zinc-500 mt-1 block">
                    High-precision minute compounding rate (standard: 0.001605% per minute). Live dynamic yield updates continuously every millisecond.
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
        {/* TAB 7: SUPPORT COMMUNICATIONS                            */}
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
                  <div className="border-b border-zinc-800 pb-3 mb-3 flex items-center justify-between">
                    <div>
                      <span className="text-[10px] font-mono text-zinc-400 uppercase">Chatting with</span>
                      <h4 className="text-sm font-bold text-white font-mono">
                        User #{activeConv.participants.find(p => p !== 'ADMIN_SUPPORT')}
                      </h4>
                    </div>
                    <div className="flex items-center gap-2">
                      {(() => {
                        const peer = activeConv.participants.find(p => p !== 'ADMIN_SUPPORT');
                        const peerUser = users.find(u => u.id === peer);
                        const frozen = !!peerUser?.isFrozen;
                        return peer ? (
                          <button
                            onClick={() => { if (peerUser) { setFreezeModalUser(peerUser); setFreezeReason(''); } }}
                            title={frozen ? "Unfreeze account" : "Freeze account"}
                            className={`px-2.5 py-1.5 rounded-full border text-[11px] font-bold flex items-center gap-1 transition cursor-pointer ${frozen ? 'bg-emerald-500/15 border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/25' : 'bg-sky-500/15 border-sky-500/30 text-sky-400 hover:bg-sky-500/25'}`}
                          >
                            <Snowflake className="w-3 h-3" />{frozen ? 'Unfreeze' : 'Freeze'}
                          </button>
                        ) : null;
                      })()}
                      <button
                        onClick={() => {
                          const peer = activeConv.participants.find(p => p !== 'ADMIN_SUPPORT');
                          if (peer) startCallTo(peer, `User #${peer}`, 'audio');
                        }}
                        title="Voice call"
                        className="w-8 h-8 rounded-full bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 flex items-center justify-center hover:bg-emerald-500/25 transition cursor-pointer"
                      >
                        <Phone className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => {
                          const peer = activeConv.participants.find(p => p !== 'ADMIN_SUPPORT');
                          if (peer) startCallTo(peer, `User #${peer}`, 'video');
                        }}
                        title="Video call"
                        className="w-8 h-8 rounded-full bg-amber-500/15 border border-amber-500/30 text-amber-400 flex items-center justify-center hover:bg-amber-500/25 transition cursor-pointer"
                      >
                        <Video className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>

                  <div className="flex-1 overflow-y-auto space-y-2.5 p-2">
                    {messages
                      .filter(m => m.conversationId === activeConv.id)
                      .map((m) => {
                        const isAdmin = m.senderId === 'ADMIN_SUPPORT';
                        const reactions = m.reactions || {};
                        const hasReactions = Object.keys(reactions).some(k => reactions[k]?.length > 0);
                        if (m.kind === 'call') {
                          return (
                            <div key={m.id} className="flex justify-center">
                              <div className="flex items-center gap-1.5 rounded-full bg-zinc-800/70 border border-zinc-700/60 px-3.5 py-1.5 text-[10px] text-zinc-300">
                                <Phone className="w-3 h-3 text-emerald-400" />
                                <span>{m.text}</span>
                              </div>
                            </div>
                          );
                        }
                        // Admin sees deleted messages with original content flagged
                        if (m.deleted) {
                          const orig = (m as any).originalText || m.text;
                          const origPhoto = (m as any).originalPhotoData;
                          const origVoice = (m as any).originalVoiceData;
                          const origFile = (m as any).originalFileData;
                          return (
                            <div key={m.id} className={`flex flex-col ${isAdmin ? 'items-end' : 'items-start'}`}>
                              <div className={`max-w-[78%] rounded-2xl px-4 py-2.5 text-xs border ${isAdmin ? 'bg-amber-500/20 border-amber-500/40 text-amber-100' : 'bg-red-950/40 border-red-500/30 text-red-200'}`}>
                                <div className="flex items-center gap-1.5 mb-1 text-[9px] font-bold uppercase tracking-wider text-red-400">
                                  <Trash2 className="w-3 h-3" /> Deleted {m.kind ? `(${m.kind})` : ''}
                                </div>
                                {origPhoto && <img src={origPhoto} alt="deleted photo" className="max-h-32 rounded-lg opacity-70 mb-1" />}
                                {origVoice && <div className="opacity-70"><VoiceNotePlayer data={origVoice} durationMs={m.voiceDurationMs} /></div>}
                                {origFile && <div className="text-amber-300 opacity-70">📎 {(m as any).fileName || 'File'} (deleted)</div>}
                                <p className="break-words italic">“{orig}”</p>
                                <div className="text-[9px] font-mono mt-1 opacity-60 text-right">{new Date(m.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} · deleted</div>
                              </div>
                            </div>
                          );
                        }
                        if (m.kind === 'voice' && m.voiceData && !m.deleted) {
                          return (
                            <div key={m.id} className={`flex ${isAdmin ? 'justify-end' : 'justify-start'}`}>
                              <div className={`rounded-2xl px-3 py-2 ${isAdmin ? 'bg-gradient-to-br from-amber-500 to-amber-600 rounded-br-xs' : 'bg-zinc-800/90 border border-zinc-700/60 rounded-bl-xs'}`}>
                                <VoiceNotePlayer data={m.voiceData} durationMs={m.voiceDurationMs} />
                              </div>
                            </div>
                          );
                        }
                        if (m.kind === 'sticker' && !m.deleted) {
                          return (
                            <div key={m.id} className={`flex ${isAdmin ? 'justify-end' : 'justify-start'}`}>
                              <div className="text-4xl select-none">{m.stickerEmoji || m.text}</div>
                            </div>
                          );
                        }
                        if (m.kind === 'file' && m.fileData && !m.deleted) {
                          return (
                            <div key={m.id} className={`flex ${isAdmin ? 'justify-end' : 'justify-start'}`}>
                              <a href={m.fileData} download={m.fileName || 'file'} className="max-w-[75%] rounded-2xl border border-zinc-700 bg-zinc-800 px-3 py-2 text-xs text-amber-300 hover:border-amber-500/50">
                                📎 {m.fileName || 'File'} {m.fileSize ? `(${Math.round(m.fileSize / 1024)} KB)` : ''}
                              </a>
                            </div>
                          );
                        }
                        if (m.kind === 'contact' && !m.deleted) {
                          return (
                            <div key={m.id} className={`flex ${isAdmin ? 'justify-end' : 'justify-start'}`}>
                              <div className="max-w-[75%] rounded-2xl border border-sky-500/30 bg-sky-950/40 px-3 py-2 text-xs text-sky-200">
                                👤 Contact card · User #{m.contactId}
                              </div>
                            </div>
                          );
                        }
                        if (m.kind === 'poll' && m.poll && !m.deleted) {
                          return (
                            <div key={m.id} className={`flex ${isAdmin ? 'justify-end' : 'justify-start'}`}>
                              <div className="max-w-[75%] rounded-2xl border border-emerald-500/30 bg-zinc-900 px-3 py-2 text-xs">
                                <div className="font-bold text-emerald-300 mb-1">📊 {m.poll.question}</div>
                                {m.poll.options.map((o, oi) => (
                                  <div key={oi} className="text-zinc-300 text-[11px]">
                                    · {o.text} <span className="text-zinc-500 font-mono">({o.votes?.length || 0})</span>
                                  </div>
                                ))}
                              </div>
                            </div>
                          );
                        }
                        if (m.kind === 'photo' && m.photoData && !m.deleted) {
                          return (
                            <div key={m.id} className={`flex ${isAdmin ? 'justify-end' : 'justify-start'}`}>
                              <div className={`rounded-2xl px-2 py-2 ${isAdmin ? 'bg-gradient-to-br from-amber-500 to-amber-600 rounded-br-xs' : 'bg-zinc-800/90 border border-zinc-700/60 rounded-bl-xs'}`}>
                                <img src={m.photoData} alt="attachment" className="max-h-48 rounded-xl object-cover" />
                                {m.text && m.text !== '📷 Photo' && <p className="text-xs mt-1 px-1">{m.text}</p>}
                              </div>
                            </div>
                          );
                        }
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
                              <p className={`break-words ${m.deleted ? 'italic opacity-60' : ''}`}>{m.deleted ? '🚫 Message deleted' : m.text}</p>
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
                    {isRecording ? (
                      <>
                        <div className="flex-1 flex items-center gap-2.5 rounded-xl border border-red-500/40 bg-red-950/30 px-3.5 py-2.5">
                          <span className="h-2 w-2 rounded-full bg-red-500 animate-pulse" />
                          <span className="text-xs font-mono text-red-300">Recording {Math.floor(recSeconds / 60)}:{String(recSeconds % 60).padStart(2, '0')}</span>
                        </div>
                        <button type="button" onClick={cancelRecording} className="rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2.5 text-zinc-300 hover:text-white transition cursor-pointer">
                          <X className="w-4 h-4" />
                        </button>
                        <button type="button" onClick={sendRecording} className="rounded-xl bg-red-500 px-4 text-xs font-bold text-white hover:bg-red-400 transition cursor-pointer">
                          <Send className="w-4 h-4" />
                        </button>
                      </>
                    ) : (
                      <>
                        <input
                          type="text"
                          value={supportMessage}
                          onChange={(e) => setSupportMessage(e.target.value)}
                          placeholder="Type admin response..."
                          className="flex-1 rounded-xl border border-zinc-800 bg-zinc-950 px-3.5 py-2.5 text-xs text-zinc-100 focus:border-amber-500 focus:outline-none"
                        />
                        <button
                          type="button"
                          onClick={startRecording}
                          title="Record voice message"
                          className="rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2.5 text-zinc-400 hover:text-amber-400 transition cursor-pointer"
                        >
                          <Mic className="w-4 h-4" />
                        </button>
                        <button
                          type="submit"
                          disabled={!supportMessage.trim()}
                          className="rounded-xl bg-amber-500 px-4 text-xs font-bold text-zinc-950 hover:bg-amber-400 transition cursor-pointer disabled:opacity-50"
                        >
                          <Send className="w-4 h-4" />
                        </button>
                      </>
                    )}
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

      {/* Mobile Bottom Nav — Android easy one-hand */}
      {adminSession?.isLoggedIn && (
        <MobileBottomNav activeTab={activeTab} setActiveTab={(t) => { setActiveTab(t); window.scrollTo({ top: 0, behavior: 'smooth' }); }} usersCount={users.length} txCount={transactions.length} />
      )}

      {/* Quick Balance Deposit / Credit Modal */}
      {quickCreditModalUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-zinc-950/80 backdrop-blur-md animate-in fade-in duration-200 overflow-y-auto">
          <div className="w-full max-w-md max-h-[92vh] overflow-y-auto rounded-2xl sm:rounded-3xl border border-emerald-500/30 bg-zinc-900 shadow-2xl p-5 sm:p-6 space-y-4">
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
                  {paginatedUsers.map(u => (
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

      {/* Freeze / Unfreeze Confirmation Modal */}
      {freezeModalUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-zinc-950/80 backdrop-blur-md animate-in fade-in duration-200 overflow-y-auto">
          <div className="w-full max-w-md max-h-[92vh] overflow-y-auto rounded-2xl sm:rounded-3xl border border-cyan-500/40 bg-zinc-900 shadow-2xl p-5 sm:p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-zinc-800 pb-3">
              <div className="flex items-center gap-2.5">
                <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-cyan-500/20 text-cyan-300">
                  <Snowflake className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-white">
                    {freezeModalUser.isFrozen ? 'Unfreeze Account' : 'Freeze User Account'}
                  </h3>
                  <p className="text-[11px] text-zinc-400">Target: User #{freezeModalUser.id}</p>
                </div>
              </div>
              <button
                onClick={() => setFreezeModalUser(null)}
                className="rounded-xl border border-zinc-800 p-1.5 text-zinc-400 hover:text-white cursor-pointer"
              >
                ✕
              </button>
            </div>

            <div className="space-y-3">
              <p className="text-xs text-zinc-300 leading-relaxed">
                {freezeModalUser.isFrozen
                  ? `Unfreezing User #${freezeModalUser.id} will restore their ability to send P2P transfers and claim yield.`
                  : `Freezing User #${freezeModalUser.id} locks all outgoing P2P transfers and prevents unauthorized funds movement immediately.`
                }
              </p>

              <div>
                <label className="block text-[10px] font-mono text-zinc-400 mb-1">
                  Reason for Audit Log (Required)
                </label>
                <input
                  type="text"
                  value={freezeReason}
                  onChange={(e) => setFreezeReason(e.target.value)}
                  placeholder={freezeModalUser.isFrozen ? "e.g. KYC verification completed" : "e.g. Suspicious transfer investigation"}
                  className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-xs text-white focus:border-cyan-500 focus:outline-none"
                  autoFocus
                />
              </div>
              {!freezeModalUser.isFrozen && (
                <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-3 space-y-2">
                  <div className="text-[10px] font-bold text-zinc-400 uppercase">Freeze type — kon dhoroner lock</div>
                  <div className="flex gap-2">
                    <button type="button" onClick={()=>setFreezeType('permanent')} className={`flex-1 rounded-xl py-2 text-xs font-bold border transition cursor-pointer ${freezeType==='permanent' ? 'bg-cyan-500 border-cyan-400 text-zinc-950' : 'bg-zinc-900 border-zinc-800 text-zinc-300'}`}>Permanent (manual unfreeze)</button>
                    <button type="button" onClick={()=>setFreezeType('temporary')} className={`flex-1 rounded-xl py-2 text-xs font-bold border transition cursor-pointer ${freezeType==='temporary' ? 'bg-amber-500 border-amber-400 text-zinc-950' : 'bg-zinc-900 border-zinc-800 text-zinc-300'}`}>Temporary (auto-unfreeze)</button>
                  </div>
                  {freezeType==='temporary' && (
                    <div className="flex items-center gap-2">
                      <input type="number" min="1" value={freezeDurationMin} onChange={e=>setFreezeDurationMin(e.target.value)} className="w-20 rounded-lg border border-zinc-800 bg-zinc-900 px-2 py-1.5 text-xs font-mono text-white"/>
                      <span className="text-[11px] text-zinc-400">minutes — {Math.floor((parseInt(freezeDurationMin)||0)/60)}h {(parseInt(freezeDurationMin)||0)%60}m auto-unfreeze</span>
                    </div>
                  )}
                  {freezeType==='permanent' && <p className="text-[11px] text-zinc-500">Permanent freeze kokhono auto-unfreeze hobe na — admin manually unfreeze korte hobe.</p>}
                </div>
              )}

              <div className="flex gap-2 pt-2">
                <button
                  onClick={handleConfirmFreezeToggle}
                  disabled={freezeLoading}
                  className={`flex-1 rounded-xl py-2.5 text-xs font-bold transition shadow-lg cursor-pointer flex items-center justify-center gap-2 ${
                    freezeModalUser.isFrozen
                      ? 'bg-emerald-500 text-zinc-950 hover:bg-emerald-400 shadow-emerald-500/20'
                      : 'bg-cyan-500 text-zinc-950 hover:bg-cyan-400 shadow-cyan-500/20'
                  }`}
                >
                  {freezeLoading ? (
                    <span className="h-4 w-4 animate-spin rounded-full border-2 border-zinc-950 border-t-transparent" />
                  ) : (
                    <>
                      <Snowflake className="w-4 h-4 stroke-[2.5]" />
                      <span>{freezeModalUser.isFrozen ? 'Confirm Unfreeze' : 'Confirm Freeze Account'}</span>
                    </>
                  )}
                </button>

                <button
                  onClick={() => setFreezeModalUser(null)}
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
  );
};
