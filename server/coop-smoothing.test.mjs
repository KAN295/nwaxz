import test from "node:test";
import assert from "node:assert/strict";
import { PoseBuffer } from "../src/escape/coop-smoothing.ts";

test("burst arrivals interpolate on server time instead of exaggerating remote velocity", () => {
  const poses = new PoseBuffer(100);
  const server = 1_750_000_000_000;
  poses.observeClock(server, 100);
  poses.push("hunter", server, { x: 0, z: 0, angle: 0 });
  poses.observeClock(server + 50, 300);
  poses.push("hunter", server + 50, { x: 1, z: 0, angle: 0 });
  poses.observeClock(server + 100, 300);
  poses.push("hunter", server + 100, { x: 2, z: 0, angle: 0 });
  assert.ok(poses.sample("hunter", 300).x > 1.8 && poses.sample("hunter", 300).x <= 2);
});

test("remote actors are drawn between the two snapshots that bracket the render time", () => {
  const poses = new PoseBuffer(100);
  poses.push("hunter", 1000, { x: 0, z: 0, angle: 0 });
  poses.push("hunter", 1050, { x: 1, z: 0, angle: 0 });
  poses.push("hunter", 1100, { x: 2, z: 0, angle: 0 });
  assert.deepEqual(poses.sample("hunter", 1125), { x: .5, z: 0, angle: 0 });
  // Motion is continuous frame to frame instead of stepping once per snapshot.
  let last = poses.sample("hunter", 1100).x;
  for (let now = 1104; now <= 1200; now += 4) { const x = poses.sample("hunter", now).x; assert.ok(x - last <= .1 && x >= last); last = x; }
});

test("late snapshots extrapolate briefly, teleports snap, angles take the short way round", () => {
  const poses = new PoseBuffer(100);
  poses.push("a", 0, { x: 0, z: 0, angle: 3 });
  poses.push("a", 50, { x: 1, z: 0, angle: -3 });
  const late = poses.sample("a", 400);
  assert.ok(late.x > 1 && late.x <= 1 + 120 / 50 + 1e-9);
  const mid = poses.sample("a", 125);
  assert.ok(Math.abs(Math.abs(mid.angle) - Math.PI) < .05);
  poses.push("a", 100, { x: 20, z: 20, angle: 0 });
  assert.deepEqual(poses.sample("a", 150), { x: 20, z: 20, angle: 0 });
  poses.retain([]); assert.equal(poses.sample("a", 150), undefined);
});
