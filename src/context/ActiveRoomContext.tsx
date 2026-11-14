import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { useSession } from './SessionContext';
import { useJunctionRoom } from '@/hooks/useJunctionRoom';
import { useBlocks } from '@/hooks/useBlocks';
import { supabase } from '@/lib/supabase';
import { VoiceManager, type VoiceConnectionState } from '@/lib/voice';
import type { Junction, Message } from '@/types';

export interface FloatingReaction {
  id: string;
  emoji: string;
  x: number;
  sessionId: string;
  userId: string;
  nickname: string;
}

function useRoomController() {
  const { session } = useSession();
  const [junction, setJunction] = useState<Junction | null>(null);
  const [minimized, setMinimized] = useState(false);
  const [inVoice, setInVoice] = useState(false);
  const [micMuted, setMicMuted] = useState(true);
  const [speakerOn, setSpeakerOn] = useState(true);
  const [audioEnabled, setAudioEnabled] = useState(true);
  const [joiningVoice, setJoiningVoice] = useState(false);
  const [voiceError, setVoiceError] = useState('');
  const [connectionState, setConnectionState] = useState<VoiceConnectionState>('Disconnected');
  const [autoplayBlocked, setAutoplayBlocked] = useState(false);
  const [speakingStates, setSpeakingStates] = useState<Record<string, boolean>>({});
  const [mutedSessions, setMutedSessions] = useState<Set<string>>(new Set());
  const [notificationsMuted, setNotificationsMuted] = useState(false);
  const [chatPopups, setChatPopups] = useState<Message[]>([]);
  const [floatingReactions, setFloatingReactions] = useState<FloatingReaction[]>([]);
  const blocks = useBlocks(session?.userId);
  const room = useJunctionRoom(blocks.ready ? junction?.id ?? null : null, session, blocks.isBlocked);
  const manager = useRef<VoiceManager | null>(null);
  const reactionChannel = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const latest = useRef({ session, room, junction, blocks, inVoice, speakerOn, mutedSessions });
  latest.current = { session, room, junction, blocks, inVoice, speakerOn, mutedSessions };
  const navigation = useRef(0);
  const seenMessages = useRef<Set<string> | null>(null);
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>());
  const roomId = junction?.id;
  const tabId = session?.sessionId;
  const ownSpeaking = Boolean(tabId && speakingStates[tabId]);
  const updateVoiceState = room.updateVoiceState;
  const isBlocked = blocks.isBlocked;
  const junctionName = junction?.name;

  const startAudio = useCallback(async () => {
    if (!roomId || !tabId) throw new Error('Enter a room before enabling audio.');
    if (!manager.current) {
      const voice = new VoiceManager(roomId, tabId, {
        onStateChange: (state) => { if (manager.current === voice) setConnectionState(state); },
        onAutoplayBlocked: (blocked) => { if (manager.current === voice) setAutoplayBlocked(blocked); },
        onError: (message) => { if (manager.current === voice) setVoiceError(message); },
        onSpeakingChange: (id, speaking) => {
          if (manager.current !== voice) return;
          setSpeakingStates((current) => current[id] === speaking ? current : { ...current, [id]: speaking });
        },
      });
      manager.current = voice;
      voice.setSpeakerOn(latest.current.speakerOn);
      latest.current.mutedSessions.forEach((id) => voice.setPeerMuted(id, true));
    }
    const current = manager.current;
    await current.connect();
    return current;
  }, [roomId, tabId]);

  useEffect(() => {
    if (!room.joined || !audioEnabled) return;
    let disposed = false;
    void startAudio().catch((reason: Error) => {
      if (!disposed) { setVoiceError(reason.message); setConnectionState('Failed'); }
    });
    const onPageHide = () => {
      // A full document navigation can enter the browser's back-forward cache.
      // Its suspended websocket must not keep advertising a live audio member.
      const current = manager.current;
      manager.current = null;
      current?.leave();
      setInVoice(false);
      setMicMuted(true);
      setSpeakingStates({});
    };
    const onPageShow = (event: PageTransitionEvent) => {
      if (event.persisted) void startAudio().catch((reason: Error) => {
        if (!disposed) { setVoiceError(reason.message); setConnectionState('Failed'); }
      });
    };
    window.addEventListener('pagehide', onPageHide);
    window.addEventListener('pageshow', onPageShow);
    return () => {
      disposed = true;
      window.removeEventListener('pagehide', onPageHide);
      window.removeEventListener('pageshow', onPageShow);
      const current = manager.current;
      manager.current = null;
      current?.leave();
    };
  }, [room.joined, audioEnabled, startAudio]);

  useEffect(() => {
    manager.current?.setSpeakerOn(speakerOn);
  }, [speakerOn]);

  useEffect(() => {
    if (!inVoice || !tabId) return;
    void updateVoiceState({ is_speaking: ownSpeaking }).catch(() => {});
  }, [inVoice, tabId, ownSpeaking, updateVoiceState]);

  useEffect(() => {
    if (!roomId || !room.joined || !tabId) return;
    const channel = supabase.channel(`room-reactions:${roomId}`, { config: { private: true, broadcast: { self: true } } });
    channel.on('broadcast', { event: 'reaction' }, ({ payload }) => {
      const participant = latest.current.room.participants.find((person) => person.session_id === payload.sessionId);
      if (!participant || participant.user_id !== payload.userId || isBlocked(participant)) return;
      const reaction: FloatingReaction = {
        id: String(payload.id), emoji: String(payload.emoji).slice(0, 12),
        x: Math.min(80, Math.max(20, Number(payload.x) || 50)),
        sessionId: participant.session_id, userId: participant.user_id ?? '',
        nickname: participant.nickname,
      };
      setFloatingReactions((current) => [...current, reaction]);
      const timer = setTimeout(() => {
        setFloatingReactions((current) => current.filter(({ id }) => id !== reaction.id));
        timers.current.delete(timer);
      }, 4200);
      timers.current.add(timer);
    }).subscribe();
    reactionChannel.current = channel;
    return () => { reactionChannel.current = null; void supabase.removeChannel(channel); };
  }, [roomId, room.joined, tabId, isBlocked]);

  useEffect(() => {
    seenMessages.current = null;
    setChatPopups([]);
    setFloatingReactions([]);
  }, [roomId]);

  useEffect(() => {
    if (room.loading) return;
    if (!seenMessages.current) {
      seenMessages.current = new Set(room.messages.map(({ id }) => id));
      return;
    }
    for (const message of room.messages) {
      if (seenMessages.current.has(message.id)) continue;
      seenMessages.current.add(message.id);
      if (message.user_id === session?.userId || notificationsMuted || isBlocked(message)) continue;
      setChatPopups((current) => [...current, message]);
      const timer = setTimeout(() => {
        setChatPopups((current) => current.filter(({ id }) => id !== message.id));
        timers.current.delete(timer);
      }, 4200);
      timers.current.add(timer);
    }
  }, [room.loading, room.messages, session?.userId, notificationsMuted, isBlocked]);

  useEffect(() => () => {
    const current = manager.current;
    manager.current = null;
    current?.leave();
    timers.current.forEach(clearTimeout);
  }, []);

  const leaveRoom = useCallback(async () => {
    const current = manager.current;
    manager.current = null;
    current?.leave();
    setInVoice(false);
    setJoiningVoice(false);
    setSpeakingStates({});
    setAutoplayBlocked(false);
    await latest.current.room.leaveRoom();
    setJunction(null);
    setMinimized(false);
    setConnectionState('Disconnected');
  }, []);

  const openRoom = useCallback(async (slug: string) => {
    const request = ++navigation.current;
    if (latest.current.junction?.slug === slug) { setMinimized(false); return; }
    const { data, error } = await supabase.from('junctions').select('*').eq('slug', slug).maybeSingle();
    if (request !== navigation.current) return;
    if (error || !data) throw new Error('This room could not be opened. Please try again.');
    await leaveRoom();
    if (request !== navigation.current) return;
    setAudioEnabled(true);
    setMicMuted(true);
    setVoiceError('');
    setMutedSessions(new Set());
    setJunction(data as Junction);
  }, [leaveRoom]);

  const enableAudio = useCallback(async () => {
    setVoiceError('');
    setAudioEnabled(true);
    try {
      const voice = await startAudio();
      await voice.enableAudio();
    } catch (reason) {
      setVoiceError(reason instanceof Error ? reason.message : 'Could not enable audio.');
    }
  }, [startAudio]);

  const joinVoice = useCallback(async () => {
    if (joiningVoice) return;
    if (latest.current.room.participants.filter(({ in_voice }) => in_voice).length >= 10) {
      setVoiceError('This room has 10 speakers. You can continue listening while a spot opens.');
      return;
    }
    setJoiningVoice(true);
    setVoiceError('');
    setAudioEnabled(true);
    try {
      const voice = await startAudio();
      await voice.startPublishing();
      if (manager.current !== voice) return;
      voice.setMicMuted(true);
      setMicMuted(true);
      setInVoice(true);
      await latest.current.room.updateVoiceState({ in_voice: true, mic_muted: true, is_speaking: false });
    } catch (reason) {
      await manager.current?.stopPublishing();
      setInVoice(false);
      setVoiceError(reason instanceof Error ? reason.message : 'Could not access the microphone.');
    } finally { setJoiningVoice(false); }
  }, [joiningVoice, startAudio]);

  const moveToListening = useCallback(async () => {
    await manager.current?.stopPublishing();
    setInVoice(false);
    setMicMuted(true);
    setSpeakingStates((current) => ({ ...current, [latest.current.session?.sessionId ?? '']: false }));
    await latest.current.room.updateVoiceState({ in_voice: false, mic_muted: true, is_speaking: false });
  }, []);

  const leaveVoice = useCallback(async () => {
    const current = manager.current;
    manager.current = null;
    current?.leave();
    setAudioEnabled(false);
    setInVoice(false);
    setMicMuted(true);
    setAutoplayBlocked(false);
    setConnectionState('Disconnected');
    await latest.current.room.updateVoiceState({ in_voice: false, mic_muted: true, is_speaking: false });
  }, []);

  const toggleMic = useCallback(async () => {
    const next = !micMuted;
    manager.current?.setMicMuted(next);
    setMicMuted(next);
    await latest.current.room.updateVoiceState({ mic_muted: next, is_speaking: false });
  }, [micMuted]);

  const toggleMute = useCallback((id: string) => {
    setMutedSessions((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id); else next.add(id);
      manager.current?.setPeerMuted(id, next.has(id));
      return next;
    });
  }, []);

  const handleBlock = useCallback(async (id: string) => {
    const participant = latest.current.room.participants.find((person) => person.session_id === id);
    try { await latest.current.blocks.blockUser(id, participant?.user_id ?? null); }
    catch (reason) { setVoiceError((reason as Error).message); }
  }, []);

  const unblockUser = useCallback(async (id: string) => {
    const participant = latest.current.room.participants.find((person) => person.session_id === id);
    try { await latest.current.blocks.unblockUser(id, participant?.user_id ?? null); }
    catch (reason) { setVoiceError((reason as Error).message); }
  }, []);

  useEffect(() => {
    if (!junctionName || !('mediaSession' in navigator)) return;
    if (typeof MediaMetadata !== 'undefined') {
      navigator.mediaSession.metadata = new MediaMetadata({ title: junctionName, artist: 'Junction voice' });
    }
    navigator.mediaSession.playbackState = audioEnabled ? 'playing' : 'paused';
    const actions: [MediaSessionAction, () => void][] = [
      ['play', () => { void enableAudio(); }],
      ['pause', () => setSpeakerOn(false)],
      ['stop', () => { void leaveVoice(); }],
    ];
    const registered: MediaSessionAction[] = [];
    for (const [action, handler] of actions) {
      try {
        navigator.mediaSession.setActionHandler(action, handler);
        registered.push(action);
      } catch { /* Optional system controls vary between mobile browsers. */ }
    }
    return () => {
      navigator.mediaSession.metadata = null;
      for (const action of registered) navigator.mediaSession.setActionHandler(action, null);
    };
  }, [junctionName, audioEnabled, enableAudio, leaveVoice]);

  const blockedSessions = new Set([
    ...blocks.blocks.map(({ blocked_session_id }) => blocked_session_id),
    ...room.participants.filter(blocks.isBlocked).map(({ session_id }) => session_id),
  ]);

  return {
    ...room, error: room.error || blocks.error, junction, minimized, openRoom, leaveRoom,
    minimizeRoom: () => setMinimized(true),
    restoreRoom: () => setMinimized(false),
    backToExplore: () => { if (inVoice || joiningVoice) setMinimized(true); else void leaveRoom(); },
    inVoice, micMuted, speakerOn, setSpeakerOn, joiningVoice,
    audioEnabled, autoplayBlocked, connectionState, voiceError,
    setVoiceError, speakingStates, mutedSessions, blockedSessions,
    isBlocked: blocks.isBlocked, notificationsMuted, setNotificationsMuted,
    chatPopups: chatPopups.filter((message) => !blocks.isBlocked(message)),
    floatingReactions: floatingReactions.filter((reaction) => !blocks.isBlocked({ session_id: reaction.sessionId, user_id: reaction.userId })),
    joinVoice, leaveVoice, moveToListening, enableAudio, toggleMic, toggleMute, handleBlock, unblockUser,
    sendReaction: (emoji: string) => {
      if (!session) return;
      void reactionChannel.current?.send({
        type: 'broadcast', event: 'reaction',
        payload: { id: crypto.randomUUID(), emoji, x: Math.random() * 62 + 18, sessionId: session.sessionId, userId: session.userId },
      });
    },
  };
}

const ActiveRoomContext = createContext<ReturnType<typeof useRoomController> | null>(null);

export function ActiveRoomProvider({ children }: { children: ReactNode }) {
  const value = useRoomController();
  return <ActiveRoomContext.Provider value={value}>{children}</ActiveRoomContext.Provider>;
}

export function useActiveRoom() {
  const context = useContext(ActiveRoomContext);
  if (!context) throw new Error('useActiveRoom requires ActiveRoomProvider');
  return context;
}
