import { useEffect, useState } from 'react';
import { Lock, Unlock, ShieldAlert } from 'lucide-react';
import { BoostPayStore } from '../services/store';

/**
 * Admin → Manage → temporary money lock.
 * One card serves both independent holds:
 *   kind="send"  → "Sent Money Lock"   gates outgoing P2P transfers (/api/transfer)
 *   kind="agent" → "Pay an Agent Lock" gates outgoing agent payments (/api/user/send-to-agent)
 * Each hold:
 *   · Full lock   → that channel is closed completely
 *   · Amount lock → only the held amount is blocked, the rest still goes through
 * Allowed per channel = balance − held. The server enforces it, so the hold
 * cannot be bypassed from the app. Receiving / boosting / admin credit is never blocked.
 */
type LockMode = 'off' | 'amount' | 'full';

export function SendLockCard({
  userId,
  balance,
  lock,
  sendable,
  kind = 'send',
  onChanged,
}: {
  userId: string;
  balance: number;
  lock?: { mode: LockMode; amount: number; note?: string; setAt?: number };
  sendable?: number;
  kind?: 'send' | 'agent';
  onChanged?: () => void;
}) {
  const isAgent = kind === 'agent';
  const title = isAgent ? 'Pay an Agent Lock' : 'Sent Money Lock';
  const channel = isAgent ? 'pay an agent' : 'send money';
  const Channel = isAgent ? 'Agent payments' : 'Sending';
  const [mode, setMode] = useState<'amount' | 'full'>('amount');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [ok, setOk] = useState('');

  const current: LockMode = (lock && lock.mode) || 'off';
  const held = current === 'off' ? 0 : Number(lock?.amount || 0);
  const canSend = typeof sendable === 'number' ? sendable : Math.max(0, (Number(balance) || 0) - held);

  useEffect(() => {
    setAmount('');
    setNote('');
    setError('');
    setOk('');
    setMode('amount');
  }, [userId, kind]);

  const post = async (payload: Record<string, any>, okText: string) => {
    setBusy(true);
    setError('');
    setOk('');
    try {
      const res = isAgent
        ? await BoostPayStore.adminSetAgentLock(userId, payload as any)
        : await BoostPayStore.adminSetSendLock(userId, payload as any);
      if (!res.success) throw new Error(res.error || 'Could not save the lock.');
      setOk(okText);
      setAmount('');
      setNote('');
      onChanged?.();
    } catch (e: any) {
      setError(e?.message || 'Could not save the lock.');
    } finally {
      setBusy(false);
    }
  };

  const applyLock = () => {
    if (mode === 'full') return post({ mode: 'full', note }, `Full lock applied — User #${userId} cannot ${channel}.`);
    const value = Number(amount);
    if (!(value > 0)) {
      setError('Enter a lock amount greater than 0.');
      return;
    }
    if (value > (Number(balance) || 0)) {
      setError(`Lock amount cannot exceed the balance ($${(Number(balance) || 0).toFixed(2)}).`);
      return;
    }
    return post({ mode: 'amount', amount: value, note }, `$${value.toFixed(2)} held — the rest can still go out (${channel}).`);
  };

  return (
    <div className="rounded-2xl border border-orange-500/30 bg-zinc-950 p-4 space-y-3">
      <h4 className="text-xs font-bold text-white flex items-center gap-2">
        <Lock className="w-4 h-4 text-orange-400" /> {title}
        <span className="text-[10px] font-normal text-zinc-500">(temporary hold)</span>
      </h4>

      <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-2.5 text-[11px] font-mono space-y-1">
        <div className="flex justify-between text-zinc-400">
          <span>Balance</span>
          <span className="text-white font-bold">${(Number(balance) || 0).toFixed(2)}</span>
        </div>
        <div className="flex justify-between text-zinc-400">
          <span>{Channel} held</span>
          <span className={held > 0 ? 'text-orange-400 font-bold' : 'text-zinc-500'}>${held.toFixed(2)}</span>
        </div>
        <div className="flex justify-between text-zinc-400">
          <span>Can still {isAgent ? 'pay an agent' : 'send'}</span>
          <span className={canSend > 0 ? 'text-emerald-400 font-bold' : 'text-red-400 font-bold'}>${canSend.toFixed(2)}</span>
        </div>
        {current !== 'off' && (
          <div className="flex justify-between text-zinc-500">
            <span>Status</span>
            <span className="text-orange-300 font-bold">
              {current === 'full' ? `FULL — cannot ${channel}` : 'Partial hold'}
            </span>
          </div>
        )}
        {current !== 'off' && lock?.note ? (
          <div className="text-[10px] text-zinc-500 break-words">Note: {lock.note}</div>
        ) : null}
      </div>

      <div className="grid grid-cols-2 gap-2">
        {(['amount', 'full'] as const).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => setMode(m)}
            className={`rounded-xl border py-2 text-[11px] font-bold transition cursor-pointer ${
              mode === m
                ? 'border-orange-500/60 bg-orange-500/20 text-orange-300'
                : 'border-zinc-800 bg-zinc-900 text-zinc-400 hover:border-zinc-700'
            }`}
          >
            {m === 'amount' ? 'Hold an amount' : 'Full lock'}
          </button>
        ))}
      </div>

      {mode === 'amount' && (
        <div>
          <label className="block text-[10px] font-mono text-zinc-500 mb-1">Amount to hold ($)</label>
          <input
            type="number"
            step="0.01"
            min="0"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="e.g. 25.00"
            className="w-full rounded-xl border border-zinc-800 bg-zinc-900 px-3 py-2 text-xs text-zinc-100 font-mono focus:border-orange-500 focus:outline-none"
          />
          <p className="mt-1 text-[10px] text-zinc-500">
            Only this amount is blocked — the remaining ${Math.max(0, (Number(balance) || 0) - (Number(amount) || 0)).toFixed(2)} can still be used to {channel}.
          </p>
        </div>
      )}

      <div>
        <label className="block text-[10px] font-mono text-zinc-500 mb-1">Reason (optional, admin only)</label>
        <input
          type="text"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="e.g. suspicious activity under review"
          className="w-full rounded-xl border border-zinc-800 bg-zinc-900 px-3 py-2 text-xs text-zinc-100 focus:border-orange-500 focus:outline-none"
        />
      </div>

      {ok && <div className="rounded-xl border border-emerald-500/40 bg-emerald-500/10 p-2.5 text-[11px] font-bold text-emerald-400">{ok}</div>}
      {error && <div className="rounded-xl border border-red-500/40 bg-red-500/10 p-2.5 text-[11px] font-bold text-red-400">{error}</div>}

      <div className="flex gap-2">
        <button
          onClick={applyLock}
          disabled={busy}
          className="flex-1 rounded-xl bg-orange-500/20 border border-orange-500/40 py-2 text-xs font-bold text-orange-300 hover:bg-orange-500/30 transition cursor-pointer disabled:opacity-50"
        >
          {busy ? 'Saving…' : mode === 'full' ? `Lock all ${isAgent ? 'agent payments' : 'sending'}` : 'Apply hold'}
        </button>
        {current !== 'off' && (
          <button
            onClick={() => post({ mode: 'off' }, `Lock released — the user can ${channel} normally again.`)}
            disabled={busy}
            className="rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-xs font-bold text-emerald-400 hover:bg-emerald-500/20 transition cursor-pointer disabled:opacity-50 inline-flex items-center gap-1.5"
          >
            <Unlock className="w-3.5 h-3.5" /> Release
          </button>
        )}
      </div>

      <p className="text-[10px] leading-relaxed text-zinc-500 flex items-start gap-1.5">
        <ShieldAlert className="w-3 h-3 mt-0.5 shrink-0 text-zinc-600" />
        {isAgent
          ? 'Blocks money going to agents only — P2P sends stay available unless the Sent Money Lock is also on. Receiving, boosting and admin adjustments keep working. The user sees the held amount, not this note. No MFA prompt needed.'
          : 'Blocks outgoing P2P sends only. Pay an Agent is controlled by its own card. Receiving, boosting and admin adjustments keep working. The user sees the held amount, not this note. No MFA prompt needed.'}
      </p>
    </div>
  );
}

export default SendLockCard;
