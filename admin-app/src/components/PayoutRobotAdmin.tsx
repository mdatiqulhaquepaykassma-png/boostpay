import { useCallback, useEffect, useState } from 'react';
import { Bot, RefreshCw, Send, Ban, CheckCheck, Undo2, AlertTriangle, Smartphone, Link2, Loader2 } from 'lucide-react';
import { BoostPayStore } from '../services/store';

/**
 * Payout Robot — the admin panel drives the phone that sends bKash/Nagad money.
 *
 *   queue a job here ▸ the phone (ussd-payout app, "server queue" mode) picks it up
 *   ▸ the phone types the USSD menu ▸ the wallet's "you have sent Tk …" SMS comes
 *   back through the SMS relay ▸ that SMS is the ONLY thing that marks a job PAID
 *   and completes the user's withdrawal.
 *
 * A test job has no user and no withdrawal attached, so a mistake here can move
 * money out of the wallet but can never pay or refund a customer wrongly.
 *
 * A FAILED job is NOT a refund — never was a safe one, because the phone can send the
 * money and lose its receipt (2026-11-13: 199.64 BDT paid AND refunded by two polling
 * loops on one phone). Since then the panel holds three money actions per job and the
 * admin chooses one:
 *   ↻ retry      → queue it again, only while the withdrawal is still PENDING
 *   ✔ mark paid  → the wallet really sent it; a TrxID is mandatory, the customer gets
 *                  the receipt and the withdrawal is completed through the normal path
 *   ↩ refund     → you checked the wallet: nothing left it; the money returns to the
 *                  user and the job is cancelled so no phone can send it later
 */

// NOTE: adminAuthHeaders() already sets Content-Type — never add it twice.
// Wrapped: a broken session in storage must never take the whole console down.
const PAYOUT_SERVER = 'https://management.boostpay.online';

const authHeaders = (): Record<string, string> => {
  try { return { ...BoostPayStore.adminAuthHeaders() }; } catch { return { 'Content-Type': 'application/json' }; }
};

/** Every number on this screen is rendered defensively — a missing field shows 0, never a crash. */
const num = (v: any, fallback = 0): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};
const asArray = <T,>(v: any): T[] => (Array.isArray(v) ? v : []);
/**
 * Anything that is not a plain string/number becomes ''. React refuses to render an
 * object as a child (error #31) — a withdrawal's destination arrives as
 * {accountName, accountNumber}, and that is exactly what blacked the tab out once.
 */
const str = (v: any): string => {
  if (v == null) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (typeof v === 'object') {
    const d: any = v;
    const num = d.accountNumber || d.number || d.msisdn || d.mobile || d.account || d.phone;
    const name = d.accountName || d.name || '';
    if (num || name) return [name, num].filter(Boolean).join(' · ');
    try { return Object.values(d).map((x) => String(x)).join(' · '); } catch { return ''; }
  }
  return '';
};

type Job = {
  id: string; kind: 'TEST' | 'WITHDRAW'; provider: string; number: string;
  amountBdt: number; amountUsd: number; ref: string; withdrawId: string; userId: string; note: string;
  status: string; deviceId: string; deviceLabel: string; attempts: number;
  createdAt: number; claimedAt: number; sentAt: number; paidAt: number; finishedAt: number;
  trxId: string; resultNote: string; screenLog: string;
  markedPaidAt?: number; markedPaidBy?: string; lateReceipt?: boolean;
  retryable?: boolean; retryBlocked?: string;
  markPaid?: boolean; markPaidBlocked?: string;
  refund?: boolean; refundBlocked?: string;
  withdrawStatus?: string; needsDecision?: boolean;
};
type Pending = {
  id: string; userId: string; userName: string; userPhone: string; methodName: string;
  number: string; amountUsd: number; amountBdt: number | null; queued: boolean; createdAt: number;
};
type Device = {
  id: string; label: string; methodName: string; msisdn: string; active: boolean;
  payoutEnabled: boolean; payoutProvider: string; lastSeenAt: number; lastJobAt: number;
  online?: boolean; secondsAgo?: number; payoutAppVersion?: string; queueDryRun?: boolean;
};
type Stats = { queued: number; claimed: number; sent: number; paid24h: number; failed24h: number; paidBdt24h: number };
type EventRow = { at: number; action: string; detail: string };

const STATUS_STYLE: Record<string, string> = {
  QUEUED: 'bg-cyan-500/15 text-cyan-300 border-cyan-500/30',
  CLAIMED: 'bg-indigo-500/15 text-indigo-300 border-indigo-500/30',
  SENT: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
  PAID: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
  DRYRUN: 'bg-zinc-600/30 text-zinc-300 border-zinc-500/40',
  FAILED: 'bg-red-500/15 text-red-300 border-red-500/40',
  CANCELLED: 'bg-zinc-700/40 text-zinc-300 border-zinc-600/40',
};

const ago = (t: number) => {
  if (!t) return 'never';
  const d = Date.now() - t;
  if (d < 60_000) return 'just now';
  if (d < 3_600_000) return `${Math.floor(d / 60_000)} min ago`;
  if (d < 86_400_000) return `${Math.floor(d / 3_600_000)} h ago`;
  return `${Math.floor(d / 86_400_000)} d ago`;
};

export const PayoutRobotAdmin = () => {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [pending, setPending] = useState<Pending[]>([]);
  const [devices, setDevices] = useState<Device[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [smsStats, setSmsStats] = useState<{ count: number; lastAt: number } | null>(null);
  const [events, setEvents] = useState<EventRow[]>([]);
  const [phoneStatus, setPhoneStatus] = useState<{ online: number; dryRun: number; liveMode: number } | null>(null);
  const [, setTick] = useState(0);
  const [issuedToken, setIssuedToken] = useState<{ label: string; token: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [note, setNote] = useState('');
  const [open, setOpen] = useState<string>('');
  // ✔ Mark paid needs a TrxID, so it opens a small inline form instead of a blind click
  const [payFor, setPayFor] = useState<string>('');
  const [payTrx, setPayTrx] = useState('');
  const [form, setForm] = useState({ provider: 'nagad', number: '', amountBdt: '20', ref: '1' });
  const [loaded, setLoaded] = useState(false);
  const [httpNote, setHttpNote] = useState('');

  const load = useCallback(async () => {
    try {
      const r = await fetch('/api/admin/payouts', { headers: authHeaders() });
      const j = await r.json();
      setHttpNote('HTTP ' + r.status);
      if (!r.ok) throw new Error(j.error || 'Could not load the payout queue.');
      setJobs(asArray<Job>(j.jobs));
      setPending(asArray<Pending>(j.pending));
      setDevices(asArray<Device>(j.devices));
      setStats(j.stats && typeof j.stats === 'object' ? j.stats : null);
      setSmsStats(j.smsStats && typeof j.smsStats === 'object' ? j.smsStats : null);
      setEvents(asArray<EventRow>(j.events));
      setPhoneStatus(j.phoneStatus && typeof j.phoneStatus === 'object' ? j.phoneStatus : null);
      setErr('');
    } catch (e: any) { setErr(e?.message || 'Could not load the payout queue.'); }
    finally { setLoaded(true); }
  }, []);

  useEffect(() => { void load(); const iv = window.setInterval(load, 5000); return () => window.clearInterval(iv); }, [load]);
  // re-render every second so "3 s ago" stays true between polls
  useEffect(() => { const iv = window.setInterval(() => setTick((n) => n + 1), 1000); return () => window.clearInterval(iv); }, []);

  const call = async (url: string, body: any, okText: string) => {
    setBusy(true); setErr(''); setNote('');
    try {
      const r = await fetch(url, { method: 'POST', headers: authHeaders(), body: JSON.stringify(body) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'That did not work.');
      setNote(okText);
      await load();
    } catch (e: any) { setErr(e?.message || 'That did not work.'); }
    setBusy(false);
  };

  const newToken = async (d: Device) => {
    if (!window.confirm(`Issue a new token for ${str(d.label)}?\n\nThe current token stops working immediately — paste the new one in the app.`)) return;
    setBusy(true); setErr(''); setNote('');
    try {
      const r = await fetch(`/api/admin/payouts/devices/${d.id}/token`, { method: 'POST', headers: authHeaders(), body: JSON.stringify({}) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'Could not issue a token.');
      setIssuedToken({ label: str(d.label), token: String(j.token || '') });
      await load();
    } catch (e: any) { setErr(e?.message || 'Could not issue a token.'); }
    setBusy(false);
  };

  const queueTest = () => {
    const amount = Number(form.amountBdt);
    if (!form.number.trim()) { setErr('Enter the receiver number.'); return; }
    if (!window.confirm(
      `Send a REAL payout of ${amount} BDT to ${form.number.trim()} from the ${form.provider} phone?\n\n` +
      'This is a test job: no user and no withdrawal are attached, so nothing can be paid or refunded wrongly — ' +
      'but the money does leave the wallet. The phone sends it for real — there is no dry run any more.'
    )) return;
    void call('/api/admin/payouts/test', { ...form, amountBdt: amount }, 'Test payout queued — the phone will pick it up within a few seconds.');
  };

  const queueWithdraw = (p: Pending) => {
    if (!window.confirm(`Send $${num(p.amountUsd).toFixed(2)} (${num(p.amountBdt)} BDT) to ${str(p.number) || str((p as any).destination)} via the robot?\n\nIf the phone fails, nothing is refunded automatically: the job stays here so you can retry it, mark it paid with the wallet TrxID, or refund it yourself.`)) return;
    void call('/api/admin/payouts/queue', { withdrawId: p.id }, `Withdrawal ${str(p.id)} queued for the robot.`);
  };

  const cancel = (j: Job) => {
    if (!window.confirm(`Cancel ${str(j.id)}? A queued withdrawal is refunded to the user.`)) return;
    void call(`/api/admin/payouts/${j.id}/cancel`, { reason: 'cancelled in the admin panel' }, `${str(j.id)} cancelled.`);
  };

  const retry = (j: Job) => {
    if (!window.confirm(`Queue ${str(j.id)} again?\n\nOnly a job that FAILED can be retried, and a withdrawal is only retried while it is still pending — so this can never pay twice.`)) return;
    void call(`/api/admin/payouts/${j.id}/retry`, {}, `${str(j.id)} is back in the queue — the phone will pick it up.`);
  };

  const cleanTrx = (v: string) => String(v || '').toUpperCase().replace(/[^A-Z0-9_-]/g, '').slice(0, 40);

  const submitMarkPaid = (key: string, body: any) => {
    const trxId = cleanTrx(payTrx);
    if (trxId.length < 3) { setErr('Type the TrxID the wallet showed — at least 3 letters or numbers.'); return; }
    setPayFor(''); setPayTrx('');
    void call('/api/admin/payouts/mark-paid', { ...body, trxId },
      `Recorded as paid · TrxID ${trxId} — the customer sees the receipt and the withdrawal is closed.`);
  };

  const refundJob = (j: Job) => {
    if (!window.confirm(
      `Refund ${str(j.withdrawId) || 'this withdrawal'} to the user?\n\n` +
      'Only press this after you checked the wallet: the money must NOT have left it. ' +
      'The withdrawal is refunded, the customer is notified, and the job is cancelled so no phone sends it.'
    )) return;
    void call('/api/admin/payouts/refund', { jobId: j.id, reason: 'refunded in the payout panel' },
      `${str(j.withdrawId) || str(j.id)} refunded to the user and the job is closed.`);
  };

  const refundPending = (p: Pending) => {
    if (!window.confirm(
      `Refund $${num(p.amountUsd).toFixed(2)} to ${str(p.userName) || str(p.userId)}?\n\n` +
      'This returns the held withdrawal without a payout. Only for money the wallet never sent.'
    )) return;
    void call('/api/admin/payouts/refund', { withdrawId: p.id, reason: 'refunded in the payout panel' },
      `${str(p.id)} refunded to the user.`);
  };

  const patchDevice = async (d: Device, body: any, okText: string) => {
    setBusy(true); setErr(''); setNote('');
    try {
      const r = await fetch(`/api/admin/payouts/devices/${d.id}`, { method: 'POST', headers: authHeaders(), body: JSON.stringify(body) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'Could not update the phone.');
      setNote(okText);
      await load();
    } catch (e: any) { setErr(e?.message || 'Could not update the phone.'); }
    setBusy(false);
  };

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-zinc-800 bg-zinc-950/60 p-4">
        <h3 className="flex items-center gap-2 text-sm font-black text-white">
          <Bot className="w-4 h-4 text-emerald-400" /> Payout robot — send from the admin panel
        </h3>
        <p className="mt-1 text-[11px] leading-relaxed text-zinc-500">
          Queue a job here and the phone with the USSD app sends it: menu → number → amount → reference → PIN, one key each.
          A job turns <b className="text-emerald-300">PAID</b> only when the wallet's “you have sent Tk …” SMS comes back through the
          SMS Bridge. If the phone fails, the withdrawal is refunded to the user automatically.
        </p>
        {/* ── MOBILE ⇄ PANEL — the one thing that must be obvious ─────────── */}
        {(() => {
          const seen = (d: Device) => (num(d.secondsAgo) >= 0 ? num(d.secondsAgo)
            : (num(d.lastSeenAt) ? Math.round((Date.now() - num(d.lastSeenAt)) / 1000) : -1));
          const enabled = devices.filter((d) => d.active !== false && d.payoutEnabled !== false);
          const online = enabled.filter((d) => seen(d) >= 0 && seen(d) < 90);
          const live = online.filter((d) => d.queueDryRun !== true);
          const dry = online.filter((d) => d.queueDryRun === true);
          const state = online.length === 0 ? 'DISCONNECTED' : (live.length > 0 ? 'CONNECTED · LIVE' : 'CONNECTED · DRY RUN');
          const ring = online.length === 0 ? 'border-red-500/60 bg-red-500/10'
            : live.length > 0 ? 'border-emerald-500/60 bg-emerald-500/10' : 'border-amber-500/60 bg-amber-500/10';
          const text = online.length === 0 ? 'text-red-200' : live.length > 0 ? 'text-emerald-200' : 'text-amber-200';
          return (
            <div className={`mt-3 rounded-2xl border-2 ${ring} px-4 py-3`}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className={`h-3 w-3 rounded-full ${online.length ? 'bg-emerald-400 animate-pulse' : 'bg-red-500'}`} />
                  <span className={`text-[15px] font-black tracking-wide ${text}`}>MOBILE: {state}</span>
                </div>
                <span className="text-[10px] font-semibold text-zinc-400">
                  {online.length === 0 ? 'no phone is asking for jobs right now'
                    : online.map((d) => `${str(d.label)} · app ${str(d.payoutAppVersion) || '?'} · ${seen(d)}s ago`).join('  |  ')}
                </span>
              </div>
              {online.length === 0 ? (
                <p className="mt-1 text-[11px] leading-relaxed text-red-200/85">
                  A queued job waits until the phone checks in. On the phone: open the app → <b>▶ CONNECT</b> (top button) →
                  the card on the phone must turn green. A “Queue running” notification stays on the phone while it is connected.
                </p>
              ) : null}
              <div className="mt-2 flex flex-wrap items-center gap-2">
                {devices.length === 0 ? (
                  <span className="text-[10.5px] text-zinc-400">No phone registered yet — create one in <b>SMS Bridge</b>.</span>
                ) : devices.map((d) => (
                  <button
                    key={d.id}
                    disabled={busy}
                    onClick={() => patchDevice(d, { payoutEnabled: d.payoutEnabled === false },
                      d.payoutEnabled === false ? `${str(d.label)} re-connected` : `${str(d.label)} disconnected — its app will show DISCONNECTED`)}
                    className={`rounded-lg border px-2.5 py-1 text-[10.5px] font-black disabled:opacity-40 ${
                      d.payoutEnabled === false
                        ? 'border-red-500/50 bg-red-500/15 text-red-200'
                        : 'border-emerald-500/50 bg-emerald-500/15 text-emerald-200'}`}
                  >
                    {str(d.label)} · {d.payoutEnabled === false ? 'DISCONNECTED — connect' : 'CONNECTED — disconnect'}
                  </button>
                ))}
              </div>
            </div>
          );
        })()}

        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-6">
          {[
            ['Queued', num(stats?.queued)],
            ['On a phone', num(stats?.claimed)],
            ['Sent', num(stats?.sent)],
            ['Paid 24h', num(stats?.paid24h)],
            ['Failed 24h', num(stats?.failed24h)],
            ['BDT paid 24h', num(stats?.paidBdt24h)],
          ].map(([label, value]) => (
            <div key={String(label)} className="rounded-xl border border-zinc-800 bg-zinc-900/60 px-3 py-2">
              <div className="text-[9px] font-bold uppercase tracking-wider text-zinc-500">{label}</div>
              <div className="text-sm font-black text-white">{value}</div>
            </div>
          ))}
        </div>
        <p className="mt-2 flex flex-wrap items-center gap-2 text-[10px] leading-relaxed text-zinc-500">
          <a href="/nagadpayout" target="_blank" rel="noreferrer" className="rounded-lg border border-rose-500/40 bg-rose-500/10 px-2 py-1 font-black text-rose-300">Nagad payout APK</a>
          <a href="/ussdpayout" target="_blank" rel="noreferrer" className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-2 py-1 font-black text-amber-300">bKash payout APK</a>
          <span>on the phone: paste the server URL + device token, then press ▶ CONNECT.</span>
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-2 rounded-xl border border-zinc-700 bg-zinc-950 px-3 py-2">
          <span className="text-[9px] font-bold uppercase tracking-wider text-zinc-500">Server URL for the phone</span>
          <code className="break-all font-mono text-[11px] text-emerald-200">{PAYOUT_SERVER}</code>
          <button
            onClick={() => { void navigator.clipboard?.writeText(PAYOUT_SERVER); setNote('Server URL copied — paste it into the payout app → Server connection.'); }}
            className="ml-auto rounded-lg border border-zinc-700 px-2 py-1 text-[10px] font-bold text-zinc-200"
          >Copy</button>
        </div>
      </div>

      {!loaded && !err ? (
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 px-3 py-2 text-[11px] text-zinc-400">
          Loading the queue… (if this never turns into a list, the panel could not reach the server{httpNote ? ` — ${httpNote}` : ''})
        </div>
      ) : null}

      {issuedToken ? (
        <div className="rounded-2xl border border-emerald-500/40 bg-emerald-500/[0.07] p-4">
          <div className="flex items-center justify-between">
            <div className="text-[11px] font-black uppercase tracking-wider text-emerald-300">
              New token for {str(issuedToken.label)} — shown once
            </div>
            <button onClick={() => setIssuedToken(null)} className="text-[10px] font-bold text-zinc-400">close</button>
          </div>
          <div className="mt-2 flex items-center gap-2">
            <code className="flex-1 break-all rounded-xl border border-zinc-700 bg-zinc-950 px-3 py-2 font-mono text-[11px] text-emerald-200">{str(issuedToken.token)}</code>
            <button
              onClick={() => { void navigator.clipboard?.writeText(issuedToken.token); setNote('Token copied — paste it into the payout app (section 4).'); }}
              className="rounded-xl border border-zinc-700 px-3 py-2 text-[10px] font-bold text-zinc-200"
            >Copy</button>
          </div>
          <ol className="mt-2 space-y-1 text-[10.5px] leading-relaxed text-zinc-400">
            <li>1. On the payout phone open the app → <b className="text-zinc-200">Server connection</b>.</li>
            <li>2. Server = <b className="text-zinc-200">{PAYOUT_SERVER}</b> · paste this token into the token box → <b className="text-zinc-200">Test</b>.</li>
            <li>3. <b className="text-zinc-200">▶ CONNECT</b> — the big card must turn green and this panel must show <b className="text-zinc-200">CONNECTED</b>.</li>
          </ol>
        </div>
      ) : null}

      {note ? <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-[11px] text-emerald-200">{note}</div> : null}
      {err ? <div className="rounded-xl border border-red-500/40 bg-red-500/10 px-3 py-2 text-[11px] text-red-200">{err}</div> : null}

      {/* ── test payout ─────────────────────────────────────────────────── */}
      <div className="rounded-2xl border border-zinc-800 bg-zinc-950/60 p-4">
        <div className="text-[11px] font-black uppercase tracking-wider text-amber-400">Test payout</div>
        <div className="mt-3 grid gap-2 sm:grid-cols-4">
          <select className="rounded-xl border border-zinc-800 bg-zinc-900 px-3 py-2 text-[12px] text-white outline-none" value={form.provider} onChange={(e) => setForm({ ...form, provider: e.target.value })}>
            <option value="nagad">Nagad</option>
            <option value="bkash">bKash</option>
          </select>
          <input className="rounded-xl border border-zinc-800 bg-zinc-900 px-3 py-2 text-[12px] text-white outline-none" placeholder="Receiver 01XXXXXXXXX" value={form.number} onChange={(e) => setForm({ ...form, number: e.target.value })} />
          <input className="rounded-xl border border-zinc-800 bg-zinc-900 px-3 py-2 text-[12px] text-white outline-none" placeholder="Amount BDT" value={form.amountBdt} onChange={(e) => setForm({ ...form, amountBdt: e.target.value })} />
          <input className="rounded-xl border border-zinc-800 bg-zinc-900 px-3 py-2 text-[12px] text-white outline-none" placeholder="Reference (1)" value={form.ref} onChange={(e) => setForm({ ...form, ref: e.target.value })} />
        </div>
        <button disabled={busy} onClick={queueTest} className="mt-2 flex items-center gap-1.5 rounded-xl bg-amber-500 px-3 py-2 text-[11px] font-black text-zinc-950 disabled:opacity-50">
          {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />} Queue test payout
        </button>
      </div>

      {/* ── pending withdrawals ─────────────────────────────────────────── */}
      <div className="rounded-2xl border border-zinc-800 bg-zinc-950/60 p-4">
        <div className="flex items-center justify-between">
          <div className="text-[11px] font-black uppercase tracking-wider text-cyan-400">Withdrawals waiting for a payout</div>
          <button onClick={load} className="rounded-lg border border-zinc-700 px-2 py-1 text-[10px] font-bold text-zinc-300"><RefreshCw className="inline w-3 h-3" /> refresh</button>
        </div>
        {pending.length === 0 ? (
          <p className="mt-2 text-[11px] text-zinc-500">Nothing pending. A user withdrawal appears here as soon as they submit it.</p>
        ) : (
          <div className="mt-3 space-y-2">
            {pending.map((p) => (
              <div key={p.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-zinc-800 bg-zinc-900/50 px-3 py-2">
                <div className="min-w-0">
                  <div className="text-[12px] font-bold text-white">{str(p.userName) || str(p.userId) || 'user'} · ${num(p.amountUsd).toFixed(2)}</div>
                  <div className="text-[10px] text-zinc-500">
                    {str(p.methodName)} · {str(p.number) || str((p as any).destination) || 'no number'} · {p.amountBdt != null ? `${num(p.amountBdt)} BDT` : 'no BDT rate'} · {ago(num(p.createdAt))}
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    disabled={busy || p.queued || !p.number || p.amountBdt == null}
                    onClick={() => queueWithdraw(p)}
                    className="rounded-xl border border-cyan-500/40 bg-cyan-500/10 px-3 py-1.5 text-[10px] font-black text-cyan-300 disabled:opacity-40"
                  >
                    {p.queued ? 'in queue' : 'Send via robot'}
                  </button>
                  <button
                    onClick={() => { const k = 'w:' + str(p.id); if (payFor === k) { setPayFor(''); setPayTrx(''); } else { setPayFor(k); setPayTrx(''); } }}
                    disabled={busy}
                    title="you paid this by hand (agent, bank, wallet) — record the reference so the customer sees a receipt"
                    className="rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-2.5 py-1.5 text-[10px] font-black text-emerald-300 disabled:opacity-40"
                  >
                    <CheckCheck className="inline w-3 h-3" /> paid
                  </button>
                  <button
                    onClick={() => refundPending(p)}
                    disabled={busy}
                    title="return the held money — no payout was made"
                    className="rounded-xl border border-fuchsia-500/40 bg-fuchsia-500/10 px-2.5 py-1.5 text-[10px] font-black text-fuchsia-300 disabled:opacity-40"
                  >
                    <Undo2 className="inline w-3 h-3" /> refund
                  </button>
                </div>
                {payFor === 'w:' + str(p.id) ? (
                  <div className="flex w-full flex-wrap items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/5 px-2 py-1.5">
                    <span className="text-[10px] font-bold text-emerald-300">TrxID / reference</span>
                    <input
                      autoFocus value={payTrx} onChange={(e) => setPayTrx(e.target.value)} placeholder="e.g. 76BA500O"
                      className="w-40 rounded-lg border border-zinc-700 bg-zinc-950 px-2 py-1 font-mono text-[11px] text-white outline-none focus:border-emerald-400"
                    />
                    <button onClick={() => submitMarkPaid('w:' + str(p.id), { withdrawId: p.id })} disabled={busy}
                      className="rounded-lg bg-emerald-500 px-2.5 py-1 text-[10px] font-black text-zinc-950 disabled:opacity-50">save receipt</button>
                    <button onClick={() => { setPayFor(''); setPayTrx(''); }} className="text-[10px] font-bold text-zinc-400">cancel</button>
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── phones ──────────────────────────────────────────────────────── */}
      <div className="rounded-2xl border border-zinc-800 bg-zinc-950/60 p-4">
        <div className="text-[11px] font-black uppercase tracking-wider text-indigo-400">Phones allowed to send payouts</div>
        {devices.length === 0 ? (
          <p className="mt-2 text-[11px] text-zinc-500">
            No phone registered yet. Create one in <b className="text-zinc-300">SMS Bridge</b> — the same device and token are used here,
            so one revoke switch stops both duties.
          </p>
        ) : (
          <div className="mt-3 space-y-2">
            {devices.map((d) => (
              <div key={d.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-zinc-800 bg-zinc-900/50 px-3 py-2">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-1.5 text-[12px] font-bold text-white">
                    <Smartphone className="w-3.5 h-3.5 text-zinc-400" /> {str(d.label)}
                    {(() => {
                      const seen = num(d.secondsAgo) >= 0 ? num(d.secondsAgo) : (num(d.lastSeenAt) ? Math.round((Date.now() - num(d.lastSeenAt)) / 1000) : -1);
                      const isOnline = seen >= 0 && seen < 90;
                      const cls = !isOnline ? 'bg-zinc-700/50 text-zinc-300 border-zinc-600'
                        : d.queueDryRun ? 'bg-amber-500/15 text-amber-300 border-amber-500/40'
                          : 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40';
                      return (
                        <span className={`rounded-md border px-1.5 py-0.5 text-[9px] font-black ${cls}`}>
                          {!isOnline ? 'OFFLINE' : d.queueDryRun ? 'DRY RUN' : 'LIVE'}
                          {isOnline ? ` · ${seen}s` : ''}
                        </span>
                      );
                    })()}
                  </div>
                  <div className="text-[10px] text-zinc-500">
                    {str(d.methodName)} · app {str(d.payoutAppVersion) || '—'} · seen {ago(num(d.lastSeenAt))} · last job {ago(num(d.lastJobAt))} · {d.active ? 'relay on' : 'relay paused'}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <select
                    className="rounded-lg border border-zinc-700 bg-zinc-900 px-2 py-1 text-[10px] text-white"
                    value={d.payoutProvider}
                    onChange={(e) => patchDevice(d, { payoutProvider: e.target.value }, `${str(d.label)}: wallet ${e.target.value || 'auto'}`)}
                  >
                    <option value="">auto</option>
                    <option value="nagad">nagad</option>
                    <option value="bkash">bkash</option>
                  </select>
                  <button
                    disabled={busy}
                    onClick={() => void newToken(d)}
                    className="rounded-lg border border-zinc-700 bg-zinc-900 px-2 py-1 text-[10px] font-bold text-zinc-300 disabled:opacity-40"
                    title="Issue a new device token (the phone must be given the new one)"
                  >
                    New token
                  </button>
                  <button
                    onClick={() => patchDevice(d, { payoutEnabled: !d.payoutEnabled }, `${str(d.label)}: payouts ${d.payoutEnabled ? 'OFF' : 'ON'}`)}
                    className={`rounded-lg border px-2 py-1 text-[10px] font-black ${d.payoutEnabled ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300' : 'border-zinc-700 bg-zinc-800 text-zinc-400'}`}
                  >
                    {d.payoutEnabled ? 'payout ON' : 'payout OFF'}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {smsStats && num(smsStats.count) === 0 ? (
        <div className="rounded-2xl border border-amber-500/40 bg-amber-500/10 p-3 text-[11px] leading-relaxed text-amber-100">
          <b>No SMS has ever reached the server.</b> The debit SMS is the only thing that turns a payout
          <b> SENT → PAID</b> (and auto-credits a deposit). Until the SMS relay app is running on the wallet phone,
          a payout can be sent but never confirmed. Text the relay phone’s number from another phone to test it.
        </div>
      ) : null}

      {/* ── queue ───────────────────────────────────────────────────────── */}
      <div className="rounded-2xl border border-zinc-800 bg-zinc-950/60 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="text-[11px] font-black uppercase tracking-wider text-emerald-400">Queue</div>
          <div className="flex flex-wrap items-center gap-2 text-[10px] font-bold">
            <span className="rounded-md border border-cyan-500/30 bg-cyan-500/10 px-1.5 py-0.5 text-cyan-300">{num(stats?.queued)} queued</span>
            <span className="rounded-md border border-indigo-500/30 bg-indigo-500/10 px-1.5 py-0.5 text-indigo-300">{num(stats?.claimed)} on a phone</span>
            <span className="rounded-md border border-amber-500/30 bg-amber-500/10 px-1.5 py-0.5 text-amber-300">{num(stats?.sent)} waiting for SMS</span>
            <span className="rounded-md border border-emerald-500/30 bg-emerald-500/10 px-1.5 py-0.5 text-emerald-300">{num(stats?.paid24h)} paid 24 h</span>
            <span className={`rounded-md border px-1.5 py-0.5 ${num(stats?.failed24h) ? 'border-red-500/40 bg-red-500/15 text-red-300' : 'border-zinc-700 bg-zinc-800 text-zinc-400'}`}>{num(stats?.failed24h)} failed 24 h</span>
          </div>
        </div>
        {jobs.length === 0 ? (
          <p className="mt-2 text-[11px] text-zinc-500">No jobs yet. Queue a test above to see the whole path end to end.</p>
        ) : (
          <div className="mt-3 space-y-2">
            {jobs.map((j) => (
              <div key={j.id} className="rounded-xl border border-zinc-800 bg-zinc-900/50 px-3 py-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2 text-[12px] font-bold text-white">
                      <span className={`rounded-md border px-1.5 py-0.5 text-[9px] font-black ${STATUS_STYLE[j.status] || ''}`}>{j.status}</span>
                      <span>{num(j.amountBdt)} BDT → {str(j.number) || '—'}</span>
                      <span className="text-[9px] font-bold uppercase text-zinc-500">{str(j.kind)} · {str(j.provider)}</span>
                    </div>
                    <div className="text-[10px] text-zinc-500">
                      {str(j.id)} · created {ago(num(j.createdAt))}
                      {str(j.deviceLabel) ? ` · phone ${str(j.deviceLabel)}` : ''}
                      {str(j.trxId) ? ` · TrxID ${str(j.trxId)}` : ''}
                      {num(j.attempts) ? ` · ${num(j.attempts)} attempt(s)` : ''}
                    </div>
                    {j.status === 'FAILED' || j.status === 'DRYRUN' ? (
                      <div className="mt-1 text-[10px] text-red-300">
                        {j.status === 'FAILED' ? 'failed' : 'not sent (dry run)'}: {str(j.resultNote) || 'the phone did not say why'}
                        {j.retryable === false && str(j.retryBlocked) ? <span className="text-zinc-500"> · {str(j.retryBlocked)}</span> : null}
                      </div>
                    ) : null}
                    {j.needsDecision ? (
                      <div className="mt-1 text-[10px] font-bold text-amber-300">
                        ⚠ no money moved automatically — nothing was refunded. Decide: ↻ retry, ✔ mark paid with the wallet TrxID, or ↩ refund.
                        {str(j.withdrawStatus) ? ` (withdrawal ${str(j.withdrawStatus)})` : ''}
                      </div>
                    ) : null}
                    {num(j.markedPaidAt) ? (
                      <div className="mt-1 text-[10px] text-zinc-500">
                        receipt recorded by hand{str(j.markedPaidBy) ? ` · ${str(j.markedPaidBy)}` : ''} · {ago(num(j.markedPaidAt))}
                      </div>
                    ) : null}
                    {str(j.markPaidBlocked) && j.markPaid === false && ['FAILED', 'DRYRUN', 'CLAIMED', 'QUEUED'].includes(j.status) ? (
                      <div className="mt-1 text-[10px] text-zinc-600">mark paid off: {str(j.markPaidBlocked)}</div>
                    ) : null}
                  </div>
                  <div className="flex items-center gap-2">
                    <button onClick={() => setOpen(open === j.id ? '' : j.id)} className="rounded-lg border border-zinc-700 px-2 py-1 text-[10px] font-bold text-zinc-300">
                      {open === j.id ? 'hide' : 'log'}
                    </button>
                    {['FAILED', 'DRYRUN'].includes(j.status) ? (
                      <button
                        onClick={() => retry(j)}
                        disabled={busy || j.retryable === false}
                        title={j.retryable === false ? (str(j.retryBlocked) || 'this job cannot be retried') : 'queue this job again — the withdrawal is still pending, so this cannot pay twice'}
                        className={`rounded-lg border px-2 py-1 text-[10px] font-black ${j.retryable === false
                          ? 'cursor-not-allowed border-zinc-700 bg-zinc-800/60 text-zinc-500'
                          : 'border-amber-500/50 bg-amber-500/15 text-amber-200'}`}
                      >
                        <RefreshCw className="inline w-3 h-3" /> retry
                      </button>
                    ) : null}
                    {['FAILED', 'DRYRUN', 'CLAIMED', 'QUEUED', 'SENT'].includes(j.status) ? (
                      <button
                        onClick={() => { if (payFor === j.id) { setPayFor(''); setPayTrx(''); } else { setPayFor(j.id); setPayTrx(str(j.trxId) || ''); } }}
                        disabled={busy || j.markPaid === false}
                        title={j.markPaid === false ? (str(j.markPaidBlocked) || 'this job cannot be marked paid') : 'the wallet really sent this — record its TrxID'}
                        className={`rounded-lg border px-2 py-1 text-[10px] font-black ${j.markPaid === false
                          ? 'cursor-not-allowed border-zinc-700 bg-zinc-800/60 text-zinc-500'
                          : 'border-emerald-500/50 bg-emerald-500/15 text-emerald-200'}`}
                      >
                        <CheckCheck className="inline w-3 h-3" /> mark paid
                      </button>
                    ) : null}
                    {['QUEUED', 'CLAIMED', 'FAILED', 'DRYRUN'].includes(j.status) ? (
                      <button
                        onClick={() => refundJob(j)}
                        disabled={busy || j.refund === false}
                        title={j.refund === false ? (str(j.refundBlocked) || 'nothing to refund here') : 'return the held withdrawal to the user and close this job'}
                        className={`rounded-lg border px-2 py-1 text-[10px] font-black ${j.refund === false
                          ? 'cursor-not-allowed border-zinc-700 bg-zinc-800/60 text-zinc-500'
                          : 'border-fuchsia-500/50 bg-fuchsia-500/15 text-fuchsia-200'}`}
                      >
                        <Undo2 className="inline w-3 h-3" /> refund
                      </button>
                    ) : null}
                    {['QUEUED', 'CLAIMED', 'FAILED'].includes(j.status) ? (
                      <button onClick={() => cancel(j)} className="rounded-lg border border-red-500/40 bg-red-500/10 px-2 py-1 text-[10px] font-black text-red-300">
                        <Ban className="inline w-3 h-3" /> cancel
                      </button>
                    ) : null}
                  </div>
                </div>
                {payFor === j.id ? (
                  <div className="mt-2 flex flex-wrap items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/5 px-2 py-2">
                    <span className="text-[10px] font-bold text-emerald-300">wallet TrxID for {num(j.amountBdt)} BDT → {str(j.number) || '—'}</span>
                    <input
                      autoFocus value={payTrx} onChange={(e) => setPayTrx(e.target.value)}
                      placeholder="e.g. 76BA500O"
                      className="w-40 rounded-lg border border-zinc-700 bg-zinc-950 px-2 py-1 font-mono text-[11px] text-white outline-none focus:border-emerald-400"
                    />
                    <button onClick={() => submitMarkPaid(j.id, { jobId: j.id })} disabled={busy}
                      className="rounded-lg bg-emerald-500 px-2.5 py-1 text-[10px] font-black text-zinc-950 disabled:opacity-50">save receipt</button>
                    <button onClick={() => { setPayFor(''); setPayTrx(''); }} className="text-[10px] font-bold text-zinc-400">cancel</button>
                    {str(j.withdrawStatus) === 'REJECTED' ? (
                      <span className="text-[9.5px] font-bold text-amber-300">this withdrawal was already refunded — the receipt is recorded, then settle it in Treasury (debit the user)</span>
                    ) : null}
                  </div>
                ) : null}
                {open === j.id ? (
                  <div className="mt-2 space-y-1 rounded-lg border border-zinc-800 bg-zinc-950 p-2">
                    <div className="text-[10px] text-zinc-400">
                      {j.status === 'PAID' ? <CheckCheck className="inline w-3 h-3 text-emerald-400" /> : <AlertTriangle className="inline w-3 h-3 text-amber-400" />}
                      {' '}{str(j.resultNote) || 'no note yet'}
                    </div>
                    {j.userId ? <div className="text-[10px] text-zinc-500">user {str(j.userId)}{j.withdrawId ? ` · withdrawal ${str(j.withdrawId)}` : ''}</div> : null}
                    {str(j.screenLog) ? (
                      <pre className="max-h-56 overflow-auto whitespace-pre-wrap break-words font-mono text-[9.5px] leading-relaxed text-zinc-300">{str(j.screenLog)}</pre>
                    ) : <div className="text-[10px] text-zinc-600">the phone has not sent its screen log yet</div>}
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        )}
        <p className="mt-3 flex items-center gap-1 text-[10px] text-zinc-600"><Link2 className="w-3 h-3" /> this screen refreshes every 5 s</p>
      </div>

      {/* ── phone check-ins ─────────────────────────────────────────────── */}
      <div className="rounded-2xl border border-zinc-800 bg-zinc-950/60 p-4">
        <div className="text-[11px] font-black uppercase tracking-wider text-zinc-400">Phone check-ins &amp; payout events</div>
        <p className="mt-1 text-[10.5px] leading-relaxed text-zinc-500">
          If the list below is empty, no phone has ever asked this server for a job — the app is not connected
          (wrong token, “Start queue” not pressed, or the phone has no internet).
          A red <b className="text-red-300">PAYOUT_AUTH_FAIL</b> line means the phone IS calling but its token is not recognised:
          press <b className="text-zinc-300">New token</b> above and paste it into the app.
        </p>
        {events.length === 0 ? (
          <div className="mt-2 rounded-xl border border-zinc-800 bg-zinc-900/50 px-3 py-2 text-[11px] text-zinc-500">nothing yet</div>
        ) : (
          <div className="mt-2 space-y-1">
            {events.map((e, i) => (
              <div key={`${e.at}-${i}`} className="flex items-start gap-2 rounded-lg border border-zinc-800 bg-zinc-900/40 px-2 py-1">
                <span className="w-24 shrink-0 text-[9.5px] font-mono text-zinc-500">{new Date(num(e.at)).toISOString().slice(11, 19)}</span>
                <span className={`shrink-0 rounded px-1 text-[9px] font-black ${e.action.includes('AUTH_FAIL') ? 'bg-red-500/15 text-red-300' : e.action === 'PAYOUT_PAID' ? 'bg-emerald-500/15 text-emerald-300' : 'bg-zinc-800 text-zinc-300'}`}>
                  {str(e.action).replace('PAYOUT_', '')}
                </span>
                <span className="min-w-0 break-words text-[10px] text-zinc-400">{str(e.detail)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
