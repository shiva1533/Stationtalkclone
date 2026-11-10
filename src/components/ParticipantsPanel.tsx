import { useEffect, useRef, useState } from 'react';
import { Ban, Flag, Headphones, Mic, MicOff, MoreVertical, Users, Volume2, VolumeX, X } from 'lucide-react';
import type { Participant } from '@/types';
import { Avatar } from './Avatar';
import { useSession } from '@/context/SessionContext';

interface ParticipantsPanelProps {
  participants: Participant[];
  mutedSessions: Set<string>;
  blockedSessions: Set<string>;
  onMute: (sessionId: string) => void;
  onUnblock: (sessionId: string) => void;
  onReport: (sessionId: string, nickname: string) => void;
  onBlock: (sessionId: string) => void;
  onClose?: () => void;
}

export function ParticipantsPanel({ participants, mutedSessions, blockedSessions, onMute, onUnblock, onReport, onBlock, onClose }: ParticipantsPanelProps) {
  const { session } = useSession();
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuFor) return;
    const handler = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) setMenuFor(null);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [menuFor]);

  const inVoice = participants.filter((participant) => participant.in_voice);
  const listeners = participants.filter((participant) => !participant.in_voice);

  const renderParticipant = (participant: Participant) => {
    const isOwn = participant.session_id === session?.sessionId;
    const isMuted = mutedSessions.has(participant.session_id);
    const isBlocked = blockedSessions.has(participant.session_id);
    return (
      <div key={participant.id} className={`group relative flex items-center gap-2.5 rounded-xl px-3 py-2.5 transition-colors ${participant.is_speaking ? 'bg-emerald-500/10' : 'hover:bg-white/5'}`}>
        <Avatar emoji={participant.avatar_emoji} color={participant.avatar_color} size="sm" speaking={participant.is_speaking} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="truncate text-sm font-medium text-white/90">{participant.nickname}</span>
            {isOwn && <span className="text-xs text-white/35">you</span>}
          </div>
          {participant.in_voice ? (
            <div className="mt-0.5 flex items-center gap-1.5 text-[10px] text-white/40">
              {participant.mic_muted ? <><MicOff size={10} /> muted</> : <><Mic size={10} className="text-emerald-400" /> {participant.is_speaking ? 'speaking' : 'live mic'}</>}
            </div>
          ) : <div className="mt-0.5 flex items-center gap-1 text-[10px] text-white/35"><Headphones size={10} /> listening</div>}
        </div>

        {!isOwn && <div className="relative" ref={menuFor === participant.id ? menuRef : undefined}>
          <button onClick={() => setMenuFor(menuFor === participant.id ? null : participant.id)} className="rounded-lg p-1.5 text-white/40 transition-colors hover:bg-white/10 hover:text-white" aria-label={`Actions for ${participant.nickname}`}>
            <MoreVertical size={16} />
          </button>
          {menuFor === participant.id && <div className="absolute right-0 top-9 z-30 min-w-40 rounded-xl border border-white/10 bg-[#141521] p-1.5 shadow-2xl">
            <button onClick={() => { onMute(participant.session_id); setMenuFor(null); }} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-xs text-white/75 hover:bg-white/10 hover:text-white">
              {isMuted ? <Volume2 size={14} /> : <VolumeX size={14} />}{isMuted ? 'Unmute audio' : 'Mute audio'}
            </button>
            <button onClick={() => { onReport(participant.session_id, participant.nickname); setMenuFor(null); }} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-xs text-white/75 hover:bg-white/10 hover:text-white"><Flag size={14} /> Report</button>
            {isBlocked ? <button onClick={() => { onUnblock(participant.session_id); setMenuFor(null); }} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-xs text-white/75 hover:bg-white/10"><Ban size={14} /> Unblock</button> : <button onClick={() => { onBlock(participant.session_id); setMenuFor(null); }} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-xs text-red-300 hover:bg-red-500/10"><Ban size={14} /> Block</button>}
          </div>}
        </div>}
        {isMuted && !isOwn && <VolumeX size={14} className="text-amber-300/70" />}
      </div>
    );
  };

  return (
    <div className="flex h-full flex-col bg-[#10111b]/70">
      <div className="flex items-center justify-between border-b border-white/5 px-4 py-3">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-white/90"><Users size={16} className="text-white/50" /> People ({participants.length})</h3>
        {onClose && <button onClick={onClose} className="rounded p-1 text-white/40 hover:text-white"><X size={18} /></button>}
      </div>
      <div className="flex-1 space-y-4 overflow-y-auto p-2">
        {inVoice.length > 0 && <div><p className="mb-1.5 flex items-center gap-1.5 px-3 text-[10px] font-medium uppercase tracking-wide text-white/30"><Volume2 size={11} /> In voice ({inVoice.length})</p><div className="space-y-0.5">{inVoice.map(renderParticipant)}</div></div>}
        <div><p className="mb-1.5 px-3 text-[10px] font-medium uppercase tracking-wide text-white/30">Listening ({listeners.length})</p><div className="space-y-0.5">{listeners.map(renderParticipant)}</div></div>
      </div>
    </div>
  );
}
