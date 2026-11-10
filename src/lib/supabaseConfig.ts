const url = import.meta.env.VITE_SUPABASE_URL?.trim();
const key = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim();

export const supabaseConfig = getSupabaseConfig();

function getSupabaseConfig() {
  if (!url || !key || !/^https?:\/\//i.test(url)) return null;

  try {
    return { url: new URL(url).href, key };
  } catch {
    return null;
  }
}
