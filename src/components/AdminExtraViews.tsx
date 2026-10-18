import { FC, useState, useEffect, useCallback } from 'react';
import {
  BarChart3,
  TrendingUp,
  Radio,
  ShieldAlert,
  Users2,
  Loader2,
  AlertTriangle,
  Check,
  Send,
  Trash2,
  Plus,
  RefreshCw,
  KeyRound,
  Activity,
  Wallet
} from 'lucide-react';
import { BoostPayStore } from '../services/store';

/* ==========================================================================
   Simple dependency-free SVG charts
   ========================================================================== */

interface SeriesPoint { label: string; value: number; }

const LineChart: FC<{ points: SeriesPoint[]; color: string; title: string; suffix?: string }> = ({ points, color, title, suffix = '' }) => {
  const w = 560, h = 150, pad = 26;
  const max = Math.max(1, ...points.map(p => p.value));
  const min = Math.min(0, ...points.map(p => p.value));
  const span = max - min || 1;
  const x = (i: number) => pad + (i * (w - pad * 2)) / Math.max(1, points.length - 1);
  const y = (v: number) => h - pad - ((v - min) * (h - pad * 2)) / span;
  const path = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(' ');
  const area = `${path} L${x(points.length - 1).toFixed(1)},${h - pad} L${x(0).toFixed(1)},${h - pad} Z`;
  return (
    <div>
      <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500 mb-1">{title}</p>
      <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-40">
        <defs>
          <linearGradient id={`g-${color.replace('#', '')}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.35" />
            <stop offset="100%" stopColor={color} stopOpacity="0.02" />
          </linearGradient>
        </defs>
        {[0, 0.25, 0.5, 0.75, 1].map((t) => (
          <line key={t} x1={pad} x2={w - pad} y1={pad + t * (h - pad * 2)} y2={pad + t * (h - pad * 2)} stroke="#27272a" strokeWidth="1" />
        ))}
        <path d={area} fill={`url(#g-${color.replace('#', '')})`} />
        <path d={path} fill="none" stroke={color} strokeWidth="2.2" strokeLinejoin="round" strokeLinecap="round" />
        {points.length > 0 && (
          <circle cx={x(points.length - 1)} cy={y(points[points.length - 1].value)} r="4" fill={color} />
        )}
        <text x={pad} y={h - 8} fill="#71717a" fontSize="9" fontFamily="monospace">{points[0]?.label || ''}</text>
        <text x={w - pad} y={h - 8} fill="#71717a" fontSize="9" fontFamily="monospace" textAnchor="end">{points[points.length - 1]?.label || ''}</text>
        <text x={pad - 6} y={pad + 4} fill="#71717a" fontSize="9" fontFamily="monospace" textAnchor="end">{max.toFixed(0)}{suffix}</text>
        <text x={pad - 6} y={h - pad} fill="#71717a" fontSize="9" fontFamily="monospace" textAnchor="end">{min.toFixed(0)}{suffix}</text>
      </svg>
    </div>
  );
};

const BarChart: FC<{ points: SeriesPoint[]; color: string; title: string }> = ({ points, color, title }) => {
  const w = 560, h = 150, pad = 26;
  const max = Math.max(1, ...points.map(p => Math.abs(p.value)));
  const bw = Math.max(2, (w - pad * 2) / Math.max(1, points.length) - 3);
  return (
    <div>
      <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500 mb-1">{title}</p>
      <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-40">
        <line x1={pad} x2={w - pad} y1={h - pad} y2={h - pad} stroke="#3f3f46" strokeWidth="1" />
        {points.map((p, i) => {
          const bh = (Math.abs(p.value) / max) * (h - pad * 2);
          const xPos = pad + (i * (w - pad * 2)) / Math.max(1, points.length);
          return (
            <rect
              key={i}
              x={xPos}
              y={p.value >= 0 ? h - pad - bh : h - pad}
              width={bw}
              height={Math.max(1, bh)}
              fill={p.value >= 0 ? color : '#f43f5e'}
              rx="2"
              opacity={0.85}
            />
          );
        })}
        <text x={pad} y={h - 8} fill="#71717a" fontSize="9" fontFamily="monospace">{points[0]?.label || ''}</text>
        <text x={w - pad} y={h - 8} fill="#71717a" fontSize="9" fontFamily="monospace" textAnchor="end">{points[points.length - 1]?.label || ''}</text>
      </svg>
    </div>
  );
};

/* ==========================================================================
   Analytics & Revenue Dashboard
   ========================================================================== */

export const AnalyticsDashboard: FC = () => {
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const d = await BoostPayStore.adminApi('/api/admin/analytics');
      setData(d);
      setError('');
    } catch (e: any) {
      setError(e.message || 'Failed to load analytics.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  if (loading) {
    return <div className="flex items-center justify-center py-20"><Loader2 className="w-6 h-6 text-zinc-500 animate-spin" /></div>;
  }
  if (error) {
    return (
      <div className="flex items-center gap-2 rounded-2xl border border-red-500/30 bg-red-500/10 p-4 text-xs text-red-300">
        <AlertTriangle className="w-4 h-4 shrink-0" /> {error}
      </div>
    );
  }

  const daily: any[] = data?.daily || [];
  const totals = data?.totals || {};
  const rewardPoints: SeriesPoint[] = daily.map(d => ({ label: d.date.slice(5), value: d.rewards }));
  const flowPoints: SeriesPoint[] = daily.map(d => ({ label: d.date.slice(5), value: d.netFlow }));
  const activePoints: SeriesPoint[] = daily.map(d => ({ label: d.date.slice(5), value: d.activeUsers }));

  const statCards = [
    { label: 'Total Liquidity', value: `$${Number(totals.totalBalance || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, icon: <Wallet className="w-4 h-4 text-amber-400" /> },
    { label: 'Lifetime Profit Paid', value: `$${Number(totals.totalProfit || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, icon: <TrendingUp className="w-4 h-4 text-emerald-400" /> },
    { label: 'Today Yield Payouts', value: `$${Number(totals.todayRewards || 0).toFixed(2)}`, icon: <Activity className="w-4 h-4 text-sky-400" /> },
    { label: 'Registered Users', value: String(totals.userCount || 0), icon: <Users2 className="w-4 h-4 text-violet-400" /> },
    { label: 'Active Boosts', value: String(totals.activeBoosts || 0), icon: <BarChart3 className="w-4 h-4 text-amber-400" /> },
    { label: 'Frozen Accounts', value: String(totals.frozen || 0), icon: <ShieldAlert className="w-4 h-4 text-rose-400" /> }
  ];

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-bold text-white flex items-center gap-2">
            <BarChart3 className="w-5 h-5 text-amber-400" /> Financial Analytics
          </h2>
          <p className="text-[11px] text-zinc-400">Liquidity flow, profit payouts & active-user trends (last 30 days)</p>
        </div>
        <button onClick={load} className="flex items-center gap-1.5 rounded-xl border border-zinc-800 bg-zinc-900 px-3 py-2 text-[11px] text-zinc-300 hover:border-amber-500/40 hover:text-amber-400 cursor-pointer active:scale-95 transition">
          <RefreshCw className="w-3.5 h-3.5" /> Refresh
        </button>
      </div>

      {/* Totals */}
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
        {statCards.map((c) => (
          <div key={c.label} className="rounded-2xl border border-zinc-800 bg-zinc-900/80 p-4">
            <div className="flex items-center gap-2 mb-1.5">
              {c.icon}
              <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">{c.label}</span>
            </div>
            <p className="text-lg font-bold text-white font-mono">{c.value}</p>
          </div>
        ))}
      </div>

      {/* Charts */}
      <div className="rounded-3xl border border-zinc-800 bg-zinc-900/80 p-5">
        <LineChart points={rewardPoints} color="#34d399" title="Daily Compounding Profit Payouts (USD)" />
      </div>
      <div className="rounded-3xl border border-zinc-800 bg-zinc-900/80 p-5">
        <BarChart points={flowPoints} color="#fbbf24" title="Daily Net Liquidity Flow (credits − debits, USD)" />
      </div>
      <div className="rounded-3xl border border-zinc-800 bg-zinc-900/80 p-5">
        <LineChart points={activePoints} color="#60a5fa" title="Daily Active Transacting Users" />
      </div>
    </div>
  );
};

/* ==========================================================================
   Broadcast system announcements
   ========================================================================== */

export const BroadcastView: FC = () => {
  const [title, setTitle] = useState('BOOSTPAY-ALERTS');
  const [message, setMessage] = useState('');
  const [banner, setBanner] = useState(false);
  const [audience, setAudience] = useState<'all' | 'active'>('all');
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  const send = async () => {
    if (!message.trim()) {
      setResult({ type: 'err', text: 'Write a message first.' });
      return;
    }
    setSending(true);
    setResult(null);
    try {
      const data = await BoostPayStore.adminApi('/api/admin/broadcast', {
        method: 'POST',
        body: { title, message: message.trim(), banner, audience }
      });
      setResult({ type: 'ok', text: `Announcement delivered to ${data.sent} user inboxes${banner ? ' + urgent banner shown' : ''}.` });
      setMessage('');
    } catch (e: any) {
      setResult({ type: 'err', text: e.message || 'Broadcast failed.' });
    } finally {
      setSending(false);
    }
  };

  const clearBanner = async () => {
    try {
      await BoostPayStore.adminApi('/api/admin/banner', { method: 'DELETE' });
      setResult({ type: 'ok', text: 'Active banner cleared for all users.' });
    } catch (e: any) {
      setResult({ type: 'err', text: e.message || 'Failed to clear banner.' });
    }
  };

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-base font-bold text-white flex items-center gap-2">
          <Radio className="w-5 h-5 text-amber-400" /> Broadcast Announcements
        </h2>
        <p className="text-[11px] text-zinc-400">Push a system notification (and optional urgent banner) to every user inbox in one click</p>
      </div>

      <div className="rounded-3xl border border-zinc-800 bg-zinc-900/80 p-5 space-y-4">
        {result && (
          <div className={`flex items-start gap-2 rounded-2xl border p-3 text-xs ${result.type === 'ok' ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300' : 'border-red-500/30 bg-red-500/10 text-red-300'}`}>
            {result.type === 'ok' ? <Check className="w-3.5 h-3.5 mt-0.5 shrink-0" /> : <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />}
            <span>{result.text}</span>
          </div>
        )}

        <div>
          <label className="block text-[11px] font-semibold text-zinc-300 mb-1.5">Title</label>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value.slice(0, 80))}
            className="w-full rounded-2xl border border-zinc-800 bg-zinc-950 px-3.5 py-2.5 text-xs text-white focus:border-amber-500 focus:outline-none"
          />
        </div>

        <div>
          <label className="block text-[11px] font-semibold text-zinc-300 mb-1.5">Message</label>
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value.slice(0, 1000))}
            rows={4}
            placeholder="e.g. Scheduled maintenance tonight at 02:00 UTC. Boosts keep running."
            className="w-full rounded-2xl border border-zinc-800 bg-zinc-950 px-3.5 py-2.5 text-xs text-white placeholder-zinc-600 focus:border-amber-500 focus:outline-none resize-none"
          />
        </div>

        <div className="flex flex-wrap items-center gap-4">
          <label className="flex items-center gap-2 text-xs text-zinc-300 cursor-pointer">
            <input type="checkbox" checked={banner} onChange={(e) => setBanner(e.target.checked)} className="h-4 w-4 accent-amber-500" />
            Also show as urgent banner
          </label>
          <label className="flex items-center gap-2 text-xs text-zinc-300 cursor-pointer">
            Audience:
            <select
              value={audience}
              onChange={(e) => setAudience(e.target.value as 'all' | 'active')}
              className="rounded-xl border border-zinc-800 bg-zinc-950 px-2.5 py-1.5 text-xs text-white focus:border-amber-500 focus:outline-none"
            >
              <option value="all">All users</option>
              <option value="active">Active accounts only</option>
            </select>
          </label>
        </div>

        <div className="flex gap-2.5">
          <button
            onClick={send}
            disabled={sending}
            className="flex items-center gap-2 rounded-2xl bg-amber-500 px-5 py-2.5 text-xs font-bold text-zinc-950 hover:bg-amber-400 active:scale-95 transition cursor-pointer disabled:opacity-60"
          >
            {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            Send Broadcast
          </button>
          <button
            onClick={clearBanner}
            className="flex items-center gap-2 rounded-2xl border border-zinc-800 bg-zinc-950 px-5 py-2.5 text-xs font-semibold text-zinc-300 hover:border-red-500/40 hover:text-red-400 active:scale-95 transition cursor-pointer"
          >
            <Trash2 className="w-4 h-4" /> Clear Banner
          </button>
        </div>
      </div>
    </div>
  );
};

/* ==========================================================================
   Anti-fraud monitoring
   ========================================================================== */

export const FraudView: FC = () => {
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const d = await BoostPayStore.adminApi('/api/admin/fraud');
      setData(d);
      setError('');
    } catch (e: any) {
      setError(e.message || 'Failed to load fraud data.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const unfreeze = async (userId: string) => {
    setBusyId(userId);
    try {
      await BoostPayStore.adminApi('/api/admin/users/freeze', {
        method: 'POST',
        body: { userId, isFrozen: false, reason: 'Reviewed by admin — no fraud confirmed' }
      });
      await load();
    } catch (e: any) {
      setError(e.message || 'Unfreeze failed.');
    } finally {
      setBusyId(null);
    }
  };

  if (loading) {
    return <div className="flex items-center justify-center py-20"><Loader2 className="w-6 h-6 text-zinc-500 animate-spin" /></div>;
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-bold text-white flex items-center gap-2">
            <ShieldAlert className="w-5 h-5 text-rose-400" /> Anti-Fraud Monitor
          </h2>
          <p className="text-[11px] text-zinc-400">Same-IP multi-account transfer velocity (10-minute window) — auto-freeze triggers appear here</p>
        </div>
        <button onClick={load} className="flex items-center gap-1.5 rounded-xl border border-zinc-800 bg-zinc-900 px-3 py-2 text-[11px] text-zinc-300 hover:border-amber-500/40 hover:text-amber-400 cursor-pointer active:scale-95 transition">
          <RefreshCw className="w-3.5 h-3.5" /> Refresh
        </button>
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded-2xl border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-300">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0" /> {error}
        </div>
      )}

      {/* Risk signals */}
      <div className="rounded-3xl border border-zinc-800 bg-zinc-900/80 p-5">
        <h3 className="text-xs font-bold text-white mb-3">Live Risk Signals</h3>
        {(data?.signals || []).length === 0 ? (
          <p className="py-6 text-center text-[11px] text-zinc-500">No suspicious same-IP activity in the last 10 minutes.</p>
        ) : (
          <div className="space-y-2">
            {(data.signals || []).map((r: any) => (
              <div key={r.ip} className="flex items-center justify-between rounded-2xl border border-zinc-800 bg-zinc-950/60 p-3">
                <div className="min-w-0">
                  <p className="text-xs font-mono text-rose-400 font-bold">{r.ip}</p>
                  <p className="text-[10px] text-zinc-500 truncate">
                    {r.transfers} transfers · ${r.volume} · accounts: {r.senders.map((x: string) => `#${x}`).join(', ')}
                  </p>
                </div>
                <span className="shrink-0 rounded-full bg-rose-500/15 px-2.5 py-1 text-[9px] font-bold text-rose-400">
                  {r.senders.length >= 3 ? 'HIGH RISK' : 'WATCH'}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Frozen users */}
      <div className="rounded-3xl border border-zinc-800 bg-zinc-900/80 p-5">
        <h3 className="text-xs font-bold text-white mb-3">Frozen Accounts ({(data?.frozenUsers || []).length})</h3>
        {(data?.frozenUsers || []).length === 0 ? (
          <p className="py-6 text-center text-[11px] text-zinc-500">No frozen accounts.</p>
        ) : (
          <div className="space-y-2">
            {(data.frozenUsers || []).map((u: any) => (
              <div key={u.id} className="flex items-center justify-between gap-3 rounded-2xl border border-zinc-800 bg-zinc-950/60 p-3">
                <div className="min-w-0">
                  <p className="text-xs font-bold text-white font-mono">#{u.id} <span className="text-zinc-500 font-sans font-normal">{u.email}</span></p>
                  <p className="text-[10px] text-rose-300/80 truncate">{u.frozenReason || 'Frozen by administration'}</p>
                </div>
                <button
                  onClick={() => unfreeze(u.id)}
                  disabled={busyId === u.id}
                  className="shrink-0 flex items-center gap-1 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3 py-1.5 text-[10px] font-semibold text-emerald-400 hover:bg-emerald-500/20 active:scale-95 transition cursor-pointer disabled:opacity-50"
                >
                  {busyId === u.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
                  Unfreeze
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Fraud audit trail */}
      <div className="rounded-3xl border border-zinc-800 bg-zinc-900/80 p-5">
        <h3 className="text-xs font-bold text-white mb-3">Fraud Audit Trail</h3>
        {(data?.fraudLogs || []).length === 0 ? (
          <p className="py-6 text-center text-[11px] text-zinc-500">No fraud events recorded yet.</p>
        ) : (
          <div className="space-y-1.5 max-h-72 overflow-y-auto">
            {(data.fraudLogs || []).map((l: any) => (
              <div key={l.id} className="rounded-xl border border-zinc-800/70 bg-zinc-950/50 p-2.5">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-bold text-amber-400 font-mono">{l.action}</span>
                  <span className="text-[9px] text-zinc-500 font-mono">{new Date(l.timestamp).toLocaleString()}</span>
                </div>
                <p className="text-[10px] text-zinc-400 mt-0.5">{l.details}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

/* ==========================================================================
   Admin accounts & roles (role-bounded backend)
   ========================================================================== */

export const AdminAccountsView: FC<{ myEmail: string; myRole: string }> = ({ myEmail, myRole }) => {
  const [admins, setAdmins] = useState<any[]>([]);
  const [error, setError] = useState('');
  const [ok, setOk] = useState('');
  const [loading, setLoading] = useState(true);
  const [newEmail, setNewEmail] = useState('');
  const [newPass, setNewPass] = useState('');
  const [newRole, setNewRole] = useState<'SUPERADMIN' | 'SUPPORT'>('SUPPORT');
  const [busy, setBusy] = useState(false);
  const [curPass, setCurPass] = useState('');
  const [nextPass, setNextPass] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const d = await BoostPayStore.adminApi('/api/admin/accounts');
      setAdmins(d.admins || []);
      setError('');
    } catch (e: any) {
      setError(e.message || 'Failed to load admin accounts.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const createAdmin = async () => {
    setBusy(true); setError(''); setOk('');
    try {
      await BoostPayStore.adminApi('/api/admin/accounts', {
        method: 'POST',
        body: { email: newEmail, password: newPass, role: newRole }
      });
      setOk(`Created ${newRole} account ${newEmail}.`);
      setNewEmail(''); setNewPass('');
      await load();
    } catch (e: any) {
      setError(e.message || 'Failed to create admin.');
    } finally {
      setBusy(false);
    }
  };

  const removeAdmin = async (email: string) => {
    setBusy(true); setError(''); setOk('');
    try {
      await BoostPayStore.adminApi(`/api/admin/accounts/${encodeURIComponent(email)}`, { method: 'DELETE' });
      setOk(`Removed ${email}.`);
      await load();
    } catch (e: any) {
      setError(e.message || 'Failed to remove admin.');
    } finally {
      setBusy(false);
    }
  };

  const changeMyPassword = async () => {
    setBusy(true); setError(''); setOk('');
    try {
      await BoostPayStore.adminApi('/api/admin/accounts/password', {
        method: 'POST',
        body: { currentPassword: curPass, newPassword: nextPass }
      });
      setOk('Admin password changed.');
      setCurPass(''); setNextPass('');
    } catch (e: any) {
      setError(e.message || 'Failed to change password.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-base font-bold text-white flex items-center gap-2">
          <Users2 className="w-5 h-5 text-amber-400" /> Admin Accounts & Roles
        </h2>
        <p className="text-[11px] text-zinc-400">
          The backend is role-bounded: <span className="text-amber-400 font-semibold">SUPPORT</span> admins get
          read-only access + support chat. <span className="text-amber-400 font-semibold">SUPERADMIN</span> is required
          for money operations, freezes, broadcasts and backups. Every sensitive action is audit-logged.
        </p>
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded-2xl border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-300">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0" /> {error}
        </div>
      )}
      {ok && (
        <div className="flex items-center gap-2 rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-3 text-xs text-emerald-300">
          <Check className="w-3.5 h-3.5 shrink-0" /> {ok}
        </div>
      )}

      <div className="rounded-3xl border border-zinc-800 bg-zinc-900/80 p-5">
        <h3 className="text-xs font-bold text-white mb-3">Accounts</h3>
        {loading ? (
          <div className="flex justify-center py-8"><Loader2 className="w-5 h-5 text-zinc-500 animate-spin" /></div>
        ) : (
          <div className="space-y-2">
            {admins.map((a) => (
              <div key={a.email} className="flex items-center justify-between rounded-2xl border border-zinc-800 bg-zinc-950/60 p-3">
                <div>
                  <p className="text-xs font-bold text-white">{a.email} {a.email === myEmail && <span className="text-[9px] bg-amber-500/20 text-amber-400 px-1.5 py-0.5 rounded">YOU</span>}</p>
                  <p className="text-[10px] text-zinc-500">Role: <span className={a.role === 'SUPERADMIN' ? 'text-amber-400 font-semibold' : 'text-sky-400 font-semibold'}>{a.role}</span></p>
                </div>
                {a.email !== myEmail && (
                  <button
                    onClick={() => removeAdmin(a.email)}
                    disabled={busy}
                    className="rounded-xl border border-zinc-800 bg-zinc-900 p-2 text-zinc-400 hover:border-red-500/40 hover:text-red-400 active:scale-95 transition cursor-pointer"
                    title="Remove admin"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {myRole === 'SUPERADMIN' && (
        <div className="rounded-3xl border border-zinc-800 bg-zinc-900/80 p-5 space-y-3">
          <h3 className="text-xs font-bold text-white flex items-center gap-2"><Plus className="w-3.5 h-3.5 text-amber-400" /> Create Admin</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            <input value={newEmail} onChange={(e) => setNewEmail(e.target.value)} placeholder="admin email"
              className="rounded-2xl border border-zinc-800 bg-zinc-950 px-3.5 py-2.5 text-xs text-white placeholder-zinc-600 focus:border-amber-500 focus:outline-none" />
            <input value={newPass} onChange={(e) => setNewPass(e.target.value)} type="password" placeholder="password (min 6 chars)"
              className="rounded-2xl border border-zinc-800 bg-zinc-950 px-3.5 py-2.5 text-xs text-white placeholder-zinc-600 focus:border-amber-500 focus:outline-none" />
          </div>
          <div className="flex items-center gap-3">
            <select value={newRole} onChange={(e) => setNewRole(e.target.value as any)}
              className="rounded-2xl border border-zinc-800 bg-zinc-950 px-3.5 py-2.5 text-xs text-white focus:border-amber-500 focus:outline-none">
              <option value="SUPPORT">SUPPORT (read-only)</option>
              <option value="SUPERADMIN">SUPERADMIN (full control)</option>
            </select>
            <button onClick={createAdmin} disabled={busy || !newEmail || newPass.length < 6}
              className="flex items-center gap-1.5 rounded-2xl bg-amber-500 px-5 py-2.5 text-xs font-bold text-zinc-950 hover:bg-amber-400 active:scale-95 transition cursor-pointer disabled:opacity-50">
              <Plus className="w-3.5 h-3.5" /> Create
            </button>
          </div>
        </div>
      )}

      <div className="rounded-3xl border border-zinc-800 bg-zinc-900/80 p-5 space-y-3">
        <h3 className="text-xs font-bold text-white flex items-center gap-2"><KeyRound className="w-3.5 h-3.5 text-amber-400" /> Change My Admin Password</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
          <input value={curPass} onChange={(e) => setCurPass(e.target.value)} type="password" placeholder="Current password"
            className="rounded-2xl border border-zinc-800 bg-zinc-950 px-3.5 py-2.5 text-xs text-white placeholder-zinc-600 focus:border-amber-500 focus:outline-none" />
          <input value={nextPass} onChange={(e) => setNextPass(e.target.value)} type="password" placeholder="New password (min 6 chars)"
            className="rounded-2xl border border-zinc-800 bg-zinc-950 px-3.5 py-2.5 text-xs text-white placeholder-zinc-600 focus:border-amber-500 focus:outline-none" />
        </div>
        <button onClick={changeMyPassword} disabled={busy || !curPass || nextPass.length < 6}
          className="rounded-2xl bg-amber-500 px-5 py-2.5 text-xs font-bold text-zinc-950 hover:bg-amber-400 active:scale-95 transition cursor-pointer disabled:opacity-50">
          Update Password
        </button>
      </div>
    </div>
  );
};
