import { ArrowRight, MapPin, Mic, Users } from 'lucide-react';
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
  const people = junction.participants ?? [];
  const extraPeople = Math.max(0, junction.online_count - people.length);
  const location = junction.city ?? category.label;

  return (
    <article className={`group rounded-[22px] border border-white/10 bg-[#10111b]/90 p-5 shadow-[0_18px_60px_rgba(0,0,0,0.18)] transition-all duration-300 hover:-translate-y-1 hover:border-white/20 hover:bg-[#141521] ${compact ? 'p-3.5' : 'sm:p-6'}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="inline-flex max-w-[75%] items-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-xs font-semibold uppercase tracking-[0.12em] text-white/70">
          <MapPin size={14} className="text-sky-300" />
          <span className="truncate">{category.label} · {location}</span>
        </div>
        <div className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-semibold ${junction.online_count > 0 ? 'bg-emerald-400/10 text-emerald-300' : 'bg-white/[0.06] text-white/45'}`}>
          <span className={`mr-1.5 inline-block h-1.5 w-1.5 rounded-full ${junction.online_count > 0 ? 'bg-emerald-300 animate-pulse' : 'bg-white/30'}`} />
          {junction.online_count > 0 ? `${junction.online_count} live` : 'Stage open'}
        </div>
      </div>

      <div className={compact ? 'mt-3' : 'mt-5'}>
        <h3 className={`${compact ? 'text-lg' : 'text-[1.45rem]'} font-semibold tracking-tight text-white`}>{junction.name}</h3>
        <p className={`${compact ? 'mt-1 min-h-0 line-clamp-1' : 'mt-2 min-h-12 line-clamp-2'} text-sm leading-6 text-white/55`}>{junction.description}</p>
      </div>

      <div className={`${compact ? 'my-3' : 'my-5'} h-px bg-white/[0.08]`} />

      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          {people.length > 0 ? (
            <div className="flex -space-x-2">
              {people.slice(0, 4).map((person) => (
                <div key={person.session_id} className="rounded-full ring-2 ring-[#10111b]">
                  <Avatar emoji={person.avatar_emoji} color={person.avatar_color} size="sm" speaking={person.in_voice} />
                </div>
              ))}
              {extraPeople > 0 && (
                <div className="flex h-9 w-9 items-center justify-center rounded-full border-2 border-[#10111b] bg-white/10 text-xs font-semibold text-white/70">
                  +{extraPeople}
                </div>
              )}
            </div>
          ) : (
            <div className="flex items-center gap-2 text-sm text-white/45">
              <span className="h-2 w-2 rounded-full bg-white/30" />
              Be the first to join
            </div>
          )}
          {junction.voice_count > 0 && (
            <span className="hidden items-center gap-1 text-xs text-emerald-300 sm:flex">
              <Mic size={13} /> {junction.voice_count}
            </span>
          )}
        </div>

        <button
          onClick={() => onJoin(junction.slug)}
          className={`flex shrink-0 items-center gap-2 rounded-xl bg-[#6655e8] px-3 py-2.5 text-sm font-semibold text-white shadow-lg shadow-[#6655e8]/20 transition-all hover:bg-[#7666f2] active:scale-95 ${compact ? 'px-3 py-2 text-xs' : ''}`}
        >
          <Users size={16} />
          Join
          <ArrowRight size={16} className="transition-transform group-hover:translate-x-0.5" />
        </button>
      </div>
    </article>
  );
}
