import { FC, useState, useEffect, memo, useMemo, useCallback } from 'react';
import { MessageSquare, Search, Send, ShieldAlert, ShieldCheck, ArrowLeft, Plus } from 'lucide-react';
import { BoostPayStore } from '../services/store';
import { User, Conversation, Message } from '../types';

interface Props {
  currentUser: User;
  initialPeerId?: string | null;
  targetPeerId?: string | null;
}

const MessageItem = memo(({ m, isMe, isAdmin }: { m: Message, isMe: boolean, isAdmin: boolean }) => (
  <div
    className={`flex flex-col max-w-[80%] rounded-2xl p-3 text-xs leading-relaxed ${
      isMe
        ? 'ml-auto bg-amber-500 text-zinc-950 font-medium rounded-br-none shadow-md shadow-amber-500/10'
        : isAdmin
        ? 'mr-auto bg-sky-950/80 border border-sky-500/30 text-sky-100 rounded-bl-none'
        : 'mr-auto bg-zinc-900 border border-zinc-800 text-zinc-200 rounded-bl-none'
    }`}
  >
    {!isMe && (
      <span className={`text-[10px] font-mono font-bold mb-1 flex items-center gap-1 ${
        isAdmin ? 'text-sky-400' : 'text-zinc-400'
      }`}>
        {isAdmin && <ShieldCheck className="w-3 h-3" />}
        {isAdmin ? 'Official Support' : `User #${m.senderId}`}
      </span>
    )}
    <p>{m.text}</p>
    <span className={`text-[9px] font-mono mt-1 self-end ${
      isMe ? 'text-zinc-900/70' : 'text-zinc-500'
    }`}>
      {new Date(m.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
    </span>
  </div>
));

export const MessengerView: FC<Props> = ({ currentUser, initialPeerId, targetPeerId }) => {
  const [conversations, setConversations] = useState<Conversation[]>(BoostPayStore.getConversations());
  const [messages, setMessages] = useState<Message[]>(BoostPayStore.getMessages());
  const [activeConv, setActiveConv] = useState<Conversation | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [inputMsg, setInputMsg] = useState('');

  // New Chat Dialog
  const [isNewChatOpen, setIsNewChatOpen] = useState(false);
  const [newPeerId, setNewPeerId] = useState('');
  const [newChatError, setNewChatError] = useState('');

  const peerIdToUse = initialPeerId || targetPeerId;

  // Subscription for real-time updates
  useEffect(() => {
    const unsubscribe = BoostPayStore.subscribeToChat((convs, msgs) => {
      setConversations(convs);
      setMessages(msgs);
    });
    return unsubscribe;
  }, []);

  // Polling for server sync (500ms)
  useEffect(() => {
    let active = true;
    const poll = async () => {
      while (active) {
        await BoostPayStore.syncChatState();
        await new Promise(r => setTimeout(r, 500));
      }
    };
    poll();
    return () => { active = false; };
  }, []);

  // Auto-focus conversation if initiated from Leaderboard
  useEffect(() => {
    if (peerIdToUse) {
      const allConvs = BoostPayStore.getConversations();
      let existing = allConvs.find(c =>
        c.participants.includes(currentUser.id) && c.participants.includes(peerIdToUse)
      );

      if (!existing) {
        existing = {
          id: `CONV-${currentUser.id}-${peerIdToUse}`,
          participants: [currentUser.id, peerIdToUse],
          lastMessage: 'Conversation initiated from Leaderboard',
          lastMessageAt: Date.now()
        };
        allConvs.unshift(existing);
        BoostPayStore.saveConversations(allConvs);
        setConversations(allConvs);
      }
      setActiveConv(existing);
    }
  }, [peerIdToUse, currentUser.id]);

  const userConversations = conversations.filter(c =>
    c.participants.includes(currentUser.id) || c.participants.includes('ADMIN_SUPPORT')
  );

  const filteredConversations = userConversations.filter(c =>
    c.id.toLowerCase().includes(searchTerm.toLowerCase()) ||
    c.participants.some(p => p.includes(searchTerm))
  );

  const getOtherParticipant = (conv: Conversation): string => {
    return conv.participants.find(p => p !== currentUser.id) || 'ADMIN_SUPPORT';
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

    // Check if conversation already exists
    const existing = conversations.find(c =>
      c.participants.includes(currentUser.id) && c.participants.includes(cleanId)
    );

    if (existing) {
      setActiveConv(existing);
      setIsNewChatOpen(false);
      setNewPeerId('');
      return;
    }

    // Create new conversation with clean unique ID
    const newConv: Conversation = {
      id: `CONV-${currentUser.id}-${cleanId}`,
      participants: [currentUser.id, cleanId],
      lastMessage: 'Conversation initiated',
      lastMessageAt: Date.now()
    };

    const updated = [newConv, ...conversations];
    BoostPayStore.saveConversations(updated);
    setConversations(updated);
    setActiveConv(newConv);
    setIsNewChatOpen(false);
    setNewPeerId('');
  };

  const handleSendMessage = (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeConv || !inputMsg.trim()) return;

    const newMsg: Message = {
      id: 'MSG-' + Date.now(),
      conversationId: activeConv.id,
      senderId: currentUser.id,
      senderRole: 'USER',
      text: inputMsg.trim(),
      timestamp: Date.now()
    };

    const updatedMessages = [...messages, newMsg];
    BoostPayStore.saveMessages(updatedMessages);
    setMessages(updatedMessages);

    const updatedConvs = conversations.map(c => {
      if (c.id === activeConv.id) {
        return {
          ...c,
          lastMessage: inputMsg.trim(),
          lastMessageAt: Date.now()
        };
      }
      return c;
    });

    BoostPayStore.saveConversations(updatedConvs);
    setConversations(updatedConvs);
    setInputMsg('');
  };

  return (
    <div className="mx-auto max-w-xl px-4 py-6 text-zinc-100">
      {/* If active conversation is selected */}
      {activeConv ? (
        <div className="flex flex-col h-[75vh] rounded-3xl border border-zinc-800 bg-zinc-950 p-4 shadow-2xl overflow-hidden">
          {/* Conversation Top Header */}
          <div className="flex items-center justify-between border-b border-zinc-800 pb-3 mb-2">
            <div className="flex items-center gap-2.5">
              <button
                onClick={() => setActiveConv(null)}
                className="rounded-xl p-1.5 text-zinc-400 hover:bg-zinc-800 hover:text-white transition"
              >
                <ArrowLeft className="w-5 h-5" />
              </button>
              <div>
                <div className="flex items-center gap-1.5">
                  {getOtherParticipant(activeConv) === 'ADMIN_SUPPORT' ? (
                    <span className="flex items-center gap-1 text-xs font-bold text-sky-400 font-mono">
                      <ShieldCheck className="w-3.5 h-3.5" /> Official Verified Support
                    </span>
                  ) : (
                    <span className="text-xs font-bold font-mono text-amber-400">
                      User #{getOtherParticipant(activeConv)}
                    </span>
                  )}
                </div>
                <div className="text-[10px] text-zinc-500 font-mono">
                  ID: {activeConv.id}
                </div>
              </div>
            </div>
          </div>

          {/* Persistent Scam Warning Notice at Top of Chat (Prompt 2 & 8) */}
          <div className="rounded-xl border border-red-500/30 bg-red-950/20 px-3 py-2 mb-3 flex items-center gap-2 text-[11px] text-red-300">
            <ShieldAlert className="w-4 h-4 text-red-400 shrink-0" />
            <span>Never send external funds or share passwords. Official staff never asks for credentials.</span>
          </div>

          {/* Messages list */}
          <div className="flex-1 overflow-y-auto space-y-2.5 pr-1">
            {messages
              .filter(m => m.conversationId === activeConv.id)
              .map(m => (
                <MessageItem 
                  key={m.id} 
                  m={m} 
                  isMe={m.senderId === currentUser.id}
                  isAdmin={m.senderRole === 'ADMIN'}
                />
              ))}

            {messages.filter(m => m.conversationId === activeConv.id).length === 0 && (
              <div className="h-full flex items-center justify-center text-xs text-zinc-500">
                Say hello to initiate this conversation safely.
              </div>
            )}
          </div>

          {/* Message Input Form */}
          <form onSubmit={handleSendMessage} className="flex gap-2 pt-3 border-t border-zinc-800">
            <input
              type="text"
              placeholder="Type your message..."
              value={inputMsg}
              onChange={(e) => setInputMsg(e.target.value)}
              className="flex-1 rounded-2xl border border-zinc-800 bg-zinc-900 px-4 py-2.5 text-xs text-white placeholder-zinc-500 focus:border-amber-500 focus:outline-none"
            />
            <button
              type="submit"
              className="rounded-2xl bg-amber-500 px-4 py-2.5 text-zinc-950 hover:bg-amber-400 transition font-bold"
            >
              <Send className="w-4 h-4" />
            </button>
          </form>
        </div>
      ) : (
        /* Conversations Inbox List */
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
              className="flex items-center gap-1.5 rounded-xl bg-amber-500 px-3 py-2 text-xs font-bold text-zinc-950 hover:bg-amber-400 transition shadow-lg shadow-amber-500/20"
            >
              <Plus className="w-3.5 h-3.5" /> New Chat
            </button>
          </div>

          {/* Search bar */}
          <div className="relative">
            <Search className="absolute left-3 top-2.5 w-4 h-4 text-zinc-500" />
            <input
              type="text"
              placeholder="Search by Conversation ID or Numeric User ID..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full rounded-2xl border border-zinc-800 bg-zinc-900 pl-9 pr-3 py-2 text-xs text-zinc-200 placeholder-zinc-500 focus:border-amber-500 focus:outline-none font-mono"
            />
          </div>

          {/* Conversations list */}
          <div className="space-y-2">
            {filteredConversations.map((conv) => {
              const other = getOtherParticipant(conv);
              const isSupport = other === 'ADMIN_SUPPORT';

              return (
                <button
                  key={conv.id}
                  onClick={() => setActiveConv(conv)}
                  className="w-full flex items-center justify-between rounded-2xl border border-zinc-800 bg-zinc-900/80 p-3.5 hover:border-zinc-700 hover:bg-zinc-900 transition text-left"
                >
                  <div className="flex items-center gap-3">
                    <div className={`rounded-xl p-2.5 ${
                      isSupport ? 'bg-sky-500/20 text-sky-400' : 'bg-amber-500/20 text-amber-400'
                    }`}>
                      {isSupport ? <ShieldCheck className="w-5 h-5" /> : <MessageSquare className="w-5 h-5" />}
                    </div>
                    <div>
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs font-bold font-mono text-zinc-200">
                          {isSupport ? 'Official Verified Support' : `User #${other}`}
                        </span>
                        <span className="text-[10px] text-zinc-500 font-mono">({conv.id})</span>
                      </div>
                      <p className="text-[11px] text-zinc-400 truncate max-w-xs mt-0.5">
                        {conv.lastMessage || 'No messages yet'}
                      </p>
                    </div>
                  </div>

                  <span className="text-[10px] font-mono text-zinc-500">
                    {new Date(conv.lastMessageAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </span>
                </button>
              );
            })}

            {filteredConversations.length === 0 && (
              <div className="py-12 text-center text-xs text-zinc-500 border border-dashed border-zinc-850 rounded-2xl">
                No conversations found. Tap "New Chat" above to message a peer by numeric ID.
              </div>
            )}
          </div>

          {/* New Chat Modal */}
          {isNewChatOpen && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
              <div className="relative w-full max-w-sm rounded-2xl border border-zinc-800 bg-zinc-900 p-5 shadow-2xl text-zinc-100">
                <h3 className="font-bold text-sm text-white mb-1">Start New Conversation</h3>
                <p className="text-xs text-zinc-400 mb-4">Enter recipient's 6-digit numeric User ID</p>

                <form onSubmit={handleStartNewConversation} className="space-y-3">
                  <input
                    type="text"
                    placeholder="e.g. 541290"
                    value={newPeerId}
                    onChange={(e) => setNewPeerId(e.target.value.replace(/\D/g, ''))}
                    className="w-full rounded-xl border border-zinc-800 bg-zinc-950 p-2.5 text-xs font-mono text-zinc-100 focus:border-amber-500 focus:outline-none"
                  />

                  {newChatError && (
                    <p className="text-xs text-red-400 font-medium">{newChatError}</p>
                  )}

                  <div className="flex gap-2 pt-2">
                    <button
                      type="button"
                      onClick={() => setIsNewChatOpen(false)}
                      className="flex-1 rounded-xl bg-zinc-800 py-2 text-xs font-semibold text-zinc-300 hover:bg-zinc-700"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      className="flex-1 rounded-xl bg-amber-500 py-2 text-xs font-bold text-zinc-950 hover:bg-amber-400 shadow-md shadow-amber-500/20"
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
