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
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="w-full max-w-md rounded-3xl bg-slate-900 border border-white/10 p-6 shadow-2xl space-y-6">
        <div className="text-center space-y-1">
          <h2 className="text-xl font-bold text-white">Pick your identity</h2>
          <p className="text-sm text-white/50">No account needed. This is how others will see you.</p>
        </div>

        {/* Preview */}
        <div className="flex flex-col items-center gap-3 py-2">
          <Avatar emoji={emoji} color={color} size="xl" ring />
          <span className="text-white font-medium text-lg">{nickname.trim() || 'Your nickname'}</span>
        </div>

        {/* Nickname */}
        <div className="space-y-2">
          <label className="text-xs font-medium text-white/60 uppercase tracking-wide">Nickname</label>
          <div className="flex gap-2">
            <input
              value={nickname}
              onChange={(e) => checkNickname(e.target.value)}
              maxLength={24}
              placeholder="e.g. Curious Panda"
              className="flex-1 px-4 py-2.5 rounded-xl bg-slate-800 border border-white/10 text-white placeholder:text-white/30 focus:outline-none focus:border-indigo-400 transition-colors"
            />
            <button
              onClick={shuffleName}
              className="px-3 rounded-xl bg-slate-800 border border-white/10 text-white/70 hover:text-white hover:border-white/30 transition-colors"
              title="Random name"
            >
              <Shuffle size={18} />
            </button>
          </div>
          {taken && (
            <p className="text-xs text-amber-400">Someone is using that name right now. Try another?</p>
          )}
          {checking && <p className="text-xs text-white/40">Checking…</p>}
        </div>

        {/* Avatar emoji */}
        <div className="space-y-2">
          <label className="text-xs font-medium text-white/60 uppercase tracking-wide">Avatar</label>
          <div className="grid grid-cols-10 gap-1.5 max-h-32 overflow-y-auto p-1 rounded-xl bg-slate-800/50">
            {AVATAR_EMOJIS.map((e) => (
              <button
                key={e}
                onClick={() => setEmoji(e)}
                className={`aspect-square rounded-lg flex items-center justify-center text-lg transition-all ${
                  emoji === e ? 'bg-indigo-500/30 ring-1 ring-indigo-400' : 'hover:bg-white/5'
                }`}
              >
                {e}
              </button>
            ))}
          </div>
        </div>

        {/* Color */}
        <div className="space-y-2">
          <label className="text-xs font-medium text-white/60 uppercase tracking-wide">Color</label>
          <div className="flex flex-wrap gap-2">
            {AVATAR_COLORS.map((c) => (
              <button
                key={c}
                onClick={() => setColor(c)}
                className={`w-8 h-8 rounded-full transition-all ${color === c ? 'ring-2 ring-offset-2 ring-offset-slate-900 ring-white scale-110' : 'hover:scale-105'}`}
                style={{ backgroundColor: c }}
              >
                {color === c && (
                  <span className="flex items-center justify-center w-full h-full">
                    <Check size={14} className="text-white" />
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>

        {/* Actions */}
        <div className="flex gap-3 pt-2">
          <button
            onClick={onCancel}
            className="flex-1 py-2.5 rounded-xl bg-slate-800 border border-white/10 text-white/70 hover:text-white hover:border-white/30 transition-colors font-medium"
          >
            Cancel
          </button>
          <button
            onClick={handleConfirm}
            disabled={taken || nickname.trim().length < 2}
            className="flex-1 py-2.5 rounded-xl bg-indigo-500 text-white font-medium hover:bg-indigo-400 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            Enter Junction
          </button>
        </div>
      </div>
    </div>
  );
}

export function randomizeAvatar() {
  return randomAvatar();
}
