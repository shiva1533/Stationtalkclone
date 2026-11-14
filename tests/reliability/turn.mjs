import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHmac, webcrypto } from 'node:crypto';
import ts from 'typescript';

export async function testTurnEndpoint() {
  const source = await readFile(new URL('../../supabase/functions/turn-credentials/index.ts', import.meta.url), 'utf8');
  const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
  const settings = new Map(Object.entries({
    APP_ORIGINS: 'https://junction.test', SUPABASE_URL: 'https://database.test',
    SUPABASE_ANON_KEY: 'test-public-key', TURN_URLS: 'turn:relay.test:3478,turns:relay.test:5349',
    TURN_SHARED_SECRET: 'server-only-test-secret',
  }));
  let handler;
  const deno = { env: { get: (key) => settings.get(key) }, serve: (callback) => { handler = callback; } };
  const fetchAuth = async (_url, request) => new Response(JSON.stringify({ id: 'verified-user' }), {
    status: request.headers.Authorization === 'Bearer valid-token' ? 200 : 401,
  });
  new Function('Deno', 'crypto', 'fetch', compiled)(deno, webcrypto, fetchAuth);
  const request = (token, origin = 'https://junction.test') => new Request('https://endpoint.test', {
    headers: { Origin: origin, ...(token ? { Authorization: 'Bearer ' + token } : {}) },
  });
  assert.equal((await handler(request(null))).status, 401);
  assert.equal((await handler(request('bad-token'))).status, 401);
  assert.equal((await handler(request('valid-token', 'https://unapproved.test'))).status, 403);
  const response = await handler(request('valid-token'));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  const body = await response.json();
  const relay = body.iceServers[0];
  assert.equal(relay.credential, createHmac('sha1', settings.get('TURN_SHARED_SECRET')).update(relay.username).digest('base64'));
  assert.ok(body.expiresAt > Date.now() && body.expiresAt < Date.now() + 601_000);
  assert.ok(!JSON.stringify(body).includes(settings.get('TURN_SHARED_SECRET')));
  settings.delete('TURN_SHARED_SECRET');
  assert.equal((await handler(request('valid-token'))).status, 503);
  console.log('TURN endpoint rejects unauthenticated/unapproved callers and returns only expiring credentials.');
}
