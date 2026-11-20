import { test } from "node:test";
import assert from "node:assert/strict";
import { EscapeWorld, CRYSTALS, SIZE, HEIGHT } from "../src/escape/world.ts";

const frames = (w, seconds, input = {}) => { for (let i = 0; i < Math.ceil(seconds * 60); i++) w.advance(1 / 60, input); };
function face(w, point) { w.data.player.angle = Math.atan2(point.z - w.data.player.z, point.x - w.data.player.x); }
function takeCrystal(w, kind) {
  const c = CRYSTALS.find(c => c.kind === kind && !w.data.hunt.collected.includes(c.id));
  Object.assign(w.data.player, { x: c.x, z: c.z, pitch: 0 }); face(w, c); w.interact();
}
function freezeHunter(w) { takeCrystal(w, "freeze"); w.data.player.light = false; w.useCrystal("freeze"); }

test("patrol seeds differ, while a restored seed continues the same route", () => {
  const starts = [11, 22, 33, 44, 55, 66].map(seed => new EscapeWorld(seed).snapshot().pursuit.target);
  assert.ok(new Set(starts.map(p => `${p.x},${p.z}`)).size >= 4);
  const moving = new EscapeWorld(77), initial = { ...moving.data.hunter }; frames(moving, 1);
  assert.ok(Math.hypot(moving.data.hunter.x - initial.x, moving.data.hunter.z - initial.z) > .2);
  const a = new EscapeWorld(1234); frames(a, 3); const save = a.snapshot(), resumed = EscapeWorld.restore(save);
  frames(a, 4); frames(resumed, 4);
  assert.deepEqual(resumed.snapshot().pursuit.target, a.snapshot().pursuit.target);
  assert.equal(resumed.data.hunt.rng, a.data.hunt.rng);
  assert.ok(Math.abs(resumed.data.hunter.x - a.data.hunter.x) < .01 && Math.abs(resumed.data.hunter.z - a.data.hunter.z) < .01);
});

test("a confirmed moving sighting feeds one model search, independent of the concealed location", () => {
  const world = new EscapeWorld(2041);
  world.data.elapsed = 10;
  Object.assign(world.data.hunter, { x: 3.5, z: 9.5, angle: 0, state: "chase" });
  Object.assign(world.data.player, { x: 6.5, z: 9.5, angle: 0, light: false });
  frames(world, .4, { forward: 1 });
  const snapshot = world.snapshot();
  assert.ok(snapshot.pursuit.searchClue?.heading.x > .99, "direction came from actually visible movement");
  assert.deepEqual(EscapeWorld.restore(snapshot).snapshot(), snapshot);

  const destinations = [];
  for (const x of [11.5, 19.5]) {
    const scenario = structuredClone(snapshot);
    Object.assign(scenario.player, { x, z: 3.5 });
    scenario.pursuit.unseen = 3.49;
    const lost = EscapeWorld.restore(scenario);
    assert.equal(lost.seesPlayer(), false);
    lost.advance(1 / 60);
    assert.equal(lost.data.hunter.state, 'search');
    assert.notDeepEqual(lost.target, snapshot.pursuit.target);
    assert.equal(lost.wall(lost.target.x, lost.target.z, true), 0);
    assert.equal(lost.drainEvents().filter(event => event.type === 'hunter-think').length, 1);
    assert.equal(lost.snapshot().pursuit.searchClue, undefined);
    lost.advance(.15);
    assert.equal(lost.drainEvents().some(event => event.type === 'hunter-think'), false);
    destinations.push(lost.target);
  }
  assert.deepEqual(destinations[0], destinations[1], 'concealed coordinates do not affect the chosen probe');

  const legacy = structuredClone(snapshot);
  delete legacy.pursuit.searchClue;
  legacy.pursuit.unseen = 3.49;
  Object.assign(legacy.player, { x: 11.5, z: 3.5 });
  const fallback = EscapeWorld.restore(legacy);
  fallback.advance(1 / 60);
  assert.equal(fallback.data.hunter.state, 'search');
  assert.equal(fallback.drainEvents().some(event => event.type === 'hunter-think'), false, 'no confirmed direction leaves ordinary search in control');
});

test("walking effort follows actual displacement; rest recovers and panting emits bounded events", () => {
  const blocked = new EscapeWorld(1); Object.assign(blocked.data.player, { x: 1.3, z: 3.5, angle: Math.PI });
  frames(blocked, 3, { forward: 1 }); assert.equal(blocked.data.hunt.effort, 0);
  const w = new EscapeWorld(2); freezeHunter(w); Object.assign(w.data.hunter, { x: 11.5, z: 21.5, state: "patrol" }); Object.assign(w.data.player, { x: 12.5, z: 9.5, angle: 0 });
  for (let i = 0; i < 12; i++) frames(w, 1, { forward: i % 2 ? -1 : 1, sprint: true });
  assert.ok(w.data.hunt.effort > 0);
  for (let i = 0; i < 8; i++) frames(w, 1, { forward: i % 2 ? -1 : 1, sprint: true });
  assert.equal(w.data.hunt.panting, true); assert.equal(w.data.hunt.effort, 100);
  const breaths = w.drainEvents().filter(e => e.type === "breath").length;
  assert.ok(breaths >= 2 && breaths <= 8);
  frames(w, 4); assert.ok(w.data.hunt.effort < 35); assert.equal(w.data.hunt.panting, false);
});

test("glare needs the real torch cone and clear wall path, then disarms until it fades", () => {
  const setup = () => { const w = new EscapeWorld(4); w.data.elapsed = 8; Object.assign(w.data.player, { x: 1.5, z: 9.5, angle: 0, pitch: 0, light: true, battery: 100 }); Object.assign(w.data.hunter, { x: 15.5, z: 9.5, angle: 0, state: "patrol" }); w.target={x:1.5,z:9.5}; return w; };
  const aimed = setup(); frames(aimed, 5); assert.ok(aimed.data.hunt.glare >= 99); assert.equal(aimed.data.hunter.state, "chase");
  aimed.drainEvents(); frames(aimed, 1); assert.equal(aimed.drainEvents().filter(e => e.type === "message").length, 0);
  const away = setup(); away.data.player.angle = Math.PI; frames(away, 3); assert.equal(away.data.hunt.glare, 0);
  const pitch = setup(); pitch.data.player.pitch = -1.2; frames(pitch, 3); assert.equal(pitch.data.hunt.glare, 0);
  const wall = setup(); Object.assign(wall.data.player, { x: 11.5, z: 6.5, angle: Math.PI / 2 }); Object.assign(wall.data.hunter, { x: 11.5, z: 8.5 }); frames(wall, 6); assert.equal(wall.data.hunt.glare, 0);
});

test("crystals are finite, persist their use history, and freeze expires without clearing hunter memory", () => {
  const w = new EscapeWorld(7); takeCrystal(w, "freeze"); takeCrystal(w, "freeze"); assert.equal(w.crystalCharges("freeze"), 2);
  w.data.player.light = false;
  Object.assign(w.data.hunter, { x: 6.5, z: 4.5, state: "search", angle: 1 }); w.target = { x: 8.5, z: 4.5 };
  w.useCrystal("freeze"); const held = { ...w.data.hunter }; frames(w, 9);
  assert.deepEqual(w.data.hunter, held); assert.equal(w.data.phase, "playing"); assert.equal(w.data.hunt.freeze > 0, true);
  w.useCrystal("freeze"); assert.equal(w.crystalCharges("freeze"), 1, "cannot stack the active effect");
  frames(w, 1.2); assert.equal(w.data.hunt.freeze, 0); assert.ok(w.data.hunter.x > held.x || w.data.hunter.z !== held.z);
  w.useCrystal("freeze"); assert.equal(w.crystalCharges("freeze"), 0);
  w.useCrystal("freeze"); assert.equal(w.data.hunt.freezeUsed, 2, "empty use cannot consume another charge");
  const saved = EscapeWorld.restore(w.snapshot()); assert.deepEqual(saved.snapshot(), w.snapshot());
});

test("reveal is a timed effect; pickup and consumption history survive capture and a new night", () => {
  const w = new EscapeWorld(8); takeCrystal(w, "reveal"); assert.equal(w.crystalCharges("reveal"), 1); Object.assign(w.data.hunter, { x: 11.5, z: 21.5, state: "patrol" });
  w.useCrystal("reveal"); frames(w, 9.9); assert.ok(w.data.hunt.reveal > 0); frames(w, .2); assert.equal(w.data.hunt.reveal, 0);
  w.capture(); assert.equal(w.data.hunt.reveal, 0); w.nextNight();
  assert.equal(w.crystalCharges("reveal"), 0); assert.equal(w.data.hunt.revealUsed, 1);
});

test("version 2 snapshots round-trip exactly and reject missing current-format state", () => {
  const good = new EscapeWorld(10).snapshot();
  assert.equal(good.version, 2);
  assert.deepEqual(EscapeWorld.restore(good).snapshot(), good);
  for (const key of ["basement", "abilities", "interference", "expansion", "hunt", "explored"]) {
    const old = structuredClone(good); delete old[key];
    assert.throws(() => EscapeWorld.restore(old), /逃生存档/);
  }
  for (const key of ["pitch", "sprinting", "winded"]) {
    const old = structuredClone(good); delete old.player[key];
    assert.throws(() => EscapeWorld.restore(old), /逃生存档/);
  }
  for (const mutate of [d => d.hunt.effort = 101, d => d.hunt.freeze = 11, d => d.hunt.collected.push("unknown"), d => d.hunt.freezeUsed = 99, d => d.hunt.rng = -1, d => d.hunt.recent = [SIZE * HEIGHT]]) {
    const bad = structuredClone(good); mutate(bad); assert.throws(() => EscapeWorld.restore(bad), /逃生存档/);
  }
});
