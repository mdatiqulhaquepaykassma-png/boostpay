import { FC, useState, useEffect, memo, useRef } from 'react';
import {
  MessageSquare,
  Search,
  Send,
  ShieldAlert,
  ShieldCheck,
  ArrowLeft,
  Plus,
  Headphones,
  Copy,
  Check,
  Smile,
  CheckCheck
} from 'lucide-react';
import { BoostPayStore, copyToClipboard } from '../services/store';
import { User, Conversation, Message } from '../types';

interface Props {
  currentUser: User;
  initialPeerId?: string | null;
  targetPeerId?: string | null;
}

const EMOJI_PALETTE = ['👍', '❤️', '🔥', '🚀', '💸'];

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
}

const MessageItem = memo(({
  m,
  isMe,
  isAdmin,
  currentUserId,
  onReact,
  onCopy,
  copiedMsgId
}: MessageItemProps) => {
  const [showActionBar, setShowActionBar] = useState(false);
  const isCopied = copiedMsgId === m.id;

  const reactions = m.reactions || {};
  const hasReactions = Object.keys(reactions).some(k => reactions[k]?.length > 0);

  return (
    <div
      className={`group relative flex flex-col max-w-[85%] sm:max-w-[78%] transition-all ${
        isMe ? 'ml-auto items-end' : 'mr-auto items-start'
      }`}
      onMouseEnter={() => setShowActionBar(true)}
      onMouseLeave={() => setShowActionBar(false)}
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

      {/* Main Glassmorphic Bubble */}
      <div
        className={`relative px-4 py-3 text-xs leading-relaxed transition-all backdrop-blur-md ${
          isMe
            ? 'bg-gradient-to-br from-amber-500 to-amber-600 text-zinc-950 font-medium rounded-2xl rounded-br-xs shadow-lg shadow-amber-500/10'
            : isAdmin
            ? 'bg-gradient-to-br from-sky-950/80 via-sky-900/40 to-zinc-900/90 border border-sky-500/30 text-sky-100 rounded-2xl rounded-bl-xs shadow-lg shadow-sky-500/5'
            : 'bg-zinc-900/90 border border-zinc-800/80 text-zinc-100 rounded-2xl rounded-bl-xs shadow-md'
        }`}
      >
        <p className="break-words select-text font-normal">{m.text}</p>

        {/* Timestamp & Sent Status */}
        <div className={`flex items-center gap-1 mt-1 font-mono text-[9px] ${
          isMe ? 'justify-end text-zinc-900/70' : 'justify-end text-zinc-500'
        }`}>
          <span>{new Date(m.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
          {isMe && <CheckCheck className="w-3 h-3 stroke-[2.2] text-zinc-900/80 inline" />}
        </div>

        {/* Floating Quick Actions Bar (Hover / Tap) */}
        <div
          className={`absolute -top-7 ${
            isMe ? 'right-0' : 'left-0'
          } z-20 flex items-center gap-1 rounded-full border border-zinc-700/80 bg-zinc-900/95 px-2 py-1 shadow-xl backdrop-blur-xl transition-opacity duration-150 ${
            showActionBar ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
          }`}
        >
          {EMOJI_PALETTE.map((emoji) => {
            const hasUserReacted = reactions[emoji]?.includes(currentUserId);
            return (
              <button
                key={emoji}
                onClick={(e) => {
                  e.stopPropagation();
                  onReact(m.id, emoji);
                }}
                className={`flex h-6 w-6 items-center justify-center rounded-full text-xs transition-transform hover:scale-125 cursor-pointer active:scale-95 ${
                  hasUserReacted ? 'bg-amber-500/20 ring-1 ring-amber-400' : 'hover:bg-zinc-800'
                }`}
                title={`React ${emoji}`}
              >
                {emoji}
              </button>
            );
          })}

          <div className="h-3 w-px bg-zinc-700 mx-0.5" />

          {/* Copy Message Button */}
          <button
            onClick={(e) => {
              e.stopPropagation();
              onCopy(m.text);
            }}
            className="flex h-6 w-6 items-center justify-center rounded-full text-zinc-400 hover:text-white hover:bg-zinc-800 transition cursor-pointer"
            title="Copy message"
          >
            {isCopied ? (
              <Check className="w-3 h-3 text-emerald-400" />
            ) : (
              <Copy className="w-3 h-3" />
            )}
          </button>
        </div>
      </div>

      {/* Accumulated Reaction Badges Below Bubble */}
      {hasReactions && (
        <div className={`flex flex-wrap gap-1 mt-1 px-1 ${isMe ? 'justify-end' : 'justify-start'}`}>
          {Object.entries(reactions).map(([emoji, userIds]) => {
            if (!userIds || userIds.length === 0) return null;
            const hasUserReacted = userIds.includes(currentUserId);
            return (
              <button
                key={emoji}
                onClick={() => onReact(m.id, emoji)}
                className={`flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-mono transition-all cursor-pointer ${
                  hasUserReacted
                    ? 'border border-amber-500/40 bg-amber-500/15 text-amber-300 font-bold shadow-sm shadow-amber-500/10'
                    : 'border border-zinc-800 bg-zinc-900/90 text-zinc-400 hover:border-zinc-700 hover:text-zinc-200'
                }`}
                title={`${userIds.length} reaction${userIds.length > 1 ? 's' : ''}`}
              >
                <span>{emoji}</span>
                <span>{userIds.length}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
});

export const MessengerView: FC<Props> = ({ currentUser, initialPeerId, targetPeerId }) => {
  const [conversations, setConversations] = useState<Conversation[]>(() => BoostPayStore.getConversations());
  const [messages, setMessages] = useState<Message[]>(() => BoostPayStore.getMessages());
  const [activeConv, setActiveConv] = useState<Conversation | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [inputMsg, setInputMsg] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [copiedMsgId, setCopiedMsgId] = useState<string | null>(null);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);

  // New Chat Dialog
  const [isNewChatOpen, setIsNewChatOpen] = useState(false);
  const [newPeerId, setNewPeerId] = useState('');
  const [newChatError, setNewChatError] = useState('');

  // Auto-scroll ref
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const peerIdToUse = initialPeerId || targetPeerId;

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

  // Strictly filter conversations so the user only sees threads they are part of
  const userConversations = conversations.filter(c =>
    Array.isArray(c.participants) && c.participants.includes(currentUser.id)
  );

  const filteredConversations = userConversations.filter(c =>
    c.id.toLowerCase().includes(searchTerm.toLowerCase()) ||
    c.participants.some(p => p.toLowerCase().includes(searchTerm.toLowerCase()))
  );

  const getOtherParticipant = (conv: Conversation): string => {
    return conv.participants.find(p => p !== currentUser.id) || (conv.participants.includes('ADMIN_SUPPORT') ? 'ADMIN_SUPPORT' : 'Support');
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
      setNewChatError('You cannot start a conversation with your own User ID');
      return;
    }

    const allUsers = BoostPayStore.getUsers();
    const peer = allUsers.find(u => u.id === cleanId);
    if (!peer && cleanId !== 'ADMIN_SUPPORT') {
      setNewChatError(`User ID #${cleanId} not found`);
      return;
    }

    openConversationWithPeer(cleanId);
    setIsNewChatOpen(false);
    setNewPeerId('');
  };

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeConv || !inputMsg.trim() || isSending) return;

    const textToSend = inputMsg.trim();
    const otherParticipant = getOtherParticipant(activeConv);

    setInputMsg('');
    setShowEmojiPicker(false);
    setIsSending(true);

    try {
      await BoostPayStore.sendChatMessage(otherParticipant, textToSend, 'USER');
    } finally {
      setIsSending(false);
      setTimeout(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
      }, 50);
    }
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
    <div className="mx-auto max-w-xl px-4 py-5 text-zinc-100 flex flex-col min-h-[82vh]">
      {/* If active conversation is selected */}
      {activeConv ? (
        <div className="flex flex-col flex-1 rounded-3xl border border-zinc-800/80 bg-zinc-950/80 shadow-2xl backdrop-blur-2xl overflow-hidden min-h-[75vh]">
          {/* Conversation Top Header */}
          <div className="flex items-center justify-between border-b border-zinc-800/80 bg-zinc-900/60 backdrop-blur-md px-4 py-3">
            <div className="flex items-center gap-3">
              <button
                onClick={() => setActiveConv(null)}
                className="rounded-xl p-2 text-zinc-400 hover:bg-zinc-800 hover:text-white transition cursor-pointer min-w-[44px] min-h-[44px] flex items-center justify-center -ml-1"
                title="Back to inbox"
              >
                <ArrowLeft className="w-5 h-5" />
              </button>

              {/* Participant Avatar with Presence Dot */}
              <div className="relative">
                <div className={`h-10 w-10 rounded-2xl bg-gradient-to-tr ${getAvatarGradient(getOtherParticipant(activeConv))} flex items-center justify-center text-white font-mono font-bold text-xs shadow-md`}>
                  {getOtherParticipant(activeConv) === 'ADMIN_SUPPORT' ? (
                    <ShieldCheck className="w-5 h-5 text-white stroke-[2.2]" />
                  ) : (
                    `#${getOtherParticipant(activeConv)}`
                  )}
                </div>
                {/* Real-time Online Presence Dot */}
                <span className="absolute -bottom-0.5 -right-0.5 flex h-3 w-3">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                  <span className="relative inline-flex rounded-full h-3 w-3 bg-emerald-500 ring-2 ring-zinc-950" />
                </span>
              </div>

              <div>
                <div className="flex items-center gap-1.5">
                  {getOtherParticipant(activeConv) === 'ADMIN_SUPPORT' ? (
                    <span className="flex items-center gap-1 text-xs font-bold text-sky-400 font-mono">
                      Official Verified Support
                    </span>
                  ) : (
                    <span className="text-xs font-bold font-mono text-zinc-100">
                      Peer User #{getOtherParticipant(activeConv)}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2 text-[10px] text-zinc-400 font-mono">
                  <span className="flex items-center gap-1 text-emerald-400 font-medium">
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 inline-block" /> Active now
                  </span>
                  <span>·</span>
                  <span className="text-zinc-500">{activeConv.id}</span>
                </div>
              </div>
            </div>
          </div>

          {/* Scam Protection Alert Warning */}
          <div className="mx-4 mt-3 rounded-2xl border border-red-500/20 bg-red-950/25 px-3 py-2 flex items-center gap-2.5 text-[11px] text-red-300 backdrop-blur-md">
            <ShieldAlert className="w-4 h-4 text-red-400 shrink-0" />
            <span>Protect credentials: Official staff will never ask for your recovery phrase or transfer passwords.</span>
          </div>

          {/* Messages Stream Viewport */}
          <div className="flex-1 overflow-y-auto space-y-3.5 p-4 pr-3">
            {/* Date separator pill */}
            <div className="flex items-center justify-center my-2">
              <span className="rounded-full bg-zinc-900/90 border border-zinc-800 px-3 py-0.5 text-[10px] font-mono text-zinc-400 shadow-sm backdrop-blur-md">
                Secure Encrypted Stream
              </span>
            </div>

            {messages
              .filter(m => m.conversationId === activeConv.id)
              .map(m => (
                <MessageItem
                  key={m.id}
                  m={m}
                  isMe={m.senderId === currentUser.id}
                  isAdmin={m.senderRole === 'ADMIN' || m.senderId === 'ADMIN_SUPPORT'}
                  currentUserId={currentUser.id}
                  onReact={handleToggleReaction}
                  onCopy={handleCopyMessageText}
                  copiedMsgId={copiedMsgId}
                />
              ))}

            {messages.filter(m => m.conversationId === activeConv.id).length === 0 && (
              <div className="h-48 flex flex-col items-center justify-center text-center px-6">
                <div className="h-12 w-12 rounded-2xl bg-zinc-900 border border-zinc-800 flex items-center justify-center text-amber-400 mb-3">
                  <MessageSquare className="w-6 h-6 stroke-[1.8]" />
                </div>
                <h4 className="text-xs font-bold text-zinc-200">Start the conversation</h4>
                <p className="text-[11px] text-zinc-500 mt-1 max-w-xs">
                  Say hello to initiate real-time communication. All messages are synchronized instantly.
                </p>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Quick Emoji Bar (Collapsible) */}
          {showEmojiPicker && (
            <div className="px-4 py-2 border-t border-zinc-800/80 bg-zinc-900/70 backdrop-blur-md flex items-center gap-2 animate-in fade-in duration-150">
              <span className="text-[10px] font-mono text-zinc-400 uppercase tracking-wider">Quick:</span>
              <div className="flex items-center gap-1.5">
                {['👍', '❤️', '🔥', '🚀', '💸', '✨', '⚡', '🎉'].map((emoji) => (
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

          {/* Message Input Dock */}
          <form
            onSubmit={handleSendMessage}
            className="p-3 border-t border-zinc-800/80 bg-zinc-900/80 backdrop-blur-xl flex items-center gap-2"
          >
            <button
              type="button"
              onClick={() => setShowEmojiPicker(prev => !prev)}
              className={`p-2.5 rounded-2xl border transition cursor-pointer min-h-[44px] min-w-[44px] flex items-center justify-center ${
                showEmojiPicker
                  ? 'border-amber-500/50 bg-amber-500/15 text-amber-400'
                  : 'border-zinc-800 bg-zinc-950 text-zinc-400 hover:text-zinc-200 hover:border-zinc-700'
              }`}
              title="Insert Emoji"
            >
              <Smile className="w-5 h-5" />
            </button>

            <input
              ref={inputRef}
              type="text"
              placeholder={`Message ${getOtherParticipant(activeConv) === 'ADMIN_SUPPORT' ? 'Official Support' : `User #${getOtherParticipant(activeConv)}`}...`}
              value={inputMsg}
              onChange={(e) => setInputMsg(e.target.value)}
              className="flex-1 rounded-2xl border border-zinc-800 bg-zinc-950/90 px-4 py-3 text-xs text-white placeholder-zinc-500 focus:border-amber-500 focus:outline-none transition-colors"
            />

            <button
              type="submit"
              disabled={!inputMsg.trim() || isSending}
              className="rounded-2xl bg-amber-500 px-4 py-3 text-zinc-950 hover:bg-amber-400 transition font-bold disabled:opacity-40 disabled:hover:bg-amber-500 cursor-pointer active:scale-95 shadow-lg shadow-amber-500/20 min-h-[44px] min-w-[44px] flex items-center justify-center"
              title="Send message"
            >
              <Send className="w-4 h-4 stroke-[2.2]" />
            </button>
          </form>
        </div>
      ) : (
        /* Conversations Inbox List View */
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-bold text-white flex items-center gap-2">
                <MessageSquare className="w-5 h-5 text-amber-400" /> Messenger Inbox
              </h2>
              <p className="text-xs text-zinc-400">Direct peer communication & Verified Support</p>
            </div>
            <button
              onClick={() => setIsNewChatOpen(true)}
              className="flex items-center gap-1.5 rounded-2xl bg-amber-500 px-3.5 py-2.5 text-xs font-bold text-zinc-950 hover:bg-amber-400 transition shadow-lg shadow-amber-500/20 cursor-pointer active:scale-95 min-h-[44px]"
            >
              <Plus className="w-4 h-4" /> New Chat
            </button>
          </div>

          {/* 1-Tap Official Verified Support Glass Banner */}
          <div
            onClick={() => openConversationWithPeer('ADMIN_SUPPORT')}
            className="relative overflow-hidden rounded-3xl border border-sky-500/30 bg-gradient-to-r from-sky-950/60 via-zinc-900/80 to-zinc-950 p-4 shadow-xl backdrop-blur-xl hover:border-sky-500/60 hover:shadow-sky-500/10 transition-all cursor-pointer group"
          >
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-3.5">
                <div className="rounded-2xl p-3 bg-sky-500/20 text-sky-400 border border-sky-500/30 group-hover:scale-105 transition-transform shadow-md shadow-sky-500/10">
                  <Headphones className="w-5 h-5 stroke-[2.2]" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-sky-400 font-mono flex items-center gap-1">
                      <ShieldCheck className="w-4 h-4 text-sky-400" /> Official Verified Support
                    </span>
                  </div>
                  <p className="text-[11px] text-zinc-300 mt-0.5">
                    Need instant help with transfers, rates or boosts? Tap for 24/7 direct assistance.
                  </p>
                </div>
              </div>
              <span className="shrink-0 text-[10px] font-mono text-sky-400 font-bold bg-sky-500/15 border border-sky-500/30 px-2.5 py-1 rounded-xl">
                Live
              </span>
            </div>
          </div>

          {/* Search bar with glass styling */}
          <div className="relative">
            <Search className="absolute left-3.5 top-3 w-4 h-4 text-zinc-500" />
            <input
              type="text"
              placeholder="Search by User ID..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full rounded-2xl border border-zinc-800/80 bg-zinc-900/80 backdrop-blur-md pl-10 pr-4 py-2.5 text-xs text-zinc-200 placeholder-zinc-500 focus:border-amber-500 focus:outline-none font-mono transition-colors"
            />
          </div>

          {/* Conversations list */}
          <div className="space-y-2.5">
            {filteredConversations.map((conv) => {
              const other = getOtherParticipant(conv);
              const isSupport = other === 'ADMIN_SUPPORT';
              const gradient = getAvatarGradient(other);

              return (
                <button
                  key={conv.id}
                  onClick={() => setActiveConv(conv)}
                  className="w-full flex items-center justify-between rounded-3xl border border-zinc-800/80 bg-zinc-900/70 p-3.5 hover:border-zinc-700 hover:bg-zinc-900/90 transition-all text-left cursor-pointer backdrop-blur-md shadow-sm hover:shadow-md"
                >
                  <div className="flex items-center gap-3.5 min-w-0 pr-2">
                    {/* Circle Avatar with Initials & Online Dot */}
                    <div className="relative shrink-0">
                      <div className={`h-11 w-11 rounded-2xl bg-gradient-to-tr ${gradient} flex items-center justify-center text-white font-mono font-bold text-xs shadow-md`}>
                        {isSupport ? (
                          <ShieldCheck className="w-5 h-5 text-white stroke-[2.2]" />
                        ) : (
                          `#${other}`
                        )}
                      </div>
                      <span className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full bg-emerald-500 ring-2 ring-zinc-950" />
                    </div>

                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs font-bold font-mono text-zinc-100">
                          {isSupport ? 'Official Verified Support' : `User #${other}`}
                        </span>
                      </div>
                      <p className="text-[11px] text-zinc-400 truncate max-w-[220px] sm:max-w-xs mt-0.5">
                        {conv.lastMessage || 'No messages yet'}
                      </p>
                    </div>
                  </div>

                  <span className="text-[10px] font-mono text-zinc-500 shrink-0 self-start mt-1">
                    {new Date(conv.lastMessageAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </span>
                </button>
              );
            })}

            {filteredConversations.length === 0 && (
              <div className="py-12 text-center text-xs text-zinc-500 border border-dashed border-zinc-800 rounded-3xl">
                No conversations found. Tap &quot;New Chat&quot; above to message a peer by numeric ID.
              </div>
            )}
          </div>

          {/* New Chat Modal with Frosted Glass Overlay */}
          {isNewChatOpen && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md p-4 animate-in fade-in duration-150">
              <div className="relative w-full max-w-sm rounded-3xl border border-zinc-800 bg-zinc-900/95 p-6 shadow-2xl text-zinc-100 backdrop-blur-2xl">
                <h3 className="font-bold text-sm text-white mb-1">Start New Conversation</h3>
                <p className="text-xs text-zinc-400 mb-5">Enter recipient&apos;s numeric User ID (e.g. 1, 2, 3)</p>

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

                  <div className="flex gap-2.5 pt-2">
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
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
