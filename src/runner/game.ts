import "./runner.css";
import { loadImage } from "../loading.ts";
import type { Settings } from "../settings.ts";
import type { AudioManager } from "../audio.ts";
import { dogPose, chaserFrame } from "./animation.ts";
import { RunnerWorld, RUN_SCENES, RUN_RECORD_KEY, ENDLESS_RECORD_KEY, readRunRecord, type RunAction, type RunPhase, type RunMode } from "./world.ts";

export class RunnerGame {
  private world = new RunnerWorld(crypto.getRandomValues(new Uint32Array(1))[0], "endless");
  private chosenMode: RunMode = "endless";
  private chosenScene = 0;
  private record = readRunRecord(null);
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private frame = 0;
  private last = 0;
  private uiPhase: RunPhase | "loading" = "loading";
  private destroyed = false;
  private ready = false;
  private runArt?: HTMLImageElement;
  private actionArt?: HTMLImageElement;
  private chaserArt?: HTMLImageElement;
  private powerArt?: HTMLImageElement;
  private laughArt?: HTMLImageElement;
  private scenery?: HTMLImageElement;
  private sceneArt: HTMLImageElement[] = [];
  private mandatoryArt?: HTMLImageElement;
  private stone?: HTMLImageElement;
  private props?: HTMLImageElement;
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
    root.innerHTML = `<main class="runner-screen" aria-label="奶蛙逃亡"><canvas class="runner-canvas" aria-label="三轨水渠跑道，使用方向键或滑动操作"></canvas><header class="runner-header"><button data-run="exit" aria-label="返回模式选择">‹ <span>返回</span></button><div><h1>奶蛙逃亡</h1><small id="runner-scene"></small></div><button data-run="pause" aria-label="暂停跑酷">Ⅱ</button></header><div class="runner-hud"><div><span>得分</span><strong id="run-score">0</strong></div><div><span>距离</span><strong id="run-distance">0<small>米</small></strong></div><div><span>金币</span><strong id="run-coins">0</strong></div></div><p class="runner-turn" role="status" aria-live="polite" hidden></p><div class="runner-action-cue" role="status" hidden></div><div class="runner-effects" aria-label="道具效果"></div><p class="runner-warning" role="status" hidden></p><section class="runner-panel" aria-live="polite"></section><nav class="runner-controls" aria-label="跑酷操作"><button data-run="left" aria-label="左换道或左转">←</button><button data-run="jump" aria-label="跳跃">↑<small>跳跃</small></button><button data-run="slide" aria-label="滑铲">↓<small>滑铲</small></button><button data-run="right" aria-label="右换道或右转">→</button></nav><footer class="runner-footnote">← → 换道　↑ 跳跃　↓ 下滑</footer></main>`;
    this.canvas = root.querySelector("canvas")!;
    this.ctx = this.canvas.getContext("2d")!;
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
      const [run, laugh, scenery, stone, props, actions, chaser, power, temple, mine, mandatory] = await Promise.all([
        loadImage("/assets/runner/milk-dog-run-v2.png"), loadImage("/assets/character/milk-frog-atlas.webp"),
        loadImage("/assets/runner/aqueduct-scene-v1.png"), loadImage("/assets/runner/wet-stone-v1.png"), loadImage("/assets/runner/obstacles-v1.png"),
        loadImage("/assets/runner/milk-dog-actions-v2.png"), loadImage("/assets/character/haunted-frog-directions-walk-v1.webp"), loadImage("/assets/runner/powerups-v1.png"),
        loadImage(RUN_SCENES[1].image), loadImage(RUN_SCENES[2].image), loadImage("/assets/runner/mandatory-obstacles-v1.png"),
      ]);
      if (this.destroyed) return;
      this.runArt = run; this.laughArt = laugh; this.scenery = scenery; this.stone = stone; this.props = props;
      this.actionArt = actions; this.chaserArt = chaser; this.powerArt = power;
      this.sceneArt = [scenery,temple,mine]; this.mandatoryArt = mandatory;
      this.ready = true; this.uiPhase = "ready"; this.showPanel();
    } catch {
      if (this.destroyed) return;
      this.error = "加载失败，请重试。"; this.showPanel();
    }
  }
  private onClick = (event: Event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-run]");
    if (!button) return;
    const action = button.dataset.run;
    if (action === "exit") { this.exit(); return; }
    if (action === "help") { this.overlay.innerHTML = `<div class="runner-card"><h2>玩法说明</h2><div class="runner-guide"><span>← →<b>换道 / 转弯</b></span><span>↑<b>跳跃</b></span><span>↓<b>下滑</b></span></div><p>电脑：方向键或 WASD，空格跳跃，Esc 暂停。<br>手机：滑动屏幕，或点下方按钮。</p><p>磁铁：自动吸取附近金币。<br>护盾：挡住一次撞击或掉落。<br>冲刺：加速前进，自动避障和转弯。</p><p>连续收币可提高金币分数，最高5倍。<br>撞到木箱或横梁后，8秒内再撞一次会被抓。<br>全路倒木、断沟必须跳，低门必须下滑。<br>每450米切换场景，弯道按大箭头转。</p><button data-run="help-back" class="primary">返回</button></div>`; return; }
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
    if (action === "start" && this.ready) { this.world.start(); this.audio.setPlaying(true); }
    else if (action === "restart") { this.resetFeedback(); this.world = new RunnerWorld(crypto.getRandomValues(new Uint32Array(1))[0], this.chosenMode, this.chosenScene); this.world.start(); this.audio.setPlaying(true); }
    else if (action === "continue") { this.chosenMode = "endless"; this.loadRecord(); this.world.continue(); this.audio.setPlaying(true); }
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
    this.world.action(action);
    this.audio.effect("tap"); this.sync();
  }
  private resetFeedback(){this.turnAt=-10;this.observedTurns=0;this.warnedTurn=-1;this.urgentTurn=-1;}
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
    this.sceneLabel.textContent=RUN_SCENES[w.sceneIndex].name;
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
      const markup=`<strong>${slide?"↓":"↑"}</strong><span>${slide?"下滑":"跳跃"}<small>${distance} 米 · ${slide?"低门":forced.kind==="gap"?"断沟":"倒木"}</small></span>`;
      if(this.cue.innerHTML!==markup)this.cue.innerHTML=markup;
      this.cue.classList.toggle("now",forced.z-w.distance<w.speed*.6);
    }
    if (this.ready && this.uiPhase !== w.phase) {
      if (w.phase === "lost" || w.phase === "won") { this.save(); this.audio.setPlaying(false); if (w.phase === "won") this.audio.effect("win"); }
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
    this.overlay.hidden = this.ready && w.phase === "running";
    if (this.overlay.hidden) return;
    const button = (action: string, text: string, secondary = false) => `<button data-run="${action}" class="${secondary ? "secondary" : "primary"}">${text}</button>`;
    if (!this.ready) { this.overlay.innerHTML = `<div class="runner-card"><h2>${this.error ? "加载失败" : "加载中…"}</h2>${this.error ? `<p>${this.error}</p>${button("retry-art", "重试")}` : ""}${button("exit", "返回", true)}</div>`; return; }
    if (w.phase === "ready") {
      this.overlay.innerHTML = `<div class="runner-card"><h2>奶蛙逃亡</h2><div class="runner-roster"><div><canvas width="140" height="110" data-portrait="dog" aria-label="玩家奶狗"></canvas><b>奶狗</b><small>你</small></div><span aria-hidden="true">VS</span><div><canvas width="140" height="110" data-portrait="chaser" aria-label="追赶者恐怖奶蛙"></canvas><b>恐怖奶蛙</b><small>追赶者</small></div></div><div class="runner-mode-select" aria-label="选择玩法"><button data-run="mode-endless" aria-pressed="${this.chosenMode === "endless"}">无限模式</button><button data-run="mode-challenge" aria-pressed="${this.chosenMode === "challenge"}">千米挑战</button></div><div class="runner-scene-select" aria-label="选择场景">${RUN_SCENES.map((scene,index)=>`<button data-run="scene-${scene.id}" aria-pressed="${index===this.chosenScene}">${scene.name}</button>`).join("")}</div><p>${this.chosenMode === "endless" ? "跑得越远，得分越高。" : "跑满1000米。"}</p><p class="runner-tip">左右换道，上跳下滑。<br>捡道具，躲开障碍，别被抓住。</p><div class="runner-record">最高分 <b>${this.record.score}</b>　最远 ${this.record.distance} 米</div>${button("start", "开始游戏")}${button("help", "玩法说明", true)}${button("exit", "返回", true)}${this.storageNotice()}</div>`;
    } else if (w.phase === "paused") {
      this.overlay.innerHTML = `<div class="runner-card"><h2>暂停</h2>${button("resume", "继续")}${button("restart", "重新开始", true)}${button("exit", "主菜单", true)}</div>`;
    } else {
      this.overlay.innerHTML = `<div class="runner-card runner-result"><h2>${w.phase === "won" ? "挑战完成" : "游戏结束"}</h2>${w.phase === "won" ? '<div class="runner-celebrate"><canvas class="runner-dog-win" width="160" height="140" aria-label="奶狗庆祝"></canvas><canvas class="runner-laugh" width="160" height="140" aria-label="奶蛙捧腹大笑庆祝"></canvas></div>' : `<p>${w.reason}</p>`}<div class="runner-result-stats"><span><b>${w.score}</b>得分</span><span><b>${Math.floor(w.distance)}</b>距离</span><span><b>${w.coins}</b>金币</span></div><p>最高分 ${this.record.score}　最远 ${this.record.distance} 米</p>${w.phase === "won" ? button("continue", "继续无限模式") : ""}${button("restart", "再跑一次", w.phase === "won")}${button("exit", "主菜单", true)}${this.storageNotice()}</div>`;
    }
    this.overlay.querySelector<HTMLButtonElement>(".primary")?.focus({ preventScroll: true });
  }
  private storageNotice() { return this.recordError ? '<p class="runner-tip" role="status">纪录未能保存。</p>' : ""; }
  private draw(time: number) {
    const c = this.ctx, width = this.canvas.width, height = this.canvas.height;
    c.setTransform(width / 600, 0, 0, height / 800, 0, 0);
    const aspect = (height / 800) / (width / 600);
    const laneSpacing = Math.min(190,Math.max(110,288-100*aspect));
    if (!this.scenery || !this.stone || !this.props) return;
    c.clearRect(0,0,600,800);
    c.save();
    const turning = this.world.elapsed - this.turnAt;
    if (!this.settings.reducedMotion && turning >= 0 && turning < .8) {
      c.translate(300+this.turnDirection*Math.sin(turning/.8*Math.PI)*55,400); c.rotate(this.turnDirection * Math.sin(turning / .8 * Math.PI) * .13); c.translate(-300,-400);
    }
    const scenery=this.sceneArt[this.world.sceneIndex];
    if(this.world.sceneIndex===0)c.drawImage(scenery,-105,-168,810,980);
    else c.drawImage(scenery,-105,-60,810,1080);
    const hitAge=this.world.elapsed-this.world.hitAt;
    if(!this.settings.reducedMotion&&hitAge>=0&&hitAge<.25)c.translate(Math.sin(hitAge*90)*5*(1-hitAge/.25),0);
    const upcoming = this.world.approachingTurn;
    const cornerDistance = upcoming ? upcoming.z - this.world.distance : Infinity;
    const project = (lane: number, z: number) => {
      const s = 1 / (1 + Math.max(0,z) / 19);
      const bend = upcoming && cornerDistance < 90 ? (upcoming.direction === "left" ? -1 : 1) * Math.min(1,Math.max(0,(z-cornerDistance+10)/45)) * 110 / (1+cornerDistance/65) : 0;
      return { x: 300 + bend + (lane-1)*laneSpacing*s, y: 180+530*s, s };
    };
    // Inverse perspective maps the generated wet-stone bitmap to a moving road.
    // Every visible surface comes from the image assets; strips only project pixels.
    const strip = this.settings.quality === "high" ? 1 : 2;
    const texture = this.world.sceneIndex===2 ? scenery : this.stone;
    const textureHeight=this.world.sceneIndex===2?texture.height*.25:texture.height;
    const textureOffset=this.world.sceneIndex===2?texture.height*.7:0;
    for (let y = 205; y < 800; y += strip) {
      const near = 19*(530/(y+strip-180)-1), far = 19*(530/(y-180)-1);
      const p = project(1,Math.max(0,near));
      const roadScale = (y+strip-180)/530;
      const sy = (-(this.world.distance + far)*36 % textureHeight + textureHeight) % textureHeight;
      const sh = Math.max(1,(far-near)*36);
      c.globalAlpha = Math.min(.94,Math.max(0,(y-205)/100));
      let sampled = 0;
      while (sampled < sh) {
        const sourceY = (sy+sampled)%textureHeight, count = Math.min(sh-sampled,textureHeight-sourceY);
        c.drawImage(texture,0,sourceY+textureOffset,texture.width,count,p.x-300*roadScale,y+strip*sampled/sh,600*roadScale,strip*count/sh+.5);
        sampled += count;
      }
    }
    c.globalAlpha = 1;

    for (const item of [...this.world.items].sort((a,b)=>b.z-a.z)) {
      if (item.done || item.z < this.world.distance-2) continue;
      const p = project(item.lane,item.z-this.world.distance), s = p.s;
      const isPower = item.kind === "magnet" || item.kind === "shield" || item.kind === "boost";
      const mandatory=item.span===3;
      const cart=this.world.sceneIndex===2&&item.kind==="block"&&!mandatory;
      const image = mandatory||cart ? this.mandatoryArt! : isPower ? this.powerArt! : this.props;
      const cell = image.width/2;
      const frame = mandatory ? item.kind==="block"?0:item.kind==="beam"?1:3 : cart?2:isPower ? item.kind==="magnet"?0:item.kind==="shield"?1:2:item.kind==="block"?0:item.kind==="beam"?1:item.kind==="gap"?2:3;
      const width = mandatory ? 650 : isPower ? 96 : item.kind === "coin" ? 76 : item.kind === "gap" ? 204 : item.kind === "beam" ? 194 : 154;
      const height = mandatory ? item.kind==="beam"?185:item.kind==="gap"?70:95 : isPower?96:item.kind==="coin"?76:item.kind==="gap"?95:item.kind==="beam"?185:154;
      const lift=mandatory ? item.kind==="gap"?35:height : isPower?85:item.kind==="coin"?62:item.kind==="gap"?65:height*.95;
      const cropTop=mandatory?(item.kind==="block"?.4:item.kind==="beam"?.2:.28):0;
      const cropHeight=mandatory?(item.kind==="block"?.35:item.kind==="beam"?.58:.38):1;
      c.drawImage(image,(frame%2)*cell,(Math.floor(frame/2)+cropTop)*cell,cell,cell*cropHeight,p.x-width*s/2,p.y-lift*s,width*s,height*s);
    }
    if (this.runArt && this.actionArt) {
      const w = this.world, x = 300+(w.position-1)*laneSpacing, jump = w.jumpHeight*160;
      c.fillStyle = "#062b3566"; c.beginPath(); c.ellipse(x,706,62*(1-w.jumpHeight*.35),10,0,0,Math.PI*2); c.fill();
      let pose = dogPose(w,this.settings.reducedMotion);
      if(turning>=0 && turning<.4 && w.phase === "running" && !w.jump && !w.slide) pose = {sheet:"actions",frame:this.turnDirection<0?6:7};
      const image = pose.sheet === "run" ? this.runArt : this.actionArt;
      const cellW = image.width/4, cellH = image.height/2, size = 200;
      c.drawImage(image,(pose.frame%4)*cellW,Math.floor(pose.frame/4)*cellH,cellW,cellH,x-size*aspect/2,710-size*.88-jump,size*aspect,size);
      if(w.shield>0 && this.powerArt){
        const cell=this.powerArt.width/2;c.globalAlpha=.3;
        c.drawImage(this.powerArt,cell,cell,cell,cell,x-120*aspect,710-216-jump,240*aspect,240);c.globalAlpha=1;
      }
      // Chase-camera view: back frames face toward the dog, never toward the viewer.
      if(this.chaserArt && w.phase!=="ready" && w.phase!=="won"){
        const caught=w.phase==="lost"&&w.reason!=="掉下去了"&&w.elapsed-w.hitAt<1;
        const close=caught?1:w.danger/8;
        if(close>0){
          const cell=this.chaserArt.width/4,size=205+close*40,frame=chaserFrame(w,this.settings.reducedMotion);
          const enemyX=x;
          c.drawImage(this.chaserArt,(frame%4)*cell,Math.floor(frame/4)*cell,cell,cell,enemyX-size*aspect/2,1000-close*150-size,size*aspect,size);
        }
      }
    }
    c.restore();
    c.setTransform(1,0,0,1,0,0);
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
    if (this.world.phase === "running" || this.world.phase === "paused") this.save();
    this.destroyed = true; cancelAnimationFrame(this.frame); this.abort.abort(); this.resize.disconnect(); this.audio.setPlaying(false);
  }
}
