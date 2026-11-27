/**
 * 奶狗快跑 — pure simulation. No DOM, no rendering; driven at a fixed 120 Hz step.
 *
 * Coordinates: `distance` runs along the (possibly turning) route, lanes are 0/1/2,
 * `altitude` is metres above the road.
 */
import { BRIDGE_TURNS, RIDE_LEAD, featureOf, isDownhillRope, nextBridgeTurn, riderHeightAt, sceneAt, sectionFeature, sectionIndexAt, sectionScene, sectionStart, type CourseFeature, type FeatureKind, type RideSection } from "./course.ts";

export { sceneAt } from "./course.ts";

export type RunAction = "left" | "right" | "jump" | "slide";
export type RunPhase = "ready" | "running" | "caught" | "paused" | "won" | "lost";
/**
 * `chase`: win back the golden apple from the frog running ahead. `daily`: the endless run on the
 * same course for everyone all day. `rush`: a minute to grab as many coins as possible. `dark`: a
 * night run with the frog always close behind, held off with lanterns.
 */
export type RunMode = "endless" | "chase" | "daily" | "rush" | "dark";
export type RunObstacleKind = "block" | "gap" | "long-gap" | "beam" | "spikes" | "boulder" | "fire" | "trap" | "cart-block" | "bridge-branch" | "crate" | "runaway-cart";
export type CoinTier = "silver" | "gold" | "diamond";
const STANDARD_POWERS = ["shield", "magnet", "slow", "double", "boost", "spring"] as const;
export const RUN_POWERS = [...STANDARD_POWERS, "bike", "fruit", "balloon"] as const;
export type RunPowerKind = typeof RUN_POWERS[number];
export const RUN_POWER_SECONDS: Record<RunPowerKind, number> = { magnet: 10, shield: 20, boost: 5, slow: 5, double: 8, spring: 10, bike: 9, fruit: 15, balloon: 7 };
/** `chest` opens into a random reward; `clock` adds time in the coin rush; `lantern` drives the frog back in the dark. */
export type RunPickupKind = "chest" | "clock" | "lantern";
export type RunItemKind = "coin" | RunObstacleKind | RunPowerKind | RunPickupKind;
/** What a chest held. */
export type ChestReward = { silver?: number; gold?: number; diamond?: number; power?: RunPowerKind };
export type RunWeather = "sunny" | "rain" | "snow";
/**
 * `pulled` coins are flying toward the dog under a magnet; `lane` is then fractional. `thrownAt` marks a crate the frog threw, for its flight.
 * `roll` is the speed (m/s) of a boulder or runaway cart that comes at the dog; `rollFrom` is where it set off, once it has.
 * `threat` notes, a moment before contact, whether the dog was about to hit the obstacle: dodging it after that is a near miss.
 */
export type RunItem = {
  id: number; z: number; lane: number; kind: RunItemKind; done: boolean; span?: 2 | 3; y?: number; pulled?: boolean; tier?: CoinTier; feature?: FeatureKind | "fork"; thrownAt?: number;
  roll?: number; rollFrom?: number; threat?: boolean;
};
/** The frog in chase mode: metres ahead of the dog, seconds left, the lane it runs in. */
export type RunChase = { gap: number; timeLeft: number; lane: number; nextThrow: number; throws: number; escaped: boolean };
/**
 * `fork` corners also open the other way, onto a broken bridge. `three` corners (in the mine) also
 * carry on straight, into a shaft. `bridge` corners are on the log bridge over the sea. `wrong` marks
 * the trap the dog ran into, until it falls.
 */
export type RunTurn = { z: number; direction: "left" | "right"; taken: boolean; fork?: boolean; three?: boolean; bridge?: boolean; wrong?: "side" | "straight" };
export type RunRecord = { version: 1; distance: number; coins: number; score: number };

const OBSTACLES: readonly string[] = ["block", "gap", "long-gap", "beam", "spikes", "boulder", "fire", "trap", "cart-block", "bridge-branch", "crate", "runaway-cart"];
export const isRunObstacle = (kind: RunItemKind): kind is RunObstacleKind => OBSTACLES.includes(kind);
export const isRunPower = (kind: RunItemKind): kind is RunPowerKind => (RUN_POWERS as readonly string[]).includes(kind);

/** Scenes in index order; the run visits them on one fixed itinerary (see course.ts). New scenes paint their sky in code. */
export const RUN_SCENES: readonly { id: string; name: string; image?: string; night?: string }[] = [
  { id: "aqueduct", name: "峡谷水渠", image: "/assets/runner/aqueduct-scene-v1.png", night: "/assets/runner/aqueduct-night-v1.png" },
  { id: "temple", name: "遗迹长廊", image: "/assets/runner/temple-scene-v1.png", night: "/assets/runner/temple-night-v1.png" },
  { id: "mine", name: "矿洞轨道", image: "/assets/runner/mine-scene-v1.png", night: "/assets/runner/mine-night-v1.png" },
  { id: "bamboo", name: "竹林小径" },
  { id: "canyon", name: "赤岩峡谷" },
  { id: "snow", name: "雪原" },
];
/** The retired 1000 m challenge kept its records under "nwaxz-runner-record-v1"; that key is left alone. */
export const CHASE_RECORD_KEY = "nwaxz-runner-chase-record-v1";
export const ENDLESS_RECORD_KEY = "nwaxz-runner-endless-record-v1";
export const RECORD_KEYS: Record<RunMode, string> = {
  endless: ENDLESS_RECORD_KEY, chase: CHASE_RECORD_KEY, daily: "nwaxz-runner-daily-record-v1", rush: "nwaxz-runner-rush-record-v1", dark: "nwaxz-runner-dark-record-v1",
};
/** Endless rules: no clock, the run goes on until the dog is caught. */
export const isLongRun = (mode: RunMode) => mode === "endless" || mode === "daily" || mode === "dark";
/** The daily course: one seed for everyone on a given (local) date. */
export function dailySeed(date: Date) {
  let hash = (date.getFullYear() * 10000 + (date.getMonth() + 1) * 100 + date.getDate()) >>> 0;
  hash = Math.imul(hash ^ (hash >>> 16), 0x45d9f3b) >>> 0;
  hash = Math.imul(hash ^ (hash >>> 16), 0x45d9f3b) >>> 0;
  return (hash ^ (hash >>> 16)) >>> 0 || 1;
}
/** Coin rush: a minute on the clock, five more seconds for each clock picked up. */
export const RUSH_SECONDS = 60;
export const CLOCK_SECONDS = 5;
/** The dark run: how far behind the frog starts, how fast it closes in, and what pushes it back or brings it on. */
export const DARK_START_GAP = 16;
export const DARK_CLOSE = .3;
export const DARK_MAX_GAP = 26;
export const LANTERN_GAP = 5;
const DARK_HIT_GAP = 6;
/** Balloons lift the dog this high (over the temple arches and the mine's frames); spring shoes jump this much harder. */
export const FLY_HEIGHT = 8;
/** Seconds the balloons take to float the dog back down at the end of a flight. */
const BALLOON_DESCENT = 1;
export const SPRING_BOOST = 1.38;
export const BALLOON_START = 800;
const BALLOON_CHANCE = .09;
export const CHEST_START = 300;
const CHEST_CHANCE = .12;
/** Seconds of protection after getting back up, and the gold a revive costs (doubling each time in a run). */
export const REVIVE_GRACE = 2.5;
export const REVIVE_COST = 20;
/** Chase mode: through the snowfield and the red-rock canyon, both downhill ziplines on the way. */
export const CHASE_START = (() => { let index = 0; while (sectionScene(index) !== 5) index++; return sectionStart(index); })();
export const CHASE_SECONDS = 80;
export const CHASE_START_GAP = 30;
/** The frog runs this much slower than the dog's normal pace, so a clean run closes in. */
const CHASE_FROG_PACE = .99;
/** Metres the frog gains on each stumble or wall bump, and loses on each coin collected. */
const CHASE_HIT_GAP = 10;
const CHASE_COIN_GAP = .1;
/** The dog closes in by at most this many metres a second, even on a dash or a zipline. */
const CHASE_MAX_CLOSE = 2.2;
/** Within this many metres the dog grabs the apple back. */
export const CHASE_CATCH = 1.4;
export const LONG_GAP_START = 600;
export const GOLD_START = 1500;
export const DIAMOND_START = 4000;
export const BIKE_START = 1100;
export const FRUIT_START = 650;
const BIKE_CHANCE = .06;
const FRUIT_CHANCE = .015;
const DIAMOND_CHANCE = .003;

// Movement tuning (metres, seconds).
export const LANE_WIDTH = 2.4;
const BASE_SPEED = 13;
const MAX_SPEED = 30;
const JUMP_VELOCITY = 7.4;
const GRAVITY = 23;
const SLIDE_TIME = .7;
const LANE_RATE = 16;
const DANGER_TIME = 8;
const GRACE_TIME = 1;
const CAPTURE_TIME = 2.4;
const TURN_WINDOW = 24;
const TURN_LATE = 1.5;
/** Share of corners after the first that become forks with a broken-bridge side. */
export const FORK_CHANCE = .55;
/** Metres past the corner, along the wrong side of a fork, where the broken bridge deck starts and ends. */
export const FORK_BRIDGE_START = 12;
export const FORK_BRIDGE_BREAK = 15.2;
/** Metres past a log-bridge fork where its broken side snaps off. */
export const BRIDGE_FORK_BREAK = 13;
/** Metres past a mine junction, straight on, where the dog drops into the shaft. */
export const SHAFT_EDGE = 9.6;
/** Turn and fork prompts only show for the first and middle part of a run; after this the player reads the scene. */
export const TURN_HINT_END = 2000;
/**
 * Rolling boulders (temple, canyon, snowfield) and runaway carts (mine) lie still until the dog comes
 * near, then come at it down one lane. They set off so as to roll this many metres before they meet
 * the dog, and are laid this much further on, so they are met about where a still one would be.
 */
export const ROLL_TRAVEL = 12;
/** Metres into a run before anything rolls; never in the chase, which has the frog's crates. */
export const ROLL_START = 350;
export const ROLL_SPEED = { boulder: 8, "runaway-cart": 10 } as const;
const ROLLING_SCENES: readonly number[] = [1, 2, 4, 5];
/** Seconds before contact. Dodging an obstacle the dog was still about to hit at that moment is a near miss. */
export const NEAR_WINDOW = .3;
/** Points for a near miss, before the coin streak multiplier. */
export const NEAR_SCORE = 100;
const STEP = 1 / 120;

/** Height the dog must exceed to pass over each obstacle; beams need sliding instead. */
const CLEARANCE: Record<RunObstacleKind, number> = { block: .85, gap: .05, "long-gap": .05, beam: Infinity, spikes: .5, boulder: 1.75, fire: .7, trap: .35, "cart-block": Infinity, "bridge-branch": .48, crate: .85, "runaway-cart": 1.45 };
/** Half depth along the route. */
const DEPTH: Record<Exclude<RunObstacleKind, "long-gap">, number> = { block: .6, gap: 2.4, beam: .35, spikes: .7, boulder: .7, fire: .6, trap: 1.75, "cart-block": .8, "bridge-branch": .49, crate: .5, "runaway-cart": .95 };
const baseSpeedAt = (distance: number) => Math.min(MAX_SPEED, BASE_SPEED + distance / 110);
export function obstacleHalfDepth(kind: RunObstacleKind, distance: number) {
  // A single jump lasts about .63 s. This span requires about .78 s at the normal pace.
  return kind === "long-gap" ? baseSpeedAt(distance) * .39 : DEPTH[kind];
}
export const isFallObstacle = (kind: RunItemKind): kind is "gap" | "long-gap" | "trap" => kind === "gap" || kind === "long-gap" || kind === "trap";
export function coversLane(item: RunItem, lane: number, margin = 0) {
  return item.span === 3 || (lane >= item.lane - margin && lane <= item.lane + (item.span ?? 1) - 1 + margin);
}

export function weatherAt(seed: number, distance: number): RunWeather {
  let hash = (seed ^ Math.imul(Math.floor(distance / 300) + 1, 0x45d9f3b)) >>> 0;
  hash = Math.imul(hash ^ (hash >>> 16), 0x45d9f3b) >>> 0;
  return (["sunny", "rain", "snow"] as const)[hash % 3];
}
export const nightAt = (distance: number) => distance >= 1000 && (distance - 1000) % 2100 < 1500;
/** No weather underground, always snowing on the snowfield, and no snow in the red-rock canyon. */
export function sceneWeather(scene: number, weather: RunWeather): RunWeather {
  if (scene === 2) return "sunny";
  if (scene === 5) return "snow";
  return scene === 4 && weather === "snow" ? "sunny" : weather;
}

/** Hash of the run seed and corner position, so forks never shift the obstacle random stream. */
export function forkRoll(seed: number, z: number) {
  let hash = (seed ^ Math.imul(Math.round(z) + 7, 0x2c1b3c6d)) >>> 0;
  hash = Math.imul(hash ^ (hash >>> 15), 0x297a2d39) >>> 0;
  hash = (hash ^ (hash >>> 13)) >>> 0;
  return hash / 4294967296;
}

export function readRunRecord(raw: string | null): RunRecord {
  const empty: RunRecord = { version: 1, distance: 0, coins: 0, score: 0 };
  try {
    const value = JSON.parse(raw ?? "null");
    if (value?.version !== 1) return empty;
    for (const key of ["distance", "coins", "score"] as const) {
      if (!Number.isSafeInteger(value[key]) || value[key] < 0 || value[key] > 1e9) return empty;
    }
    return { version: 1, distance: value.distance, coins: value.coins, score: value.score };
  } catch { return empty; }
}

/** Whole-road obstacles each scene draws from, by scene index. */
const WHOLE_ROAD: readonly (readonly ("gap" | "block" | "beam")[])[] = [
  ["gap", "gap", "block", "beam"], ["block", "beam", "beam", "gap"], ["beam", "block", "gap"],
  ["block", "beam", "beam", "gap"], ["gap", "gap", "block", "beam"], ["block", "block", "beam", "gap"],
];

const FAIL_TEXT: Record<RunObstacleKind, [string, string]> = {
  block: ["撞上了倒木", "整条路的倒木要跳过去。"],
  gap: ["掉进了裂缝", "看到裂缝提前起跳，空中还能再跳一次。"],
  "long-gap": ["没跳过长落穴", "从边缘起跳，飞到坑上方时在空中再跳一次。"],
  beam: ["撞上了低门", "整条路的低门要下滑钻过去。"],
  spikes: ["绊倒在乱石枯枝上", "看清路上的乱石和枯枝，换道或跳过去。"],
  boulder: ["撞上了巨石", "巨石很高，换道躲开最稳。"],
  fire: ["碰到了火焰", "换到别的道，或者跳过去。"],
  trap: ["掉进了落穴", "看见活动木板就提前跳过去，或换到空着的跑道。"],
  "cart-block": ["矿车撞上了塌方", "矿车里要提前换到畅通的轨道。"],
  "bridge-branch": ["撞上了桥上的横枝", "走在桥中央，靠近横枝时跳过去。"],
  crate: ["撞上了木箱", "奶蛙扔来的木箱要换道躲开，或者跳过去。"],
  "runaway-cart": ["被失控的矿车撞飞了", "听到轰隆声先看矿车在哪条轨道，提前换道，或者二段跳越过去。"],
};
/** What rolled into the dog, by scene. */
const ROLLED_INTO: Record<number, string> = { 1: "被滚来的石球撞倒了", 4: "被滚落的巨石撞倒了", 5: "被滚下来的大雪球撞倒了" };

export class RunnerWorld {
  phase: RunPhase = "ready";
  distance = 0;
  elapsed = 0;
  gait = 0;
  lane = 1;
  position = 1;
  coins = 0;
  silver = 0;
  gold = 0;
  diamond = 0;
  fallObstacle?: RunItem;
  fallVelocity = 0;
  coinScore = 0;
  private bonusDistanceScore = 0;
  streak = 0;
  /** Seconds of jump left (kept for animation); 0 when grounded. */
  jump = 0;
  jumpCount = 0;
  slide = 0;
  magnet = 0;
  shield = 0;
  boost = 0;
  slow = 0;
  double = 0;
  bike = 0;
  fruit = 0;
  spring = 0;
  balloon = 0;
  ropeLandedAt = -Infinity;
  /** Times of the last take-off and touchdown, for squash-and-stretch. */
  jumpedAt = -Infinity;
  landedAt = -Infinity;
  /** Seconds the chaser stays close after a stumble. */
  danger = 0;
  stumble = 0;
  hitAt = -10;
  reason = "";
  deathHint = "";
  captureTime = 0;
  endless: boolean;
  items: RunItem[] = [];
  turns: RunTurn[] = [];
  turnCount = 0;
  private turnsMade = 0;
  lastTurnDirection: "left" | "right" = "left";
  readonly weatherSeed: number;
  /** Event counters for effects: they only ever increase. */
  powerPicked = 0;
  lastPower: RunPowerKind = "magnet";
  shieldSaves = 0;
  stumbles = 0;
  /** Bumps against the side wall: count, and which side (-1 left, 1 right) the last one was. */
  wallBumps = 0;
  wallSide = 0;
  wallBumpAt = -10;
  /** Near misses this run, the points they earned, and the time and kind of the last one. */
  nearMisses = 0;
  nearScore = 0;
  nearAt = -10;
  nearKind: RunObstacleKind = "block";
  /** Run tallies for missions: second jumps, slides, forks taken the right way, rides finished, obstacles ridden through on the bicycle, best coin multiplier, rolling hazards set off. */
  doubleJumps = 0;
  slides = 0;
  forksCleared = 0;
  ridesDone = 0;
  smashed = 0;
  bestMultiplier = 1;
  rollsStarted = 0;
  /** Chests opened (and what the last one held), times the dog got back up, clocks and lanterns picked up. */
  chests = 0;
  lastChest: ChestReward = {};
  revives = 0;
  clocks = 0;
  lanterns = 0;
  readonly mode: RunMode;
  /** Where the run starts on the course: 0 in endless mode, the snowfield in chase mode. */
  readonly origin: number;
  chase?: RunChase;
  /** Coin rush: seconds left on the clock. */
  rush?: { timeLeft: number };
  /** The dark run: metres between the dog and the frog behind it. */
  hunt?: { gap: number };
  /** Power-up durations, with any upgrades bought. */
  readonly durations: Record<RunPowerKind, number>;

  private altitude = 0;
  private verticalSpeed = 0;
  private jumpBuffer = 0;
  private grace = 0;
  private streakTimer = 0;
  private accumulator = 0;
  private pausedFrom: "running" | "caught" = "running";
  private seed: number;
  private sequence = 0;
  private rows = 0;
  private powerIndex = 0;
  private nextRow = 90;
  private nextTurn = 300;
  /** Position of the last corner generated, regular or on the log bridge. */
  private lastTurnZ = 0;
  private nextLongGap = LONG_GAP_START;
  private nextFeatureSection = 0;
  private mountedRide?: RideSection;
  private rideTakeoff = 0;
  private rideTakeoffGrade = 0;
  /** Whether the dog was on the log bridge last step, to count crossing it. */
  private onBridge = false;
  /** Set by `row` when it lays a rolling hazard. */
  private rolledRow = false;

  constructor(seed = 1, mode: RunMode = "endless", options: { durations?: Partial<Record<RunPowerKind, number>> } = {}) {
    this.seed = seed >>> 0 || 1;
    this.weatherSeed = seed >>> 0;
    this.mode = mode;
    this.endless = isLongRun(mode);
    this.durations = { ...RUN_POWER_SECONDS, ...options.durations };
    this.origin = mode === "chase" ? CHASE_START : 0;
    if (mode === "chase") {
      // Straight into the chase: no opening stretch, no long pits, the frog already running ahead.
      this.distance = this.origin; this.lastTurnZ = this.origin;
      this.nextRow = this.origin + 45; this.nextTurn = this.origin + 170;
      this.nextLongGap = Infinity; this.nextFeatureSection = sectionIndexAt(this.origin); this.rows = 2;
      this.chase = { gap: CHASE_START_GAP, timeLeft: CHASE_SECONDS, lane: 1, nextThrow: 6, throws: 0, escaped: false };
    }
    if (mode === "rush") { this.rush = { timeLeft: RUSH_SECONDS }; this.nextRow = 50; this.rows = 2; }
    if (mode === "dark") this.hunt = { gap: DARK_START_GAP };
    this.nextTurn = this.turnOutsideFeature(this.nextTurn, this.origin);
    this.populate();
  }

  /** Metres run so far in this run. */
  get runDistance() { return this.distance - this.origin; }
  /** Pace follows the distance run; the chase starts at a brisk 16 m/s, the coin rush at 15. */
  private paceAt(distance: number) { return baseSpeedAt(distance - this.origin + (this.chase ? 330 : this.rush ? 220 : 0)); }
  private get courseSpeed() {
    const multiplier = this.boost > 0 ? 1.5 : this.fruit > 0 ? 1.27 : this.cycling ? 1.22 : this.mountedRide ? 1.17 : this.stumble > 0 ? .7 : 1;
    return this.paceAt(this.distance) * multiplier;
  }
  get timeScale() { return this.slow > 0 ? .7 : 1; }
  get speed() { return this.courseSpeed * this.timeScale; }
  /**
   * Real seconds the fixed steps have not reached yet. Drawing leads the last step by this much, so
   * the run moves evenly whatever the screen's frame rate (2 steps one frame, 1 or 3 the next).
   */
  get lag() { return this.phase === "running" ? this.accumulator : 0; }
  get trapFall() { return !!this.fallObstacle; }
  get ride() { return this.mountedRide; }
  get bridge() {
    const section = sectionFeature(this.distance);
    return section?.kind === "bridge" && this.distance >= section.start && this.distance < section.end ? section : undefined;
  }
  get upcomingFeature() {
    const section = sectionFeature(this.distance);
    return section && this.distance >= section.start - RIDE_LEAD && this.distance < section.start ? section : undefined;
  }
  get cycling() { return this.bike > 0 && !this.ride && !this.bridge && !this.flying; }
  get invincible() { return this.boost > 0 || this.fruit > 0; }
  /** Up among the balloons: over everything, taking corners by itself. */
  get flying() { return this.balloon > 0; }
  get jumpHeight() { return this.mountedRide ? riderHeightAt(this.distance, this.mountedRide, this.rideTakeoff, this.rideTakeoffGrade) : this.altitude; }
  get airborne() { return this.altitude > 0 || this.verticalSpeed > 0; }
  get multiplier() { return Math.min(5, 1 + Math.floor(this.streak / 10)); }
  get score() { return Math.floor(this.runDistance) * 10 + this.coinScore + this.nearScore + this.bonusDistanceScore + this.chaseBonus; }
  /** Winning the chase pays for every second still on the clock. */
  get chaseBonus() { return this.chase && this.phase === "won" ? 2000 + Math.ceil(this.chase.timeLeft) * 300 : 0; }
  get sceneIndex() { return sceneAt(this.distance); }
  get weather() { return sceneWeather(this.sceneIndex, weatherAt(this.weatherSeed, this.distance)); }
  /** Whether the HUD still says which way to turn (never in the dark run). */
  get turnHints() { return this.runDistance < TURN_HINT_END && this.mode !== "dark"; }
  /** The chase and the coin rush always run by day, the dark run always by night. */
  get night() { return this.mode === "dark" || (!this.chase && !this.rush && nightAt(this.distance)); }
  get approachingTurn() { return this.turns.find(turn => !turn.taken && turn.z >= this.distance - TURN_LATE); }
  /** The fork whose broken-bridge side the dog took, until it falls. */
  get wrongTurn() { return this.turns.find(turn => turn.wrong); }
  /** True while a left/right input would take the next corner instead of changing lanes. */
  get turnWindow() { const turn = this.approachingTurn; return !!turn && turn.z - this.distance <= TURN_WINDOW; }
  /** Next obstacle the player still has to deal with. */
  get nextObstacle() {
    let best: RunItem | undefined;
    for (const item of this.items) if (!item.done && isRunObstacle(item.kind) && item.z + obstacleHalfDepth(item.kind, item.z) >= this.distance && (!best || item.z < best.z)) best = item;
    return best;
  }

  start() { if (this.phase === "ready") this.phase = "running"; }
  pause() { if (this.phase === "running" || this.phase === "caught") { this.pausedFrom = this.phase; this.phase = "paused"; this.accumulator = 0; } }
  resume() { if (this.phase === "paused") this.phase = this.pausedFrom; }
  finishCapture() { if (this.phase === "caught") { this.captureTime = CAPTURE_TIME; this.phase = "lost"; } }
  /** Tilt control: jump straight to a lane. */
  steer(lane: number) { if (this.phase === "running" && Number.isInteger(lane) && lane >= 0 && lane <= 2 && !this.turnWindow) this.lane = lane; }

  action(action: RunAction) {
    if (this.phase !== "running") return;
    if (action === "left" || action === "right") {
      const turn = this.approachingTurn;
      if (turn && turn.z - this.distance <= TURN_WINDOW) {
        if (action !== turn.direction && this.fruit <= 0 && !this.flying) {
          // A fork's other side is real road: the dog runs onto it and falls at the broken bridge.
          if (turn.fork) { turn.taken = true; turn.wrong = "side"; return; }
          if (turn.bridge) { this.fallFromCourse("bridge", this.distance, "转错了方向", "桥上看清木头往哪边弯，另一边是海。"); return; }
          this.fail("转错了方向", "看清弯道往哪边拐再转。"); return;
        }
        turn.taken = true; this.turnCount++; this.lastTurnDirection = turn.direction;
        if (turn.fork) this.forksCleared++;
        return;
      }
      const lane = this.lane + (action === "left" ? -1 : 1);
      if (lane < 0 || lane > 2) { this.bumpWall(action === "left" ? -1 : 1); return; }
      this.lane = lane;
    } else if (this.mountedRide || this.flying) return;
    else if (action === "jump") {
      if (this.jumpCount < 2) {
        this.slide = 0; this.jumpCount++; this.verticalSpeed = JUMP_VELOCITY * (this.spring > 0 ? SPRING_BOOST : 1); this.jump = this.airTime(); this.jumpedAt = this.elapsed;
        if (this.jumpCount === 2) this.doubleJumps++;
      } else this.jumpBuffer = .15;
    } else if (this.airborne) {
      // Slide in the air slams the dog down and slides on landing.
      this.verticalSpeed = Math.min(this.verticalSpeed, -14); this.jumpBuffer = 0; this.slide = SLIDE_TIME + this.airTime(); this.slides++;
    } else { if (this.slide === 0) this.slides++; this.slide = SLIDE_TIME; }
  }

  /**
   * Steering past the outer lane runs the dog into the side of the road. That stumbles like a light
   * hit and sets the frog on it; doing it again while chased is fatal. Not on rides, on the log bridge
   * (where leaving the middle is a fall anyway) or while invincible.
   */
  private bumpWall(side: number) {
    if (this.mountedRide || this.bridge || this.wrongTurn || this.invincible || this.flying || this.grace > 0) return;
    this.wallBumps++; this.wallSide = side; this.wallBumpAt = this.elapsed; this.hitAt = this.elapsed; this.streak = 0; this.streakTimer = 0;
    if (this.shield > 0) { this.grace = GRACE_TIME; return; }
    this.stumbleFrom(CHASE_HIT_GAP * .6, "撞墙后被恐怖奶蛙抓住了", "被追的时候别往路边撞，看准再换道。");
  }

  /** A recoverable knock: the frog closes in (or, in the chase, gets further away). Returns false when it ends the run. */
  private stumbleFrom(chaseGap: number, reason: string, hint: string) {
    if (this.chase) { this.chase.gap += chaseGap; this.stumble = 1; this.grace = GRACE_TIME; this.stumbles++; return true; }
    if (this.hunt) {
      // In the dark the frog is always on the dog's heels: a knock brings it a good deal closer.
      this.hunt.gap -= DARK_HIT_GAP; this.stumble = 1; this.grace = GRACE_TIME; this.stumbles++;
      if (this.hunt.gap > 0) return true;
      this.fail("在黑暗里被恐怖奶蛙抓住了", "黑夜里奶蛙一直跟在后面：别撞东西，多捡灯笼把它逼退。");
      return false;
    }
    if (this.danger > 0) { this.fail(reason, hint); return false; }
    this.danger = DANGER_TIME; this.stumble = 1; this.grace = GRACE_TIME; this.stumbles++;
    return true;
  }

  advance(seconds: number) {
    if (!Number.isFinite(seconds) || seconds <= 0) return;
    if (this.phase === "caught") {
      this.captureTime += Math.min(seconds, .1);
      if (this.captureTime >= CAPTURE_TIME) this.phase = "lost";
      return;
    }
    if (this.phase !== "running") return;
    // A stalled frame (background tab, debugger) never fast-forwards into a crash.
    this.accumulator += Math.min(seconds, .1);
    while (this.accumulator >= STEP && this.phase === "running") { this.accumulator -= STEP; this.step(STEP); }
  }

  private airTime() {
    // Time until landing from the current height and vertical speed.
    const v = this.verticalSpeed;
    return (v + Math.sqrt(v * v + 2 * GRAVITY * this.altitude)) / GRAVITY;
  }

  private step(realDt: number) {
    // Scale travel and flight together so the hourglass preserves jump distances.
    const dt = realDt * this.timeScale;
    const speed = this.courseSpeed;
    const previousDistance = this.distance;
    const previousMetre = Math.floor(this.distance);
    this.elapsed += dt;
    this.distance += speed * dt;
    if (this.double > 0 || this.fruit > 0) this.bonusDistanceScore += (Math.floor(this.distance) - previousMetre) * 10;
    this.gait += dt * Math.min(3.6, 1.8 + speed / 20);
    const bridge = this.bridge, upcoming = this.upcomingFeature;
    if (this.onBridge && !bridge) this.ridesDone++;
    this.onBridge = !!bridge;
    if ((this.invincible || this.flying) && (bridge || (upcoming?.kind === "bridge" && upcoming.start - this.distance <= 18))) this.lane = 1;
    this.position += (this.lane - this.position) * Math.min(1, realDt * LANE_RATE);
    if (Math.abs(this.lane - this.position) < .002) this.position = this.lane;

    let landingVelocity = 0;
    if (this.flying) {
      // Balloons: rise to flying height, hold it, and float down over the last second. A ride or the
      // log bridge coming up cuts the flight short so the dog is down in time.
      if (upcoming || bridge) this.balloon = Math.min(this.balloon, BALLOON_DESCENT);
      const target = this.balloon > BALLOON_DESCENT ? FLY_HEIGHT : 0;
      this.altitude = Math.max(0, this.altitude + (target - this.altitude) * Math.min(1, dt * 3.4));
      this.verticalSpeed = 0; this.jump = 0; this.jumpCount = 0; this.slide = 0;
    } else if (this.airborne) {
      this.verticalSpeed -= GRAVITY * dt;
      this.altitude = Math.max(0, this.altitude + this.verticalSpeed * dt);
      this.jump = Math.max(0, this.jump - dt);
      if (this.altitude === 0 && this.verticalSpeed < 0) {
        landingVelocity = this.verticalSpeed;
        this.verticalSpeed = 0; this.jumpCount = 0; this.jump = 0; this.landedAt = this.elapsed;
        if (this.jumpBuffer > 0) { this.jumpBuffer = 0; this.action("jump"); }
      }
    }
    for (const key of ["slide", "danger", "stumble", "grace", "streakTimer", "jumpBuffer"] as const) this[key] = Math.max(0, this[key] - dt);
    const wasFlying = this.flying;
    for (const power of RUN_POWERS) this[power] = Math.max(0, this[power] - realDt);
    // A moment's protection while finding its feet after the balloons let go.
    if (wasFlying && !this.flying) this.grace = Math.max(this.grace, 1.2);
    if (this.streakTimer === 0) this.streak = 0;

    if (!this.advanceRide(previousDistance, speed)) return;
    if (bridge && Math.abs(this.position - 1) > .37 && this.altitude <= .11 && !this.invincible) {
      this.fallFromCourse("bridge", this.distance, "掉下了独木桥", "过桥时留在中间，跳过横枝。");
      return;
    }

    const wrong = this.wrongTurn;
    if (wrong) {
      // The broken way is narrower than the road, so the dog lines up with it. Nothing on this side
      // counts; the run ends where it gives way.
      this.lane = 1;
      if (wrong.wrong === "straight") {
        if (this.distance >= wrong.z + SHAFT_EDGE) this.fallFromCourse("fork", this.distance, "掉进了竖井", "矿洞三岔口只有一条活路：直走是竖井，断桥那边也走不通。");
      } else if (wrong.bridge) {
        if (this.distance >= wrong.z + BRIDGE_FORK_BREAK) this.fallFromCourse("fork", this.distance, "走上了断掉的独木桥", "桥上分岔时看清哪根木头断了，走完好的那根。");
      } else if (this.distance >= wrong.z + FORK_BRIDGE_BREAK) this.fallFromCourse("fork", this.distance, "走上了断桥", "岔路口要看清：有断桥的一边是死路，走另一边。");
      return;
    }

    const turn = this.approachingTurn;
    if (turn && (this.invincible || this.flying) && turn.z - this.distance <= 16) this.action(turn.direction);
    // Checked against every corner, not just the approaching one: a single step can carry the dog
    // past the last moment to turn, and the corner would otherwise be quietly skipped.
    const missed = this.turns.find(corner => !corner.taken && this.distance > corner.z + TURN_LATE - .01);
    if (missed) {
      // A mine junction also carries on straight, into a shaft; the log bridge has only the sea ahead.
      if (missed.three) { missed.taken = true; missed.wrong = "straight"; return; }
      if (missed.bridge) { this.fallFromCourse("bridge", this.distance, "冲出了独木桥", "桥上的弯道也要及时转，木头不会等你。"); return; }
      this.fail("冲出了弯道", "看到弯道及时转弯。");
      return;
    }

    this.rollItems(speed, dt);
    const coinsBefore = this.coins;
    for (const item of this.items) {
      if (item.done || (item.feature && item.feature !== (bridge?.kind ?? this.mountedRide?.kind))) continue;
      if (item.kind === "coin") this.touchCoin(item, dt);
      else if (isRunPower(item.kind)) this.touchPower(item, item.kind);
      else if (item.kind === "chest" || item.kind === "clock" || item.kind === "lantern") this.touchPickup(item, item.kind);
      else if (isRunObstacle(item.kind) && !this.touchObstacle(item, item.kind, landingVelocity)) return;
    }
    this.bestMultiplier = Math.max(this.bestMultiplier, this.multiplier);
    if (this.chase && !this.stepChase(realDt, dt, speed, this.coins - coinsBefore)) return;
    if (this.rush) {
      this.rush.timeLeft = Math.max(0, this.rush.timeLeft - realDt);
      if (this.rush.timeLeft === 0) { this.phase = "won"; this.reason = "时间到"; return; }
    }
    if (this.hunt) {
      // The frog creeps up all the time, faster the further the run goes; lanterns drive it back.
      this.hunt.gap = Math.min(DARK_MAX_GAP, this.hunt.gap - DARK_CLOSE * (1 + this.runDistance / 2000) * realDt);
      if (this.hunt.gap <= 0) { this.hunt.gap = 0; this.fail("在黑暗里被恐怖奶蛙抓住了", "黑夜里奶蛙一直跟在后面：别撞东西，多捡灯笼把它逼退。"); return; }
    }

    this.items = this.items.filter(item => item.z + (item.kind === "long-gap" ? obstacleHalfDepth(item.kind, item.z) : 0) > this.distance - 10);
    this.turns = this.turns.filter(t => t.z > this.distance - 30);
    this.populate();
  }

  /**
   * The frog keeps a little under the dog's normal pace, so a clean run closes the gap; coins close
   * it faster, knocks open it up. Now and then it throws a crate back into the dog's way. Returns
   * false when the chase is over.
   */
  private stepChase(realDt: number, dt: number, speed: number, coins: number) {
    const chase = this.chase!;
    chase.timeLeft = Math.max(0, chase.timeLeft - realDt);
    let closing = Math.min(CHASE_MAX_CLOSE, speed - this.paceAt(this.distance) * CHASE_FROG_PACE);
    // Within a few metres the dog lunges for it, so the last stretch never crawls.
    if (chase.gap < 5 && closing > 0) closing = Math.max(closing, .9);
    chase.gap -= closing * dt + coins * CHASE_COIN_GAP;
    chase.gap = Math.min(60, chase.gap);
    if (chase.gap <= CHASE_CATCH) { chase.gap = CHASE_CATCH; this.phase = "won"; return false; }
    if (chase.timeLeft <= 0) {
      // No capture scene: the frog simply gets away, laughing.
      chase.escaped = true; this.reason = "奶蛙带着金苹果跑掉了"; this.deathHint = "少撞东西、多收银币就能追得更快；冲刺道具能一口气拉近距离。";
      this.captureTime = CAPTURE_TIME; this.phase = "lost";
      return false;
    }
    // The frog drifts between lanes as it runs, and throws from the lane it is in.
    if (Math.floor(this.elapsed / 2.6) !== Math.floor((this.elapsed - dt) / 2.6)) chase.lane = this.pick([0, 1, 2]);
    chase.nextThrow -= realDt;
    if (chase.nextThrow <= 0) {
      // Only where the crate has room of its own; otherwise try again a moment later.
      const z = this.distance + chase.gap - 1.5, section = sectionFeature(z);
      const clear = chase.gap > 9 && !this.mountedRide && !this.wrongTurn && !this.nearTurn(z)
        && !(section && z > section.start - 20 && z < section.end + 10)
        && !this.items.some(item => isRunObstacle(item.kind) && Math.abs(item.z - z) < 6);
      if (clear) { this.add(z, chase.lane, "crate", { thrownAt: this.elapsed }); chase.throws++; }
      chase.nextThrow = clear ? 3.5 + this.random() * 3 : .5;
    }
    return true;
  }

  private fallFromCourse(kind: FeatureKind | "fork", at: number, reason: string, hint: string) {
    this.fallObstacle = { id: -1, kind: "long-gap", z: at + obstacleHalfDepth("long-gap", at), lane: 1, span: 3, done: true, feature: kind };
    this.fallVelocity = Math.min(0, this.verticalSpeed);
    this.fail(reason, hint);
  }

  private advanceRide(previousDistance: number, speed: number) {
    if (this.mountedRide) {
      if (this.distance >= this.mountedRide.end) {
        if (this.mountedRide.kind === "rope") this.ropeLandedAt = this.elapsed;
        this.mountedRide = undefined; this.ridesDone++;
      }
      return true;
    }
    const ride = sectionFeature(this.distance);
    if (!ride || ride.kind === "bridge" || previousDistance >= ride.start || this.distance < ride.start) return true;
    if (ride.kind === "rope" && this.altitude < .25 && !this.invincible) {
      this.fallFromCourse("rope", ride.start, "没抓住绳索", isDownhillRope(ride) ? "跑到崖边时跳起来，抓住滑索滑下去。" : "靠近桥沿时跳起来，抓住滑索越过水面。");
      return false;
    }
    this.mountedRide = ride;
    this.rideTakeoff = this.altitude;
    this.rideTakeoffGrade = this.verticalSpeed / speed;
    this.altitude = this.verticalSpeed = this.jump = this.jumpCount = this.jumpBuffer = this.slide = this.danger = this.stumble = 0;
    return true;
  }

  private touchCoin(item: RunItem, dt: number) {
    let ahead = item.z - this.distance;
    if (!item.pulled && (this.magnet > 0 || this.fruit > 0) && ahead > -1 && ahead < 14) item.pulled = true;
    if (item.pulled) {
      // Fly toward the dog instead of vanishing, so the magnet is visible.
      item.z -= 26 * dt; ahead = item.z - this.distance;
      const k = Math.min(1, dt * 9);
      item.lane += (this.position - item.lane) * k;
      item.y = (item.y ?? .8) + (this.jumpHeight + .9 - (item.y ?? .8)) * k;
      if (ahead > .6) return;
    } else {
      const reach = Math.abs(ahead) < .9 && Math.abs(item.lane - this.position) < .5 && Math.abs((item.y ?? .8) - (this.jumpHeight + .8)) < 1.1;
      if (!reach && !(this.invincible && Math.abs(ahead) < .9)) return;
    }
    const tier = item.tier ?? "silver";
    item.done = true; this.coins++; this[tier]++; this.streak++; this.streakTimer = 4;
    this.coinScore += (tier === "diamond" ? 1000 : tier === "gold" ? 150 : 50) * this.multiplier * (this.double > 0 || this.fruit > 0 ? 2 : 1);
  }

  private touchPower(item: RunItem, kind: RunPowerKind) {
    if (Math.abs(item.z - this.distance) > .9 || Math.abs(item.lane - this.position) > .55 || this.flying) return;
    item.done = true;
    this.grantPower(kind);
  }

  private grantPower(kind: RunPowerKind) {
    this.powerPicked++; this.lastPower = kind;
    this[kind] = this.durations[kind];
    if (kind === "boost" || kind === "fruit") { this.danger = 0; this.stumble = 0; }
    if (kind === "balloon") { this.bike = 0; this.slide = 0; this.layAirCoins(); }
  }

  /** A ribbon of coins up in the air along the flight, holding a lane for a while, then drifting to another. */
  private layAirCoins() {
    const end = this.distance + this.courseSpeed * Math.max(0, this.balloon - BALLOON_DESCENT - .4);
    const lanes = [this.lane];
    for (let i = 0; i < 8; i++) lanes.push(this.pick([0, 1, 2]));
    for (let k = 0, z = this.distance + 14; z < end && k < 56; k++, z += 3) {
      const from = lanes[Math.floor(k / 8)], to = lanes[Math.floor(k / 8) + 1] ?? from, phase = k % 8;
      this.addCoin(z, phase < 5 ? from : from + (to - from) * (phase - 4) / 4, { y: FLY_HEIGHT + .8 });
    }
  }

  /** Chests, the coin rush's clocks and the dark run's lanterns. */
  private touchPickup(item: RunItem, kind: RunPickupKind) {
    if (Math.abs(item.z - this.distance) > .9 || Math.abs(item.lane - this.position) > .55 || Math.abs((item.y ?? .8) - (this.jumpHeight + .8)) > 1.6) return;
    item.done = true;
    if (kind === "clock") { this.clocks++; if (this.rush) this.rush.timeLeft += CLOCK_SECONDS; return; }
    if (kind === "lantern") { this.lanterns++; this.coinScore += 100; if (this.hunt) this.hunt.gap = Math.min(DARK_MAX_GAP, this.hunt.gap + LANTERN_GAP); return; }
    // A chest: mostly silver, often gold, now and then a power-up, rarely a diamond. Rolled from the
    // chest itself, so opening one never changes the course that follows.
    const roll = forkRoll(this.weatherSeed ^ 0x5bd1e995, item.id * 13 + 7);
    const reward: ChestReward = roll < .04 ? { diamond: 1 } : roll < .3 ? { gold: 3 + Math.floor(roll * 20) }
      : roll < .45 ? { power: STANDARD_POWERS[Math.floor(roll * 97) % STANDARD_POWERS.length] } : { silver: 40 + Math.floor(roll * 120) };
    this.chests++; this.lastChest = reward; this.coinScore += 250;
    for (const tier of ["silver", "gold", "diamond"] as const) this[tier] += reward[tier] ?? 0;
    if (reward.power) this.grantPower(reward.power);
  }

  /** Returns false when the run ended. */
  private touchObstacle(item: RunItem, kind: RunObstacleKind, landingVelocity: number) {
    const ahead = item.z - this.distance, depth = obstacleHalfDepth(kind, item.z);
    // High among the balloons, nothing on the road can touch the dog.
    if (this.flying) { if (ahead < -depth) item.done = true; return true; }
    if (ahead < -depth) {
      // Got past it. If the dog was still about to hit it a moment before, that was a near miss.
      if (item.threat) this.nearMiss(kind);
      item.done = true; return true;
    }
    if (ahead > depth) {
      const closing = this.courseSpeed + (item.rollFrom !== undefined ? item.roll ?? 0 : 0);
      if (item.threat === undefined && ahead - depth < closing * NEAR_WINDOW) item.threat = this.wouldHit(item, kind);
      return true;
    }
    if (!coversLane(item, this.position, .6)) return true;
    const clear = kind === "beam" ? this.slide > 0 && !this.airborne : this.altitude > CLEARANCE[kind];
    if (clear || this.invincible || this.grace > 0) return true;
    if (this.cycling && (kind === "block" || kind === "spikes")) {
      item.done = true; this.smashed++;
      return true;
    }

    item.done = true; this.hitAt = this.elapsed; this.streak = 0; this.streakTimer = 0;
    if (this.shield > 0) { this.shield = 0; this.grace = GRACE_TIME; this.shieldSaves++; return true; }
    const recoverable = kind === "bridge-branch" || kind === "crate" || (item.span !== 3 && (kind === "block" || kind === "beam"));
    if (!recoverable) {
      if (isFallObstacle(kind)) {
        this.fallObstacle = item;
        this.fallVelocity = Math.min(0, this.verticalSpeed, landingVelocity);
      }
      if (item.roll && kind === "boulder") this.fail(ROLLED_INTO[sceneAt(item.z)] ?? "被滚来的巨石撞倒了", "滚石只沿一条道滚过来，看准它在哪条道，提前换道，或者二段跳越过去。");
      else this.fail(...FAIL_TEXT[kind]);
      return false;
    }
    if (!this.stumbleFrom(CHASE_HIT_GAP, "被恐怖奶蛙抓住了", "撞到一次后要稳住，8秒内别再撞。")) return false;
    // Bumping a lane obstacle knocks the dog back toward the lane it came from.
    // Not on the log bridge, where leaving the middle would drop the dog off it.
    if (kind !== "bridge-branch" && Math.abs(this.lane - item.lane) < .5 && Math.abs(this.position - item.lane) > .05) this.lane = Math.round(this.position + (this.position < item.lane ? -.5 : .5));
    return true;
  }

  /** Whether the dog, left as it is right now, would run into this obstacle. Long pits are always jumped late, so they never count. */
  private wouldHit(item: RunItem, kind: RunObstacleKind) {
    if (kind === "long-gap" || this.invincible || this.flying || this.grace > 0 || (this.cycling && (kind === "block" || kind === "spikes"))) return false;
    if (!coversLane(item, this.position, .6)) return false;
    return kind === "beam" ? !(this.slide > 0 && !this.airborne) : this.altitude <= CLEARANCE[kind];
  }

  /** A last-moment dodge: points (under the coin multiplier) and a push to the coin streak. */
  private nearMiss(kind: RunObstacleKind) {
    this.nearMisses++; this.nearAt = this.elapsed; this.nearKind = kind;
    this.nearScore += NEAR_SCORE * this.multiplier * (this.double > 0 || this.fruit > 0 ? 2 : 1);
    this.streak += 2; this.streakTimer = 4;
  }

  /** Boulders and carts set off once they will meet the dog after rolling ROLL_TRAVEL metres, and keep going past it. */
  private rollItems(speed: number, dt: number) {
    for (const item of this.items) {
      if (!item.roll) continue;
      if (item.rollFrom === undefined) {
        if (item.z - this.distance > ROLL_TRAVEL * (item.roll + speed) / item.roll) continue;
        item.rollFrom = item.z; this.rollsStarted++;
      }
      item.z -= item.roll * dt;
    }
  }

  private fail(reason: string, hint: string) { this.phase = "caught"; this.captureTime = 0; this.reason = reason; this.deathHint = hint; }

  /** Whether the run can go on after it ended: not in the chase or the coin rush, which run on a clock. */
  get canRevive() { return (this.phase === "caught" || this.phase === "lost") && !this.chase && !this.rush; }
  /** Gold the next revive costs: it doubles each time within a run. */
  get reviveCost() { return REVIVE_COST * 2 ** this.revives; }

  /**
   * Gets the dog back on its feet: past whatever it fell into, on the right side of any corner it
   * missed or took the wrong way, with the road ahead cleared and a few seconds' protection.
   */
  revive() {
    if (!this.canRevive) return false;
    let at = this.distance;
    const fell = this.fallObstacle, section = sectionFeature(this.distance);
    if (fell?.feature === "rope" && section?.kind === "rope") at = section.end + 6;
    else if (fell && !fell.feature) at = fell.z + obstacleHalfDepth(fell.kind as RunObstacleKind, fell.z) + 2;
    // Corners behind the dog count as taken the right way: it carries on along the real road.
    for (const turn of this.turns) if (turn.z < at + 2 && (!turn.taken || turn.wrong)) { turn.taken = true; turn.wrong = undefined; }
    this.items = this.items.filter(item => !(isRunObstacle(item.kind) && item.z > at - 3 && item.z < at + 40));
    this.distance = at; this.fallObstacle = undefined; this.fallVelocity = 0;
    this.altitude = this.verticalSpeed = this.jump = this.jumpCount = this.jumpBuffer = this.slide = this.stumble = this.danger = 0;
    if (this.bridge) this.lane = this.position = 1;
    this.phase = "running"; this.captureTime = 0; this.reason = this.deathHint = ""; this.accumulator = 0;
    this.grace = REVIVE_GRACE; this.streak = 0; this.streakTimer = 0;
    if (this.hunt) this.hunt.gap = Math.max(this.hunt.gap, DARK_START_GAP);
    this.revives++;
    return true;
  }

  /** No ride or log bridge from `z` to `z + length`, so a balloon flight is not cut short. */
  private clearAhead(z: number, length: number) {
    for (let d = z; d <= z + length; d += 30) {
      const f = sectionFeature(d);
      if (f && d > f.start - RIDE_LEAD - 20 && d < f.end + 10) return false;
    }
    return true;
  }

  private random() { this.seed = (Math.imul(1664525, this.seed) + 1013904223) >>> 0; return this.seed / 4294967296; }
  private pick<T>(values: readonly T[]) { return values[Math.floor(this.random() * values.length)]; }
  private add(z: number, lane: number, kind: RunItemKind, extra: Partial<RunItem> = {}) { this.items.push({ id: this.sequence++, z, lane, kind, done: false, ...extra }); }
  private addCoin(z: number, lane: number, extra: Partial<RunItem> = {}) {
    const roll = this.random();
    // The coin rush pays out gold from the start.
    const goldChance = this.rush ? .15 : z < GOLD_START ? 0 : Math.min(.7, .1 + (z - GOLD_START) / 1300);
    const tier: CoinTier = z >= DIAMOND_START && roll < DIAMOND_CHANCE ? "diamond" : roll < goldChance ? "gold" : "silver";
    this.add(z, lane, "coin", { ...extra, tier });
  }

  private nearTurn(z: number) { return this.turns.some(turn => z > turn.z - 45 && z < turn.z + 25); }

  /**
   * A rolling hazard needs its whole run-up clear of corners and rides, in one scene. It lies further
   * on than a row, past the corners laid so far, so the next corner still to come must be far enough too.
   */
  private canRoll(z: number) {
    const end = z + ROLL_TRAVEL, scene = sceneAt(z);
    if (this.chase || z - this.origin < ROLL_START || !ROLLING_SCENES.includes(scene) || sceneAt(end) !== scene || this.nearTurn(end) || end + 45 >= this.nextTurn) return false;
    const section = sectionFeature(end);
    return !(section && end > section.start - 26 && end < section.end + 23);
  }

  private turnOutsideFeature(z: number, previous: number) {
    const section = sectionFeature(z);
    if (!section) return z;
    const before = section.start - 48, after = section.end + 34;
    if (z <= before || z >= after) return z;
    return before - previous >= 260 ? before : after;
  }

  private populate() {
    for (;;) {
      // Corners on the log bridge sit at fixed places along it; the others are spaced out between features.
      const bridgeZ = nextBridgeTurn(Math.max(this.lastTurnZ, this.distance)), onBridge = bridgeZ < this.nextTurn;
      const z = onBridge ? bridgeZ : this.nextTurn;
      if (z >= this.distance + 200) break;
      const scene = sceneAt(z), first = this.turnsMade++ === 0;
      // The middle corner of the bridge always splits; elsewhere about half of them do. Every mine
      // corner is a three-way junction with two traps.
      const middle = onBridge && z - (sectionFeature(z)?.start ?? 0) === BRIDGE_TURNS[1];
      const fork = onBridge ? middle || forkRoll(this.weatherSeed, z + 1) < .5 : !first && (scene === 2 || forkRoll(this.weatherSeed, z) < FORK_CHANCE);
      const three = !onBridge && fork && scene === 2;
      this.turns.push({ z, direction: this.random() < .5 ? "left" : "right", taken: false, ...(fork ? { fork } : {}), ...(three ? { three } : {}), ...(onBridge ? { bridge: true } : {}) });
      this.lastTurnZ = z;
      // Silver coins curve into the safe side of a fork, like a trail to follow. The log bridge already has its own.
      if (fork && !onBridge) for (let i = 0; i < 4; i++) this.add(z + 2 + i * 3, 1, "coin", { tier: "silver" });
      if (!onBridge) this.nextTurn = this.turnOutsideFeature(this.nextTurn + 260 + Math.floor(this.random() * 120), this.nextTurn);
    }
    while (sectionStart(this.nextFeatureSection) < this.distance + 150) {
      const feature = featureOf(this.nextFeatureSection);
      if (feature && feature.start >= this.distance + 150) break;
      if (feature) this.addFeatureItems(feature);
      this.nextFeatureSection++;
    }
    while (this.nextRow < this.distance + 150) {
      const z = this.nextRow;
      const speed = this.paceAt(z);
      const section = sectionFeature(z);
      const nearFeature = !!section && z > section.start - 26 && z < section.end + 23;
      const longGap = !this.nearTurn(z) && !nearFeature && this.row(z);
      // Leave at least ~1.15 s of reaction time between rows, a bit more early on. The chase spaces
      // its rows out a little more, leaving room for the frog's crates.
      const early = Math.max(0, 1 - (z - this.origin) / 600) + (this.chase ? .35 : 0);
      const landingSpace = longGap ? .42 : 0;
      // A rolling hazard waits further on than where it is met; keep the next row clear of it.
      const rollRoom = this.rolledRow ? 4 : 0; this.rolledRow = false;
      this.nextRow += speed * (1.15 + early * .6 + landingSpace) + rollRoom + this.random() * 8;
    }
  }

  private addFeatureItems(ride: CourseFeature) {
    if (ride.kind === "bridge") {
      // Branches lie across the log between its corners, more than 45 m before and 25 m after each.
      const branches = [28, 122, 208].map(offset => ride.start + offset);
      for (const z of branches) this.add(z, 1, "bridge-branch", { span: 3, feature: "bridge" });
      for (let z = ride.start + 6; z < ride.end - 4; z += 4.2) {
        const y = branches.some(near => Math.abs(z - near) < 6) ? 1.46 : .8;
        this.addCoin(z, 1, { y, feature: "bridge" });
      }
      return;
    }
    if (ride.kind === "rope") {
      const step = (ride.end - ride.start - 16) / 11;
      for (let i = 0; i < 12; i++) {
        const z = ride.start + 8 + i * step;
        this.addCoin(z, [1, 0, 2, 1][Math.floor(i / 3)], { y: riderHeightAt(z, ride) + .82, feature: "rope" });
      }
      return;
    }
    const first = this.pick([0, 2]);
    for (const [i, offset] of [24, 52, 81, 109, 137, 163, 189].entries()) {
      const z = ride.start + offset, clear = i % 2 ? 2 - first : first;
      this.add(z, clear === 0 ? 1 : 0, "cart-block", { span: 2, feature: "cart" });
      for (let j = -3; j <= 1; j++) this.addCoin(z + j * 2, clear, { y: 1.26, feature: "cart" });
    }
  }

  private row(z: number) {
    const scene = sceneAt(z);
    const roll = this.random();
    const pattern = this.rows++;
    let free = Math.floor(this.random() * 3);
    let jumpArc = false;
    const longGapDepth = obstacleHalfDepth("long-gap", z);
    const longGap = z - longGapDepth >= this.nextLongGap;

    if (longGap) {
      this.add(z, 1, "long-gap", { span: 3 });
      this.nextLongGap = z + 165 + this.random() * 65;
      free = 1;
    } else if (pattern < 2) {
      // Warm-up: an easy barrier in the middle lane, then one on a side.
      this.add(z, pattern === 0 ? 1 : this.pick([0, 2]), "beam");
      free = pattern === 0 ? this.pick([0, 2]) : 1;
    } else if (roll < .16) {
      const lane = Math.floor(this.random() * 3);
      this.add(z, lane, this.pick(["beam", "boulder"] as const));
      free = (lane + 1 + Math.floor(this.random() * 2)) % 3;
    } else if (roll < .42 && this.canRoll(z)) {
      // Something comes down one lane at the dog: a boulder, a giant snowball, or a runaway cart in the mine.
      const lane = Math.floor(this.random() * 3), kind = scene === 2 ? "runaway-cart" : "boulder";
      this.add(z + ROLL_TRAVEL, lane, kind, { roll: ROLL_SPEED[kind] });
      free = (lane + 1 + Math.floor(this.random() * 2)) % 3;
      this.rolledRow = true;
    } else if (roll < .62) {
      // A single two-lane obstacle leaves one clear route.
      const lane = this.pick([0, 1]);
      const kind = this.pick(["block", "spikes", "fire", "trap"] as const);
      this.add(z, lane, kind, { span: 2 });
      free = lane === 0 ? 2 : 0;
    } else {
      // Whole-road obstacle: jump or slide, no lane avoids it.
      const kind = this.pick(WHOLE_ROAD[scene] ?? WHOLE_ROAD[0]);
      this.add(z, 1, kind, { span: 3 });
      free = 1; jumpArc = kind !== "beam";
    }

    // Coins: a line leading into the free lane, or an arc over a jump.
    if (longGap) for (let i = -2; i <= 2; i++) this.addCoin(z + i * longGapDepth / 2, free, { y: 1 + 1.2 * (1 - (i / 2) ** 2) });
    else if (jumpArc) for (let i = -2; i <= 2; i++) this.addCoin(z + i * 1.8, free, { y: .8 + 1.1 * (1 - (i / 2.6) ** 2) });
    else for (let i = 0; i < 5; i++) this.addCoin(z - 10 + i * 2.6, free);
    if (this.rush) {
      // The coin rush: a second, denser line just after each row, and a clock every few rows.
      const lane = this.pick([0, 1, 2]);
      for (let i = 0; i < 6; i++) this.addCoin(z + 3.5 + i * 1.8, lane);
      if (pattern % 5 === 1) this.add(z + 15, lane, "clock");
    }
    // In the dark, lanterns to drive the frog back.
    if (this.hunt && pattern % 3 === 1) this.add(z + 6, free, "lantern");

    if (pattern >= 3 && pattern % 3 === 0) {
      const pickup = z + (longGap ? longGapDepth + 4 : 9);
      const normal = STANDARD_POWERS[this.powerIndex++ % STANDARD_POWERS.length];
      const roll = pickup >= FRUIT_START && this.powerIndex > 4 ? this.random() : 1;
      const fruitChance = sceneAt(pickup) === 2 ? 0 : FRUIT_CHANCE;
      const bike = fruitChance + BIKE_CHANCE, balloon = bike + BALLOON_CHANCE, chest = balloon + CHEST_CHANCE;
      const rare = roll < fruitChance ? "fruit" : pickup >= BIKE_START && roll < bike ? "bike"
        : pickup >= BALLOON_START && roll < balloon && !this.chase && this.clearAhead(pickup, 260) ? "balloon"
          : pickup >= CHEST_START && roll >= balloon && roll < chest ? "chest" : normal;
      this.add(pickup, free, rare);
    }
    return longGap;
  }
}
