import { useState, useRef, useEffect } from 'react';
import { Send, Smile, X, Bell, BellOff } from 'lucide-react';
import type { Message, Participant, Reaction } from '@/types';
import { ChatMessage } from './ChatMessage';
import { supabase } from '@/lib/supabase';
import { useSession } from '@/context/SessionContext';

interface ChatPanelProps {
  junctionId: string;
  messages: Message[];
  reactions: Reaction[];
  blockedSessions: Set<string>;
  isBlocked: (sender: { session_id: string; user_id?: string | null }) => boolean;
  participants: Participant[];
  connected: boolean;
  slowModeSeconds: number;
  onSend: (content: string, replyTo: string | null) => Promise<void>;
  onToggleReaction: (messageId: string, emoji: string) => Promise<void>;
  onReport: (sessionId: string, nickname: string) => void;
  onBlock: (sessionId: string) => void;
  notificationsMuted: boolean;
  onToggleMute: () => void;
}

interface TypingUser {
  sessionId: string;
  userId: string;
  nickname: string;
  avatarColor: string;
}

const EMOJI_PICKER = [
  '😀', '😂', '😍', '🥰', '😎', '🤔', '😅', '😭', '😢', '😡', '👍',
  '👎', '👏', '🙌', '🤝', '👋', '🔥', '✨', '💯', '🎉', '❤️',
  '🧡', '💛', '💚', '💙', '💜', '🤍', '🖤', '💪', '🤙', '🙏',
];

export function ChatPanel({
  junctionId,
  messages,
  reactions,
  blockedSessions,
  isBlocked,
  participants,
  connected,
  slowModeSeconds,
  onSend,
  onToggleReaction,
  onReport,
  onBlock,
  notificationsMuted,
  onToggleMute,
}: ChatPanelProps) {
  const { session } = useSession();
  const [input, setInput] = useState('');
  const [replyTo, setReplyTo] = useState<Message | null>(null);
  const [showEmoji, setShowEmoji] = useState(false);
  const [sending, setSending] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const [atBottom, setAtBottom] = useState(true);
  const [typingUsers, setTypingUsers] = useState<Map<string, TypingUser>>(new Map());
  const [slowModeRemaining, setSlowModeRemaining] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const emojiRef = useRef<HTMLDivElement>(null);
  const lastMessageId = useRef<string | null>(null);
  const typingChannelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const lastTypingSent = useRef(0);
  const lastSentTime = useRef(0);
  const typingTimeoutRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const members = useRef(participants);
  members.current = participants;

  // Auto-scroll
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (atBottom) {
      el.scrollTop = el.scrollHeight;
    }
    if (messages.length > 0) {
      const last = messages[messages.length - 1];
      if (last.id !== lastMessageId.current) {
        lastMessageId.current = last.id;
        if (!atBottom && last.session_id !== session?.sessionId) {
          setUnreadCount((c) => c + 1);
        }
      }
    }
  }, [messages, atBottom, session]);

  // Typing indicator channel
  useEffect(() => {
    if (!connected) return;
    const timeouts = typingTimeoutRef.current;
    const ch = supabase.channel(`typing:${junctionId}`, { config: { private: true, broadcast: { self: false } } });
    ch.on('broadcast', { event: 'typing' }, (payload) => {
      const data = payload.payload as TypingUser;
      if (data.sessionId === session?.sessionId) return;
      const member = members.current.find((person) => person.session_id === data.sessionId && person.user_id === data.userId);
      if (!member || isBlocked(member)) return;
      data.nickname = member.nickname;
      data.avatarColor = member.avatar_color;
      setTypingUsers((prev) => {
        const next = new Map(prev);
        next.set(data.sessionId, data);
        return next;
      });
      const existing = typingTimeoutRef.current.get(data.sessionId);
      if (existing) clearTimeout(existing);
      typingTimeoutRef.current.set(
        data.sessionId,
        setTimeout(() => {
          setTypingUsers((prev) => {
            const next = new Map(prev);
            next.delete(data.sessionId);
            return next;
          });
        }, 4000),
      );
    });
    ch.subscribe();
    typingChannelRef.current = ch;

    return () => {
      supabase.removeChannel(ch);
      timeouts.forEach((t) => clearTimeout(t));
      timeouts.clear();
    };
  }, [junctionId, session?.sessionId, connected, isBlocked]);

  // Slow mode countdown
  useEffect(() => {
    if (slowModeRemaining <= 0) return;
    const timer = setTimeout(() => setSlowModeRemaining((s) => Math.max(0, s - 1)), 1000);
    return () => clearTimeout(timer);
  }, [slowModeRemaining]);

  // Emoji picker outside click
  useEffect(() => {
    if (!showEmoji) return;
    const handler = (e: MouseEvent) => {
      if (emojiRef.current && !emojiRef.current.contains(e.target as Node)) {
        setShowEmoji(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showEmoji]);

  const handleScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const isBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
    setAtBottom(isBottom);
    if (isBottom) setUnreadCount(0);
  };

  const scrollToBottom = () => {
    const el = scrollRef.current;
    if (el) {
      el.scrollTop = el.scrollHeight;
      setUnreadCount(0);
    }
  };

  const broadcastTyping = () => {
    if (!session) return;
    const now = Date.now();
    if (now - lastTypingSent.current < 3000) return;
    lastTypingSent.current = now;
    typingChannelRef.current?.send({
      type: 'broadcast',
      event: 'typing',
      payload: {
        sessionId: session.sessionId,
        userId: session.userId,
        nickname: session.nickname,
        avatarColor: session.avatarColor,
      },
    });
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    if (e.target.value.trim()) broadcastTyping();
  };

  const handleSend = async () => {
    if (!input.trim() || sending || slowModeRemaining > 0) return;
    setSending(true);
    try {
      await onSend(input, replyTo && !isBlocked(replyTo) ? replyTo.id : null);
      setInput('');
      setReplyTo(null);
      setAtBottom(true);
      lastSentTime.current = Date.now();
      if (slowModeSeconds > 0) setSlowModeRemaining(slowModeSeconds);
    } catch (err) {
      console.error('Send failed:', err);
    } finally {
      setSending(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const addEmoji = (emoji: string) => {
    setInput((prev) => prev + emoji);
  };

  const messageMap = new Map(messages.map((m) => [m.id, m]));
  const reactionsByMessage = reactions.reduce<Record<string, Reaction[]>>((acc, r) => {
    if (!acc[r.message_id]) acc[r.message_id] = [];
    acc[r.message_id].push(r);
    return acc;
  }, {});

  const activeTyping = Array.from(typingUsers.values())
    .filter((user) => !isBlocked({ session_id: user.sessionId, user_id: user.userId })).slice(0, 3);
  const canSend = input.trim().length > 0 && !sending && slowModeRemaining === 0;

  return (
    <section className="room-chat">
      {/* Chat header */}
      <div className="room-panel-heading">
        <h2>Live chat</h2>
        <div className="flex items-center gap-2">
          {unreadCount > 0 && (
            <span className="text-xs px-2 py-0.5 rounded-full bg-accent text-white font-medium">
              {unreadCount} new
            </span>
          )}
          {slowModeSeconds > 0 && (
            <span className="text-xs px-1.5 py-0.5 rounded-full bg-subtle text-warning border border-line">
              slow: {slowModeSeconds}s
            </span>
          )}
          <button
            onClick={onToggleMute}
            className="room-icon-button"
            aria-label={notificationsMuted ? 'Unmute notifications' : 'Mute notifications'}
            title={notificationsMuted ? 'Unmute notifications' : 'Mute notifications'}
          >
            {notificationsMuted ? <BellOff size={16} /> : <Bell size={16} />}
          </button>
        </div>
      </div>

      {/* Messages */}
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="room-chat-messages"
      >
        {messages.length === 0 ? (
          <div className="room-chat-empty">
            <p>No messages yet. Say hello to start the chat.</p>
          </div>
        ) : (
          messages.map((msg) => (
            <ChatMessage
              key={msg.id}
              message={msg}
              reactions={reactionsByMessage[msg.id] ?? []}
              replyToMessage={msg.reply_to ? messageMap.get(msg.reply_to) : undefined}
              blockedSessions={blockedSessions}
              onToggleReaction={onToggleReaction}
              onReply={setReplyTo}
              onReport={onReport}
              onBlock={onBlock}
            />
          ))
        )}
      </div>

      {/* Typing indicator */}
      {activeTyping.length > 0 && (
        <div className="px-4 py-1.5 text-xs text-muted flex items-center gap-2 border-t border-line bg-subtle">
          <div className="flex gap-0.5">
            <span className="w-1 h-1 rounded-full bg-outline animate-bounce" style={{ animationDelay: '0ms' }} />
            <span className="w-1 h-1 rounded-full bg-outline animate-bounce" style={{ animationDelay: '150ms' }} />
            <span className="w-1 h-1 rounded-full bg-outline animate-bounce" style={{ animationDelay: '300ms' }} />
          </div>
          <span>
            {activeTyping.length === 1
              ? `${activeTyping[0].nickname} is typing…`
              : activeTyping.length === 2
                ? `${activeTyping[0].nickname} and ${activeTyping[1].nickname} are typing…`
                : `${activeTyping[0].nickname} and ${activeTyping.length - 1} others are typing…`}
          </span>
        </div>
      )}

      {/* Scroll to bottom button */}
      {!atBottom && unreadCount > 0 && (
        <button
          onClick={scrollToBottom}
          className="absolute bottom-20 right-6 z-10 px-3 py-1.5 rounded-full bg-accent text-white text-xs font-medium shadow-lg flex items-center gap-1.5 animate-in fade-in slide-in-from-bottom-2 duration-200"
        >
          {unreadCount} new message{unreadCount > 1 ? 's' : ''} ↓
        </button>
      )}

      {/* Reply preview */}
      {replyTo && !isBlocked(replyTo) && (
        <div className="px-3 py-2 bg-accent-soft border-t border-accent-line flex items-center gap-2">
          <span className="text-muted text-xs">↳</span>
          <div className="flex-1 min-w-0 text-xs">
            <span className="font-medium">{replyTo.nickname}</span>
            <span className="text-muted">: {replyTo.content}</span>
          </div>
          <button onClick={() => setReplyTo(null)} className="text-muted hover:text-ink">
            <X size={14} />
          </button>
        </div>
      )}

      {/* Emoji picker */}
      {showEmoji && (
        <div ref={emojiRef} className="chat-emoji-panel">
          <div className="chat-emoji-grid">
            {EMOJI_PICKER.map((e) => (
              <button
                key={e}
                onClick={() => addEmoji(e)}
                aria-label={`Insert ${e}`}
                className="reaction-emoji-button"
              >
                {e}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Input */}
      <div className="room-chat-composer">
        <div className="composer-controls">
          <div className="relative">
            <button
              onClick={() => setShowEmoji((v) => !v)}
              aria-label="Choose an emoji"
              aria-expanded={showEmoji}
              className="room-icon-button composer-emoji"
            >
              <Smile size={16} />
            </button>
          </div>
          <textarea
            value={input}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            rows={1}
            maxLength={500}
            placeholder={slowModeRemaining > 0 ? `Wait ${slowModeRemaining}s…` : 'Type a message...'}
            aria-label="Chat message"
            disabled={slowModeRemaining > 0}
            className="composer-input"
          />
          <button
            onClick={handleSend}
            aria-label="Send message"
            disabled={!canSend}
            className="composer-send"
          >
            <Send size={16} />
          </button>
        </div>
      </div>
    </section>
  );
}
