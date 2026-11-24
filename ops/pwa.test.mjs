import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createHash } from "node:crypto";
import { surfacePaths } from "../src/escape/material-assets.ts";
import { FROG_EXTRA_ART } from "../src/escape/extra-art.ts";
import { DOG_LOOKS } from "../src/runner/shop.ts";

test("escape lobby does not statically import the 3D renderer or engine", () => {
  const graph = JSON.parse(fs.readFileSync(new URL("../dist/.vite/manifest.json", import.meta.url), "utf8"));
  const visited = new Set();
  const visit = key => { if (visited.has(key)) return; visited.add(key); graph[key]?.imports?.forEach(visit); };
  visit("src/escape/game.ts");
  assert.ok(graph["src/escape/game.ts"].dynamicImports.includes("src/escape/renderer.ts"));
  assert.ok(!visited.has("src/escape/renderer.ts"));
  for (const key of visited) assert.ok(!/thinEngine|scene\.pure|pbrMaterial/.test(graph[key].file), "engine initialization stays behind the Start action");
  const bytes = [...visited].reduce((sum, key) => sum + fs.statSync(new URL("../dist/" + graph[key].file, import.meta.url)).size, 0);
  assert.ok(bytes < 512 * 1024, "lobby static JS dependency closure remains under 512KiB");
});

test("complete-offline inventory covers revisioned resources while the startup shell stays small", () => {
  const manifest = JSON.parse(fs.readFileSync(new URL("../dist/preload-manifest.json", import.meta.url), "utf8"));
  const worker = fs.readFileSync(new URL("../dist/sw.js", import.meta.url), "utf8");
  assert.ok(!worker.includes("self.__WB_MANIFEST"), "manifest must be injected");
  const startup = manifest.filter(entry => entry.startup === true);
  assert.ok(startup.length > 0 && startup.some(entry => entry.url === "index.html"));
  assert.ok(startup.reduce((sum, entry) => sum + entry.bytes, 0) < 512 * 1024, "first launch shell stays under 512KiB before transfer compression");
  assert.ok(startup.every(entry => !/\.(?:mp4|png|glb)$/.test(entry.url)), "unrelated original paintings, models and movies never gate first launch");
  assert.ok(worker.includes("PREPARE_GAME"));
  assert.equal(new Set(manifest.map(entry => entry.url)).size, manifest.length);
  const offline = new Set(manifest.map(entry => `/${entry.url}`));
  for (const look of DOG_LOOKS) {
    assert.ok(offline.has(look.sprite), `${look.name} atlas must be available offline`);
    assert.ok(offline.has(look.logo), `${look.name} logo must be available offline`);
  }
  for (const entry of manifest) {
    const content = fs.readFileSync(new URL(`../dist/${entry.url}`, import.meta.url));
    assert.equal(entry.bytes, content.length, `${entry.url} progress size`);
    assert.equal(entry.integrity, `sha256-${createHash("sha256").update(content).digest("base64")}`);
    assert.ok(worker.includes(`"bytes":${entry.bytes}`), "runtime byte counts must survive manifest injection");
    if (entry.revision) assert.equal(entry.revision, createHash("md5").update(content).digest("hex"));
    assert.ok(worker.includes(entry.url), `${entry.url} must be in the worker`);
  }
  const videos = manifest.filter(entry => entry.url.endsWith(".mp4"));
  assert.deepEqual(videos.map(entry => entry.url).sort(), [
    "assets/video/escape-caught-1-v1.mp4",
    "assets/video/escape-caught-2-v1.mp4",
    "assets/video/escape-caught-3-v1.mp4",
    "assets/video/escape-opening-2-v1.mp4",
    "assets/video/escape-opening-v1.mp4",
  ]);
  assert.ok(videos.every(entry => entry.revision && entry.bytes > 2000000));
  assert.ok(manifest.every(entry => entry.url !== "preload-manifest.json"));
  const versusArt = JSON.parse(fs.readFileSync(new URL('../public/assets/versus/manifest.json',import.meta.url),'utf8'));
  const seasonalArt = JSON.parse(fs.readFileSync(new URL('../public/assets/seasonal-baths-v1.json',import.meta.url),'utf8'));
  for(const a of seasonalArt.assets){assert.ok(manifest.some(entry=>entry.url===a.url.slice(1)));assert.equal(createHash('sha256').update(fs.readFileSync(new URL('../dist'+a.url,import.meta.url))).digest('hex'),a.sha256,'seasonal native PNG must remain byte-identical');}
  for (const asset of versusArt.assets) {
    assert.ok(manifest.some(entry=>entry.url===asset.url.slice(1)), 'every client painting is available offline');
    assert.equal(createHash('sha256').update(fs.readFileSync(new URL('../dist'+asset.url,import.meta.url))).digest('hex'),asset.sha256,'client art keeps its native bytes');
  }
  assert.ok(fs.readFileSync(new URL('../dist/assets/scenes/versus-cover-v1.png',import.meta.url))
    .equals(fs.readFileSync(new URL('../public/assets/scenes/versus-cover-v1.png',import.meta.url))), 'teaser cover retains native PNG bytes');
  for (const art of Object.values(FROG_EXTRA_ART)) {
    assert.ok(manifest.some(entry => entry.url === art.url.slice(1)), "new directional actions must be preloaded");
    const built = fs.readFileSync(new URL(`../dist${art.url}`, import.meta.url));
    assert.equal(createHash("sha256").update(built).digest("hex"), art.sha256, "native action PNG bytes must remain unchanged");
  }
  for (const url of [
    "index.html",
    "icon.svg",
    "boot.css",
    "boot-gallery.js",
    "assets/loading/playlist.json",
    "assets/character/milk-frog-atlas.webp",
    "assets/character/milk-frog-extra-v2.webp",
    "assets/character/wait.webp",
    "assets/scenes/bath-cover-v2.webp",
    "assets/scenes/versus-cover-v1.png",
    "assets/scenes/haunted-cover-v1.webp",
    "assets/scenes/bath-stage-v2.webp",
    "assets/scenes/workshop-stage-v1.webp",
    "assets/props/bath-props-v1.webp",
    "assets/props/garden-props-v1.webp",
    "assets/props/bathtub-v1.webp",
    "assets/audio/bubble-day-soft-v1.mp3",
    "assets/audio/ios-session-v1.mp3",
    "assets/audio/sewer-escape-v1.mp3",
    "assets/scenes/escape-cover-v1.webp",
    "assets/scenes/escape-materials-v1.webp",
    "assets/scenes/escape-basement-atlas-v1.webp",
    "assets/models/escape-props-v1.glb",
    "assets/character/haunted-frog-actions-v2.webp",
    "assets/character/haunted-frog-directions-idle-v1.webp",
    "assets/character/haunted-frog-directions-walk-v1.webp",
    "assets/ui/escape-map-atlas-v1.webp",
    "assets/props/escape-props-v1.webp",
    "assets/props/escape-details-v1.webp",
    "assets/audio/haunted-bath-v1.mp3",
    "assets/audio/haunted-laugh-v1.mp3",
    "assets/audio/runner-puppy-whimper-v1.mp3",
    "assets/runner/sewer-frog-corner-v1.webp",
    "assets/runner/obstacle-cedar-bark-v1.webp",
    "assets/runner/obstacle-cedar-ring-v1.webp",
    "assets/runner/obstacle-fractured-rock-v1.webp",
    "assets/runner/mine-amethyst-v1.webp",
    "assets/scenes/haunted-bath-v1.webp",
    "assets/scenes/haunted-corridor-v1.webp",
    "assets/scenes/haunted-machine-v1.webp",
    "assets/scenes/haunted-laundry-v1.webp",
    "assets/character/haunted-frog-v1.webp",
    "assets/props/pumpkin-v1.webp",
  ]) {
    const entry = manifest.find((entry) => entry.url === url);
    assert.ok(
      entry?.revision,
      `${url} needs a revision to update between releases`,
    );
  }
  assert.ok(manifest.some((entry) => /\.js$/.test(entry.url)));
  assert.ok(manifest.some((entry) => /\.css$/.test(entry.url)));
  for (const url of Object.values(surfacePaths)) {
    const entry = manifest.find(e => e.url === url.slice(1));
    assert.ok(entry?.revision, `${url} must be available offline`);
    assert.ok(fs.readFileSync(new URL(`../dist${url}`, import.meta.url)).equals(fs.readFileSync(new URL(`../public${url}`, import.meta.url))), `${url} must be copied byte-for-byte`);
  }
});
