import test from "node:test";
import assert from "node:assert/strict";
import { EscapeWorld } from "../src/escape/world.ts";
import { bagEntries } from "../src/escape/backpack.ts";

test("the backpack lists carried items, crystal charges and found notes with descriptions", () => {
  const w = new EscapeWorld(), d = w.data;
  let entries = bagEntries(w);
  assert.deepEqual(entries.filter(e => e.tab === "crystals"), []);
  assert.deepEqual(entries.filter(e => e.tab === "notes"), []);
  assert.ok(entries.some(e => e.id === "item:battery"));
  d.inventory.push("brass", "fuse"); d.notes = ["bed-note"]; d.hunt.collected = ["crystal-bed", "crystal-hall-east", "crystal-hall-west"];
  entries = bagEntries(w);
  assert.deepEqual(["item:brass", "item:fuse"].map(id => entries.find(e => e.id === id)?.name), ["黄铜钥匙", "保险丝"]);
  const freeze = entries.find(e => e.id === "crystal:freeze");
  assert.equal(freeze.count, 2); assert.equal(freeze.use, "freeze");
  assert.equal(entries.find(e => e.id === "crystal:reveal").count, 1);
  const note = entries.find(e => e.tab === "notes");
  assert.equal(note.name, "床边纸条"); assert.ok(note.text.length > 10);
  for (const entry of entries) assert.ok(entry.text.length > 4, entry.id);
});
