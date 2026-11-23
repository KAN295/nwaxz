import test from "node:test";
import assert from "node:assert/strict";
import packageInfo from "../package.json" with { type: "json" };
import { CoopService, resolveCoopClientIp } from "./coop-service.mjs";
import { EscapeWorld } from "../src/escape/world.ts";

const request = (name, avatar = 0) => ({ version: packageInfo.version, name, avatar });
function service() { let time = 1_000_000; const instance = new CoopService({ now: () => time, autoTick: false }); return { instance, advance: ms => { time += ms; } }; }

test("rooms isolate sessions and lock starting lives to the roster size", () => {
  const { instance: s } = service();
  try {
    const a = s.create(request("房主"));
    assert.throws(() => s.start(a.code, { id: a.playerId, token: a.token }), /至少需要两名玩家/);
    const b = s.join({ ...request("队友", 1), code: a.code });
    s.setReady(a.code, a.token, true); s.setReady(a.code, b.token, true);
    s.start(a.code, { id: a.playerId, token: a.token });
    assert.deepEqual([...s.rooms.get(a.code).players.values()].map(p => p.lives), [2, 2]);
    const c = s.create(request("另一个房间", 2));
    assert.notEqual(c.code, a.code);
    assert.throws(() => s.input(c.code, a.token, { seq: 0, move: { forward: 0, strafe: 0, turn: 0, look: 0, sprint: false } }), e => e.status === 401);
    assert.throws(() => s.join({ ...request("迟到者"), code: a.code }), e => e.status === 409);
  } finally { s.close(); }
});

test("explicit lobby leave frees the slot immediately and transfers the leader", () => {
  const { instance: s } = service();
  try {
    const a = s.create(request("a")), b = s.join({ ...request("b"), code: a.code });
    s.leave(a.code, a.token);
    const room = s.rooms.get(a.code);
    assert.equal(room.players.size, 1); assert.equal(room.leaderId, b.playerId);
    const c = s.join({ ...request("c"), code: a.code });
    assert.equal(s.findPlayer(room, c.token).slot, 1);
  } finally { s.close(); }
});

test("three-player start grants one life; incompatible app versions fail the handshake", () => {
  const { instance: s } = service();
  try {
    assert.throws(() => s.create({ ...request("x"), version: "old" }), e => e.status === 409);
    const a = s.create(request("a")), b = s.join({ ...request("b"), code: a.code }), c = s.join({ ...request("c"), code: a.code });
    s.setReady(a.code, a.token, true); s.setReady(a.code, b.token, true); s.setReady(a.code, c.token, true);
    s.start(a.code, { id: a.playerId, token: a.token });
    assert.deepEqual([...s.rooms.get(a.code).players.values()].map(p => p.lives), [1, 1, 1]);
  } finally { s.close(); }
});

test("room capacity, per-host cap, and session action rates are bounded", () => {
  const { instance: s } = service();
  try {
    s.maxRooms = 4;
    const a = s.create(request("a"), "ip-a"), b = s.create(request("b"), "ip-a"), c = s.create(request("c"), "ip-a");
    assert.notEqual(a.code, b.code); assert.notEqual(b.code, c.code);
    assert.throws(() => s.create(request("c"), "ip-a"), e => e.status === 429);
    s.create(request("d"), "ip-b");
    assert.throws(() => s.create(request("e"), "ip-c"), e => e.status === 503);
    const joined = s.join({ ...request("teammate"), code: a.code }, "ip-c");
    s.setReady(a.code, a.token, true); s.setReady(a.code, joined.token, true); s.start(a.code, { id: a.playerId, token: a.token });
    for (let seq = 1; seq <= 10; seq++) s.input(a.code, a.token, { seq, move: { forward: 0, strafe: 0, turn: 0, look: 0, sprint: false }, action: "light" });
    assert.throws(() => s.input(a.code, a.token, { seq: 11, move: { forward: 0, strafe: 0, turn: 0, look: 0, sprint: false }, action: "light" }), e => e.status === 429);
  } finally { s.close(); }
});

test("a forged X-Real-IP is ignored on public sockets and accepted from a private proxy", () => {
  const requestFor = (remoteAddress, realIp, ip = remoteAddress) => ({ socket: { remoteAddress }, ip, get: name => name === "x-real-ip" ? realIp : undefined });
  assert.equal(resolveCoopClientIp(requestFor("203.0.113.4", "198.51.100.9")), "203.0.113.4");
  assert.equal(resolveCoopClientIp(requestFor("172.22.0.4", "198.51.100.9")), "198.51.100.9");
  assert.equal(resolveCoopClientIp(requestFor("127.0.0.1", "not-an-ip")), "127.0.0.1");
});

test("co-op perception forces 100 only on the chased player and releases it on search", () => {
  const world = new EscapeWorld(42);
  world.data.phase = "playing"; world.data.hunter.state = "chase";
  world.data.hunt.noise = 0; world.data.hunt.glare = 0; world.data.hunt.sight = 0;
  world.setCoopPerceptionContext("player-b", "player-a");
  world.syncExposure();
  assert.equal(world.perception.total, 0); assert.equal(world.data.hunt.exposure, 0);
  world.data.hunt.noise = 45; world.syncExposure();
  assert.equal(world.perception.total, 45); assert.equal(world.data.hunt.exposure, 45);
  world.data.hunt.noise = 0; world.setCoopPerceptionContext("player-b", "player-b"); world.syncExposure();
  assert.equal(world.perception.total, 100); assert.equal(world.data.hunt.exposure, 100);
  world.data.hunter.state = "search"; world.setCoopPerceptionContext("player-b", "player-b"); world.syncExposure();
  assert.equal(world.perception.total, 0); assert.equal(world.data.hunt.exposure, 0);
});

test("restore applies co-op target context before chase perception fallback", () => {
  const source = new EscapeWorld(43);
  source.data.phase = "playing"; source.data.hunter.state = "chase";
  const raw = source.snapshot(); delete raw.hunt.sight;
  const bystander = EscapeWorld.restore(raw, { playerId: "player-b", targetId: "player-a" });
  assert.equal(bystander.data.hunt.sight, 0); assert.equal(bystander.data.hunt.exposure, 0);
  const chased = EscapeWorld.restore(raw, { playerId: "player-a", targetId: "player-a" });
  assert.equal(chased.data.hunt.sight, 100); assert.equal(chased.data.hunt.exposure, 100);
  const solo = EscapeWorld.restore(raw);
  assert.equal(solo.data.hunt.sight, 100); assert.equal(solo.data.hunt.exposure, 100);
});

test("authoritative input clamps movement and does not accept client world coordinates", () => {
  const { instance: s } = service();
  try {
    const a = s.create(request("a")), b = s.join({ ...request("b"), code: a.code });
    s.setReady(a.code, a.token, true); s.setReady(a.code, b.token, true);
    s.start(a.code, { id: a.playerId, token: a.token });
    const room = s.rooms.get(a.code), player = s.findPlayer(room, a.token);
    assert.throws(() => s.input(a.code, a.token, { seq: 1, position: { x: 22, z: 22 }, move: { forward: 9, strafe: 0, turn: 99, look: 0, sprint: false } }), e => e.status === 400);
    s.input(a.code, a.token, { seq: 1, move: { forward: 9, strafe: 0, turn: 99, look: 0, sprint: false } });
    assert.deepEqual(player.position, { x: 3.5, z: 5.5 });
    assert.equal(player.lastInput.forward, 1); assert.equal(player.lastInput.turn, 4);
    assert.throws(() => s.input(a.code, a.token, { seq: 1, move: { forward: 0, strafe: 0, turn: 0, look: 0, sprint: false } }), /序号/);
    const peer = s.findPlayer(room, b.token);
    assert.equal(peer.position.x, 4.5);
  } finally { s.close(); }
});

test("shared crystal pickup is server-checked against actual position and facing", () => {
  const { instance: s } = service();
  try {
    const a = s.create(request("a")), b = s.join({ ...request("b"), code: a.code });
    s.setReady(a.code, a.token, true); s.setReady(a.code, b.token, true);
    s.start(a.code, { id: a.playerId, token: a.token });
    const room = s.rooms.get(a.code), player = s.findPlayer(room, a.token);
    player.position = { x: 3.5, z: 5.5 }; player.actorWorld.data.player = { ...player.actorWorld.data.player, x: 3.5, z: 5.5, angle: -Math.PI / 2 };
    s.input(a.code, a.token, { seq: 1, move: { forward: 0, strafe: 0, turn: 0, look: 0, sprint: false }, action: "interact", targetId: "crystal-bed" });
    assert.deepEqual(room.world.data.hunt.collected, ["crystal-bed"]);
    const other = s.findPlayer(room, b.token);
    assert.equal(s.snapshot(room, other).team.crystals, 1);
    assert.throws(() => s.input(a.code, a.token, { seq: 2, move: { forward: 0, strafe: 0, turn: 0, look: 0, sprint: false }, action: "interact", targetId: "crystal-laundry" }), /无效/);
  } finally { s.close(); }
});

test("all connected actors move and recover stamina at full fixed dt while shared elapsed advances once", () => {
  const { instance: s, advance } = service();
  try {
    const a = s.create(request("a")), b = s.join({ ...request("b"), code: a.code });
    s.setReady(a.code, a.token, true); s.setReady(a.code, b.token, true); s.start(a.code, { id: a.playerId, token: a.token });
    const room = s.rooms.get(a.code);
    for (const [session, seq] of [[a, 1], [b, 1]]) s.input(a.code, session.token, { seq, move: { forward: 1, strafe: 0, turn: 0, look: 0, sprint: false } });
    for (const member of room.players.values()) member.actorWorld.data.player.stamina = 50;
    const beforeA = s.findPlayer(room, a.token).actorWorld.data.player.stamina;
    const beforeB = s.findPlayer(room, b.token).actorWorld.data.player.stamina;
    advance(50); s.pulse();
    const pa = s.findPlayer(room, a.token), pb = s.findPlayer(room, b.token);
    assert.ok(pa.position.z < 5.5); assert.ok(pb.position.z < 5.5);
    assert.equal(room.world.data.elapsed, 0.05);
    assert.ok(pa.actorWorld.data.player.stamina > beforeA);
    assert.ok(pb.actorWorld.data.player.stamina > beforeB);
    assert.equal(EscapeWorld.restore(s.snapshot(room, pa).world).data.player.z, pa.position.z);
    assert.equal(EscapeWorld.restore(s.snapshot(room, pb).world).data.player.z, pb.position.z);
  } finally { s.close(); }
});

test("player hidden state, search timer, and sense meters remain personal", () => {
  const { instance: s, advance } = service();
  try {
    const a = s.create(request("a")), b = s.join({ ...request("b"), code: a.code });
    s.setReady(a.code, a.token, true); s.setReady(a.code, b.token, true); s.start(a.code, { id: a.playerId, token: a.token });
    const room = s.rooms.get(a.code), pa = s.findPlayer(room, a.token), pb = s.findPlayer(room, b.token);
    pa.position = { x: 5.5, z: 2.58 }; pa.actorWorld.data.player = { ...pa.actorWorld.data.player, ...pa.position }; pa.actorWorld.data.hidden = pa.hidden = "bed-hide";
    pb.position = { x: 2.5, z: 2.5 }; pb.actorWorld.data.player = { ...pb.actorWorld.data.player, ...pb.position }; pb.actorWorld.pending = { id: "bed-drawer", remaining: 0.3 };
    pa.actorWorld.data.hunt.effort = 70; pb.actorWorld.data.hunt.effort = 10;
    advance(50); s.pulse();
    assert.equal(pa.actorWorld.data.hidden, "bed-hide"); assert.equal(pb.actorWorld.data.hidden, undefined);
    assert.ok(pb.actorWorld.pending.remaining < 0.3);
    assert.notEqual(pa.actorWorld.data.hunt.effort, pb.actorWorld.data.hunt.effort);
    assert.equal(EscapeWorld.restore(s.snapshot(room, pa).world).data.hidden, "bed-hide");
  } finally { s.close(); }
});

test("the room ability clock advances once for the basement roster and is shared in snapshots", () => {
  const { instance: s, advance } = service();
  try {
    const a = s.create(request("a")), b = s.join({ ...request("b"), code: a.code });
    s.setReady(a.code, a.token, true); s.setReady(a.code, b.token, true); s.start(a.code, { id: a.playerId, token: a.token });
    const room = s.rooms.get(a.code);
    for (const member of room.players.values()) {
      member.position = { x: 5.5, z: 32.5 };
      member.actorWorld.data.player = { ...member.actorWorld.data.player, ...member.position };
    }
    advance(50); s.pulse();
    assert.equal(room.world.data.abilities.enabled, true);
    assert.equal(room.world.data.abilities.rest, 29.95);
    assert.equal(s.snapshot(room, s.findPlayer(room, a.token)).world.abilities.rest, 29.95);
    assert.equal(s.snapshot(room, s.findPlayer(room, b.token)).world.abilities.rest, 29.95);
  } finally { s.close(); }
});

test("team ward clears every private interference state immediately", () => {
  const { instance: s } = service();
  try {
    const a = s.create(request("a")), b = s.join({ ...request("b"), code: a.code });
    const c = s.join({ ...request("c"), code: a.code });
    s.setReady(a.code, a.token, true); s.setReady(a.code, b.token, true); s.setReady(a.code, c.token, true); s.start(a.code, { id: a.playerId, token: a.token });
    const room = s.rooms.get(a.code); room.world.data.hunt.collected.push("basement-crystal-ward");
    for (const player of room.players.values()) player.actorWorld.data.interference = { stage: "corrupt", clear: 0, attempt: 0, tick: 0, remaining: 30, clock: 0, seed: 1 };
    s.input(a.code, a.token, { seq: 1, move: { forward: 0, strafe: 0, turn: 0, look: 0, sprint: false }, action: "ward" });
    assert.equal(room.world.data.hunt.ward, 60);
    assert.ok([...room.players.values()].every(player => player.actorWorld.data.interference.stage === "clear"));
  } finally { s.close(); }
});

test("an active team freeze blocks hunter collision capture", () => {
  const { instance: s } = service();
  try {
    const a = s.create(request("a")), b = s.join({ ...request("b"), code: a.code });
    s.setReady(a.code, a.token, true); s.setReady(a.code, b.token, true); s.start(a.code, { id: a.playerId, token: a.token });
    const room = s.rooms.get(a.code), target = s.findPlayer(room, b.token), player = { ...target.actorWorld.data.player, ...target.position };
    room.world.data.hunter = { ...player, angle: 0, state: "patrol" }; room.world.data.hunt.freeze = 1;
    const caught = room.world.advanceEnemyAuthoritative(0.05, [{ id: target.id, player, living: true, exposure: 100 }]);
    assert.deepEqual(caught, []); assert.equal(room.world.data.hunt.freeze, 0.95);
  } finally { s.close(); }
});

test("a cooperative capture does not clear team protection or alert timers", () => {
  const { instance: s } = service();
  try {
    const a = s.create(request("a")), b = s.join({ ...request("b"), code: a.code });
    s.setReady(a.code, a.token, true); s.setReady(a.code, b.token, true); s.start(a.code, { id: a.playerId, token: a.token });
    const room = s.rooms.get(a.code), target = s.findPlayer(room, b.token), player = { ...target.actorWorld.data.player, ...target.position };
    Object.assign(room.world.data.hunt, { collected: ["basement-crystal-ward", "crystal-hall-west"], ward: 60, wardUsed: 1, reveal: 10, revealUsed: 1, alert: 6 });
    Object.assign(room.world.data.hunter, { x: player.x, z: player.z, state: "patrol" });
    const caught = room.world.advanceEnemyAuthoritative(0.05, [{ id: target.id, player, living: true, exposure: 0 }]);
    assert.deepEqual(caught, [target.id]);
    assert.equal(room.world.data.phase, "playing");
    assert.equal(room.world.data.hunt.ward, 59.95);
    assert.equal(room.world.data.hunt.reveal, 9.95);
    assert.equal(room.world.data.hunt.alert, 6);
    assert.doesNotThrow(() => EscapeWorld.restore(room.world.snapshot()));
  } finally { s.close(); }
});

test("a missing cooperative chase target is not refreshed from stale player coordinates", () => {
  const { instance: s } = service();
  try {
    const a = s.create(request("a")), b = s.join({ ...request("b"), code: a.code });
    s.setReady(a.code, a.token, true); s.setReady(a.code, b.token, true); s.start(a.code, { id: a.playerId, token: a.token });
    const world = s.rooms.get(a.code).world, oldTarget = s.findPlayer(s.rooms.get(a.code), b.token);
    world.coopTargetId = oldTarget.id;
    world.data.player = { ...oldTarget.actorWorld.data.player, x: 21.5, z: 20.5 };
    Object.assign(world.data.hunter, { x: 18.5, z: 18.5, state: "chase" }); world.target = { x: 18.5, z: 18.5 };
    const before = { ...world.target };
    const other = s.findPlayer(s.rooms.get(a.code), a.token);
    world.advanceEnemyAuthoritative(0.05, [{ id: other.id, player: { ...other.actorWorld.data.player, x: 3.5, z: 5.5 }, living: true, exposure: 0 }]);
    assert.deepEqual(world.target, before);
    assert.equal(world.data.hunter.state, "search");
    assert.notDeepEqual(world.target, { x: world.data.player.x, z: world.data.player.z });
  } finally { s.close(); }
});

test("the shared hunter targets and captures a non-host player", () => {
  const { instance: s } = service();
  try {
    const a = s.create(request("a")), b = s.join({ ...request("b"), code: a.code });
    s.setReady(a.code, a.token, true); s.setReady(a.code, b.token, true); s.start(a.code, { id: a.playerId, token: a.token });
    const room = s.rooms.get(a.code), target = s.findPlayer(room, b.token);
    const player = { ...target.actorWorld.data.player, ...target.position };
    Object.assign(room.world.data.hunter, { x: player.x, z: player.z, state: "patrol" });
    const caught = room.world.advanceEnemyAuthoritative(0.05, [{ id: target.id, player, exposure: 100, rawExposure: 100, currentExposure: 100, currentCues: { sight: player }, focus: "sight", living: true }]);
    assert.deepEqual(caught, [target.id]);
    assert.equal(room.world.coopTargetId, target.id);
    assert.equal(s.snapshot(room, target).targetPlayerId, target.id);
  } finally { s.close(); }
});

test("forced HUD exposure cannot reacquire a target hidden behind a wall; real new cues can", () => {
  const { instance: s, advance } = service();
  try {
    const a = s.create(request("a")), b = s.join({ ...request("b"), code: a.code }), c = s.join({ ...request("c"), code: a.code });
    for (const session of [a, b, c]) s.setReady(a.code, session.token, true);
    s.start(a.code, { id: a.playerId, token: a.token });
    const room = s.rooms.get(a.code), target = s.findPlayer(room, b.token);
    room.world.data.elapsed = 10;
    Object.assign(room.world.data.hunter, { x: 12.5, z: 9.5, angle: Math.PI, state: "chase" });
    Object.assign(room.world.data.player, { x: 4.5, z: 9.5 });
    room.world.target = { x: 4.5, z: 9.5 };
    target.position = { x: 4.5, z: 9.5 };
    Object.assign(target.actorWorld.data.player, { x: 4.5, z: 9.5, light: false, crouched: false, sprinting: false });
    target.actorWorld.data.hunt.sight = 100;
    advance(50); s.pulse();
    assert.equal(room.world.coopTargetId, target.id);
    assert.equal(room.world.data.hunter.state, "chase");
    const lastKnown = { ...room.world.target };

    target.position = { x: 20.5, z: 5.5 };
    Object.assign(target.actorWorld.data.player, { x: 20.5, z: 5.5, light: false });
    let elapsed = 0;
    while (elapsed < 4_000) { advance(50); s.pulse(); elapsed += 50; }
    advance(50); s.pulse();
    assert.equal(room.world.data.hunter.state, "search");
    assert.deepEqual(room.world.target, lastKnown);
    assert.equal(target.actorWorld.data.hunt.exposure, target.actorWorld.perception.total);
    assert.ok(target.actorWorld.data.hunt.exposure < 100);

    const other = s.findPlayer(room, c.token), visible = { ...other.actorWorld.data.player, x: 10.5, z: 9.5 };
    const trace = { x: 10.5, z: 9.5 };
    room.world.data.hunter.state = "chase"; room.world.coopTargetId = target.id;
    room.world.advanceEnemyAuthoritative(0.05, [
      { id: target.id, player: { ...target.actorWorld.data.player }, living: true, exposure: 100, rawExposure: 100, currentExposure: 0, currentCues: {} },
      { id: other.id, player: visible, living: true, exposure: 100, rawExposure: 100, currentExposure: 100, currentCues: { sight: trace }, focus: "sight" },
    ]);
    assert.equal(room.world.coopTargetId, other.id);
    assert.deepEqual({ x: room.world.target.x, z: room.world.target.z }, trace);
  } finally { s.close(); }
});

test("a chased player with a current audible cue leads the hunter to that trace", () => {
  const { instance: s } = service();
  try {
    const a = s.create(request("a")), b = s.join({ ...request("b"), code: a.code });
    s.setReady(a.code, a.token, true); s.setReady(a.code, b.token, true); s.start(a.code, { id: a.playerId, token: a.token });
    const world = s.rooms.get(a.code).world, target = s.findPlayer(s.rooms.get(a.code), b.token);
    world.coopTargetId = target.id; world.data.hunter.state = "chase";
    world.target = { x: 9.5, z: 9.5 };
    const soundTrace = { x: 10.5, z: 9.5 }, player = { ...target.actorWorld.data.player, x: 18.5, z: 20.5 };
    world.advanceEnemyAuthoritative(0.05, [{
      id: target.id, player, living: true, exposure: 100, rawExposure: 58, currentExposure: 58,
      currentCues: { noise: soundTrace }, focus: "noise",
    }]);
    assert.deepEqual(world.target, soundTrace);
    assert.equal(world.unseen, 0);
  } finally { s.close(); }
});

test("investigation follows a personal sensed trace and zero exposure does not reveal position", () => {
  const { instance: s } = service();
  try {
    const a = s.create(request("a")), b = s.join({ ...request("b"), code: a.code });
    s.setReady(a.code, a.token, true); s.setReady(a.code, b.token, true); s.start(a.code, { id: a.playerId, token: a.token });
    const world = s.rooms.get(a.code).world, player = { ...s.findPlayer(s.rooms.get(a.code), b.token).actorWorld.data.player, x: 20, z: 5.5 };
    const trace = { x: 9.5, z: 9.5 };
    world.advanceEnemyAuthoritative(0.05, [{ id: b.playerId, player, living: true, exposure: 60, rawExposure: 60, currentExposure: 60, currentCues: { noise: trace }, focus: "noise", traces: { noise: trace } }]);
    assert.equal(world.data.hunter.state, "investigate"); assert.deepEqual(world.target, trace);
    world.advanceEnemyAuthoritative(0.05, [{ id: b.playerId, player: { ...player, x: 22 }, living: true, exposure: 0 }]);
    assert.deepEqual(world.target, trace);
  } finally { s.close(); }
});

test("capture is private, waits for respawn acknowledgement, and preserves the team clock", () => {
  const { instance: s, advance } = service();
  try {
    const a = s.create(request("a")), b = s.join({ ...request("b"), code: a.code });
    s.setReady(a.code, a.token, true); s.setReady(a.code, b.token, true); s.start(a.code, { id: a.playerId, token: a.token });
    const room = s.rooms.get(a.code), victim = s.findPlayer(room, b.token);
    Object.assign(room.world.data.hunter, { x: victim.position.x, z: victim.position.z, state: "patrol" });
    advance(50); s.pulse();
    assert.equal(victim.status, "caught"); assert.equal(victim.lives, 1);
    assert.ok(s.snapshot(room, victim).events.some(event => event.type === "caught"));
    assert.ok(!s.snapshot(room, s.findPlayer(room, a.token)).events.some(event => event.type === "caught"));
    const elapsed = room.world.data.elapsed;
    assert.throws(() => s.input(a.code, b.token, { seq: 1, move: { forward: 0, strafe: 0, turn: 0, look: 0, sprint: false } }), e => e.status === 409);
    s.respawn(a.code, b.token);
    assert.equal(victim.status, "connected"); assert.equal(room.world.data.elapsed, elapsed);
    // A respawned player must be able to move again straight away.
    Object.assign(room.world.data.hunter, { x: 20.5, z: 20.5 });
    const start = { ...victim.actorWorld.data.player };
    for (let seq = 2; seq < 22; seq++) { s.input(a.code, b.token, { seq, move: { forward: 1, strafe: 0, turn: 0, look: 0, sprint: false }, aim: { angle: Math.PI / 2, pitch: 0 } }); advance(50); s.pulse(); }
    assert.ok(Math.hypot(victim.actorWorld.data.player.x - start.x, victim.actorWorld.data.player.z - start.z) > .8);
    victim.status = "eliminated";
    assert.equal(s.snapshot(room, victim).viewPlayerId, a.playerId);
  } finally { s.close(); }
});

test("in-game explicit leave costs no life and does not recalculate the original roster", () => {
  const { instance: s } = service();
  try {
    const a = s.create(request("a")), b = s.join({ ...request("b"), code: a.code });
    s.setReady(a.code, a.token, true); s.setReady(a.code, b.token, true); s.start(a.code, { id: a.playerId, token: a.token });
    const room = s.rooms.get(a.code), survivor = s.findPlayer(room, b.token);
    assert.equal(survivor.lives, 2);
    s.leave(a.code, a.token);
    assert.equal(s.findPlayer(room, a.token).status, "left");
    assert.equal(survivor.lives, 2); assert.equal(room.initialPlayerCount, 2);
    assert.equal(room.leaderId, b.playerId); assert.equal(s.snapshot(room, survivor).team.total, 2);
    room.world.coopTargetId = a.playerId; room.world.data.hunter.state = "chase"; s.pulse();
    assert.equal(room.world.coopTargetId, undefined);
    const peer = { status() { return this; }, set() { return this; }, flushHeaders() {}, write() { return true; }, on() {}, end() {} };
    assert.throws(() => s.reconnect(a.code, a.token, peer), e => e.status === 409);
  } finally { s.close(); }
});

test("disconnect has a reconnect grace period and rooms are released after everyone leaves", () => {
  const { instance: s, advance } = service();
  try {
    const a = s.create(request("a")), b = s.join({ ...request("b"), code: a.code });
    const room = s.rooms.get(a.code), player = s.findPlayer(room, a.token);
    const stream = { writableEnded: false, writableLength: 0, events: {}, status() { return this; }, set() { return this; }, flushHeaders() {}, write() { return true; }, on(event, fn) { this.events[event] = fn; }, end() { this.writableEnded = true; } };
    s.attachStream(room, player, stream); stream.events.close();
    assert.equal(player.status, "reconnecting");
    assert.equal(room.leaderId, b.playerId);
    assert.throws(() => s.auth(a.code, "bad"), e => e.status === 401);
    advance(59_999); s.cleanup(); assert.ok(s.rooms.has(a.code));
    const peer = { writableEnded: false, writableLength: 0, events: {}, status() { return this; }, set() { return this; }, flushHeaders() {}, write() { return true; }, on(event, fn) { this.events[event] = fn; }, end() { this.writableEnded = true; } };
    s.reconnect(a.code, a.token, peer);
    assert.equal(s.findPlayer(room, a.token).status, "connected");
    peer.events.close(); s.disconnect(a.code, s.findPlayer(room, b.token));
    advance(60_001); s.cleanup(); assert.equal(s.rooms.has(a.code), false);
  } finally { s.close(); }
});

test("a congested connection skips snapshots but still receives critical events and current state", () => {
  const { instance: s, advance } = service();
  try {
    const a = s.create(request("a")), b = s.join({ ...request("b"), code: a.code });
    const room = s.rooms.get(a.code), player = s.findPlayer(room, a.token), snapshots = [];
    s.setReady(a.code, a.token, true); s.setReady(a.code, b.token, true);
    s.start(a.code, player);
    const stream = {
      writableEnded: false, writableLength: 20 * 1024,
      status() { return this; }, set() { return this; }, write() {}, on() {},
      sendSnapshot(snapshot) { snapshots.push(snapshot); },
      end() { this.writableEnded = true; },
    };
    s.attachStream(room, player, stream);
    room.sharedEvents.push({ type: "door", id: "study" });
    advance(50); s.pulse();
    assert.equal(snapshots.length, 0);
    assert.equal(stream.writableEnded, false);
    stream.writableLength = 0;
    advance(50); s.pulse();
    assert.equal(snapshots.length, 1);
    assert.ok(snapshots[0].events.some(event => event.type === "door" && event.id === "study"));
    assert.equal(snapshots[0].serverTime, s.now());
  } finally { s.close(); }
});

test("empty lobbies expire after two minutes and terminal rooms close after one minute", () => {
  const { instance: s, advance } = service();
  try {
    const lobby = s.create(request("waiting"));
    advance(119_999); s.cleanup(); assert.ok(s.rooms.has(lobby.code));
    advance(1); s.cleanup(); assert.equal(s.rooms.has(lobby.code), false);

    const session = s.create(request("finished")), room = s.rooms.get(session.code), player = s.findPlayer(room, session.token);
    const stream = { writableEnded: false, writableLength: 0, status() { return this; }, set() { return this; }, flushHeaders() {}, write() { return true; }, on() {}, end() { this.writableEnded = true; } };
    s.attachStream(room, player, stream); s.setTerminalPhase(room, "won");
    const lastActive = room.lastActive;
    advance(59_999); s.pulse(); s.cleanup();
    assert.ok(s.rooms.has(session.code)); assert.equal(room.lastActive, lastActive);
    advance(1); s.pulse();
    assert.equal(s.rooms.has(session.code), false); assert.equal(stream.writableEnded, true);
  } finally { s.close(); }
});
