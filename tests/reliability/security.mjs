import assert from 'node:assert/strict';
import { createTestDatabase } from './database.mjs';

export async function testSecurity() {
  const { db, asUser } = await createTestDatabase();
  const a = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const b = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  const c = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
  const rooms = (await db.query('select id from junctions order by slug limit 2')).rows;
  try {
    for (const id of [a, b, c]) {
      await db.query('insert into auth.users values ($1)', [id]);
      await asUser(id, "insert into junction_profiles(user_id,display_name) values ($1,'Test Person')", [id]);
    }
    const leaseA = '11111111-1111-4111-8111-111111111111';
    const leaseB = '22222222-2222-4222-8222-222222222222';
    await asUser(a, 'select * from join_junction_session($1,$2,$3)', [rooms[0].id, 'tab-a', leaseA]);
    await asUser(b, 'select * from join_junction_session($1,$2,$3)', [rooms[0].id, 'tab-b', leaseB]);
    const inserted = await asUser(b, "insert into messages(junction_id,session_id,nickname,content) values ($1,'tab-b','Forged Name','Historical message') returning *", [rooms[0].id]);
    assert.equal(inserted.rows[0].user_id, b);
    assert.equal(inserted.rows[0].nickname, 'Test Person');
    assert.equal((await asUser(a, 'select * from messages')).rows.length, 1);
    await asUser(a, "insert into messages(junction_id,session_id,nickname,content,reply_to) values ($1,'tab-a','A','Reply',$2)", [rooms[0].id, inserted.rows[0].id]);
    await asUser(a, "delete from messages where content='Reply'");
    const aliceMessage = (await asUser(a, "insert into messages(junction_id,session_id,nickname,content) values ($1,'tab-a','A','Alice message') returning *", [rooms[0].id])).rows[0];
    await asUser(a, "select * from block_junction_user('tab-b')");
    await db.exec('create policy test_permissive_policy on messages for select to authenticated using (true)');
    assert.equal((await asUser(a, 'select * from messages where user_id=$1', [b])).rows.length, 0);
    assert.equal((await db.query('select * from messages')).rows.length, 2, 'Blocking must retain history');
    await asUser(b, "insert into messages(junction_id,session_id,nickname,content) values ($1,'tab-b','B','Blocked live message')", [rooms[0].id]);
    assert.equal((await asUser(a, 'select * from messages where user_id=$1', [b])).rows.length, 0);
    await assert.rejects(asUser(b, "insert into messages(junction_id,session_id,nickname,content,reply_to) values ($1,'tab-b','B','Directed blocked reply',$2)", [rooms[0].id, aliceMessage.id]));
    await assert.rejects(asUser(b, "insert into reactions(junction_id,message_id,session_id,emoji) values ($1,$2,'tab-b','😭')", [rooms[0].id, aliceMessage.id]));
    await asUser(c, 'select * from join_junction_session($1,$2,$3)', [rooms[0].id, 'tab-c', '55555555-5555-4555-8555-555555555555']);
    assert.equal((await asUser(c, 'select * from messages where user_id=$1', [b])).rows.length, 2, 'Shared-room posts still reach unblocked members');
    assert.equal((await asUser(b, 'select * from messages where id=$1', [aliceMessage.id])).rows.length, 1, 'Reading shared chat does not grant directed interaction');
    await assert.rejects(asUser(b, "update participants set user_id=$1 where session_id='tab-b'", [a]));
    await assert.rejects(asUser(b, "update participants set connection_id=gen_random_uuid() where session_id='tab-b'"));
    await db.exec('create policy test_open_profiles on junction_profiles for all to authenticated using (true) with check (true)');
    assert.equal((await asUser(b, 'select * from junction_profiles where user_id=$1', [a])).rows.length, 0);
    assert.equal((await asUser(b, "update junction_profiles set display_name='Forged' where user_id=$1 returning *", [a])).rows.length, 0);
    await assert.rejects(asUser(a, "update junction_profiles set display_name=' ' where user_id=$1", [a]));
    await assert.rejects(asUser(a, "update junction_profiles set avatar_color='invalid' where user_id=$1", [a]));

    await assert.rejects(asUser(b, "insert into messages(junction_id,session_id,user_id,nickname,content) values ($1,'tab-a',$2,'A','Forged identity')", [rooms[0].id, a]));
    await assert.rejects(asUser(null, 'select * from messages'));
    await assert.rejects(asUser(c, "insert into blocks(blocker_session_id,blocked_session_id,blocker_user_id,blocked_user_id) values ('c','b',$1,$2)", [a, b]));
    assert.equal((await asUser(c, 'select * from blocks')).rows.length, 0);
    await asUser(b, 'delete from blocks where blocker_user_id=$1', [a]);
    assert.equal((await asUser(a, 'select * from blocks')).rows.length, 1, 'Another user must not remove a block');
    await assert.rejects(asUser(a, "select * from block_junction_user('tab-a')"));

    // The same verified person has independent room sessions in two tabs.
    const leaseA2 = '33333333-3333-4333-8333-333333333333';
    await asUser(a, 'select * from join_junction_session($1,$2,$3)', [rooms[1].id, 'tab-a-2', leaseA2]);
    await asUser(a, 'select leave_junction_session($1,$2,$3)', [rooms[0].id, 'tab-a', leaseA]);
    assert.equal((await db.query("select * from participants where user_id=$1 and left_at is null", [a])).rows.length, 1);
    // A stale cleanup cannot end the replacement lease of the same tab.
    const replacement = '44444444-4444-4444-8444-444444444444';
    await asUser(a, 'select * from join_junction_session($1,$2,$3)', [rooms[1].id, 'tab-a-2', replacement]);
    await asUser(a, 'select leave_junction_session($1,$2,$3)', [rooms[1].id, 'tab-a-2', leaseA2]);
    assert.equal((await db.query("select * from participants where session_id='tab-a-2' and left_at is null")).rows.length, 1);
    await asUser(a, 'select leave_junction_session($1,$2,$3)', [rooms[1].id, 'tab-a-2', replacement]);
    assert.equal((await asUser(a, 'select * from heartbeat_junction_session($1,$2,$3)', [rooms[1].id, 'tab-a-2', replacement])).rows.length, 0);
    console.log('PostgreSQL RLS, stable-user blocks, forged sender rejection, history retention, and independent lease cleanup passed.');
  } finally { await db.close(); }
}

if (process.argv[1]?.endsWith('security.mjs')) await testSecurity();
