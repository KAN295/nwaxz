export type RunAction = "left" | "right" | "jump" | "slide";
export type RunPhase = "ready" | "running" | "paused" | "won" | "lost";
export type RunItem = { id: number; z: number; lane: number; kind: "coin" | "block" | "gap" | "beam"; done: boolean };
export type RunTurn = { z: number; direction: "left" | "right"; taken: boolean };
export const RUN_RECORD_KEY = "nwaxz-runner-record-v1";
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
  lane = 1;
  position = 1;
  coins = 0;
  jump = 0;
  slide = 0;
  reason = "";
  endless = false;
  items: RunItem[] = [];
  turns: RunTurn[] = [];
  turnCount = 0;
  private accumulator = 0;
  private nextRow = 44;
  private nextTurn = 180;
  private sequence = 0;
  private seed: number;
  constructor(seed = 1) { this.seed = seed >>> 0; this.populate(); }
  get speed() { return Math.min(28, 12 + this.distance / 140); }
  get score() { return Math.floor(this.distance) * 10 + this.coins * 50; }
  get jumpHeight() { return this.jump > 0 ? Math.sin(Math.PI * (1 - this.jump / .95)) : 0; }
  get approachingTurn() { return this.turns.find(turn => !turn.taken && turn.z >= this.distance - 1); }
  start() { if (this.phase === "ready") this.phase = "running"; }
  pause() { if (this.phase === "running") { this.phase = "paused"; this.accumulator = 0; } }
  resume() { if (this.phase === "paused") this.phase = "running"; }
  continue() { if (this.phase === "won") { this.endless = true; this.phase = "running"; this.accumulator = 0; } }
  action(action: RunAction) {
    if (this.phase !== "running") return;
    const turn = this.approachingTurn;
    if ((action === "left" || action === "right") && turn && turn.z - this.distance <= 16) {
      if (action !== turn.direction) { this.fail("弯道方向错了，再试一次！"); return; }
      turn.taken = true; this.turnCount++; this.lane = 1; this.position = 1;
      return;
    }
    if (action === "left") this.lane = Math.max(0, this.lane - 1);
    if (action === "right") this.lane = Math.min(2, this.lane + 1);
    if (action === "jump" && this.jump === 0 && this.slide === 0) this.jump = .95;
    if (action === "slide" && this.jump === 0 && this.slide === 0) this.slide = .85;
  }
  advance(seconds: number) {
    if (this.phase !== "running" || !Number.isFinite(seconds) || seconds <= 0) return;
    // Drop stalled frame time instead of letting a background tab kill the player.
    this.accumulator += Math.min(seconds, .1);
    while (this.accumulator >= 1 / 120 && this.phase === "running") {
      this.accumulator -= 1 / 120; this.step(1 / 120);
    }
  }
  private step(dt: number) {
    this.elapsed += dt;
    this.distance += this.speed * dt;
    this.position += (this.lane - this.position) * Math.min(1, dt * 18);
    this.jump = Math.max(0, this.jump - dt); this.slide = Math.max(0, this.slide - dt);
    for (const item of this.items) {
      if (item.done || Math.abs(item.z - this.distance) > .9) continue;
      if (Math.abs(item.lane - this.position) > .42) continue;
      if (item.kind === "coin") {
        if (this.jumpHeight < .45 && this.slide === 0) { item.done = true; this.coins++; }
      } else if ((item.kind === "beam" && this.slide > 0) || (item.kind !== "beam" && this.jumpHeight > .4)) {
        item.done = true;
      } else { this.fail(item.kind === "gap" ? "掉进了断开的水渠。试试向上跳！" : item.kind === "beam" ? "碰到横梁了。试试向下滑铲！" : "撞到木箱了。换道或跳过去！"); return; }
    }
    if (this.turns.some(turn => !turn.taken && this.distance > turn.z)) { this.fail("错过了弯道。看见提示后，在转弯区左右转向！"); return; }
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
      if (Math.min(z % 180, 180 - z % 180) > 30 && (z < 970 || z > 1030)) {
        const lane = Math.floor(this.random() * 3);
        const kind = (["block", "gap", "beam"] as const)[Math.floor(this.random() * 3)];
        this.items.push({ id: this.sequence++, z, lane, kind, done: false });
        const safe = (lane + 1 + Math.floor(this.random() * 2)) % 3;
        for (let i = 0; i < 3; i++) this.items.push({ id: this.sequence++, z: z + i * 2.8, lane: safe, kind: "coin", done: false });
      }
      this.nextRow += 22;
    }
  }
  private fail(reason: string) { this.phase = "lost"; this.reason = reason; }
}
