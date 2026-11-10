/**
 * Deposit / Withdraw — a dedicated full page (owner request 2026-11-10).
 *
 * Layout follows the brief: two tabs at the top, then the method catalogue in a
 * fixed order — Recommended, E-Wallets, Internet Banking, Cryptocurrency,
 * Telegram Agent (shown as "Cash Agent" on the withdraw side). Recommended is only a
 * *display position*: the same method row is
 * also listed in its own category, because there is a single configuration per
 * method. Nothing here moves money: a deposit is a request an admin verifies, and
 * a withdrawal is debited server-side the moment it is submitted.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft, ArrowRight, ChevronDown, Check, Copy, Loader2, Search, ShieldCheck, X, Clock, Wallet,
} from 'lucide-react';
import { BoostPayStore } from '../services/store';
import { useCurrency } from '../lib/currency';

type Mode = 'deposit' | 'withdraw';

type Method = {
  id: string; name: string; logo: string;
  category: 'EWALLET' | 'BANK' | 'CRYPTO' | 'AGENT';
  recommended: boolean; recommendedOrder: number; order: number;
  currencies: string[]; min: number; max: number; feePercent: number;
  processingTime: string; maintenance: boolean; maintenanceMessage: string;
  payTo: { accountName: string; accountNumber: string; instructions: string } | null;
  requires: Array<{ key: string; label: string; placeholder: string }>;
  flow: 'FORM' | 'AGENT';
};

type Resp = {
  success: boolean; mode: Mode; currency: string; role: string;
  categories: Array<{ id: string; label: string; icon: string }>;
  methods: Method[];
  withdrawable: number | null;
};

type Req = {
  id: string; methodName: string; amountUsd: number; feeUsd?: number; netUsd?: number;
  entryAmount: number; entryCurrency: string; status: string; createdAt: number; reason?: string;
};

interface Props {
  isOpen: boolean;
  initialMode: Mode;
  onClose: () => void;
  /** the Telegram-agent method reuses the existing cash-out screen */
  onOpenAgentPay: () => void;
  onOpenAgentChat: () => void;
  /** keep the page in the URL so back works */
  onModeChange: (m: Mode) => void;
}

const SECTION_ORDER: Array<{ key: string; label: string; icon: string }> = [
  { key: 'EWALLET', label: 'E-Wallets', icon: '📱' },
  { key: 'BANK', label: 'Internet Banking', icon: '🏦' },
  { key: 'CRYPTO', label: 'Cryptocurrency', icon: '₿' },
  { key: 'AGENT', label: 'Telegram Agent', icon: '💬' },
];

const STATUS_STYLE: Record<string, string> = {
  PENDING: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
  APPROVED: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
  COMPLETED: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
  REJECTED: 'bg-rose-500/15 text-rose-300 border-rose-500/30',
};

function timeAgo(ts: number) {
  const s = Math.max(0, Math.floor((Date.now() - Number(ts || 0)) / 1000));
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export const PaymentsPage: React.FC<Props> = ({ isOpen, initialMode, onClose, onOpenAgentPay, onOpenAgentChat, onModeChange }) => {
  const { price, currency } = useCurrency();
  /** the card line is ~90px wide: drop trailing ".00" so the range never clips */
  const compact = useCallback((usd: number) => price(Number(usd) || 0).replace(/\.00(?=\D*$)/, ''), [price]);
  /** a readable tile: an admin-supplied image URL wins, otherwise the initials */
  const logoTile = (m: Method, size: 'card' | 'sheet') => {
    const dim = size === 'card' ? 'h-9 w-9 rounded-lg text-[12px]' : 'h-8 w-8 rounded-lg text-[11px]';
    const url = String(m.logo || '').trim();
    if (/^(https?:|data:image\/)/i.test(url)) {
      return <img src={url} alt="" className={`${dim} shrink-0 object-contain`} />;
    }
    const words = (m.name.replace(/^the\s+/i, '').match(/[A-Za-z0-9]+/g) || [m.name]);
    const initials = words.slice(0, 2).map((w) => w[0].toUpperCase()).join('');
    return (
      <span className={`${dim} flex shrink-0 items-center justify-center bg-gradient-to-br from-amber-300 to-amber-500 font-black text-zinc-950`}>
        {initials || '•'}
      </span>
    );
  };
  const [mode, setMode] = useState<Mode>(initialMode);
  const [data, setData] = useState<Resp | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [q, setQ] = useState('');
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [openMethod, setOpenMethod] = useState<Method | null>(null);
  const [history, setHistory] = useState<Req[]>([]);

  const entryCode = currency?.code || 'USD';
  const entryRate = currency && currency.rate > 0 ? currency.rate : 1;

  useEffect(() => { setMode(initialMode); }, [initialMode]);

  // the page is only mounted while open; a mode switch inside writes the URL
  const switchMode = (m: Mode) => {
    setMode(m);
    setOpenMethod(null);
    setQ('');
    onModeChange(m);
  };

  const load = useCallback(async (m: Mode) => {
    setLoading(true); setLoadError('');
    try {
      const r = await fetch(`/api/payment/methods?mode=${m}`, { headers: BoostPayStore.authHeaders() });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j?.error || `Could not load the payment methods (HTTP ${r.status}).`);
      setData(j as Resp);
    } catch (e: any) {
      setLoadError(e?.message || 'Could not load the payment methods.');
    } finally { setLoading(false); }
  }, []);

  const loadHistory = useCallback(async (m: Mode) => {
    try {
      const r = await fetch(m === 'deposit' ? '/api/user/deposit-requests' : '/api/user/withdraw-requests', { headers: BoostPayStore.authHeaders() });
      if (!r.ok) return;
      const j = await r.json();
      setHistory(Array.isArray(j.requests) ? j.requests : []);
    } catch { /* history is a nice-to-have */ }
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    void load(mode);
    void loadHistory(mode);
  }, [isOpen, mode, load, loadHistory]);

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, onClose]);

  const methods = data?.methods || [];

  /**
   * Owner request 2026-11-10: on the WITHDRAW side the Telegram-agent channel is
   * called "Cash Agent". This is a display label only — the stored method keeps
   * its real id/name, so nothing in the admin panel or the ledger changes.
   */
  const nameOf = useCallback((m: { name: string; category: string }) =>
    (mode === 'withdraw' && m.category === 'AGENT' ? 'Cash Agent' : m.name), [mode]);

  const byQuery = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return methods;
    return methods.filter((m) => `${nameOf(m)} ${m.name} ${m.id}`.toLowerCase().includes(needle));
  }, [methods, q, nameOf]);

  const recommended = useMemo(() => byQuery
    .filter((m) => m.recommended)
    .sort((a, b) => (a.recommendedOrder || 0) - (b.recommendedOrder || 0)), [byQuery]);

  if (!isOpen) return null;

  const openCard = (m: Method) => {
    if (m.flow === 'AGENT') {
      if (mode === 'withdraw') { onOpenAgentPay(); return; }
      onOpenAgentChat();
      return;
    }
    setOpenMethod(m);
  };

  const Section: React.FC<{ title: string; icon: string; rows: Method[]; empty?: string; accent?: string; stateKey?: string }> = ({ title, icon, rows, empty, accent, stateKey }) => {
    const key = stateKey || title;
    const isCollapsed = !!collapsed[key];
    return (
      <section className="mb-3">
        <button
          onClick={() => setCollapsed((c) => ({ ...c, [key]: !c[key] }))}
          aria-expanded={!isCollapsed}
          className={`flex w-full items-center gap-2.5 rounded-t-2xl rounded-b-none border border-b-0 border-sky-900/60 px-3.5 py-2.5 text-left ${accent || 'bg-gradient-to-r from-[#0b1f3a] to-[#123a63]'}`}
        >
          <span className="text-[15px] leading-none">{icon}</span>
          <span className="min-w-0 flex-1 truncate text-[12px] font-bold uppercase tracking-wide text-white">{title}</span>
          <span className="rounded-full bg-white/15 px-1.5 py-0.5 text-[9px] font-bold text-white/90">{rows.length}</span>
          <ChevronDown className={`h-4 w-4 shrink-0 text-white/80 transition ${isCollapsed ? '-rotate-90' : ''}`} />
        </button>
        {!isCollapsed && (
          <div className="rounded-b-2xl border border-sky-900/40 bg-zinc-950/60 p-2.5">
            {rows.length === 0 ? (
              <div className="px-1 py-2 text-[11px] text-zinc-500">{empty || 'No method available right now.'}</div>
            ) : (
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
                {rows.map((m) => (
                  <button
                    key={`${key}-${m.id}`}
                    onClick={() => openCard(m)}
                    className="group flex min-h-[64px] items-center gap-2 rounded-xl border border-zinc-800 bg-white/[0.04] p-2.5 text-left transition hover:border-amber-500/50 hover:bg-white/[0.07] active:scale-[0.98]"
                    aria-label={`${nameOf(m)} ${mode}`}
                  >
                    {logoTile(m, 'card')}
                    <span className="min-w-0 flex-1">
                      <span className="line-clamp-2 text-[10.5px] font-bold leading-[1.15] text-zinc-100">{nameOf(m)}</span>
                      <span className="mt-0.5 block whitespace-nowrap text-[8px] tabular-nums text-zinc-500">
                        {compact(m.min)} – {compact(m.max)}
                      </span>
                    </span>
                    <ArrowRight className="h-3.5 w-3.5 shrink-0 text-zinc-600 transition group-hover:text-amber-400" />
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </section>
    );
  };

  return (
    <div className="fixed inset-0 z-[70] flex flex-col bg-zinc-950 text-zinc-100" role="dialog" aria-modal="true" aria-label={`${mode} page`}>
      {/* header */}
      <div className="shrink-0 bg-gradient-to-r from-[#08172c] via-[#0b2444] to-[#123a63] pt-[env(safe-area-inset-top)] shadow-lg">
        <div className="flex items-center gap-2 px-3 pt-3">
          <button onClick={onClose} className="flex h-9 w-9 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20" aria-label="Back">
            <ArrowLeft className="h-4 w-4" />
          </button>
          <div className="min-w-0 flex-1">
            <div className="text-[13px] font-black tracking-tight text-white">BoostPay</div>
            <div className="text-[9px] uppercase tracking-[0.18em] text-sky-200/70">Payments</div>
          </div>
          <div className="rounded-full bg-white/10 px-2 py-1 text-[9px] font-bold text-sky-100">{entryCode}</div>
        </div>
        {/* tabs */}
        <div className="mt-3 flex gap-1 px-3 pb-0">
          {(['deposit', 'withdraw'] as Mode[]).map((m) => {
            const active = mode === m;
            return (
              <button
                key={m}
                onClick={() => switchMode(m)}
                aria-selected={active}
                role="tab"
                className={`flex-1 rounded-t-xl px-3 py-2.5 text-[12px] font-black uppercase tracking-wide transition ${
                  active ? 'bg-zinc-950 text-white shadow-[0_-2px_0_0_theme(colors.amber.400)_inset]' : 'bg-white/5 text-sky-200/80 hover:bg-white/10'
                }`}
              >
                {m}
              </button>
            );
          })}
        </div>
      </div>

      {/* body */}
      <div className="flex-1 overflow-y-auto overscroll-contain px-3 pb-[calc(1.5rem+env(safe-area-inset-bottom))] pt-3">
        {mode === 'withdraw' && data?.withdrawable !== null && data?.withdrawable !== undefined && (
          <div className="mb-3 flex items-center gap-2 rounded-xl border border-emerald-500/25 bg-emerald-500/[0.07] px-3 py-2">
            <Wallet className="h-3.5 w-3.5 text-emerald-300" />
            <span className="text-[10px] text-emerald-200/90">Withdrawable now (boosted profit only):</span>
            <span className="ml-auto font-mono text-[11px] font-bold text-emerald-300">{price(data.withdrawable)}</span>
          </div>
        )}

        <div className="mb-3 flex items-center gap-2 rounded-xl border border-zinc-800 bg-zinc-900/70 px-2.5 py-2">
          <Search className="h-3.5 w-3.5 text-zinc-500" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search a payment method"
            className="min-w-0 flex-1 bg-transparent text-[11px] text-zinc-200 outline-none placeholder:text-zinc-600"
          />
          {q && <button onClick={() => setQ('')} className="text-zinc-500 hover:text-zinc-300" aria-label="Clear search"><X className="h-3.5 w-3.5" /></button>}
        </div>

        {loading && (
          <div className="space-y-2">
            <div className="h-10 animate-pulse rounded-t-2xl bg-zinc-900" />
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {[0, 1, 2, 3].map((i) => <div key={i} className="h-16 animate-pulse rounded-xl bg-zinc-900" />)}
            </div>
          </div>
        )}

        {!loading && loadError && (
          <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-3 text-[11px] text-rose-200">
            {loadError}
            <button onClick={() => void load(mode)} className="ml-2 underline">Retry</button>
          </div>
        )}

        {!loading && !loadError && (
          <>
            <Section
              title="Recommended payment methods"
              icon="⭐"
              rows={recommended}
              accent="bg-gradient-to-r from-amber-700/80 to-amber-500/70"
              empty={q ? 'Nothing matches your search.' : 'No method is featured right now.'}
            />
            {SECTION_ORDER.map((s) => (
              <Section
                key={s.key}
                stateKey={s.key}
                title={mode === 'withdraw' && s.key === 'AGENT' ? 'Cash Agent' : s.label}
                icon={s.icon}
                rows={byQuery.filter((m) => m.category === s.key)}
              />
            ))}
            {methods.length === 0 && (
              <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4 text-center text-[11px] text-zinc-400">
                No {mode} method is available for your account right now. Please contact support.
              </div>
            )}

            {history.length > 0 && (
              <div className="mt-5">
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">Your recent {mode}s</span>
                  <span className="text-[9px] text-zinc-600">{history.length}</span>
                </div>
                <div className="space-y-1.5">
                  {history.slice(0, 8).map((r) => (
                    <div key={r.id} className="flex items-center gap-2 rounded-xl border border-zinc-800 bg-zinc-900/60 px-2.5 py-2">
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[10.5px] font-semibold text-zinc-200">
                          {mode === 'withdraw' && r.methodName === 'Telegram Agent' ? 'Cash Agent' : r.methodName} · <span className="font-mono text-zinc-500">{r.id}</span>
                        </div>
                        <div className="text-[9px] text-zinc-500">{timeAgo(r.createdAt)} · {r.entryAmount} {r.entryCurrency}{r.reason ? ` · ${r.reason}` : ''}</div>
                      </div>
                      <div className="text-right">
                        <div className="font-mono text-[10.5px] font-bold text-zinc-100">{price(r.amountUsd)}</div>
                        <span className={`mt-0.5 inline-block rounded-full border px-1.5 py-[1px] text-[8px] font-bold ${STATUS_STYLE[r.status] || 'border-zinc-700 text-zinc-400'}`}>{r.status}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="mt-4 flex items-start gap-2 rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2.5 text-[9.5px] leading-relaxed text-zinc-500">
              <ShieldCheck className="mt-px h-3.5 w-3.5 shrink-0 text-emerald-400" />
              <span>
                Deposits are credited after the payment is verified. Withdrawals leave your wallet when you submit them and are
                returned automatically if they are rejected. Your balance is always kept in USD; amounts here follow your display currency.
              </span>
            </div>
          </>
        )}
      </div>

      {openMethod && (
        <MethodFlow
          method={openMethod}
          label={nameOf(openMethod)}
          logo={logoTile(openMethod, 'sheet')}
          mode={mode}
          entryCode={entryCode}
          entryRate={entryRate}
          price={price}
          onClose={() => { setOpenMethod(null); void loadHistory(mode); }}
          onDone={() => { void load(mode); void loadHistory(mode); }}
        />
      )}
    </div>
  );
};

/* ── the per-method request form ─────────────────────────────────────────── */
const MethodFlow: React.FC<{
  method: Method; label: string; logo: React.ReactNode; mode: Mode; entryCode: string; entryRate: number;
  price: (usd: number, d?: number) => string;
  onClose: () => void; onDone: () => void;
}> = ({ method, label, logo, mode, entryCode, entryRate, price, onClose, onDone }) => {
  const [amount, setAmount] = useState('');
  const [reference, setReference] = useState('');
  const [note, setNote] = useState('');
  const [dest, setDest] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState<{ id: string; amountUsd: number; netUsd?: number; status: string } | null>(null);
  const [copied, setCopied] = useState('');

  const copy = async (text: string, key: string) => {
    try { await navigator.clipboard.writeText(text); setCopied(key); setTimeout(() => setCopied(''), 1200); } catch { /* ignore */ }
  };

  const typedUsd = mode === 'deposit' && entryCode !== 'USD'
    ? (Number(amount) || 0) / (entryRate > 0 ? entryRate : 1)
    : (Number(amount) || 0);
  const feeUsd = Math.round(typedUsd * (method.feePercent || 0)) / 100;
  const netUsd = Math.max(0, typedUsd - feeUsd);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!(Number(amount) > 0)) { setError('Enter an amount greater than 0.'); return; }
    if (mode === 'deposit' && reference.trim().length < 4) { setError('Enter the transaction ID / reference from your payment.'); return; }
    if (mode === 'withdraw') {
      const missing = method.requires.find((f) => String(dest[f.key] || '').trim().length < 3);
      if (missing) { setError(`Please fill in: ${missing.label}.`); return; }
    }
    setBusy(true);
    try {
      const path = mode === 'deposit' ? '/api/user/deposit-request' : '/api/user/withdraw-request';
      const body: any = {
        methodId: method.id,
        amount: Number(amount),
        currency: entryCode,
        idempotencyKey: `${mode}-${method.id}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      };
      if (mode === 'deposit') { body.reference = reference.trim(); body.note = note.trim(); }
      else { body.destination = dest; body.note = note.trim(); }
      const r = await fetch(path, { method: 'POST', headers: BoostPayStore.authHeaders(), body: JSON.stringify(body) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j?.error || 'Could not submit the request.');
      setDone({
        id: j.request?.id || '', amountUsd: Number(j.request?.amountUsd || typedUsd),
        netUsd: j.request?.netUsd, status: j.request?.status || 'PENDING',
      });
      onDone();
    } catch (err: any) {
      setError(err?.message || 'Could not submit the request.');
    } finally { setBusy(false); }
  };

  return (
    <div className="absolute inset-0 z-[75] flex flex-col bg-black/60" onClick={onClose}>
      <div
        className="mt-auto flex max-h-[92%] flex-col overflow-hidden rounded-t-3xl border-t border-zinc-700 bg-zinc-950"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-zinc-800 px-3.5 py-3">
          {logo}
          <div className="min-w-0 flex-1">
            <div className="truncate text-[12px] font-bold text-white">{label}</div>
            <div className="text-[9px] uppercase tracking-wider text-zinc-500">{mode} · {entryCode}</div>
          </div>
          <button onClick={onClose} className="rounded-full p-1.5 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200" aria-label="Close"><X className="h-4 w-4" /></button>
        </div>

        <div className="flex-1 overflow-y-auto px-3.5 py-3">
          {done ? (
            <div className="space-y-3 text-center">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-emerald-500/15">
                <Check className="h-6 w-6 text-emerald-400" />
              </div>
              <div className="text-[13px] font-bold text-white">
                {mode === 'deposit' ? 'Deposit submitted' : 'Withdrawal requested'}
              </div>
              <p className="text-[11px] leading-relaxed text-zinc-400">
                {mode === 'deposit'
                  ? 'Your deposit is pending verification. It is credited to your balance as soon as the payment is confirmed.'
                  : 'The amount has left your wallet and is being paid out. If it is rejected, it is returned automatically.'}
              </p>
              <div className="rounded-xl border border-zinc-800 bg-zinc-900/70 p-3 text-left text-[10.5px] font-mono">
                <div className="flex justify-between"><span className="text-zinc-500">Request</span><span className="text-zinc-200">{done.id}</span></div>
                <div className="mt-1 flex justify-between"><span className="text-zinc-500">Amount</span><span className="text-zinc-200">{price(done.amountUsd)}</span></div>
                {mode === 'withdraw' && done.netUsd !== undefined && (
                  <div className="mt-1 flex justify-between"><span className="text-zinc-500">You receive</span><span className="text-emerald-300">{price(Number(done.netUsd))}</span></div>
                )}
                <div className="mt-1 flex justify-between"><span className="text-zinc-500">Status</span><span className="text-amber-300">{done.status}</span></div>
              </div>
              <button onClick={onClose} className="h-11 w-full rounded-2xl bg-amber-500 text-[12px] font-black text-zinc-950 hover:bg-amber-400">Done</button>
            </div>
          ) : (
            <form onSubmit={submit} className="space-y-3">
              <div className="grid grid-cols-3 gap-2 text-center">
                <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 px-2 py-1.5">
                  <div className="text-[8px] uppercase tracking-wider text-zinc-500">Min</div>
                  <div className="font-mono text-[10px] font-bold text-zinc-200">{price(method.min)}</div>
                </div>
                <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 px-2 py-1.5">
                  <div className="text-[8px] uppercase tracking-wider text-zinc-500">Max</div>
                  <div className="font-mono text-[10px] font-bold text-zinc-200">{price(method.max)}</div>
                </div>
                <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 px-2 py-1.5">
                  <div className="text-[8px] uppercase tracking-wider text-zinc-500">Fee</div>
                  <div className="font-mono text-[10px] font-bold text-zinc-200">{method.feePercent}%</div>
                </div>
              </div>

              <div className="flex items-center gap-1.5 text-[9.5px] text-zinc-500">
                <Clock className="h-3 w-3" /> {method.processingTime}
              </div>

              {mode === 'deposit' && method.payTo && (
                <div className="space-y-1.5 rounded-xl border border-sky-900/50 bg-[#0b1f3a]/60 p-3">
                  <div className="text-[9px] font-bold uppercase tracking-wider text-sky-200/80">Send your payment to</div>
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <div className="text-[9px] text-zinc-400">{method.payTo.accountName || 'Account name'}</div>
                      <div className="truncate font-mono text-[12px] font-bold text-white">{method.payTo.accountNumber || 'Not configured'}</div>
                    </div>
                    {method.payTo.accountNumber && (
                      <button type="button" onClick={() => void copy(method.payTo!.accountNumber, 'acc')}
                        className="rounded-lg border border-sky-500/40 px-2 py-1 text-[9px] font-bold text-sky-200">
                        {copied === 'acc' ? 'Copied' : <Copy className="h-3 w-3" />}
                      </button>
                    )}
                  </div>
                  {method.payTo.instructions && (
                    <p className="text-[9.5px] leading-relaxed text-zinc-400">{method.payTo.instructions}</p>
                  )}
                  {!method.payTo.accountNumber && (
                    <p className="text-[9.5px] font-semibold text-amber-300">
                      This method is not configured yet — please choose another one or contact support.
                    </p>
                  )}
                </div>
              )}

              <label className="block">
                <span className="mb-1 block text-[9.5px] font-bold uppercase tracking-wider text-zinc-400">Amount ({entryCode})</span>
                <input
                  inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)}
                  placeholder="0.00"
                  className="w-full rounded-xl border border-zinc-700 bg-zinc-900 px-3 py-2.5 font-mono text-[15px] font-bold text-white outline-none focus:border-amber-500/60"
                />
                {mode === 'withdraw' && entryCode !== 'USD' && Number(amount) > 0 && (
                  <span className="mt-1 block text-[9px] text-zinc-500">${typedUsd.toFixed(2)} of your balance · fee {price(feeUsd)}</span>
                )}
              </label>

              {mode === 'deposit' ? (
                <>
                  <label className="block">
                    <span className="mb-1 block text-[9.5px] font-bold uppercase tracking-wider text-zinc-400">Transaction ID / reference</span>
                    <input
                      value={reference} onChange={(e) => setReference(e.target.value)}
                      placeholder="e.g. the TrxID from your wallet SMS"
                      className="w-full rounded-xl border border-zinc-700 bg-zinc-900 px-3 py-2.5 text-[11.5px] text-white outline-none focus:border-amber-500/60"
                    />
                  </label>
                </>
              ) : (
                method.requires.map((f) => (
                  <label key={f.key} className="block">
                    <span className="mb-1 block text-[9.5px] font-bold uppercase tracking-wider text-zinc-400">{f.label}</span>
                    <input
                      value={dest[f.key] || ''} onChange={(e) => setDest((d) => ({ ...d, [f.key]: e.target.value }))}
                      placeholder={f.placeholder}
                      className="w-full rounded-xl border border-zinc-700 bg-zinc-900 px-3 py-2.5 text-[11.5px] text-white outline-none focus:border-amber-500/60"
                    />
                  </label>
                ))
              )}

              <label className="block">
                <span className="mb-1 block text-[9.5px] font-bold uppercase tracking-wider text-zinc-400">Note (optional)</span>
                <input
                  value={note} onChange={(e) => setNote(e.target.value)} maxLength={200}
                  placeholder="Anything the reviewer should know"
                  className="w-full rounded-xl border border-zinc-700 bg-zinc-900 px-3 py-2.5 text-[11.5px] text-white outline-none focus:border-amber-500/60"
                />
              </label>

              {error && <div className="rounded-xl border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-[10.5px] font-semibold text-rose-200">{error}</div>}

              <button
                type="submit" disabled={busy || (mode === 'deposit' && !method.payTo?.accountNumber)}
                className="flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-amber-500 text-[12px] font-black text-zinc-950 transition hover:bg-amber-400 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {busy ? <><Loader2 className="h-4 w-4 animate-spin" /> Sending…</> : mode === 'deposit' ? 'Submit deposit' : 'Request withdrawal'}
              </button>

              <p className="pb-1 text-center text-[9px] leading-relaxed text-zinc-600">
                {mode === 'deposit'
                  ? 'Nothing is credited until the payment is verified by our team.'
                  : 'Only boosted profit can be withdrawn. The amount is taken from your balance now and refunded if rejected.'}
              </p>
            </form>
          )}
        </div>
      </div>
    </div>
  );
};

export default PaymentsPage;
