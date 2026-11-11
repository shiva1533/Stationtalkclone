import { Compass, Headphones, MessageCircle, UserRound, UsersRound } from 'lucide-react';

export type CommunityView = 'explore' | 'live' | 'friends' | 'chats';

interface CommunityNavigationProps {
  active: CommunityView;
  onNavigate: (view: CommunityView) => void;
  onProfile: () => void;
  mobile?: boolean;
}

const destinations = [
  { key: 'explore', label: 'Explore', icon: Compass },
  { key: 'live', label: 'Live', icon: Headphones },
  { key: 'friends', label: 'Friends', icon: UsersRound },
  { key: 'chats', label: 'Chats', icon: MessageCircle },
] as const;

export function CommunityNavigation({ active, onNavigate, onProfile, mobile = false }: CommunityNavigationProps) {
  return (
    <nav aria-label={mobile ? 'Mobile navigation' : 'Main navigation'} className={mobile ? 'mobile-dock' : 'desktop-navigation'}>
      {destinations.map(({ key, label, icon: Icon }) => (
        <button key={key} onClick={() => onNavigate(key)} aria-current={active === key ? 'page' : undefined} className={`community-nav-item ${active === key ? 'is-active' : ''}`}>
          <Icon size={19} strokeWidth={1.8} aria-hidden="true" />
          <span>{label}</span>
        </button>
      ))}
      <button onClick={onProfile} className="community-nav-item">
        <UserRound size={19} strokeWidth={1.8} aria-hidden="true" /><span>Profile</span>
      </button>
    </nav>
  );
}
