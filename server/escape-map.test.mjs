import assert from "node:assert/strict";
import test from "node:test";
import { EscapeMap, mapWindow, playerArrow, visibleTiles } from "../src/escape/minimap.ts";
import { DOORS, EscapeWorld, roomAt, SIZE } from "../src/escape/world.ts";

const tileAt = (tiles, x, z) => tiles.find(tile => tile.x === x && tile.z === z);
const indexOf = (x, z) => z * SIZE + x;

test("doorway thresholds assign every room, including the two expanded rooms", () => {
  const sides = { bedroom: ["寝室", "回声长廊"], study: ["档案室", "回声长廊"], infirmary: ["值班室", "回声长廊"],
    laundry: ["回声长廊", "洗衣间"], workshop: ["回声长廊", "配电室"], cellar: ["回声长廊", "地下检修室"],
    changing: ["洗衣间", "旧更衣室"], boiler: ["配电室", "锅炉房"] };
  for (const door of DOORS) {
    const [upper, lower] = sides[door.id];
    const x = door.x + .5;
    assert.equal(roomAt({ x, z: door.z + .499 }), upper, `${door.id} upper threshold half`);
    assert.equal(roomAt({ x, z: door.z + .5 }), lower, `${door.id} lower threshold half`);
  }
  const world = new EscapeWorld();
  Object.assign(world.data.player, { x: 11.5, z: 7.5 });
  assert.equal(world.room, "回声长廊", "world room lookup follows the centerline assignment");
});

test("whole map samples the 25x25 grid and shows features only on explored tiles", () => {
  const world = new EscapeWorld();
  assert.equal(tileAt(visibleTiles(world), 11, 7).door, undefined,
    "a known door remains hidden until its tile is explored");
  world.data.explored = [indexOf(11, 7), indexOf(2, 2)];
  const tiles = visibleTiles(world);

  assert.equal(tiles.length, SIZE * SIZE);
  assert.equal(tileAt(tiles, 3, 5).reveal, "explored", "the player's current cell is visible");
  assert.equal(tileAt(tiles, 11, 7).door?.id, "study");
  assert.equal(tileAt(tiles, 11, 7).door?.locked, true);
  assert.equal(tileAt(tiles, 2, 2).feature?.id, "bed-drawer");
  assert.equal(tileAt(tiles, 12, 7).reveal, "fog");
  assert.equal(tileAt(tiles, 12, 7).door, undefined, "the adjacent unexplored door stays hidden");
  assert.equal(tileAt(tiles, 5, 2).feature, undefined, "unexplored furniture has no marker");
});

test("compact map is a player-centered 13x13 crop and marks only explored objectives", () => {
  const world = new EscapeWorld();
  Object.assign(world.data.player, { x: 15.4, z: 21.8 });
  world.data.explored = [indexOf(20, 16)];
  const window = mapWindow(world.data.player, true);
  assert.deepEqual(window, { x: 9, z: 15, columns: 13, rows: 13 });

  const tiles = visibleTiles(world, true);
  assert.equal(tiles.length, 169);
  assert.equal(tileAt(tiles, 15, 21).reveal, "explored", "player stays in the crop center");
  assert.equal(tileAt(tiles, 15, 21).index, indexOf(15, 21));
  assert.equal(tileAt(tiles, 15, 25).terrain, "outside", "crop retains map-edge context");
  assert.equal(tileAt(tiles, 20, 16).feature?.id, "cellar-drawer");
  assert.equal(tileAt(tiles, 16, 20).feature, undefined, "nearby unexplored tiles stay unmarked");
  assert.deepEqual(mapWindow(world.data.player), { x: 0, z: 0, columns: 25, rows: 25 });
});

test("explored floor hazards appear on the map without revealing nearby hazards", () => {
  const world = new EscapeWorld(); world.data.explored = [indexOf(7, 9)];
  const tiles = visibleTiles(world);
  assert.equal(tileAt(tiles, 7, 9).feature?.kind, "hazard");
  assert.equal(tileAt(tiles, 16, 9).feature, undefined);
});

test("player arrow points east at zero and south for positive quarter-turn", () => {
  const east = playerArrow(0, 2);
  assert.ok(Math.abs(east.tip.x - 2) < 1e-12);
  assert.ok(Math.abs(east.tip.y) < 1e-12);
  const south = playerArrow(Math.PI / 2, 3);
  assert.ok(Math.abs(south.tip.x) < 1e-12);
  assert.ok(Math.abs(south.tip.y - 3) < 1e-12);
  const north = playerArrow(-Math.PI / 2, 1);
  assert.ok(north.tip.y < 0);
});

test("fallback canvas paints a textured map without top-level DOM requirements", () => {
  const calls = [];
  const context = new Proxy({ imageSmoothingEnabled: true }, {
    get(target, key) {
      if (key in target) return target[key];
      return (...args) => calls.push([key, ...args]);
    },
    set(target, key, value) { target[key] = value; return true; },
  });
  const canvas = { width: 160, height: 160, getContext: () => context };
  new EscapeMap().draw(canvas, new EscapeWorld(), true);
  const fills = calls.filter(([name]) => name === "fillRect");
  const compass = calls.filter(([name]) => name === "fillText").map(([, text]) => text);
  assert.ok(fills.length > 80, "fallback uses stone texture detail as well as tile fills");
  assert.deepEqual(compass.filter(text=>['北','南','西','东'].includes(text)), ["北", "南", "西", "东"]);
  assert.ok(compass.includes('寝室')&&compass.includes('回声长廊'),'explored named areas have Chinese labels');
  assert.ok(!compass.includes('档案室'),'unexplored room names are not revealed');
});
