import { FC, useState, useEffect, useCallback, Fragment } from 'react';
import {
  Sliders,
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
  Wallet,
  Database,
  Table2,
  Search,
  ChevronLeft,
  ChevronRight,
  Lock
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

const FreezeCountdown: FC<{ until?: number }> = ({ until }) => {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!until) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [until]);
  if (!until) return <span className="text-[10px] text-zinc-500">Permanent freeze</span>;
  const diff = until - now;
  if (diff <= 0) return <span className="text-[10px] text-emerald-400 font-bold">Ready to unfreeze</span>;
  const h = Math.floor(diff/3600000);
  const m = Math.floor((diff%3600000)/60000);
  const sSec = Math.floor((diff%60000)/1000);
  return <span className="font-mono text-xs font-bold text-amber-400">{String(h).padStart(2,'0')}:{String(m).padStart(2,'0')}:{String(sSec).padStart(2,'0')}</span>;
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
      let d:any = null;
      try { d = await BoostPayStore.adminApi('/api/admin/fraud'); } catch {}
      // also fetch new antifraud logs for 1h temp freezes
      let af:any = null;
      try { af = await BoostPayStore.adminApi('/api/admin/antifraud/logs'); } catch {}
      if (!d) d = { signals:[], frozenUsers:[], fraudLogs:[] };
      if (af) {
        // merge antifraudLogs into fraudLogs + expose signals from it
        const extraLogs = (af.logs||[]).map((l:any)=> ({ id: l.id, action: 'FRAUD_AUTO_FREEZE', details: l.reason + ' — IP ' + (l.ip||'?') + ' — until ' + (l.frozenUntil? new Date(l.frozenUntil).toLocaleString(): '1h'), timestamp: l.timestamp }));
        d.fraudLogs = [...(extraLogs||[]), ...(d.fraudLogs||[])].slice(0,200);
        // FIX: af.config may be null if server had old DB without antifraud — build default fallback so UI never empty
        const fallbackAf = {
          enabled: true,
          tempFreezeMs: 3600000,
          maxTransfersPer10Min: 5,
          maxDistinctSendersPerIp: 3,
          maxVolumePer10Min: 500,
          newAccountLargeTransferThreshold: 100,
          velocityEnabled: true,
          freezeDurations: { velocity: 3600000, multiIp: 3600000, newAccountLarge: 1800000, deviceFingerprint: 7200000, loginSpam: 3600000, chatSpam: 1800000, scam: 7200000 },
          features: { velocity: true, multiIp: true, newAccountLarge: true, deviceFingerprint: true, loginSpam: true, chatSpam: true, scam: true },
          maxLoginsPer10Min: 5,
          maxMessagesPerMin: 10
        };
        const resolvedCfg = af.config || (d as any)._afConfig || fallbackAf;
        // merge fallback to ensure freezeDurations/features exist
        if (resolvedCfg) {
          if (!resolvedCfg.freezeDurations) resolvedCfg.freezeDurations = (fallbackAf as any).freezeDurations;
          if (!resolvedCfg.features) resolvedCfg.features = (fallbackAf as any).features;
        }
        if ((!d.frozenUsers||d.frozenUsers.length===0) && af.logs) {
          d._afConfig = resolvedCfg;
        }
        d._afConfig = resolvedCfg || d._afConfig;
        d._afLogs = af.logs;
      }
      // ensure _afConfig always present even if af fetch failed — so Antifraud Config section never shows "nothing"
      if (!d._afConfig) {
        d._afConfig = {
          enabled: true, tempFreezeMs: 3600000, maxTransfersPer10Min: 5, maxDistinctSendersPerIp: 3, maxVolumePer10Min: 500,
          newAccountLargeTransferThreshold: 100, velocityEnabled: true,
          freezeDurations: { velocity: 3600000, multiIp: 3600000, newAccountLarge: 1800000, deviceFingerprint: 7200000, loginSpam: 3600000, chatSpam: 1800000, scam: 7200000 },
          features: { velocity: true, multiIp: true, newAccountLarge: true, deviceFingerprint: true, loginSpam: true, chatSpam: true, scam: true },
          maxLoginsPer10Min: 5, maxMessagesPerMin: 10
        };
      }
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
      <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-200 flex items-center justify-between gap-3">
        <div><span className="font-bold">📍 Kon feature ON/OFF kothay pabo?</span> → Ekhane <b>Antifraud Config</b> card e <b>Feature ON/OFF</b> toggle gulo ache (Velocity, Multi-IP, Device Fingerprint, Login Spam, Chat Spam, Scam). Niche <b>Per-reason freeze time (minutes)</b> list e protita karon er jonno koto min freeze hobe set korte parben + live countdown frozen accounts e dekhabe.</div>
        <button onClick={()=> document.getElementById('antifraud-config-section')?.scrollIntoView({behavior:'smooth', block:'start'})} className="shrink-0 rounded-xl bg-amber-500 px-3 py-1.5 text-xs font-bold text-zinc-950 hover:bg-amber-400 cursor-pointer">Antifraud Config ↓</button>
      </div>
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

      {/* Frozen users — with live countdown for temp freeze */}
      <div className="rounded-3xl border border-zinc-800 bg-zinc-900/80 p-5">
        <h3 className="text-xs font-bold text-white mb-3 flex items-center justify-between">Frozen Accounts ({(data?.frozenUsers || []).length}) <span className="text-[10px] text-zinc-500 font-normal">Live countdown for temp freeze</span></h3>
        {(data?.frozenUsers || []).length === 0 ? (
          <p className="py-6 text-center text-[11px] text-zinc-500">No frozen accounts.</p>
        ) : (
          <div className="space-y-2">
            {(data.frozenUsers || []).map((u: any) => (
              <div key={u.id} className="flex items-center justify-between gap-3 rounded-2xl border border-zinc-800 bg-zinc-950/60 p-3">
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-bold text-white font-mono">#{u.id} <span className="text-zinc-500 font-sans font-normal">{u.email}</span> {u.isTempFreeze && <span className="ml-1 rounded-full bg-amber-500/20 border border-amber-500/30 px-1.5 py-0.5 text-[9px] text-amber-300">TEMP</span>}</p>
                  <p className="text-[10px] text-rose-300/80 truncate">{u.frozenReason || 'Frozen by administration'}</p>
                  {u.isTempFreeze && u.frozenUntil ? (
                    <div className="mt-1 flex items-center gap-2 text-[10px]">
                      <span className="text-zinc-500">Unfreeze in:</span>
                      <FreezeCountdown until={u.frozenUntil} />
                      <span className="text-zinc-600 font-mono text-[9px]">{new Date(u.frozenUntil).toLocaleTimeString()}</span>
                    </div>
                  ) : u.frozenAt ? (
                    <div className="mt-1 text-[10px] text-zinc-500">Frozen at {new Date(u.frozenAt).toLocaleString()}</div>
                  ) : null}
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

      {/* Antifraud config — editable per-reason durations */}
      {data?._afConfig && (
        <AntifraudConfigEditor config={data._afConfig} onSaved={load} logs={data._afLogs} />
      )}

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

const AntifraudConfigEditor: FC<{ config:any; onSaved:()=>void; logs:any[] }> = ({ config, onSaved, logs }) => {
  const [saving, setSaving]=useState(false);
  const [msg, setMsg]=useState('');
  const [err, setErr]=useState('');
  const [form, setForm]=useState<any>(() => ({
    enabled: config.enabled !== false,
    velocityEnabled: config.velocityEnabled !== false,
    maxTransfersPer10Min: config.maxTransfersPer10Min ?? 5,
    maxLoginsPer10Min: config.maxLoginsPer10Min ?? 5,
    maxMessagesPerMin: config.maxMessagesPerMin ?? 10,
    newAccountLargeTransferThreshold: config.newAccountLargeTransferThreshold ?? 100,
    freezeDurations: (()=>{ if(config.freezeDurations){ const o:any={}; for(const k in config.freezeDurations) o[k]=Math.round((config.freezeDurations[k]||0)/60000); return o; } return { velocity:60, multiIp:60, newAccountLarge:30, deviceFingerprint:120, loginSpam:60, chatSpam:30, scam:120 }; })(),
    features: config.features || { velocity:true, multiIp:true, newAccountLarge:true, deviceFingerprint:true, loginSpam:true, chatSpam:true, scam:true }
  }));
  useEffect(()=>{ const fd:any={}; if(config.freezeDurations) for(const k in config.freezeDurations) fd[k]=Math.round((config.freezeDurations[k]||0)/60000); setForm({ enabled: config.enabled!==false, velocityEnabled: config.velocityEnabled!==false, maxTransfersPer10Min: config.maxTransfersPer10Min, maxLoginsPer10Min: config.maxLoginsPer10Min, maxMessagesPerMin: config.maxMessagesPerMin, newAccountLargeTransferThreshold: config.newAccountLargeTransferThreshold, freezeDurations: Object.keys(fd).length?fd:{ velocity:60, multiIp:60, newAccountLarge:30, deviceFingerprint:120, loginSpam:60, chatSpam:30, scam:120 }, features: config.features || { velocity:true, multiIp:true, newAccountLarge:true, deviceFingerprint:true, loginSpam:true, chatSpam:true, scam:true } }); },[config]);
  const save = async () => {
    setSaving(true); setMsg(''); setErr('');
    try{
      const payload:any = { enabled: !!form.enabled, velocityEnabled: !!form.velocityEnabled, maxTransfersPer10Min: Number(form.maxTransfersPer10Min), maxLoginsPer10Min: Number(form.maxLoginsPer10Min), maxMessagesPerMin: Number(form.maxMessagesPerMin), newAccountLargeTransferThreshold: Number(form.newAccountLargeTransferThreshold), freezeDurations: {}, features: form.features };
      for(const k in form.freezeDurations) { let v=parseInt(String(form.freezeDurations[k]),10); if(!isNaN(v)&&v>=1) payload.freezeDurations[k]=v*60000; }
      await BoostPayStore.adminApi('/api/admin/antifraud/config', { method:'POST', body: payload });
      setMsg('Antifraud config saved ✅'); onSaved();
    }catch(e:any){ setErr(e.message||'Save failed'); }
    setSaving(false);
  };
  const labels:any = { velocity:'Velocity (same IP rapid)', multiIp:'Multi-IP cluster', newAccountLarge:'New account large', deviceFingerprint:'Device multi-account', loginSpam:'Login spam', chatSpam:'Chat spam', scam:'Scam' };
  const desc:any = { velocity:'High velocity transfers from same user (10m window)', multiIp:'Multiple users sharing same IP doing transfers', newAccountLarge:'New account <24h sending large amount', deviceFingerprint:'Same device/browser with multiple accounts', loginSpam:'Many login attempts in 10 min (brute force)', chatSpam:'Flooding chat with many messages per minute', scam:'General scam / suspicious pattern' };
  return (
    <div id="antifraud-config-section" className="rounded-3xl border border-zinc-800 bg-zinc-900/80 p-5 space-y-3">
      <h3 className="text-xs font-bold text-white flex items-center justify-between">Antifraud Config — features & per-reason freeze {msg && <span className="text-emerald-400 text-[11px]">{msg}</span>} {err && <span className="text-red-400 text-[11px]">{err}</span>}</h3>
      <div className="flex flex-wrap gap-2 p-2 rounded-xl bg-zinc-950 border border-zinc-800">
        <label className="flex items-center gap-2 text-xs text-zinc-300 cursor-pointer"><input type="checkbox" checked={!!form.enabled} onChange={e=> setForm((f:any)=>({...f, enabled: e.target.checked}))} className="h-4 w-4 accent-amber-500"/> Antifraud Master ON</label>
        <label className="flex items-center gap-2 text-xs text-zinc-300 cursor-pointer"><input type="checkbox" checked={!!form.velocityEnabled} onChange={e=> setForm((f:any)=>({...f, velocityEnabled: e.target.checked}))} className="h-4 w-4 accent-amber-500"/> Velocity legacy ON</label>
      </div>
      <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-3">
        <div className="text-[10px] font-bold uppercase tracking-wider text-zinc-400 mb-2">Feature ON/OFF — kon feature active thakbe</div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {Object.keys(form.features||{}).map((k:string)=>(
            <label key={k} className="flex items-center justify-between rounded-lg border border-zinc-800 bg-zinc-900 px-2 py-1.5 cursor-pointer">
              <span className="text-xs text-zinc-300">{labels[k]||k}</span>
              <input type="checkbox" checked={!!form.features[k]} onChange={e=> setForm((f:any)=>({...f, features:{...f.features, [k]: e.target.checked}}))} className="h-4 w-4 accent-emerald-500"/>
            </label>
          ))}
        </div>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <div><label className="text-[10px] text-zinc-500 font-mono">Max transfers /10m</label><input type="number" value={form.maxTransfersPer10Min} onChange={e=> setForm((f:any)=>({...f, maxTransfersPer10Min: e.target.value}))} className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-2 py-1.5 text-xs font-mono text-white"/></div>
        <div><label className="text-[10px] text-zinc-500 font-mono">Max logins /10m</label><input type="number" value={form.maxLoginsPer10Min} onChange={e=> setForm((f:any)=>({...f, maxLoginsPer10Min: e.target.value}))} className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-2 py-1.5 text-xs font-mono text-white"/></div>
        <div><label className="text-[10px] text-zinc-500 font-mono">Max messages /min</label><input type="number" value={form.maxMessagesPerMin} onChange={e=> setForm((f:any)=>({...f, maxMessagesPerMin: e.target.value}))} className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-2 py-1.5 text-xs font-mono text-white"/></div>
        <div><label className="text-[10px] text-zinc-500 font-mono">New acct threshold $</label><input type="number" value={form.newAccountLargeTransferThreshold} onChange={e=> setForm((f:any)=>({...f, newAccountLargeTransferThreshold: e.target.value}))} className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-2 py-1.5 text-xs font-mono text-white"/></div>
      </div>
      <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-3">
        <div className="text-[10px] font-bold uppercase tracking-wider text-zinc-400 mb-2">Per-reason freeze time (minutes) — dynamically kon karon e koto khon freeze</div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {Object.keys(form.freezeDurations).map(k=>(
            <div key={k} className={`rounded-xl border p-2 ${form.features[k]===false ? 'border-zinc-800 bg-zinc-900 opacity-60' : 'border-zinc-800 bg-zinc-950'}`}>
              <div className="flex items-center justify-between">
                <div className={`text-[9px] uppercase tracking-wider font-semibold ${form.features[k]===false ? 'text-zinc-600' : 'text-zinc-400'}`}>{labels[k]||k}</div>
                <span className={`text-[9px] px-1.5 py-0.5 rounded-full ${form.features[k]===false ? 'bg-zinc-800 text-zinc-500' : 'bg-emerald-500/20 text-emerald-400'}`}>{form.features[k]===false ? 'OFF' : 'ON'}</span>
              </div>
              <div className="text-[10px] text-zinc-500 leading-tight mt-0.5">{desc[k]||''}</div>
              <div className="flex items-center gap-1 mt-1">
                <input type="number" value={form.freezeDurations[k]} onChange={e=> setForm((f:any)=>({...f, freezeDurations:{...f.freezeDurations, [k]: e.target.value}}))} className="w-16 rounded-lg border border-zinc-800 bg-zinc-900 px-2 py-1 text-xs font-mono text-white"/>
                <span className="text-[10px] text-zinc-500">min</span>
                <span className="text-[9px] text-zinc-600 ml-1">{form.freezeDurations[k]}m = {Math.floor(Number(form.freezeDurations[k])/60)}h{(Number(form.freezeDurations[k])%60)? ' '+(Number(form.freezeDurations[k])%60)+'m':''}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
      <button onClick={save} disabled={saving} className="rounded-xl bg-amber-500 px-5 py-2 text-xs font-bold text-zinc-950 hover:bg-amber-400 disabled:opacity-50 cursor-pointer">{saving?'Saving...':'Save Antifraud Config'}</button>
      <p className="text-[11px] text-zinc-500">Each reason locks for its configured minutes (temp freeze, auto-unfreeze). Velocity/multiIp/newAccountLarge are transfer-related; deviceFingerprint covers shared-device logins; loginSpam/chatSpam are rate-limits.</p>
      {logs && logs.length>0 && (
        <div className="space-y-1 max-h-40 overflow-y-auto">
          {logs.slice(0,10).map((l:any)=>(
            <div key={l.id} className="flex justify-between rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-xs font-mono">
              <span className="text-rose-300">#{l.userId} — {l.reason}</span>
              <span className="text-zinc-500">{new Date(l.timestamp).toLocaleTimeString()}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export const AdminSystemSettingsView: FC = () => {
  const [cfg, setCfg] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const load = async () => {
    setLoading(true);
    try {
      const d:any = await BoostPayStore.adminApi('/api/admin/stats');
      if (d?.config) setCfg(d.config);
      // also fetch full referral + antifraud to show
      try {
        const r = await BoostPayStore.adminApi('/api/admin/refer/overview');
        if (r?.config) setCfg((prev:any)=> ({...prev, referral: r.config}));
      } catch {}
      try {
        const af = await BoostPayStore.adminApi('/api/admin/antifraud/logs');
        if (af?.config) setCfg((prev:any)=> ({...prev, antifraud: af.config}));
      } catch {}
      setErr('');
    } catch(e:any){ setErr(e.message); }
    setLoading(false);
  };
  useEffect(()=>{ load(); },[]);
  const save = async () => {
    if (!cfg) return;
    setSaving(true); setMsg(''); setErr('');
    try {
      await BoostPayStore.adminApi('/api/admin/config', { method:'POST', body: {
        minuteRatePercent: cfg.minuteRatePercent,
        hourlyRatePercent: cfg.hourlyRatePercent,
        minBoostMs: cfg.minBoostMs,
        maxBoostMs: cfg.maxBoostMs,
        targetDurationMs: cfg.targetDurationMs,
        compoundingEnabled: cfg.compoundingEnabled,
        maintenanceMode: cfg.maintenanceMode,
        referral: cfg.referral,
        antifraud: cfg.antifraud
      }});
      // also save refer via dedicated endpoint to ensure sync
      if (cfg.referral) {
        try { await BoostPayStore.adminApi('/api/admin/refer/config', { method:'POST', body: cfg.referral }); } catch {}
      }
      if (cfg.antifraud) {
        try { await BoostPayStore.adminApi('/api/admin/antifraud/config', { method:'POST', body: { ...cfg.antifraud, freezeDurations: cfg.antifraud.freezeDurations }}); } catch {}
      }
      setMsg('All settings saved ✅');
      await load();
    } catch(e:any){ setErr(e.message); }
    setSaving(false);
  };
  if (loading) return <div className="flex justify-center py-10"><Loader2 className="w-6 h-6 animate-spin text-zinc-500"/></div>;
  if (!cfg) return <div className="text-xs text-red-400">{err || 'Failed to load config'}</div>;
  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-bold text-white flex items-center gap-2"><Sliders className="w-5 h-5 text-amber-400"/> System Settings — Full Control</h2>
        <button onClick={load} className="rounded-xl border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-xs text-zinc-300 hover:border-amber-500/40 cursor-pointer flex items-center gap-1"><RefreshCw className="w-3.5 h-3.5"/> Refresh</button>
      </div>
      {err && <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-300 flex items-center gap-2"><AlertTriangle className="w-4 h-4"/>{err}</div>}
      {msg && <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3 text-xs text-emerald-300 flex items-center gap-2"><Check className="w-4 h-4"/>{msg}</div>}
      <div className="rounded-3xl border border-zinc-800 bg-zinc-900/80 p-5 space-y-4">
        <h3 className="text-xs font-bold text-white">Compounding Engine</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div><label className="text-[10px] font-mono text-zinc-500">Minute Rate %</label><input type="number" step="0.0001" value={cfg.minuteRatePercent ?? ''} onChange={e=> setCfg({...cfg, minuteRatePercent: parseFloat(e.target.value)||0})} className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-xs font-mono text-white"/></div>
          <div><label className="text-[10px] font-mono text-zinc-500">Min Boost (ms)</label><input type="number" value={cfg.minBoostMs ?? ''} onChange={e=> setCfg({...cfg, minBoostMs: parseInt(e.target.value)||0})} className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-xs font-mono text-white"/></div>
          <div><label className="text-[10px] font-mono text-zinc-500">Max Boost (ms)</label><input type="number" value={cfg.maxBoostMs ?? ''} onChange={e=> setCfg({...cfg, maxBoostMs: parseInt(e.target.value)||0})} className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-xs font-mono text-white"/></div>
          <div><label className="text-[10px] font-mono text-zinc-500">Target Duration (ms, optional)</label><input type="number" value={cfg.targetDurationMs ?? ''} onChange={e=> setCfg({...cfg, targetDurationMs: parseInt(e.target.value)||0})} className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-xs font-mono text-white"/></div>
          <label className="flex items-center gap-2 text-xs text-zinc-300"><input type="checkbox" checked={!!cfg.compoundingEnabled} onChange={e=> setCfg({...cfg, compoundingEnabled: e.target.checked})} /> Compounding enabled</label>
          <label className="flex items-center gap-2 text-xs text-zinc-300"><input type="checkbox" checked={!!cfg.maintenanceMode} onChange={e=> setCfg({...cfg, maintenanceMode: e.target.checked})} /> Maintenance mode</label>
        </div>
      </div>
      <div className="rounded-3xl border border-zinc-800 bg-zinc-900/80 p-5 space-y-4">
        <h3 className="text-xs font-bold text-white">Referral Control</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label className="flex items-center gap-2 text-xs text-zinc-300"><input type="checkbox" checked={!!cfg.referral?.enabled} onChange={e=> setCfg({...cfg, referral:{...cfg.referral, enabled:e.target.checked}})} /> Referral enabled</label>
          <label className="flex items-center gap-2 text-xs text-zinc-300"><input type="checkbox" checked={!!cfg.referral?.dailyTierEnabled} onChange={e=> setCfg({...cfg, referral:{...cfg.referral, dailyTierEnabled:e.target.checked}})} /> Daily tier 1-10% UTC</label>
          <div><label className="text-[10px] font-mono text-zinc-500">Base Rate %</label><input type="number" step="0.5" value={cfg.referral?.baseRatePercent ?? ''} onChange={e=> setCfg({...cfg, referral:{...cfg.referral, baseRatePercent: parseFloat(e.target.value)||0}})} className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-xs font-mono text-white"/></div>
          <div><label className="text-[10px] font-mono text-zinc-500">Max Rate %</label><input type="number" step="1" value={cfg.referral?.maxRatePercent ?? ''} onChange={e=> setCfg({...cfg, referral:{...cfg.referral, maxRatePercent: parseFloat(e.target.value)||10}})} className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-xs font-mono text-white"/></div>
          <label className="flex items-center gap-2 text-xs text-zinc-300"><input type="checkbox" checked={!!cfg.referral?.commissionOnCompounding} onChange={e=> setCfg({...cfg, referral:{...cfg.referral, commissionOnCompounding:e.target.checked}})} /> Commission on compounding</label>
        </div>
      </div>
      <div className="rounded-3xl border border-zinc-800 bg-zinc-900/80 p-5 space-y-4">
        <h3 className="text-xs font-bold text-white">Antifraud</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label className="flex items-center gap-2 text-xs text-zinc-300"><input type="checkbox" checked={!!cfg.antifraud?.enabled} onChange={e=> setCfg({...cfg, antifraud:{...cfg.antifraud, enabled:e.target.checked}})} /> Antifraud Master ON</label>
          <label className="flex items-center gap-2 text-xs text-zinc-300"><input type="checkbox" checked={!!cfg.antifraud?.velocityEnabled} onChange={e=> setCfg({...cfg, antifraud:{...cfg.antifraud, velocityEnabled:e.target.checked}})} /> Velocity check (legacy)</label>
          <div><label className="text-[10px] font-mono text-zinc-500">Max transfers /10m</label><input type="number" value={cfg.antifraud?.maxTransfersPer10Min ?? ''} onChange={e=> setCfg({...cfg, antifraud:{...cfg.antifraud, maxTransfersPer10Min: parseInt(e.target.value)||0}})} className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-xs font-mono text-white"/></div>
          <div><label className="text-[10px] font-mono text-zinc-500">New acct threshold $</label><input type="number" value={cfg.antifraud?.newAccountLargeTransferThreshold ?? ''} onChange={e=> setCfg({...cfg, antifraud:{...cfg.antifraud, newAccountLargeTransferThreshold: parseFloat(e.target.value)||0}})} className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-xs font-mono text-white"/></div>
          <div><label className="text-[10px] font-mono text-zinc-500">Max logins /10m</label><input type="number" value={cfg.antifraud?.maxLoginsPer10Min ?? ''} onChange={e=> setCfg({...cfg, antifraud:{...cfg.antifraud, maxLoginsPer10Min: parseInt(e.target.value)||0}})} className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-xs font-mono text-white"/></div>
          <div><label className="text-[10px] font-mono text-zinc-500">Max messages /min</label><input type="number" value={cfg.antifraud?.maxMessagesPerMin ?? ''} onChange={e=> setCfg({...cfg, antifraud:{...cfg.antifraud, maxMessagesPerMin: parseInt(e.target.value)||0}})} className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-xs font-mono text-white"/></div>
        </div>
        {cfg.antifraud?.features && (
          <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-3">
            <div className="text-[10px] font-bold uppercase tracking-wider text-zinc-400 mb-2">Features ON/OFF — kon detection active</div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {Object.keys(cfg.antifraud.features).map(k=> (
                <label key={k} className="flex items-center justify-between rounded-lg border border-zinc-800 bg-zinc-900 px-2 py-1.5 cursor-pointer">
                  <span className="text-xs text-zinc-300 capitalize">{k.replace(/([A-Z])/g,' $1')}</span>
                  <input type="checkbox" checked={!!cfg.antifraud.features[k]} onChange={e=> setCfg({...cfg, antifraud:{...cfg.antifraud, features:{...cfg.antifraud.features, [k]: e.target.checked}}})} className="h-4 w-4 accent-emerald-500"/>
                </label>
              ))}
            </div>
          </div>
        )}
        {cfg.antifraud?.freezeDurations && (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {Object.keys(cfg.antifraud.freezeDurations).map(k=>(
              <div key={k} className="rounded-xl border border-zinc-800 bg-zinc-950 p-2">
                <div className="text-[9px] uppercase tracking-wider text-zinc-500 font-semibold">{k}</div>
                <div className="flex items-center gap-1 mt-1">
                  <input type="number" value={Math.round((cfg.antifraud.freezeDurations[k]||0)/60000)} onChange={e=> { const mv=parseInt(e.target.value)||0; setCfg({...cfg, antifraud:{...cfg.antifraud, freezeDurations:{...cfg.antifraud.freezeDurations, [k]: mv*60000}}}); }} className="w-16 rounded-lg border border-zinc-800 bg-zinc-900 px-2 py-1 text-xs font-mono text-white"/>
                  <span className="text-[10px] text-zinc-500">min</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      <div className="flex gap-2">
        <button onClick={save} disabled={saving} className="rounded-xl bg-amber-500 px-6 py-2.5 text-xs font-bold text-zinc-950 hover:bg-amber-400 disabled:opacity-50 flex items-center gap-2 cursor-pointer">{saving? <Loader2 className="w-4 h-4 animate-spin"/>: <Check className="w-4 h-4"/>} {saving?'Saving...':'Save All Settings'}</button>
        <button onClick={load} className="rounded-xl border border-zinc-800 bg-zinc-900 px-4 py-2.5 text-xs text-zinc-300 hover:border-zinc-700 cursor-pointer">Reset</button>
      </div>
      <p className="text-[11px] text-zinc-500 leading-relaxed">This panel exposes every live system setting: compounding engine, referral 1-10% global ranking, antifraud per-reason freezes. Changes apply instantly and are audit-logged.</p>
    </div>
  );
};

export const ReferAdminView: FC = () => {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [form, setForm] = useState<any>({ enabled: true, baseRatePercent: 1, maxRatePercent: 10, dailyTierEnabled: true, commissionOnCompounding: true });

  const load = async () => {
    setLoading(true);
    try {
      const d = await BoostPayStore.adminApi('/api/admin/refer/overview');
      setData(d);
      if (d?.config) setForm({ enabled: d.config.enabled!==false, baseRatePercent: d.config.baseRatePercent??1, maxRatePercent: d.config.maxRatePercent??10, dailyTierEnabled: d.config.dailyTierEnabled!==false, commissionOnCompounding: d.config.commissionOnCompounding!==false });
    } catch(e:any){ setErr(e.message); }
    setLoading(false);
  };
  useEffect(()=>{ load(); },[]);

  const save = async () => {
    setSaving(true); setMsg(''); setErr('');
    try{
      await BoostPayStore.adminApi('/api/admin/refer/config', { method:'POST', body: form });
      setMsg('Referral config saved ✅');
      await load();
    }catch(e:any){ setErr(e.message); }
    setSaving(false);
  };

  if (loading) return <div className="flex justify-center py-10"><Loader2 className="w-6 h-6 animate-spin text-zinc-500"/></div>;
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-bold text-white flex items-center gap-2"><Users2 className="w-5 h-5 text-amber-400"/> Referral Control Center</h2>
        <button onClick={load} className="rounded-xl border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-xs text-zinc-300 hover:border-amber-500/40 cursor-pointer flex items-center gap-1"><RefreshCw className="w-3.5 h-3.5"/> Refresh</button>
      </div>
      {err && <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-300 flex items-center gap-2"><AlertTriangle className="w-4 h-4"/>{err}</div>}
      {msg && <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3 text-xs text-emerald-300 flex items-center gap-2"><Check className="w-4 h-4"/>{msg}</div>}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="rounded-2xl border border-zinc-800 bg-zinc-900 p-4"><div className="text-[10px] uppercase text-zinc-500 font-semibold">Total Referrals</div><div className="text-xl font-black text-white font-mono">{data?.totalReferrals??0}</div></div>
        <div className="rounded-2xl border border-zinc-800 bg-zinc-900 p-4"><div className="text-[10px] uppercase text-zinc-500 font-semibold">Total Commission Paid</div><div className="text-xl font-black text-emerald-400 font-mono">${Number(data?.totalCommissions??0).toFixed(2)}</div></div>
        <div className="rounded-2xl border border-zinc-800 bg-zinc-900 p-4"><div className="text-[10px] uppercase text-zinc-500 font-semibold">Active Rate</div><div className="text-xl font-black text-amber-400 font-mono">{form.baseRatePercent}–{form.maxRatePercent}%</div></div>
        <div className="rounded-2xl border border-zinc-800 bg-zinc-900 p-4"><div className="text-[10px] uppercase text-zinc-500 font-semibold">Mode</div><div className="text-sm font-bold text-white">{form.enabled? 'Enabled ✅':'Disabled'}</div></div>
      </div>

      <div className="rounded-3xl border border-zinc-800 bg-zinc-900/80 p-5 space-y-4">
        <h3 className="text-xs font-bold text-white">Referral Settings (1-10% dynamic)</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label className="flex items-center gap-2 text-xs text-zinc-300"><input type="checkbox" checked={form.enabled} onChange={e=> setForm({...form, enabled: e.target.checked})} /> Referral system enabled</label>
          <label className="flex items-center gap-2 text-xs text-zinc-300"><input type="checkbox" checked={form.dailyTierEnabled} onChange={e=> setForm({...form, dailyTierEnabled: e.target.checked})} /> Daily tier 1-10% (UTC midnight reset)</label>
          <label className="flex items-center gap-2 text-xs text-zinc-300"><input type="checkbox" checked={form.commissionOnCompounding} onChange={e=> setForm({...form, commissionOnCompounding: e.target.checked})} /> Commission on compounding</label>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div><label className="text-[10px] font-mono text-zinc-500">Base Rate % (min)</label><input type="number" step="0.5" value={form.baseRatePercent} onChange={e=> setForm({...form, baseRatePercent: parseFloat(e.target.value)||0})} className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-xs font-mono text-white"/></div>
          <div><label className="text-[10px] font-mono text-zinc-500">Max Rate % (cap)</label><input type="number" step="1" value={form.maxRatePercent} onChange={e=> setForm({...form, maxRatePercent: parseFloat(e.target.value)||10})} className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-xs font-mono text-white"/></div>
        </div>
        <p className="text-[11px] text-zinc-500 leading-relaxed">How it works: Each UTC day, count referrals created today per referrer → 1 = 1%, 2 = 2% ... 10+ = 10% (capped by Max). That % is applied to each compounding REWARD of referred users that day.</p>
        <button onClick={save} disabled={saving} className="rounded-xl bg-amber-500 px-5 py-2.5 text-xs font-bold text-zinc-950 hover:bg-amber-400 cursor-pointer disabled:opacity-50">{saving?'Saving...':'Save Refer Config'}</button>
      </div>

      <div className="rounded-3xl border border-zinc-800 bg-zinc-900/80 p-5">
        <h3 className="text-xs font-bold text-white mb-3">Recent Referrals ({(data?.referrals||[]).length})</h3>
        <div className="space-y-1.5 max-h-64 overflow-y-auto">
          {(data?.referrals||[]).slice(0,50).map((r:any)=> (
            <div key={r.id} className="flex justify-between rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-xs font-mono">
              <span className="text-amber-400">#{r.referrerId} → #{r.referredId}</span>
              <span className="text-zinc-500">{new Date(r.createdAt).toLocaleDateString()} {r.dayKey}</span>
            </div>
          ))}
          {(data?.referrals||[]).length===0 && <p className="text-center text-[11px] text-zinc-500 py-6">No referrals yet.</p>}
        </div>
      </div>
      <div className="rounded-3xl border border-zinc-800 bg-zinc-900/80 p-5">
        <h3 className="text-xs font-bold text-white mb-3">Recent Commissions</h3>
        <div className="space-y-1.5 max-h-64 overflow-y-auto">
          {(data?.commissions||[]).slice(0,50).map((c:any)=>(
            <div key={c.id} className="flex justify-between rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-xs font-mono">
              <span className="text-emerald-400">+${Number(c.amount).toFixed(4)} ({c.rate}% from #{c.referredId}→#{c.referrerId})</span>
              <span className="text-zinc-500">{new Date(c.timestamp).toLocaleDateString()}</span>
            </div>
          ))}
          {(data?.commissions||[]).length===0 && <p className="text-center text-[11px] text-zinc-500 py-6">No commissions yet.</p>}
        </div>
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

/* ==========================================================================
   Visual Database Table Browser
   ========================================================================== */

interface DbTableInfo { name: string; count: number; columns: string[]; }
interface DbTableData { name: string; count: number; columns: string[]; rows: any[]; }

const dbFmtCell = (v: any): string => {
  if (v === null || v === undefined) return '';
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (typeof v === 'object') {
    const s = JSON.stringify(v);
    return s.length > 100 ? s.slice(0, 100) + '…' : s;
  }
  const s = String(v);
  return s.length > 100 ? s.slice(0, 100) + '…' : s;
};

export const DatabaseBrowser: FC = () => {
  const [tables, setTables] = useState<DbTableInfo[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [data, setData] = useState<DbTableData | null>(null);
  const [loadingList, setLoadingList] = useState(true);
  const [loadingRows, setLoadingRows] = useState(false);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(0);
  const [expanded, setExpanded] = useState<number | null>(null);
  const [sortCol, setSortCol] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<1 | -1>(1);
  const pageSize = 25;

  const loadTables = useCallback(async () => {
    setLoadingList(true);
    setError('');
    try {
      const res = await BoostPayStore.adminApi('/api/admin/db/tables');
      const list: DbTableInfo[] = res.tables || [];
      setTables(list);
      setSelected((prev) => prev || (list[0] ? list[0].name : null));
    } catch (e: any) {
      setError(e?.message || 'Failed to load tables');
    }
    setLoadingList(false);
  }, []);

  const loadRows = useCallback(async (name: string) => {
    setLoadingRows(true);
    setExpanded(null);
    setPage(0);
    setQuery('');
    setSortCol(null);
    try {
      const res = await BoostPayStore.adminApi(`/api/admin/db/tables/${encodeURIComponent(name)}?limit=500`);
      setData(res);
    } catch (e: any) {
      setError(e?.message || 'Failed to load rows');
    }
    setLoadingRows(false);
  }, []);

  useEffect(() => { loadTables(); }, [loadTables]);
  useEffect(() => { if (selected) loadRows(selected); }, [selected, loadRows]);

  const filtered = (data?.rows || []).filter((r) =>
    !query.trim() || JSON.stringify(r).toLowerCase().includes(query.trim().toLowerCase())
  );
  const sorted = sortCol
    ? [...filtered].sort((a, b) => {
        const av = a?.[sortCol]; const bv = b?.[sortCol];
        return String(av ?? '').localeCompare(String(bv ?? ''), undefined, { numeric: true }) * sortDir;
      })
    : filtered;
  const pageCount = Math.max(1, Math.ceil(sorted.length / pageSize));
  const pageRows = sorted.slice(page * pageSize, (page + 1) * pageSize);
  const columns = data?.columns || [];

  return (
    <div className="rounded-3xl border border-zinc-800 bg-zinc-900/90 p-6 shadow-xl space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-zinc-800 pb-4">
        <div>
          <h3 className="text-sm font-bold text-white flex items-center gap-2">
            <Table2 className="w-4 h-4 text-amber-400" />
            Database Tables — Visual Browser
          </h3>
          <p className="text-xs text-zinc-400 mt-0.5">
            Live data straight from the server database. Click any table to browse its rows, click a row to see full details.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-700/70 bg-zinc-950 px-2.5 py-1.5 text-[10px] font-mono text-zinc-400">
            <Lock className="w-3 h-3 text-amber-400" /> secret fields masked
          </span>
          <button
            onClick={() => { loadTables(); if (selected) loadRows(selected); }}
            className="inline-flex items-center gap-2 rounded-xl bg-amber-500 px-3.5 py-2 text-xs font-bold text-zinc-950 hover:bg-amber-400 transition cursor-pointer"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loadingList || loadingRows ? 'animate-spin' : ''}`} />
            <span>Refresh</span>
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-3 text-xs text-rose-400">{error}</div>
      )}

      {/* Table selector chips */}
      <div className="flex flex-wrap gap-2">
        {loadingList && tables.length === 0 && (
          <div className="flex items-center gap-2 text-xs text-zinc-500 py-2">
            <Loader2 className="w-4 h-4 animate-spin" /> Loading tables...
          </div>
        )}
        {tables.map((t) => (
          <button
            key={t.name}
            onClick={() => setSelected(t.name)}
            className={`inline-flex items-center gap-2 rounded-xl px-3.5 py-2 text-xs font-bold border transition cursor-pointer ${
              selected === t.name
                ? 'bg-amber-500 text-zinc-950 border-amber-400'
                : 'bg-zinc-950 text-zinc-300 border-zinc-700/70 hover:border-amber-500/50 hover:text-white'
            }`}
          >
            <Database className="w-3.5 h-3.5" />
            <span>{t.name}</span>
            <span className={`rounded-md px-1.5 py-0.5 text-[10px] font-mono ${selected === t.name ? 'bg-zinc-950/30 text-zinc-950' : 'bg-zinc-800 text-zinc-400'}`}>
              {t.count}
            </span>
          </button>
        ))}
      </div>

      {/* Rows grid */}
      {selected && (
        <div className="rounded-2xl border border-zinc-800 bg-zinc-950 overflow-hidden">
          <div className="flex flex-col sm:flex-row sm:items-center gap-3 p-3 border-b border-zinc-800">
            <div className="flex items-center gap-2 text-xs font-bold text-white">
              <Table2 className="w-4 h-4 text-amber-400" />
              <span>{selected}</span>
              <span className="text-zinc-500 font-normal">
                {data ? `${data.count} rows · ${columns.length} columns` : ''}
              </span>
            </div>
            <div className="flex-1" />
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-zinc-500 absolute left-2.5 top-1/2 -translate-y-1/2" />
              <input
                value={query}
                onChange={(e) => { setQuery(e.target.value); setPage(0); setExpanded(null); }}
                placeholder="Search rows..."
                className="w-full sm:w-56 rounded-lg border border-zinc-800 bg-zinc-900 pl-8 pr-3 py-1.5 text-xs text-white placeholder:text-zinc-600 focus:outline-none focus:border-amber-500/60"
              />
            </div>
            <div className="flex items-center gap-1.5">
              <button
                onClick={() => { setPage((p) => Math.max(0, p - 1)); setExpanded(null); }}
                disabled={page === 0}
                className="rounded-lg border border-zinc-800 bg-zinc-900 p-1.5 text-zinc-400 hover:text-white disabled:opacity-40 cursor-pointer"
              >
                <ChevronLeft className="w-3.5 h-3.5" />
              </button>
              <span className="text-[10px] font-mono text-zinc-500 w-16 text-center">
                {page + 1} / {pageCount}
              </span>
              <button
                onClick={() => { setPage((p) => Math.min(pageCount - 1, p + 1)); setExpanded(null); }}
                disabled={page >= pageCount - 1}
                className="rounded-lg border border-zinc-800 bg-zinc-900 p-1.5 text-zinc-400 hover:text-white disabled:opacity-40 cursor-pointer"
              >
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {loadingRows ? (
            <div className="flex items-center gap-2 text-xs text-zinc-500 p-6">
              <Loader2 className="w-4 h-4 animate-spin" /> Loading rows...
            </div>
          ) : pageRows.length === 0 ? (
            <div className="text-xs text-zinc-600 p-6">No rows match your search.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-[11px]">
                <thead>
                  <tr className="border-b border-zinc-800">
                    {columns.map((c) => (
                      <th
                        key={c}
                        onClick={() => {
                          if (sortCol === c) setSortDir((d) => (d === 1 ? -1 : 1));
                          else { setSortCol(c); setSortDir(1); }
                        }}
                        className="px-3 py-2 font-bold text-zinc-400 uppercase tracking-wider whitespace-nowrap cursor-pointer hover:text-amber-400 select-none"
                      >
                        {c}
                        {sortCol === c ? (sortDir === 1 ? ' ▲' : ' ▼') : ''}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {pageRows.map((row, i) => {
                    const globalIndex = page * pageSize + i;
                    const isOpen = expanded === globalIndex;
                    return (
                      <Fragment key={`frag-${globalIndex}`}>
                        <tr
                          onClick={() => setExpanded(isOpen ? null : globalIndex)}
                          className={`border-b border-zinc-900 cursor-pointer transition ${
                            isOpen ? 'bg-amber-500/10' : i % 2 ? 'bg-zinc-900/40 hover:bg-zinc-800/60' : 'hover:bg-zinc-800/60'
                          }`}
                        >
                          {columns.map((c) => (
                            <td key={c} className="px-3 py-2 text-zinc-200 font-mono whitespace-nowrap max-w-[240px] truncate">
                              {row?.[c] === null || row?.[c] === undefined
                                ? <span className="text-zinc-600">—</span>
                                : <span title={typeof row[c] === 'object' ? JSON.stringify(row[c], null, 2) : String(row[c])}>{dbFmtCell(row[c])}</span>}
                            </td>
                          ))}
                        </tr>
                        {isOpen && (
                          <tr className="bg-zinc-950">
                            <td colSpan={Math.max(1, columns.length)} className="px-4 py-3">
                              <div className="text-[10px] uppercase tracking-wider text-zinc-500 mb-1.5">Full row detail</div>
                              <pre className="text-[10px] text-emerald-300/90 bg-zinc-900 border border-zinc-800 rounded-xl p-3 whitespace-pre-wrap break-all max-h-72 overflow-y-auto">
                                {JSON.stringify(row, null, 2)}
                              </pre>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
