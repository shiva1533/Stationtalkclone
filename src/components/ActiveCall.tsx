import { Headphones, Mic, MicOff, PhoneOff, Volume2, VolumeX } from 'lucide-react';
import { useActiveRoom } from '@/context/ActiveRoomContext';

export function ActiveCall() {
  const room = useActiveRoom();
  if (!room.minimized || !room.junction) return null;

  return (
    <aside className="active-call" aria-label="Active room">
      <button onClick={room.restoreRoom} className="active-call-room" aria-label="Return to active room">
        <span className="active-call-icon"><Headphones size={20} /></span>
        <span><strong>{room.junction.name}</strong><small>{room.audioEnabled ? room.connectionState : 'Audio off'} · {room.inVoice ? 'In voice' : 'Listening'}</small></span>
      </button>
      <div className="active-call-controls">
        {(room.autoplayBlocked || !room.audioEnabled || room.connectionState === 'Failed') && (
          <button className="room-icon-button" onClick={() => { void room.enableAudio(); }} aria-label="Enable audio"><Headphones size={18} /></button>
        )}
        {room.inVoice && <button className="room-icon-button" onClick={() => { void room.toggleMic(); }} aria-label={room.micMuted ? 'Unmute' : 'Mute'}>{room.micMuted ? <MicOff size={18} /> : <Mic size={18} />}</button>}
        <button className="room-icon-button" onClick={() => room.setSpeakerOn(!room.speakerOn)} aria-label={room.speakerOn ? 'Mute speaker' : 'Enable speaker'}>{room.speakerOn ? <Volume2 size={18} /> : <VolumeX size={18} />}</button>
        <button className="room-icon-button active-call-leave" onClick={() => { void room.leaveRoom(); }} aria-label="Leave call"><PhoneOff size={18} /></button>
      </div>
    </aside>
  );
}
