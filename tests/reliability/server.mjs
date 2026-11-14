// Isolated test adapter for the Supabase HTTP/Phoenix protocols. Application SQL
// runs in real PostgreSQL (PGlite), including its RLS policies. Never uses .env.local.
import { createServer } from 'node:http';
import { randomUUID, createHmac } from 'node:crypto';
import { WebSocketServer } from 'ws';
import { createTestDatabase } from './database.mjs';

const tables = ['junctions', 'participants', 'messages', 'reactions', 'blocks', 'junction_profiles', 'reports'];
const identifier = (value) => {
  if (!/^[a-z_][a-z0-9_]*$/i.test(value)) throw new Error('Invalid identifier');
  return '"' + value + '"';
};

export async function startTestBackend(port = 4179) {
  const { db, asUser } = await createTestDatabase();
  const users = new Map();
  const refreshTokens = new Map();
  const sockets = new Set();
  let subscriptionId = 0;
  let mutationQueue = Promise.resolve();
  const delivery = { deniedMessages: 0, earlyCandidates: 0 };
  const lastSignals = new Map();

  function sessionFor(user) {
    const now = Math.floor(Date.now() / 1000);
    const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
    const payload = Buffer.from(JSON.stringify({ sub: user.id, role: 'authenticated', aud: 'authenticated', exp: now + 3600, iat: now, is_anonymous: true })).toString('base64url');
    const signature = createHmac('sha256', 'isolated-test-secret').update(header + '.' + payload).digest('base64url');
    const refresh = randomUUID();
    refreshTokens.set(refresh, user);
    return { access_token: header + '.' + payload + '.' + signature, refresh_token: refresh, token_type: 'bearer', expires_in: 3600, expires_at: now + 3600, user };
  }
  function userFromToken(token) {
    if (!token) return null;
    try {
      const [header, payload, signature] = token.split('.');
      const expected = createHmac('sha256', 'isolated-test-secret').update(header + '.' + payload).digest('base64url');
      if (signature !== expected) return null;
      return users.get(JSON.parse(Buffer.from(payload, 'base64url')).sub) ?? null;
    } catch { return null; }
  }
  async function snapshot() {
    return Object.fromEntries(await Promise.all(tables.map(async (table) => [table, (await db.query('select * from ' + identifier(table))).rows])));
  }
  const frame = (client, event, payload, ref = null, topic = client.topic) => {
    if (client.ws.readyState === 1) client.ws.send(JSON.stringify({ topic, event, payload, ref, join_ref: client.joinRef }));
  };
  function presenceState(topic) {
    const result = {};
    for (const ws of sockets) for (const client of ws.channels.values()) {
      if (client.topic !== topic || !client.presence) continue;
      const key = client.config.presence?.key || client.id;
      result[key] ??= { metas: [] };
      result[key].metas.push(client.presence);
    }
    return result;
  }
  function presenceDiff(topic, joins, leaves) {
    for (const ws of sockets) for (const client of ws.channels.values()) {
      if (client.topic === topic) frame(client, 'presence_diff', { joins, leaves });
    }
  }
  function untrack(client) {
    if (!client.presence) return;
    const key = client.config.presence?.key || client.id;
    const old = client.presence;
    client.presence = null;
    presenceDiff(client.topic, {}, { [key]: { metas: [old] } });
  }
  async function canSelect(client, table, row, deleted = false) {
    if (table === 'blocks') return row.blocker_user_id === client.userId;
    if (deleted) {
      if (table === 'messages' || table === 'reactions') {
        return Boolean((await asUser(client.userId, 'select can_read_junction_message($1,$2,$3) as allowed', [row.junction_id, row.user_id, row.session_id])).rows[0].allowed);
      }
      return Boolean(client.userId);
    }
    return (await asUser(client.userId, 'select * from ' + identifier(table) + ' where ' + identifier(table === 'junction_profiles' ? 'user_id' : 'id') + '=$1', [row.id ?? row.user_id])).rows.length > 0;
  }
  async function notify(before, after) {
    for (const table of tables) {
      const key = table === 'junction_profiles' ? 'user_id' : 'id';
      const oldRows = new Map(before[table].map((row) => [row[key], row]));
      const newRows = new Map(after[table].map((row) => [row[key], row]));
      const changes = [];
      for (const [id, row] of newRows) {
        const old = oldRows.get(id);
        if (!old) changes.push({ event: 'INSERT', row, old: {} });
        else if (JSON.stringify(old) !== JSON.stringify(row)) changes.push({ event: 'UPDATE', row, old });
      }
      for (const [id, row] of oldRows) if (!newRows.has(id)) changes.push({ event: 'DELETE', row, old: row });
      for (const change of changes) {
        for (const ws of sockets) for (const client of ws.channels.values()) {
          const subscriptions = client.subscriptions.filter((sub) => sub.table === table && (sub.event === '*' || sub.event === change.event) && matchesFilter(sub.filter, change.row));
          if (!subscriptions.length) continue;
          if (!await canSelect(client, table, change.row, change.event === 'DELETE')) {
            if (table === 'messages') delivery.deniedMessages++;
            continue;
          }
          frame(client, 'postgres_changes', {
            ids: subscriptions.map(({ id }) => id),
            data: { schema: 'public', table, commit_timestamp: new Date().toISOString(), type: change.event,
              columns: Object.keys(change.row).map((name) => ({ name, type: typeof change.row[name] === 'boolean' ? 'bool' : 'text' })),
              record: change.event === 'DELETE' ? {} : change.row, old_record: change.old, errors: null },
          });
        }
      }
    }
  }
  function matchesFilter(filter, row) {
    if (!filter) return true;
    const match = filter.match(/^([a-z_]+)=eq\.(.+)$/);
    return !match || String(row[match[1]]) === match[2];
  }
  function where(url, parameters) {
    const clauses = [];
    for (const [column, filter] of url.searchParams) {
      if (['select', 'order', 'limit', 'offset', 'on_conflict'].includes(column)) continue;
      const separator = filter.indexOf('.');
      const operator = filter.slice(0, separator);
      const value = filter.slice(separator + 1);
      const name = identifier(column);
      if (operator === 'is') { clauses.push(name + (value === 'null' ? ' is null' : ' is ' + (value === 'true' ? 'true' : 'false'))); continue; }
      if (operator === 'in') {
        const values = value.slice(1, -1).split(',').map((part) => part.replace(/^"|"$/g, ''));
        const positions = values.map((part) => { parameters.push(part); return '$' + parameters.length; });
        clauses.push(name + ' in (' + positions.join(',') + ')');
        continue;
      }
      const operators = { eq: '=', neq: '<>', gt: '>', gte: '>=', lt: '<', lte: '<=', ilike: 'ilike' };
      if (!operators[operator]) throw new Error('Unsupported test filter ' + operator);
      parameters.push(value);
      clauses.push(name + ' ' + operators[operator] + ' $' + parameters.length);
    }
    return clauses.length ? ' where ' + clauses.join(' and ') : '';
  }
  const server = createServer(async (request, response) => {
    response.setHeader('Access-Control-Allow-Origin', '*');
    response.setHeader('Access-Control-Allow-Headers', '*');
    response.setHeader('Access-Control-Allow-Methods', 'GET,HEAD,POST,PUT,PATCH,DELETE,OPTIONS');
    response.setHeader('Access-Control-Expose-Headers', 'Content-Range');
    response.setHeader('Content-Type', 'application/json');
    if (request.method === 'OPTIONS') { response.statusCode = 204; response.end(); return; }
    const url = new URL(request.url, 'http://127.0.0.1:' + port);
    let text = '';
    for await (const chunk of request) text += chunk;
    const body = text ? JSON.parse(text) : {};
    const user = userFromToken((request.headers.authorization ?? '').replace(/^Bearer /, ''));
    try {
      if (url.pathname.startsWith('/auth/v1/')) {
        if (url.pathname.endsWith('/signup')) {
          const id = randomUUID();
          const created = { id, aud: 'authenticated', role: 'authenticated', is_anonymous: true,
            app_metadata: { provider: 'anonymous' }, user_metadata: {}, created_at: new Date().toISOString() };
          users.set(id, created);
          await db.query('insert into auth.users(id) values ($1)', [id]);
          response.end(JSON.stringify(sessionFor(created)));
        } else if (url.pathname.endsWith('/token')) {
          const owner = refreshTokens.get(body.refresh_token);
          if (!owner) throw new Error('Unknown refresh token');
          response.end(JSON.stringify(sessionFor(owner)));
        } else if (url.pathname.endsWith('/user') && user) {
          response.end(JSON.stringify(user));
        } else { response.statusCode = 401; response.end(JSON.stringify({ message: 'Authentication required' })); }
        return;
      }
      const table = url.pathname.split('/').at(-1);
      if (url.pathname.startsWith('/rest/v1/rpc/')) {
        const allowed = ['join_junction_session', 'leave_junction_session', 'heartbeat_junction_session', 'block_junction_user', 'purge_junction_chat_if_empty'];
        if (!allowed.includes(table)) throw new Error('Unknown test RPC');
        const operation = mutationQueue.then(async () => {
          const before = await snapshot();
          const names = Object.keys(body);
          const result = await asUser(user?.id, 'select * from ' + identifier(table) + '(' + names.map((name, index) => identifier(name) + ' => $' + (index + 1)).join(',') + ')', Object.values(body));
          await notify(before, await snapshot());
          return table.startsWith('join_') || table.startsWith('block_') ? result.rows[0] : table.startsWith('heartbeat_') ? result.rows : null;
        });
        mutationQueue = operation.catch(() => {});
        response.end(JSON.stringify(await operation));
        return;
      }
      if (!tables.includes(table)) { response.statusCode = 404; response.end('{}'); return; }
      let result;
      if (request.method === 'GET' || request.method === 'HEAD') {
        const parameters = [];
        const select = url.searchParams.get('select') ?? '*';
        const columns = select === '*' ? '*' : select.split(',').map(identifier).join(',');
        let sql = 'select ' + columns + ' from ' + identifier(table) + where(url, parameters);
        const order = url.searchParams.get('order');
        if (order) sql += ' order by ' + order.split(',').map((part) => {
          const [name, direction] = part.split('.');
          return identifier(name) + (direction === 'desc' ? ' desc' : ' asc');
        }).join(',');
        if (url.searchParams.has('limit')) sql += ' limit ' + Math.min(1000, Number(url.searchParams.get('limit')));
        result = await asUser(user?.id, sql, parameters);
        response.setHeader('Content-Range', '0-' + Math.max(0, result.rows.length - 1) + '/' + result.rows.length);
        if (request.method === 'HEAD') { response.end(); return; }
      } else {
        const operation = mutationQueue.then(async () => {
          const before = await snapshot();
          const parameters = [];
          let sql;
          if (request.method === 'POST') {
            const values = Array.isArray(body) ? body[0] : body;
            const names = Object.keys(values);
            parameters.push(...Object.values(values));
            sql = 'insert into ' + identifier(table) + '(' + names.map(identifier).join(',') + ') values (' + names.map((_, i) => '$' + (i + 1)).join(',') + ')';
            if ((request.headers.prefer ?? '').includes('resolution=merge-duplicates')) {
              const conflict = (url.searchParams.get('on_conflict') ?? (table === 'junction_profiles' ? 'user_id' : 'id')).split(',');
              sql += ' on conflict (' + conflict.map(identifier).join(',') + ') do update set ' + names.map((name) => identifier(name) + '=excluded.' + identifier(name)).join(',');
            }
          } else if (request.method === 'PATCH') {
            parameters.push(...Object.values(body));
            sql = 'update ' + identifier(table) + ' set ' + Object.keys(body).map((name, i) => identifier(name) + '=$' + (i + 1)).join(',') + where(url, parameters);
          } else sql = 'delete from ' + identifier(table) + where(url, parameters);
          const changed = await asUser(user?.id, sql + ' returning *', parameters);
          await notify(before, await snapshot());
          return changed;
        });
        mutationQueue = operation.catch(() => {});
        result = await operation;
      }
      if ((request.headers.accept ?? '').includes('vnd.pgrst.object')) {
        if (result.rows.length !== 1) { response.statusCode = 406; response.end(JSON.stringify({ code: 'PGRST116', details: 'The result contains ' + result.rows.length + ' rows', message: 'Object expected' })); return; }
        response.end(JSON.stringify(result.rows[0]));
      } else response.end(JSON.stringify(result.rows));
    } catch (error) {
      response.statusCode = 400;
      response.end(JSON.stringify({ code: error.code ?? 'TEST', message: error.message }));
    }
  });

  const websocket = new WebSocketServer({ server });
  websocket.on('connection', (ws) => {
    ws.channels = new Map();
    sockets.add(ws);
    ws.on('message', async (raw) => {
      const parsed = JSON.parse(raw);
      const message = Array.isArray(parsed) ? { join_ref: parsed[0], ref: parsed[1], topic: parsed[2], event: parsed[3], payload: parsed[4] } : parsed;
      const { topic, event, payload, ref, join_ref: joinRef } = message;
      if (event === 'heartbeat') { frame({ ws, topic, joinRef }, 'phx_reply', { status: 'ok', response: {} }, ref); return; }
      if (event === 'phx_join') {
        const owner = userFromToken(payload.access_token);
        const client = { ws, topic, joinRef, userId: owner?.id, id: randomUUID(), config: payload.config, subscriptions: [] };
        const privateAllowed = !payload.config.private || (owner && (await asUser(owner.id, 'select can_use_junction_channel($1) as allowed', [topic.replace(/^realtime:/, '')])).rows[0].allowed);
        if (!privateAllowed) { frame(client, 'phx_reply', { status: 'error', response: { reason: 'Unauthorized' } }, ref); return; }
        client.subscriptions = (payload.config.postgres_changes ?? []).map((sub) => ({ ...sub, id: ++subscriptionId }));
        ws.channels.set(topic, client);
        frame(client, 'phx_reply', { status: 'ok', response: { postgres_changes: client.subscriptions } }, ref);
        frame(client, 'presence_state', presenceState(topic));
        return;
      }
      const client = ws.channels.get(topic);
      if (!client) return;
      if (event === 'phx_leave') {
        untrack(client);
        ws.channels.delete(topic);
      } else if (event === 'presence') {
        const key = client.config.presence?.key || client.id;
        const old = client.presence;
        if (payload.event === 'track') {
          client.presence = { ...payload.payload, phx_ref: randomUUID() };
          presenceDiff(topic, { [key]: { metas: [client.presence] } }, old ? { [key]: { metas: [old] } } : {});
        } else untrack(client);
      } else if (event === 'broadcast') {
        if (payload.payload?.type === 'ice') lastSignals.set(payload.payload.from, { topic, payload });
        for (const other of sockets) for (const target of other.channels.values()) {
          if (target.topic !== topic || (target === client && !client.config.broadcast.self)) continue;
          const send = () => frame(target, 'broadcast', payload);
          // Deliberately deliver ICE before SDP to exercise candidate buffering.
          if (payload.payload?.type === 'description') setTimeout(send, 40);
          else { if (payload.payload?.type === 'ice') delivery.earlyCandidates++; send(); }
        }
      } else if (event === 'access_token') {
        client.userId = userFromToken(payload.access_token)?.id;
      }
      frame(client, 'phx_reply', { status: 'ok', response: {} }, ref);
    });
    ws.on('close', () => {
      for (const client of ws.channels.values()) untrack(client);
      sockets.delete(ws);
    });
  });
  await new Promise((resolve) => server.listen(port, '127.0.0.1', resolve));
  return {
    db, asUser, delivery, origin: 'http://127.0.0.1:' + port,
    injectLateMessage: (userId, row) => {
      // Fault injection only: simulate a packet queued before a block was saved.
      for (const ws of sockets) for (const client of ws.channels.values()) {
        if (client.userId !== userId) continue;
        const subscriptions = client.subscriptions.filter((sub) => sub.table === 'messages' && matchesFilter(sub.filter, row));
        if (!subscriptions.length) continue;
        frame(client, 'postgres_changes', {
          ids: subscriptions.map(({ id }) => id),
          data: {
            schema: 'public', table: 'messages', type: 'INSERT', commit_timestamp: new Date().toISOString(),
            columns: Object.keys(row).map((name) => ({ name, type: 'text' })), record: row, old_record: {}, errors: null,
          },
        });
      }
    },
    injectDepartedSignal: (sessionId) => {
      const stored = lastSignals.get(sessionId);
      if (!stored) return;
      for (const ws of sockets) for (const client of ws.channels.values()) {
        if (client.topic === stored.topic) frame(client, 'broadcast', stored.payload);
      }
    },
    interrupt: () => { for (const ws of sockets) ws.close(1012, 'Isolated network interruption'); },
    close: async () => {
      for (const ws of sockets) ws.terminate();
      await new Promise((resolve) => websocket.close(resolve));
      await new Promise((resolve) => server.close(resolve));
      await db.close();
    },
  };
}
