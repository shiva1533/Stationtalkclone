import { useState } from 'react';
import { SessionProvider, useSession } from '@/context/SessionContext';
import { ActiveRoomProvider, useActiveRoom } from '@/context/ActiveRoomContext';
import { JunctionsProvider } from '@/hooks/useJunctions';
import { LandingPage } from '@/components/LandingPage';
import { RoomView } from '@/components/RoomView';
import { NicknameModal } from '@/components/NicknameModal';
import { ActiveCall } from '@/components/ActiveCall';
import type { Session } from '@/types';

function JunctionApp() {
  const { session, setSession } = useSession();
  const room = useActiveRoom();
  const [pendingSlug, setPendingSlug] = useState<string | null>(null);
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState('');

  const enter = async (slug: string) => {
    setOpening(true);
    setError('');
    try { await room.openRoom(slug); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not open the room.'); }
    finally { setOpening(false); }
  };

  const handleJoin = (slug: string) => {
    if (!session) return;
    if (!session.nameConfirmed) { setPendingSlug(slug); return; }
    void enter(slug);
  };

  const confirmName = async (updated: Session) => {
    await setSession(updated);
    const slug = pendingSlug;
    setPendingSlug(null);
    if (slug) await enter(slug);
  };

  return (
    <div className={room.minimized ? 'has-active-call' : undefined}>
      {room.junction && !room.minimized ? <RoomView /> : <LandingPage onJoin={handleJoin} />}
      {opening && <p className="app-status" role="status">Opening room…</p>}
      {error && <div className="app-status" role="alert">{error}<button onClick={() => setError('')} aria-label="Dismiss">×</button></div>}
      <ActiveCall />
      {session && <NicknameModal open={Boolean(pendingSlug)} session={session} onConfirm={confirmName} onCancel={() => setPendingSlug(null)} />}
    </div>
  );
}

function SessionGate() {
  const { ready, error } = useSession();
  if (error) {
    return (
      <main className="mx-auto max-w-lg space-y-3 p-6">
        <h1 className="text-xl font-semibold">Junction</h1>
        <p role="alert" className="text-sm text-muted">{error}</p>
        <button className="button button-primary" onClick={() => window.location.reload()}>Try again</button>
      </main>
    );
  }
  if (!ready) return <p role="status" className="p-6 text-muted">Connecting to Junction…</p>;
  return <JunctionsProvider><ActiveRoomProvider><JunctionApp /></ActiveRoomProvider></JunctionsProvider>;
}

export default function App() {
  return <SessionProvider><SessionGate /></SessionProvider>;
}
