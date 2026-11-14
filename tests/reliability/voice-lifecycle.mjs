import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import ts from 'typescript';

export async function testIdleListenerDeparture() {
  const source = (await readFile(new URL('../../src/lib/voice.ts', import.meta.url), 'utf8'))
    .replace(/^import .*;\r?\n/gm, '').replace('export class VoiceManager', 'class VoiceManager');
  const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText.replace(/export \{\};?/, '');
  let presence = {};
  let sync;
  const channel = {
    on(kind, _filter, callback) { if (kind === 'presence') sync = callback; return this; },
    subscribe(callback) { callback('SUBSCRIBED'); },
    track: async () => 'ok', send: async () => 'ok', presenceState: () => presence,
  };
  const events = { addEventListener() {}, removeEventListener() {} };
  const VoiceManager = new Function('supabase', 'getIceConfiguration', 'window', 'document', 'setTimeout', compiled + '\nreturn VoiceManager;')(
    { channel: () => channel, removeChannel: async () => {} },
    async () => ({ iceServers: [], expiresAt: Date.now() + 300000 }), events, events,
    (callback, milliseconds) => setTimeout(callback, milliseconds === 12000 ? 20 : milliseconds),
  );
  const manager = new VoiceManager('room', 'local', {
    onStateChange() {}, onSpeakingChange() {}, onAutoplayBlocked() {}, onError() {},
  });
  try {
    await manager.connect();
    presence = { remote: [{ session_id: 'remote', instance: 'first', publishing: false }] };
    sync();
    presence = {};
    sync();
    await delay(60);
    assert.equal(manager.members.size, 0, 'An idle listener must expire even when it has no audio peer');
    assert.equal(manager.departures.size, 0);
    console.log('Idle-listener departure expires without leaking a future audio peer.');
  } finally { manager.leave(); }
}
