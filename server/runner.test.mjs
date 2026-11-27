import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { RunnerWorld, BIKE_START, FRUIT_START, LONG_GAP_START, BRIDGE_FORK_BREAK, CHASE_START, CHASE_SECONDS, CHASE_START_GAP, CHASE_CATCH, FORK_BRIDGE_BREAK, FORK_CHANCE, SHAFT_EDGE, TURN_HINT_END, NEAR_SCORE, ROLL_START, ROLL_TRAVEL, ROLL_SPEED, readRunRecord, isRunObstacle, isRunPower, obstacleHalfDepth, weatherAt, nightAt, sceneAt, sceneWeather } from '../src/runner/world.ts';
import { CAPTURE_GRAB_AT, CAPTURE_LAUGH_AT, captureMotion, dogFall, dogPose, chaserFrame } from '../src/runner/animation.ts';
import { RunnerRoute3D } from '../src/runner/route3d.ts';
import { BRIDGE_TURNS, CART_LENGTH, BRIDGE_LENGTH, DOWNHILL_ROPE_LENGTH, elevationAt, riderHeightAt, ROPE_RELEASE_DISTANCE, sectionFeature, sectionIndexAt, sectionStart, sectionScene } from '../src/runner/course.ts';
import { RunnerTilt } from '../src/runner/tilt.ts';
import { readWardrobe, migrateLegacyWardrobe, canAfford, DOG_LOOKS } from '../src/runner/shop.ts';
import { completeMission, missionAt, missionDone, missionText, missionValue, readMissionBook, rewardText } from '../src/runner/missions.ts';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine.js';
import { Scene } from '@babylonjs/core/scene.js';
import { createRunnerSprite } from '../src/runner/actors2d.ts';

const run = (world, seconds) => { for (let i = 0; i < Math.round(seconds * 120); i++) world.advance(1 / 120); };
/** Moves a fresh world to `distance`, generating only the special stretches (and their corners) from there on. */
function skipTo(w, distance) {
  w.distance = distance; w.items = []; w.turns = [];
  w.nextRow = Infinity; w.nextTurn = Infinity; w.lastTurnZ = distance;
  w.nextFeatureSection = sectionIndexAt(distance);
  w.populate();
  return w;
}
/** Takes every corner the right way as soon as its window opens. */
const steer = w => { if (w.turnWindow) w.action(w.approachingTurn.direction); };
/** The first log bridge, rope or cart ride of the run. */
const firstFeature = kind => { for (let d = 0; ; d += 50) { const f = sectionFeature(d); if (f?.kind === kind) return f; } };
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
    assert.equal(first.span, undefined); assert.equal(first.kind, 'beam');
  }
});

test('a fallen log causes a recoverable stumble; jumping or dodging avoids it', () => {
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

test('two-lane fire and debris collide across both lanes and leave the third clear', () => {
  for (const kind of ['fire', 'spikes']) for (const lane of [0, 1]) {
    for (const hitLane of [lane, lane + 1]) {
      const hit = place(kind, { lane, span: 2 }); hit.lane = hit.position = hitLane; run(hit, .6);
      assert.equal(hit.phase, 'caught', `${kind} ${lane} hits lane ${hitLane}`);
    }
    const safe = place(kind, { lane, span: 2 }); safe.lane = safe.position = lane === 0 ? 2 : 0; run(safe, .6);
    assert.equal(safe.phase, 'running', `${kind} ${lane} leaves one lane clear`);
  }
});

test('a joined log hits either occupied lane as one recoverable obstacle', () => {
  for (const lane of [0, 1, 2]) {
    const w = place('block', { lane: 1, span: 2 });
    w.lane = w.position = lane;
    run(w, .6);
    assert.equal(w.phase, 'running');
    assert.equal(w.stumbles, lane === 0 ? 0 : 1);
  }
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

test('late-run currency starts at the new distances and diamonds use the rare roll', () => {
  const world = new RunnerWorld(22, 'endless'); world.items = [];
  const tierAt = (distance, roll) => {
    world.random = () => roll;
    world.addCoin(distance, 1);
    return world.items.pop().tier;
  };
  assert.equal(tierAt(1499.9, 0), 'silver');
  assert.equal(tierAt(1500, .05), 'gold');
  assert.equal(tierAt(1500, .2), 'silver');
  assert.equal(tierAt(2000, .2), 'gold');
  assert.equal(tierAt(3999.9, 0), 'gold');
  assert.equal(tierAt(4000, .00299), 'diamond');
  assert.equal(tierAt(4000, .003), 'gold');
  assert.equal(tierAt(6000, .99), 'silver');
  for (const [tier, points] of [['silver', 50], ['gold', 150], ['diamond', 1000]]) {
    const collected = place('coin', { tier }); run(collected, .6);
    assert.equal(collected[tier], 1); assert.equal(collected.coinScore, points);
  }
});

test('falling through a gap or trap plays the fall, while other hits do not', () => {
  for (const kind of ['gap', 'trap']) { const world = place(kind); run(world, .6); assert.equal(world.phase, 'caught'); assert.equal(world.trapFall, true); }
  for (const lane of [0, 1, 2]) {
    const world = place('trap', { span: 2, lane: 1 });
    world.lane = world.position = lane;
    run(world, .6);
    assert.equal(world.trapFall, lane !== 0);
  }
  const fire = place('fire'); run(fire, .6); assert.equal(fire.trapFall, false);
});

test('a long gap needs two jumps at both introduction and top speed, with or without slow time', () => {
  // 650 m is just after long pits begin, on the canal; 2600 m is in the bamboo grove.
  for (const z of [650, 2600]) for (const lane of [0, 1, 2]) for (const slow of [0, 5]) {
    const half = obstacleHalfDepth('long-gap', z), edge = z - half;
    const attempt = (double) => {
      const w = place('long-gap', { z, span: 3 });
      w.endless = true;
      w.slow = slow;
      w.lane = w.position = lane;
      w.distance = edge;
      w.distance -= w.speed * .13 / w.timeScale;
      w.nextRow = w.nextTurn = Infinity;
      w.action('jump'); run(w, .34 / w.timeScale);
      if (double) w.action('jump');
      run(w, .81 / w.timeScale);
      return w;
    };
    const single = attempt(false);
    assert.equal(single.phase, 'caught'); assert.equal(single.fallObstacle.kind, 'long-gap');
    assert.ok(single.distance > edge && single.distance < z + half);
    assert.ok(single.fallVelocity < 0);
    const double = attempt(true);
    assert.equal(double.phase, 'running'); assert.ok(double.distance > z + half);
  }
});

test('the wider ordinary fissure is still passable with one jump', () => {
  for (const z of [85, 2600]) {
    const w = place('gap', { z, span: 3 });
    w.endless = true; w.nextRow = w.nextTurn = w.nextFeatureSection = Infinity;
    const half = obstacleHalfDepth('gap', z);
    assert.equal(half * 2, 4.8);
    w.distance = z - half - w.speed * .12;
    w.action('jump');
    run(w, .65);
    assert.equal(w.phase, 'running');
    assert.ok(w.distance > z + half);
    assert.equal(w.jumpCount, 0);
  }
});

test('fall animation keeps the initial contact pose, decelerates forward and never drifts beyond the far lip', () => {
  const w = place('trap');
  while (w.phase === 'running') run(w, 1 / 120);
  const atContact = dogFall(w, false);
  assert.deepEqual(atContact, { forward: 0, drop: 0, roll: 0, frame: 0 });
  run(w, .15); const early = dogFall(w, false);
  run(w, .15); const later = dogFall(w, false);
  assert.ok(later.forward - early.forward < early.forward);
  assert.ok(later.drop - early.drop > early.drop);
  assert.ok(later.roll > 0 && later.frame > early.frame);
  assert.equal(dogFall(w, true).roll, 0);
  w.distance = w.fallObstacle.z + obstacleHalfDepth('trap', 0) - .1;
  assert.equal(dogFall(w, false).forward, 0);
});

test('QS 2027 shop includes both tied rank-100 schools and a sprite atlas for every look', () => {
  assert.equal(DOG_LOOKS.length, 102); assert.equal(new Set(DOG_LOOKS.map(look => look.id)).size, 102);
  assert.equal(DOG_LOOKS[0].name, 'Massachusetts Institute of Technology (MIT)');
  assert.deepEqual(DOG_LOOKS.slice(-2).map(look => [look.rank, look.name]), [['=100', 'Purdue University'], ['=100', 'University College Dublin']]);
  for (const look of DOG_LOOKS) { assert.match(look.color, /^#[0-9a-f]{6}$/i); assert.ok(fs.existsSync(`public${look.logo}`), look.logo); assert.ok(fs.existsSync(`public${look.sprite}`), look.sprite); }
  const spriteHashes = DOG_LOOKS.map(look => createHash('sha256').update(fs.readFileSync(`public${look.sprite}`)).digest('hex'));
  assert.equal(new Set(spriteHashes).size, DOG_LOOKS.length, 'every school has its own sprite atlas');
  const empty = readWardrobe(null); assert.deepEqual(empty.owned, ['original']); assert.equal(empty.equipped, 'original');
  const saved = readWardrobe(JSON.stringify({ version: 2, silver: 45, gold: 9, diamond: 0, owned: ['original', 'qs001', 'fake', 'qs001'], equipped: 'qs001' }));
  assert.deepEqual(saved.owned, ['original', 'qs001']); assert.equal(saved.equipped, 'qs001');
  assert.ok(canAfford(saved, { silver: 45 })); assert.ok(!canAfford(saved, { diamond: 1 }));
  assert.equal(readWardrobe(JSON.stringify({ ...saved, version: 2, silver: -1 })).silver, 0);
  const migrated = migrateLegacyWardrobe(JSON.stringify({ version: 1, silver: 7, gold: 4, diamond: 0, owned: ['sunny', 'mint', 'nebula'], equipped: 'mint' }));
  assert.deepEqual(migrated.owned, ['original']); assert.equal(migrated.equipped, 'original');
  assert.equal(migrated.silver, 52); assert.equal(migrated.diamond, 3);
});

test('QS prices use only the ranked currency, with equal prices for tied schools', () => {
  let previous;
  for (const look of DOG_LOOKS) {
    const rank = Number(look.rank.replace('=', ''));
    const currency = rank <= 30 || look.id === 'qs031' ? 'diamond' : rank <= 56 ? 'gold' : 'silver';
    assert.deepEqual(Object.keys(look.price), [currency]);
    const amount = look.price[currency];
    const wallet = { silver: 200, gold: 200, diamond: 200, [currency]: amount - 1 };
    assert.ok(amount > 0);
    assert.equal(canAfford(wallet, look.price), false);
    assert.equal(canAfford({ ...wallet, [currency]: amount }, look.price), true);
    if (previous) {
      assert.ok(rank >= previous.rank);
      if (rank === previous.rank) assert.equal(amount, previous.amount);
      if (currency === previous.currency) assert.ok(amount <= previous.amount);
    }
    previous = { rank, currency, amount };
  }
});

test('boost is faster, passes hazards, takes corners itself and expires', () => {
  const w = place('boost'); w.turns = [{ z: 30, direction: 'right', taken: false }];
  w.items.push({ id: 2, z: 15, lane: 1, kind: 'gap', done: false, span: 3 }); run(w, 1.5);
  assert.equal(w.phase, 'running'); assert.equal(w.turnCount, 1); assert.ok(w.speed > 18);
  w.items = []; run(w, 4); assert.equal(w.boost, 0);
});

test('hourglass slows running for five gameplay seconds and pauses with the game', () => {
  const w = place('slow', { z: .7 });
  run(w, .1);
  assert.equal(w.lastPower, 'slow'); assert.equal(w.timeScale, .7);
  assert.ok(w.slow > 4.9 && w.speed < 10);
  w.pause(); const held = w.slow; run(w, 2); assert.equal(w.slow, held);
  w.resume(); run(w, 5);
  assert.equal(w.slow, 0); assert.equal(w.timeScale, 1);
});

test('double score doubles running and coin points while leaving the wallet amount unchanged', () => {
  const withBonus = place('double', { z: .7 });
  const normal = place('coin'); normal.items = [];
  for (const w of [withBonus, normal]) {
    w.nextRow = w.nextTurn = Infinity;
    w.items.push({ id: 2, kind: 'coin', tier: 'gold', lane: 1, z: 4, done: false });
    run(w, .6);
  }
  assert.equal(withBonus.lastPower, 'double');
  assert.equal(withBonus.score, normal.score * 2);
  assert.equal(withBonus.gold, 1); assert.equal(withBonus.coins, 1);
  run(withBonus, 8); run(normal, 8);
  assert.equal(withBonus.double, 0);
  const difference = withBonus.score - normal.score;
  run(withBonus, 1); run(normal, 1);
  assert.equal(withBonus.score - normal.score, difference);
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
  // However big each step is, running past a corner never skips it.
  for (const speedUp of [1, 3, 7]) {
    const fast = skipTo(new RunnerWorld(1, 'endless'), 500 * speedUp); fast.start(); fast.items = [];
    fast.turns = [{ z: fast.distance + 20, direction: 'left', taken: false }];
    run(fast, 3); assert.equal(fast.reason, '冲出了弯道', `at ${fast.distance}`);
  }
});

test('forks: the wrong side runs onto the broken bridge and falls; the right side carries on', () => {
  const fork = (lane = 0) => {
    const w = new RunnerWorld(3); w.start(); w.nextRow = w.nextTurn = Infinity; w.lane = w.position = lane;
    w.items = [{ id: 1, kind: 'coin', lane: 1, z: 40, done: false }];
    w.turns = [{ z: 30, direction: 'right', taken: false, fork: true }];
    w.distance = 15;
    return w;
  };
  const wrong = fork();
  wrong.action('left');
  assert.equal(wrong.phase, 'running'); assert.equal(wrong.wrongTurn?.z, 30); assert.equal(wrong.turnCount, 0);
  run(wrong, .5);
  assert.equal(wrong.phase, 'running'); assert.equal(wrong.lane, 1, 'the dog lines up with the narrow bridge');
  while (wrong.phase === 'running' && wrong.distance < 60) wrong.advance(1 / 120);
  assert.equal(wrong.reason, '走上了断桥'); assert.equal(wrong.trapFall, true);
  assert.ok(Math.abs(wrong.distance - (30 + FORK_BRIDGE_BREAK)) < .5);
  assert.equal(wrong.coins, 0, 'nothing on the safe side is collected from the broken side');

  const right = fork(1);
  right.action('right'); assert.equal(right.turnCount, 1); assert.equal(right.wrongTurn, undefined);
  run(right, 2.5); assert.equal(right.phase, 'running'); assert.equal(right.coins, 1);

  // The golden fruit still steers round any corner, forks included.
  const golden = fork(); golden.fruit = 5; golden.action('left');
  assert.equal(golden.wrongTurn, undefined); assert.equal(golden.phase, 'running');
});

test('forks are common after the first corner and lay a coin trail into the safe side', () => {
  let corners = 0, forks = 0, bridgeCorners = 0, bridgeForks = 0, mineCorners = 0;
  for (let seed = 1; seed <= 60; seed++) {
    const w = new RunnerWorld(seed, 'endless'); w.start();
    const seen = [];
    for (let tick = 0; tick < 120 * 140 && w.phase === 'running' && w.distance < 2600; tick++) {
      for (const t of w.turns) if (!seen.some(s => s.z === t.z)) {
        seen.push(t);
        if (t.fork && !t.bridge) assert.equal(w.items.filter(i => i.kind === 'coin' && i.lane === 1 && i.z > t.z && i.z < t.z + 14).length >= 4, true);
      }
      drive(w); w.advance(1 / 120);
    }
    assert.equal(w.phase, 'running', `seed ${seed}: ${w.reason} at ${Math.round(w.distance)}`);
    assert.ok(!seen[0].fork, `seed ${seed}: the first corner is a plain one`);
    for (const t of seen.slice(1)) {
      if (t.bridge) { bridgeCorners++; if (t.fork) bridgeForks++; continue; }
      // Every mine corner is a three-way junction; the rest fork by chance.
      if (sceneAt(t.z) === 2) { mineCorners++; assert.ok(t.fork && t.three, `seed ${seed}: mine corner ${t.z}`); continue; }
      assert.ok(!t.three); corners++; if (t.fork) forks++;
    }
  }
  assert.ok(Math.abs(forks / corners - FORK_CHANCE) < .12, `fork share ${forks}/${corners}`);
  assert.ok(mineCorners > 30, `mine junctions ${mineCorners}`);
  assert.equal(bridgeCorners, 60 * BRIDGE_TURNS.length);
  assert.ok(bridgeForks >= 60 && bridgeForks < bridgeCorners, `bridge forks ${bridgeForks}/${bridgeCorners}`);
});

test('turn prompts stop after the middle of a run', () => {
  const w = new RunnerWorld(3);
  w.distance = TURN_HINT_END - 1; assert.equal(w.turnHints, true);
  w.distance = TURN_HINT_END; assert.equal(w.turnHints, false);
});

test('mine junctions: straight on drops into the shaft, the other side is a broken bridge', () => {
  // Past the minecart ride, on open mine road.
  const base = sectionStart([...Array(12).keys()].find(i => sectionScene(i) === 2)) + 450, z = base + 30;
  assert.equal(sceneAt(z), 2);
  const junction = (lane = 1) => {
    const w = skipTo(new RunnerWorld(3, 'endless'), base); w.start(); w.lane = w.position = lane;
    w.turns = [{ z, direction: 'left', taken: false, fork: true, three: true }];
    return w;
  };
  const straight = junction(0);
  while (straight.phase === 'running' && straight.distance < z + 30) straight.advance(1 / 120);
  assert.equal(straight.reason, '掉进了竖井'); assert.equal(straight.trapFall, true);
  assert.ok(Math.abs(straight.distance - (z + SHAFT_EDGE)) < .5);
  assert.equal(straight.lane, 1);
  const side = junction(); side.distance = z - 15; side.action('right');
  while (side.phase === 'running' && side.distance < z + 30) side.advance(1 / 120);
  assert.equal(side.reason, '走上了断桥');
  const safe = junction(); safe.distance = z - 15; safe.action('left'); run(safe, 2);
  assert.equal(safe.phase, 'running'); assert.equal(safe.turnCount, 1);
});

test('long frames are clamped and fixed steps prevent tunnelling', () => {
  const w = new RunnerWorld(); w.start(); w.advance(1000); assert.ok(w.distance < 1.5);
  const a = place('block'), b = place('block'); for (let i = 0; i < 12; i++) a.advance(.05); run(b, .6);
  assert.equal(a.danger > 0, b.danger > 0); assert.ok(Math.abs(a.distance - b.distance) < .12);
});

/** Simple bot that reads the course the way a player would. */
function drive(w) {
  const feature = w.upcomingFeature;
  if (feature?.kind === 'rope' && feature.start - w.distance < w.speed * .30 && !w.airborne) w.action('jump');
  if (feature?.kind === 'bridge' && feature.start - w.distance < 19 && w.lane !== 1) w.action(w.lane === 0 ? 'right' : 'left');
  const turn = w.approachingTurn; if (turn && w.turnWindow && turn.z - w.distance <= 12) w.action(turn.direction);
  const ahead = w.items.filter(i => isRunObstacle(i.kind) && !i.done && i.z + obstacleHalfDepth(i.kind, i.z) >= w.distance).sort((a, b) => a.z - b.z);
  const next = ahead[0]; if (!next) return;
  if (w.bridge && next.kind !== 'bridge-branch') return;
  if (next.kind === 'long-gap') {
    const toLip = next.z - obstacleHalfDepth(next.kind, next.z) - w.distance;
    if ((w.jumpCount === 0 && toLip < w.speed * .13) || (w.jumpCount === 1 && w.jump < .3)) w.action('jump');
    return;
  }
  if (next.span === 3) { if (next.z - w.distance < w.speed * .28 + 1) w.action(next.kind === 'beam' ? 'slide' : 'jump'); return; }
  if (next.z - w.distance < Math.max(14, w.speed * .9)) {
    const blocked = ahead.filter(i => Math.abs(i.z - next.z) < .01).flatMap(i => i.span === 2 ? [i.lane, i.lane + 1] : [i.lane]);
    const lane = [0, 1, 2].find(l => !blocked.includes(l));
    if (!w.turnWindow) { if (w.lane < lane) w.action('right'); else if (w.lane > lane) w.action('left'); }
  }
}
test('40 seeded courses are solvable for 3 km with bounded memory and keep corners clear', () => {
  let sawJoinedLogs = false, rolling = 0, nearMisses = 0;
  for (let seed = 1; seed <= 40; seed++) {
    const w = new RunnerWorld(seed, 'endless'); w.start(); let full = 0, long = 0; const seen = new Set();
    const earlyPickups = new Set();
    // The log bridge lays all its coins at once, so the item list peaks just before it.
    let maxItems = 0;
    for (let tick = 0; tick < 120 * 150 && w.phase === 'running' && w.distance < 3000; tick++) {
      maxItems = Math.max(maxItems, w.items.length);
      for (const i of w.items) {
        if (i.z < 1500 && (i.kind === 'slow' || i.kind === 'double')) earlyPickups.add(i.kind);
        if (!isRunObstacle(i.kind)) continue;
        // A rolling boulder or cart the dog got past keeps rolling away behind it.
        if (!(i.roll && i.done)) for (const t of w.turns) assert.ok(i.z < t.z - 45 || i.z > t.z + 25, `seed ${seed}: obstacle ${i.z} near corner ${t.z}`);
        if (i.span === 2 && i.kind === 'block') sawJoinedLogs = true;
        if (!seen.has(i.id)) {
          if (i.kind === 'long-gap') { assert.ok(i.z - obstacleHalfDepth(i.kind, i.z) >= LONG_GAP_START); assert.equal(i.span, 3); long++; }
          if (i.span === undefined) assert.ok(i.kind === 'beam' || i.kind === 'boulder' || i.kind === 'runaway-cart', `unexpected single-lane ${i.kind}`);
          if (i.roll) { rolling++; assert.ok([1, 2, 4, 5].includes(sceneAt(i.z)) && i.z >= ROLL_START, `seed ${seed}: ${i.kind} rolls at ${Math.round(i.z)}`); }
          if (i.kind === 'runaway-cart') assert.equal(sceneAt(i.z), 2);
          if (i.span === 3) full++;
          seen.add(i.id);
        }
      }
      drive(w); w.advance(1 / 120);
    }
    assert.equal(w.phase, 'running', `seed ${seed}: ${w.reason} at ${Math.round(w.distance)}`);
    assert.ok(w.distance >= 3000); assert.ok(full > 10); assert.ok(long >= 5); assert.ok(w.items.length < 80); assert.ok(w.turns.length <= 3); assert.ok(w.turnCount >= 7);
    assert.ok(maxItems < 140, `seed ${seed}: at most ${maxItems} items at once`);
    assert.equal(earlyPickups.size, 2, `seed ${seed}: both new pickups appear before 1500m`);
    // The canal zipline, the log bridge and the mine cart all come before 3 km.
    assert.ok(w.ridesDone >= 3, `seed ${seed}: finished ${w.ridesDone} rides`);
    assert.ok(w.forksCleared >= 1, `seed ${seed}: took ${w.forksCleared} forks the right way`);
    nearMisses += w.nearMisses;
  }
  assert.ok(sawJoinedLogs);
  // The temple and the mine both come before 3 km: boulders roll and carts run away on most courses.
  assert.ok(rolling >= 40, `${rolling} rolling hazards on 40 courses`);
  // The bot reacts late on purpose (as late as a player might), so it scrapes past a good many.
  assert.ok(nearMisses > 40, `${nearMisses} near misses`);
});

test('chase mode: a clean run catches the frog on the snowfield and in the canyon before time runs out', () => {
  let wins = 0, throws = 0;
  for (let seed = 1; seed <= 12; seed++) {
    const w = new RunnerWorld(seed, 'chase');
    assert.equal(w.distance, CHASE_START); assert.equal(sceneAt(w.distance), 5); assert.equal(w.runDistance, 0);
    assert.equal(w.night, false); assert.equal(w.chase.gap, CHASE_START_GAP); assert.equal(w.chase.timeLeft, CHASE_SECONDS);
    w.start();
    for (let tick = 0; tick < 120 * (CHASE_SECONDS + 5) && w.phase === 'running'; tick++) { drive(w); w.advance(1 / 120); }
    assert.notEqual(w.phase, 'caught', `seed ${seed}: ${w.reason} at ${Math.round(w.runDistance)} m`);
    if (w.phase === 'won') {
      wins++;
      assert.ok(w.chase.gap <= CHASE_CATCH + .01); assert.ok(w.chase.timeLeft > 0);
      assert.ok(w.score >= Math.floor(w.runDistance) * 10 + 2000, 'catching the frog pays a bonus');
      assert.ok([5, 4].includes(sceneAt(w.distance)), 'the chase stays on the snowfield and in the canyon');
    }
    throws += w.chase.throws;
    // No long pits in the chase, and nothing rolls at the dog there: the frog's crates are enough.
    assert.ok(!w.items.some(i => i.kind === 'long-gap'));
    assert.equal(w.rollsStarted, 0); assert.ok(!w.items.some(i => i.roll));
  }
  assert.ok(wins >= 10, `caught the frog in ${wins} of 12`);
  assert.ok(throws > 12, `the frog threw ${throws} crates`);
});

test('chase mode: knocks let the frog get away instead of catching the dog; time running out ends the chase', () => {
  const w = new RunnerWorld(3, 'chase'); w.start(); w.nextRow = w.nextTurn = Infinity; w.turns = []; w.chase.nextThrow = Infinity;
  w.items = [{ id: 1, z: w.distance + 5, lane: 1, kind: 'block', done: false }, { id: 2, z: w.distance + 32, lane: 1, kind: 'crate', done: false }];
  const gap = w.chase.gap; run(w, 2.6);
  assert.equal(w.phase, 'running', 'two knocks in a row are not fatal in the chase');
  assert.equal(w.stumbles, 2); assert.equal(w.danger, 0);
  assert.ok(w.chase.gap > gap + 15, `the frog pulled away to ${w.chase.gap}`);
  w.chase.timeLeft = .05; run(w, .2);
  assert.equal(w.phase, 'lost'); assert.equal(w.chase.escaped, true); assert.equal(w.reason, '奶蛙带着金苹果跑掉了');
  // Crates land between the dog and the frog, in the frog's lane.
  const thrower = new RunnerWorld(4, 'chase'); thrower.start(); thrower.nextRow = Infinity; thrower.items = []; thrower.chase.nextThrow = 0;
  thrower.advance(1 / 120);
  const crate = thrower.items.find(i => i.kind === 'crate');
  assert.ok(crate && crate.z > thrower.distance && crate.z < thrower.distance + thrower.chase.gap && crate.lane === thrower.chase.lane);
});

test('steering into the side of the road stumbles the dog and sets the frog on it', () => {
  const w = new RunnerWorld(2); w.start(); w.items = []; w.turns = []; w.nextRow = w.nextTurn = Infinity;
  w.lane = w.position = 0; w.action('left');
  assert.equal(w.wallBumps, 1); assert.equal(w.wallSide, -1); assert.ok(w.danger > 0); assert.equal(w.lane, 0); assert.equal(w.phase, 'running');
  w.action('left'); assert.equal(w.wallBumps, 1, 'a second press during the knock does not count twice');
  run(w, 1.2); w.lane = w.position = 2; w.action('right');
  assert.equal(w.phase, 'caught'); assert.equal(w.reason, '撞墙后被恐怖奶蛙抓住了');
  // No bumps while invincible, on the log bridge, or in the chase (where the frog just gains ground).
  const golden = new RunnerWorld(2); golden.start(); golden.fruit = 5; golden.lane = golden.position = 0; golden.action('left'); assert.equal(golden.wallBumps, 0);
  const bridge = firstFeature('bridge'), onBridge = skipTo(new RunnerWorld(2, 'endless'), bridge.start + 10); onBridge.start();
  onBridge.lane = onBridge.position = 2; onBridge.action('right'); assert.equal(onBridge.wallBumps, 0);
  const chase = new RunnerWorld(2, 'chase'); chase.start(); chase.lane = chase.position = 2; const gap = chase.chase.gap;
  chase.action('right'); assert.equal(chase.wallBumps, 1); assert.ok(chase.chase.gap > gap + 4); assert.equal(chase.danger, 0);
});

test('near misses: dodging in the last moment scores; an early dodge, a hit or invincibility does not', () => {
  /** Runs until the obstacle's near face is `metres` ahead. */
  const closeTo = (w, metres) => { while (w.items[0].z - w.distance - obstacleHalfDepth(w.items[0].kind, w.items[0].z) > metres) w.advance(1 / 120); };
  const late = place('block', { span: 2, z: 20 }); closeTo(late, 2.5); late.action('left'); run(late, 1.5);
  assert.equal(late.phase, 'running'); assert.equal(late.stumbles, 0);
  assert.equal(late.nearMisses, 1); assert.equal(late.nearScore, NEAR_SCORE); assert.equal(late.nearKind, 'block');
  assert.equal(late.score, Math.floor(late.runDistance) * 10 + late.coinScore + NEAR_SCORE, 'near misses add to the score');
  const leap = place('block', { span: 3, z: 20 }); closeTo(leap, 2.5); leap.action('jump'); run(leap, 1.5);
  assert.equal(leap.phase, 'running'); assert.equal(leap.nearMisses, 1, 'a late jump over a whole-road log counts');
  const duck = place('beam', { span: 3, z: 20 }); closeTo(duck, 2); duck.action('slide'); run(duck, 1.5);
  assert.equal(duck.phase, 'running'); assert.equal(duck.nearMisses, 1, 'so does a late slide under a gate');
  const early = place('block', { span: 2, z: 20 }); early.action('left'); run(early, 1.5);
  assert.equal(early.nearMisses, 0, 'an early dodge is just a dodge');
  const hit = place('block', { span: 2, z: 20 }); run(hit, 1.5);
  assert.equal(hit.stumbles, 1); assert.equal(hit.nearMisses, 0);
  const golden = place('block', { span: 2, z: 20 }); golden.fruit = 10; run(golden, 1.5);
  assert.equal(golden.nearMisses, 0, 'nothing is close while invincible');
  // A near miss keeps the coin streak going and builds it up.
  const streak = place('block', { span: 2, z: 20 }); streak.streak = 9; streak.streakTimer = 4; closeTo(streak, 2.5); streak.action('left'); run(streak, .5);
  assert.equal(streak.multiplier, 2); assert.equal(streak.nearScore, NEAR_SCORE);
});

test('boulders and runaway carts set off toward the dog and are met about where a still one would be', () => {
  const meet = (kind, lane = 1) => {
    const w = place(kind, { z: 60 + ROLL_TRAVEL, roll: ROLL_SPEED[kind], lane }), rolling = w.items[0];
    let started;
    for (let i = 0; i < 120 * 8 && w.phase === 'running' && w.distance < 90; i++) {
      w.advance(1 / 120);
      if (started === undefined && rolling.rollFrom !== undefined) started = w.distance;
    }
    return { w, started, rolling };
  };
  const { w: boulder, started } = meet('boulder');
  assert.ok(started > 35 && started < 45, `set off when the dog was at ${started}`);
  assert.equal(boulder.phase, 'caught'); assert.equal(boulder.reason, '被滚来的巨石撞倒了'); assert.equal(boulder.rollsStarted, 1);
  assert.ok(Math.abs(boulder.distance - 60) < 2.5, `met at ${boulder.distance}`);
  const { w: cart } = meet('runaway-cart');
  assert.equal(cart.reason, '被失控的矿车撞飞了'); assert.ok(Math.abs(cart.distance - 60) < 2.5);
  // In another lane it rolls on past the dog and away behind it.
  const { w: aside, rolling } = meet('boulder', 0);
  assert.equal(aside.phase, 'running'); assert.ok(rolling.z < 58 && rolling.done, `rolled on behind the dog to ${rolling.z}`);
  assert.ok(!aside.items.includes(rolling), 'and is dropped once well behind');
  // The snowfield's boulders are giant snowballs.
  const snow = skipTo(new RunnerWorld(5, 'endless'), CHASE_START + 20); snow.start();
  snow.items = [{ id: 1, kind: 'boulder', lane: 1, z: snow.distance + 50, roll: ROLL_SPEED.boulder, done: false }];
  run(snow, 4); assert.equal(snow.reason, '被滚下来的大雪球撞倒了');
});

test('run tallies count second jumps and slides for missions', () => {
  const w = new RunnerWorld(3); w.start(); w.items = []; w.turns = []; w.nextRow = w.nextTurn = Infinity;
  w.action('jump'); w.action('jump'); w.action('jump'); assert.equal(w.doubleJumps, 1);
  run(w, 1); w.action('slide'); w.action('slide'); assert.equal(w.slides, 1, 'pressing again mid-slide is one slide');
  run(w, 1); w.action('slide'); assert.equal(w.slides, 2);
});

test('capture pauses independently and settles after the animation or a skip', () => {
  const w = place('spikes'); run(w, .6); w.pause(); const snapshot = JSON.stringify(w); run(w, 10); assert.equal(JSON.stringify(w), snapshot);
  w.resume(); assert.equal(w.phase, 'caught'); run(w, 3); assert.equal(w.phase, 'lost');
  const skip = place('fire'); run(skip, .6); skip.finishCapture(); assert.equal(skip.phase, 'lost');
});

test('capture keeps the last running pose before contact and lifts the dog before the laugh', () => {
  const w = place('beam', { span: 3 });
  while (w.phase === 'running') run(w, 1 / 120);
  assert.equal(w.captureTime, 0);
  assert.equal(dogPose(w, false).sheet, 'run');
  assert.equal(captureMotion(0, false).orbit, 0);
  w.captureTime = .2;
  assert.equal(dogPose(w, false).frame, 3);
  assert.equal(captureMotion(CAPTURE_GRAB_AT, false).height, 0);
  w.captureTime = .65;
  assert.equal(dogPose(w, false).frame, 2);
  assert.ok(captureMotion(.65, false).height > .32);
  assert.ok(captureMotion(CAPTURE_LAUGH_AT, false).height >= .8 && captureMotion(CAPTURE_LAUGH_AT, false).height <= .94);
  w.pause();
  assert.equal(dogPose(w, false).frame, 2);
  assert.equal(captureMotion(w.captureTime, true).tilt, 0);
  assert.equal(captureMotion(2.4, false).orbit, 1);
});

test('missions: three at a time, dealt in order, repeating harder after the opening list', () => {
  const fresh = readMissionBook(null);
  assert.deepEqual(fresh, { version: 1, next: 3, active: [0, 1, 2], completed: 0 });
  for (const raw of ['{"version":2}', '{"version":1,"next":3,"active":[0,1],"completed":0}', '{"version":1,"next":3,"active":[0,0,1],"completed":0}', '{"version":1,"next":2,"active":[0,1,2],"completed":0}', '{"version":1,"next":3,"active":[0,1,-2],"completed":0}', 'nope'])
    assert.deepEqual(readMissionBook(raw), fresh, raw);
  const after = completeMission(fresh, 1);
  assert.deepEqual(after, { version: 1, next: 4, active: [0, 3, 2], completed: 1 });
  assert.deepEqual(readMissionBook(JSON.stringify(after)), after);
  // Every mission reads as a sentence, pays something, and later rounds ask for more.
  for (let i = 0; i < 80; i++) {
    const mission = missionAt(i);
    assert.ok(missionText(mission).length > 3 && rewardText(mission.reward).length > 2, `mission ${i}`);
    assert.ok(mission.target > 0);
  }
  const later = (kind, from) => { for (let i = from; ; i++) if (missionAt(i).kind === kind) return missionAt(i); };
  assert.ok(later('near', 40).target < later('near', 80).target);
  assert.equal(rewardText({ gold: 3 }), '3 金币'); assert.equal(rewardText({ silver: 40, diamond: 1 }), '40 银币 · 1 钻石');
});

test('missions count a run the way it was played', () => {
  const w = new RunnerWorld(7, 'endless'); w.start();
  for (let tick = 0; tick < 120 * 60 && w.phase === 'running'; tick++) { drive(w); w.advance(1 / 120); }
  const stats = { mode: 'endless', distance: w.runDistance, silver: w.silver, gold: w.gold, score: w.score, nearMisses: w.nearMisses, doubleJumps: w.doubleJumps, slides: w.slides, forksCleared: w.forksCleared, ridesDone: w.ridesDone, powers: w.powerPicked, shieldSaves: w.shieldSaves, bestMultiplier: w.bestMultiplier, won: false, timeLeft: 0 };
  assert.equal(missionValue(missionAt(0), stats), Math.floor(w.runDistance));
  assert.equal(missionDone({ kind: 'distance', target: 500, reward: {} }, stats), w.runDistance >= 500);
  assert.equal(missionValue({ kind: 'distance', target: 500, reward: {} }, { ...stats, mode: 'chase' }), 0, 'distance missions are for endless runs');
  assert.equal(missionValue({ kind: 'chase-win', target: 1, reward: {} }, stats), 0);
  assert.equal(missionValue({ kind: 'chase-time', target: 20, reward: {} }, { ...stats, mode: 'chase', won: true, timeLeft: 24.6 }), 24);
  for (const [kind, value] of [['slide', w.slides], ['near', w.nearMisses], ['multiplier', w.bestMultiplier], ['silver', w.silver], ['powers', w.powerPicked], ['score', w.score]])
    assert.equal(missionValue({ kind, target: 1, reward: {} }, stats), value, kind);
  assert.ok(w.runDistance > 500 && w.bestMultiplier >= 1);
});

test('record parser rejects corrupt or foreign records', () => {
  for (const raw of [null, '{', '{}', '{"version":1,"distance":-2,"coins":0,"score":0}', '{"version":1,"distance":4.5,"coins":0,"score":0}', '{"version":9,"distance":5,"coins":3,"score":200}'])
    assert.deepEqual(readRunRecord(raw), { version: 1, distance: 0, coins: 0, score: 0 });
  assert.deepEqual(readRunRecord('{"version":1,"distance":1000,"coins":9,"score":10450,"extra":"x"}'), { version: 1, distance: 1000, coins: 9, score: 10450 });
});

test('scenes follow one itinerary; snow comes half as often; weather is reproducible; night alternates after 1000 m', () => {
  for (const [d, scene] of [[0, 0], [699, 0], [700, 1], [1559, 1], [1560, 2], [2560, 3], [3260, 5], [4020, 4], [4720, 0]]) assert.equal(sceneAt(d), scene, `at ${d} m`);
  const visits = [0, 0, 0, 0, 0, 0], metres = [0, 0, 0, 0, 0, 0];
  for (let i = 0; i < 44; i++) { visits[sectionScene(i)]++; metres[sectionScene(i)] += sectionStart(i + 1) - sectionStart(i); }
  for (const scene of [0, 1, 2, 3, 4]) assert.equal(visits[scene], visits[5] * 2);
  assert.ok(metres[2] / visits[2] > metres[0] / visits[0], 'the mine runs longer than the canal');
  for (let i = 0; i < 44; i++) for (const d of [sectionStart(i) - .01, sectionStart(i) + .01]) assert.ok(Number.isFinite(elevationAt(d)));
  assert.equal(sceneWeather(5, 'sunny'), 'snow'); assert.equal(sceneWeather(2, 'rain'), 'sunny'); assert.equal(sceneWeather(4, 'snow'), 'sunny'); assert.equal(sceneWeather(1, 'rain'), 'rain');
  const values = new Set(); for (let seed = 0; seed < 20; seed++) for (let d = 0; d < 6000; d += 300) { values.add(weatherAt(seed, d)); assert.equal(weatherAt(seed, d), weatherAt(seed, d + 1)); }
  assert.deepEqual([...values].sort(), ['rain', 'snow', 'sunny']);
  for (const [d, v] of [[999, false], [1000, true], [1499, true], [2499, true], [2500, false], [3099, false], [3100, true]]) assert.equal(nightAt(d), v);
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

test('the broken side of a fork mirrors the bend and runs straight out the other way', () => {
  const route = new RunnerRoute3D(); route.sync([{ z: 180, direction: 'right' }], 0);
  const corner = route.corner(180);
  for (const at of [150, 169]) { const a = route.branch(at, 180, 'left'), b = route.sample(at); assert.ok(Math.hypot(a.x - b.x, a.z - b.z) < 1e-9 && Math.abs(a.heading - b.heading) < 1e-9); }
  for (const at of [169, 175, 180, 186, 191]) { const a = route.branch(at - .001, 180, 'left'), b = route.branch(at + .001, 180, 'left'); assert.ok(Math.hypot(a.x - b.x, a.z - b.z) < .01); }
  const out = route.branch(200, 180, 'left');
  assert.ok(Math.abs(out.heading + Math.PI / 2) < 1e-9);
  assert.ok(Math.abs(out.x - (corner.x - 20)) < 1e-9 && Math.abs(out.z - corner.z) < 1e-9);
  const safe = route.sample(200);
  assert.ok(Math.abs(safe.x - (corner.x + 20)) < 1e-9, 'the safe side goes the opposite way');
});

test('terrain rises and falls continuously and stays level across scene boundaries', () => {
  const route = new RunnerRoute3D();
  assert.equal(route.sample(140).y, elevationAt(140));
  assert.ok(route.sample(88).y > route.sample(50).y);
  assert.ok(route.sample(196).y > route.sample(252).y);
  for (const z of [45, 120, 157, 270, 430, 520, 700, 1560, 2560, 3260, 4020, 4720]) assert.ok(Math.abs(elevationAt(z + .01) - elevationAt(z - .01)) < .001);
  // The sea crossing and the mine gallery are level.
  const bridge = firstFeature('bridge');
  for (let d = bridge.start - 20; d <= bridge.end + 20; d += 5) assert.equal(elevationAt(d), 0);
  const mine = sectionStart([...Array(12).keys()].find(i => sectionScene(i) === 2));
  for (let d = mine; d < mine + 1000; d += 10) assert.equal(elevationAt(d), 0);
});

test('the aqueduct requires grabbing the rope, and the rope can be steered and exited', () => {
  const use = jump => {
    const w = new RunnerWorld(9, 'endless');
    const rope = sectionFeature(0);
    assert.equal(rope.kind, 'rope');
    w.start(); w.distance = rope.start - 4;
    if (jump) w.action('jump');
    run(w, .35);
    return { w, rope };
  };
  const missed = use(false).w;
  assert.equal(missed.phase, 'caught');
  assert.equal(missed.reason, '没抓住绳索');
  assert.equal(missed.trapFall, true);
  const { w, rope } = use(true);
  assert.equal(w.ride.kind, 'rope');
  w.action('left'); run(w, .4); assert.equal(w.lane, 0);
  assert.ok(w.jumpHeight > .5);
  w.action('jump'); assert.equal(w.jumpCount, 0);
  while (w.distance < rope.end && w.phase === 'running') w.advance(1 / 120);
  assert.equal(w.phase, 'running');
  assert.equal(w.ride, undefined);
  assert.equal(w.jumpHeight, 0);
  assert.ok(Number.isFinite(w.ropeLandedAt));
  assert.equal(sectionFeature(900).kind, 'bridge');
});

test('the longer minecart ride has seven rockfalls and corners stay beyond the exit', () => {
  const cart = firstFeature('cart');
  const board = () => {
    const w = skipTo(new RunnerWorld(5, 'endless'), cart.start - 2);
    w.start(); run(w, .27);
    assert.equal(w.ride.kind, 'cart');
    return w;
  };
  const blocked = board();
  run(blocked, 1.6);
  assert.equal(blocked.reason, '矿车撞上了塌方');
  const w = board();
  assert.equal(cart.end - cart.start, CART_LENGTH);
  assert.equal(w.items.filter(item => item.kind === 'cart-block').length, 7);
  while (w.distance < cart.end && w.phase === 'running') { drive(w); w.advance(1 / 120); }
  assert.equal(w.phase, 'running');
  assert.equal(w.ride, undefined);
  // The ride comes late enough in the run to go at nearly top speed.
  assert.ok(w.elapsed > 5.5, `ride lasted ${w.elapsed}s`);
  assert.ok(w.coins >= 24);
  // A corner that would fall during the ride waits until past the exit.
  assert.equal(w.turnOutsideFeature(cart.start + 20, cart.start - 200), cart.end + 34);
});

test('canyon and snowfield ziplines drop from a high ledge to the valley floor and can be ridden', () => {
  const ropes = [];
  for (let d = 0; d < 6000 && ropes.length < 3; d += 50) { const f = sectionFeature(d); if (f?.kind === 'rope' && sceneAt(f.start) !== 0 && !ropes.some(r => r.start === f.start)) ropes.push(f); }
  assert.deepEqual(ropes.map(r => sceneAt(r.start)).slice(0, 2), [5, 4]);
  for (const rope of ropes) {
    assert.equal(rope.end - rope.start, DOWNHILL_ROPE_LENGTH);
    assert.ok(elevationAt(rope.start) > 8 && elevationAt(rope.end) < .5, 'from a high ledge down to the floor');
    // From the moment the dog has hold of the handle (after the grab, it is lifted to the cable).
    let previous = Infinity;
    for (let z = rope.start; z <= rope.end; z += 1) {
      assert.ok(riderHeightAt(z, rope) >= 0);
      if (z < rope.start + 6) continue;
      const height = riderHeightAt(z, rope) + elevationAt(z);
      assert.ok(height <= previous + .2, `the dog keeps going down at ${z - rope.start} m`); previous = height;
    }
    const w = skipTo(new RunnerWorld(11, 'endless'), rope.start - 30); w.start(); w.lane = w.position = 1;
    while (w.distance < rope.end + 5 && w.phase === 'running') { drive(w); w.advance(1 / 120); }
    // The bot hangs straight on, so it collects the middle line of coins: all six of them sit at reach.
    assert.equal(w.phase, 'running', w.reason); assert.equal(w.ride, undefined); assert.equal(w.coins, 6);
    const missed = skipTo(new RunnerWorld(11, 'endless'), rope.start - 4); missed.start(); run(missed, .5);
    assert.equal(missed.reason, '没抓住绳索'); assert.match(missed.deathHint, /崖边/);
  }
});

test('rope preserves the initial jump height and releases onto the deck with a descending arc', () => {
  const rope = sectionFeature(0, 0);
  assert.equal(riderHeightAt(rope.start, rope, .54, .19), .54);
  assert.ok(riderHeightAt(rope.start + .2, rope, .54, .19) > .56);
  const release = rope.end - ROPE_RELEASE_DISTANCE;
  assert.ok(Math.abs(riderHeightAt(release - .001, rope) - riderHeightAt(release + .001, rope)) < .01);
  assert.ok(riderHeightAt(release + 2, rope) > riderHeightAt(release + 6, rope));
  assert.equal(riderHeightAt(rope.end, rope), 0);
});

test('the long log bridge over the sea: stay in the middle, jump three branches, take its corners', () => {
  const bridge = firstFeature('bridge');
  const approach = (lane, seed = 5) => {
    const w = skipTo(new RunnerWorld(seed, 'endless'), bridge.start - 4);
    w.start(); w.lane = w.position = lane;
    return w;
  };
  const edge = approach(2); run(edge, .6);
  assert.equal(edge.reason, '掉下了独木桥'); assert.equal(edge.trapFall, true);
  const branch = approach(1);
  const branchZ = branch.items.filter(item => item.kind === 'bridge-branch').map(item => item.z).sort((a, b) => a - b);
  while (branch.distance < branchZ[0] + 1 && branch.phase === 'running') { steer(branch); branch.advance(1 / 120); }
  assert.equal(branch.phase, 'running');
  assert.equal(branch.stumbles, 1); assert.ok(branch.danger > 0);
  assert.equal(branch.lane, 1);
  // The next branch comes round within the eight seconds the frog stays close.
  while (branch.phase === 'running' && branch.distance < branchZ[1] + 1) { steer(branch); branch.advance(1 / 120); }
  assert.equal(branch.reason, '被恐怖奶蛙抓住了');

  const clear = approach(1);
  assert.equal(bridge.end - bridge.start, BRIDGE_LENGTH);
  assert.equal(clear.items.filter(item => item.kind === 'bridge-branch').length, 3);
  const corners = new Set();
  while (clear.distance < bridge.end && clear.phase === 'running') {
    for (const t of clear.turns) if (t.bridge) corners.add(t.z);
    drive(clear); clear.advance(1 / 120);
  }
  assert.equal(clear.phase, 'running');
  assert.equal(clear.bridge, undefined);
  assert.deepEqual([...corners].sort((a, b) => a - b), BRIDGE_TURNS.map(offset => bridge.start + offset));
  assert.equal(clear.turnCount, BRIDGE_TURNS.length);

  // Running straight on at a corner, or turning the wrong way where the log does not split, ends in the sea.
  const corner = bridge.start + BRIDGE_TURNS[0];
  const missed = approach(1); missed.items = [];
  while (missed.phase === 'running') missed.advance(1 / 120);
  assert.equal(missed.reason, '冲出了独木桥'); assert.equal(missed.trapFall, true);
  assert.ok(Math.abs(missed.distance - (corner + 1.5)) < .5);
  for (let seed = 1; seed < 40; seed++) {
    const w = approach(1, seed); w.items = [];
    const turn = w.turns.find(t => t.z === corner);
    w.distance = corner - 10;
    w.action(turn.direction === 'left' ? 'right' : 'left');
    if (!turn.fork) { assert.equal(w.reason, '转错了方向'); assert.equal(w.trapFall, true); continue; }
    // Where it does split, the other log has broken off.
    assert.equal(w.phase, 'running'); assert.equal(w.wrongTurn, turn);
    while (w.phase === 'running') w.advance(1 / 120);
    assert.equal(w.reason, '走上了断掉的独木桥');
    assert.ok(Math.abs(w.distance - (corner + BRIDGE_FORK_BREAK)) < .5);
  }
});

test('bicycle clears logs and debris and leaves low gates and pits dangerous', () => {
  for (const kind of ['block', 'spikes', 'beam', 'gap']) {
    const w = place('bike', { z: .7 });
    w.items.push({ id: 2, kind, lane: 1, z: 5, span: 3, done: false });
    run(w, .6);
    assert.equal(w.bike > 8, true);
    assert.equal(w.phase, ['block', 'spikes'].includes(kind) ? 'running' : 'caught');
  }
});

test('golden fruit attracts coins, doubles scores, protects against obstacles and runs for 15 seconds', () => {
  const w = place('fruit', { z: .7 });
  w.nextTurn = w.nextRow = w.nextFeatureSection = Infinity;
  w.turns = [{ z: 34, direction: 'right', taken: false }];
  w.items.push({ id: 2, z: 4.7, lane: 0, kind: 'coin', done: false }, { id: 3, z: 7, lane: 1, span: 3, kind: 'gap', done: false });
  while (w.fruit === 0) w.advance(1 / 120);
  assert.equal(w.fruit, 15);
  run(w, 1.6);
  assert.equal(w.phase, 'running'); assert.equal(w.coins, 1); assert.equal(w.coinScore, 100); assert.equal(w.turnCount, 1);
  assert.ok(w.score >= Math.floor(w.distance) * 19);
  w.distance = 260;
  w.items = []; w.turns = [];
  run(w, 13.42);
  assert.equal(w.fruit, 0); assert.equal(w.invincible, false);
});

test('bicycle and golden fruit stay rare and only generate in eligible sections', () => {
  const pickups = [];
  for (let seed = 1; seed <= 60; seed++) {
    const w = new RunnerWorld(seed, 'endless', seed % 3);
    w.distance = 6800; w.populate();
    const powers = w.items.filter(item => isRunPower(item.kind) && item.z >= BIKE_START);
    pickups.push(...powers.map(item => item.kind));
    assert.ok(w.items.filter(item => item.kind === 'fruit').every(item => item.z >= FRUIT_START && sceneAt(item.z, w.startScene) !== 2));
    assert.ok(w.items.filter(item => item.kind === 'bike').every(item => item.z >= BIKE_START));
  }
  const rate = kind => pickups.filter(value => value === kind).length / pickups.length;
  assert.ok(rate('fruit') > .002 && rate('fruit') < .025);
  assert.ok(rate('bike') > .025 && rate('bike') < .09);
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
