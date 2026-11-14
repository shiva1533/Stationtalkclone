# Pending identity migration: production-safety audit

Reviewed 2026-11-14. **Local review and isolated tests only. No Supabase Cloud SQL,
migration, Auth setting, or application data was changed.**

Follow-up: a subsequent [read-only production preflight](supabase-production-preflight.md)
compared the actual schema with the repository baseline. No migration was applied.
The original audit and its local-test limitations below remain recorded as such.

Verdict: the revised draft passes the local SQL, preservation, authorization and
browser checks. Production deployment remains conditional on the owner-level
schema/preflight review and coordinated release described below. This is not an
approval to apply the migration.

## Full change set for this audit

- [Complete before/after SQL patch](verified-sessions-production-safety.patch).
- `supabase/migrations/20261112090000_verified_sessions_and_blocks.sql`: the
  authorization, defaults, guards and retention protections described below.
- `supabase/review/identity_preflight.sql`: expanded read-only inventory of role
  attributes/inheritance, PUBLIC and column grants, triggers, all public functions
  and views. The report itself was exercised only in the isolated database.
- `tests/reliability/production-safety.mjs`: new regression tests reproducing
  hosted default privileges, permissive policy drift, disabled RLS, tab spoofing,
  clock forgery, broken defaults, incompatible indexes/profile keys and inherited
  destructive privileges.
- `tests/reliability/run.mjs`: includes the new production-safety tests.
- `docs/identity-and-blocking-migration.md`: updated membership visibility, target
  resolution, privilege restrictions and existing-FK behavior.
- This audit report and its SQL patch.

The earlier `20261107020727_junction_schema.sql` and
`20261111014820_purge_empty_junction_chat.sql` files were not edited. Frontend
source files were inspected but not modified during this audit. Existing pending
frontend changes from the earlier sprint are outside this audit's SQL diff.

## Findings fixed in the pending SQL

| Finding | Correction and evidence |
| --- | --- |
| **High: default/PUBLIC grants could leave destructive privileges.** RLS does not protect TRUNCATE, and granting only SELECT/INSERT/UPDATE does not remove wider existing grants. | Reset table privileges for PUBLIC, anon and authenticated; explicitly grant only needed operations. Tests reproduce broad default grants and verify TRUNCATE/TRIGGER/REFERENCES are absent. Unexpected effective destructive privileges inherited through other roles abort deployment. |
| **High: a public tab ID could redirect a block to another account.** The old target lookup picked the newest membership anywhere. | Resolve verified membership only in a room the blocker currently occupies. Reject multiple candidate accounts. A different-room tab-name collision cannot redirect a block, and departed authors remain blockable from history. |
| **High: permissive Realtime policy drift could override channel restrictions.** PostgreSQL ORs permissive policies. | Add restrictive read/write guards for Junction namespaces, reject malformed topic suffixes and retain unrelated services' namespaces. Tests add an open policy and still deny outsiders/unauthenticated clients and another user's block channel. |
| **High: drifted/disabled RLS was assumed safe.** | Explicitly enable RLS on all application tables. Reject application roles with superuser/BYPASSRLS attributes. Tests deliberately disable message RLS before migration and confirm cross-room reads remain denied. |
| **Medium: departed membership metadata was globally readable by every signed-in guest.** | Owners may read their own membership history; other users see only active, recent memberships. The directory and room participant UI retain their existing active-data contracts. |
| **Medium: client timestamps could keep stale participants alive or backdate/future-date messages.** | Stamp direct participant updates with server time and the caller's verified profile; stamp new message creation time. Membership RPCs retain ownership of connection/lease state. |
| **Medium: direct room deletion could cascade into other authors' chat history.** | Revoke application DELETE on rooms and deny it with restrictive RLS. The current frontend has no room-delete call. Creating/editing an owned room remains supported and tested. Any future room-deletion feature needs a separate retention-aware design. |
| **Medium: security-definer lookup paths should be pinned.** | All pending migration functions now use an empty search path and schema-qualified application relations. Trigger functions are not directly executable by application roles. The channel authorization helper is callable by anon for policy evaluation, but returns false without an authenticated UID. |
| **Medium: avatar literals can be damaged by non-UTF-8 editing/copying.** | Use ASCII SQL Unicode escape `U&'\+01F43C'` for the panda default in profiles, participants and messages; require a UTF8 database. Tests evaluate all three defaults and verify the exact U+1F43C value. No historical avatar column is updated. |
| **Medium: IF NOT EXISTS could mask incompatible profile/index drift.** | Require `junction_profiles.user_id` as the existing profile primary key; verify a valid, immediate, non-partial unique block-pair index usable by ON CONFLICT. Equivalent existing Auth foreign keys are reused without duplicates. |
| **Operational: repeated/manual execution could collide with already installed objects.** | Fail early when principal migration policies/check constraints already exist, with a migration-history review error. This remains a one-time, versioned migration, not an idempotent SQL installer. |
| **Operational: broad policy-name deletion could remove unrelated policies.** | Remove only the exact original `pub_select/insert/update/delete_<table>` policy names, rather than a wildcard. Other permissive policies remain subject to the restrictive application guards. |
| **Operational: a publication check could match a different schema's blocks table.** | Check both `schemaname='public'` and `tablename='blocks'`. Missing required Supabase Auth/Realtime objects or publication cause an early failure. |

Membership INSERT/DELETE and block INSERT/UPDATE are RPC-only, enforced by both
privileges and restrictive RLS. Message/reaction updates and report edits/deletion
are denied. Profile deletion through the application is denied. Profile, block
and report reads remain owner-only even with extra permissive policies.

## Schema and reference review

| Relation | References verified against the earlier schema and isolated migration chain |
| --- | --- |
| `public.junctions` | Original room fields/ID plus nullable `creator_user_id`; existing create-room inserts receive ownership from `auth.uid()`. |
| `public.participants` | Original room/session/profile/audio/heartbeat/left fields plus nullable `user_id`, UUID `connection_id`, and text `connection_state`. RPC argument names match `useJunctionRoom`. |
| `public.messages` | Existing room/session/name/avatar/content/reply/timestamp fields plus nullable `user_id`; reply lookup uses the same room and visible parent message. |
| `public.reactions` | Existing message/room/session/emoji fields plus nullable `user_id`; INSERT requires a visible same-room message and block-aware directed-interaction authorization. |
| `public.reports` | Existing reporter/session/room fields plus `reporter_user_id`; only the verified author can insert/read the report. |
| `public.blocks` | Existing session columns retained; verified Auth-ID pair added with unique index and consistency checks. The block RPC signature remains `target_session`. |
| `public.junction_profiles` | Auth UID primary key, display name, avatar and updated timestamp match `identity.ts` upsert/read behavior. Existing incompatible profile stores abort rather than being duplicated. |
| `auth.users` | Referenced by verified user IDs; no Auth row is created, modified, reassigned or deleted by this migration. |
| `realtime.messages` / `realtime.topic()` | Private channel policy entry points; runtime authorization remains subject to Supabase's managed Realtime behavior. |
| `supabase_realtime` | Existing publication retained and public blocks added when absent. |

The SQL chain parsed and executed in PostgreSQL/PGlite. Function paths, foreign
keys, check constraints, profile upserts, create-room ownership, message stamps,
replies, reactions, reports, block RPCs, lease transitions and channel guards were
exercised. No duplicate equivalent foreign keys were created. Deliberately
colliding migration objects, incompatible indexes and incompatible profile primary
keys fail closed instead of deleting/replacing existing data.

## Data preservation and frontend compatibility

The revised migration has no data DELETE, UPDATE, TRUNCATE, DROP TABLE or DROP
SCHEMA operation. UPDATE/INSERT statements inside function/trigger definitions
execute only for subsequent application requests. Existing records were compared
field-for-field before/after migration, including profiles, rooms, memberships,
messages, reactions, reports and blocks.

- Historical Auth-ID columns remain NULL when ownership was never verified.
  Defaults are installed after adding columns; the migration caller never becomes
  the author of old content.
- The original empty-room purge RPC becomes an authenticated no-op. Join/leave
  and blocking preserve messages and reactions.
- No blanket encoding repair or ownership backfill is attempted. The local SQL
  source was valid UTF-8; the new escape notation prevents future default encoding
  damage. Previously corrupted stored avatars, if any, require an explicit,
  reviewed repair rather than guessing their intended value.
- Guest Auth persists/refreshes its existing Supabase session, and profile storage
  uses the verified Auth UID. The display-name flow remains first-setup only.
- No frontend RPC signature or table/column contract changed in this audit.
  Directory reads, profile edits, creating/updating owned rooms, room joining,
  messages, replies, reactions, reports and blocking are compatible with the
  revised permissions. Direct room deletion is intentionally disabled.

## Validation results

Passed locally:

```text
npm run typecheck
npm run build
npm run lint                 # 0 errors; 3 existing Fast Refresh warnings
npm run test:reliability
node tests/reliability/production-safety.mjs
node tests/reliability/migration-compatibility.mjs
git diff --check
```

Browser regressions use two separate Chrome Auth contexts, additional tabs, actual
WebRTC with simulated microphones, PostgreSQL/PGlite, and a local Supabase-protocol
adapter. They cover guest setup/persistence, chat, server-filtered blocks,
queued-popup suppression, crying emojis, independent tab membership, audio
listening/publishing, minimizing/restoring calls, reconnects and cleanup. No test
rows or SQL were sent to production. Real Supabase Auth/Realtime integration and
physical mobile tests are not implied by the local adapter results.

## Remaining production risks and required review

1. **Live schema and migration history are not certified.** No owner-level Cloud
   catalog inspection or migration was executed during this audit. Run the prepared
   read-only preflight, compare the real schema and migration list, and review any
   custom functions, owner-rights views, triggers or inherited roles. Unknown
   privileged RPC/view paths could bypass RLS; this draft cannot certify objects
   absent from the repository. Do not reapply this version if already recorded.
2. **Legacy identity cannot be safely inferred.** Unverified history remains stored
   but is excluded from verified delivery. Legacy unowned blocks remain stored
   and must be recreated against verified accounts. A separate trusted mapping is
   needed for any later attribution. This migration does not recover chat already
   deleted by the old purge feature.
3. **Existing invalid rows are retained.** NOT VALID checks protect new writes,
   but do not certify all historical names, avatars or Auth references. Editing an
   invalid historical profile may fail validation until it is explicitly corrected.
   Duplicate verified block pairs or type/constraint drift can abort deployment.
4. **Release ordering matters.** Enable anonymous sign-ins manually in the existing
   Supabase project and coordinate the frontend/RLS release. Old public-write clients
   are incompatible after cutover. Use maintenance/staging, take a recoverable
   backup, and retire old clients/RPC callers before deployment; an already-running
   old purge request is not undone by redefining the function.
5. **Locking and load need real sizing.** ALTER TABLE and ordinary CREATE INDEX
   take locks; the transaction holds locks until commit. A 5-second lock timeout
   and 120-second per-statement timeout limit individual waits/work, not the total
   transaction duration. Large deployments may need separately reviewed concurrent
   index migrations. RLS query plans and sustained traffic need staging/load tests.
6. **Realtime limits remain.** Disable public Broadcast/Presence access manually
   after upgrading clients; public channels bypass private-channel checks. Private
   authorization is cached for a connection, so a malicious client retaining a
   socket may not be revoked immediately on room departure. Shared voice/typing/
   reaction payload fields are not authenticated authorship; never send chat text
   through an alternate broadcast path. Message INSERT contents remain protected
   by database SELECT RLS. Realtime DELETE events can expose primary-key metadata
   and should never generate message alerts/previews.
7. **Anonymous identity is account-scoped.** Clearing storage/new browsers creates
   another guest UID; blocks cannot identify a person deliberately making new
   accounts. Configure signup rate limits and plan CAPTCHA token integration before
   enabling mandatory CAPTCHA. Posting/moderation quotas and abuse controls require
   a separate product-level review; RLS alone is not rate limiting.
8. **Managed integration still needs acceptance testing.** After approval and staging
   rollout, verify real anonymous Auth, private Realtime policies, message delivery
   with two users, and production network/audio behavior. No production-safety
   audit of a pending migration can substitute for that test.

References: [Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security),
[function security](https://supabase.com/docs/guides/database/functions),
[Realtime authorization/cache](https://supabase.com/docs/guides/realtime/authorization),
[Postgres Changes limitations](https://supabase.com/docs/guides/realtime/postgres-changes),
[PostgreSQL REVOKE](https://www.postgresql.org/docs/17/sql-revoke.html).
