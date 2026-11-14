import { createContext, useContext, useState, useEffect, useCallback, useRef, type ReactNode } from 'react';
import type { Session } from '@/types';
import { initializeIdentity, persistProfile } from '@/lib/identity';
import { loadSession } from '@/lib/session';
import { supabase } from '@/lib/supabase';

interface SessionContextValue {
  session: Session | null;
  setSession: (session: Session) => Promise<void>;
  ready: boolean;
  error: string;
}

const SessionContext = createContext<SessionContextValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [session, setSessionState] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  const owner = useRef<string | null>(null);

  useEffect(() => {
    let disposed = false;
    initializeIdentity().then((identity) => {
      if (!disposed) { owner.current = identity.userId; setSessionState(identity); setReady(true); }
    }).catch((reason: Error) => { if (!disposed) setError(reason.message); });
    const onStorage = (event: StorageEvent) => {
      if (event.key !== 'junction_session') return;
      const saved = loadSession();
      if (saved) setSessionState((current) => current && saved.userId === current.userId
        ? { ...saved, sessionId: current.sessionId } : current);
    };
    window.addEventListener('storage', onStorage);
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, authSession) => {
      if (event === 'SIGNED_OUT' || (authSession && owner.current && authSession.user.id !== owner.current)) {
        // Account changes must not leave the previous account's call running.
        window.location.reload();
      }
    });
    return () => {
      disposed = true;
      window.removeEventListener('storage', onStorage);
      subscription.unsubscribe();
    };
    // Identity initialization is single-flight, including React StrictMode.
  }, []);

  const setSession = useCallback(async (next: Session) => {
    await persistProfile(next);
    setSessionState({ ...next, nickname: next.nickname.trim(), nameConfirmed: true });
  }, []);

  return <SessionContext.Provider value={{ session, setSession, ready, error }}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionContextValue {
  const context = useContext(SessionContext);
  if (!context) throw new Error('useSession must be used within SessionProvider');
  return context;
}
