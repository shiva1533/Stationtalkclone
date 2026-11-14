import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';

interface Block {
  id: string;
  blocked_session_id: string;
  blocked_user_id: string | null;
}

interface Sender {
  session_id: string;
  user_id?: string | null;
}

export function useBlocks(userId: string | undefined) {
  const [blocks, setBlocks] = useState<Block[]>([]);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  const rows = useRef<Block[]>([]);
  const initialized = useRef(false);
  const revision = useRef(0);
  const request = useRef(0);
  const invalidate = useCallback(() => { ++request.current; }, []);

  const apply = useCallback((next: Block[]) => {
    rows.current = next;
    setBlocks(next);
  }, []);

  const refresh = useCallback(async () => {
    if (!userId) return;
    const generation = ++request.current;
    const version = revision.current;
    const { data, error } = await supabase.from('blocks')
      .select('id,blocked_session_id,blocked_user_id').eq('blocker_user_id', userId);
    if (version !== revision.current || generation !== request.current) return;
    if (error) {
      setError('Your privacy settings could not be loaded. Reconnecting…');
      return;
    }
    setError('');
    apply(data ?? []);
    initialized.current = true;
    setReady(true);
  }, [userId, apply]);

  useEffect(() => {
    initialized.current = false;
    setReady(false);
    apply([]);
    void refresh();
    if (!userId) return;
    const channel = supabase.channel(`blocks:${userId}`, { config: { private: true } })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'blocks' }, () => { void refresh(); })
      .subscribe((status) => { if (status === 'SUBSCRIBED') void refresh(); });
    const onStorage = (event: StorageEvent) => {
      if (event.key === `junction-blocks:${userId}`) void refresh();
    };
    window.addEventListener('storage', onStorage);
    const onVisible = () => { if (document.visibilityState === 'visible') void refresh(); };
    window.addEventListener('online', refresh);
    document.addEventListener('visibilitychange', onVisible);
    const timer = setInterval(() => { void refresh(); }, 15_000);
    return () => {
      invalidate();
      clearInterval(timer);
      window.removeEventListener('storage', onStorage);
      window.removeEventListener('online', refresh);
      document.removeEventListener('visibilitychange', onVisible);
      void supabase.removeChannel(channel);
    };
  }, [userId, refresh, apply, invalidate]);

  const isBlocked = useCallback((sender: Sender) => {
    if (!initialized.current) return true;
    return rows.current.some((block) => block.blocked_session_id === sender.session_id
      || Boolean(sender.user_id && block.blocked_user_id === sender.user_id));
  }, []);

  const blockUser = useCallback(async (sessionId: string, targetUserId: string | null) => {
    ++revision.current;
    const before = rows.current;
    apply([...before, { id: 'pending', blocked_session_id: sessionId, blocked_user_id: targetUserId }]);
    const { error } = await supabase.rpc('block_junction_user', { target_session: sessionId });
    ++revision.current;
    if (error) {
      apply(before);
      throw new Error('Could not block this person. Please try again.');
    }
    localStorage.setItem(`junction-blocks:${userId}`, String(Date.now()));
    await refresh();
  }, [userId, apply, refresh]);

  const unblockUser = useCallback(async (sessionId: string, targetUserId: string | null) => {
    if (!userId) return;
    const matching = rows.current.filter((block) => block.blocked_session_id === sessionId
      || Boolean(targetUserId && block.blocked_user_id === targetUserId));
    if (!matching.length) return;
    const { error } = await supabase.from('blocks').delete().eq('blocker_user_id', userId)
      .in('id', matching.map(({ id }) => id));
    if (error) throw new Error('Could not unblock this person.');
    ++revision.current;
    apply(rows.current.filter((block) => !matching.some(({ id }) => id === block.id)));
    localStorage.setItem(`junction-blocks:${userId}`, String(Date.now()));
  }, [userId, apply]);

  return { blocks, ready, error, isBlocked, blockUser, unblockUser };
}
