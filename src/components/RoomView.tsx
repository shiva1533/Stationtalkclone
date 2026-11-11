import { useCallback, useEffect, useRef, useState } from 'react';
import { Compass, Headphones, HeadphoneOff, Mic, MicOff, MessageSquare, PhoneOff, Smile, Users, Volume2, X } from 'lucide-react';
import type { ReactNode } from 'react';
import type { Junction, Message, Participant, Session } from '@/types';
import { supabase } from '@/lib/supabase';
import { useJunctionRoom } from '@/hooks/useJunctionRoom';
import { useJunctions, type JunctionParticipantPreview } from '@/hooks/useJunctions';
import { VoiceManager } from '@/lib/voice';
import { CATEGORY_META, REACTION_EMOJIS } from '@/lib/constants';
import { Avatar } from './Avatar';
import { ChatPanel } from './ChatPanel';
import { JunctionCard } from './JunctionCard';
import { ParticipantsPanel } from './ParticipantsPanel';

interface RoomViewProps {
  junction: Junction;
  session: Session;
  onLeave: () => void;
  onExplore: (slug: string) => void;
}

const MAX_VOICE_PARTICIPANTS = 10;

type ExploreJunction = Junction & {
  online_count: number;
  voice_count: number;
  participants: JunctionParticipantPreview[];
};

type FloatingReaction = {
  id: string;
  emoji: string;
  x: number;
  sessionId: string;
  nickname: string;
};

export function RoomView({ junction, session, onLeave, onExplore }: RoomViewProps) {
  const { participants, messages, reactions, loading, sendMessage, toggleReaction, updateVoiceState, leaveRoom, reportUser } = useJunctionRoom(junction.id, session);
  const { junctions: exploreJunctions } = useJunctions();
  const [inVoice, setInVoice] = useState(false);
  const [micMuted, setMicMuted] = useState(true);
  const [speakerOn, setSpeakerOn] = useState(true);
  const [mobileTab, setMobileTab] = useState<'stage' | 'chat' | 'people'>('stage');
  const [voiceError, setVoiceError] = useState('');
  const [notificationsMuted, setNotificationsMuted] = useState(false);
  const [blockedSessions, setBlockedSessions] = useState<Set<string>>(new Set());
  const [mutedSessions, setMutedSessions] = useState<Set<string>>(new Set());
  const [reportTarget, setReportTarget] = useState<{ sessionId: string; nickname: string } | null>(null);
  const [floatingReactions, setFloatingReactions] = useState<FloatingReaction[]>([]);
  const [chatPopups, setChatPopups] = useState<Message[]>([]);
  const [showExplore, setShowExplore] = useState(false);
  const [showReactionPicker, setShowReactionPicker] = useState(false);
  const [speakingStates, setSpeakingStates] = useState<Record<string, boolean>>({});
  const voiceManagerRef = useRef<VoiceManager | null>(null);
  const audioElementsRef = useRef<Map<string, HTMLAudioElement>>(new Map());
  const reactionChannelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const lastMessageIdRef = useRef<string | null>(null);
  const speakingSyncRef = useRef<boolean | null>(null);
  const cat = CATEGORY_META[junction.category];
  const me = participants.find((participant) => participant.session_id === session.sessionId);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.from('blocks').select('blocked_session_id').eq('blocker_session_id', session.sessionId);
      setBlockedSessions(new Set((data ?? []).map((row) => row.blocked_session_id as string)));
    })();
  }, [session.sessionId]);

  useEffect(() => {
    const channel = supabase.channel(`room-reactions:${junction.id}`, { config: { broadcast: { self: true } } });
    channel.on('broadcast', { event: 'reaction' }, (payload) => {
      const reaction = payload.payload as FloatingReaction;
      setFloatingReactions((current) => [...current, reaction]);
      window.setTimeout(() => setFloatingReactions((current) => current.filter((item) => item.id !== reaction.id)), 4200);
    });
    channel.subscribe();
    reactionChannelRef.current = channel;
    return () => {
      supabase.removeChannel(channel);
      reactionChannelRef.current = null;
    };
  }, [junction.id]);

  useEffect(() => {
    if (messages.length === 0) return;
    const latest = messages[messages.length - 1];
    if (!lastMessageIdRef.current) {
      lastMessageIdRef.current = latest.id;
      return;
    }
    if (latest.id !== lastMessageIdRef.current && latest.session_id !== session.sessionId) {
      setChatPopups((current) => [...current, latest]);
      window.setTimeout(() => setChatPopups((current) => current.filter((message) => message.id !== latest.id)), 4200);
    }
    lastMessageIdRef.current = latest.id;
  }, [messages, session.sessionId]);

  useEffect(() => {
    if (!me?.in_voice) return;
    const speaking = speakingStates[session.sessionId] ?? false;
    if (speakingSyncRef.current !== speaking) {
      speakingSyncRef.current = speaking;
      updateVoiceState({ is_speaking: speaking });
    }
  }, [me?.in_voice, session.sessionId, speakingStates, updateVoiceState]);

  const handleSpeakingChange = useCallback((sessionId: string, speaking: boolean) => {
    setSpeakingStates((current) => current[sessionId] === speaking ? current : { ...current, [sessionId]: speaking });
  }, []);

  const handleRemoteStream = useCallback((sessionId: string, stream: MediaStream) => {
    let audio = audioElementsRef.current.get(sessionId);
    if (!audio) {
      audio = new Audio();
      audio.autoplay = true;
      audio.srcObject = stream;
      audioElementsRef.current.set(sessionId, audio);
    }
    audio.muted = mutedSessions.has(sessionId);
    audio.play().catch(() => {});
  }, [mutedSessions, speakerOn]);

  const handlePeerLeft = useCallback((sessionId: string) => {
    const audio = audioElementsRef.current.get(sessionId);
    if (audio) {
      audio.srcObject = null;
      audioElementsRef.current.delete(sessionId);
    }
    setSpeakingStates((current) => {
      const next = { ...current };
      delete next[sessionId];
      return next;
    });
  }, []);

  useEffect(() => {
    audioElementsRef.current.forEach((audio, sessionId) => {
      audio.muted = !speakerOn || mutedSessions.has(sessionId);
    });
  }, [mutedSessions, speakerOn]);

  const joinVoice = async () => {
    if (voiceParticipants.length >= MAX_VOICE_PARTICIPANTS) {
      setVoiceError('This room already has 10 people in voice. Please wait for a spot to open.');
      return;
    }
    setVoiceError('');
    try {
      const voice = new VoiceManager(junction.id, session.sessionId, session.nickname, session.avatarEmoji, {
        onRemoteStream: handleRemoteStream,
        onPeerLeft: handlePeerLeft,
        onPeerJoined: () => {},
        onSpeakingChange: handleSpeakingChange,
      });
      voiceManagerRef.current = voice;
      await voice.join();
      voice.setMicMuted(true);
      setInVoice(true);
      setMicMuted(true);
      await updateVoiceState({ in_voice: true, mic_muted: true, is_speaking: false });
    } catch (error) {
      setVoiceError(`${error instanceof Error ? error.message : 'Could not access microphone'}. Check browser permissions.`);
      voiceManagerRef.current?.leave();
      voiceManagerRef.current = null;
    }
  };

  const toggleMic = async () => {
    const nextMuted = !micMuted;
    setMicMuted(nextMuted);
    voiceManagerRef.current?.setMicMuted(nextMuted);
    await updateVoiceState({ mic_muted: nextMuted, is_speaking: false });
  };

  const sendReaction = (emoji: string) => {
    reactionChannelRef.current?.send({
      type: 'broadcast',
      event: 'reaction',
      payload: { id: `${session.sessionId}-${Date.now()}`, emoji, x: Math.random() * 62 + 18, sessionId: session.sessionId, nickname: session.nickname },
    });
  };

  const unblockUser = async (sessionId: string) => {
    setBlockedSessions((current) => {
      const next = new Set(current);
      next.delete(sessionId);
      return next;
    });
    await supabase.from('blocks').delete().eq('blocker_session_id', session.sessionId).eq('blocked_session_id', sessionId);
  };

  const toggleMute = (sessionId: string) => {
    setMutedSessions((current) => {
      const next = new Set(current);
      if (next.has(sessionId)) next.delete(sessionId); else next.add(sessionId);
      const audio = audioElementsRef.current.get(sessionId);
      if (audio) audio.muted = next.has(sessionId);
      return next;
    });
  };

  const handleBlock = async (sessionId: string) => {
    setBlockedSessions((current) => new Set([...current, sessionId]));
    await supabase.from('blocks').insert({ blocker_session_id: session.sessionId, blocked_session_id: sessionId });
  };

  const handleReport = (sessionId: string, nickname: string) => setReportTarget({ sessionId, nickname });
  const handleLeave = async () => { voiceManagerRef.current?.leave(); await leaveRoom(); onLeave(); };
  const voiceParticipants = participants.filter((participant) => participant.in_voice);
  const listeners = participants.filter((participant) => !participant.in_voice);
  const speakingCount = voiceParticipants.filter((participant) => participant.is_speaking || speakingStates[participant.session_id]).length;

  useEffect(() => () => { voiceManagerRef.current?.leave(); }, []);

  return (
    <div className="relative flex h-dvh flex-col overflow-hidden bg-canvas">
      <header className="z-20 flex shrink-0 items-center justify-between gap-3 border-b border-line bg-surface px-4 py-3 sm:px-6">
        <div className="flex min-w-0 items-center gap-3">
          <span className="grid size-9 shrink-0 place-items-center rounded-md bg-accent-soft text-base" aria-hidden="true">{cat.emoji}</span>
          <div className="min-w-0">
            <h1 className="truncate text-base font-semibold">{junction.name}</h1>
            {junction.description && <p className="truncate text-xs text-muted">{junction.description}</p>}
          </div>
        </div>
        <button onClick={() => setShowExplore(true)} className="button button-secondary shrink-0">
          <Compass size={16} aria-hidden="true" />
          <span className="hidden sm:inline">Explore rooms</span><span className="sm:hidden">Explore</span>
        </button>
      </header>

      <main className="flex min-h-0 flex-1 overflow-hidden">
        <div className={`min-w-0 flex-1 flex-col lg:flex ${mobileTab === 'stage' ? 'flex' : 'hidden'}`}>
          <ParticipantStage voiceParticipants={voiceParticipants} listeners={listeners} participants={participants} session={session} speakingStates={speakingStates} speakingCount={speakingCount} loading={loading} />
        </div>
        <div className={`min-w-0 flex-1 flex-col lg:flex lg:max-w-sm lg:border-l lg:border-line ${mobileTab === 'chat' ? 'flex' : 'hidden'}`}>
          <ChatPanel junctionId={junction.id} messages={messages} reactions={reactions} blockedSessions={blockedSessions} slowModeSeconds={junction.slow_mode_seconds} onSend={sendMessage} onToggleReaction={toggleReaction} onReport={handleReport} onBlock={handleBlock} notificationsMuted={notificationsMuted} onToggleMute={() => setNotificationsMuted((current) => !current)} />
        </div>
        <div className={`min-w-0 flex-1 flex-col lg:w-56 lg:flex-none lg:border-l lg:border-line lg:flex ${mobileTab === 'people' ? 'flex' : 'hidden'}`}>
          <ParticipantsPanel participants={participants} mutedSessions={mutedSessions} blockedSessions={blockedSessions} onMute={toggleMute} onUnblock={unblockUser} onReport={handleReport} onBlock={handleBlock} />
        </div>
      </main>

      {voiceError && (
        <div role="alert" className="absolute inset-x-4 top-20 z-50 mx-auto flex max-w-md items-center gap-3 rounded-md border border-danger-line bg-danger-soft px-3 py-2 text-sm text-danger">
          <span className="flex-1">{voiceError}</span>
          <button onClick={() => setVoiceError('')} aria-label="Dismiss error" className="rounded p-1"><X size={16} /></button>
        </div>
      )}
      <div className="pointer-events-none fixed bottom-24 left-4 z-40 flex w-64 max-w-[calc(100%-2rem)] flex-col gap-2">
        {chatPopups.map((message) => <ChatPopup key={message.id} message={message} />)}
      </div>
      {floatingReactions.map((reaction) => (
        <div key={reaction.id} className="animate-junction-reaction pointer-events-none fixed bottom-24 z-50 flex flex-col items-center" style={{ left: `${reaction.x}%` }}>
          <span className="text-3xl">{reaction.emoji}</span>
          <span className="mt-1 rounded-full border border-line bg-surface px-2 py-0.5 text-xs font-medium text-muted">{reaction.nickname}</span>
        </div>
      ))}

      <footer className="z-20 shrink-0 border-t border-line bg-surface">
        <div className="flex border-b border-line lg:hidden">
          <MobileTabButton active={mobileTab === 'stage'} onClick={() => setMobileTab('stage')} icon={<Volume2 size={15} />} label="Stage" count={participants.length} />
          <MobileTabButton active={mobileTab === 'chat'} onClick={() => setMobileTab('chat')} icon={<MessageSquare size={15} />} label="Chat" />
          <MobileTabButton active={mobileTab === 'people'} onClick={() => setMobileTab('people')} icon={<Users size={15} />} label="People" count={participants.length} />
        </div>
        <div className="flex flex-wrap items-center justify-center gap-1.5 px-2 py-2.5 sm:gap-2">
          {!inVoice ? (
            <button onClick={joinVoice} className="button button-primary"><Headphones size={16} /> Join voice</button>
          ) : (
            <>
              <ControlButton active={!micMuted} onClick={toggleMic} icon={micMuted ? <MicOff size={16} /> : <Mic size={16} />} label={micMuted ? 'Unmute' : 'Mute'} />
              <ControlButton active={speakerOn} onClick={() => setSpeakerOn((current) => !current)} icon={speakerOn ? <Headphones size={16} /> : <HeadphoneOff size={16} />} label={speakerOn ? 'Speaker' : 'Muted'} />
              <button onClick={handleLeave} aria-label="End call" className="button border border-danger-line bg-danger-soft px-2 text-danger hover:bg-danger-line sm:px-3">
                <PhoneOff size={16} /><span className="hidden sm:inline">End call</span>
              </button>
            </>
          )}
          <ReactionPicker open={showReactionPicker} onToggle={() => setShowReactionPicker((current) => !current)} onSelect={(emoji) => { sendReaction(emoji); setShowReactionPicker(true); }} />
        </div>
      </footer>

      {reportTarget && <ReportModal nickname={reportTarget.nickname} onCancel={() => setReportTarget(null)} onSubmit={async (reason) => { await reportUser(reportTarget.sessionId, reportTarget.nickname, reason); setReportTarget(null); }} />}
      {showExplore && <ExploreModal junctions={exploreJunctions} currentJunctionId={junction.id} onClose={() => setShowExplore(false)} onJoin={(slug) => { setShowExplore(false); onExplore(slug); }} />}
    </div>
  );
}

interface ParticipantStageProps {
  voiceParticipants: Participant[];
  listeners: Participant[];
  participants: Participant[];
  session: Session;
  speakingStates: Record<string, boolean>;
  speakingCount: number;
  loading: boolean;
}

function ParticipantStage({ voiceParticipants, listeners, participants, session, speakingStates, speakingCount, loading }: ParticipantStageProps) {
  const groups = [
    { label: 'In voice', members: voiceParticipants },
    { label: 'Listening', members: listeners },
  ];

  return (
    <section className="flex min-h-0 flex-1 flex-col">
      <div className="flex min-h-12 shrink-0 items-center justify-between gap-3 border-b border-line bg-surface px-4 sm:px-5">
        <h2 className="text-sm font-semibold">Voice stage</h2>
        <span className="text-xs text-muted">
          {speakingCount > 0 ? `${speakingCount} speaking` : `${participants.length} here · ${voiceParticipants.length} in voice`}
        </span>
      </div>
      <div className="flex-1 space-y-5 overflow-y-auto p-4 sm:p-5">
        {loading ? (
          <p role="status" className="py-8 text-center text-sm text-muted">Loading participants…</p>
        ) : participants.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted">You’re the first one here.</p>
        ) : (
          groups.filter(({ members }) => members.length > 0).map(({ label, members }) => (
            <section key={label}>
              <h3 className="mb-2 text-xs font-medium text-muted">{label} ({members.length})</h3>
              <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,8rem),1fr))] gap-2.5">
                {members.map((participant) => (
                  <ParticipantCard
                    key={participant.id}
                    participant={participant}
                    isMe={participant.session_id === session.sessionId}
                    speaking={speakingStates[participant.session_id] ?? participant.is_speaking}
                  />
                ))}
              </div>
            </section>
          ))
        )}
      </div>
    </section>
  );
}

function ParticipantCard({ participant, isMe, speaking }: { participant: Participant; isMe: boolean; speaking: boolean }) {
  const status = participant.in_voice ? (participant.mic_muted ? 'Muted' : speaking ? 'Speaking' : 'Live mic') : 'Listening';

  return (
    <div className={`flex min-w-0 flex-col items-center gap-1.5 rounded-lg border px-3 py-3.5 ${speaking ? 'border-accent-line bg-accent-soft' : 'border-line bg-surface'}`}>
      <Avatar emoji={participant.avatar_emoji} color={participant.avatar_color} size="md" speaking={speaking} ring={participant.in_voice} />
      <p className="w-full truncate text-center text-sm font-medium">
        {participant.nickname}{isMe && <span className="ml-1 text-xs text-muted">(you)</span>}
      </p>
      <span className={`text-xs ${speaking ? 'font-medium text-accent' : 'text-muted'}`}>{status}</span>
    </div>
  );
}

function ControlButton({ active, onClick, icon, label }: { active: boolean; onClick: () => void; icon: ReactNode; label: string }) {
  return (
    <button onClick={onClick} className={`button gap-1.5 px-2 sm:gap-2 sm:px-3 ${active ? 'border border-accent-line bg-accent-soft text-accent hover:bg-subtle' : 'button-secondary'}`}>
      {icon}{label}
    </button>
  );
}

function MobileTabButton({ active, onClick, icon, label, count }: { active: boolean; onClick: () => void; icon: ReactNode; label: string; count?: number }) {
  return (
    <button onClick={onClick} aria-label={label} aria-pressed={active} className={`flex min-h-10 flex-1 items-center justify-center gap-1.5 border-b-2 text-sm font-medium focus-visible:outline-offset-[-3px] ${active ? 'border-accent text-accent' : 'border-transparent text-muted'}`}>
      {icon}{label}{count ? <span className="text-xs">({count})</span> : null}
    </button>
  );
}

function ReactionPicker({ open, onToggle, onSelect }: { open: boolean; onToggle: () => void; onSelect: (emoji: string) => void }) {
  return (
    <div className="relative">
      {open && (
        <div role="group" aria-label="Room reactions" className="reaction-picker-grid absolute bottom-full right-0 z-30 mb-2 rounded-xl border border-line bg-surface shadow-md">
          {REACTION_EMOJIS.map((emoji) => (
            <button key={emoji} aria-label={`React with ${emoji}`} onClick={() => onSelect(emoji)} className="reaction-emoji-button hover:bg-accent-soft">{emoji}</button>
          ))}
        </div>
      )}
      <button onClick={onToggle} aria-expanded={open} className={`button gap-1.5 px-2 sm:gap-2 sm:px-3 ${open ? 'border border-accent-line bg-accent-soft text-accent' : 'button-secondary'}`}>
        <Smile size={16} /> React
      </button>
    </div>
  );
}

function ChatPopup({ message }: { message: Message }) {
  return (
    <div className="animate-chat-popup flex items-center gap-2 rounded-lg border border-line bg-surface px-3 py-2 shadow-md">
      <Avatar emoji={message.avatar_emoji} color={message.avatar_color} size="xs" />
      <div className="min-w-0">
        <p className="truncate text-xs font-semibold">{message.nickname}</p>
        <p className="truncate text-xs text-muted">{message.content}</p>
      </div>
    </div>
  );
}

function ExploreModal({ junctions, currentJunctionId, onClose, onJoin }: { junctions: ExploreJunction[]; currentJunctionId: string; onClose: () => void; onJoin: (slug: string) => void }) {
  return (
    <div className="fixed inset-0 z-[60] grid place-items-center bg-ink/35 p-4">
      <section role="dialog" aria-modal="true" aria-labelledby="explore-title" className="flex max-h-[calc(100dvh-2rem)] w-full max-w-3xl flex-col overflow-hidden rounded-lg border border-line bg-surface shadow-lg">
        <div className="flex items-center justify-between border-b border-line px-4 py-3 sm:px-5">
          <h2 id="explore-title" className="text-base font-semibold">Explore rooms</h2>
          <button onClick={onClose} className="button button-secondary !px-2" aria-label="Close explorer"><X size={16} /></button>
        </div>
        <div className="grid min-h-0 gap-3 overflow-y-auto bg-canvas p-4 sm:grid-cols-2 sm:p-5">
          {junctions.map((item) => (
            <div key={item.id} className={`grid min-w-0 rounded-lg ${item.id === currentJunctionId ? 'ring-1 ring-accent' : ''}`}>
              <JunctionCard junction={item} onJoin={onJoin} compact />
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

function ReportModal({ nickname, onCancel, onSubmit }: { nickname: string; onCancel: () => void; onSubmit: (reason: string) => void }) {
  const [reason, setReason] = useState('');
  const reasons = ['Spam', 'Harassment', 'Hate speech', 'Inappropriate content', 'Other'];

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-ink/35 p-4">
      <section role="dialog" aria-modal="true" aria-labelledby="report-title" className="dialog space-y-3">
        <div className="flex items-center justify-between gap-2">
          <h2 id="report-title" className="break-words text-base font-semibold">Report {nickname}</h2>
          <button onClick={onCancel} aria-label="Close report" className="button button-secondary !px-2"><X size={16} /></button>
        </div>
        <div className="space-y-1.5" role="group" aria-label="Reason for reporting">
          {reasons.map((item) => (
            <button key={item} onClick={() => setReason(item)} aria-pressed={reason === item} className={`button w-full justify-start border ${reason === item ? 'border-accent-line bg-accent-soft text-accent' : 'button-secondary'}`}>
              {item}
            </button>
          ))}
        </div>
        <button onClick={() => reason && onSubmit(reason)} disabled={!reason} className="button w-full bg-danger text-white hover:bg-danger-hover">Submit report</button>
      </section>
    </div>
  );
}
