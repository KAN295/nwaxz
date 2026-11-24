import { Engine } from "@babylonjs/core/Engines/engine.js";
import { Scene } from "@babylonjs/core/scene.js";
import { UniversalCamera } from "@babylonjs/core/Cameras/universalCamera.js";
import { Vector3, Color3, Color4 } from "@babylonjs/core/Maths/math.js";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder.js";
import { Mesh } from "@babylonjs/core/Meshes/mesh.js";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh.js";
import "@babylonjs/core/Meshes/instancedMesh.js";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode.js";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial.js";
import { Texture } from "@babylonjs/core/Materials/Textures/texture.js";
import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture.js";
import { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight.js";
import { DirectionalLight } from "@babylonjs/core/Lights/directionalLight.js";
import { ParticleSystem } from "@babylonjs/core/Particles/particleSystem.js";
import "@babylonjs/core/Particles/particleSystemComponent.js";
import type { Settings } from "../settings.ts";
import { loadImage, withTimeout } from "../loading.ts";
import { cleanSheet, createRunnerSprite, sheetTexture } from "./actors2d.ts";
import { chaserFrame, dogFall, dogPose } from "./animation.ts";
import { flameMesh } from "./fire3d.ts";
import { GroundOpenings, MAX_GROUND_OPENINGS, type GroundOpening } from "./groundOpenings.ts";
import { CORNER_RADIUS, RunnerRoute3D, type RoutePoint } from "./route3d.ts";
import { getDogLook } from "./shop.ts";
import { coversLane, isFallObstacle, isRunObstacle, isRunPower, LANE_WIDTH, obstacleHalfDepth, RUN_POWERS, RUN_SCENES, sceneAt, type RunItem, type RunPowerKind, type RunnerWorld } from "./world.ts";

/**
 * Everything lives in fixed world coordinates along the route; only the camera, the dog
 * and a few effects move each frame. Road tiles sit in a ring of slots and are placed
 * once when a slot is recycled, so static scenery costs almost nothing per frame.
 */
const TILE = 4;
const TILE_DEPTH = TILE + .45; // Overlap hides seams on curves.
const SLOTS = 44;
const BEHIND = 16;
const ROAD_HALF = LANE_WIDTH * 1.5 + .2;
const waterDepth = (kind: RunItem["kind"]) => kind === "long-gap" ? 2.65 : 1.55;
const itemOffset = (item: RunItem) => item.span === 3 ? 0 : (item.lane + ((item.span ?? 1) - 1) / 2 - 1) * LANE_WIDTH;
const DOG_SIZE = 2.1;
const FROG_SIZE = 2.4;
const LAUGH_SIZE = 3.4;
// Feet sit near the bottom of each sheet cell (measured from the drawings).
const DOG_FEET = .39, FROG_FEET = .48, LAUGH_FEET = .43;
const SKY_RADIUS = 330, SKY_HEIGHT = 345;
const FLAMES = [
  [-1.86, -.11, 2.15, 1.14], [-1.24, .24, 2.62, 1.2], [-.62, -.15, 2.31, 1.22], [0, .3, 2.79, 1.13],
  [.62, -.12, 2.42, 1.22], [1.24, .12, 2.68, 1.19], [1.86, -.06, 2.18, 1.14],
  [-1.35, -.44, 1.45, 1.14], [-.06, -.48, 1.68, 1.35], [1.22, -.45, 1.52, 1.22],
] as const;
const POWER_COLORS: Record<RunPowerKind, [string, string]> = {
  magnet: ["#ff5a4a", "#ffb0a0"], shield: ["#5fe0ff", "#d6f8ff"], boost: ["#ffc73a", "#fff1b0"],
  slow: ["#ba91ee", "#ecd6ff"], double: ["#e8a344", "#ffe8ab"],
};
const POWER_ART = {
  magnet: 0, shield: 1, boost: 2,
  slow: "/assets/runner/pickup-hourglass-v1.webp", double: "/assets/runner/pickup-double-score-v1.webp",
} satisfies Record<RunPowerKind, number | string>;
const GROVES = [
  { ground: -7, spacing: 5, trees: [{ name: "river-cypress", height: 13.2 }, { name: "river-willow", height: 12 }] },
  { ground: -.35, spacing: 3, trees: [{ name: "temple-banyan", height: 7.8 }, { name: "temple-maple", height: 6.9 }] },
  { ground: -.35, spacing: 6, trees: [{ name: "mine-dead-birch", height: 2.9 }, { name: "mine-old-root", height: 1.65 }] },
] as const;

type Theme = { sky: Color3; fog: Color3; nightSky: Color3; nightFog: Color3; ground: StandardMaterial; groundY: number };
type Decor = { node: TransformNode; every: number; offset: number };
type RoadLane = { main: TransformNode; otherSide?: TransformNode };
type Slot = { n: number; root: TransformNode; themes: TransformNode[]; lanes: RoadLane[][]; trees: Mesh[]; decor: Decor[]; theme: number; holes: (RunItem | undefined)[]; pierCut: boolean };

const angleTo = (from: number, to: number) => { let d = (to - from) % (Math.PI * 2); if (d > Math.PI) d -= Math.PI * 2; if (d < -Math.PI) d += Math.PI * 2; return d; };

export class RunnerRenderer3D {
  readonly engine: Engine;
  readonly scene: Scene;
  readonly camera: UniversalCamera;
  readonly dog;
  readonly chaserSprite;

  private sun: DirectionalLight;
  private ambient: HemisphericLight;
  private route = new RunnerRoute3D();
  private lastWorld?: RunnerWorld;
  private slots: Slot[] = [];
  private templates = new Map<string, TransformNode>();
  private props = new Map<number, TransformNode>();
  private corners = new Map<number, TransformNode>();
  private textures = new Map<string, Texture>();
  private sheets: Record<"run" | "actions" | "fall" | "walk" | "laugh", Texture | undefined> = { run: undefined, actions: undefined, fall: undefined, walk: undefined, laugh: undefined };
  private mats: Record<string, StandardMaterial> = {};
  private themes: Theme[] = [];
  private groundPlane: Mesh;
  private groundCuts: GroundOpening[] = [];
  private waterImpact = false;
  private sky: Mesh;
  private skyMat: StandardMaterial;
  private skies: { day: Texture; night: Texture }[] = [];
  private shadow: Mesh;
  private schoolSheet?: Texture;
  private rain: AbstractMesh[] = [];
  private snow: AbstractMesh[] = [];
  private streaks: AbstractMesh[] = [];
  private bubble: Mesh;
  private magnetRing: Mesh;
  private boostGlow: Mesh;
  private skinHalo: Mesh;
  private sparks: ParticleSystem;
  private silverSparks: ParticleSystem;
  private diamondSparks: ParticleSystem;
  private magic: ParticleSystem;
  private fireEmbers: ParticleSystem;
  private fireSmoke: ParticleSystem;
  private fireParticleTime = 0;
  private coinMats: Record<"silver" | "gold" | "diamond", StandardMaterial>;
  private dogLook = "original";
  private seen = { silver: 0, gold: 0, diamond: 0, power: 0, shield: 0, stumble: 0, turns: 0 };
  private flash = { shield: 0, power: 0 };
  private turnBlend = { x: 0, z: 0 };
  private camYaw = 0;
  private routeVersion = -1;
  private camLateral = 0;
  private cameraPos = new Vector3(0, 4, -8);
  private cameraTarget = new Vector3(0, 1, 6);
  private lastTime = 0;
  private disposed = false;

  constructor(private canvas: HTMLCanvasElement, private settings: Settings) {
    this.engine = new Engine(canvas, true, { stencil: false, powerPreference: "high-performance", preserveDrawingBuffer: false }, false);
    this.scene = new Scene(this.engine);
    this.scene.skipPointerMovePicking = true;
    this.scene.fogMode = Scene.FOGMODE_LINEAR;
    this.camera = new UniversalCamera("runner-chase-camera", this.cameraPos.clone(), this.scene);
    this.camera.minZ = .3; this.camera.maxZ = 800; this.camera.fov = .95;
    this.camera.inputs.clear();
    // Two lights only: every extra light costs on every pixel of every material.
    this.ambient = new HemisphericLight("runner-sky", new Vector3(0, 1, 0), this.scene);
    this.sun = new DirectionalLight("runner-sun", new Vector3(-.4, -.85, .35), this.scene);

    this.buildMaterials();
    this.groundPlane = MeshBuilder.CreateGround("runner-ground", { width: 900, height: 900 }, this.scene);
    this.groundPlane.isPickable = false;
    this.skyMat = new StandardMaterial("runner-sky-dome", this.scene);
    this.skyMat.disableLighting = true; this.skyMat.emissiveColor = Color3.White(); this.skyMat.fogEnabled = false; this.skyMat.backFaceCulling = false; this.skyMat.useAlphaFromDiffuseTexture = true;
    this.sky = MeshBuilder.CreateCylinder("runner-sky-dome", { diameter: SKY_RADIUS * 2, height: SKY_HEIGHT, tessellation: 48, cap: Mesh.NO_CAP, sideOrientation: Mesh.BACKSIDE }, this.scene);
    this.sky.material = this.skyMat; this.sky.isPickable = false; this.sky.infiniteDistance = false;

    this.dog = createRunnerSprite(this.scene, "runner-milk-dog-2d", DOG_SIZE);
    this.chaserSprite = createRunnerSprite(this.scene, "runner-milk-frog-2d", FROG_SIZE);
    this.shadow = MeshBuilder.CreateGround("runner-dog-shadow", { width: 1.8, height: 1.1 }, this.scene);
    this.shadow.material = this.radialMaterial("blob", "rgba(0,0,0,.55)", false);

    // Power-up effects around the dog.
    this.bubble = MeshBuilder.CreateSphere("shield-bubble", { diameter: 2.08, segments: 20 }, this.scene);
    const bubbleMat = this.glow("bubble", "#7fe8ff", "#2a9cc4"); bubbleMat.alpha = .22; bubbleMat.specularColor.set(1, 1, 1); bubbleMat.specularPower = 12; bubbleMat.backFaceCulling = false;
    this.bubble.material = bubbleMat; this.bubble.isPickable = false;
    this.magnetRing = MeshBuilder.CreateTorus("magnet-ring", { diameter: 1.88, thickness: .075, tessellation: 40 }, this.scene);
    const ringMat = this.glow("magnet-aura", "#ff6a5a", "#ff3a2a"); ringMat.alpha = .75; ringMat.disableLighting = true;
    this.magnetRing.material = ringMat; this.magnetRing.isPickable = false;
    this.boostGlow = MeshBuilder.CreateGround("boost-glow", { width: 2.9, height: 4.2 }, this.scene);
    this.boostGlow.material = this.radialMaterial("boost-glow", "rgba(255,205,70,.85)", true);
    this.skinHalo = MeshBuilder.CreateTorus("dog-look-halo", { diameter: 2.2, thickness: .07, tessellation: 40 }, this.scene);
    this.skinHalo.material = this.glow("dog-look-glow", "#b4e3ff", "#8bd4ff");
    this.skinHalo.isPickable = false;

    this.sparks = this.particles("coin-sparks", 240, "#fff2a0", "#ffc63a");
    this.silverSparks = this.particles("silver-sparks", 240, "#ffffff", "#a8cfdf");
    this.diamondSparks = this.particles("diamond-sparks", 240, "#eaffff", "#6bd6ff");
    this.magic = this.particles("power-sparks", 300, "#ffffff", "#ffffff");
    this.fireEmbers = this.particles("fire-embers", 220, "#fff0a0", "#ff4c16");
    this.fireEmbers.gravity.set(0, 2.4, 0); this.fireEmbers.minSize = .035; this.fireEmbers.maxSize = .14;
    this.fireEmbers.minLifeTime = .25; this.fireEmbers.maxLifeTime = 1; this.fireEmbers.minEmitPower = .4; this.fireEmbers.maxEmitPower = 2.3;
    this.fireSmoke = this.particles("fire-smoke", 90, "#8e8984", "#514d49");
    this.fireSmoke.blendMode = ParticleSystem.BLENDMODE_STANDARD;
    this.fireSmoke.color1 = new Color4(.28, .25, .23, .32); this.fireSmoke.color2 = new Color4(.39, .35, .32, .14);
    this.fireSmoke.gravity.set(0, 1.1, 0); this.fireSmoke.minSize = .16; this.fireSmoke.maxSize = .5;
    this.fireSmoke.minLifeTime = .6; this.fireSmoke.maxLifeTime = 1.6; this.fireSmoke.minEmitPower = .15; this.fireSmoke.maxEmitPower = .6;
    this.coinMats = { silver: this.glow("silver-coin", "#d9e5eb", "#293b44"), gold: this.mats.gold, diamond: this.glow("diamond-coin", "#a9f4ff", "#4794cb") };

    this.buildTemplates();
    this.buildSlots();
    this.buildWeather();
    this.resize();
  }

  // ---------- assets ----------

  private texture(path: string, repeat = 1) {
    const key = `${path}@${repeat}`;
    let texture = this.textures.get(key);
    if (texture) return texture;
    texture = new Texture(path, this.scene, false, true, Texture.TRILINEAR_SAMPLINGMODE);
    texture.anisotropicFilteringLevel = 4; texture.uScale = texture.vScale = repeat;
    this.textures.set(key, texture);
    return texture;
  }
  private mat(name: string, color: string, path?: string, repeat = 1) {
    const m = new StandardMaterial(`runner-${name}`, this.scene);
    m.diffuseColor = Color3.FromHexString(color);
    m.specularColor = new Color3(.08, .08, .08); m.specularPower = 32;
    m.maxSimultaneousLights = 2;
    if (path) m.diffuseTexture = this.texture(path, repeat);
    this.mats[name] = m;
    return m;
  }
  private glow(name: string, color: string, emissive: string) {
    const m = this.mat(name, color);
    m.emissiveColor = Color3.FromHexString(emissive);
    return m;
  }
  private radialMaterial(name: string, color: string, additive: boolean) {
    const texture = new DynamicTexture(`runner-${name}-tex`, { width: 128, height: 128 }, this.scene, false);
    const ctx = texture.getContext() as CanvasRenderingContext2D;
    const gradient = ctx.createRadialGradient(64, 64, 2, 64, 64, 62);
    gradient.addColorStop(0, color); gradient.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = gradient; ctx.fillRect(0, 0, 128, 128); texture.update(); texture.hasAlpha = true;
    const m = new StandardMaterial(`runner-${name}`, this.scene);
    m.diffuseTexture = texture; m.useAlphaFromDiffuseTexture = true; m.disableLighting = true;
    m.emissiveColor = additive ? Color3.White() : Color3.Black(); m.zOffset = -2; m.backFaceCulling = false;
    if (additive) m.alphaMode = Engine.ALPHA_ADD;
    this.mats[name] = m;
    return m;
  }
  private dotTexture() {
    const texture = new DynamicTexture("runner-dot", { width: 32, height: 32 }, this.scene, false);
    const ctx = texture.getContext() as CanvasRenderingContext2D, g = ctx.createRadialGradient(16, 16, 1, 16, 16, 15);
    g.addColorStop(0, "rgba(255,255,255,1)"); g.addColorStop(.45, "rgba(255,255,255,.75)"); g.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = g; ctx.fillRect(0, 0, 32, 32); texture.update(); texture.hasAlpha = true;
    return texture;
  }
  private particles(name: string, capacity: number, c1: string, c2: string) {
    const ps = new ParticleSystem(name, capacity, this.scene);
    ps.particleTexture = this.textures.get("dot") ?? this.dotTexture();
    this.textures.set("dot", ps.particleTexture as Texture);
    ps.emitter = Vector3.Zero(); ps.emitRate = 0; ps.blendMode = ParticleSystem.BLENDMODE_ADD;
    ps.color1 = Color4.FromHexString(`${c1}ff`); ps.color2 = Color4.FromHexString(`${c2}ff`); ps.colorDead = new Color4(0, 0, 0, 0);
    ps.minSize = .12; ps.maxSize = .32; ps.minLifeTime = .25; ps.maxLifeTime = .6;
    ps.minEmitPower = 2; ps.maxEmitPower = 5; ps.gravity = new Vector3(0, -6, 0);
    ps.direction1 = new Vector3(-1, 1.2, -1); ps.direction2 = new Vector3(1, 2.2, 1);
    ps.minEmitBox = new Vector3(-.2, -.2, -.2); ps.maxEmitBox = new Vector3(.2, .2, .2);
    ps.updateSpeed = 1 / 60;
    ps.start();
    return ps;
  }
  private burst(ps: ParticleSystem, at: Vector3, count: number, colors?: [string, string]) {
    if (colors) { ps.color1 = Color4.FromHexString(`${colors[0]}ff`); ps.color2 = Color4.FromHexString(`${colors[1]}ff`); }
    (ps.emitter as Vector3).copyFrom(at);
    ps.manualEmitCount = Math.max(ps.manualEmitCount, 0) + count;
  }

  private buildMaterials() {
    const stone = "/assets/runner/wet-stone-v1.png", wood = "/assets/materials/escape/04-aged-wood-v1.png";
    const rust = "/assets/materials/escape/08-rusted-iron-v1.png", rock = "/assets/materials/escape/05-basement-wall-v1.png";
    this.mat("road-aqueduct", "#e9e1cc", stone);
    this.mat("road-temple", "#cfc6a8", "/assets/materials/escape/06-basement-floor-v1.png");
    this.mat("road-mine", "#8d7f6a", "/assets/materials/escape/07-basement-ceiling-v1.png");
    this.mat("stone", "#d8cfb8", stone);
    this.mat("stone-dark", "#8e8a7c", stone);
    this.mat("moss-stone", "#9fa587", rock);
    this.mat("rock", "#6b5d4f", rock);
    this.mat("wood", "#ffffff", wood);
    this.mat("metal", "#9a9a9a", rust);
    this.mat("rail", "#b9b4aa", rust);
    this.mat("pit", "#05080a").specularColor.setAll(0);
    this.mat("foliage-dark", "#4a6538", rock, 2).specularColor.setAll(0);
    this.glow("gold", "#f2c443", "#7a560a").specularColor.set(.9, .8, .4);
    this.glow("lamp", "#ffe2a0", "#ffc25a");
    this.glow("warning", "#f2c443", "#3a2a00");
    this.radialMaterial("lamp-halo", "rgba(255,200,110,.9)", true);
    for (const [kind, [color]] of Object.entries(POWER_COLORS)) {
      const ring = this.glow(`ring-${kind}`, color, color); ring.alpha = .8; ring.disableLighting = true;
      const beam = this.glow(`beam-${kind}`, color, color); beam.alpha = .18; beam.disableLighting = true; beam.backFaceCulling = false; beam.alphaMode = Engine.ALPHA_ADD;
    }
    for (const grove of GROVES) for (const { name } of grove.trees) {
      const tree = this.mat(`tree-${name}`, "#ffffff", `/assets/runner/trees/${name}-v1.webp`);
      tree.diffuseTexture!.hasAlpha = true;
      tree.useAlphaFromDiffuseTexture = true;
      tree.disableLighting = true;
      tree.emissiveColor.setAll(1);
      tree.backFaceCulling = false;
      tree.transparencyMode = StandardMaterial.MATERIAL_ALPHATEST;
      tree.alphaCutOff = .29;
    }
    const water = this.mat("water", "#3f6f73", stone, 52);
    water.specularColor.set(.5, .6, .6); water.fogEnabled = false;
    for (const [name, repeat] of [["pit-water", 1], ["pit-water-long", 2]] as const) {
      const pool = this.mat(name, "#91aba8", "/assets/runner/pit-water-v1.png", repeat);
      pool.emissiveTexture = pool.diffuseTexture;
      pool.emissiveColor.set(.6, .66, .67);
      pool.specularColor.set(.35, .42, .43);
      if (name === "pit-water-long") (pool.diffuseTexture as Texture).vScale = 6;
    }
    const grass = this.mat("grass", "#6f8251", rock, 75); grass.specularColor.setAll(0);
    const cave = this.mat("cave-floor", "#2c241d", rock, 75); cave.specularColor.setAll(0);
    new GroundOpenings(grass, this.groundCuts);
    new GroundOpenings(cave, this.groundCuts);
    this.themes = [
      { sky: new Color3(.62, .74, .78), fog: new Color3(.66, .74, .74), nightSky: new Color3(.07, .1, .18), nightFog: new Color3(.1, .13, .2), ground: water, groundY: -7 },
      { sky: new Color3(.66, .76, .62), fog: new Color3(.6, .67, .55), nightSky: new Color3(.06, .09, .1), nightFog: new Color3(.08, .12, .12), ground: grass, groundY: -.35 },
      { sky: new Color3(.09, .07, .06), fog: new Color3(.12, .09, .07), nightSky: new Color3(.04, .03, .03), nightFog: new Color3(.06, .045, .04), ground: cave, groundY: -.35 },
    ];
  }
  async load() {
    const [run, actions, fall, walk, laugh] = await Promise.all([
      loadImage("/assets/runner/milk-dog-run-v2.png"), loadImage("/assets/runner/milk-dog-actions-v2.png"),
      loadImage("/assets/runner/milk-dog-fall-v1.png"),
      loadImage("/assets/character/haunted-frog-directions-walk-v1.webp"), loadImage("/assets/character/milk-frog-atlas.webp"),
    ]);
    this.sheets = {
      run: sheetTexture(this.scene, cleanSheet(run)), actions: sheetTexture(this.scene, cleanSheet(actions)),
      fall: sheetTexture(this.scene, cleanSheet(fall)),
      walk: sheetTexture(this.scene, walk.src), laugh: sheetTexture(this.scene, laugh.src),
    };
    this.dog.frame(this.sheets.actions!, 0, 4, 2);
    this.chaserSprite.frame(this.sheets.walk!, 4, 4, 4);
    // The sky is a world-fixed band: the side strip (cliffs, trees, sky) of each scene picture,
    // mirrored into a seamless panorama so the road in the middle of the photo never shows.
    const pictures = await Promise.all(RUN_SCENES.flatMap(scene => [loadImage(scene.image), loadImage(scene.night)]));
    this.skies = RUN_SCENES.map((_, i) => ({ day: this.panorama(pictures[i * 2], i), night: this.panorama(pictures[i * 2 + 1], i) }));
    this.skyMat.diffuseTexture = this.skies[0].day;
    await withTimeout(this.scene.whenReadyAsync(), "3D场景准备超时，请重试。");
    this.warmUp();
  }

  /**
   * Compile every shader variant before the run starts: instanced props and effects
   * would otherwise compile the first time they appear and freeze the game for a moment.
   */
  private warmUp() {
    const warm = new TransformNode("runner-warm-up", this.scene);
    warm.position.set(0, 0, 12);
    for (const name of this.templates.keys()) this.instance(name, warm);
    for (const slot of this.slots) slot.themes.forEach(group => group.setEnabled(true));
    const effects = [this.bubble, this.magnetRing, this.boostGlow, this.rain[0], this.snow[0], this.streaks[0]];
    effects.forEach(mesh => { mesh.setEnabled(true); mesh.position.set(0, 1, 10); });
    this.mats["lamp-halo"].alpha = .9;
    this.burst(this.sparks, new Vector3(0, 1, 10), 4); this.burst(this.magic, new Vector3(0, 1, 10), 4);
    this.camera.position.set(0, 4, -8); this.camera.setTarget(new Vector3(0, 1, 8));
    this.scene.render();
    warm.dispose();
    for (const slot of this.slots) slot.themes.forEach(group => group.setEnabled(false));
    [...effects, ...this.rain, ...this.snow, ...this.streaks].forEach(mesh => mesh.setEnabled(false));
  }

  private panorama(image: HTMLImageElement, scene: number) {
    const w = image.naturalWidth, h = image.naturalHeight;
    const crop = { x: 0, y: 0, w: w * .3, h: h * (scene === 1 ? .26 : .34) };
    const segment = 256, segments = 8, height = Math.round(segment * crop.h / crop.w);
    const canvas = document.createElement("canvas");
    canvas.width = segment * segments; canvas.height = height;
    const ctx = canvas.getContext("2d")!;
    for (let i = 0; i < segments; i++) {
      ctx.save();
      // Alternate plain and mirrored copies so every seam matches.
      if (i % 2) { ctx.translate((i + 1) * segment, 0); ctx.scale(-1, 1); } else ctx.translate(i * segment, 0);
      ctx.drawImage(image, crop.x, crop.y, crop.w, crop.h, 0, 0, segment, height);
      ctx.restore();
    }
    // Fade the bottom edge into the fog so the band meets the ground softly.
    const fade = ctx.createLinearGradient(0, height * .82, 0, height);
    fade.addColorStop(0, "rgba(0,0,0,0)"); fade.addColorStop(1, "rgba(0,0,0,1)");
    ctx.globalCompositeOperation = "destination-out"; ctx.fillStyle = fade; ctx.fillRect(0, height * .82, canvas.width, height * .18);
    const texture = new Texture(canvas.toDataURL("image/png"), this.scene, false, true, Texture.TRILINEAR_SAMPLINGMODE);
    texture.hasAlpha = true; texture.wrapV = Texture.CLAMP_ADDRESSMODE;
    return texture;
  }

  resize() {
    if (this.disposed) return;
    const rect = this.canvas.getBoundingClientRect();
    const ratio = Math.min(devicePixelRatio || 1, this.settings.quality === "high" ? 2 : 1.25);
    this.engine.setSize(Math.max(1, Math.round(rect.width * ratio)), Math.max(1, Math.round(rect.height * ratio)));
  }
  setDogLook(id: string, image?: HTMLImageElement) {
    if (this.disposed) return;
    this.schoolSheet?.dispose();
    this.schoolSheet = image ? sheetTexture(this.scene, image.src) : undefined;
    this.dogLook = image ? id : "original";
  }

  // ---------- static geometry ----------

  private box(name: string, parent: TransformNode, size: [number, number, number], at: [number, number, number], material: string) {
    const m = MeshBuilder.CreateBox(name, { width: size[0], height: size[1], depth: size[2] }, this.scene);
    m.parent = parent; m.position.set(...at); m.material = this.mats[material]; m.isPickable = false;
    return m;
  }
  private cylinder(name: string, parent: TransformNode, options: { diameterTop?: number; diameterBottom?: number; diameter?: number; height: number; tessellation?: number }, at: [number, number, number], material: string) {
    const m = MeshBuilder.CreateCylinder(name, { tessellation: 14, ...options }, this.scene);
    m.parent = parent; m.position.set(...at); m.material = this.mats[material]; m.isPickable = false;
    return m;
  }

  private pitSurface(parent: TransformNode, width: number, length: number, kind: RunItem["kind"]) {
    const pool = MeshBuilder.CreateGround("pit-water", { width, height: length }, this.scene);
    pool.parent = parent;
    pool.position.y = -waterDepth(kind);
    pool.material = this.mats[kind === "long-gap" ? "pit-water-long" : "pit-water"];
    pool.isPickable = false;
  }

  /** Off-screen source meshes; every road slot and prop is an instance of these, so they batch. */
  private buildTemplates() {
    const stash = new TransformNode("runner-templates", this.scene);
    stash.position.y = -500;
    const make = (name: string, build: (root: TransformNode) => void) => {
      const root = new TransformNode(`tpl-${name}`, this.scene); root.parent = stash; build(root); this.templates.set(name, root);
    };
    const L = LANE_WIDTH, W = ROAD_HALF * 2, D = TILE_DEPTH;
    for (const theme of RUN_SCENES) make(`lane-${theme.id}`, r => {
      this.box("lane", r, [L, .5, D], [0, -.25, 0], `road-${theme.id}`);
      // Track follows each floor segment so rails stop at the edges of a pit.
      if (theme.id === "mine") {
        for (const side of [-1, 1]) this.box("rail", r, [.1, .1, D], [side * .55, .05, 0], "rail");
        for (const z of [-1, 1]) this.box("sleeper", r, [1.6, .06, .28], [0, .01, z], "wood");
      }
    });
    make("aqueduct-wall", r => { for (const s of [-1, 1]) { this.box("parapet", r, [.45, .8, D], [s * (ROAD_HALF + .2), .15, 0], "stone"); this.box("coping", r, [.6, .14, D], [s * (ROAD_HALF + .2), .6, 0], "stone-dark"); } });
    make("aqueduct-pier", r => { this.box("pier", r, [W + 1.4, 9, 1.6], [0, -5, 0], "stone-dark"); for (const s of [-1, 1]) this.box("buttress", r, [1.4, 9, 2.2], [s * (ROAD_HALF + .3), -5, 0], "stone-dark"); });
    make("temple-ledge", r => { for (const s of [-1, 1]) { this.box("ledge", r, [.9, .55, D], [s * (ROAD_HALF + .45), .02, 0], "moss-stone"); this.box("hedge", r, [1.4, 1.1, D], [s * (ROAD_HALF + 1.6), .3, 0], "foliage-dark"); } });
    make("temple-arch", r => {
      for (const s of [-1, 1]) { this.box("column", r, [1.1, 6.4, 1.1], [s * (ROAD_HALF + .9), 3, 0], "moss-stone"); this.box("plinth", r, [1.5, .6, 1.5], [s * (ROAD_HALF + .9), .1, 0], "stone-dark"); }
      this.box("lintel", r, [W + 3.4, 1, 1.3], [0, 6.6, 0], "moss-stone");
      for (const s of [-1, 1]) { const vine = this.cylinder("vine", r, { diameter: .5, height: 2.4, tessellation: 6 }, [s * (ROAD_HALF + .3), 5.2, .5], "foliage"); vine.scaling.x = .6; }
    });
    make("mine-wall", r => {
      for (const s of [-1, 1]) this.box("rock-wall", r, [1.6, 8, D], [s * (ROAD_HALF + 1.2), 3.6, 0], "rock");
      this.box("ceiling", r, [W + 4, 1, D], [0, 7.4, 0], "rock");
    });
    make("mine-frame", r => {
      for (const s of [-1, 1]) this.box("post", r, [.38, 6.6, .38], [s * (ROAD_HALF + .15), 3.1, 0], "wood");
      this.box("cap", r, [W + .8, .45, .45], [0, 6.4, 0], "wood");
      this.box("lantern", r, [.32, .42, .32], [0, 5.95, 0], "lamp");
      const halo = MeshBuilder.CreatePlane("halo", { size: 2.2 }, this.scene); halo.parent = r; halo.position.set(0, 5.95, 0); halo.material = this.mats["lamp-halo"]; halo.billboardMode = Mesh.BILLBOARDMODE_ALL;
    });
    make("lamp-post", r => {
      for (const s of [-1, 1]) {
        this.cylinder("pole", r, { diameter: .14, height: 4.2 }, [s * (ROAD_HALF + .55), 2, 0], "metal");
        this.box("bulb", r, [.4, .5, .4], [s * (ROAD_HALF + .55), 4.25, 0], "lamp");
        this.box("hood", r, [.6, .12, .6], [s * (ROAD_HALF + .55), 4.55, 0], "metal");
        const halo = MeshBuilder.CreatePlane("halo", { size: 2.6 }, this.scene); halo.parent = r; halo.position.set(s * (ROAD_HALF + .55), 4.2, 0); halo.material = this.mats["lamp-halo"]; halo.billboardMode = Mesh.BILLBOARDMODE_ALL;
      }
    });
    make("plaza", r => { this.box("plaza", r, [W + 2, .5, W + 2], [0, -.26, 0], "stone-dark"); });
    make("dead-end", r => {
      this.box("wall", r, [W + 2.5, 3.2, 1], [0, 1.6, 0], "stone-dark");
      for (const s of [-1, 1]) this.box("pillar", r, [1, 4, 1.2], [s * (ROAD_HALF + 1.2), 2, 0], "stone");
    });

    // Obstacles. "-double" covers two lanes and "-wide" spans the road.
    make("block-double", r => {
      const trunk = this.cylinder("joined-log", r, { diameterTop: .62, diameterBottom: .86, height: 4.72, tessellation: 15 }, [0, .42, -.04], "wood");
      trunk.rotation.set(0, -.08, Math.PI / 2 + .035);
      const limb = this.cylinder("broken-limb", r, { diameterTop: .12, diameterBottom: .35, height: 1.9, tessellation: 11 }, [.5, .55, .13], "wood");
      limb.rotation.set(.16, .54, Math.PI / 2 - .23);
      for (const [x, z] of [[-1.8, -.43], [1.62, .33]] as const) {
        const stone = MeshBuilder.CreatePolyhedron("nesting-rock", { type: 2, size: .42 }, this.scene);
        stone.parent = r; stone.position.set(x, .13, z); stone.material = this.mats["moss-stone"];
      }
    });
    make("block-wide", r => {
      for (const [z, y, length, thick, angle] of [[0, .55, W + .75, 1.08, .03], [-.62, .28, W - .5, .45, -.1], [.58, .25, W - .8, .38, .12]] as const) {
        const log = this.cylinder("fallen-log", r, { diameterTop: thick * .8, diameterBottom: thick, height: length, tessellation: 15 }, [0, y, z], "wood");
        log.rotation.z = Math.PI / 2 + angle; log.rotation.y = z * .17;
      }
      for (const [x, z, tilt] of [[-2.5, .1, -.3], [-.8, -.45, .4], [1.45, .1, -.55], [2.5, .4, .26]] as const) {
        const branch = this.cylinder("broken-branch", r, { diameterTop: .03, diameterBottom: .2, height: 1.25, tessellation: 7 }, [x, 1.06, z], "wood");
        branch.rotation.z = tilt;
      }
      for (const x of [-3.2, 3.1]) { const rock = MeshBuilder.CreatePolyhedron("log-end-rock", { type: 2, size: .45 }, this.scene); rock.parent = r; rock.position.set(x, .15, .55); rock.material = this.mats["moss-stone"]; }
    });
    make("beam", r => {
      const width = 2.1;
      for (const s of [-1, 1]) this.box("post", r, [.16, 1.5, .16], [s * (width / 2 - .1), .75, 0], "metal");
      this.box("bar", r, [width, .38, .3], [0, 1.25, 0], "warning");
      for (let x = -width / 2 + .45; x < width / 2 - .2; x += .6) this.box("stripe", r, [.22, .4, .32], [x, 1.25, 0], "pit");
    });
    make("beam-wide", r => {
      for (const s of [-1, 1]) this.box("gate-post", r, [.6, 2.6, .6], [s * (ROAD_HALF + .1), 1.1, 0], "stone-dark");
      this.box("gate-bar", r, [W + 1.2, .55, .5], [0, 1.3, 0], "wood");
      for (let x = -3; x <= 3; x += 1.5) this.box("hanging", r, [.08, .5, .08], [x, .85, 0], "metal");
    });
    for (const [name, width] of [["gap", L], ["gap-wide", W], ["long-gap-wide", W]] as const) make(name, r => {
      for (const side of [-1, 1]) this.box("fissure-wall", r, [.25, 6.4, 3], [side * (width / 2 + .13), -3.2, 0], "rock");
      this.pitSurface(r, width + .05, 3.04, name === "long-gap-wide" ? "long-gap" : "gap");
      for (const side of [-1, 1]) {
        this.box("fissure-end", r, [width + .5, 6.4, .24], [0, -3.2, side * 1.62], "stone-dark");
        this.box("lip", r, [width, .2, .25], [0, -.09, side * 1.62], "stone-dark");
        this.box("edge", r, [width - .16, .04, .14], [0, .02, side * 1.64], "warning");
        if (name === "long-gap-wide") for (const x of [-1, 1]) {
          const edge = this.box("long-gap-marker", r, [.34, .58, .26], [x * (width / 2 - .22), .32, side * 1.83], "warning");
          edge.rotation.z = x * .1;
        }
      }
    });
    make("trap-double", r => {
      const halfDepth = obstacleHalfDepth("trap", 0);
      const width = 2 * L;
      for (let i = 0; i < 8; i++) this.box("trap-plank", r, [.57, .13, halfDepth * 2], [(i - 3.5) * .6, .02, 0], "wood");
      for (const side of [-1, 1]) {
        this.box("trap-shaft-wall", r, [.25, 6.4, halfDepth * 2], [side * (width / 2 + .13), -3.2, 0], "rock");
        this.box("trap-shaft-end", r, [width, 6.4, .24], [0, -3.2, side * (halfDepth + .12)], "stone-dark");
        this.box("trap-rim", r, [width, .13, .15], [0, .04, side * (halfDepth + .085)], "warning");
      }
      this.pitSurface(r, width + .05, halfDepth * 2 + .04, "trap");
    });
    make("spikes-double", r => {
      const width = 4.5, count = 11;
      for (let i = 0; i < count; i++) {
        const x = (i / (count - 1) - .5) * (width - .25), z = Math.sin(i * 2.3) * .48;
        const size = .27 + (i % 4) * .09;
        const rock = MeshBuilder.CreatePolyhedron("loose-rock", { type: i % 2 ? 1 : 2, size }, this.scene);
        rock.parent = r; rock.position.set(x, size * .36, z); rock.rotation.set(i * .11, i * 1.7, i * .23);
        rock.material = this.mats[i % 3 ? "moss-stone" : "rock"];
      }
      for (let i = 0; i < 6; i++) {
        const x = (i / 5 - .5) * (width - .6), z = i % 2 ? -.38 : .4;
        const branch = this.cylinder("fallen-twig", r, { diameterTop: .035, diameterBottom: .12, height: .95 + (i % 3) * .18, tessellation: 6 }, [x, .18, z], "wood");
        branch.rotation.z = Math.PI / 2 + (i % 2 ? -.34 : .25); branch.rotation.y = i * .71;
      }
    });
    make("boulder", r => {
      const rock = MeshBuilder.CreatePolyhedron("boulder", { type: 2, size: 1 }, this.scene);
      rock.parent = r; rock.position.y = 1.05; rock.scaling.set(1.05, 1.1, 1); rock.material = this.mats["moss-stone"];
    });
    const flameMaterial = new StandardMaterial("runner-fire-volume", this.scene);
    flameMaterial.diffuseTexture = this.texture("/assets/runner/flame-v2.png");
    flameMaterial.diffuseTexture.hasAlpha = true;
    flameMaterial.useAlphaFromDiffuseTexture = true; flameMaterial.disableLighting = true;
    flameMaterial.emissiveColor = Color3.White(); flameMaterial.backFaceCulling = false;
    flameMaterial.transparencyMode = StandardMaterial.MATERIAL_ALPHATESTANDBLEND;
    flameMaterial.alphaCutOff = .08;
    make("fire-double", r => {
      for (const [i, [x, z, height, width]] of FLAMES.entries()) {
        const flame = flameMesh(this.scene, i % 2 === 0);
        flame.parent = r;
        flame.position.set(x, -.015, z);
        flame.scaling.set(width, height, .94);
        flame.rotation.y = i * .64;
        flame.material = flameMaterial;
      }
    });
    for (const tier of ["silver", "gold"] as const) make(`coin-${tier}`, r => {
      const coin = this.cylinder("coin", r, { diameter: .62, height: .1, tessellation: 18 }, [0, 0, 0], "gold");
      coin.rotation.x = Math.PI / 2; coin.material = this.coinMats[tier];
      for (const side of [-1, 1]) {
        const ring = MeshBuilder.CreateTorus("coin-rim", { diameter: .47, thickness: .045, tessellation: 18 }, this.scene);
        ring.parent = r; ring.position.z = side * .065; ring.rotation.x = Math.PI / 2; ring.material = this.coinMats[tier];
      }
    });
    make("coin-diamond", r => {
      const gem = MeshBuilder.CreatePolyhedron("diamond-gem", { type: 1, size: .38 }, this.scene);
      gem.parent = r; gem.material = this.coinMats.diamond;
    });
    const powers = this.texture("/assets/runner/powerups-v1.png");
    for (const kind of RUN_POWERS) {
      const art = POWER_ART[kind];
      const texture = typeof art === "number" ? powers.clone() : this.texture(art);
      texture.hasAlpha = true;
      if (typeof art === "number") {
        texture.uScale = texture.vScale = .5; texture.uOffset = (art % 2) * .5; texture.vOffset = art < 2 ? .5 : 0;
      }
      const m = new StandardMaterial(`runner-power-${kind}`, this.scene);
      m.diffuseTexture = texture; m.useAlphaFromDiffuseTexture = true; m.disableLighting = true; m.backFaceCulling = false;
      m.emissiveColor = Color3.White(); m.transparencyMode = StandardMaterial.MATERIAL_ALPHATEST; m.alphaCutOff = .4;
      this.mats[`power-${kind}`] = m;
      make(kind, r => {
        const icon = MeshBuilder.CreatePlane("icon", { size: 1.25 }, this.scene); icon.parent = r; icon.position.y = 1.15; icon.material = m; icon.billboardMode = Mesh.BILLBOARDMODE_Y;
        const ring = MeshBuilder.CreateTorus("halo", { diameter: 1.42, thickness: .08, tessellation: 28 }, this.scene); ring.parent = r; ring.position.y = .06; ring.material = this.mats[`ring-${kind}`];
        // A light pillar so power-ups read from far away.
        this.cylinder("beam", r, { diameterTop: .65, diameterBottom: 1.2, height: 4.5, tessellation: 16 }, [0, 2.25, 0], `beam-${kind}`);
      });
    }
  }

  private instance(name: string, parent: TransformNode) {
    const node = this.templates.get(name)!.instantiateHierarchy(parent, { doNotInstantiate: false }, (source, clone) => { clone.name = source.name; })!;
    node.position.setAll(0);
    return node;
  }

  private buildSlots() {
    const treePlane = MeshBuilder.CreatePlane("runner-tree-source", { size: 1 }, this.scene);
    treePlane.setEnabled(false);
    treePlane.isPickable = false;
    treePlane.billboardMode = Mesh.BILLBOARDMODE_Y;
    for (let i = 0; i < SLOTS; i++) {
      const root = new TransformNode(`road-slot-${i}`, this.scene);
      const trees = [treePlane.clone(`runner-tree-${i}-left`, root), treePlane.clone(`runner-tree-${i}-right`, root)];
      for (const tree of trees) tree.setEnabled(false);
      const themes: TransformNode[] = [], lanes: RoadLane[][] = [], decor: Decor[] = [];
      const add = (name: string, group: TransformNode, every = 1, offset = 0) => { const node = this.instance(name, group); if (every > 1) decor.push({ node, every, offset }); return node; };
      ["aqueduct", "temple", "mine"].forEach((theme, t) => {
        const group = new TransformNode(`slot-${i}-${theme}`, this.scene); group.parent = root; themes.push(group);
        lanes.push([0, 1, 2].map(lane => {
          const main = add(`lane-${theme}`, group);
          main.position.x = (lane - 1) * LANE_WIDTH;
          return { main };
        }));
        if (t === 0) { add("aqueduct-wall", group); add("aqueduct-pier", group, 5, 0); add("lamp-post", group, 5, 3); }
        if (t === 1) { add("temple-ledge", group); add("temple-arch", group, 4, 2); add("lamp-post", group, 5, 3); }
        if (t === 2) { add("mine-wall", group); add("mine-frame", group, 2, 0); }
        group.setEnabled(false);
      });
      this.slots.push({ n: -1, root, themes, lanes, trees, decor, theme: -1, holes: [undefined, undefined, undefined], pierCut: false });
    }
  }

  private placeTrees(slot: Slot, nearTurn: boolean) {
    const { n, theme } = slot;
    const grove = GROVES[theme];
    for (const [i, tree] of slot.trees.entries()) {
      const offset = i === 0 ? 0 : theme === 2 ? 1 : 2;
      const visible = n > 0 && !nearTurn && (n + offset) % grove.spacing === 0;
      tree.setEnabled(visible);
      if (!visible) continue;
      const variant = (Math.floor((n + offset) / grove.spacing) + i) % grove.trees.length;
      const style = grove.trees[variant];
      const variation = (Math.imul(n + 13 * i, 2654435761) >>> 0) / 0x100000000;
      const height = style.height * (.88 + variation * .24);
      const material = this.mats[`tree-${style.name}`];
      const size = material.diffuseTexture!.getBaseSize();
      const width = height * (size.height > 0 ? size.width / size.height : .7);
      const side = i === 0 ? -1 : 1;
      const setback = theme === 2 ? 3.96 : ROAD_HALF + width / 2 + 1.2 + variation * 3.2;
      tree.material = material;
      tree.scaling.set(side * width, height, 1);
      tree.position.set(side * setback, grove.ground + height * .486, (variation - .5) * 1.8);
    }
  }

  private buildWeather() {
    const rain = this.mat("rain", "#cfe9f5"); rain.emissiveColor.set(.5, .6, .68); rain.alpha = .45; rain.disableLighting = true;
    const snow = new StandardMaterial("runner-snow", this.scene);
    snow.diffuseTexture = this.textures.get("dot")!; snow.useAlphaFromDiffuseTexture = true; snow.disableLighting = true; snow.emissiveColor = Color3.White();
    const streak = this.mat("streak", "#fff6d0"); streak.emissiveColor.set(1, .95, .75); streak.alpha = .55; streak.disableLighting = true; streak.alphaMode = Engine.ALPHA_ADD;
    const drop = MeshBuilder.CreateBox("rain-drop", { width: .02, height: .7, depth: .02 }, this.scene); drop.material = rain; drop.position.y = -500;
    const flake = MeshBuilder.CreatePlane("snow-flake", { size: .14 }, this.scene); flake.material = snow; flake.billboardMode = Mesh.BILLBOARDMODE_ALL; flake.position.y = -500;
    const line = MeshBuilder.CreateBox("speed-line", { width: .03, height: .03, depth: 4 }, this.scene); line.material = streak; line.position.y = -500;
    for (let i = 0; i < 140; i++) { this.rain.push(drop.createInstance(`rain-${i}`)); this.snow.push(flake.createInstance(`snow-${i}`)); }
    for (let i = 0; i < 36; i++) this.streaks.push(line.createInstance(`speed-${i}`));
  }

  // ---------- helpers ----------

  /** Point on the route, offset sideways (positive = right of travel). */
  private place(distance: number, lateral = 0): RoutePoint {
    const p = this.route.sample(distance);
    return { x: p.x + Math.cos(p.heading) * lateral, z: p.z - Math.sin(p.heading) * lateral, heading: p.heading };
  }
  /** Road centre under the dog: straight on into the corner until the turn is actually taken. */
  private dogCentre(world: RunnerWorld): RoutePoint {
    const turn = world.approachingTurn;
    if (turn && !turn.taken && world.distance > turn.z - CORNER_RADIUS) return this.route.straight(world.distance, turn.z) ?? this.route.sample(world.distance);
    return this.route.sample(world.distance);
  }

  // ---------- per frame ----------

  draw(world: RunnerWorld) {
    if (this.disposed) return;
    const now = performance.now() / 1000, dt = this.lastTime ? Math.min(.1, now - this.lastTime) : 0;
    this.lastTime = now;
    if (this.lastWorld !== world) this.reset(world);
    this.route.sync(world.turns, world.distance);

    const theme = world.sceneIndex, look = this.themes[theme], night = world.night;
    const weather = theme === 2 ? "sunny" : world.weather; // no rain or snow underground
    const capture = world.phase === "caught" || world.phase === "lost" || (world.phase === "paused" && world.reason !== "");
    const t = world.elapsed + (capture ? world.captureTime : 0);
    const running = world.phase === "running";

    this.drawAtmosphere(theme, look, night, weather);
    this.drawRoad(world);
    this.drawCorners(world);
    this.drawProps(world, t, dt);

    // Dog. A late turn press inside the curve blends from the straight line onto the arc.
    if (world.turnCount !== this.seen.turns) {
      const turn = world.turns.find(x => x.taken && Math.abs(x.z - world.distance) < CORNER_RADIUS + 2 && x.direction === world.lastTurnDirection);
      const straight = turn && world.distance > turn.z - CORNER_RADIUS ? this.route.straight(world.distance, turn.z) : undefined;
      if (straight) { const arc = this.route.sample(world.distance); this.turnBlend.x += straight.x - arc.x; this.turnBlend.z += straight.z - arc.z; }
      this.seen.turns = world.turnCount;
    }
    const decay = Math.exp(-dt * 9); this.turnBlend.x *= decay; this.turnBlend.z *= decay;
    const centre = this.dogCentre(world);
    centre.x += this.turnBlend.x; centre.z += this.turnBlend.z;
    const lateral = (world.position - 1) * LANE_WIDTH;
    const rx = Math.cos(centre.heading), rz = -Math.sin(centre.heading), fx = Math.sin(centre.heading), fz = Math.cos(centre.heading);
    const player = new Vector3(centre.x + rx * lateral, 0, centre.z + rz * lateral);

    const falling = world.trapFall && capture;
    const pose = dogPose(world, this.settings.reducedMotion, falling);
    const fall = dogFall(world, this.settings.reducedMotion);
    if (this.schoolSheet) {
      let frame = pose.sheet === "run" ? Math.floor(pose.frame / 2) : 4 + pose.frame;
      if (falling && world.captureTime > .06) frame = fall.frame >= 4 ? 7 : 6;
      else if (!capture && world.airborne && world.jumpCount === 2) frame = 6;
      this.dog.frame(this.schoolSheet, frame, 4, 2);
    } else if (falling && world.captureTime > .045) {
      this.dog.frame(this.sheets.fall!, fall.frame, 4, 2);
    } else {
      this.dog.frame(this.sheets[pose.sheet]!, pose.frame, 4, 2);
    }
    const squash = pose.sheet === "actions" && pose.frame === 3 && (!capture || falling) ? .1 : 0;
    this.dog.root.position.set(player.x + fx * fall.forward, DOG_SIZE * DOG_FEET + world.jumpHeight - squash - fall.drop, player.z + fz * fall.forward);
    const roll = this.schoolSheet ? fall.roll : fall.roll * .66;
    this.dog.root.rotation.z = roll * (lateral > 0 ? -1 : 1);
    this.dog.root.scaling.setAll(1);
    this.dog.material.alpha = 1;
    if (falling && world.fallObstacle) {
      const depth = waterDepth(world.fallObstacle.kind);
      const below = fall.drop - world.jumpHeight - depth;
      this.dog.material.alpha = Math.min(1, Math.max(0, (1.35 - below) / .45));
      if (!this.waterImpact && below > .28 && world.phase === "caught") {
        this.waterImpact = true;
        if (!this.settings.reducedMotion) {
          this.burst(this.magic, new Vector3(this.dog.root.position.x, -depth + .08, this.dog.root.position.z), 12, ["#d7eeee", "#416e72"]);
        }
      }
    }
    this.dog.root.setEnabled(this.dog.material.alpha > 0);
    this.skinHalo.setEnabled(this.dogLook !== "original" && !falling);
    if (this.skinHalo.isEnabled()) {
      const hue = Color3.FromHexString(getDogLook(this.dogLook).color);
      (this.skinHalo.material as StandardMaterial).emissiveColor.copyFrom(hue);
      this.skinHalo.position.set(player.x, .08 + world.jumpHeight, player.z);
      this.skinHalo.scaling.setAll(1 + Math.sin(t * 5) * .07);
    }
    const overGap = world.items.some(gap => (gap.kind === "gap" || gap.kind === "long-gap") && Math.abs(gap.z - world.distance) < obstacleHalfDepth(gap.kind, gap.z) && coversLane(gap, world.position, .6));
    this.shadow.position.set(player.x, .03, player.z); this.shadow.rotation.y = centre.heading;
    this.shadow.scaling.setAll(Math.max(.4, 1 - world.jumpHeight * .25));
    this.shadow.setEnabled(!falling && !overGap);

    this.drawEffects(world, player, t, dt, capture);

    // Chaser: shown for the opening sprint and after a stumble.
    const frog = this.chaserSprite;
    const close = capture ? 1 : world.phase === "ready" ? 0 : world.danger > 0 ? Math.min(1, world.danger / 2) : Math.max(0, 1 - world.elapsed / 3.5);
    if (falling) {
      frog.root.setEnabled(false);
      this.shadow.setEnabled(false);
    } else if (!capture) {
      frog.frame(this.sheets.walk!, chaserFrame(world, this.settings.reducedMotion), 4, 4);
      frog.root.scaling.setAll(1);
      const side = world.position > 1.4 ? -1 : 1, back = 2.4 + (1 - close) * 7;
      frog.root.position.set(player.x - fx * back + rx * side * 1.45, FROG_SIZE * FROG_FEET + Math.abs(Math.sin(world.gait * Math.PI * 2)) * .12, player.z - fz * back + rz * side * 1.45);
      frog.root.setEnabled(close > .02);
      frog.material.alpha = Math.min(1, close * 1.5);
    } else this.drawCapture(world, player, centre.heading);

    if (!falling) this.updateCamera(world, player, centre, capture, dt, t);
    this.sky.position.set(this.camera.position.x, SKY_HEIGHT / 2 - 12, this.camera.position.z);
    const gx = Math.round(this.camera.position.x / 70) * 70, gz = Math.round(this.camera.position.z / 70) * 70;
    this.groundPlane.position.set(gx, look.groundY, gz);
    for (const name of ["pit-water", "pit-water-long"]) {
      const water = this.mats[name].diffuseTexture as Texture;
      const drift = this.settings.reducedMotion ? 0 : t;
      water.uOffset = drift * .022;
      water.vOffset = drift * .047;
    }
    this.drawWeather(weather, t, running && world.boost > 0, centre.heading);
    this.scene.render();
  }

  private reset(world: RunnerWorld) {
    this.route = new RunnerRoute3D();
    for (const prop of this.props.values()) prop.dispose();
    for (const corner of this.corners.values()) corner.dispose();
    this.props.clear(); this.corners.clear();
    for (const slot of this.slots) { slot.n = -1; slot.theme = -1; }
    this.routeVersion = -1;
    this.lastWorld = world;
    this.lastTime = 0;
    this.fireParticleTime = 0;
    this.waterImpact = false;
    this.seen = { silver: world.silver, gold: world.gold, diamond: world.diamond, power: world.powerPicked, shield: world.shieldSaves, stumble: world.stumbles, turns: world.turnCount };
    this.flash = { shield: 0, power: 0 };
    this.turnBlend = { x: 0, z: 0 };
    this.camYaw = 0; this.camLateral = 0;
    this.cameraPos.set(0, 4.2, -8); this.cameraTarget.set(0, 1.2, 6);
  }

  private drawAtmosphere(theme: number, look: Theme, night: boolean, weather: string) {
    const dim = night ? .6 : weather === "sunny" ? 1 : .82;
    const sky = night ? look.nightSky : look.sky, fog = night ? look.nightFog : look.fog;
    const wet = weather === "rain" ? .85 : weather === "snow" ? 1.12 : 1;
    this.scene.clearColor = new Color4(sky.r * wet, sky.g * wet, sky.b * wet, 1);
    this.scene.fogColor = weather === "snow" && !night ? Color3.Lerp(fog, new Color3(.85, .88, .9), .5) : fog.scale(wet);
    this.scene.fogEnd = weather === "sunny" ? 170 : 125; this.scene.fogStart = weather === "sunny" ? 55 : 28;
    this.ambient.intensity = theme === 2 ? .7 : night ? .62 : .75 * dim;
    this.ambient.groundColor.set(.3 * dim, .27 * dim, .22 * dim);
    this.ambient.diffuse.set(night ? .7 : 1, night ? .76 : 1, night ? 1 : 1);
    this.sun.intensity = theme === 2 ? .2 : night ? .25 : .95 * dim;
    this.sun.diffuse.set(night ? .6 : 1, night ? .7 : .94, night ? 1 : .82);
    const tint = night ? .8 : theme === 2 ? .85 : weather === "sunny" ? 1 : .9;
    this.dog.tint(tint);
    this.chaserSprite.tint(tint);
    for (const [index, grove] of GROVES.entries()) {
      const shade = index === 2 ? .62 : night ? .62 : weather === "rain" ? .84 : .97;
      for (const { name } of grove.trees) this.mats[`tree-${name}`].emissiveColor.setAll(shade);
    }
    this.groundPlane.material = look.ground;
    const skies = this.skies[theme];
    if (skies) this.skyMat.diffuseTexture = night ? skies.night : skies.day;
    this.skyMat.emissiveColor.setAll(night ? .8 : weather === "sunny" ? 1 : .78);
    this.sky.setEnabled(theme !== 2);
    this.mats["lamp-halo"].alpha = night || theme === 2 ? .9 : 0;
  }

  /** Recycle slots only when the window moves; then fix up gap holes. */
  private drawRoad(world: RunnerWorld) {
    const first = Math.floor((world.distance - BEHIND) / TILE);
    const openings = world.items.flatMap(item => {
      if (!isFallObstacle(item.kind)) return [];
      const depth = obstacleHalfDepth(item.kind, item.z);
      return [{ item, start: item.z - depth, end: item.z + depth }];
    });
    this.groundCuts.length = 0;
    if (world.sceneIndex !== 0) {
      for (const { item, start, end } of openings) {
        if (end < world.distance - BEHIND || start > world.distance + 145) continue;
        const p = this.place(item.z, itemOffset(item));
        const halfWidth = item.span === 3 ? ROAD_HALF : (item.span ?? 1) * LANE_WIDTH / 2;
        const halfDepth = (end - start) / 2;
        // The route keeps obstacles on straight sections aligned to the world axes.
        const across = Math.abs(Math.cos(p.heading)), forward = Math.abs(Math.sin(p.heading));
        const x = across * halfWidth + forward * halfDepth;
        const z = forward * halfWidth + across * halfDepth;
        this.groundCuts.push([p.x - x, p.z - z, p.x + x, p.z + z]);
        if (this.groundCuts.length === MAX_GROUND_OPENINGS) break;
      }
    }
    if (this.route.version !== this.routeVersion) { this.routeVersion = this.route.version; for (const slot of this.slots) slot.n = -1; }
    for (let n = first; n < first + SLOTS; n++) {
      const slot = this.slots[((n % SLOTS) + SLOTS) % SLOTS];
      const recycled = slot.n !== n;
      const at = n * TILE + TILE / 2;
      if (recycled) {
        slot.n = n;
        const p = this.route.sample(at);
        slot.root.position.set(p.x, 0, p.z); slot.root.rotation.y = p.heading;
        const theme = sceneAt(at, world.startScene);
        if (slot.theme !== theme) { slot.themes.forEach((group, i) => group.setEnabled(i === theme)); slot.theme = theme; }
        this.placeTrees(slot, world.turns.some(turn => Math.abs(turn.z - at) < 18));
      }
      const half = TILE_DEPTH / 2;
      const here = openings.filter(gap => gap.start < at + half && gap.end > at - half);
      const pierCut = here.some(gap => gap.item.kind === "long-gap");
      if (recycled || pierCut !== slot.pierCut) {
        slot.pierCut = pierCut;
        for (const d of slot.decor) {
          const inLongGap = pierCut && d.node.name === "tpl-aqueduct-pier";
          d.node.setEnabled(!inLongGap && ((n % d.every) + d.every) % d.every === d.offset);
        }
      }
      for (let lane = 0; lane < 3; lane++) {
        const gap = here.find(opening => coversLane(opening.item, lane));
        if (!recycled && gap?.item === slot.holes[lane]) continue;
        slot.holes[lane] = gap?.item;
        const tile = slot.lanes[slot.theme][lane];
        if (!gap) {
          this.sizeLane(tile.main, -half, half);
          tile.otherSide?.setEnabled(false);
          continue;
        }
        const before = Math.max(-half, gap.start - at), after = Math.min(half, gap.end - at);
        if (before > -half && after < half) {
          if (!tile.otherSide) {
            tile.otherSide = this.instance(`lane-${RUN_SCENES[slot.theme].id}`, slot.themes[slot.theme]);
            tile.otherSide.position.x = tile.main.position.x;
          }
          this.sizeLane(tile.main, -half, before);
          this.sizeLane(tile.otherSide, after, half);
        } else {
          if (before > -half) this.sizeLane(tile.main, -half, before);
          else this.sizeLane(tile.main, after, half);
          tile.otherSide?.setEnabled(false);
        }
      }
    }
  }

  private sizeLane(node: TransformNode, start: number, end: number) {
    const length = end - start;
    node.setEnabled(length > .001);
    node.position.z = (start + end) / 2;
    node.scaling.z = length / TILE_DEPTH;
  }

  private drawCorners(world: RunnerWorld) {
    const live = new Set(world.turns.filter(turn => turn.z > world.distance - 30 && turn.z < world.distance + 170).map(turn => turn.z));
    for (const [z, node] of this.corners) if (!live.has(z)) { node.dispose(); this.corners.delete(z); }
    for (const turn of world.turns) {
      if (!live.has(turn.z) || this.corners.has(turn.z)) continue;
      const corner = this.route.corner(turn.z);
      if (!corner) continue;
      const node = new TransformNode(`corner-${turn.z}`, this.scene);
      this.instance("plaza", node);
      const wall = this.instance("dead-end", node); wall.position.z = ROAD_HALF + 1.4;
      node.position.set(corner.x, 0, corner.z); node.rotation.y = corner.heading;
      this.corners.set(turn.z, node);
    }
  }

  private drawProps(world: RunnerWorld, t: number, dt: number) {
    const visible = new Set<number>();
    for (const item of world.items) {
      const depth = item.kind === "long-gap" ? obstacleHalfDepth(item.kind, item.z) : 0;
      if (item.z + depth <= world.distance - 8 || item.z - depth >= world.distance + 155) continue;
      if (!item.done || isRunObstacle(item.kind)) visible.add(item.id);
    }
    for (const [id, root] of this.props) if (!visible.has(id)) { root.dispose(); this.props.delete(id); }
    for (const item of world.items) {
      if (!visible.has(item.id)) continue;
      let prop = this.props.get(item.id);
      if (!prop) {
        const name = item.kind === "coin" ? `coin-${item.tier ?? "silver"}` : item.span === 3 ? `${item.kind}-wide` : item.span === 2 ? `${item.kind}-double` : item.kind;
        prop = new TransformNode(`item-${item.id}`, this.scene);
        this.instance(this.templates.has(name) ? name : item.kind, prop);
        if (item.kind === "long-gap") {
          const depth = obstacleHalfDepth(item.kind, item.z);
          for (const mesh of prop.getChildMeshes()) {
            if (mesh.name === "fissure-wall" || mesh.name === "pit-water") mesh.scaling.z = depth / 1.5;
            else mesh.position.z += Math.sign(mesh.position.z) * (depth - 1.5);
          }
        }
        this.props.set(item.id, prop);
      }
      const p = this.place(item.z, itemOffset(item));
      prop.position.set(p.x, 0, p.z); prop.rotation.y = p.heading;
      if (item.kind === "coin") {
        prop.position.y = item.y ?? .8; prop.rotation.y += t * 3 + item.id;
        if (item.pulled) prop.scaling.setAll(1.25);
      }
      else if (isRunPower(item.kind)) { prop.position.y = Math.sin(t * 3 + item.id) * .15; prop.getChildren()[0]?.getChildren().forEach(c => { if (c.name === "halo") (c as TransformNode).rotation.y = t * 2; }); }
      else if (item.kind === "fire") {
        const phase = this.settings.reducedMotion ? 0 : t;
        for (const [index, mesh] of prop.getChildMeshes().entries()) {
          const beat = item.id * .29 + index * 2.3;
          const [, , height, width] = FLAMES[index];
          mesh.scaling.x = width * (1 + Math.sin(phase * 11 + beat) * .1);
          mesh.scaling.y = height * (1 + Math.sin(phase * 9 + beat) * .12 + Math.sin(phase * 17 - beat) * .055);
          mesh.rotation.z = Math.sin(phase * 7 + beat) * .09;
        }
      }
      else if (item.kind === "trap" && world.fallObstacle === item) {
        // The two leaves swing down around their outer rails, clearing the middle of the shaft.
        const planks = prop.getChildMeshes().filter(mesh => mesh.name === "trap-plank");
        for (const [index, plank] of planks.entries()) {
          const closedX = (index - 3.5) * (LANE_WIDTH / 4);
          const side = Math.sign(closedX);
          const arm = LANE_WIDTH - Math.abs(closedX);
          const progress = Math.min(1, Math.max(0, world.captureTime - (side > 0 ? .035 : 0)) / .35);
          const angle = 1.49 * progress * progress * (3 - 2 * progress);
          plank.rotation.z = side * angle;
          plank.position.x = side * (LANE_WIDTH - arm * Math.cos(angle));
          plank.position.y = .02 - arm * Math.sin(angle);
        }
      }
    }
    if (world.phase !== "running") return;
    const fire = world.items.find(item => item.kind === "fire" && item.z > world.distance - 2 && item.z < world.distance + 22);
    if (!fire) { this.fireParticleTime = 0; return; }
    this.fireParticleTime += dt * 60 * world.timeScale;
    const ticks = Math.floor(this.fireParticleTime);
    if (!ticks) return;
    this.fireParticleTime -= ticks;
    const at = this.place(fire.z, itemOffset(fire));
    const across = Math.abs(Math.cos(at.heading)), forward = Math.abs(Math.sin(at.heading));
    const spreadX = across * 1.9 + forward * .35, spreadZ = forward * 1.9 + across * .35;
    this.fireEmbers.minEmitBox.set(-spreadX, 0, -spreadZ);
    this.fireEmbers.maxEmitBox.set(spreadX, .35, spreadZ);
    (this.fireEmbers.emitter as Vector3).set(at.x, .52, at.z);
    (this.fireSmoke.emitter as Vector3).set(at.x, 1.55, at.z);
    this.fireEmbers.manualEmitCount += ticks * (this.settings.reducedMotion ? 1 : 5);
    if (!this.settings.reducedMotion) this.fireSmoke.manualEmitCount += ticks;
  }

  private drawEffects(world: RunnerWorld, player: Vector3, t: number, dt: number, capture: boolean) {
    const at = new Vector3(player.x, .9 + world.jumpHeight, player.z);
    const coinAt = at.add(new Vector3(0, .3, 0));
    for (const [tier, system] of [["silver", this.silverSparks], ["gold", this.sparks], ["diamond", this.diamondSparks]] as const) {
      if (world[tier] > this.seen[tier]) this.burst(system, coinAt, Math.min(30, (world[tier] - this.seen[tier]) * 8));
      this.seen[tier] = world[tier];
    }
    if (world.powerPicked > this.seen.power) { this.burst(this.magic, at, 70, POWER_COLORS[world.lastPower]); this.flash.power = 1; }
    this.seen.power = world.powerPicked;
    if (world.shieldSaves > this.seen.shield) { this.burst(this.magic, at, 90, POWER_COLORS.shield); this.flash.shield = 1; }
    this.seen.shield = world.shieldSaves;
    if (world.stumbles > this.seen.stumble) this.burst(this.magic, new Vector3(player.x, .4, player.z), 30, ["#b8a07a", "#6d5a3e"]);
    this.seen.stumble = world.stumbles;
    this.flash.power = Math.max(0, this.flash.power - dt * 2.5);
    this.flash.shield = Math.max(0, this.flash.shield - dt * 2);

    const motion = this.settings.reducedMotion ? 0 : 1;
    // Shield: a bubble around the dog, blinking in its last three seconds; it bursts when used.
    const shieldOn = !capture && (world.shield > 0 || this.flash.shield > 0);
    this.bubble.setEnabled(shieldOn);
    if (shieldOn) {
      const ending = world.shield > 0 && world.shield < 3 && Math.floor(t * 8) % 2 === 0;
      const pop = this.flash.shield > 0 && world.shield === 0 ? 1 + (1 - this.flash.shield) * .8 : 1 + Math.sin(t * 4) * .03 * motion;
      this.bubble.position.copyFrom(at); this.bubble.scaling.setAll(pop);
      (this.bubble.material as StandardMaterial).alpha = world.shield === 0 ? this.flash.shield * .35 : ending ? .08 : .22;
    }
    // Magnet: a spinning red ring at the dog's feet.
    const magnetOn = !capture && world.magnet > 0;
    this.magnetRing.setEnabled(magnetOn);
    if (magnetOn) {
      this.magnetRing.position.set(player.x, .15 + world.jumpHeight + Math.sin(t * 6) * .12 * motion, player.z);
      this.magnetRing.rotation.y = t * 4; this.magnetRing.scaling.setAll(1 + Math.sin(t * 9) * .08 * motion);
      (this.magnetRing.material as StandardMaterial).alpha = world.magnet < 3 && Math.floor(t * 8) % 2 === 0 ? .25 : .8;
    }
    // Boost: golden glow under the dog plus speed lines (in drawWeather) and wider FOV.
    const boostOn = !capture && world.boost > 0;
    this.boostGlow.setEnabled(boostOn);
    if (boostOn) { this.boostGlow.position.set(player.x, .05, player.z); this.boostGlow.rotation.y = Math.atan2(player.x - this.camera.position.x, player.z - this.camera.position.z); }
    if (boostOn && Math.random() < .5) this.burst(this.magic, new Vector3(player.x, .5 + world.jumpHeight, player.z), 2, POWER_COLORS.boost);
  }

  private drawCapture(world: RunnerWorld, player: Vector3, heading: number) {
    const frog = this.chaserSprite, dog = this.dog.root;
    const time = world.captureTime, forward = new Vector3(Math.sin(heading), 0, Math.cos(heading));
    const pounce = Math.min(1, time / .45), ease = pounce * pounce * (3 - 2 * pounce);
    if (time < .45) {
      // The frog lunges in from behind with its grinning face.
      frog.frame(this.sheets.walk!, 0, 4, 4); frog.root.scaling.setAll(1);
      const at = Vector3.Lerp(player.subtract(forward.scale(4)), player.subtract(forward.scale(.9)), ease);
      frog.root.position.set(at.x, FROG_SIZE * FROG_FEET + Math.sin(pounce * Math.PI) * 1.2, at.z);
    } else {
      // Then the original belly laugh, large and facing the camera.
      frog.frame(this.sheets.laugh!, 6, 4, 2);
      const scale = LAUGH_SIZE / FROG_SIZE * (this.settings.reducedMotion ? 1 : 1 + Math.sin(time * 16) * .02);
      frog.root.scaling.setAll(scale);
      const at = player.subtract(forward.scale(1.1));
      frog.root.position.set(at.x, FROG_SIZE * scale * LAUGH_FEET, at.z);
    }
    frog.root.setEnabled(true); frog.material.alpha = 1;
    const shake = this.settings.reducedMotion ? 0 : Math.sin(time * 40) * .05;
    dog.position.set(player.x + forward.x * .6 + shake, DOG_SIZE * DOG_FEET - .1, player.z + forward.z * .6);
  }

  private updateCamera(world: RunnerWorld, player: Vector3, centre: RoutePoint, capture: boolean, dt: number, t: number) {
    const portrait = this.engine.getRenderWidth() / Math.max(1, this.engine.getRenderHeight()) < .85;
    const k = (rate: number) => dt > 0 ? 1 - Math.exp(-rate * dt) : 1;
    // The camera turns a little behind the road, so a corner swings the view round smoothly.
    this.camYaw += angleTo(this.camYaw, centre.heading) * k(capture ? 2 : 4.5);
    const fov = (portrait ? 1.08 : .9) + (world.boost > 0 && !capture ? .14 : 0);
    this.camera.fov += (fov - this.camera.fov) * k(4);
    const fx = Math.sin(this.camYaw), fz = Math.cos(this.camYaw);
    let position: Vector3, target: Vector3;
    if (capture) {
      const rx = Math.cos(centre.heading), rz = -Math.sin(centre.heading), hx = Math.sin(centre.heading), hz = Math.cos(centre.heading);
      position = new Vector3(player.x + hx * 7.5 + rx * 1.6, 2.6, player.z + hz * 7.5 + rz * 1.6);
      target = new Vector3(player.x - hx * .6, 1.6, player.z - hz * .6);
      Vector3.LerpToRef(this.cameraPos, position, k(3.2), this.cameraPos);
      Vector3.LerpToRef(this.cameraTarget, target, k(3.2), this.cameraTarget);
    } else {
      // Follow most of the lane offset (smoothed) so the dog stays near the centre of the screen.
      const lateral = (world.position - 1) * LANE_WIDTH * (portrait ? .8 : .6);
      this.camLateral += (lateral - this.camLateral) * k(10);
      const rx = Math.cos(this.camYaw), rz = -Math.sin(this.camYaw);
      const bx = centre.x + rx * this.camLateral, bz = centre.z + rz * this.camLateral;
      const back = portrait ? 8.4 : 7.4, height = (portrait ? 4.6 : 4.1) + world.jumpHeight * .25;
      this.cameraPos.set(bx - fx * back, height, bz - fz * back);
      this.cameraTarget.set(bx + fx * 7, 1.1 + world.jumpHeight * .35, bz + fz * 7);
      if (!this.settings.reducedMotion && world.elapsed - world.hitAt < .35) this.cameraPos.x += Math.sin(t * 60) * .12;
    }
    this.camera.position.copyFrom(this.cameraPos);
    this.camera.setTarget(this.cameraTarget);
  }

  private drawWeather(weather: string, t: number, boost: boolean, heading: number) {
    const cam = this.camera.position;
    const fx = Math.sin(heading), fz = Math.cos(heading), rx = Math.cos(heading), rz = -Math.sin(heading);
    const spread = (i: number, salt: number) => ((Math.sin(i * 12.9898 + salt) * 43758.5453) % 1 + 1) % 1;
    const rainOn = weather === "rain", snowOn = weather === "snow";
    if (this.rain[0].isEnabled() !== rainOn) this.rain.forEach(d => d.setEnabled(rainOn));
    if (this.snow[0].isEnabled() !== snowOn) this.snow.forEach(f => f.setEnabled(snowOn));
    if (rainOn) this.rain.forEach((drop, i) => {
      const a = spread(i, 1) * 30 - 4, b = spread(i, 2) * 18 - 9;
      drop.position.set(cam.x + fx * a + rx * b, ((spread(i, 3) * 12 - t * 16) % 12 + 12) % 12 - 1, cam.z + fz * a + rz * b);
    });
    if (snowOn) this.snow.forEach((flake, i) => {
      const a = spread(i, 4) * 26 - 3, b = spread(i, 5) * 18 - 9 + Math.sin(t + i) * .4;
      flake.position.set(cam.x + fx * a + rx * b, ((spread(i, 6) * 10 - t * 1.6) % 10 + 10) % 10 - .5, cam.z + fz * a + rz * b);
    });
    // Speed lines streaming past the camera while boosting.
    if (this.streaks[0].isEnabled() !== boost) this.streaks.forEach(s => s.setEnabled(boost));
    if (boost) this.streaks.forEach((line, i) => {
      const along = ((spread(i, 7) * 30 - t * 60) % 30 + 30) % 30 - 2;
      const side = (spread(i, 8) < .5 ? -1 : 1) * (2.5 + spread(i, 9) * 4), up = .5 + spread(i, 10) * 4.5;
      line.position.set(cam.x + fx * along + rx * side, up, cam.z + fz * along + rz * side);
      line.rotation.y = heading;
    });
  }

  dispose() { if (this.disposed) return; this.disposed = true; this.scene.dispose(); this.engine.dispose(); }
}
