import "./runner.css";
import { loadImage } from "../loading.ts";
import type { Settings } from "../settings.ts";
import type { AudioManager } from "../audio.ts";
import { RunnerWorld, RUN_RECORD_KEY, readRunRecord, type RunAction, type RunPhase } from "./world.ts";

export class RunnerGame {
  private world = new RunnerWorld(crypto.getRandomValues(new Uint32Array(1))[0]);
  private record = readRunRecord(null);
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private frame = 0;
  private last = 0;
  private uiPhase: RunPhase | "loading" = "loading";
  private destroyed = false;
  private ready = false;
  private runArt?: HTMLImageElement;
  private laughArt?: HTMLImageElement;
  private scenery?: HTMLImageElement;
  private stone?: HTMLImageElement;
  private props?: HTMLImageElement;
  private error = "";
  private recordError = false;
  private pointer?: { x: number; y: number; id: number };
  private turnAt = -10;
  private turnDirection = 1;
  private abort = new AbortController();
  private resize: ResizeObserver;
  private overlay: HTMLElement;
  private meter: HTMLElement;
  private coin: HTMLElement;
  private turn: HTMLElement;
  constructor(private root: HTMLElement, private audio: AudioManager, private settings: Settings, private exit: () => void) {
    try { this.record = readRunRecord(localStorage.getItem(RUN_RECORD_KEY)); } catch { this.recordError = true; }
    root.innerHTML = `<main class="runner-screen" aria-label="奶蛙逃亡"><canvas class="runner-canvas" aria-label="三轨水渠跑道，使用方向键或滑动操作"></canvas><header class="runner-header"><button data-run="exit" aria-label="返回模式选择">‹ <span>返回</span></button><div><small>水渠尽头，自有天光</small><h1>奶蛙逃亡</h1></div><button data-run="pause" aria-label="暂停跑酷">Ⅱ</button></header><div class="runner-hud"><div><span>逃亡距离</span><strong id="run-distance">0<small>米</small></strong></div><div><span>泡泡币</span><strong id="run-coins">0</strong></div></div><p class="runner-turn" role="status" aria-live="polite" hidden></p><section class="runner-panel" aria-live="polite"></section><nav class="runner-controls" aria-label="跑酷操作"><button data-run="left" aria-label="左换道或左转">←</button><button data-run="jump" aria-label="跳跃">↑<small>跳跃</small></button><button data-run="slide" aria-label="滑铲">↓<small>滑铲</small></button><button data-run="right" aria-label="右换道或右转">→</button></nav><footer class="runner-footnote">左右换道 · 上跳下滑 · 弯道跟随箭头转向</footer></main>`;
    this.canvas = root.querySelector("canvas")!;
    this.ctx = this.canvas.getContext("2d")!;
    this.overlay = root.querySelector(".runner-panel")!;
    this.meter = root.querySelector("#run-distance")!;
    this.coin = root.querySelector("#run-coins")!;
    this.turn = root.querySelector(".runner-turn")!;
    const signal = this.abort.signal;
    root.addEventListener("click", this.onClick, { signal });
    document.addEventListener("keydown", this.onKey, { signal });
    document.addEventListener("visibilitychange", () => { if (document.hidden) this.pause(); }, { signal });
    window.addEventListener("blur", () => this.pause(), { signal });
    window.addEventListener("pagehide", () => { this.pause(); this.save(); }, { signal });
    this.canvas.addEventListener("pointerdown", event => {
      if (this.world.phase !== "running") return;
      this.pointer = { x: event.clientX, y: event.clientY, id: event.pointerId };
      this.canvas.setPointerCapture(event.pointerId);
    }, { signal });
    this.canvas.addEventListener("pointerup", event => {
      if (!this.pointer || event.pointerId !== this.pointer.id) return;
      const dx = event.clientX - this.pointer.x, dy = event.clientY - this.pointer.y;
      this.pointer = undefined;
      if (Math.max(Math.abs(dx), Math.abs(dy)) < 22) return;
      this.act(Math.abs(dx) > Math.abs(dy) ? dx < 0 ? "left" : "right" : dy < 0 ? "jump" : "slide");
    }, { signal });
    this.canvas.addEventListener("pointercancel", () => { this.pointer = undefined; }, { signal });
    this.resize = new ResizeObserver(() => this.fit()); this.resize.observe(this.canvas); this.fit();
    this.showPanel();
    void this.loadArt();
    this.frame = requestAnimationFrame(this.tick);
  }
  private async loadArt() {
    this.error = ""; this.showPanel();
    try {
      const [run, laugh, scenery, stone, props] = await Promise.all([
        loadImage("/assets/character/haunted-frog-directions-walk-v1.webp"), loadImage("/assets/character/milk-frog-atlas.webp"),
        loadImage("/assets/runner/aqueduct-scene-v1.png"), loadImage("/assets/runner/wet-stone-v1.png"), loadImage("/assets/runner/obstacles-v1.png"),
      ]);
      if (this.destroyed) return;
      this.runArt = run; this.laughArt = laugh; this.scenery = scenery; this.stone = stone; this.props = props;
      this.ready = true; this.uiPhase = "ready"; this.showPanel();
    } catch {
      if (this.destroyed) return;
      this.error = "奶蛙还没准备好，请检查网络后重试。"; this.showPanel();
    }
  }
  private onClick = (event: Event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-run]");
    if (!button) return;
    const action = button.dataset.run;
    if (action === "exit") { this.exit(); return; }
    if (action === "retry-art") { void this.loadArt(); return; }
    if (action === "start" && this.ready) { this.world.start(); this.audio.setPlaying(true); }
    else if (action === "restart") { this.turnAt = -10; this.world = new RunnerWorld(crypto.getRandomValues(new Uint32Array(1))[0]); this.world.start(); this.audio.setPlaying(true); }
    else if (action === "continue") { this.world.continue(); this.audio.setPlaying(true); }
    else if (action === "resume") { this.world.resume(); this.audio.setPlaying(true); }
    else if (action === "pause") { this.pause(); return; }
    else if (["left", "right", "jump", "slide"].includes(action ?? "")) { this.act(action as RunAction); return; }
    void this.audio.unlock(); this.last = 0; this.sync();
  };
  private onKey = (event: KeyboardEvent) => {
    if (event.altKey || event.ctrlKey || event.metaKey || event.target instanceof HTMLInputElement) return;
    const map: Record<string, RunAction> = { ArrowLeft: "left", a: "left", A: "left", ArrowRight: "right", d: "right", D: "right", ArrowUp: "jump", w: "jump", W: "jump", " ": "jump", ArrowDown: "slide", s: "slide", S: "slide" };
    if (event.key === "Escape" || event.key.toLowerCase() === "p") {
      event.preventDefault(); if (event.repeat) return;
      if (this.world.phase === "paused") { this.world.resume(); this.audio.setPlaying(true); this.last = 0; this.sync(); } else this.pause();
    } else if (map[event.key] && this.world.phase === "running") {
      event.preventDefault(); if (!event.repeat) this.act(map[event.key]);
    }
  };
  private act(action: RunAction) {
    const turns = this.world.turnCount;
    this.world.action(action);
    if (turns !== this.world.turnCount) { this.turnAt = this.world.elapsed; this.turnDirection = action === "left" ? -1 : 1; }
    this.audio.effect("tap"); this.sync();
  }
  private pause() { this.world.pause(); this.pointer = undefined; this.audio.setPlaying(false); this.last = 0; this.sync(); }
  private fit() {
    const rect = this.canvas.getBoundingClientRect();
    const ratio = Math.min(devicePixelRatio || 1, this.settings.quality === "high" ? 3 : 2);
    this.canvas.width = Math.max(1, Math.round(rect.width * ratio)); this.canvas.height = Math.max(1, Math.round(rect.height * ratio));
  }
  private tick = (time: number) => {
    if (this.destroyed) return;
    const coins = this.world.coins;
    if (!document.hidden) this.world.advance(this.last ? (time - this.last) / 1000 : 0);
    this.last = time;
    if (this.world.coins > coins) this.audio.effect("coin");
    this.sync(); this.draw(time / 1000);
    this.frame = requestAnimationFrame(this.tick);
  };
  private sync() {
    const w = this.world;
    this.root.querySelector("main")!.dataset.phase = this.ready ? w.phase : "loading";
    this.meter.innerHTML = `${Math.floor(w.distance)}<small>米</small>`;
    this.coin.textContent = String(w.coins);
    const turn = w.approachingTurn;
    const remaining = turn ? turn.z - w.distance : Infinity;
    const show = w.phase === "running" && remaining < 65;
    this.turn.hidden = !show;
    if (show) {
      const text = `${turn!.direction === "left" ? "← 左转" : "右转 →"} · ${remaining <= 16 ? "现在转向！" : `${Math.ceil(remaining)}米后进入转弯区`}`;
      if (this.turn.textContent !== text) this.turn.textContent = text;
      this.turn.classList.toggle("now", remaining <= 16);
    }
    if (this.ready && this.uiPhase !== w.phase) {
      if (w.phase === "lost" || w.phase === "won") { this.save(); this.audio.setPlaying(false); if (w.phase === "won") this.audio.effect("win"); }
      this.uiPhase = w.phase; this.showPanel();
    }
  }
  private save() {
    const w = this.world;
    this.record = { version: 1, distance: Math.max(this.record.distance, Math.floor(w.distance)), coins: Math.max(this.record.coins, w.coins), score: Math.max(this.record.score, w.score) };
    try {
      const stored = readRunRecord(localStorage.getItem(RUN_RECORD_KEY));
      this.record = { version: 1, distance: Math.max(this.record.distance, stored.distance, Math.floor(w.distance)), coins: Math.max(this.record.coins, stored.coins, w.coins), score: Math.max(this.record.score, stored.score, w.score) };
      localStorage.setItem(RUN_RECORD_KEY, JSON.stringify(this.record));
    } catch { this.recordError = true; }
  }
  private showPanel() {
    const w = this.world;
    this.overlay.hidden = this.ready && w.phase === "running";
    if (this.overlay.hidden) return;
    const button = (action: string, text: string, secondary = false) => `<button data-run="${action}" class="${secondary ? "secondary" : "primary"}">${text}</button>`;
    if (!this.ready) { this.overlay.innerHTML = `<div class="runner-card"><small>奶蛙逃亡</small><h2>${this.error ? "再等奶蛙一下" : "正在准备水渠…"}</h2><p>${this.error || "载入角色后即可出发"}</p>${this.error ? button("retry-art", "重试") : ""}${button("exit", "返回模式选择", true)}</div>`; return; }
    if (w.phase === "ready") {
      this.overlay.innerHTML = `<div class="runner-card"><small>全新跑酷冒险 / WATERWAY RUN</small><h2>一跃，逃向天光。</h2><p>穿过古老浴场的三轨水渠。<br>先跑出 <b>1000 米</b>，再挑战无尽旅程。</p><div class="runner-guide"><span>← →<b>换道 / 转弯</b></span><span>↑<b>跳过木箱与断桥</b></span><span>↓<b>滑过横梁</b></span></div><p class="runner-tip">手机滑动或点下方按钮；电脑使用方向键 / WASD。<br>弯道亮起金色提示时，按箭头方向转弯。Esc / P 暂停。</p><div class="runner-record">本机最佳 <b>${this.record.distance} 米</b> · ${this.record.score} 分</div>${button("start", "开始逃亡 →")}${button("exit", "返回模式选择", true)}${this.storageNotice()}</div>`;
    } else if (w.phase === "paused") {
      this.overlay.innerHTML = `<div class="runner-card"><small>喘口气，水渠会等你</small><h2>已暂停</h2><p>距离、机关和计时已停止。</p>${button("resume", "继续逃亡")}${button("restart", "重新出发", true)}${button("exit", "返回模式选择", true)}</div>`;
    } else {
      this.overlay.innerHTML = `<div class="runner-card runner-result ${w.phase === "won" ? "runner-victory" : ""}"><small>${w.phase === "won" ? "千米逃亡 · 成功" : "这趟旅程，到这里"}</small><h2>${w.phase === "won" ? "笑着跑出浴场！" : "再跳远一点"}</h2>${w.phase === "won" ? '<canvas class="runner-laugh" width="320" height="240" aria-label="奶蛙捧腹大笑庆祝"></canvas>' : `<p>${w.reason}</p>`}<div class="runner-result-stats"><span><b>${Math.floor(w.distance)}</b>米</span><span><b>${w.coins}</b>泡泡币</span><span><b>${w.score}</b>分</span></div><p>本机最远 ${this.record.distance} 米 · 最高 ${this.record.score} 分</p>${w.phase === "won" ? button("continue", "继续 · 无尽逃亡") : ""}${button("restart", "重新出发", w.phase === "won")}${button("exit", "返回模式选择", true)}${this.storageNotice()}</div>`;
    }
    this.overlay.querySelector<HTMLButtonElement>(".primary")?.focus({ preventScroll: true });
  }
  private storageNotice() { return this.recordError ? '<p class="runner-tip" role="status">浏览器存储不可用，本次纪录仅保留在当前页面。</p>' : ""; }
  private draw(time: number) {
    const c = this.ctx, width = this.canvas.width, height = this.canvas.height;
    c.setTransform(width / 600, 0, 0, height / 800, 0, 0);
    const aspect = (height / 800) / (width / 600);
    if (!this.scenery || !this.stone || !this.props) return;
    c.save();
    const turning = this.world.elapsed - this.turnAt;
    if (!this.settings.reducedMotion && turning >= 0 && turning < .65) {
      c.translate(300,400); c.rotate(this.turnDirection * Math.sin(turning / .65 * Math.PI) * .04); c.translate(-300,-400);
    }
    c.drawImage(this.scenery, 0, 0, 600, 800);
    const upcoming = this.world.approachingTurn;
    const cornerDistance = upcoming ? upcoming.z - this.world.distance : Infinity;
    const project = (lane: number, z: number) => {
      const s = 1 / (1 + Math.max(0,z) / 16);
      const bend = upcoming && cornerDistance < 90 ? (upcoming.direction === "left" ? -1 : 1) * Math.min(1,Math.max(0,(z-cornerDistance+10)/45)) * 110 / (1+cornerDistance/65) : 0;
      return { x: 300 + bend + (lane-1)*165*s, y: 285+467*s, s };
    };
    // Inverse perspective maps the generated wet-stone bitmap to a moving road.
    // Every visible surface comes from the image assets; strips only project pixels.
    const strip = this.settings.quality === "high" ? 2 : 4;
    const texture = this.stone;
    for (let y = 310; y < 800; y += strip) {
      const near = 16*(467/(y+strip-285)-1), far = 16*(467/(y-285)-1);
      const p = project(1,Math.max(0,near));
      const roadScale = (y+strip-285)/467;
      const sy = (-(this.world.distance + far)*36 % texture.height + texture.height) % texture.height;
      const sh = Math.max(1,(far-near)*36);
      c.globalAlpha = Math.min(.94,Math.max(0,(y-310)/110));
      let sampled = 0;
      while (sampled < sh) {
        const sourceY = (sy+sampled)%texture.height, count = Math.min(sh-sampled,texture.height-sourceY);
        c.drawImage(texture,0,sourceY,texture.width,count,p.x-280*roadScale,y+strip*sampled/sh,560*roadScale,strip*count/sh+.5);
        sampled += count;
      }
    }
    c.globalAlpha = 1;
    const propCell = this.props.width/2;
    for (const item of [...this.world.items].sort((a,b)=>b.z-a.z)) {
      if (item.done || item.z < this.world.distance-2) continue;
      const p = project(item.lane,item.z-this.world.distance), s = p.s;
      const frame = item.kind === "block" ? 0 : item.kind === "beam" ? 1 : item.kind === "gap" ? 2 : 3;
      const w = item.kind === "coin" ? 72 : item.kind === "gap" ? 188 : item.kind === "beam" ? 182 : 136;
      const h = item.kind === "coin" ? 72 : item.kind === "gap" ? 95 : item.kind === "beam" ? 185 : 136;
      const lift = item.kind === "coin" ? 62 : item.kind === "gap" ? 65 : h*.95;
      c.drawImage(this.props,(frame%2)*propCell,Math.floor(frame/2)*propCell,propCell,propCell,p.x-w*s/2,p.y-lift*s,w*s,h*s);
    }
    if (this.runArt) {
      const x = 300 + (this.world.position - 1) * 165, jump = this.world.jumpHeight * 115;
      c.fillStyle = "#062b3566"; c.beginPath(); c.ellipse(x,746,52*(1-this.world.jumpHeight*.35),12,0,0,Math.PI*2); c.fill();
      const moving = this.world.phase === "running" && !this.settings.reducedMotion;
      const cell = this.runArt.width / 4;
      const row = 1 + (moving && Math.floor(this.world.elapsed * 9) % 2 ? 2 : 0);
      const bob = moving ? Math.sin(this.world.elapsed * 18) * 4 : 0;
      const h = this.world.slide > 0 ? 85 : 154;
      c.drawImage(this.runArt,0,row*cell,cell,cell,x-82*aspect,752-h-jump+bob,164*aspect,h);
    }
    c.restore();
    c.setTransform(1,0,0,1,0,0);
    const laugh = this.overlay.querySelector<HTMLCanvasElement>(".runner-laugh");
    if (laugh && this.laughArt) {
      const lc = laugh.getContext("2d")!; lc.clearRect(0,0,320,240);
      const pulse = this.settings.reducedMotion ? 0 : Math.sin(time * 12) * 2;
      lc.drawImage(this.laughArt,1024,512,512,512,40,0,240,240+pulse);
    }
  }
  destroy() {
    if (this.destroyed) return;
    if (this.world.phase === "running" || this.world.phase === "paused") this.save();
    this.destroyed = true; cancelAnimationFrame(this.frame); this.abort.abort(); this.resize.disconnect(); this.audio.setPlaying(false);
  }
}
