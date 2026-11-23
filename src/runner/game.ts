import "./runner.css";
import { loadImage } from "../loading.ts";
import type { Settings } from "../settings.ts";
import type { AudioManager } from "../audio.ts";
import { RunnerTilt } from "./tilt.ts";
import { canAfford, DOG_LOOKS, getDogLook, LEGACY_WARDROBE_KEY, migrateLegacyWardrobe, ORIGINAL_LOOK, readWardrobe, WARDROBE_KEY, type CurrencyPurse } from "./shop.ts";
import type { RunnerRenderer3D } from "./renderer3d.ts";
import {
  RunnerWorld, RUN_SCENES, RUN_RECORD_KEY, ENDLESS_RECORD_KEY, CHALLENGE_DISTANCE, LONG_GAP_START, obstacleHalfDepth, readRunRecord,
  type RunAction, type RunPhase, type RunMode,
} from "./world.ts";

const TITLE = "奶狗快跑";
const WEATHER_NAME = { sunny: "晴", rain: "雨", snow: "雪" } as const;
const CUE_NAME: Record<string, string> = { gap: "裂缝", block: "倒木", beam: "低门" };
const KEYS: Record<string, RunAction> = {
  ArrowLeft: "left", a: "left", A: "left", ArrowRight: "right", d: "right", D: "right",
  ArrowUp: "jump", w: "jump", W: "jump", " ": "jump", ArrowDown: "slide", s: "slide", S: "slide",
};
const POWER_INFO = {
  magnet: { name: "磁铁", text: "附近货币自动飞过来", time: 10 },
  shield: { name: "护盾", text: "可以挡住一次撞击", time: 20 },
  boost: { name: "飞鞋冲刺", text: "加速无敌，自动转弯", time: 5 },
} as const;
const newSeed = () => crypto.getRandomValues(new Uint32Array(1))[0];

export class RunnerGame {
  private mode: RunMode = "endless";
  private sceneChoice = 0;
  private world = new RunnerWorld(newSeed(), this.mode, this.sceneChoice);
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
  private last = 0;
  private shownPhase: RunPhase | "loading" = "loading";
  private art: { dog?: HTMLImageElement; frog?: HTMLImageElement; laugh?: HTMLImageElement } = {};
  private skinPortrait?: HTMLImageElement;
  private swipe?: { x: number; y: number; id: number; used: boolean };
  private warnedTurn = -1;
  private urgentTurn = -1;
  private abort = new AbortController();
  private resize: ResizeObserver;
  private el: {
    main: HTMLElement; canvas: HTMLCanvasElement; panel: HTMLElement; distance: HTMLElement; score: HTMLElement; coins: HTMLElement;
    scene: HTMLElement; effects: HTMLElement; cue: HTMLElement; danger: HTMLElement; capture: HTMLElement; toast: HTMLElement;
  };
  private seenEvents = { power: 0, shield: 0, stumble: 0 };
  private toastTimer = 0;

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
  <div class="runner-effects" aria-label="道具效果"></div>
  <div class="runner-cue" role="status" hidden></div>
  <p class="runner-toast" role="status" hidden></p>
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
      danger: $(".runner-danger"), capture: $(".runner-capture"), toast: $(".runner-toast"),
    };
    this.loadRecord();
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
      const [dog, frog, laugh, module] = await Promise.all([
        loadImage("/assets/runner/milk-dog-actions-v2.png"), loadImage("/assets/character/haunted-frog-directions-walk-v1.webp"),
        loadImage("/assets/character/milk-frog-atlas.webp"), import("./renderer3d.ts"),
      ]);
      if (this.destroyed) return;
      this.art = { dog, frog, laugh };
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
      this.swipe = { x: event.clientX, y: event.clientY, id: event.pointerId, used: false };
      canvas.setPointerCapture(event.pointerId);
    }, { signal });
    // Fire as soon as the finger has travelled far enough, not on release: it feels much snappier.
    canvas.addEventListener("pointermove", event => {
      const s = this.swipe;
      if (!s || s.used || event.pointerId !== s.id) return;
      const dx = event.clientX - s.x, dy = event.clientY - s.y;
      if (Math.hypot(dx, dy) < 26) return;
      s.used = true;
      this.act(Math.abs(dx) > Math.abs(dy) ? (dx < 0 ? "left" : "right") : (dy < 0 ? "jump" : "slide"));
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
      case "mode-endless": case "mode-challenge":
        this.mode = action === "mode-endless" ? "endless" : "challenge"; this.newWorld(); this.loadRecord(); this.showPanel(); return;
      case "start": if (this.ready) this.begin(); return;
      case "restart": this.newWorld(); this.begin(); return;
      case "resume": this.resume(); return;
      case "continue": this.mode = "endless"; this.loadRecord(); this.world.continue(); this.audio.setPlaying(true); this.last = 0; return;
    }
    if (action.startsWith("scene-")) {
      const index = RUN_SCENES.findIndex(scene => `scene-${scene.id}` === action);
      if (index >= 0) { this.sceneChoice = index; this.newWorld(); this.showPanel(); }
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
    if (event.key === "Enter" && (phase === "ready" || phase === "lost") && this.ready && !event.repeat) {
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

  private toast(html: string, kind: string) {
    const el = this.el.toast;
    el.innerHTML = html; el.dataset.kind = kind; el.hidden = false;
    el.classList.remove("show"); void el.offsetWidth; el.classList.add("show");
    clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => { el.hidden = true; }, 1800);
  }

  private newWorld() {
    this.world = new RunnerWorld(newSeed(), this.mode, this.sceneChoice);
    this.shopOpen = false; this.credited = { silver: 0, gold: 0, diamond: 0 };
    this.seenEvents = { power: 0, shield: 0, stumble: 0 };
    this.el.toast.hidden = true;
    this.warnedTurn = this.urgentTurn = -1;
  }
  private begin() {
    this.tilt.calibrate(); this.world.start(); this.last = 0;
    this.audio.setMode("normal"); this.audio.setPlaying(true);
  }
  private resume() {
    if (this.world.phase !== "paused") return;
    this.tilt.calibrate(); this.world.resume(); this.last = 0;
    this.audio.setPlaying((this.world.phase as RunPhase) === "running");
  }
  private pause() { this.world.pause(); this.swipe = undefined; this.audio.setPlaying(false); this.last = 0; }

  private tick = (time: number) => {
    if (this.destroyed) return;
    const coins = this.world.coins;
    if (!document.hidden) this.world.advance(this.last ? (time - this.last) / 1000 : 0);
    this.last = time;
    if (this.world.coins > coins) this.audio.effect("coin");
    this.sync();
    if (this.ready) this.renderer?.draw(this.world);
    this.drawPortraits(time / 1000);
    this.frame = requestAnimationFrame(this.tick);
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
    set(el.distance, `${Math.floor(w.distance)}<small>米</small>`);
    set(el.score, String(w.score));
    set(el.coins, `${w.silver}银 · ${w.gold}金 · ${w.diamond}钻`);
    set(el.scene, [RUN_SCENES[w.sceneIndex].name, w.night ? "夜" : "", w.sceneIndex === 2 ? "" : WEATHER_NAME[w.weather]].filter(Boolean).join(" · "));

    const effects = (["magnet", "shield", "boost"] as const).filter(key => w[key] > 0)
      .map(key => `<span class="runner-effect runner-effect-${key}"><i aria-hidden="true"></i><em>${POWER_INFO[key].name}</em>${Math.ceil(w[key])}<u style="--left:${Math.round(w[key] / POWER_INFO[key].time * 100)}%"></u></span>`).join("")
      + (w.multiplier > 1 ? `<span class="runner-combo">×${w.multiplier}</span>` : "");
    set(el.effects, effects);
    el.effects.hidden = w.phase !== "running";
    el.danger.hidden = w.phase !== "running" || w.danger === 0;

    this.syncCue();
    if (w.powerPicked !== this.seenEvents.power) {
      this.seenEvents.power = w.powerPicked;
      const info = POWER_INFO[w.lastPower];
      this.toast(`<b>${info.name}</b>${info.text}`, w.lastPower);
      this.audio.effect("coin");
    }
    if (w.shieldSaves !== this.seenEvents.shield) { this.seenEvents.shield = w.shieldSaves; this.toast("<b>护盾</b>挡住了撞击！", "shield"); }
    if (w.stumbles > this.seenEvents.stumble) {
      this.seenEvents.stumble = w.stumbles;
      this.audio.haunt({ allowNormalMode: true });
    }
    el.capture.hidden = w.phase !== "caught" || (w.trapFall && w.captureTime < .48);
    if (w.phase === "caught") set(el.capture.querySelector("strong")!, w.reason);

    if (this.ready && this.shownPhase !== w.phase) {
      if (w.phase === "caught" || w.phase === "lost" || w.phase === "won") { this.save(); this.audio.setPlaying(false); }
      if (w.phase === "won") this.audio.effect("win");
      if (w.phase === "caught" && this.shownPhase === "running") {
        if (!w.trapFall) this.audio.haunt({ allowNormalMode: true });
        if (this.settings.vibration) navigator.vibrate?.(180);
      }
      this.shownPhase = w.phase; this.showPanel();
    }
  }

  /** One short prompt at a time: corners first, then whole-road obstacles. */
  private syncCue() {
    const w = this.world, cue = this.el.cue;
    let html = "", urgent = false;
    if (w.phase === "running" && w.boost === 0) {
      const turn = w.approachingTurn, toTurn = turn ? turn.z - w.distance : Infinity;
      const next = w.nextObstacle;
      const longGap = next?.kind === "long-gap" ? next : undefined;
      const toLip = longGap ? longGap.z - obstacleHalfDepth("long-gap", longGap.z) - w.distance : Infinity;
      if (longGap && toLip < w.speed * 1.75) {
        if (toLip >= 0) {
          urgent = w.jumpCount === 0 && toLip < w.speed * .19;
          html = `<b>▲▲</b><span>${urgent ? "现在起跳" : "前方长落穴"}</span><small>二段跳</small>`;
        } else if (w.jumpCount === 1) {
          urgent = w.jump < .39;
          html = `<b>▲</b><span>${urgent ? "再跳一次" : "空中准备再跳"}</span>`;
        }
      } else if (turn && toTurn < 55) {
        urgent = w.turnWindow;
        const arrow = turn.direction === "left" ? "◀" : "▶", word = turn.direction === "left" ? "左转" : "右转";
        html = `<b>${arrow}</b><span>${urgent ? `现在${word}` : `前方${word}`}</span>`;
        if (this.warnedTurn !== turn.z) { this.warnedTurn = turn.z; this.audio.effect("coin"); }
        if (urgent && this.urgentTurn !== turn.z) { this.urgentTurn = turn.z; this.audio.effect("tap"); if (this.settings.vibration) navigator.vibrate?.(60); }
      } else {
        if (next?.span === 3 && next.z - w.distance < w.speed * 1.6) {
          const slide = next.kind === "beam";
          urgent = next.z - w.distance < w.speed * .55;
          html = `<b>${slide ? "▼" : "▲"}</b><span>${slide ? "下滑" : "跳"}</span><small>${CUE_NAME[next.kind] ?? ""}</small>`;
        }
      }
    }
    cue.hidden = !html;
    if (html && cue.innerHTML !== html) cue.innerHTML = html;
    cue.classList.toggle("now", urgent);
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
  private async chooseLook(action: string) {
    if (!this.shopOpen || this.pendingSkin) return;
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

  private recordKey() { return this.mode === "endless" ? ENDLESS_RECORD_KEY : RUN_RECORD_KEY; }
  private loadRecord() {
    this.record = readRunRecord(null);
    try { this.record = readRunRecord(localStorage.getItem(this.recordKey())); } catch { this.recordError = true; }
  }
  private save() {
    this.creditCollectedCoins();
    const w = this.world;
    const merge = (a: typeof this.record) => ({ version: 1 as const, distance: Math.max(a.distance, Math.floor(w.distance)), coins: Math.max(a.coins, w.coins), score: Math.max(a.score, w.score) });
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
      html = `
        <h2 class="runner-title">${TITLE}</h2>
        <div class="runner-roster">
          <figure><canvas width="160" height="140" data-portrait="dog" aria-label="玩家：奶狗"></canvas><figcaption>奶狗<small>你</small></figcaption></figure>
          <span aria-hidden="true">VS</span>
          <figure><canvas width="160" height="140" data-portrait="frog" aria-label="追赶者：恐怖奶蛙"></canvas><figcaption>恐怖奶蛙<small>追赶者</small></figcaption></figure>
        </div>
        <div class="runner-seg" aria-label="玩法">${toggle("mode-endless", "无限模式", this.mode === "endless")}${toggle("mode-challenge", "千米挑战", this.mode === "challenge")}</div>
        <div class="runner-seg runner-seg-3" aria-label="场景">${RUN_SCENES.map((s, i) => toggle(`scene-${s.id}`, s.name, i === this.sceneChoice)).join("")}</div>
        <p class="runner-record">最高分 <b>${this.record.score}</b> · 最远 <b>${this.record.distance}</b> 米</p>
        ${btn("start", "开始奔跑")}
        ${btn("shop", "皮肤商城", "ghost")}
        <div class="runner-row">${btn("help", "玩法说明", "ghost")}${gyroRow}${btn("exit", "返回", "ghost")}</div>
        ${gyroNote}${note}`;
    } else if (w.phase === "paused") {
      html = `<h2>暂停</h2>${btn("resume", "继续")}${btn("restart", "重新开始", "ghost")}<div class="runner-row">${gyroRow}${btn("exit", "主菜单", "ghost")}</div>${gyroNote}`;
    } else {
      const won = w.phase === "won";
      const best = w.score >= this.record.score && w.score > 0 ? `<p class="runner-best">新纪录！</p>` : "";
      html = `
        <h2>${won ? "千米挑战完成！" : "游戏结束"}</h2>
        ${won ? `<div class="runner-celebrate"><canvas width="160" height="140" data-portrait="dog-win" aria-label="奶狗庆祝"></canvas><canvas class="runner-laugh" width="160" height="160" data-portrait="laugh" aria-label="奶蛙捧腹大笑"></canvas></div>`
              : `<p class="runner-reason">${w.reason}</p><p class="runner-hint">${w.deathHint}</p>`}
        <div class="runner-stats"><span><b>${w.score}</b>得分</span><span><b>${Math.floor(w.distance)}</b>米</span><span><b>${w.coins}</b>货币</span></div>
        ${best}<p class="runner-record">最高分 <b>${this.record.score}</b> · 最远 <b>${this.record.distance}</b> 米</p>
        ${won ? btn("continue", "继续无限模式") : ""}${btn("restart", "再跑一次", won ? "ghost" : "primary")}${btn("shop", "皮肤商城", "ghost")}${btn("exit", "主菜单", "ghost")}${note}`;
    }
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

  private showHelp() {
    this.el.panel.innerHTML = `<div class="runner-card runner-help">
      <h2>玩法说明</h2>
      <div class="runner-keys"><span><kbd>←</kbd><kbd>→</kbd>换道 / 转弯</span><span><kbd>↑</kbd>跳（空中可再跳）</span><span><kbd>↓</kbd>下滑（空中按会急降）</span></div>
      <ul>
        <li>电脑：方向键或 WASD，空格跳，Esc 暂停，回车开始。手机：在画面上滑动，或用底部按钮。</li>
        <li>整条路的<b>倒木、裂缝</b>要跳过，<b>低门</b>要下滑；屏幕中间会提示。</li>
        <li>${LONG_GAP_START}米起会出现横跨三道的<b>长落穴</b>。靠近边缘起跳，在坑上方按提示再跳一次。</li>
        <li>单道的倒木、栏杆撞到会踉跄，恐怖奶蛙会笑着追上来——8秒内再撞就被抓。乱石枯枝有单道和双道两种，火焰覆盖两道；都要躲开或跳过（巨石要二段跳）。</li>
        <li>路尽头立着<b>箭头墙</b>时，按箭头方向转弯。</li>
        <li>先收银币，400米后开始出现金币；1800米后才有极少量钻石。磁铁吸取附近货币，护盾挡一次撞击，飞鞋冲刺无敌5秒。连续收取分数翻倍，最高×5。</li>
        <li>活动木板下面有深坑，跳过或换道；踩翻后奶狗会从原镜头中落下。收集货币可在皮肤商城解锁 102 套 QS 2027 高校主题奶狗。</li>
        <li>${CHALLENGE_DISTANCE}米挑战跑到终点即胜利；每450米换一个场景，1000米后进入较长的黑夜。</li>
      </ul>
      <button data-run="help-back" class="primary">知道了</button></div>`;
    this.el.panel.querySelector<HTMLButtonElement>(".primary")?.focus({ preventScroll: true });
  }

  private drawPortraits(time: number) {
    const panel = this.el.panel;
    if (panel.hidden) return;
    const draw = (key: string, image: HTMLImageElement | undefined, frame: number, columns: number, rows: number, bob = 0) => {
      const canvas = panel.querySelector<HTMLCanvasElement>(`[data-portrait="${key}"]`);
      if (!canvas || !image) return;
      const ctx = canvas.getContext("2d")!, cw = image.naturalWidth / columns, ch = image.naturalHeight / rows;
      const size = Math.min(canvas.width, canvas.height);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(image, (frame % columns) * cw, Math.floor(frame / columns) * ch, cw, ch, (canvas.width - size) / 2, bob, size, size);
    };
    const motion = this.settings.reducedMotion ? 0 : 1;
    draw("dog", this.skinPortrait ?? this.art.dog, 4, 4, 2, Math.sin(time * 5) * 2 * motion);
    draw("frog", this.art.frog, 0, 4, 4, Math.sin(time * 4 + 1) * 2 * motion);
    draw("dog-win", this.skinPortrait ?? this.art.dog, 4, 4, 2, -Math.abs(Math.sin(time * 6)) * 8 * motion);
    draw("laugh", this.art.laugh, 6, 4, 2, Math.sin(time * 14) * 2 * motion);
  }

  destroy() {
    if (this.destroyed) return;
    if (this.world.phase === "running" || this.world.phase === "paused" || this.world.phase === "caught") this.save();
    this.destroyed = true;
    this.shopObserver?.disconnect();
    cancelAnimationFrame(this.frame); this.abort.abort(); this.resize.disconnect();
    this.audio.setPlaying(false); clearTimeout(this.gyroTimer); clearTimeout(this.toastTimer); this.renderer?.dispose();
  }
}
