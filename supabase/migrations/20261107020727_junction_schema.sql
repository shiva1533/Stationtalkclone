/*
# Junction — Real-time social hangout platform schema

1. New Tables
- `junctions`: Virtual rooms (city-based + categories). Each has name, slug, category, description, image_url, optional city, slow_mode, permanence flag, and creator session.
- `participants`: Live presence per junction. Tracks session id, nickname, avatar, voice state (in_voice, mic_muted, is_speaking, hand_raised), and a heartbeat timestamp used to expire inactive users.
- `messages`: Real-time group chat messages with optional reply_to for threaded replies. Sender nickname/avatar denormalized for fast rendering.
- `reactions`: Emoji reactions on messages, unique per (message, session, emoji).
- `reports`: User moderation reports.
- `blocks`: Per-session block list so a user can hide another user's messages.

2. Security
- This is a NO-AUTH public app (no sign-in). All policies target `anon, authenticated` with `USING (true)` / `WITH CHECK (true)` because data is intentionally public/shared.
- RLS enabled on every table.
- Grants: anon + authenticated get CRUD on junctions, participants, messages, reactions, reports, blocks.

3. Important notes
- Participants expire via heartbeat: the frontend filters by last_heartbeat (only active within 90s).
- Slow mode is enforced client-side (junctions.slow_mode_seconds) — the column is informational for the UI to gate sends.
- Voice signaling happens over Supabase Realtime broadcast channels (no extra table needed).
*/

-- ── junctions ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS junctions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  slug text UNIQUE NOT NULL,
  category text NOT NULL DEFAULT 'city',
  description text NOT NULL DEFAULT '',
  image_url text NOT NULL DEFAULT '',
  city text,
  is_permanent boolean NOT NULL DEFAULT false,
  slow_mode_seconds int NOT NULL DEFAULT 0 CHECK (slow_mode_seconds >= 0),
  creator_session_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE junctions ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON junctions TO anon, authenticated;

DROP POLICY IF EXISTS "pub_select_junctions" ON junctions;
CREATE POLICY "pub_select_junctions" ON junctions FOR SELECT
  TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "pub_insert_junctions" ON junctions;
CREATE POLICY "pub_insert_junctions" ON junctions FOR INSERT
  TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "pub_update_junctions" ON junctions;
CREATE POLICY "pub_update_junctions" ON junctions FOR UPDATE
  TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "pub_delete_junctions" ON junctions;
CREATE POLICY "pub_delete_junctions" ON junctions FOR DELETE
  TO anon, authenticated USING (true);

-- ── participants ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS participants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  junction_id uuid NOT NULL REFERENCES junctions(id) ON DELETE CASCADE,
  session_id text NOT NULL,
  nickname text NOT NULL,
  avatar_emoji text NOT NULL DEFAULT '🐼',
  avatar_color text NOT NULL DEFAULT '#6366f1',
  in_voice boolean NOT NULL DEFAULT false,
  mic_muted boolean NOT NULL DEFAULT true,
  is_speaking boolean NOT NULL DEFAULT false,
  hand_raised boolean NOT NULL DEFAULT false,
  last_heartbeat timestamptz NOT NULL DEFAULT now(),
  joined_at timestamptz NOT NULL DEFAULT now(),
  left_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (junction_id, session_id)
);

ALTER TABLE participants ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON participants TO anon, authenticated;

DROP POLICY IF EXISTS "pub_select_participants" ON participants;
CREATE POLICY "pub_select_participants" ON participants FOR SELECT
  TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "pub_insert_participants" ON participants;
CREATE POLICY "pub_insert_participants" ON participants FOR INSERT
  TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "pub_update_participants" ON participants;
CREATE POLICY "pub_update_participants" ON participants FOR UPDATE
  TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "pub_delete_participants" ON participants;
CREATE POLICY "pub_delete_participants" ON participants FOR DELETE
  TO anon, authenticated USING (true);

CREATE INDEX IF NOT EXISTS idx_participants_junction ON participants(junction_id);
CREATE INDEX IF NOT EXISTS idx_participants_heartbeat ON participants(last_heartbeat);

-- ── messages ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  junction_id uuid NOT NULL REFERENCES junctions(id) ON DELETE CASCADE,
  session_id text NOT NULL,
  nickname text NOT NULL,
  avatar_emoji text NOT NULL DEFAULT '🐼',
  avatar_color text NOT NULL DEFAULT '#6366f1',
  content text NOT NULL CHECK (length(trim(content)) > 0 AND length(content) <= 500),
  reply_to uuid REFERENCES messages(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON messages TO anon, authenticated;

DROP POLICY IF EXISTS "pub_select_messages" ON messages;
CREATE POLICY "pub_select_messages" ON messages FOR SELECT
  TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "pub_insert_messages" ON messages;
CREATE POLICY "pub_insert_messages" ON messages FOR INSERT
  TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "pub_update_messages" ON messages;
CREATE POLICY "pub_update_messages" ON messages FOR UPDATE
  TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "pub_delete_messages" ON messages;
CREATE POLICY "pub_delete_messages" ON messages FOR DELETE
  TO anon, authenticated USING (true);

CREATE INDEX IF NOT EXISTS idx_messages_junction_created ON messages(junction_id, created_at DESC);

-- ── reactions ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS reactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id uuid NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  junction_id uuid NOT NULL REFERENCES junctions(id) ON DELETE CASCADE,
  session_id text NOT NULL,
  emoji text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (message_id, session_id, emoji)
);

ALTER TABLE reactions ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON reactions TO anon, authenticated;

DROP POLICY IF EXISTS "pub_select_reactions" ON reactions;
CREATE POLICY "pub_select_reactions" ON reactions FOR SELECT
  TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "pub_insert_reactions" ON reactions;
CREATE POLICY "pub_insert_reactions" ON reactions FOR INSERT
  TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "pub_delete_reactions" ON reactions;
CREATE POLICY "pub_delete_reactions" ON reactions FOR DELETE
  TO anon, authenticated USING (true);

CREATE INDEX IF NOT EXISTS idx_reactions_message ON reactions(message_id);

-- ── reports ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  junction_id uuid NOT NULL REFERENCES junctions(id) ON DELETE CASCADE,
  reporter_session_id text NOT NULL,
  reported_session_id text NOT NULL,
  reported_nickname text NOT NULL DEFAULT '',
  reason text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE reports ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT ON reports TO anon, authenticated;

DROP POLICY IF EXISTS "pub_select_reports" ON reports;
CREATE POLICY "pub_select_reports" ON reports FOR SELECT
  TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "pub_insert_reports" ON reports;
CREATE POLICY "pub_insert_reports" ON reports FOR INSERT
  TO anon, authenticated WITH CHECK (true);

-- ── blocks ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS blocks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  blocker_session_id text NOT NULL,
  blocked_session_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (blocker_session_id, blocked_session_id)
);

ALTER TABLE blocks ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, DELETE ON blocks TO anon, authenticated;

DROP POLICY IF EXISTS "pub_select_blocks" ON blocks;
CREATE POLICY "pub_select_blocks" ON blocks FOR SELECT
  TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "pub_insert_blocks" ON blocks;
CREATE POLICY "pub_insert_blocks" ON blocks FOR INSERT
  TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "pub_delete_blocks" ON blocks;
CREATE POLICY "pub_delete_blocks" ON blocks FOR DELETE
  TO anon, authenticated USING (true);

-- ── Enable realtime on all tables ──────────────────────────
ALTER PUBLICATION supabase_realtime ADD TABLE junctions;
ALTER PUBLICATION supabase_realtime ADD TABLE participants;
ALTER PUBLICATION supabase_realtime ADD TABLE messages;
ALTER PUBLICATION supabase_realtime ADD TABLE reactions;

-- ── Seed permanent city junctions ──────────────────────────
INSERT INTO junctions (name, slug, category, description, image_url, city, is_permanent) VALUES
('Hyderabad Junction', 'hyderabad', 'city', 'Meet people from the City of Pearls. Talk, chat, and make new friends.', 'https://images.pexels.com/photos/12966707/pexels-photo-12966707.jpeg?auto=compress&cs=tinysrgb&h=650&w=940', 'Hyderabad', true),
('Bangalore Junction', 'bangalore', 'city', 'India''s tech capital. Connect with developers, dreamers, and night owls.', 'https://images.pexels.com/photos/14845309/pexels-photo-14845309.jpeg?auto=compress&cs=tinysrgb&h=650&w=940', 'Bangalore', true),
('Chennai Junction', 'chennai', 'city', 'Where culture meets conversation. Join the Chennai crowd.', 'https://images.pexels.com/photos/6667281/pexels-photo-6667281.jpeg?auto=compress&cs=tinysrgb&h=650&w=940', 'Chennai', true),
('Mumbai Junction', 'mumbai', 'city', 'The city of dreams. Fast chat, faster people.', 'https://images.pexels.com/photos/6522109/pexels-photo-6522109.jpeg?auto=compress&cs=tinysrgb&h=650&w=940', 'Mumbai', true),
('Delhi Junction', 'delhi', 'city', 'Dilli hai dil. Join the loudest Junction on the platform.', 'https://images.pexels.com/photos/19883648/pexels-photo-19883648.jpeg?auto=compress&cs=tinysrgb&h=650&w=940', 'Delhi', true),
('Kolkata Junction', 'kolkata', 'city', 'Adda, art, and music. The cultural Junction.', 'https://images.pexels.com/photos/21577610/pexels-photo-21577610.jpeg?auto=compress&cs=tinysrgb&h=650&w=940', 'Kolkata', true),
('Pune Junction', 'pune', 'city', 'Hills, startups, and students. Say hi to Pune.', 'https://images.pexels.com/photos/7823001/pexels-photo-7823001.jpeg?auto=compress&cs=tinysrgb&h=650&w=940', 'Pune', true),
('Vizag Junction', 'vizag', 'city', 'Beach vibes and sea breeze. The coastal Junction.', 'https://images.pexels.com/photos/5667923/pexels-photo-5667923.jpeg?auto=compress&cs=tinysrgb&h=650&w=940', 'Visakhapatnam', true)
ON CONFLICT (slug) DO NOTHING;

-- Seed category junctions
INSERT INTO junctions (name, slug, category, description, image_url, is_permanent) VALUES
('Lo-Fi Lounge', 'lofi-lounge', 'music', 'Chill beats, shared listening. Vibe with strangers.', '', true),
('Gamer Arena', 'gamer-arena', 'gaming', 'Find your squad. Talk shop, plan raids, or just hang.', '', true),
('Study Hall', 'study-hall', 'study', 'Pomodoro together. Quiet focus with occasional chat.', '', true),
('Tech Talk', 'tech-talk', 'technology', 'Builders, hackers, and curious minds. Discuss the future.', '', true),
('New Friends', 'new-friends', 'friendship', 'Just here to meet someone new. No agenda.', '', true),
('Language Exchange', 'language-exchange', 'language', 'Practice languages with native speakers worldwide.', '', true),
('Random Talk', 'random-talk', 'random', 'No topic, no plan. Pure random conversation.', '', true)
ON CONFLICT (slug) DO NOTHING;
