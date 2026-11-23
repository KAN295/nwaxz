import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from './app.mjs';
import { CoopService } from './coop-service.mjs';
import packageInfo from '../package.json' with { type: 'json' };

async function harness(t) {
  const coop = new CoopService();
  const app = createApp({ coopService: coop });
  const social = app.locals.social;
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => { coop.shutdown(); social.close(); server.closeAllConnections(); server.close(); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (path, { method = 'GET', body, token } = {}) => {
    const response = await fetch(base + path, {
      method,
      headers: { ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...(token ? { authorization: `Bearer ${token}` } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(5000),
    });
    return { status: response.status, body: await response.json(), headers: response.headers };
  };
  const guest = async (name, avatar) => {
    const response = await call('/api/social/guest', { method: 'POST', body: { name, avatar } });
    assert.equal(response.status, 200, JSON.stringify(response.body));
    return response.body;
  };
  const createRoom = async (profile, options = {}) => call('/api/coop/rooms', {
    method: 'POST', token: profile.token,
    body: { version: packageInfo.version, name: profile.name, avatar: profile.avatar, ...options },
  });
  const joinRoom = async (profile, code, options = {}) => call(`/api/coop/${code}/join`, {
    method: 'POST', token: profile.token,
    body: { version: packageInfo.version, name: profile.name, avatar: profile.avatar, ...options },
  });
  return { call, guest, createRoom, joinRoom };
}

test('guest profiles authenticate and update through their bearer token', async t => {
  const { call, guest } = await harness(t);
  const profile = await guest('旧昵称', 1);
  assert.match(profile.uid, /^\d{9}$/);
  assert.match(profile.token, /^[\w-]{43}$/);
  assert.equal((await call('/api/social/me')).status, 401);

  const me = await call('/api/social/me', { token: profile.token });
  assert.equal(me.status, 200);
  assert.deepEqual(me.body, { uid: profile.uid, name: '旧昵称', avatar: 1 });
  assert.equal((await call('/api/social/me', { token: 'invalid' })).status, 401);

  const updated = await call('/api/social/me', { method: 'PATCH', token: profile.token, body: { name: '新昵称', avatar: 3 } });
  assert.equal(updated.status, 200);
  assert.deepEqual(updated.body, { uid: profile.uid, name: '新昵称', avatar: 3 });
  assert.deepEqual((await call('/api/social/me', { token: profile.token })).body, updated.body);
  assert.equal((await call('/api/social/me', { method: 'PATCH', token: profile.token, body: { name: ' ', avatar: 1 } })).status, 400);
});

test('friend requests and accepts are UID based and require authenticated profiles', async t => {
  const { call, guest } = await harness(t);
  const alice = await guest('甲', 0), bob = await guest('乙', 2);
  assert.equal((await call('/api/social/friends/request', { method: 'POST', body: { uid: bob.uid } })).status, 401);
  assert.equal((await call('/api/social/friends/request', { method: 'POST', token: alice.token, body: { uid: 'not-a-uid' } })).status, 400);
  assert.equal((await call('/api/social/friends/request', { method: 'POST', token: alice.token, body: { uid: alice.uid } })).status, 400);

  assert.equal((await call('/api/social/friends/request', { method: 'POST', token: alice.token, body: { uid: bob.uid } })).status, 200);
  const inbox = await call('/api/social/friends', { token: bob.token });
  assert.equal(inbox.status, 200);
  assert.deepEqual(inbox.body.requests, [{ uid: alice.uid, name: '甲', avatar: 0 }]);
  assert.equal((await call('/api/social/friends/accept', { method: 'POST', token: bob.token, body: { uid: alice.uid } })).status, 200);

  const [aliceFriends, bobFriends] = await Promise.all([
    call('/api/social/friends', { token: alice.token }), call('/api/social/friends', { token: bob.token }),
  ]);
  assert.deepEqual(aliceFriends.body.friends.map(friend => friend.uid), [bob.uid]);
  assert.deepEqual(bobFriends.body.friends.map(friend => friend.uid), [alice.uid]);
  assert.deepEqual(bobFriends.body.requests, []);
});

test('server list advertises eight room slots and exposes room titles without private password data', async t => {
  const { call, guest, createRoom } = await harness(t);
  const host = await guest('房主', 0);
  const publicRoom = await createRoom(host, { title: '走廊小队', visibility: 'public' });
  const privateRoom = await createRoom(host, { title: '好友专用', visibility: 'private', password: 'room-pass-732' });
  assert.equal(publicRoom.status, 200, JSON.stringify(publicRoom.body));
  assert.equal(privateRoom.status, 200, JSON.stringify(privateRoom.body));

  const listing = await call('/api/coop/servers');
  assert.equal(listing.status, 200);
  assert.equal(listing.body.server.capacity, 8);
  assert.ok(listing.body.rooms.some(room => room.code === publicRoom.body.code && room.name === '走廊小队' && room.locked === false));
  assert.ok(listing.body.rooms.some(room => room.code === privateRoom.body.code && room.name === '好友专用' && room.locked === true));
  const serialized = JSON.stringify(listing.body);
  assert.ok(!serialized.includes('room-pass-732'));
  assert.ok(!/password(?:Hash|Salt)?/iu.test(serialized));
  assert.ok(!serialized.includes(host.token));
});

test('private room rejects a wrong password but accepts an invited friend without one and consumes the invite', async t => {
  const { call, guest, createRoom, joinRoom } = await harness(t);
  const host = await guest('房主', 0), friend = await guest('好友', 1), stranger = await guest('访客', 3);
  assert.equal((await call('/api/social/friends/request', { method: 'POST', token: host.token, body: { uid: friend.uid } })).status, 200);
  assert.equal((await call('/api/social/friends/accept', { method: 'POST', token: friend.token, body: { uid: host.uid } })).status, 200);

  const room = await createRoom(host, { title: '邀请测试', visibility: 'private', password: 'correct-42' });
  assert.equal(room.status, 200, JSON.stringify(room.body));
  assert.equal((await joinRoom(stranger, room.body.code, { password: 'wrong-42' })).status, 403);
  assert.equal((await call('/api/social/invite', { method: 'POST', token: host.token, body: { uid: friend.uid, roomCode: room.body.code } })).status, 200);

  const invitation = await call('/api/social/friends', { token: friend.token });
  assert.deepEqual(invitation.body.invitations, [{ fromUid: host.uid, fromName: '房主', roomCode: room.body.code }]);
  const joined = await joinRoom(friend, room.body.code);
  assert.equal(joined.status, 200, JSON.stringify(joined.body));
  assert.equal(joined.body.code, room.body.code);
  assert.deepEqual((await call('/api/social/friends', { token: friend.token })).body.invitations, []);

  assert.equal((await joinRoom(stranger, room.body.code)).status, 403, 'the invite is specific to one UID and is consumed');
});
