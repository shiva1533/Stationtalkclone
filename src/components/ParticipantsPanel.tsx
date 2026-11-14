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
      <div key={participant.id} className={`people-row ${participant.is_speaking ? 'is-speaking' : ''}`}>
        <Avatar emoji={participant.avatar_emoji} color={participant.avatar_color} size="md" speaking={participant.is_speaking} speakingColor="#8B5CF6" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="truncate text-sm font-medium text-ink">{participant.nickname}</span>
            {isOwn && <span className="text-xs text-muted">you</span>}
          </div>
          {participant.in_voice ? (
            <div className="mt-0.5 flex items-center gap-1.5 text-xs text-muted">
              {participant.mic_muted ? <><MicOff size={10} /> muted</> : <><Mic size={10} className="text-accent" /> {participant.is_speaking ? 'speaking' : 'live mic'}</>}
            </div>
          ) : <div className="mt-0.5 flex items-center gap-1 text-xs text-muted"><Headphones size={10} /> listening</div>}
        </div>

        {!isOwn && <div className="relative" ref={menuFor === participant.id ? menuRef : undefined}>
          <button onClick={() => setMenuFor(menuFor === participant.id ? null : participant.id)} className="room-icon-button" aria-label={`Actions for ${participant.nickname}`}>
            <MoreVertical size={16} />
          </button>
          {menuFor === participant.id && <div className="absolute right-0 top-9 z-30 min-w-40 rounded-md border border-line bg-surface p-1.5 shadow-lg">
            <button onClick={() => { onMute(participant.session_id); setMenuFor(null); }} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-xs text-muted hover:bg-subtle hover:text-ink">
              {isMuted ? <Volume2 size={14} /> : <VolumeX size={14} />}{isMuted ? 'Unmute audio' : 'Mute audio'}
            </button>
            <button onClick={() => { onReport(participant.session_id, participant.nickname); setMenuFor(null); }} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-xs text-muted hover:bg-subtle hover:text-ink"><Flag size={14} /> Report</button>
            {isBlocked ? <button onClick={() => { onUnblock(participant.session_id); setMenuFor(null); }} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-xs text-muted hover:bg-subtle"><Ban size={14} /> Unblock</button> : <button onClick={() => { onBlock(participant.session_id); setMenuFor(null); }} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-xs text-danger hover:bg-danger-soft"><Ban size={14} /> Block</button>}
          </div>}
        </div>}
        {isMuted && !isOwn && <VolumeX size={14} className="text-warning" />}
      </div>
    );
  };

  return (
    <section className="room-people">
      <div className="room-panel-heading">
        <h2 className="flex items-center gap-2"><Users size={16} className="text-accent" /> People ({participants.length})</h2>
        {onClose && <button onClick={onClose} className="rounded p-1 text-muted hover:text-ink"><X size={18} /></button>}
      </div>
      <div className="people-list">
        <div className="people-group">
          <h3><Volume2 size={12} /> IN VOICE <span>({inVoice.length})</span></h3>
          {inVoice.map(renderParticipant)}
        </div>
        <div className="people-group">
          <h3><Headphones size={12} /> LISTENING <span>({listeners.length})</span></h3>
          {listeners.map(renderParticipant)}
        </div>
      </div>
    </section>
  );
}
