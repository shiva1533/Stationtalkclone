import { useState } from 'react';
import { ArrowUpRight, Building2, Headphones, MapPin, UsersRound } from 'lucide-react';
import type { Junction } from '@/types';
import type { JunctionParticipantPreview } from '@/hooks/useJunctions';
import { CATEGORY_META } from '@/lib/constants';
import { Avatar } from './Avatar';

interface JunctionCardProps {
  junction: Junction & {
    online_count: number;
    voice_count: number;
    participants: JunctionParticipantPreview[];
  };
  onJoin: (slug: string) => void;
  compact?: boolean;
  featured?: boolean;
}

export function JunctionCard({ junction, onJoin, compact = false, featured = false }: JunctionCardProps) {
  const [failedImage, setFailedImage] = useState<string | null>(null);
  const category = CATEGORY_META[junction.category];
  const people = junction.participants.slice(0, 3);
  const extraPeople = Math.max(0, junction.online_count - people.length);

  return (
    <article className={`room-card ${featured ? 'room-card-featured' : ''} ${compact ? 'room-card-compact' : ''}`}>
      <div className={`room-thumbnail ${junction.category !== 'city' ? 'topic-thumbnail' : ''}`}>
        {junction.image_url && failedImage !== junction.image_url ? (
          <img src={junction.image_url} alt={junction.city ? `A view of ${junction.city}` : ''} loading={featured ? 'eager' : 'lazy'} onError={() => setFailedImage(junction.image_url)} />
        ) : junction.category === 'city' ? (
          <Building2 size={30} strokeWidth={1.3} aria-hidden="true" />
        ) : (
          <span aria-hidden="true">{category.emoji}</span>
        )}
      </div>

      <div className="room-card-content">
        <p className="room-location"><MapPin size={12} aria-hidden="true" />{junction.city ?? category.label}</p>
        <h3>{junction.name}</h3>
        <p className="room-description">{junction.description}</p>
        <div className="room-members">
          {people.length > 0 && (
            <div className="member-avatars" aria-label="People in this room">
              {people.map((person) => (
                <div key={person.session_id} title={person.nickname} className="member-avatar"><Avatar emoji={person.avatar_emoji} color={person.avatar_color} size="xs" /></div>
              ))}
              {extraPeople > 0 && <span className="extra-members">+{extraPeople}</span>}
            </div>
          )}
          <span className="member-count"><UsersRound size={13} aria-hidden="true" />{junction.online_count} {junction.online_count === 1 ? 'member' : 'members'}</span>
          {junction.voice_count > 0 && <span className="voice-count"><Headphones size={13} aria-hidden="true" />{junction.voice_count} in voice</span>}
        </div>
      </div>

      <div className="room-card-actions">
        <span className={`room-online ${junction.online_count > 0 ? 'is-online' : ''}`}><span className="status-dot" />{junction.online_count > 0 ? `${junction.online_count} online` : 'Room open'}</span>
        <button onClick={() => onJoin(junction.slug)} aria-label={`Join ${junction.name}`} className="button button-primary join-room-button">Join<ArrowUpRight size={15} aria-hidden="true" /></button>
      </div>
    </article>
  );
}
