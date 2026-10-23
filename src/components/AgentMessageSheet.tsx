import { FC, useCallback, useEffect, useRef, useState } from 'react';
import { MessageSquare, Send as SendIcon, X, Store, ShieldCheck } from 'lucide-react';
import { BoostPayStore } from '../services/store';

interface AgentMsg {
  id: string; agentId: string; userId: string; senderRole: 'USER' | 'AGENT'; text: string; at: number;
}

interface Props {
  isOpen: boolean;
  agentId: string;
  agentName?: string;
  onClose: () => void;
}

const clock = (ts: number) => {
  const d = new Date(ts);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
};
const dayLabel = (ts: number) => {
  const d = new Date(ts); const now = new Date();
  const same = d.toDateString() === now.toDateString();
  if (same) return clock(ts);
  return `${d.toLocaleDateString([], { day: '2-digit', month: 'short' })} · ${clock(ts)}`;
};

/**
 * Direct 1-to-1 thread between the signed-in user and one agent.
 * Owner rule: IDs only — the agent is shown as its agent ID, never a person's name/email.
 */
export const AgentMessageSheet: FC<Props> = ({ isOpen, agentId, agentName, onClose }) => {
  const [messages, setMessages] = useState<AgentMsg[]>([]);
  const [text, setText] = useState('');
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const listRef = useRef<HTMLDivElement | null>(null);

  const load = useCallback(async (quiet = false) => {
    if (!agentId) return;
    if (!quiet) setLoading(true);
    try {
      const res = await fetch(`/api/user/agent-thread?agentId=${encodeURIComponent(agentId)}`, {
        headers: BoostPayStore.authHeaders()
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || 'Could not load the conversation.');
      setMessages(json.messages || []);
      setError('');
    } catch (err: any) {
      if (!quiet) setError(err?.message || 'Could not load the conversation.');
    } finally {
      if (!quiet) setLoading(false);
    }
  }, [agentId]);

  useEffect(() => {
    if (!isOpen || !agentId) return;
    setText(''); setError('');
    void load();
    const iv = window.setInterval(() => { void load(true); }, 8000);
    return () => window.clearInterval(iv);
  }, [isOpen, agentId, load]);

  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length]);

  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    const clean = text.trim();
    if (!clean) return;
    setBusy(true); setError('');
    try {
      const res = await fetch('/api/user/message-agent', {
        method: 'POST',
        headers: BoostPayStore.authHeaders(),
        body: JSON.stringify({ agentId, text: clean })
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) throw new Error(json?.error || 'Message could not be sent.');
      setText('');
      setMessages((prev) => [...prev, json.message]);
    } catch (err: any) {
      setError(err?.message || 'Message could not be sent.');
    } finally {
      setBusy(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[140] flex items-end sm:items-center justify-center bg-black/75 backdrop-blur-sm p-0 sm:p-4" onClick={onClose}>
      <div
        className="flex h-[88vh] w-full max-w-md flex-col overflow-hidden rounded-t-3xl sm:h-[80vh] sm:rounded-3xl border border-zinc-800 bg-zinc-900 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-zinc-800 bg-zinc-900/95 px-4 py-3">
          <div className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-emerald-500/15"><Store className="h-4 w-4 text-emerald-400" /></span>
            <div className="min-w-0">
              <div className="truncate text-sm font-black text-white">{agentName || 'Agent'}</div>
              <div className="font-mono text-[9px] text-zinc-500">{agentId}</div>
            </div>
          </div>
          <button onClick={onClose} className="rounded-xl border border-zinc-800 bg-zinc-950 p-2 text-zinc-400 hover:text-white cursor-pointer" aria-label="Close">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div ref={listRef} className="flex-1 space-y-2 overflow-y-auto overscroll-contain px-3 py-3">
          {loading ? (
            <p className="py-8 text-center text-[11px] text-zinc-500">Loading conversation…</p>
          ) : messages.length === 0 ? (
            <div className="mt-6 rounded-2xl border border-zinc-800 bg-zinc-950/70 p-4 text-center">
              <MessageSquare className="mx-auto h-5 w-5 text-zinc-600" />
              <p className="mt-2 text-[11px] font-semibold text-zinc-300">No messages yet</p>
              <p className="mt-1 text-[10px] leading-relaxed text-zinc-500">
                Ask the agent about cash in / cash out, limits or the handover. Only your User ID is shared with the agent.
              </p>
            </div>
          ) : (
            messages.map((m) => {
              const mine = m.senderRole === 'USER';
              return (
                <div key={m.id} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
                  <div className={`max-w-[82%] rounded-2xl px-3 py-2 text-[12px] leading-relaxed ${mine ? 'bg-emerald-500/15 text-emerald-50 border border-emerald-500/25' : 'bg-zinc-800 text-zinc-100 border border-zinc-700/70'}`}>
                    <div className="whitespace-pre-wrap break-words">{m.text}</div>
                    <div className={`mt-1 text-right text-[8px] ${mine ? 'text-emerald-200/60' : 'text-zinc-500'}`}>{dayLabel(m.at)}</div>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {error ? <div className="mx-3 mb-2 rounded-xl border border-red-500/40 bg-red-500/10 px-3 py-2 text-[11px] font-semibold text-red-200">{error}</div> : null}

        <form onSubmit={send} className="flex items-end gap-2 border-t border-zinc-800 bg-zinc-950/80 px-3 py-2.5">
          <input
            value={text}
            onChange={(e) => setText(e.target.value.slice(0, 1000))}
            placeholder="Message this agent…"
            className="min-w-0 flex-1 rounded-2xl border border-zinc-800 bg-zinc-900 px-3.5 py-2.5 text-[12px] text-white placeholder-zinc-600 outline-none focus:border-emerald-500/60"
          />
          <button
            type="submit"
            disabled={busy || !text.trim()}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-emerald-500 text-zinc-950 transition hover:bg-emerald-400 disabled:opacity-40 cursor-pointer"
            aria-label="Send message"
          >
            <SendIcon className="h-4 w-4" />
          </button>
        </form>

        <div className="flex items-center justify-center gap-1.5 px-3 pb-2.5 text-[8.5px] text-zinc-600">
          <ShieldCheck className="h-3 w-3" />
          Messages are private between you and this agent. Never share passwords or OTPs.
        </div>
      </div>
    </div>
  );
};
