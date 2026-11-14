import { createClient } from '@supabase/supabase-js';
import { supabaseConfig } from './supabaseConfig';

if (!supabaseConfig) {
  throw new Error('Supabase requires a valid VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.');
}

export const supabase = createClient(supabaseConfig.url, supabaseConfig.key, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  realtime: { params: { eventsPerSecond: 20 } },
});
