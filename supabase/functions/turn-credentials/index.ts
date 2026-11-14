// Deploy with server-side TURN_URLS, TURN_SHARED_SECRET, and APP_ORIGINS.
// No permanent TURN credential is shipped in the Vite bundle.
Deno.serve(async (request: Request) => {
  const origin = request.headers.get('Origin') ?? '';
  const origins = (Deno.env.get('APP_ORIGINS') ?? '').split(',').map((value) => value.trim());
  const headers = {
    'Access-Control-Allow-Origin': origins.includes(origin) ? origin : '',
    'Access-Control-Allow-Headers': 'authorization, content-type',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
    Vary: 'Origin',
  };
  if (request.method === 'OPTIONS') return new Response(null, { status: origins.includes(origin) ? 204 : 403, headers });
  if (request.method !== 'GET' || !origins.includes(origin)) return new Response('{}', { status: 403, headers });
  const urls = (Deno.env.get('TURN_URLS') ?? '').split(',').filter((url) => /^turns?:/i.test(url));
  const secret = Deno.env.get('TURN_SHARED_SECRET');
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const key = Deno.env.get('SUPABASE_ANON_KEY');
  if (!urls.length || !secret || !supabaseUrl || !key) return new Response('{}', { status: 503, headers });
  const authorization = request.headers.get('Authorization') ?? '';
  if (!authorization.startsWith('Bearer ')) return new Response('{}', { status: 401, headers });
  const verified = await fetch(supabaseUrl + '/auth/v1/user', { headers: { Authorization: authorization, apikey: key } });
  if (!verified.ok) return new Response('{}', { status: 401, headers });
  const user = await verified.json();
  const expires = Math.floor(Date.now() / 1000) + 600;
  const username = expires + ':' + user.id;
  const signingKey = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']);
  const signature = await crypto.subtle.sign('HMAC', signingKey, new TextEncoder().encode(username));
  const credential = btoa(String.fromCharCode(...new Uint8Array(signature)));
  return new Response(JSON.stringify({
    iceServers: [{ urls, username, credential }], expiresAt: expires * 1000,
  }), { headers });
});
