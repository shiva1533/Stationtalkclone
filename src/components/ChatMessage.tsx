import { useState, useRef, useEffect } from 'react';
import { CornerDownRight, MoreVertical, Flag, Ban, X } from 'lucide-react';
import type { Message, Reaction as ReactionType } from '@/types';
import { Avatar } from './Avatar';
import { REACTION_EMOJIS } from '@/lib/constants';
import { useSession } from '@/context/SessionContext';

interface ChatMessageProps {
  message: Message;
  reactions: ReactionType[];
  replyToMessage?: Message;
  blockedSessions: Set<string>;
  onToggleReaction: (messageId: string, emoji: string) => void;
  onReply: (message: Message) => void;
  onReport: (sessionId: string, nickname: string) => void;
  onBlock: (sessionId: string) => void;
}

export function ChatMessage({
  message,
  reactions,
  replyToMessage,
  blockedSessions,
  onToggleReaction,
  onReply,
  onReport,
  onBlock,
}: ChatMessageProps) {
  const { session } = useSession();
  const [showActions, setShowActions] = useState(false);
  const [showReactions, setShowReactions] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const isOwn = session?.sessionId === message.session_id;
  const isBlocked = blockedSessions.has(message.session_id);

  useEffect(() => {
    if (!showActions) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setShowActions(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showActions]);

  if (isBlocked) {
    return (
      <div className="flex items-center gap-2 py-1.5 text-xs text-white/30 italic px-2">
        <Ban size={12} />
        Blocked message hidden
      </div>
    );
  }

  const grouped = reactions.reduce<Record<string, { count: number; hasMine: boolean }>>((acc, r) => {
    if (!acc[r.emoji]) acc[r.emoji] = { count: 0, hasMine: false };
    acc[r.emoji].count += 1;
    if (r.session_id === session?.sessionId) acc[r.emoji].hasMine = true;
    return acc;
  }, {});

  return (
    <div className={`group flex gap-2.5 px-3 py-1.5 rounded-lg hover:bg-white/5 transition-colors ${isOwn ? '' : ''}`}>
      <Avatar emoji={message.avatar_emoji} color={message.avatar_color} size="sm" />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium" style={{ color: message.avatar_color }}>
            {message.nickname}
            {isOwn && <span className="text-white/40 ml-1 text-xs">(you)</span>}
          </span>
          <span className="text-[10px] text-white/30">{formatTime(message.created_at)}</span>
        </div>

        {replyToMessage && (
          <div className="flex items-center gap-1.5 text-xs text-white/40 mt-0.5 mb-0.5 pl-2 border-l-2" style={{ borderColor: replyToMessage.avatar_color }}>
            <CornerDownRight size={12} />
            <span style={{ color: replyToMessage.avatar_color }}>{replyToMessage.nickname}:</span>
            <span className="truncate">{replyToMessage.content}</span>
          </div>
        )}

        <p className="text-sm text-white/85 break-words leading-relaxed">{message.content}</p>

        {/* Reactions */}
        {Object.keys(grouped).length > 0 && (
          <div className="flex flex-wrap gap-1 mt-1.5">
            {Object.entries(grouped).map(([emoji, info]) => (
              <button
                key={emoji}
                onClick={() => onToggleReaction(message.id, emoji)}
                className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-xs border transition-all ${
                  info.hasMine
                    ? 'bg-indigo-500/20 border-indigo-400/40 text-white'
                    : 'bg-white/5 border-white/10 text-white/60 hover:border-white/30'
                }`}
              >
                <span>{emoji}</span>
                <span className="font-medium">{info.count}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Action button */}
      <div className="relative" ref={menuRef}>
        <button
          onClick={() => setShowActions((v) => !v)}
          className="opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded text-white/40 hover:text-white hover:bg-white/10"
        >
          <MoreVertical size={14} />
        </button>

        {showActions && (
          <div className="absolute right-0 top-7 z-20 bg-slate-800 border border-white/10 rounded-xl shadow-xl py-1 min-w-[140px]">
            <button
              onClick={() => { setShowReactions((v) => !v); setShowActions(false); }}
              className="w-full px-3 py-1.5 text-left text-sm text-white/80 hover:bg-white/5"
            >
              React
            </button>
            <button
              onClick={() => { onReply(message); setShowActions(false); }}
              className="w-full px-3 py-1.5 text-left text-sm text-white/80 hover:bg-white/5"
            >
              Reply
            </button>
            {!isOwn && (
              <>
                <button
                  onClick={() => { onReport(message.session_id, message.nickname); setShowActions(false); }}
                  className="w-full px-3 py-1.5 text-left text-sm text-white/80 hover:bg-white/5 flex items-center gap-2"
                >
                  <Flag size={13} /> Report
                </button>
                <button
                  onClick={() => { onBlock(message.session_id); setShowActions(false); }}
                  className="w-full px-3 py-1.5 text-left text-sm text-white/80 hover:bg-white/5 flex items-center gap-2"
                >
                  <Ban size={13} /> Block
                </button>
              </>
            )}
          </div>
        )}

        {showReactions && (
          <div className="absolute right-0 top-7 z-20 bg-slate-800 border border-white/10 rounded-full shadow-xl px-1.5 py-1 flex gap-0.5">
            {REACTION_EMOJIS.map((emoji) => (
              <button
                key={emoji}
                onClick={() => { onToggleReaction(message.id, emoji); setShowReactions(false); }}
                className="w-8 h-8 rounded-full hover:bg-white/10 flex items-center justify-center text-lg transition-transform hover:scale-125"
              >
                {emoji}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}
