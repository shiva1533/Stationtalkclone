import { useEffect, useState, useCallback, useRef } from 'react';
import { supabase } from '@/lib/supabase';
import type { Participant, Message, Reaction, Session } from '@/types';
import { HEARTBEAT_INTERVAL_MS, PRESENCE_TIMEOUT_MS } from '@/lib/constants';

export function useJunctionRoom(junctionId: string | null, session: Session | null) {
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [reactions, setReactions] = useState<Reaction[]>([]);
  const [loading, setLoading] = useState(true);
  const participantRef = useRef<Participant | null>(null);
  const heartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const refreshParticipants = useCallback(async () => {
    if (!junctionId) return;
    const cutoff = new Date(Date.now() - PRESENCE_TIMEOUT_MS).toISOString();
    const { data } = await supabase
      .from('participants')
      .select('*')
      .eq('junction_id', junctionId)
      .gt('last_heartbeat', cutoff)
      .is('left_at', null)
      .order('joined_at', { ascending: true });
    setParticipants((data as Participant[]) ?? []);
  }, [junctionId]);

  const joinRoom = useCallback(async () => {
    if (!junctionId || !session) return;
    const { data: existing } = await supabase
      .from('participants')
      .select('*')
      .eq('junction_id', junctionId)
      .eq('session_id', session.sessionId)
      .maybeSingle();

    if (existing) {
      await supabase
        .from('participants')
        .update({
          last_heartbeat: new Date().toISOString(),
          left_at: null,
          nickname: session.nickname,
          avatar_emoji: session.avatarEmoji,
          avatar_color: session.avatarColor,
        })
        .eq('id', existing.id);
      participantRef.current = existing as Participant;
    } else {
      const { data } = await supabase
        .from('participants')
        .insert({
          junction_id: junctionId,
          session_id: session.sessionId,
          nickname: session.nickname,
          avatar_emoji: session.avatarEmoji,
          avatar_color: session.avatarColor,
          mic_muted: true,
        })
        .select()
        .single();
      participantRef.current = data as Participant;
    }
    refreshParticipants();
  }, [junctionId, session, refreshParticipants]);

  // Initial load + join
  useEffect(() => {
    if (!junctionId || !session) return;
    setLoading(true);

    (async () => {
      await joinRoom();

      const { data: msgData } = await supabase
        .from('messages')
        .select('*')
        .eq('junction_id', junctionId)
        .order('created_at', { ascending: false })
        .limit(60);
      setMessages(((msgData as Message[]) ?? []).reverse());

      const msgIds = ((msgData as Message[]) ?? []).map((m) => m.id);
      if (msgIds.length > 0) {
        const { data: rxnData } = await supabase
          .from('reactions')
          .select('*')
          .in('message_id', msgIds);
        setReactions((rxnData as Reaction[]) ?? []);
      }

      setLoading(false);
    })();

    // Heartbeat
    heartbeatRef.current = setInterval(async () => {
      if (!session || !junctionId) return;
      await supabase
        .from('participants')
        .update({ last_heartbeat: new Date().toISOString(), left_at: null })
        .eq('junction_id', junctionId)
        .eq('session_id', session.sessionId);
    }, HEARTBEAT_INTERVAL_MS);

    // Realtime subscriptions
    const channel = supabase
      .channel(`room:${junctionId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'participants', filter: `junction_id=eq.${junctionId}` },
        () => refreshParticipants(),
      )
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages', filter: `junction_id=eq.${junctionId}` },
        (payload) => {
          const msg = payload.new as Message;
          setMessages((prev) => (prev.some((m) => m.id === msg.id) ? prev : [...prev, msg]));
        },
      )
      .on(
        'postgres_changes',
        { event: 'DELETE', schema: 'public', table: 'messages', filter: `junction_id=eq.${junctionId}` },
        (payload) => {
          setMessages((prev) => prev.filter((m) => m.id !== (payload.old as Message).id));
        },
      )
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'reactions', filter: `junction_id=eq.${junctionId}` },
        (payload) => {
          const rxn = payload.new as Reaction;
          setReactions((prev) => {
            const exists = prev.some((r) => r.id === rxn.id);
            if (exists) return prev;
            return [...prev, rxn];
          });
        },
      )
      .on(
        'postgres_changes',
        { event: 'DELETE', schema: 'public', table: 'reactions', filter: `junction_id=eq.${junctionId}` },
        (payload) => {
          const rxnId = (payload.old as Reaction).id;
          setReactions((prev) => prev.filter((r) => r.id !== rxnId));
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
      if (heartbeatRef.current) clearInterval(heartbeatRef.current);
    };
  }, [junctionId, session, joinRoom, refreshParticipants]);

  const leaveRoom = useCallback(async () => {
    if (!junctionId || !session) return;
    await supabase
      .from('participants')
      .update({ left_at: new Date().toISOString(), in_voice: false, is_speaking: false })
      .eq('junction_id', junctionId)
      .eq('session_id', session.sessionId);
    if (heartbeatRef.current) clearInterval(heartbeatRef.current);
    refreshParticipants();
  }, [junctionId, session, refreshParticipants]);

  const sendMessage = useCallback(
    async (content: string, replyTo: string | null): Promise<void> => {
      if (!junctionId || !session || !content.trim()) return;
      const { error } = await supabase.from('messages').insert({
        junction_id: junctionId,
        session_id: session.sessionId,
        nickname: session.nickname,
        avatar_emoji: session.avatarEmoji,
        avatar_color: session.avatarColor,
        content: content.trim().slice(0, 500),
        reply_to: replyTo,
      });
      if (error) throw error;
    },
    [junctionId, session],
  );

  const toggleReaction = useCallback(
    async (messageId: string, emoji: string): Promise<void> => {
      if (!junctionId || !session) return;
      const { data: existing } = await supabase
        .from('reactions')
        .select('id')
        .eq('message_id', messageId)
        .eq('session_id', session.sessionId)
        .eq('emoji', emoji)
        .maybeSingle();
      if (existing) {
        await supabase.from('reactions').delete().eq('id', existing.id);
      } else {
        await supabase.from('reactions').insert({
          message_id: messageId,
          junction_id: junctionId,
          session_id: session.sessionId,
          emoji,
        });
      }
    },
    [junctionId, session],
  );

  const updateVoiceState = useCallback(
    async (patch: Partial<Pick<Participant, 'in_voice' | 'mic_muted' | 'is_speaking' | 'hand_raised'>>): Promise<void> => {
      if (!junctionId || !session) return;
      await supabase
        .from('participants')
        .update({ ...patch, last_heartbeat: new Date().toISOString() })
        .eq('junction_id', junctionId)
        .eq('session_id', session.sessionId);
    },
    [junctionId, session],
  );

  const reportUser = useCallback(
    async (reportedSessionId: string, reportedNickname: string, reason: string): Promise<void> => {
      if (!junctionId || !session) return;
      await supabase.from('reports').insert({
        junction_id: junctionId,
        reporter_session_id: session.sessionId,
        reported_session_id: reportedSessionId,
        reported_nickname: reportedNickname,
        reason,
      });
    },
    [junctionId, session],
  );

  return {
    participants,
    messages,
    reactions,
    loading,
    sendMessage,
    toggleReaction,
    updateVoiceState,
    leaveRoom,
    reportUser,
    refreshParticipants,
  };
}
