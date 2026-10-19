import React, { FC, useState, useEffect, memo, useRef } from 'react';
import {
  MessageSquare,
  Search,
  Send,
  ShieldAlert,
  ShieldCheck,
  ArrowLeft,
  Plus,
  Users,
  Headphones,
  Copy,
  Check,
  Smile,
  Phone,
  Video
, Mic, Play, Pause, X, Pin, Reply, Forward, Pencil, Trash2, ImagePlus, Bell, BellOff, Settings, Users2, Info, Volume2, Paperclip, BarChart3, Link2, Globe, Lock, PhoneOff, MicOff, Mic2, Bookmark, UserPlus, Eye
} from 'lucide-react';
import { BoostPayStore, copyToClipboard } from '../services/store';
import { startCallTo } from './CallOverlay';
import { User, Conversation, Message } from '../types';

/** In-chat voice note player */
const VoiceNotePlayer: FC<{ data: string; durationMs?: number; isMe: boolean }> = ({ data, durationMs, isMe }) => {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [cur, setCur] = useState(0);
  const total = Math.max(1, Math.round((durationMs || 0) / 1000));
  const toggle = () => {
    const el = audioRef.current;
    if (!el) return;
    if (el.paused) {
      el.play().then(() => setPlaying(true)).catch(() => {});
    } else {
      el.pause();
      setPlaying(false);
    }
  };
  return (
    <div className="flex items-center gap-2 min-w-[160px]">
      <button
        type="button"
        onClick={toggle}
        className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition cursor-pointer ${isMe ? 'bg-zinc-950/20 text-zinc-950' : 'bg-amber-500/20 text-amber-400'}`}
        title={playing ? 'Pause' : 'Play voice message'}
      >
        {playing ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
      </button>
      <div className="flex-1">
        <div className={`h-1 rounded-full overflow-hidden ${isMe ? 'bg-zinc-950/20' : 'bg-zinc-700'}`}>
          <div
            className={`h-full ${isMe ? 'bg-zinc-950/60' : 'bg-amber-400'}`}
            style={{ width: `${Math.min(100, (cur / total) * 100)}%`, transition: 'width 0.2s linear' }}
          />
        </div>
        <div className={`text-[9px] font-mono mt-0.5 ${isMe ? 'text-zinc-950/70' : 'text-zinc-400'}`}>
          {Math.floor(cur / 60)}:{String(Math.floor(cur % 60)).padStart(2, '0')} / {Math.floor(total / 60)}:{String(Math.floor(total % 60)).padStart(2, '0')}
        </div>
      </div>
      <audio
        ref={audioRef}
        src={data}
        preload="metadata"
        onTimeUpdate={() => setCur(audioRef.current?.currentTime || 0)}
        onEnded={() => { setPlaying(false); setCur(0); }}
        className="hidden"
      />
    </div>
  );
};

interface Props {
  currentUser: User;
  initialPeerId?: string | null;
  targetPeerId?: string | null;
}

const EMOJI_PALETTE = ['👍', '❤️', '🔥', '🚀', '💸', '✨', '⚡', '🎉'];

// Helper to generate consistent vibrant avatar colors based on numeric ID
function getAvatarGradient(id: string): string {
  if (id === 'ADMIN_SUPPORT') {
    return 'from-sky-500 to-blue-600 shadow-sky-500/20';
  }
  const gradients = [
    'from-amber-500 to-orange-600 shadow-amber-500/20',
    'from-emerald-500 to-teal-600 shadow-emerald-500/20',
    'from-indigo-500 to-purple-600 shadow-indigo-500/20',
    'from-rose-500 to-pink-600 shadow-rose-500/20',
    'from-cyan-500 to-blue-600 shadow-cyan-500/20',
    'from-violet-500 to-fuchsia-600 shadow-violet-500/20'
  ];
  const num = parseInt(id.replace(/\D/g, '') || '1', 10);
  return gradients[num % gradients.length];
}

interface MessageItemProps {
  m: Message;
  isMe: boolean;
  isAdmin: boolean;
  currentUserId: string;
  onReact: (messageId: string, emoji: string) => void;
  onCopy: (text: string) => void;
  copiedMsgId: string | null;
  onReply: (m: Message) => void;
  onForward: (m: Message) => void;
  onPin: (m: Message) => void;
  onEdit: (m: Message) => void;
  onDelete: (m: Message) => void;
  showSeen?: boolean;
  onOpenImage?: (dataUrl: string) => void;
  onVotePoll?: (m: Message, optionIndex: number) => void;
  onInfo?: (m: Message) => void;
}

const MessageItem = memo(({
  m,
  isMe,
  isAdmin,
  currentUserId,
  onReact,
  onCopy,
  copiedMsgId,
  onReply,
  onForward,
  onPin,
  onEdit,
  onDelete,
  showSeen,
  onOpenImage,
  onVotePoll,
  onInfo
}: MessageItemProps) => {
  const [showActionBar, setShowActionBar] = useState(false);
  const isCopied = copiedMsgId === m.id;

  const reactions = m.reactions || {};
  const hasReactions = Object.keys(reactions).some(k => reactions[k]?.length > 0);
  const isDeleted = !!m.deleted;
  const isVoice = m.kind === 'voice' && !!m.voiceData && !isDeleted;
  const isPhoto = m.kind === 'photo' && !!m.photoData && !isDeleted;
  const isFile = m.kind === 'file' && !!m.fileData && !isDeleted;
  const isContact = m.kind === 'contact' && !!m.contactId && !isDeleted;
  const isPoll = m.kind === 'poll' && !!m.poll && !isDeleted;
  const isSticker = m.kind === 'sticker' && !isDeleted;

  return (
    m.kind === 'call' ? (
      <div className="flex justify-center my-1.5">
        <div className={`inline-flex items-center gap-2 rounded-full border px-3.5 py-1.5 text-[10px] ${
          m.callInfo?.outcome === 'missed' || m.callInfo?.outcome === 'declined'
            ? 'border-red-500/25 bg-red-500/10 text-red-300'
            : 'border-zinc-800 bg-zinc-900/80 text-zinc-400'
        }`}>
          <span>{m.callInfo?.outcome === 'missed' ? '📵' : m.callInfo?.media === 'video' ? '🎥' : '📞'}</span>
          <span className="font-semibold">
            {m.callInfo?.outcome === 'missed'
              ? 'Missed call'
              : m.callInfo?.outcome === 'declined'
              ? 'Call declined'
              : `${m.callInfo?.media === 'video' ? 'Video' : 'Voice'} call`}
          </span>
          {m.callInfo?.outcome === 'completed' && (
            <span className="font-mono text-zinc-500">
              {Math.floor((m.callInfo.durationMs || 0) / 60000)}m {Math.floor(((m.callInfo.durationMs || 0) % 60000) / 1000)}s
            </span>
          )}
          <span className="text-zinc-600">·</span>
          <span className="font-mono text-zinc-500">{new Date(m.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
        </div>
      </div>
    ) : (
    <div
      className={`group relative flex flex-col max-w-[85%] sm:max-w-[78%] transition-all ${
        isMe ? 'ml-auto items-end' : 'mr-auto items-start'
      }`}
      onMouseEnter={() => setShowActionBar(true)}
      onMouseLeave={() => setShowActionBar(false)}
      onTouchStart={() => setShowActionBar(true)}
    >
      {/* Sender Header for Incoming Messages */}
      {!isMe && (
        <div className="flex items-center gap-1.5 mb-1 px-1">
          <span className={`text-[10px] font-mono font-bold flex items-center gap-1 ${
            isAdmin ? 'text-sky-400' : 'text-zinc-400'
          }`}>
            {isAdmin && <ShieldCheck className="w-3.5 h-3.5 text-sky-400" />}
            {isAdmin ? 'Official Verified Support' : `User #${m.senderId}`}
          </span>
        </div>
      )}

      {/* Pinned indicator */}
      {m.pinned && (
        <div className="flex items-center gap-1 mb-0.5 text-[9px] text-amber-400/90 font-mono">
          <Pin className="w-2.5 h-2.5" /> Pinned
        </div>
      )}

      {/* Forwarded header */}
      {m.forwardedFrom && (
        <div className="flex items-center gap-1 mb-0.5 text-[9px] text-zinc-400 font-mono">
          <Forward className="w-2.5 h-2.5" /> Forwarded from #{m.forwardedFrom}
        </div>
      )}

      {/* Main Glassmorphic Bubble */}
      <div
        className={`relative px-3.5 py-2.5 text-xs leading-relaxed transition-all backdrop-blur-md ${
          isDeleted
            ? 'bg-zinc-900/50 border border-zinc-800/60 text-zinc-500 italic rounded-2xl'
            : isMe
            ? 'bg-gradient-to-br from-amber-500 to-amber-600 text-zinc-950 font-medium rounded-2xl rounded-br-xs shadow-md shadow-amber-500/10'
            : isAdmin
            ? 'bg-gradient-to-br from-sky-950/80 via-sky-900/40 to-zinc-900/90 border border-sky-500/30 text-sky-100 rounded-2xl rounded-bl-xs shadow-md shadow-sky-500/5'
            : 'bg-zinc-900/90 border border-zinc-800/80 text-zinc-100 rounded-2xl rounded-bl-xs shadow-sm'
        }`}
      >
        {/* Reply quote */}
        {m.replyTo && !isDeleted && (
          <div className={`mb-1.5 rounded-xl px-2.5 py-1.5 border-l-2 ${
            isMe ? 'bg-zinc-950/15 border-zinc-950/40' : 'bg-zinc-800/60 border-amber-400/70'
          }`}>
            <div className={`text-[9px] font-bold font-mono ${isMe ? 'text-zinc-950/80' : 'text-amber-400'}`}>
              #{m.replyTo.senderId}
            </div>
            <div className={`text-[10px] truncate max-w-[200px] ${isMe ? 'text-zinc-950/70' : 'text-zinc-400'}`}>
              {m.replyTo.text || 'Attachment'}
            </div>
          </div>
        )}

        {isDeleted ? (
          <p className="break-words select-text font-normal text-[11px]">🚫 Message deleted</p>
        ) : isPhoto ? (
          <div className="space-y-1">
            <button type="button" onClick={() => onOpenImage?.(m.photoData!)} className="block cursor-zoom-in">
              <img src={m.photoData} alt="Photo attachment" className="max-h-56 rounded-xl object-cover" />
            </button>
            {m.text && m.text !== '📷 Photo' && (
              <p className="break-words select-text font-normal">{m.text}</p>
            )}
          </div>
        ) : isVoice ? (
          <VoiceNotePlayer data={m.voiceData!} durationMs={m.voiceDurationMs} isMe={isMe} />
        ) : isSticker ? (
          <div className="py-1 select-none">
            <span className="text-5xl leading-none block">{m.stickerEmoji || m.text || '🙂'}</span>
          </div>
        ) : isFile ? (
          <div className="space-y-1 min-w-[190px]">
            <div className={`flex items-center gap-2.5 rounded-xl px-2.5 py-2 ${isMe ? 'bg-zinc-950/15' : 'bg-zinc-800/70'}`}>
              <div className={`flex h-9 w-9 items-center justify-center rounded-xl ${isMe ? 'bg-zinc-950/25' : 'bg-amber-500/15 border border-amber-500/30'}`}>
                <Paperclip className={`w-4 h-4 ${isMe ? 'text-zinc-900' : 'text-amber-400'}`} />
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-[11px] font-semibold truncate">{m.fileName || 'File'}</div>
                <div className="text-[9px] font-mono opacity-70">{m.fileSize ? `${Math.max(1, Math.round(m.fileSize / 1024))} KB` : 'document'}</div>
              </div>
              <a
                href={m.fileData}
                download={m.fileName || 'file'}
                className={`shrink-0 rounded-lg px-2 py-1 text-[9px] font-bold transition cursor-pointer ${isMe ? 'bg-zinc-950/25 text-zinc-900 hover:bg-zinc-950/40' : 'bg-amber-500/20 text-amber-300 hover:bg-amber-500/30'}`}
                title="Download file"
              >
                Save
              </a>
            </div>
          </div>
        ) : isContact ? (
          <div className="flex items-center gap-2.5 min-w-[180px]">
            <div className={`flex h-10 w-10 items-center justify-center rounded-full font-bold text-xs ${isMe ? 'bg-zinc-950/25 text-zinc-900' : 'bg-sky-500/20 text-sky-300 border border-sky-500/30'}`}>
              {(m.contactId || '?').slice(0, 2).toUpperCase()}
            </div>
            <div>
              <div className="text-[11px] font-bold">User #{m.contactId}</div>
              <div className="text-[9px] opacity-70 font-mono">Contact card</div>
            </div>
          </div>
        ) : isPoll ? (
          <div className="min-w-[210px] space-y-1.5">
            <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wide opacity-80">
              <BarChart3 className="w-3 h-3" /> Poll
            </div>
            <p className="font-semibold text-[11px] break-words">{m.poll!.question}</p>
            <div className="space-y-1">
              {m.poll!.options.map((opt, i) => {
                const total = m.poll!.options.reduce((n, o) => n + (o.votes?.length || 0), 0);
                const votes = opt.votes?.length || 0;
                const pct = total ? Math.round((votes / total) * 100) : 0;
                const voted = (opt.votes || []).includes(currentUserId);
                return (
                  <button
                    key={i}
                    type="button"
                    onClick={() => onVotePoll?.(m, i)}
                    className={`relative w-full overflow-hidden rounded-lg border px-2.5 py-1.5 text-left text-[10px] transition cursor-pointer ${
                      voted
                        ? isMe ? 'border-zinc-950/40 bg-zinc-950/10' : 'border-amber-500/50 bg-amber-500/10'
                        : isMe ? 'border-zinc-950/25 hover:border-zinc-950/45' : 'border-zinc-700 hover:border-zinc-500'
                    }`}
                  >
                    <span className="absolute inset-y-0 left-0 bg-current opacity-10" style={{ width: `${pct}%` }} />
                    <span className="relative flex items-center justify-between gap-2">
                      <span className="font-medium truncate">{opt.text}</span>
                      <span className="font-mono opacity-75">{pct}%</span>
                    </span>
                  </button>
                );
              })}
            </div>
            <div className="text-[9px] opacity-60 font-mono">
              {m.poll!.options.reduce((n, o) => n + (o.votes?.length || 0), 0)} votes{m.poll!.closed ? ' · closed' : ''}
            </div>
          </div>
        ) : (
          <p className="break-words select-text font-normal">{m.text}</p>
        )}

        {/* Timestamp Footer */}
        <div className="flex items-center justify-end gap-1 mt-1 text-[9px] opacity-75 font-mono">
          {m.editedAt && !isDeleted && <span>edited</span>}
          <span>{new Date(m.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
          {isMe && !isDeleted && (
            <span className={showSeen ? 'text-sky-600' : ''}>{showSeen ? '✓✓' : '✓'}</span>
          )}
        </div>
      </div>

      {hasReactions && (
        <div className="flex gap-1 mt-1">
          {Object.entries(reactions).map(([emoji, uids]) => (
            <button
              key={emoji}
              type="button"
              onClick={() => onReact(m.id, emoji)}
              className={`text-[10px] rounded-full px-1.5 py-0.2 border cursor-pointer transition ${
                (uids || []).includes(currentUserId)
                  ? 'bg-amber-500/20 border-amber-500/40 text-amber-300'
                  : 'bg-zinc-800/80 border-zinc-700 text-zinc-300 hover:border-zinc-500'
              }`}
              title="Tap to react"
            >
              {emoji} {uids.length}
            </button>
          ))}
        </div>
      )}

      {/* Floating Hover Action Bar */}
      {showActionBar && !isDeleted && (
        <div
          className={`absolute -top-7 ${
            isMe ? 'right-0' : 'left-0'
          } z-20 flex items-center gap-1 bg-zinc-900/95 border border-zinc-800 px-2 py-1 rounded-xl shadow-xl backdrop-blur-md animate-in fade-in zoom-in-95 duration-100`}
        >
          {/* Reaction Triggers */}
          <div className="flex items-center gap-0.5 border-r border-zinc-800 pr-1.5 mr-0.5">
            {EMOJI_PALETTE.slice(0, 4).map((emoji) => (
              <button
                key={emoji}
                type="button"
                onClick={() => onReact(m.id, emoji)}
                className="hover:scale-125 transition-transform text-xs p-0.5 cursor-pointer"
                title={`React ${emoji}`}
              >
                {emoji}
              </button>
            ))}
          </div>

          <button type="button" onClick={() => onReply(m)} className="text-zinc-400 hover:text-amber-300 p-1 rounded transition cursor-pointer" title="Reply">
            <Reply className="w-3 h-3" />
          </button>
          <button type="button" onClick={() => onForward(m)} className="text-zinc-400 hover:text-sky-300 p-1 rounded transition cursor-pointer" title="Forward">
            <Forward className="w-3 h-3" />
          </button>
          <button type="button" onClick={() => onPin(m)} className={`p-1 rounded transition cursor-pointer ${m.pinned ? 'text-amber-400' : 'text-zinc-400 hover:text-amber-300'}`} title={m.pinned ? 'Unpin' : 'Pin'}>
            <Pin className="w-3 h-3" />
          </button>
          {isMe && !isVoice && !isPhoto && !isFile && !isContact && !isPoll && !isSticker && (
            <button type="button" onClick={() => onEdit(m)} className="text-zinc-400 hover:text-emerald-300 p-1 rounded transition cursor-pointer" title="Edit">
              <Pencil className="w-3 h-3" />
            </button>
          )}
          {isMe && (
            <button type="button" onClick={() => onDelete(m)} className="text-zinc-400 hover:text-red-400 p-1 rounded transition cursor-pointer" title="Delete">
              <Trash2 className="w-3 h-3" />
            </button>
          )}
          <button type="button" onClick={() => onInfo?.(m)} className="text-zinc-400 hover:text-sky-300 p-1 rounded transition cursor-pointer" title="Message info">
            <Info className="w-3 h-3" />
          </button>
          {!isVoice && !isPhoto && !isFile && !isSticker && (
            <button
              type="button"
              onClick={() => onCopy(m.text)}
              className="text-zinc-400 hover:text-zinc-200 p-1 rounded transition cursor-pointer"
              title="Copy Text"
            >
              {isCopied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
            </button>
          )}
        </div>
      )}
    </div>
    )
  );
});

MessageItem.displayName = 'MessageItem';

export const MessengerView: FC<Props> = ({ currentUser, initialPeerId, targetPeerId }) => {
  const [conversations, setConversations] = useState<Conversation[]>(() => BoostPayStore.getConversations());
  const [messages, setMessages] = useState<Message[]>(() => BoostPayStore.getMessages());
  const [activeConv, setActiveConv] = useState<Conversation | null>(null);
  const [inputMsg, setInputMsg] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [recSeconds, setRecSeconds] = useState(0);
  const recMediaRef = useRef<MediaRecorder | null>(null);
  const recChunksRef = useRef<Blob[]>([]);
  const recTimerRef = useRef<number | null>(null);

  // Telegram-style chat features
  const [replyTo, setReplyTo] = useState<Message | null>(null);
  const [editing, setEditing] = useState<Message | null>(null);
  const [forwardMsg, setForwardMsg] = useState<Message | null>(null);
  const [showSearch, setShowSearch] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [peerTyping, setPeerTyping] = useState(false);
  const [onlineIds, setOnlineIds] = useState<string[]>([]);
  const [showGroupInfo, setShowGroupInfo] = useState(false);
  const [showChatMenu, setShowChatMenu] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [imageViewer, setImageViewer] = useState<string | null>(null);

  // Telegram-style extras: stickers, files, polls, contacts, message info
  const [showStickerPicker, setShowStickerPicker] = useState(false);
  const [showPollCreator, setShowPollCreator] = useState(false);
  const [pollQuestion, setPollQuestion] = useState('');
  const [pollOptions, setPollOptions] = useState<string[]>(['', '']);
  const [showContactPicker, setShowContactPicker] = useState(false);
  const [infoMsg, setInfoMsg] = useState<Message | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Public group discovery + join requests + invite links
  const [showDiscover, setShowDiscover] = useState(false);
  const [discoverGroups, setDiscoverGroups] = useState<{ id: string; name: string; memberCount: number; joinApprovalRequired: boolean }[]>([]);
  const [inviteLink, setInviteLink] = useState('');
  const [inviteCopied, setInviteCopied] = useState(false);
  const [blockedIds, setBlockedIds] = useState<string[]>([]);
  const [showAttachmentMenu, setShowAttachmentMenu] = useState(false);

  // GROUP VOICE CALL (mesh WebRTC)
  const [gcCall, setGcCall] = useState<any>(null);
  const [gcJoined, setGcJoined] = useState(false);
  const [gcMicOn, setGcMicOn] = useState(true);
  const [gcRemoteStreams, setGcRemoteStreams] = useState<Record<string, MediaStream>>({});
  const gcPcsRef = useRef<Map<string, RTCPeerConnection>>(new Map());
  const gcLocalStreamRef = useRef<MediaStream | null>(null);
  const [editingGroupName, setEditingGroupName] = useState('');
  const [addMemberId, setAddMemberId] = useState('');
  const [notifEnabled, setNotifEnabled] = useState(() => {
    try { return localStorage.getItem('boostpay_chat_notif') !== 'off'; } catch { return true; }
  });
  const [soundEnabled, setSoundEnabled] = useState(() => {
    try { return localStorage.getItem('boostpay_chat_sound') !== 'off'; } catch { return true; }
  });
  const typingTimeoutRef = useRef<number | null>(null);
  const peerTypingTimeoutRef = useRef<number | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [isNewChatOpen, setIsNewChatOpen] = useState(false);
  const [newPeerId, setNewPeerId] = useState('');
  const [newChatError, setNewChatError] = useState('');
  const [newChatMode, setNewChatMode] = useState<'DM' | 'GROUP'>('DM');
  const [groupName, setGroupName] = useState('');
  const [groupMemberIds, setGroupMemberIds] = useState<string[]>([]);
  const [groupSuggestions, setGroupSuggestions] = useState<{ id: string; email: string }[]>([]);
  const [isCreatingGroup, setIsCreatingGroup] = useState(false);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [copiedMsgId, setCopiedMsgId] = useState<string | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const peerIdToUse = initialPeerId || targetPeerId;

  // Load blocked users
  useEffect(() => {
    void BoostPayStore.getBlockedIds().then(setBlockedIds);
  }, [currentUser.id]);

  // Real-time Server-Sent Events (SSE) Stream + Initial Sync
  useEffect(() => {
    BoostPayStore.syncChatState(currentUser.id);

    const unsubscribeStream = BoostPayStore.initChatStream(currentUser.id);

    const unsubscribeLocal = BoostPayStore.subscribeToChat((convs, msgs) => {
      setConversations(convs);
      setMessages(msgs);
    });

    return () => {
      unsubscribeStream();
      unsubscribeLocal();
    };
  }, [currentUser.id]);

  // Keep activeConv synchronized with latest conversation state
  useEffect(() => {
    if (activeConv) {
      const fresh = conversations.find(c => c.id === activeConv.id);
      if (fresh && (fresh.lastMessageAt !== activeConv.lastMessageAt || fresh.lastMessage !== activeConv.lastMessage)) {
        setActiveConv(fresh);
      }
    }
  }, [conversations, activeConv]);

  // Auto-scroll to latest message whenever messages change or active conversation opens
  useEffect(() => {
    if (activeConv) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, activeConv?.id]);

  // Auto-focus input when active conversation opens
  useEffect(() => {
    if (activeConv) {
      setTimeout(() => {
        inputRef.current?.focus();
      }, 100);
    }
  }, [activeConv?.id]);

  // Auto-focus conversation if initiated from Leaderboard or prop
  useEffect(() => {
    if (peerIdToUse) {
      openConversationWithPeer(peerIdToUse);
    }
  }, [peerIdToUse, currentUser.id]);

  const openConversationWithPeer = (peerId: string) => {
    const cleanPeer = peerId.trim();
    if (!cleanPeer || cleanPeer === currentUser.id) return;

    const canonicalId = BoostPayStore.getCanonicalConversationId(currentUser.id, cleanPeer);
    const allConvs = BoostPayStore.getConversations();
    let existing = allConvs.find(c => c.id === canonicalId);

    if (!existing) {
      existing = {
        id: canonicalId,
        participants: cleanPeer === 'ADMIN_SUPPORT'
          ? [currentUser.id, 'ADMIN_SUPPORT']
          : [currentUser.id, cleanPeer].sort((a, b) => a.localeCompare(b, undefined, { numeric: true })),
        lastMessage: cleanPeer === 'ADMIN_SUPPORT' ? 'Official Support Channel' : 'Conversation initiated',
        lastMessageAt: Date.now()
      };
      allConvs.unshift(existing);
      BoostPayStore.saveConversations(allConvs);
      setConversations(allConvs);
    }
    setActiveConv(existing);
  };

  const openSavedMessages = () => {
    const canonicalId = BoostPayStore.getCanonicalConversationId(currentUser.id, currentUser.id);
    const allConvs = BoostPayStore.getConversations();
    let existing = allConvs.find(c => c.id === canonicalId);
    if (!existing) {
      existing = {
        id: canonicalId,
        participants: [currentUser.id, currentUser.id],
        lastMessage: 'Saved Messages',
        lastMessageAt: Date.now()
      };
      allConvs.unshift(existing);
      BoostPayStore.saveConversations(allConvs);
      setConversations(allConvs);
    }
    setActiveConv(existing);
  };

  // Strictly filter conversations so the user only sees threads they are part of
  const userConversations = conversations.filter(c =>
    Array.isArray(c.participants) && c.participants.includes(currentUser.id)
  );

  const filteredConversations = userConversations.filter(c =>
    c.id.toLowerCase().includes(searchTerm.toLowerCase()) ||
    c.participants.some(p => p.toLowerCase().includes(searchTerm.toLowerCase()))
  );

  const getOtherParticipant = (conv: Conversation): string => {
    if (conv.type === 'group') return conv.id;
    if ((conv.participants || []).every(p => p === currentUser.id)) return currentUser.id; // Saved Messages
    return conv.participants.find(p => p !== currentUser.id) || (conv.participants.includes('ADMIN_SUPPORT') ? 'ADMIN_SUPPORT' : 'Support');
  };

  const getConvTitle = (conv: Conversation): string => {
    if (conv.type === 'group') return conv.name || 'Group chat';
    if ((conv.participants || []).every(p => p === currentUser.id)) return 'Saved Messages';
    const other = conv.participants.find(p => p !== currentUser.id);
    if (other === 'ADMIN_SUPPORT' || conv.participants.includes('ADMIN_SUPPORT')) return 'Official Verified Support';
    return `User #${other}`;
  };

  const openNewChatModal = async () => {
    setIsNewChatOpen(true);
    setNewChatMode('DM');
    setNewChatError('');
    setGroupName('');
    setGroupMemberIds([]);
    const suggestions = await BoostPayStore.getGroupSuggestions();
    setGroupSuggestions(suggestions);
  };

  const handleCreateGroup = async (e: React.FormEvent) => {
    e.preventDefault();
    setNewChatError('');
    if (!groupName.trim()) {
      setNewChatError('Give the group a name.');
      return;
    }
    if (groupMemberIds.length < 2) {
      setNewChatError('Pick at least 2 other members.');
      return;
    }
    setIsCreatingGroup(true);
    try {
      const conv = await BoostPayStore.createGroup(groupName.trim(), groupMemberIds);
      setIsNewChatOpen(false);
      setActiveConv(conv);
    } catch (err: any) {
      setNewChatError(err.message || 'Could not create the group.');
    } finally {
      setIsCreatingGroup(false);
    }
  };

  const handleStartNewConversation = (e: React.FormEvent) => {
    e.preventDefault();
    setNewChatError('');
    const cleanId = newPeerId.trim();

    if (!cleanId) {
      setNewChatError('Please enter a numeric User ID');
      return;
    }

    if (cleanId === currentUser.id) {
      setNewChatError('You cannot chat with yourself');
      return;
    }

    const allUsers = BoostPayStore.getUsers();
    const peerExists = allUsers.some(u => u.id === cleanId);
    if (!peerExists) {
      setNewChatError(`User #${cleanId} not found in system.`);
      return;
    }

    openConversationWithPeer(cleanId);
    setIsNewChatOpen(false);
    setNewPeerId('');
  };

  // ------------------------- TELEGRAM-STYLE FEATURES -------------------------
  useEffect(() => {
    const unsub = BoostPayStore.onTyping((ev) => {
      if (activeConv && ev.conversationId === activeConv.id && ev.userId !== currentUser.id) {
        setPeerTyping(true);
        if (peerTypingTimeoutRef.current) clearTimeout(peerTypingTimeoutRef.current);
        peerTypingTimeoutRef.current = window.setTimeout(() => setPeerTyping(false), 3000);
      }
    });
    return unsub;
  }, [activeConv?.id, currentUser.id]);

  useEffect(() => {
    let alive = true;
    const poll = async () => {
      const ids = await BoostPayStore.getPresence();
      if (alive) setOnlineIds(ids);
    };
    void poll();
    const iv = window.setInterval(poll, 20000);
    return () => { alive = false; clearInterval(iv); };
  }, []);

  // Read receipts: mark the open conversation as read whenever new content lands
  useEffect(() => {
    if (!activeConv) return;
    void BoostPayStore.markConversationRead(activeConv.id);
  }, [activeConv?.id, messages.length]);

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeConv || !inputMsg.trim() || isSending) return;

    const textToSend = inputMsg.trim();

    // Edit mode: update the message instead of sending a new one
    if (editing) {
      const ok = await BoostPayStore.editMessage(editing.id, textToSend);
      if (ok) {
        setMessages(prev => prev.map(m => m.id === editing.id ? { ...m, text: textToSend, editedAt: Date.now() } : m));
      }
      setEditing(null);
      setInputMsg('');
      return;
    }

    setInputMsg('');
    setShowEmojiPicker(false);
    setIsSending(true);
    setReplyTo(null);

    // Groups: send to the group conversation ID; DMs: send to the peer
    const recipient = activeConv.type === 'group' ? activeConv.id : getOtherParticipant(activeConv);

    try {
      await BoostPayStore.sendChatMessage(recipient, textToSend, 'USER', undefined, undefined, {
        replyTo: replyTo ? { id: replyTo.id, text: replyTo.text || '', senderId: replyTo.senderId } : null
      });
    } finally {
      setIsSending(false);
      setTimeout(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
      }, 50);
    }
  };

  const handleInputChange = (v: string) => {
    setInputMsg(v);
    if (activeConv && v.trim()) {
      if (!typingTimeoutRef.current) {
        void BoostPayStore.sendTyping(activeConv.id);
        typingTimeoutRef.current = window.setTimeout(() => { typingTimeoutRef.current = null; }, 2500);
      }
    }
  };

  const handleReply = (m: Message) => { setReplyTo(m); setEditing(null); inputRef.current?.focus(); };
  const handleForwardStart = (m: Message) => setForwardMsg(m);
  const handlePin = async (m: Message) => {
    const ok = await BoostPayStore.togglePin(m.id, !m.pinned);
    if (ok) setMessages(prev => prev.map(x => x.id === m.id ? { ...x, pinned: !m.pinned } : x));
  };
  const handleEdit = (m: Message) => { setEditing(m); setReplyTo(null); setInputMsg(m.text); inputRef.current?.focus(); };
  const handleDelete = async (m: Message) => {
    if (!window.confirm('Delete this message for everyone?')) return;
    const ok = await BoostPayStore.deleteMessage(m.id);
    if (ok) setMessages(prev => prev.map(x => x.id === m.id ? { ...x, deleted: true, text: '🚫 Message deleted', kind: 'text' } : x));
  };
  const handleForwardSend = async (targetConv: Conversation) => {
    if (!forwardMsg) return;
    const recipient = targetConv.type === 'group' ? targetConv.id : getOtherParticipant(targetConv);
    const text = forwardMsg.kind === 'photo' ? '📷 Photo' : forwardMsg.kind === 'voice' ? '🎤 Voice message' : forwardMsg.text;
    await BoostPayStore.sendChatMessage(recipient, text, 'USER', undefined, undefined, {
      forwardedFrom: String(forwardMsg.senderId),
      ...(forwardMsg.kind === 'photo' && forwardMsg.photoData ? { photoData: forwardMsg.photoData } : {})
    });
    setForwardMsg(null);
    if (targetConv.id === activeConv?.id) {
      setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 80);
    }
  };

  // ───────────────── STICKERS / FILES / POLLS / CONTACTS / INFO ─────────────────
  const STICKER_PALETTE = ['😀', '😂', '🥰', '😎', '🤩', '😭', '😡', '👍', '👎', '🙏', '👏', '💪', '🔥', '💯', '🎉', '❤️', '💔', '✨', '⭐', '💎', '🚀', '☕', '🍕', '🏆'];

  const handleSendSticker = async (emoji: string) => {
    if (!activeConv) return;
    setShowStickerPicker(false);
    const recipient = activeConv.type === 'group' ? activeConv.id : getOtherParticipant(activeConv);
    await BoostPayStore.sendChatMessage(recipient, emoji, 'USER', undefined, undefined, { stickerEmoji: emoji });
    setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 80);
  };

  const handleSendFile = (file: File) => {
    if (!activeConv) return;
    if (file.size > 4 * 1024 * 1024) {
      void BoostPayStore.triggerToast('File is too large (max 4MB).');
      return;
    }
    const reader = new FileReader();
    reader.onload = async () => {
      const dataUrl = String(reader.result || '');
      const recipient = activeConv.type === 'group' ? activeConv.id : getOtherParticipant(activeConv);
      await BoostPayStore.sendChatMessage(recipient, `📎 ${file.name}`, 'USER', undefined, undefined, {
        fileData: dataUrl,
        fileName: file.name,
        fileSize: file.size
      });
      setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 80);
    };
    reader.readAsDataURL(file);
  };

  const handleSendPoll = async () => {
    if (!activeConv) return;
    const q = pollQuestion.trim();
    const opts = pollOptions.map(o => o.trim()).filter(Boolean);
    if (!q || opts.length < 2) {
      void BoostPayStore.triggerToast('Poll needs a question and at least 2 options.');
      return;
    }
    const recipient = activeConv.type === 'group' ? activeConv.id : getOtherParticipant(activeConv);
    await BoostPayStore.sendChatMessage(recipient, `📊 Poll: ${q}`, 'USER', undefined, undefined, {
      poll: { question: q, options: opts.map(t => ({ text: t, votes: [] })) }
    });
    setShowPollCreator(false);
    setPollQuestion('');
    setPollOptions(['', '']);
    setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 80);
  };

  const handleSendContact = async (contactId: string) => {
    if (!activeConv) return;
    setShowContactPicker(false);
    const recipient = activeConv.type === 'group' ? activeConv.id : getOtherParticipant(activeConv);
    await BoostPayStore.sendChatMessage(recipient, '👤 Contact card', 'USER', undefined, undefined, { contactId });
    setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 80);
  };

  const handleVotePoll = async (m: Message, optionIndex: number) => {
    const poll = await BoostPayStore.pollVote(m.id, optionIndex);
    if (poll) setMessages(prev => prev.map(x => x.id === m.id ? { ...x, poll } : x));
  };

  const handleBlockToggle = async () => {
    if (!activeConv || activeConv.type === 'group') return;
    const peerId = getOtherParticipant(activeConv);
    const isBlocked = blockedIds.includes(peerId);
    const ok = await BoostPayStore.blockUser(peerId, !isBlocked);
    if (ok) {
      setBlockedIds(prev => isBlocked ? prev.filter(id => id !== peerId) : [...prev, peerId]);
      void BoostPayStore.triggerToast(isBlocked ? `Unblocked User #${peerId}` : `Blocked User #${peerId}`);
    }
  };
  const isPeerBlocked = activeConv && activeConv.type !== 'group' ? blockedIds.includes(getOtherParticipant(activeConv)) : false;

  // ───────────────── GROUP CALL (MESH) ─────────────────
  const gcEnsurePeer = (peerId: string): RTCPeerConnection => {
    let pc = gcPcsRef.current.get(peerId);
    if (pc) return pc;
    pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
    gcPcsRef.current.set(peerId, pc);
    if (gcLocalStreamRef.current) {
      for (const track of gcLocalStreamRef.current.getTracks()) {
        pc.addTrack(track, gcLocalStreamRef.current);
      }
    }
    pc.onicecandidate = (ev) => {
      if (ev.candidate && activeConv) {
        void BoostPayStore.sendCallSignal(peerId, { kind: 'candidate', candidate: ev.candidate, groupId: activeConv.id, gc: true });
      }
    };
    pc.ontrack = (ev) => {
      const [stream] = ev.streams;
      if (stream) setGcRemoteStreams(prev => ({ ...prev, [peerId]: stream }));
    };
    return pc;
  };

  const gcCleanupPeer = (peerId: string) => {
    const pc = gcPcsRef.current.get(peerId);
    if (pc) { try { pc.close(); } catch { /* ignore */ } }
    gcPcsRef.current.delete(peerId);
    setGcRemoteStreams(prev => {
      const next = { ...prev };
      delete next[peerId];
      return next;
    });
  };

  const gcTeardown = () => {
    for (const pid of Array.from(gcPcsRef.current.keys())) gcCleanupPeer(pid);
    if (gcLocalStreamRef.current) {
      for (const t of gcLocalStreamRef.current.getTracks()) t.stop();
      gcLocalStreamRef.current = null;
    }
    setGcJoined(false);
    setGcRemoteStreams({});
    setGcMicOn(true);
  };

  const joinGroupCall = async () => {
    if (!activeConv) return;
    try {
      let call = gcCall;
      if (!call || call.conversationId !== activeConv.id) {
        call = await BoostPayStore.gcJoin(activeConv.id, gcCall?.callId || '');
        if (!call) call = await BoostPayStore.gcStart(activeConv.id);
      }
      if (!call) { void BoostPayStore.triggerToast('Could not join the group call.'); return; }
      setGcCall(call);
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      gcLocalStreamRef.current = stream;
      setGcJoined(true);
      const me = currentUser.id;
      for (const pt of (call.participants || [])) {
        if (pt.userId === me) continue;
        const pc = gcEnsurePeer(pt.userId);
        const initiator = me.localeCompare(pt.userId, undefined, { numeric: true }) < 0;
        if (initiator) {
          const offer = await pc.createOffer();
          await pc.setLocalDescription(offer);
          void BoostPayStore.sendCallSignal(pt.userId, { kind: 'offer', sdp: offer.sdp, groupId: activeConv.id, gc: true });
        }
      }
    } catch {
      void BoostPayStore.triggerToast('Microphone permission is required for group calls.');
    }
  };

  const leaveGroupCall = async () => {
    if (!activeConv) return;
    await BoostPayStore.gcLeave(activeConv.id);
    gcTeardown();
    setGcCall(null);
  };

  const toggleGcMic = () => {
    const next = !gcMicOn;
    setGcMicOn(next);
    if (gcLocalStreamRef.current) {
      for (const t of gcLocalStreamRef.current.getTracks()) t.enabled = next;
    }
  };

  // Group-call room events over SSE
  useEffect(() => {
    const unsub = BoostPayStore.onGroupCall((data: any) => {
      if (!activeConv || data.conversationId !== activeConv.id) return;
      if (data.action === 'ended') {
        gcTeardown();
        setGcCall(null);
        return;
      }
      setGcCall(data.call || null);
      // Drop peers that left the room
      const ids = new Set<string>(((data.call && data.call.participants) || []).map((p: any) => p.userId));
      for (const pid of Array.from(gcPcsRef.current.keys())) {
        if (!ids.has(pid) || pid === currentUser.id) gcCleanupPeer(pid);
      }
    });
    return unsub;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeConv?.id, currentUser.id]);

  // Mesh SDP/ICE for group calls (piggybacks the call-signal stream)
  useEffect(() => {
    const unsub = BoostPayStore.onCallSignal(async ({ from, signal }) => {
      if (!signal || signal.gc !== true || !gcJoined) return;
      if (!activeConv || signal.groupId !== activeConv.id) return;
      try {
        if (signal.kind === 'offer' && signal.sdp) {
          const pc = gcEnsurePeer(from);
          await pc.setRemoteDescription({ type: 'offer', sdp: signal.sdp });
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          void BoostPayStore.sendCallSignal(from, { kind: 'answer', sdp: answer.sdp, groupId: activeConv.id, gc: true });
        } else if (signal.kind === 'answer' && signal.sdp) {
          const pc = gcPcsRef.current.get(from);
          if (pc) await pc.setRemoteDescription({ type: 'answer', sdp: signal.sdp });
        } else if (signal.kind === 'candidate' && signal.candidate) {
          const pc = gcPcsRef.current.get(from);
          if (pc) await pc.addIceCandidate(signal.candidate).catch(() => {});
        }
      } catch { /* ignore negotiation errors */ }
    });
    return unsub;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gcJoined, activeConv?.id, currentUser.id]);

  // Detect ongoing group call when opening a group
  useEffect(() => {
    let alive = true;
    setGcCall(null);
    if (activeConv && activeConv.type === 'group') {
      void BoostPayStore.gcState(activeConv.id).then((call) => {
        if (alive && call) setGcCall(call);
      });
    }
    return () => { alive = false; };
  }, [activeConv?.id]);

  // Leaving the chat view tears the call down locally
  useEffect(() => {
    return () => {
      if (gcLocalStreamRef.current) {
        for (const t of gcLocalStreamRef.current.getTracks()) t.stop();
      }
      for (const pc of gcPcsRef.current.values()) { try { pc.close(); } catch { /* ignore */ } }
    };
  }, []);

  // ───────────────── GROUP DISCOVERY / INVITE / REQUESTS ─────────────────
  const loadDiscover = async () => {
    setShowDiscover(true);
    setDiscoverGroups(await BoostPayStore.discoverGroups());
  };

  const handleDiscoverJoin = async (g: { id: string; name: string }) => {
    const res = await BoostPayStore.groupJoin({ conversationId: g.id });
    if (!res.ok) {
      void BoostPayStore.triggerToast(res.error || 'Could not join.');
      return;
    }
    if (res.pending) {
      void BoostPayStore.triggerToast('Join request sent — waiting for creator approval.');
    } else {
      void BoostPayStore.triggerToast(`Joined ${g.name}`);
      if (res.conversation) {
        setConversations(prev => {
          const idx = prev.findIndex(c => c.id === res.conversation.id);
          return idx >= 0 ? prev.map(c => c.id === res.conversation.id ? res.conversation : c) : [res.conversation, ...prev];
        });
        setActiveConv(res.conversation);
        setShowDiscover(false);
      }
    }
    setDiscoverGroups(await BoostPayStore.discoverGroups());
  };

  const handleGenerateInvite = async () => {
    if (!activeConv) return;
    const res = await BoostPayStore.groupInvite(activeConv.id);
    if (res) {
      setInviteLink(res.url);
      void copyToClipboard(res.url).then((ok) => {
        if (ok) {
          setInviteCopied(true);
          setTimeout(() => setInviteCopied(false), 1500);
        }
      });
    }
  };

  const handleJoinRequest = async (userId: string, approve: boolean) => {
    if (!activeConv) return;
    const ok = await BoostPayStore.groupRequestResolve(activeConv.id, userId, approve);
    if (ok) {
      setConversations(prev => prev.map(c => {
        if (c.id !== activeConv.id) return c;
        const joinRequests = (c.joinRequests || []).filter(r => r.userId !== userId);
        const participants = approve ? Array.from(new Set([...(c.participants || []), userId])) : (c.participants || []);
        return { ...c, joinRequests, participants };
      }));
      setActiveConv(prev => {
        if (!prev || prev.id !== activeConv.id) return prev;
        const joinRequests = (prev.joinRequests || []).filter(r => r.userId !== userId);
        const participants = approve ? Array.from(new Set([...(prev.participants || []), userId])) : (prev.participants || []);
        return { ...prev, joinRequests, participants };
      });
    }
  };

  const handlePrivacyToggle = async (isPublic: boolean) => {
    if (!activeConv) return;
    const ok = await BoostPayStore.groupPrivacy(activeConv.id, isPublic, !!activeConv.joinApprovalRequired);
    if (ok) setActiveConv(prev => prev ? { ...prev, isPublic } : prev);
  };

  const handleApprovalToggle = async (joinApprovalRequired: boolean) => {
    if (!activeConv) return;
    const ok = await BoostPayStore.groupPrivacy(activeConv.id, !!activeConv.isPublic, joinApprovalRequired);
    if (ok) setActiveConv(prev => prev ? { ...prev, joinApprovalRequired } : prev);
  };
  const handleSendPhoto = (file: File) => {
    if (!activeConv || file.size > 4 * 1024 * 1024) {
      window.alert('Please choose an image under 4 MB.');
      return;
    }
    const reader = new FileReader();
    reader.onloadend = async () => {
      const dataUrl = String(reader.result || '');
      if (!dataUrl.startsWith('data:image/')) return;
      const recipient = activeConv.type === 'group' ? activeConv.id : getOtherParticipant(activeConv);
      await BoostPayStore.sendChatMessage(recipient, '📷 Photo', 'USER', undefined, undefined, {
        photoData: dataUrl,
        replyTo: replyTo ? { id: replyTo.id, text: replyTo.text || '', senderId: replyTo.senderId } : null
      });
      setReplyTo(null);
      setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 80);
    };
    reader.readAsDataURL(file);
  };
  const handleToggleMute = async () => {
    if (!activeConv) return;
    const muted = !(activeConv.mutedBy || []).includes(currentUser.id);
    await BoostPayStore.setConversationMute(activeConv.id, muted);
    setActiveConv(prev => prev ? { ...prev, mutedBy: muted ? [...(prev.mutedBy || []), currentUser.id] : (prev.mutedBy || []).filter(u => u !== currentUser.id) } : prev);
  };
  const toggleNotif = () => {
    const v = !notifEnabled;
    setNotifEnabled(v);
    try { localStorage.setItem('boostpay_chat_notif', v ? 'on' : 'off'); } catch { /* ignore */ }
  };
  const toggleSound = () => {
    const v = !soundEnabled;
    setSoundEnabled(v);
    try { localStorage.setItem('boostpay_chat_sound', v ? 'on' : 'off'); } catch { /* ignore */ }
  };

  // ------------------------- VOICE NOTES -------------------------
  const stopRecordingCleanup = () => {
    if (recTimerRef.current) { clearInterval(recTimerRef.current); recTimerRef.current = null; }
    try { recMediaRef.current?.stream.getTracks().forEach(t => t.stop()); } catch { /* already stopped */ }
    recMediaRef.current = null;
    setIsRecording(false);
    setRecSeconds(0);
  };

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus']
        .find((t) => (window as any).MediaRecorder && MediaRecorder.isTypeSupported(t)) || '';
      const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      recChunksRef.current = [];
      rec.ondataavailable = (e) => { if (e.data && e.data.size > 0) recChunksRef.current.push(e.data); };
      rec.start();
      recMediaRef.current = rec;
      setIsRecording(true);
      setRecSeconds(0);
      recTimerRef.current = window.setInterval(() => setRecSeconds(s => s + 1), 1000);
    } catch {
      BoostPayStore.triggerToast({ type: 'ERROR', title: 'Microphone blocked', message: 'Allow microphone access to record voice messages.' } as any);
    }
  };

  const cancelRecording = () => {
    try { recMediaRef.current?.stop(); } catch { /* noop */ }
    recChunksRef.current = [];
    stopRecordingCleanup();
  };

  const sendRecording = async () => {
    const rec = recMediaRef.current;
    const conv = activeConv;
    if (!rec || !conv) return;
    const chunks = recChunksRef.current;
    const ms = recSeconds * 1000;
    rec.onstop = async () => {
      stopRecordingCleanup();
      if (!chunks.length) return;
      const blob = new Blob(chunks, { type: chunks[0].type || 'audio/webm' });
      if (blob.size > 2 * 1024 * 1024) {
        BoostPayStore.triggerToast({ type: 'ERROR', title: 'Voice message too long', message: 'Keep voice notes under 2 minutes.' } as any);
        return;
      }
      const reader = new FileReader();
      reader.onloadend = async () => {
        const dataUrl = String(reader.result || '');
        if (!dataUrl.startsWith('data:audio/')) return;
        const recipient = conv.type === 'group' ? conv.id : getOtherParticipant(conv);
        await BoostPayStore.sendChatMessage(recipient, '🎤 Voice message', 'USER', undefined, { data: dataUrl, durationMs: ms });
        setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 50);
      };
      reader.readAsDataURL(blob);
    };
    try { rec.stop(); } catch { stopRecordingCleanup(); }
  };

  const handleToggleReaction = async (messageId: string, emoji: string) => {
    await BoostPayStore.toggleMessageReaction(messageId, emoji, currentUser.id);
  };

  const handleCopyMessageText = async (text: string) => {
    const success = await copyToClipboard(text);
    if (success) {
      setCopiedMsgId('COPIED_TEMP');
      setTimeout(() => setCopiedMsgId(null), 1500);
    }
  };

  const handleAddEmojiToInput = (emoji: string) => {
    setInputMsg(prev => prev + emoji);
    inputRef.current?.focus();
  };

  return (
    <div className="w-full flex-1 flex flex-col min-h-0 overflow-hidden text-zinc-100">
      {/* 1. ACTIVE CHAT THREAD (FIXED FULLSCREEN VIEWPORT WITH LOCKED BOTTOM DOCK) */}
      {activeConv ? (
        <div className="flex-1 flex flex-col min-h-0 overflow-hidden bg-zinc-950">
          {/* Pinned Top Navigation Bar */}
          <div className="shrink-0 flex items-center justify-between border-b border-zinc-800 bg-zinc-950/95 backdrop-blur-md px-3.5 py-2.5 z-10">
            <div className="flex items-center gap-2.5 min-w-0">
              <button
                onClick={() => setActiveConv(null)}
                className="rounded-xl p-2 text-zinc-400 hover:bg-zinc-800 hover:text-white transition cursor-pointer min-w-[44px] min-h-[44px] flex items-center justify-center -ml-1 shrink-0"
                title="Back to conversations"
              >
                <ArrowLeft className="w-5 h-5" />
              </button>

              {/* Participant Avatar with Presence Dot */}
              <div className="relative shrink-0">
                <div className={`h-10 w-10 rounded-2xl bg-gradient-to-tr ${getAvatarGradient(getOtherParticipant(activeConv))} flex items-center justify-center text-white font-mono font-bold text-xs shadow-md`}>
                  {activeConv.type === 'group' ? (
                    <Users className="w-5 h-5 text-white" />
                  ) : getOtherParticipant(activeConv) === 'ADMIN_SUPPORT' ? (
                    <ShieldCheck className="w-5 h-5 text-white stroke-[2.2]" />
                  ) : (
                    `#${getOtherParticipant(activeConv)}`
                  )}
                </div>
                <span className={`absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full ring-2 ring-zinc-950 ${
                  activeConv.type !== 'group' && onlineIds.includes(getOtherParticipant(activeConv)) ? 'bg-emerald-500' : 'bg-zinc-600'
                }`} />
              </div>

              <div className="min-w-0">
                <div className="flex items-center gap-1.5 truncate">
                  {activeConv.type === 'group' ? (
                    <span className="text-xs font-bold font-mono text-zinc-100">
                      {activeConv.name || 'Group chat'}
                    </span>
                  ) : getOtherParticipant(activeConv) === 'ADMIN_SUPPORT' ? (
                    <span className="text-xs font-bold text-sky-400 font-mono flex items-center gap-1">
                      Official Verified Support
                    </span>
                  ) : (activeConv.participants || []).every(p => p === currentUser.id) ? (
                    <span className="text-xs font-bold font-mono text-amber-300 flex items-center gap-1">
                      <Bookmark className="w-3.5 h-3.5" /> Saved Messages
                    </span>
                  ) : (
                    <span className="text-xs font-bold font-mono text-zinc-100">
                      User #{getOtherParticipant(activeConv)}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2 text-[10px] text-zinc-400 font-mono">
                  {peerTyping ? (
                    <span className="flex items-center gap-1 text-amber-400 font-medium">
                      typing<span className="animate-pulse">…</span>
                    </span>
                  ) : activeConv.type !== 'group' && onlineIds.includes(getOtherParticipant(activeConv)) ? (
                    <span className="flex items-center gap-1 text-emerald-400 font-medium">
                      <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 inline-block" /> Active now
                    </span>
                  ) : (
                    <span className="text-zinc-500 font-medium">last seen recently</span>
                  )}
                </div>
              </div>
            </div>

            {/* Group voice call (mesh room) */}
            {activeConv.type === 'group' && (
              <div className="flex items-center gap-1.5 shrink-0">
                <button
                  onClick={() => { if (gcJoined) { void leaveGroupCall(); } else { void joinGroupCall(); } }}
                  title={gcJoined ? 'Leave group call' : gcCall ? 'Join group call' : 'Start group call'}
                  className={`flex h-9 items-center gap-1.5 rounded-2xl border px-3 transition cursor-pointer ${
                    gcJoined
                      ? 'border-red-500/50 bg-red-500/15 text-red-300 hover:bg-red-500/25'
                      : gcCall
                      ? 'border-emerald-500/50 bg-emerald-500/15 text-emerald-300 hover:bg-emerald-500/25 animate-pulse'
                      : 'border-zinc-800 bg-zinc-900 text-emerald-400 hover:border-emerald-500/50 hover:bg-emerald-500/10'
                  }`}
                >
                  <Phone className="w-4 h-4" />
                  <span className="text-[10px] font-bold">{gcJoined ? 'Leave' : gcCall ? 'Join' : 'Call'}</span>
                </button>
              </div>
            )}

            {/* Call actions (1:1 threads) — clean: only calls + info menu */}
            {activeConv.type !== 'group' && (
              <div className="flex items-center gap-1.5 shrink-0">
                <button
                  onClick={() => startCallTo(getOtherParticipant(activeConv), getConvTitle(activeConv), 'audio')}
                  title="Voice call"
                  className="flex h-9 w-9 items-center justify-center rounded-2xl border border-zinc-800 bg-zinc-900 text-emerald-400 hover:border-emerald-500/50 hover:bg-emerald-500/10 active:scale-95 transition cursor-pointer"
                >
                  <Phone className="w-4 h-4" />
                </button>
                <button
                  onClick={() => startCallTo(getOtherParticipant(activeConv), getConvTitle(activeConv), 'video')}
                  title="Video call"
                  className="flex h-9 w-9 items-center justify-center rounded-2xl border border-zinc-800 bg-zinc-900 text-sky-400 hover:border-sky-500/50 hover:bg-sky-500/10 active:scale-95 transition cursor-pointer"
                >
                  <Video className="w-4 h-4" />
                </button>
                <button
                  onClick={() => setShowChatMenu(s => !s)}
                  title="Chat info & actions"
                  className="flex h-9 w-9 items-center justify-center rounded-2xl border border-zinc-800 bg-zinc-900 text-zinc-400 hover:text-white hover:border-zinc-600 active:scale-95 transition cursor-pointer"
                >
                  <Info className="w-4 h-4" />
                </button>
              </div>
            )}
            {activeConv.type === 'group' && (
              <button
                onClick={() => { setShowGroupInfo(true); setEditingGroupName(activeConv.name || ''); }}
                title="Group info"
                className="flex h-9 w-9 items-center justify-center rounded-2xl border border-zinc-800 bg-zinc-900 text-zinc-400 hover:text-white hover:border-zinc-600 active:scale-95 transition cursor-pointer shrink-0"
              >
                <Users2 className="w-4 h-4" />
              </button>
            )}
          </div>

          {/* Compact Security Header */}
          <div className="shrink-0 mx-3 my-1.5 rounded-xl border border-red-500/20 bg-red-950/20 px-3 py-1.5 flex items-center gap-2 text-[10px] text-red-300">
            <ShieldAlert className="w-3.5 h-3.5 text-red-400 shrink-0" />
            <span className="truncate">Staff will never ask for your password or recovery phrase.</span>
          </div>

          {/* Search in conversation */}
          {showSearch && (
            <div className="shrink-0 mx-3 mb-1.5 flex items-center gap-2 rounded-xl border border-zinc-800 bg-zinc-900 px-3 py-2">
              <Search className="w-3.5 h-3.5 text-zinc-500" />
              <input
                autoFocus
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search messages..."
                className="flex-1 bg-transparent text-xs text-white placeholder-zinc-500 focus:outline-none"
              />
              <button onClick={() => { setShowSearch(false); setSearchQuery(''); }} className="text-zinc-500 hover:text-white cursor-pointer">
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          )}

          {/* Chat menu dropdown */}
          {showChatMenu && (
            <div className="shrink-0 mx-3 mb-1.5 rounded-2xl border border-zinc-800 bg-zinc-900/95 p-2 shadow-xl">
              <button
                onClick={() => { void handleToggleMute(); setShowChatMenu(false); }}
                className="w-full flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-xs text-zinc-200 hover:bg-zinc-800 transition cursor-pointer"
              >
                {(activeConv.mutedBy || []).includes(currentUser.id)
                  ? <BellOff className="w-4 h-4 text-zinc-400" />
                  : <Bell className="w-4 h-4 text-amber-400" />}
                {(activeConv.mutedBy || []).includes(currentUser.id) ? 'Unmute notifications' : 'Mute notifications'}
              </button>
              <button
                onClick={() => { setShowSearch(s => !s); setSearchQuery(''); setShowChatMenu(false); }}
                className="w-full flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-xs text-zinc-200 hover:bg-zinc-800 transition cursor-pointer"
              >
                <Search className="w-4 h-4 text-zinc-400" />
                {showSearch ? 'Hide search' : 'Search in chat'}
              </button>
              <button
                onClick={() => { void handleBlockToggle(); setShowChatMenu(false); }}
                className={`w-full flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-xs transition cursor-pointer ${isPeerBlocked ? 'text-red-400 hover:bg-red-500/10' : 'text-zinc-200 hover:bg-zinc-800'}`}
              >
                <span className="text-[11px] font-bold w-4 text-center">{isPeerBlocked ? '✓' : '⊘'}</span>
                {isPeerBlocked ? 'Unblock user' : 'Block user'}
              </button>
              <button
                onClick={() => { setShowSettings(true); setShowChatMenu(false); }}
                className="w-full flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-xs text-zinc-200 hover:bg-zinc-800 transition cursor-pointer"
              >
                <Settings className="w-4 h-4 text-zinc-400" />
                Chat settings
              </button>
              {activeConv.type === 'group' && (
                <button
                  onClick={() => { setShowGroupInfo(true); setEditingGroupName(activeConv.name || ''); setShowChatMenu(false); }}
                  className="w-full flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-xs text-zinc-200 hover:bg-zinc-800 transition cursor-pointer"
                >
                  <Users2 className="w-4 h-4 text-zinc-400" />
                  Group info
                </button>
              )}
            </div>
          )}

          {/* Pinned message banner */}
          {(() => {
            const pinned = messages.find(m => m.conversationId === activeConv.id && m.pinned && !m.deleted);
            if (!pinned) return null;
            return (
              <div className="shrink-0 mx-3 mb-1.5 rounded-xl border border-amber-500/25 bg-amber-500/10 px-3 py-1.5 flex items-center gap-2 text-[10px] text-amber-200">
                <Pin className="w-3 h-3 text-amber-400 shrink-0" />
                <span className="truncate flex-1">{pinned.text || 'Attachment'}</span>
                <button onClick={() => void handlePin(pinned)} className="text-amber-400/70 hover:text-amber-300 cursor-pointer">
                  <X className="w-3 h-3" />
                </button>
              </div>
            );
          })()}

          {/* Ongoing group call banner */}
          {activeConv.type === 'group' && gcCall && !gcJoined && (
            <div className="shrink-0 mx-3 mb-1.5 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="text-[10px] font-bold text-emerald-300">Group call in progress</div>
                <div className="text-[9px] text-emerald-200/70 font-mono">
                  {(gcCall.participants || []).map((pt: any) => `#${pt.userId}`).join(', ') || '…'}
                </div>
              </div>
              <button
                onClick={() => void joinGroupCall()}
                className="rounded-lg bg-emerald-500 px-3 py-1.5 text-[10px] font-bold text-zinc-950 hover:bg-emerald-400 active:scale-95 transition cursor-pointer"
              >
                Join
              </button>
            </div>
          )}

          {/* Active group call room bar */}
          {gcJoined && (
            <div className="shrink-0 mx-3 mb-1.5 rounded-xl border border-amber-500/30 bg-zinc-900/95 px-3 py-2 flex items-center gap-2">
              <Phone className="w-3.5 h-3.5 text-emerald-400 animate-pulse shrink-0" />
              <div className="flex-1 min-w-0 text-[10px] text-zinc-200 font-mono truncate">
                Group call · {Object.keys(gcRemoteStreams).length + 1} connected · {gcMicOn ? '🎤 on' : '🔇 muted'}
              </div>
              <button
                onClick={() => toggleGcMic()}
                className={`rounded-lg border px-2.5 py-1.5 transition cursor-pointer ${gcMicOn ? 'border-zinc-700 text-zinc-200 hover:border-zinc-500' : 'border-red-500/50 bg-red-500/15 text-red-300'}`}
                title={gcMicOn ? 'Mute mic' : 'Unmute mic'}
              >
                {gcMicOn ? <Mic className="w-3.5 h-3.5" /> : <MicOff className="w-3.5 h-3.5" />}
              </button>
              <button
                onClick={() => void leaveGroupCall()}
                className="rounded-lg bg-red-500 px-2.5 py-1.5 text-[10px] font-bold text-white hover:bg-red-400 transition cursor-pointer"
              >
                Leave
              </button>
            </div>
          )}

          {isPeerBlocked && (
            <div className="shrink-0 mx-3 my-1.5 rounded-xl border border-red-500/30 bg-red-950/30 px-3 py-2 flex items-center justify-between gap-2">
              <span className="text-[11px] text-red-300 font-medium">You blocked this user. Unblock to send messages.</span>
              <button onClick={() => void handleBlockToggle()} className="rounded-lg bg-zinc-800 px-3 py-1 text-[10px] font-bold text-zinc-200 hover:bg-zinc-700 transition cursor-pointer">Unblock</button>
            </div>
          )}

          {/* Messages Stream Viewport (Strictly Scrollable Middle Section) */}
          <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain space-y-3 px-3.5 py-2">
            {!searchQuery && (
              <div className="flex items-center justify-center my-1.5">
                <span className="rounded-full bg-zinc-900/90 border border-zinc-800 px-3 py-0.5 text-[10px] font-mono text-zinc-400 shadow-sm">
                  Secure Encrypted Stream
                </span>
              </div>
            )}

            {(() => {
              const convMsgs = messages.filter(m =>
                m.conversationId === activeConv.id &&
                (!searchQuery || (m.text || '').toLowerCase().includes(searchQuery.toLowerCase()))
              );
              const peerId = getOtherParticipant(activeConv);
              const peerLastRead = (activeConv.lastRead && (activeConv.lastRead as any)[peerId]) || 0;
              return convMsgs.map((m, i) => {
                const prev = convMsgs[i - 1];
                const showDate = !prev || new Date(prev.timestamp).toDateString() !== new Date(m.timestamp).toDateString();
                return (
                  <React.Fragment key={m.id}>
                    {showDate && (
                      <div className="flex items-center justify-center my-2">
                        <span className="rounded-full bg-zinc-900/90 border border-zinc-800 px-3 py-0.5 text-[10px] font-mono text-zinc-400">
                          {new Date(m.timestamp).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })}
                        </span>
                      </div>
                    )}
                    <MessageItem
                      m={m}
                      isMe={m.senderId === currentUser.id}
                      isAdmin={m.senderRole === 'ADMIN' || m.senderId === 'ADMIN_SUPPORT'}
                      currentUserId={currentUser.id}
                      onReact={handleToggleReaction}
                      onCopy={handleCopyMessageText}
                      copiedMsgId={copiedMsgId}
                      onReply={handleReply}
                      onForward={handleForwardStart}
                      onPin={handlePin}
                      onEdit={handleEdit}
                      onDelete={handleDelete}
                      showSeen={m.senderId === currentUser.id && peerLastRead > 0 && m.timestamp <= peerLastRead}
                      onOpenImage={setImageViewer}
                      onVotePoll={handleVotePoll}
                      onInfo={setInfoMsg}
                    />
                  </React.Fragment>
                );
              });
            })()}

            {messages.filter(m => m.conversationId === activeConv.id).length === 0 && (
              <div className="h-44 flex flex-col items-center justify-center text-center px-4">
                <div className="h-10 w-10 rounded-2xl bg-zinc-900 border border-zinc-800 flex items-center justify-center text-amber-400 mb-2">
                  <MessageSquare className="w-5 h-5 stroke-[1.8]" />
                </div>
                <h4 className="text-xs font-bold text-zinc-200">Say hello</h4>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Sticker picker */}
          {showStickerPicker && (
            <div className="shrink-0 px-3 py-2 border-t border-zinc-800/80 bg-zinc-900/95 backdrop-blur-md animate-in fade-in duration-100">
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-[9px] font-mono text-zinc-400 uppercase tracking-wider">Stickers</span>
                <button type="button" onClick={() => setShowStickerPicker(false)} className="text-zinc-500 hover:text-white cursor-pointer p-1">
                  <X className="w-3 h-3" />
                </button>
              </div>
              <div className="grid grid-cols-8 gap-1">
                {STICKER_PALETTE.map((emoji) => (
                  <button
                    key={emoji}
                    type="button"
                    onClick={() => void handleSendSticker(emoji)}
                    className="flex h-9 w-9 items-center justify-center rounded-xl hover:bg-zinc-800 text-xl transition-transform active:scale-125 cursor-pointer"
                  >
                    {emoji}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Collapsible Quick Emoji Bar */}
          {showEmojiPicker && (
            <div className="shrink-0 px-3 py-1.5 border-t border-zinc-800/80 bg-zinc-900/90 backdrop-blur-md flex items-center gap-1.5 animate-in fade-in duration-100">
              <span className="text-[9px] font-mono text-zinc-400 uppercase tracking-wider">Quick:</span>
              <div className="flex items-center gap-1">
                {EMOJI_PALETTE.map((emoji) => (
                  <button
                    key={emoji}
                    type="button"
                    onClick={() => handleAddEmojiToInput(emoji)}
                    className="flex h-7 w-7 items-center justify-center rounded-lg hover:bg-zinc-800 text-sm transition-transform active:scale-125 cursor-pointer"
                  >
                    {emoji}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* LOCKED BOTTOM INPUT DOCK (Permanently pinned at bottom above nav bar) */}
          <form
            onSubmit={handleSendMessage}
            className="relative shrink-0 p-2.5 border-t border-zinc-800 bg-zinc-950/95 backdrop-blur-xl flex items-center gap-2 z-10"
          >
            {/* Emoji button moved inside attachment menu */}

            {(replyTo || editing) && (
              <div className="absolute -top-11 left-2.5 right-2.5 flex items-center gap-2.5 rounded-2xl border border-zinc-800 bg-zinc-900/95 px-3 py-2 shadow-xl">
                <div className={`w-0.5 self-stretch rounded-full ${editing ? 'bg-emerald-400' : 'bg-amber-400'}`} />
                <div className="flex-1 min-w-0">
                  <div className={`text-[9px] font-bold font-mono ${editing ? 'text-emerald-400' : 'text-amber-400'}`}>
                    {editing ? 'Editing message' : `Reply to #${replyTo!.senderId}`}
                  </div>
                  <div className="text-[10px] text-zinc-400 truncate">
                    {(editing ? editing.text : replyTo!.text) || 'Attachment'}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => { setReplyTo(null); setEditing(null); setInputMsg(''); }}
                  className="text-zinc-500 hover:text-white p-1 cursor-pointer"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            )}
            {isRecording ? (
              <>
                <div className="flex-1 flex items-center gap-2.5 rounded-full border border-red-500/40 bg-red-950/30 px-4 py-2">
                  <span className="h-2.5 w-2.5 rounded-full bg-red-500 animate-pulse" />
                  <span className="text-xs font-mono text-red-300">Recording {Math.floor(recSeconds / 60)}:{String(recSeconds % 60).padStart(2, '0')}</span>
                  <span className="text-[9px] text-zinc-500 ml-auto">max 2 min</span>
                </div>
                <button
                  type="button"
                  onClick={cancelRecording}
                  className="rounded-2xl border border-zinc-800 bg-zinc-900 px-3 py-2.5 text-zinc-300 hover:text-white transition cursor-pointer min-h-[44px] shrink-0"
                  title="Cancel recording"
                >
                  <X className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={sendRecording}
                  className="rounded-2xl bg-red-500 px-4 py-2.5 text-white hover:bg-red-400 transition font-bold cursor-pointer active:scale-95 shadow-md shadow-red-500/20 min-h-[44px] min-w-[44px] flex items-center justify-center shrink-0"
                  title="Send voice message"
                >
                  <Send className="w-4 h-4 stroke-[2.2]" />
                </button>
              </>
            ) : (
              <>
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => setShowAttachmentMenu(v => !v)}
                    className={`rounded-2xl border px-3 py-2.5 transition cursor-pointer min-h-[44px] min-w-[44px] flex items-center justify-center shrink-0 ${showAttachmentMenu ? 'border-amber-500/50 bg-amber-500/15 text-amber-400' : 'border-zinc-800 bg-zinc-900 text-zinc-400 hover:text-zinc-200 hover:border-zinc-700'}`}
                    title="Attachments"
                  >
                    <Paperclip className="w-4 h-4" />
                  </button>
                  {showAttachmentMenu && (
                    <div className="absolute bottom-full left-0 mb-2 flex flex-col gap-1.5 rounded-2xl border border-zinc-800 bg-zinc-900 p-2 shadow-2xl min-w-[180px] z-20">
                      <label className="flex items-center gap-2.5 rounded-xl px-3 py-2 text-xs text-zinc-200 hover:bg-zinc-800 cursor-pointer transition">
                        <ImagePlus className="w-4 h-4 text-amber-400" /> Photo
                        <input type="file" accept="image/*" className="hidden" onChange={(e) => { const f = e.target.files && e.target.files[0]; if (f) { handleSendPhoto(f); setShowAttachmentMenu(false); } e.target.value = ''; }} />
                      </label>
                      <label className="flex items-center gap-2.5 rounded-xl px-3 py-2 text-xs text-zinc-200 hover:bg-zinc-800 cursor-pointer transition">
                        <Paperclip className="w-4 h-4 text-sky-400" /> File / Document
                        <input type="file" className="hidden" onChange={(e) => { const f = e.target.files && e.target.files[0]; if (f) { handleSendFile(f); setShowAttachmentMenu(false); } e.target.value = ''; }} />
                      </label>
                      {/* Sticker quick button hidden per user request (was causing send bug) */}
                      <button type="button" onClick={() => { setShowPollCreator(true); setShowAttachmentMenu(false); }} className="flex items-center gap-2.5 rounded-xl px-3 py-2 text-xs text-zinc-200 hover:bg-zinc-800 transition text-left">
                        <BarChart3 className="w-4 h-4 text-emerald-400" /> Poll
                      </button>
                      <button type="button" onClick={() => { setShowContactPicker(true); setShowAttachmentMenu(false); }} className="flex items-center gap-2.5 rounded-xl px-3 py-2 text-xs text-zinc-200 hover:bg-zinc-800 transition text-left">
                        <UserPlus className="w-4 h-4 text-sky-400" /> Contact
                      </button>
                      <button type="button" onClick={() => { setShowAttachmentMenu(false); setShowEmojiPicker(v=> !v); }} className="flex items-center gap-2.5 rounded-xl px-3 py-2 text-xs text-zinc-200 hover:bg-zinc-800 transition text-left">
                        <Smile className="w-4 h-4 text-amber-400" /> Insert Emoji
                      </button>
                    </div>
                  )}
                </div>
                <input
                  ref={inputRef}
                  type="text"
                  disabled={!!isPeerBlocked}
                  placeholder={isPeerBlocked ? 'You blocked this user' : (activeConv.participants || []).every(p => p === currentUser.id)
                    ? 'Write a note to yourself…'
                    : `Message ${getOtherParticipant(activeConv) === 'ADMIN_SUPPORT' ? 'Official Support' : `User #${getOtherParticipant(activeConv)}`}...`}
                  value={inputMsg}
                  onChange={(e) => handleInputChange(e.target.value)}
                  className={`flex-1 rounded-full border px-4 py-2.5 text-xs placeholder-zinc-500 focus:outline-none transition-colors ${isPeerBlocked ? 'border-zinc-800 bg-zinc-900/60 text-zinc-500 cursor-not-allowed' : 'border-zinc-800 bg-zinc-900 text-white focus:border-amber-500/60'}`}
                />

                <button
                  type="button"
                  onClick={startRecording}
                  className="rounded-2xl border border-zinc-800 bg-zinc-900 px-3 py-2.5 text-zinc-400 hover:text-amber-400 hover:border-amber-500/40 transition cursor-pointer min-h-[44px] min-w-[44px] flex items-center justify-center shrink-0"
                  title="Record voice message"
                >
                  <Mic className="w-4 h-4" />
                </button>

                <button
                  type="submit"
                  disabled={!inputMsg.trim() || isSending}
                  className="rounded-2xl bg-amber-500 px-4 py-2.5 text-zinc-950 hover:bg-amber-400 transition font-bold disabled:opacity-40 disabled:hover:bg-amber-500 cursor-pointer active:scale-95 shadow-md shadow-amber-500/20 min-h-[44px] min-w-[44px] flex items-center justify-center shrink-0"
                  title="Send message"
                >
                  <Send className="w-4 h-4 stroke-[2.2]" />
                </button>
              </>
            )}
          </form>
        </div>
      ) : (
        /* 2. CONVERSATION INBOX LIST VIEW */
        <div className="flex-1 flex flex-col min-h-0 overflow-hidden px-4 pt-3">
          <div className="shrink-0 flex items-center justify-between mb-3">
            <div>
              <h2 className="text-lg font-bold text-white tracking-tight">Messages</h2>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => void loadDiscover()}
                title="Discover public groups"
                className="flex items-center justify-center rounded-2xl border border-zinc-800 bg-zinc-900 px-3 text-emerald-400 hover:text-emerald-300 hover:border-emerald-500/40 transition cursor-pointer min-h-[44px]"
              >
                <Globe className="w-4 h-4" />
              </button>
              <button
                onClick={() => openSavedMessages()}
                title="Saved Messages"
                className="flex items-center justify-center rounded-2xl border border-zinc-800 bg-zinc-900 px-3 text-amber-400 hover:text-amber-300 hover:border-amber-500/40 transition cursor-pointer min-h-[44px]"
              >
                <Bookmark className="w-4 h-4" />
              </button>
              <button
                onClick={() => setShowSettings(true)}
                title="Chat settings"
                className="flex items-center justify-center rounded-2xl border border-zinc-800 bg-zinc-900 px-3 text-zinc-400 hover:text-white hover:border-zinc-600 transition cursor-pointer min-h-[44px]"
              >
                <Settings className="w-4 h-4" />
              </button>
              <button
                onClick={() => openNewChatModal()}
                className="flex items-center gap-1.5 rounded-2xl bg-amber-500 px-3 py-2 text-xs font-bold text-zinc-950 hover:bg-amber-400 transition shadow-md shadow-amber-500/20 cursor-pointer active:scale-95 min-h-[44px]"
              >
                <Plus className="w-4 h-4" /> New Chat
              </button>
            </div>
          </div>

          {/* 1-Tap Official Verified Support Glass Banner */}
          <div
            onClick={() => openConversationWithPeer('ADMIN_SUPPORT')}
            className="shrink-0 mb-3 relative overflow-hidden rounded-2xl border border-sky-500/30 bg-gradient-to-r from-sky-950/60 via-zinc-900/80 to-zinc-950 p-3.5 shadow-lg backdrop-blur-xl hover:border-sky-500/60 transition-all cursor-pointer group"
          >
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="rounded-xl p-2.5 bg-sky-500/20 text-sky-400 border border-sky-500/30 group-hover:scale-105 transition-transform">
                  <Headphones className="w-4 h-4 stroke-[2.2]" />
                </div>
                <div>
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs font-bold text-sky-400 font-mono flex items-center gap-1">
                      <ShieldCheck className="w-3.5 h-3.5 text-sky-400" /> Official Verified Support
                    </span>
                  </div>
                  <p className="text-[11px] text-zinc-300 mt-0.5">
                    Help with transfers, rates & account issues.
                  </p>
                </div>
              </div>
              <span className="shrink-0 text-[10px] font-mono text-sky-400 font-bold bg-sky-500/15 border border-sky-500/30 px-2 py-0.5 rounded-lg">
                Live
              </span>
            </div>
          </div>

          {/* Search bar */}
          <div className="shrink-0 relative mb-3">
            <Search className="absolute left-3.5 top-3 w-4 h-4 text-zinc-500" />
            <input
              type="text"
              placeholder="Search by User ID..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full rounded-2xl border border-zinc-800 bg-zinc-900 pl-10 pr-4 py-2.5 text-xs text-zinc-200 placeholder-zinc-500 focus:border-amber-500 focus:outline-none font-mono transition-colors"
            />
          </div>

          {/* Scrollable Conversations list */}
          <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain space-y-2 pb-4">
            {filteredConversations.map((conv) => {
              const other = getOtherParticipant(conv);
              const isSupport = other === 'ADMIN_SUPPORT';
              const gradient = getAvatarGradient(other);

              return (
                <button
                  key={conv.id}
                  onClick={() => setActiveConv(conv)}
                  className="w-full flex items-center justify-between rounded-2xl border border-zinc-800 bg-zinc-900/80 p-3 hover:border-zinc-700 hover:bg-zinc-900 transition-all text-left cursor-pointer shadow-sm"
                >
                  <div className="flex items-center gap-3 min-w-0 pr-2">
                    <div className="relative shrink-0">
                      <div className={`h-10 w-10 rounded-xl bg-gradient-to-tr ${gradient} flex items-center justify-center text-white font-mono font-bold text-xs shadow-md`}>
                        {conv.type === 'group' ? (
                          <Users className="w-4 h-4 text-white" />
                        ) : isSupport ? (
                          <ShieldCheck className="w-4 h-4 text-white stroke-[2.2]" />
                        ) : (
                          `#${other}`
                        )}
                      </div>
                      <span className={`absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full ring-2 ring-zinc-950 ${
                        conv.type !== 'group' && onlineIds.includes(other) ? 'bg-emerald-500' : 'bg-zinc-600'
                      }`} />
                    </div>

                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs font-bold font-mono text-zinc-100">
                          {conv.type === 'group'
                            ? conv.name || 'Group chat'
                            : isSupport ? 'Official Verified Support' : `User #${other}`}
                        </span>
                        {(conv.mutedBy || []).includes(currentUser.id) && (
                          <BellOff className="w-3 h-3 text-zinc-500 shrink-0" />
                        )}
                      </div>
                      <p className="text-[11px] text-zinc-400 truncate max-w-[200px] sm:max-w-xs mt-0.5">
                        {conv.lastMessage || 'No messages yet'}
                      </p>
                    </div>
                  </div>

                  <span className="text-[10px] font-mono text-zinc-500 shrink-0 self-start mt-0.5">
                    {new Date(conv.lastMessageAt || conv.timestamp || Date.now()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </span>
                </button>
              );
            })}

            {filteredConversations.length === 0 && (
              <div className="py-10 text-center text-xs text-zinc-500 border border-dashed border-zinc-800 rounded-2xl">
                No conversations yet.
              </div>
            )}
          </div>

          {/* New Chat / New Group Modal */}
          {isNewChatOpen && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md p-4 animate-in fade-in duration-150">
              <div className="relative w-full max-w-sm rounded-3xl border border-zinc-800 bg-zinc-900/95 p-5 shadow-2xl text-zinc-100 backdrop-blur-2xl">
                <h3 className="font-bold text-sm text-white mb-1">Start New Conversation</h3>
                <p className="text-xs text-zinc-400 mb-3">By numeric user ID, or start a group</p>

                {/* Mode switch */}
                <div className="flex rounded-2xl bg-zinc-950 p-1 mb-4 border border-zinc-800/80">
                  <button
                    type="button"
                    onClick={() => setNewChatMode('DM')}
                    className={`flex-1 rounded-xl py-2 text-[11px] font-semibold transition cursor-pointer ${newChatMode === 'DM' ? 'bg-amber-500 text-zinc-950 font-bold' : 'text-zinc-400 hover:text-zinc-200'}`}
                  >
                    Direct Message
                  </button>
                  <button
                    type="button"
                    onClick={() => setNewChatMode('GROUP')}
                    className={`flex-1 rounded-xl py-2 text-[11px] font-semibold transition cursor-pointer ${newChatMode === 'GROUP' ? 'bg-amber-500 text-zinc-950 font-bold' : 'text-zinc-400 hover:text-zinc-200'}`}
                  >
                    Group Chat
                  </button>
                </div>

                {newChatMode === 'DM' ? (
                  <form onSubmit={handleStartNewConversation} className="space-y-4">
                    <div>
                      <label className="block text-[11px] font-semibold text-zinc-300 font-mono mb-1.5">
                        Recipient User ID
                      </label>
                      <input
                        type="text"
                        placeholder="e.g. 2"
                        value={newPeerId}
                        onChange={(e) => setNewPeerId(e.target.value.replace(/\D/g, ''))}
                        className="w-full rounded-2xl border border-zinc-800 bg-zinc-950 p-3 text-xs font-mono text-zinc-100 focus:border-amber-500 focus:outline-none"
                        autoFocus
                      />
                    </div>

                    {newChatError && (
                      <p className="text-xs text-red-400 font-medium">{newChatError}</p>
                    )}

                    <div className="flex gap-2.5 pt-1">
                      <button
                        type="button"
                        onClick={() => setIsNewChatOpen(false)}
                        className="flex-1 rounded-2xl bg-zinc-800 py-2.5 text-xs font-semibold text-zinc-300 hover:bg-zinc-700 cursor-pointer min-h-[44px]"
                      >
                        Cancel
                      </button>
                      <button
                        type="submit"
                        className="flex-1 rounded-2xl bg-amber-500 py-2.5 text-xs font-bold text-zinc-950 hover:bg-amber-400 shadow-md shadow-amber-500/20 cursor-pointer active:scale-95 min-h-[44px]"
                      >
                        Open Chat
                      </button>
                    </div>
                  </form>
                ) : (
                  <form onSubmit={handleCreateGroup} className="space-y-4">
                    <div>
                      <label className="block text-[11px] font-semibold text-zinc-300 mb-1.5">Group name</label>
                      <input
                        type="text"
                        placeholder="e.g. Trading Squad"
                        value={groupName}
                        onChange={(e) => setGroupName(e.target.value.slice(0, 60))}
                        className="w-full rounded-2xl border border-zinc-800 bg-zinc-950 p-3 text-xs text-zinc-100 focus:border-amber-500 focus:outline-none"
                        autoFocus
                      />
                    </div>

                    <div>
                      <label className="block text-[11px] font-semibold text-zinc-300 mb-1.5">
                        Members ({groupMemberIds.length} selected)
                      </label>
                      <div className="max-h-44 overflow-y-auto rounded-2xl border border-zinc-800 bg-zinc-950 p-2 space-y-1">
                        {groupSuggestions.length === 0 && (
                          <p className="p-2 text-[11px] text-zinc-500">No other users found.</p>
                        )}
                        {groupSuggestions.map((u) => {
                          const checked = groupMemberIds.includes(u.id);
                          return (
                            <button
                              key={u.id}
                              type="button"
                              onClick={() =>
                                setGroupMemberIds((prev) =>
                                  checked ? prev.filter((x) => x !== u.id) : [...prev, u.id]
                                )
                              }
                              className={`flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left transition cursor-pointer ${checked ? 'bg-amber-500/15 border border-amber-500/40' : 'hover:bg-zinc-900 border border-transparent'}`}
                            >
                              <div className={`flex h-7 w-7 items-center justify-center rounded-lg font-mono text-[10px] font-bold ${checked ? 'bg-amber-500 text-zinc-950' : 'bg-zinc-800 text-zinc-400'}`}>
                                {checked ? <Check className="w-3.5 h-3.5" /> : `#${u.id}`}
                              </div>
                              <div className="min-w-0">
                                <p className="text-[11px] font-semibold text-zinc-200">User #{u.id}</p>
                                <p className="text-[10px] text-zinc-500 truncate">User #{u.id}</p>
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    {newChatError && (
                      <p className="text-xs text-red-400 font-medium">{newChatError}</p>
                    )}

                    <div className="flex gap-2.5 pt-1">
                      <button
                        type="button"
                        onClick={() => setIsNewChatOpen(false)}
                        className="flex-1 rounded-2xl bg-zinc-800 py-2.5 text-xs font-semibold text-zinc-300 hover:bg-zinc-700 cursor-pointer min-h-[44px]"
                      >
                        Cancel
                      </button>
                      <button
                        type="submit"
                        disabled={isCreatingGroup}
                        className="flex-1 rounded-2xl bg-amber-500 py-2.5 text-xs font-bold text-zinc-950 hover:bg-amber-400 shadow-md shadow-amber-500/20 cursor-pointer active:scale-95 min-h-[44px] disabled:opacity-60"
                      >
                        {isCreatingGroup ? 'Creating...' : 'Create Group'}
                      </button>
                    </div>
                  </form>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Forward message sheet */}
      {forwardMsg && (
        <div className="fixed inset-0 z-[120] flex items-end sm:items-center justify-center bg-black/70 backdrop-blur-sm p-0 sm:p-4" onClick={() => setForwardMsg(null)}>
          <div className="w-full max-w-md rounded-t-3xl sm:rounded-3xl border border-zinc-800 bg-zinc-900 p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-sm font-bold text-white mb-3">Forward message to</h3>
            <div className="max-h-72 overflow-y-auto overscroll-contain space-y-1.5">
              {userConversations.map((c) => (
                <button
                  key={c.id}
                  onClick={() => void handleForwardSend(c)}
                  className="w-full flex items-center gap-2.5 rounded-2xl border border-zinc-800 bg-zinc-950 px-3.5 py-2.5 text-left hover:border-amber-500/40 transition cursor-pointer"
                >
                  <div className={`h-8 w-8 rounded-xl bg-gradient-to-tr ${getAvatarGradient(getOtherParticipant(c))} flex items-center justify-center text-white font-mono text-[10px] font-bold`}>
                    {c.type === 'group' ? <Users className="w-3.5 h-3.5" /> : `#${getOtherParticipant(c)}`}
                  </div>
                  <span className="text-xs font-semibold text-zinc-200 truncate">
                    {getConvTitle(c)}
                  </span>
                </button>
              ))}
              {userConversations.length === 0 && (
                <p className="text-xs text-zinc-500 text-center py-4">No conversations yet.</p>
              )}
            </div>
            <button onClick={() => setForwardMsg(null)} className="mt-3 w-full rounded-2xl bg-zinc-800 py-2.5 text-xs font-semibold text-zinc-300 hover:bg-zinc-700 cursor-pointer">
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Group info sheet */}
      {showGroupInfo && activeConv && activeConv.type === 'group' && (
        <div className="fixed inset-0 z-[120] flex items-end sm:items-center justify-center bg-black/70 backdrop-blur-sm p-0 sm:p-4" onClick={() => setShowGroupInfo(false)}>
          <div className="w-full max-w-md rounded-t-3xl sm:rounded-3xl border border-zinc-800 bg-zinc-900 p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-sm font-bold text-white mb-3">Group Info</h3>
            <label className="text-[10px] text-zinc-500 font-semibold uppercase tracking-wider">Group name</label>
            <div className="mt-1 flex gap-2">
              <input
                value={editingGroupName}
                onChange={(e) => setEditingGroupName(e.target.value)}
                className="flex-1 rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-xs text-white focus:border-amber-500/60 focus:outline-none"
              />
              <button
                onClick={async () => {
                  if (!editingGroupName.trim()) return;
                  await BoostPayStore.updateConversation(activeConv.id, { name: editingGroupName.trim() });
                  setActiveConv(prev => prev ? { ...prev, name: editingGroupName.trim() } : prev);
                  setShowGroupInfo(false);
                }}
                className="rounded-xl bg-amber-500 px-4 text-xs font-bold text-zinc-950 hover:bg-amber-400 cursor-pointer"
              >
                Save
              </button>
            </div>

            <div className="mt-4 text-[10px] text-zinc-500 font-semibold uppercase tracking-wider">
              Members ({(activeConv.participants || []).length})
            </div>
            <div className="mt-1.5 max-h-40 overflow-y-auto overscroll-contain space-y-1">
              {(activeConv.participants || []).map((pid) => (
                <div key={pid} className="flex items-center justify-between rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2">
                  <span className="text-xs font-mono text-zinc-200">
                    {pid === currentUser.id ? `User #${pid} (You)` : `User #${pid}`}
                  </span>
                  {pid !== currentUser.id && (
                    <button
                      onClick={async () => {
                        await BoostPayStore.updateConversation(activeConv.id, { removeMembers: [pid] });
                        setActiveConv(prev => prev ? { ...prev, participants: (prev.participants || []).filter(x => x !== pid) } : prev);
                      }}
                      className="text-[10px] text-red-400 hover:text-red-300 cursor-pointer"
                    >
                      Remove
                    </button>
                  )}
                </div>
              ))}
            </div>

            <div className="mt-3 flex gap-2">
              <input
                value={addMemberId}
                onChange={(e) => setAddMemberId(e.target.value)}
                placeholder="Add member by ID (#12)"
                className="flex-1 rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-xs text-white placeholder-zinc-600 focus:border-amber-500/60 focus:outline-none"
              />
              <button
                onClick={async () => {
                  const raw = addMemberId.replace(/\D/g, '');
                  if (!raw) return;
                  await BoostPayStore.updateConversation(activeConv.id, { addMembers: [raw] });
                  setActiveConv(prev => prev ? { ...prev, participants: Array.from(new Set([...(prev.participants || []), raw])) } : prev);
                  setAddMemberId('');
                }}
                className="rounded-xl border border-zinc-800 bg-zinc-950 px-4 text-xs font-bold text-amber-400 hover:border-amber-500/40 cursor-pointer"
              >
                Add
              </button>
            </div>

            {/* Privacy (creator only) */}
            {String(activeConv.createdBy || '') === currentUser.id && (
              <div className="mt-4 rounded-2xl border border-zinc-800 bg-zinc-950 p-3 space-y-2">
                <div className="text-[10px] text-zinc-500 font-semibold uppercase tracking-wider">Privacy</div>
                <button
                  onClick={() => void handlePrivacyToggle(!activeConv.isPublic)}
                  className="w-full flex items-center justify-between rounded-xl border border-zinc-800 bg-zinc-900 px-3 py-2.5 cursor-pointer hover:border-zinc-700 transition"
                >
                  <span className="flex items-center gap-2 text-xs text-zinc-200">
                    {activeConv.isPublic ? <Globe className="w-3.5 h-3.5 text-emerald-400" /> : <Lock className="w-3.5 h-3.5 text-zinc-400" />}
                    {activeConv.isPublic ? 'Public group' : 'Private group'}
                  </span>
                  <span className={`text-[9px] font-bold px-2 py-0.5 rounded-full ${activeConv.isPublic ? 'bg-emerald-500/15 text-emerald-400' : 'bg-zinc-800 text-zinc-500'}`}>
                    {activeConv.isPublic ? 'DISCOVERABLE' : 'INVITE ONLY'}
                  </span>
                </button>
                <button
                  onClick={() => void handleApprovalToggle(!activeConv.joinApprovalRequired)}
                  className="w-full flex items-center justify-between rounded-xl border border-zinc-800 bg-zinc-900 px-3 py-2.5 cursor-pointer hover:border-zinc-700 transition"
                >
                  <span className="flex items-center gap-2 text-xs text-zinc-200">
                    <Eye className="w-3.5 h-3.5 text-sky-400" />
                    Join approval
                  </span>
                  <span className={`text-[9px] font-bold px-2 py-0.5 rounded-full ${activeConv.joinApprovalRequired ? 'bg-amber-500/15 text-amber-400' : 'bg-zinc-800 text-zinc-500'}`}>
                    {activeConv.joinApprovalRequired ? 'REQUIRED' : 'INSTANT'}
                  </span>
                </button>
              </div>
            )}

            {/* Invite link */}
            <div className="mt-3 rounded-2xl border border-zinc-800 bg-zinc-950 p-3">
              <div className="text-[10px] text-zinc-500 font-semibold uppercase tracking-wider mb-1.5">Invite link</div>
              <div className="flex items-center gap-2">
                <div className="flex-1 truncate rounded-xl border border-zinc-800 bg-zinc-900 px-3 py-2 text-[10px] font-mono text-zinc-300">
                  {inviteLink || (activeConv.inviteToken ? 'Tap Regenerate to copy the link' : 'No link yet')}
                </div>
                <button
                  onClick={() => void handleGenerateInvite()}
                  className="rounded-xl bg-amber-500 px-3 py-2 text-[10px] font-bold text-zinc-950 hover:bg-amber-400 cursor-pointer flex items-center gap-1"
                >
                  {inviteCopied ? <Check className="w-3 h-3" /> : <Link2 className="w-3 h-3" />}
                  {inviteCopied ? 'Copied' : 'Generate'}
                </button>
              </div>
            </div>

            {/* Join requests (creator only) */}
            {String(activeConv.createdBy || '') === currentUser.id && (activeConv.joinRequests || []).length > 0 && (
              <div className="mt-3 rounded-2xl border border-amber-500/25 bg-amber-500/5 p-3">
                <div className="text-[10px] text-amber-400 font-semibold uppercase tracking-wider mb-1.5">
                  Join requests ({(activeConv.joinRequests || []).length})
                </div>
                <div className="space-y-1.5">
                  {(activeConv.joinRequests || []).map((r) => (
                    <div key={r.userId} className="flex items-center justify-between rounded-xl border border-zinc-800 bg-zinc-900 px-3 py-2">
                      <span className="text-xs font-mono text-zinc-200">User #{r.userId}</span>
                      <div className="flex gap-1.5">
                        <button
                          onClick={() => void handleJoinRequest(r.userId, true)}
                          className="rounded-lg bg-emerald-500/20 border border-emerald-500/40 px-2.5 py-1 text-[10px] font-bold text-emerald-300 hover:bg-emerald-500/30 cursor-pointer"
                        >
                          Approve
                        </button>
                        <button
                          onClick={() => void handleJoinRequest(r.userId, false)}
                          className="rounded-lg bg-red-500/15 border border-red-500/30 px-2.5 py-1 text-[10px] font-bold text-red-300 hover:bg-red-500/25 cursor-pointer"
                        >
                          Decline
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <button
              onClick={async () => {
                if (!window.confirm('Leave this group?')) return;
                await BoostPayStore.leaveConversation(activeConv.id);
                setShowGroupInfo(false);
                setActiveConv(null);
              }}
              className="mt-4 w-full rounded-2xl border border-red-500/30 bg-red-950/30 py-2.5 text-xs font-bold text-red-300 hover:bg-red-950/50 cursor-pointer"
            >
              Leave Group
            </button>
          </div>
        </div>
      )}

      {/* Chat settings sheet */}
      {showSettings && (
        <div className="fixed inset-0 z-[120] flex items-end sm:items-center justify-center bg-black/70 backdrop-blur-sm p-0 sm:p-4" onClick={() => setShowSettings(false)}>
          <div className="w-full max-w-md rounded-t-3xl sm:rounded-3xl border border-zinc-800 bg-zinc-900 p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-sm font-bold text-white mb-3">Chat Settings</h3>
            <button onClick={toggleNotif} className="w-full flex items-center justify-between rounded-2xl border border-zinc-800 bg-zinc-950 px-4 py-3 mb-2 cursor-pointer hover:border-zinc-700 transition">
              <span className="flex items-center gap-2.5 text-xs text-zinc-200">
                {notifEnabled ? <Bell className="w-4 h-4 text-amber-400" /> : <BellOff className="w-4 h-4 text-zinc-500" />}
                Message notifications
              </span>
              <span className={`text-[10px] font-bold px-2 py-1 rounded-full ${notifEnabled ? 'bg-emerald-500/15 text-emerald-400' : 'bg-zinc-800 text-zinc-500'}`}>
                {notifEnabled ? 'ON' : 'OFF'}
              </span>
            </button>
            <button onClick={toggleSound} className="w-full flex items-center justify-between rounded-2xl border border-zinc-800 bg-zinc-950 px-4 py-3 mb-2 cursor-pointer hover:border-zinc-700 transition">
              <span className="flex items-center gap-2.5 text-xs text-zinc-200">
                <Volume2 className="w-4 h-4 text-sky-400" />
                Chat sounds
              </span>
              <span className={`text-[10px] font-bold px-2 py-1 rounded-full ${soundEnabled ? 'bg-emerald-500/15 text-emerald-400' : 'bg-zinc-800 text-zinc-500'}`}>
                {soundEnabled ? 'ON' : 'OFF'}
              </span>
            </button>
            <button onClick={() => setShowSettings(false)} className="mt-2 w-full rounded-2xl bg-zinc-800 py-2.5 text-xs font-semibold text-zinc-300 hover:bg-zinc-700 cursor-pointer">
              Done
            </button>
          </div>
        </div>
      )}

      {/* Fullscreen image viewer */}
      {imageViewer && (
        <div className="fixed inset-0 z-[130] flex items-center justify-center bg-black/90 backdrop-blur-md p-4" onClick={() => setImageViewer(null)}>
          <button onClick={() => setImageViewer(null)} className="absolute top-4 right-4 rounded-full bg-white/10 p-2.5 text-white hover:bg-white/20 cursor-pointer">
            <X className="w-5 h-5" />
          </button>
          <img src={imageViewer} alt="Attachment" className="max-h-[85vh] max-w-full rounded-2xl object-contain" />
        </div>
      )}

      {/* Group call remote audio streams */}
      {Object.entries(gcRemoteStreams).map(([pid, stream]) => (
        <audio
          key={pid}
          autoPlay
          ref={(el) => { if (el) el.srcObject = stream; }}
          className="hidden"
        />
      ))}

      {/* Poll creator */}
      {showPollCreator && (
        <div className="fixed inset-0 z-[125] flex items-end sm:items-center justify-center bg-black/70 backdrop-blur-sm p-0 sm:p-4" onClick={() => setShowPollCreator(false)}>
          <div className="w-full max-w-md rounded-t-3xl sm:rounded-3xl border border-zinc-800 bg-zinc-900 p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-sm font-bold text-white mb-3 flex items-center gap-2"><BarChart3 className="w-4 h-4 text-emerald-400" /> Create Poll</h3>
            <input
              value={pollQuestion}
              onChange={(e) => setPollQuestion(e.target.value)}
              placeholder="Ask a question…"
              className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2.5 text-xs text-white placeholder-zinc-600 focus:border-amber-500/60 focus:outline-none"
            />
            <div className="mt-2.5 space-y-2">
              {pollOptions.map((opt, i) => (
                <div key={i} className="flex items-center gap-2">
                  <input
                    value={opt}
                    onChange={(e) => setPollOptions(prev => prev.map((o, j) => j === i ? e.target.value : o))}
                    placeholder={`Option ${i + 1}`}
                    className="flex-1 rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-xs text-white placeholder-zinc-600 focus:border-amber-500/60 focus:outline-none"
                  />
                  {pollOptions.length > 2 && (
                    <button
                      type="button"
                      onClick={() => setPollOptions(prev => prev.filter((_, j) => j !== i))}
                      className="text-zinc-500 hover:text-red-400 p-1.5 cursor-pointer"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              ))}
            </div>
            {pollOptions.length < 10 && (
              <button
                type="button"
                onClick={() => setPollOptions(prev => [...prev, ''])}
                className="mt-2 text-[11px] text-amber-400 hover:text-amber-300 font-semibold cursor-pointer"
              >
                + Add option
              </button>
            )}
            <div className="mt-4 flex gap-2">
              <button onClick={() => setShowPollCreator(false)} className="flex-1 rounded-2xl border border-zinc-800 bg-zinc-950 py-2.5 text-xs font-bold text-zinc-300 hover:bg-zinc-800 cursor-pointer">
                Cancel
              </button>
              <button onClick={() => void handleSendPoll()} className="flex-1 rounded-2xl bg-amber-500 py-2.5 text-xs font-bold text-zinc-950 hover:bg-amber-400 cursor-pointer">
                Send Poll
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Contact picker */}
      {showContactPicker && (
        <div className="fixed inset-0 z-[125] flex items-end sm:items-center justify-center bg-black/70 backdrop-blur-sm p-0 sm:p-4" onClick={() => setShowContactPicker(false)}>
          <div className="w-full max-w-md rounded-t-3xl sm:rounded-3xl border border-zinc-800 bg-zinc-900 p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-sm font-bold text-white mb-3 flex items-center gap-2"><UserPlus className="w-4 h-4 text-sky-400" /> Share Contact</h3>
            <div className="max-h-64 overflow-y-auto overscroll-contain space-y-1.5">
              {BoostPayStore.getUsers().filter(u => u.id !== currentUser.id).slice(0, 30).map((u) => (
                <button
                  key={u.id}
                  onClick={() => void handleSendContact(u.id)}
                  className="w-full flex items-center gap-2.5 rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2.5 text-left hover:border-sky-500/40 transition cursor-pointer"
                >
                  <div className="h-8 w-8 rounded-full bg-sky-500/15 border border-sky-500/30 flex items-center justify-center text-[10px] font-bold text-sky-300 font-mono">
                    #{u.id}
                  </div>
                  <div>
                    <div className="text-xs text-zinc-100 font-mono font-semibold">User #{u.id}</div>
                    <div className="text-[9px] text-zinc-500 font-mono">Tap to share</div>
                  </div>
                </button>
              ))}
            </div>
            <button onClick={() => setShowContactPicker(false)} className="mt-3 w-full rounded-2xl bg-zinc-800 py-2.5 text-xs font-semibold text-zinc-300 hover:bg-zinc-700 cursor-pointer">
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Message info sheet */}
      {infoMsg && (
        <div className="fixed inset-0 z-[125] flex items-end sm:items-center justify-center bg-black/70 backdrop-blur-sm p-0 sm:p-4" onClick={() => setInfoMsg(null)}>
          <div className="w-full max-w-md rounded-t-3xl sm:rounded-3xl border border-zinc-800 bg-zinc-900 p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-sm font-bold text-white mb-3 flex items-center gap-2"><Info className="w-4 h-4 text-sky-400" /> Message Info</h3>
            <div className="rounded-2xl border border-zinc-800 bg-zinc-950 p-3.5 space-y-2.5">
              <div className="flex items-center justify-between text-xs">
                <span className="text-zinc-500">From</span>
                <span className="text-zinc-100 font-mono font-semibold">User #{infoMsg.senderId}</span>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-zinc-500">Type</span>
                <span className="text-zinc-100 font-mono">{infoMsg.kind || 'text'}</span>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-zinc-500">Sent</span>
                <span className="text-zinc-100 font-mono">{new Date(infoMsg.timestamp).toLocaleString()}</span>
              </div>
              {infoMsg.editedAt && (
                <div className="flex items-center justify-between text-xs">
                  <span className="text-zinc-500">Edited</span>
                  <span className="text-zinc-100 font-mono">{new Date(infoMsg.editedAt).toLocaleString()}</span>
                </div>
              )}
              {infoMsg.senderId === currentUser.id && activeConv && (
                (() => {
                  const others = (activeConv.participants || []).filter((pid) => pid !== currentUser.id);
                  const reads = others
                    .map((pid) => ({ pid, at: (activeConv.lastRead || {})[pid] || 0 }))
                    .filter((r) => r.at >= infoMsg.timestamp)
                    .sort((a, b) => a.at - b.at);
                  return (
                    <div className="pt-2 border-t border-zinc-800/80">
                      <div className="text-[10px] text-zinc-500 uppercase tracking-wider font-semibold mb-1.5">Seen by</div>
                      {reads.length === 0 ? (
                        <div className="text-[11px] text-zinc-500">Not seen yet</div>
                      ) : (
                        <div className="space-y-1">
                          {reads.map((r) => (
                            <div key={r.pid} className="flex items-center justify-between text-[11px]">
                              <span className="text-zinc-300 font-mono">User #{r.pid}</span>
                              <span className="text-sky-400 font-mono">✓✓ {new Date(r.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })()
              )}
            </div>
            <button onClick={() => setInfoMsg(null)} className="mt-3 w-full rounded-2xl bg-zinc-800 py-2.5 text-xs font-semibold text-zinc-300 hover:bg-zinc-700 cursor-pointer">
              Close
            </button>
          </div>
        </div>
      )}

      {/* Discover public groups */}
      {showDiscover && (
        <div className="fixed inset-0 z-[125] flex items-end sm:items-center justify-center bg-black/70 backdrop-blur-sm p-0 sm:p-4" onClick={() => setShowDiscover(false)}>
          <div className="w-full max-w-md rounded-t-3xl sm:rounded-3xl border border-zinc-800 bg-zinc-900 p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-sm font-bold text-white mb-3 flex items-center gap-2"><Globe className="w-4 h-4 text-emerald-400" /> Discover Public Groups</h3>
            {discoverGroups.length === 0 ? (
              <div className="py-8 text-center text-xs text-zinc-500">No public groups to discover right now.</div>
            ) : (
              <div className="max-h-72 overflow-y-auto overscroll-contain space-y-1.5">
                {discoverGroups.map((g) => (
                  <div key={g.id} className="flex items-center gap-2.5 rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2.5">
                    <div className="h-9 w-9 rounded-xl bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center">
                      <Users className="w-4 h-4 text-emerald-400" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-xs text-zinc-100 font-semibold truncate">{g.name}</div>
                      <div className="text-[9px] text-zinc-500 font-mono">
                        {g.memberCount} members{g.joinApprovalRequired ? ' · approval required' : ''}
                      </div>
                    </div>
                    <button
                      onClick={() => void handleDiscoverJoin(g)}
                      className="rounded-lg bg-emerald-500/20 border border-emerald-500/40 px-3 py-1.5 text-[10px] font-bold text-emerald-300 hover:bg-emerald-500/30 cursor-pointer"
                    >
                      Join
                    </button>
                  </div>
                ))}
              </div>
            )}
            <button onClick={() => setShowDiscover(false)} className="mt-3 w-full rounded-2xl bg-zinc-800 py-2.5 text-xs font-semibold text-zinc-300 hover:bg-zinc-700 cursor-pointer">
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
