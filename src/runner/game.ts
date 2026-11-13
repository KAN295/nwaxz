import "./runner.css";
import { loadImage } from "../loading.ts";
import type { Settings } from "../settings.ts";
import type { AudioManager } from "../audio.ts";
import { RunnerTilt } from "./tilt.ts";
import type { RunnerRenderer3D } from "./renderer3d.ts";
import { RunnerWorld, RUN_SCENES, RUN_RECORD_KEY, ENDLESS_RECORD_KEY, readRunRecord, type RunAction, type RunPhase, type RunMode } from "./world.ts";

export class RunnerGame {
  private world = new RunnerWorld(crypto.getRandomValues(new Uint32Array(1))[0], "endless");
  private chosenMode: RunMode = "endless";
  private chosenScene = 0;
  private record = readRunRecord(null);
  private canvas: HTMLCanvasElement;
  private renderer?: RunnerRenderer3D;
  private tilt=new RunnerTilt();
  private gyroState: "off"|"waiting"|"on" = "off";
  private gyroMessage="";
  private gyroTimer=0;
  private frame = 0;
  private last = 0;
  private uiPhase: RunPhase | "loading" = "loading";
  private destroyed = false;
  private ready = false;
  private actionArt?: HTMLImageElement;
  private chaserArt?: HTMLImageElement;
  private laughArt?: HTMLImageElement;
  private error = "";
  private recordError = false;
  private pointer?: { x: number; y: number; id: number };
  private turnAt = -10;
  private turnDirection = 1;
  private observedTurns = 0;
  private warnedTurn = -1;
  private urgentTurn = -1;
  private abort = new AbortController();
  private resize: ResizeObserver;
  private overlay: HTMLElement;
  private meter: HTMLElement;
  private coin: HTMLElement;
  private turn: HTMLElement;
  private effects: HTMLElement;
  private warning: HTMLElement;
  private score: HTMLElement;
  private cue: HTMLElement;
  private sceneLabel: HTMLElement;
  constructor(private root: HTMLElement, private audio: AudioManager, private settings: Settings, private exit: () => void) {
    this.loadRecord();
    root.innerHTML = `<main class="runner-screen" aria-label="奶蛙逃亡"><canvas class="runner-canvas" aria-label="三轨水渠跑道，使用方向键或滑动操作"></canvas><header class="runner-header"><button data-run="exit" aria-label="返回模式选择">‹ <span>返回</span></button><div><h1>奶蛙逃亡</h1><small id="runner-scene"></small></div><button data-run="pause" aria-label="暂停跑酷">Ⅱ</button></header><div class="runner-hud"><div><span>得分</span><strong id="run-score">0</strong></div><div><span>距离</span><strong id="run-distance">0<small>米</small></strong></div><div><span>金币</span><strong id="run-coins">0</strong></div></div><p class="runner-turn" role="status" aria-live="polite" hidden></p><div class="runner-action-cue" role="status" hidden></div><div class="runner-effects" aria-label="道具效果"></div><p class="runner-warning" role="status" hidden></p><section class="runner-capture-caption" aria-live="polite" hidden><strong>被抓住了</strong><p></p><button data-run="skip-capture">跳过</button></section><section class="runner-panel" aria-live="polite"></section><nav class="runner-controls" aria-label="跑酷操作"><button data-run="left" aria-label="左换道或左转">←</button><button data-run="jump" aria-label="跳跃">↑<small>跳跃</small></button><button data-run="slide" aria-label="滑铲">↓<small>滑铲</small></button><button data-run="right" aria-label="右换道或右转">→</button></nav><footer class="runner-footnote">← → 换道　↑ 跳跃　↓ 下滑</footer></main>`;
    this.canvas = root.querySelector("canvas")!;

    this.overlay = root.querySelector(".runner-panel")!;
    this.meter = root.querySelector("#run-distance")!;
    this.coin = root.querySelector("#run-coins")!;
    this.turn = root.querySelector(".runner-turn")!;
    this.effects = root.querySelector(".runner-effects")!;
    this.warning = root.querySelector(".runner-warning")!;
    this.score = root.querySelector("#run-score")!;
    this.cue = root.querySelector(".runner-action-cue")!;
    this.sceneLabel = root.querySelector("#runner-scene")!;
    const signal = this.abort.signal;
    root.addEventListener("click", this.onClick, { signal });
    document.addEventListener("keydown", this.onKey, { signal });
    window.addEventListener("deviceorientation",this.onOrientation,{signal});
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
      const [actions,chaser,laugh,module] = await Promise.all([
        loadImage("/assets/runner/milk-dog-actions-v2.png"),loadImage("/assets/character/haunted-frog-directions-walk-v1.webp"),loadImage("/assets/character/milk-frog-atlas.webp"),import("./renderer3d.ts"),
      ]);
      if(this.destroyed)return;
      this.actionArt=actions;this.chaserArt=chaser;this.laughArt=laugh;
      this.renderer?.dispose();this.renderer=new module.RunnerRenderer3D(this.canvas,this.settings);
      await this.renderer.load();
      if(this.destroyed){this.renderer.dispose();return;}
      this.root.querySelector('main')!.dataset.engine="babylon";
      this.ready = true; this.uiPhase = "ready"; this.showPanel();
    } catch {
      if (this.destroyed) return;
      this.renderer?.dispose();this.renderer=undefined;this.error = "3D场景加载失败，请重试或检查浏览器WebGL设置。"; this.showPanel();
    }
  }
  private onClick = (event: Event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-run]");
    if (!button) return;
    const action = button.dataset.run;
    if(action==="gyro"){void this.toggleGyro();return;}
    if(action==="calibrate"){this.tilt.calibrate();this.gyroMessage="已重新校准";this.showPanel();return;}
    if(action==="skip-capture"){this.world.finishCapture();this.sync();return;}
    if (action === "exit") { this.exit(); return; }
    if (action === "help") { this.overlay.innerHTML = `<div class="runner-card"><h2>玩法说明</h2><div class="runner-guide"><span>← →<b>换道 / 转弯</b></span><span>↑<b>跳跃</b></span><span>↓<b>下滑</b></span></div><p>电脑：方向键或 WASD，空格跳跃，Esc 暂停。<br>手机：滑动屏幕，或点下方按钮；可开启倾斜换道。<br>空中再按一次跳跃，可二段跳。</p><p>磁铁：自动吸取附近金币。<br>护盾：挡住一次撞击或掉落。<br>冲刺：加速前进，自动避障和转弯。</p><p>连续收币可提高金币分数，最高5倍。<br>撞到木箱或横梁后，8秒内再撞一次会被抓。<br>地刺、火焰、断崖必须跳；巨石可换道或二段跳。<br>撞木箱和普通横梁会引来追赶，致命障碍会直接被抓。<br>每450米切换场景，弯道按大箭头转。</p><button data-run="help-back" class="primary">返回</button></div>`; return; }
    if (action === "help-back") { this.showPanel(); return; }
    if (action === "retry-art") { void this.loadArt(); return; }
    if (action?.startsWith("scene-")) {
      const index = RUN_SCENES.findIndex(scene=>`scene-${scene.id}`===action);if(index<0)return;
      this.chosenScene=index;this.world=new RunnerWorld(crypto.getRandomValues(new Uint32Array(1))[0],this.chosenMode,index);this.resetFeedback();this.showPanel();return;
    }
    if (action === "mode-endless" || action === "mode-challenge") {
      this.chosenMode = action === "mode-endless" ? "endless" : "challenge";
      this.world = new RunnerWorld(crypto.getRandomValues(new Uint32Array(1))[0], this.chosenMode, this.chosenScene); this.resetFeedback(); this.loadRecord(); this.showPanel(); return;
    }
    if (action === "start" && this.ready) { this.tilt.calibrate();this.world.start();this.audio.setMode("normal"); this.audio.setPlaying(true); }
    else if (action === "restart") { this.resetFeedback(); this.world = new RunnerWorld(crypto.getRandomValues(new Uint32Array(1))[0], this.chosenMode, this.chosenScene); this.tilt.calibrate();this.world.start();this.audio.setMode("normal"); this.audio.setPlaying(true); }
    else if (action === "continue") { this.chosenMode = "endless"; this.loadRecord(); this.world.continue(); this.audio.setPlaying(true); }
    else if (action === "resume") { this.tilt.calibrate();this.world.resume(); this.audio.setPlaying(["running"].includes(this.world.phase)); }
    else if (action === "pause") { this.pause(); return; }
    else if (["left", "right", "jump", "slide"].includes(action ?? "")) { this.act(action as RunAction); return; }
    void this.audio.unlock(); this.last = 0; this.sync();
  };
  private onKey = (event: KeyboardEvent) => {
    if (event.altKey || event.ctrlKey || event.metaKey || event.target instanceof HTMLInputElement) return;
    const map: Record<string, RunAction> = { ArrowLeft: "left", a: "left", A: "left", ArrowRight: "right", d: "right", D: "right", ArrowUp: "jump", w: "jump", W: "jump", " ": "jump", ArrowDown: "slide", s: "slide", S: "slide" };
    if (event.key === "Escape" || event.key.toLowerCase() === "p") {
      event.preventDefault(); if (event.repeat) return;
      if (this.world.phase === "paused") { this.tilt.calibrate();this.world.resume(); this.audio.setPlaying(["running"].includes(this.world.phase)); this.last = 0; this.sync(); } else this.pause();
    } else if (map[event.key] && this.world.phase === "running") {
      event.preventDefault(); if (!event.repeat) this.act(map[event.key]);
    }
  };
  private act(action: RunAction) {
    this.world.action(action);
    this.audio.effect("tap"); this.sync();
  }
  private async toggleGyro(){
    if(this.gyroState!=="off"){this.gyroState="off";clearTimeout(this.gyroTimer);this.gyroMessage="倾斜控制已关闭";this.showPanel();return;}
    if(!window.isSecureContext||typeof DeviceOrientationEvent==="undefined"){this.gyroMessage="此浏览器无法启用倾斜控制，请使用滑动或按钮。";this.showPanel();return;}
    try{
      const api=DeviceOrientationEvent as typeof DeviceOrientationEvent&{requestPermission?:()=>Promise<string>};
      if(api.requestPermission&&await api.requestPermission()!=="granted"){if(this.destroyed)return;this.gyroMessage="未获得运动权限，可继续用滑动或按钮。";this.showPanel();return;}
      if(this.destroyed)return;
      this.gyroState="waiting";this.tilt.calibrate();this.gyroMessage="请握稳手机，正在校准…";this.showPanel();
      this.gyroTimer=window.setTimeout(()=>{if(this.gyroState==="waiting"){this.gyroState="off";this.gyroMessage="未收到传感器数据，请使用滑动或按钮。";this.showPanel();}},4000);
    }catch{if(this.destroyed)return;this.gyroState="off";this.gyroMessage="倾斜控制未能启用，请使用滑动或按钮。";this.showPanel();}
  }
  private onOrientation=(event:DeviceOrientationEvent)=>{
    if(this.gyroState==="off")return;
    const lane=this.tilt.sample(event.beta,event.gamma,screen.orientation?.angle??Number((window as Window&{orientation?:number}).orientation??0));
    if(lane===null)return;
    if(this.gyroState==="waiting"){clearTimeout(this.gyroTimer);this.gyroState="on";this.gyroMessage="倾斜换道已开启，转弯和跳跃仍用滑动。";this.showPanel();}
    this.world.steer(lane);
  };
  private resetFeedback(){this.turnAt=-10;this.observedTurns=0;this.warnedTurn=-1;this.urgentTurn=-1;}
  private pause() { this.world.pause(); this.pointer = undefined; this.audio.setPlaying(false); this.last = 0; this.sync(); }
  private fit() { this.renderer?.resize(); }
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
    const main=this.root.querySelector("main")!;
    main.dataset.phase = this.ready ? w.phase : "loading";
    main.classList.toggle("runner-hit",w.elapsed-w.hitAt<.3);
    main.classList.toggle("runner-turning",w.elapsed-this.turnAt<.8);
    main.dataset.turn=this.turnDirection<0?"left":"right";
    this.meter.innerHTML = `${Math.floor(w.distance)}<small>米</small>`;
    this.coin.textContent = String(w.coins);
    this.score.textContent = String(w.score);
    const active = ([['magnet','磁铁'],['shield','护盾'],['boost','冲刺']] as const).filter(([key])=>w[key]>0);
    const effectMarkup = active.map(([key,name])=>`<span class="runner-effect runner-effect-${key}"><i aria-hidden="true"></i>${name} ${Math.ceil(w[key])}秒</span>`).join('') + (w.multiplier>1 ? `<span class="runner-combo">金币 ×${w.multiplier}</span>` : '');
    if(this.effects.innerHTML !== effectMarkup) this.effects.innerHTML = effectMarkup;
    this.effects.hidden = w.phase !== "running";
    this.warning.hidden = w.phase !== "running" || w.danger === 0;
    const warning = "快跑！别再撞了";
    if(this.warning.textContent !== warning) this.warning.textContent = warning;
    this.sceneLabel.textContent=`${RUN_SCENES[w.sceneIndex].name} · ${w.night?"夜间 · ":""}${{sunny:"晴天",rain:"雨天",snow:"雪天"}[w.weather]}`;
    const capture=this.root.querySelector<HTMLElement>(".runner-capture-caption")!;capture.hidden=w.phase!=="caught";
    if(w.phase==="caught")capture.querySelector("p")!.textContent=w.reason;
    if(w.turnCount !== this.observedTurns){this.observedTurns=w.turnCount;this.turnAt=w.elapsed;this.turnDirection=w.lastTurnDirection==="left"?-1:1;}
    const turn = w.approachingTurn;
    const remaining = turn ? turn.z-w.distance : Infinity;
    const show = w.phase === "running" && remaining < 70;
    this.turn.hidden=!show;
    if(show){
      const urgent=remaining<=16;
      const markup=`<strong>${turn!.direction==="left"?"❮❮❮":"❯❯❯"}</strong><span>${urgent?"现在":"前方"}${turn!.direction==="left"?"左转":"右转"}</span><small aria-hidden="true">${Math.ceil(Math.max(0,remaining))} 米</small><progress max="70" value="${70-Math.max(0,remaining)}" aria-label="转弯距离"></progress>`;
      if(this.turn.innerHTML!==markup)this.turn.innerHTML=markup;
      this.turn.classList.toggle("now",urgent);this.turn.dataset.direction=turn!.direction;
      if(this.warnedTurn!==turn!.z){this.warnedTurn=turn!.z;this.audio.effect("coin");}
      if(urgent&&this.urgentTurn!==turn!.z){this.urgentTurn=turn!.z;this.audio.effect("tap");if(this.settings.vibration)navigator.vibrate?.(80);}
    }
    const forced=w.items.find(item=>item.span===3&&!item.done&&item.z>w.distance-1&&item.z-w.distance<55);
    this.cue.hidden=w.phase!=="running"||show||!forced;
    if(forced){
      const slide=forced.kind==="beam",distance=Math.ceil(Math.max(0,forced.z-w.distance));
      const markup=`<strong>${slide?"↓":"↑"}</strong><span>${slide?"下滑":"跳跃"}<small>${distance} 米 · ${slide?"低门":({gap:"断沟",cliff:"断崖",fire:"火焰",spikes:"地刺",block:"倒木"} as Record<string,string>)[forced.kind]??"障碍"}</small></span>`;
      if(this.cue.innerHTML!==markup)this.cue.innerHTML=markup;
      this.cue.classList.toggle("now",forced.z-w.distance<w.speed*.6);
    }
    if (this.ready && this.uiPhase !== w.phase) {
      if (w.phase === "caught" || w.phase === "lost" || w.phase === "won") { this.save(); this.audio.setPlaying(false); if (w.phase === "won") this.audio.effect("win"); if(w.phase==="caught"){this.audio.setMode("horror");this.audio.haunt();} }
      this.uiPhase = w.phase; this.showPanel();
    }
  }
  private loadRecord() {
    this.record = readRunRecord(null);
    try { this.record = readRunRecord(localStorage.getItem(this.chosenMode === "endless" ? ENDLESS_RECORD_KEY : RUN_RECORD_KEY)); }
    catch { this.recordError = true; }
  }
  private save() {
    const w = this.world;
    this.record = { version: 1, distance: Math.max(this.record.distance, Math.floor(w.distance)), coins: Math.max(this.record.coins, w.coins), score: Math.max(this.record.score, w.score) };
    try {
      const stored = readRunRecord(localStorage.getItem(this.chosenMode === "endless" ? ENDLESS_RECORD_KEY : RUN_RECORD_KEY));
      this.record = { version: 1, distance: Math.max(this.record.distance, stored.distance, Math.floor(w.distance)), coins: Math.max(this.record.coins, stored.coins, w.coins), score: Math.max(this.record.score, stored.score, w.score) };
      localStorage.setItem(this.chosenMode === "endless" ? ENDLESS_RECORD_KEY : RUN_RECORD_KEY, JSON.stringify(this.record));
    } catch { this.recordError = true; }
  }
  private showPanel() {
    const w = this.world;
    this.overlay.hidden = this.ready && (w.phase === "running"||w.phase==="caught");
    if (this.overlay.hidden) return;
    const button = (action: string, text: string, secondary = false) => `<button data-run="${action}" class="${secondary ? "secondary" : "primary"}">${text}</button>`;
    if (!this.ready) { this.overlay.innerHTML = `<div class="runner-card"><h2>${this.error ? "加载失败" : "加载中…"}</h2>${this.error ? `<p>${this.error}</p>${button("retry-art", "重试")}` : ""}${button("exit", "返回", true)}</div>`; return; }
    if (w.phase === "ready") {
      this.overlay.innerHTML = `<div class="runner-card"><h2>奶蛙逃亡</h2><div class="runner-roster"><div><canvas width="140" height="110" data-portrait="dog" aria-label="玩家奶狗"></canvas><b>奶狗</b><small>你</small></div><span aria-hidden="true">VS</span><div><canvas width="140" height="110" data-portrait="chaser" aria-label="追赶者恐怖奶蛙"></canvas><b>恐怖奶蛙</b><small>追赶者</small></div></div><div class="runner-mode-select" aria-label="选择玩法"><button data-run="mode-endless" aria-pressed="${this.chosenMode === "endless"}">无限模式</button><button data-run="mode-challenge" aria-pressed="${this.chosenMode === "challenge"}">千米挑战</button></div><div class="runner-scene-select" aria-label="选择场景">${RUN_SCENES.map((scene,index)=>`<button data-run="scene-${scene.id}" aria-pressed="${index===this.chosenScene}">${scene.name}</button>`).join("")}</div><p>${this.chosenMode === "endless" ? "跑得越远，得分越高。" : "跑满1000米。"}</p><p class="runner-tip">左右换道，上跳下滑。<br>捡道具，躲开障碍，别被抓住。</p><div class="runner-record">最高分 <b>${this.record.score}</b>　最远 ${this.record.distance} 米</div>${button("start", "开始游戏")}${button("gyro", this.gyroState==="off"?"开启倾斜控制":"关闭倾斜控制", true)}<p class="runner-gyro-status" role="status">${this.gyroMessage}</p>${button("help", "玩法说明", true)}${button("exit", "返回", true)}${this.storageNotice()}</div>`;
    } else if (w.phase === "paused") {
      this.overlay.innerHTML = `<div class="runner-card"><h2>暂停</h2>${button("resume", "继续")}${button("restart", "重新开始", true)}${button("gyro",this.gyroState==="off"?"开启倾斜控制":"关闭倾斜控制",true)}${this.gyroState==="on"?button("calibrate","重新校准",true):""}<p class="runner-gyro-status" role="status">${this.gyroMessage}</p>${button("exit", "主菜单", true)}</div>`;
    } else {
      this.overlay.innerHTML = `<div class="runner-card runner-result"><h2>${w.phase === "won" ? "挑战完成" : "游戏结束"}</h2>${w.phase === "won" ? '<div class="runner-celebrate"><canvas class="runner-dog-win" width="160" height="140" aria-label="奶狗庆祝"></canvas><canvas class="runner-laugh" width="160" height="140" aria-label="奶蛙捧腹大笑庆祝"></canvas></div>' : `<p>${w.reason}</p><p class="runner-death-hint">${w.deathHint}</p>`}<div class="runner-result-stats"><span><b>${w.score}</b>得分</span><span><b>${Math.floor(w.distance)}</b>距离</span><span><b>${w.coins}</b>金币</span></div><p>最高分 ${this.record.score}　最远 ${this.record.distance} 米</p>${w.phase === "won" ? button("continue", "继续无限模式") : ""}${button("restart", "再跑一次", w.phase === "won")}${button("exit", "主菜单", true)}${this.storageNotice()}</div>`;
    }
    this.overlay.querySelector<HTMLButtonElement>(".primary")?.focus({ preventScroll: true });
  }
  private storageNotice() { return this.recordError ? '<p class="runner-tip" role="status">纪录未能保存。</p>' : ""; }
  private draw(time: number) {
    if(this.ready)this.renderer?.draw(this.world);
    const portrait = (selector: string, image: HTMLImageElement | undefined, frame: number, columns: number, rows: number) => {
      const canvas=this.overlay.querySelector<HTMLCanvasElement>(selector);if(!canvas||!image)return;
      const ctx=canvas.getContext("2d")!,cw=image.width/columns,ch=image.height/rows;
      ctx.clearRect(0,0,canvas.width,canvas.height);
      ctx.drawImage(image,(frame%columns)*cw,Math.floor(frame/columns)*ch,cw,ch,(canvas.width-canvas.height)/2,0,canvas.height,canvas.height);
    };
    portrait('[data-portrait="dog"]',this.actionArt,4,4,2);
    portrait('[data-portrait="chaser"]',this.chaserArt,0,4,4);
    portrait('.runner-dog-win',this.actionArt,4,4,2);
    const laugh = this.overlay.querySelector<HTMLCanvasElement>(".runner-laugh");
    if(laugh && this.laughArt){
      const lc=laugh.getContext("2d")!,size=laugh.height;
      const pulse=this.settings.reducedMotion?0:Math.sin(time*12)*1.5;
      lc.clearRect(0,0,laugh.width,laugh.height);
      lc.drawImage(this.laughArt,1024,512,512,512,(laugh.width-size)/2,0,size,size+pulse);
    }
  }

  destroy() {
    if (this.destroyed) return;
    if (this.world.phase === "running" || this.world.phase === "paused" || this.world.phase === "caught") this.save();
    this.destroyed = true; cancelAnimationFrame(this.frame); this.abort.abort(); this.resize.disconnect(); this.audio.setPlaying(false);clearTimeout(this.gyroTimer);this.renderer?.dispose();
  }
}
