import { useMemo, useState } from 'react';
import { Globe2, Plus, Search, Shuffle, X } from 'lucide-react';
import { useJunctions } from '@/hooks/useJunctions';
import { JunctionCard } from '@/components/JunctionCard';
import { CreateJunctionModal } from '@/components/CreateJunctionModal';
import { CATEGORY_META } from '@/lib/constants';
import type { JunctionCategory } from '@/types';

interface LandingPageProps {
  onJoin: (slug: string) => void;
}

type Filter = 'all' | JunctionCategory;

const categories = [
  { key: 'all' as const, label: 'All rooms' },
  ...Object.entries(CATEGORY_META).map(([key, { label }]) => ({ key: key as JunctionCategory, label })),
];

export function LandingPage({ onJoin }: LandingPageProps) {
  const { junctions, loading, loadFailed, totalOnline, retry } = useJunctions();
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [showCreate, setShowCreate] = useState(false);
  const search = query.trim().toLowerCase();

  const filtered = useMemo(() => junctions.filter((junction) => {
    if (filter !== 'all' && junction.category !== filter) return false;
    return [junction.name, junction.description, junction.city ?? ''].some((value) => value.toLowerCase().includes(search));
  }), [junctions, filter, search]);

  const trending = useMemo(
    () => [...junctions].sort((a, b) => b.online_count - a.online_count).slice(0, 3),
    [junctions],
  );
  const cityJunctions = filtered.filter((junction) => junction.category === 'city');
  const otherJunctions = filtered.filter((junction) => junction.category !== 'city');

  const handleRandom = () => {
    const active = junctions.filter((junction) => junction.online_count > 0);
    const pool = active.length > 0 ? active : junctions;
    if (pool.length > 0) onJoin(pool[Math.floor(Math.random() * pool.length)].slug);
  };

  return (
    <div className="min-h-screen bg-canvas">
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <div className="flex items-center gap-2.5">
            <span className="flex size-8 items-center justify-center rounded-md bg-accent text-white">
              <Globe2 size={18} aria-hidden="true" />
            </span>
            <span className="text-base font-semibold">Junction</span>
          </div>
          <button onClick={() => setShowCreate(true)} className="button button-primary">
            <Plus size={16} aria-hidden="true" /> Create room
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 pb-8 pt-6 sm:px-6 sm:pt-8">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight sm:text-[1.75rem] sm:leading-9">Explore rooms</h1>
            <p className="mt-1 text-sm text-muted">Join a room to talk or chat. No sign-up needed.</p>
          </div>
          <button onClick={handleRandom} disabled={junctions.length === 0} className="button button-secondary self-start sm:self-auto">
            <Shuffle size={15} aria-hidden="true" /> Random room
          </button>
        </div>

        <div className="mt-5 flex flex-col gap-3 border-b border-line sm:mt-6">
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
            <div className="relative w-full sm:max-w-xs">
              <Search size={16} aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
              <input
                aria-label="Search rooms or cities"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search rooms or cities"
                className="field w-full pl-9 pr-10"
              />
              {query && (
                <button onClick={() => setQuery('')} aria-label="Clear search" className="absolute inset-y-0 right-1 grid w-8 place-items-center rounded-md text-muted hover:text-ink">
                  <X size={16} />
                </button>
              )}
            </div>
            <p className="flex items-center gap-2 text-xs text-muted">
              <span className={`size-1.5 rounded-full ${totalOnline > 0 ? 'bg-accent' : 'bg-outline'}`} />
              {totalOnline} online <span aria-hidden="true">·</span> {junctions.length} rooms
            </p>
          </div>

          <div className="-mx-1 flex gap-1 overflow-x-auto px-1" aria-label="Room categories" role="group">
            {categories.map((category) => (
              <button
                key={category.key}
                onClick={() => setFilter(category.key)}
                aria-pressed={filter === category.key}
                className={`min-h-10 shrink-0 border-b-2 px-2.5 text-sm font-medium transition-colors focus-visible:outline-offset-[-3px] ${filter === category.key ? 'border-accent text-accent' : 'border-transparent text-muted hover:text-ink'}`}
              >
                {category.label}
              </button>
            ))}
          </div>
        </div>

        {loading ? (
          <div role="status" className="py-12 text-center text-sm text-muted">Loading rooms…</div>
        ) : loadFailed ? (
          <div className="mt-5 rounded-lg border border-line bg-surface px-4 py-8 text-center">
            <p role="alert" className="text-sm text-muted">Couldn’t load rooms. Check the Supabase connection and try again.</p>
            <button onClick={retry} className="button button-secondary mt-3">Try again</button>
          </div>
        ) : (
          <div className="mt-5 space-y-6 sm:mt-6 sm:space-y-7">
            {filter === 'all' && !search && trending.length > 0 && (
              <section aria-labelledby="trending-rooms">
                <h2 id="trending-rooms" className="mb-2.5 text-base font-semibold">Trending rooms</h2>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {trending.map((junction) => <JunctionCard key={junction.id} junction={junction} onJoin={onJoin} compact />)}
                </div>
              </section>
            )}

            {cityJunctions.length > 0 && (
              <section aria-labelledby="city-rooms">
                <h2 id="city-rooms" className="mb-2.5 text-base font-semibold">City rooms</h2>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {cityJunctions.map((junction) => <JunctionCard key={junction.id} junction={junction} onJoin={onJoin} />)}
                </div>
              </section>
            )}

            {otherJunctions.length > 0 && (
              <section aria-labelledby="topic-rooms">
                <h2 id="topic-rooms" className="mb-2.5 text-base font-semibold">Topic rooms</h2>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {otherJunctions.map((junction) => <JunctionCard key={junction.id} junction={junction} onJoin={onJoin} />)}
                </div>
              </section>
            )}

            {filtered.length === 0 && (
              <div className="rounded-lg border border-line bg-surface px-4 py-10 text-center">
                <p className="text-sm text-muted">{search || filter !== 'all' ? 'No rooms match your filters.' : 'There are no rooms yet.'}</p>
                {(search || filter !== 'all') && (
                  <button onClick={() => { setQuery(''); setFilter('all'); }} className="mt-2 min-h-9 rounded px-2 text-sm font-medium text-accent hover:underline">
                    Clear filters
                  </button>
                )}
              </div>
            )}
          </div>
        )}
      </main>

      {showCreate && <CreateJunctionModal onClose={() => setShowCreate(false)} onCreated={(slug) => { setShowCreate(false); onJoin(slug); }} />}
    </div>
  );
}
