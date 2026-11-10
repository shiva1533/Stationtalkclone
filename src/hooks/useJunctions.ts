import { useEffect, useState, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import type { Junction } from '@/types';
import { PRESENCE_TIMEOUT_MS } from '@/lib/constants';

export interface JunctionParticipantPreview {
  session_id: string;
  nickname: string;
  avatar_emoji: string;
  avatar_color: string;
  in_voice: boolean;
}

interface JunctionWithPresence extends Junction {
  online_count: number;
  voice_count: number;
  participants: JunctionParticipantPreview[];
}

export function useJunctions() {
  const [junctions, setJunctions] = useState<Junction[]>([]);
  const [presence, setPresence] = useState<
    Record<string, { online: number; voice: number; participants: JunctionParticipantPreview[] }>
  >({});
  const [loading, setLoading] = useState(true);

  const fetchJunctions = useCallback(async () => {
    const { data, error } = await supabase
      .from('junctions')
      .select('*')
      .order('is_permanent', { ascending: false })
      .order('created_at', { ascending: true });
    if (error) {
      console.error('Failed to load junctions:', error);
      return;
    }
    setJunctions((data as Junction[]) ?? []);
    setLoading(false);
  }, []);

  const fetchPresence = useCallback(async () => {
    const cutoff = new Date(Date.now() - PRESENCE_TIMEOUT_MS).toISOString();
    const { data } = await supabase
      .from('participants')
      .select('junction_id, session_id, nickname, avatar_emoji, avatar_color, in_voice')
      .gt('last_heartbeat', cutoff)
      .is('left_at', null);
    const map: Record<string, { online: number; voice: number; participants: JunctionParticipantPreview[] }> = {};
    for (const row of data ?? []) {
      const key = row.junction_id as string;
      if (!map[key]) map[key] = { online: 0, voice: 0, participants: [] };
      map[key].online += 1;
      if (row.in_voice) map[key].voice += 1;
      if (map[key].participants.length < 5) {
        map[key].participants.push({
          session_id: row.session_id as string,
          nickname: row.nickname as string,
          avatar_emoji: row.avatar_emoji as string,
          avatar_color: row.avatar_color as string,
          in_voice: row.in_voice as boolean,
        });
      }
    }
    setPresence(map);
  }, []);

  useEffect(() => {
    fetchJunctions();
    fetchPresence();

    const presenceChannel = supabase
      .channel('junctions-presence-overview')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'participants' }, () => {
        fetchPresence();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'junctions' }, () => {
        fetchJunctions();
      })
      .subscribe();

    const interval = setInterval(fetchPresence, 30_000);

    return () => {
      supabase.removeChannel(presenceChannel);
      clearInterval(interval);
    };
  }, [fetchJunctions, fetchPresence]);

  const junctionsWithPresence: JunctionWithPresence[] = junctions.map((j) => ({
    ...j,
    online_count: presence[j.id]?.online ?? 0,
    voice_count: presence[j.id]?.voice ?? 0,
    participants: presence[j.id]?.participants ?? [],
  }));

  const totalOnline = Object.values(presence).reduce((sum, p) => sum + p.online, 0);

  return { junctions: junctionsWithPresence, loading, totalOnline, refresh: fetchPresence };
}
