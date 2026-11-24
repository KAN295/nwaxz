/**
 * 奶狗快跑 — pure simulation. No DOM, no rendering; driven at a fixed 120 Hz step.
 *
 * Coordinates: `distance` runs along the (possibly turning) route, lanes are 0/1/2,
 * `altitude` is metres above the road.
 */
import { RIDE_LEAD, RIDE_START, SCENE_LENGTH, riderHeightAt, sceneAt, sectionFeature, type CourseFeature, type FeatureKind, type RideSection } from "./course.ts";

export { SCENE_LENGTH, sceneAt } from "./course.ts";

export type RunAction = "left" | "right" | "jump" | "slide";
export type RunPhase = "ready" | "running" | "caught" | "paused" | "won" | "lost";
export type RunMode = "challenge" | "endless";
export type RunObstacleKind = "block" | "gap" | "long-gap" | "beam" | "spikes" | "boulder" | "fire" | "trap" | "cart-block" | "bridge-branch";
export type CoinTier = "silver" | "gold" | "diamond";
const STANDARD_POWERS = ["shield", "magnet", "slow", "double", "boost"] as const;
export const RUN_POWERS = [...STANDARD_POWERS, "bike", "fruit"] as const;
export type RunPowerKind = typeof RUN_POWERS[number];
export const RUN_POWER_SECONDS: Record<RunPowerKind, number> = { magnet: 10, shield: 20, boost: 5, slow: 5, double: 8, bike: 9, fruit: 15 };
export type RunItemKind = "coin" | RunObstacleKind | RunPowerKind;
export type RunWeather = "sunny" | "rain" | "snow";
/** `pulled` coins are flying toward the dog under a magnet; `lane` is then fractional. */
export type RunItem = { id: number; z: number; lane: number; kind: RunItemKind; done: boolean; span?: 2 | 3; y?: number; pulled?: boolean; tier?: CoinTier; feature?: FeatureKind };
export type RunTurn = { z: number; direction: "left" | "right"; taken: boolean };
export type RunRecord = { version: 1; distance: number; coins: number; score: number };

const OBSTACLES: readonly string[] = ["block", "gap", "long-gap", "beam", "spikes", "boulder", "fire", "trap", "cart-block", "bridge-branch"];
export const isRunObstacle = (kind: RunItemKind): kind is RunObstacleKind => OBSTACLES.includes(kind);
export const isRunPower = (kind: RunItemKind): kind is RunPowerKind => (RUN_POWERS as readonly string[]).includes(kind);

export const RUN_SCENES = [
  { id: "aqueduct", name: "峡谷水渠", image: "/assets/runner/aqueduct-scene-v1.png", night: "/assets/runner/aqueduct-night-v1.png" },
  { id: "temple", name: "遗迹长廊", image: "/assets/runner/temple-scene-v1.png", night: "/assets/runner/temple-night-v1.png" },
  { id: "mine", name: "矿洞轨道", image: "/assets/runner/mine-scene-v1.png", night: "/assets/runner/mine-night-v1.png" },
] as const;
export const RUN_RECORD_KEY = "nwaxz-runner-record-v1";
export const ENDLESS_RECORD_KEY = "nwaxz-runner-endless-record-v1";
export const CHALLENGE_DISTANCE = 1000;
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
const STEP = 1 / 120;

/** Height the dog must exceed to pass over each obstacle; beams need sliding instead. */
const CLEARANCE: Record<RunObstacleKind, number> = { block: .85, gap: .05, "long-gap": .05, beam: Infinity, spikes: .5, boulder: 1.75, fire: .7, trap: .35, "cart-block": Infinity, "bridge-branch": .48 };
/** Half depth along the route. */
const DEPTH: Record<Exclude<RunObstacleKind, "long-gap">, number> = { block: .6, gap: 1.5, beam: .35, spikes: .7, boulder: .7, fire: .6, trap: 1.75, "cart-block": .8, "bridge-branch": .49 };
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
};

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
  ropeLandedAt = -Infinity;
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
  lastTurnDirection: "left" | "right" = "left";
  readonly weatherSeed: number;
  readonly startScene: number;
  /** Event counters for effects: they only ever increase. */
  powerPicked = 0;
  lastPower: RunPowerKind = "magnet";
  shieldSaves = 0;
  stumbles = 0;

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
  private nextLongGap = LONG_GAP_START;
  private nextFeatureSection = 0;
  private mountedRide?: RideSection;
  private rideTakeoff = 0;
  private rideTakeoffGrade = 0;

  constructor(seed = 1, mode: RunMode = "challenge", startScene = 0) {
    this.seed = seed >>> 0 || 1;
    this.weatherSeed = seed >>> 0;
    this.endless = mode === "endless";
    this.startScene = Number.isInteger(startScene) && startScene >= 0 && startScene < RUN_SCENES.length ? startScene : 0;
    this.populate();
  }

  private get courseSpeed() {
    const multiplier = this.boost > 0 ? 1.5 : this.fruit > 0 ? 1.27 : this.cycling ? 1.22 : this.mountedRide ? 1.17 : this.stumble > 0 ? .7 : 1;
    return baseSpeedAt(this.distance) * multiplier;
  }
  get timeScale() { return this.slow > 0 ? .7 : 1; }
  get speed() { return this.courseSpeed * this.timeScale; }
  get trapFall() { return !!this.fallObstacle; }
  get ride() { return this.mountedRide; }
  get bridge() {
    const section = sectionFeature(this.distance, this.startScene);
    return section.kind === "bridge" && this.distance >= section.start && this.distance < section.end ? section : undefined;
  }
  get upcomingFeature() {
    const section = sectionFeature(this.distance, this.startScene);
    return this.distance >= section.start - RIDE_LEAD && this.distance < section.start ? section : undefined;
  }
  get cycling() { return this.bike > 0 && !this.ride && !this.bridge; }
  get invincible() { return this.boost > 0 || this.fruit > 0; }
  get jumpHeight() { return this.mountedRide ? riderHeightAt(this.distance, this.mountedRide, this.rideTakeoff, this.rideTakeoffGrade) : this.altitude; }
  get airborne() { return this.altitude > 0 || this.verticalSpeed > 0; }
  get multiplier() { return Math.min(5, 1 + Math.floor(this.streak / 10)); }
  get score() { return Math.floor(this.distance) * 10 + this.coinScore + this.bonusDistanceScore; }
  get sceneIndex() { return sceneAt(this.distance, this.startScene); }
  get weather() { return weatherAt(this.weatherSeed, this.distance); }
  get night() { return nightAt(this.distance); }
  get approachingTurn() { return this.turns.find(turn => !turn.taken && turn.z >= this.distance - TURN_LATE); }
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
  continue() { if (this.phase === "won") { this.endless = true; this.phase = "running"; this.accumulator = 0; } }
  finishCapture() { if (this.phase === "caught") { this.captureTime = CAPTURE_TIME; this.phase = "lost"; } }
  /** Tilt control: jump straight to a lane. */
  steer(lane: number) { if (this.phase === "running" && Number.isInteger(lane) && lane >= 0 && lane <= 2 && !this.turnWindow) this.lane = lane; }

  action(action: RunAction) {
    if (this.phase !== "running") return;
    if (action === "left" || action === "right") {
      const turn = this.approachingTurn;
      if (turn && turn.z - this.distance <= TURN_WINDOW) {
        if (action !== turn.direction && this.fruit <= 0) { this.fail("转错了方向", "按屏幕提示的方向转弯。"); return; }
        turn.taken = true; this.turnCount++; this.lastTurnDirection = turn.direction;
        return;
      }
      this.lane = Math.max(0, Math.min(2, this.lane + (action === "left" ? -1 : 1)));
    } else if (this.mountedRide) return;
    else if (action === "jump") {
      if (this.jumpCount < 2) {
        this.slide = 0; this.jumpCount++; this.verticalSpeed = JUMP_VELOCITY; this.jump = this.airTime();
      } else this.jumpBuffer = .15;
    } else if (this.airborne) {
      // Slide in the air slams the dog down and slides on landing.
      this.verticalSpeed = Math.min(this.verticalSpeed, -14); this.jumpBuffer = 0; this.slide = SLIDE_TIME + this.airTime();
    } else this.slide = SLIDE_TIME;
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
    if (this.double > 0 || this.fruit > 0) {
      const scoredMetre = Math.floor(this.endless ? this.distance : Math.min(this.distance, CHALLENGE_DISTANCE));
      this.bonusDistanceScore += (scoredMetre - previousMetre) * 10;
    }
    this.gait += dt * Math.min(3.6, 1.8 + speed / 20);
    const bridge = this.bridge, upcoming = this.upcomingFeature;
    if (this.invincible && (bridge || (upcoming?.kind === "bridge" && upcoming.start - this.distance <= 18))) this.lane = 1;
    this.position += (this.lane - this.position) * Math.min(1, realDt * LANE_RATE);
    if (Math.abs(this.lane - this.position) < .002) this.position = this.lane;

    let landingVelocity = 0;
    if (this.airborne) {
      this.verticalSpeed -= GRAVITY * dt;
      this.altitude = Math.max(0, this.altitude + this.verticalSpeed * dt);
      this.jump = Math.max(0, this.jump - dt);
      if (this.altitude === 0 && this.verticalSpeed < 0) {
        landingVelocity = this.verticalSpeed;
        this.verticalSpeed = 0; this.jumpCount = 0; this.jump = 0;
        if (this.jumpBuffer > 0) { this.jumpBuffer = 0; this.action("jump"); }
      }
    }
    for (const key of ["slide", "danger", "stumble", "grace", "streakTimer", "jumpBuffer"] as const) this[key] = Math.max(0, this[key] - dt);
    for (const power of RUN_POWERS) this[power] = Math.max(0, this[power] - realDt);
    if (this.streakTimer === 0) this.streak = 0;

    if (!this.advanceRide(previousDistance, speed)) return;
    if (bridge && Math.abs(this.position - 1) > .37 && this.altitude <= .11 && !this.invincible) {
      this.fallFromCourse("bridge", this.distance, "掉下了独木桥", "过桥时留在中间，跳过横枝。");
      return;
    }

    const turn = this.approachingTurn;
    if (turn && this.invincible && turn.z - this.distance <= 16) this.action(turn.direction);
    if (turn && this.distance > turn.z + TURN_LATE - .01 && !turn.taken) { this.fail("冲出了弯道", "看到屏幕提示后及时转弯。"); return; }

    for (const item of this.items) {
      if (item.done || (item.feature && item.feature !== (bridge?.kind ?? this.mountedRide?.kind))) continue;
      if (item.kind === "coin") this.touchCoin(item, dt);
      else if (isRunPower(item.kind)) this.touchPower(item, item.kind);
      else if (isRunObstacle(item.kind) && !this.touchObstacle(item, item.kind, landingVelocity)) return;
    }

    if (!this.endless && this.distance >= CHALLENGE_DISTANCE) { this.distance = CHALLENGE_DISTANCE; this.phase = "won"; }
    this.items = this.items.filter(item => item.z + (item.kind === "long-gap" ? obstacleHalfDepth(item.kind, item.z) : 0) > this.distance - 10);
    this.turns = this.turns.filter(t => t.z > this.distance - 30);
    this.populate();
  }

  private fallFromCourse(kind: FeatureKind, at: number, reason: string, hint: string) {
    this.fallObstacle = { id: -1, kind: "long-gap", z: at + obstacleHalfDepth("long-gap", at), lane: 1, span: 3, done: true, feature: kind };
    this.fallVelocity = Math.min(0, this.verticalSpeed);
    this.fail(reason, hint);
  }

  private advanceRide(previousDistance: number, speed: number) {
    if (this.mountedRide) {
      if (this.distance >= this.mountedRide.end) {
        if (this.mountedRide.kind === "rope") this.ropeLandedAt = this.elapsed;
        this.mountedRide = undefined;
      }
      return true;
    }
    const ride = sectionFeature(this.distance, this.startScene);
    if (ride.kind === "bridge" || previousDistance >= ride.start || this.distance < ride.start) return true;
    if (ride.kind === "rope" && this.altitude < .25 && !this.invincible) {
      this.fallFromCourse("rope", ride.start, "没抓住绳索", "靠近桥沿时跳起来，抓住滑索越过水面。");
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
    if (Math.abs(item.z - this.distance) > .9 || Math.abs(item.lane - this.position) > .55) return;
    item.done = true; this.powerPicked++; this.lastPower = kind;
    this[kind] = RUN_POWER_SECONDS[kind];
    if (kind === "boost" || kind === "fruit") { this.danger = 0; this.stumble = 0; }
  }

  /** Returns false when the run ended. */
  private touchObstacle(item: RunItem, kind: RunObstacleKind, landingVelocity: number) {
    const ahead = item.z - this.distance, depth = obstacleHalfDepth(kind, item.z);
    if (ahead < -depth) { item.done = true; return true; }
    if (ahead > depth) return true;
    if (!coversLane(item, this.position, .6)) return true;
    const clear = kind === "beam" ? this.slide > 0 && !this.airborne : this.altitude > CLEARANCE[kind];
    if (clear || this.invincible || this.grace > 0) return true;
    if (this.cycling && (kind === "block" || kind === "spikes")) {
      item.done = true;
      return true;
    }

    item.done = true; this.hitAt = this.elapsed; this.streak = 0; this.streakTimer = 0;
    if (this.shield > 0) { this.shield = 0; this.grace = GRACE_TIME; this.shieldSaves++; return true; }
    const recoverable = item.span !== 3 && (kind === "block" || kind === "beam");
    if (!recoverable) {
      if (isFallObstacle(kind)) {
        this.fallObstacle = item;
        this.fallVelocity = Math.min(0, this.verticalSpeed, landingVelocity);
      }
      this.fail(...FAIL_TEXT[kind]);
      return false;
    }
    if (this.danger > 0) { this.fail("被恐怖奶蛙抓住了", "撞到一次后要稳住，8秒内别再撞。"); return false; }
    this.danger = DANGER_TIME; this.stumble = 1; this.grace = GRACE_TIME; this.stumbles++;
    // Bumping a lane obstacle knocks the dog back toward the lane it came from.
    if (Math.abs(this.lane - item.lane) < .5 && Math.abs(this.position - item.lane) > .05) this.lane = Math.round(this.position + (this.position < item.lane ? -.5 : .5));
    return true;
  }

  private fail(reason: string, hint: string) { this.phase = "caught"; this.captureTime = 0; this.reason = reason; this.deathHint = hint; }

  private random() { this.seed = (Math.imul(1664525, this.seed) + 1013904223) >>> 0; return this.seed / 4294967296; }
  private pick<T>(values: readonly T[]) { return values[Math.floor(this.random() * values.length)]; }
  private add(z: number, lane: number, kind: RunItemKind, extra: Partial<RunItem> = {}) { this.items.push({ id: this.sequence++, z, lane, kind, done: false, ...extra }); }
  private addCoin(z: number, lane: number, extra: Partial<RunItem> = {}) {
    const roll = this.random();
    const goldChance = z < GOLD_START ? 0 : Math.min(.7, .1 + (z - GOLD_START) / 1300);
    const tier: CoinTier = z >= DIAMOND_START && roll < DIAMOND_CHANCE ? "diamond" : roll < goldChance ? "gold" : "silver";
    this.add(z, lane, "coin", { ...extra, tier });
  }

  private nearTurn(z: number) { return this.turns.some(turn => z > turn.z - 45 && z < turn.z + 25); }

  private populate() {
    while (this.nextTurn < this.distance + 200) {
      this.turns.push({ z: this.nextTurn, direction: this.random() < .5 ? "left" : "right", taken: false });
      this.nextTurn += 260 + Math.floor(this.random() * 120);
      const section = sectionFeature(this.nextTurn, this.startScene);
      if (this.nextTurn > section.start - 48 && this.nextTurn < section.end + 34) this.nextTurn = section.end + 34;
    }
    while (this.nextFeatureSection * SCENE_LENGTH + RIDE_START < this.distance + 150) {
      this.addFeatureItems(sectionFeature(this.nextFeatureSection++ * SCENE_LENGTH, this.startScene));
    }
    while (this.nextRow < this.distance + 150) {
      const z = this.nextRow;
      const speed = baseSpeedAt(z);
      const milestone = !this.endless && z > CHALLENGE_DISTANCE - 40 && z < CHALLENGE_DISTANCE + 20;
      const section = sectionFeature(z, this.startScene);
      const nearFeature = z > section.start - 26 && z < section.end + 23;
      const longGap = !this.nearTurn(z) && !milestone && !nearFeature && this.row(z);
      // Leave at least ~1.15 s of reaction time between rows, a bit more early on.
      const early = Math.max(0, 1 - z / 600);
      const landingSpace = longGap ? .42 : 0;
      this.nextRow += speed * (1.15 + early * .6 + landingSpace) + this.random() * 8;
    }
  }

  private addFeatureItems(ride: CourseFeature) {
    if (ride.kind === "bridge") {
      this.add(ride.start + 24, 1, "bridge-branch", { span: 3, feature: "bridge" });
      for (let i = 0; i < 9; i++) {
        const z = ride.start + 6 + i * 4.2;
        this.addCoin(z, 1, { y: Math.abs(z - ride.start - 24) < 6 ? 1.46 : .8, feature: "bridge" });
      }
      return;
    }
    if (ride.kind === "rope") {
      for (let i = 0; i < 12; i++) {
        const z = ride.start + 8 + i * 3.4;
        this.addCoin(z, [1, 0, 2, 1][Math.floor(i / 3)], { y: riderHeightAt(z, ride) + .82, feature: "rope" });
      }
      return;
    }
    const first = this.pick([0, 2]);
    for (const [i, offset] of [24, 50, 76].entries()) {
      const z = ride.start + offset, clear = i % 2 ? 2 - first : first;
      this.add(z, clear === 0 ? 1 : 0, "cart-block", { span: 2, feature: "cart" });
      for (let j = -3; j <= 1; j++) this.addCoin(z + j * 2, clear, { y: 1.26, feature: "cart" });
    }
  }

  private row(z: number) {
    const scene = sceneAt(z, this.startScene);
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
    } else if (roll < .62) {
      // A single two-lane obstacle leaves one clear route.
      const lane = this.pick([0, 1]);
      const kind = this.pick(["block", "spikes", "fire", "trap"] as const);
      this.add(z, lane, kind, { span: 2 });
      free = lane === 0 ? 2 : 0;
    } else {
      // Whole-road obstacle: jump or slide, no lane avoids it.
      const kind = this.pick(scene === 0 ? ["gap", "gap", "block", "beam"] as const : scene === 1 ? ["block", "beam", "beam", "gap"] as const : ["beam", "block", "gap"] as const);
      this.add(z, 1, kind, { span: 3 });
      free = 1; jumpArc = kind !== "beam";
    }

    // Coins: a line leading into the free lane, or an arc over a jump.
    if (longGap) for (let i = -2; i <= 2; i++) this.addCoin(z + i * longGapDepth / 2, free, { y: 1 + 1.2 * (1 - (i / 2) ** 2) });
    else if (jumpArc) for (let i = -2; i <= 2; i++) this.addCoin(z + i * 1.8, free, { y: .8 + 1.1 * (1 - (i / 2.6) ** 2) });
    else for (let i = 0; i < 5; i++) this.addCoin(z - 10 + i * 2.6, free);

    if (pattern >= 3 && pattern % 3 === 0) {
      const pickup = z + (longGap ? longGapDepth + 4 : 9);
      const normal = STANDARD_POWERS[this.powerIndex++ % STANDARD_POWERS.length];
      const roll = pickup >= FRUIT_START && this.powerIndex > 4 ? this.random() : 1;
      const fruitChance = sceneAt(pickup, this.startScene) === 2 ? 0 : FRUIT_CHANCE;
      const rare = roll < fruitChance ? "fruit" : pickup >= BIKE_START && roll < fruitChance + BIKE_CHANCE ? "bike" : normal;
      this.add(pickup, free, rare);
    }
    return longGap;
  }
}
