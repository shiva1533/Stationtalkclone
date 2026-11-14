# Junction reliability changes

## Lifecycle and causes

The existing architecture is a mesh of browser RTCPeerConnections with Supabase
broadcast signaling. There is no SFU. Room data and presence remain in the
existing Supabase database.

| Original cause | Change |
| --- | --- |
| Voice lived in RoomView and closed when that view unmounted | ActiveRoomProvider owns the room lease, audio manager, messages, and notifications. The mini-player survives room-screen navigation. |
| Microphone access was mandatory before signaling | Every room member can connect as a receiver. Capture starts only after Join voice. |
| Leaving the microphone closed every peer | Move to Listening removes outgoing tracks, releases the microphone, and retains incoming audio. Leave voice explicitly closes audio. |
| Early ICE was discarded and offers could collide | Buffered ICE, deterministic polite/impolite negotiation, ICE restarts, and temporary-disconnect grace periods. |
| Late packets could recreate departed peers or overwrite a newer session | Signaling is accepted only for the current presence instance. One peer and one audio element are owned per remote tab. |
| Cached documents could retain voice presence after a full browser navigation | Pagehide releases audio and microphone resources; restoring the cached document reconnects as a listener. Minimizing inside Junction preserves the call. |
| Removing an idle listener's audio peer cancelled its presence expiry | Audio-peer removal and presence expiry now have independent lifecycles. |
| Incoming streams could ignore current output preferences | Audio output and per-person mute settings are applied whenever a track arrives. |
| One local-storage ID represented multiple tabs | Persistent verified user identity is separate from a fresh per-document tab ID. Room leases have independent connection IDs. |
| Async join and cleanup raced during StrictMode/navigation | Membership operations are serialized. Stale cleanup cannot close a replacement lease. Pagehide sends an authenticated keepalive leave request; pageshow renews a restored document. |
| Blocking hid only one chat component | Messages, popups, replies, typing previews, and reactions use the current block filter. PostgreSQL RLS independently prevents delivery from blocked accounts. |
| Public callers could forge a sender ID | Supabase Auth establishes the caller. SQL stamps authorship and requires an owned room session. |
| Saved names were ignored on join | Names persist locally and in an owner-only Junction profile. Permanent Auth accounts also save their display name in existing Auth metadata. |

## Deployment

The local publishable key cannot apply SQL or configure Auth. Release the frontend
and backend authorization changes together.

1. Back up the database and review any additional deployment-specific RLS policies.
   Apply supabase/migrations/20261112090000_verified_sessions_and_blocks.sql after
   the existing migrations.
2. Enable anonymous sign-ins in Supabase Auth for guests. Existing signed-in
   accounts keep their Auth identity. Anonymous Auth users have the authenticated
   database role; they are different from unauthenticated callers.
3. Room broadcasts use private realtime channels. The migration authorizes
   authenticated room members. Disable public channel access in Realtime settings
   after old clients have been retired.
4. Provision a TURN service with TURN REST shared-secret support. Deploy
   supabase/functions/turn-credentials/index.ts. The function validates bearer
   tokens against Supabase Auth itself. If the gateway cannot verify the project's
   signing key, disable gateway JWT verification for this function while retaining
   its own Auth verification.
5. Set server-side function secrets TURN_URLS, TURN_SHARED_SECRET, and comma-separated
   APP_ORIGINS. Supabase supplies SUPABASE_URL and SUPABASE_ANON_KEY in the function.
   Set VITE_TURN_CREDENTIALS_URL to the deployed endpoint and rebuild.
6. Verify anonymous Auth, private realtime channels, the new RLS policies, and TURN
   traversal in staging before production release.

TURN credentials expire after ten minutes and are refreshed before expiry.
Permanent TURN credentials never enter the Vite bundle. With no TURN endpoint,
STUN/direct connections can work, but restrictive networks cannot be guaranteed
to connect.

Legacy public records cannot safely be assigned to an account from a claimed old
local-storage ID. They are retained, but unverified messages are excluded from
new verified delivery. Legacy blocks without a verified owner cannot be securely
claimed; affected users must block those accounts again.

The identity migration now retires automatic empty-room chat deletion to preserve
history, including through the legacy purge RPC. Blocking never deletes a message.
See [the identity migration review and commands](identity-and-blocking-migration.md)
before applying anything to the existing project.

## Reproducible tests

Run npm run test:reliability. Set CHROME_PATH if Chrome is installed outside the
default location. The suite uses PostgreSQL/PGlite and a local HTTP/Phoenix
adapter. It never reads production credentials or writes test rows to production.
Browser audio is actual WebRTC with Chrome's simulated microphone device.

Coverage includes:

- PostgreSQL allow/deny policies, verified authorship, forged-session rejection,
  account-based blocks, and retained message history.
- Separate browser tabs, independent room memberships, stale-lease cleanup,
  document closure, and restored documents.
- Receive-only listeners, permission-free browsing/exit, autoplay recovery,
  bidirectional audio with SDP deliberately delayed behind ICE, and microphone
  release while continuing to listen.
- Minimized-call continuity, speaker output state, blocked typing/popups/replies,
  delayed message packets, and signals from departed tabs.
- Signaling interruption, visibility changes, and final presence/media cleanup.
- TURN endpoint Auth/CORS checks, expiring credentials, and secret non-disclosure.

The adapter exercises the application SQL and its Supabase protocol usage. It
does not replace final integration tests against deployed Supabase Realtime and
an actual TURN provider.

## Mobile and background limits

Hidden visibility does not disconnect a call. Media Session metadata and supported
system controls are registered. Visible/online recovery renews membership,
retries playback, and restarts failed ICE negotiation.

Physical Android Chrome, installed Android PWA, iOS Safari, phone locking,
Bluetooth/audio-focus changes, and restrictive-network TURN traversal still need
device/provider testing. They are not verified by the desktop suite. The existing
app has no installable PWA manifest or service worker.

A web page cannot guarantee background microphone capture or execution when the
OS suspends it. Media Session supplies system media controls, not permission to
bypass suspension. A native calling implementation is needed where guaranteed
locked-screen calling is a product requirement. Wake Lock is not used.

Platform references:

- [Perfect negotiation](https://developer.mozilla.org/en-US/docs/Web/API/WebRTC_API/Perfect_negotiation)
- [Supabase anonymous Auth](https://supabase.com/docs/guides/auth/auth-anonymous)
- [Realtime authorization](https://supabase.com/docs/guides/realtime/authorization)
- [Media Session API](https://developer.mozilla.org/en-US/docs/Web/API/Media_Session_API)
