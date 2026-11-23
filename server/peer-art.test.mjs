import assert from "node:assert/strict";
import test from "node:test";
import { PEER_DIRECTIONS, PEER_AVATARS, peerAvatarOptions, peerDirectionCell, peerAvatarPortraitStyle, interpolatePeerAngle, peerDirectionForView, peerIsRenderable, peerViewAtlasCell, wrapPeerAngle } from "../src/escape/peer-art.ts";

const peer = (overrides = {}) => ({
  id: "remote-player", slot: 2, name: "peer", avatar: 1, lives: 2, status: "connected",
  position: { x: 12.5, z: 8.5, angle: 0, pitch: 0, crouched: false },
  ...overrides,
});

test("all eight real directions map clockwise to the generated 4x2 atlas cells", () => {
  assert.deepEqual(PEER_DIRECTIONS, ["front", "front-right", "right", "back-right", "back", "back-left", "left", "front-left"]);
  const expected = [[0, 0], [1, 0], [2, 0], [3, 0], [0, 1], [1, 1], [2, 1], [3, 1]];
  for (let index = 0; index < 8; index++) {
    const angle = index * Math.PI / 4;
    assert.equal(peerDirectionForView(0, angle), index);
    assert.deepEqual(peerViewAtlasCell(0, angle), { column: expected[index][0], row: expected[index][1] });
    assert.deepEqual(peerDirectionCell(index), { column: expected[index][0], row: expected[index][1] });
  }
});

test("angle wrapping and interpolation cross the ±π seam on the short arc", () => {
  assert.ok(Math.abs(wrapPeerAngle(Math.PI + .02) - (-Math.PI + .02)) < 1e-10);
  const middle = interpolatePeerAngle(Math.PI - .04, -Math.PI + .04, .5);
  assert.ok(Math.abs(Math.abs(middle) - Math.PI) < 1e-10);
  assert.ok(Math.abs(interpolatePeerAngle(.2, 1.2, 0) - .2) < 1e-10);
  assert.ok(Math.abs(interpolatePeerAngle(.2, 1.2, 1) - 1.2) < 1e-10);
});

test("remote visibility excludes self, terminal states, invalid assets, and missing or invalid positions", () => {
  assert.equal(peerIsRenderable(peer(), "local-player"), true);
  assert.equal(peerIsRenderable(peer({ id: "local-player" }), "local-player"), false);
  assert.equal(peerIsRenderable(peer({ status: "reconnecting" }), "local-player"), true);
  for (const status of ["caught", "eliminated", "escaped"]) assert.equal(peerIsRenderable(peer({ status }), "local-player"), false, status);
  assert.equal(peerIsRenderable(peer({ avatar: 4 }), "local-player"), false);
  assert.equal(peerIsRenderable(peer({ position: undefined }), "local-player"), false);
  assert.equal(peerIsRenderable(peer({ position: { x: 1, z: 2, angle: Number.NaN } }), "local-player"), false);
});

test("four roster options retain fixed avatar ids and square portrait atlas cells", () => {
  assert.deepEqual(peerAvatarOptions.map(option => option.id), [0, 1, 2, 3]);
  assert.equal(PEER_AVATARS.length, 4);
  assert.deepEqual([0, 1, 2, 3].map(id => peerAvatarPortraitStyle(id).backgroundPosition), ["0% 0%", "100% 0%", "0% 100%", "100% 100%"]);
  assert.ok([0, 1, 2, 3].every(id => peerAvatarPortraitStyle(id).backgroundSize === "200% 200%"));
});
