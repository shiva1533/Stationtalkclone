import assert from 'node:assert/strict';
import { createTestDatabase } from './database.mjs';

export async function testMigrationCompatibility() {
  const snapshots = new Map();
  const owner = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
  let room;
  const { db, asUser } = await createTestDatabase({ beforeIdentityMigration: async (database) => {
    room = (await database.query('select id from junctions order by slug limit 1')).rows[0].id;
    await database.query('insert into auth.users values ($1)', [owner]);
    await database.exec(`create table junction_profiles (
      user_id uuid primary key references auth.users(id), display_name text not null,
      avatar_emoji text not null, avatar_color text not null, updated_at timestamptz not null
    )`);
    await database.query("insert into junction_profiles values ($1,'Existing Owner','🐼','#7029D9','2026-01-01Z')", [owner]);
    await database.query("insert into participants(junction_id,session_id,nickname,last_heartbeat) values ($1,'legacy-tab','Original guest','2020-01-01Z')", [room]);
    const message = (await database.query("insert into messages(junction_id,session_id,nickname,content) values ($1,'legacy-tab','Original guest','Keep this original history') returning id", [room])).rows[0].id;
    await database.query("insert into reactions(junction_id,message_id,session_id,emoji) values ($1,$2,'legacy-tab','😢')", [room, message]);
    await database.query("insert into reports(junction_id,reporter_session_id,reported_session_id,reason) values ($1,'legacy-tab','other-tab','Preserve report')", [room]);
    await database.exec("insert into blocks(blocker_session_id,blocked_session_id) values ('legacy-tab','other-tab')");
    for (const table of ['junctions','junction_profiles','participants','messages','reactions','reports','blocks']) {
      snapshots.set(table, (await database.query(`select * from ${table} order by 1`)).rows);
    }
    // Even a migration caller with a UID must not acquire historical authorship.
    await database.query("select set_config('request.jwt.claim.sub',$1,false)", [owner]);
  } });
  try {
    for (const [table, before] of snapshots) {
      const columns = Object.keys(before[0]).map((name) => '"' + name + '"').join(',');
      assert.deepEqual((await db.query(`select ${columns} from ${table} order by 1`)).rows, before, table + ' original values must survive migration');
    }
    for (const [table, column] of [['participants','user_id'],['messages','user_id'],['reactions','user_id'],['reports','reporter_user_id'],['blocks','blocker_user_id']]) {
      assert.equal((await db.query(`select count(*)::int as count from ${table} where ${column} is not null`)).rows[0].count, 0);
    }
    await asUser(owner, 'select * from join_junction_session($1,$2,$3)', [room, 'verified-tab', '66666666-6666-4666-8666-666666666666']);
    await asUser(owner, 'select leave_junction_session($1,$2,$3)', [room, 'verified-tab', '66666666-6666-4666-8666-666666666666']);
    await asUser(owner, 'select purge_junction_chat_if_empty($1)', [room]);
    assert.equal((await db.query('select count(*)::int as count from messages')).rows[0].count, 1, 'Join, leave and the legacy purge API must preserve history');
    // Exercise the review report in a transaction that guarantees read-only SQL.
    const { readFile } = await import('node:fs/promises');
    await db.exec(await readFile(new URL('../../supabase/review/identity_preflight.sql', import.meta.url), 'utf8'));
  } finally { await db.close(); }
  await assert.rejects(createTestDatabase({ beforeIdentityMigration: async (database) => {
    await database.exec('create table profiles(id uuid primary key, display_name text)');
  } }), /existing profile table needs an explicit mapping/i);
  console.log('Existing profiles, room membership, legacy messages/reactions/reports/blocks survive; duplicate profile stores are rejected.');
}

if (process.argv[1]?.endsWith('migration-compatibility.mjs')) await testMigrationCompatibility();
