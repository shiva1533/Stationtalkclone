import { createContext, useContext, useState, useEffect, type ReactNode } from 'react';
import type { Session } from '@/types';
import { loadSession, createSession } from '@/lib/session';

interface SessionContextValue {
  session: Session | null;
  setSession: (s: Session) => void;
  ready: boolean;
}

const SessionContext = createContext<SessionContextValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [session, setSessionState] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const existing = loadSession();
    if (existing) {
      setSessionState(existing);
    } else {
      setSessionState(createSession());
    }
    setReady(true);
  }, []);

  const setSession = (s: Session) => {
    setSessionState(s);
  };

  return (
    <SessionContext.Provider value={{ session, setSession, ready }}>
      {children}
    </SessionContext.Provider>
  );
}

export function useSession(): SessionContextValue {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error('useSession must be used within SessionProvider');
  return ctx;
}
