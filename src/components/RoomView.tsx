import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, Compass, Headphones, HeadphoneOff, Mic, MicOff, MessageSquare, Minimize2, PhoneOff, Smile, Users, Volume2, X } from 'lucide-react';
import type { ReactNode } from 'react';
import type { Junction, Message, Participant, Session } from '@/types';
import { useSession } from '@/context/SessionContext';
import { useActiveRoom } from '@/context/ActiveRoomContext';
import { useJunctions, type JunctionParticipantPreview } from '@/hooks/useJunctions';
import { CATEGORY_META, REACTION_EMOJIS } from '@/lib/constants';
import { Avatar } from './Avatar';
import { ChatPanel } from './ChatPanel';
import { JunctionCard } from './JunctionCard';
import { ParticipantsPanel } from './ParticipantsPanel';
import '@/room.css';

type ExploreJunction = Junction & {
  online_count: number;
  voice_count: number;
  participants: JunctionParticipantPreview[];
};

export function RoomView() {
  const {
    junction, participants, messages, reactions, loading, joined, error,
    sendMessage, toggleReaction, reportUser, inVoice, micMuted, speakerOn,
    setSpeakerOn, joiningVoice, voiceError, setVoiceError, speakingStates,
    blockedSessions, mutedSessions, notificationsMuted, setNotificationsMuted,
    chatPopups, floatingReactions, joinVoice, leaveVoice, moveToListening,
    enableAudio, autoplayBlocked, audioEnabled, connectionState, isBlocked,
    toggleMic, toggleMute, handleBlock, unblockUser, sendReaction,
    backToExplore: handleLeave, minimizeRoom, openRoom: onExplore,
  } = useActiveRoom();
  const { session } = useSession();
  const { junctions: exploreJunctions } = useJunctions();
  const [failedThumbnail, setFailedThumbnail] = useState<string | null>(null);
  const [mobileTab, setMobileTab] = useState<'stage' | 'chat' | 'people'>('stage');
  const [showExplore, setShowExplore] = useState(false);
  const [showReactionPicker, setShowReactionPicker] = useState(false);
  const [reportTarget, setReportTarget] = useState<{ sessionId: string; nickname: string } | null>(null);
  const viewportRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;
    const resize = () => {
      viewportRef.current?.style.setProperty('--room-viewport-height', viewport.height + 'px');
      viewportRef.current?.style.setProperty('--room-viewport-top', viewport.offsetTop + 'px');
    };
    resize();
    viewport.addEventListener('resize', resize);
    viewport.addEventListener('scroll', resize);
    return () => {
      viewport.removeEventListener('resize', resize);
      viewport.removeEventListener('scroll', resize);
    };
  }, []);

  if (!junction || !session) return null;
  const cat = CATEGORY_META[junction.category];
  const voiceParticipants = participants.filter((participant) => participant.in_voice);
  const listeners = participants.filter((participant) => !participant.in_voice);
  const speakingCount = voiceParticipants.filter((participant) => participant.is_speaking || speakingStates[participant.session_id]).length;
  const handleReport = (sessionId: string, nickname: string) => setReportTarget({ sessionId, nickname });

  return (
    <div ref={viewportRef} className="voice-room">
      <div className="voice-room-shell">
        <header className="voice-room-header">
          <button onClick={handleLeave} className="room-icon-button room-back" aria-label="Back to Explore" title="Back to Explore">
            <ArrowLeft size={18} />
            <span className="hidden lg:inline">Back to Explore</span>
            <span className="lg:hidden">Back</span>
          </button>
          <div className="voice-room-thumbnail" aria-hidden="true">
            {junction.image_url && failedThumbnail !== junction.image_url ? (
              <img src={junction.image_url} alt="" onError={() => setFailedThumbnail(junction.image_url)} />
            ) : <span>{cat.emoji}</span>}
          </div>
          <div className="voice-room-title">
            <h1>{junction.name}</h1>
            {junction.description && <p>{junction.description}</p>}
          </div>
          <button onClick={minimizeRoom} className="room-icon-button" aria-label="Minimize room" title="Minimize room">
            <Minimize2 size={17} />
          </button>
          <button onClick={() => setShowExplore(true)} className="button button-secondary room-explore">
            <Compass size={17} aria-hidden="true" />
            <span className="hidden sm:inline">Explore rooms</span>
            <span className="sm:hidden">Explore</span>
          </button>
        </header>

        <RoomNavigation active={mobileTab} onChange={setMobileTab} count={participants.length} desktop />

        <main className="voice-room-content" data-view={mobileTab}>
          <div className="room-stage-pane">
            <ParticipantStage
              voiceParticipants={voiceParticipants}
              listeners={listeners}
              participants={participants}
              session={session}
              speakingStates={speakingStates}
              speakingCount={speakingCount}
              loading={loading}
            />
          </div>
          <div className="room-chat-pane">
            <ChatPanel
              junctionId={junction.id}
              messages={messages}
              reactions={reactions}
              blockedSessions={blockedSessions}
              isBlocked={isBlocked}
              participants={participants}
              connected={joined}
              slowModeSeconds={junction.slow_mode_seconds}
              onSend={sendMessage}
              onToggleReaction={toggleReaction}
              onReport={handleReport}
              onBlock={handleBlock}
              notificationsMuted={notificationsMuted}
              onToggleMute={() => setNotificationsMuted((current) => !current)}
            />
          </div>
          <div className="room-people-pane">
            <ParticipantsPanel
              participants={participants}
              mutedSessions={mutedSessions}
              blockedSessions={blockedSessions}
              onMute={toggleMute}
              onUnblock={unblockUser}
              onReport={handleReport}
              onBlock={handleBlock}
            />
          </div>
        </main>

        {(voiceError || error) && (
          <div role="alert" className="room-voice-error">
            <span>{voiceError || error}</span>
            <button onClick={() => setVoiceError('')} aria-label="Dismiss error" className="room-icon-button">
              <X size={16} />
            </button>
          </div>
        )}

        <div className="room-chat-popups">
          {chatPopups.map((message) => <ChatPopup key={message.id} message={message} />)}
        </div>
        {floatingReactions.map((reaction) => (
          <div key={reaction.id} className="animate-junction-reaction room-floating-reaction" style={{ left: `${reaction.x}%` }}>
            <span className="text-3xl">{reaction.emoji}</span>
            <span className="mt-1 rounded-full border border-line bg-surface px-2 py-0.5 text-xs font-medium text-muted">{reaction.nickname}</span>
          </div>
        ))}

        {(autoplayBlocked || !audioEnabled || connectionState === 'Failed') && (
          <div className="room-audio-notice">
            <span>{!audioEnabled ? 'Room audio is off.' : 'Tap to enable room audio.'}</span>
            <button className="button button-secondary" onClick={() => { void enableAudio(); }}>Enable audio</button>
          </div>
        )}
        <footer className="room-footer">
          <RoomNavigation active={mobileTab} onChange={setMobileTab} count={participants.length} />
          <div className="room-call-options">
            <span role="status">{inVoice ? 'In voice' : 'Listening'} · {audioEnabled ? connectionState : 'Audio off'}</span>
            {inVoice && <button onClick={() => { void moveToListening().catch((reason: Error) => setVoiceError(reason.message)); }}>Move to Listening</button>}
          </div>
          <div className="voice-controls" aria-label="Voice controls" role="group">
            {!inVoice ? (
              <button onClick={joinVoice} disabled={joiningVoice || !joined} className="button button-primary room-join-voice">
                <Headphones size={18} />{joiningVoice ? 'Connecting…' : 'Join voice'}
              </button>
            ) : (
              <>
                <ControlButton
                  active={!micMuted}
                  primary
                  onClick={toggleMic}
                  icon={micMuted ? <MicOff size={18} /> : <Mic size={18} />}
                  label={micMuted ? 'Unmute' : 'Mute'}
                />
                <ControlButton
                  active={speakerOn}
                  onClick={() => setSpeakerOn((current) => !current)}
                  icon={speakerOn ? <Headphones size={18} /> : <HeadphoneOff size={18} />}
                  label={speakerOn ? 'Speaker' : 'Audio off'}
                />
                <button onClick={leaveVoice} aria-label="Leave voice" className="button room-leave-voice">
                  <PhoneOff size={18} /><span>Leave voice</span>
                </button>
              </>
            )}
            <ReactionPicker
              open={showReactionPicker}
              onToggle={() => setShowReactionPicker((current) => !current)}
              onSelect={(emoji) => { sendReaction(emoji); setShowReactionPicker(true); }}
            />
          </div>
        </footer>

        {reportTarget && (
          <ReportModal
            nickname={reportTarget.nickname}
            onCancel={() => setReportTarget(null)}
            onSubmit={async (reason) => {
              await reportUser(reportTarget.sessionId, reportTarget.nickname, reason);
              setReportTarget(null);
            }}
          />
        )}
        {showExplore && (
          <ExploreModal
            junctions={exploreJunctions}
            currentJunctionId={junction.id}
            onClose={() => setShowExplore(false)}
            onJoin={(slug) => { setShowExplore(false); void onExplore(slug).catch((reason: Error) => setVoiceError(reason.message)); }}
          />
        )}
      </div>
    </div>
  );
}

interface ParticipantStageProps {
  voiceParticipants: Participant[];
  listeners: Participant[];
  participants: Participant[];
  session: Session;
  speakingStates: Record<string, boolean>;
  speakingCount: number;
  loading: boolean;
}

function ParticipantStage({ voiceParticipants, listeners, participants, session, speakingStates, speakingCount, loading }: ParticipantStageProps) {
  const groups = [
    { label: 'In voice', members: voiceParticipants },
    { label: 'Listening', members: listeners },
  ];

  return (
    <section className="voice-stage">
      <div className="room-panel-heading">
        <h2>Voice stage</h2>
        <p className="stage-counts">{participants.length} here <span>·</span> {voiceParticipants.length} in voice</p>
      </div>
      <div className="voice-stage-scroll">
        {speakingCount > 0 && <p className="stage-speaking"><span />{speakingCount} speaking</p>}
        {loading ? (
          <p role="status" className="room-loading">Loading participants…</p>
        ) : participants.length === 0 ? (
          <p className="room-loading">You’re the first one here.</p>
        ) : (
          groups.filter(({ members }) => members.length > 0).map(({ label, members }) => (
            <section key={label} className="stage-group">
              <h3>{label} <span>({members.length})</span></h3>
              <div className="participant-grid">
                {members.map((participant) => (
                  <ParticipantCard
                    key={participant.id}
                    participant={participant}
                    isMe={participant.session_id === session.sessionId}
                    speaking={speakingStates[participant.session_id] ?? participant.is_speaking}
                  />
                ))}
              </div>
            </section>
          ))
        )}
      </div>
    </section>
  );
}

function ParticipantCard({ participant, isMe, speaking }: { participant: Participant; isMe: boolean; speaking: boolean }) {
  const status = participant.in_voice ? (participant.mic_muted ? 'Muted' : speaking ? 'Speaking' : 'Live mic') : 'Listening';
  const StatusIcon = !participant.in_voice ? Headphones : participant.mic_muted ? MicOff : Mic;

  return (
    <div className={`voice-participant-card ${speaking ? 'is-speaking' : ''}`}>
      <Avatar
        emoji={participant.avatar_emoji}
        color={participant.avatar_color}
        size="lg"
        speaking={speaking}
        speakingColor="#8B5CF6"
        ring={participant.in_voice}
      />
      <p className="participant-name">
        <span>{participant.nickname}</span>{isMe && <small>(you)</small>}
      </p>
      <span className={`participant-status ${speaking ? 'is-speaking' : ''}`}>
        <StatusIcon size={12} aria-hidden="true" />{status}
      </span>
    </div>
  );
}

function ControlButton({ active, onClick, icon, label, primary = false }: { active: boolean; onClick: () => void; icon: ReactNode; label: string; primary?: boolean }) {
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      className={`button room-control ${primary ? 'button-primary' : active ? 'room-control-active' : 'button-secondary'}`}
    >
      {icon}{label}
    </button>
  );
}

type RoomTab = 'stage' | 'chat' | 'people';

function RoomNavigation({ active, onChange, count, desktop = false }: { active: RoomTab; onChange: (tab: RoomTab) => void; count: number; desktop?: boolean }) {
  const tabs = [
    { key: 'stage', label: 'Stage', icon: Volume2, count },
    { key: 'chat', label: 'Chat', icon: MessageSquare },
    { key: 'people', label: 'People', icon: Users, count },
  ] as const;

  return (
    <nav className={`room-navigation ${desktop ? 'room-navigation-desktop' : 'room-navigation-mobile'}`} aria-label={desktop ? 'Room navigation' : 'Mobile room navigation'}>
      {tabs.map(({ key, label, icon: Icon, ...tab }) => (
        <button key={key} onClick={() => onChange(key)} aria-label={label} aria-pressed={active === key} className={active === key ? 'is-active' : ''}>
          <Icon size={17} aria-hidden="true" />{label}{'count' in tab && <span className="room-tab-count">{tab.count}</span>}
        </button>
      ))}
    </nav>
  );
}

function ReactionPicker({ open, onToggle, onSelect }: { open: boolean; onToggle: () => void; onSelect: (emoji: string) => void }) {
  return (
    <div className="room-reaction-control">
      {open && (
        <div role="group" aria-label="Room reactions" className="reaction-picker-grid room-reaction-picker">
          {REACTION_EMOJIS.map((emoji) => (
            <button key={emoji} aria-label={`React with ${emoji}`} onClick={() => onSelect(emoji)} className="reaction-emoji-button">{emoji}</button>
          ))}
        </div>
      )}
      <button onClick={onToggle} aria-expanded={open} className={`button ${open ? 'room-control-active' : 'button-secondary'}`}>
        <Smile size={18} />React
      </button>
    </div>
  );
}

function ChatPopup({ message }: { message: Message }) {
  return (
    <div className="animate-chat-popup flex items-center gap-2 rounded-lg border border-line bg-surface px-3 py-2 shadow-md">
      <Avatar emoji={message.avatar_emoji} color={message.avatar_color} size="xs" />
      <div className="min-w-0">
        <p className="truncate text-xs font-semibold">{message.nickname}</p>
        <p className="truncate text-xs text-muted">{message.content}</p>
      </div>
    </div>
  );
}

function ExploreModal({ junctions, currentJunctionId, onClose, onJoin }: { junctions: ExploreJunction[]; currentJunctionId: string; onClose: () => void; onJoin: (slug: string) => void }) {
  return (
    <div className="fixed inset-0 z-[60] grid place-items-center bg-ink/35 p-4">
      <section role="dialog" aria-modal="true" aria-labelledby="explore-title" className="flex max-h-[calc(100dvh-2rem)] w-full max-w-3xl flex-col overflow-hidden rounded-lg border border-line bg-surface shadow-lg">
        <div className="flex items-center justify-between border-b border-line px-4 py-3 sm:px-5">
          <h2 id="explore-title" className="text-base font-semibold">Explore rooms</h2>
          <button onClick={onClose} className="button button-secondary !px-2" aria-label="Close explorer"><X size={16} /></button>
        </div>
        <div className="grid min-h-0 gap-3 overflow-y-auto bg-canvas p-4 sm:grid-cols-2 sm:p-5">
          {junctions.map((item) => (
            <div key={item.id} className={`grid min-w-0 rounded-lg ${item.id === currentJunctionId ? 'ring-1 ring-accent' : ''}`}>
              <JunctionCard junction={item} onJoin={onJoin} compact />
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

function ReportModal({ nickname, onCancel, onSubmit }: { nickname: string; onCancel: () => void; onSubmit: (reason: string) => void }) {
  const [reason, setReason] = useState('');
  const reasons = ['Spam', 'Harassment', 'Hate speech', 'Inappropriate content', 'Other'];

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-ink/35 p-4">
      <section role="dialog" aria-modal="true" aria-labelledby="report-title" className="dialog space-y-3">
        <div className="flex items-center justify-between gap-2">
          <h2 id="report-title" className="break-words text-base font-semibold">Report {nickname}</h2>
          <button onClick={onCancel} aria-label="Close report" className="button button-secondary !px-2"><X size={16} /></button>
        </div>
        <div className="space-y-1.5" role="group" aria-label="Reason for reporting">
          {reasons.map((item) => (
            <button key={item} onClick={() => setReason(item)} aria-pressed={reason === item} className={`button w-full justify-start border ${reason === item ? 'border-accent-line bg-accent-soft text-accent' : 'button-secondary'}`}>
              {item}
            </button>
          ))}
        </div>
        <button onClick={() => reason && onSubmit(reason)} disabled={!reason} className="button w-full bg-danger text-white hover:bg-danger-hover">Submit report</button>
      </section>
    </div>
  );
}
