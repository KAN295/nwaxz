export type RunAction = "left" | "right" | "jump" | "slide";
export type RunPhase = "ready" | "running" | "caught" | "paused" | "won" | "lost";
export type RunMode = "challenge" | "endless";
export type RunItemKind = "coin" | "block" | "gap" | "beam" | "spikes" | "boulder" | "fire" | "cliff" | "magnet" | "shield" | "boost";
export const isRunObstacle = (kind: RunItemKind) => ["block","gap","beam","spikes","boulder","fire","cliff"].includes(kind);
export type RunWeather = "sunny" | "rain" | "snow";
export function weatherAt(seed: number, distance: number): RunWeather {
  let hash=(seed^Math.imul(Math.floor(distance/300)+1,0x45d9f3b))>>>0;
  hash=Math.imul(hash^(hash>>>16),0x45d9f3b)>>>0;
  return (["sunny","rain","snow"] as const)[hash%3];
}
export const nightAt=(distance:number)=>distance>=1000&&Math.floor((distance-1000)/500)%2===0;
export type RunItem = { id: number; z: number; lane: number; kind: RunItemKind; done: boolean; span?: 3 };
export const RUN_SCENES = [
  { id: "aqueduct", name: "峡谷水渠", image: "/assets/runner/aqueduct-scene-v1.png" },
  { id: "temple", name: "遗迹长廊", image: "/assets/runner/temple-scene-v1.png" },
  { id: "mine", name: "矿洞轨道", image: "/assets/runner/mine-scene-v1.png" },
] as const;
export type RunTurn = { z: number; direction: "left" | "right"; taken: boolean };
export const RUN_RECORD_KEY = "nwaxz-runner-record-v1";
export const ENDLESS_RECORD_KEY = "nwaxz-runner-endless-record-v1";
export type RunRecord = { version: 1; distance: number; coins: number; score: number };
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

/** Fixed-step simulation; visibility/pause time never enters the world clock. */
export class RunnerWorld {
  phase: RunPhase = "ready";
  distance = 0;
  elapsed = 0;
  gait = 0;
  lane = 1;
  position = 1;
  coins = 0;
  jump = 0;
  jumpCount = 0;
  private altitude = 0;
  private verticalSpeed = 0;
  slide = 0;
  reason = "";
  deathHint = "";
  captureTime = 0;
  private pausedFrom: "running" | "caught" = "running";
  endless = false;
  items: RunItem[] = [];
  turns: RunTurn[] = [];
  turnCount = 0;
  lastTurnDirection: "left" | "right" = "left";
  hitAt = -10;
  magnet = 0;
  shield = 0;
  boost = 0;
  danger = 0;
  stumble = 0;
  streak = 0;
  coinScore = 0;
  private streakTimer = 0;
  private grace = 0;
  private rows = 0;
  private powerSequence = 0;
  private accumulator = 0;
  private nextRow = 38;
  private nextTurn = 180;
  private sequence = 0;
  private seed: number;
  readonly weatherSeed: number;
  readonly startScene: number;
  constructor(seed = 1, mode: RunMode = "challenge", startScene = 0) {
    this.startScene = Number.isInteger(startScene) && startScene>=0 && startScene<RUN_SCENES.length ? startScene : 0;
    this.weatherSeed=seed>>>0;
    this.seed = seed >>> 0; this.endless = mode === "endless"; this.populate();
  }
  get sceneIndex() { return (Math.floor(this.distance/450)+this.startScene)%RUN_SCENES.length; }
  get speed() { return Math.min(32, 14 + this.distance / 125) * (this.boost > 0 ? 1.5 : this.stumble > 0 ? .65 : 1); }
  get multiplier() { return Math.min(5, 1 + Math.floor(this.streak / 10)); }
  get score() { return Math.floor(this.distance) * 10 + this.coinScore; }
  get jumpHeight() { return this.altitude; }
  get weather() { return weatherAt(this.weatherSeed,this.distance); }
  get night() { return nightAt(this.distance); }
  get approachingTurn() { return this.turns.find(turn => !turn.taken && turn.z >= this.distance - 1); }
  start() { if (this.phase === "ready") this.phase = "running"; }
  pause() { if (this.phase === "running"||this.phase==="caught") { this.pausedFrom=this.phase; this.phase = "paused"; this.accumulator = 0; } }
  resume() { if (this.phase === "paused") this.phase = this.pausedFrom; }
  steer(lane:number) { if(this.phase==="running"&&Number.isInteger(lane)&&lane>=0&&lane<=2)this.lane=lane; }
  finishCapture(){if(this.phase==="caught"){this.captureTime=2.6;this.phase="lost";}}
  continue() { if (this.phase === "won") { this.endless = true; this.phase = "running"; this.accumulator = 0; } }
  action(action: RunAction) {
    if (this.phase !== "running") return;
    const turn = this.approachingTurn;
    if ((action === "left" || action === "right") && turn && turn.z - this.distance <= 16) {
      if (action !== turn.direction && this.boost === 0) { this.fail("转错方向"); return; }
      turn.taken = true; this.turnCount++; this.lastTurnDirection = turn.direction; this.lane = 1; this.position = 1;
      return;
    }
    if (action === "left") this.lane = Math.max(0, this.lane - 1);
    if (action === "right") this.lane = Math.min(2, this.lane + 1);
    if (action === "jump" && this.jumpCount < 2 && this.slide === 0) {
      this.jumpCount++;this.verticalSpeed=4.4;
      this.jump=(this.verticalSpeed+Math.sqrt(this.verticalSpeed**2+18.4*this.altitude))/9.2;
    }
    if (action === "slide" && this.jump === 0 && this.slide === 0) this.slide = .85;
  }
  advance(seconds: number) {
    if(this.phase==="caught"&&Number.isFinite(seconds)&&seconds>0){this.captureTime+=Math.min(seconds,.1);if(this.captureTime>=2.6)this.phase="lost";return;}
    if (this.phase !== "running" || !Number.isFinite(seconds) || seconds <= 0) return;
    // Drop stalled frame time instead of letting a background tab kill the player.
    this.accumulator += Math.min(seconds, .1);
    while (this.accumulator >= 1 / 120 && this.phase === "running") {
      this.accumulator -= 1 / 120; this.step(1 / 120);
    }
  }
  private step(dt: number) {
    this.elapsed += dt;
    this.gait += dt * Math.min(3.7, 1.9 + this.speed / 22);
    this.distance += this.speed * dt;
    this.position += (this.lane - this.position) * Math.min(1, dt * 18);
    if(this.jumpCount>0){
      this.altitude=Math.max(0,this.altitude+this.verticalSpeed*dt-4.6*dt*dt);this.verticalSpeed-=9.2*dt;
      this.jump=Math.max(0,this.jump-dt);
      if(this.altitude===0&&this.verticalSpeed<0){this.jump=0;this.jumpCount=0;this.verticalSpeed=0;}
    }
    this.slide = Math.max(0, this.slide - dt);
    for (const key of ["magnet", "shield", "boost", "danger", "stumble", "grace", "streakTimer"] as const) this[key] = Math.max(0,this[key]-dt);
    if (this.streakTimer === 0) this.streak = 0;
    const corner = this.approachingTurn;
    if (this.boost > 0 && corner && corner.z-this.distance <= 16) this.action(corner.direction);
    for (const item of this.items) {
      if (item.done) continue;
      const close = Math.abs(item.z-this.distance) <= (item.kind==="cliff"?4.5:.9);
      const sameLane = item.span === 3 || Math.abs(item.lane-this.position) <= (isRunObstacle(item.kind) ? .62 : .42);
      const attracted = item.kind === "coin" && this.magnet > 0 && item.z >= this.distance-.9 && item.z <= this.distance+12;
      if (!attracted && (!close || !sameLane)) continue;
      if (item.kind === "coin") {
        if (attracted || (this.jumpHeight < .45 && this.slide === 0) || this.boost > 0) {
          item.done = true; this.coins++; this.streak++; this.streakTimer = 4; this.coinScore += 50*this.multiplier;
        }
      } else if (item.kind === "magnet" || item.kind === "shield" || item.kind === "boost") {
        item.done = true;
        this[item.kind] = item.kind === "shield" ? 20 : item.kind === "magnet" ? 10 : 5;
        if (item.kind === "boost") { this.danger = 0; this.stumble = 0; }
      } else if (this.boost > 0 || this.grace > 0) {
        item.done = true;
      } else if ((item.kind === "beam" && this.slide > 0) || (item.kind !== "beam" && this.jumpHeight > (item.kind==="boulder"?1.2:item.kind==="fire"||item.kind==="spikes"?.65:item.kind==="cliff"?.3:.4))) {
        item.done = item.kind!=="cliff"||this.distance>item.z+4.2;
      } else {
        item.done = true;
        this.hitAt = this.elapsed;
        if (this.shield > 0) { this.shield = 0; this.grace = 1.25; }
        else if (["gap","cliff","spikes","boulder","fire"].includes(item.kind)) {
          const names:Record<string,string>={gap:"踩进裂缝",cliff:"没跳过断崖",spikes:"踩中地刺",boulder:"撞上巨石",fire:"碰到火焰"};
          this.fail(names[item.kind],item.kind==="boulder"?"换道躲开巨石，或用二段跳越过。":item.kind==="cliff"?"靠近断崖再跳，空中还能再跳一次。":"看准障碍起跳，空中可再跳一次。");return;
        }
        else if (item.span === 3) { this.fail(item.kind === "beam" ? "撞上低门了，要下滑" : "撞上倒木了，要跳跃"); return; }
        else if (this.danger > 0) { this.fail("被恐怖奶蛙抓住了"); return; }
        else { this.danger = 8; this.stumble = 1; this.grace = 1.25; this.streak = 0; this.streakTimer = 0; }
      }
    }
    if (this.turns.some(turn => !turn.taken && this.distance > turn.z)) { this.fail("错过转弯"); return; }
    if (!this.endless && this.distance >= 1000) { this.distance = 1000; this.phase = "won"; }
    this.items = this.items.filter(item => item.z > this.distance - 8);
    this.turns = this.turns.filter(turn => turn.z > this.distance - 20);
    this.populate();
  }
  private random() { this.seed = (Math.imul(1664525, this.seed) + 1013904223) >>> 0; return this.seed / 4294967296; }
  private populate() {
    while (this.nextTurn < this.distance + 180) {
      this.turns.push({ z: this.nextTurn, direction: this.random() < .5 ? "left" : "right", taken: false });
      this.nextTurn += 180;
    }
    while (this.nextRow < this.distance + 140) {
      const z = this.nextRow;
      // Reserve clear approach and recovery zones around every corner and the milestone.
      if (Math.min(z % 180, 180 - z % 180) > 30 && (this.endless || z < 970 || z > 1030)) {
        const lane = Math.floor(this.random() * 3), pattern = this.rows++ % 12;
        const scene = (Math.floor(z/450)+this.startScene)%3;
        const full = pattern%2===1;
        const kind:RunItemKind = full ? pattern===3?"beam":pattern===5?"cliff":pattern===9?"spikes":pattern===11?"fire":pattern===7?"block":scene===0?"gap":"block" : pattern===6?"boulder":pattern===4?"fire":(["block","beam","spikes"] as const)[Math.floor(this.random()*3)];
        this.items.push({ id: this.sequence++, z, lane: full ? 1 : lane, kind, done: false, ...(full ? {span:3 as const} : {}) });
        const safe = full ? 1 : (lane+1+Math.floor(this.random()*2))%3;
        if (pattern === 2) this.items.push({ id:this.sequence++, z, lane:[0,1,2].find(value=>value!==lane&&value!==safe)!, kind:"block", done:false });
        for (let i = 0; i < 3; i++) this.items.push({ id: this.sequence++, z: z + i * 2.8, lane: safe, kind: "coin", done: false });
        if (this.rows % 7 === 0) {
          const power = (["shield", "magnet", "boost"] as const)[this.powerSequence++ % 3];
          this.items.push({ id: this.sequence++, z: z+9, lane: safe, kind: power, done: false });
        }
      }
      this.nextRow += Math.max(24,Math.min(32,14+z/125)*1.35);
    }
  }
  private fail(reason: string, hint = "左右换道，上跳下滑；弯道按箭头转向。") { this.phase = "caught"; this.captureTime=0;this.reason = reason;this.deathHint=hint; }
}
