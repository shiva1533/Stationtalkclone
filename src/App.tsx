import { useState } from 'react';
import { SessionProvider, useSession } from '@/context/SessionContext';
import { LandingPage } from '@/components/LandingPage';
import { RoomView } from '@/components/RoomView';
import { NicknameModal } from '@/components/NicknameModal';
import { supabase } from '@/lib/supabase';
import { saveSession } from '@/lib/session';
import type { Junction, Session } from '@/types';

function JunctionApp() {
  const { session, setSession, ready } = useSession();
  const [activeJunction, setActiveJunction] = useState<Junction | null>(null);
  const [loadingJunction, setLoadingJunction] = useState(false);
  const [showNickname, setShowNickname] = useState(false);
  const [pendingSlug, setPendingSlug] = useState<string | null>(null);

  const handleJoin = async (slug: string) => {
    if (!session) return;
    setPendingSlug(slug);
    setShowNickname(true);
  };

  const handleConfirmNickname = (updated: Session) => {
    setSession(updated);
    saveSession(updated);
    setShowNickname(false);
    if (pendingSlug) {
      enterJunction(pendingSlug);
    }
  };

  const enterJunction = async (slug: string) => {
    setLoadingJunction(true);
    const { data } = await supabase.from('junctions').select('*').eq('slug', slug).maybeSingle();
    setLoadingJunction(false);
    if (data) {
      setActiveJunction(data as Junction);
    }
  };

  const handleLeave = () => {
    setActiveJunction(null);
    setPendingSlug(null);
  };

  if (!ready || !session) {
    return (
      <div className="min-h-screen bg-canvas flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-line border-t-accent rounded-full animate-spin" />
      </div>
    );
  }

  if (loadingJunction) {
    return (
      <div className="min-h-screen bg-canvas flex items-center justify-center">
        <div className="space-y-3 text-center">
          <div className="w-8 h-8 border-2 border-line border-t-accent rounded-full animate-spin mx-auto" />
          <p className="text-muted text-sm">Entering Junction…</p>
        </div>
      </div>
    );
  }

  if (activeJunction) {
    return <RoomView junction={activeJunction} session={session} onLeave={handleLeave} onExplore={enterJunction} />;
  }

  return (
    <>
      <LandingPage onJoin={handleJoin} />
      <NicknameModal
        open={showNickname}
        session={session}
        onConfirm={handleConfirmNickname}
        onCancel={() => {
          setShowNickname(false);
          setPendingSlug(null);
        }}
      />
    </>
  );
}

export default function App() {
  return (
    <SessionProvider>
      <JunctionApp />
    </SessionProvider>
  );
}
