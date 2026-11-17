/**
 * 奶狗快跑 — pure simulation. No DOM, no rendering; driven at a fixed 120 Hz step.
 *
 * Coordinates: `distance` runs along the (possibly turning) route, lanes are 0/1/2,
 * `altitude` is metres above the road.
 */
export type RunAction = "left" | "right" | "jump" | "slide";
export type RunPhase = "ready" | "running" | "caught" | "paused" | "won" | "lost";
export type RunMode = "challenge" | "endless";
export type RunObstacleKind = "block" | "gap" | "beam" | "spikes" | "boulder" | "fire" | "trap";
export type RunPowerKind = "magnet" | "shield" | "boost" | "spring";
export type RunItemKind = "coin" | RunObstacleKind | RunPowerKind;
export type RunWeather = "sunny" | "rain" | "snow";
/** `pulled` coins are flying toward the dog under a magnet; `lane` is then fractional. */
export type RunItem = { id: number; z: number; lane: number; kind: RunItemKind; done: boolean; span?: 3; y?: number; pulled?: boolean };
export type RunTurn = { z: number; direction: "left" | "right"; taken: boolean };
export type RunRecord = { version: 1; distance: number; coins: number; score: number };

const OBSTACLES: readonly string[] = ["block", "gap", "beam", "spikes", "boulder", "fire", "trap"];
const POWERS: readonly string[] = ["magnet", "shield", "boost", "spring"];
export const isRunObstacle = (kind: RunItemKind): kind is RunObstacleKind => OBSTACLES.includes(kind);
export const isRunPower = (kind: RunItemKind): kind is RunPowerKind => POWERS.includes(kind);

export const RUN_SCENES = [
  { id: "aqueduct", name: "峡谷水渠", image: "/assets/runner/aqueduct-scene-v1.png", night: "/assets/runner/aqueduct-night-v1.png" },
  { id: "temple", name: "遗迹长廊", image: "/assets/runner/temple-scene-v1.png", night: "/assets/runner/temple-night-v1.png" },
  { id: "mine", name: "矿洞轨道", image: "/assets/runner/mine-scene-v1.png", night: "/assets/runner/mine-night-v1.png" },
] as const;
export const SCENE_LENGTH = 450;
export const RUN_RECORD_KEY = "nwaxz-runner-record-v1";
export const ENDLESS_RECORD_KEY = "nwaxz-runner-endless-record-v1";
export const CHALLENGE_DISTANCE = 1000;

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
const CLEARANCE: Record<RunObstacleKind, number> = { block: .85, gap: .05, beam: Infinity, spikes: .5, boulder: 1.75, fire: .7, trap: .8 };
/** Half depth along the route. */
const DEPTH: Record<RunObstacleKind, number> = { block: .6, gap: 1.5, beam: .35, spikes: .7, boulder: .7, fire: .6, trap: .8 };

export function weatherAt(seed: number, distance: number): RunWeather {
  let hash = (seed ^ Math.imul(Math.floor(distance / 300) + 1, 0x45d9f3b)) >>> 0;
  hash = Math.imul(hash ^ (hash >>> 16), 0x45d9f3b) >>> 0;
  return (["sunny", "rain", "snow"] as const)[hash % 3];
}
export const nightAt = (distance: number) => distance >= 1000 && Math.floor((distance - 1000) / 500) % 2 === 0;

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
  beam: ["撞上了低门", "整条路的低门要下滑钻过去。"],
  spikes: ["踩中了地刺", "换到别的道，或者跳过去。"],
  boulder: ["撞上了巨石", "巨石很高，换道躲开最稳。"],
  fire: ["碰到了火焰", "换到别的道，或者跳过去。"],
  trap: ["掉进了落穴", "留意地面的活动陷阱，及时跳开。"],
};

export class RunnerWorld {
  phase: RunPhase = "ready";
  distance = 0;
  elapsed = 0;
  gait = 0;
  lane = 1;
  position = 1;
  coins = 0;
  coinScore = 0;
  streak = 0;
  /** Seconds of jump left (kept for animation); 0 when grounded. */
  jump = 0;
  jumpCount = 0;
  slide = 0;
  magnet = 0;
  shield = 0;
  boost = 0;
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
  wallHits = 0;
  wallHitTime = -10;
  trapFalls = 0;
  springCharges = 0;
  springSaves = 0;
  wallHitSide: "left" | "right" | "" = "";

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

  constructor(seed = 1, mode: RunMode = "challenge", startScene = 0) {
    this.seed = seed >>> 0 || 1;
    this.weatherSeed = seed >>> 0;
    this.endless = mode === "endless";
    this.startScene = Number.isInteger(startScene) && startScene >= 0 && startScene < RUN_SCENES.length ? startScene : 0;
    this.populate();
  }

  get speed() {
    const base = Math.min(MAX_SPEED, BASE_SPEED + this.distance / 110);
    return base * (this.boost > 0 ? 1.5 : this.stumble > 0 ? .7 : 1);
  }
  get jumpHeight() { return this.altitude; }
  get airborne() { return this.altitude > 0 || this.verticalSpeed > 0; }
  get multiplier() { return Math.min(5, 1 + Math.floor(this.streak / 10)); }
  get score() { return Math.floor(this.distance) * 10 + this.coinScore; }
  get sceneIndex() { return sceneAt(this.distance, this.startScene); }
  get weather() { return weatherAt(this.weatherSeed, this.distance); }
  get night() { return nightAt(this.distance); }
  get approachingTurn() { return this.turns.find(turn => !turn.taken && turn.z >= this.distance - TURN_LATE); }
  /** True while a left/right input would take the next corner instead of changing lanes. */
  get turnWindow() { const turn = this.approachingTurn; return !!turn && turn.z - this.distance <= TURN_WINDOW; }
  /** Next obstacle the player still has to deal with. */
  get nextObstacle() {
    let best: RunItem | undefined;
    for (const item of this.items) if (!item.done && isRunObstacle(item.kind) && item.z > this.distance - 1 && (!best || item.z < best.z)) best = item;
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
        if (action !== turn.direction) { this.fail("转错了方向", "看清大箭头再转弯。"); return; }
        turn.taken = true; this.turnCount++; this.lastTurnDirection = turn.direction;
        return;
      }
      this.lane = Math.max(0, Math.min(2, this.lane + (action === "left" ? -1 : 1)));
    } else if (action === "jump") {
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

  private step(dt: number) {
    this.elapsed += dt;
    this.distance += this.speed * dt;
    this.gait += dt * Math.min(3.6, 1.8 + this.speed / 20);
    this.position += (this.lane - this.position) * Math.min(1, dt * LANE_RATE);
    if (Math.abs(this.lane - this.position) < .002) this.position = this.lane;

    if (this.airborne) {
      this.verticalSpeed -= GRAVITY * dt;
      this.altitude = Math.max(0, this.altitude + this.verticalSpeed * dt);
      this.jump = Math.max(0, this.jump - dt);
      if (this.altitude === 0 && this.verticalSpeed < 0) {
        this.verticalSpeed = 0; this.jumpCount = 0; this.jump = 0;
        if (this.jumpBuffer > 0) { this.jumpBuffer = 0; this.action("jump"); }
      }
    }
    for (const key of ["slide", "magnet", "shield", "boost", "danger", "stumble", "grace", "streakTimer", "jumpBuffer"] as const) this[key] = Math.max(0, this[key] - dt);
    if (this.streakTimer === 0) this.streak = 0;

    const turn = this.approachingTurn;
    if (turn && this.boost > 0 && turn.z - this.distance <= 16) this.action(turn.direction);
    if (turn && this.distance > turn.z + TURN_LATE - .01 && !turn.taken) { this.fail("冲出了弯道", "看到大箭头后，按箭头方向转弯。"); return; }

    for (const item of this.items) {
      if (item.done) continue;
      if (item.kind === "coin") this.touchCoin(item, dt);
      else if (isRunPower(item.kind)) this.touchPower(item, item.kind);
      else if (isRunObstacle(item.kind) && !this.touchObstacle(item, item.kind)) return;
    }

    if (!this.endless && this.distance >= CHALLENGE_DISTANCE) { this.distance = CHALLENGE_DISTANCE; this.phase = "won"; }
    this.items = this.items.filter(item => item.z > this.distance - 10);
    this.turns = this.turns.filter(t => t.z > this.distance - 30);
    this.populate();
  }

  private touchCoin(item: RunItem, dt: number) {
    let ahead = item.z - this.distance;
    if (!item.pulled && this.magnet > 0 && ahead > -1 && ahead < 14) item.pulled = true;
    if (item.pulled) {
      // Fly toward the dog instead of vanishing, so the magnet is visible.
      item.z -= 26 * dt; ahead = item.z - this.distance;
      const k = Math.min(1, dt * 9);
      item.lane += (this.position - item.lane) * k;
      item.y = (item.y ?? .8) + (this.altitude + .9 - (item.y ?? .8)) * k;
      if (ahead > .6) return;
    } else {
      const reach = Math.abs(ahead) < .9 && Math.abs(item.lane - this.position) < .5 && Math.abs((item.y ?? .8) - (this.altitude + .8)) < 1.1;
      if (!reach && !(this.boost > 0 && Math.abs(ahead) < .9)) return;
    }
    item.done = true; this.coins++; this.streak++; this.streakTimer = 4; this.coinScore += 50 * this.multiplier;
  }

  private touchPower(item: RunItem, kind: RunPowerKind) {
    if (Math.abs(item.z - this.distance) > .9 || Math.abs(item.lane - this.position) > .55) return;
    item.done = true; this.powerPicked++; this.lastPower = kind;
    if (kind !== "spring") this[kind] = kind === "shield" ? 20 : kind === "magnet" ? 10 : 5;
    if (kind === "boost") { this.danger = 0; this.stumble = 0; }
    if (kind === "spring") this.springCharges = 1;
  }

  /** Returns false when the run ended. */
  private touchObstacle(item: RunItem, kind: RunObstacleKind) {
    const ahead = item.z - this.distance, depth = DEPTH[kind];
    if (ahead < -depth) { if (kind === "trap" && !item.done) { item.done = true; this.trapFalls++; } else item.done = true; return true; }
    if (ahead > depth) return true;
    if (item.span !== 3 && Math.abs(item.lane - this.position) > .6) return true;
    const clear = kind === "beam" ? this.slide > 0 && !this.airborne : this.altitude > CLEARANCE[kind];
    if (clear || this.boost > 0 || this.grace > 0) {
      if (kind === "trap" && clear && this.boost === 0 && this.grace === 0) item.done = true;
      return true;
    }

    item.done = true; this.hitAt = this.elapsed; this.streak = 0; this.streakTimer = 0;
    if (this.shield > 0) { this.shield = 0; this.grace = GRACE_TIME; this.shieldSaves++; return true; }
    if (kind === "trap") {
      this.trapFalls++;
      if (this.springCharges > 0 && this.danger === 0) {
        this.springCharges = 0; this.springSaves++; this.hitWall(this.position < 1 ? "left" : "right");
        this.danger = DANGER_TIME; this.stumble = .85; this.grace = GRACE_TIME; this.stumbles++;
      } else {
        if (this.danger > 0) { this.fail("被恐怖奶蛙抓住了", "撞到一次后要稳住，8秒内别再撞。"); return false; }
        this.stumble = .85; this.grace = GRACE_TIME;
      }
      this.lane = this.lane < 1 ? 1 : this.lane - 1; return true;
    }
    const recoverable = item.span !== 3 && (kind === "block" || kind === "beam");
    if (!recoverable) {
      const [reason, hint] = FAIL_TEXT[kind];
      if (this.springCharges > 0) {
        this.springCharges = 0; this.springSaves++; this.hitWall(this.position < 1 ? "left" : "right");
        this.danger = DANGER_TIME; this.stumble = 1; this.grace = GRACE_TIME; this.stumbles++; return true;
      }
      this.fail(reason, hint); return false;
    }
    if (this.danger > 0) { this.fail("被恐怖奶蛙抓住了", "撞到一次后要稳住，8秒内别再撞。"); return false; }
    this.danger = DANGER_TIME; this.stumble = 1; this.grace = GRACE_TIME; this.stumbles++;
    if (Math.abs(this.position - item.lane) < .7 && (this.position < .25 || this.position > 1.75)) this.hitWall(this.position < 1 ? "left" : "right");
    // Bumping a lane obstacle knocks the dog back toward the lane it came from.
    if (Math.abs(this.lane - item.lane) < .5 && Math.abs(this.position - item.lane) > .05) this.lane = Math.round(this.position + (this.position < item.lane ? -.5 : .5));
    return true;
  }

  private hitWall(side: "left" | "right") {
    this.wallHits++; this.wallHitSide = side; this.wallHitTime = this.elapsed;
    this.hitAt = this.elapsed; this.stumble = 1; this.grace = GRACE_TIME;
  }

  private fail(reason: string, hint: string) { this.phase = "caught"; this.captureTime = 0; this.reason = reason; this.deathHint = hint; }

  private random() { this.seed = (Math.imul(1664525, this.seed) + 1013904223) >>> 0; return this.seed / 4294967296; }
  private pick<T>(values: readonly T[]) { return values[Math.floor(this.random() * values.length)]; }
  private add(z: number, lane: number, kind: RunItemKind, extra: Partial<RunItem> = {}) { this.items.push({ id: this.sequence++, z, lane, kind, done: false, ...extra }); }

  private nearTurn(z: number) { return this.turns.some(turn => z > turn.z - 45 && z < turn.z + 25); }

  private populate() {
    while (this.nextTurn < this.distance + 200) {
      this.turns.push({ z: this.nextTurn, direction: this.random() < .5 ? "left" : "right", taken: false });
      this.nextTurn += 260 + Math.floor(this.random() * 120);
    }
    while (this.nextRow < this.distance + 150) {
      const z = this.nextRow;
      const speed = Math.min(MAX_SPEED, BASE_SPEED + z / 110);
      const milestone = !this.endless && z > CHALLENGE_DISTANCE - 40 && z < CHALLENGE_DISTANCE + 20;
      if (!this.nearTurn(z) && !milestone) this.row(z);
      // Leave at least ~1.15 s of reaction time between rows, a bit more early on.
      const early = Math.max(0, 1 - z / 600);
      this.nextRow += speed * (1.15 + early * .6) + this.random() * 8;
    }
  }

  private row(z: number) {
    const difficulty = Math.min(1, z / 1500);
    const scene = sceneAt(z, this.startScene);
    const roll = this.random();
    const pattern = this.rows++;
    let free = Math.floor(this.random() * 3);
    let jumpArc = false;

    if (pattern < 2) {
      // Warm-up: one crate in the middle lane, then one on a side.
      this.add(z, pattern === 0 ? 1 : this.pick([0, 2]), "block");
      free = pattern === 0 ? this.pick([0, 2]) : 1;
    } else if (roll < .36 - difficulty * .08) {
      // One lane obstacle.
      const lane = Math.floor(this.random() * 3);
      this.add(z, lane, this.pick(["block", "block", "beam", "spikes", "fire", "trap"] as const));
      free = (lane + 1 + Math.floor(this.random() * 2)) % 3;
    } else if (roll < .62) {
      // Two lanes blocked, one way through.
      for (const lane of [0, 1, 2]) if (lane !== free) this.add(z, lane, this.pick(scene === 2 ? ["block", "boulder", "beam"] as const : ["block", "boulder", "fire", "spikes"] as const));
    } else {
      // Whole-road obstacle: jump or slide, no lane avoids it.
      const kind = this.pick(scene === 0 ? ["gap", "gap", "block", "beam"] as const : scene === 1 ? ["block", "beam", "beam", "gap"] as const : ["beam", "block", "gap"] as const);
      this.add(z, 1, kind, { span: 3 });
      free = 1; jumpArc = kind !== "beam";
    }

    // Coins: a line leading into the free lane, or an arc over a jump.
    if (jumpArc) for (let i = -2; i <= 2; i++) this.add(z + i * 1.8, free, "coin", { y: .8 + 1.1 * (1 - (i / 2.6) ** 2) });
    else for (let i = 0; i < 5; i++) this.add(z - 10 + i * 2.6, free, "coin");

    if (pattern > 3 && pattern % 5 === 0) this.add(z + 9, free, (["shield", "magnet", "boost", "spring"] as const)[this.powerIndex++ % 4]);
  }
}

export function sceneAt(distance: number, startScene: number) {
  return (Math.floor(Math.max(0, distance) / SCENE_LENGTH) + startScene) % RUN_SCENES.length;
}
