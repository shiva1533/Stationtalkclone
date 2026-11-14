# Identity and blocking migration: ready for review, not applied

Target existing project: `tecubhwgqxvkyqaqnxfd`. No hosted project was created,
no Auth settings were changed, and no production SQL/migration was executed.
The frontend continues to use the existing publishable key. A service-role key
is neither needed nor requested.

## Inspection and compatibility

The original repository schema has `junctions`, `participants`, `messages`,
`reactions`, `reports`, and `blocks`, with public, unconditional access policies.
Its identity was a claimed browser `session_id`; there was no database profile
table in those migrations. The application now uses Supabase Auth, an owner-only
`junction_profiles` record, private realtime channels, and separate per-tab leases.

Read-only API checks on 2026-11-12 returned: Auth settings reachable, new signups
allowed, no exposed `profiles` or `junction_profiles` table (`PGRST205`). Anonymous
provider status is not exposed by that settings response. The public key could
not retrieve the complete API schema. These checks do not prove there are no
custom/private tables, policies, triggers, or schema drift.

Run `supabase/review/identity_preflight.sql` in the existing project's SQL Editor
for an owner-level, read-only review. It selects schema metadata, estimated row
counts, policies, grants, constraints, and publication configuration; no personal
records or chat contents. Review the output before approving deployment.
If a separate public table whose name contains `profile` already exists,
the migration aborts rather than creating a second store. Map that store explicitly
before proceeding. An existing compatible `junction_profiles` store is reused.
Unexpected columns/types, duplicate verified blocks, or conflicting policies can
abort the transaction; nothing is silently deleted or repaired.

## Database changes

Migration: `supabase/migrations/20261112090000_verified_sessions_and_blocks.sql`.
This was the unapplied draft from the reliability sprint; the two earlier migration
files are unchanged. If this version has already been applied elsewhere, do not
edit its recorded history: prepare a subsequent migration for that deployment.

| Area | Change |
| --- | --- |
| Profiles | `junction_profiles.user_id` is the primary key and references `auth.users.id`. Owner-only SELECT/INSERT/UPDATE. Display names are trimmed, 2–24 characters, with no control characters; avatars are validated. |
| Membership | Nullable verified `user_id`, independent `connection_id` and connection status on existing participants. Join/heartbeat/leave RPCs use `auth.uid()` and exact leases. Direct transport-identity writes are revoked; owners see their history, other users see only live membership. |
| Authorship | Nullable Auth foreign keys added to existing messages, reactions, reports, and room creators. New message authorship/name/avatar are stamped from the authenticated caller's profile, regardless of submitted values. |
| Blocks | Existing `blocks` reused. Add `blocker_user_id`, `blocked_user_id`, a unique pair index, target index, and self-block/pair consistency checks. Only the blocker can read/remove its records. Block creation resolves verified membership in a currently accessible room and rejects ambiguous tab/account mappings. Departed chat authors remain blockable. |
| RLS | Replace the original public policies with authenticated access and restrictive ownership/blocking policies. Extra permissive message/profile policies cannot bypass these restrictive checks. Unauthenticated callers lose chat/moderation write access. |
| Realtime | Authorize private room/voice/typing/reaction channels for room members, and own block channels. Publish block changes so other tabs refresh. Postgres message INSERT delivery uses each recipient's SELECT RLS. |
| Retention | Retire automatic empty-room message deletion. The legacy purge RPC becomes an authenticated no-op. Join, leave and block do not delete history. |

Indexes cover verified owners/foreign keys, block lookup, and active room ownership.
Check constraints use `NOT VALID` where preserving existing rows is necessary:
they enforce new writes/edits immediately, without rewriting old rows. Existing
Auth references on historical content use PostgreSQL's default NO ACTION deletion
behavior; deleting Auth users must be reviewed rather than cascading away chat.
New profile foreign keys cascade only when their Auth account is deleted
administratively; existing equivalent FK deletion behavior is retained.
Application roles cannot truncate tables, install triggers, or cascade-delete
rooms through a direct DELETE. Security-definer functions use an empty search
path, and client heartbeat timestamps are replaced with the server time.

The migration is transactional and has a 5-second lock timeout and 120-second
statement timeout. Large production tables may require a separately reviewed
concurrent-index rollout rather than increasing timeouts blindly. No data-reset,
TRUNCATE, table drop, or data deletion statement is run by this new migration.

## Blocking semantics in this application

Junction has shared-room chat, not a direct-message/recipient table. When A blocks B:

- B may still post shared-room chat for C and other unblocked members.
- A cannot SELECT B's historical/new verified messages or message reactions through
  REST/SQL as the authenticated application role. Postgres Changes uses the same
  SELECT policy to prevent delivering those new message contents to A.
- B cannot send a directed reply to A's messages or react to A's messages. RLS
  checks blocks in either direction for those interactions, including direct API
  calls. Forging an author's ID or reusing another tab's membership is rejected.
- Client filtering additionally removes cached messages/popups, replies, typing
  previews and reactions immediately; it is not the authorization boundary.
- The blocker cannot be forged and another user cannot remove the block.

Broadcast presence/voice channels remain shared room infrastructure. Database RLS
does not authenticate arbitrary sender fields inside broadcast payloads. Chat
contents must continue to use database INSERTs, not a parallel broadcast chat path.
Any future DMs, invites, or recipient-specific tables need their own block-aware
INSERT and SELECT policies before being exposed.

## Preserving legacy data and identity

No old profiles, messages, reactions, reports, blocks, memberships or rooms are
deleted or overwritten. Added Auth IDs remain NULL for unverified historical rows;
defaults are installed only after column creation so an applying administrator
does not become the author of old messages.

Old public browser IDs cannot prove account ownership. Unverified historical
messages remain in the database but are excluded from verified chat delivery;
legacy unowned blocks remain stored but cannot be safely reassigned. Users must
block verified accounts again. Keep the archive intact; any later attribution
requires a separately reviewed, trusted mapping, never a browser-provided claim.
Existing local names/avatars are carried forward into the user's new verified
profile after Auth initialization. Existing signed-in accounts retain their UID.

Supabase persists/refreshes the guest Auth session in browser storage. The same
browser profile retains its UID across refreshes and rooms; each document/tab has
a separate presence ID. Clearing storage, signing out, or using another device
creates another guest identity. Anonymous users cannot recover an account across
devices without linking a permanent sign-in method. Blocking protects account IDs;
it cannot identify a person who deliberately creates a completely new account.

## Dashboard settings for the existing project

1. **Authentication → Sign In / Providers:** enable **Allow anonymous sign-ins**
   and allow new signups. The screenshot's disabled-provider error is resolved by
   this setting; it cannot be fixed by a database migration. Keep existing account
   providers/settings intact.
2. **Authentication → URL Configuration:** use the real deployed Junction origin
   as Site URL; retain necessary existing redirect URLs and add the local Vite
   origin for development when needed. Guest sign-in itself requires no redirect.
3. **Authentication → Rate Limits:** review anonymous sign-in limits for expected
   traffic. Supabase recommends CAPTCHA for production anonymous signup abuse
   prevention. This frontend does not yet collect a CAPTCHA token: do not enable
   mandatory CAPTCHA until that verification UI/token integration is implemented.
   If CAPTCHA is already enforced, integrate it before approving this release.
4. **Realtime:** enable/confirm Postgres Changes publication for `junctions`,
   `participants`, `messages`, `reactions`, and `blocks`. Existing publication
   entries are retained and the migration adds blocks. After upgraded clients are
   deployed, disable public Broadcast/Presence channel access. Room channels use
   private authorization policies installed by this migration.
5. **Database backups:** confirm a recoverable backup/PITR checkpoint before the
   approved deployment. Do not enable automatic anonymous-account cleanup that
   deletes still-used accounts; retained history has Auth foreign keys.

Local `supabase/config.toml` enables anonymous signup only for local development
and disables extra seed files. It does not update any dashboard setting. Do not
push that local configuration wholesale to production.

References: [Anonymous Auth](https://supabase.com/docs/guides/auth/auth-anonymous),
[Realtime Postgres Changes/RLS](https://supabase.com/docs/guides/realtime/postgres-changes),
[Realtime authorization](https://supabase.com/docs/guides/realtime/authorization).

## Exact review commands — no migration application

CLI `3.1.0` and the flags below were verified using its version/help commands.
Run login on your own terminal through the normal Supabase CLI flow; keep any
CLI access token or prompted database password there. Never paste them into chat,
source files, Vite variables, or command-line arguments.

```powershell
Set-Location C:\Users\balne\shivashankar\Stationtalkclone
npx --yes supabase@3.1.0 login
npx --yes supabase@3.1.0 link --project-ref tecubhwgqxvkyqaqnxfd
npx --yes supabase@3.1.0 migration list --remote
npx --yes supabase@3.1.0 db dump --remote --schema public --file supabase/.temp/identity-review-schema.sql
npx --yes supabase@3.1.0 db push --remote --dry-run --skip-vault
```

The dump is schema-only and stored in an ignored directory; it is not a data backup.
The dry run lists pending migrations, not a full simulation of SQL/RLS correctness.
Check its Target line identifies the intended existing project. Confirm versions
`20261107020727` and `20261111014820` are already recorded remotely and only
`20261112090000` is pending. If migration history differs, stop and reconcile it
with the owner-level preflight; do not use include-all, automatic history repair,
or reapply the original bootstrap migration to an existing populated database.

These remote review commands were prepared, not executed. Only API metadata GETs
were made against production during this work. SQL compatibility was tested in
an isolated local PostgreSQL/PGlite database.

## Apply command — only after your explicit review and approval

After reviewing the migration, preflight/schema dump, backup and staging results:

```powershell
Set-Location C:\Users\balne\shivashankar\Stationtalkclone
npx --yes supabase@3.1.0 db push --remote --skip-vault
npx --yes supabase@3.1.0 migration list --remote
```

No apply command has been run. The CLI should show the target and request hosted
change confirmation. Do not pass an automatic confirmation flag. Coordinate the
frontend release with the authorization migration: old public-write clients will
be denied after migration, and new clients require the migration plus anonymous
Auth enabled. Keep the release in maintenance/staging until both are ready.
If application checks fail, stop the rollout and prepare a forward correction;
do not restore insecure public policies or delete the retained data.

## Verification

```powershell
npm run typecheck
npm run build
npm run lint
npm run test:reliability
```

Local coverage includes migration of populated legacy tables and an existing
profile, data-preserving join/leave, rejection of duplicate profile stores,
owner-only profiles, forged authorship/lease rejection, blocked direct replies
and reactions, recipient-specific SELECT policies, queued-popup filtering, guest
name persistence and separate-tab identities. Chrome sessions use real WebRTC
with simulated microphones; a local Supabase-protocol adapter exercises the SQL.
No test rows are sent to production. A final two-session test against deployed
Supabase Realtime remains necessary after approved staging/production rollout.
