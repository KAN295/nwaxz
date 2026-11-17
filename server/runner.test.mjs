import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { RunnerWorld, readRunRecord, isRunObstacle, weatherAt, nightAt, sceneAt } from '../src/runner/world.ts';
import { dogPose, chaserFrame } from '../src/runner/animation.ts';
import { RunnerRoute3D } from '../src/runner/route3d.ts';
import { RunnerTilt } from '../src/runner/tilt.ts';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine.js';
import { Scene } from '@babylonjs/core/scene.js';
import { createRunnerSprite } from '../src/runner/actors2d.ts';

const run = (world, seconds) => { for (let i = 0; i < Math.round(seconds * 120); i++) world.advance(1 / 120); };
/** A running world with nothing but one item 5 m ahead in the middle lane. */
function place(kind, extra = {}) {
  const world = new RunnerWorld(4); world.start(); world.turns = [];
  world.items = [{ id: 1, lane: 1, z: 5, kind, done: false, ...extra }];
  return world;
}

test('ready, pause and resume freeze every clock and ignore input', () => {
  const w = new RunnerWorld(9); w.action('left'); run(w, 1); assert.equal(w.distance, 0); assert.equal(w.lane, 1);
  w.start(); run(w, .5); w.action('jump'); w.pause(); const snapshot = JSON.stringify(w);
  run(w, 30); w.action('right'); assert.equal(JSON.stringify(w), snapshot);
  w.resume(); run(w, .1); assert.ok(w.distance > 6); assert.ok(w.jumpHeight > 0);
});

test('lanes are bounded and the dog glides between them', () => {
  const w = new RunnerWorld(); w.start(); for (let i = 0; i < 5; i++) w.action('left'); assert.equal(w.lane, 0);
  run(w, .4); assert.equal(w.position, 0); for (let i = 0; i < 5; i++) w.action('right'); assert.equal(w.lane, 2);
});

test('the opening stretch has no obstacles and starts gently', () => {
  for (let seed = 1; seed <= 20; seed++) {
    const w = new RunnerWorld(seed, 'endless');
    const first = w.items.filter(i => isRunObstacle(i.kind)).sort((a, b) => a.z - b.z)[0];
    assert.ok(first.z >= 80, `seed ${seed}: first obstacle at ${first.z}`);
    assert.equal(first.span, undefined); assert.equal(first.kind, 'block');
  }
});

test('a crate causes a recoverable stumble; jumping or dodging avoids it', () => {
  const hit = place('block'); run(hit, .6); assert.equal(hit.phase, 'running'); assert.ok(hit.danger > 0); assert.ok(hit.speed < 13);
  const jump = place('block'); run(jump, .1); jump.action('jump'); run(jump, .5); assert.equal(jump.danger, 0);
  const dodge = place('block'); dodge.action('left'); run(dodge, .6); assert.equal(dodge.danger, 0);
});

test('a second stumble while chased is fatal; running clean lets the frog fall back', () => {
  const w = place('block'); run(w, .6); assert.ok(w.danger > 0);
  run(w, 1.5); w.items = [{ id: 2, z: w.distance + 5, lane: w.lane, kind: 'beam', done: false }]; run(w, .6);
  assert.equal(w.phase, 'caught'); assert.match(w.reason, /恐怖奶蛙/);
  const calm = place('block'); run(calm, .6); calm.items = []; run(calm, 9); assert.equal(calm.danger, 0); assert.equal(calm.phase, 'running');
});

test('a trap drops its floor planks and bumps the dog toward a safe lane', () => {
  const w = place('trap'); run(w, .6);
  assert.equal(w.phase, 'running'); assert.equal(w.trapFalls, 1); assert.ok(w.stumble > 0);
  assert.notEqual(w.lane, 1); assert.ok(w.grace > 0);
});

test('a jump clears the trap without starting the fall event', () => {
  const w = place('trap'); w.action('jump'); run(w, .6);
  assert.equal(w.phase, 'running'); assert.equal(w.trapFalls, 0);
  assert.equal(w.items[0].done, true); assert.equal(w.stumble, 0);
});

test('a spring claw saves once from a fatal obstacle and is consumed', () => {
  const w = place('fire'); w.springCharges = 1; run(w, .6);
  assert.equal(w.phase, 'running'); assert.equal(w.springSaves, 1); assert.equal(w.springCharges, 0);
  assert.equal(w.wallHits, 1); assert.ok(w.danger > 0);
  w.grace = 0; w.danger = 0; w.items = [{ id: 2, lane: w.lane, z: w.distance + 5, kind: 'fire', done: false }]; run(w, .6);
  assert.equal(w.phase, 'caught');
});

test('whole-road obstacles need the right move from every lane', () => {
  for (const [kind, move] of [['block', 'jump'], ['gap', 'jump'], ['beam', 'slide']]) for (const lane of [0, 1, 2]) {
    const bad = place(kind, { span: 3 }); bad.lane = bad.position = lane; bad.action(lane === 0 ? 'right' : 'left'); run(bad, .6);
    assert.equal(bad.phase, 'caught', `${kind} lane ${lane}`); assert.ok(bad.reason && bad.deathHint);
    const good = place(kind, { span: 3 }); good.lane = good.position = lane; run(good, .15); good.action(move); run(good, .6);
    assert.equal(good.phase, 'running', `${kind} lane ${lane} with ${move}`);
  }
  const jumpGate = place('beam', { span: 3 }); run(jumpGate, .15); jumpGate.action('jump'); run(jumpGate, .6); assert.equal(jumpGate.phase, 'caught');
});

test('lethal lane hazards: spikes and fire can be jumped, the boulder needs a double jump', () => {
  for (const kind of ['spikes', 'fire', 'boulder']) {
    const w = place(kind); run(w, .6); assert.equal(w.phase, 'caught'); const d = w.distance; run(w, 1); assert.equal(w.distance, d);
  }
  for (const kind of ['spikes', 'fire']) { const w = place(kind); run(w, .12); w.action('jump'); run(w, .6); assert.equal(w.phase, 'running', kind); }
  const single = place('boulder'); run(single, .12); single.action('jump'); run(single, .6); assert.equal(single.phase, 'caught');
  const double = place('boulder'); double.items[0].z = 9; double.action('jump'); run(double, .25); double.action('jump'); run(double, .7); assert.equal(double.phase, 'running');
});

test('jump arc, double jump, landing buffer and air slide', () => {
  const w = new RunnerWorld(); w.start(); w.items = []; w.turns = [];
  w.action('jump'); run(w, .3); const h = w.jumpHeight; assert.ok(h > 1);
  w.action('jump'); assert.equal(w.jumpCount, 2); w.action('jump'); assert.equal(w.jumpCount, 2);
  run(w, .3); assert.ok(w.jumpHeight > h); run(w, 2); assert.equal(w.jumpHeight, 0); assert.equal(w.jumpCount, 0);
  w.action('jump'); run(w, .2); w.action('slide'); run(w, .25); assert.equal(w.jumpHeight, 0); assert.ok(w.slide > 0);
});

test('coins collect once, magnet pulls across lanes, shield absorbs exactly one hit', () => {
  const coin = place('coin'); run(coin, .6); assert.equal(coin.coins, 1); run(coin, .5); assert.equal(coin.coins, 1);
  const m = place('magnet'); m.items = [{ id: 1, z: 1, lane: 1, kind: 'magnet', done: false }, { id: 2, z: 8, lane: 0, kind: 'coin', done: false }]; run(m, .2);
  assert.equal(m.coins, 1); assert.ok(m.magnet > 9);
  const s = place('shield'); run(s, .5); assert.ok(s.shield > 0);
  s.items = [{ id: 3, z: s.distance + 4, lane: 1, kind: 'gap', done: false, span: 3 }]; run(s, .5);
  assert.equal(s.phase, 'running'); assert.equal(s.shield, 0);
});

test('boost is faster, passes hazards, takes corners itself and expires', () => {
  const w = place('boost'); w.turns = [{ z: 30, direction: 'right', taken: false }];
  w.items.push({ id: 2, z: 15, lane: 1, kind: 'gap', done: false, span: 3 }); run(w, 1.5);
  assert.equal(w.phase, 'running'); assert.equal(w.turnCount, 1); assert.ok(w.speed > 18);
  w.items = []; run(w, 4); assert.equal(w.boost, 0);
});

test('coin streak multiplies coin score and resets after four seconds', () => {
  const w = place('coin'); w.items = Array.from({ length: 10 }, (_, id) => ({ id, z: 1, lane: 1, kind: 'coin', done: false })); run(w, .2);
  assert.equal(w.coins, 10); assert.equal(w.multiplier, 2); assert.equal(w.coinScore, 550); run(w, 4.1); assert.equal(w.multiplier, 1);
});

test('corners: left/right turns inside the window, wrong or missed turns fail', () => {
  const w = new RunnerWorld(); w.start(); w.items = []; w.turns = [{ z: 50, direction: 'left', taken: false }];
  w.action('left'); assert.equal(w.turnCount, 0); assert.equal(w.lane, 0);
  w.distance = 35; w.action('left'); assert.equal(w.turnCount, 1); assert.equal(w.lane, 0);
  const wrong = new RunnerWorld(); wrong.start(); wrong.turns = [{ z: 10, direction: 'right', taken: false }]; wrong.action('left'); assert.equal(wrong.phase, 'caught');
  const missed = new RunnerWorld(); missed.start(); missed.items = []; missed.turns = [{ z: 1, direction: 'left', taken: false }]; run(missed, .3); assert.equal(missed.phase, 'caught');
});

test('long frames are clamped and fixed steps prevent tunnelling', () => {
  const w = new RunnerWorld(); w.start(); w.advance(1000); assert.ok(w.distance < 1.5);
  const a = place('block'), b = place('block'); for (let i = 0; i < 12; i++) a.advance(.05); run(b, .6);
  assert.equal(a.danger > 0, b.danger > 0); assert.ok(Math.abs(a.distance - b.distance) < .12);
});

/** Simple bot that reads the course the way a player would. */
function drive(w) {
  const turn = w.approachingTurn; if (turn && w.turnWindow && turn.z - w.distance <= 12) w.action(turn.direction);
  const ahead = w.items.filter(i => isRunObstacle(i.kind) && !i.done && i.z > w.distance - 1).sort((a, b) => a.z - b.z);
  const next = ahead[0]; if (!next) return;
  if (next.span === 3) { if (next.z - w.distance < w.speed * .28 + 1) w.action(next.kind === 'beam' ? 'slide' : 'jump'); return; }
  if (next.z - w.distance < Math.max(14, w.speed * .9)) {
    const blocked = ahead.filter(i => Math.abs(i.z - next.z) < .01).map(i => i.lane);
    const lane = [0, 1, 2].find(l => !blocked.includes(l));
    if (!w.turnWindow) { if (w.lane < lane) w.action('right'); else if (w.lane > lane) w.action('left'); }
  }
}
test('40 seeded courses are solvable for 3 km with bounded memory and keep corners clear', () => {
  for (let seed = 1; seed <= 40; seed++) {
    const w = new RunnerWorld(seed, 'endless', seed % 3); w.start(); let full = 0; const seen = new Set();
    for (let tick = 0; tick < 120 * 150 && w.phase === 'running' && w.distance < 3000; tick++) {
      for (const i of w.items) if (isRunObstacle(i.kind)) {
        for (const t of w.turns) assert.ok(i.z < t.z - 45 || i.z > t.z + 25, `seed ${seed}: obstacle ${i.z} near corner ${t.z}`);
        if (i.span === 3 && !seen.has(i.id)) { full++; seen.add(i.id); }
      }
      drive(w); w.advance(1 / 120);
    }
    assert.equal(w.phase, 'running', `seed ${seed}: ${w.reason} at ${Math.round(w.distance)}`);
    assert.ok(w.distance >= 3000); assert.ok(full > 10); assert.ok(w.items.length < 80); assert.ok(w.turns.length <= 3); assert.ok(w.turnCount >= 7);
  }
});

test('1000 m challenge stops for the laugh and can continue endlessly', () => {
  const w = new RunnerWorld(7); w.start();
  for (let tick = 0; tick < 120 * 80 && w.phase === 'running'; tick++) { drive(w); w.advance(1 / 120); }
  assert.equal(w.phase, 'won'); assert.equal(w.distance, 1000); run(w, 2); assert.equal(w.distance, 1000);
  w.continue(); w.advance(.1); assert.equal(w.phase, 'running'); assert.ok(w.distance > 1000);
});

test('capture pauses independently and settles after the animation or a skip', () => {
  const w = place('spikes'); run(w, .6); w.pause(); const snapshot = JSON.stringify(w); run(w, 10); assert.equal(JSON.stringify(w), snapshot);
  w.resume(); assert.equal(w.phase, 'caught'); run(w, 3); assert.equal(w.phase, 'lost');
  const skip = place('fire'); run(skip, .6); skip.finishCapture(); assert.equal(skip.phase, 'lost');
});

test('record parser rejects corrupt or foreign records', () => {
  for (const raw of [null, '{', '{}', '{"version":1,"distance":-2,"coins":0,"score":0}', '{"version":1,"distance":4.5,"coins":0,"score":0}', '{"version":9,"distance":5,"coins":3,"score":200}'])
    assert.deepEqual(readRunRecord(raw), { version: 1, distance: 0, coins: 0, score: 0 });
  assert.deepEqual(readRunRecord('{"version":1,"distance":1000,"coins":9,"score":10450,"extra":"x"}'), { version: 1, distance: 1000, coins: 9, score: 10450 });
});

test('scenes rotate every 450 m; weather is reproducible; night alternates after 1000 m', () => {
  assert.equal(sceneAt(0, 1), 1); assert.equal(sceneAt(450, 1), 2); assert.equal(sceneAt(900, 1), 0);
  const values = new Set(); for (let seed = 0; seed < 20; seed++) for (let d = 0; d < 6000; d += 300) { values.add(weatherAt(seed, d)); assert.equal(weatherAt(seed, d), weatherAt(seed, d + 1)); }
  assert.deepEqual([...values].sort(), ['rain', 'snow', 'sunny']);
  for (const [d, v] of [[999, false], [1000, true], [1499, true], [1500, false], [2000, true]]) assert.equal(nightAt(d), v);
});

test('dog animation: eight-frame gallop, jump/slide poses, frozen clock; chaser uses rear frames', () => {
  const w = new RunnerWorld(); w.start(); w.items = []; const frames = new Set();
  for (let i = 0; i < 70; i++) { w.advance(1 / 120); const pose = dogPose(w, false); assert.equal(pose.sheet, 'run'); frames.add(pose.frame); }
  assert.equal(frames.size, 8); w.action('jump'); w.advance(1 / 120); assert.deepEqual(dogPose(w, false), { sheet: 'actions', frame: 1 });
  run(w, 1); w.action('slide'); assert.deepEqual(dogPose(w, false), { sheet: 'actions', frame: 3 });
  w.pause(); const gait = w.gait; run(w, 4); assert.equal(w.gait, gait);
  const still = new RunnerWorld(); still.start(); assert.deepEqual(dogPose(still, true), { sheet: 'actions', frame: 0 });
  const c = new RunnerWorld(); c.start(); c.items = []; const rear = new Set(); for (let i = 0; i < 100; i++) { c.advance(1 / 120); rear.add(chaserFrame(c, false)); }
  assert.deepEqual([...rear].sort((a, b) => a - b), [4, 12]); assert.equal(chaserFrame(c, true), 4);
});

test('3D route has continuous rounded quarter-turns and bounded corner history', () => {
  const route = new RunnerRoute3D(); route.sync([{ z: 180, direction: 'right' }, { z: 360, direction: 'left' }], 0);
  assert.equal(route.sample(160).heading, 0); assert.ok(Math.abs(route.sample(200).heading - Math.PI / 2) < 1e-8);
  for (const at of [174, 180, 186, 354, 360, 366]) { const a = route.sample(at - .001), b = route.sample(at + .001); assert.ok(Math.hypot(a.x - b.x, a.z - b.z) < .01); }
  for (let d = 540; d < 10000; d += 180) route.sync([{ z: d, direction: 'left' }], d); assert.ok(route.storedCorners <= 4);
});

test('tilt calibration supports portrait/landscape, hysteresis and missing sensors', () => {
  const tilt = new RunnerTilt(); assert.equal(tilt.sample(null, 0, 0), null); assert.equal(tilt.sample(0, 0, 0), 1);
  for (let i = 0; i < 12; i++) tilt.sample(0, -25, 0); assert.equal(tilt.sample(0, -25, 0), 0); for (let i = 0; i < 15; i++) tilt.sample(0, 0, 0); assert.equal(tilt.sample(0, 0, 0), 1);
  assert.equal(tilt.sample(30, 0, 90), 1); for (let i = 0; i < 12; i++) tilt.sample(55, 0, 90); assert.equal(tilt.sample(55, 0, 90), 2); tilt.calibrate(); assert.equal(tilt.sample(55, 0, 90), 1);
});

test('characters are camera-facing flat drawings', () => {
  const engine = new NullEngine(); const scene = new Scene(engine);
  try {
    const dog = createRunnerSprite(scene, 'runner-milk-dog-2d', 2.1);
    assert.ok(dog.root.billboardMode > 0); assert.equal(dog.root.getTotalVertices(), 4); assert.ok(dog.root.getBoundingInfo().boundingBox.extendSize.x > 1);
  } finally { scene.dispose(); engine.dispose(); }
});

test('generated scenery and props retain their native PNG bytes', () => {
  const manifest = JSON.parse(fs.readFileSync(new URL('../public/assets/runner/manifest.json', import.meta.url), 'utf8'));
  assert.equal(manifest.nativeBytes, true); assert.equal(manifest.assets.length, 12);
  for (const asset of manifest.assets) {
    const bytes = fs.readFileSync(new URL('../public' + asset.url, import.meta.url));
    assert.equal(bytes.readUInt32BE(16), asset.width); assert.equal(bytes.readUInt32BE(20), asset.height);
    assert.equal(bytes.length, asset.bytes); assert.equal(bytes[25], asset.pngColorType);
    assert.equal(createHash('sha256').update(bytes).digest('hex'), asset.sha256);
  }
});
