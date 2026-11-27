/**
 * Small animals that come and go round the road: birds, gulls over the sea, vultures over the canyon,
 * bats, butterflies, falling leaves, fireflies, dust in the mine, tumbleweeds. All of them are sprites
 * from one painted atlas (plus one glow sprite), so the lot costs two draw calls.
 */
import type { Scene } from "@babylonjs/core/scene.js";
import { Vector3, Color4 } from "@babylonjs/core/Maths/math.js";
import { Engine } from "@babylonjs/core/Engines/engine.js";
import { SpriteManager } from "@babylonjs/core/Sprites/spriteManager.js";
import { Sprite } from "@babylonjs/core/Sprites/sprite.js";

export type AmbiencePoint = { x: number; y: number; z: number; heading: number };
export type AmbienceFrame = {
  /** Seconds since the last frame; 0 freezes everything (pause, menus). */
  dt: number;
  scene: number; night: boolean; weather: string;
  camera: Vector3; distance: number;
  /** Point on the route, offset sideways (positive = right of travel). */
  place: (distance: number, lateral: number) => AmbiencePoint;
  /** On or about to cross the log bridge over the sea. */
  sea: boolean;
  reducedMotion: boolean;
};

type Kind = "bird" | "gull" | "vulture" | "bat" | "butterfly" | "leaf" | "firefly" | "dust" | "tumbleweed";
type Critter = {
  kind: Kind; sprite: Sprite; on: boolean;
  x: number; y: number; z: number; vx: number; vy: number; vz: number;
  /** Anchor and circling radius for hovering and circling animals. */
  ax: number; ay: number; az: number; radius: number;
  age: number; life: number; phase: number; rate: number; ground: number; cells: readonly number[]; alpha: number;
};

// Atlas cells, 64 px each, eight to a row.
const CELL = 64;
const BIRD = [0, 1, 2] as const, BAT = [3, 4] as const, FLY = [5, 6] as const;
const LEAF = 7, MAPLE = 8, GINKGO = 9, BLADE = 10, TUMBLE = 11;
const GULL = [12, 13] as const, VULTURE = [14, 15] as const;
const BUTTERFLY_TINTS = [[1, .86, .32], [.55, .78, 1], [1, .62, .3], [.98, .98, .95], [.92, .55, .85]] as const;

const random = Math.random;
const between = (a: number, b: number) => a + random() * (b - a);
const side = () => random() < .5 ? -1 : 1;

export class RunnerAmbience {
  private critters: Critter[] = [];
  private glows: Critter[] = [];
  private flockWait = 3;
  private tumbleWait = 4;
  /** The way the road runs at the dog, to tell what is behind the camera. */
  private fx = 0;
  private fz = 1;
  private wanted: Record<Kind, number> = { bird: 0, gull: 0, vulture: 0, bat: 0, butterfly: 0, leaf: 0, firefly: 0, dust: 0, tumbleweed: 0 };

  constructor(scene: Scene) {
    const atlas = new SpriteManager("runner-critters", paintAtlas(), 72, CELL, scene);
    // Birds high over the road would fade into the fog colour against an unfogged sky.
    atlas.fogEnabled = false;
    const glow = new SpriteManager("runner-glow-critters", paintGlow(), 40, CELL, scene);
    glow.blendMode = Engine.ALPHA_ADD; glow.disableDepthWrite = true; glow.fogEnabled = false;
    for (const [manager, list, count] of [[atlas, this.critters, 72], [glow, this.glows, 40]] as const) {
      for (let i = 0; i < count; i++) {
        const sprite = new Sprite(`critter-${i}`, manager);
        sprite.isVisible = false; sprite.isPickable = false;
        list.push({ kind: "bird", sprite, on: false, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, ax: 0, ay: 0, az: 0, radius: 0, age: 0, life: 0, phase: 0, rate: 0, ground: 0, cells: BIRD, alpha: 1 });
      }
    }
  }

  /** Shows one sprite of each kind at `at` for the warm-up render, so their shaders are ready before the run. */
  warm(on: boolean, at: Vector3) {
    for (const pool of [this.critters, this.glows]) {
      const c = pool[0];
      c.sprite.isVisible = on; c.on = false; c.sprite.position.copyFrom(at);
    }
  }

  update(f: AmbienceFrame) {
    this.wanted = this.plan(f);
    const heading = f.place(f.distance, 0).heading;
    this.fx = Math.sin(heading); this.fz = Math.cos(heading);
    const dt = f.reducedMotion ? f.dt * .6 : f.dt;
    this.spawn(f, dt);
    for (const c of this.critters) if (c.on) this.move(c, f, dt);
    for (const c of this.glows) if (c.on) this.move(c, f, dt);
  }

  /** Hides everything at once (a new run starts somewhere else). */
  reset() {
    for (const c of [...this.critters, ...this.glows]) { c.on = false; c.sprite.isVisible = false; }
    this.flockWait = 3; this.tumbleWait = 4;
  }

  // ---------- animals ----------

  /** How many of each animal the scene wants round the dog right now. */
  private plan(f: AmbienceFrame): Record<Kind, number> {
    const day = !f.night, wet = f.weather === "rain";
    const want: Record<Kind, number> = { bird: 0, gull: 0, vulture: 0, bat: 0, butterfly: 0, leaf: 0, firefly: 0, dust: 0, tumbleweed: 0 };
    switch (f.scene) {
      case 0: if (day) want.bird = wet ? 0 : 5; else { want.firefly = 14; want.bat = 3; } break;
      case 1:
        if (f.sea && day) want.gull = 5;
        if (day) { want.bird = wet ? 0 : 5; want.butterfly = wet ? 0 : 6; } else { want.firefly = 16; want.bat = 3; }
        want.leaf = wet ? 5 : 10; break;
      case 2: want.bat = 5; want.dust = 26; break;
      case 3: if (day) { want.bird = wet ? 0 : 5; want.butterfly = wet ? 0 : 7; } else want.firefly = 22; want.leaf = wet ? 6 : 12; break;
      case 4: if (day) { want.vulture = 3; want.tumbleweed = 1; } else want.bat = 3; break;
      case 5: if (day) want.bird = 4; break;
    }
    if (f.reducedMotion) for (const key of Object.keys(want) as Kind[]) want[key] = Math.ceil(want[key] / 2);
    return want;
  }

  private count(kind: Kind) {
    let n = 0;
    for (const c of kind === "firefly" || kind === "dust" ? this.glows : this.critters) if (c.on && c.kind === kind) n++;
    return n;
  }
  private take(kind: Kind, cells: readonly number[], life: number) {
    const pool = kind === "firefly" || kind === "dust" ? this.glows : this.critters;
    const c = pool.find(item => !item.on);
    if (!c) return undefined;
    Object.assign(c, { kind, on: true, age: 0, life, phase: random() * Math.PI * 2, cells, alpha: 1, vx: 0, vy: 0, vz: 0, radius: 0 });
    c.sprite.isVisible = true; c.sprite.angle = 0; c.sprite.invertU = false; c.sprite.color = new Color4(1, 1, 1, 1);
    return c;
  }

  private spawn(f: AmbienceFrame, dt: number) {
    if (dt <= 0) return;
    const w = this.wanted;
    // Birds come over in flocks now and then; the others keep their numbers up round the dog.
    this.flockWait -= dt;
    if (w.bird && this.flockWait <= 0 && this.count("bird") === 0) { this.flock(f, w.bird); this.flockWait = between(6, 12); }
    if (w.gull && this.count("gull") === 0) this.circle(f, "gull", w.gull);
    if (w.vulture && this.count("vulture") === 0) this.circle(f, "vulture", w.vulture);
    this.tumbleWait -= dt;
    if (w.tumbleweed && this.tumbleWait <= 0 && this.count("tumbleweed") < w.tumbleweed) { this.tumbleweed(f); this.tumbleWait = between(5, 9); }
    for (const kind of ["bat", "butterfly", "leaf", "firefly", "dust"] as const) {
      // A few at a time, so a new scene fills up gradually rather than all at once.
      for (let n = this.count(kind), k = 0; n < w[kind] && k < 3; n++, k++) this.single(f, kind);
    }
  }

  private flock(f: AmbienceFrame, size: number) {
    // White egrets over the canal; small dark birds over the temple and bamboo; crows over the snow.
    const style = f.scene === 0 ? { tint: [.97, .97, .95], size: 1.45, rate: 2.6, speed: 8 } : f.scene === 5 ? { tint: [.1, .1, .12], size: 1.05, rate: 4.4, speed: 9 } : { tint: [.13, .12, .14], size: .75, rate: 7, speed: 11 };
    const s = side(), at = f.place(f.distance + between(55, 95), s * between(22, 40));
    const height = at.y + between(13, 24);
    // Across the road toward the other side, drifting a little the way the dog runs.
    const across = -s, rx = Math.cos(at.heading), rz = -Math.sin(at.heading), fx = Math.sin(at.heading), fz = Math.cos(at.heading);
    const vx = (rx * across + fx * .25) * style.speed, vz = (rz * across + fz * .25) * style.speed;
    const n = Math.max(3, size + Math.floor(random() * 3) - 1);
    for (let i = 0; i < n; i++) {
      const c = this.take("bird", BIRD, between(12, 15)); if (!c) return;
      // A loose V behind the leader.
      const back = Math.ceil(i / 2) * 2.4, wing = (i % 2 ? 1 : -1) * Math.ceil(i / 2) * 1.8;
      c.x = at.x - vx / style.speed * back + fx * wing; c.z = at.z - vz / style.speed * back + fz * wing; c.y = height - back * .15 + between(-.6, .6);
      c.vx = vx; c.vz = vz; c.vy = between(-.2, .3); c.rate = style.rate * between(.85, 1.15);
      c.sprite.width = c.sprite.height = style.size * between(.9, 1.1);
      c.sprite.color = new Color4(style.tint[0], style.tint[1], style.tint[2], 1);
    }
  }

  /** Gulls wheel low over the sea beside the log bridge; vultures circle high over the canyon. */
  private circle(f: AmbienceFrame, kind: "gull" | "vulture", n: number) {
    const gull = kind === "gull", s = side();
    const centre = f.place(f.distance + between(gull ? 45 : 70, gull ? 70 : 120), s * between(gull ? 10 : 25, gull ? 18 : 45));
    for (let i = 0; i < n; i++) {
      const c = this.take(kind, gull ? GULL : VULTURE, 60); if (!c) return;
      c.ax = c.x = centre.x; c.az = c.z = centre.z; c.ay = c.y = centre.y + (gull ? between(5, 10) : between(26, 38));
      c.radius = gull ? between(5, 11) : between(14, 24);
      c.rate = (gull ? between(.45, .7) : between(.18, .28)) * (random() < .5 ? -1 : 1);
      c.sprite.width = c.sprite.height = gull ? between(1.1, 1.4) : between(2.6, 3.2);
    }
  }

  private tumbleweed(f: AmbienceFrame) {
    const c = this.take("tumbleweed", [TUMBLE], 16); if (!c) return;
    const s = side(), at = f.place(f.distance + between(32, 58), s * 12);
    const rx = Math.cos(at.heading), rz = -Math.sin(at.heading), speed = between(3.5, 5);
    c.x = at.x; c.z = at.z; c.ground = at.y; c.y = at.y;
    c.vx = -s * rx * speed; c.vz = -s * rz * speed;
    c.rate = s * between(3, 5);
    c.sprite.width = c.sprite.height = between(.8, 1.1);
  }

  private single(f: AmbienceFrame, kind: "bat" | "butterfly" | "leaf" | "firefly" | "dust") {
    const mine = f.scene === 2;
    switch (kind) {
      case "bat": {
        const c = this.take(kind, BAT, between(3, 6)); if (!c) return;
        const at = f.place(f.distance + between(18, 60), side() * between(1, 9));
        c.x = at.x; c.z = at.z; c.y = at.y + (mine ? between(6.5, 10) : between(5, 12));
        c.vx = between(-6, 6); c.vz = between(-6, 3); c.vy = between(-.5, .5); c.rate = between(10, 13);
        c.sprite.width = c.sprite.height = between(.55, .8);
        c.sprite.color = new Color4(.75, .7, .8, 1);
        return;
      }
      case "butterfly": {
        const c = this.take(kind, FLY, 40); if (!c) return;
        const at = f.place(f.distance + between(6, 60), side() * between(4, 7.5));
        c.ax = c.x = at.x; c.az = c.z = at.z; c.ay = c.y = at.y + between(.45, 1.7); c.radius = between(.4, 1.1); c.rate = between(7, 10);
        const tint = BUTTERFLY_TINTS[Math.floor(random() * BUTTERFLY_TINTS.length)];
        c.sprite.color = new Color4(tint[0], tint[1], tint[2], 1);
        c.sprite.width = c.sprite.height = between(.28, .36);
        return;
      }
      case "leaf": {
        // Maple and ginkgo in the temple, long blades in the bamboo grove.
        const cell = f.scene === 3 ? BLADE : random() < .6 ? MAPLE : random() < .5 ? GINKGO : LEAF;
        const c = this.take(kind, [cell], 30); if (!c) return;
        const at = f.place(f.distance + between(4, 48), side() * between(0, 9));
        c.x = at.x; c.z = at.z; c.ground = at.y; c.y = at.y + between(4, 9);
        c.vy = -between(.6, 1.05); c.rate = between(1.2, 2.4) * (random() < .5 ? -1 : 1);
        const tint = cell === BLADE ? [.55 + random() * .2, .72 + random() * .15, .3] : cell === MAPLE ? [.95, .3 + random() * .35, .15] : cell === GINKGO ? [1, .82, .28] : [.6, .72, .3];
        c.sprite.color = new Color4(tint[0], tint[1], tint[2], 1);
        c.sprite.width = c.sprite.height = cell === BLADE ? between(.36, .48) : between(.24, .34);
        return;
      }
      case "firefly": case "dust": {
        const c = this.take(kind, [0], 40); if (!c) return;
        const glow = kind === "firefly", at = f.place(f.distance + between(3, glow ? 55 : 32), side() * (glow ? between(3, 9) : between(0, 6)));
        c.ax = c.x = at.x; c.az = c.z = at.z; c.ay = c.y = at.y + (glow ? (f.scene === 0 ? between(-1, 1.6) : between(.3, 2.2)) : between(.4, 5));
        c.radius = glow ? between(.3, .9) : between(.2, .6); c.rate = glow ? between(.5, 1.1) : between(.12, .3);
        c.alpha = 0;
        c.sprite.width = c.sprite.height = glow ? between(.34, .5) : between(.08, .14);
        c.sprite.color = glow ? new Color4(.85, 1, .45, 0) : new Color4(1, .82, .55, 0);
        return;
      }
    }
  }

  private move(c: Critter, f: AmbienceFrame, dt: number) {
    const s = c.sprite;
    c.age += dt;
    const cam = f.camera, circling = c.kind === "gull" || c.kind === "vulture";
    // Gone once it is well behind the camera or far away, or when the scene no longer has its kind.
    const dx = (circling ? c.ax : c.x) - cam.x, dz = (circling ? c.az : c.z) - cam.z;
    const behind = dx * this.fx + dz * this.fz < -8, far = dx * dx + dz * dz > 190 * 190;
    if (c.age > c.life || behind || far || !this.wanted[c.kind]) { c.on = false; s.isVisible = false; return; }
    const flap = (rate: number) => c.cells[Math.floor((c.age * rate + c.phase) % c.cells.length)];
    switch (c.kind) {
      case "bird": {
        c.x += c.vx * dt; c.y += c.vy * dt; c.z += c.vz * dt;
        // Flap for a while, then glide with the wings held out.
        const gliding = Math.sin(c.age * .9 + c.phase) > .45;
        s.cellIndex = gliding ? BIRD[1] : flap(c.rate);
        break;
      }
      case "gull": case "vulture": {
        const a = c.phase + c.age * c.rate;
        c.x = c.ax + Math.cos(a) * c.radius; c.z = c.az + Math.sin(a) * c.radius; c.y = c.ay + Math.sin(a * 2) * .6;
        const glide = c.kind === "vulture" ? Math.sin(c.age * .7 + c.phase) > -.6 : Math.sin(c.age * 1.3 + c.phase) > 0;
        s.cellIndex = glide ? c.cells[0] : flap(c.kind === "gull" ? 3 : 1.6);
        break;
      }
      case "bat": {
        // Jinking flight: the heading wobbles hard and fast.
        const jink = Math.sin(c.age * 7 + c.phase) * 4;
        c.x += (c.vx + jink) * dt; c.z += (c.vz - jink * .5) * dt; c.y += (c.vy + Math.sin(c.age * 9 + c.phase) * 1.4) * dt;
        s.cellIndex = flap(c.rate);
        break;
      }
      case "butterfly": {
        const a = c.age * .9 + c.phase;
        c.x = c.ax + Math.cos(a) * c.radius + Math.sin(a * 2.3) * .2; c.z = c.az + Math.sin(a * 1.3) * c.radius; c.y = c.ay + Math.sin(a * 3.1) * .25;
        s.cellIndex = flap(c.rate);
        break;
      }
      case "leaf": {
        c.y += c.vy * dt;
        c.x += Math.sin(c.age * 1.6 + c.phase) * .9 * dt; c.z += Math.cos(c.age * 1.1 + c.phase) * .6 * dt;
        s.angle += c.rate * dt; s.cellIndex = c.cells[0];
        if (c.y < c.ground + .05) { c.on = false; s.isVisible = false; return; }
        break;
      }
      case "firefly": case "dust": {
        const a = c.age * c.rate + c.phase;
        c.x = c.ax + Math.cos(a) * c.radius; c.z = c.az + Math.sin(a * 1.4) * c.radius; c.y = c.ay + Math.sin(a * 2.1) * c.radius * .6;
        // Fade in, then glow on and off (fireflies) or shimmer gently (dust in the lamp light).
        c.alpha = Math.min(1, c.alpha + dt * 2.5);
        const pulse = c.kind === "firefly" ? .3 + .7 * Math.max(0, Math.sin(c.age * 2.2 + c.phase * 3)) ** 2 : .45 + Math.sin(c.age * 1.7 + c.phase) * .2;
        s.color.a = c.alpha * pulse;
        s.cellIndex = 0;
        break;
      }
      case "tumbleweed": {
        c.x += c.vx * dt; c.z += c.vz * dt;
        c.y = c.ground + s.height * .48 + Math.abs(Math.sin(c.age * 3.6 + c.phase)) * .45;
        s.angle -= c.rate * dt; s.cellIndex = TUMBLE;
        break;
      }
    }
    s.position.set(c.x, c.y, c.z);
  }
}

// ---------- painted textures ----------

function canvas(width: number, height: number) {
  const el = document.createElement("canvas"); el.width = width; el.height = height;
  return [el, el.getContext("2d")!] as const;
}

/** Everything is painted light so a sprite's colour can tint it; dark animals are tinted dark. */
function paintAtlas() {
  const [el, ctx] = canvas(CELL * 8, CELL * 2);
  const cell = (index: number, draw: () => void) => {
    ctx.save(); ctx.translate((index % 8) * CELL, Math.floor(index / 8) * CELL); draw(); ctx.restore();
  };
  // Birds seen from below: a small body and two wings, raised, held out (an M), or swept down.
  const bird = (elbow: number, tip: number, tipColour?: string, broad = 1) => {
    ctx.fillStyle = "#f6f6f4";
    for (const s of [-1, 1]) {
      ctx.beginPath(); ctx.moveTo(32 + s * 2, 31);
      ctx.quadraticCurveTo(32 + s * 9, 31 + elbow - 2 * broad, 32 + s * 14, 31 + elbow);
      ctx.quadraticCurveTo(32 + s * 22, 31 + (elbow + tip) / 2 - broad, 32 + s * 29, 32 + tip);
      ctx.quadraticCurveTo(32 + s * 21, 34 + (elbow + tip) / 2 + broad, 32 + s * 14, 34 + elbow + 2 * broad);
      ctx.quadraticCurveTo(32 + s * 8, 35 + elbow / 2 + broad, 32 + s * 2, 36);
      ctx.fill();
      if (tipColour) { ctx.fillStyle = tipColour; ctx.beginPath(); ctx.ellipse(32 + s * 26, 32 + tip, 3.5, 2.2, s * .3, 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = "#f6f6f4"; }
    }
    ctx.beginPath(); ctx.ellipse(32, 34, 2.6, 6, 0, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.moveTo(30, 39); ctx.lineTo(32, 44); ctx.lineTo(34, 39); ctx.fill();
  };
  cell(BIRD[0], () => bird(-10, -20));
  cell(BIRD[1], () => bird(-4, 1));
  cell(BIRD[2], () => bird(5, 13));
  cell(GULL[0], () => bird(-6, -3, "#4b4f55", 1.4));
  cell(GULL[1], () => bird(2, 9, "#4b4f55", 1.4));
  // Vultures: broad dark wings with the long fingers spread at the tips.
  const vulture = (lift: number) => {
    ctx.fillStyle = "#3b2c25";
    for (const s of [-1, 1]) {
      ctx.beginPath(); ctx.moveTo(32, 29); ctx.lineTo(32 + s * 24, 29 + lift); ctx.lineTo(32 + s * 30, 31 + lift);
      for (let k = 0; k < 4; k++) { ctx.lineTo(32 + s * (30 - k * 1.6), 33 + lift + k * 1.4); ctx.lineTo(32 + s * (27 - k * 1.6), 32 + lift + k * 1.4); }
      ctx.lineTo(32 + s * 18, 37 + lift * .5); ctx.lineTo(32, 37); ctx.fill();
    }
    ctx.beginPath(); ctx.ellipse(32, 33, 3.2, 6, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#c9a98f"; ctx.beginPath(); ctx.arc(32, 26.5, 2.4, 0, Math.PI * 2); ctx.fill();
  };
  cell(VULTURE[0], () => vulture(-1));
  cell(VULTURE[1], () => vulture(-7));
  // Bats: scalloped wings, up and down.
  const bat = (lift: number) => {
    ctx.fillStyle = "#3a3540";
    for (const s of [-1, 1]) {
      ctx.beginPath(); ctx.moveTo(32, 30); ctx.lineTo(32 + s * 12, 30 + lift); ctx.lineTo(32 + s * 26, 28 + lift * 1.3);
      ctx.quadraticCurveTo(32 + s * 22, 36 + lift, 32 + s * 18, 36 + lift * .8);
      ctx.quadraticCurveTo(32 + s * 14, 40 + lift * .5, 32 + s * 10, 37 + lift * .4);
      ctx.quadraticCurveTo(32 + s * 6, 41, 32, 37); ctx.fill();
    }
    ctx.beginPath(); ctx.ellipse(32, 33, 3.4, 5, 0, 0, Math.PI * 2); ctx.fill();
    for (const s of [-1, 1]) { ctx.beginPath(); ctx.moveTo(32 + s * 1.5, 29); ctx.lineTo(32 + s * 3.5, 24); ctx.lineTo(32 + s * 3.8, 29.5); ctx.fill(); }
  };
  cell(BAT[0], () => bat(-9));
  cell(BAT[1], () => bat(7));
  // Butterfly: open from above, then folded seen edge-on; tinted per insect.
  cell(FLY[0], () => {
    for (const s of [-1, 1]) {
      ctx.fillStyle = "#ffffff";
      ctx.beginPath(); ctx.ellipse(32 + s * 11, 25, 11, 13, s * .45, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.ellipse(32 + s * 8, 41, 7.5, 9, -s * .5, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = "rgba(60,40,30,.55)"; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.ellipse(32 + s * 11, 25, 10, 12, s * .45, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = "rgba(40,30,30,.6)"; ctx.beginPath(); ctx.arc(32 + s * 13, 22, 2.6, 0, Math.PI * 2); ctx.fill();
    }
    ctx.fillStyle = "#2a2320"; ctx.fillRect(31, 18, 2.4, 30);
    ctx.strokeStyle = "#2a2320"; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(32, 18); ctx.lineTo(27, 11); ctx.moveTo(33, 18); ctx.lineTo(38, 11); ctx.stroke();
  });
  cell(FLY[1], () => {
    ctx.fillStyle = "#ffffff"; ctx.beginPath(); ctx.ellipse(32, 26, 4, 14, 0, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(32, 39, 3, 8, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#2a2320"; ctx.fillRect(31, 22, 2.4, 24);
  });
  // Leaves: plain, maple, ginkgo and a long bamboo blade, light with a darker vein.
  const vein = (x1: number, y1: number, x2: number, y2: number) => { ctx.strokeStyle = "rgba(90,70,50,.45)"; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke(); };
  cell(LEAF, () => { ctx.fillStyle = "#f2f2ea"; ctx.beginPath(); ctx.ellipse(32, 32, 10, 20, .5, 0, Math.PI * 2); ctx.fill(); vein(22, 49, 42, 15); });
  cell(MAPLE, () => {
    ctx.fillStyle = "#f4efe6"; ctx.beginPath();
    for (let k = 0; k < 10; k++) {
      const a = -Math.PI / 2 + k * Math.PI / 5, r = k % 2 ? 8 : 22;
      ctx.lineTo(32 + Math.cos(a) * r, 32 + Math.sin(a) * r);
    }
    ctx.closePath(); ctx.fill(); vein(32, 54, 32, 12);
  });
  cell(GINKGO, () => {
    ctx.fillStyle = "#f6f2e4"; ctx.beginPath(); ctx.moveTo(32, 48); ctx.lineTo(13, 22); ctx.quadraticCurveTo(32, 8, 51, 22); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = "rgba(90,70,50,.35)"; ctx.lineWidth = 1; for (let k = -2; k <= 2; k++) { ctx.beginPath(); ctx.moveTo(32, 48); ctx.lineTo(32 + k * 8, 17); ctx.stroke(); }
    vein(32, 48, 32, 58);
  });
  cell(BLADE, () => { ctx.fillStyle = "#f0f2e6"; ctx.beginPath(); ctx.ellipse(32, 32, 4.5, 26, .7, 0, Math.PI * 2); ctx.fill(); vein(17, 51, 47, 13); });
  // Tumbleweed: a loose ball of dry twigs, painted in its own straw colours.
  cell(TUMBLE, () => {
    for (let k = 0; k < 46; k++) {
      ctx.strokeStyle = ["#9c7a4c", "#b8955f", "#7f6038"][k % 3]; ctx.lineWidth = 1.3;
      const a = k * 2.4, r = 9 + (k % 5) * 3.4;
      ctx.beginPath(); ctx.arc(32 + Math.cos(a) * 4, 32 + Math.sin(a) * 4, r, a, a + 2 + (k % 3)); ctx.stroke();
    }
  });
  return el.toDataURL("image/png");
}

function paintGlow() {
  const [el, ctx] = canvas(CELL, CELL);
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 31);
  g.addColorStop(0, "rgba(255,255,255,1)"); g.addColorStop(.25, "rgba(255,255,255,.8)"); g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g; ctx.fillRect(0, 0, CELL, CELL);
  return el.toDataURL("image/png");
}
