// Read-only API metadata inspection. Never signs up users or prints credentials/data.
import { readFile } from 'node:fs/promises';
const env = Object.fromEntries((await readFile(new URL('../.env.local', import.meta.url), 'utf8'))
  .split(/\r?\n/).filter((line) => /^[A-Z_]+=/.test(line)).map((line) => {
    const at = line.indexOf('=');
    return [line.slice(0, at), line.slice(at + 1).trim().replace(/^['"]|['"]$/g, '')];
  }));
const origin = env.VITE_SUPABASE_URL;
const headers = { apikey: env.VITE_SUPABASE_ANON_KEY };
if (!origin || !headers.apikey) throw new Error('Missing public Supabase configuration.');
for (const path of ['/auth/v1/settings', '/rest/v1/']) {
  const response = await fetch(new URL(path, origin), { headers, signal: AbortSignal.timeout(15000) });
  const body = await response.json();
  if (!response.ok) { console.log(JSON.stringify({ path, status: response.status, code: body.code ?? null })); continue; }
  if (path.includes('/auth/')) {
    console.log(JSON.stringify({ path, status: response.status,
      anonymousProvider: body.external?.anonymous ?? body.anonymous_users_enabled ?? 'not exposed',
      signupsDisabled: body.disable_signup ?? 'not exposed' }));
  } else {
    console.log(JSON.stringify({ path, status: response.status, tables: Object.fromEntries(
      Object.entries(body.definitions ?? {}).map(([table, definition]) => [table, Object.keys(definition.properties ?? {})]),
    ) }));
  }
}
for (const table of ['junction_profiles', 'profiles']) {
  const response = await fetch(new URL(`/rest/v1/${table}?select=*&limit=0`, origin), { headers, signal: AbortSignal.timeout(15000) });
  const body = await response.json();
  console.log(JSON.stringify({ table, status: response.status, code: !response.ok ? body.code : undefined }));
}
