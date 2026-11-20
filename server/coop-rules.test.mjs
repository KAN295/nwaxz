import test from 'node:test';
import assert from 'node:assert/strict';
import { EscapeWorld } from '../src/escape/world.ts';
import { createAbilities } from '../src/escape/abilities.ts';
import { CoopService } from './coop-service.mjs';
import packageInfo from '../package.json' with { type: 'json' };

const warning = remaining => ({ ...createAbilities(), enabled: true, stage: 'warning', selected: 'sense', rest: 0, attempt: 1, warning: remaining, notice: { kind: 'sense-warning', remaining, duration: 3 } });

test('a moving teammate cannot raise a stationary scan target to the moving scan probability', () => {
  const world = new EscapeWorld(1);
  world.data.abilities = warning(3);
  const target = { id: 'quiet', player: { ...world.data.player, x: 12.5, z: 40.5 }, exposure: 0, living: true, moving: false };
  const other = { ...target, id: 'runner', player: { ...target.player, x: 15.5 }, moving: true };
  world.advanceEnemyAuthoritative(.05, [target, other]);
  assert.equal(world.data.abilities.scanChance, .2);
});

test('a successful scan can search a known occupied wardrobe without capturing its teammate', () => {
  const world = new EscapeWorld(1);
  world.data.hunter = { x: 9.5, z: 32.5, angle: Math.PI, state: 'patrol' };
  world.data.abilities = warning(.01);
  const target = { id: 'hidden', player: { ...world.data.player, x: 7.5, z: 32.58, light: false }, hidden: 'basement-wardrobe-entrance', exposure: 0, living: true, moving: false };
  const caught = new Set();
  for (let n = 0; n < 200 && !caught.size; n++) for (const id of world.advanceEnemyAuthoritative(.05, [target])) caught.add(id);
  assert.equal(caught.has(target.id), false);
  assert.equal(world.data.phase, 'playing');
});

test('authoritative proximity never captures a hidden teammate, including a witnessed wardrobe', () => {
  const world = new EscapeWorld(2);
  const candidate = { id: 'hidden', player: { ...world.data.player, x: 5.5, z: 2.58 }, hidden: 'bed-hide', seenHide: 'bed-hide', exposure: 0, living: true };
  Object.assign(world.data.hunter, { x: 5.5, z: 2.7, angle: Math.PI / 2, state: 'search' });
  assert.deepEqual(world.advanceEnemyAuthoritative(.05, [candidate]), []);
  assert.equal(world.data.phase, 'playing');
});

test('a fresh teammate clue can interrupt patrol after the hunter loses its previous target', () => {
  const world = new EscapeWorld(78);
  world.data.elapsed = 10;
  Object.assign(world.data.hunter, { x: 3.5, z: 9.5, angle: 0 });
  const firstSighting = { x: 13.5, z: 9.5 };
  const previous = { id: 'previous', player: { ...world.data.player, ...firstSighting, light: false }, living: true, exposure: 100, currentExposure: 100 };
  world.advanceEnemyAuthoritative(1 / 60, [{ ...previous, focus: 'sight', currentCues: { sight: firstSighting } }]);
  assert.equal(world.data.hunter.state, 'chase');

  const outOfSight = { ...previous, player: { ...previous.player, x: 11.5, z: 5.5 }, exposure: 0, currentExposure: 0 };
  for (let i = 0; i < 1800 && world.data.hunter.state !== 'patrol'; i++) world.advanceEnemyAuthoritative(1 / 60, [outOfSight]);
  assert.equal(world.data.hunter.state, 'patrol');

  const sound = { x: 6.5, z: 9.5 };
  const other = { id: 'other', player: { ...world.data.player, x: 5.5, z: 5.5 }, living: true, exposure: 55, currentExposure: 55, focus: 'noise', currentCues: { noise: sound } };
  world.advanceEnemyAuthoritative(1 / 60, [outOfSight, other]);
  assert.equal(world.data.hunter.state, 'investigate');
  assert.deepEqual(world.target, sound, 'investigate the sensed position rather than the unseen teammate');
});

test('respawning chooses a clear ground-floor spawn away from a hunter camping the bedroom', t => {
  let now = 1_000_000;
  const service = new CoopService({ now: () => now, autoTick: false }); t.after(() => service.close());
  const a = service.create({ version: packageInfo.version, name: '甲', avatar: 0 });
  const b = service.join({ version: packageInfo.version, code: a.code, name: '乙', avatar: 1 });
  for (const session of [a, b]) service.setReady(a.code, session.token, true);
  service.start(a.code, { id: a.playerId, token: a.token });
  const room = service.rooms.get(a.code), player = room.players.get(a.playerId);
  Object.assign(room.world.data.hunter, player.position, { state: 'patrol' });
  now += 50; service.pulse(); assert.equal(player.status, 'caught');
  const before = room.world.snapshot(); service.respawn(a.code, a.token);
  assert.ok(Math.hypot(player.position.x - room.world.data.hunter.x, player.position.z - room.world.data.hunter.z) >= 6);
  assert.equal(room.world.wall(player.position.x, player.position.z), 0);
  assert.deepEqual(room.world.data.hunter, before.hunter);
  assert.equal(room.world.data.elapsed, before.elapsed);
  assert.equal(player.lives, 1);
});
