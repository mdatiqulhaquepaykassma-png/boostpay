import { FC, useCallback, useEffect, useMemo, useState } from 'react';
import { Store, X, CheckCircle2, AlertTriangle, ChevronDown, Search, UserRound, MessageSquare, KeyRound, Copy, Clock, Undo2 } from 'lucide-react';
import { AgentMessageSheet } from './AgentMessageSheet';
import { BoostPayStore } from '../services/store';
import { User } from '../types';

interface AgentOption { id: string; name: string }
interface AgentListResponse {
  success: boolean; enabled: boolean; feePercent: number;
  minUserSend: number; maxUserSend: number; agents: AgentOption[];
}

const claimClock = (msLeft: number) => {
  const t = Math.max(0, Math.floor(msLeft / 1000));
  return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
};

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
  const [agentSearch, setAgentSearch] = useState('');
  const [pickerOpen, setPickerOpen] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [receipt, setReceipt] = useState<{ amount: number; fee: number; total: number; agentId: string; txId: string; claimCode: string; payoutId: string; expiresAt: number; cancelled?: boolean } | null>(null);
  const [pending, setPending] = useState<Array<{ id: string; agentId: string; amount: number; fee: number; total: number; claimCode: string; expiresAt: number }>>([]);
  const [nowTs, setNowTs] = useState(Date.now());
  const [notice, setNotice] = useState('');
  const [cancellingId, setCancellingId] = useState('');

  const [unreadByAgent, setUnreadByAgent] = useState<Record<string, number>>({});

  const loadInbox = useCallback(async () => {
    try {
      const res = await fetch('/api/user/agent-inbox', { headers: BoostPayStore.authHeaders() });
      if (!res.ok) return;
      const json = await res.json();
      const map: Record<string, number> = {};
      for (const t of json.threads || []) if (t.unread > 0) map[t.agentId] = t.unread;
      setUnreadByAgent(map);
    } catch { /* ignore */ }
  }, []);

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
    const iv = window.setInterval(() => setNowTs(Date.now()), 1000);
    return () => window.clearInterval(iv);
  }, [isOpen]);

  const loadPending = useCallback(async () => {
    try {
      const res = await fetch('/api/user/agent-payouts', { headers: BoostPayStore.authHeaders() });
      if (!res.ok) return;
      const json = await res.json();
      setPending(Array.isArray(json.payouts) ? json.payouts : []);
    } catch { /* ignore */ }
  }, []);

  const cancelPayout = useCallback(async (id: string) => {
    setCancellingId(id); setNotice('');
    try {
      const res = await fetch(`/api/user/agent-payouts/${encodeURIComponent(id)}/cancel`, {
        method: 'POST', headers: BoostPayStore.authHeaders(), body: '{}'
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) throw new Error(json?.error || 'Could not cancel.');
      const updated: User = { ...currentUser, balance: Number(json.balance ?? currentUser.balance) };
      BoostPayStore.setCurrentUser(updated);
      onSuccess(updated);
      setNotice(`Cancelled — $${Number(json.refunded || 0).toFixed(2)} refunded to your wallet.`);
      setReceipt((r) => (r && r.payoutId === id ? { ...r, cancelled: true } : r));
      await loadPending();
    } catch (err: any) {
      setNotice(err?.message || 'Could not cancel.');
    } finally { setCancellingId(''); }
  }, [currentUser, onSuccess, loadPending]);

  useEffect(() => {
    if (!isOpen) return;
    setAmount(''); setNote(''); setError(''); setReceipt(null); setAgentId(''); setNotice('');
    setAgentSearch(''); setPickerOpen(false); setChatOpen(false);
    void load();
    void loadInbox();
    void loadPending();
  }, [isOpen, load, loadInbox, loadPending]);

  const feePercent = Number(data?.feePercent || 0);
  const numAmount = Number(amount || 0);
  const fee = useMemo(() => Math.round(numAmount * feePercent) / 100, [numAmount, feePercent]);
  const total = useMemo(() => Math.round((numAmount + fee) * 100) / 100, [numAmount, fee]);
  const selectedAgent = data?.agents.find((a) => a.id === agentId) || null;
  const query = agentSearch.trim().toLowerCase();
  const filteredAgents = useMemo(() => {
    const list = data?.agents || [];
    if (!query) return list;
    return list.filter((a) => `${a.id} ${a.name || ''}`.toLowerCase().includes(query));
  }, [data, query]);

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
      setReceipt({
        amount: json.amount, fee: json.fee, total: json.total, agentId: json.agentId,
        txId: json.transaction?.id || '', claimCode: json.claimCode || '', payoutId: json.payoutId || '',
        expiresAt: Number(json.expiresAt || 0)
      });
      setNowTs(Date.now());
      void loadPending();
    } catch (err: any) {
      setError(err?.message || 'Payment failed.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
    <AgentMessageSheet
      isOpen={chatOpen}
      agentId={chatOpen ? (receipt?.agentId || agentId) : ''}
      agentName={selectedAgent?.name}
      onClose={() => { setChatOpen(false); void loadInbox(); }}
    />
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
          <div className="p-5">
            {receipt.cancelled ? (
              <div className="text-center">
                <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-amber-500/15"><Undo2 className="w-7 h-7 text-amber-400" /></div>
                <div className="mt-3 text-base font-black text-white">Payment cancelled</div>
                <p className="mt-1 text-[11px] text-zinc-400">The held amount + fee went back to your wallet.</p>
                <div className="mt-4 rounded-2xl bg-zinc-950/70 p-3 text-left text-[11px]">
                  <div className="flex justify-between"><span className="text-zinc-500">Refunded</span><span className="font-black text-emerald-300">${receipt.total.toFixed(2)}</span></div>
                  <div className="flex justify-between"><span className="text-zinc-500">Balance</span><span className="font-bold text-white">${Number(currentUser.balance || 0).toFixed(2)}</span></div>
                </div>
                <button onClick={onClose} className="mt-4 h-11 w-full rounded-2xl bg-amber-500 text-xs font-black text-zinc-950 cursor-pointer">Done</button>
              </div>
            ) : (
              <>
                <div className="text-center">
                  <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-emerald-500/15"><CheckCircle2 className="w-7 h-7 text-emerald-400" /></div>
                  <div className="mt-3 text-base font-black text-white">Show this code to the agent</div>
                  <div className="mt-1 text-[11px] text-zinc-400">Agent {receipt.agentId} enters it to receive ${receipt.amount.toFixed(2)}</div>
                </div>

                <div className="mt-4 rounded-3xl border border-emerald-500/40 bg-emerald-500/10 px-4 py-4 text-center">
                  <div className="flex items-center justify-center gap-1.5 text-[9px] font-bold uppercase tracking-[0.2em] text-emerald-300/80"><KeyRound className="h-3 w-3" /> Claim code</div>
                  <div className="mt-1 flex items-center justify-center gap-2">
                    <span className="font-mono text-4xl font-black tracking-[0.35em] text-white">{receipt.claimCode || '----'}</span>
                    <button
                      type="button"
                      onClick={() => { void navigator.clipboard?.writeText(receipt.claimCode).catch(() => undefined); }}
                      className="rounded-xl border border-emerald-500/40 bg-emerald-500/10 p-2 text-emerald-300 cursor-pointer"
                      aria-label="Copy claim code"
                    ><Copy className="h-3.5 w-3.5" /></button>
                  </div>
                  {receipt.expiresAt ? (
                    <div className="mt-2 flex items-center justify-center gap-1.5 text-[11px] font-bold text-amber-300">
                      <Clock className="h-3.5 w-3.5" />
                      Expires in <span className="font-mono">{claimClock(receipt.expiresAt - nowTs)}</span>
                    </div>
                  ) : null}
                  <p className="mt-1 text-[9.5px] leading-relaxed text-zinc-400">
                    The money is on hold. If the agent never enters this code before it expires, the full amount is refunded to your wallet automatically.
                  </p>
                </div>

                <div className="mt-3 space-y-1.5 rounded-2xl bg-zinc-950/70 p-3 text-[11px]">
                  <div className="flex justify-between"><span className="text-zinc-500">Amount</span><span className="font-semibold text-white">${receipt.amount.toFixed(2)}</span></div>
                  <div className="flex justify-between"><span className="text-zinc-500">Fee ({feePercent}%)</span><span className="font-semibold text-amber-300">${receipt.fee.toFixed(2)}</span></div>
                  <div className="flex justify-between border-t border-zinc-800 pt-1.5"><span className="text-zinc-400">Total debited</span><span className="font-black text-white">${receipt.total.toFixed(2)}</span></div>
                  <div className="flex justify-between"><span className="text-zinc-500">Reference</span><span className="font-mono text-zinc-300">{receipt.txId}</span></div>
                  <div className="flex justify-between"><span className="text-zinc-500">Balance</span><span className="font-bold text-white">${Number(currentUser.balance || 0).toFixed(2)}</span></div>
                </div>

                {notice ? <div className="mt-3 rounded-2xl border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-[11px] font-semibold text-emerald-200">{notice}</div> : null}

                {receipt.payoutId && receipt.expiresAt && receipt.expiresAt > nowTs ? (
                  <button
                    type="button"
                    onClick={() => void cancelPayout(receipt.payoutId)}
                    disabled={cancellingId === receipt.payoutId}
                    className="mt-3 flex h-11 w-full items-center justify-center gap-2 rounded-2xl border border-red-500/40 bg-red-500/10 text-[11px] font-bold text-red-200 disabled:opacity-60 cursor-pointer"
                  >
                    <Undo2 className="h-3.5 w-3.5" /> {cancellingId === receipt.payoutId ? 'Cancelling…' : 'Cancel & get a full refund'}
                  </button>
                ) : null}

                <button onClick={onClose} className="mt-2 h-11 w-full rounded-2xl bg-amber-500 text-xs font-black text-zinc-950 cursor-pointer">Done</button>
                <button
                  onClick={() => setChatOpen(true)}
                  className="mt-2 flex h-11 w-full items-center justify-center gap-2 rounded-2xl border border-zinc-800 bg-zinc-950 text-[11px] font-bold text-zinc-300 transition hover:border-emerald-500/40 hover:text-emerald-300 cursor-pointer"
                >
                  <MessageSquare className="h-3.5 w-3.5" /> Message agent {receipt.agentId}
                </button>
              </>
            )}
          </div>
        ) : (
          <form onSubmit={submit} className="p-4 space-y-3">
            {pending.length > 0 ? (
              <div className="rounded-2xl border border-amber-500/30 bg-amber-500/5 p-3">
                <div className="mb-2 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-amber-300">
                  <Clock className="h-3 w-3" /> Waiting for an agent ({pending.length})
                </div>
                <div className="space-y-2">
                  {pending.map((p) => (
                    <div key={p.id} className="rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2">
                      <div className="flex items-center justify-between gap-2">
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5">
                            <span className="font-mono text-base font-black tracking-[0.2em] text-white">{p.claimCode}</span>
                            <span className="rounded-full bg-amber-500/15 px-1.5 py-0.5 font-mono text-[8.5px] font-bold text-amber-300">{claimClock(p.expiresAt - nowTs)}</span>
                          </div>
                          <div className="mt-0.5 truncate text-[9.5px] text-zinc-500">Agent {p.agentId} · ${Number(p.amount).toFixed(2)} · total ${Number(p.total).toFixed(2)}</div>
                        </div>
                        <button
                          type="button"
                          onClick={() => void cancelPayout(p.id)}
                          disabled={cancellingId === p.id}
                          className="shrink-0 rounded-xl border border-red-500/40 bg-red-500/10 px-2.5 py-1.5 text-[9.5px] font-bold text-red-200 disabled:opacity-60 cursor-pointer"
                        >{cancellingId === p.id ? '…' : 'Cancel'}</button>
                      </div>
                    </div>
                  ))}
                </div>
                <p className="mt-1.5 text-[9px] leading-relaxed text-zinc-500">Nothing is credited to the agent until the code is entered. Expired payments refund automatically.</p>
              </div>
            ) : null}
            {notice ? <div className="rounded-2xl border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-[11px] font-semibold text-emerald-200">{notice}</div> : null}
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
                <div className="relative">
                  <span className="mb-1.5 flex items-center justify-between text-[10px] font-bold uppercase tracking-wider text-zinc-400">
                    <span>Choose agent</span>
                    <span className="font-mono text-[9px] normal-case text-zinc-600">{data.agents.length} available</span>
                  </span>

                  {/* dropdown trigger — shows the chosen agent */}
                  <button
                    type="button"
                    onClick={() => setPickerOpen((v) => !v)}
                    className={`flex w-full items-center gap-2.5 rounded-2xl border px-3 py-2.5 text-left transition cursor-pointer ${pickerOpen ? 'border-emerald-500/60 bg-emerald-500/10' : agentId ? 'border-zinc-700 bg-zinc-950' : 'border-zinc-800 bg-zinc-950 hover:border-zinc-700'}`}
                  >
                    <span className={`flex h-8 w-8 items-center justify-center rounded-xl ${agentId ? 'bg-emerald-500/15 text-emerald-300' : 'bg-zinc-800 text-zinc-400'}`}>
                      {selectedAgent ? (
                        <span className="text-[11px] font-black">{(selectedAgent.name || selectedAgent.id).slice(0, 1).toUpperCase()}</span>
                      ) : (
                        <UserRound className="h-4 w-4" />
                      )}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className={`block truncate text-[12px] font-bold ${selectedAgent ? 'text-white' : 'text-zinc-500'}`}>
                        {selectedAgent ? selectedAgent.name || selectedAgent.id : 'Select an agent'}
                      </span>
                      <span className="block font-mono text-[9px] text-zinc-500">
                        {selectedAgent ? selectedAgent.id : 'Search by agent ID or name'}
                      </span>
                    </span>
                    <ChevronDown className={`h-4 w-4 shrink-0 text-zinc-500 transition-transform ${pickerOpen ? 'rotate-180' : ''}`} />
                  </button>

                  {/* dropdown panel — search + filtered list */}
                  {pickerOpen ? (
                    <div className="absolute inset-x-0 z-20 mt-1.5 overflow-hidden rounded-2xl border border-zinc-700 bg-zinc-900 shadow-2xl shadow-black/60">
                      <div className="flex items-center gap-2 border-b border-zinc-800 px-3 py-2">
                        <Search className="h-3.5 w-3.5 shrink-0 text-zinc-500" />
                        <input
                          autoFocus
                          value={agentSearch}
                          onChange={(e) => setAgentSearch(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Escape') setPickerOpen(false);
                            if (e.key === 'Enter') {
                              e.preventDefault();
                              if (filteredAgents[0]) {
                                setAgentId(filteredAgents[0].id);
                                setPickerOpen(false);
                                setAgentSearch('');
                              }
                            }
                          }}
                          placeholder="Search agent ID or name…"
                          className="w-full bg-transparent text-[12px] text-white placeholder-zinc-600 outline-none"
                        />
                        {agentSearch ? (
                          <button type="button" onClick={() => setAgentSearch('')} className="rounded-lg p-1 text-zinc-500 hover:text-white cursor-pointer" aria-label="Clear search">
                            <X className="h-3.5 w-3.5" />
                          </button>
                        ) : null}
                      </div>
                      <div className="max-h-52 overflow-y-auto overscroll-contain">
                        {filteredAgents.length === 0 ? (
                          <p className="px-3 py-5 text-center text-[11px] text-zinc-500">No agent matches “{agentSearch.trim()}”.</p>
                        ) : (
                          filteredAgents.map((a) => (
                            <button
                              type="button"
                              key={a.id}
                              onClick={() => { setAgentId(a.id); setPickerOpen(false); setAgentSearch(''); }}
                              className={`flex w-full items-center gap-2.5 border-b border-zinc-800/60 px-3 py-2.5 text-left transition last:border-0 cursor-pointer ${agentId === a.id ? 'bg-emerald-500/10' : 'hover:bg-zinc-800/60'}`}
                            >
                              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-zinc-800 font-mono text-[10px] font-bold text-zinc-300">{(a.name || a.id).slice(0, 1).toUpperCase()}</span>
                              <span className="min-w-0 flex-1">
                                <span className="block truncate text-[12px] font-bold text-white">{a.name || a.id}</span>
                                <span className="block font-mono text-[9px] text-zinc-500">{a.id}</span>
                              </span>
                              {unreadByAgent[a.id] ? (
                                <span className="shrink-0 rounded-full bg-emerald-500 px-1.5 py-0.5 text-[9px] font-black text-zinc-950">{unreadByAgent[a.id]}</span>
                              ) : null}
                              {agentId === a.id ? <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" /> : null}
                            </button>
                          ))
                        )}
                      </div>
                    </div>
                  ) : null}
                </div>

                {selectedAgent ? (
                  <button
                    type="button"
                    onClick={() => setChatOpen(true)}
                    className="flex w-full items-center justify-center gap-2 rounded-2xl border border-zinc-800 bg-zinc-950 px-3 py-2.5 text-[11px] font-bold text-zinc-300 transition hover:border-emerald-500/40 hover:text-emerald-300 cursor-pointer"
                  >
                    <MessageSquare className="h-3.5 w-3.5" />
                    Message {selectedAgent.name || selectedAgent.id}
                    {unreadByAgent[selectedAgent.id] ? (
                      <span className="rounded-full bg-emerald-500 px-1.5 py-0.5 text-[9px] font-black text-zinc-950">{unreadByAgent[selectedAgent.id]}</span>
                    ) : null}
                  </button>
                ) : null}

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
    </>
  );
};
