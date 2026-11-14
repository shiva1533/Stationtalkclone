import { createContext, createElement, useContext, useEffect, useState, useCallback, useMemo, useSyncExternalStore, type ReactNode } from 'react';
import { getCommunitySnapshot, subscribeCommunity } from '@/lib/communityPresence';
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

function useDirectoryData() {
  const [junctions, setJunctions] = useState<Junction[]>([]);
  const [presenceRows, setPresenceRows] = useState<(JunctionParticipantPreview & { junction_id: string; connection_id: string })[]>([]);
  const community = useSyncExternalStore(subscribeCommunity, getCommunitySnapshot);
  const presence = useMemo(() => {
    const map: Record<string, { online: number; voice: number; participants: JunctionParticipantPreview[] }> = {};
    for (const row of presenceRows) {
      if (community.ready && !community.members.some((member) => member.session_id === row.session_id && member.junction_id === row.junction_id && member.connection_id === row.connection_id)) continue;
      const entry = map[row.junction_id] ??= { online: 0, voice: 0, participants: [] };
      entry.online++;
      if (row.in_voice) entry.voice++;
      if (entry.participants.length < 5) entry.participants.push(row);
    }
    return map;
  }, [presenceRows, community]);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);

  const fetchJunctions = useCallback(async () => {
    const { data, error } = await supabase
      .from('junctions')
      .select('*')
      .order('is_permanent', { ascending: false })
      .order('created_at', { ascending: true });
    if (error) {
      console.error('Failed to load junctions:', error);
    } else {
      setJunctions((data as Junction[]) ?? []);
    }
    setLoadFailed(Boolean(error));
    setLoading(false);
  }, []);

  const fetchPresence = useCallback(async () => {
    const cutoff = new Date(Date.now() - PRESENCE_TIMEOUT_MS).toISOString();
    const { data } = await supabase
      .from('participants')
      .select('junction_id, session_id, connection_id, nickname, avatar_emoji, avatar_color, in_voice')
      .gt('last_heartbeat', cutoff)
      .is('left_at', null);
    setPresenceRows(data ?? []);
  }, []);

  useEffect(() => {
    fetchJunctions();
    fetchPresence();

    const presenceChannel = supabase
      .channel('junctions-presence-overview', { config: { private: true } })
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

  const retry = () => {
    setLoading(true);
    void fetchJunctions();
    void fetchPresence();
  };

  return { junctions: junctionsWithPresence, loading, loadFailed, totalOnline, refresh: fetchPresence, retry };
}

const DirectoryContext = createContext<ReturnType<typeof useDirectoryData> | null>(null);

export function JunctionsProvider({ children }: { children: ReactNode }) {
  const value = useDirectoryData();
  return createElement(DirectoryContext.Provider, { value }, children);
}

export function useJunctions() {
  const value = useContext(DirectoryContext);
  if (!value) throw new Error('useJunctions requires JunctionsProvider');
  return value;
}
