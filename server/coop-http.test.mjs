import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from './app.mjs';
import { CoopService } from './coop-service.mjs';
import packageInfo from '../package.json' with { type: 'json' };
import { EscapeWorld } from '../src/escape/world.ts';

async function harness(t, options = {}) {
  const service = new CoopService(options);
  const app = createApp({ coopService: service });
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => { service.shutdown(); server.closeAllConnections(); server.close(); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = async (path, body, token) => {
    const response = await fetch(base + '/api/coop' + path, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...(token ? { authorization: `Bearer ${token}` } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(5000),
    });
    return { status: response.status, body: await response.json(), headers: response.headers };
  };
  const social = async (path, body, token) => {
    const response = await fetch(base + '/api/social' + path, {
      method: body === undefined ? 'GET' : path === '/me' ? 'PATCH' : 'POST',
      headers: { ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...(token ? { authorization: `Bearer ${token}` } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(5000),
    });
    return { status: response.status, body: await response.json(), headers: response.headers };
  };
  const registerGuest = async (name, avatar) => {
    const response = await social('/guest', { name, avatar });
    assert.equal(response.status, 200, JSON.stringify(response.body));
    return response.body;
  };
  const create = async (name = '值班员', avatar = 0) => {
    const profile = await registerGuest(name, avatar);
    const response = await fetch(base + '/api/coop/rooms', {
      method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${profile.token}` },
      body: JSON.stringify({ version: packageInfo.version, name, avatar }), signal: AbortSignal.timeout(5000),
    }).then(async result => ({ status: result.status, body: await result.json() }));
    assert.equal(response.status, 200, JSON.stringify(response.body));
    return { ...response.body, profile };
  };
  const join = async (session, name = '维修员', avatar = 2) => {
    const profile = await registerGuest(name, avatar);
    const response = await fetch(base + `/api/coop/${session.code}/join`, {
      method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${profile.token}` },
      body: JSON.stringify({ version: packageInfo.version, name, avatar }), signal: AbortSignal.timeout(5000),
    }).then(async result => ({ status: result.status, body: await result.json() }));
    assert.equal(response.status, 200, JSON.stringify(response.body));
    return { ...response.body, profile };
  };
  return { service, base, request, social, registerGuest, create, join };
}

test('HTTP rooms require current clients, valid profiles, ready peers and the leader', async t => {
  const { base, request, create, join, registerGuest } = await harness(t);
  assert.equal((await request('/rooms', { version: 'obsolete', name: '旧版', avatar: 0 })).status, 409);
  assert.equal((await request('/rooms', { version: packageInfo.version, name: ' ', avatar: 0 })).status, 400);
  assert.equal((await request('/rooms', { version: packageInfo.version, name: '同伴', avatar: 99 })).status, 400);
  const host = await create(), guest = await join(host);
  assert.notEqual(host.token, guest.token);
  assert.equal((await request(`/${host.code}/start`, {}, host.token)).status, 409);
  for (const peer of [host, guest]) assert.equal((await request(`/${host.code}/ready`, { ready: true }, peer.token)).status, 200);
  assert.equal((await request(`/${host.code}/start`, {}, guest.token)).status, 403);
  const started = await request(`/${host.code}/start`, {}, host.token);
  assert.equal(started.status, 200);
  assert.deepEqual(started.body.players.map(p => p.lives), [2, 2]);
  const late = await registerGuest('迟到', 1);
  const lateResponse = await fetch(`${base}/api/coop/${host.code}/join`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${late.token}` }, body: JSON.stringify({ version: packageInfo.version, name: '迟到', avatar: 1 }) });
  assert.equal(lateResponse.status, 409);
});

test('SSE is private, unbuffered and sends a valid personally projected snapshot', async t => {
  const { base, create, join, request } = await harness(t);
  const host = await create('雨衣', 0), guest = await join(host, '浴袍', 1);
  const missingAuth = await fetch(`${base}/api/coop/${host.code}/events?token=${host.token}`);
  assert.equal(missingAuth.status, 401, 'a token in a URL grants no stream access');
  const controller = new AbortController(); t.after(() => controller.abort());
  const response = await fetch(`${base}/api/coop/${host.code}/events`, { headers: { authorization: `Bearer ${guest.token}` }, signal: controller.signal });
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /text\/event-stream/);
  assert.equal(response.headers.get('x-accel-buffering'), 'no');
  assert.match(response.headers.get('cache-control'), /no-transform/);
  const reader = response.body.getReader(), decoder = new TextDecoder(); let stream = '';
  const timeout = setTimeout(() => controller.abort(), 5000); t.after(() => clearTimeout(timeout));
  while (!/event: snapshot\ndata: ([^\n]+)\n\n/.test(stream)) {
    const { value, done } = await reader.read(); assert.equal(done, false);
    stream += decoder.decode(value, { stream: true });
  }
  assert.ok(!stream.includes(host.token) && !stream.includes(guest.token));
  const packet = JSON.parse(stream.match(/event: snapshot\ndata: ([^\n]+)\n\n/)[1]);
  assert.equal(packet.protocol, 1);
  assert.equal(packet.room.code, host.code);
  assert.equal(packet.room.players.length, 2);
  assert.deepEqual(packet.room.players.map(p => p.avatar), [0, 1]);
  assert.deepEqual(EscapeWorld.restore(packet.world).snapshot(), packet.world);
  const ping = await request('/ping'); assert.equal(ping.status, 200); assert.ok(Number.isFinite(ping.body.serverTime));
  controller.abort();
});

test('HTTP commands reject coordinates, stale sequences, remote interactions and cross-room tokens', async t => {
  const { request, create, join, service } = await harness(t);
  const host = await create(), guest = await join(host), other = await create('另一房');
  for (const peer of [host, guest]) await request(`/${host.code}/ready`, { ready: true }, peer.token);
  await request(`/${host.code}/start`, {}, host.token);
  const move = { forward: 0, strafe: 0, turn: 0, look: 0, sprint: false };
  const player = service.rooms.get(host.code).players.get(guest.playerId), before = { ...player.position };
  assert.equal((await request(`/${host.code}/input`, { seq: 1, move, x: 20, z: 50 }, guest.token)).status, 400);
  assert.equal((await request(`/${host.code}/input`, { seq: 1, move }, other.token)).status, 401);
  assert.equal((await request(`/${host.code}/input`, { seq: 1, move, action: 'interact', targetId: 'exit' }, guest.token)).status, 400);
  assert.deepEqual(player.position, before);
  const accepted = await request(`/${host.code}/input`, { seq: 2, move, aim: { angle: 0.8, pitch: 0.4 } }, guest.token);
  assert.equal(accepted.status, 200);
  assert.equal((await request(`/${host.code}/input`, { seq: 2, move }, guest.token)).status, 400);
  assert.equal((await request(`/${host.code}/save`, {}, guest.token)).status, 404, 'there is no multiplayer save endpoint');
  assert.equal((await request(`/${host.code}/match`, {}, guest.token)).status, 404, 'there is no matchmaking endpoint');
});

test('oversized/malformed requests return bounded JSON failures, and room capacity is enforced', async t => {
  const { base, request, create } = await harness(t, { maxRooms: 1 });
  await create();
  const extra = await fetch(base + '/api/social/guest', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: '额外', avatar: 0 }) }).then(response => response.json());
  assert.equal((await request('/rooms', { version: packageInfo.version, name: '额外', avatar: 0 }, extra.token)).status, 503);
  for (const [body, expected] of [['{"bad":', 400], [JSON.stringify({ huge: 'x'.repeat(10_000) }), 413]]) {
    const response = await fetch(base + '/api/coop/rooms', { method: 'POST', headers: { 'content-type': 'application/json' }, body });
    assert.equal(response.status, expected); assert.match(response.headers.get('content-type'), /application\/json/);
    const text = await response.text(); assert.ok(text.length < 256); assert.ok(!text.includes('node_modules'));
  }
});

test('non-host stone and glass sounds cause bounded investigation below the exposure threshold', t => {
  for (const kind of ['stone', 'glass', 'distant']) {
    let now = 1_000_000;
    const service = new CoopService({ now: () => now, autoTick: false }); t.after(() => service.shutdown());
    const host = service.create({ version: packageInfo.version, name: '甲', avatar: 0 });
    const guest = service.join({ version: packageInfo.version, code: host.code, name: '乙', avatar: 1 });
    for (const session of [host, guest]) service.setReady(host.code, session.token, true);
    service.start(host.code, { id: host.playerId, token: host.token });
    const room = service.rooms.get(host.code), member = room.players.get(guest.playerId);
    // A controlled legal corridor fixture; actions and physics still run through authority.
    member.position = kind === 'glass' ? { x: 7.18, z: 9.5 } : { x: 12.5, z: 9.5 };
    Object.assign(member.actorWorld.data.player, member.position, { light: false, angle: 0 });
    Object.assign(room.world.data.hunter, kind === 'distant' ? { x: 20.5, z: 50.5, angle: 0, state: 'patrol' } : { x: 17.5, z: 9.5, angle: 0, state: 'patrol' });
    const input = { seq: 1, move: { forward: kind === 'glass' ? 1 : 0, strafe: 0, turn: 0, look: 0, sprint: false }, aim: { angle: kind === 'glass' ? 0 : Math.PI, pitch: 0 }, ...(kind === 'glass' ? {} : { action: 'stone' }) };
    service.input(host.code, guest.token, input);
    for (let n = 0; n < (kind === 'glass' ? 4 : 1); n++) { now += 50; service.pulse(); }
    assert.ok(member.actorWorld.data.hunt.noise < 45);
    if (kind === 'distant') assert.equal(room.world.data.hunter.state, 'patrol', 'inaudible sounds do not reveal the player');
    else {
      assert.equal(room.world.data.hunter.state, 'investigate', `${kind} must produce a real, non-chasing investigation`);
      if (kind === 'stone') assert.ok(room.world.target.x < member.position.x, 'the lure follows the throw aim, not the thrower');
    }
  }
});
