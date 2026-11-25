import { Engine } from "@babylonjs/core/Engines/engine.js";
import { Scene } from "@babylonjs/core/scene.js";
import { UniversalCamera } from "@babylonjs/core/Cameras/universalCamera.js";
import { Vector3, Color3, Color4 } from "@babylonjs/core/Maths/math.js";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder.js";
import { Mesh } from "@babylonjs/core/Meshes/mesh.js";
import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData.js";
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
import { CAPTURE_LAUGH_AT, MINECART_SURPRISE_ART, captureMotion, chaserFrame, dogFall, dogPose } from "./animation.ts";
import { FROG_EXTRA_ART } from "../escape/extra-art.ts";
import { BRIDGE_LENGTH, BRIDGE_WATER_Y, elevationAt, featureOf, GORGE_HALF_WIDTH, GORGE_Y, isDownhillRope, rideLateralScale, ROPE_GRAB_DISTANCE, ROPE_LANE_SCALE, ropeHeightAt, ropeReleaseProgress, SEA_Y, sectionFeature, sectionIndexAt, type CourseFeature } from "./course.ts";
import { flameMesh } from "./fire3d.ts";
import { GroundOpenings, MAX_GROUND_OPENINGS, type GroundOpening } from "./groundOpenings.ts";
import { CORNER_RADIUS, RunnerRoute3D, type RoutePoint } from "./route3d.ts";
import { getDogLook } from "./shop.ts";
import { BRIDGE_FORK_BREAK, coversLane, FORK_BRIDGE_BREAK, FORK_BRIDGE_START, isFallObstacle, isRunObstacle, isRunPower, LANE_WIDTH, obstacleHalfDepth, RUN_POWERS, RUN_SCENES, sceneAt, SHAFT_EDGE, type RunItem, type RunPowerKind, type RunTurn, type RunnerWorld } from "./world.ts";

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
// Feet sit near the bottom of each sheet cell (measured from the drawings).
const DOG_FEET = .39, FROG_FEET = .48;
const FISSURE_HALF = obstacleHalfDepth("gap", 0);
const SKY_RADIUS = 330, SKY_HEIGHT = 345;
const GROUND_SIZE = 900, GROUND_SNAP = 70;
// Broken-bridge side of a fork, in metres along that side: the stub road ends where the deck starts,
// the deck snaps off at the break, and the far end hangs on the other bank.
const FORK_STUB_START = (ROAD_HALF * 2 + 2) / 2;
const FORK_GAP_END = 11.5;
const FORK_CHASM = { start: .25, end: FORK_GAP_END + .75, half: 4.2 };
// Straight on at a mine junction, in metres past the corner: the floor opens into a flooded shaft.
const SHAFT = { start: SHAFT_EDGE - 1.2, end: SHAFT_EDGE + 4.6, half: ROAD_HALF + .3, water: 9 };
/** Inner face of the mine walls, from the track centre. */
const MINE_WALL = ROAD_HALF + 4.4;
/** Open water either side of each leg of the log bridge. */
const SEA_REACH = 72;
/** Sharks show up beside the log bridge every few seconds for this long. */
const SHARK_SECONDS = 4.6;
const FLAMES = [
  [-1.86, -.11, 2.15, 1.14], [-1.24, .24, 2.62, 1.2], [-.62, -.15, 2.31, 1.22], [0, .3, 2.79, 1.13],
  [.62, -.12, 2.42, 1.22], [1.24, .12, 2.68, 1.19], [1.86, -.06, 2.18, 1.14],
  [-1.35, -.44, 1.45, 1.14], [-.06, -.48, 1.68, 1.35], [1.22, -.45, 1.52, 1.22],
] as const;
const POWER_COLORS: Record<RunPowerKind, [string, string]> = {
  magnet: ["#ff5a4a", "#ffb0a0"], shield: ["#5fe0ff", "#d6f8ff"], boost: ["#ffc73a", "#fff1b0"],
  slow: ["#ba91ee", "#ecd6ff"], double: ["#e8a344", "#ffe8ab"],
  bike: ["#44cbb2", "#acf9e8"], fruit: ["#ffb831", "#fff0a3"],
};
const POWER_ART = {
  magnet: 0, shield: 1, boost: 2,
  slow: "/assets/runner/pickup-hourglass-v1.webp", double: "/assets/runner/pickup-double-score-v1.webp",
  bike: "/assets/runner/pickup-bicycle-v1.webp",
} satisfies Record<Exclude<RunPowerKind, "fruit">, number | string>;
const FRUIT_TREE = "runner-fruit-tree";
const ORES = ["mine-amethyst", "mine-calcite", "mine-malachite"] as const;
type Grove = { ground: number; spacing: number; trees: readonly { name: string; height: number }[] };
/** Painted tree cards by scene; the bamboo, canyon and snow scenes grow modelled plants as slot decor instead. */
const GROVES: readonly Grove[] = [
  { ground: -7, spacing: 5, trees: [{ name: "river-cypress", height: 13.2 }, { name: "river-willow", height: 12 }, { name: "river-pine", height: 14.2 }, { name: FRUIT_TREE, height: 12.4 }] },
  { ground: -.35, spacing: 3, trees: [{ name: "temple-banyan", height: 7.8 }, { name: "temple-maple", height: 6.9 }, { name: "temple-ginkgo", height: 8.5 }, { name: FRUIT_TREE, height: 7.7 }] },
  { ground: -.35, spacing: 6, trees: [{ name: "mine-dead-birch", height: 2.9 }, { name: "mine-old-root", height: 1.65 }, { name: "mine-petrified-root", height: 2.15 }] },
  { ground: -.35, spacing: 1, trees: [] },
  { ground: -.35, spacing: 1, trees: [] },
  { ground: -.35, spacing: 1, trees: [] },
];
/** Scenery along each scene's road: template, repeat every n tiles, at offset; `vary` turns and resizes each copy. */
const SCENE_DECOR: readonly (readonly [name: string, every: number, offset: number, vary?: boolean])[][] = [
  [["aqueduct-wall", 1, 0], ["aqueduct-pier", 5, 0], ["lamp-post", 5, 3]],
  [["temple-ledge", 1, 0], ["temple-arch", 4, 2], ["lamp-post", 5, 3], ["temple-ferns", 3, 1, true]],
  [["mine-wall-a", 3, 0], ["mine-wall-b", 3, 1], ["mine-wall-c", 3, 2], ["mine-frame", 2, 0], ["mine-cart-parked", 11, 5]],
  [["bamboo-fence", 1, 0], ["bamboo-bank", 1, 0], ["bamboo-clump-a", 2, 0, true], ["bamboo-clump-b", 2, 1, true], ["stone-lantern", 5, 3]],
  [["canyon-kerb", 1, 0], ["canyon-mesa", 1, 0], ["canyon-hoodoos", 4, 1, true], ["canyon-boulders", 3, 0, true], ["cactus-patch", 3, 2, true], ["canyon-lamp", 5, 3]],
  [["snow-bank", 1, 0], ["snow-ridge", 1, 0], ["snow-pines-a", 2, 0, true], ["snow-pines-b", 2, 1, true], ["snow-lamp", 5, 3], ["snowman", 13, 6]],
];
/** Scenery that holds the road up opens over pits in the road. Only the canal piers stay at forks: the others would fill the ravine under the broken bridge. */
const SUPPORTS = new Set(["tpl-aqueduct-pier", "tpl-canyon-mesa", "tpl-snow-ridge", "tpl-bamboo-bank"]);
/** Sky bands painted in code for the scenes without a picture: gradient, then ridges from far to near. */
type Ridge = { color: string; night: string; base: number; height: number; waves: readonly [frequency: number, weight: number][]; flat?: number; snow?: string };
const PAINTED_SKIES: Partial<Record<number, { top: string; horizon: string; nightTop: string; nightHorizon: string; mist: string; ridges: readonly Ridge[] }>> = {
  3: {
    top: "#8fb7b3", horizon: "#dfe9d2", nightTop: "#0b1418", nightHorizon: "#24352f", mist: "rgba(228,240,220,.55)",
    ridges: [
      { color: "#8fae96", night: "#1b2a27", base: .62, height: .34, waves: [[3, .5], [7, .3], [13, .2]] },
      { color: "#5f8a5c", night: "#142420", base: .74, height: .3, waves: [[4, .45], [9, .35], [17, .2]] },
      { color: "#3e6a3f", night: "#0d1a15", base: .86, height: .24, waves: [[5, .4], [11, .4], [23, .2]] },
    ],
  },
  4: {
    top: "#e9a86c", horizon: "#fbe1b4", nightTop: "#170d1f", nightHorizon: "#4a2a35", mist: "rgba(250,214,170,.35)",
    ridges: [
      { color: "#c98b6b", night: "#3a2230", base: .6, height: .3, waves: [[2, .5], [5, .3], [11, .2]], flat: .7 },
      { color: "#b0603d", night: "#2a1622", base: .72, height: .32, waves: [[3, .5], [7, .3], [15, .2]], flat: .62 },
      { color: "#8a4128", night: "#1d0f17", base: .86, height: .22, waves: [[4, .5], [9, .3], [19, .2]], flat: .55 },
    ],
  },
  5: {
    top: "#9fc4e0", horizon: "#eef4f8", nightTop: "#0b1226", nightHorizon: "#2c3a55", mist: "rgba(245,248,252,.6)",
    ridges: [
      { color: "#b9cadb", night: "#2b3650", base: .58, height: .4, waves: [[3, .55], [7, .3], [16, .15]], snow: "#f7fbff" },
      { color: "#8ea6be", night: "#1f293f", base: .72, height: .32, waves: [[4, .5], [9, .3], [19, .2]], snow: "#eef5fb" },
      { color: "#dfe9f1", night: "#3b4760", base: .9, height: .14, waves: [[5, .5], [12, .5]] },
    ],
  },
};

type Theme = { sky: Color3; fog: Color3; nightSky: Color3; nightFog: Color3; ground: StandardMaterial; groundY: number };
type Decor = { node: TransformNode; every: number; offset: number; vary: boolean };
type RoadLane = { main: TransformNode; otherSide?: TransformNode };
type Slot = { n: number; root: TransformNode; themes: TransformNode[]; lanes: RoadLane[][]; trees: Mesh[]; ores: Mesh[]; decor: Decor[]; theme: number; holes: (RunItem | "rope" | "bridge" | undefined)[]; pierCut: boolean; crossingGap: boolean; forkCut: boolean };

const angleTo = (from: number, to: number) => { let d = (to - from) % (Math.PI * 2); if (d > Math.PI) d -= Math.PI * 2; if (d < -Math.PI) d += Math.PI * 2; return d; };
/** Repeatable pseudo-random numbers for building scenery: the same seed always gives the same plants. */
const seeded = (seed: number) => () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
const hash01 = (n: number, salt = 0) => (Math.imul(n + salt * 7919, 2654435761) >>> 0) / 4294967296;

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
  private crossings = new Map<number, TransformNode>();
  private crossingRouteVersion = -1;
  private cart: TransformNode;
  private bicycle: TransformNode;
  private bikeWheels: TransformNode[];
  private ropeHandle: TransformNode;
  private ropeLanyard: AbstractMesh;
  private cartLane = 0;
  private textures = new Map<string, Texture>();
  private sheets: Partial<Record<"run" | "actions" | "fall" | "cart" | "walk" | "grab" | "laugh", Texture>> = {};
  private mats: Record<string, StandardMaterial> = {};
  private themes: Theme[] = [];
  private groundPlane: Mesh;
  private groundCuts: GroundOpening[] = [];
  /** Open sea under the log bridge; only seen where the ground is cut away round the bridge. */
  private sea: Mesh;
  private shark!: { root: TransformNode; fin: AbstractMesh; shadow: Mesh; wake: Mesh; z: number; side: number; lateral: number; age: number; wait: number; active: boolean };
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
  private seen = { silver: 0, gold: 0, diamond: 0, power: 0, shield: 0, stumble: 0, turns: 0, wrong: -1 };
  private flash = { shield: 0, power: 0 };
  private turnBlend = { x: 0, z: 0 };
  private camYaw = 0;
  private routeVersion = -1;
  private camLateral = 0;
  private cameraPos = new Vector3(0, 4, -8);
  private cameraTarget = new Vector3(0, 1, 6);
  private captureCamera?: { position: Vector3; target: Vector3 };
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
    this.groundPlane = MeshBuilder.CreateGround("runner-ground", { width: GROUND_SIZE, height: GROUND_SIZE }, this.scene);
    this.groundPlane.isPickable = false;
    this.sea = MeshBuilder.CreateGround("runner-sea", { width: GROUND_SIZE, height: GROUND_SIZE }, this.scene);
    this.sea.material = this.mats.sea; this.sea.isPickable = false; this.sea.setEnabled(false);
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
    this.cart = this.instance("minecart", new TransformNode("runner-minecart", this.scene));
    this.bicycle = this.instance("bicycle", new TransformNode("runner-bicycle", this.scene));
    this.bikeWheels = this.bicycle.getChildTransformNodes().filter(node => node.name === "bicycle-wheel");
    this.ropeHandle = this.instance("rope-handle", new TransformNode("runner-rope-handle", this.scene));
    this.ropeLanyard = this.ropeHandle.getChildMeshes().find(mesh => mesh.name === "rope-lanyard")!;
    this.cart.setEnabled(false); this.bicycle.setEnabled(false); this.ropeHandle.setEnabled(false);
    this.buildShark();
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
    // Roads and walls are seen at grazing angles; stronger anisotropy keeps them sharp into the distance.
    texture.anisotropicFilteringLevel = this.settings.quality === "high" ? 16 : 8; texture.uScale = texture.vScale = repeat;
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
  /** Painted warning board: at the broken-bridge side of a fork, or over a mine shaft. */
  private signMaterial(name: string, title: string, note: string) {
    const texture = new DynamicTexture(`runner-${name}-tex`, { width: 512, height: 256 }, this.scene, true);
    const ctx = texture.getContext() as CanvasRenderingContext2D;
    ctx.fillStyle = "#f3e2b4"; ctx.fillRect(0, 0, 512, 256);
    ctx.fillStyle = "#a3231a"; ctx.fillRect(14, 14, 484, 228);
    ctx.strokeStyle = "#f7e9c2"; ctx.lineWidth = 8; ctx.strokeRect(30, 30, 452, 196);
    ctx.fillStyle = "#fff6dc"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.font = "900 112px 'Microsoft YaHei', 'PingFang SC', 'Noto Sans SC', sans-serif";
    ctx.fillText(title, 256, 112);
    ctx.font = "700 46px 'Microsoft YaHei', 'PingFang SC', 'Noto Sans SC', sans-serif";
    ctx.fillText(note, 256, 196);
    texture.update();
    const m = new StandardMaterial(`runner-${name}`, this.scene);
    m.diffuseTexture = texture; m.disableLighting = true; m.emissiveColor = Color3.White();
    this.mats[name] = m;
    return m;
  }
  /** Alpha card of drawn leaves, for bamboo crowns and temple ferns. */
  private leafMaterial(name: string, colors: readonly string[], blade: [number, number], count: number, seed: number) {
    const size = 256, texture = new DynamicTexture(`runner-${name}-tex`, { width: size, height: size }, this.scene, true);
    const ctx = texture.getContext() as CanvasRenderingContext2D, random = seeded(seed);
    ctx.clearRect(0, 0, size, size);
    for (let i = 0; i < count; i++) {
      // Leaves fan out and droop from the upper middle of the card.
      const angle = (random() - .5) * Math.PI * 1.5 + Math.PI / 2, reach = size * (.18 + random() * .3);
      const x = size / 2 + Math.cos(angle) * reach * .9, y = size * .3 + Math.sin(angle) * reach * .75 + random() * size * .25;
      ctx.save(); ctx.translate(x, y); ctx.rotate(angle + (random() - .5) * .6);
      ctx.fillStyle = colors[i % colors.length];
      ctx.beginPath(); ctx.ellipse(0, 0, blade[0] * (.7 + random() * .6), blade[1], 0, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = "rgba(255,255,230,.25)"; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(-blade[0] * .8, 0); ctx.lineTo(blade[0] * .8, 0); ctx.stroke();
      ctx.restore();
    }
    texture.update(); texture.hasAlpha = true;
    const m = new StandardMaterial(`runner-${name}`, this.scene);
    m.diffuseTexture = texture; m.useAlphaFromDiffuseTexture = true; m.transparencyMode = StandardMaterial.MATERIAL_ALPHATEST; m.alphaCutOff = .4;
    m.disableLighting = true; m.emissiveColor.setAll(.92); m.backFaceCulling = false; m.maxSimultaneousLights = 2;
    this.mats[name] = m;
    return m;
  }
  /** Drifted snow: soft blue-grey hollows and glints on white, so snow stays white under full light. */
  private snowTexture(repeat: number) {
    const size = 256, texture = new DynamicTexture("runner-snow-tex", { width: size, height: size }, this.scene, true);
    const ctx = texture.getContext() as CanvasRenderingContext2D, random = seeded(907);
    ctx.fillStyle = "#f6f9fb"; ctx.fillRect(0, 0, size, size);
    // Blotches drawn wrapped round the edges so the tile repeats without seams.
    for (let i = 0; i < 70; i++) {
      const x = random() * size, y = random() * size, r = 8 + random() * 30;
      for (const [dx, dy] of [[0, 0], [-size, 0], [size, 0], [0, -size], [0, size]]) {
        const g = ctx.createRadialGradient(x + dx, y + dy, 0, x + dx, y + dy, r);
        g.addColorStop(0, random() < .5 ? "rgba(196,212,226,.45)" : "rgba(255,255,255,.7)"); g.addColorStop(1, "rgba(255,255,255,0)");
        ctx.fillStyle = g; ctx.fillRect(x + dx - r, y + dy - r, r * 2, r * 2);
      }
    }
    for (let i = 0; i < 160; i++) { ctx.fillStyle = `rgba(170,190,210,${.15 + random() * .2})`; ctx.fillRect(random() * size, random() * size, 1.5, 1.5); }
    texture.update(); texture.wrapU = texture.wrapV = Texture.WRAP_ADDRESSMODE; texture.uScale = texture.vScale = repeat;
    texture.anisotropicFilteringLevel = 8;
    return texture;
  }
  /** Top-down silhouette of a shark, blurred, to show faintly under the water surface. */
  private sharkShadowMaterial() {
    const texture = new DynamicTexture("runner-shark-shadow-tex", { width: 128, height: 256 }, this.scene, false);
    const ctx = texture.getContext() as CanvasRenderingContext2D;
    ctx.clearRect(0, 0, 128, 256); ctx.filter = "blur(5px)"; ctx.fillStyle = "rgba(10,24,38,.95)";
    ctx.beginPath(); ctx.ellipse(64, 120, 20, 82, 0, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.moveTo(44, 96); ctx.lineTo(8, 150); ctx.lineTo(52, 128); ctx.fill();
    ctx.beginPath(); ctx.moveTo(84, 96); ctx.lineTo(120, 150); ctx.lineTo(76, 128); ctx.fill();
    ctx.beginPath(); ctx.moveTo(64, 190); ctx.lineTo(34, 246); ctx.lineTo(64, 226); ctx.lineTo(94, 246); ctx.fill();
    texture.update(); texture.hasAlpha = true;
    const m = new StandardMaterial("runner-shark-shadow", this.scene);
    m.diffuseTexture = texture; m.useAlphaFromDiffuseTexture = true; m.disableLighting = true; m.emissiveColor = Color3.White();
    m.backFaceCulling = false; m.zOffset = -3;
    this.mats["shark-shadow"] = m;
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
    const flags = "/assets/materials/escape/06-basement-floor-v1.png";
    this.mat("road-aqueduct", "#e9e1cc", stone);
    this.mat("road-temple", "#cfc6a8", flags);
    this.mat("road-mine", "#8d7f6a", "/assets/materials/escape/07-basement-ceiling-v1.png");
    this.mat("road-bamboo", "#b9c0a2", stone);
    // Lit colours saturate, so warm tints must stay dark enough to survive full sun.
    this.mat("road-canyon", "#b37b50", stone).emissiveColor.set(.06, .03, .01);
    const packed = this.mat("road-snow", "#a4b2bf"); packed.diffuseTexture = this.snowTexture(1.5); packed.emissiveColor.set(.05, .06, .08);
    this.mat("stone", "#d8cfb8", stone);
    this.mat("stone-dark", "#8e8a7c", stone);
    const cornerFrog = this.mat("corner-frog", "#ffffff", "/assets/runner/sewer-frog-corner-v1.webp");
    cornerFrog.disableLighting = true;
    cornerFrog.emissiveColor.setAll(.78);
    this.mat("moss-stone", "#9fa587", rock);
    this.mat("rock", "#6b5d4f", rock);
    this.mat("wood", "#ffffff", wood);
    this.mat("log-bark", "#e6d2b8", "/assets/runner/obstacle-cedar-bark-v1.webp");
    // The log bridge is one long tube: its bark repeats every few metres along it instead of stretching.
    for (const [name, repeat] of [["bridge-bark", Math.round((BRIDGE_LENGTH + 2) / 2.6)], ["bridge-bark-short", 9]] as const) {
      const bark = this.mat(name, "#e6d2b8");
      const texture = new Texture("/assets/runner/obstacle-cedar-bark-v1.webp", this.scene, false, true, Texture.TRILINEAR_SAMPLINGMODE);
      texture.anisotropicFilteringLevel = this.settings.quality === "high" ? 16 : 8; texture.uScale = 2; texture.vScale = repeat;
      bark.diffuseTexture = texture;
    }
    this.mat("log-end", "#dbc4a6", "/assets/runner/obstacle-cedar-ring-v1.webp");
    this.mat("obstacle-rock", "#d6d6c0", "/assets/runner/obstacle-fractured-rock-v1.webp");
    this.mat("zipline", "#b89a73", wood).emissiveColor.set(.28, .22, .16);
    for (const [i, name] of ORES.entries()) {
      const crystal = this.mat(name, "#ffffff", `/assets/runner/${name}-v1.webp`);
      crystal.diffuseTexture!.hasAlpha = true;
      crystal.useAlphaFromDiffuseTexture = true;
      crystal.transparencyMode = StandardMaterial.MATERIAL_ALPHATEST;
      crystal.alphaCutOff = .28;
      crystal.disableLighting = true; crystal.backFaceCulling = false;
      crystal.emissiveColor.setAll([.78, .74, .82][i]);
    }
    this.mat("bike-frame", "#32c3a7").specularColor.set(.45, .52, .51);
    this.mat("bike-rubber", "#202528").specularColor.setAll(.04);
    this.mat("bike-chrome", "#8a9b9e").specularColor.setAll(.55);
    this.glow("fruit-peel", "#ffca35", "#825014").specularColor.set(.7, .42, .19);
    this.mat("fruit-leaf", "#719237");
    this.mat("metal", "#9a9a9a", rust);
    this.mat("rail", "#b9b4aa", rust);
    this.mat("pit", "#05080a").specularColor.setAll(0);
    this.mat("foliage-dark", "#4a6538", rock, 2).specularColor.setAll(0);
    this.glow("gold", "#f2c443", "#7a560a").specularColor.set(.9, .8, .4);
    this.glow("lamp", "#ffe2a0", "#ffc25a");
    this.glow("warning", "#f2c443", "#3a2a00");
    this.glow("fork-flag", "#d8342a", "#5a0d08").backFaceCulling = false;
    this.signMaterial("fork-sign", "断桥", "危险 · 此路不通");
    this.signMaterial("shaft-sign", "竖井", "危险 · 小心坠落");
    this.radialMaterial("lamp-halo", "rgba(255,200,110,.9)", true);
    this.radialMaterial("wake", "rgba(235,248,250,.75)", true);
    // Scenery for the newer scenes and the finer details: plain colours, so they cost no extra textures.
    this.mat("lamp-iron", "#2f2b28").specularColor.set(.35, .33, .3);
    this.mat("bamboo", "#a7bb5e").specularColor.set(.28, .3, .18);
    this.mat("bamboo-node", "#6f8436").specularColor.setAll(.1);
    this.mat("sandstone", "#b0613a", stone).specularColor.setAll(.02);
    this.mat("sandstone-light", "#c48a5a", stone).specularColor.setAll(.02);
    this.mat("cactus", "#4f8148").specularColor.set(.12, .16, .1);
    this.glow("cactus-flower", "#f06d93", "#4a1424");
    const snow = this.mat("snow", "#f3f7fa"); snow.emissiveColor.set(.32, .34, .36); snow.specularColor.setAll(.18);
    const ice = this.glow("ice", "#cbe9f5", "#2c5566"); ice.alpha = .82; ice.specularColor.setAll(.7); ice.specularPower = 64;
    this.mat("pine", "#2c5a3d").specularColor.setAll(.03);
    this.mat("pine-trunk", "#5b3f2c").specularColor.setAll(.02);
    this.mat("coal", "#1d1b1a").specularColor.setAll(.25);
    this.glow("carrot", "#f08a2c", "#4a2006");
    this.mat("scarf", "#c8352b");
    this.mat("mushroom-cap", "#c63c2b").specularColor.set(.3, .2, .18);
    this.mat("mushroom-brown", "#9b6038").specularColor.set(.2, .15, .1);
    this.glow("mushroom-spot", "#fff6e6", "#3a332a");
    this.mat("mushroom-stem", "#efe4cc");
    this.mat("shelf-fungus", "#c59a5d");
    this.mat("vine", "#3d7430").specularColor.setAll(.05);
    const leaf = this.mat("vine-leaf", "#5d9a3b"); leaf.backFaceCulling = false; leaf.specularColor.set(.12, .2, .1);
    // Cliff faces under raised road are tens of metres across, so their rock repeats instead of stretching.
    this.mat("mesa-rock", "#a95c37", stone, 7).specularColor.setAll(.02);
    this.mat("cliff-rock", "#6b5d4f", rock, 6).specularColor.setAll(.02);
    this.mat("bank-earth", "#55703f", rock, 5).specularColor.setAll(0);
    this.mat("charcoal", "#2b2420").emissiveColor.set(.16, .04, 0);
    this.glow("ember", "#ff8a2a", "#ff5410");
    this.mat("bone", "#efe6d2").emissiveColor.set(.18, .17, .15);
    this.glow("beacon", "#ff7a3a", "#ff4a14");
    this.glow("reflector", "#ff4a3a", "#7a1208");
    this.mat("bleached", "#b5a690", "/assets/runner/obstacle-cedar-bark-v1.webp").specularColor.setAll(.03);
    const crystal = this.glow("crystal", "#c39bff", "#6a3ac8"); crystal.alpha = .9; crystal.specularColor.setAll(.8); crystal.specularPower = 64;
    this.mat("moss", "#5c8a3a").specularColor.setAll(0);
    this.mat("flower-pink", "#f2a3c0").emissiveColor.set(.25, .12, .16);
    this.mat("flower-white", "#fbf5e8").emissiveColor.set(.25, .24, .22);
    const fin = this.mat("shark", "#3c4b57"); fin.specularColor.set(.45, .5, .55); fin.specularPower = 40;
    this.sharkShadowMaterial();
    this.leafMaterial("bamboo-leaves", ["#5f8f36", "#77a644", "#4b7a2e", "#89b552"], [26, 5], 70, 11);
    this.leafMaterial("fern-leaves", ["#4f8a39", "#6aa249", "#3f7430"], [18, 6], 44, 29);
    for (const [kind, [color]] of Object.entries(POWER_COLORS)) {
      const ring = this.glow(`ring-${kind}`, color, color); ring.alpha = .8; ring.disableLighting = true;
      const beam = this.glow(`beam-${kind}`, color, color); beam.alpha = .18; beam.disableLighting = true; beam.backFaceCulling = false; beam.alphaMode = Engine.ALPHA_ADD;
    }
    for (const grove of GROVES) for (const { name } of grove.trees) {
      if (this.mats[`tree-${name}`]) continue;
      const tree = this.mat(`tree-${name}`, "#ffffff", `/assets/runner/trees/${name}-v1.webp`);
      tree.diffuseTexture!.hasAlpha = true;
      tree.useAlphaFromDiffuseTexture = true;
      tree.disableLighting = true;
      tree.emissiveColor.setAll(1);
      tree.backFaceCulling = false;
      tree.transparencyMode = StandardMaterial.MATERIAL_ALPHATEST;
      tree.alphaCutOff = .29;
    }
    // The ground plane re-centres on a 70 m grid, so each ground texture repeats a whole number of
    // times per 70 m: otherwise the pattern visibly jumps whenever the plane moves.
    const groundRepeat = (tilesPer70m: number) => GROUND_SIZE / (GROUND_SNAP / tilesPer70m);
    const water = this.mat("water", "#9cbdb8", "/assets/runner/pit-water-v1.png", groundRepeat(3));
    water.emissiveTexture = water.diffuseTexture; water.emissiveColor.set(.42, .48, .48);
    water.specularColor.set(.55, .62, .62); water.specularPower = 48; water.fogEnabled = false;
    for (const [name, repeat] of [["pit-water", 1], ["pit-water-long", 2]] as const) {
      const pool = this.mat(name, "#91aba8", "/assets/runner/pit-water-v1.png", repeat);
      pool.emissiveTexture = pool.diffuseTexture;
      pool.emissiveColor.set(.6, .66, .67);
      pool.specularColor.set(.35, .42, .43);
      if (name === "pit-water-long") (pool.diffuseTexture as Texture).vScale = 6;
    }
    const sea = this.mat("sea", "#7eaeb3", "/assets/runner/pit-water-v1.png", groundRepeat(4));
    sea.emissiveTexture = sea.diffuseTexture; sea.emissiveColor.set(.3, .4, .43);
    sea.specularColor.set(.6, .68, .7); sea.specularPower = 56;
    const ground = (name: string, color: string, texture = rock) => {
      const m = this.mat(name, color, texture, groundRepeat(6)); m.specularColor.setAll(0);
      new GroundOpenings(m, this.groundCuts);
      return m;
    };
    const grass = ground("grass", "#6f8251"), cave = ground("cave-floor", "#2c241d");
    const moss = ground("bamboo-floor", "#5b7a43"), sand = ground("sand", "#9a663c", stone), drift = ground("snowfield", "#eef3f6");
    drift.diffuseTexture = this.snowTexture(groundRepeat(8));
    drift.emissiveColor.set(.34, .36, .38); sand.emissiveColor.set(.12, .06, .02);
    this.themes = [
      { sky: new Color3(.62, .74, .78), fog: new Color3(.66, .74, .74), nightSky: new Color3(.07, .1, .18), nightFog: new Color3(.1, .13, .2), ground: water, groundY: -7 },
      { sky: new Color3(.66, .76, .62), fog: new Color3(.6, .67, .55), nightSky: new Color3(.06, .09, .1), nightFog: new Color3(.08, .12, .12), ground: grass, groundY: -.35 },
      { sky: new Color3(.09, .07, .06), fog: new Color3(.12, .09, .07), nightSky: new Color3(.04, .03, .03), nightFog: new Color3(.06, .045, .04), ground: cave, groundY: -.35 },
      { sky: new Color3(.62, .76, .7), fog: new Color3(.66, .76, .66), nightSky: new Color3(.05, .09, .08), nightFog: new Color3(.07, .11, .1), ground: moss, groundY: -.35 },
      { sky: new Color3(.9, .7, .5), fog: new Color3(.88, .7, .53), nightSky: new Color3(.1, .06, .1), nightFog: new Color3(.15, .09, .11), ground: sand, groundY: -.35 },
      { sky: new Color3(.78, .86, .92), fog: new Color3(.85, .89, .93), nightSky: new Color3(.07, .09, .16), nightFog: new Color3(.13, .15, .21), ground: drift, groundY: -.35 },
    ];
  }
  async load() {
    const [run, actions, fall, cart, walk, grab, laugh] = await Promise.all([
      loadImage("/assets/runner/milk-dog-run-v2.png"), loadImage("/assets/runner/milk-dog-actions-v2.png"),
      loadImage("/assets/runner/milk-dog-fall-v1.png"), loadImage(MINECART_SURPRISE_ART),
      loadImage("/assets/character/haunted-frog-directions-walk-v1.webp"),
      loadImage(FROG_EXTRA_ART.directionAttack.url), loadImage(FROG_EXTRA_ART.directionLaugh.url),
    ]);
    this.sheets = {
      run: sheetTexture(this.scene, cleanSheet(run)), actions: sheetTexture(this.scene, cleanSheet(actions)),
      fall: sheetTexture(this.scene, cleanSheet(fall)), cart: sheetTexture(this.scene, cart.src),
      walk: sheetTexture(this.scene, walk.src), grab: sheetTexture(this.scene, grab.src), laugh: sheetTexture(this.scene, laugh.src),
    };
    this.dog.frame(this.sheets.actions!, 0, 4, 2);
    this.chaserSprite.frame(this.sheets.walk!, 4, 4, 4);
    // The sky is a world-fixed band: the side strip (cliffs, trees, sky) of each scene picture,
    // mirrored into a seamless panorama so the road in the middle of the photo never shows.
    // Scenes without a picture get a band painted in code.
    this.skies = await Promise.all(RUN_SCENES.map(async (scene, i) => {
      if (!scene.image || !scene.night) return { day: this.paintedSky(i, false), night: this.paintedSky(i, true) };
      const [day, night] = await Promise.all([loadImage(scene.image), loadImage(scene.night)]);
      return { day: this.panorama(day, i), night: this.panorama(night, i) };
    }));
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
    const effects = [this.bubble, this.magnetRing, this.boostGlow, this.rain[0], this.snow[0], this.streaks[0], this.sea];
    this.shark.root.setEnabled(true); this.shark.root.position.set(0, 0, 14);
    effects.forEach(mesh => { mesh.setEnabled(true); mesh.position.set(0, 1, 10); });
    this.mats["lamp-halo"].alpha = .9;
    this.burst(this.sparks, new Vector3(0, 1, 10), 4); this.burst(this.magic, new Vector3(0, 1, 10), 4);
    this.camera.position.set(0, 4, -8); this.camera.setTarget(new Vector3(0, 1, 8));
    this.scene.render();
    warm.dispose();
    for (const slot of this.slots) slot.themes.forEach(group => group.setEnabled(false));
    [...effects, ...this.rain, ...this.snow, ...this.streaks].forEach(mesh => mesh.setEnabled(false));
    this.shark.root.setEnabled(false);
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

  /** Seamless sky band in the same layout as `panorama`: gradient, stars at night, then ridges from far to near. */
  private paintedSky(scene: number, night: boolean) {
    const look = PAINTED_SKIES[scene]!;
    const width = 2048, height = 256, canvas = document.createElement("canvas");
    canvas.width = width; canvas.height = height;
    const ctx = canvas.getContext("2d")!, random = seeded(scene * 97 + (night ? 5 : 0));
    const sky = ctx.createLinearGradient(0, 0, 0, height);
    sky.addColorStop(0, night ? look.nightTop : look.top); sky.addColorStop(.85, night ? look.nightHorizon : look.horizon);
    ctx.fillStyle = sky; ctx.fillRect(0, 0, width, height);
    if (night) for (let i = 0; i < 260; i++) {
      ctx.fillStyle = `rgba(255,255,240,${.25 + random() * .6})`;
      ctx.fillRect(random() * width, random() * height * .6, 1 + random() * 1.4, 1 + random() * 1.4);
    }
    // Whole numbers of waves across the width, so the band joins up all the way round.
    const ridgeAt = (ridge: Ridge, x: number, phase: number) => {
      let y = 0;
      for (const [frequency, weight] of ridge.waves) y += weight * (1 - Math.abs(Math.sin(Math.PI * frequency * x / width + phase * frequency)));
      return ridge.flat ? Math.min(y, ridge.flat) / ridge.flat : y;
    };
    for (const [index, ridge] of look.ridges.entries()) {
      const phase = index * 1.7 + scene;
      const outline = new Path2D();
      outline.moveTo(0, height);
      for (let x = 0; x <= width; x += 4) outline.lineTo(x, height * (ridge.base - ridge.height * ridgeAt(ridge, x, phase)));
      outline.lineTo(width, height); outline.closePath();
      ctx.fillStyle = night ? ridge.night : ridge.color; ctx.fill(outline);
      if (ridge.snow && !night) {
        // Snow caps: the top of each peak, with a ragged lower edge.
        ctx.save(); ctx.clip(outline);
        ctx.fillStyle = ridge.snow; ctx.beginPath(); ctx.moveTo(0, 0);
        for (let x = 0; x <= width; x += 8) ctx.lineTo(x, height * (ridge.base - ridge.height * .58) + Math.sin(x * .09) * 4 + Math.sin(x * .023) * 7);
        ctx.lineTo(width, 0); ctx.closePath(); ctx.fill();
        ctx.restore();
      }
      // A band of mist at the foot of each ridge gives the layers depth.
      const mist = ctx.createLinearGradient(0, height * (ridge.base - .08), 0, height * (ridge.base + .04));
      mist.addColorStop(0, "rgba(0,0,0,0)"); mist.addColorStop(1, night ? "rgba(40,50,70,.35)" : look.mist);
      ctx.fillStyle = mist; ctx.fillRect(0, height * (ridge.base - .08), width, height * .12);
    }
    const fade = ctx.createLinearGradient(0, height * .82, 0, height);
    fade.addColorStop(0, "rgba(0,0,0,0)"); fade.addColorStop(1, "rgba(0,0,0,1)");
    ctx.globalCompositeOperation = "destination-out"; ctx.fillStyle = fade; ctx.fillRect(0, height * .82, width, height * .18);
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
  private cylinder(name: string, parent: TransformNode, options: { diameterTop?: number; diameterBottom?: number; diameter?: number; height: number; tessellation?: number; arc?: number; enclose?: boolean }, at: [number, number, number], material: string) {
    const m = MeshBuilder.CreateCylinder(name, { tessellation: 14, ...options }, this.scene);
    m.parent = parent; m.position.set(...at); m.material = this.mats[material]; m.isPickable = false;
    return m;
  }

  private fallenLog(name: string, root: TransformNode, length: number, diameter: number, at: [number, number, number], bark = "log-bark") {
    const trunk = this.cylinder(name, root, { height: length, diameterBottom: diameter, diameterTop: diameter * .78, tessellation: 24 }, at, bark);
    for (const side of [-1, 1]) {
      const end = MeshBuilder.CreateDisc("exposed-growth-rings", { radius: diameter * (side === 1 ? .382 : .49), tessellation: 24, sideOrientation: Mesh.DOUBLESIDE }, this.scene);
      end.parent = trunk; end.position.y = side * (length / 2 + .007); end.rotation.x = Math.PI / 2;
      end.material = this.mats[bark === "log-bark" ? "log-end" : bark]; end.isPickable = false;
    }
    return trunk;
  }

  /** A boulder with a lumpy, faceted surface: an icosphere pushed in and out by a few smooth bumps. */
  private roughRock(name: string, parent: TransformNode, radius: number, seed: number, material: string, at: [number, number, number], bumpiness = 1, smooth = false) {
    const rock = MeshBuilder.CreateIcoSphere(name, { radius, subdivisions: smooth ? 4 : 3, flat: !smooth }, this.scene);
    const random = seeded(seed);
    const bumps = Array.from({ length: 9 }, () => ({ dir: new Vector3(random() * 2 - 1, random() * 2 - 1, random() * 2 - 1).normalize(), size: (random() - .35) * .34 * bumpiness }));
    const positions = Array.from(rock.getVerticesData("position")!);
    for (let i = 0; i < positions.length; i += 3) {
      const dir = new Vector3(positions[i], positions[i + 1], positions[i + 2]).normalize();
      let scale = 1;
      for (const bump of bumps) scale += bump.size * Math.max(0, Vector3.Dot(dir, bump.dir)) ** 3;
      // A little flatter underneath, so it sits on the ground.
      if (dir.y < -.55) scale *= .9;
      positions[i] = dir.x * radius * scale; positions[i + 1] = dir.y * radius * scale; positions[i + 2] = dir.z * radius * scale;
    }
    const normals: number[] = [];
    VertexData.ComputeNormals(positions, rock.getIndices()!, normals);
    rock.setVerticesData("position", positions); rock.setVerticesData("normal", normals); rock.refreshBoundingInfo();
    rock.parent = parent; rock.position.set(...at); rock.material = this.mats[material]; rock.isPickable = false;
    return rock;
  }

  /** A cone sticking out of a surface along `dir` from `centre`: crystals, horns, spikes. */
  private spike(name: string, parent: TransformNode, centre: Vector3, dir: Vector3, length: number, diameter: number, material: string, tessellation = 6) {
    const cone = this.cylinder(name, parent, { diameterTop: 0, diameterBottom: diameter, height: length, tessellation }, [0, 0, 0], material);
    const d = dir.normalizeToNew();
    cone.position.copyFrom(centre.add(d.scale(length / 2)));
    cone.rotation.set(Math.acos(Math.max(-1, Math.min(1, d.y))), Math.atan2(d.x, d.z), 0);
    return cone;
  }

  /** A sun-bleached steer skull, for the canyon. */
  private skull(r: TransformNode, x: number, y: number, z: number) {
    const head = MeshBuilder.CreateSphere("skull", { diameter: .32, segments: 10 }, this.scene);
    head.parent = r; head.position.set(x, y, z); head.scaling.set(1, .72, 1.15); head.material = this.mats.bone;
    this.box("skull-snout", r, [.15, .12, .2], [x, y - .04, z - .2], "bone");
    for (const s of [-1, 1]) {
      this.spike("skull-horn", r, new Vector3(x + s * .13, y + .05, z), new Vector3(s, .55, 0), .34, .08, "bone");
      const eye = MeshBuilder.CreateSphere("skull-eye", { diameter: .07, segments: 6 }, this.scene);
      eye.parent = r; eye.position.set(x + s * .07, y + .02, z - .17); eye.material = this.mats.coal;
    }
  }

  /** One-lane barrier: slide under the bar at 1.25 m. Each scene builds it from what is to hand. */
  private barrier(r: TransformNode, scene: number) {
    const width = 2.1, px = width / 2 - .12, random = seeded(401 + scene);
    const tie = (x: number, y: number, diameter = .2) => {
      const ring = MeshBuilder.CreateTorus("barrier-tie", { diameter, thickness: .035, tessellation: 10 }, this.scene);
      ring.parent = r; ring.position.set(x, y, 0); ring.rotation.z = Math.PI / 2; ring.material = this.mats.zipline;
    };
    switch (scene) {
      case 1: { // Temple: carved stone stumps holding a creeper-wound pole.
        for (const s of [-1, 1]) {
          this.box("barrier-plinth", r, [.44, .16, .44], [s * px, .08, 0], "stone-dark");
          this.cylinder("barrier-pillar", r, { diameter: .3, height: 1.34, tessellation: 8 }, [s * px, .82, 0], "moss-stone");
          this.box("barrier-capital", r, [.4, .14, .4], [s * px, 1.52, 0], "stone-dark");
        }
        const pole = this.cylinder("barrier-pole", r, { diameter: .26, height: width + .15, tessellation: 12 }, [0, 1.25, 0], "log-bark");
        pole.rotation.z = Math.PI / 2;
        this.addVine(pole, width * .85, () => .13, 2.6, .5, random);
        for (const x of [-.55, .15, .7]) this.box("barrier-moss", r, [.05, .2 + random() * .1, .05], [x, 1.03, -.06], "moss");
        return;
      }
      case 2: { // Mine: timber posts, a striped hazard beam and a lantern.
        for (const s of [-1, 1]) {
          this.box("barrier-post", r, [.22, 1.6, .22], [s * px, .8, 0], "wood");
          this.box("barrier-foot", r, [.5, .1, .5], [s * px, .05, 0], "stone-dark");
          this.box("barrier-bracket", r, [.3, .36, .26], [s * px, 1.25, 0], "metal");
        }
        for (let i = 0; i < 6; i++) {
          const stripe = this.box("barrier-stripe", r, [.32, .28, .2], [-.75 + i * .3, 1.25, 0], i % 2 ? "pit" : "warning");
          stripe.rotation.z = .5;
        }
        this.box("barrier-top", r, [width + .1, .05, .22], [0, 1.41, 0], "wood");
        this.box("lantern-arm", r, [.36, .06, .06], [-px + .17, 1.66, 0], "metal");
        this.cylinder("lantern", r, { diameterTop: .2, diameterBottom: .16, height: .24, tessellation: 6 }, [-px + .32, 1.5, 0], "lamp");
        this.cylinder("lantern-roof", r, { diameterTop: .03, diameterBottom: .26, height: .1, tessellation: 6 }, [-px + .32, 1.66, 0], "lamp-iron");
        return;
      }
      case 3: { // Bamboo grove: crossed bamboo legs, two poles lashed with rope, paper charms.
        for (const s of [-1, 1]) for (const lean of [-.32, .32]) {
          const leg = this.cylinder("barrier-leg", r, { diameter: .1, height: 1.7, tessellation: 8 }, [s * px, .8, 0], "bamboo");
          leg.rotation.x = lean;
        }
        for (const y of [1.32, 1.18]) {
          const pole = this.cylinder("barrier-pole", r, { diameter: .11, height: width + .3, tessellation: 8 }, [0, y, 0], "bamboo");
          pole.rotation.z = Math.PI / 2;
        }
        for (const x of [-.62, 0, .62]) { const node = this.cylinder("barrier-node", r, { diameter: .13, height: .04, tessellation: 8 }, [x, 1.32, 0], "bamboo-node"); node.rotation.z = Math.PI / 2; }
        for (const s of [-1, 1]) tie(s * px, 1.25, .28);
        for (const [x, tilt] of [[-.42, .08], [.18, -.06], [.62, .1]] as const) {
          const charm = MeshBuilder.CreatePlane("barrier-charm", { width: .15, height: .32 }, this.scene);
          charm.parent = r; charm.position.set(x, .98, -.07); charm.rotation.z = tilt; charm.material = this.mats["fork-flag"];
        }
        return;
      }
      case 4: { // Canyon: a weathered hitching rail with a steer skull.
        for (const s of [-1, 1]) {
          const post = this.box("barrier-post", r, [.2, 1.62, .2], [s * px, .78, 0], "bleached"); post.rotation.z = s * .04;
          this.roughRock("barrier-stone", r, .22, 60 + s, "sandstone", [s * px + .14, .06, .16]);
          tie(s * px, 1.25, .3);
        }
        this.box("barrier-rail", r, [width + .2, .24, .13], [0, 1.28, 0], "bleached");
        this.box("barrier-rail-low", r, [width, .12, .1], [0, 1.07, .03], "bleached");
        this.skull(r, 0, 1.52, -.02);
        return;
      }
      case 5: { // Snowfield: a red and white ski barrier, snow on top and icicles below.
        for (const s of [-1, 1]) {
          this.box("barrier-post", r, [.18, 1.56, .18], [s * px, .78, 0], "pine-trunk");
          this.box("barrier-post-snow", r, [.25, .1, .25], [s * px, 1.6, 0], "snow");
          const drift = MeshBuilder.CreateSphere("barrier-drift", { diameter: .8, segments: 8 }, this.scene);
          drift.parent = r; drift.position.set(s * px, .02, 0); drift.scaling.set(1, .45, 1); drift.material = this.mats.snow;
        }
        for (let i = 0; i < 6; i++) this.box("barrier-band", r, [width / 6 + .005, .3, .2], [-width / 2 + width / 12 + i * width / 6, 1.25, 0], i % 2 ? "snow" : "scarf");
        this.box("barrier-snowcap", r, [width - .06, .09, .26], [0, 1.44, 0], "snow");
        for (let i = 0; i < 7; i++) {
          const length = .14 + random() * .22;
          this.cylinder("icicle", r, { diameterTop: .06, diameterBottom: 0, height: length, tessellation: 5 }, [-.85 + i * .28 + (random() - .5) * .08, 1.1 - length / 2, (random() - .5) * .1], "ice");
        }
        return;
      }
      default: { // Canal: a steel road barrier with hazard stripes, reflectors and a beacon.
        for (const s of [-1, 1]) {
          this.box("barrier-foot", r, [.46, .12, .5], [s * px, .06, 0], "stone-dark");
          this.cylinder("barrier-post", r, { diameter: .13, height: 1.5, tessellation: 10 }, [s * px, .8, 0], "lamp-iron");
          this.box("barrier-reflector", r, [.13, .13, .03], [s * (width / 2 - .1), 1.25, -.13], "reflector");
        }
        this.box("barrier-bar", r, [width, .32, .22], [0, 1.25, 0], "warning");
        for (let x = -.72; x <= .73; x += .36) { const stripe = this.box("barrier-stripe", r, [.12, .3, .235], [x, 1.25, 0], "pit"); stripe.rotation.z = .55; }
        this.cylinder("beacon-base", r, { diameter: .16, height: .08, tessellation: 10 }, [0, 1.45, 0], "lamp-iron");
        const beacon = MeshBuilder.CreateSphere("beacon", { diameter: .16, segments: 8, slice: .5 }, this.scene);
        beacon.parent = r; beacon.position.set(0, 1.49, 0); beacon.material = this.mats.beacon;
      }
    }
  }

  /** Whole-road gate: slide under the beam at 1.3 m. */
  private gate(r: TransformNode, scene: number) {
    const px = ROAD_HALF + .1, span = ROAD_HALF * 2 + 1.2, random = seeded(431 + scene);
    const hangingLeaves = (x: number, top: number, count: number) => {
      for (let k = 0; k < count; k++) {
        const leaf = MeshBuilder.CreateSphere("gate-leaf", { diameter: .2, segments: 4 }, this.scene);
        leaf.parent = r; leaf.position.set(x + (random() - .5) * .1, top - k * .07, -.3); leaf.scaling.set(.9, .5, .25); leaf.material = this.mats["vine-leaf"];
      }
    };
    switch (scene) {
      case 1: { // Temple: a carved lintel on round pillars, hung with creepers.
        for (const s of [-1, 1]) {
          this.cylinder("gate-pillar", r, { diameter: .7, height: 2.7, tessellation: 10 }, [s * px, 1, 0], "moss-stone");
          this.box("gate-base", r, [.9, .3, .9], [s * px, -.2, 0], "stone-dark");
        }
        this.box("gate-lintel", r, [span + .4, .55, .62], [0, 1.32, 0], "moss-stone");
        for (let x = -3; x <= 3.01; x += 1.5) this.box("gate-carving", r, [.5, .3, .04], [x, 1.32, -.32], "stone-dark");
        this.box("gate-moss", r, [span * .7, .08, .5], [-.4, 1.63, 0], "moss");
        for (const x of [-2.6, -1.1, .3, 1.9, 3.1]) hangingLeaves(x, 1.05, 3);
        return;
      }
      case 2: { // Mine: a timber gate with braces, hazard stripes and a hanging lantern.
        for (const s of [-1, 1]) {
          this.box("gate-post", r, [.42, 2.7, .42], [s * px, 1, 0], "wood");
          const brace = this.cylinder("gate-brace", r, { diameter: .16, height: 1.2, tessellation: 6 }, [s * (px - .45), 1.95, 0], "wood");
          brace.rotation.z = s * .7;
        }
        this.box("gate-beam", r, [span, .5, .42], [0, 1.3, 0], "wood");
        for (let i = 0; i < 12; i++) { const stripe = this.box("gate-stripe", r, [.34, .44, .02], [-3.3 + i * .6, 1.3, -.22], i % 2 ? "pit" : "warning"); stripe.rotation.z = .5; }
        this.cylinder("gate-chain", r, { diameter: .03, height: .14, tessellation: 4 }, [0, 1, 0], "metal");
        this.cylinder("gate-lantern", r, { diameterTop: .24, diameterBottom: .18, height: .26, tessellation: 6 }, [0, .82, 0], "lamp");
        this.cylinder("gate-lantern-roof", r, { diameterTop: .03, diameterBottom: .3, height: .1, tessellation: 6 }, [0, .98, 0], "lamp-iron");
        return;
      }
      case 3: { // Bamboo grove: thick canes lashed into a frame, with charms and bells.
        for (const s of [-1, 1]) {
          this.cylinder("gate-cane", r, { diameter: .24, height: 2.8, tessellation: 10 }, [s * px, 1.05, 0], "bamboo");
          for (const y of [.4, 1, 1.6, 2.2]) this.cylinder("gate-node", r, { diameter: .27, height: .05, tessellation: 10 }, [s * px, y, 0], "bamboo-node");
        }
        for (const y of [1.45, 1.2]) { const pole = this.cylinder("gate-pole", r, { diameter: .17, height: span + .4, tessellation: 10 }, [0, y, 0], "bamboo"); pole.rotation.z = Math.PI / 2; }
        for (const s of [-1, 1]) { const tie = MeshBuilder.CreateTorus("gate-tie", { diameter: .42, thickness: .05, tessellation: 12 }, this.scene); tie.parent = r; tie.position.set(s * px, 1.32, 0); tie.rotation.z = Math.PI / 2; tie.material = this.mats.zipline; }
        for (const x of [-2.7, -.9, .9, 2.7]) {
          const charm = MeshBuilder.CreatePlane("gate-charm", { width: .2, height: .4 }, this.scene);
          charm.parent = r; charm.position.set(x, .9, -.1); charm.material = this.mats["fork-flag"];
        }
        for (const x of [-1.8, 0, 1.8]) { const bell = MeshBuilder.CreateSphere("gate-bell", { diameter: .16, segments: 8, slice: .6 }, this.scene); bell.parent = r; bell.position.set(x, .98, 0); bell.material = this.mats.gold; }
        return;
      }
      case 4: { // Canyon: a ranch gate of bleached timber, with a skull on top.
        for (const s of [-1, 1]) {
          this.box("gate-post", r, [.34, 2.8, .34], [s * px, 1.05, 0], "bleached");
          for (let k = 0; k < 3; k++) this.roughRock("gate-rock", r, .22 + k * .05, 70 + k + s, "sandstone", [s * (px + .3 - k * .25), .02, (k - 1) * .3]);
        }
        this.box("gate-beam", r, [span, .3, .2], [0, 1.45, 0], "bleached");
        this.box("gate-beam", r, [span, .22, .18], [0, 1.16, .02], "bleached");
        const brace = this.box("gate-brace", r, [span * .55, .14, .1], [-1.3, 1.3, -.08], "bleached"); brace.rotation.z = .06;
        this.skull(r, 0, 1.72, -.02);
        return;
      }
      case 5: { // Snowfield: a striped pole on snow-capped posts, fringed with icicles.
        for (const s of [-1, 1]) {
          this.box("gate-post", r, [.36, 2.7, .36], [s * px, 1, 0], "pine-trunk");
          this.box("gate-post-snow", r, [.46, .16, .46], [s * px, 2.42, 0], "snow");
          const drift = MeshBuilder.CreateSphere("gate-drift", { diameter: 1.3, segments: 8 }, this.scene);
          drift.parent = r; drift.position.set(s * px, -.05, 0); drift.scaling.set(1, .4, 1); drift.material = this.mats.snow;
        }
        for (let i = 0; i < 10; i++) this.box("gate-band", r, [span / 10 + .005, .46, .4], [-span / 2 + span / 20 + i * span / 10, 1.3, 0], i % 2 ? "snow" : "scarf");
        this.box("gate-snowcap", r, [span - .1, .12, .46], [0, 1.58, 0], "snow");
        for (let i = 0; i < 16; i++) {
          const length = .16 + random() * .26;
          this.cylinder("icicle", r, { diameterTop: .07, diameterBottom: 0, height: length, tessellation: 5 }, [-span / 2 + .3 + i * (span - .6) / 15, 1.07 - length / 2, (random() - .5) * .2], "ice");
        }
        return;
      }
      default: { // Canal: stone posts, an iron-bound beam with a hazard plate, and hanging chains.
        for (const s of [-1, 1]) {
          this.box("gate-post", r, [.6, 2.6, .6], [s * px, 1.1, 0], "stone-dark");
          this.box("gate-cap", r, [.76, .18, .76], [s * px, 2.46, 0], "stone");
        }
        this.box("gate-beam", r, [span, .5, .45], [0, 1.3, 0], "wood");
        for (let x = -3; x <= 3.01; x += 1.5) this.box("gate-band", r, [.07, .54, .49], [x, 1.3, 0], "lamp-iron");
        this.box("gate-plate", r, [1.3, .3, .03], [0, 1.3, -.24], "warning");
        for (let i = 0; i < 4; i++) { const stripe = this.box("gate-plate-stripe", r, [.1, .3, .035], [-.45 + i * .3, 1.3, -.24], "pit"); stripe.rotation.z = .55; }
        for (const x of [-3, -1.5, 1.5, 3]) for (let k = 0; k < 3; k++) {
          const link = MeshBuilder.CreateTorus("gate-chain", { diameter: .13, thickness: .03, tessellation: 10 }, this.scene);
          link.parent = r; link.position.set(x, .97 - k * .1, 0); link.rotation.set(Math.PI / 2, k % 2 ? Math.PI / 2 : 0, 0); link.material = this.mats.metal;
        }
      }
    }
  }

  /** Single-lane boulder, about 2 m high. */
  private boulder(r: TransformNode, scene: number) {
    const random = seeded(451 + scene), centre = new Vector3(0, 1.03, 0);
    const onSurface = (up: number, around: number, out = 1) => new Vector3(Math.cos(around) * Math.sin(up), Math.cos(up), Math.sin(around) * Math.sin(up)).scale(out);
    const pebbles = (material: string, count: number) => {
      for (let k = 0; k < count; k++) this.roughRock("boulder-pebble", r, .1 + random() * .14, 500 + k, material, [(random() - .5) * 2.4, .04, (random() - .5) * 2.2]);
    };
    const moss = (y: number, size: number) => {
      const cap = MeshBuilder.CreateSphere("boulder-moss", { diameter: size, segments: 10 }, this.scene);
      cap.parent = r; cap.position.set((random() - .5) * .3, y, (random() - .5) * .3); cap.scaling.y = .22; cap.material = this.mats.moss;
    };
    switch (scene) {
      case 1: { // Temple: a carved stone ball with banded grooves and moss on top.
        const ball = MeshBuilder.CreateSphere("stone-ball", { diameter: 2.05, segments: 20 }, this.scene);
        ball.parent = r; ball.position.copyFrom(centre); ball.material = this.mats["moss-stone"];
        for (const [tilt, roll] of [[.2, 0], [.2 + Math.PI / 2, .35]] as const) {
          const band = MeshBuilder.CreateTorus("stone-ball-band", { diameter: 2.05, thickness: .09, tessellation: 36 }, this.scene);
          band.parent = r; band.position.copyFrom(centre); band.rotation.set(tilt, 0, roll); band.material = this.mats["stone-dark"];
        }
        moss(2, 1.1);
        pebbles("moss-stone", 3);
        return;
      }
      case 2: { // Mine: a rock split open on a seam of glowing crystals.
        this.roughRock("boulder", r, 1.03, 812, "obstacle-rock", [0, 1.03, 0]);
        for (let k = 0; k < 7; k++) this.spike("boulder-crystal", r, centre.add(onSurface(.3 + random() * 1.2, random() * 6.3, .8)), onSurface(.3 + random() * .9, random() * 6.3), .65 + random() * .45, .26 + random() * .12, "crystal");
        for (let k = 0; k < 5; k++) {
          const fleck = MeshBuilder.CreatePolyhedron("boulder-ore", { type: 1, size: .07 + random() * .05 }, this.scene);
          fleck.parent = r; fleck.position.copyFrom(centre.add(onSurface(.6 + random() * 1.2, random() * 6.3, 1.02))); fleck.material = this.mats.gold;
        }
        pebbles("obstacle-rock", 4);
        return;
      }
      case 3: { // Bamboo grove: a mossy boulder with ferns growing from the top.
        this.roughRock("boulder", r, 1.03, 813, "moss-stone", [0, 1.03, 0]);
        moss(1.92, 1.3);
        for (let c = 0; c < 2; c++) {
          const fern = MeshBuilder.CreatePlane("boulder-fern", { size: 1.1 }, this.scene);
          fern.parent = r; fern.position.set(.15, 2.25, 0); fern.rotation.y = c * Math.PI / 2 + .4; fern.material = this.mats["fern-leaves"];
        }
        this.addMushroom(r, -.75, .05, -.7, .8, true, random);
        this.addMushroom(r, -.55, .03, -.85, .55, false, random);
        return;
      }
      case 4: { // Canyon: banded red sandstone with a smaller stone balanced on it.
        this.roughRock("boulder", r, 1.03, 814, "sandstone", [0, 1.03, 0]);
        for (const [y, size] of [[.75, 2.02], [1.35, 1.9]] as const) {
          const band = MeshBuilder.CreateTorus("boulder-band", { diameter: size, thickness: .1, tessellation: 28 }, this.scene);
          band.parent = r; band.position.y = y; band.scaling.set(1, .6, 1); band.material = this.mats["sandstone-light"];
        }
        this.roughRock("boulder-cap", r, .42, 815, "sandstone-light", [.1, 2.1, .05]);
        pebbles("sandstone", 5);
        return;
      }
      case 5: { // Snowfield: a giant snowball, studded with twigs and pebbles, with the track it rolled down.
        this.roughRock("snowball", r, 1.05, 816, "snow", [0, 1.05, 0], .35, true);
        for (let k = 0; k < 5; k++) this.spike("snowball-twig", r, centre.add(onSurface(.4 + random() * 1.6, random() * 6.3, .9)), onSurface(.4 + random() * 1.5, random() * 6.3), .4 + random() * .3, .05, "pine-trunk", 4);
        for (let k = 0; k < 7; k++) {
          const stone = MeshBuilder.CreateSphere("snowball-stone", { diameter: .1 + random() * .08, segments: 5 }, this.scene);
          stone.parent = r; stone.position.copyFrom(centre.add(onSurface(.3 + random() * 1.9, random() * 6.3, 1.03))); stone.material = this.mats.coal;
        }
        const track = MeshBuilder.CreateSphere("snowball-track", { diameter: 1, segments: 10 }, this.scene);
        track.parent = r; track.position.set(0, .02, 2.4); track.scaling.set(1.5, .18, 3.2); track.material = this.mats.snow;
        for (let k = 0; k < 5; k++) {
          const clump = MeshBuilder.CreateSphere("snowball-clump", { diameter: .3 + random() * .25, segments: 6 }, this.scene);
          clump.parent = r; clump.position.set((random() - .5) * 2.4, .05, (random() - .5) * 2); clump.scaling.y = .6; clump.material = this.mats.snow;
        }
        return;
      }
      default: { // Canal: a wet, mossy boulder.
        this.roughRock("boulder", r, 1.03, 811, "obstacle-rock", [0, 1.03, 0]);
        moss(1.95, .9); moss(1.7, .7);
        pebbles("obstacle-rock", 5);
      }
    }
  }

  /** Two-lane debris to jump over. */
  private debris(r: TransformNode, scene: number) {
    const width = 4.5, random = seeded(461 + scene);
    const along = (i: number, n: number) => (i / (n - 1) - .5) * (width - .45);
    switch (scene) {
      case 1: { // Temple: fallen carved blocks, a column drum and roots.
        for (let i = 0; i < 7; i++) {
          const size = .28 + random() * .26;
          const block = this.box("rubble-block", r, [size * 1.3, size, size], [along(i, 7), size * .42, (random() - .5) * .8], i % 3 ? "moss-stone" : "stone-dark");
          block.rotation.set(random() * .5, random() * 3, random() * .4);
        }
        for (const x of [-1.1, 1.3]) { const drum = this.cylinder("column-drum", r, { diameter: .55, height: .4, tessellation: 12 }, [x, .27, .45], "moss-stone"); drum.rotation.set(Math.PI / 2, .4, 0); }
        for (let i = 0; i < 3; i++) { const root = this.cylinder("rubble-root", r, { diameterTop: .03, diameterBottom: .09, height: 1.2, tessellation: 6 }, [along(i, 3) * .8, .1, -.4], "log-bark"); root.rotation.set(.1, i * .9, Math.PI / 2 - .1); }
        return;
      }
      case 2: { // Mine: ore rubble, crystal shards and broken sleepers.
        for (let i = 0; i < 9; i++) this.roughRock("ore-rubble", r, .22 + random() * .18, 900 + i, "obstacle-rock", [along(i, 9), .2, (random() - .5) * .9]);
        for (let i = 0; i < 4; i++) this.spike("rubble-crystal", r, new Vector3(along(i, 4) + .3, .05, (random() - .5) * .6), new Vector3((random() - .5) * .8, 1, (random() - .5) * .8), .45 + random() * .25, .16, "crystal");
        for (const x of [-1.2, .9]) { const sleeper = this.box("broken-sleeper", r, [1.3, .12, .26], [x, .14, -.35], "wood"); sleeper.rotation.set(0, .4, .2); }
        const rail = this.box("broken-rail", r, [1.6, .1, .1], [.2, .2, .4], "rail"); rail.rotation.set(0, -.3, .25);
        return;
      }
      case 3: { // Bamboo grove: a row of sharpened stakes leaning at the runner.
        for (let i = 0; i < 9; i++) {
          const stake = this.cylinder("bamboo-stake", r, { diameterTop: 0, diameterBottom: .11, height: .8 + random() * .15, tessellation: 7 }, [along(i, 9), .38, .08], "bamboo");
          stake.rotation.set(-.42 + (random() - .5) * .1, 0, (random() - .5) * .15);
        }
        const rail = this.cylinder("stake-rail", r, { diameter: .09, height: width, tessellation: 8 }, [0, .22, .2], "bamboo"); rail.rotation.z = Math.PI / 2;
        for (let i = 0; i < 9; i += 2) { const tie = MeshBuilder.CreateTorus("stake-tie", { diameter: .16, thickness: .03, tessellation: 8 }, this.scene); tie.parent = r; tie.position.set(along(i, 9), .22, .2); tie.rotation.z = Math.PI / 2; tie.material = this.mats.zipline; }
        return;
      }
      case 4: { // Canyon: a clump of cacti among rocks.
        for (let i = 0; i < 4; i++) {
          const x = along(i, 4) + (random() - .5) * .3, z = (random() - .5) * .7, h = .5 + random() * .3;
          this.cylinder("small-cactus", r, { diameter: .26, height: h, tessellation: 10 }, [x, h / 2, z], "cactus");
          const top = MeshBuilder.CreateSphere("small-cactus-top", { diameter: .26, segments: 6 }, this.scene); top.parent = r; top.position.set(x, h, z); top.material = this.mats.cactus;
          const arm = this.cylinder("small-cactus-arm", r, { diameter: .14, height: .24, tessellation: 8 }, [x + .15, h * .6, z], "cactus"); arm.rotation.z = -.9;
          const bloom = MeshBuilder.CreateSphere("small-cactus-flower", { diameter: .08, segments: 5 }, this.scene); bloom.parent = r; bloom.position.set(x, h + .12, z); bloom.material = this.mats["cactus-flower"];
        }
        for (let i = 0; i < 3; i++) { const barrel = MeshBuilder.CreateSphere("barrel-cactus", { diameter: .36, segments: 8 }, this.scene); barrel.parent = r; barrel.position.set(along(i, 3) * .7, .13, .4); barrel.scaling.y = .75; barrel.material = this.mats.cactus; }
        for (let i = 0; i < 4; i++) this.roughRock("canyon-rubble", r, .16 + random() * .14, 920 + i, "sandstone", [along(i, 4) - .2, .1, -.45]);
        return;
      }
      case 5: { // Snowfield: a crop of ice spikes in drifted snow.
        for (let i = 0; i < 10; i++) {
          this.spike("ice-spike", r, new Vector3(along(i, 10), 0, (random() - .5) * .8), new Vector3((random() - .5) * .5, 1, (random() - .5) * .5), .45 + random() * .35, .22 + random() * .14, "ice");
        }
        for (let i = 0; i < 4; i++) { const drift = MeshBuilder.CreateSphere("ice-drift", { diameter: .9, segments: 8 }, this.scene); drift.parent = r; drift.position.set(along(i, 4), 0, (random() - .5) * .6); drift.scaling.set(1, .3, .8); drift.material = this.mats.snow; }
        return;
      }
      default: { // Canal: loose rocks and fallen twigs.
        for (let i = 0; i < 11; i++) {
          const size = .2 + (i % 4) * .07;
          this.roughRock("loose-rock", r, size, 940 + i, "obstacle-rock", [along(i, 11), size * .5, Math.sin(i * 2.3) * .48]);
        }
        for (let i = 0; i < 6; i++) {
          const branch = this.cylinder("fallen-twig", r, { diameterTop: .035, diameterBottom: .12, height: .95 + (i % 3) * .18, tessellation: 6 }, [(i / 5 - .5) * (width - .6), .18, i % 2 ? -.38 : .4], "log-bark");
          branch.rotation.z = Math.PI / 2 + (i % 2 ? -.34 : .25); branch.rotation.y = i * .71;
        }
      }
    }
  }

  /** Two-lane fire: tongues of flame over burning logs and embers, inside whatever ring the place offers. */
  private campfire(r: TransformNode, scene: number, flameMaterial: StandardMaterial) {
    const random = seeded(471 + scene);
    for (const [i, [x, z, height, width]] of FLAMES.entries()) {
      const flame = flameMesh(this.scene, i % 2 === 0);
      flame.parent = r; flame.position.set(x, -.015, z); flame.scaling.set(width, height, .94); flame.rotation.y = i * .64;
      flame.material = flameMaterial;
    }
    for (const [x, turn] of [[-1.35, .5], [-.45, -.4], [.45, .35], [1.35, -.5]] as const) {
      const log = this.cylinder("fire-log", r, { diameter: .24, height: 1.25, tessellation: 8 }, [x, .12, (random() - .5) * .3], scene === 3 ? "bamboo" : "charcoal");
      log.rotation.set(0, turn, Math.PI / 2);
    }
    for (let k = 0; k < 18; k++) {
      const ember = MeshBuilder.CreateIcoSphere("fire-ember", { radius: .045 + random() * .05, subdivisions: 1 }, this.scene);
      ember.parent = r; ember.position.set((random() - .5) * 4.1, .03, (random() - .5) * 1.1); ember.material = this.mats.ember;
    }
    // A ring round the fire, made of what the place has.
    const ring = ["stone-dark", "moss-stone", "coal", "stone-dark", "sandstone", "rock"][scene];
    for (let k = 0; k < 16; k++) {
      const angle = k / 16 * Math.PI * 2;
      this.roughRock("fire-stone", r, .16 + random() * .08, 960 + k, ring, [Math.cos(angle) * 2.45, .08, Math.sin(angle) * .9]);
    }
    if (scene === 1) {
      // A toppled bronze brazier.
      const bowl = this.cylinder("fire-brazier", r, { diameterTop: 1, diameterBottom: .5, height: .4, tessellation: 14 }, [2.05, .35, .7], "metal");
      bowl.rotation.z = -1.15;
    } else if (scene === 2) {
      for (let k = 0; k < 14; k++) this.roughRock("fire-coal", r, .1 + random() * .08, 980 + k, "coal", [(random() - .5) * 3.8, .06, (random() - .5) * 1.2]);
      const plank = this.box("fire-crate", r, [.9, .08, .26], [-2, .2, .65], "wood"); plank.rotation.set(.3, .5, .4);
    } else if (scene === 3) {
      for (let k = 0; k < 5; k++) { const cane = this.cylinder("fire-cane", r, { diameter: .1, height: .6, tessellation: 8 }, [(random() - .5) * 3.6, .06, (random() - .5) * 1], "charcoal"); cane.rotation.set(0, random() * 3, Math.PI / 2); }
    } else if (scene === 4) {
      for (let k = 0; k < 6; k++) { const twig = this.cylinder("fire-brush", r, { diameterTop: .02, diameterBottom: .06, height: .7, tessellation: 5 }, [(k < 3 ? -1 : 1) * (2.1 + random() * .3), .2, (random() - .5) * .8], "bleached"); twig.rotation.set(random() - .5, random() * 3, .8); }
    } else if (scene === 5) {
      // The fire has melted a dark patch in the snow, with drifts round it.
      const melt = MeshBuilder.CreateDisc("fire-melt", { radius: 1, tessellation: 24 }, this.scene);
      melt.parent = r; melt.position.y = .015; melt.rotation.x = Math.PI / 2; melt.scaling.set(2.6, 1.1, 1); melt.material = this.mats.charcoal;
      for (let k = 0; k < 8; k++) {
        const angle = k / 8 * Math.PI * 2, drift = MeshBuilder.CreateSphere("fire-drift", { diameter: .8, segments: 8 }, this.scene);
        drift.parent = r; drift.position.set(Math.cos(angle) * 2.9, 0, Math.sin(angle) * 1.15); drift.scaling.set(1, .35, .8); drift.material = this.mats.snow;
      }
    }
  }

  /** Two-lane trapdoor over a shaft. Planks are named "trap-plank" and swing open; their trim rides on them. */
  private trapdoor(r: TransformNode, scene: number) {
    const halfDepth = obstacleHalfDepth("trap", 0), width = 2 * LANE_WIDTH, random = seeded(481 + scene);
    const plankMaterial = ["wood", "wood", "wood", "bamboo", "bleached", "ice"][scene];
    for (let i = 0; i < 8; i++) {
      const plank = this.box("trap-plank", r, [.57, .13, halfDepth * 2], [(i - 3.5) * .6, .02, 0], plankMaterial);
      if (scene === 3) for (const dx of [-.19, 0, .19]) this.box("trap-slat", plank, [.025, .02, halfDepth * 2], [dx, .075, 0], "bamboo-node");
      else if (scene === 5) {
        for (let k = 0; k < 2; k++) this.box("trap-frost", plank, [.3 + random() * .2, .02, .5 + random() * .6], [(random() - .5) * .2, .075, (random() - .5) * 2.6], "snow");
        const crack = this.box("trap-crack", plank, [.02, .015, 1.1], [(random() - .5) * .3, .072, (random() - .5) * 1.5], "pit"); crack.rotation.y = (random() - .5) * 1.2;
      } else {
        for (const z of [-1.15, 1.15]) this.box("trap-strap", plank, [.59, .025, .09], [0, .075, z], scene === 2 ? "rail" : "lamp-iron");
        if (scene === 1 && i % 3 === 0) this.box("trap-moss", plank, [.34, .02, .7], [(random() - .5) * .1, .075, (random() - .5) * 1.8], "moss");
        if (scene === 4 && i % 2 === 0) this.box("trap-sand", plank, [.4, .02, .9], [0, .074, (random() - .5) * 1.6], "sandstone-light");
      }
      if (i === 3 && scene !== 5) {
        const ring = MeshBuilder.CreateTorus("trap-handle", { diameter: .2, thickness: .035, tessellation: 12 }, this.scene);
        ring.parent = plank; ring.position.set(.12, .08, 0); ring.material = this.mats.metal;
      }
    }
    for (const side of [-1, 1]) {
      this.box("trap-shaft-wall", r, [.25, 6.4, halfDepth * 2], [side * (width / 2 + .13), -3.2, 0], "rock");
      this.box("trap-shaft-end", r, [width, 6.4, .24], [0, -3.2, side * (halfDepth + .12)], "stone-dark");
      this.box("trap-rim", r, [width, .13, .15], [0, .04, side * (halfDepth + .085)], "warning");
      this.box("trap-frame", r, [.14, .14, halfDepth * 2 + .3], [side * (width / 2 + .07), .03, 0], scene === 5 ? "snow" : "wood");
      const hinge = this.cylinder("trap-hinge", r, { diameter: .08, height: halfDepth * 2 - .3, tessellation: 8 }, [side * (width / 2 - .03), .07, 0], "lamp-iron");
      hinge.rotation.x = Math.PI / 2;
    }
    this.pitSurface(r, width + .05, halfDepth * 2 + .04, "trap");
  }

  /** A crack across the road (one lane, or all three). Parts on each bank keep that bank's side of z, so long pits can stretch them apart. */
  private fissure(r: TransformNode, scene: number, name: string, width: number) {
    const wall = ["rock", "moss-stone", "rock", "rock", "sandstone", "rock"][scene], random = seeded(491 + scene * 3 + Math.round(width));
    for (const side of [-1, 1]) this.box("fissure-wall", r, [.25, 6.4, FISSURE_HALF * 2], [side * (width / 2 + .13), -3.2, 0], wall);
    this.pitSurface(r, width + .05, FISSURE_HALF * 2 + .04, name === "long-gap-wide" ? "long-gap" : "gap");
    for (const side of [-1, 1]) {
      const bank = side * (FISSURE_HALF + .12);
      this.box("fissure-end", r, [width + .5, 6.4, .24], [0, -3.2, bank], scene === 4 ? "sandstone" : "stone-dark");
      this.box("lip", r, [width, .2, .25], [0, -.09, bank], "stone-dark");
      this.box("edge", r, [width - .16, .04, .14], [0, .02, side * (FISSURE_HALF + .14)], "warning");
      if (name === "long-gap-wide") for (const x of [-1, 1]) {
        const edge = this.box("long-gap-marker", r, [.34, .58, .26], [x * (width / 2 - .22), .32, side * (FISSURE_HALF + .33)], "warning");
        edge.rotation.z = x * .1;
      }
      // Broken edge: chunks hanging just under the lip.
      const inside = side * (FISSURE_HALF - .08);
      for (let k = 0, n = Math.round(width * 1.3); k < n; k++) {
        this.roughRock("fissure-chunk", r, .12 + random() * .12, 1000 + k * 2 + side, wall, [(k / Math.max(1, n - 1) - .5) * (width - .3), -.3 - random() * .5, inside - side * random() * .15]);
      }
      if (scene === 1 || scene === 3) for (let k = 0; k < 3; k++) {
        // Roots dangle from the lip into the dark.
        const length = .8 + random() * .7;
        const root = this.cylinder("fissure-root", r, { diameterTop: .07, diameterBottom: .02, height: length, tessellation: 5 }, [(random() - .5) * (width - .4), -.15 - length / 2, inside], "log-bark");
        root.rotation.set(side * .15, 0, (random() - .5) * .3);
      } else if (scene === 2) {
        const sleeper = this.box("fissure-sleeper", r, [Math.min(1.6, width - .2), .1, .24], [(random() - .5) * .3, -.4, inside - side * .3], "wood");
        sleeper.rotation.x = side * .9;
      } else if (scene === 5) {
        this.box("fissure-snow", r, [width + .1, .12, .3], [0, .05, side * (FISSURE_HALF + .2)], "snow");
        for (let k = 0, n = Math.round(width * 2); k < n; k++) {
          const length = .2 + random() * .35;
          this.cylinder("fissure-icicle", r, { diameterTop: .08, diameterBottom: 0, height: length, tessellation: 5 }, [(k / Math.max(1, n - 1) - .5) * (width - .2), -.2 - length / 2, inside], "ice");
        }
      } else if (scene === 4) {
        for (let k = 0; k < 3; k++) {
          const plate = this.box("fissure-plate", r, [.6 + random() * .4, .08, .4], [(random() - .5) * (width - .6), -.12, inside + side * .05], "sandstone-light");
          plate.rotation.set(side * (.3 + random() * .3), random() * .5, 0);
        }
      }
    }
  }

  /** Log piles for the scenes without mushrooms or creepers. */
  private logPile(r: TransformNode, scene: number, wide: boolean) {
    const random = seeded(501 + scene + (wide ? 50 : 0)), length = wide ? ROAD_HALF * 2 + .6 : 4.6;
    switch (scene) {
      case 2: { // Mine: stacked square timbers bound with iron, ore spilling out.
        for (const [y, z, scale] of [[.2, -.2, 1], [.2, .2, .96], [.56, 0, .9]] as const) {
          const timber = this.box("pile-timber", r, [length * scale, .36, .36], [(random() - .5) * .2, y, z], "wood");
          timber.rotation.y = (random() - .5) * .06;
        }
        for (const x of [-.3, .3]) this.box("pile-band", r, [.06, .8, .8], [x * length, .38, 0], "metal");
        for (let k = 0; k < 5; k++) this.roughRock("pile-ore", r, .1 + random() * .08, 1100 + k, k % 2 ? "gold" : "obstacle-rock", [(random() - .5) * length * .8, .08, -.45 - random() * .2]);
        return;
      }
      case 3: { // Bamboo grove: a bundle of cut canes, tied with rope, leaves still on one end.
        for (const [row, count] of [[0, 4], [1, 3], [2, 2]] as const) for (let i = 0; i < count; i++) {
          const cane = this.cylinder("pile-cane", r, { diameter: .2, height: length * (.94 + random() * .1), tessellation: 10 }, [(random() - .5) * .2, .1 + row * .17, (i - (count - 1) / 2) * .21], "bamboo");
          cane.rotation.z = Math.PI / 2;
        }
        for (const x of [-.3, .3]) { const tie = MeshBuilder.CreateTorus("pile-tie", { diameter: .95, thickness: .05, tessellation: 18 }, this.scene); tie.parent = r; tie.position.set(x * length, .3, 0); tie.rotation.z = Math.PI / 2; tie.scaling.set(1, 1, .62); tie.material = this.mats.zipline; }
        for (let c = 0; c < 2; c++) { const leaves = MeshBuilder.CreatePlane("pile-leaves", { size: 1.3 }, this.scene); leaves.parent = r; leaves.position.set(length / 2 + .2, .55, 0); leaves.rotation.y = c * Math.PI / 2 + .3; leaves.material = this.mats["bamboo-leaves"]; }
        return;
      }
      case 4: { // Canyon: a sun-bleached dead trunk with bare branches.
        const trunk = this.fallenLog("dead-trunk", r, length, wide ? .9 : .8, [0, wide ? .45 : .4, 0], "bleached");
        trunk.rotation.z = Math.PI / 2 + .03;
        for (let k = 0; k < 4; k++) {
          const branch = this.cylinder("dead-branch", r, { diameterTop: .03, diameterBottom: .12, height: .7 + random() * .4, tessellation: 6 }, [(k / 3 - .5) * length * .8, .85, (random() - .5) * .3], "bleached");
          branch.rotation.set((random() - .5) * .6, 0, (random() - .5) * 1.2);
        }
        for (let k = 0; k < 3; k++) this.roughRock("dead-trunk-rock", r, .2 + random() * .15, 1120 + k, "sandstone", [(random() - .5) * length, .1, (random() < .5 ? -1 : 1) * .55]);
        return;
      }
      default: { // Snowfield: logs under a blanket of snow, icicles along the edge.
        const logs = wide ? [[0, .5, 1.05], [-.55, .25, .5]] as const : [[0, .42, .86]] as const;
        for (const [z, y, thick] of logs) {
          const log = this.fallenLog("snowy-log", r, length, thick, [0, y, z]);
          log.rotation.z = Math.PI / 2 + .02;
          const blanket = MeshBuilder.CreateSphere("snow-blanket", { diameter: 1, segments: 12 }, this.scene);
          blanket.parent = r; blanket.position.set(0, y + thick * .42, z); blanket.scaling.set(length * .98, thick * .32, thick * .82); blanket.material = this.mats.snow;
          for (let k = 0; k < 8; k++) {
            const icicle = .12 + random() * .2;
            this.cylinder("log-icicle", r, { diameterTop: .05, diameterBottom: 0, height: icicle, tessellation: 5 }, [(k / 7 - .5) * length * .85, y - icicle / 2 + .05, z - thick * .45], "ice");
          }
        }
      }
    }
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
    // Built at the origin, then parked under the stash. `merge` folds static parts into one mesh per
    // material, so a detailed prop costs a handful of instances instead of dozens.
    const make = (name: string, build: (root: TransformNode) => void, merge = false) => {
      const root = new TransformNode(`tpl-${name}`, this.scene); build(root);
      if (merge) this.mergeByMaterial(root);
      root.parent = stash; this.templates.set(name, root);
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
    make("aqueduct-pier", r => { this.box("pier", r, [W + 1.4, 18, 1.6], [0, -9.5, 0], "stone-dark"); for (const s of [-1, 1]) this.box("buttress", r, [1.4, 18, 2.2], [s * (ROAD_HALF + .3), -9.5, 0], "stone-dark"); });
    make("temple-ledge", r => { for (const s of [-1, 1]) { this.box("ledge", r, [.9, .55, D], [s * (ROAD_HALF + .45), .02, 0], "moss-stone"); this.box("hedge", r, [1.4, 1.1, D], [s * (ROAD_HALF + 1.6), .3, 0], "foliage-dark"); } });
    make("temple-arch", r => {
      for (const s of [-1, 1]) { this.box("column", r, [1.1, 6.4, 1.1], [s * (ROAD_HALF + .9), 3, 0], "moss-stone"); this.box("plinth", r, [1.5, .6, 1.5], [s * (ROAD_HALF + .9), .1, 0], "stone-dark"); }
      this.box("lintel", r, [W + 3.4, 1, 1.3], [0, 6.6, 0], "moss-stone");
      for (const s of [-1, 1]) { const vine = this.cylinder("vine", r, { diameter: .5, height: 2.4, tessellation: 6 }, [s * (ROAD_HALF + .3), 5.2, .5], "foliage-dark"); vine.scaling.x = .6; }
    });
    // The mine is a wide gallery: rough rock walls well back from the track, three variants in turn.
    for (const [i, variant] of ["a", "b", "c"].entries()) make(`mine-wall-${variant}`, r => {
      const random = seeded(301 + i * 17);
      for (const s of [-1, 1]) {
        this.box("mine-rock-face", r, [2.4, 12.6, D], [s * (MINE_WALL + 1.2), 5.9, 0], "rock");
        for (let k = 0; k < 7; k++) {
          const lump = MeshBuilder.CreateIcoSphere("mine-wall-lump", { radius: .6 + random() * .8, subdivisions: 2, flat: true }, this.scene);
          lump.parent = r; lump.material = this.mats[k % 3 ? "rock" : "obstacle-rock"];
          lump.position.set(s * (MINE_WALL + .45 - random() * .4), .2 + random() * 10, (random() - .5) * D * .95);
          lump.scaling.set(.45 + random() * .2, .7 + random() * .6, .8 + random() * .6); lump.rotation.set(random() * 3, random() * 3, random() * 3);
        }
        for (let k = 0; k < 3; k++) {
          const rubble = MeshBuilder.CreateIcoSphere("mine-rubble", { radius: .2 + random() * .28, subdivisions: 1, flat: true }, this.scene);
          rubble.parent = r; rubble.material = this.mats["obstacle-rock"]; rubble.scaling.y = .6;
          rubble.position.set(s * (MINE_WALL - .5 - random() * 1.1), -.25, (random() - .5) * D); rubble.rotation.set(random() * 3, random() * 3, 0);
        }
      }
      this.box("mine-ceiling", r, [MINE_WALL * 2 + 5, 1.4, D], [0, 12.2, 0], "rock");
      for (let k = 0; k < 3; k++) {
        const length = .9 + random() * 1.5;
        this.cylinder("stalactite", r, { diameterTop: .45 + random() * .35, diameterBottom: 0, height: length, tessellation: 7 }, [(random() - .5) * MINE_WALL * 1.7, 11.5 - length / 2, (random() - .5) * D * .8], "rock");
      }
      // A water pipe on one wall and a power cable on the other run the length of the gallery.
      const pipe = this.cylinder("mine-pipe", r, { diameter: .26, height: D, tessellation: 10 }, [MINE_WALL - .35, 2.4, 0], "metal"); pipe.rotation.x = Math.PI / 2;
      this.box("mine-pipe-clamp", r, [.5, .08, .1], [MINE_WALL - .15, 2.4, 0], "lamp-iron");
      const cable = this.cylinder("mine-cable", r, { diameter: .07, height: D, tessellation: 6 }, [-(MINE_WALL - .2), 5.4, 0], "rail"); cable.rotation.x = Math.PI / 2;
    }, true);
    make("mine-frame", r => {
      for (const s of [-1, 1]) {
        this.box("post", r, [.42, 7.6, .42], [s * (ROAD_HALF + 1.1), 3.45, 0], "wood");
        this.box("post-foot", r, [.62, .3, .62], [s * (ROAD_HALF + 1.1), -.2, 0], "stone-dark");
        const brace = this.cylinder("brace", r, { diameter: .2, height: 1.5, tessellation: 6 }, [s * (ROAD_HALF + .6), 6.55, 0], "wood");
        brace.rotation.z = s * .74;
      }
      this.box("cap", r, [W + 3.4, .5, .5], [0, 7.35, 0], "wood");
      this.cylinder("lantern-chain", r, { diameter: .03, height: .7, tessellation: 4 }, [0, 6.75, 0], "metal");
      this.cylinder("lantern-roof", r, { diameterTop: .05, diameterBottom: .42, height: .18, tessellation: 6 }, [0, 6.42, 0], "lamp-iron");
      this.cylinder("lantern", r, { diameterTop: .32, diameterBottom: .25, height: .36, tessellation: 6 }, [0, 6.15, 0], "lamp");
      this.cylinder("lantern-base", r, { diameter: .27, height: .05, tessellation: 6 }, [0, 5.95, 0], "lamp-iron");
      const halo = MeshBuilder.CreatePlane("halo", { size: 2.4 }, this.scene); halo.parent = r; halo.position.set(0, 6.15, 0); halo.material = this.mats["lamp-halo"]; halo.billboardMode = Mesh.BILLBOARDMODE_ALL;
    }, true);
    make("mine-cart-parked", r => {
      // An ore cart left on a short siding beside the track.
      const x = -(ROAD_HALF + 2.3);
      for (const s of [-1, 1]) this.box("siding-rail", r, [.08, .1, D], [x + s * .55, -.28, 0], "rail");
      for (const z of [-1.4, 0, 1.4]) this.box("siding-sleeper", r, [1.6, .06, .28], [x, -.33, z], "wood");
      this.box("ore-cart-body", r, [1.3, .7, 1.7], [x, .35, .2], "log-bark");
      for (const s of [-1, 1]) this.box("ore-cart-band", r, [1.36, .1, .1], [x, .6, .2 + s * .8], "metal");
      for (const sx of [-1, 1]) for (const z of [-.4, .8]) {
        const wheel = this.cylinder("ore-cart-wheel", r, { diameter: .4, height: .12, tessellation: 12 }, [x + sx * .55, -.08, z], "metal");
        wheel.rotation.z = Math.PI / 2;
      }
      const random = seeded(77);
      for (let k = 0; k < 6; k++) {
        const ore = MeshBuilder.CreatePolyhedron("ore-lump", { type: k % 2 ? 2 : 1, size: .2 + random() * .14 }, this.scene);
        ore.parent = r; ore.material = this.mats[k === 2 || k === 5 ? "gold" : "obstacle-rock"];
        ore.position.set(x + (random() - .5) * .8, .78 + random() * .14, .2 + (random() - .5) * 1.1); ore.rotation.set(random() * 3, random() * 3, 0);
      }
    }, true);
    make("zipline-anchor", r => {
      for (const side of [-1, 1]) {
        this.box("zipline-post", r, [.43, 3.8, .48], [side * 2.95, 1.78, 0], "wood");
        this.box("zipline-foot", r, [.85, .48, .85], [side * 2.95, .17, 0], "stone-dark");
      }
      this.box("zipline-crossbar", r, [6.44, .31, .47], [0, 3.38, 0], "wood");
      this.box("zipline-bracket", r, [.29, .47, .24], [0, 3.12, 0], "metal");
    });
    make("rope-handle", r => {
      this.cylinder("rope-lanyard", r, { height: 1, diameter: .073, tessellation: 9 }, [0, -.5, 0], "zipline");
      this.box("rope-pulley", r, [.29, .23, .45], [0, 0, 0], "metal");
    });
    make("bicycle", r => {
      const rod = (parent: TransformNode, a: [number, number], b: [number, number], diameter: number, material: string) => {
        const dy = b[0] - a[0], dz = b[1] - a[1];
        const part = this.cylinder("bicycle-tube", parent, { height: Math.hypot(dy, dz), diameter, tessellation: 10 }, [0, (a[0] + b[0]) / 2, (a[1] + b[1]) / 2], material);
        part.rotation.x = Math.atan2(dz, dy);
      };
      const axleY = .40;
      for (const z of [-.67, .67]) {
        const wheel = new TransformNode("bicycle-wheel", this.scene); wheel.parent = r; wheel.position.set(0, axleY, z);
        for (const [diameter, thickness, material] of [[.70, .098, "bike-rubber"], [.64, .034, "bike-chrome"]] as const) {
          const rim = MeshBuilder.CreateTorus("bicycle-rim", { diameter, thickness, tessellation: 28 }, this.scene);
          rim.parent = wheel; rim.rotation.z = Math.PI / 2; rim.material = this.mats[material]; rim.isPickable = false;
        }
        for (let i = 0; i < 4; i++) {
          const a = i * Math.PI / 4, y = .31 * Math.cos(a), z = .31 * Math.sin(a);
          rod(wheel, [-y, -z], [y, z], .016, "bike-chrome");
        }
      }
      const seat: [number, number] = [.96, -.36], pedal: [number, number] = [.39, -.15], head: [number, number] = [.92, .49];
      for (const [a, b] of [[seat, pedal], [seat, head], [pedal, head], [[axleY, -.67], pedal], [[axleY, -.67], seat], [[axleY, .67], head]] as [[number,number], [number,number]][]) rod(r, a, b, .073, "bike-frame");
      this.box("saddle", r, [.30, .085, .31], [0, 1.02, -.40], "bike-rubber");
      rod(r, head, [1.15, .56], .06, "bike-chrome");
      this.box("handlebar", r, [.65, .061, .073], [0, 1.15, .55], "bike-rubber");
    });
    make("fruit", r => {
      const body = MeshBuilder.CreateSphere("rolling-fruit", { diameter: .68, segments: 18 }, this.scene);
      body.parent = r; body.scaling.y = .88; body.material = this.mats["fruit-peel"]; body.isPickable = false;
      this.cylinder("fruit-stem", r, { height: .14, diameterTop: .047, diameterBottom: .062, tessellation: 8 }, [0, .34, 0], "wood");
      const leaf = MeshBuilder.CreateSphere("fruit-leaf", { diameter: .24, segments: 10 }, this.scene);
      leaf.parent = r; leaf.position.set(.108, .37, 0); leaf.scaling.set(1, .19, .56); leaf.rotation.z = .46;
      leaf.material = this.mats["fruit-leaf"]; leaf.isPickable = false;
    });
    make("minecart", r => {
      this.box("cart-floor", r, [1.55, .26, 1.86], [0, .28, 0], "metal");
      for (const side of [-1, 1]) {
        const sideWall = this.box("cart-side", r, [.16, .60, 1.91], [side * .77, .59, 0], "log-bark");
        sideWall.rotation.z = -side * .18;
        const endWall = this.box("cart-end", r, [1.66, .59, .16], [0, .59, side * .89], "log-bark");
        endWall.rotation.x = side * .19;
        this.box("cart-rim", r, [1.77, .10, .13], [0, .91, side * .96], "metal");
        for (const z of [-.63, .63]) {
          const wheel = this.cylinder("cart-wheel", r, { height: .17, diameter: .48, tessellation: 18 }, [side * .61, .25, z], "metal");
          wheel.rotation.z = Math.PI / 2;
        }
      }
      this.box("cart-lantern", r, [.23, .26, .18], [0, .68, .99], "lamp");
    });
    make("lamp-post", r => this.lampPost(r, false), true);
    make("snow-lamp", r => this.lampPost(r, true), true);
    make("stone-lantern", r => {
      for (const s of [-1, 1]) {
        const x = s * (ROAD_HALF + .95);
        this.box("lantern-foot", r, [.72, .2, .72], [x, .08, 0], "stone-dark");
        this.box("lantern-step", r, [.5, .14, .5], [x, .25, 0], "stone");
        this.cylinder("lantern-pillar", r, { diameter: .28, height: .86, tessellation: 6 }, [x, .75, 0], "stone");
        this.box("lantern-shelf", r, [.68, .12, .68], [x, 1.24, 0], "stone-dark");
        for (const [dx, dz] of [[-1, -1], [-1, 1], [1, -1], [1, 1]] as const) this.box("lantern-corner", r, [.09, .36, .09], [x + dx * .2, 1.48, dz * .2], "stone");
        this.box("lantern-light", r, [.3, .3, .3], [x, 1.48, 0], "lamp");
        const roof = this.cylinder("lantern-roof", r, { diameterTop: .08, diameterBottom: 1.02, height: .34, tessellation: 4 }, [x, 1.83, 0], "stone-dark");
        roof.rotation.y = Math.PI / 4;
        const knob = MeshBuilder.CreateSphere("lantern-knob", { diameter: .15, segments: 6 }, this.scene);
        knob.parent = r; knob.position.set(x, 2.05, 0); knob.material = this.mats.stone;
        const halo = MeshBuilder.CreatePlane("halo", { size: 1.9 }, this.scene); halo.parent = r; halo.position.set(x, 1.48, 0); halo.material = this.mats["lamp-halo"]; halo.billboardMode = Mesh.BILLBOARDMODE_ALL;
      }
    }, true);
    make("canyon-lamp", r => {
      for (const s of [-1, 1]) {
        const x = s * (ROAD_HALF + .65), lx = x - s * .78;
        this.box("lamp-post-wood", r, [.22, 3.3, .22], [x, 1.5, 0], "wood");
        for (const k of [0, 1, 2]) {
          const stone = MeshBuilder.CreatePolyhedron("lamp-foot-rock", { type: 2, size: .2 + k * .05 }, this.scene);
          stone.parent = r; stone.position.set(x + (k - 1) * .22, -.2, (k % 2 ? .2 : -.18)); stone.material = this.mats.sandstone;
        }
        this.box("lamp-beam", r, [.95, .14, .14], [x - s * .4, 3.05, 0], "wood");
        const brace = this.cylinder("lamp-brace", r, { diameter: .09, height: .7, tessellation: 6 }, [x - s * .25, 2.75, 0], "wood");
        brace.rotation.z = s * .66;
        this.cylinder("lamp-hook", r, { diameter: .03, height: .2, tessellation: 4 }, [lx, 2.9, 0], "lamp-iron");
        this.cylinder("lamp-cap", r, { diameterTop: .04, diameterBottom: .34, height: .14, tessellation: 8 }, [lx, 2.76, 0], "lamp-iron");
        this.cylinder("lamp-glass", r, { diameter: .26, height: .34, tessellation: 8 }, [lx, 2.52, 0], "lamp");
        this.cylinder("lamp-bottom", r, { diameter: .3, height: .05, tessellation: 8 }, [lx, 2.33, 0], "lamp-iron");
        const halo = MeshBuilder.CreatePlane("halo", { size: 2.2 }, this.scene); halo.parent = r; halo.position.set(lx, 2.52, 0); halo.material = this.mats["lamp-halo"]; halo.billboardMode = Mesh.BILLBOARDMODE_ALL;
      }
    }, true);
    make("temple-ferns", r => {
      // Ferns and small flowers growing out of the mossy ledges.
      const random = seeded(41);
      for (const s of [-1, 1]) for (let k = 0; k < 2; k++) {
        const x = s * (ROAD_HALF + .35 + random() * .25), z = (k - .5) * 2 + (random() - .5);
        for (let c = 0; c < 2; c++) {
          const card = MeshBuilder.CreatePlane("fern", { size: .95 + random() * .4 }, this.scene);
          card.parent = r; card.material = this.mats["fern-leaves"];
          card.position.set(x, .62, z); card.rotation.set((random() - .5) * .3, c * Math.PI / 2 + random(), 0);
        }
        for (let f = 0; f < 3; f++) {
          const bloom = MeshBuilder.CreateSphere("flower", { diameter: .09 + random() * .05, segments: 5 }, this.scene);
          bloom.parent = r; bloom.material = this.mats[f % 2 ? "flower-white" : "flower-pink"];
          bloom.position.set(x + (random() - .5) * .5, .38 + random() * .12, z + (random() - .5) * .8);
        }
      }
    }, true);
    make("bamboo-fence", r => {
      for (const s of [-1, 1]) {
        const x = s * (ROAD_HALF + .35);
        this.box("fence-kerb", r, [.45, .26, D], [s * (ROAD_HALF + .05), .02, 0], "stone-dark");
        for (const y of [.45, .86]) {
          const rail = this.cylinder("fence-rail", r, { diameter: .085, height: D, tessellation: 8 }, [x, y, 0], "bamboo");
          rail.rotation.x = Math.PI / 2;
          const tie = MeshBuilder.CreateTorus("fence-tie", { diameter: .17, thickness: .03, tessellation: 10 }, this.scene);
          tie.parent = r; tie.position.set(x, y, 0); tie.rotation.z = Math.PI / 2; tie.material = this.mats.zipline;
        }
        this.cylinder("fence-post", r, { diameter: .13, height: 1.15, tessellation: 8 }, [x, .52, 0], "bamboo");
        this.cylinder("fence-post-node", r, { diameter: .15, height: .05, tessellation: 8 }, [x, 1.08, 0], "bamboo-node");
      }
    }, true);
    for (const [i, variant] of ["a", "b"].entries()) make(`bamboo-clump-${variant}`, r => this.bambooClump(r, 53 + i * 31), true);
    make("canyon-kerb", r => {
      const random = seeded(61);
      for (const s of [-1, 1]) {
        this.box("canyon-kerb-stone", r, [.6, .42, D], [s * (ROAD_HALF + .1), .02, 0], "sandstone-light");
        this.box("canyon-fence-post", r, [.15, .95, .15], [s * (ROAD_HALF + .5), .45, 0], "wood");
        const rope = this.cylinder("canyon-fence-rope", r, { diameter: .045, height: D, tessellation: 6 }, [s * (ROAD_HALF + .5), .8, 0], "zipline");
        rope.rotation.x = Math.PI / 2;
        for (let k = 0; k < 2; k++) {
          const pebble = MeshBuilder.CreatePolyhedron("canyon-pebble", { type: 2, size: .16 + random() * .18 }, this.scene);
          pebble.parent = r; pebble.material = this.mats.sandstone;
          pebble.position.set(s * (ROAD_HALF + 1.1 + random()), -.25, (random() - .5) * D); pebble.rotation.set(random() * 3, random() * 3, 0);
        }
      }
    }, true);
    make("canyon-hoodoos", r => {
      // Banded sandstone towers with a harder cap rock, like those left standing in a dry canyon.
      const random = seeded(71);
      for (const s of [-1, 1]) for (let k = 0; k < (s > 0 ? 2 : 1); k++) {
        const x = s * (ROAD_HALF + 7 + random() * 8), z = (random() - .5) * 3, height = 6 + random() * 7, spin = random() * 3;
        const tiers: [number, number, number, string][] = [[3.4, 2.4, .42, "sandstone"], [2.4, 1.7, .3, "sandstone-light"], [1.7, 1.1, .16, "sandstone"]];
        let y = -.35;
        for (const [bottom, top, share, material] of tiers) {
          const tier = this.cylinder("hoodoo", r, { diameterBottom: bottom, diameterTop: top, height: height * share, tessellation: 7 }, [x, y + height * share / 2, z], material);
          tier.rotation.y = spin; y += height * share;
        }
        const cap = this.cylinder("hoodoo-cap", r, { diameterBottom: 2.2, diameterTop: 1.6, height: .8, tessellation: 7 }, [x, y + .35, z], "sandstone-light");
        cap.rotation.set(.06, spin, -.05);
      }
    }, true);
    make("canyon-boulders", r => {
      const random = seeded(83);
      for (const s of [-1, 1]) for (let k = 0; k < 3; k++) {
        const size = .35 + random() * .8;
        const rock = MeshBuilder.CreatePolyhedron("canyon-boulder", { type: k % 2 ? 1 : 2, size }, this.scene);
        rock.parent = r; rock.material = this.mats[k === 1 ? "sandstone-light" : "sandstone"];
        rock.position.set(s * (ROAD_HALF + 1.8 + random() * 4.5), size * .35 - .35, (random() - .5) * 3.5);
        rock.scaling.set(1, .7 + random() * .3, 1.1); rock.rotation.set(random() * 3, random() * 3, random());
      }
    }, true);
    make("cactus-patch", r => this.cactusPatch(r, seeded(97)), true);
    // Raised stretches stand on a mesa, a snowy ridge or a bank of earth, wide enough to hold the
    // scenery beside the road, instead of floating over the plain. At ground level they sit just
    // below it and do not show.
    make("canyon-mesa", r => {
      this.box("mesa-body", r, [42, 30, D], [0, -15.45, 0], "mesa-rock");
      this.box("mesa-band", r, [42.2, .9, D], [0, -1.4, 0], "sandstone-light");
      this.box("mesa-band", r, [42.1, .6, D], [0, -4.8, 0], "sandstone-light");
    }, true);
    make("snow-ridge", r => {
      this.box("ridge-body", r, [34, 30, D], [0, -15.45, 0], "cliff-rock");
      this.box("ridge-snow", r, [34.4, 1.6, D], [0, -1.25, 0], "snow");
    }, true);
    make("bamboo-bank", r => {
      this.box("bank-body", r, [24, 30, D], [0, -15.42, 0], "bank-earth");
    }, true);
    make("snow-bank", r => {
      const random = seeded(103);
      for (const s of [-1, 1]) {
        this.box("snow-kerb", r, [.5, .24, D], [s * (ROAD_HALF + .05), .0, 0], "stone-dark");
        this.box("snow-kerb-top", r, [.58, .09, D], [s * (ROAD_HALF + .05), .15, 0], "snow");
        const drift = MeshBuilder.CreateSphere("snow-drift", { diameter: 1, segments: 10 }, this.scene);
        drift.parent = r; drift.material = this.mats.snow;
        drift.position.set(s * (ROAD_HALF + 1.5), -.15, (random() - .5) * .8); drift.scaling.set(2.2, .9 + random() * .4, D * 1.05);
        const x = s * (ROAD_HALF + .55);
        this.box("snow-fence-post", r, [.13, 1.02, .13], [x, .46, 0], "pine-trunk");
        this.box("snow-fence-cap", r, [.2, .07, .2], [x, 1.0, 0], "snow");
        const rail = this.cylinder("snow-fence-rail", r, { diameter: .07, height: D, tessellation: 6 }, [x, .76, 0], "pine-trunk");
        rail.rotation.x = Math.PI / 2;
        this.box("snow-on-rail", r, [.11, .045, D], [x, .81, 0], "snow");
        for (const z of [-1.3, .2, 1.4]) {
          const length = .16 + random() * .18;
          this.cylinder("icicle", r, { diameterTop: .055, diameterBottom: 0, height: length, tessellation: 5 }, [x, .72 - length / 2, z], "ice");
        }
      }
    }, true);
    for (const [i, variant] of ["a", "b"].entries()) make(`snow-pines-${variant}`, r => {
      const random = seeded(127 + i * 19);
      for (const s of [-1, 1]) for (let k = 0; k < 2 + (random() < .5 ? 1 : 0); k++) this.snowPine(r, s * (ROAD_HALF + 4 + random() * 7), (random() - .5) * 3.6, .8 + random() * .75);
    }, true);
    make("snowman", r => this.snowman(r, ROAD_HALF + 3.2, 0), true);
    // Log bridge over the sea: crossed stakes driven into the sea bed hold the log up.
    make("bridge-pile", r => {
      const lean = .63, length = 3.7, below = 2.35;
      for (const s of [-1, 1]) {
        const offset = below - length / 2;
        const stake = this.cylinder("bridge-stake", r, { diameter: .19, height: length, tessellation: 8 }, [s * Math.sin(lean) * offset, -1.6 - Math.cos(lean) * offset, 0], "wood");
        stake.rotation.z = s * lean;
      }
      const lash = MeshBuilder.CreateTorus("bridge-lashing", { diameter: .34, thickness: .07, tessellation: 12 }, this.scene);
      lash.parent = r; lash.position.set(0, -1.6, 0); lash.rotation.x = Math.PI / 2; lash.material = this.mats.zipline;
    }, true);
    make("bridge-vine", r => {
      const axis = new TransformNode("bridge-vine-axis", this.scene); axis.parent = r; axis.position.y = -.68; axis.rotation.x = Math.PI / 2;
      const random = seeded(137);
      this.addVine(axis, 2.2, () => .73, 1.4, 0, random);
      this.addVine(axis, 1.4, () => .73, .9, 2.4, random);
    }, true);
    make("mooring-post", r => {
      this.cylinder("mooring-post", r, { diameter: .5, height: 3.5, tessellation: 10 }, [0, -1.05, 0], "wood");
      this.cylinder("mooring-cap", r, { diameterTop: .2, diameterBottom: .52, height: .2, tessellation: 10 }, [0, .8, 0], "wood");
      for (const y of [.25, .4]) {
        const coil = MeshBuilder.CreateTorus("mooring-rope", { diameter: .56, thickness: .07, tessellation: 14 }, this.scene);
        coil.parent = r; coil.position.y = y; coil.material = this.mats.zipline;
      }
    }, true);
    make("bridge-shore", r => {
      // Where land meets sea at each end of the log bridge. Local +Z points out over the water.
      this.box("shore-wall", r, [SEA_REACH * 2, 2.4, 1.4], [0, -1.45, -.2], "stone-dark");
      this.box("shore-landing", r, [3.4, .32, 2.2], [0, -.18, -1.1], "stone");
      for (const s of [-1, 1]) this.cylinder("shore-bollard", r, { diameter: .42, height: .95, tessellation: 10 }, [s * 1.4, .3, -.4], "stone-dark");
      const random = seeded(149);
      for (let k = 0; k < 14; k++) {
        const rock = MeshBuilder.CreatePolyhedron("shore-rock", { type: k % 2 ? 1 : 2, size: .4 + random() * .7 }, this.scene);
        rock.parent = r; rock.material = this.mats["obstacle-rock"];
        rock.position.set((random() - .5) * SEA_REACH * 1.6, SEA_Y + .1, .8 + random() * 1.6); rock.rotation.set(random() * 3, random() * 3, 0);
      }
    }, true);
    make("mine-shaft-left", r => this.mineShaft(r, -1), true);
    make("mine-shaft-right", r => this.mineShaft(r, 1), true);
    make("plaza", r => { this.box("plaza", r, [W + 2, .5, W + 2], [0, -.26, 0], "stone-dark"); });
    make("dead-end", r => {
      this.box("wall", r, [W + 2.5, 3.2, 1], [0, 1.6, 0], "stone-dark");
      for (const s of [-1, 1]) this.box("pillar", r, [1, 4, 1.2], [s * (ROAD_HALF + 1.2), 2, 0], "stone");
      const portrait = MeshBuilder.CreatePlane("corner-frog-portrait", { width: 2.83, height: 2.85 }, this.scene);
      portrait.parent = r;
      portrait.position.set(0, 1.6, -.505);
      portrait.material = this.mats["corner-frog"];
      portrait.isPickable = false;
    });
    // Fork, broken side. Local +Z runs away from the corner; y = 0 is the road surface.
    make("fork-stub", r => {
      const length = FORK_BRIDGE_START - FORK_STUB_START;
      this.box("fork-stub-base", r, [W, 24, length], [0, -12.5, length / 2], "stone-dark");
      for (const s of [-1, 1]) this.box("fork-stub-curb", r, [.4, .3, length], [s * (ROAD_HALF + .05), .1, length / 2], "stone");
    });
    make("fork-sign", r => {
      this.box("fork-sign-post", r, [.18, 2.3, .18], [0, 1.1, .08], "wood");
      this.box("fork-sign-back", r, [1.86, .98, .08], [0, 1.78, .06], "wood");
      const board = MeshBuilder.CreatePlane("fork-sign-board", { width: 1.72, height: .86 }, this.scene);
      board.parent = r; board.position.set(0, 1.78, 0); board.material = this.mats["fork-sign"]; board.isPickable = false;
    });
    make("fork-bridge", r => {
      const deck = FORK_BRIDGE_BREAK - FORK_BRIDGE_START, half = 1.85;
      const rope = (x: number, a: [number, number], b: [number, number], diameter = .065) => {
        const dy = b[0] - a[0], dz = b[1] - a[1];
        const part = this.cylinder("fork-rope", r, { height: Math.hypot(dy, dz), diameter, tessellation: 8 }, [x, (a[0] + b[0]) / 2, (a[1] + b[1]) / 2], "zipline");
        part.rotation.x = Math.atan2(dz, dy);
      };
      // Stone abutments drop out of sight below each bank.
      this.box("fork-abutment", r, [half * 2 + 1.3, 24, 1.4], [0, -12.25, -.7], "stone-dark");
      this.box("fork-abutment", r, [half * 2 + 1.3, 24, 1.6], [0, -12.25, FORK_GAP_END + 1.3], "stone-dark");
      // Near side: two log stringers carry the planks and snap at the break.
      for (const s of [-1, 1]) {
        const beam = this.cylinder("fork-stringer", r, { diameter: .3, height: deck + .35, tessellation: 10 }, [s * 1.15, -.27, (deck + .35) / 2 - .1], "log-bark");
        beam.rotation.x = Math.PI / 2 + s * .05;
      }
      const planks: [width: number, x: number, z: number, drop: number, pitch: number, roll: number][] = [
        [3.7, 0, .25, 0, 0, 0], [3.7, .02, .8, 0, 0, .01], [3.66, -.03, 1.35, 0, 0, 0],
        [3.1, .3, 1.9, -.02, .04, .03], [2.2, -.5, 2.45, -.08, .13, -.04], [1.3, .7, 3.02, -.24, .38, -.2],
      ];
      for (const [width, x, z, drop, pitch, roll] of planks) {
        const plank = this.box("fork-plank", r, [width, .12, .46], [x, -.06 + drop, z], "wood");
        plank.rotation.set(pitch, 0, roll);
      }
      for (const s of [-1, 1]) {
        this.box("fork-post", r, [.26, 1.55, .26], [s * (half + .15), .55, .05], "wood");
        const flag = MeshBuilder.CreatePlane("fork-flag", { width: .52, height: .32 }, this.scene);
        flag.parent = r; flag.position.set(s * (half + .15) + s * .29, 1.13, .05); flag.rotation.set(0, Math.PI / 2, s * .14);
        flag.material = this.mats["fork-flag"]; flag.isPickable = false;
        // Hand ropes sag over the near deck, then hang loose from where it broke.
        rope(s * (half + .15), [1.25, .05], [1.02, 2.6]);
        rope(s * (half + .1), [1.02, 2.6], [-.95, 3.05]);
      }
      // Far side: the rest of the bridge hangs down the far bank.
      const far = FORK_GAP_END;
      for (const s of [-1, 1]) {
        this.box("fork-post", r, [.26, 1.55, .26], [s * (half + .15), .55, far + .7], "wood");
        rope(s * (half + .15), [1.25, far + .7], [-1.3, far + .12]);
      }
      for (const [i, z] of [far + .55, far + 1.1, far + 1.65, far + 2.2].entries()) this.box("fork-plank", r, [3.6 - i * .05, .12, .46], [0, -.06, z], "wood");
      for (const [i, [x, y, pitch, roll]] of ([[-.35, -.42, 1.36, .06], [.18, -1.12, 1.47, -.09], [-.12, -1.82, 1.52, .12], [.3, -2.5, 1.43, -.05]] as const).entries()) {
        const plank = this.box("fork-plank", r, [3.2 - i * .45, .12, .46], [x, y, far - .06 - i * .04], "wood");
        plank.position.z = far + .4 - i * .03;
        plank.rotation.set(pitch, 0, roll);
      }
      // Ravine under the gap, for banks that sit on solid ground. Placed in ground heights after instancing.
      const chasm = new TransformNode("fork-chasm", this.scene); chasm.parent = r;
      const length = FORK_CHASM.end - FORK_CHASM.start, middle = (FORK_CHASM.start + FORK_CHASM.end) / 2;
      for (const s of [-1, 1]) {
        this.box("fork-chasm-side", chasm, [.5, 4.52, length + .5], [s * FORK_CHASM.half, -2.57, middle], "obstacle-rock");
        this.box("fork-chasm-end", chasm, [FORK_CHASM.half * 2 + .5, 4.52, .5], [0, -2.57, s > 0 ? FORK_CHASM.end : FORK_CHASM.start], "obstacle-rock");
      }
      const water = MeshBuilder.CreateGround("fork-chasm-water", { width: FORK_CHASM.half * 2, height: length }, this.scene);
      water.parent = chasm; water.position.set(0, BRIDGE_WATER_Y, middle); water.material = this.mats["pit-water-long"]; water.isPickable = false;
    });

    // Obstacles. "-double" covers two lanes and "-wide" spans the road. Every scene dresses the same
    // hazards in its own materials: "@scene" templates (snowballs on the snowfield, sharpened stakes in
    // the bamboo grove...); the canal's keep the plain names.
    // Canal and temple log piles: some grow mushrooms, and in the temple ruins they are wound with creepers.
    for (const vine of [false, true]) for (const mushrooms of [false, true]) make(`block-double${vine ? "-vine" : ""}${mushrooms ? "-mushroom" : ""}`, r => {
      const random = seeded(vine ? 211 : 223);
      const trunk = this.fallenLog("joined-log", r, 4.72, .86, [0, .42, -.04]);
      trunk.rotation.set(0, -.08, Math.PI / 2 + .035);
      const limb = this.cylinder("broken-limb", r, { diameterTop: .12, diameterBottom: .35, height: 1.9, tessellation: 11 }, [.5, .55, .13], "log-bark");
      limb.rotation.set(.16, .54, Math.PI / 2 - .23);
      for (const [x, z] of [[-1.8, -.43], [1.62, .33]] as const) this.roughRock("nesting-rock", r, .34, 1200 + x, "obstacle-rock", [x, .13, z]);
      if (vine) {
        const radius = (y: number) => .43 - (y / 4.72 + .5) * .095;
        this.addVine(trunk, 4.3, radius, 2.4, .4, random);
        this.addVine(trunk, 3.2, radius, 1.7, 3.1, random);
        this.addVine(limb, 1.5, y => .14 - y * .06, 1.2, 1, random);
      }
      if (mushrooms) {
        // Toadstools on top of the log, a cluster at its foot, and shelf fungus on the side facing the runner.
        for (const [x, z, size, red] of [[-1.45, .06, 1.05, true], [-1.2, -.12, .72, true], [.3, .14, .9, false], [.52, -.04, .62, false], [1.5, .08, .86, true]] as const) this.addMushroom(r, x, .8, z, size, red, random);
        for (const [x, z, size] of [[-2.25, -.55, .8], [-2.05, -.7, .55], [2.3, .6, .7]] as const) this.addMushroom(r, x, -.02, z, size, false, random);
        for (const [x, y, size] of [[-.7, .45, 1], [-.48, .33, .7], [.95, .52, .85]] as const) {
          const shelf = MeshBuilder.CreateSphere("shelf-fungus", { diameter: .46 * size, segments: 10, slice: .5 }, this.scene);
          shelf.parent = r; shelf.position.set(x, y, -.4); shelf.scaling.set(1, .42, .62); shelf.material = this.mats["shelf-fungus"];
        }
      }
    }, true);
    for (const vine of [false, true]) make(vine ? "block-wide-vine" : "block-wide", r => {
      const random = seeded(229);
      for (const [index, [z, y, length, thick, angle]] of ([[0, .55, W + .75, 1.08, .03], [-.62, .28, W - 1.5, .45, -.065], [.60, .25, W - 3.2, .39, .10]] as const).entries()) {
        const log = this.fallenLog("fallen-log", r, length, thick, [0, y, z]);
        log.rotation.z = Math.PI / 2 + angle; log.rotation.y = z * .17;
        if (vine && index === 0) {
          const radius = (at: number) => thick / 2 - (at / length + .5) * thick * .11;
          this.addVine(log, length * .9, radius, 3.4, .2, random);
          this.addVine(log, length * .6, radius, 2.2, 2.6, random);
        }
      }
      for (const [x, z, tilt, length] of [[-2.5, .1, -.53, .78], [-.8, -.38, .52, .46], [1.55, .20, -.71, .62]] as const) {
        const branch = this.cylinder("broken-branch", r, { diameterTop: .055, diameterBottom: .23, height: length, tessellation: 10 }, [x, .94, z], "log-bark");
        branch.rotation.set(.28, 0, tilt);
      }
      for (const x of [-3.2, 3.1]) this.roughRock("log-end-rock", r, .36, 1210 + x, "obstacle-rock", [x, .15, .55]);
    }, true);
    const flameMaterial = new StandardMaterial("runner-fire-volume", this.scene);
    flameMaterial.diffuseTexture = this.texture("/assets/runner/flame-v2.png");
    flameMaterial.diffuseTexture.hasAlpha = true;
    flameMaterial.useAlphaFromDiffuseTexture = true; flameMaterial.disableLighting = true;
    flameMaterial.emissiveColor = Color3.White(); flameMaterial.backFaceCulling = false;
    flameMaterial.transparencyMode = StandardMaterial.MATERIAL_ALPHATESTANDBLEND;
    flameMaterial.alphaCutOff = .08;
    for (const [scene, { id }] of RUN_SCENES.entries()) {
      const at = scene === 0 ? "" : `@${id}`;
      make(`beam${at}`, r => this.barrier(r, scene), true);
      make(`beam-wide${at}`, r => this.gate(r, scene), true);
      make(`boulder${at}`, r => this.boulder(r, scene), true);
      make(`spikes-double${at}`, r => this.debris(r, scene), true);
      // Flames flicker, trapdoor planks swing open and long pits stretch their banks apart, so these keep their parts.
      make(`fire-double${at}`, r => this.campfire(r, scene, flameMaterial));
      make(`trap-double${at}`, r => this.trapdoor(r, scene));
      for (const [name, width] of [["gap", L], ["gap-wide", W], ["long-gap-wide", W]] as const) make(`${name}${at}`, r => this.fissure(r, scene, name, width));
      if (scene >= 2) for (const wide of [false, true]) make(`block-${wide ? "wide" : "double"}${at}`, r => this.logPile(r, scene, wide), true);
    }
    make("cart-block-double", r => {
      for (let i = 0; i < 6; i++) this.roughRock("mine-rockfall", r, .45 + i % 3 * .14, 1220 + i, "obstacle-rock", [(i - 2.5) * .74, .44 + i % 3 * .14, Math.sin(i * 2) * .43]);
      this.box("rockfall-crossbar", r, [4.35, .23, .27], [0, .9, -.72], "wood");
      for (const x of [-1.92, 1.92]) this.box("rockfall-marker", r, [.23, .24, .15], [x, .93, -.895], "warning");
    }, true);
    make("bridge-branch-wide", r => {
      const branch = this.fallenLog("bridge-cross-branch", r, 1.93, .63, [0, .30, 0]);
      branch.rotation.set(.10, -.14, 1.40);
      this.addVine(branch, 1.7, y => .315 - (y / 1.93 + .5) * .07, 1.3, .8, seeded(233));
    }, true);
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
      if (kind === "fruit") continue;
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

  /** Folds a template's static parts into one mesh per material; billboards (lamp halos) stay separate. */
  private mergeByMaterial(root: TransformNode) {
    const meshes = root.getChildMeshes(false).filter((mesh): mesh is Mesh => mesh instanceof Mesh && mesh.billboardMode === Mesh.BILLBOARDMODE_NONE);
    for (const mesh of meshes) mesh.setParent(root);
    const groups = new Map<unknown, Mesh[]>();
    for (const mesh of meshes) { const list = groups.get(mesh.material); if (list) list.push(mesh); else groups.set(mesh.material, [mesh]); }
    for (const [material, list] of groups) {
      if (list.length < 2) continue;
      const merged = Mesh.MergeMeshes(list, true, true);
      if (!merged) continue;
      merged.name = `${root.name}-part`; merged.parent = root; merged.material = material as StandardMaterial; merged.isPickable = false;
    }
    // Pivots used while building are empty now.
    for (const node of root.getDescendants(false)) if (node.getClassName() === "TransformNode" && (node as TransformNode).getChildMeshes(false).length === 0) node.dispose();
  }

  /** A creeper wound round a log, with leaves, in the log's own frame (its axis along local Y). */
  private addVine(parent: TransformNode, length: number, radius: (y: number) => number, turns: number, phase: number, random: () => number) {
    const steps = Math.ceil(turns * 22), path: Vector3[] = [];
    for (let i = 0; i <= steps; i++) {
      const t = i / steps, y = (t - .5) * length, angle = phase + t * turns * Math.PI * 2, r = radius(y) + .03;
      path.push(new Vector3(Math.cos(angle) * r, y, Math.sin(angle) * r));
    }
    const stem = MeshBuilder.CreateTube("vine", { path, radius: .026, tessellation: 6 }, this.scene);
    stem.parent = parent; stem.material = this.mats.vine; stem.isPickable = false;
    for (let i = 1; i < path.length - 1; i += 2) {
      const p = path[i], out = Math.atan2(p.x, p.z);
      const leaf = MeshBuilder.CreateSphere("vine-leaf", { diameter: .22, segments: 4 }, this.scene);
      leaf.parent = parent; leaf.material = this.mats["vine-leaf"]; leaf.isPickable = false;
      // Flat against the bark: thin along the outward direction.
      leaf.position.set(p.x * 1.08, p.y + (random() - .5) * .08, p.z * 1.08);
      leaf.rotation.set(0, out, (random() - .5) * 1.4);
      leaf.scaling.set(.8 + random() * .5, .5 + random() * .3, .18);
    }
  }

  private addMushroom(parent: TransformNode, x: number, y: number, z: number, size: number, red: boolean, random: () => number) {
    const stem = .2 * size, lean = (random() - .5) * .3;
    const foot = new TransformNode("mushroom", this.scene); foot.parent = parent; foot.position.set(x, y, z); foot.rotation.set(lean, 0, (random() - .5) * .3);
    this.cylinder("mushroom-stem", foot, { diameterTop: .065 * size, diameterBottom: .095 * size, height: stem, tessellation: 8 }, [0, stem / 2, 0], "mushroom-stem");
    const cap = MeshBuilder.CreateSphere("mushroom-cap", { diameter: .34 * size, segments: 10, slice: .5 }, this.scene);
    cap.parent = foot; cap.position.y = stem - .015 * size; cap.scaling.y = .72; cap.material = this.mats[red ? "mushroom-cap" : "mushroom-brown"]; cap.isPickable = false;
    const gills = MeshBuilder.CreateDisc("mushroom-gills", { radius: .165 * size, tessellation: 12 }, this.scene);
    gills.parent = foot; gills.position.y = stem - .016 * size; gills.rotation.x = -Math.PI / 2; gills.material = this.mats["mushroom-stem"]; gills.isPickable = false;
    if (!red) return;
    for (let i = 0; i < 6; i++) {
      const around = i * 1.1 + random(), up = .35 + random() * .8, r = .17 * size;
      const spot = MeshBuilder.CreateSphere("mushroom-spot", { diameter: (.035 + random() * .025) * size, segments: 4 }, this.scene);
      spot.parent = foot; spot.material = this.mats["mushroom-spot"]; spot.isPickable = false;
      spot.position.set(Math.cos(around) * Math.sin(up) * r, cap.position.y + Math.cos(up) * r * .72, Math.sin(around) * Math.sin(up) * r);
    }
  }

  private lampPost(r: TransformNode, snowy: boolean) {
    for (const s of [-1, 1]) {
      const x = s * (ROAD_HALF + .55), lx = x - s * .74;
      this.box("lamp-base", r, [.5, .36, .5], [x, .14, 0], "stone-dark");
      this.box("lamp-plinth", r, [.34, .14, .34], [x, .39, 0], "lamp-iron");
      this.cylinder("lamp-pole", r, { diameterBottom: .17, diameterTop: .1, height: 3.9, tessellation: 10 }, [x, 2.4, 0], "lamp-iron");
      for (const y of [1.25, 3.15]) {
        const collar = MeshBuilder.CreateTorus("lamp-collar", { diameter: .16, thickness: .05, tessellation: 12 }, this.scene);
        collar.parent = r; collar.position.set(x, y, 0); collar.material = this.mats["lamp-iron"];
      }
      const knob = MeshBuilder.CreateSphere("lamp-knob", { diameter: .15, segments: 8 }, this.scene);
      knob.parent = r; knob.position.set(x, 4.38, 0); knob.material = this.mats["lamp-iron"];
      // A curved bracket: the arm out over the road edge and a brace under it.
      const arm = this.cylinder("lamp-arm", r, { diameter: .06, height: .8, tessellation: 6 }, [x - s * .38, 4.25, 0], "lamp-iron");
      arm.rotation.z = Math.PI / 2;
      const brace = this.cylinder("lamp-brace", r, { diameter: .045, height: .74, tessellation: 6 }, [x - s * .27, 4.0, 0], "lamp-iron");
      brace.rotation.z = s * Math.atan2(.55, .5);
      const scroll = MeshBuilder.CreateTorus("lamp-scroll", { diameter: .2, thickness: .03, tessellation: 12 }, this.scene);
      scroll.parent = r; scroll.position.set(x - s * .14, 4.1, 0); scroll.rotation.x = Math.PI / 2; scroll.material = this.mats["lamp-iron"];
      // Hexagonal lantern hanging from the arm.
      this.cylinder("lamp-hook", r, { diameter: .03, height: .16, tessellation: 4 }, [lx, 4.16, 0], "lamp-iron");
      this.cylinder("lamp-roof", r, { diameterTop: .05, diameterBottom: .46, height: .2, tessellation: 6 }, [lx, 3.99, 0], "lamp-iron");
      this.cylinder("lamp-rim", r, { diameter: .37, height: .05, tessellation: 6 }, [lx, 3.87, 0], "lamp-iron");
      this.cylinder("lamp-glass", r, { diameterTop: .34, diameterBottom: .25, height: .38, tessellation: 6 }, [lx, 3.66, 0], "lamp");
      this.cylinder("lamp-sill", r, { diameter: .28, height: .05, tessellation: 6 }, [lx, 3.45, 0], "lamp-iron");
      this.cylinder("lamp-drop", r, { diameterTop: .2, diameterBottom: 0, height: .14, tessellation: 6 }, [lx, 3.36, 0], "lamp-iron");
      if (snowy) {
        this.cylinder("lamp-snow", r, { diameterTop: .05, diameterBottom: .4, height: .09, tessellation: 6 }, [lx, 4.08, 0], "snow");
        this.box("lamp-base-snow", r, [.54, .08, .54], [x, .35, 0], "snow");
        this.box("lamp-arm-snow", r, [.7, .035, .08], [x - s * .4, 4.29, 0], "snow");
      }
      const halo = MeshBuilder.CreatePlane("halo", { size: 2.5 }, this.scene); halo.parent = r; halo.position.set(lx, 3.66, 0); halo.material = this.mats["lamp-halo"]; halo.billboardMode = Mesh.BILLBOARDMODE_ALL;
    }
  }

  /** Two thickets of leaning bamboo canes, one each side, with ringed nodes and leaf crowns. */
  private bambooClump(r: TransformNode, seed: number) {
    const random = seeded(seed);
    for (const s of [-1, 1]) {
      const cx = s * (ROAD_HALF + 3.4 + random() * 2.4), cz = (random() - .5) * 1.6;
      for (let i = 0, canes = 6 + Math.floor(random() * 3); i < canes; i++) {
        const height = 8 + random() * 5.5, d = .12 + random() * .09;
        const cane = new TransformNode("bamboo-cane", this.scene); cane.parent = r;
        cane.position.set(cx + (random() - .5) * 2.6, -.35, cz + (random() - .5) * 2.6);
        cane.rotation.set((random() - .5) * .14, 0, -s * (.03 + random() * .1));
        this.cylinder("bamboo-stalk", cane, { diameter: d, height, tessellation: 8 }, [0, height / 2, 0], "bamboo");
        for (let y = .5 + random() * .4; y < height - .3; y += .8 + random() * .35) this.cylinder("bamboo-ring", cane, { diameter: d * 1.18, height: .05, tessellation: 8 }, [0, y, 0], "bamboo-node");
        for (let k = 0; k < 3; k++) {
          const crown = MeshBuilder.CreatePlane("bamboo-crown", { size: 2.4 + random() * 1.3 }, this.scene);
          crown.parent = cane; crown.material = this.mats["bamboo-leaves"];
          crown.position.set((random() - .5) * .5, height * (.6 + k * .14), (random() - .5) * .5);
          crown.rotation.set((random() - .5) * .3, k * Math.PI / 3 + random(), 0);
        }
      }
      // Young shoots and fallen leaves on the ground.
      for (let k = 0; k < 2; k++) {
        const shoot = this.cylinder("bamboo-shoot", r, { diameterTop: 0, diameterBottom: .22, height: .5 + random() * .4, tessellation: 6 }, [cx + (random() - .5) * 2, -.1, cz + (random() - .5) * 2], "bamboo-node");
        shoot.rotation.z = (random() - .5) * .3;
      }
    }
  }

  private cactusPatch(r: TransformNode, random: () => number) {
    for (const s of [-1, 1]) {
      const x = s * (ROAD_HALF + 2.8 + random() * 3.5), z = (random() - .5) * 2.4, height = 2.4 + random() * 1.6;
      this.cylinder("cactus-trunk", r, { diameter: .46, height, tessellation: 12 }, [x, height / 2 - .35, z], "cactus");
      const top = MeshBuilder.CreateSphere("cactus-top", { diameter: .46, segments: 8 }, this.scene);
      top.parent = r; top.position.set(x, height - .35, z); top.material = this.mats.cactus;
      for (const side of random() < .5 ? [-1, 1] : [s]) {
        const elbow = height * (.35 + random() * .2) - .35, reach = .55, rise = .7 + random() * .5;
        const arm = this.cylinder("cactus-arm", r, { diameter: .28, height: reach, tessellation: 10 }, [x + side * reach / 2, elbow, z], "cactus");
        arm.rotation.z = Math.PI / 2;
        this.cylinder("cactus-arm-up", r, { diameter: .28, height: rise, tessellation: 10 }, [x + side * reach, elbow + rise / 2, z], "cactus");
        const tip = MeshBuilder.CreateSphere("cactus-arm-top", { diameter: .28, segments: 6 }, this.scene);
        tip.parent = r; tip.position.set(x + side * reach, elbow + rise, z); tip.material = this.mats.cactus;
      }
      for (let k = 0; k < 2; k++) {
        const flower = MeshBuilder.CreateSphere("cactus-flower", { diameter: .11, segments: 5 }, this.scene);
        flower.parent = r; flower.position.set(x + (k - .5) * .14, height - .16, z + (random() - .5) * .1); flower.material = this.mats["cactus-flower"];
      }
      const barrel = MeshBuilder.CreateSphere("barrel-cactus", { diameter: .55, segments: 8 }, this.scene);
      barrel.parent = r; barrel.position.set(x - s * 1.1, -.15, z + 1); barrel.scaling.y = .8; barrel.material = this.mats.cactus;
    }
  }

  /** Spruce in snow: stacked cones, each with a snow cap over its top. */
  private snowPine(r: TransformNode, x: number, z: number, scale: number) {
    this.cylinder("pine-trunk", r, { diameter: .38 * scale, height: 1.6 * scale, tessellation: 8 }, [x, -.35 + .8 * scale, z], "pine-trunk");
    for (const [d, h, y] of [[3.4, 2.4, 1.6], [2.8, 2.2, 2.7], [2.2, 2, 3.8], [1.5, 1.8, 4.85], [.8, 1.3, 5.75]] as const) {
      const at = -.35 + y * scale;
      this.cylinder("pine-tier", r, { diameterTop: 0, diameterBottom: d * scale, height: h * scale, tessellation: 10 }, [x, at, z], "pine");
      this.cylinder("pine-snow", r, { diameterTop: 0, diameterBottom: d * .8 * scale, height: h * .6 * scale, tessellation: 10 }, [x, at + h * .22 * scale, z], "snow");
    }
  }

  private snowman(r: TransformNode, x: number, z: number) {
    const face = Math.atan2(-1, -.6), fx = Math.sin(face), fz = Math.cos(face);
    for (const [d, y] of [[1.35, .45], [.98, 1.4], [.68, 2.13]] as const) {
      const ball = MeshBuilder.CreateSphere("snowman-ball", { diameter: d, segments: 14 }, this.scene);
      ball.parent = r; ball.position.set(x, y, z); ball.material = this.mats.snow;
    }
    const dot = (name: string, y: number, ahead: number, across: number, d: number, material: string) => {
      const ball = MeshBuilder.CreateSphere(name, { diameter: d, segments: 6 }, this.scene);
      ball.parent = r; ball.material = this.mats[material];
      ball.position.set(x + fx * ahead + fz * across, y, z + fz * ahead - fx * across);
    };
    for (const side of [-1, 1]) dot("snowman-eye", 2.22, .3, side * .11, .075, "coal");
    for (const y of [1.2, 1.45, 1.7]) dot("snowman-button", y, .47 - Math.abs(y - 1.45) * .25, 0, .085, "coal");
    const nose = this.cylinder("snowman-nose", r, { diameterTop: 0, diameterBottom: .1, height: .34, tessellation: 8 }, [x + fx * .45, 2.12, z + fz * .45], "carrot");
    nose.rotation.set(Math.PI / 2, face, 0);
    const scarf = MeshBuilder.CreateTorus("snowman-scarf", { diameter: .62, thickness: .13, tessellation: 18 }, this.scene);
    scarf.parent = r; scarf.position.set(x, 1.82, z); scarf.material = this.mats.scarf;
    this.box("snowman-scarf-tail", r, [.14, .42, .06], [x + fx * .2 + fz * .18, 1.62, z + fz * .2 - fx * .18], "scarf");
    this.cylinder("snowman-hat", r, { diameter: .42, height: .36, tessellation: 14 }, [x, 2.6, z], "coal");
    this.cylinder("snowman-brim", r, { diameter: .6, height: .04, tessellation: 14 }, [x, 2.43, z], "coal");
    for (const side of [-1, 1]) {
      const arm = this.cylinder("snowman-arm", r, { diameterTop: .02, diameterBottom: .05, height: 1, tessellation: 5 }, [x + fz * side * .75, 1.62, z - fx * side * .75], "pine-trunk");
      arm.rotation.set(0, face, side * -1.05);
    }
  }

  /** Straight on at a mine junction: the track runs on to a flooded shaft under a winding frame, then rock. Local +Z points straight on. */
  private mineShaft(r: TransformNode, signSide: number) {
    const { start, end, half, water } = SHAFT, middle = (start + end) / 2, length = end - start;
    for (const s of [-1, 1]) {
      this.box("shaft-side", r, [.5, 30, length + .5], [s * (half + .25), -15, middle], "rock");
      this.box("shaft-end", r, [half * 2 + 1, 30, .5], [0, -15, s > 0 ? end + .25 : start - .25], "rock");
      this.box("shaft-lip", r, [.35, .22, length + .6], [s * (half + .1), -.06, middle], "stone-dark");
      // Winding frame over the shaft.
      for (const z of [start + .4, end - .4]) {
        const leg = this.cylinder("headframe-leg", r, { diameter: .26, height: 7.2, tessellation: 8 }, [s * (half + .45), 3.3, (z + middle) / 2], "wood");
        leg.rotation.x = Math.atan2(middle - z, 6.7);
      }
    }
    this.box("headframe-beam", r, [half * 2 + 1.6, .4, .4], [0, 6.75, middle], "wood");
    const wheel = MeshBuilder.CreateTorus("headframe-wheel", { diameter: 1.3, thickness: .1, tessellation: 20 }, this.scene);
    wheel.parent = r; wheel.position.set(0, 6.2, middle); wheel.rotation.z = Math.PI / 2; wheel.material = this.mats.metal;
    this.cylinder("headframe-rope", r, { diameter: .05, height: 12, tessellation: 5 }, [0, .2, middle + .62], "zipline");
    // A lantern on each leg lights the hole so it reads from down the gallery.
    for (const s of [-1, 1]) {
      this.cylinder("headframe-lantern", r, { diameterTop: .3, diameterBottom: .24, height: .36, tessellation: 6 }, [s * (half + .2), 3.2, start + .2], "lamp");
      this.cylinder("headframe-lantern-roof", r, { diameterTop: .04, diameterBottom: .4, height: .16, tessellation: 6 }, [s * (half + .2), 3.46, start + .2], "lamp-iron");
      const halo = MeshBuilder.CreatePlane("halo", { size: 2.6 }, this.scene); halo.parent = r; halo.position.set(s * (half + .2), 3.2, start + .2); halo.material = this.mats["lamp-halo"]; halo.billboardMode = Mesh.BILLBOARDMODE_ALL;
    }
    const flood = MeshBuilder.CreateGround("shaft-water", { width: half * 2, height: length }, this.scene);
    flood.parent = r; flood.position.set(0, -water, middle); flood.material = this.mats["pit-water-long"];
    // One rail has buckled down into the hole; boards hang off the near lip.
    const bent = this.box("shaft-rail-bent", r, [.1, .1, 2], [.55, -.75, start + .55], "rail");
    bent.rotation.x = .95;
    for (const [x, pitch, roll, width] of [[-1.6, 1.1, .15, 1.8], [.9, 1.35, -.2, 1.4], [2.4, .8, .1, 1.1]] as const) {
      const board = this.box("shaft-board", r, [width, .1, 1.3], [x, -.55, start + .35], "wood");
      board.rotation.set(pitch, 0, roll);
    }
    const signX = signSide * (half + 1.3);
    this.box("shaft-sign-post", r, [.18, 2.3, .18], [signX, 1.1, start - 1.2], "wood");
    this.box("shaft-sign-back", r, [1.86, .98, .08], [signX, 1.78, start - 1.14], "wood");
    const board = MeshBuilder.CreatePlane("shaft-sign", { width: 1.72, height: .86 }, this.scene);
    board.parent = r; board.position.set(signX, 1.78, start - 1.2); board.material = this.mats["shaft-sign"];
    // The gallery ends in rock beyond the shaft.
    this.box("shaft-back", r, [half * 2 + 12, 14, 2], [0, 5, end + 4], "rock");
    const random = seeded(163);
    for (let k = 0; k < 6; k++) {
      const lump = MeshBuilder.CreatePolyhedron("shaft-back-rock", { type: k % 2 ? 1 : 2, size: .9 + random() }, this.scene);
      lump.parent = r; lump.material = this.mats["obstacle-rock"];
      lump.position.set((random() - .5) * (half * 2 + 8), random() * 8, end + 3); lump.scaling.set(1, 1, .5);
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
    for (let i = 0; i < SLOTS; i++) {
      const root = new TransformNode(`road-slot-${i}`, this.scene);
      // Babylon billboards ignore the parent's rotation, including when placing local offsets.
      const trees = [treePlane.clone(`runner-tree-${i}-left`), treePlane.clone(`runner-tree-${i}-right`)];
      for (const tree of trees) tree.setEnabled(false);
      const themes: TransformNode[] = [], lanes: RoadLane[][] = [], decor: Decor[] = [];
      RUN_SCENES.forEach(({ id }, t) => {
        const group = new TransformNode(`slot-${i}-${id}`, this.scene); group.parent = root; themes.push(group);
        lanes.push([0, 1, 2].map(lane => {
          const main = this.instance(`lane-${id}`, group);
          main.position.x = (lane - 1) * LANE_WIDTH;
          return { main };
        }));
        for (const [name, every, offset, vary] of SCENE_DECOR[t]) decor.push({ node: this.instance(name, group), every, offset, vary: !!vary });
        group.setEnabled(false);
      });
      const ores = [-1, 1].map(side => {
        const ore = MeshBuilder.CreatePlane("mine-ore-vein", { size: 1 }, this.scene);
        ore.parent = themes[2]; ore.rotation.y = side * 1.15; ore.isPickable = false;
        ore.setEnabled(false);
        return ore;
      });
      this.slots.push({ n: Number.NaN, root, themes, lanes, trees, ores, decor, theme: -1, holes: [undefined, undefined, undefined], pierCut: false, crossingGap: false, forkCut: false });
    }
  }

  private placeTrees(slot: Slot, at: number, turns: readonly RunTurn[]) {
    const { n, theme } = slot;
    const grove = GROVES[theme];
    // No trees standing in the sea round the log bridge.
    const bridge = sectionFeature(at);
    const offshore = bridge?.kind === "bridge" && at > bridge.start - 3 && at < bridge.end + 3;
    for (const [i, tree] of slot.trees.entries()) {
      const offset = i === 0 ? 0 : theme === 2 ? 1 : 2;
      if (n <= 0 || offshore || !grove.trees.length || (n + offset) % grove.spacing !== 0) { tree.setEnabled(false); continue; }
      const variant = (Math.floor((n + offset) / grove.spacing) + i) % grove.trees.length;
      const style = grove.trees[variant];
      const variation = (Math.imul(n + 13 * i, 2654435761) >>> 0) / 0x100000000;
      const height = style.height * (.88 + variation * .24);
      const material = this.mats[`tree-${style.name}`];
      const size = material.diffuseTexture!.getBaseSize();
      const width = height * (size.height > 0 ? size.width / size.height : .7);
      const distance = at + (variation - .5) * 1.8;
      const turnClearance = Math.max(18, CORNER_RADIUS + TILE_DEPTH / 2 + width / 2);
      if (turns.some(turn => Math.abs(turn.z - distance) < turnClearance)) { tree.setEnabled(false); continue; }
      const side = i === 0 ? -1 : 1;
      const setback = theme === 2 ? MINE_WALL - .3 : ROAD_HALF + width / 2 + 1.2 + variation * 3.2;
      const point = this.place(distance, side * setback);
      // Mine roots follow the wall, so their edges cannot pivot into the track.
      tree.billboardMode = theme === 2 ? Mesh.BILLBOARDMODE_NONE : Mesh.BILLBOARDMODE_Y;
      tree.rotation.y = theme === 2 ? point.heading + Math.PI / 2 : 0;
      tree.material = material;
      tree.scaling.set(side * width, height, 1);
      tree.position.set(point.x, grove.ground + height * .486 + (theme === 2 ? point.y : 0), point.z);
      tree.setEnabled(true);
    }
  }

  /** A dorsal fin that breaks the surface, a dark shape under it and a little wake. */
  private buildShark() {
    const root = new TransformNode("runner-shark", this.scene);
    // A little larger than life, so it reads from the log at a glance.
    const fin = MeshBuilder.CreateCylinder("shark-fin", { diameterTop: 0, diameterBottom: 1.5, height: 1.35, tessellation: 3 }, this.scene);
    fin.parent = root; fin.material = this.mats.shark; fin.scaling.set(.14, 1, 1.05); fin.rotation.x = -.42; fin.isPickable = false;
    const tail = MeshBuilder.CreateCylinder("shark-tail", { diameterTop: 0, diameterBottom: .8, height: .7, tessellation: 3 }, this.scene);
    tail.parent = fin; tail.material = this.mats.shark; tail.position.set(0, -.3, -2.7); tail.rotation.x = -.5; tail.isPickable = false;
    const shadow = MeshBuilder.CreateGround("shark-shadow", { width: 2.4, height: 6.2 }, this.scene);
    shadow.parent = root; shadow.position.set(0, .03, -.6); shadow.material = this.mats["shark-shadow"]; shadow.isPickable = false;
    const wake = MeshBuilder.CreateGround("shark-wake", { width: 2.4, height: 3.6 }, this.scene);
    wake.parent = root; wake.position.set(0, .05, .2); wake.material = this.mats.wake; wake.isPickable = false;
    root.setEnabled(false);
    this.shark = { root, fin, shadow, wake, z: 0, side: 1, lateral: 7, age: 0, wait: 2, active: false };
  }

  /** Now and then a shark surfaces in the sea beside the log bridge, slips past the dog and sinks again. */
  private drawShark(world: RunnerWorld, dt: number) {
    const shark = this.shark, bridge = world.bridge, running = world.phase === "running";
    if (!shark.active) {
      shark.root.setEnabled(false);
      if (!bridge || !running) return;
      shark.wait -= dt;
      const z = world.distance + 16 + Math.random() * 14;
      if (shark.wait > 0 || z > bridge.end - 35) return;
      Object.assign(shark, { active: true, age: 0, z, side: Math.random() < .5 ? -1 : 1, lateral: 4.5 + Math.random() * 3 });
    }
    if (running) shark.age += dt;
    if (shark.age >= SHARK_SECONDS || (!bridge && running)) {
      shark.active = false; shark.wait = 3 + Math.random() * 4; shark.root.setEnabled(false);
      return;
    }
    // It cruises the same way as the dog, a little slower, so the dog overtakes it.
    if (running) shark.z += world.speed * .78 * dt;
    const rise = Math.max(0, Math.min(1, shark.age / .9, (SHARK_SECONDS - shark.age) / 1.1)), shown = rise * rise * (3 - 2 * rise);
    const weave = Math.sin(shark.age * 1.7) * .6, p = this.place(shark.z, shark.side * shark.lateral + weave);
    shark.root.position.set(p.x, SEA_Y, p.z);
    shark.root.rotation.y = p.heading + Math.cos(shark.age * 1.7) * .16;
    shark.fin.position.y = -.95 + shown * 1.25;
    this.mats["shark-shadow"].alpha = .62 * shown;
    this.mats.wake.alpha = .6 * shown;
    shark.root.setEnabled(true);
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
    return { ...p, x: p.x + Math.cos(p.heading) * lateral, z: p.z - Math.sin(p.heading) * lateral };
  }

  private roadPitch(distance: number, half = .75) {
    return -Math.atan2(elevationAt(distance + half) - elevationAt(distance - half), half * 2);
  }
  /** Road centre under the dog: straight on into the corner until the turn is actually taken. */
  private dogCentre(world: RunnerWorld): RoutePoint {
    const wrong = world.wrongTurn;
    if (wrong) {
      // The trap side is level with the corner plaza.
      const point = wrong.wrong === "straight" ? this.route.straight(world.distance, wrong.z) : this.route.branch(world.distance, wrong.z, wrong.direction === "left" ? "right" : "left");
      if (point) return { ...point, y: elevationAt(Math.min(world.distance, wrong.z)) };
    }
    const turn = world.approachingTurn;
    if (turn && !turn.taken && world.distance > turn.z - CORNER_RADIUS) return this.route.straight(world.distance, turn.z) ?? this.route.sample(world.distance);
    return this.route.sample(world.distance);
  }

  /** Height of the water the dog falls into. */
  private fallSurface(world: RunnerWorld, obstacle: RunItem) {
    const wrong = world.wrongTurn;
    switch (obstacle.feature) {
      case "rope": return sceneAt(obstacle.z) === 0 ? -7 : GORGE_Y;
      case "bridge": return SEA_Y;
      case "fork":
        if (wrong?.wrong === "straight") return elevationAt(wrong.z) - SHAFT.water;
        if (wrong?.bridge) return SEA_Y;
        return sceneAt(wrong?.z ?? obstacle.z) === 0 ? -7 : BRIDGE_WATER_Y;
      default: return elevationAt(obstacle.z) - waterDepth(obstacle.kind);
    }
  }

  // ---------- per frame ----------

  draw(world: RunnerWorld) {
    if (this.disposed) return;
    const now = performance.now() / 1000, dt = this.lastTime ? Math.min(.1, now - this.lastTime) : 0;
    this.lastTime = now;
    if (this.lastWorld !== world) this.reset(world);
    this.route.sync(world.turns, world.distance);

    const theme = world.sceneIndex, look = this.themes[theme], night = world.night;
    const weather = world.weather; // already sunny underground and snowing on the snowfield
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
    const wrong = world.wrongTurn;
    if (wrong && this.seen.wrong !== wrong.z) {
      // Same blend for a late press toward the broken side of a fork. Running on straight needs none.
      this.seen.wrong = wrong.z;
      const late = wrong.wrong === "side" && world.distance > wrong.z - CORNER_RADIUS;
      const straight = late ? this.route.straight(world.distance, wrong.z) : undefined;
      const bend = straight && this.route.branch(world.distance, wrong.z, wrong.direction === "left" ? "right" : "left");
      if (straight && bend) { this.turnBlend.x += straight.x - bend.x; this.turnBlend.z += straight.z - bend.z; }
    }
    const decay = Math.exp(-dt * 9); this.turnBlend.x *= decay; this.turnBlend.z *= decay;
    const centre = this.dogCentre(world);
    centre.x += this.turnBlend.x; centre.z += this.turnBlend.z;
    const lateral = (world.position - 1) * LANE_WIDTH * rideLateralScale(world.distance, world.ride);
    const rx = Math.cos(centre.heading), rz = -Math.sin(centre.heading), fx = Math.sin(centre.heading), fz = Math.cos(centre.heading);
    const player = new Vector3(centre.x + rx * lateral, centre.y, centre.z + rz * lateral);
    this.drawRides(world, player, centre, lateral);

    const falling = world.trapFall && capture;
    const grab = capture && !falling ? captureMotion(world.captureTime, this.settings.reducedMotion) : undefined;
    const pose = dogPose(world, this.settings.reducedMotion, falling);
    const fall = dogFall(world, this.settings.reducedMotion);
    if (this.schoolSheet) {
      let frame = pose.sheet === "run" ? Math.floor(pose.frame / 2) : 4 + pose.frame;
      if (falling && world.captureTime > .06) frame = fall.frame >= 4 ? 7 : 6;
      else if (!capture && world.airborne && world.jumpCount === 2) frame = 6;
      // Monash has front-facing action art as well as the rear views that show TRX.
      if (this.dogLook === "qs031" && frame >= 5 && (!grab || grab.orbit < .65)) frame -= 4;
      this.dog.frame(this.schoolSheet, frame, 4, 2);
    } else if (falling && world.captureTime > .045) {
      this.dog.frame(this.sheets.fall!, fall.frame, 4, 2);
    } else if (world.ride?.kind === "cart" && !capture) {
      this.dog.frame(this.sheets.cart!, 0, 1, 1);
    } else {
      this.dog.frame(this.sheets[pose.sheet]!, pose.frame, 4, 2);
    }
    const bike = world.cycling && !capture;
    const lift = bike ? this.drawBike(world, player, centre.heading) : 0;
    this.bicycle.setEnabled(bike);
    const rope = world.ride?.kind === "rope" ? world.ride : undefined;
    const release = rope ? ropeReleaseProgress(world.distance, rope) : 0;
    // Squash on touchdown (rope release or any jump), stretch just after take-off.
    const animate = !this.settings.reducedMotion && !capture;
    const land = animate ? Math.max(0, 1 - (world.elapsed - world.ropeLandedAt) / .16, 1 - (world.elapsed - world.landedAt) / .14) : 0;
    const takeoff = animate && world.airborne ? Math.max(0, 1 - (world.elapsed - world.jumpedAt) / .18) : 0;
    const squash = (pose.sheet === "actions" && pose.frame === 3 ? .1 : 0) + land * .08;
    this.dog.root.position.set(player.x + fx * fall.forward, player.y + DOG_SIZE * DOG_FEET + world.jumpHeight + lift - squash - fall.drop, player.z + fz * fall.forward);
    const roll = this.schoolSheet ? fall.roll : fall.roll * .66;
    const motion = !capture && !this.settings.reducedMotion;
    const swing = rope ? -lateral * .11 * (1 - release) + Math.sin(Math.PI * release) * .17 : 0;
    // Lean into lane changes: a little on foot, more on a ride or the bicycle.
    const lean = motion ? (world.lane - world.position) * (world.ride || bike ? .13 : .07) + swing : 0;
    this.dog.root.rotation.set(0, 0, roll * (lateral > 0 ? -1 : 1) + lean);
    this.dog.root.billboardMode = grab ? Mesh.BILLBOARDMODE_NONE : Mesh.BILLBOARDMODE_Y;
    this.dog.root.scaling.set(1 + land * .06 - takeoff * .05, 1 - land * .10 + takeoff * .09, 1);
    this.dog.material.alpha = 1;
    if (falling && world.fallObstacle) {
      const surface = this.fallSurface(world, world.fallObstacle);
      const below = surface - player.y - world.jumpHeight + fall.drop;
      this.dog.material.alpha = Math.min(1, Math.max(0, (1.35 - below) / .45));
      if (!this.waterImpact && below > .28 && world.phase === "caught") {
        this.waterImpact = true;
        if (!this.settings.reducedMotion) {
          this.burst(this.magic, new Vector3(this.dog.root.position.x, surface + .08, this.dog.root.position.z), 12, ["#d7eeee", "#416e72"]);
        }
      }
    }
    this.dog.root.setEnabled(this.dog.material.alpha > 0);
    this.skinHalo.setEnabled((world.fruit > 0 || this.dogLook !== "original") && !capture && !world.ride);
    if (this.skinHalo.isEnabled()) {
      const hue = Color3.FromHexString(world.fruit > 0 ? "#ffcf41" : getDogLook(this.dogLook).color);
      (this.skinHalo.material as StandardMaterial).emissiveColor.copyFrom(hue);
      this.skinHalo.position.set(player.x, player.y + .08 + world.jumpHeight + lift, player.z);
      this.skinHalo.scaling.setAll(1 + Math.sin(t * 5) * .07);
    }
    const overGap = world.items.some(gap => (gap.kind === "gap" || gap.kind === "long-gap") && Math.abs(gap.z - world.distance) < obstacleHalfDepth(gap.kind, gap.z) && coversLane(gap, world.position, .6));
    this.shadow.position.set(player.x, player.y + .03, player.z); this.shadow.rotation.set(this.roadPitch(world.distance), centre.heading, 0);
    this.shadow.scaling.setAll(Math.max(.4, 1 - world.jumpHeight * .25));
    this.shadow.setEnabled(!falling && !overGap && !world.ride);

    this.drawEffects(world, player, t, dt, capture, lift);

    if (!falling) this.updateCamera(world, player, centre, grab, dt, t);
    // Chaser: shown for the opening sprint and after a stumble.
    const frog = this.chaserSprite;
    const close = capture ? 1 : world.phase === "ready" ? 0 : world.danger > 0 ? Math.min(1, world.danger / 2) : Math.max(0, 1 - world.elapsed / 3.5);
    if (falling) {
      frog.root.setEnabled(false);
      this.shadow.setEnabled(false);
    } else if (!capture) {
      frog.root.billboardMode = Mesh.BILLBOARDMODE_Y;
      frog.root.rotation.setAll(0);
      frog.frame(this.sheets.walk!, chaserFrame(world, this.settings.reducedMotion), 4, 4);
      frog.root.scaling.setAll(1);
      // On the log bridge the frog follows the log's centre line instead of an empty side lane.
      const onBridge = !!world.bridge;
      const base = onBridge ? centre : player;
      // Straight behind the dog it keeps further back so it does not hide the dog from the camera.
      const side = onBridge ? 0 : world.position > 1.4 ? -1 : 1, back = onBridge ? 3.9 + (1 - close) * 3.2 : 2.4 + (1 - close) * 7;
      frog.root.position.set(base.x - fx * back + rx * side * 1.45, elevationAt(world.distance - back) + FROG_SIZE * FROG_FEET + Math.abs(Math.sin(world.gait * Math.PI * 2)) * .12, base.z - fz * back + rz * side * 1.45);
      frog.root.setEnabled(close > .02 && !world.ride && (!onBridge || world.danger > 0));
      frog.material.alpha = Math.min(1, close * 1.5);
    } else if (grab) this.drawCapture(world, player, centre.heading, grab);

    this.sky.position.set(this.camera.position.x, SKY_HEIGHT / 2 - 12, this.camera.position.z);
    const gx = Math.round(this.camera.position.x / GROUND_SNAP) * GROUND_SNAP, gz = Math.round(this.camera.position.z / GROUND_SNAP) * GROUND_SNAP;
    this.groundPlane.position.set(gx, look.groundY, gz);
    this.sea.position.set(gx, SEA_Y, gz);
    for (const [name, speed] of [["pit-water", 1], ["pit-water-long", 1], ["water", .35], ["sea", .25]] as const) {
      const water = this.mats[name].diffuseTexture as Texture;
      const drift = this.settings.reducedMotion ? 0 : t * speed;
      water.uOffset = drift * .022;
      water.vOffset = drift * .047;
    }
    this.drawShark(world, dt);
    this.drawWeather(weather, t, running && world.boost > 0, centre.heading, player.y);
    this.scene.render();
  }

  private reset(world: RunnerWorld) {
    this.route = new RunnerRoute3D();
    for (const prop of this.props.values()) prop.dispose();
    for (const corner of this.corners.values()) corner.dispose();
    for (const crossing of this.crossings.values()) crossing.dispose();
    this.props.clear(); this.corners.clear(); this.crossings.clear();
    // NaN never equals a tile number: -1 is a real tile just behind the start, and a slot marked -1 would
    // skip being placed and keep the last run's holes.
    for (const slot of this.slots) { slot.n = Number.NaN; slot.theme = -1; slot.holes.fill(undefined); }
    // The new route counts its versions from zero again, so a stale number could match and leave
    // bridges and ziplines built for an older shape of the route.
    this.routeVersion = -1; this.crossingRouteVersion = -1;
    this.lastWorld = world;
    this.lastTime = 0;
    this.fireParticleTime = 0;
    this.waterImpact = false;
    this.seen = { silver: world.silver, gold: world.gold, diamond: world.diamond, power: world.powerPicked, shield: world.shieldSaves, stumble: world.stumbles, turns: world.turnCount, wrong: world.wrongTurn?.z ?? -1 };
    this.flash = { shield: 0, power: 0 };
    this.turnBlend = { x: 0, z: 0 };
    this.camYaw = 0; this.camLateral = 0;
    this.captureCamera = undefined;
    this.cartLane = 0;
    this.shark.active = false; this.shark.wait = 2; this.shark.root.setEnabled(false);
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
    // Unlit leaf cards follow the light by hand.
    const leaves = night ? .5 : weather === "sunny" ? .92 : .78;
    this.mats["bamboo-leaves"].emissiveColor.setAll(leaves); this.mats["fern-leaves"].emissiveColor.setAll(leaves);
    this.mats.snow.emissiveColor.setAll(night ? .12 : .34); this.mats.snowfield.emissiveColor.setAll(night ? .1 : .36);
    this.groundPlane.material = look.ground;
    const skies = this.skies[theme];
    if (skies) this.skyMat.diffuseTexture = night ? skies.night : skies.day;
    this.skyMat.emissiveColor.setAll(night ? .8 : weather === "sunny" ? 1 : .78);
    this.sky.setEnabled(theme !== 2);
    this.mats["lamp-halo"].alpha = night || theme === 2 ? .9 : 0;
    for (const sign of ["fork-sign", "shaft-sign"]) this.mats[sign].emissiveColor.setAll(night ? .62 : theme === 2 ? .78 : .95);
  }

  /** Recycle slots only when the window moves; then fix up gap holes. */
  private drawRoad(world: RunnerWorld) {
    const first = Math.floor((world.distance - BEHIND) / TILE);
    const openings = world.items.flatMap(item => {
      if (!isFallObstacle(item.kind)) return [];
      const depth = obstacleHalfDepth(item.kind, item.z);
      return [{ item, start: item.z - depth, end: item.z + depth }];
    });
    // Holes in the landscape (the canal scene's ground is already water far below): the sea round the
    // log bridge, ravines under broken bridges, mine shafts, then pits in the road.
    this.groundCuts.length = 0;
    const bridge = this.bridgeNear(world);
    this.sea.setEnabled(!!bridge);
    if (bridge) this.cutSea(world, bridge);
    for (let index = sectionIndexAt(world.distance - BEHIND); index <= sectionIndexAt(world.distance + 170); index++) {
      const rope = featureOf(index);
      if (!rope || !isDownhillRope(rope) || rope.end < world.distance - BEHIND - 10 || rope.start > world.distance + 170) continue;
      this.cutGround(this.place((rope.start + rope.end) / 2), GORGE_HALF_WIDTH, (rope.end - rope.start) / 2 + 2);
    }
    if (world.sceneIndex !== 0) {
      for (const turn of world.turns) {
        if (!turn.fork || turn.bridge || turn.z < world.distance - 30 || turn.z > world.distance + 170 || sceneAt(turn.z) === 0) continue;
        const chasm = this.forkChasm(turn);
        if (chasm) this.cutGround(chasm, FORK_CHASM.half, (FORK_CHASM.end - FORK_CHASM.start) / 2);
        const shaft = turn.three ? this.junctionPoint(turn, 0, (SHAFT.start + SHAFT.end) / 2) : undefined;
        if (shaft) this.cutGround(shaft, SHAFT.half, (SHAFT.end - SHAFT.start) / 2);
      }
      for (const { item, start, end } of openings) {
        if (this.groundCuts.length >= MAX_GROUND_OPENINGS) break;
        if (end < world.distance - BEHIND || start > world.distance + 145) continue;
        const p = this.place(item.z, itemOffset(item));
        const halfWidth = item.span === 3 ? ROAD_HALF : (item.span ?? 1) * LANE_WIDTH / 2;
        const halfDepth = (end - start) / 2;
        this.cutGround(p, halfWidth, halfDepth);
      }
    }
    this.groundCuts.length = Math.min(this.groundCuts.length, MAX_GROUND_OPENINGS);
    if (this.route.version !== this.routeVersion) { this.routeVersion = this.route.version; for (const slot of this.slots) slot.n = Number.NaN; }
    for (let n = first; n < first + SLOTS; n++) {
      const slot = this.slots[((n % SLOTS) + SLOTS) % SLOTS];
      const recycled = slot.n !== n;
      const at = n * TILE + TILE / 2;
      if (recycled) {
        slot.n = n;
        const p = this.route.sample(at);
        slot.root.position.set(p.x, p.y, p.z); slot.root.rotation.set(this.roadPitch(at, TILE / 2), p.heading, 0);
        const theme = sceneAt(at);
        if (slot.theme !== theme) { slot.themes.forEach((group, i) => group.setEnabled(i === theme)); slot.theme = theme; }
        this.placeTrees(slot, at, world.turns);
        for (const [index, ore] of slot.ores.entries()) {
          const every = index === 0 ? 4 : 5, offset = index === 0 ? 1 : 2;
          const visible = theme === 2 && n >= 0 && (n + offset) % every === 0 && !this.nearFork(world, at);
          ore.setEnabled(visible);
          if (!visible) continue;
          const variant = (Math.floor((n + offset) / every) + index) % ORES.length;
          const size = 1.5 + (n % 3) * .35, side = index === 0 ? -1 : 1;
          ore.material = this.mats[ORES[variant]];
          ore.scaling.set(side * size, size, 1); ore.position.set(side * (MINE_WALL - .2), size * .46 + (variant % 2) * .6, -.42);
        }
        // Plants and rocks turn and change size from tile to tile, so the same few models never line up.
        for (const d of slot.decor) {
          if (!d.vary) continue;
          const spin = hash01(n, d.offset), size = hash01(n, d.offset + 11);
          d.node.rotation.y = (spin < .5 ? 0 : Math.PI) + (spin % .5 - .25) * .8;
          d.node.scaling.set(1, .82 + size * .36, 1);
        }
      }
      const half = TILE_DEPTH / 2;
      const section = sectionFeature(at);
      const crossing = section && section.kind !== "cart" && section.start < at + half && section.end > at - half ? section : undefined;
      const here = openings.filter(gap => gap.start < at + half && gap.end > at - half);
      const pierCut = here.length > 0;
      const forkCut = this.nearFork(world, at);
      if (recycled || pierCut !== slot.pierCut || !!crossing !== slot.crossingGap || forkCut !== slot.forkCut) {
        slot.pierCut = pierCut; slot.crossingGap = !!crossing; slot.forkCut = forkCut;
        for (const d of slot.decor) {
          const support = SUPPORTS.has(d.node.name), pier = d.node.name === "tpl-aqueduct-pier";
          // A fork opens both sides of the bend, so walls, hedges and lamps there would block the other road.
          d.node.setEnabled(!crossing && !(pierCut && support) && !(forkCut && !pier) && ((n % d.every) + d.every) % d.every === d.offset);
        }
      }
      for (let lane = 0; lane < 3; lane++) {
        const opening = here.find(gap => coversLane(gap.item, lane));
        const gap = crossing ?? opening;
        const id = crossing?.kind ?? opening?.item;
        if (!recycled && id === slot.holes[lane]) continue;
        slot.holes[lane] = id;
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

  /** Road just before and around a fork, kept open so the broken side can be seen on the way in. */
  private nearFork(world: RunnerWorld, at: number) {
    return world.turns.some(turn => turn.fork && !turn.bridge && at > turn.z - CORNER_RADIUS - 16 && at < turn.z + CORNER_RADIUS + 4);
  }

  /** The log bridge whose sea is in view, if any. */
  private bridgeNear(world: RunnerWorld) {
    for (let index = sectionIndexAt(world.distance - SEA_REACH); index <= sectionIndexAt(world.distance + 170); index++) {
      const feature = featureOf(index);
      if (feature?.kind === "bridge" && feature.start < world.distance + 170 && feature.end > world.distance - SEA_REACH - BEHIND) return feature;
    }
    return undefined;
  }

  /**
   * Opens the ground into sea along each straight leg of the log bridge. Legs meet at the bridge's
   * corners (known ones; the rest of the bridge is still straight ahead), and overlap round them.
   */
  private cutSea(world: RunnerWorld, bridge: Extract<CourseFeature, { kind: "bridge" }>) {
    const start = this.place(bridge.start), end = this.place(bridge.end);
    const corners = world.turns.filter(turn => turn.bridge && turn.z > bridge.start && turn.z < bridge.end)
      .map(turn => this.route.corner(turn.z)).filter(corner => !!corner);
    const points = [{ x: start.x, z: start.z }, ...corners.map(c => ({ x: c.x, z: c.z })), { x: end.x, z: end.z }];
    for (let i = 0; i + 1 < points.length; i++) {
      const a = points[i], b = points[i + 1], length = Math.hypot(b.x - a.x, b.z - a.z);
      if (length < .1) continue;
      const dx = (b.x - a.x) / length, dz = (b.z - a.z) / length;
      const back = i === 0 ? 0 : SEA_REACH, on = i + 2 === points.length ? 0 : SEA_REACH;
      const middle = (on - back) / 2 + length / 2;
      this.cutGround({ x: a.x + dx * middle, y: 0, z: a.z + dz * middle, heading: Math.atan2(dx, dz) }, SEA_REACH, (length + back + on) / 2);
    }
  }

  /** A point in a corner's frame: `across` towards the incoming road's right, `along` straight on. */
  private junctionPoint(turn: RunTurn, across: number, along: number): RoutePoint | undefined {
    const corner = this.route.corner(turn.z);
    if (!corner) return undefined;
    const h = corner.heading;
    return { x: corner.x + Math.sin(h) * along + Math.cos(h) * across, y: 0, z: corner.z + Math.cos(h) * along - Math.sin(h) * across, heading: h };
  }

  private cutGround(point: RoutePoint, halfWidth: number, halfDepth: number) {
    const across = Math.abs(Math.cos(point.heading)), forward = Math.abs(Math.sin(point.heading));
    const x = across * halfWidth + forward * halfDepth, z = forward * halfWidth + across * halfDepth;
    this.groundCuts.push([point.x - x, point.z - z, point.x + x, point.z + z]);
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
      // `holder` stays at the origin for parts built in world coordinates; `node` sits on the corner.
      const holder = new TransformNode(`corner-${turn.z}`, this.scene);
      const node = new TransformNode(`corner-frame-${turn.z}`, this.scene); node.parent = holder;
      node.position.set(corner.x, elevationAt(turn.z), corner.z); node.rotation.y = corner.heading;
      if (turn.bridge) this.buildBridgeCorner(holder, node, turn);
      else {
        const deck = new TransformNode(`corner-deck-${turn.z}`, this.scene);
        deck.parent = node; deck.rotation.x = this.roadPitch(turn.z);
        this.instance("plaza", deck);
        // A mine junction carries on straight to a shaft instead of ending in a wall.
        if (turn.three) this.buildShaft(deck, turn);
        else this.instance("dead-end", deck).position.z = ROAD_HALF + 1.4;
        if (turn.fork) this.buildFork(node, turn, sceneAt(turn.z));
      }
      this.corners.set(turn.z, holder);
    }
  }

  /** Straight on from a mine junction: a short run of track, then the shaft. */
  private buildShaft(deck: TransformNode, turn: RunTurn) {
    const stub = SHAFT.start - FORK_STUB_START;
    for (let i = 0; i < 3; i++) {
      const tile = this.instance(`lane-${RUN_SCENES[2].id}`, deck);
      tile.position.set((i - 1) * LANE_WIDTH, 0, FORK_STUB_START + stub / 2);
      tile.scaling.z = stub / TILE_DEPTH;
    }
    // The warning sign stands on the broken bridge's side, so it never blocks the safe way.
    this.instance(turn.direction === "left" ? "mine-shaft-right" : "mine-shaft-left", deck);
  }

  /**
   * A corner on the log bridge: a mooring post marks the outside of the bend. At a fork the other
   * log curves away the other way and snaps off over the sea.
   */
  private buildBridgeCorner(holder: TransformNode, node: TransformNode, turn: RunTurn) {
    this.instance("mooring-post", node);
    if (!turn.fork) return;
    const other = turn.direction === "left" ? "right" : "left", side = other === "right" ? 1 : -1;
    const y = elevationAt(turn.z) - .68, end = turn.z + BRIDGE_FORK_BREAK - .2, path: Vector3[] = [];
    for (let d = turn.z - CORNER_RADIUS; d <= end + .01; d += 1) {
      const p = this.route.branch(Math.min(d, end), turn.z, other);
      if (!p) return;
      // The broken log sags towards where it snapped.
      const sag = Math.max(0, Math.min(1, (d - (end - 7)) / 7)) ** 2 * .5;
      path.push(new Vector3(p.x, y - sag, p.z));
    }
    const log = MeshBuilder.CreateTube("bridge-broken-log", { path, radius: .66, tessellation: 18 }, this.scene);
    log.parent = holder; log.material = this.mats["bridge-bark-short"]; log.isPickable = false;
    const tip = this.route.branch(end, turn.z, other)!, fx = Math.sin(tip.heading), fz = Math.cos(tip.heading);
    const random = seeded(Math.round(turn.z));
    for (let k = 0; k < 7; k++) {
      // Splinters where the log tore apart.
      const angle = k / 7 * Math.PI * 2, r = .45 * random() + .1;
      const splinter = this.cylinder("bridge-splinter", holder, { diameterTop: 0, diameterBottom: .12 + random() * .1, height: .4 + random() * .5, tessellation: 4 }, [tip.x + Math.cos(tip.heading) * Math.cos(angle) * r + fx * .15, y - .5 + Math.sin(angle) * r, tip.z - Math.sin(tip.heading) * Math.cos(angle) * r + fz * .15], "log-end");
      splinter.rotation.set(Math.PI / 2 + (random() - .5) * .5, tip.heading + (random() - .5) * .5, 0);
    }
    // The far half lies in the water, one end sunk.
    const fallen = this.cylinder("bridge-fallen-log", holder, { diameter: 1.25, height: 3.6, tessellation: 16 }, [tip.x + fx * 2.6, SEA_Y + .05, tip.z + fz * 2.6], "log-bark");
    fallen.rotation.set(Math.PI / 2 + .3, tip.heading + .25, 0);
    // A warning sign on a pile in the water, beside the log just before it splits, and a rag on the broken log.
    const sign = this.instance("fork-sign", node);
    sign.position.set(side * 2.6, 0, -CORNER_RADIUS - 3);
    this.cylinder("bridge-sign-pile", node, { diameter: .22, height: 2.2, tessellation: 8 }, [side * 2.6, -1.05, -CORNER_RADIUS - 2.92], "wood");
    const flagAt = this.route.branch(turn.z - CORNER_RADIUS + 6, turn.z, other)!;
    this.cylinder("bridge-flag-stick", holder, { diameter: .06, height: 1.4, tessellation: 6 }, [flagAt.x, y + .9, flagAt.z], "wood");
    const flag = MeshBuilder.CreatePlane("bridge-flag", { width: .55, height: .34 }, this.scene);
    flag.parent = holder; flag.position.set(flagAt.x + Math.cos(flagAt.heading) * .29, y + 1.38, flagAt.z - Math.sin(flagAt.heading) * .29);
    flag.rotation.y = flagAt.heading + Math.PI / 2; flag.material = this.mats["fork-flag"]; flag.isPickable = false;
  }

  /** The other side of a fork: a short road out of the plaza that ends at a broken bridge over a ravine. */
  private buildFork(corner: TransformNode, turn: RunTurn, theme: number) {
    const side = turn.direction === "left" ? 1 : -1;
    const branch = new TransformNode(`fork-${turn.z}`, this.scene);
    branch.parent = corner; branch.rotation.y = side * Math.PI / 2;
    const lane = `lane-${RUN_SCENES[theme].id}`, stub = FORK_BRIDGE_START - FORK_STUB_START;
    for (let row = 0; row < 2; row++) for (let i = 0; i < 3; i++) {
      const tile = this.instance(lane, branch);
      tile.position.set((i - 1) * LANE_WIDTH, 0, FORK_STUB_START + stub * (row + .5) / 2);
      tile.scaling.z = stub / 2 / TILE_DEPTH;
    }
    this.instance("fork-stub", branch).position.z = FORK_STUB_START;
    const bridge = this.instance("fork-bridge", branch);
    bridge.position.z = FORK_BRIDGE_START;
    const chasm = bridge.getChildTransformNodes(true).find(node => node.name === "fork-chasm");
    // Over the canal the bridge spans open water; elsewhere a ravine is cut into the ground.
    if (chasm) { chasm.position.y = -elevationAt(turn.z); chasm.setEnabled(theme !== 0); }
    const sign = this.instance("fork-sign", corner);
    // Faces the oncoming dog from the start of the broken side, clear of the line the dog would run.
    sign.position.set(side * (FORK_STUB_START + 3.4), 0, -ROAD_HALF + .5);
  }

  /** World footprint of the ravine under a fork's broken bridge, for cutting the ground. */
  private forkChasm(turn: RunTurn): RoutePoint | undefined {
    const corner = this.route.corner(turn.z);
    if (!corner) return undefined;
    const heading = corner.heading + (turn.direction === "left" ? 1 : -1) * Math.PI / 2;
    const along = FORK_BRIDGE_START + (FORK_CHASM.start + FORK_CHASM.end) / 2;
    return { x: corner.x + Math.sin(heading) * along, y: 0, z: corner.z + Math.cos(heading) * along, heading };
  }

  private buildRope(ride: Extract<CourseFeature, { kind: "rope" }>) {
    const root = new TransformNode(`zipline-${ride.start}`, this.scene);
    const start = ride.start - .8, end = ride.end + .8;
    const path = Array.from({ length: 21 }, (_, i) => {
      const at = start + (end - start) * i / 20;
      const point = this.place(at);
      return new Vector3(point.x, ropeHeightAt(at, ride), point.z);
    });
    const cable = MeshBuilder.CreateTube("zipline-cable", { path, radius: .039, tessellation: 10 }, this.scene);
    cable.parent = root; cable.material = this.mats.zipline; cable.isPickable = false;
    for (const at of [start, end]) {
      const point = this.place(at);
      const anchor = this.instance("zipline-anchor", root);
      anchor.position.set(point.x, point.y, point.z);
      anchor.rotation.y = point.heading;
      anchor.scaling.y = (ropeHeightAt(at, ride) - point.y) / 3.12;
    }
    if (isDownhillRope(ride)) {
      // Below a downhill zipline: a gorge with a river, cut into the ground between the two ledges.
      const snow = sceneAt(ride.start) === 5, length = ride.end - ride.start + 4, middle = this.place((ride.start + ride.end) / 2);
      const gorge = new TransformNode("zipline-gorge", this.scene); gorge.parent = root;
      gorge.position.set(middle.x, 0, middle.z); gorge.rotation.y = middle.heading;
      const wall = snow ? "rock" : "sandstone", depth = -.35 - GORGE_Y;
      for (const s of [-1, 1]) {
        this.box("gorge-side", gorge, [1, depth + .4, length], [s * (GORGE_HALF_WIDTH + .5), GORGE_Y + depth / 2 - .2, 0], wall);
        this.box("gorge-end", gorge, [GORGE_HALF_WIDTH * 2 + 2, depth + .4, 1], [0, GORGE_Y + depth / 2 - .2, s * (length / 2 + .5)], wall);
        if (snow) this.box("gorge-snow-rim", gorge, [1.3, .3, length], [s * (GORGE_HALF_WIDTH + .45), -.3, 0], "snow");
      }
      const river = MeshBuilder.CreateGround("gorge-river", { width: GORGE_HALF_WIDTH * 2, height: length }, this.scene);
      river.parent = gorge; river.position.y = GORGE_Y; river.material = this.mats["pit-water-long"]; river.isPickable = false;
      const random = seeded(Math.round(ride.start));
      for (let k = 0; k < 16; k++) {
        const rock = MeshBuilder.CreateIcoSphere("gorge-rock", { radius: .6 + random() * 1.4, subdivisions: 1, flat: true }, this.scene);
        rock.parent = gorge; rock.material = this.mats[snow ? (k % 3 ? "rock" : "snow") : k % 2 ? "sandstone" : "sandstone-light"];
        rock.position.set((random() < .5 ? -1 : 1) * (GORGE_HALF_WIDTH - random() * 4), GORGE_Y + .1, (random() - .5) * length * .9);
        rock.scaling.y = .6; rock.rotation.set(random(), random() * 3, 0);
      }
    }
    return root;
  }

  /** The long log over the sea, following the route round its corners, on crossed stakes, wound with creepers. */
  private buildBridge(section: Extract<CourseFeature, { kind: "bridge" }>) {
    const root = new TransformNode(`log-bridge-${section.start}`, this.scene);
    const length = section.end - section.start;
    const segments = Math.ceil((length + 2) / 2);
    const path = Array.from({ length: segments + 1 }, (_, i) => {
      const point = this.place(section.start - 1 + (length + 2) * i / segments);
      return new Vector3(point.x, point.y - .68, point.z);
    });
    const log = MeshBuilder.CreateTube("bridge-log", { path, radius: .73, tessellation: 20 }, this.scene);
    log.parent = root; log.material = this.mats["bridge-bark"]; log.isPickable = false;
    const put = (name: string, at: number, roll = 0) => {
      const p = this.place(at), node = this.instance(name, root);
      node.position.set(p.x, p.y, p.z); node.rotation.set(0, p.heading, roll);
      return node;
    };
    for (let at = section.start + 4; at < section.end; at += 9) put("bridge-pile", at);
    for (let at = section.start + 7, k = 0; at < section.end - 3; at += 6.5 + (k % 3), k++) put("bridge-vine", at, k * 2.1);
    put("bridge-shore", section.start);
    put("bridge-shore", section.end).rotation.y += Math.PI;
    return root;
  }

  private drawRides(world: RunnerWorld, player: Vector3, centre: RoutePoint, lateral: number) {
    if (this.crossingRouteVersion !== this.route.version) {
      this.crossingRouteVersion = this.route.version;
      for (const crossing of this.crossings.values()) crossing.dispose();
      this.crossings.clear();
    }
    const live = new Set<number>();
    // The sea and the shore at the far end of the log bridge stay in view a while after it.
    const first = sectionIndexAt(world.distance - BEHIND - SEA_REACH), last = sectionIndexAt(world.distance + 168);
    for (let i = first; i <= last; i++) {
      const section = featureOf(i);
      if (!section || section.kind === "cart" || section.start > world.distance + 168 || section.end < world.distance - BEHIND - (section.kind === "bridge" ? SEA_REACH : 0)) continue;
      live.add(section.start);
      if (!this.crossings.has(section.start)) this.crossings.set(section.start, section.kind === "rope" ? this.buildRope(section) : this.buildBridge(section));
    }
    for (const [start, crossing] of this.crossings) if (!live.has(start)) { crossing.dispose(); this.crossings.delete(start); }

    const mounted = world.ride, local = sectionFeature(world.distance);
    const cart = local?.kind === "cart" && world.distance >= local.start - 36 && world.distance < local.end + 16 ? local : undefined;
    this.cart.setEnabled(!!cart);
    if (cart) {
      if (world.distance < cart.end) this.cartLane = lateral;
      const at = Math.min(cart.end, Math.max(cart.start, world.distance));
      const point = this.place(at, this.cartLane);
      this.cart.position.set(point.x, point.y, point.z);
      this.cart.rotation.set(this.roadPitch(at), point.heading, mounted && !this.settings.reducedMotion ? (world.lane - world.position) * .14 : 0);
    }

    this.ropeHandle.setEnabled(mounted?.kind === "rope");
    if (mounted?.kind === "rope") {
      const height = ropeHeightAt(world.distance, mounted);
      const board = Math.min(1, (world.distance - mounted.start) / (ROPE_GRAB_DISTANCE * .55));
      const spring = Math.min(1, ropeReleaseProgress(world.distance, mounted) * 4);
      const attached = Math.max(0, Math.min(1, board)) * (1 - spring);
      const hand = height - player.y - world.jumpHeight - DOG_SIZE * DOG_FEET - .25;
      const grip = .18 + (Math.max(.21, hand) - .18) * attached;
      const swing = lateral * attached;
      this.ropeHandle.position.set(centre.x, height, centre.z);
      this.ropeHandle.rotation.y = centre.heading;
      this.ropeLanyard.position.set(swing / 2, -grip / 2, 0);
      this.ropeLanyard.rotation.z = Math.atan2(swing, grip);
      this.ropeLanyard.scaling.y = Math.hypot(swing, grip);
    }
  }

  private drawBike(world: RunnerWorld, player: Vector3, heading: number) {
    const approach = Math.max(2.6, world.speed * .14);
    const obstacle = world.items.find(item => (item.kind === "block" || item.kind === "spikes") && coversLane(item, world.position, .6) && Math.abs(item.z - world.distance) < approach);
    const progress = obstacle ? 1 - Math.abs(obstacle.z - world.distance) / approach : 0;
    const bump = Math.sin(Math.PI / 2 * progress);
    const rise = obstacle?.kind === "block" ? 1.04 * bump : .61 * bump;
    const tilt = this.settings.reducedMotion ? 0 : .27 * bump;
    this.bicycle.position.set(player.x, player.y + world.jumpHeight + rise, player.z);
    this.bicycle.rotation.set(this.roadPitch(world.distance) - tilt, heading - (this.settings.reducedMotion ? 0 : .12), this.settings.reducedMotion ? 0 : (world.lane - world.position) * .18);
    for (const wheel of this.bikeWheels) wheel.rotation.x = -world.distance / .4;
    return .72 + rise;
  }

  private addFruitTree(root: TransformNode, item: RunItem, world: RunnerWorld) {
    const tree = MeshBuilder.CreatePlane("fruit-source-tree", { size: 1 }, this.scene);
    tree.parent = root; tree.material = this.mats[`tree-${FRUIT_TREE}`]; tree.isPickable = false;
    const size = this.mats[`tree-${FRUIT_TREE}`].diffuseTexture!.getBaseSize();
    const roadHeight = elevationAt(item.z);
    const base = sceneAt(item.z) === 0 ? -7 : -.35;
    const height = (roadHeight + 4.0 - base) / .75;
    const width = height * (size.height ? size.width / size.height : .78);
    const side = item.lane === 2 ? 1 : -1;
    tree.position.set(side * (ROAD_HALF + width / 2 + .72) - itemOffset(item), base + height * .486 - roadHeight, .5);
    tree.scaling.set(side * width, height, 1);
    tree.rotation.y = side * .21;
  }

  private drawFruit(prop: TransformNode, item: RunItem, distance: number) {
    const tree = prop.getChildMeshes(true).find(mesh => mesh.name === "fruit-source-tree")!;
    const fruit = prop.getChildTransformNodes(true).find(node => node.name === "tpl-fruit")!;
    fruit.setEnabled(!item.done);
    if (item.done) return;
    const ahead = item.z - distance, side = item.lane === 2 ? 1 : -1;
    const drop = Math.max(0, Math.min(1, (36 - ahead) / 10));
    const roll = Math.max(0, Math.min(1, (26 - ahead) / 20));
    const origin = tree.position.x - side * Math.abs(tree.scaling.x) * .37;
    const shoulder = side * (ROAD_HALF - .52) - itemOffset(item);
    const edge = origin + (shoulder - origin) * drop;
    const bounce = Math.abs(Math.sin(Math.PI * 5 * roll)) * Math.exp(-8 * roll) * .70;
    fruit.position.set(edge * (1 - roll), .32 + 3.85 * (1 - drop * drop) + bounce, .5 - .65 * Math.sin(Math.PI * roll));
    fruit.rotation.set(.25 * drop, .1, -side * (drop * 1.35 + roll * 10.3));
  }

  /** Template for an item: logs in the temple ruins are wound with creepers, and about half the two-lane log piles grow mushrooms. */
  private propName(item: RunItem) {
    if (item.kind === "coin") return `coin-${item.tier ?? "silver"}`;
    const scene = sceneAt(item.z), size = item.span === 3 ? "-wide" : item.span === 2 ? "-double" : "";
    if (item.kind === "block" && scene <= 1) {
      // Canal and temple logs: creepers in the temple, mushrooms on about half the two-lane piles.
      return `block${size}${scene === 1 ? "-vine" : ""}${item.span === 2 && hash01(item.id, 5) < .5 ? "-mushroom" : ""}`;
    }
    const themed = `${item.kind}${size}@${RUN_SCENES[scene].id}`;
    return this.templates.has(themed) ? themed : `${item.kind}${size}`;
  }

  private drawProps(world: RunnerWorld, t: number, dt: number) {
    const visible = new Set<number>();
    for (const item of world.items) {
      const depth = item.kind === "long-gap" ? obstacleHalfDepth(item.kind, item.z) : 0;
      if (item.z + depth <= world.distance - 8 || item.z - depth >= world.distance + 155) continue;
      if (!item.done || isRunObstacle(item.kind) || item.kind === "fruit") visible.add(item.id);
    }
    for (const [id, root] of this.props) if (!visible.has(id)) { root.dispose(); this.props.delete(id); }
    for (const item of world.items) {
      if (!visible.has(item.id)) continue;
      let prop = this.props.get(item.id);
      if (!prop) {
        const name = this.propName(item);
        prop = new TransformNode(`item-${item.id}`, this.scene);
        this.instance(this.templates.has(name) ? name : item.kind, prop);
        if (item.kind === "fruit") this.addFruitTree(prop, item, world);
        if (item.kind === "long-gap") {
          const depth = obstacleHalfDepth(item.kind, item.z);
          for (const mesh of prop.getChildMeshes()) {
            if (mesh.name === "fissure-wall" || mesh.name === "pit-water") mesh.scaling.z = depth / FISSURE_HALF;
            else mesh.position.z += Math.sign(mesh.position.z) * (depth - FISSURE_HALF);
          }
        }
        this.props.set(item.id, prop);
      }
      const p = this.place(item.z, itemOffset(item) * (item.feature === "rope" ? ROPE_LANE_SCALE : 1));
      prop.position.set(p.x, p.y, p.z); prop.rotation.set(isRunObstacle(item.kind) ? this.roadPitch(item.z) : 0, p.heading, 0);
      if (item.kind === "coin") {
        prop.position.y += item.y ?? .8; prop.rotation.y += t * 3 + item.id;
        if (item.pulled) prop.scaling.setAll(1.25);
      }
      else if (item.kind === "fruit") this.drawFruit(prop, item, world.distance);
      else if (isRunPower(item.kind)) { prop.position.y += Math.sin(t * 3 + item.id) * .15; prop.getChildren()[0]?.getChildren().forEach(c => { if (c.name === "halo") (c as TransformNode).rotation.y = t * 2; }); }
      else if (item.kind === "fire") {
        const phase = this.settings.reducedMotion ? 0 : t;
        for (const [index, mesh] of prop.getChildMeshes().filter(mesh => mesh.name === "flame-volume").entries()) {
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
    (this.fireEmbers.emitter as Vector3).set(at.x, at.y + .52, at.z);
    (this.fireSmoke.emitter as Vector3).set(at.x, at.y + 1.55, at.z);
    this.fireEmbers.manualEmitCount += ticks * (this.settings.reducedMotion ? 1 : 5);
    if (!this.settings.reducedMotion) this.fireSmoke.manualEmitCount += ticks;
  }

  private drawEffects(world: RunnerWorld, player: Vector3, t: number, dt: number, capture: boolean, lift: number) {
    const at = new Vector3(player.x, player.y + .9 + world.jumpHeight + lift, player.z);
    const coinAt = at.add(new Vector3(0, .3, 0));
    for (const [tier, system] of [["silver", this.silverSparks], ["gold", this.sparks], ["diamond", this.diamondSparks]] as const) {
      if (world[tier] > this.seen[tier]) this.burst(system, coinAt, Math.min(30, (world[tier] - this.seen[tier]) * 8));
      this.seen[tier] = world[tier];
    }
    if (world.powerPicked > this.seen.power) { this.burst(this.magic, at, 70, POWER_COLORS[world.lastPower]); this.flash.power = 1; }
    this.seen.power = world.powerPicked;
    if (world.shieldSaves > this.seen.shield) { this.burst(this.magic, at, 90, POWER_COLORS.shield); this.flash.shield = 1; }
    this.seen.shield = world.shieldSaves;
    if (world.stumbles > this.seen.stumble) this.burst(this.magic, new Vector3(player.x, player.y + .4, player.z), 30, ["#b8a07a", "#6d5a3e"]);
    this.seen.stumble = world.stumbles;
    this.flash.power = Math.max(0, this.flash.power - dt * 2.5);
    this.flash.shield = Math.max(0, this.flash.shield - dt * 2);

    const motion = this.settings.reducedMotion ? 0 : 1;
    // Shield: a bubble around the dog, blinking in its last three seconds; it bursts when used.
    const golden = world.fruit > 0;
    const shieldOn = !capture && (golden || world.shield > 0 || this.flash.shield > 0);
    this.bubble.setEnabled(shieldOn);
    if (shieldOn) {
      const ending = world.shield > 0 && world.shield < 3 && Math.floor(t * 8) % 2 === 0;
      const pop = this.flash.shield > 0 && world.shield === 0 ? 1 + (1 - this.flash.shield) * .8 : 1 + Math.sin(t * 4) * .03 * motion;
      this.bubble.position.copyFrom(at); this.bubble.scaling.setAll(pop);
      const mat = this.bubble.material as StandardMaterial;
      mat.diffuseColor.copyFrom(Color3.FromHexString(golden ? "#ffdc55" : "#7fe8ff"));
      mat.emissiveColor.copyFrom(Color3.FromHexString(golden ? "#b77822" : "#2a9cc4"));
      mat.alpha = golden ? .27 : world.shield === 0 ? this.flash.shield * .35 : ending ? .08 : .22;
    }
    // Magnet: a spinning red ring at the dog's feet.
    const magnetOn = !capture && (golden || world.magnet > 0);
    this.magnetRing.setEnabled(magnetOn);
    if (magnetOn) {
      this.magnetRing.position.set(player.x, player.y + .15 + world.jumpHeight + lift + Math.sin(t * 6) * .12 * motion, player.z);
      this.magnetRing.rotation.y = t * 4; this.magnetRing.scaling.setAll(1 + Math.sin(t * 9) * .08 * motion);
      (this.magnetRing.material as StandardMaterial).alpha = world.magnet < 3 && Math.floor(t * 8) % 2 === 0 ? .25 : .8;
    }
    // Boost: golden glow under the dog plus speed lines (in drawWeather) and wider FOV.
    const boostOn = !capture && world.invincible;
    this.boostGlow.setEnabled(boostOn);
    if (boostOn) { this.boostGlow.position.set(player.x, player.y + .05 + world.jumpHeight, player.z); this.boostGlow.rotation.y = Math.atan2(player.x - this.camera.position.x, player.z - this.camera.position.z); }
    if (boostOn && Math.random() < .5) this.burst(this.magic, new Vector3(player.x, player.y + .5 + world.jumpHeight, player.z), 2, POWER_COLORS.boost);
  }

  private drawCapture(world: RunnerWorld, player: Vector3, heading: number, motion: ReturnType<typeof captureMotion>) {
    const frog = this.chaserSprite, dog = this.dog.root;
    const time = world.captureTime, { reach, lift, height, tilt } = motion;
    const forward = new Vector3(Math.sin(heading), 0, Math.cos(heading));
    const right = new Vector3(Math.cos(heading), 0, -Math.sin(heading));
    const side = world.position > 1.4 ? -1 : 1;
    const scale = 1 + .28 * lift;
    const startBehind = world.danger > 0 ? 2.4 + 2.6 * (1 - Math.min(1, world.danger / 2)) : 4.5;
    const frogAt = player.subtract(forward.scale(startBehind + (1.36 - startBehind) * reach + .50 * lift))
      .add(right.scale(side * (.36 + 1.09 * (1 - reach))));
    frogAt.y = player.y + FROG_SIZE * scale * FROG_FEET + .21 * Math.sin(Math.PI * reach);
    frog.root.position.copyFrom(frogAt);
    frog.root.scaling.setAll(scale);
    const view = this.camera.position.subtract(frogAt);
    const angle = Math.atan2(Vector3.Dot(view, right), Vector3.Dot(view, forward));
    const frame = (8 + Math.round(-angle / (Math.PI / 4))) % 8;
    if (time < .15) {
      frog.frame(this.sheets.walk!, frame, 4, 4);
    } else {
      const laughing = time >= CAPTURE_LAUGH_AT;
      const atlas = laughing ? FROG_EXTRA_ART.directionLaugh : FROG_EXTRA_ART.directionAttack;
      const rect = atlas.frames[frame];
      frog.region(this.sheets[laughing ? "laugh" : "grab"]!, rect.x / atlas.width, rect.y / atlas.height, rect.width / atlas.width, rect.height / atlas.height);
      frog.root.scaling.x *= rect.width / rect.height;
    }
    frog.root.billboardMode = Mesh.BILLBOARDMODE_NONE;
    frog.material.alpha = world.danger > 0 || world.elapsed < 3.5 ? 1 : Math.min(1, time / .13);
    frog.root.setEnabled(frog.material.alpha > 0);

    dog.position.subtractInPlace(forward.scale(.52 * reach + .73 * lift));
    dog.position.subtractInPlace(right.scale(side * .80 * lift));
    dog.position.y += height - world.jumpHeight * reach;
    dog.rotation.z = side * tilt;
    // Face each sprite toward the moving camera, including when it crosses the side of the road.
    for (const actor of [frog.root, dog]) {
      const dx = actor.position.x - this.camera.position.x, dz = actor.position.z - this.camera.position.z;
      actor.rotation.y = Math.atan2(dx, dz);
      actor.rotation.x = .45 * Math.atan2(this.camera.position.y - actor.position.y, Math.hypot(dx, dz));
    }
    this.shadow.position.x = dog.position.x;
    this.shadow.position.z = dog.position.z;
    this.shadow.scaling.setAll(Math.max(.4, 1 - (height + world.jumpHeight * (1 - reach)) * .35));
  }

  private updateCamera(world: RunnerWorld, player: Vector3, centre: RoutePoint, shot: ReturnType<typeof captureMotion> | undefined, dt: number, t: number) {
    const portrait = this.engine.getRenderWidth() / Math.max(1, this.engine.getRenderHeight()) < .85;
    const k = (rate: number) => dt > 0 ? 1 - Math.exp(-rate * dt) : 1;
    // The camera turns a little behind the road, so a corner swings the view round smoothly.
    this.camYaw += angleTo(this.camYaw, centre.heading) * k(shot ? 2 : 4.5);
    const fov = (portrait ? 1.08 : .9) + (world.boost > 0 && !shot ? .14 : 0);
    this.camera.fov += (fov - this.camera.fov) * k(4);
    const fx = Math.sin(this.camYaw), fz = Math.cos(this.camYaw);
    if (shot) {
      const rx = Math.cos(centre.heading), rz = -Math.sin(centre.heading), hx = Math.sin(centre.heading), hz = Math.cos(centre.heading);
      const initial = this.captureCamera ??= { position: this.cameraPos.clone(), target: this.cameraTarget.clone() };
      const side = world.position > 1.4 ? -1 : 1;
      const end = new Vector3(player.x + hx * 7.2 + rx * side * 1.05, player.y + 3.55, player.z + hz * 7.2 + rz * side * 1.05);
      const target = new Vector3(player.x - hx * .75, player.y + 1.5 + .19 * shot.lift, player.z - hz * .75);
      Vector3.LerpToRef(initial.position, end, shot.orbit, this.cameraPos);
      Vector3.LerpToRef(initial.target, target, shot.focus, this.cameraTarget);
      // The side arc keeps the camera clear of both actors as it swings around.
      const arc = Math.sin(Math.PI * shot.orbit);
      this.cameraPos.x += rx * side * 3.35 * arc;
      this.cameraPos.z += rz * side * 3.35 * arc;
      this.cameraPos.y += .75 * arc;
    } else {
      this.captureCamera = undefined;
      // Follow most of the lane offset (smoothed) so the dog stays near the centre of the screen.
      const lateral = (world.position - 1) * LANE_WIDTH * (portrait ? .8 : .6) * rideLateralScale(world.distance, world.ride);
      this.camLateral += (lateral + (world.cycling && !this.settings.reducedMotion ? .68 : 0) - this.camLateral) * k(10);
      const rx = Math.cos(this.camYaw), rz = -Math.sin(this.camYaw);
      const bx = centre.x + rx * this.camLateral, bz = centre.z + rz * this.camLateral;
      const back = portrait ? 8.4 : 7.4, height = (portrait ? 4.6 : 4.1) + world.jumpHeight * .25;
      this.cameraPos.set(bx - fx * back, elevationAt(world.distance - back) + height, bz - fz * back);
      this.cameraTarget.set(bx + fx * 7, elevationAt(world.distance + 7) + 1.1 + world.jumpHeight * .35, bz + fz * 7);
      const sinceHit = world.elapsed - world.hitAt;
      if (!this.settings.reducedMotion && sinceHit < .35) {
        // Shake sideways to the view (not along world X, which is forward after a turn) and settle out.
        const shake = Math.sin(t * 60) * .14 * (1 - sinceHit / .35);
        this.cameraPos.x += rx * shake; this.cameraPos.z += rz * shake;
      }
    }
    this.camera.position.copyFrom(this.cameraPos);
    this.camera.setTarget(this.cameraTarget);
  }

  private drawWeather(weather: string, t: number, boost: boolean, heading: number, ground: number) {
    const cam = this.camera.position;
    const fx = Math.sin(heading), fz = Math.cos(heading), rx = Math.cos(heading), rz = -Math.sin(heading);
    const spread = (i: number, salt: number) => ((Math.sin(i * 12.9898 + salt) * 43758.5453) % 1 + 1) % 1;
    const rainOn = weather === "rain", snowOn = weather === "snow";
    if (this.rain[0].isEnabled() !== rainOn) this.rain.forEach(d => d.setEnabled(rainOn));
    if (this.snow[0].isEnabled() !== snowOn) this.snow.forEach(f => f.setEnabled(snowOn));
    if (rainOn) this.rain.forEach((drop, i) => {
      const a = spread(i, 1) * 30 - 4, b = spread(i, 2) * 18 - 9;
      drop.position.set(cam.x + fx * a + rx * b, ground + ((spread(i, 3) * 12 - t * 16) % 12 + 12) % 12 - 1, cam.z + fz * a + rz * b);
    });
    if (snowOn) this.snow.forEach((flake, i) => {
      const a = spread(i, 4) * 26 - 3, b = spread(i, 5) * 18 - 9 + Math.sin(t + i) * .4;
      flake.position.set(cam.x + fx * a + rx * b, ground + ((spread(i, 6) * 10 - t * 1.6) % 10 + 10) % 10 - .5, cam.z + fz * a + rz * b);
    });
    // Speed lines streaming past the camera while boosting.
    if (this.streaks[0].isEnabled() !== boost) this.streaks.forEach(s => s.setEnabled(boost));
    if (boost) this.streaks.forEach((line, i) => {
      const along = ((spread(i, 7) * 30 - t * 60) % 30 + 30) % 30 - 2;
      const side = (spread(i, 8) < .5 ? -1 : 1) * (2.5 + spread(i, 9) * 4), up = .5 + spread(i, 10) * 4.5;
      line.position.set(cam.x + fx * along + rx * side, ground + up, cam.z + fz * along + rz * side);
      line.rotation.y = heading;
    });
  }

  dispose() { if (this.disposed) return; this.disposed = true; this.scene.dispose(); this.engine.dispose(); }
}
