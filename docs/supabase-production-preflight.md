# Production preflight follow-up

2026-11-14 — existing project `tecubhwgqxvkyqaqnxfd`
(`bolt-native-database-72728145`). **No migration or data modification applied.**

The user confirmed the first two migrations are recorded remotely and the dry run
lists only `20261112090000_verified_sessions_and_blocks.sql` as pending.

The CLI's `db query --read-only` mode was used to inspect schema metadata under
`supabase_read_only_user`. The SQL Editor preflight contains transaction wrappers,
which that mode rejects. A local, ignored SELECT-only JSON wrapper was generated
instead; read-only enforcement was retained throughout. No chat/account records
were selected. The raw metadata report is stored locally in ignored `.local` files.

Compared production metadata with the isolated database built from the two
previous repository migrations:

- Column names, data types, defaults and nullability match.
- Primary/unique/foreign-key/check constraints and index definitions match.
- Original public policies match; RLS is enabled on all six application tables.
- The four existing publication entries match; the pending migration adds blocks.
- No conflicting public profile table, public view, trigger or additional public
  function was found. The existing public function is the known empty-room purge.
- `anon` and `authenticated` have no superuser/BYPASSRLS attributes or inherited
  role memberships reported by the inspected catalogs.
- UTF8 encoding, `auth.uid()`, `realtime.topic()` and the RLS-enabled
  `realtime.messages` table are present.

The raw constraint catalogs represent NOT NULL constraints differently from the
local engine. Those entries were compared through column nullability instead;
no material schema difference remains in the inspected objects.

No schema blocker was found in this read-only comparison. This does not verify
recoverable backups, Auth provider settings, active clients, data distribution,
managed Realtime behavior or post-deployment application operation.

Next prerequisites: confirm a recoverable backup, enable anonymous sign-ins in
the existing dashboard, and coordinate a maintenance/staging cutover for the
frontend and authorization policies. Preserve the documented legacy-history
limitations. The migration remains pending until the user's explicit production
approval; the earlier instruction not to apply it has not been revoked.

After approval only, the prepared apply command is:

```powershell
npx supabase db push --remote --skip-vault
```

Then verify migration history and the actual anonymous Auth/chat/blocking flows
with separate sessions. Do not use a reset, force migration-history repair, or
restore the old unconditional public policies.
