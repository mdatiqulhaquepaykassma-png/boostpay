import { useEffect, useState } from 'react';
import { Send, Link2, Users } from 'lucide-react';
import { BoostPayStore } from '../services/store';

/**
 * Admin → Manage → "Send to refer only".
 *
 * Pins one user's outgoing P2P transfers to their own upline:
 *   OFF        → normal sending (no restriction)
 *   ONLY L1    → the direct referrer, nobody else
 *   L1 + TEAM  → the direct referrer and everyone under them, at any depth
 *
 * The amount is optional (0 = no cap) and applies per day, per transfer, or once
 * in total. The rule only gates SENDING money — receiving, boosting, withdrawals
 * and agent payments are untouched. The server enforces it in /api/transfer, so
 * it cannot be bypassed from the app; every change is audit-logged.
 */
export function ReferSendCard({
  userId,
  policy,
  usage,
  onChanged,
}: {
  userId: string;
  policy?: { mode: 'off' | 'l1' | 'team'; amount: number; period: 'day' | 'send' | 'total'; inherit?: boolean; allowUpline?: boolean; note?: string; setAt?: number };
  usage?: { period: string; cap: number; used: number; remaining: number | null; todayUsed: number; totalUsed: number; sendsToday: number } | null;
  onChanged?: (updatedUser?: any) => void;
}) {
  const [mode, setMode] = useState<'off' | 'l1' | 'team'>('off');
  const [team, setTeam] = useState(false);
  const [amount, setAmount] = useState('');
  const [period, setPeriod] = useState<'day' | 'send' | 'total'>('day');
  const [note, setNote] = useState('');
  const [inherit, setInherit] = useState(false);
  const [allowUpline, setAllowUpline] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [ok, setOk] = useState('');
  const [server, setServer] = useState<{ mode: string; amount: number; period: string; inherit?: boolean; allowUpline?: boolean; allowedRecipients?: number; uplineAllowed?: boolean; used?: number } | null>(null);
  const [liveUsage, setLiveUsage] = useState<any>(usage || null);

  const live = server || (policy ? { mode: policy.mode, amount: Number(policy.amount) || 0, period: policy.period } : null);
  const current = live?.mode || 'off';

  useEffect(() => {
    setMode(current === 'team' ? 'l1' : (current as any));
    setTeam(current === 'team');
    setAmount(live && live.amount > 0 ? String(live.amount) : '');
    setPeriod((live?.period as any) || 'day');
    setNote(policy?.note || '');
    setInherit(!!(policy as any)?.inherit);
    setAllowUpline((policy as any)?.allowUpline !== false);
    setError('');
    setOk('');
    setServer(null);
    setLiveUsage(usage || null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  // keep up with the parent's refreshed numbers while the sheet is open
  useEffect(() => { if (usage) setLiveUsage(usage); }, [JSON.stringify(usage || null)]);

  const post = async (payload: Record<string, any>, okText: string) => {
    setBusy(true); setError(''); setOk('');
    try {
      const res = await BoostPayStore.adminSetReferSend(userId, payload as any);
      if (!res.success) throw new Error(res.error || 'Could not save the rule.');
      const saved: any = (res as any).referSend || null;
      if ((res as any).referSendUsage) setLiveUsage((res as any).referSendUsage);
      if (saved) setServer({ mode: saved.mode, amount: Number(saved.amount) || 0, period: saved.period, inherit: !!saved.inherit, allowUpline: saved.allowUpline !== false, allowedRecipients: saved.allowedRecipients, uplineAllowed: saved.uplineAllowed, used: saved.used });
      setOk(
        saved
          ? `${okText} Server confirms: ${saved.mode === 'off' ? 'no restriction' : `${saved.mode === 'l1' ? 'direct refer only' : 'refer + team'} · ${saved.allowedRecipients ?? 0} allowed recipient(s)${saved.amount > 0 ? ` · cap $${Number(saved.amount).toFixed(2)} ${saved.period === 'day' ? 'per day' : saved.period === 'total' ? 'in total' : 'per transfer'}` : ' · no cap'}${saved.inherit ? ' · also applies to the receiver' : ''}`}.`
          : okText
      );
      onChanged?.((res as any).user);
    } catch (e: any) {
      setError(e?.message || 'Could not save the rule.');
    } finally { setBusy(false); }
  };

  const save = () => {
    if (mode === 'off') return post({ mode: 'off' }, `Restriction removed — User #${userId} can send normally again.`);
    const value = Number(amount);
    if (amount !== '' && (!Number.isFinite(value) || value < 0)) { setError('Enter a limit of 0 or more (0 = no cap).'); return; }
    const finalMode = team ? 'team' : 'l1';
    return post(
      { mode: finalMode, amount: Number.isFinite(value) ? value : 0, period, inherit, allowUpline, note },
      finalMode === 'l1'
        ? `User #${userId} can now send only to their direct referrer.`
        : `User #${userId} can now send only to their referrer and team members.`
    );
  };

  return (
    <div className="rounded-2xl border border-emerald-500/30 bg-zinc-950 p-4 space-y-3">
      <h4 className="text-xs font-bold text-white flex items-center gap-2">
        <Send className="w-4 h-4 text-emerald-400" /> Send to refer only
        <span className="text-[10px] font-normal text-zinc-500">(who this user may send money to)</span>
      </h4>

      <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-2.5 text-[11px] font-mono space-y-1">
        <div className="flex justify-between text-zinc-400">
          <span>Right now</span>
          <span className={current === 'off' ? 'text-zinc-300' : 'text-emerald-300 font-bold'}>
            {current === 'off' ? 'no restriction' : current === 'l1' ? 'direct refer only' : 'refer + team'}
          </span>
        </div>
        {current !== 'off' && (
          <div className="flex justify-between text-zinc-500">
            <span>Limit</span>
            <span className="text-zinc-200">
              {(live?.amount || 0) > 0
                ? `$${(live?.amount || 0).toFixed(2)} ${live?.period === 'day' ? 'per day' : live?.period === 'total' ? 'in total' : 'per transfer'}`
                : 'no amount cap'}
            </span>
          </div>
        )}
        {current !== 'off' && (
          <div className="flex justify-between text-zinc-500">
            <span>Upline (refer)</span>
            <span className={live?.allowUpline === false ? 'text-red-400' : 'text-emerald-300'}>
              {live?.allowUpline === false ? 'blocked' : 'allowed'}
            </span>
          </div>
        )}
        {current !== 'off' && (
          <div className="flex justify-between text-zinc-500">
            <span>Receiver</span>
            <span className={live?.inherit ? 'text-sky-300' : 'text-zinc-300'}>
              {live?.inherit ? 'same rule applies' : 'free to send anywhere'}
            </span>
          </div>
        )}
        {typeof live?.allowedRecipients === 'number' && (
          <div className="flex justify-between text-zinc-500"><span>Allowed recipients</span><span className="text-zinc-200">{live.allowedRecipients}</span></div>
        )}
      </div>

      {/* How much has already gone out, and how much is left */}
      {liveUsage && (
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-2.5 space-y-1">
          <div className="flex justify-between text-[11px] font-mono text-zinc-400">
            <span>Sent today</span>
            <span className="text-white font-bold">${Number(liveUsage.todayUsed || 0).toFixed(2)} <span className="text-zinc-500 font-normal">({liveUsage.sendsToday || 0} send{(liveUsage.sendsToday || 0) === 1 ? '' : 's'})</span></span>
          </div>
          <div className="flex justify-between text-[11px] font-mono text-zinc-400">
            <span>Sent in total</span>
            <span className="text-zinc-200">${Number(liveUsage.totalUsed || 0).toFixed(2)}</span>
          </div>
          {Number(liveUsage.cap) > 0 ? (
            <>
              <div className="flex justify-between text-[11px] font-mono text-zinc-400">
                <span>
                  Limit used ({liveUsage.period === 'day' ? 'per day' : liveUsage.period === 'total' ? 'in total' : 'per transfer'})
                </span>
                <span className="text-amber-300">${Number(liveUsage.used || 0).toFixed(2)} / ${Number(liveUsage.cap).toFixed(2)}</span>
              </div>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-zinc-800">
                <div
                  className={`h-full rounded-full ${Number(liveUsage.remaining) <= 0 ? 'bg-red-500' : 'bg-emerald-500'}`}
                  style={{ width: `${Math.min(100, Math.round((Number(liveUsage.used || 0) / Math.max(1, Number(liveUsage.cap))) * 100))}%` }}
                />
              </div>
              <div className="flex justify-between text-[11px] font-mono">
                <span className="text-zinc-500">Left to send</span>
                <span className={Number(liveUsage.remaining) > 0 ? 'text-emerald-300 font-bold' : 'text-red-400 font-bold'}>
                  ${Number(liveUsage.remaining || 0).toFixed(2)}
                </span>
              </div>
            </>
          ) : (
            <div className="flex justify-between text-[11px] font-mono text-zinc-500">
              <span>Amount limit</span><span className="text-zinc-300">none</span>
            </div>
          )}
        </div>
      )}

      <div className="grid grid-cols-3 gap-1.5">
        <button
          type="button"
          onClick={() => setMode('off')}
          className={`rounded-lg border px-2 py-2 text-[10px] font-bold transition cursor-pointer ${mode === 'off' ? 'bg-zinc-700 border-zinc-500 text-white' : 'bg-zinc-900 border-zinc-800 text-zinc-400 hover:border-zinc-600'}`}
        >Off</button>
        <button
          type="button"
          onClick={() => { setMode('l1'); setTeam(false); }}
          className={`rounded-lg border px-2 py-2 text-[10px] font-bold transition cursor-pointer flex items-center justify-center gap-1 ${mode === 'l1' && !team ? 'bg-emerald-500/20 border-emerald-500/50 text-emerald-300' : 'bg-zinc-900 border-zinc-800 text-zinc-400 hover:border-zinc-600'}`}
        ><Link2 className="w-3 h-3" /> L1 refer</button>
        <button
          type="button"
          onClick={() => { setMode('team'); setTeam(true); }}
          className={`rounded-lg border px-2 py-2 text-[10px] font-bold transition cursor-pointer flex items-center justify-center gap-1 ${team ? 'bg-emerald-500/20 border-emerald-500/50 text-emerald-300' : 'bg-zinc-900 border-zinc-800 text-zinc-400 hover:border-zinc-600'}`}
        ><Users className="w-3 h-3" /> + team</button>
      </div>

      {mode !== 'off' && (
        <>
          <label className="flex items-start gap-2 text-[11px] text-zinc-300 cursor-pointer">
            <input
              type="checkbox"
              checked={team}
              onChange={(e) => setTeam(e.target.checked)}
              className="mt-0.5 accent-emerald-500"
            />
            <span>
              Also allow <b>team members under them</b>
              <span className="block text-[10px] text-zinc-500">
                Unticked = the tick means <b>only the L1 (direct) refer</b> can receive money.
              </span>
            </span>
          </label>

          <label className="flex items-start gap-2 text-[11px] text-zinc-300 cursor-pointer">
            <input
              type="checkbox"
              checked={allowUpline}
              onChange={(e) => setAllowUpline(e.target.checked)}
              className="mt-0.5 accent-emerald-500"
            />
            <span>
              Allow sending <b>to the upline (refer)</b>
              <span className="block text-[10px] text-zinc-500">
                Unticked = the user can <b>never</b> send money up to the person who referred them (their team may stay open).
              </span>
            </span>
          </label>

          <label className="flex items-start gap-2 text-[11px] text-zinc-300 cursor-pointer rounded-lg border border-sky-500/25 bg-sky-500/[0.05] p-2">
            <input
              type="checkbox"
              checked={inherit}
              onChange={(e) => setInherit(e.target.checked)}
              className="mt-0.5 accent-sky-500"
            />
            <span>
              Also apply to whoever receives the money
              <span className="block text-[10px] text-zinc-500">
                Off = the receiver can send to anyone. On = the receiver gets the same rule, and it keeps following the
                money if they pass it on. An admin rule set on a receiver is never overwritten.
              </span>
            </span>
          </label>

          <div className="grid grid-cols-2 gap-2">
            <label className="block text-[10px] uppercase tracking-wider text-zinc-500">
              Limit amount ($)
              <input
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ''))}
                placeholder="10.00 (blank = no cap)"
                className="mt-1 w-full rounded-lg bg-zinc-900 border border-zinc-800 px-2 py-1.5 text-xs text-white font-mono"
              />
            </label>
            <label className="block text-[10px] uppercase tracking-wider text-zinc-500">
              Applies
              <select
                value={period}
                onChange={(e) => setPeriod(e.target.value as any)}
                className="mt-1 w-full rounded-lg bg-zinc-900 border border-zinc-800 px-2 py-1.5 text-xs text-white"
              >
                <option value="day">Per day</option>
                <option value="send">Per transfer</option>
                <option value="total">Once in total</option>
              </select>
            </label>
          </div>

          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Reason / note (optional)"
            className="w-full rounded-lg bg-zinc-900 border border-zinc-800 px-2 py-1.5 text-xs text-white"
          />
        </>
      )}

      <button
        type="button"
        onClick={save}
        disabled={busy}
        className="w-full rounded-xl bg-emerald-500/20 border border-emerald-500/40 py-2 text-xs font-bold text-emerald-300 hover:bg-emerald-500/30 transition cursor-pointer disabled:opacity-50"
      >
        {busy ? 'Saving…' : mode === 'off' ? 'Remove restriction' : 'Save send rule'}
      </button>

      {error && <p className="text-[11px] text-red-400">{error}</p>}
      {ok && <p className="text-[11px] text-emerald-400">{ok}</p>}
      <p className="text-[10px] leading-relaxed text-zinc-500">
        Only outgoing P2P transfers are limited. Receiving, boosting, withdrawals and agent payments keep working. The server refuses any transfer outside this rule, and every change is audit-logged.
      </p>
    </div>
  );
}
