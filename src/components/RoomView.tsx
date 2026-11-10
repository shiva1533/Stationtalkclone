import { useCallback, useEffect, useRef, useState } from 'react';
import { Compass, Headphones, HeadphoneOff, Mic, MicOff, MessageSquare, PhoneOff, Sparkles, Users, Volume2, X } from 'lucide-react';
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

  const leaveVoice = async () => {
    voiceManagerRef.current?.leave();
    voiceManagerRef.current = null;
    audioElementsRef.current.forEach((audio) => { audio.srcObject = null; });
    audioElementsRef.current.clear();
    setInVoice(false);
    setSpeakingStates({});
    speakingSyncRef.current = null;
    await updateVoiceState({ in_voice: false, is_speaking: false });
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
    <div className="relative flex h-screen flex-col overflow-hidden bg-[#090a11] text-white">
      <header className="z-20 shrink-0 border-b border-white/5 bg-[#090a11]/90 backdrop-blur-xl">
        <div className="flex items-center justify-between gap-3 px-4 py-3">
          <div className="min-w-0"><div className="flex items-center gap-2"><span className="text-lg">{cat.emoji}</span><h1 className="truncate text-lg font-semibold">{junction.name}</h1></div><div className="flex items-center gap-3 text-xs text-white/40"><span><Users size={11} className="mr-1 inline" />{participants.length}</span><span><Volume2 size={11} className="mr-1 inline" />{voiceParticipants.length} in voice</span>{speakingCount > 0 && <span className="text-emerald-400">{speakingCount} speaking</span>}</div></div>
          <button onClick={() => setShowExplore(true)} className="flex shrink-0 items-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-sm font-medium text-white/70 hover:border-white/25 hover:text-white"><Compass size={16} /><span className="hidden sm:inline">Explore rooms</span><span className="sm:hidden">Explore</span></button>
        </div>
        {junction.description && <div className="truncate px-4 pb-2 text-xs text-white/40">{junction.description}</div>}
      </header>

      <main className="relative flex min-h-0 flex-1 overflow-hidden">
        <div className={`min-w-0 flex-1 ${mobileTab === 'stage' ? 'flex' : 'hidden'} flex-col lg:flex`}><ParticipantStage voiceParticipants={voiceParticipants} listeners={listeners} participants={participants} session={session} speakingStates={speakingStates} loading={loading} catEmoji={cat.emoji} junctionName={junction.name} /></div>
        <div className={`${mobileTab === 'chat' ? 'flex' : 'hidden'} min-w-0 flex-1 flex-col border-white/5 lg:flex lg:max-w-md lg:border-l`}><ChatPanel junctionId={junction.id} messages={messages} reactions={reactions} blockedSessions={blockedSessions} slowModeSeconds={junction.slow_mode_seconds} onSend={sendMessage} onToggleReaction={toggleReaction} onReport={handleReport} onBlock={handleBlock} notificationsMuted={notificationsMuted} onToggleMute={() => setNotificationsMuted((current) => !current)} /></div>
        <div className={`${mobileTab === 'people' ? 'flex' : 'hidden'} min-w-0 flex-1 flex-col lg:hidden`}><ParticipantsPanel participants={participants} mutedSessions={mutedSessions} blockedSessions={blockedSessions} onMute={toggleMute} onUnblock={unblockUser} onReport={handleReport} onBlock={handleBlock} /></div>
        <div className="hidden w-64 shrink-0 border-l border-white/5 lg:flex"><ParticipantsPanel participants={participants} mutedSessions={mutedSessions} blockedSessions={blockedSessions} onMute={toggleMute} onUnblock={unblockUser} onReport={handleReport} onBlock={handleBlock} /></div>
      </main>

      {voiceError && <div className="absolute left-1/2 top-16 z-50 flex max-w-md -translate-x-1/2 items-center gap-2 rounded-xl border border-red-400/30 bg-red-500/20 px-4 py-3 text-sm text-red-200"><span className="flex-1">{voiceError}</span><button onClick={() => setVoiceError('')}><X size={16} /></button></div>}
      <div className="pointer-events-none fixed bottom-24 left-4 z-40 flex w-64 flex-col gap-2">{chatPopups.map((message) => <ChatPopup key={message.id} message={message} />)}</div>
      {floatingReactions.map((reaction) => <div key={reaction.id} className="animate-junction-reaction pointer-events-none fixed bottom-24 z-50 flex flex-col items-center" style={{ left: `${reaction.x}%` }}><span className="text-4xl">{reaction.emoji}</span><span className="mt-1 rounded-full bg-black/50 px-2 py-0.5 text-[10px] font-medium text-white/75">{reaction.nickname}</span></div>)}

      <footer className="z-20 shrink-0 border-t border-white/5 bg-[#10111b]/92 backdrop-blur-xl">
        <div className="flex border-b border-white/5 lg:hidden"><MobileTabButton active={mobileTab === 'stage'} onClick={() => setMobileTab('stage')} icon={<Users size={16} />} label="Stage" count={participants.length} /><MobileTabButton active={mobileTab === 'chat'} onClick={() => setMobileTab('chat')} icon={<MessageSquare size={16} />} label="Chat" /><MobileTabButton active={mobileTab === 'people'} onClick={() => setMobileTab('people')} icon={<Users size={16} />} label="People" count={participants.length} /></div>
        <div className="flex items-center justify-center gap-2 px-3 py-3 sm:gap-3">
          {!inVoice ? <button onClick={joinVoice} className="flex items-center gap-2 rounded-xl bg-emerald-500 px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-emerald-500/20 hover:bg-emerald-400"><Headphones size={18} /> Join voice</button> : <><ControlButton active={!micMuted} onClick={toggleMic} icon={micMuted ? <MicOff size={20} /> : <Mic size={20} />} label={micMuted ? 'Unmute' : 'Mute'} activeColor="bg-emerald-500" /><ControlButton active={speakerOn} onClick={() => setSpeakerOn((current) => !current)} icon={speakerOn ? <Headphones size={20} /> : <HeadphoneOff size={20} />} label={speakerOn ? 'Speaker' : 'Muted'} activeColor="bg-sky-500" /><button onClick={handleLeave} className="flex items-center gap-2 rounded-xl border border-red-400/30 bg-red-500/15 px-3 py-2.5 text-sm font-medium text-red-300 hover:bg-red-500/25"><PhoneOff size={18} /><span className="hidden sm:inline">End call</span></button></>}
          <ControlButton active={mobileTab === 'chat'} onClick={() => setMobileTab('chat')} icon={<MessageSquare size={20} />} label="Chat" activeColor="bg-[#6655e8]" />
          <ReactionPicker open={showReactionPicker} onToggle={() => setShowReactionPicker((current) => !current)} onSelect={(emoji) => { sendReaction(emoji); setShowReactionPicker(true); }} />
        </div>
      </footer>

      {reportTarget && <ReportModal nickname={reportTarget.nickname} onCancel={() => setReportTarget(null)} onSubmit={async (reason) => { await reportUser(reportTarget.sessionId, reportTarget.nickname, reason); setReportTarget(null); }} />}
      {showExplore && <ExploreModal junctions={exploreJunctions} currentJunctionId={junction.id} onClose={() => setShowExplore(false)} onJoin={(slug) => { setShowExplore(false); onExplore(slug); }} />}
    </div>
  );
}

function ParticipantStage({ voiceParticipants, listeners, participants, session, speakingStates, loading, catEmoji, junctionName }: { voiceParticipants: Participant[]; listeners: Participant[]; participants: Participant[]; session: Session; speakingStates: Record<string, boolean>; loading: boolean; catEmoji: string; junctionName: string }) {
  const renderCard = (participant: Participant, variant: 'voice' | 'listener') => <ParticipantCard key={participant.id} participant={participant} isMe={participant.session_id === session.sessionId} speaking={speakingStates[participant.session_id] ?? participant.is_speaking} variant={variant} />;
  return <div className="flex min-h-0 flex-1 flex-col overflow-y-auto bg-gradient-to-b from-[#10111b] to-[#090a11]"><div className="flex shrink-0 items-center justify-between border-b border-white/5 px-4 py-3 sm:px-6"><div><div className="flex items-center gap-2"><span className="text-xl">{catEmoji}</span><h2 className="text-sm font-semibold">{junctionName}</h2></div><p className="text-[11px] text-white/40">{participants.length} {participants.length === 1 ? 'person' : 'people'} here{voiceParticipants.length > 0 && ` · ${voiceParticipants.length} in voice`}</p></div>{voiceParticipants.length > 0 && <span className="rounded-full border border-emerald-400/20 bg-emerald-500/10 px-2.5 py-1 text-xs text-emerald-300"><span className="mr-1.5 inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" />Live voice</span>}</div><div className="flex-1 space-y-6 p-4 sm:p-6">{loading ? <div className="flex justify-center py-20"><div className="h-8 w-8 animate-spin rounded-full border-2 border-white/15 border-t-[#a89fff]" /></div> : participants.length === 0 ? <div className="py-20 text-center text-sm text-white/35">{catEmoji} You are the first one here.</div> : <>{voiceParticipants.length > 0 && <section><h3 className="mb-3 flex items-center gap-2 text-xs uppercase tracking-wide text-white/40"><Volume2 size={13} className="text-emerald-400" /> In voice ({voiceParticipants.length})</h3><div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">{voiceParticipants.map((participant) => renderCard(participant, 'voice'))}</div></section>}{listeners.length > 0 && <section><h3 className="mb-3 flex items-center gap-2 text-xs uppercase tracking-wide text-white/40"><Headphones size={13} /> Listening ({listeners.length})</h3><div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">{listeners.map((participant) => renderCard(participant, 'listener'))}</div></section>}</>}</div></div>;
}

function ParticipantCard({ participant, isMe, speaking, variant }: { participant: Participant; isMe: boolean; speaking: boolean; variant: 'voice' | 'listener' }) {
  return <div className={`relative flex flex-col items-center gap-2 rounded-2xl border p-4 transition-all ${speaking ? 'border-emerald-400/40 bg-emerald-500/10 shadow-lg shadow-emerald-500/10' : variant === 'voice' ? 'border-white/10 bg-white/5' : 'border-white/5 bg-[#10111b]/70'}`}>{speaking && <span className="absolute inset-0 animate-pulse rounded-2xl opacity-30" style={{ boxShadow: `0 0 20px 4px ${participant.avatar_color}66` }} />}<Avatar emoji={participant.avatar_emoji} color={participant.avatar_color} size="xl" speaking={speaking} ring={variant === 'voice'} /><p className="max-w-[140px] truncate text-sm font-medium text-white/90">{participant.nickname}{isMe && <span className="ml-1 text-white/40">(you)</span>}</p><span className={`text-[10px] ${speaking ? 'text-emerald-400' : 'text-white/40'}`}>{variant === 'voice' ? (participant.mic_muted ? 'Muted' : speaking ? 'Speaking' : 'Live mic') : 'Listening'}</span>{speaking && <div className="absolute right-2 top-2 flex items-end gap-0.5"><i className="h-2 w-0.5 animate-[bar1_0.6s_ease-in-out_infinite] bg-emerald-400" /><i className="h-3 w-0.5 animate-[bar2_0.5s_ease-in-out_infinite] bg-emerald-400" /><i className="h-2.5 w-0.5 animate-[bar3_0.7s_ease-in-out_infinite] bg-emerald-400" /></div>}</div>;
}

function ControlButton({ active, onClick, icon, label, activeColor }: { active: boolean; onClick: () => void; icon: ReactNode; label: string; activeColor: string }) {
  return <button onClick={onClick} className={`flex min-w-[58px] flex-col items-center gap-0.5 rounded-xl border px-2.5 py-2 transition-all ${active ? `${activeColor} border-transparent text-white shadow-lg` : 'border-white/10 bg-white/5 text-white/60 hover:border-white/30 hover:text-white'}`}>{icon}<span className="text-[10px] font-medium">{label}</span></button>;
}

function MobileTabButton({ active, onClick, icon, label, count }: { active: boolean; onClick: () => void; icon: ReactNode; label: string; count?: number }) {
  return <button onClick={onClick} className={`flex flex-1 items-center justify-center gap-1.5 py-2.5 text-sm font-medium ${active ? 'border-b-2 border-[#a89fff] bg-white/5 text-white' : 'text-white/40'}`}>{icon}{label}{count ? <span className="rounded-full bg-white/10 px-1.5 py-0.5 text-[10px]">{count}</span> : null}</button>;
}

function ReactionPicker({ open, onToggle, onSelect }: { open: boolean; onToggle: () => void; onSelect: (emoji: string) => void }) {
  return <div className="relative">{open && <div className="absolute bottom-14 right-0 z-30 grid w-[min(13rem,calc(100vw-2rem))] grid-cols-5 gap-2 rounded-2xl border border-white/10 bg-[#171925] p-3 shadow-2xl">{REACTION_EMOJIS.map((emoji) => <button key={emoji} onClick={() => onSelect(emoji)} className="flex h-9 w-9 items-center justify-center rounded-lg text-xl transition-transform hover:scale-110 hover:bg-white/10">{emoji}</button>)}</div>}<button onClick={onToggle} className={`flex min-w-[58px] flex-col items-center gap-0.5 rounded-xl border px-2.5 py-2 ${open ? 'border-[#a89fff] bg-[#6655e8] text-white' : 'border-white/10 bg-white/5 text-white/70 hover:border-white/30'}`}><Sparkles size={20} /><span className="text-[10px] font-medium">React</span></button></div>;
}

function ChatPopup({ message }: { message: Message }) {
  return <div className="animate-chat-popup flex items-center gap-2 rounded-2xl border border-white/10 bg-[#171925]/95 px-3 py-2 shadow-xl backdrop-blur-md"><Avatar emoji={message.avatar_emoji} color={message.avatar_color} size="xs" /><div className="min-w-0"><p className="truncate text-[10px] font-semibold" style={{ color: message.avatar_color }}>{message.nickname}</p><p className="truncate text-xs text-white/80">{message.content}</p></div></div>;
}

function ExploreModal({ junctions, currentJunctionId, onClose, onJoin }: { junctions: ExploreJunction[]; currentJunctionId: string; onClose: () => void; onJoin: (slug: string) => void }) {
  return <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"><div className="flex max-h-[88vh] w-full max-w-4xl flex-col overflow-hidden rounded-3xl border border-white/10 bg-[#0d0f18] shadow-2xl"><div className="flex items-center justify-between border-b border-white/10 px-5 py-4 sm:px-6"><div><p className="text-xs uppercase tracking-[0.16em] text-[#a89fff]">Explore</p><h2 className="mt-1 text-xl font-semibold">Choose another junction</h2></div><button onClick={onClose} className="rounded-xl border border-white/10 bg-white/[0.04] p-2 text-white/60 hover:text-white" aria-label="Close explorer"><X size={18} /></button></div><div className="flex-1 overflow-y-auto px-4 py-5 sm:px-6 sm:py-6"><div className="grid min-w-0 grid-cols-1 gap-4 lg:grid-cols-2">{junctions.map((item) => <div key={item.id} className={`min-w-0 ${item.id === currentJunctionId ? 'rounded-[26px] ring-2 ring-[#a89fff] ring-offset-2 ring-offset-[#0d0f18]' : ''}`}><JunctionCard junction={item} onJoin={onJoin} compact /></div>)}</div></div></div></div>;
}

function ReportModal({ nickname, onCancel, onSubmit }: { nickname: string; onCancel: () => void; onSubmit: (reason: string) => void }) {
  const [reason, setReason] = useState('');
  const reasons = ['Spam', 'Harassment', 'Hate speech', 'Inappropriate content', 'Other'];
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"><div className="w-full max-w-sm space-y-4 rounded-3xl border border-white/10 bg-[#10111b] p-6 shadow-2xl"><div className="flex items-center justify-between"><h2 className="text-lg font-bold">Report {nickname}</h2><button onClick={onCancel}><X size={18} /></button></div><p className="text-sm text-white/50">Help keep Junction safe.</p><div className="space-y-2">{reasons.map((item) => <button key={item} onClick={() => setReason(item)} className={`w-full rounded-xl border px-4 py-2.5 text-left text-sm ${reason === item ? 'border-[#a89fff]/40 bg-[#6655e8]/20' : 'border-white/10 bg-white/5 text-white/70'}`}>{item}</button>)}</div><button onClick={() => reason && onSubmit(reason)} disabled={!reason} className="w-full rounded-xl bg-red-500 py-2.5 font-medium disabled:opacity-40">Submit report</button></div></div>;
}
