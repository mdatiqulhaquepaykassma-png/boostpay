import { FC, useCallback, useEffect, useState } from 'react';
import {
  Network, Search, ArrowDownLeft, ArrowUpRight, Loader2, RefreshCw, Wallet, Building2, Users,
  Timer, ChevronRight, Home, Info, Zap, AlertTriangle
} from 'lucide-react';
import { BoostPayStore } from '../services/store';

/**
 * MoneyFlowView — admin: "tk kar theke kar kache gelo, ar ekhon kar kache ache".
 *
 * Left/top: where all the money is sitting right now (users, agents, management,
 *          and money stuck in unclaimed agent claim codes).
 * Below:   type any account (user ID, AGT-…, MGT-…) and walk the money graph —
 *          every counterparty that paid them in, every counterparty they paid
 *          out, amounts, counts and where that counterparty's balance sits now.
 *          Each row is a door: tap it and you continue from there.
 *
 * Honest limit shown on screen: a wallet balance is one number, so no ledger can
 * say "this dollar came from user 7". What it CAN show is the movement graph and
 * today's holdings — which is exactly what an audit of "kar kache koto ache"
 * needs.
 */

type Summary = {
  at: number;
  users: { count: number; balance: number; boosting: number };
  agents: { count: number; balance: number; list: { id: string; balance: number; active: boolean; pendingIn: number }[] };
  management: { count: number; balance: number; list: { id: string; balance: number; active: boolean }[] };
  topUsers: { id: string; balance: number }[];
  inTransit: { count: number; total: number };
  lifetime: { rewardsMinted: number; commissionsPaid: number; p2pVolume: number; agentPaid: number; adminCredits: number; adminDebits: number };
  recon: { inflow: number; outflow: number; atRest: number; delta: number; note: string };
  note: string;
};

type Edge = {
  id: string; kind: string; amount: number; fee: number; count: number;
  lastAt: number; firstAt: number; status: string; type: string; balance: number;
};

type NodeView = {
  node: { id: string; type: string; balance: number; frozen: boolean; blocked: boolean; label: string };
  in: Edge[];
  out: Edge[];
  inTransit: { out: any[]; in: any[]; outTotal: number; inTotal: number };
  totals: { in: number; out: number; net: number; events: number };
  events: { at: number; kind: string; from: string; to: string; amount: number; ref: string; status: string; note: string }[];
};

const money = (n: number | undefined): string => {
  const raw = Number(n) || 0;
  const sign = raw < 0 ? '-' : '';
  const v = Math.abs(raw);
  if (v === 0) return '$0';
  if (v < 0.01) return sign + '$' + v.toFixed(4);
  if (v < 1) return sign + '$' + v.toFixed(3);
  if (v < 1000) return sign + '$' + v.toFixed(2);
  return sign + '$' + Math.round(v).toLocaleString();
};

const when = (ts: number | undefined): string => {
  if (!ts) return '—';
  const d = new Date(ts);
  const diff = Date.now() - ts;
  if (diff < 60000) return 'just now';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  return d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
};

const KIND_LABEL: Record<string, { text: string; cls: string }> = {
  P2P: { text: 'user → user', cls: 'bg-sky-500/15 text-sky-300 border-sky-500/30' },
  AGENT_PAY: { text: 'user → agent', cls: 'bg-amber-500/15 text-amber-300 border-amber-500/30' },
  BOOST_REWARD: { text: 'boost engine', cls: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30' },
  REFERRAL: { text: 'referral commission', cls: 'bg-violet-500/15 text-violet-300 border-violet-500/30' },
  ADMIN: { text: 'admin', cls: 'bg-zinc-700/40 text-zinc-300 border-zinc-600' },
  MGMT_FUND: { text: 'management → agent', cls: 'bg-indigo-500/15 text-indigo-300 border-indigo-500/30' },
  MGMT_COLLECT: { text: 'agent → management', cls: 'bg-teal-500/15 text-teal-300 border-teal-500/30' },
  UNKNOWN: { text: 'unknown row', cls: 'bg-zinc-800 text-zinc-400 border-zinc-700' }
};

const typeChip = (t: string) => {
  if (t === 'USER') return 'bg-sky-500/15 text-sky-300';
  if (t === 'AGENT') return 'bg-amber-500/15 text-amber-300';
  if (t === 'MANAGEMENT') return 'bg-indigo-500/15 text-indigo-300';
  if (t === 'SYSTEM') return 'bg-zinc-700/50 text-zinc-300';
  return 'bg-zinc-800 text-zinc-500';
};

export const MoneyFlowView: FC = () => {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [path, setPath] = useState<NodeView[]>([]);
  const [nodeLoading, setNodeLoading] = useState(false);

  const loadSummary = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch('/api/admin/money-tree/summary', { headers: BoostPayStore.adminAuthHeaders() });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error || `HTTP ${r.status}`);
      setSummary(j);
      setErr(null);
    } catch (e: any) {
      setErr(e?.message || 'Could not load the money summary.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void loadSummary(); }, [loadSummary]);

  const openNode = useCallback(async (id: string, opts?: { push?: boolean }) => {
    const key = String(id || '').trim();
    if (!key) return;
    setNodeLoading(true);
    try {
      const r = await fetch(`/api/admin/money-tree?node=${encodeURIComponent(key)}`, { headers: BoostPayStore.adminAuthHeaders() });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error || `HTTP ${r.status}`);
      setPath(prev => {
        const exists = prev.findIndex(p => p.node.id === j.node.id);
        if (exists >= 0) return prev.slice(0, exists + 1);
        return opts?.push === false ? [j] : [...prev, j];
      });
      setQuery('');
      setErr(null);
    } catch (e: any) {
      setErr(e?.message || `Could not open ${key}.`);
    } finally {
      setNodeLoading(false);
    }
  }, []);

  const current = path.length ? path[path.length - 1] : null;

  // Defensive view-model: an older API build (or a partial response) must never
  // blank the admin page — every list falls back to empty.
  const view = summary && {
    ...summary,
    topUsers: summary.topUsers || [],
    users: summary.users || { count: 0, balance: 0, boosting: 0 },
    agents: { ...(summary.agents || { count: 0, balance: 0, list: [] }), list: (summary.agents && summary.agents.list) || [] },
    management: { ...(summary.management || { count: 0, balance: 0, list: [] }), list: (summary.management && summary.management.list) || [] },
    inTransit: summary.inTransit || { count: 0, total: 0 },
    lifetime: summary.lifetime || { rewardsMinted: 0, commissionsPaid: 0, p2pVolume: 0, agentPaid: 0, adminCredits: 0, adminDebits: 0 },
    recon: summary.recon || { inflow: 0, outflow: 0, atRest: 0, delta: 0, note: '' }
  };

  return (
    <div className="space-y-4">
      {/* ── header ─────────────────────────────────────────────────────────── */}
      <div className="rounded-2xl border border-zinc-800 bg-zinc-900/80 p-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-500/15 text-emerald-400">
            <Network className="h-4.5 w-4.5" />
          </div>
          <div className="min-w-0">
            <h2 className="text-sm font-bold text-white">Money Flow — kar theke kar kache, ar ekhon kar kache</h2>
            <p className="text-[11px] text-zinc-500">Read-only. Built from transactions + agent/management ledgers.</p>
          </div>
          <button
            onClick={() => void loadSummary()}
            className="ml-auto flex items-center gap-1.5 rounded-xl border border-zinc-700 bg-zinc-950 px-3 py-1.5 text-[11px] font-semibold text-zinc-300 hover:bg-zinc-800 cursor-pointer"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} /> Refresh
          </button>
        </div>

        {err && (
          <div className="mt-3 flex items-center gap-2 rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-[11px] text-red-300">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0" /> {err}
          </div>
        )}
      </div>

      {/* ── where the money sits now ───────────────────────────────────────── */}
      {loading && !summary ? (
        <div className="flex items-center gap-2 rounded-2xl border border-zinc-800 bg-zinc-900/60 p-6 text-xs text-zinc-400">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading holdings…
        </div>
      ) : view && (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Holding label="In user wallets" value={money(view.users.balance)} sub={`${view.users.count} users · ${view.users.boosting} boosting`} icon={Wallet} tone="sky" onClick={() => view.topUsers[0] && void openNode(view.topUsers[0].id)} />
            <Holding label="In agent wallets" value={money(view.agents.balance)} sub={`${view.agents.count} agents`} icon={Building2} tone="amber" onClick={() => view.agents.list[0] && void openNode(view.agents.list[0].id)} />
            <Holding label="In management wallets" value={money(view.management.balance)} sub={`${view.management.count} accounts`} icon={Users} tone="indigo" onClick={() => view.management.list[0] && void openNode(view.management.list[0].id)} />
            <Holding label="In transit (claim codes)" value={money(view.inTransit.total)} sub={`${view.inTransit.count} unclaimed`} icon={Timer} tone="rose" />
          </div>

          <div className="rounded-2xl border border-zinc-800 bg-zinc-900/70 p-3">
            <div className="flex flex-wrap gap-2 text-[11px]">
              <Chip label="Total at rest" value={money(view.recon.atRest)} strong />
              <Chip label="Minted by boost" value={money(view.lifetime.rewardsMinted)} />
              <Chip label="Referral commissions" value={money(view.lifetime.commissionsPaid)} />
              <Chip label="P2P volume" value={money(view.lifetime.p2pVolume)} />
              <Chip label="Paid to agents" value={money(view.lifetime.agentPaid)} />
              <Chip label="Admin credits" value={money(view.lifetime.adminCredits)} />
              <Chip label="Admin debits" value={money(view.lifetime.adminDebits)} />
              <Chip label="System delta" value={money(view.recon.delta)} muted />
            </div>
            <p className="mt-2 flex items-start gap-1.5 text-[10px] leading-relaxed text-zinc-500">
              <Info className="mt-0.5 h-3 w-3 shrink-0" />
              <span>{view.recon.note} {view.note}</span>
            </p>
          </div>

          {/* quick doors */}
          <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-zinc-800 bg-zinc-900/70 p-3">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">Quick open:</span>
            {view.agents.list.slice(0, 3).map(a => (
              <button key={a.id} onClick={() => void openNode(a.id)} className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-2 py-1 font-mono text-[10px] font-bold text-amber-300 hover:bg-amber-500/20 cursor-pointer">
                {a.id} · {money(a.balance)}
              </button>
            ))}
            {view.management.list.slice(0, 2).map(m => (
              <button key={m.id} onClick={() => void openNode(m.id)} className="rounded-lg border border-indigo-500/30 bg-indigo-500/10 px-2 py-1 font-mono text-[10px] font-bold text-indigo-300 hover:bg-indigo-500/20 cursor-pointer">
                {m.id} · {money(m.balance)}
              </button>
            ))}
            {view.topUsers.slice(0, 3).map(u => (
              <button key={u.id} onClick={() => void openNode(u.id)} className="rounded-lg border border-sky-500/30 bg-sky-500/10 px-2 py-1 font-mono text-[10px] font-bold text-sky-300 hover:bg-sky-500/20 cursor-pointer">
                #{u.id} · {money(u.balance)}
              </button>
            ))}
          </div>
        </>
      )}

      {/* ── search ─────────────────────────────────────────────────────────── */}
      <div className="rounded-2xl border border-zinc-800 bg-zinc-900/70 p-3">
        <form
          onSubmit={(e) => { e.preventDefault(); void openNode(query); }}
          className="flex items-center gap-2"
        >
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-500" />
            <input
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="User ID (e.g. 12), agent (AGT-1001) or management (MGT-101)"
              className="w-full rounded-xl border border-zinc-700 bg-zinc-950 py-2 pl-9 pr-3 font-mono text-xs text-white placeholder-zinc-600 focus:border-emerald-500 focus:outline-none"
            />
          </div>
          <button type="submit" disabled={!query.trim() || nodeLoading} className="rounded-xl bg-emerald-500 px-4 py-2 text-xs font-bold text-zinc-950 hover:bg-emerald-400 disabled:opacity-50 cursor-pointer">
            {nodeLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Trace'}
          </button>
        </form>

        {/* breadcrumb = the path you walked */}
        {path.length > 0 && (
          <div className="mt-3 flex flex-wrap items-center gap-1 text-[11px]">
            <button onClick={() => setPath([])} className="flex items-center gap-1 rounded-lg bg-zinc-800 px-2 py-1 text-zinc-300 hover:bg-zinc-700 cursor-pointer">
              <Home className="h-3 w-3" /> Flow
            </button>
            {path.map((p, i) => (
              <span key={p.node.id + i} className="flex items-center gap-1">
                <ChevronRight className="h-3 w-3 text-zinc-600" />
                <button
                  onClick={() => setPath(prev => prev.slice(0, i + 1))}
                  className={`rounded-lg px-2 py-1 font-mono font-bold cursor-pointer ${i === path.length - 1 ? 'bg-emerald-500/20 text-emerald-300' : 'bg-zinc-800 text-zinc-300 hover:bg-zinc-700'}`}
                >
                  {p.node.type === 'USER' ? '#' : ''}{p.node.id}
                </button>
              </span>
            ))}
          </div>
        )}
      </div>

      {/* ── the node ───────────────────────────────────────────────────────── */}
      {current && (
        <div className="space-y-3">
          <div className="rounded-2xl border border-emerald-500/25 bg-gradient-to-r from-emerald-500/10 to-zinc-900/80 p-4">
            <div className="flex flex-wrap items-center gap-3">
              <span className={`rounded-lg px-2 py-1 text-[10px] font-bold ${typeChip(current.node.type)}`}>{current.node.type}</span>
              <h3 className="font-mono text-base font-black text-white">{current.node.label}</h3>
              {current.node.frozen && <span className="rounded-lg bg-sky-500/20 px-2 py-0.5 text-[10px] font-bold text-sky-300">FROZEN</span>}
              {current.node.blocked && <span className="rounded-lg bg-red-500/20 px-2 py-0.5 text-[10px] font-bold text-red-300">DISABLED</span>}
              <div className="ml-auto text-right">
                <div className="text-[9px] uppercase tracking-wider text-zinc-500">Balance now</div>
                <div className="font-mono text-lg font-black text-emerald-300">{money(current.node.balance)}</div>
              </div>
            </div>
            <div className="mt-2 flex flex-wrap gap-2 text-[10px]">
              <span className="rounded-lg bg-zinc-800/80 px-2 py-1 text-zinc-300">Received all-time <span className="font-mono font-bold text-emerald-300">{money(current.totals.in)}</span></span>
              <span className="rounded-lg bg-zinc-800/80 px-2 py-1 text-zinc-300">Sent all-time <span className="font-mono font-bold text-rose-300">{money(current.totals.out)}</span></span>
              <span className="rounded-lg bg-zinc-800/80 px-2 py-1 text-zinc-300">Net <span className={`font-mono font-bold ${current.totals.net >= 0 ? 'text-emerald-300' : 'text-rose-300'}`}>{money(current.totals.net)}</span></span>
              <span className="rounded-lg bg-zinc-800/80 px-2 py-1 text-zinc-300">Movements <span className="font-mono font-bold text-white">{current.totals.events}</span></span>
            </div>
            <p className="mt-2 text-[10px] text-zinc-500">
              Balance and the received/sent totals do not have to add up — money also moves through boost rewards, holds and fees. Tap any row to keep walking the same trail.
            </p>
          </div>

          {(current.inTransit.outTotal > 0 || current.inTransit.inTotal > 0) && (
            <div className="rounded-2xl border border-rose-500/30 bg-rose-500/5 p-3">
              <div className="flex items-center gap-2 text-[11px] font-bold text-rose-300">
                <Timer className="h-3.5 w-3.5" /> In transit — claim code not used yet
              </div>
              {current.inTransit.out.length > 0 && (
                <div className="mt-1 text-[11px] text-zinc-300">
                  {money(current.inTransit.outTotal)} left this account for {current.inTransit.out.length} claim code(s) — no agent has claimed them:
                  <div className="mt-1 flex flex-wrap gap-1">
                    {current.inTransit.out.map(t => (
                      <span key={t.id} className="rounded-lg bg-zinc-950 px-2 py-1 font-mono text-[10px] text-zinc-300">
                        → {t.to} · {money(t.amount)} · {t.code || 'code'} · expires {when(t.expiresAt)}
                      </span>
                    ))}
                  </div>
                </div>
              )}
              {current.inTransit.in.length > 0 && (
                <div className="mt-1 text-[11px] text-zinc-300">
                  {money(current.inTransit.inTotal)} is waiting for this agent to claim: {current.inTransit.in.map((t: any) => `#${t.from} ${money(t.amount)}`).join(' · ')}
                </div>
              )}
            </div>
          )}

          <div className="grid gap-3 lg:grid-cols-2">
            <EdgeList
              title="Came IN from"
              icon={ArrowDownLeft}
              tone="emerald"
              empty="No incoming money recorded for this account."
              rows={current.in}
              onOpen={(id) => void openNode(id)}
              showBalance
            />
            <EdgeList
              title="Went OUT to"
              icon={ArrowUpRight}
              tone="rose"
              empty="No outgoing money recorded for this account."
              rows={current.out}
              onOpen={(id) => void openNode(id)}
              showBalance
            />
          </div>

          <div className="rounded-2xl border border-zinc-800 bg-zinc-900/70 p-3">
            <div className="flex items-center gap-2 text-[11px] font-bold text-zinc-300">
              <Zap className="h-3.5 w-3.5 text-amber-400" /> Last {current.events.length} movements
            </div>
            <div className="mt-2 max-h-80 space-y-1 overflow-y-auto pr-1">
              {current.events.length === 0 && <p className="text-[11px] text-zinc-500">Nothing recorded yet.</p>}
              {current.events.map((e, i) => {
                const k = KIND_LABEL[e.kind] || { text: e.kind, cls: 'bg-zinc-800 text-zinc-400 border-zinc-700' };
                return (
                  <div key={`${e.ref}-${i}`} className="flex flex-wrap items-center gap-2 rounded-xl border border-zinc-800 bg-zinc-950 px-2.5 py-1.5">
                    <span className="font-mono text-[10px] text-zinc-500">{when(e.at)}</span>
                    <span className="font-mono text-[10px] font-bold text-zinc-300">
                      {(e.from === 'BOOST_ENGINE' || e.from === 'ADMIN' || e.from === 'UNKNOWN' ? e.from : '#' + e.from)}
                      {' → '}
                      {(e.to === 'ADMIN' || e.to === 'UNKNOWN' ? e.to : '#' + e.to)}
                    </span>
                    <span className={`rounded-md border px-1.5 py-0.5 text-[9px] font-semibold ${k.cls}`}>{k.text}</span>
                    <span className="ml-auto font-mono text-[11px] font-bold text-white">{money(e.amount)}</span>
                    {e.status && <span className="rounded-md bg-zinc-800 px-1.5 py-0.5 text-[9px] text-zinc-400">{e.status}</span>}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {!current && !loading && (
        <div className="rounded-2xl border border-dashed border-zinc-800 bg-zinc-900/40 p-8 text-center">
          <Network className="mx-auto mb-2 h-6 w-6 text-zinc-600" />
          <p className="text-xs font-bold text-zinc-400">Type an account above, or tap a quick door</p>
          <p className="mt-1 text-[11px] text-zinc-500">You will see who paid them in, who they paid out, and where that money sits now.</p>
        </div>
      )}
    </div>
  );
};

const Holding: FC<{ label: string; value: string; sub: string; icon: any; tone: 'sky' | 'amber' | 'indigo' | 'rose'; onClick?: () => void }> = ({ label, value, sub, icon: Icon, tone, onClick }) => {
  const tones: Record<string, string> = {
    sky: 'border-sky-500/25 bg-sky-500/5 text-sky-400',
    amber: 'border-amber-500/25 bg-amber-500/5 text-amber-400',
    indigo: 'border-indigo-500/25 bg-indigo-500/5 text-indigo-400',
    rose: 'border-rose-500/25 bg-rose-500/5 text-rose-400'
  };
  return (
    <button
      onClick={onClick}
      disabled={!onClick}
      className={`rounded-2xl border p-3 text-left ${tones[tone]} ${onClick ? 'cursor-pointer hover:brightness-125' : 'cursor-default'}`}
    >
      <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider">
        <Icon className="h-3 w-3" /> {label}
      </div>
      <div className="mt-1 font-mono text-lg font-black text-white">{value}</div>
      <div className="text-[10px] text-zinc-500">{sub}</div>
    </button>
  );
};

const Chip: FC<{ label: string; value: string; strong?: boolean; muted?: boolean }> = ({ label, value, strong, muted }) => (
  <span className={`rounded-lg border px-2 py-1 ${strong ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300' : muted ? 'border-zinc-800 bg-zinc-950 text-zinc-500' : 'border-zinc-800 bg-zinc-950 text-zinc-300'}`}>
    {label} <span className="font-mono font-bold">{value}</span>
  </span>
);

const EdgeList: FC<{
  title: string; icon: any; tone: 'emerald' | 'rose'; empty: string;
  rows: Edge[]; onOpen: (id: string) => void; showBalance?: boolean;
}> = ({ title, icon: Icon, tone, empty, rows, onOpen }) => (
  <div className="rounded-2xl border border-zinc-800 bg-zinc-900/70 p-3">
    <div className={`flex items-center gap-2 text-[11px] font-bold ${tone === 'emerald' ? 'text-emerald-300' : 'text-rose-300'}`}>
      <Icon className="h-3.5 w-3.5" /> {title}
    </div>
    <div className="mt-2 space-y-1">
      {rows.length === 0 && <p className="text-[11px] text-zinc-500">{empty}</p>}
      {rows.map(r => {
        const k = KIND_LABEL[r.kind] || { text: r.kind, cls: 'bg-zinc-800 text-zinc-400 border-zinc-700' };
        const clickable = r.id && r.id !== 'UNKNOWN';
        return (
          <button
            key={r.id + r.kind}
            onClick={() => clickable && onOpen(r.id)}
            disabled={!clickable}
            className={`flex w-full items-center gap-2 rounded-xl border border-zinc-800 bg-zinc-950 px-2.5 py-2 text-left ${clickable ? 'hover:border-emerald-500/40 hover:bg-zinc-900 cursor-pointer' : 'cursor-default opacity-70'}`}
          >
            <span className={`rounded-md px-1.5 py-0.5 text-[9px] font-bold ${typeChip(r.type)}`}>{r.type}</span>
            <span className="font-mono text-[11px] font-bold text-zinc-200">{r.id === 'UNKNOWN' ? 'unknown row' : r.id}</span>
            <span className={`rounded-md border px-1.5 py-0.5 text-[9px] ${k.cls}`}>{k.text}</span>
            <span className="ml-auto text-right">
              <span className={`block font-mono text-[11px] font-black ${tone === 'emerald' ? 'text-emerald-300' : 'text-rose-300'}`}>{money(r.amount)}</span>
              <span className="block text-[9px] text-zinc-600">
                {r.count}× · {when(r.lastAt)}
                {r.kind === 'AGENT_PAY' && r.fee > 0 ? ` · fee ${money(r.fee)}` : ''}
              </span>
            </span>
            {clickable && <ChevronRight className="h-3.5 w-3.5 shrink-0 text-zinc-600" />}
          </button>
        );
      })}
    </div>
  </div>
);

export default MoneyFlowView;
