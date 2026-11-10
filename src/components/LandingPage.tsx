import { useMemo, useState } from 'react';
import { Globe2, Plus, Search, Shuffle, Sparkles, Users, X } from 'lucide-react';
import { useJunctions } from '@/hooks/useJunctions';
import { JunctionCard } from '@/components/JunctionCard';
import { CreateJunctionModal } from '@/components/CreateJunctionModal';
import { CATEGORY_META } from '@/lib/constants';
import type { JunctionCategory } from '@/types';

interface LandingPageProps {
  onJoin: (slug: string) => void;
}

type Filter = 'all' | JunctionCategory;

export function LandingPage({ onJoin }: LandingPageProps) {
  const { junctions, loading, totalOnline } = useJunctions();
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [showCreate, setShowCreate] = useState(false);

  const filtered = useMemo(() => junctions.filter((junction) => {
    if (filter !== 'all' && junction.category !== filter) return false;
    if (!query.trim()) return true;
    const search = query.toLowerCase();
    return [junction.name, junction.description, junction.city ?? ''].some((value) => value.toLowerCase().includes(search));
  }), [junctions, query, filter]);

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

  const categories: { key: Filter; label: string; emoji: string }[] = [
    { key: 'all', label: 'All regions', emoji: '◉' },
    ...Object.entries(CATEGORY_META).map(([key, meta]) => ({ key: key as Filter, label: meta.label, emoji: meta.emoji })),
  ];

  return (
    <div className="min-h-screen overflow-x-hidden bg-[#090a11] text-white">
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute -left-40 -top-40 h-[34rem] w-[34rem] rounded-full bg-[#5148d8]/15 blur-[130px]" />
        <div className="absolute -right-48 top-1/3 h-[30rem] w-[30rem] rounded-full bg-sky-500/10 blur-[140px]" />
        <div className="absolute bottom-0 left-1/3 h-[24rem] w-[24rem] rounded-full bg-fuchsia-500/5 blur-[130px]" />
      </div>

      <div className="relative">
        <header className="sticky top-0 z-30 border-b border-white/[0.08] bg-[#090a11]/85 backdrop-blur-2xl">
          <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-4 sm:px-6 lg:px-8">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-gradient-to-br from-[#7766f0] to-sky-400 shadow-lg shadow-[#6655e8]/25">
                <Globe2 size={22} />
              </div>
              <div>
                <h1 className="text-xl font-bold tracking-tight">Junction</h1>
                <p className="text-[10px] uppercase tracking-[0.18em] text-white/35">Meet · Talk · Connect</p>
              </div>
            </div>

            <div className="hidden items-center gap-2 rounded-full border border-emerald-400/20 bg-emerald-400/10 px-4 py-2 text-sm font-medium text-emerald-300 md:flex">
              <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-300" />
              {totalOnline} online now
            </div>

            <div className="flex items-center gap-2">
              <button onClick={() => setShowCreate(true)} className="hidden items-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-sm font-medium text-white/75 transition-colors hover:border-white/25 hover:text-white sm:flex">
                <Plus size={16} /> Create room
              </button>
              <button onClick={handleRandom} className="flex items-center gap-2 rounded-xl bg-[#6655e8] px-3.5 py-2.5 text-sm font-semibold shadow-lg shadow-[#6655e8]/20 transition-all hover:bg-[#7666f2] active:scale-95 sm:px-4">
                <Shuffle size={16} />
                <span className="hidden sm:inline">Explore randomly</span>
                <span className="sm:hidden">Explore</span>
              </button>
            </div>
          </div>
        </header>

        <main className="mx-auto max-w-6xl space-y-8 px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
          <section className="grid items-end gap-6 lg:grid-cols-[1fr_24rem]">
            <div className="max-w-2xl">
              <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-[#7466ed]/25 bg-[#7466ed]/10 px-3 py-1.5 text-xs font-medium text-[#b7b0ff]">
                <Sparkles size={14} /> Live rooms for curious people
              </div>
              <h2 className="text-4xl font-semibold leading-[1.08] tracking-[-0.04em] text-white sm:text-5xl">
                Find your people.
                <span className="block bg-gradient-to-r from-[#a89fff] via-sky-300 to-white bg-clip-text text-transparent">Join the conversation.</span>
              </h2>
              <p className="mt-4 max-w-xl text-base leading-7 text-white/55">
                Drop into a city, topic, or late-night room. Talk over live voice, chat in real time, and leave whenever you want.
              </p>
            </div>

            <div className="rounded-2xl border border-white/10 bg-white/[0.035] p-2 shadow-2xl shadow-black/20">
              <div className="relative">
                <Search size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-white/35" />
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Search rooms or places..."
                  className="w-full rounded-xl border border-white/10 bg-[#141521] py-3.5 pl-11 pr-10 text-sm text-white outline-none transition-colors placeholder:text-white/30 focus:border-[#7766f0]"
                />
                {query && <button onClick={() => setQuery('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-white/40 hover:text-white"><X size={17} /></button>}
              </div>
            </div>
          </section>

          <div className="flex gap-2 overflow-x-auto pb-1">
            {categories.map((category) => (
              <button
                key={category.key}
                onClick={() => setFilter(category.key)}
                className={`shrink-0 rounded-xl border px-4 py-2.5 text-sm font-medium transition-all ${filter === category.key ? 'border-[#8175f5] bg-[#6655e8] text-white shadow-lg shadow-[#6655e8]/20' : 'border-white/10 bg-white/[0.04] text-white/55 hover:border-white/25 hover:text-white'}`}
              >
                <span className="mr-2">{category.emoji}</span>{category.label}
              </button>
            ))}
          </div>

          {loading ? (
            <div className="flex justify-center py-24"><div className="h-8 w-8 animate-spin rounded-full border-2 border-white/15 border-t-[#8175f5]" /></div>
          ) : (
            <>
              {filter === 'all' && !query && trending.length > 0 && (
                <section>
                  <div className="mb-4 flex items-end justify-between">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#a89fff]">Start here</p>
                      <h3 className="mt-1 text-2xl font-semibold tracking-tight">Trending rooms</h3>
                    </div>
                    <span className="text-sm text-white/35">{junctions.length} rooms available</span>
                  </div>
                  <div className="grid gap-4 lg:grid-cols-3">{trending.map((junction) => <JunctionCard key={junction.id} junction={junction} onJoin={onJoin} compact />)}</div>
                </section>
              )}

              {cityJunctions.length > 0 && (
                <section>
                  <div className="mb-4 flex items-center gap-3"><div className="rounded-xl bg-sky-400/10 p-2 text-sky-300"><Globe2 size={18} /></div><div><p className="text-xs uppercase tracking-[0.16em] text-white/35">Explore by place</p><h3 className="text-2xl font-semibold tracking-tight">City rooms</h3></div></div>
                  <div className="grid gap-4 md:grid-cols-2">{cityJunctions.map((junction) => <JunctionCard key={junction.id} junction={junction} onJoin={onJoin} />)}</div>
                </section>
              )}

              {otherJunctions.length > 0 && (
                <section>
                  <div className="mb-4 flex items-center gap-3"><div className="rounded-xl bg-fuchsia-400/10 p-2 text-fuchsia-300"><Sparkles size={18} /></div><div><p className="text-xs uppercase tracking-[0.16em] text-white/35">Find your corner</p><h3 className="text-2xl font-semibold tracking-tight">Explore categories</h3></div></div>
                  <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">{otherJunctions.map((junction) => <JunctionCard key={junction.id} junction={junction} onJoin={onJoin} />)}</div>
                </section>
              )}

              {filtered.length === 0 && <div className="rounded-3xl border border-white/10 bg-white/[0.03] py-20 text-center"><Users size={28} className="mx-auto mb-3 text-white/25" /><p className="text-lg text-white/50">No rooms match your search.</p><button onClick={() => { setQuery(''); setFilter('all'); }} className="mt-3 text-sm font-medium text-[#a89fff] hover:text-white">Clear filters</button></div>}
            </>
          )}

          <section className="grid grid-cols-2 gap-3 border-t border-white/[0.08] pt-8 sm:grid-cols-4">
            {[{ icon: Users, label: 'Online now', value: totalOnline }, { icon: Globe2, label: 'Live rooms', value: junctions.length }, { icon: Sparkles, label: 'Topics', value: Object.keys(CATEGORY_META).length }, { icon: Users, label: 'Active rooms', value: junctions.filter((junction) => junction.online_count > 0).length }].map((stat) => (
              <div key={stat.label} className="rounded-2xl border border-white/10 bg-white/[0.03] p-4"><stat.icon size={18} className="mb-3 text-[#a89fff]" /><div className="text-2xl font-semibold">{stat.value}</div><div className="mt-1 text-xs uppercase tracking-[0.12em] text-white/35">{stat.label}</div></div>
            ))}
          </section>
        </main>

        {showCreate && <CreateJunctionModal onClose={() => setShowCreate(false)} onCreated={(slug) => { setShowCreate(false); onJoin(slug); }} />}
      </div>
    </div>
  );
}
