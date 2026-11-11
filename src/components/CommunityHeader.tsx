import { Bell, Plus, Search } from 'lucide-react';
import { useSession } from '@/context/SessionContext';
import { CommunityNavigation, type CommunityView } from './CommunityNavigation';
import { Avatar } from './Avatar';

interface CommunityHeaderProps {
  active: CommunityView;
  onNavigate: (view: CommunityView) => void;
  onCreate: () => void;
  onSearch: () => void;
  onProfile: () => void;
}

export function CommunityHeader({ active, onNavigate, onCreate, onSearch, onProfile }: CommunityHeaderProps) {
  const { session } = useSession();

  return (
    <header className="community-header">
      <div className="page-width header-inner">
        <button onClick={() => onNavigate('explore')} aria-label="Junction home" className="brand">
          <img src="/junction.svg" alt="" width="36" height="36" />
          <span>Junction</span>
        </button>
        <span className="community-badge"><span className="status-dot" /><span className="badge-full">Live Community</span><span className="badge-short">Live</span></span>
        <div className="header-desktop-nav">
          <CommunityNavigation active={active} onNavigate={onNavigate} onProfile={onProfile} />
        </div>
        <div className="header-actions">
          <button onClick={onSearch} aria-label="Search rooms" className="icon-button"><Search size={19} /></button>
          <details className="notification-menu" onKeyDown={(event) => { if (event.key === 'Escape') event.currentTarget.open = false; }}>
            <summary aria-label="Notifications" className="icon-button"><Bell size={19} /></summary>
            <div className="notification-panel">
              <div className="flex items-center gap-2 text-sm font-semibold"><Bell size={16} className="text-accent" /> Notifications</div>
              <p className="mt-2 text-sm leading-6 text-muted">Chat notifications appear while you’re in a room. Join a conversation to get started.</p>
            </div>
          </details>
          <button onClick={onCreate} className="button button-primary header-create" aria-label="Create room">
            <Plus size={17} /><span>Create Room</span>
          </button>
          <button onClick={onProfile} aria-label="Edit profile" className="profile-button">
            {session && <Avatar emoji={session.avatarEmoji} color={session.avatarColor} size="sm" />}
          </button>
        </div>
      </div>
    </header>
  );
}
