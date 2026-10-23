import { FC, useCallback, useEffect, useRef, useState } from 'react';
import { Phone, Store, Video, X } from 'lucide-react';
import { BoostPayStore } from '../services/store';
import { ChatComposer, ChatList, ChatMessageLike, ChatSendPayload } from './ChatKit';
import { startCallTo } from './CallOverlay';

interface Props {
  isOpen: boolean;
  agentId: string;
  agentName?: string;
  onClose: () => void;
}

/**
 * Direct 1-to-1 thread between the signed-in user and one agent.
 * Same chat experience as the rest of the app: text, photos, voice notes,
 * replies, seen ticks and typing indicators (owner request 2026-10-23).
 * Owner rule: IDs only — the agent is shown as its agent ID, never a name/email.
 */
export const AgentMessageSheet: FC<Props> = ({ isOpen, agentId, agentName, onClose }) => {
  const [messages, setMessages] = useState<ChatMessageLike[]>([]);
  const [peerTyping, setPeerTyping] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const listRef = useRef<HTMLDivElement | null>(null);

  const load = useCallback(async (quiet = false) => {
    if (!agentId) return;
    if (!quiet) setLoading(true);
    try {
      const res = await fetch(`/api/user/agent-thread?agentId=${encodeURIComponent(agentId)}`, {
        headers: BoostPayStore.authHeaders()
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) throw new Error(json?.error || 'Could not load the conversation.');
      setMessages(Array.isArray(json?.messages) ? json.messages : []);
      setPeerTyping(!!json?.peerTyping);
      setError('');
    } catch (err: any) {
      if (!quiet) setError(err?.message || 'Could not load the conversation.');
    } finally {
      if (!quiet) setLoading(false);
    }
  }, [agentId]);

  useEffect(() => {
    if (!isOpen || !agentId) return;
    setMessages([]); setError(''); setPeerTyping(false);
    void load();
    const iv = window.setInterval(() => { void load(true); }, 6000);
    return () => window.clearInterval(iv);
  }, [isOpen, agentId, load]);

  // Live wake-up from the server stream: an agent reply shows up at once.
  useEffect(() => {
    if (!isOpen || !agentId) return;
    const onLive = (e: Event) => {
      const detail = (e as CustomEvent).detail || {};
      if (detail.agentId && String(detail.agentId) !== String(agentId)) return;
      void load(true);
    };
    window.addEventListener('boostpay:agent-chat', onLive as EventListener);
    return () => window.removeEventListener('boostpay:agent-chat', onLive as EventListener);
  }, [isOpen, agentId, load]);

  const send = async (payload: ChatSendPayload) => {
    setError('');
    const res = await fetch('/api/user/message-agent', {
      method: 'POST',
      headers: BoostPayStore.authHeaders(),
      body: JSON.stringify({ agentId, ...payload })
    });
    const json = await res.json().catch(() => null);
    if (!res.ok) throw new Error(json?.error || 'Message could not be sent.');
    setMessages((prev) => (prev.some((m) => m.id === json.message.id) ? prev : [...prev, json.message]));
  };

  const typing = () => {
    void fetch('/api/user/typing-agent', {
      method: 'POST',
      headers: BoostPayStore.authHeaders(),
      body: JSON.stringify({ agentId })
    }).catch(() => undefined);
  };

  if (!isOpen) return null;
  const title = agentName || (agentId ? `Agent ${agentId}` : 'Agent');

  return (
    <div className="fixed inset-0 z-[140] flex items-end justify-center bg-black/75 backdrop-blur-sm p-0 sm:items-center sm:p-4" onClick={onClose}>
      <div
        className="flex h-[88vh] w-full max-w-md flex-col overflow-hidden rounded-t-3xl border border-zinc-800 bg-zinc-900 shadow-2xl sm:h-[80vh] sm:rounded-3xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-zinc-800 bg-zinc-900/95 px-4 py-3">
          <div className="flex min-w-0 items-center gap-2">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-emerald-500/15"><Store className="h-4 w-4 text-emerald-400" /></span>
            <div className="min-w-0">
              <div className="truncate text-sm font-black text-white">{title}</div>
              <div className="font-mono text-[9px] text-zinc-500">{agentId}{peerTyping ? ' · typing…' : ''}</div>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            <button
              onClick={() => startCallTo(agentId, title, 'audio')}
              className="flex h-9 w-9 items-center justify-center rounded-xl border border-emerald-500/40 bg-emerald-500/10 text-emerald-300 active:scale-95 cursor-pointer"
              title="Voice call this agent"
              aria-label="Voice call this agent"
            ><Phone className="h-4 w-4" /></button>
            <button
              onClick={() => startCallTo(agentId, title, 'video')}
              className="flex h-9 w-9 items-center justify-center rounded-xl border border-emerald-500/40 bg-emerald-500/10 text-emerald-300 active:scale-95 cursor-pointer"
              title="Video call this agent"
              aria-label="Video call this agent"
            ><Video className="h-4 w-4" /></button>
            <button onClick={onClose} className="rounded-xl border border-zinc-800 bg-zinc-950 p-2 text-zinc-400 hover:text-white cursor-pointer" aria-label="Close">
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        <ChatList
          messages={messages}
          myRole="USER"
          accent="emerald"
          scope={`user-agent-${agentId}`}
          peerReadKey="readByAgent"
          loading={loading}
          emptyTitle="No messages yet"
          emptyHint="Ask the agent about cash in / cash out, limits or the handover. Only your User ID is shared with the agent."
          className="flex-1 px-3 py-3"
          listRef={listRef}
        />

        {error ? <div className="mx-3 mb-2 rounded-xl border border-red-500/40 bg-red-500/10 px-3 py-2 text-[11px] font-semibold text-red-200">{error}</div> : null}

        <ChatComposer
          accent="emerald"
          scope={`user-agent-${agentId}`}
          placeholder="Message the agent…"
          onSend={send}
          onTyping={typing}
          onError={(m) => setError(m)}
        />
      </div>
    </div>
  );
};
