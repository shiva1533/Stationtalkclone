import { useState, useEffect } from 'react';
import type { Session } from '@/types';
import { supabase } from '@/lib/supabase';
import { AVATAR_EMOJIS, AVATAR_COLORS, randomNickname, randomAvatar } from '@/lib/constants';
import { Shuffle, Check } from 'lucide-react';
import { Avatar } from './Avatar';

interface NicknameModalProps {
  open: boolean;
  session: Session;
  onConfirm: (s: Session) => void;
  onCancel: () => void;
}

export function NicknameModal({ open, session, onConfirm, onCancel }: NicknameModalProps) {
  const [nickname, setNickname] = useState(session.nickname);
  const [emoji, setEmoji] = useState(session.avatarEmoji);
  const [color, setColor] = useState(session.avatarColor);
  const [checking, setChecking] = useState(false);
  const [taken, setTaken] = useState(false);

  useEffect(() => {
    if (open) {
      setNickname(session.nickname);
      setEmoji(session.avatarEmoji);
      setColor(session.avatarColor);
      setTaken(false);
    }
  }, [open, session]);

  if (!open) return null;

  const handleConfirm = async () => {
    const finalNick = nickname.trim() || randomNickname();
    const updated: Session = {
      ...session,
      nickname: finalNick,
      avatarEmoji: emoji,
      avatarColor: color,
    };
    onConfirm(updated);
  };

  const shuffleName = () => {
    setNickname(randomNickname());
  };

  const checkNickname = async (value: string) => {
    setNickname(value);
    if (value.trim().length < 2) {
      setTaken(false);
      return;
    }
    setChecking(true);
    const cutoff = new Date(Date.now() - 90_000).toISOString();
    const { count } = await supabase
      .from('participants')
      .select('*', { count: 'exact', head: true })
      .ilike('nickname', value.trim())
      .gt('last_heartbeat', cutoff)
      .is('left_at', null)
      .neq('session_id', session.sessionId);
    setTaken((count ?? 0) > 0);
    setChecking(false);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-ink/35 animate-in fade-in duration-200">
      <section role="dialog" aria-modal="true" aria-labelledby="nickname-title" className="dialog space-y-4">
        <div className="space-y-1">
          <h2 id="nickname-title" className="text-base font-semibold">Join as a guest</h2>
          <p className="text-sm text-muted">Choose how you’ll appear to others in the room.</p>
        </div>

        {/* Preview */}
        <div className="flex items-center gap-3 rounded-md border border-line bg-canvas p-2.5">
          <Avatar emoji={emoji} color={color} size="md" />
          <span className="min-w-0 truncate text-sm font-medium">{nickname.trim() || 'Your nickname'}</span>
        </div>

        {/* Nickname */}
        <div className="space-y-1.5">
          <label htmlFor="guest-nickname" className="block text-xs font-medium text-muted">Nickname</label>
          <div className="flex gap-2">
            <input
              id="guest-nickname"
              value={nickname}
              onChange={(e) => checkNickname(e.target.value)}
              maxLength={24}
              placeholder="e.g. Curious Panda"
              className="field min-w-0 flex-1"
            />
            <button
              onClick={shuffleName}
              className="button button-secondary"
              aria-label="Random name"
            >
              <Shuffle size={18} />
            </button>
          </div>
          {taken && (
            <p className="text-xs text-warning">Someone is using that name right now. Try another?</p>
          )}
          {checking && <p className="text-xs text-muted">Checking…</p>}
        </div>

        {/* Avatar emoji */}
        <div className="space-y-1.5">
          <p id="guest-avatar" className="text-xs font-medium text-muted">Avatar</p>
          <div className="grid max-h-28 grid-cols-7 gap-1 overflow-y-auto rounded-md bg-subtle p-1.5 sm:grid-cols-8" role="group" aria-labelledby="guest-avatar">
            {AVATAR_EMOJIS.map((e) => (
              <button
                key={e}
                onClick={() => setEmoji(e)}
                aria-pressed={emoji === e}
                className={`grid aspect-square place-items-center rounded-md text-base transition-colors ${
                  emoji === e ? 'bg-surface ring-1 ring-inset ring-accent' : 'hover:bg-surface'
                }`}
              >
                {e}
              </button>
            ))}
          </div>
        </div>

        {/* Color */}
        <div className="space-y-1.5">
          <p id="guest-color" className="text-xs font-medium text-muted">Color</p>
          <div className="flex flex-wrap gap-1.5" role="group" aria-labelledby="guest-color">
            {AVATAR_COLORS.map((c) => (
              <button
                key={c}
                onClick={() => setColor(c)}
                aria-label={`Avatar color ${c}`}
                aria-pressed={color === c}
                className={`size-7 rounded-full ${color === c ? 'ring-2 ring-accent ring-offset-1' : 'hover:ring-1 hover:ring-outline'}`}
                style={{ backgroundColor: c }}
              >
                {color === c && (
                  <span className="flex items-center justify-center w-full h-full">
                    <Check size={14} className="text-ink" />
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>

        {/* Actions */}
        <div className="flex gap-2 pt-1">
          <button
            onClick={onCancel}
            className="button button-secondary flex-1"
          >
            Cancel
          </button>
          <button
            onClick={handleConfirm}
            disabled={taken || nickname.trim().length < 2}
            className="button button-primary flex-1"
          >
            Join room
          </button>
        </div>
      </section>
    </div>
  );
}

export function randomizeAvatar() {
  return randomAvatar();
}
