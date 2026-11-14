import { PGlite } from '@electric-sql/pglite';
import { readFile, readdir } from 'node:fs/promises';

export async function createTestDatabase({ beforeIdentityMigration } = {}) {
  const db = new PGlite();
  try {
  await db.exec(`
    create role anon;
    create role authenticated;
    create schema auth;
    create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
    $$;
    grant usage on schema auth, public to anon, authenticated;
    grant execute on function auth.uid() to anon, authenticated;
    create schema realtime;
    create table realtime.messages(id uuid primary key default gen_random_uuid(), topic text);
    alter table realtime.messages enable row level security;
    grant usage on schema realtime to anon, authenticated;
    grant select, insert on realtime.messages to authenticated;
    create function realtime.topic() returns text language sql stable as $$
      select current_setting('realtime.topic', true);
    $$;
    create publication supabase_realtime;
  `);
  const directory = new URL('../../supabase/migrations/', import.meta.url);
  for (const file of (await readdir(directory)).filter((name) => name.endsWith('.sql')).sort()) {
    if (file === '20261112090000_verified_sessions_and_blocks.sql') await beforeIdentityMigration?.(db);
    await db.exec(await readFile(new URL(file, directory), 'utf8'));
  }
  async function asUser(userId, query, parameters = []) {
    return db.transaction(async (transaction) => {
      await transaction.exec('set local role ' + (userId ? 'authenticated' : 'anon'));
      await transaction.query("select set_config('request.jwt.claim.sub', $1, true)", [userId ?? '']);
      return transaction.query(query, parameters);
    });
  }
  return { db, asUser };
  } catch (error) {
    await db.close();
    throw error;
  }
}
