import React, { FC, useState, useEffect, memo, useRef } from 'react';
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
  Smile
} from 'lucide-react';
import { BoostPayStore, copyToClipboard } from '../services/store';
import { User, Conversation, Message } from '../types';

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
        className={`relative px-3.5 py-2.5 text-xs leading-relaxed transition-all backdrop-blur-md ${
          isMe
            ? 'bg-gradient-to-br from-amber-500 to-amber-600 text-zinc-950 font-medium rounded-2xl rounded-br-xs shadow-md shadow-amber-500/10'
            : isAdmin
            ? 'bg-gradient-to-br from-sky-950/80 via-sky-900/40 to-zinc-900/90 border border-sky-500/30 text-sky-100 rounded-2xl rounded-bl-xs shadow-md shadow-sky-500/5'
            : 'bg-zinc-900/90 border border-zinc-800/80 text-zinc-100 rounded-2xl rounded-bl-xs shadow-sm'
        }`}
      >
        <p className="break-words select-text font-normal">{m.text}</p>

        {/* Timestamp Footer */}
        <div className="flex items-center justify-end gap-1 mt-1 text-[9px] opacity-75 font-mono">
          <span>{new Date(m.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
        </div>
      </div>

      {/* Emoji Reactions Bar */}
      {hasReactions && (
        <div className={`flex flex-wrap gap-1 mt-1 ${isMe ? 'justify-end' : 'justify-start'}`}>
          {Object.entries(reactions).map(([emoji, userIds]) => {
            if (!userIds || userIds.length === 0) return null;
            const userReacted = userIds.includes(currentUserId);
            return (
              <button
                key={emoji}
                type="button"
                onClick={() => onReact(m.id, emoji)}
                className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] border transition cursor-pointer select-none ${
                  userReacted
                    ? 'bg-amber-500/20 border-amber-500/40 text-amber-300 font-bold'
                    : 'bg-zinc-900/90 border-zinc-800 text-zinc-400 hover:border-zinc-700'
                }`}
              >
                <span>{emoji}</span>
                <span className="font-mono text-[9px]">{userIds.length}</span>
              </button>
            );
          })}
        </div>
      )}

      {/* Floating Hover Action Bar */}
      {showActionBar && (
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

          {/* Copy Message Text */}
          <button
            type="button"
            onClick={() => onCopy(m.text)}
            className="text-zinc-400 hover:text-zinc-200 p-1 rounded transition cursor-pointer"
            title="Copy Text"
          >
            {isCopied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
          </button>
        </div>
      )}
    </div>
  );
});

MessageItem.displayName = 'MessageItem';

export const MessengerView: FC<Props> = ({ currentUser, initialPeerId, targetPeerId }) => {
  const [conversations, setConversations] = useState<Conversation[]>(() => BoostPayStore.getConversations());
  const [messages, setMessages] = useState<Message[]>(() => BoostPayStore.getMessages());
  const [activeConv, setActiveConv] = useState<Conversation | null>(null);
  const [inputMsg, setInputMsg] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [isNewChatOpen, setIsNewChatOpen] = useState(false);
  const [newPeerId, setNewPeerId] = useState('');
  const [newChatError, setNewChatError] = useState('');
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [copiedMsgId, setCopiedMsgId] = useState<string | null>(null);

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

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeConv || !inputMsg.trim() || isSending) return;

    const textToSend = inputMsg.trim();
    setInputMsg('');
    setShowEmojiPicker(false);
    setIsSending(true);

    const otherParticipant = getOtherParticipant(activeConv);

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
                  {getOtherParticipant(activeConv) === 'ADMIN_SUPPORT' ? (
                    <ShieldCheck className="w-5 h-5 text-white stroke-[2.2]" />
                  ) : (
                    `#${getOtherParticipant(activeConv)}`
                  )}
                </div>
                <span className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full bg-emerald-500 ring-2 ring-zinc-950" />
              </div>

              <div className="min-w-0">
                <div className="flex items-center gap-1.5 truncate">
                  {getOtherParticipant(activeConv) === 'ADMIN_SUPPORT' ? (
                    <span className="text-xs font-bold text-sky-400 font-mono flex items-center gap-1">
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
                  <span className="text-zinc-500 truncate">{activeConv.id}</span>
                </div>
              </div>
            </div>
          </div>

          {/* Compact Security Header */}
          <div className="shrink-0 mx-3 my-1.5 rounded-xl border border-red-500/20 bg-red-950/20 px-3 py-1.5 flex items-center gap-2 text-[10px] text-red-300">
            <ShieldAlert className="w-3.5 h-3.5 text-red-400 shrink-0" />
            <span className="truncate">Staff will never ask for your recovery phrase or transfer passwords.</span>
          </div>

          {/* Messages Stream Viewport (Strictly Scrollable Middle Section) */}
          <div className="flex-1 min-h-0 overflow-y-auto space-y-3 px-3.5 py-2">
            <div className="flex items-center justify-center my-1.5">
              <span className="rounded-full bg-zinc-900/90 border border-zinc-800 px-3 py-0.5 text-[10px] font-mono text-zinc-400 shadow-sm">
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
              <div className="h-44 flex flex-col items-center justify-center text-center px-4">
                <div className="h-10 w-10 rounded-2xl bg-zinc-900 border border-zinc-800 flex items-center justify-center text-amber-400 mb-2">
                  <MessageSquare className="w-5 h-5 stroke-[1.8]" />
                </div>
                <h4 className="text-xs font-bold text-zinc-200">Start the conversation</h4>
                <p className="text-[11px] text-zinc-500 mt-0.5 max-w-xs">
                  Say hello to initiate real-time communication.
                </p>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

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
            className="shrink-0 p-2.5 border-t border-zinc-800 bg-zinc-950/95 backdrop-blur-xl flex items-center gap-2 z-10"
          >
            <button
              type="button"
              onClick={() => setShowEmojiPicker(prev => !prev)}
              className={`p-2.5 rounded-2xl border transition cursor-pointer min-h-[44px] min-w-[44px] flex items-center justify-center shrink-0 ${
                showEmojiPicker
                  ? 'border-amber-500/50 bg-amber-500/15 text-amber-400'
                  : 'border-zinc-800 bg-zinc-900 text-zinc-400 hover:text-zinc-200 hover:border-zinc-700'
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
              className="flex-1 rounded-2xl border border-zinc-800 bg-zinc-900 px-3.5 py-2.5 text-xs text-white placeholder-zinc-500 focus:border-amber-500 focus:outline-none transition-colors"
            />

            <button
              type="submit"
              disabled={!inputMsg.trim() || isSending}
              className="rounded-2xl bg-amber-500 px-4 py-2.5 text-zinc-950 hover:bg-amber-400 transition font-bold disabled:opacity-40 disabled:hover:bg-amber-500 cursor-pointer active:scale-95 shadow-md shadow-amber-500/20 min-h-[44px] min-w-[44px] flex items-center justify-center shrink-0"
              title="Send message"
            >
              <Send className="w-4 h-4 stroke-[2.2]" />
            </button>
          </form>
        </div>
      ) : (
        /* 2. CONVERSATION INBOX LIST VIEW */
        <div className="flex-1 flex flex-col min-h-0 overflow-hidden px-4 pt-3">
          <div className="shrink-0 flex items-center justify-between mb-3">
            <div>
              <h2 className="text-base font-bold text-white flex items-center gap-2">
                <MessageSquare className="w-5 h-5 text-amber-400" /> Messenger Inbox
              </h2>
              <p className="text-[11px] text-zinc-400">Direct peer communication & Verified Support</p>
            </div>
            <button
              onClick={() => setIsNewChatOpen(true)}
              className="flex items-center gap-1.5 rounded-2xl bg-amber-500 px-3 py-2 text-xs font-bold text-zinc-950 hover:bg-amber-400 transition shadow-md shadow-amber-500/20 cursor-pointer active:scale-95 min-h-[44px]"
            >
              <Plus className="w-4 h-4" /> New Chat
            </button>
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
                    Need instant help with transfers or rates? Tap for 24/7 direct assistance.
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
          <div className="flex-1 min-h-0 overflow-y-auto space-y-2 pb-4">
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
                        {isSupport ? (
                          <ShieldCheck className="w-4 h-4 text-white stroke-[2.2]" />
                        ) : (
                          `#${other}`
                        )}
                      </div>
                      <span className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full bg-emerald-500 ring-2 ring-zinc-950" />
                    </div>

                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs font-bold font-mono text-zinc-100">
                          {isSupport ? 'Official Verified Support' : `User #${other}`}
                        </span>
                      </div>
                      <p className="text-[11px] text-zinc-400 truncate max-w-[200px] sm:max-w-xs mt-0.5">
                        {conv.lastMessage || 'No messages yet'}
                      </p>
                    </div>
                  </div>

                  <span className="text-[10px] font-mono text-zinc-500 shrink-0 self-start mt-0.5">
                    {new Date(conv.lastMessageAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </span>
                </button>
              );
            })}

            {filteredConversations.length === 0 && (
              <div className="py-10 text-center text-xs text-zinc-500 border border-dashed border-zinc-800 rounded-2xl">
                No conversations found. Tap &quot;New Chat&quot; above to message a peer by numeric ID.
              </div>
            )}
          </div>

          {/* New Chat Modal */}
          {isNewChatOpen && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md p-4 animate-in fade-in duration-150">
              <div className="relative w-full max-w-sm rounded-3xl border border-zinc-800 bg-zinc-900/95 p-5 shadow-2xl text-zinc-100 backdrop-blur-2xl">
                <h3 className="font-bold text-sm text-white mb-1">Start New Conversation</h3>
                <p className="text-xs text-zinc-400 mb-4">Enter recipient&apos;s numeric User ID (e.g. 1, 2, 3)</p>

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
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
