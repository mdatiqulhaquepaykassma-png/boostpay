import { useCallback, useEffect, useState } from 'react';
import { Bot, RefreshCw, Send, Ban, CheckCheck, AlertTriangle, Smartphone, Link2, Loader2 } from 'lucide-react';
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
 * money out of the wallet but can never pay or refund a customer wrongly. A failed
 * job refunds the withdrawal automatically.
 */

// NOTE: adminAuthHeaders() already sets Content-Type — never add it twice.
// Wrapped: a broken session in storage must never take the whole console down.
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
  const [events, setEvents] = useState<EventRow[]>([]);
  const [phoneStatus, setPhoneStatus] = useState<{ online: number; dryRun: number; liveMode: number } | null>(null);
  const [, setTick] = useState(0);
  const [issuedToken, setIssuedToken] = useState<{ label: string; token: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [note, setNote] = useState('');
  const [open, setOpen] = useState<string>('');
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
      'but the money does leave the wallet. Leave the phone on "DRY RUN" if you only want to watch the menu walk.'
    )) return;
    void call('/api/admin/payouts/test', { ...form, amountBdt: amount }, 'Test payout queued — the phone will pick it up within a few seconds.');
  };

  const queueWithdraw = (p: Pending) => {
    if (!window.confirm(`Send $${num(p.amountUsd).toFixed(2)} (${num(p.amountBdt)} BDT) to ${str(p.number) || str((p as any).destination)} via the robot?\n\nThe withdrawal is refunded automatically if the phone fails.`)) return;
    void call('/api/admin/payouts/queue', { withdrawId: p.id }, `Withdrawal ${str(p.id)} queued for the robot.`);
  };

  const cancel = (j: Job) => {
    if (!window.confirm(`Cancel ${str(j.id)}? A queued withdrawal is refunded to the user.`)) return;
    void call(`/api/admin/payouts/${j.id}/cancel`, { reason: 'cancelled in the admin panel' }, `${str(j.id)} cancelled.`);
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
        {/* ── is the app connected right now? ───────────────────────────── */}
        {(() => {
          const online = devices.filter((d) => d.active !== false && d.payoutEnabled !== false
            && (d.online === true || (num(d.lastSeenAt) && Date.now() - num(d.lastSeenAt) < 90_000)));
          const live = online.filter((d) => d.queueDryRun !== true);
          const dry = online.filter((d) => d.queueDryRun === true);
          const tone = online.length === 0 ? 'border-red-500/40 bg-red-500/10 text-red-200'
            : live.length > 0 ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200'
              : 'border-amber-500/40 bg-amber-500/10 text-amber-200';
          return (
            <div className={`mt-3 rounded-xl border px-3 py-2 text-[11px] font-semibold ${tone}`}>
              {online.length === 0 ? (
                <>
                  <b>App NOT connected.</b> No phone is asking for jobs. Open the payout app → <b>4 · Server queue</b> →
                  check the server + token → <b>▶ Start queue</b>. The phone keeps a “Queue running” notification while it is connected.
                </>
              ) : (
                <>
                  <b>{online.length} phone connected</b>
                  {live.length > 0 ? ` · ${live.length} LIVE (real money)` : ''}
                  {dry.length > 0 ? ` · ${dry.length} in DRY RUN (test jobs only)` : ''}
                  {online.map((d) => ` · ${str(d.label)} app ${str(d.payoutAppVersion) || '?'} · seen ${num(d.secondsAgo) >= 0 ? `${num(d.secondsAgo)}s ago` : 'just now'}`).join('')}
                </>
              )}
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
          <span>on the phone: paste the server URL + device token, tick “Server queue”, then START.</span>
        </p>
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
            <li>1. On the payout phone open the app → <b className="text-zinc-200">4 · Server queue</b>.</li>
            <li>2. Paste this token into the token box (replace the old one) → <b className="text-zinc-200">Test</b>.</li>
            <li>3. <b className="text-zinc-200">▶ Start queue</b> — a notification must appear: “Queue running”.</li>
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
                <button
                  disabled={busy || p.queued || !p.number || p.amountBdt == null}
                  onClick={() => queueWithdraw(p)}
                  className="rounded-xl border border-cyan-500/40 bg-cyan-500/10 px-3 py-1.5 text-[10px] font-black text-cyan-300 disabled:opacity-40"
                >
                  {p.queued ? 'in queue' : 'Send via robot'}
                </button>
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

      {/* ── queue ───────────────────────────────────────────────────────── */}
      <div className="rounded-2xl border border-zinc-800 bg-zinc-950/60 p-4">
        <div className="text-[11px] font-black uppercase tracking-wider text-emerald-400">Queue</div>
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
                  </div>
                  <div className="flex items-center gap-2">
                    <button onClick={() => setOpen(open === j.id ? '' : j.id)} className="rounded-lg border border-zinc-700 px-2 py-1 text-[10px] font-bold text-zinc-300">
                      {open === j.id ? 'hide' : 'log'}
                    </button>
                    {['QUEUED', 'CLAIMED', 'FAILED'].includes(j.status) ? (
                      <button onClick={() => cancel(j)} className="rounded-lg border border-red-500/40 bg-red-500/10 px-2 py-1 text-[10px] font-black text-red-300">
                        <Ban className="inline w-3 h-3" /> cancel
                      </button>
                    ) : null}
                  </div>
                </div>
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
