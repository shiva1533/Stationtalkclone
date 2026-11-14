import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { createServer } from 'vite';
import { startTestBackend } from './server.mjs';
import { startBrowser } from './browser.mjs';
import { testSecurity } from './security.mjs';
import { testTurnEndpoint } from './turn.mjs';
import { testIdleListenerDeparture } from './voice-lifecycle.mjs';
import { testMigrationCompatibility } from './migration-compatibility.mjs';
import { testProductionSafety } from './production-safety.mjs';

await testSecurity();
await testMigrationCompatibility();
await testProductionSafety();
await testTurnEndpoint();
await testIdleListenerDeparture();
const backend = await startTestBackend();
process.env.VITE_SUPABASE_URL = backend.origin;
process.env.VITE_SUPABASE_ANON_KEY = 'isolated-test-key';
process.env.VITE_TURN_CREDENTIALS_URL = '';
const app = await createServer({
  plugins: [{ name: 'peer-test-diagnostics', transform(code, id) {
    if (id.replaceAll('\\', '/').endsWith('/src/lib/voice.ts')) return code.replace('this.peers.set(id, peer);', 'Object.assign(pc, { __testRemote: id, __testInstance: instance }); this.peers.set(id, peer);');
  } }],
  server: { host: '127.0.0.1', port: 4180, strictPort: true }, cacheDir: 'node_modules/.vite-reliability',
});
await app.listen();
const chrome = await startBrowser();
const origin = 'http://127.0.0.1:4180';

async function home(page) {
  await page.viewport(1280, 900);
  await page.send('Page.navigate', { url: origin });
  await page.until('document.querySelectorAll("article").length > 0', 20000);
}
async function join(page, room = 'Hyderabad Junction', name) {
  await page.click('Join ' + room);
  if (name) {
    await page.until('document.querySelector("#guest-nickname")');
    await page.input('#guest-nickname', name);
    await page.click('Join room');
  }
  await page.until('document.querySelector(".voice-room h1")?.textContent === ' + JSON.stringify(room), 20000);
  await page.until('document.querySelector(".room-call-options")?.textContent.includes("Connected")', 20000);
}
async function speak(page) {
  await page.click('Join voice');
  await page.click('Unmute');
  await page.until('window.__testStreams.some(stream=>stream.getAudioTracks().some(track=>track.enabled&&track.readyState==="live"))');
}
async function bytes(page) {
  return page.run('(async()=>{let bytes=0;for(const peer of window.__testPeers){if(peer.connectionState!=="connected")continue;for(const stat of(await peer.getStats()).values())if(stat.type==="inbound-rtp"&&stat.kind==="audio")bytes+=stat.bytesReceived||0;}return bytes})()');
}
async function message(page, text) {
  await page.click('Chat');
  await page.input('[aria-label="Chat message"]', text);
  await page.click('Send message');
  await page.until('[...document.querySelectorAll(".chat-message-bubble")].some(e=>e.textContent === ' + JSON.stringify(text) + ')');
}
async function assertReceiving(page) {
  await page.until('window.__testPeers.some(peer=>peer.connectionState==="connected")', 25000);
  const before = await bytes(page);
  await delay(1000);
  assert.ok(await bytes(page) > before, 'Actual inbound WebRTC audio packets must increase');
}

try {
  const a = await chrome.page();
  const b = await chrome.page();
  await home(a);
  await home(b);
  await join(a, 'Hyderabad Junction', 'Alice');
  assert.equal(await a.run('window.__testMicrophoneRequests'), 0);
  await a.click('Back to Explore');
  await a.until('!document.querySelector(".voice-room")');
  assert.equal((await backend.db.query('select * from participants where left_at is null')).rows.length, 0);
  await join(a, 'Bangalore Junction');
  assert.equal(await a.run('Boolean(document.querySelector("#guest-nickname"))'), false);
  const identityA = await a.run('JSON.parse(localStorage.getItem("junction_session")).userId');

  const a2 = await chrome.page(a.contextId);
  await home(a2);
  await join(a2, 'Hyderabad Junction');
  const memberships = (await backend.db.query('select * from participants where user_id=$1 and left_at is null', [identityA])).rows;
  assert.equal(memberships.length, 2);
  assert.notEqual(memberships[0].session_id, memberships[1].session_id);
  await a2.click('Back to Explore');
  await a2.until('!document.querySelector(".voice-room")');
  assert.equal((await backend.db.query('select * from participants where user_id=$1 and left_at is null', [identityA])).rows.length, 1);
  await join(a2, 'Hyderabad Junction');
  await a2.send('Page.navigate', { url: 'about:blank' });
  for (let attempt = 0; attempt < 50; attempt++) {
    if ((await backend.db.query('select * from participants where user_id=$1 and left_at is null', [identityA])).rows.length === 1) break;
    await delay(100);
  }
  assert.equal((await backend.db.query('select * from participants where user_id=$1 and left_at is null', [identityA])).rows.length, 1, 'Closing one document must clear its own membership');
  await a.click('Back to Explore');
  await a.until('!document.querySelector(".voice-room")');
  await join(a);
  await join(b, 'Hyderabad Junction', 'Bob');
  assert.equal(await b.run('window.__testMicrophoneRequests'), 0);
  console.log('First setup, saved profile, no-microphone browsing/exit, and separate-tab memberships passed.');

  await b.run('window.__testBlockPlayback=true');
  await speak(a);
  await assertReceiving(b);
  assert.equal(await b.run('window.__testMicrophoneRequests'), 0);
  await b.until('document.querySelector(".room-audio-notice")');
  await b.run('window.__testBlockPlayback=false');
  await b.click('Enable audio');
  await b.until('!document.querySelector(".room-audio-notice")');
  await speak(b);
  await assertReceiving(a);
  await assertReceiving(b);
  assert.equal(await a.run('document.querySelectorAll("audio").length'), 1);
  assert.equal(await b.run('document.querySelectorAll("audio").length'), 1);
  assert.ok(backend.delivery.earlyCandidates > 0);
  console.log('Receive-only listening, autoplay recovery, delayed SDP/early ICE, and mutual audio passed.');

  await b.run('window.__retainedPeer=window.__testPeers.find(peer=>peer.connectionState==="connected")');
  await b.click('Move to Listening');
  await b.until('window.__testStreams.every(stream=>stream.getTracks().every(track=>track.readyState==="ended"))');
  assert.ok(await b.run('window.__retainedPeer.connectionState==="connected"'));
  await assertReceiving(b);
  await speak(b);
  await a.click('Back to Explore');
  await a.until('document.querySelector(".active-call") && !document.querySelector(".voice-room")');
  await assertReceiving(a);
  await a.click('Return to active room');
  await a.until('document.querySelector(".voice-room")');
  assert.equal(await a.run('window.__testMicrophoneRequests'), 1);
  console.log('Move to Listening releases the microphone and keeps receiving; minimized calls retain audio.');

  await a.click('Chat');
  await a.click('Choose an emoji');
  await a.click('Insert 😭');
  await a.click('Insert 😢');
  await a.click('Choose an emoji');
  await a.click('Send message');
  await a.until('[...document.querySelectorAll(".chat-message-bubble")].some(e=>e.textContent==="😭😢")');
  await b.until('[...document.querySelectorAll(".chat-message-bubble")].some(e=>e.textContent==="😭😢")');
  await a.click('React');
  await a.until(`document.querySelector('[aria-label="React with 😭"]') && document.querySelector('[aria-label="React with 😢"]')`);
  await a.click('React');
  await message(b, 'Before blocking');
  await a.until('document.body.textContent.includes("Before blocking")');
  await a.click('People');
  await a.click('Actions for Bob');
  await a.click('Block');
  await a.until(`document.querySelector('[aria-label="Actions for Bob"]')`);
  await delay(300);
  await message(b, 'Blocked realtime content');
  await delay(600);
  assert.ok(await a.run('!document.body.textContent.includes("Blocked realtime content") && !document.body.textContent.includes("Before blocking")'));
  await a.click('Chat');
  assert.ok(await a.run('!document.body.textContent.includes("Blocked realtime content") && !document.body.textContent.includes("Before blocking")'));
  const bob = [...(await backend.db.query("select * from junction_profiles where display_name='Bob'")).rows][0];
  assert.ok(bob);
  assert.equal((await backend.asUser(identityA, 'select * from messages where user_id=$1', [bob.user_id])).rows.length, 0);
  assert.ok((await backend.db.query('select * from messages where user_id=$1', [bob.user_id])).rows.length >= 2);
  assert.ok(backend.delivery.deniedMessages > 0);
  const blockedRow = (await backend.db.query("select * from messages where content='Blocked realtime content'")).rows[0];
  backend.injectLateMessage(identityA, blockedRow);
  await delay(300);
  assert.ok(await a.run('!document.body.textContent.includes("Blocked realtime content")'), 'Late/duplicate realtime events must also respect the block');

  const b2 = await chrome.page(b.contextId);
  await home(b2);
  await join(b2);
  await message(b2, 'Blocked second tab content');
  const secondBob = (await backend.db.query('select * from participants where user_id=$1 and left_at is null and in_voice=false', [bob.user_id])).rows[0];
  await delay(500);
  assert.ok(await a.run('!document.body.textContent.includes("Blocked second tab content")'));
  await b2.click('Back to Explore');
  await b2.until('!document.querySelector(".voice-room")');
  await a.until('window.__testPeers.filter(peer=>peer.connectionState!=="closed").length===1', 15000);
  backend.injectDepartedSignal(secondBob.session_id);
  await delay(150);
  assert.equal(await a.run('window.__testPeers.filter(peer=>peer.connectionState!=="closed").length'), 1, 'Late ICE must not resurrect a departed tab');
  console.log('Crying emojis, server-filtered blocks across sender tabs, popup suppression, and retained history passed.');

  const connectedBefore = await a.run('window.__testPeers.filter(peer=>peer.connectionState==="connected").length');
  backend.interrupt();
  await a.until('document.querySelector(".room-call-options")?.textContent.includes("Reconnecting")', 5000);
  await a.until('document.querySelector(".room-call-options")?.textContent.includes("Connected")', 25000);
  assert.ok(await a.run('window.__testPeers.filter(peer=>peer.connectionState==="connected").length') >= connectedBefore);
  await assertReceiving(a);
  await a.run('Object.defineProperty(document,"visibilityState",{configurable:true,get:()=>"hidden"});document.dispatchEvent(new Event("visibilitychange"))');
  assert.ok(await a.run('window.__testPeers.some(peer=>peer.connectionState==="connected")'));
  await a.run('Object.defineProperty(document,"visibilityState",{configurable:true,get:()=>"visible"});document.dispatchEvent(new Event("visibilitychange"))');
  console.log('Signaling interruption reconnects; visibility changes do not terminate the call.');

  for (const width of [360,390,414,1280,1440]) {
    await a.viewport(width, width < 768 ? 844 : 1000);
    assert.ok(await a.run('document.documentElement.scrollWidth<=document.documentElement.clientWidth'));
  }
  await a.capture('room-reliability');
  await a.click('Leave voice');
  await a.until('document.querySelector(".room-audio-notice")');
  assert.ok(await a.run('window.__testStreams.every(stream=>stream.getTracks().every(track=>track.readyState==="ended"))'));
  await a.click('Back to Explore');
  await a.until('!document.querySelector(".voice-room")');
  await b.click('Leave voice');
  await b.click('Back to Explore');
  await b.until('!document.querySelector(".voice-room")');
  await delay(300);
  assert.equal((await backend.db.query('select * from participants where left_at is null')).rows.length, 0);
  assert.deepEqual(a.errors, []);
  assert.deepEqual(b.errors, []);
  assert.deepEqual(a2.errors, []);
  assert.deepEqual(b2.errors, []);
  console.log('All isolated browser regressions passed. No test rows were sent to production.');
} finally {
  chrome.close();
  await app.close();
  await backend.close();
}
