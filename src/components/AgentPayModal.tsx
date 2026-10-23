import { FC, useCallback, useEffect, useMemo, useState } from 'react';
import { Store, X, CheckCircle2, AlertTriangle, ArrowRight, Copy } from 'lucide-react';
import { BoostPayStore } from '../services/store';
import { User } from '../types';

interface AgentOption { id: string; name: string; balance: number }
interface AgentListResponse {
  success: boolean; enabled: boolean; feePercent: number;
  minUserSend: number; maxUserSend: number; agents: AgentOption[];
}

interface Props {
  isOpen: boolean;
  onClose: () => void;
  currentUser: User;
  onSuccess: (updatedUser: User) => void;
}

/**
 * "Pay an Agent" — the user pays an agent from the wallet.
 * The fee is charged to the user on top of the amount (owner decision):
 *   user balance -= amount + fee,  agent receives the full amount.
 */
export const AgentPayModal: FC<Props> = ({ isOpen, onClose, currentUser, onSuccess }) => {
  const [data, setData] = useState<AgentListResponse | null>(null);
  const [agentId, setAgentId] = useState('');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [receipt, setReceipt] = useState<{ amount: number; fee: number; total: number; agentId: string; txId: string } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/agents', { headers: BoostPayStore.authHeaders() });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || 'Could not load agents.');
      setData(json);
      if (json.agents?.length === 1) setAgentId(json.agents[0].id);
    } catch (err: any) {
      setError(err?.message || 'Could not load agents.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    setAmount(''); setNote(''); setError(''); setReceipt(null); setAgentId('');
    void load();
  }, [isOpen, load]);

  const feePercent = Number(data?.feePercent || 0);
  const numAmount = Number(amount || 0);
  const fee = useMemo(() => Math.round(numAmount * feePercent) / 100, [numAmount, feePercent]);
  const total = useMemo(() => Math.round((numAmount + fee) * 100) / 100, [numAmount, fee]);
  const selectedAgent = data?.agents.find((a) => a.id === agentId) || null;

  if (!isOpen) return null;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!agentId) { setError('Choose an agent.'); return; }
    if (!/^\d+(\.\d{1,2})?$/.test(amount.trim())) { setError('Enter an amount with at most 2 decimals.'); return; }
    if (data && numAmount < data.minUserSend) { setError(`Minimum payment is ${data.minUserSend}.`); return; }
    if (data && numAmount > data.maxUserSend) { setError(`Maximum payment is ${data.maxUserSend}.`); return; }
    if (total > Number(currentUser.balance || 0)) { setError(`Insufficient balance. You need ${total.toFixed(2)} (amount + fee).`); return; }
    setBusy(true);
    try {
      const res = await fetch('/api/user/send-to-agent', {
        method: 'POST',
        headers: BoostPayStore.authHeaders(),
        body: JSON.stringify({ agentId, amount: amount.trim(), note: note.trim(), idempotencyKey: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}` })
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) throw new Error(json?.error || 'Payment failed.');
      const updated: User = { ...currentUser, balance: Number(json.balance ?? currentUser.balance) };
      BoostPayStore.setCurrentUser(updated);
      onSuccess(updated);
      setReceipt({ amount: json.amount, fee: json.fee, total: json.total, agentId: json.agentId, txId: json.transaction?.id || '' });
    } catch (err: any) {
      setError(err?.message || 'Payment failed.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[130] flex items-end sm:items-center justify-center bg-black/75 backdrop-blur-sm p-0 sm:p-4" onClick={onClose}>
      <div
        className="w-full max-w-md rounded-t-3xl sm:rounded-3xl border border-zinc-800 bg-zinc-900 shadow-2xl max-h-[92vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 flex items-center justify-between border-b border-zinc-800 bg-zinc-900/95 px-4 py-3 backdrop-blur">
          <div className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-emerald-500/15"><Store className="w-4 h-4 text-emerald-400" /></span>
            <div>
              <div className="text-sm font-black text-white">Pay an Agent</div>
              <div className="text-[9px] font-medium text-zinc-500">Cash in / cash out with a BoostPay agent</div>
            </div>
          </div>
          <button onClick={onClose} className="rounded-xl border border-zinc-800 bg-zinc-950 p-2 text-zinc-400 hover:text-white cursor-pointer"><X className="w-4 h-4" /></button>
        </div>

        {receipt ? (
          <div className="p-5 text-center">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-emerald-500/15"><CheckCircle2 className="w-7 h-7 text-emerald-400" /></div>
            <div className="mt-3 text-base font-black text-white">Payment sent</div>
            <div className="mt-1 text-2xl font-black text-emerald-300">${receipt.amount.toFixed(2)}</div>
            <div className="mt-1 text-[11px] text-zinc-400">to agent {receipt.agentId}</div>
            <div className="mt-4 space-y-1.5 rounded-2xl bg-zinc-950/70 p-3 text-left text-[11px]">
              <div className="flex justify-between"><span className="text-zinc-500">Amount</span><span className="font-semibold text-white">${receipt.amount.toFixed(2)}</span></div>
              <div className="flex justify-between"><span className="text-zinc-500">Fee ({feePercent}%)</span><span className="font-semibold text-amber-300">${receipt.fee.toFixed(2)}</span></div>
              <div className="flex justify-between border-t border-zinc-800 pt-1.5"><span className="text-zinc-400">Total debited</span><span className="font-black text-white">${receipt.total.toFixed(2)}</span></div>
              <div className="flex justify-between"><span className="text-zinc-500">Reference</span><span className="font-mono text-zinc-300">{receipt.txId}</span></div>
              <div className="flex justify-between"><span className="text-zinc-500">Balance</span><span className="font-bold text-white">${Number(currentUser.balance || 0).toFixed(2)}</span></div>
            </div>
            <button onClick={onClose} className="mt-4 h-11 w-full rounded-2xl bg-amber-500 text-xs font-black text-zinc-950 cursor-pointer">Done</button>
          </div>
        ) : (
          <form onSubmit={submit} className="p-4 space-y-3">
            {loading ? (
              <p className="py-6 text-center text-[11px] text-zinc-500">Loading agents…</p>
            ) : !data?.enabled ? (
              <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 px-3 py-3 text-[11px] font-semibold text-amber-200">
                Agent payments are currently disabled by the administrator.
              </div>
            ) : data.agents.length === 0 ? (
              <div className="rounded-2xl border border-zinc-800 bg-zinc-950 px-3 py-3 text-[11px] text-zinc-400">
                No agents are available right now. Please try again later.
              </div>
            ) : (
              <>
                <div>
                  <span className="mb-1.5 block text-[10px] font-bold uppercase tracking-wider text-zinc-400">Choose agent</span>
                  <div className="space-y-1.5 max-h-44 overflow-y-auto overscroll-contain">
                    {data.agents.map((a) => (
                      <button
                        type="button"
                        key={a.id}
                        onClick={() => setAgentId(a.id)}
                        className={`w-full flex items-center gap-2.5 rounded-2xl border px-3 py-2.5 text-left transition cursor-pointer ${agentId === a.id ? 'border-emerald-500/60 bg-emerald-500/10' : 'border-zinc-800 bg-zinc-950 hover:border-zinc-700'}`}
                      >
                        <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-zinc-800 font-mono text-[10px] font-bold text-zinc-300">{(a.name || a.id).slice(0, 1).toUpperCase()}</span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[12px] font-bold text-white">{a.name || a.id}</span>
                          <span className="block font-mono text-[9px] text-zinc-500">{a.id}</span>
                        </span>
                        {agentId === a.id ? <CheckCircle2 className="w-4 h-4 text-emerald-400" /> : <ArrowRight className="w-4 h-4 text-zinc-600" />}
                      </button>
                    ))}
                  </div>
                </div>

                <label className="block">
                  <span className="mb-1.5 block text-[10px] font-bold uppercase tracking-wider text-zinc-400">Amount (USD)</span>
                  <input
                    inputMode="decimal"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    placeholder="0.00"
                    className="w-full rounded-2xl border border-zinc-800 bg-zinc-950 px-4 py-3 text-sm text-white placeholder-zinc-600 outline-none focus:border-amber-500/60"
                  />
                </label>

                <label className="block">
                  <span className="mb-1.5 block text-[10px] font-bold uppercase tracking-wider text-zinc-400">Note (optional)</span>
                  <input
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    placeholder="Cash deposit, cash out…"
                    className="w-full rounded-2xl border border-zinc-800 bg-zinc-950 px-4 py-3 text-sm text-white placeholder-zinc-600 outline-none focus:border-amber-500/60"
                  />
                </label>

                <div className="rounded-2xl border border-zinc-800 bg-zinc-950/70 p-3 text-[11px]">
                  <div className="flex justify-between py-0.5"><span className="text-zinc-500">Amount</span><span className="font-semibold text-white">${numAmount.toFixed(2)}</span></div>
                  <div className="flex justify-between py-0.5"><span className="text-zinc-500">Agent fee ({feePercent}%)</span><span className="font-semibold text-amber-300">+${fee.toFixed(2)}</span></div>
                  <div className="mt-1 flex justify-between border-t border-zinc-800 pt-1.5"><span className="text-zinc-400">Total you pay</span><span className="font-black text-white">${total.toFixed(2)}</span></div>
                  <div className="flex justify-between"><span className="text-zinc-500">Balance after</span><span className="font-semibold text-zinc-300">${(Number(currentUser.balance || 0) - total).toFixed(2)}</span></div>
                </div>

                {selectedAgent ? (
                  <div className="flex items-start gap-2 rounded-2xl border border-zinc-800 bg-zinc-950/60 px-3 py-2 text-[10px] text-zinc-400">
                    <AlertTriangle className="mt-0.5 w-3.5 h-3.5 shrink-0 text-amber-400" />
                    <span>Agent receives the full ${numAmount.toFixed(2)}. The ${fee.toFixed(2)} fee is charged to you. Ask the agent for the cash handover before confirming.</span>
                  </div>
                ) : null}

                {error ? <div className="rounded-2xl border border-red-500/40 bg-red-500/10 px-3 py-2 text-[11px] font-semibold text-red-200">{error}</div> : null}

                <button
                  type="submit"
                  disabled={busy || !agentId || !amount}
                  className="h-12 w-full rounded-2xl bg-amber-500 text-xs font-black text-zinc-950 transition hover:bg-amber-400 disabled:opacity-50 cursor-pointer"
                >
                  {busy ? 'Processing…' : `Pay $${total.toFixed(2)} to agent`}
                </button>
              </>
            )}
          </form>
        )}
      </div>
    </div>
  );
};
