import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createTestDatabase } from './database.mjs';

export async function testProductionSafety() {
  const { db, asUser } = await createTestDatabase({ beforeIdentityMigration: async (database) => {
    // Reproduce hosted default grants, PUBLIC inheritance, permissive drift and
    // disabled RLS. These must never turn the migration's allow-side into access.
    await database.exec(`
      alter default privileges in schema public grant all on tables to anon, authenticated;
      alter default privileges in schema public grant execute on functions to anon, authenticated;
      grant all on all tables in schema public to public, anon, authenticated;
      create policy legacy_custom_open_blocks on blocks for all to public using (true) with check (true);
      create policy legacy_custom_open_reports on reports for all to public using (true) with check (true);
      create policy legacy_custom_open_realtime on realtime.messages for all to public using (true) with check (true);
      grant select, insert on realtime.messages to anon;
      alter table messages disable row level security;
      alter table participants alter column avatar_emoji set default 'broken-default';
    `);
  } });
  const a = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const b = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  const c = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
  try {
    for (const table of ['junction_profiles','participants','messages']) {
      const expression = (await db.query("select pg_get_expr(d.adbin,d.adrelid) as expression from pg_attrdef d join pg_attribute a on a.attrelid=d.adrelid and a.attnum=d.adnum where d.adrelid=$1::regclass and a.attname='avatar_emoji'", [table])).rows[0].expression;
      assert.equal((await db.query('select ' + expression + ' as avatar')).rows[0].avatar, String.fromCodePoint(0x1f43c));
    }
    for (const user of [a,b,c]) {
      await db.query('insert into auth.users values ($1)', [user]);
      const profile = (await asUser(user, "insert into junction_profiles(user_id,display_name) values ($1,'Audit Guest') returning *", [user])).rows[0];
      assert.equal(profile.avatar_emoji, String.fromCodePoint(0x1f43c));
    }
    for (const table of ['junction_profiles','junctions','participants','messages','reactions','reports','blocks']) {
      for (const role of ['anon','authenticated']) {
        for (const privilege of ['TRUNCATE','TRIGGER','REFERENCES']) {
          assert.equal((await db.query('select has_table_privilege($1,$2,$3) as allowed', [role, table, privilege])).rows[0].allowed, false, role + ' must lack ' + privilege + ' on ' + table);
        }
      }
    }
    await assert.rejects(asUser(a, 'truncate junction_profiles'));
    for (const table of ['junction_profiles','messages','reactions','reports','blocks','participants']) {
      await assert.rejects(asUser(null, 'select * from ' + table));
    }
    assert.ok((await asUser(null, 'select * from junctions')).rows.length > 0);
    const rooms = (await db.query('select id from junctions order by slug limit 2')).rows;
    const createdRoom = (await asUser(a, "insert into junctions(name,slug,creator_session_id) values ('Audit room','audit-room','a') returning *")).rows[0];
    assert.equal(createdRoom.creator_user_id, a, 'Existing create-room inserts must inherit authenticated ownership');
    assert.equal((await asUser(a, "update junctions set description='Updated' where id=$1 returning id", [createdRoom.id])).rows.length, 1);
    assert.equal((await asUser(b, "update junctions set description='Unauthorized' where id=$1 returning id", [createdRoom.id])).rows.length, 0);
    await assert.rejects(asUser(a, 'delete from junctions where id=$1', [createdRoom.id]), undefined, 'Even room creators must not cascade-delete conversation history');
    const leaseA = '11111111-1111-4111-8111-111111111111';
    const leaseB = '22222222-2222-4222-8222-222222222222';
    await asUser(a, 'select * from join_junction_session($1,$2,$3)', [rooms[0].id,'a',leaseA]);
    await asUser(b, 'select * from join_junction_session($1,$2,$3)', [rooms[0].id,'public-tab',leaseB]);
    // C adopts B's public tab name in a different room. It cannot redirect A's block.
    await asUser(c, 'select * from join_junction_session($1,$2,$3)', [rooms[1].id,'public-tab','33333333-3333-4333-8333-333333333333']);
    await asUser(a, "select block_junction_user('public-tab')");
    assert.equal((await asUser(a, 'select * from blocks')).rows[0].blocked_user_id, b);
    const secondLease = '44444444-4444-4444-8444-444444444444';
    await asUser(a, 'select * from join_junction_session($1,$2,$3)', [rooms[1].id,'a-second',secondLease]);
    await assert.rejects(asUser(a, "select block_junction_user('public-tab')"), /ambiguous block target/i);
    assert.equal((await asUser(a, 'select * from blocks')).rows[0].blocked_user_id, b);
    await asUser(a, 'select leave_junction_session($1,$2,$3)', [rooms[1].id,'a-second',secondLease]);
    assert.equal((await asUser(b, 'select * from blocks')).rows.length, 0);
    assert.equal((await asUser(c, 'select * from reports')).rows.length, 0);
    await asUser(a, "insert into reports(junction_id,reporter_session_id,reporter_user_id,reported_session_id,reason) values ($1,'a',$2,'public-tab','Audit report')", [rooms[0].id,a]);
    assert.equal((await asUser(a, 'select * from reports')).rows.length, 1);
    assert.equal((await asUser(b, 'select * from reports')).rows.length, 0, 'Permissive drift cannot expose another user\'s reports');
    await assert.rejects(asUser(c, "select block_junction_user('a')"));
    await asUser(a, "update participants set last_heartbeat='2099-01-01Z',nickname='Forged Alias',avatar_emoji='wrong' where session_id='a'");
    const updated = (await db.query("select * from participants where session_id='a'")).rows[0];
    assert.equal(updated.nickname, 'Audit Guest');
    assert.equal(updated.avatar_emoji, String.fromCodePoint(0x1f43c));
    assert.ok(Math.abs(Date.now() - Date.parse(updated.last_heartbeat)) < 10000);
    const message = (await asUser(a, "insert into messages(junction_id,session_id,nickname,content,created_at) values ($1,'a','fake','Clock test','2099-01-01Z') returning *", [rooms[0].id])).rows[0];
    assert.ok(Math.abs(Date.now() - Date.parse(message.created_at)) < 10000);
    assert.equal((await asUser(c, 'select * from messages')).rows.length, 0);
    await assert.rejects(asUser(a, 'delete from junctions where id=$1 returning id', [rooms[0].id]));
    await db.query("insert into realtime.messages(topic) values ('policy-probe')");
    for (const [user, topic, allowed] of [
      [a, 'room:' + rooms[0].id, true], [c, 'room:' + rooms[0].id, false],
      [null, 'room:' + rooms[0].id, false], [a, 'blocks:' + b, false],
      [a, 'blocks:' + a, true], [a, 'room:' + rooms[0].id + ':extra', false],
    ]) {
      await db.query("select set_config('realtime.topic',$1,false)", [topic]);
      assert.equal((await asUser(user, 'select * from realtime.messages')).rows.length > 0, allowed, 'Unexpected channel access: ' + topic);
    }
    await asUser(b, 'select leave_junction_session($1,$2,$3)', [rooms[0].id,'public-tab',leaseB]);
    await asUser(a, "delete from blocks where blocked_user_id=$1", [b]);
    await asUser(a, "select block_junction_user('public-tab')");
    assert.equal((await asUser(a, 'select * from blocks')).rows[0].blocked_user_id, b, 'Departed authors must remain blockable from history');
    assert.equal((await asUser(c, "select * from participants where junction_id=$1 and session_id='public-tab'", [rooms[0].id])).rows.length, 0, 'Departed metadata must not be globally exposed');
    assert.equal((await asUser(b, "select * from participants where junction_id=$1 and session_id='public-tab'", [rooms[0].id])).rows.length, 1, 'Owners may inspect their own history');
    const definition = await readFile(new URL('../../supabase/migrations/20261112090000_verified_sessions_and_blocks.sql', import.meta.url));
    new TextDecoder('utf-8', { fatal: true }).decode(definition);
    assert.equal((await db.query("select count(*)::int as count from (select conrelid,conkey,confrelid,confkey from pg_constraint where contype='f' and connamespace='public'::regnamespace group by conrelid,conkey,confrelid,confkey having count(*)>1) duplicates")).rows[0].count, 0, 'Auth FK creation must not duplicate existing equivalent constraints');
    assert.equal((await db.query("select count(*)::int as count from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.prosecdef and p.proname like '%junction%' and not ('search_path=\"\"'=any(p.proconfig))")).rows[0].count, 0);
    console.log('Production default grants, PUBLIC inheritance, realtime guards, spoofed block targets, clocks, UTF-8 defaults and private membership history passed.');
  } finally { await db.close(); }

  await assert.rejects(createTestDatabase({ beforeIdentityMigration: async (database) => {
    await database.exec('create index idx_blocks_verified_users on blocks(blocked_session_id)');
  } }), /unique index is missing or incompatible/i);
  await assert.rejects(createTestDatabase({ beforeIdentityMigration: async (database) => {
    await database.exec('create table junction_profiles(id uuid primary key, user_id uuid)');
  } }), /user_id as its primary key/i);
  await assert.rejects(createTestDatabase({ beforeIdentityMigration: async (database) => {
    await database.exec('create policy junction_authenticated_access on messages for select using (true)');
  } }), /review migration history\/drift/i);
  await assert.rejects(createTestDatabase({ beforeIdentityMigration: async (database) => {
    await database.exec('create role inherited_app_privileges; grant inherited_app_privileges to authenticated; grant truncate on messages to inherited_app_privileges');
  } }), /review inherited role grants/i);
}

if (process.argv[1]?.endsWith('production-safety.mjs')) await testProductionSafety();
