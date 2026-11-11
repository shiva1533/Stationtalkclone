import { useState, useRef, useEffect } from 'react';
import { CornerDownRight, MoreVertical, Flag, Ban } from 'lucide-react';
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
      <div className="flex items-center gap-2 py-1.5 text-xs text-muted italic px-2">
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
    <div className="flex gap-2.5 px-3 py-1.5 transition-colors hover:bg-subtle">
      <Avatar emoji={message.avatar_emoji} color={message.avatar_color} size="sm" />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="min-w-0 truncate text-sm font-medium">
            {message.nickname}
            {isOwn && <span className="text-muted ml-1 text-xs">(you)</span>}
          </span>
          <span className="shrink-0 text-xs text-muted">{formatTime(message.created_at)}</span>
        </div>

        {replyToMessage && (
          <div className="flex items-center gap-1.5 text-xs text-muted mt-0.5 mb-0.5 pl-2 border-l-2" style={{ borderColor: replyToMessage.avatar_color }}>
            <CornerDownRight size={12} />
            <span className="max-w-[45%] truncate font-medium">{replyToMessage.nickname}:</span>
            <span className="truncate">{replyToMessage.content}</span>
          </div>
        )}

        <p className="text-sm text-ink break-words leading-relaxed">{message.content}</p>

        {/* Reactions */}
        {Object.keys(grouped).length > 0 && (
          <div className="flex flex-wrap gap-1 mt-1.5">
            {Object.entries(grouped).map(([emoji, info]) => (
              <button
                key={emoji}
                onClick={() => onToggleReaction(message.id, emoji)}
                className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-xs border transition-all ${
                  info.hasMine
                    ? 'bg-accent-soft border-accent-line text-accent'
                    : 'bg-subtle border-line text-muted hover:border-outline'
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
          aria-label="Message actions"
          aria-expanded={showActions}
          className="grid size-7 place-items-center rounded text-muted hover:bg-surface hover:text-ink"
        >
          <MoreVertical size={14} />
        </button>

        {showActions && (
          <div className="absolute right-0 top-7 z-20 bg-surface border border-line rounded-md shadow-md py-1 min-w-[140px]">
            <button
              onClick={() => { setShowReactions((v) => !v); setShowActions(false); }}
              className="w-full px-3 py-1.5 text-left text-sm text-ink hover:bg-subtle"
            >
              React
            </button>
            <button
              onClick={() => { onReply(message); setShowActions(false); }}
              className="w-full px-3 py-1.5 text-left text-sm text-ink hover:bg-subtle"
            >
              Reply
            </button>
            {!isOwn && (
              <>
                <button
                  onClick={() => { onReport(message.session_id, message.nickname); setShowActions(false); }}
                  className="w-full px-3 py-1.5 text-left text-sm text-ink hover:bg-subtle flex items-center gap-2"
                >
                  <Flag size={13} /> Report
                </button>
                <button
                  onClick={() => { onBlock(message.session_id); setShowActions(false); }}
                  className="w-full px-3 py-1.5 text-left text-sm text-ink hover:bg-subtle flex items-center gap-2"
                >
                  <Ban size={13} /> Block
                </button>
              </>
            )}
          </div>
        )}

        {showReactions && (
          <div role="group" aria-label="Message reactions" className="reaction-picker-grid absolute right-0 top-7 z-20 rounded-xl border border-line bg-surface shadow-md">
            {REACTION_EMOJIS.map((emoji) => (
              <button
                key={emoji}
                aria-label={`React with ${emoji}`}
                onClick={() => { onToggleReaction(message.id, emoji); setShowReactions(false); }}
                className="reaction-emoji-button hover:bg-accent-soft"
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
