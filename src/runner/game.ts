import "./runner.css";
import { loadImage } from "../loading.ts";
import type { Settings } from "../settings.ts";
import type { AudioManager } from "../audio.ts";
import { RunnerTilt } from "./tilt.ts";
import { CAPTURE_GRAB_AT, CAPTURE_LAUGH_AT, MINECART_SURPRISE_ART } from "./animation.ts";
import { canAfford, DOG_LOOKS, getDogLook, LEGACY_WARDROBE_KEY, migrateLegacyWardrobe, ORIGINAL_LOOK, readWardrobe, WARDROBE_KEY, type CurrencyPurse } from "./shop.ts";
import type { RunnerRenderer3D } from "./renderer3d.ts";
import { FROG_EXTRA_ART } from "../escape/extra-art.ts";
import { completeMission, MISSIONS_KEY, missionAt, missionDone, missionText, missionValue, readMissionBook, rewardText, type Mission, type RunStats } from "./missions.ts";
import {
  RunnerWorld, RUN_SCENES, RUN_POWERS, RUN_POWER_SECONDS, CHASE_RECORD_KEY, CHASE_SECONDS, CHASE_START_GAP, ENDLESS_RECORD_KEY, LONG_GAP_START, GOLD_START, DIAMOND_START, NEAR_SCORE, ROLL_START, TURN_HINT_END, obstacleHalfDepth, readRunRecord, sceneAt,
  type RunAction, type RunPhase, type RunMode, type RunPowerKind, type RunTurn,
} from "./world.ts";

const TITLE = "奶狗快跑";
const WEATHER_NAME = { sunny: "晴", rain: "雨", snow: "雪" } as const;
const CUE_NAME: Record<string, string> = { gap: "裂缝", block: "倒木", beam: "低门", "bridge-branch": "桥上横枝" };
const KEYS: Record<string, RunAction> = {
  ArrowLeft: "left", a: "left", A: "left", ArrowRight: "right", d: "right", D: "right",
  ArrowUp: "jump", w: "jump", W: "jump", " ": "jump", ArrowDown: "slide", s: "slide", S: "slide",
};
const POWER_INFO = {
  magnet: { name: "磁铁", text: "附近货币自动飞过来" },
  shield: { name: "护盾", text: "可以挡住一次撞击" },
  boost: { name: "飞鞋冲刺", text: "加速无敌，自动转弯" },
  slow: { name: "沙漏", text: "5 秒内跑动和跳跃变慢" },
  double: { name: "双倍得分", text: "8 秒内路程和收币得分翻倍" },
  bike: { name: "自行车", text: "9 秒内可骑过倒木和乱石枯枝" },
  fruit: { name: "附魔金苹果", text: "15 秒附魔金身：无敌、加速、吸币、双倍得分、自动过弯" },
} satisfies Record<RunPowerKind, { name: string; text: string }>;
const newSeed = () => crypto.getRandomValues(new Uint32Array(1))[0];
/** Seconds the scene name stays up after the run enters a new scene. */
const SCENE_LABEL_SECONDS = 3.2;
/** Cheers for each thousand metres of an endless run. */
const MILESTONE_CHEERS = ["好样的！", "跑得漂亮！", "势不可挡！", "奶蛙望尘莫及！", "传说中的奶狗！"];
/** What is coming down the lane, by scene. */
const ROLLING_NAME: Record<number, string> = { 1: "石球滚来了", 2: "矿车冲过来了", 4: "滚石来了", 5: "大雪球滚来了" };
type RunMission = { slot: number; mission: Mission; done: boolean };

/** Corner prompt: forks and junctions first ask the player to look, then show the way once the turn is due. */
function turnCue(turn: RunTurn, due: boolean) {
  const other = turn.direction === "left" ? "右" : "左", word = turn.direction === "left" ? "左转" : "右转";
  if (!due && turn.three) return "<b>◀▲▶</b><span>前方三岔口</span><small>两条是陷阱</small>";
  if (!due && turn.fork) return turn.bridge ? "<b>◀▶</b><span>独木桥分岔</span><small>避开断木</small>" : "<b>◀▶</b><span>前方岔路</span><small>避开断桥</small>";
  const note = turn.three ? `直走是竖井 · ${other}边是断桥` : turn.fork ? `${other}边${turn.bridge ? "木头断了" : "是断桥"}` : "";
  return `<b>${turn.direction === "left" ? "◀" : "▶"}</b><span>${due ? "现在" : "前方"}${word}</span>${note ? `<small>${note}</small>` : ""}`;
}

export class RunnerGame {
  private mode: RunMode = "endless";
  private world = new RunnerWorld(newSeed(), this.mode);
  private shownScene = -1;
  private sceneLabelUntil = 0;
  private record = readRunRecord(null);
  private wardrobe = readWardrobe(null);
  private credited: CurrencyPurse = { silver: 0, gold: 0, diamond: 0 };
  private shopOpen = false;
  private shopQuery = "";
  private shopError = "";
  private pendingSkin?: { id: string };
  private shopObserver?: IntersectionObserver;
  private recordError = false;
  private renderer?: RunnerRenderer3D;
  private tilt = new RunnerTilt();
  private gyro: "off" | "waiting" | "on" = "off";
  private gyroMessage = "";
  private gyroTimer = 0;
  private ready = false;
  private error = "";
  private destroyed = false;
  private frame = 0;
  /** Set after the first frame that threw, so the console gets one report rather than one per frame. */
  private frameFailed = false;
  private last = 0;
  private shownPhase: RunPhase | "loading" = "loading";
  private captureAudio: "waiting" | "grab" | "laugh" = "waiting";
  private art: { dog?: HTMLImageElement; frog?: HTMLImageElement; laugh?: HTMLImageElement; hauntedLaugh?: HTMLImageElement } = {};
  private skinPortrait?: HTMLImageElement;
  /** Content bounds of each portrait cell, so every look fills its frame the same way. */
  private portraitBounds = new WeakMap<HTMLImageElement, Map<number, [number, number, number, number]>>();
  /** `dir` is the direction of the last swipe fired by this touch; a new one fires only in another direction. */
  private swipe?: { x: number; y: number; id: number; dir?: RunAction };
  private wakeLock?: { release(): Promise<void> };
  private seenApple = -1;
  private seenThrows = 0;
  private seenBumps = 0;
  private warnedTurn = -1;
  private urgentTurn = -1;
  private abort = new AbortController();
  private resize: ResizeObserver;
  private el: {
    main: HTMLElement; canvas: HTMLCanvasElement; panel: HTMLElement; distance: HTMLElement; score: HTMLElement; coins: HTMLElement;
    scene: HTMLElement; effects: HTMLElement; cue: HTMLElement; danger: HTMLElement; capture: HTMLElement; toast: HTMLElement; chase: HTMLElement;
    pop: HTMLElement; banner: HTMLElement;
  };
  private seenEvents = { power: 0, shield: 0, stumble: 0 };
  private toastTimer = 0;
  private missions = readMissionBook(null);
  /** The missions this run plays for (dealt before it started) and which of them it has done. */
  private runMissions: RunMission[] = [];
  /** Missions dealt during the last run, for the next one. */
  private dealt: Mission[] = [];
  private seenNear = 0;
  private seenNearScore = 0;
  private nearChain = 0;
  private lastNearAt = -10;
  private seenRolls = 0;
  private nextMilestone = 1000;
  private passedRecord = false;
  private banners: { html: string; kind: string }[] = [];
  private bannerTimer = 0;
  private popTimer = 0;

  constructor(private root: HTMLElement, private audio: AudioManager, private settings: Settings, private exit: () => void) {
    root.innerHTML = `
<main class="runner-screen" aria-label="${TITLE}">
  <canvas class="runner-canvas" aria-label="三轨跑道。方向键或滑动屏幕操作"></canvas>
  <header class="runner-top">
    <button class="runner-icon" data-run="pause" aria-label="暂停跑酷">Ⅱ</button>
    <div class="runner-meter"><strong id="run-distance">0<small>米</small></strong><span>得分 <b id="run-score">0</b></span></div>
    <div class="runner-coins"><i aria-hidden="true"></i><b id="run-coins">0</b></div>
  </header>
  <p class="runner-scene" id="runner-scene"></p>
  <div class="runner-chase" role="status" hidden></div>
  <div class="runner-effects" aria-label="道具效果"></div>
  <div class="runner-cue" role="status" hidden></div>
  <p class="runner-toast" role="status" hidden></p>
  <p class="runner-banner" role="status" hidden></p>
  <p class="runner-pop" aria-hidden="true" hidden></p>
  <p class="runner-danger" role="status" hidden>恐怖奶蛙追上来了！别再撞了</p>
  <section class="runner-capture" aria-live="polite" hidden><strong></strong><button data-run="skip-capture">跳过</button></section>
  <section class="runner-panel" aria-live="polite"></section>
  <nav class="runner-pad" aria-label="跑酷操作">
    <button data-run="left" aria-label="左换道或左转">◀</button>
    <button data-run="jump" aria-label="跳跃">▲</button>
    <button data-run="slide" aria-label="下滑">▼</button>
    <button data-run="right" aria-label="右换道或右转">▶</button>
  </nav>
</main>`;
    const $ = <T extends HTMLElement>(selector: string) => root.querySelector<T>(selector)!;
    this.el = {
      main: $("main"), canvas: $("canvas"), panel: $(".runner-panel"), distance: $("#run-distance"), score: $("#run-score"),
      coins: $("#run-coins"), scene: $("#runner-scene"), effects: $(".runner-effects"), cue: $(".runner-cue"),
      danger: $(".runner-danger"), capture: $(".runner-capture"), toast: $(".runner-toast"), chase: $(".runner-chase"),
      pop: $(".runner-pop"), banner: $(".runner-banner"),
    };
    this.loadRecord();
    try { this.missions = readMissionBook(localStorage.getItem(MISSIONS_KEY)); } catch { this.recordError = true; }
    try {
      const saved = localStorage.getItem(WARDROBE_KEY);
      this.wardrobe = saved ? readWardrobe(saved) : migrateLegacyWardrobe(localStorage.getItem(LEGACY_WARDROBE_KEY));
      if (!saved) this.persistWardrobe();
    } catch { this.recordError = true; }
    const signal = this.abort.signal;
    root.addEventListener("click", this.onClick, { signal });
    root.addEventListener("input", event => {
      const target = event.target;
      if (target instanceof HTMLInputElement && target.matches(".runner-shop-search")) { this.shopQuery = target.value; this.filterShop(); }
    }, { signal });
    document.addEventListener("keydown", this.onKey, { signal });
    window.addEventListener("deviceorientation", this.onOrientation, { signal });
    document.addEventListener("visibilitychange", () => { if (document.hidden) this.pause(); }, { signal });
    window.addEventListener("blur", () => this.pause(), { signal });
    window.addEventListener("pagehide", () => { this.pause(); this.save(); }, { signal });
    this.bindSwipe(signal);
    this.resize = new ResizeObserver(() => this.renderer?.resize());
    this.resize.observe(this.el.canvas);
    this.showPanel();
    void this.load();
    this.frame = requestAnimationFrame(this.tick);
    // Dev server only (stripped from production builds): lets QA scripts inspect the run.
    if (import.meta.env.DEV) (window as Window & { __runner?: RunnerGame }).__runner = this;
  }

  // ---------- loading ----------

  private async load() {
    this.error = ""; this.showPanel();
    try {
      const [dog, frog, laugh, hauntedLaugh, module] = await Promise.all([
        loadImage("/assets/runner/milk-dog-actions-v2.png"), loadImage("/assets/character/haunted-frog-directions-walk-v1.webp"),
        loadImage("/assets/character/milk-frog-atlas.webp"), loadImage(FROG_EXTRA_ART.directionLaugh.url), import("./renderer3d.ts"),
      ]);
      if (this.destroyed) return;
      this.art = { dog, frog, laugh, hauntedLaugh };
      this.renderer?.dispose();
      this.renderer = new module.RunnerRenderer3D(this.el.canvas, this.settings);
      await this.renderer.load();
      const look = getDogLook(this.wardrobe.equipped);
      if ("sprite" in look) {
        try {
          const image = await loadImage(look.sprite, 15000);
          if (!this.destroyed) this.applyDogLook(look.id, image);
        } catch { this.shopError = "已装备的皮肤暂时加载失败，请在商城重试。"; }
      }
      if (this.destroyed) { this.renderer.dispose(); return; }
      this.el.main.dataset.engine = "babylon";
      this.ready = true; this.shownPhase = "ready"; this.showPanel();
    } catch {
      if (this.destroyed) return;
      this.renderer?.dispose(); this.renderer = undefined;
      this.error = "3D场景加载失败，请重试或检查浏览器的 WebGL 设置。"; this.showPanel();
    }
  }

  // ---------- input ----------

  private bindSwipe(signal: AbortSignal) {
    const canvas = this.el.canvas;
    canvas.addEventListener("pointerdown", event => {
      if (this.world.phase !== "running") return;
      this.swipe = { x: event.clientX, y: event.clientY, id: event.pointerId };
      canvas.setPointerCapture(event.pointerId);
    }, { signal });
    // Fire as soon as the finger has travelled far enough, not on release: it feels much snappier.
    // The same touch can then bend into another direction (jump, then left) without lifting, but a
    // long swipe one way still counts once.
    canvas.addEventListener("pointermove", event => {
      const s = this.swipe;
      if (!s || event.pointerId !== s.id) return;
      const dx = event.clientX - s.x, dy = event.clientY - s.y;
      if (Math.hypot(dx, dy) < (s.dir ? 34 : 24)) return;
      const dir: RunAction = Math.abs(dx) > Math.abs(dy) ? (dx < 0 ? "left" : "right") : (dy < 0 ? "jump" : "slide");
      s.x = event.clientX; s.y = event.clientY;
      if (dir === s.dir) return;
      s.dir = dir;
      this.act(dir);
    }, { signal });
    const end = (event: PointerEvent) => { if (this.swipe?.id === event.pointerId) this.swipe = undefined; };
    canvas.addEventListener("pointerup", end, { signal });
    canvas.addEventListener("pointercancel", end, { signal });
  }

  private onClick = (event: Event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-run]");
    if (!button) return;
    const action = button.dataset.run ?? "";
    void this.audio.unlock();
    switch (action) {
      case "left": case "right": case "jump": case "slide": this.act(action); return;
      case "pause": this.pause(); return;
      case "exit": this.exit(); return;
      case "gyro": void this.toggleGyro(); return;
      case "calibrate": this.tilt.calibrate(); this.gyroMessage = "已重新校准"; this.showPanel(); return;
      case "help": this.showHelp(); return;
      case "shop": if (this.world.phase === "ready" || this.world.phase === "lost" || this.world.phase === "won") { this.shopOpen = true; this.shopQuery = ""; this.showPanel(); } return;
      case "shop-back": this.closeShop(); return;
      case "help-back": this.showPanel(); return;
      case "retry-art": void this.load(); return;
      case "skip-capture": this.world.finishCapture(); return;
      case "mode-endless": case "mode-chase":
        this.mode = action === "mode-endless" ? "endless" : "chase"; this.newWorld(); this.loadRecord(); this.showPanel(); return;
      case "start": if (this.ready) this.begin(); return;
      case "restart": this.newWorld(); this.begin(); return;
      case "play-endless": this.mode = "endless"; this.loadRecord(); this.newWorld(); this.begin(); return;
      case "resume": this.resume(); return;
      case "skin-prev": case "skin-next": {
        // Swap between owned looks right on the start screen.
        const owned = this.wardrobe.owned, at = owned.indexOf(this.wardrobe.equipped);
        const next = owned[(at + (action === "skin-next" ? 1 : owned.length - 1)) % owned.length];
        if (next && next !== this.wardrobe.equipped) void this.chooseLook(`equip-${next}`, false);
        return;
      }
    }
    if (action.startsWith("buy-") || action.startsWith("equip-")) void this.chooseLook(action);
  };

  private onKey = (event: KeyboardEvent) => {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    if (this.shopOpen) {
      if (event.key === "Escape" && !event.repeat) {
        event.preventDefault();
        this.closeShop();
      }
      return;
    }
    if (event.target instanceof HTMLInputElement) return;
    const phase = this.world.phase;
    if (event.key === "Escape" || event.key === "p" || event.key === "P") {
      event.preventDefault(); if (event.repeat) return;
      if (phase === "paused") this.resume(); else this.pause();
      return;
    }
    if (event.key === "Enter" && (phase === "ready" || phase === "lost" || phase === "won") && this.ready && !event.repeat) {
      event.preventDefault(); if (phase === "ready") this.begin(); else { this.newWorld(); this.begin(); }
      return;
    }
    const action = KEYS[event.key];
    if (action && phase === "running") { event.preventDefault(); if (!event.repeat) this.act(action); }
  };

  private act(action: RunAction) {
    if (this.world.phase !== "running") return;
    this.world.action(action);
    if (action === "jump" || action === "slide") this.audio.effect("tap");
  }

  // ---------- tilt ----------

  private async toggleGyro() {
    if (this.gyro !== "off") { this.gyro = "off"; clearTimeout(this.gyroTimer); this.gyroMessage = "倾斜控制已关闭"; this.showPanel(); return; }
    if (!window.isSecureContext || typeof DeviceOrientationEvent === "undefined") { this.gyroMessage = "此浏览器无法启用倾斜控制，请使用滑动或按钮。"; this.showPanel(); return; }
    try {
      const api = DeviceOrientationEvent as typeof DeviceOrientationEvent & { requestPermission?: () => Promise<string> };
      if (api.requestPermission && await api.requestPermission() !== "granted") {
        if (!this.destroyed) { this.gyroMessage = "未获得运动权限，可继续用滑动或按钮。"; this.showPanel(); }
        return;
      }
      if (this.destroyed) return;
      this.gyro = "waiting"; this.tilt.calibrate(); this.gyroMessage = "请握稳手机，正在校准…"; this.showPanel();
      this.gyroTimer = window.setTimeout(() => {
        if (this.gyro === "waiting") { this.gyro = "off"; this.gyroMessage = "未收到传感器数据，请使用滑动或按钮。"; this.showPanel(); }
      }, 4000);
    } catch {
      if (this.destroyed) return;
      this.gyro = "off"; this.gyroMessage = "倾斜控制未能启用，请使用滑动或按钮。"; this.showPanel();
    }
  }
  private onOrientation = (event: DeviceOrientationEvent) => {
    if (this.gyro === "off") return;
    const angle = screen.orientation?.angle ?? Number((window as Window & { orientation?: number }).orientation ?? 0);
    const lane = this.tilt.sample(event.beta, event.gamma, angle);
    if (lane === null) return;
    if (this.gyro === "waiting") { clearTimeout(this.gyroTimer); this.gyro = "on"; this.gyroMessage = "倾斜换道已开启，跳跃、下滑和转弯仍用滑动。"; this.showPanel(); }
    this.world.steer(lane);
  };

  // ---------- flow ----------

  private toast(html: string, kind: string, seconds = 1.8) {
    const el = this.el.toast;
    el.innerHTML = html; el.dataset.kind = kind; el.hidden = false;
    el.style.setProperty("--toast-time", `${seconds}s`);
    el.classList.remove("show"); void el.offsetWidth; el.classList.add("show");
    clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => { el.hidden = true; }, seconds * 1000);
  }
  private vibrate(pattern: number | number[]) { if (this.settings.vibration) navigator.vibrate?.(pattern); }

  private newWorld() {
    this.world = new RunnerWorld(newSeed(), this.mode);
    this.shownScene = -1;
    this.captureAudio = "waiting";
    this.shopOpen = false; this.credited = { silver: 0, gold: 0, diamond: 0 };
    this.seenEvents = { power: 0, shield: 0, stumble: 0 };
    this.seenApple = -1; this.seenThrows = 0; this.seenBumps = 0;
    this.el.toast.hidden = true;
    this.banners = []; clearTimeout(this.bannerTimer); this.el.banner.hidden = true;
    clearTimeout(this.popTimer); this.el.pop.hidden = true;
    this.warnedTurn = this.urgentTurn = -1;
  }

  /** A line under the score for milestones, records and missions; several in a row wait their turn. */
  private banner(html: string, kind: string) {
    this.banners.push({ html, kind });
    if (this.el.banner.hidden) this.nextBanner();
  }
  private nextBanner() {
    const next = this.banners.shift(), el = this.el.banner;
    if (!next) { el.hidden = true; return; }
    el.innerHTML = next.html; el.dataset.kind = next.kind; el.hidden = false;
    el.classList.remove("show"); void el.offsetWidth; el.classList.add("show");
    this.bannerTimer = window.setTimeout(() => this.nextBanner(), 2400);
  }
  /** The near-miss call-out, by the dog. */
  private pop(html: string) {
    const el = this.el.pop;
    el.innerHTML = html; el.hidden = false;
    el.classList.remove("show"); void el.offsetWidth; el.classList.add("show");
    clearTimeout(this.popTimer);
    this.popTimer = window.setTimeout(() => { el.hidden = true; }, 900);
  }

  private runStats(): RunStats {
    const w = this.world;
    return {
      mode: w.mode, distance: w.runDistance, silver: w.silver, gold: w.gold, score: w.score, nearMisses: w.nearMisses, doubleJumps: w.doubleJumps, slides: w.slides,
      forksCleared: w.forksCleared, ridesDone: w.ridesDone, powers: w.powerPicked, shieldSaves: w.shieldSaves, bestMultiplier: w.bestMultiplier, won: w.phase === "won", timeLeft: w.chase?.timeLeft ?? 0,
    };
  }

  /** Pays out any mission the run has just done and deals the next one into its slot. */
  private checkMissions() {
    if (!this.runMissions.some(entry => !entry.done)) return;
    const stats = this.runStats();
    for (const entry of this.runMissions) {
      if (entry.done || !missionDone(entry.mission, stats)) continue;
      entry.done = true;
      for (const key of ["silver", "gold", "diamond"] as const) this.wardrobe[key] = Math.min(1e9, this.wardrobe[key] + (entry.mission.reward[key] ?? 0));
      this.persistWardrobe();
      this.missions = completeMission(this.missions, entry.slot);
      this.dealt.push(missionAt(this.missions.active[entry.slot]));
      try { localStorage.setItem(MISSIONS_KEY, JSON.stringify(this.missions)); } catch { this.recordError = true; }
      this.banner(`<b>✓ 任务完成</b><span>${missionText(entry.mission)}</span><em>+${rewardText(entry.mission.reward)}</em>`, "mission");
      this.audio.effect("win");
    }
  }

  /** Near misses, rolling hazards setting off, every thousand metres and passing the longest run. */
  private syncMoments() {
    const w = this.world;
    if (w.nearMisses > this.seenNear) {
      const gained = w.nearScore - this.seenNearScore;
      this.nearChain = w.elapsed - this.lastNearAt < 2.6 ? this.nearChain + 1 : 1;
      this.seenNear = w.nearMisses; this.seenNearScore = w.nearScore; this.lastNearAt = w.elapsed;
      this.pop(`<b>${this.nearChain > 1 ? `惊险 ×${this.nearChain}` : "惊险！"}</b><span>+${gained}</span>`);
      this.audio.effect("tap"); this.vibrate(12);
    }
    if (w.rollsStarted > this.seenRolls) { this.seenRolls = w.rollsStarted; if (w.phase === "running") this.audio.effect("door"); }
    if (w.phase !== "running" || w.chase) return;
    if (w.runDistance >= this.nextMilestone) {
      const k = this.nextMilestone / 1000;
      this.banner(`<b>${this.nextMilestone} 米</b><span>${MILESTONE_CHEERS[Math.min(MILESTONE_CHEERS.length - 1, k - 1)]}</span>`, "milestone");
      this.audio.effect("coin");
      this.nextMilestone += 1000;
    }
    if (!this.passedRecord && w.runDistance > this.record.distance) {
      this.passedRecord = true;
      this.banner(`<b>新的最远纪录！</b><span>超过了 ${this.record.distance} 米</span>`, "record");
      this.audio.effect("win"); this.flash("record");
    }
  }
  private begin() {
    this.tilt.calibrate(); this.world.start(); this.last = 0;
    this.audio.setMode("normal"); this.audio.setPlaying(true);
    this.holdScreenOn(true);
    // The run plays for the missions dealt so far; any finished now are replaced from the next run on.
    this.runMissions = this.missions.active.map((index, slot) => ({ slot, mission: missionAt(index), done: false }));
    this.dealt = [];
    this.seenNear = this.seenNearScore = this.nearChain = this.seenRolls = 0; this.lastNearAt = -10;
    this.nextMilestone = 1000; this.passedRecord = this.record.distance < 300;
    if (this.world.chase) this.toast(`<b>夺回金苹果</b>恐怖奶蛙抢走了附魔金苹果，${CHASE_SECONDS} 秒内追上它！`, "fruit", 2.6);
  }
  private resume() {
    if (this.world.phase !== "paused") return;
    this.tilt.calibrate(); this.world.resume(); this.last = 0;
    this.audio.setPlaying((this.world.phase as RunPhase) === "running");
    this.holdScreenOn(true);
  }
  private pause() { this.world.pause(); this.swipe = undefined; this.audio.setPlaying(false); this.last = 0; this.holdScreenOn(false); }
  /** Keeps a phone's screen from dimming mid-run; where the browser cannot, nothing changes. */
  private holdScreenOn(on: boolean) {
    const api = (navigator as Navigator & { wakeLock?: { request(type: "screen"): Promise<{ release(): Promise<void> }> } }).wakeLock;
    if (!on) { void this.wakeLock?.release().catch(() => {}); this.wakeLock = undefined; return; }
    if (!api || this.wakeLock) return;
    api.request("screen").then(lock => { if (this.world.phase === "running" && !this.destroyed) this.wakeLock = lock; else void lock.release().catch(() => {}); }).catch(() => {});
  }

  private tick = (time: number) => {
    if (this.destroyed) return;
    // Book the next frame first: an error in one frame must never stop the game for good, which
    // used to leave it frozen until the page was reloaded.
    this.frame = requestAnimationFrame(this.tick);
    try {
      const coins = this.world.coins;
      if (!document.hidden) this.world.advance(this.last ? (time - this.last) / 1000 : 0);
      this.last = time;
      if (this.world.coins > coins) this.audio.effect("coin");
      this.sync();
      if (this.ready) this.renderer?.draw(this.world);
      this.drawPortraits(time / 1000);
    } catch (error) {
      if (!this.frameFailed) { this.frameFailed = true; console.error("奶狗快跑：这一帧出错，已跳过", error); }
    }
  };

  /** Pushes world state into the DOM; writes only when something changed. */
  private sync() {
    const w = this.world, el = this.el;
    this.creditCollectedCoins();
    const set = (node: HTMLElement, html: string) => { if (node.innerHTML !== html) node.innerHTML = html; };
    el.main.dataset.phase = this.ready ? w.phase : "loading";
    el.main.classList.toggle("runner-hit", w.elapsed - w.hitAt < .35);
    el.main.classList.toggle("runner-chased", w.phase === "running" && w.danger > 0);
    el.main.classList.toggle("runner-boost", w.phase === "running" && w.boost > 0);
    el.main.classList.toggle("runner-golden", w.phase === "running" && w.fruit > 0);
    set(el.distance, `${Math.floor(w.runDistance)}<small>米</small>`);
    this.syncChase();
    set(el.score, String(w.score));
    set(el.coins, `${w.silver}银 · ${w.gold}金 · ${w.diamond}钻`);
    // The scene name only comes up for a moment when the run enters a new scene (and at the start).
    if (w.sceneIndex !== this.shownScene) { this.shownScene = w.sceneIndex; this.sceneLabelUntil = w.elapsed + SCENE_LABEL_SECONDS; }
    const labelOn = w.phase === "running" && w.elapsed < this.sceneLabelUntil;
    if (labelOn) set(el.scene, [RUN_SCENES[w.sceneIndex].name, w.night ? "夜" : "", w.sceneIndex === 2 ? "" : WEATHER_NAME[w.weather]].filter(Boolean).join(" · "));
    el.scene.classList.toggle("show", labelOn);

    const effects = RUN_POWERS.filter(key => w[key] > 0)
      .map(key => `<span class="runner-effect runner-effect-${key}"><i aria-hidden="true"></i><em>${POWER_INFO[key].name}</em>${Math.ceil(w[key])}<u style="--left:${Math.round(w[key] / RUN_POWER_SECONDS[key] * 100)}%"></u></span>`).join("")
      + (w.multiplier > 1 ? `<span class="runner-combo">×${w.multiplier}</span>` : "");
    set(el.effects, effects);
    el.effects.hidden = w.phase !== "running";
    el.danger.hidden = w.phase !== "running" || w.danger === 0;

    this.syncCue();
    this.syncMoments();
    if (w.phase !== "ready") this.checkMissions();
    if (w.powerPicked !== this.seenEvents.power) {
      this.seenEvents.power = w.powerPicked;
      const info = POWER_INFO[w.lastPower];
      const apple = w.lastPower === "fruit";
      this.toast(`<b>${apple ? "✦ " : ""}${info.name}${apple ? " ✦" : ""}</b>${info.text}`, w.lastPower, apple ? 2.8 : 1.8);
      this.audio.effect(apple ? "win" : "coin");
      if (apple) { this.vibrate([30, 40, 60]); this.flash("apple"); }
    }
    // The golden apple announces itself as it drops from its tree.
    const apple = w.items.find(item => item.kind === "fruit" && !item.done && item.z - w.distance < 38 && item.z > w.distance);
    if (apple && apple.id !== this.seenApple && w.phase === "running") {
      this.seenApple = apple.id;
      this.toast("<b>✦ 附魔金苹果 ✦</b>从树上掉下来了，快接住！", "fruit", 2.2);
      this.audio.effect("coin");
    }
    if (w.wallBumps > this.seenBumps) { this.seenBumps = w.wallBumps; this.vibrate(70); this.audio.effect("tap"); }
    if (w.chase && w.chase.throws > this.seenThrows) { this.seenThrows = w.chase.throws; this.audio.effect("tap"); }
    if (w.shieldSaves !== this.seenEvents.shield) { this.seenEvents.shield = w.shieldSaves; this.toast("<b>护盾</b>挡住了撞击！", "shield"); }
    if (w.stumbles > this.seenEvents.stumble) {
      this.seenEvents.stumble = w.stumbles;
      this.audio.haunt({ allowNormalMode: true });
    }
    el.capture.hidden = w.phase !== "caught" || (w.trapFall && w.captureTime < .48);
    if (w.phase === "caught") set(el.capture.querySelector("strong")!, w.reason);

    if (this.ready && this.shownPhase !== w.phase) {
      if (w.phase === "caught" || w.phase === "lost" || w.phase === "won") { this.save(); this.audio.setPlaying(false); this.holdScreenOn(false); }
      if (w.phase === "won") { this.audio.effect("win"); this.flash("apple"); this.vibrate([40, 60, 40, 60, 120]); }
      if (w.chase?.escaped && w.phase === "lost") this.audio.haunt({ allowNormalMode: true });
      if (w.phase === "caught" && this.shownPhase === "running") this.vibrate(180);
      this.shownPhase = w.phase; this.showPanel();
    }
    // In the chase there is no grab from behind, so no whimper and laugh to go with it.
    if (this.ready && w.phase === "caught" && !w.trapFall && !w.chase) {
      if (this.captureAudio === "waiting" && w.captureTime >= CAPTURE_GRAB_AT) {
        this.captureAudio = "grab";
        this.audio.whimper();
      }
      if (this.captureAudio === "grab" && w.captureTime >= CAPTURE_LAUGH_AT) {
        this.captureAudio = "laugh";
        this.audio.haunt({ allowNormalMode: true });
      }
    }
  }

  /** Chase HUD: how far ahead the frog is, as a track from the dog to the frog, and the time left. */
  private syncChase() {
    const w = this.world, chase = w.chase, el = this.el.chase;
    el.hidden = !chase || !(w.phase === "running" || w.phase === "paused" || w.phase === "caught");
    if (!chase || el.hidden) return;
    const gap = Math.max(0, chase.gap), close = Math.max(0, Math.min(1, 1 - gap / (CHASE_START_GAP * 1.6)));
    const seconds = Math.ceil(chase.timeLeft), urgent = seconds <= 10;
    const html = `<span class="runner-chase-track"><i class="runner-chase-dog" style="left:${Math.round(close * 82)}%"></i><i class="runner-chase-frog"></i></span>`
      + `<b>相距 ${Math.round(gap)} 米</b><em class="${urgent ? "urgent" : ""}">${seconds} 秒</em>`;
    if (el.innerHTML !== html) el.innerHTML = html;
  }

  /** A brief full-screen flash for big moments. */
  private flash(kind: string) {
    const main = this.el.main;
    main.dataset.flash = kind;
    main.classList.remove("runner-flash"); void main.offsetWidth; main.classList.add("runner-flash");
  }

  /** One short prompt at a time: corners first, then whole-road obstacles. */
  private syncCue() {
    const w = this.world, cue = this.el.cue;
    let html = "", urgent = false, aboveRoad = false;
    if (w.phase === "running" && !w.wrongTurn && (w.ride || w.bridge || !w.invincible)) {
      const turn = w.approachingTurn, toTurn = turn ? turn.z - w.distance : Infinity;
      const next = w.nextObstacle;
      const feature = w.upcomingFeature;
      const requiredMove = next?.span === 3 && next.z - w.distance < w.speed * 1.6 && !(w.cycling && (next.kind === "block" || next.kind === "spikes")) ? next : undefined;
      const longGap = next?.kind === "long-gap" ? next : undefined;
      const toLip = longGap ? longGap.z - obstacleHalfDepth("long-gap", longGap.z) - w.distance : Infinity;
      // A boulder or cart already rolling down the dog's own lane.
      const rolling = w.items.find(item => item.roll && item.rollFrom !== undefined && !item.done && item.lane === w.lane && item.z > w.distance && item.z - w.distance < (w.speed + item.roll) * 1.6);
      if (w.ride?.kind === "rope") {
        aboveRoad = true;
        html = "<b>↔</b><span>左右摆动收币</span>";
      } else if (w.ride?.kind === "cart") {
        aboveRoad = true;
        const blocked = next?.kind === "cart-block" && next.z - w.distance < w.speed * 1.85 ? next : undefined;
        if (blocked) {
          urgent = blocked.z - w.distance < w.speed * .8;
          html = blocked.lane === 0 ? "<b>▶</b><span>右侧轨道畅通</span>" : "<b>◀</b><span>左侧轨道畅通</span>";
        } else html = "<b>↔</b><span>左右换轨</span>";
        if (this.wardrobe.equipped !== ORIGINAL_LOOK.id) html += `<img class="runner-cart-expression" src="${MINECART_SURPRISE_ART}" alt="">`;
      } else if (w.bridge) {
        aboveRoad = true;
        const branch = requiredMove?.kind === "bridge-branch" && !w.invincible ? requiredMove : undefined;
        if (turn && w.turnHints && toTurn < 55 && (!branch || turn.z < branch.z)) {
          urgent = w.turnWindow;
          html = turnCue(turn, urgent);
          this.announceTurn(turn.z, urgent);
        } else {
          urgent = !!branch && branch.z - w.distance < w.speed * .55;
          html = branch ? "<b>▲</b><span>跳过横枝</span>" : "<b>│</b><span>走桥中央</span>";
        }
      } else if (longGap && toLip < w.speed * 1.75 && !(w.turnHints && toTurn < 55 && toTurn < toLip)) {
        // A long pit just past a corner waits until the corner is taken.
        if (toLip >= 0) {
          urgent = w.jumpCount === 0 && toLip < w.speed * .19;
          html = `<b>▲▲</b><span>${urgent ? "现在起跳" : "前方长落穴"}</span><small>二段跳</small>`;
        } else if (w.jumpCount === 1) {
          urgent = w.jump < .39;
          html = `<b>▲</b><span>${urgent ? "再跳一次" : "空中准备再跳"}</span>`;
        }
      } else if (feature && (!requiredMove || requiredMove.z >= feature.start)) {
        aboveRoad = true;
        urgent = feature.start - w.distance < w.speed * .42;
        if (feature.kind === "rope") html = `<b>▲</b><span>${urgent ? "跳起来抓绳索" : "前方滑索"}</span>`;
        else if (feature.kind === "cart") html = "<b>↔</b><span>前方矿车</span>";
        else html = "<b>│</b><span>前方独木桥</span><small>走中间</small>";
      } else if (turn && toTurn < 55 && w.turnHints) {
        // Late in a run the corners carry no prompt at all: the player has to read the road.
        aboveRoad = true;
        urgent = w.turnWindow;
        html = turnCue(turn, urgent);
        this.announceTurn(turn.z, urgent);
      } else if (next?.kind === "crate" && next.lane === w.lane && next.z - w.distance < w.speed * 1.5) {
        // Only when the crate is in the dog's lane; the arrow points to a free side.
        urgent = next.z - w.distance < w.speed * .6;
        html = `<b>${w.lane === 0 ? "▶" : w.lane === 2 ? "◀" : "◀▶"}</b><span>奶蛙扔来木箱</span><small>换道或跳</small>`;
      } else if (rolling?.roll) {
        urgent = rolling.z - w.distance < (w.speed + rolling.roll) * .6;
        html = `<b>${w.lane === 0 ? "▶" : w.lane === 2 ? "◀" : "◀▶"}</b><span>${ROLLING_NAME[sceneAt(rolling.z)] ?? "滚石来了"}</span><small>换道或二段跳</small>`;
      } else if (requiredMove) {
        const slide = requiredMove.kind === "beam";
        urgent = requiredMove.z - w.distance < w.speed * .55;
        html = `<b>${slide ? "▼" : "▲"}</b><span>${slide ? "下滑" : "跳"}</span><small>${CUE_NAME[requiredMove.kind] ?? ""}</small>`;
      }
    }
    cue.hidden = !html;
    if (html && cue.innerHTML !== html) cue.innerHTML = html;
    cue.classList.toggle("now", urgent);
    cue.classList.toggle("above-road", aboveRoad);
  }

  private announceTurn(z: number, due: boolean) {
    if (this.warnedTurn !== z) { this.warnedTurn = z; this.audio.effect("coin"); }
    if (due && this.urgentTurn !== z) { this.urgentTurn = z; this.audio.effect("tap"); if (this.settings.vibration) navigator.vibrate?.(60); }
  }

  // ---------- records ----------

  private persistWardrobe(wardrobe = this.wardrobe) {
    try {
      localStorage.setItem(WARDROBE_KEY, JSON.stringify({ version: 2, ...wardrobe }));
      return true;
    } catch {
      this.recordError = true;
      return false;
    }
  }
  private creditCollectedCoins() {
    let changed = false;
    for (const key of ["silver", "gold", "diamond"] as const) {
      const gained = Math.max(0, this.world[key] - this.credited[key]);
      if (gained) { this.wardrobe[key] += gained; this.credited[key] = this.world[key]; changed = true; }
    }
    if (changed) this.persistWardrobe();
  }
  /** Buys or equips a look from the shop, or (with `inShop` false) switches between owned looks on the start screen. */
  private async chooseLook(action: string, inShop = true) {
    if ((inShop && !this.shopOpen) || this.pendingSkin) return;
    const buying = action.startsWith("buy-");
    const id = action.slice(buying ? 4 : 6);
    const look = id === ORIGINAL_LOOK.id ? ORIGINAL_LOOK : DOG_LOOKS.find(item => item.id === id);
    if (!look || buying && id === ORIGINAL_LOOK.id) return;
    const next = { ...this.wardrobe, owned: [...this.wardrobe.owned], equipped: id };
    if (buying) {
      const price = "price" in look ? look.price : {};
      if (next.owned.includes(id) || !canAfford(next, price)) return;
      for (const key of ["silver", "gold", "diamond"] as const) next[key] -= price[key] ?? 0;
      next.owned.push(id);
    } else if (!next.owned.includes(id)) return;

    const pending = this.pendingSkin = { id };
    this.shopError = "";
    this.showPanel();
    try {
      const image = "sprite" in look ? await loadImage(look.sprite, 15000) : undefined;
      if (this.destroyed || this.pendingSkin !== pending) return;
      if (!this.persistWardrobe(next)) { this.shopError = "皮肤未能保存，请重试。"; return; }
      this.wardrobe = next;
      this.applyDogLook(id, image);
    } catch {
      if (this.pendingSkin === pending) this.shopError = "皮肤加载失败，请重试。";
    } finally {
      if (this.pendingSkin === pending) {
        this.pendingSkin = undefined;
        if (!this.destroyed) this.showPanel();
      }
    }
  }

  private closeShop() {
    this.pendingSkin = undefined;
    this.shopOpen = false;
    this.showPanel();
    this.el.panel.querySelector<HTMLButtonElement>('[data-run="shop"]')?.focus();
  }

  private filterShop() {
    const query = this.shopQuery.trim().toLocaleLowerCase();
    for (const card of this.el.panel.querySelectorAll<HTMLElement>(".runner-shop-item")) {
      const look = getDogLook(card.dataset.skinId ?? "");
      card.hidden = !!query && !`${look.name} ${"rank" in look ? look.rank : ""}`.toLocaleLowerCase().includes(query);
    }
  }

  private applyDogLook(id: string, image?: HTMLImageElement) {
    this.renderer?.setDogLook(id, image);
    this.skinPortrait = image;
  }

  private recordKey() { return this.mode === "endless" ? ENDLESS_RECORD_KEY : CHASE_RECORD_KEY; }
  private loadRecord() {
    this.record = readRunRecord(null);
    try { this.record = readRunRecord(localStorage.getItem(this.recordKey())); } catch { this.recordError = true; }
  }
  private save() {
    this.creditCollectedCoins();
    const w = this.world;
    const merge = (a: typeof this.record) => ({ version: 1 as const, distance: Math.max(a.distance, Math.floor(w.runDistance)), coins: Math.max(a.coins, w.coins), score: Math.max(a.score, w.score) });
    this.record = merge(this.record);
    try {
      const stored = readRunRecord(localStorage.getItem(this.recordKey()));
      this.record = merge({ ...this.record, distance: Math.max(this.record.distance, stored.distance), coins: Math.max(this.record.coins, stored.coins), score: Math.max(this.record.score, stored.score) });
      localStorage.setItem(this.recordKey(), JSON.stringify(this.record));
    } catch { this.recordError = true; }
  }

  // ---------- panels ----------

  private showPanel() {
    const w = this.world, panel = this.el.panel;
    panel.hidden = this.ready && (w.phase === "running" || w.phase === "caught");
    if (panel.hidden) return;
    const btn = (action: string, text: string, kind = "primary", extra = "") => `<button data-run="${action}" class="${kind}" ${extra}>${text}</button>`;
    const note = this.recordError ? `<p class="runner-note" role="status">纪录未能保存。</p>` : "";
    const gyroRow = `${btn("gyro", this.gyro === "off" ? "倾斜控制：关" : "倾斜控制：开", "ghost")}${this.gyro === "on" ? btn("calibrate", "重新校准", "ghost") : ""}`;
    const gyroNote = this.gyroMessage ? `<p class="runner-note" role="status">${this.gyroMessage}</p>` : "";
    let html: string;
    if (!this.ready) {
      html = `<h2>${this.error ? "加载失败" : "正在准备跑道…"}</h2>${this.error ? `<p>${this.error}</p>${btn("retry-art", "重试")}` : `<div class="runner-spinner" aria-hidden="true"></div>`}${btn("exit", "返回", "ghost")}`;
    } else if (this.shopOpen) {
      const pending = this.pendingSkin?.id;
      const status = pending ? "正在加载皮肤…" : this.shopError;
      const originalActive = this.wardrobe.equipped === ORIGINAL_LOOK.id;
      html = `<h2>皮肤商城</h2><p>QS 2027 · 世界大学前 100 名（含并列 102 所）</p><p>银币 ${this.wardrobe.silver}　金币 ${this.wardrobe.gold}　钻石 ${this.wardrobe.diamond}</p>
        <input class="runner-shop-search" type="search" placeholder="搜索学校或名次" aria-label="搜索学校或名次">
        <div class="runner-shop-list"><div class="runner-shop-item" data-skin-id="original"><span class="runner-shop-swatch" style="--skin:#fff"></span><div><strong>默认奶狗</strong><small>原本的奶狗形象</small></div><button data-run="equip-original" ${pending || originalActive ? "disabled" : ""}>${originalActive ? "使用中" : "装备"}</button></div>${DOG_LOOKS.map(look => {
          const owned = this.wardrobe.owned.includes(look.id);
          const active = this.wardrobe.equipped === look.id && !!this.skinPortrait;
          const cost = (Object.entries(look.price) as [keyof CurrencyPurse, number][]).map(([key, n]) => `${n}${{ silver: "银币", gold: "金币", diamond: "钻石" }[key]}`).join(" · ");
          const disabled = !!pending || active || !owned && !canAfford(this.wardrobe, look.price);
          const label = active ? "使用中" : owned ? "装备" : "解锁";
          return `<div class="runner-shop-item" data-skin-id="${look.id}"><span class="runner-shop-preview" style="--skin:${look.color}" data-sprite="${look.sprite}"><img src="${look.logo}" alt="" loading="lazy"></span><div><strong>${look.name}</strong><small>QS #${look.rank} · ${cost}</small></div><button data-run="${owned ? `equip-${look.id}` : `buy-${look.id}`}" ${disabled ? "disabled" : ""}>${label}</button></div>`;
        }).join("")}</div>${status ? `<p class="runner-note" role="status">${status}</p>` : ""}${btn("shop-back", "返回", "ghost")}${note}`;
    } else if (w.phase === "ready") {
      const toggle = (action: string, label: string, on: boolean) => `<button data-run="${action}" aria-pressed="${on}">${label}</button>`;
      const look = getDogLook(this.wardrobe.equipped), switcher = this.wardrobe.owned.length > 1;
      const lookName = look.id === ORIGINAL_LOOK.id ? "奶狗" : look.name;
      const chase = this.mode === "chase";
      html = `
        <h2 class="runner-title">${TITLE}</h2>
        <div class="runner-roster">
          <figure class="runner-hero" style="--skin:${look.color}">
            ${switcher ? btn("skin-prev", "‹", "runner-skin-arrow", `aria-label="上一款皮肤"`) : ""}
            <canvas width="160" height="140" data-portrait="dog" aria-label="玩家：${lookName}"></canvas>
            ${switcher ? btn("skin-next", "›", "runner-skin-arrow next", `aria-label="下一款皮肤"`) : ""}
            <figcaption><span class="runner-look-name">${lookName}</span><small>${switcher ? "你 · 左右切换皮肤" : "你"}</small></figcaption>
          </figure>
          <span aria-hidden="true">VS</span>
          <figure><canvas width="160" height="140" data-portrait="frog" aria-label="恐怖奶蛙"></canvas><figcaption>恐怖奶蛙<small>${chase ? "抢走了金苹果" : "追赶者"}</small></figcaption></figure>
        </div>
        <div class="runner-seg" aria-label="玩法">${toggle("mode-endless", "无限模式", !chase)}${toggle("mode-chase", "夺回金苹果", chase)}</div>
        <p class="runner-mode-note">${chase ? `特别模式：${CHASE_SECONDS} 秒内追上抢走附魔金苹果的恐怖奶蛙。穿过雪原和赤岩峡谷，收币和冲刺拉近距离，撞到东西会被甩开，小心它扔来的木箱。` : "一直跑下去，被恐怖奶蛙追上就结束。"}</p>
        <p class="runner-record">最高分 <b>${this.record.score}</b>${chase ? "" : ` · 最远 <b>${this.record.distance}</b> 米`}</p>
        ${this.missionsHtml(false)}
        ${btn("start", chase ? "开始追击" : "开始奔跑")}
        ${btn("shop", "皮肤商城", "ghost")}
        <div class="runner-row">${btn("help", "玩法说明", "ghost")}${gyroRow}${btn("exit", "返回", "ghost")}</div>
        ${gyroNote}${note}`;
    } else if (w.phase === "paused") {
      html = `<h2>暂停</h2>${btn("resume", "继续")}${btn("restart", "重新开始", "ghost")}<div class="runner-row">${gyroRow}${btn("exit", "主菜单", "ghost")}</div>${gyroNote}`;
    } else html = this.resultHtml(btn, note);
    this.shopObserver?.disconnect(); this.shopObserver = undefined;
    panel.innerHTML = `<div class="runner-card">${html}</div>`;
    if (this.shopOpen) {
      const search = panel.querySelector<HTMLInputElement>(".runner-shop-search"); if (search) search.value = this.shopQuery; this.filterShop();
      const list = panel.querySelector(".runner-shop-list");
      const observer = new IntersectionObserver(entries => {
        for (const entry of entries) if (entry.isIntersecting) {
          const node = entry.target as HTMLElement;
          node.style.setProperty("--sprite", `url('${node.dataset.sprite}')`);
          observer.unobserve(node);
        }
      }, { root: list, rootMargin: "100px" });
      this.shopObserver = observer;
      panel.querySelectorAll<HTMLElement>(".runner-shop-preview").forEach(node => observer.observe(node));
    }
    panel.querySelector<HTMLButtonElement>(".primary")?.focus({ preventScroll: true });
  }

  /** The end of a run: what happened (with the frog laughing), the score, how it compares, and what next. */
  private resultHtml(btn: (action: string, text: string, kind?: string, extra?: string) => string, note: string) {
    const w = this.world, won = w.phase === "won", chase = w.chase;
    const seconds = Math.round(won && chase ? CHASE_SECONDS - chase.timeLeft : w.elapsed);
    const time = seconds >= 60 ? `${Math.floor(seconds / 60)}分${String(seconds % 60).padStart(2, "0")}` : `${seconds}秒`;
    const newBest = w.score > 0 && w.score >= this.record.score;
    const metres = Math.floor(w.runDistance), place = RUN_SCENES[w.sceneIndex].name;
    const kicker = won ? "特别模式 · 成功" : chase ? (chase.escaped ? "特别模式 · 时间到" : "特别模式 · 追击中断") : "游戏结束";
    const head = won
      ? `<div class="runner-celebrate"><canvas width="160" height="140" data-portrait="dog-win" aria-label="奶狗庆祝"></canvas><canvas class="runner-laugh" width="160" height="160" data-portrait="laugh" aria-label="奶蛙捧腹大笑"></canvas></div>
         <h2 class="runner-over-title">夺回金苹果！</h2><p class="runner-over-tip">还剩 <b>${Math.ceil(chase?.timeLeft ?? 0)}</b> 秒，时间奖励已计入得分。</p>`
      : `<div class="runner-over-head"><canvas class="runner-over-frog" width="120" height="120" data-portrait="haunt-laugh" aria-label="恐怖奶蛙捧腹大笑"></canvas>
           <div><h2 class="runner-over-reason">${w.reason}</h2><p class="runner-over-where">${place} · 第 ${metres} 米</p></div></div>
         <p class="runner-over-tip"><b>提示</b>${w.deathHint}</p>`;
    // Endless runs show how far this one got against the longest; the chase shows how close the dog came.
    const progress = chase
      ? won ? "" : `<div class="runner-progress"><i style="width:${Math.round(Math.max(0, Math.min(1, 1 - chase.gap / CHASE_START_GAP)) * 100)}%"></i><span>离奶蛙还差 ${Math.max(0, Math.round(chase.gap))} 米</span></div>`
      : `<div class="runner-progress"><i style="width:${this.record.distance ? Math.min(100, Math.round(metres / this.record.distance * 100)) : 100}%"></i><span>${metres >= this.record.distance ? "跑出了最远纪录" : `离最远 ${this.record.distance} 米还差 ${this.record.distance - metres} 米`}</span></div>`;
    return `
      <p class="runner-over-kicker">${kicker}</p>
      ${head}
      <div class="runner-over-score"><small>${won ? "本次得分" : "本局得分"}</small><strong>${w.score}</strong>${newBest ? `<em>新纪录</em>` : ""}</div>
      <div class="runner-stats runner-stats-4"><span><b>${metres}</b>米</span><span><b>${time}</b>用时</span><span><b>${w.silver}</b>银币</span><span><b>${w.gold + w.diamond}</b>金币·钻石</span></div>
      <p class="runner-over-extra">惊险闪避 <b>${w.nearMisses}</b> 次 · 最高连击 <b>×${w.bestMultiplier}</b>${w.ridesDone ? ` · 完成 <b>${w.ridesDone}</b> 段特殊路段` : ""}</p>
      ${progress}
      ${this.missionsHtml(true)}
      ${btn("restart", chase ? "再追一次" : "再跑一次")}
      <div class="runner-row">${chase ? btn("play-endless", "无限模式", "ghost") : ""}${btn("shop", "皮肤商城", "ghost")}${btn("exit", "主菜单", "ghost")}</div>
      <p class="runner-keyhint">按回车${chase ? "再追一次" : "再跑一次"}</p>${note}`;
  }

  /** The three missions: on the start screen what each pays; after a run how far it got with each, and what comes next. */
  private missionsHtml(afterRun: boolean) {
    const stats = this.runStats();
    const rows = afterRun && this.runMissions.length
      ? this.runMissions.map(({ mission, done }) => {
        if (done) return `<li class="done"><span>✓ ${missionText(mission)}</span><em>+${rewardText(mission.reward)}</em></li>`;
        const value = Math.max(0, Math.min(mission.target, missionValue(mission, stats)));
        return `<li><span>${missionText(mission)}</span><em>${value} / ${mission.target}</em><i style="width:${Math.round(value / mission.target * 100)}%"></i></li>`;
      })
      : this.missions.active.map(index => {
        const mission = missionAt(index);
        return `<li><span>${missionText(mission)}</span><em>${rewardText(mission.reward)}</em></li>`;
      });
    const next = afterRun && this.dealt.length ? `<p class="runner-missions-next">新任务：${this.dealt.map(missionText).join("；")}</p>` : "";
    return `<div class="runner-missions"><p class="runner-missions-title">任务<small>已完成 ${this.missions.completed} 个</small></p><ul>${rows.join("")}</ul>${next}</div>`;
  }

  private showHelp() {
    this.el.panel.innerHTML = `<div class="runner-card runner-help">
      <h2>玩法说明</h2>
      <div class="runner-keys"><span><kbd>←</kbd><kbd>→</kbd>换道 / 转弯</span><span><kbd>↑</kbd>跳（空中可再跳）</span><span><kbd>↓</kbd>下滑（空中按会急降）</span></div>
      <ul>
        <li>电脑：方向键或 WASD，空格跳，Esc 暂停，回车开始。手机：在画面上滑动，或用底部按钮。</li>
        <li>整条路的<b>倒木、裂缝</b>要跳过，<b>低门</b>要下滑；屏幕中间会提示。</li>
        <li>${LONG_GAP_START}米起会出现横跨三道的<b>长落穴</b>。靠近边缘起跳，在坑上方按提示再跳一次。</li>
        <li>单道只会出现<b>栏杆</b>或<b>巨石</b>。栏杆可换道或下滑，巨石可换道或二段跳。碰到栏杆或双道倒木会让奶蛙追近，8秒内再撞就被抓。已经在最左或最右道还往外换道，会<b>撞到路边</b>，同样会引来奶蛙。</li>
        <li>按弯道方向转弯；${TURN_HINT_END}米前屏幕会提示方向，之后要自己看路。<b>岔路口</b>两边都有路，其中一边通向<b>断桥</b>，走错会摔下去；银币会引向安全的一边。矿洞的<b>三岔口</b>只有一条活路：直走是竖井，另一边是断桥。</li>
        <li>峡谷水渠到桥沿时起跳抓住<b>滑索</b>，左右摆动收币；赤岩峡谷和雪原的滑索从高台一路滑到谷底。遗迹的<b>独木桥</b>横跨海面，要走中间、跳过横枝，桥上还有弯道和断掉的分岔。矿洞会自动登上<b>矿车</b>，左右换轨躲塌方。</li>
        <li>稀有<b>自行车</b>可骑过倒木和乱石枯枝。野生果树极少会掉下发光的<b>附魔金苹果</b>，滚进跑道后去接住它，可获得 15 秒附魔金身：无敌、加速、吸币、双倍得分。</li>
        <li>先收银币，${GOLD_START}米起出现金币，${DIAMOND_START}米起才有稀有钻石。磁铁吸取附近货币，护盾挡一次撞击，飞鞋冲刺无敌5秒。连续收取分数翻倍，最高×5。</li>
        <li><b>沙漏</b>让跑动和跳跃一起放慢5秒；<b>双倍得分</b>让8秒内的路程和收币得分翻倍。</li>
        <li>双道活动木板下是深坑，可提前跳过或换到空道。收集货币可在皮肤商城解锁 102 套 QS 2027 高校主题奶狗。</li>
        <li>${ROLL_START}米后，遗迹的<b>石球</b>、赤岩峡谷的<b>滚石</b>、雪原的<b>大雪球</b>会沿一条道朝你滚来，矿洞里还有冲过来的<b>失控矿车</b>。听到轰隆声就看清是哪条道，提前换道，或者二段跳越过去。</li>
        <li>眼看要撞上时才躲开（换道、起跳或下滑）算<b>惊险闪避</b>：加 ${NEAR_SCORE} 分（受连击倍率加成），并推高连击。</li>
        <li><b>任务</b>同时有三个，都要在一局之内完成，完成后马上得到银币、金币或钻石；换上的新任务从下一局开始算。</li>
        <li>无限模式的场景按路程依次切换：峡谷水渠、遗迹长廊、矿洞轨道、竹林小径、赤岩峡谷，偶尔经过雪原；1000米后进入较长的黑夜。</li>
        <li>特别模式<b>夺回金苹果</b>：恐怖奶蛙抢走了附魔金苹果在前面逃，${CHASE_SECONDS} 秒内追上它就赢。奶蛙比你稍慢，收银币、用冲刺能拉近距离，撞到东西或撞到路边会被甩开；它还会往后扔<b>木箱</b>，换道躲开或跳过去。</li>
      </ul>
      <button data-run="help-back" class="primary">知道了</button></div>`;
    this.el.panel.querySelector<HTMLButtonElement>(".primary")?.focus({ preventScroll: true });
  }

  private drawPortraits(time: number) {
    const panel = this.el.panel;
    if (panel.hidden) return;
    const paint = (key: string, image: HTMLImageElement | undefined, source: [number, number, number, number], bob: number, fit: boolean) => {
      const canvas = panel.querySelector<HTMLCanvasElement>(`[data-portrait="${key}"]`);
      if (!canvas || !image) return;
      const ctx = canvas.getContext("2d")!, [sx, sy, sw, sh] = source;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      if (!fit) {
        const size = Math.min(canvas.width, canvas.height);
        ctx.drawImage(image, sx, sy, sw, sh, (canvas.width - size) / 2, bob, size, size);
        return;
      }
      // Scale the drawing itself (not its cell) to the frame, standing on the bottom edge.
      const scale = Math.min(canvas.width * .92 / sw, canvas.height * .9 / sh), w = sw * scale, h = sh * scale;
      ctx.drawImage(image, sx, sy, sw, sh, (canvas.width - w) / 2, canvas.height - h - 4 + bob, w, h);
    };
    const cell = (image: HTMLImageElement | undefined, frame: number, columns: number, rows: number): [number, number, number, number] => {
      if (!image) return [0, 0, 1, 1];
      const cw = image.naturalWidth / columns, ch = image.naturalHeight / rows;
      return [(frame % columns) * cw, Math.floor(frame / columns) * ch, cw, ch];
    };
    const motion = this.settings.reducedMotion ? 0 : 1, dog = this.skinPortrait ?? this.art.dog;
    paint("dog", dog, this.drawingBounds(dog, 4, 4, 2), Math.sin(time * 5) * 2 * motion, true);
    paint("frog", this.art.frog, cell(this.art.frog, 0, 4, 4), Math.sin(time * 4 + 1) * 2 * motion, false);
    paint("dog-win", dog, this.drawingBounds(dog, 4, 4, 2), -Math.abs(Math.sin(time * 6)) * 8 * motion, true);
    paint("laugh", this.art.laugh, cell(this.art.laugh, 6, 4, 2), Math.sin(time * 14) * 2 * motion, false);
    const laugh = FROG_EXTRA_ART.directionLaugh.frames[0];
    paint("haunt-laugh", this.art.hauntedLaugh, [laugh.x, laugh.y, laugh.width, laugh.height], Math.abs(Math.sin(time * 9)) * -3 * motion, true);
  }

  /** The visible part of one sheet cell, measured once: school looks are drawn smaller in their cells than the default dog. */
  private drawingBounds(image: HTMLImageElement | undefined, frame: number, columns: number, rows: number): [number, number, number, number] {
    if (!image) return [0, 0, 1, 1];
    let frames = this.portraitBounds.get(image);
    if (!frames) { frames = new Map(); this.portraitBounds.set(image, frames); }
    const known = frames.get(frame);
    if (known) return known;
    const cw = Math.floor(image.naturalWidth / columns), ch = Math.floor(image.naturalHeight / rows);
    const x0 = (frame % columns) * cw, y0 = Math.floor(frame / columns) * ch;
    let bounds: [number, number, number, number] = [x0, y0, cw, ch];
    try {
      const canvas = document.createElement("canvas"); canvas.width = cw; canvas.height = ch;
      const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
      ctx.drawImage(image, x0, y0, cw, ch, 0, 0, cw, ch);
      const data = ctx.getImageData(0, 0, cw, ch).data;
      let left = cw, right = -1, top = ch, bottom = -1;
      for (let y = 0; y < ch; y += 2) for (let x = 0; x < cw; x += 2) if (data[(y * cw + x) * 4 + 3] > 40) {
        if (x < left) left = x; if (x > right) right = x; if (y < top) top = y; if (y > bottom) bottom = y;
      }
      if (right > left && bottom > top) bounds = [x0 + left, y0 + top, right - left + 2, bottom - top + 2];
    } catch { /* A tainted image keeps the whole cell. */ }
    frames.set(frame, bounds);
    return bounds;
  }

  destroy() {
    if (this.destroyed) return;
    if (this.world.phase === "running" || this.world.phase === "paused" || this.world.phase === "caught") this.save();
    this.destroyed = true;
    this.shopObserver?.disconnect();
    cancelAnimationFrame(this.frame); this.abort.abort(); this.resize.disconnect();
    this.audio.setPlaying(false); clearTimeout(this.gyroTimer); clearTimeout(this.toastTimer); clearTimeout(this.bannerTimer); clearTimeout(this.popTimer); this.renderer?.dispose();
  }
}
