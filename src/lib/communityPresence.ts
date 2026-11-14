import { supabase } from './supabase';
import type { RealtimeChannel } from '@supabase/supabase-js';

export interface CommunityMember {
  session_id: string;
  user_id: string;
  junction_id: string;
  connection_id: string;
}

let channel: RealtimeChannel | null = null;
let local: CommunityMember | null = null;
let references = 0;
let snapshot: { ready: boolean; members: CommunityMember[] } = { ready: false, members: [] };
const listeners = new Set<() => void>();

function publish(ready: boolean) {
  const members = channel ? Object.values(channel.presenceState<CommunityMember>()).flat() : [];
  snapshot = { ready, members };
  listeners.forEach((listener) => listener());
}

function retain() {
  references++;
  if (!channel) {
    const current = supabase.channel('junction-community', { config: { private: true } });
    channel = current;
    current.on('presence', { event: 'sync' }, () => publish(true))
      .subscribe((status) => {
        if (channel !== current) return;
        if (status === 'SUBSCRIBED') {
          if (local) void current.track(local);
        } else publish(false);
      });
  }
  return () => {
    references--;
    if (references > 0 || !channel) return;
    const old = channel;
    channel = null;
    publish(false);
    void supabase.removeChannel(old);
  };
}

export function subscribeCommunity(listener: () => void) {
  listeners.add(listener);
  const release = retain();
  return () => { listeners.delete(listener); release(); };
}

export const getCommunitySnapshot = () => snapshot;

export function registerCommunityRoom(member: CommunityMember) {
  const release = retain();
  local = member;
  void channel?.track(member);
  return () => {
    if (local?.connection_id === member.connection_id) {
      local = null;
      void channel?.untrack();
    }
    release();
  };
}
