import { useEffect, useState, useCallback, useRef } from 'react';
import { supabase } from '@/lib/supabase';
import { supabaseConfig } from '@/lib/supabaseConfig';
import { registerCommunityRoom } from '@/lib/communityPresence';
import type { Participant, Message, Reaction, Session } from '@/types';
import { HEARTBEAT_INTERVAL_MS, PRESENCE_TIMEOUT_MS } from '@/lib/constants';

export function useJunctionRoom(junctionId: string | null, session: Session | null, isBlocked: (sender: { session_id: string; user_id?: string | null }) => boolean) {
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [reactions, setReactions] = useState<Reaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [joined, setJoined] = useState(false);
  const [joinedRoom, setJoinedRoom] = useState<string | null>(null);
  const [connectionState, setConnectionState] = useState('Connecting');
  const [error, setError] = useState('');
  const membershipQueue = useRef<Promise<unknown>>(Promise.resolve());
  const currentLease = useRef<string | null>(null);
  const identity = useRef(session);
  identity.current = session;
  const allow = useRef(isBlocked);
  allow.current = isBlocked;
  const refresh = useRef<() => Promise<void>>(async () => {});
  const token = useRef('');
  const leave = useRef<() => Promise<unknown>>(async () => {});
  const userId = session?.userId;
  const tabId = session?.sessionId;

  useEffect(() => {
    if (!junctionId || !userId || !tabId) {
      setJoined(false);
      setParticipants([]);
      setMessages([]);
      setReactions([]);
      return;
    }
    const lease = crypto.randomUUID();
    let disposed = false;
    let channel: ReturnType<typeof supabase.channel> | null = null;
    let heartbeat: ReturnType<typeof setInterval> | null = null;
    let releaseCommunity: (() => void) | null = null;
    let refreshing = 0;
    let presenceSynced = false;
    let present = new Set<string>();
    let rows: Participant[] = [];
    let renewing = false;
    currentLease.current = lease;
    setLoading(true);
    setJoined(false);
    setError('');
    setParticipants([]);
    setMessages([]);
    setReactions([]);

    const applyParticipants = () => {
      if (disposed) return;
      setParticipants(rows.filter((row) => !presenceSynced || present.has(row.connection_id)));
    };
    const refreshParticipants = async () => {
      const request = ++refreshing;
      const { data, error: failure } = await supabase.from('participants').select('*')
        .eq('junction_id', junctionId)
        .gt('last_heartbeat', new Date(Date.now() - PRESENCE_TIMEOUT_MS).toISOString())
        .is('left_at', null).order('joined_at', { ascending: true });
      if (disposed || request !== refreshing || failure) return;
      rows = data ?? [];
      applyParticipants();
    };
    refresh.current = refreshParticipants;

    const updateToken = async () => {
      const { data } = await supabase.auth.getSession();
      token.current = data.session?.access_token ?? '';
    };
    const payload = { room_id: junctionId, tab_id: tabId, lease_id: lease };
    const renew = async () => {
      if (disposed || renewing) return;
      renewing = true;
      try {
        await updateToken();
        const { data, error: failure } = await supabase.rpc('heartbeat_junction_session', payload);
        if (disposed) return;
        if (failure) { setConnectionState('Reconnecting'); return; }
        if (!data?.length) {
          const result = await supabase.rpc('join_junction_session', payload);
          if (result.error) { setConnectionState('Reconnecting'); return; }
        }
        if (!disposed) {
          setConnectionState('Connected');
          await channel?.track({ session_id: tabId, connection_id: lease, user_id: userId });
          await refreshParticipants();
        }
      } finally { renewing = false; }
    };
    const onVisible = () => { if (document.visibilityState === 'visible') void renew(); };
    const onPageHide = () => {
      if (!token.current || !supabaseConfig) return;
      void fetch(new URL('rest/v1/rpc/leave_junction_session', supabaseConfig.url), {
        method: 'POST', keepalive: true,
        headers: { apikey: supabaseConfig.key, Authorization: 'Bearer ' + token.current, 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      }).catch(() => {});
    };
    const onPageShow = (event: PageTransitionEvent) => { if (event.persisted) void renew(); };

    const join = async () => {
      if (disposed) return;
      const { error: failure } = await supabase.rpc('join_junction_session', payload);
      if (failure) throw new Error('Could not enter this room. Check your connection and try again.');
      if (disposed) return;
      await updateToken();
      setJoined(true);
      setJoinedRoom(junctionId);
      releaseCommunity = registerCommunityRoom({ session_id: tabId, user_id: userId, junction_id: junctionId, connection_id: lease });
      channel = supabase.channel(`room:${junctionId}`, { config: { private: true, presence: { key: tabId } } })
        .on('presence', { event: 'sync' }, () => {
          presenceSynced = true;
          present = new Set(Object.values(channel!.presenceState<{ connection_id: string }>()).flat().map((member) => member.connection_id));
          applyParticipants();
          void refreshParticipants();
        })
        .on('postgres_changes', { event: '*', schema: 'public', table: 'participants', filter: `junction_id=eq.${junctionId}` }, () => { void refreshParticipants(); })
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: `junction_id=eq.${junctionId}` }, ({ new: row }) => {
          const message = row as Message;
          if (!disposed && !allow.current(message)) {
            setMessages((current) => current.some(({ id }) => id === message.id) ? current : [...current, message]);
          }
        })
        .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'messages', filter: `junction_id=eq.${junctionId}` }, ({ old: row }) => {
          if (!disposed) setMessages((current) => current.filter(({ id }) => id !== row.id));
        })
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'reactions', filter: `junction_id=eq.${junctionId}` }, ({ new: row }) => {
          const reaction = row as Reaction;
          if (!disposed && !allow.current(reaction)) setReactions((current) => current.some(({ id }) => id === reaction.id) ? current : [...current, reaction]);
        })
        .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'reactions', filter: `junction_id=eq.${junctionId}` }, ({ old: row }) => {
          if (!disposed) setReactions((current) => current.filter(({ id }) => id !== row.id));
        })
        .subscribe((status) => {
          if (disposed) return;
          if (status === 'SUBSCRIBED') void renew();
          else { presenceSynced = false; setConnectionState('Reconnecting'); }
        });
      heartbeat = setInterval(() => { void renew(); }, HEARTBEAT_INTERVAL_MS);
      window.addEventListener('online', renew);
      window.addEventListener('pagehide', onPageHide);
      window.addEventListener('pageshow', onPageShow);
      document.addEventListener('visibilitychange', onVisible);
      await refreshParticipants();
      const { data: history, error: historyError } = await supabase.from('messages').select('*')
        .eq('junction_id', junctionId).order('created_at', { ascending: false }).limit(60);
      if (disposed) return;
      if (historyError) throw new Error('Could not load the conversation.');
      const visible = ((history ?? []) as Message[]).filter((message) => !allow.current(message));
      setMessages((current) => {
        const combined = new Map([...visible, ...current].map((message) => [message.id, message]));
        return [...combined.values()].sort((a, b) => a.created_at.localeCompare(b.created_at));
      });
      if (visible.length) {
        const { data } = await supabase.from('reactions').select('*').in('message_id', visible.map(({ id }) => id));
        if (!disposed) setReactions((current) => [...new Map([...(data ?? []) as Reaction[], ...current].filter((reaction) => !allow.current(reaction)).map((reaction) => [reaction.id, reaction])).values()]);
      }
      if (!disposed) setLoading(false);
    };
    const joining = membershipQueue.current.then(join).catch((reason: Error) => {
      if (!disposed) { setError(reason.message); setLoading(false); }
    });
    membershipQueue.current = joining;

    const close = () => {
      if (disposed) return membershipQueue.current;
      disposed = true;
      if (currentLease.current === lease) currentLease.current = null;
      if (heartbeat) clearInterval(heartbeat);
      window.removeEventListener('online', renew);
      window.removeEventListener('pagehide', onPageHide);
      window.removeEventListener('pageshow', onPageShow);
      document.removeEventListener('visibilitychange', onVisible);
      releaseCommunity?.();
      const leaving = joining.then(async () => {
        if (channel) await supabase.removeChannel(channel);
        await supabase.rpc('leave_junction_session', payload);
      });
      membershipQueue.current = leaving.catch(() => {});
      return membershipQueue.current;
    };
    leave.current = close;
    return () => { void close(); };
  }, [junctionId, userId, tabId]);

  useEffect(() => {
    const profile = identity.current;
    if (!junctionId || !userId || !tabId || !joined || !currentLease.current || !profile) return;
    void supabase.from('participants').update({
      nickname: profile.nickname, avatar_emoji: profile.avatarEmoji, avatar_color: profile.avatarColor,
    }).eq('junction_id', junctionId).eq('session_id', tabId).eq('connection_id', currentLease.current);
  }, [junctionId, userId, tabId, joined, session?.nickname, session?.avatarEmoji, session?.avatarColor]);

  const sendMessage = useCallback(async (content: string, replyTo: string | null) => {
    const sender = identity.current;
    if (!junctionId || !sender || !content.trim() || !currentLease.current) throw new Error('Room is not connected.');
    const { error: failure } = await supabase.from('messages').insert({
      junction_id: junctionId, session_id: sender.sessionId, user_id: sender.userId,
      nickname: sender.nickname, avatar_emoji: sender.avatarEmoji, avatar_color: sender.avatarColor,
      content: content.trim().slice(0, 500), reply_to: replyTo,
    });
    if (failure) throw new Error('Your message could not be sent. Please try again.');
  }, [junctionId]);

  const toggleReaction = useCallback(async (messageId: string, emoji: string) => {
    const sender = identity.current;
    if (!junctionId || !sender) return;
    const { data: existing } = await supabase.from('reactions').select('id')
      .eq('message_id', messageId).eq('session_id', sender.sessionId).eq('emoji', emoji).maybeSingle();
    const result = existing
      ? await supabase.from('reactions').delete().eq('id', existing.id)
      : await supabase.from('reactions').insert({ message_id: messageId, junction_id: junctionId, session_id: sender.sessionId, user_id: sender.userId, emoji });
    if (result.error) throw new Error('Could not update this reaction.');
  }, [junctionId]);

  const updateVoiceState = useCallback(async (patch: Partial<Pick<Participant, 'in_voice' | 'mic_muted' | 'is_speaking' | 'hand_raised'>>) => {
    if (!junctionId || !identity.current || !currentLease.current) return;
    const { error: failure } = await supabase.from('participants').update({ ...patch, last_heartbeat: new Date().toISOString() })
      .eq('junction_id', junctionId).eq('session_id', identity.current.sessionId).eq('connection_id', currentLease.current);
    if (failure) throw new Error('Could not update your room status.');
  }, [junctionId]);

  const reportUser = useCallback(async (reportedSessionId: string, reportedNickname: string, reason: string) => {
    if (!junctionId || !identity.current) return;
    const { error: failure } = await supabase.from('reports').insert({
      junction_id: junctionId, reporter_session_id: identity.current.sessionId,
      reporter_user_id: identity.current.userId, reported_session_id: reportedSessionId,
      reported_nickname: reportedNickname, reason,
    });
    if (failure) throw new Error('Could not submit the report.');
  }, [junctionId]);

  return {
    participants: joinedRoom === junctionId ? participants : [],
    messages: joinedRoom === junctionId ? messages.filter((message) => !isBlocked(message)) : [],
    reactions: joinedRoom === junctionId ? reactions.filter((reaction) => !isBlocked(reaction)) : [],
    loading: loading || joinedRoom !== junctionId, joined: joined && joinedRoom === junctionId,
    connectionState, error, sendMessage, toggleReaction, updateVoiceState, reportUser,
    leaveRoom: () => leave.current(),
    refreshParticipants: () => refresh.current(),
  };
}
