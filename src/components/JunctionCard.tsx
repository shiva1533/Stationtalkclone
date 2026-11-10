import { ArrowRight, Globe2, MapPin, Mic } from 'lucide-react';
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
}

export function JunctionCard({ junction, onJoin, compact = false }: JunctionCardProps) {
  const category = CATEGORY_META[junction.category];
  const people = junction.participants.slice(0, 3);
  const extraPeople = Math.max(0, junction.online_count - people.length);
  const LocationIcon = junction.city ? MapPin : Globe2;

  return (
    <article className={`flex min-w-0 flex-col rounded-lg border border-line bg-surface transition-colors hover:border-outline ${compact ? 'p-3' : 'p-3.5'}`}>
      <div className="flex items-center justify-between gap-2 text-xs text-muted">
        <span className="flex min-w-0 items-center gap-1.5">
          <LocationIcon size={13} aria-hidden="true" className="shrink-0" />
          <span className="truncate">{junction.city ?? category.label}</span>
        </span>
        <span className={`flex shrink-0 items-center gap-1.5 ${junction.online_count > 0 ? 'font-medium text-accent' : ''}`}>
          <span className={`size-1.5 rounded-full ${junction.online_count > 0 ? 'bg-accent' : 'bg-outline'}`} />
          {junction.online_count} online
        </span>
      </div>

      <h3 className="mt-2 break-words text-sm font-semibold">{junction.name}</h3>
      <p className="mb-3 mt-1 line-clamp-2 break-words text-[13px] leading-5 text-muted">{junction.description}</p>

      <div className="mt-auto flex min-w-0 items-center justify-between gap-2 border-t border-line pt-2">
        <div className="flex min-w-0 items-center gap-2">
          {people.length > 0 ? (
            <div className="flex items-center -space-x-1.5" aria-label="People in this room">
              {people.map((person) => (
                <div key={person.session_id} title={person.nickname} className="rounded-full ring-2 ring-surface">
                  <Avatar emoji={person.avatar_emoji} color={person.avatar_color} size="xs" />
                </div>
              ))}
              {extraPeople > 0 && <span className="grid size-6 place-items-center rounded-full bg-subtle text-[11px] font-medium text-muted ring-2 ring-surface">+{extraPeople}</span>}
            </div>
          ) : (
            <span className="text-xs text-muted">Be the first to join</span>
          )}
          {junction.voice_count > 0 && (
            <span className="flex items-center gap-1 text-xs text-accent" title={`${junction.voice_count} in voice`}>
              <Mic size={13} aria-hidden="true" /> {junction.voice_count}
            </span>
          )}
        </div>

        <button onClick={() => onJoin(junction.slug)} aria-label={`Join ${junction.name}`} className="button button-secondary min-h-9 shrink-0">
          Join <ArrowRight size={14} aria-hidden="true" />
        </button>
      </div>
    </article>
  );
}
