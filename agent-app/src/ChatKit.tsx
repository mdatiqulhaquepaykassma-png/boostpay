import { useCallback, useEffect, useRef, useState } from 'react';
import { Image as ImageIcon, Mic, Paperclip, Reply, Send, Square, Trash2, X } from 'lucide-react';

/* ─────────────────────────────────────────────────────────────────────────
 * Chat kit — the SAME chat experience as the user app, shared by the agent
 * console (user ↔ agent, agent ↔ management) and the management console.
 * Owner rule: text + photos + voice notes + replies + read receipts + typing.
 * File documents, polls, contact cards and stickers are intentionally absent.
 * ───────────────────────────────────────────────────────────────────────── */

export type ChatKind = 'text' | 'photo' | 'voice';

export type ChatMessageLike = {
  id: string;
  senderRole: string;
  text?: string;
  at: number;
  kind?: ChatKind;
  photoUrl?: string;
  voiceUrl?: string;
  voiceDurationMs?: number;
  replyToId?: string;
  replyToText?: string;
  replyToSender?: string;
  readByUser?: boolean;
  readByAgent?: boolean;
  readByManagement?: boolean;
};

export type ChatSendPayload = {
  kind: ChatKind;
  text?: string;
  photo?: string;
  voice?: string;
  voiceDurationMs?: number;
  replyToId?: string;
};

const MAX_PHOTO_BYTES = 4 * 1024 * 1024;

/**
 * Phone cameras produce 3–8 MB JPEGs; base64 makes them ~33% bigger again and the
 * upload used to be rejected. Downscale to 1600 px / q0.82 before sending — still
 * sharp on a phone screen, roughly 200–400 KB.
 */
const shrinkPhoto = async (file: File): Promise<string> => {
  const dataUrl = await fileToDataUrl(file);
  if (file.size <= 600 * 1024) return dataUrl;
  try {
    const img = document.createElement('img');
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error('bad image'));
      img.src = dataUrl;
    });
    const max = 1600;
    const scale = Math.min(1, max / Math.max(img.width || 1, img.height || 1));
    if (scale >= 1) return dataUrl;
    const canvas = document.createElement('canvas');
    canvas.width = Math.round((img.width || max) * scale);
    canvas.height = Math.round((img.height || max) * scale);
    const ctx = canvas.getContext('2d');
    if (!ctx) return dataUrl;
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', 0.82);
  } catch { return dataUrl; }
};
const MAX_VOICE_MS = 120000;
const MAX_VOICE_BYTES = 3 * 1024 * 1024;

export const chatClock = (ts: number) => new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
export const chatDay = (ts: number) => {
  const d = new Date(ts);
  if (d.toDateString() === new Date().toDateString()) return chatClock(ts);
  return `${d.toLocaleDateString([], { day: '2-digit', month: 'short' })} · ${chatClock(ts)}`;
};

const fileToDataUrl = (file: Blob): Promise<string> =>
  new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result || ''));
    r.onerror = () => reject(new Error('Could not read the file.'));
    r.readAsDataURL(file);
  });

/* ── voice recorder hook ────────────────────────────────────────────────── */
export function useVoiceRecorder(onDone: (dataUrl: string, durationMs: number) => void, onError: (msg: string) => void) {
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const recRef = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const startedAt = useRef(0);
  const timer = useRef<number | null>(null);
  const cancelled = useRef(false);

  const stopTimer = () => {
    if (timer.current !== null) { window.clearInterval(timer.current); timer.current = null; }
  };

  const start = useCallback(async () => {
    try {
      if (!(window as any).MediaRecorder || !navigator.mediaDevices?.getUserMedia) {
        onError('Voice messages are not supported on this browser.');
        return;
      }
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const types = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg'];
      const mime = types.find((t) => (window as any).MediaRecorder.isTypeSupported?.(t)) || '';
      // 32 kbps mono is plenty for speech and keeps a 2-minute note ~480 KB,
      // well inside the server's chat upload limit (the default 128 kbps produced
      // notes the API rejected as too large).
      const rec = new MediaRecorder(stream, {
        ...(mime ? { mimeType: mime } : {}),
        audioBitsPerSecond: 32000
      } as MediaRecorderOptions);
      recRef.current = rec;
      chunks.current = [];
      cancelled.current = false;
      startedAt.current = Date.now();
      rec.ondataavailable = (e) => { if (e.data && e.data.size) chunks.current.push(e.data); };
      rec.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        stopTimer();
        setRecording(false);
        setSeconds(0);
        if (cancelled.current) return;
        const ms = Date.now() - startedAt.current;
        if (ms < 500) { onError('Hold a little longer to record a voice message.'); return; }
        const blob = new Blob(chunks.current, { type: rec.mimeType || 'audio/webm' });
        if (!blob.size) { onError('Nothing was recorded. Check the microphone permission and try again.'); return; }
        if (blob.size > MAX_VOICE_BYTES) { onError('Voice message is too long. Keep it under 2 minutes.'); return; }
        try { onDone(await fileToDataUrl(blob), Math.min(ms, MAX_VOICE_MS)); }
        catch { onError('Could not prepare the voice message.'); }
      };
      rec.start();
      setRecording(true);
      setSeconds(0);
      timer.current = window.setInterval(() => {
        const s = Math.floor((Date.now() - startedAt.current) / 1000);
        setSeconds(s);
        if (Date.now() - startedAt.current >= MAX_VOICE_MS) {
          try { rec.stop(); } catch { /* ignore */ }
        }
      }, 250);
    } catch (err: any) {
      onError(err?.message || 'Microphone permission is required for voice messages.');
    }
  }, [onDone, onError]);

  const stop = useCallback(() => { try { recRef.current?.stop(); } catch { /* ignore */ } }, []);
  const cancel = useCallback(() => {
    cancelled.current = true;
    try { recRef.current?.stop(); } catch { /* ignore */ }
    setRecording(false); setSeconds(0); stopTimer();
  }, []);

  useEffect(() => () => { cancelled.current = true; stopTimer(); try { recRef.current?.stop(); } catch { /* ignore */ } }, []);
  return { recording, seconds, start, stop, cancel };
}

/* ── message bubble ─────────────────────────────────────────────────────── */
export type ChatAccent = 'amber' | 'cyan' | 'emerald';

const ACCENT_STYLES: Record<ChatAccent, { bubble: string; time: string; bg: string; ring: string }> = {
  amber: { bubble: 'border-amber-500/25 bg-amber-500/15 text-amber-50', time: 'text-amber-200/60', bg: 'bg-amber-500', ring: 'focus:border-amber-500/60' },
  cyan: { bubble: 'border-cyan-500/25 bg-cyan-500/15 text-cyan-50', time: 'text-cyan-200/60', bg: 'bg-cyan-500', ring: 'focus:border-cyan-500/60' },
  emerald: { bubble: 'border-emerald-500/25 bg-emerald-500/15 text-emerald-50', time: 'text-emerald-200/60', bg: 'bg-emerald-500', ring: 'focus:border-emerald-500/60' }
};

export const ChatBubble: React.FC<{
  msg: ChatMessageLike;
  mine: boolean;
  accent: ChatAccent;
  peerRead: boolean;
}> = ({ msg, mine, accent, peerRead }) => {
  const mineCls = ACCENT_STYLES[accent].bubble;
  const timeCls = ACCENT_STYLES[accent].time;
  return (
    <div className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
      <div className={`max-w-[84%] rounded-2xl border px-3 py-2 text-[12px] leading-relaxed ${mine ? mineCls : 'border-zinc-700/70 bg-zinc-800 text-zinc-100'}`}>
        {msg.replyToText ? (
          <div className={`mb-1.5 rounded-lg border-l-2 px-2 py-1 text-[10px] ${mine ? 'border-white/40 bg-black/20 text-white/70' : 'border-zinc-500 bg-zinc-900/60 text-zinc-400'}`}>
            <div className="font-bold">{msg.replyToSender === 'USER' ? 'User' : msg.replyToSender === 'AGENT' ? 'Agent' : msg.replyToSender === 'MANAGEMENT' ? 'Management' : 'Reply'}</div>
            <div className="truncate">{msg.replyToText}</div>
          </div>
        ) : null}
        {msg.kind === 'photo' && msg.photoUrl ? (
          <a href={msg.photoUrl} target="_blank" rel="noreferrer">
            <img src={msg.photoUrl} alt="Photo" className="max-h-60 w-auto rounded-xl border border-black/20 object-contain" loading="lazy" />
          </a>
        ) : null}
        {msg.kind === 'voice' && msg.voiceUrl ? (
          <div className="flex items-center gap-2">
            <audio src={msg.voiceUrl} controls preload="none" className="h-9 max-w-[190px]" />
            {msg.voiceDurationMs ? <span className="text-[9px] opacity-70">{Math.round((msg.voiceDurationMs || 0) / 1000)}s</span> : null}
          </div>
        ) : null}
        {msg.text ? <div className="whitespace-pre-wrap break-words">{msg.text}</div> : null}
        <div className={`mt-1 flex items-center justify-end gap-1 text-[8px] ${mine ? timeCls : 'text-zinc-500'}`}>
          <span>{chatDay(msg.at)}</span>
          {mine ? <span className={peerRead ? 'text-emerald-300' : 'opacity-60'}>{peerRead ? '✓✓' : '✓'}</span> : null}
        </div>
      </div>
    </div>
  );
};

/* ── composer ───────────────────────────────────────────────────────────── */
export const ChatComposer: React.FC<{
  accent: ChatAccent;
  /** Reply isolation: only replies emitted for this scope are picked up. */
  scope?: string;
  placeholder?: string;
  busy?: boolean;
  onSend: (payload: ChatSendPayload) => Promise<void> | void;
  onTyping?: () => void;
  onError?: (msg: string) => void;
}> = ({ accent, scope = 'default', placeholder = 'Write a message…', busy = false, onSend, onTyping, onError }) => {
  const [text, setText] = useState('');
  const [reply, setReply] = useState<{ id: string; text: string; sender?: string } | null>(null);
  const [sending, setSending] = useState(false);
  const photoRef = useRef<HTMLInputElement | null>(null);
  const lastTyping = useRef(0);

  // expose reply setter to the message list through a custom event on the wrapper
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (!detail) return;
      if (String(detail.scope || 'default') !== scope) return;
      setReply({ id: String(detail.id), text: String(detail.text || ''), sender: detail.sender });
    };
    window.addEventListener('chatkit:reply', handler as EventListener);
    return () => window.removeEventListener('chatkit:reply', handler as EventListener);
  }, [scope]);

  const fail = (m: string) => { if (onError) onError(m); };
  const recorder = useVoiceRecorder(
    async (dataUrl, ms) => { await submit({ kind: 'voice', voice: dataUrl, voiceDurationMs: ms }); },
    (m) => fail(m)
  );

  const accentBg = `${ACCENT_STYLES[accent].bg} ${ACCENT_STYLES[accent].ring}`;

  const submit = async (payload: ChatSendPayload) => {
    setSending(true);
    try {
      await onSend({ ...payload, replyToId: reply?.id });
      setReply(null);
      if (payload.kind === 'text') setText('');
    } catch (err: any) {
      const raw = String(err?.message || '');
      fail(/413|too large|payload/i.test(raw) ? 'That file was too large to send — try a shorter voice note or a smaller photo.' : (raw || 'Message could not be sent.'));
    } finally { setSending(false); }
  };

  const onPickPhoto = async (file: File | null | undefined) => {
    if (!file) return;
    if (!/^image\//i.test(file.type)) { fail('Only photos can be sent.'); return; }
    if (file.size > MAX_PHOTO_BYTES) { fail('Photo is larger than 4 MB.'); return; }
    try { await submit({ kind: 'photo', photo: await shrinkPhoto(file), text: text.trim() || undefined }); }
    catch { fail('Could not read the photo.'); }
  };

  const typingPing = () => {
    if (!onTyping) return;
    const now = Date.now();
    if (now - lastTyping.current < 2500) return;
    lastTyping.current = now;
    try { onTyping(); } catch { /* ignore */ }
  };

  return (
    <div className="border-t border-zinc-800 bg-zinc-950/85 px-3 py-2.5">
      {reply ? (
        <div className="mb-2 flex items-center gap-2 rounded-xl border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-[10px] text-zinc-300">
          <Reply className="h-3 w-3 shrink-0 text-zinc-500" />
          <div className="min-w-0 flex-1">
            <div className="font-bold text-zinc-400">{reply.sender === 'USER' ? 'User' : reply.sender === 'AGENT' ? 'Agent' : reply.sender === 'MANAGEMENT' ? 'Management' : 'Reply'}</div>
            <div className="truncate">{reply.text}</div>
          </div>
          <button type="button" onClick={() => setReply(null)} className="rounded-lg border border-zinc-700 p-1 text-zinc-400"><X className="h-3 w-3" /></button>
        </div>
      ) : null}

      {recorder.recording ? (
        <div className="flex items-center gap-2 rounded-2xl border border-red-500/40 bg-red-500/10 px-3 py-2">
          <span className="h-2 w-2 animate-pulse rounded-full bg-red-500" />
          <span className="flex-1 text-[11px] font-bold text-red-200">Recording… {recorder.seconds}s</span>
          <button type="button" onClick={recorder.cancel} className="rounded-lg border border-red-500/40 p-1.5 text-red-200"><Trash2 className="h-3.5 w-3.5" /></button>
          <button type="button" onClick={recorder.stop} className="flex items-center gap-1 rounded-lg bg-red-500 px-2 py-1.5 text-[10px] font-black text-white"><Square className="h-3 w-3" /> Send</button>
        </div>
      ) : (
        <form
          onSubmit={(e) => { e.preventDefault(); if (!text.trim()) return; void submit({ kind: 'text', text: text.trim() }); }}
          className="flex items-end gap-2"
        >
          <input
            ref={photoRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => { void onPickPhoto(e.target.files && e.target.files[0]); e.target.value = ''; }}
          />
          <button type="button" onClick={() => photoRef.current?.click()} title="Send a photo" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-zinc-800 bg-zinc-900 text-zinc-400">
            <ImageIcon className="h-4 w-4" />
          </button>
          <button type="button" onClick={() => void recorder.start()} title="Record a voice message" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-zinc-800 bg-zinc-900 text-zinc-400">
            <Mic className="h-4 w-4" />
          </button>
          <input
            value={text}
            onChange={(e) => { setText(e.target.value.slice(0, 1000)); typingPing(); }}
            placeholder={placeholder}
            className={`min-w-0 flex-1 rounded-2xl border border-zinc-800 bg-zinc-900 px-3.5 py-2.5 text-[12px] text-white placeholder-zinc-600 outline-none ${accentBg}`}
          />
          <button type="submit" disabled={busy || sending || !text.trim()} className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl text-zinc-950 disabled:opacity-40 ${ACCENT_STYLES[accent].bg}`}>
            <Send className="h-4 w-4" />
          </button>
        </form>
      )}
    </div>
  );
};

/* ── message list with long-press / double-tap reply ────────────────────── */
export const ChatList: React.FC<{
  messages: ChatMessageLike[];
  myRole: string;
  accent: ChatAccent;
  /** Reply isolation: events are emitted with this scope (see ChatComposer). */
  scope?: string;
  peerReadKey: 'readByUser' | 'readByAgent' | 'readByManagement';
  loading?: boolean;
  emptyTitle?: string;
  emptyHint?: string;
  className?: string;
  style?: React.CSSProperties;
  listRef?: React.RefObject<HTMLDivElement | null>;
}> = ({ messages, myRole, accent, scope = 'default', peerReadKey, loading, emptyTitle, emptyHint, className = '', style, listRef }) => {
  const pressTimer = useRef<number | null>(null);
  const innerRef = useRef<HTMLDivElement | null>(null);
  const firstPaint = useRef(true);
  // Auto-scroll only when the reader is already at the bottom — otherwise a new
  // message yanked people out of the history they were reading.
  useEffect(() => {
    const el = (listRef && listRef.current) || innerRef.current;
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 140;
    if (firstPaint.current || nearBottom) {
      el.scrollTop = el.scrollHeight;
      firstPaint.current = false;
    }
  }, [messages.length, listRef]);
  const clearPress = () => {
    if (pressTimer.current !== null) { window.clearTimeout(pressTimer.current); pressTimer.current = null; }
  };
  const openReply = (m: ChatMessageLike) => {
    const preview = m.kind === 'photo' ? 'Photo' : m.kind === 'voice' ? 'Voice message' : String(m.text || '').slice(0, 120);
    window.dispatchEvent(new CustomEvent('chatkit:reply', { detail: { id: m.id, text: preview, sender: m.senderRole, scope } }));
  };
  return (
    <div
      ref={(node) => {
        innerRef.current = node;
        if (listRef) (listRef as any).current = node;
      }}
      className={`space-y-2 overflow-y-auto overscroll-contain ${className}`}
      style={style}
    >
      {loading ? (
        <p className="py-8 text-center text-[11px] text-zinc-600">Loading…</p>
      ) : messages.length === 0 ? (
        <div className="py-8 text-center">
          <p className="text-[11px] font-semibold text-zinc-300">{emptyTitle || 'No messages yet'}</p>
          {emptyHint ? <p className="mt-1 px-6 text-[10px] leading-relaxed text-zinc-600">{emptyHint}</p> : null}
        </div>
      ) : messages.map((m, i) => {
        const mine = m.senderRole === myRole;
        const prev = i > 0 ? messages[i - 1] : null;
        const newDay = !prev || new Date(prev.at).toDateString() !== new Date(m.at).toDateString();
        return (
          <div key={m.id}>
          {newDay ? (
            <div className="my-2 flex items-center justify-center">
              <span className="rounded-full bg-zinc-900/80 px-2.5 py-0.5 text-[8.5px] font-bold uppercase tracking-wider text-zinc-500">
                {new Date(m.at).toDateString() === new Date().toDateString()
                  ? 'Today'
                  : new Date(m.at).toLocaleDateString([], { day: '2-digit', month: 'short', year: 'numeric' })}
              </span>
            </div>
          ) : null}
          <div
            onDoubleClick={() => openReply(m)}
            onContextMenu={(e) => { e.preventDefault(); openReply(m); }}
            onTouchStart={() => { clearPress(); pressTimer.current = window.setTimeout(() => { pressTimer.current = null; openReply(m); }, 450); }}
            onTouchEnd={clearPress}
            onTouchMove={clearPress}
            onTouchCancel={clearPress}
            title="Hold to reply"
          >
            <ChatBubble msg={m} mine={mine} accent={accent} peerRead={mine ? (m as any)[peerReadKey] === true : false} />
          </div>
          </div>
        );
      })}
    </div>
  );
};
