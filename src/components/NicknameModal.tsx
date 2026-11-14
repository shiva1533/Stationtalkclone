import { useState, useEffect, useRef } from 'react';
import type { Session } from '@/types';
import { supabase } from '@/lib/supabase';
import { AVATAR_EMOJIS, AVATAR_COLORS, randomNickname, randomAvatar } from '@/lib/constants';
import { Shuffle, Check } from 'lucide-react';
import { Avatar } from './Avatar';
import { Dialog } from './Dialog';
import { validDisplayName } from '@/lib/session';

interface NicknameModalProps {
  open: boolean;
  session: Session;
  onConfirm: (s: Session) => void | Promise<void>;
  onCancel: () => void;
  title?: string;
  description?: string;
  confirmLabel?: string;
}

export function NicknameModal({ open, session, onConfirm, onCancel, title = 'Join as a guest', description = 'Choose how you’ll appear to others in the room.', confirmLabel = 'Join room' }: NicknameModalProps) {
  const [nickname, setNickname] = useState(session.nickname);
  const [emoji, setEmoji] = useState(session.avatarEmoji);
  const [color, setColor] = useState(session.avatarColor);
  const [checking, setChecking] = useState(false);
  const [taken, setTaken] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const checkVersion = useRef(0);

  useEffect(() => {
    if (open) {
      setNickname(session.nickname);
      setEmoji(session.avatarEmoji);
      setColor(session.avatarColor);
      setTaken(false);
      setError('');
    }
  }, [open, session]);

  if (!open) return null;

  const handleConfirm = async () => {
    const finalNick = nickname.trim();
    if (!validDisplayName(finalNick) || saving || checking || taken) return;
    const updated: Session = {
      ...session,
      nickname: finalNick,
      avatarEmoji: emoji,
      avatarColor: color,
      nameConfirmed: true,
    };
    setSaving(true);
    setError('');
    try {
      await onConfirm(updated);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not save your display name.');
    } finally {
      setSaving(false);
    }
  };

  const shuffleName = () => {
    void checkNickname(randomNickname());
  };

  const checkNickname = async (value: string) => {
    const version = ++checkVersion.current;
    setNickname(value);
    if (value.trim().length < 2) {
      setTaken(false);
      setChecking(false);
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
      .neq('user_id', session.userId);
    if (version !== checkVersion.current) return;
    setTaken((count ?? 0) > 0);
    setChecking(false);
  };

  return (
    <Dialog titleId="nickname-title" onClose={onCancel}>
        <div className="space-y-1">
          <h2 id="nickname-title" className="text-base font-semibold">{title}</h2>
          <p className="text-sm text-muted">{description}</p>
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
            disabled={taken || checking || saving || !validDisplayName(nickname)}
            className="button button-primary flex-1"
          >
            {saving ? 'Saving…' : confirmLabel}
          </button>
        </div>
        {error && <p role="alert" className="text-sm text-danger">{error}</p>}
    </Dialog>
  );
}

export function randomizeAvatar() {
  return randomAvatar();
}
