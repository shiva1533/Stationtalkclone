import { useMemo, useRef, useState } from 'react';
import { ArrowRight, Headphones, MessageCircle, Radio, Search, Shuffle, UsersRound, X } from 'lucide-react';
import { useJunctions } from '@/hooks/useJunctions';
import { useSession } from '@/context/SessionContext';
import { JunctionCard } from './JunctionCard';
import { CommunityHeader } from './CommunityHeader';
import type { CommunityView } from './CommunityNavigation';
import { CategoryNavigation, RoomFilterMenu, type RoomCategoryFilter } from './RoomFilters';
import { CreateJunctionModal } from './CreateJunctionModal';
import { NicknameModal } from './NicknameModal';

interface LandingPageProps {
  onJoin: (slug: string) => void;
}

export function LandingPage({ onJoin }: LandingPageProps) {
  const { junctions, loading, loadFailed, totalOnline, retry } = useJunctions();
  const { session, setSession } = useSession();
  const [view, setView] = useState<CommunityView>('explore');
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<RoomCategoryFilter>('all');
  const [onlineOnly, setOnlineOnly] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [showProfile, setShowProfile] = useState(false);
  const searchInput = useRef<HTMLInputElement>(null);
  const search = query.trim().toLowerCase();

  const filtered = useMemo(() => junctions.filter((junction) => {
    if (category !== 'all' && junction.category !== category) return false;
    if ((onlineOnly || view === 'live') && junction.online_count === 0) return false;
    if (view === 'friends' && junction.category !== 'friendship') return false;
    return [junction.name, junction.description, junction.city ?? ''].some((value) => value.toLowerCase().includes(search));
  }), [junctions, category, onlineOnly, view, search]);

  const featured = useMemo(() => {
    const cities = junctions.filter(({ slug }) => slug === 'hyderabad' || slug === 'bangalore');
    const others = junctions.filter(({ id }) => !cities.some((city) => city.id === id));
    return [...cities, ...others.sort((a, b) => b.online_count - a.online_count)].slice(0, 2);
  }, [junctions]);

  const showFeatured = view === 'explore' && category === 'all' && !search && !onlineOnly;
  const cityRooms = filtered.filter((room) => room.category === 'city' && !(showFeatured && featured.some(({ id }) => id === room.id)));
  const topicRooms = filtered.filter((room) => room.category !== 'city');

  const navigate = (next: CommunityView) => {
    setView(next);
    setQuery('');
    setCategory('all');
    setOnlineOnly(false);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const randomRoom = () => {
    const active = junctions.filter((room) => room.online_count > 0);
    const pool = active.length > 0 ? active : junctions;
    if (pool.length > 0) onJoin(pool[Math.floor(Math.random() * pool.length)].slug);
  };

  const clearFilters = () => {
    setQuery('');
    setCategory('all');
    setOnlineOnly(false);
  };

  const headings = {
    explore: { title: 'Explore', subtitle: 'Join a room to talk, chat, or vibe together. No sign-up needed.' },
    live: { title: 'Live', subtitle: 'Find a conversation happening right now. Drop in and say hello.' },
    friends: { title: 'Friendship', subtitle: 'Meet someone new in a friendship room. A good conversation is a start.' },
    chats: { title: 'Chat', subtitle: 'Choose a room to start chatting. Text and voice, together in one place.' },
  };

  return (
    <div className="community-page">
      <a href="#room-directory" className="skip-link">Skip to rooms</a>
      <CommunityHeader active={view} onNavigate={navigate} onCreate={() => setShowCreate(true)} onProfile={() => setShowProfile(true)} onSearch={() => { searchInput.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }); searchInput.current?.focus({ preventScroll: true }); }} />

      <main className="page-width community-main">
        <section className="community-hero" aria-labelledby="hero-title">
          <div className="hero-copy">
            <p className="hero-eyebrow"><span className="status-dot" /> A little conversation. A real connection.</p>
            <h1 id="hero-title"><span>{headings[view].title}</span> Rooms<span className="hero-period">.</span></h1>
            <p className="hero-subtitle">{headings[view].subtitle}</p>
            <button onClick={randomRoom} disabled={junctions.length === 0} className="button random-room-button"><Shuffle size={18} /> Random Room<ArrowRight size={17} /></button>
            <p className="hero-caption"><Headphones size={14} /> Your next conversation starts here.</p>
          </div>
          <div className="hero-art" aria-hidden="true">
            <div className="headphone-halo" />
            <img src="/images/junction-headphones.png" alt="" width="1254" height="1254" fetchPriority="high" />
            <span className="hero-art-label"><Radio size={14} /> Made for conversation</span>
          </div>
        </section>

        <section id="room-directory" className="directory" aria-label="Room directory">
          <div className="directory-toolbar">
            <div className="search-controls">
              <div className="directory-search">
                <Search size={19} aria-hidden="true" />
                <input ref={searchInput} aria-label="Search rooms or cities" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search rooms or cities..." />
                {query && <button onClick={() => setQuery('')} aria-label="Clear search" className="icon-button"><X size={16} /></button>}
              </div>
              <RoomFilterMenu category={category} onCategory={setCategory} onlineOnly={onlineOnly} onOnlineOnly={setOnlineOnly} />
            </div>
            <div className="directory-stats" aria-live="polite">
              <span><span className="status-dot" /><strong>{totalOnline.toLocaleString()}</strong> online now</span>
              <span className="stat-divider" />
              <span><MessageCircle size={16} /><strong>{junctions.length}</strong> rooms to explore</span>
            </div>
          </div>

          <CategoryNavigation category={category} onCategory={setCategory} />

          {loading ? (
            <div role="status" className="directory-empty"><Headphones size={24} /><p>Finding your next conversation…</p></div>
          ) : loadFailed ? (
            <div className="directory-empty">
              <p role="alert">We couldn’t load the rooms. Please try again.</p>
              <button onClick={retry} className="button button-secondary">Try again</button>
            </div>
          ) : (
            <div className="room-sections">
              {showFeatured && featured.length > 0 && (
                <section aria-labelledby="trending-rooms">
                  <div className="section-heading">
                    <div><p className="section-eyebrow">GOOD CONVERSATIONS START HERE</p><h2 id="trending-rooms">Trending Rooms <span className="section-dot" /></h2></div>
                    <span className="section-note">A few places to begin</span>
                  </div>
                  <div className="featured-room-list">{featured.map((room) => <JunctionCard key={room.id} junction={room} onJoin={onJoin} featured />)}</div>
                </section>
              )}

              {cityRooms.length > 0 && (
                <section aria-labelledby="city-rooms">
                  <div className="section-heading"><h2 id="city-rooms">Around the city</h2><span className="section-note">{cityRooms.length} {cityRooms.length === 1 ? 'room' : 'rooms'}</span></div>
                  <div className="room-grid">{cityRooms.map((room) => <JunctionCard key={room.id} junction={room} onJoin={onJoin} />)}</div>
                </section>
              )}

              {topicRooms.length > 0 && (
                <section aria-labelledby="topic-rooms">
                  <div className="section-heading"><h2 id="topic-rooms">{view === 'friends' ? 'Meet new friends' : 'Find your people'}</h2><span className="section-note">Something in common</span></div>
                  <div className="room-grid">{topicRooms.map((room) => <JunctionCard key={room.id} junction={room} onJoin={onJoin} />)}</div>
                </section>
              )}

              {filtered.length === 0 && (
                <div className="directory-empty">
                  <UsersRound size={28} />
                  <h2>{view === 'live' && !search && category === 'all' && !onlineOnly ? 'It’s quiet right now' : 'No rooms found'}</h2>
                  <p>{view === 'live' ? 'Check back soon, or explore a room and start a conversation.' : 'Try another search or category to find your room.'}</p>
                  <button onClick={() => { clearFilters(); if (view !== 'explore') navigate('explore'); }} className="button button-secondary">Explore all rooms</button>
                </div>
              )}
            </div>
          )}
        </section>

        <footer className="community-footer"><img src="/junction.svg" alt="" width="23" height="23" /><span>A place to talk. A place to belong.</span><span className="footer-note">Junction · Live voice & chat</span></footer>
      </main>

      {showCreate && <CreateJunctionModal onClose={() => setShowCreate(false)} onCreated={(slug) => { setShowCreate(false); onJoin(slug); }} />}
      {showProfile && session && <NicknameModal open session={session} title="Your profile" description="Your name and avatar in the Junction community." confirmLabel="Save profile" onCancel={() => setShowProfile(false)} onConfirm={async (updated) => { await setSession(updated); setShowProfile(false); }} />}
    </div>
  );
}
