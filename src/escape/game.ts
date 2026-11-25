import { ESCAPE_TITLE } from "./title.ts";
import "./style.css";
import "./hud.css";
import "./ability-hud.css";
import { AbilityHud } from "./ability-hud.ts";
import { floorAt } from "./basement-map.ts";
import { SAVE_GENERATION } from "../save-generation.ts";
import { displayPerception } from "./interference.ts";
import { NoteDialog } from "./note-dialog.ts";
import "./note-dialog.css";
import { icon } from "./icons.ts";
import { SaveWriteError, writeSaveBatch } from "./save.ts";
import { CinematicPlayer, randomOpeningClip, randomCaughtClip } from "./cinematic.ts";
import { PoseBuffer } from "./coop-smoothing.ts";
import { bagMarkup, type BagTab } from "./backpack.ts";
import { AudioManager } from "../audio.ts";
import type { Settings } from "../settings.ts";
import { EscapeWorld, ITEM_NAMES, PROPS, type EscapeSnapshot } from "./world.ts";
import { DEFAULT_HUNTER_DIFFICULTY, hunterDifficulty } from "./hunter-search-model.ts";
import type { EscapeRenderer, EscapeArt } from "./renderer.ts";
import { prepareEscape, returnPreparedEscape, takePreparedEscape } from "./preparation.ts";
import { EscapeLook, type MouseLookMode } from "./look.ts";
import { CoopClient, type CoopConnectionState } from "./coop-client.ts";
import {CoopMovement} from './coop-movement.ts';
import {SocialClient} from './social-client.ts';
import {renderLobbyView,updateRouteReadings,type LobbyModel,type LobbyScreen} from './lobby-view.ts';
import {HIGH_LATENCY_MS, PUBLIC_GAME_ORIGIN, PUBLIC_ROUTES, measureRoomRoute, type PublicRouteId, type RouteLatencies} from './public-route.ts';
import './lobby-view.css';
import type { CoopInput, CoopSnapshot } from "./coop-protocol.ts";
import { version as APP_VERSION } from "../../package.json";
import "./coop.css";
import "./backpack.css";
import "./theme.css";
export { prepareEscape } from "./preparation.ts";

const SESSION = "nwaxz-escape-session-v1", RECORD = "nwaxz-escape-record-v1", SOUND = "nwaxz-escape-sound-v1";
const HUNTER_DIFFICULTY = "nwaxz-escape-hunter-difficulty";
const HUD = "nwaxz-escape-hud-v1";
type Best = { version: 2; escapes: number; bestTimeMs: number; fewestCaptures: number; mostNotes: number };
const time = (seconds: number) => `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;
const safe = (s: string) => s.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
function readBest(raw: unknown): Best | undefined {
  if (!raw || typeof raw !== "object") return;
  const r = raw as Best;
  if (r.version !== 2 || !Number.isInteger(r.escapes) || r.escapes < 1 || r.escapes > 1e9 || !Number.isInteger(r.bestTimeMs) || r.bestTimeMs < 0 || r.bestTimeMs > 86400_000 || !Number.isInteger(r.fewestCaptures) || r.fewestCaptures < 0 || r.fewestCaptures > 2 || !Number.isInteger(r.mostNotes) || r.mostNotes < 0 || r.mostNotes > PROPS.filter(p => p.kind === "note").length) return;
  return { version: 2, escapes: r.escapes, bestTimeMs: r.bestTimeMs, fewestCaptures: r.fewestCaptures, mostNotes: r.mostNotes };
}
export class EscapeGame {
  world = new EscapeWorld();
  private renderer?: EscapeRenderer;
  private art?: EscapeArt;
  private controller = new AbortController();
  private raf = 0;
  private lastFrame = 0;
  private paused = true;
  private started = false;
  private disposed = false;
  private preparationSequence = 0;
  private cinematic?: CinematicPlayer;
  private saved?: EscapeSnapshot;
  private record?: Best;
  private storageWarning = "";
  private keys = new Set<string>();
  private stick = { x: 0, y: 0 };
  private look?: EscapeLook;
  private mouseMode: MouseLookMode = "click";
  private mouseHintUntil = 0;
  private unlockAt = -1000;
  private saveAt = 0;
  private hudAt = 0;
  private heartbeatAt = 0;
  private lastNotice = "";
  private noticeUntil = 0;
  private thinkingUntil = 0;
  private soloDifficulty = DEFAULT_HUNTER_DIFFICULTY;
  private inventoryKey = "";
  private lastRoom = "";
  private roomCueUntil = -1;
  private phase = "playing";
  private music = true;
  private sound = true;
  private hudDetails = false;
  private abilityHud: AbilityHud;
  private noteDialog: NoteDialog;
  private noteActive = false;
  private noteReturnToJournal = false;
  private coop?: CoopClient;
  private lobbyNetwork: "online"|"lan" = "online";
  private preferredRoute?:PublicRouteId;
  private routeLatencies:RouteLatencies={};
  private nextRouteProbe=0;
  private coopSnapshot?: CoopSnapshot;
  private coopState: CoopConnectionState = "offline";
  private coopMessage = "";
  private coopLatency?: number;
  private coopLastMoveAt = 0;
  private coopSeenRevision = -1;
  private coopMode = false;
  private coopStarting = false;
  private coopLobbySignature = "";
  private coopAssetsReady = false;
  private coopWasCaught = false;
  /** Set while a respawn request is in flight; the first "connected" snapshot after it resumes play once. */
  private coopAwaitingRespawn = false;
  /** Hunter and teammates are drawn slightly in the past, interpolated between server snapshots. */
  private coopPoses = new PoseBuffer(100);
  private bagTab: BagTab = "items";
  private bagSelected?: string;
  private coopFinal = false;
  private coopSyncFaulted = false;
  private coopRecovering = false;
  private coopRequesting = false;
  private coopMovement=new CoopMovement();
  private coopTeamSignature='';
  private social=new SocialClient();
  private lobbyScreen:LobbyScreen='home';
  private lobbyScreenStack:LobbyScreen[]=[];
  private lobbyVisible=false;
  private lobbyDisposer?:()=>void;
  private lobbyTimer=0;
  private lobbyRefreshing=false;
  private lobbyMessage?:string;
  private lobbyServerData?:Awaited<ReturnType<SocialClient['servers']>>;
  private lobbyFriendData:Awaited<ReturnType<SocialClient['friends']>>={friends:[],requests:[],invitations:[]};
  private coopUnsubscribers: (() => void)[] = [];
  private readonly signal = this.controller.signal;
  constructor(private root: HTMLElement, private audio: AudioManager, private settings: Settings, private exit: () => void) {
    try {
      const difficulty = localStorage.getItem(HUNTER_DIFFICULTY);
      if (difficulty !== null && /^\d{1,3}$/.test(difficulty)) this.soloDifficulty = hunterDifficulty(Number(difficulty));
      const session = localStorage.getItem(SESSION);
      if (session) {
        try { this.saved = EscapeWorld.restore(JSON.parse(session)).snapshot(); }
        catch { localStorage.removeItem(SESSION); localStorage.removeItem(RECORD); this.storageWarning = "存档格式已更新，重新开始逃生。"; }
      }
      const record = localStorage.getItem(RECORD); if (record) this.record = readBest(JSON.parse(record));
      const sound = JSON.parse(localStorage.getItem(SOUND) ?? "null");
      if (sound && typeof sound.music === "boolean" && typeof sound.sound === "boolean") { this.music = sound.music; this.sound = sound.sound; }
      else this.sound = settings.sound;
    } catch { this.storageWarning = "存档读取失败，可从备份恢复。"; }
    this.root.innerHTML = `<main class="escape-shell" aria-label="${ESCAPE_TITLE}"><canvas id="escape-view" tabindex="0" aria-label="3D第一人称逃生。WASD移动，Shift切换奔跑，C切换蹲行；点击画面后移动鼠标转头，手机滑动转头。E交互，Esc暂停并释放鼠标。"></canvas>
      <header class="escape-hud"><button id="escape-pause" class="escape-round" aria-label="暂停逃生">${icon("pause")}</button><button id="escape-bag" class="escape-round escape-bag-button" aria-label="打开背包，快捷键B" title="背包 B"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 9h14l-1.2 11H6.2Z"/><path d="M9 9V7a3 3 0 0 1 6 0v2M9 13h6"/></svg><kbd>B</kbd></button><div class="escape-location"><span id="escape-room">${safe(this.world.room)}</span><span id="escape-night">第1夜 · 00:00</span><div id="escape-lives" aria-label="剩余机会"></div></div></header><p class="escape-objective" id="escape-objective" aria-live="polite"></p>
      <button id="escape-map" class="escape-map-button" aria-label="查看地图，当前位置：${safe(this.world.room)}"><canvas id="escape-minimap" width="208" height="208" aria-hidden="true"></canvas><span>浴场地图 <kbd>M</kbd></span><small id="escape-map-room">${safe(this.world.room)}</small></button>
      <div class="escape-inventory" id="escape-inventory" aria-label="随身物品"></div>
      <section class="escape-hunt" aria-label="奶蛙追击状态"><div class="escape-exposure"><div class="escape-exposure-heading"><strong id="escape-exposure-label">暴露值</strong><b id="escape-exposure-value">0</b><span>/100</span><strong id="escape-hunt-state">平静</strong><button id="escape-hud-toggle" aria-expanded="false" aria-controls="escape-source-details"><span>详情</span><kbd>Tab</kbd></button><button id="escape-hud-help" aria-label="暴露规则说明" title="暴露规则说明">?</button></div><meter id="escape-exposure" aria-label="暴露值" min="0" max="100" value="0"></meter><p id="escape-exposure-hint">保持安静，留意周围。</p></div><div class="escape-secondary-meters" id="escape-source-details"><div class="escape-source"><div><strong>声音</strong><b id="escape-noise-value">0</b></div><meter id="escape-noise" aria-label="声音暴露" min="0" max="100" value="0"></meter><small id="escape-noise-info">静止</small><em id="escape-noise-contribution">+0分 · 0%</em></div><div class="escape-source"><div><strong>灯光</strong><b id="escape-glare-value">0</b></div><meter id="escape-glare" aria-label="灯光暴露" min="0" max="100" value="0"></meter><small id="escape-glare-info">未照中</small><em id="escape-glare-contribution">+0分 · 0%</em></div><div class="escape-source"><div><strong>视觉</strong><b id="escape-sight-value">0</b></div><meter id="escape-sight" aria-label="视觉暴露" min="0" max="100" value="0"></meter><small id="escape-sight-info">未被看到</small><em id="escape-sight-contribution">+0分 · 0%</em></div></div></section>
      <div class="escape-hunter-bearing" id="escape-hunter-bearing" aria-label="奶蛙方向" hidden>‹ 奶蛙</div>
      <div class="escape-room-toast" id="escape-room-toast" aria-live="polite" hidden></div>
      <div class="escape-mouse-hint" id="escape-mouse-hint" hidden>点击画面，移动鼠标转头</div>
      <div class="escape-crosshair" aria-hidden="true"></div><div class="escape-danger" id="escape-danger" role="status"></div><div class="escape-notice" id="escape-notice" role="status" aria-live="polite" hidden></div>
      <div class="escape-search" id="escape-search" hidden><span>搜索中</span><progress max="1.15" value="0" aria-label="搜索进度"></progress></div>
      <div class="escape-bottom"><div id="escape-movement" class="escape-movement">步行 · Shift 切换奔跑 · C 蹲行</div><div class="escape-meters"><label title="体力"><span>体力</span>${icon("run")}<meter id="escape-stamina" aria-label="体力" min="0" max="100" value="100"></meter><b id="escape-stamina-value">100</b></label><label title="疲劳"><span id="escape-effort-label">疲劳</span>${icon("run")}<meter id="escape-effort" aria-label="行走疲劳" min="0" max="100" value="0"></meter><b id="escape-effort-value">0</b></label><label title="手电电量"><span>电量</span>${icon("light")}<meter id="escape-battery" aria-label="手电电量" min="0" max="100" value="100"></meter><b id="escape-battery-value">100</b></label></div>
      <div class="escape-controls"><div class="escape-stick" id="escape-stick" aria-label="移动摇杆"><span></span></div><div class="escape-actions"><button id="escape-light" aria-label="开关手电" title="手电 F">${icon("light")}<span>手电</span><kbd>F</kbd></button><button id="escape-crouch" aria-label="切换蹲行，按 C 切换" title="蹲行 C：切换">${icon("crouch")}<span>蹲行</span><kbd>C</kbd></button><button id="escape-stone" aria-label="丢石子" title="石子 Q">${icon("stone")}<span>石子</span><b id="escape-stones">2</b><kbd>Q</kbd></button><button id="escape-sprint" aria-label="切换奔跑" title="奔跑 Shift：切换">${icon("run")}<span>奔跑</span><kbd>Shift</kbd></button><div class="escape-crystals"><button id="escape-freeze" aria-label="使用冻结晶，快捷键1"><i class="crystal-icon freeze">❄</i><span>冻结</span><b id="escape-freeze-count">0</b><small id="escape-freeze-time">余 0s</small><kbd>1</kbd></button><button id="escape-reveal" aria-label="使用显形晶，快捷键2"><i class="crystal-icon reveal">◇</i><span>显形</span><b id="escape-reveal-count">0</b><small id="escape-reveal-time">余 0s</small><kbd>2</kbd></button><button id="escape-ward" aria-label="使用净化晶，快捷键3" title="净化晶 3"><i class="crystal-icon ward">✦</i><span>净化</span><b id="escape-ward-count">0</b><small id="escape-ward-label">净化保护</small><progress id="escape-ward-progress" max="60" value="0" aria-label="净化保护剩余进度"></progress><kbd>3</kbd></button></div></div></div>
      <button class="escape-interact" id="escape-interact" hidden>${icon("hand")}<span></span><kbd>E</kbd></button></div>
      <aside id="escape-coop-team" class="escape-coop-team" aria-label="队友" hidden></aside><div id="escape-coop-status" class="escape-coop-status" hidden></div>
      <div id="escape-panel" class="escape-panel" role="dialog" aria-modal="true" aria-label="逃生菜单"></div><input id="escape-import" type="file" accept=".json,application/json" hidden></main>`;
    this.abilityHud = new AbilityHud(this.$(".escape-shell"));
    this.noteDialog = new NoteDialog(this.$(".escape-shell"), () => {
      if (!this.noteActive) return;
      this.noteActive = false;
      if (this.noteReturnToJournal) this.showJournal(); else this.resume();
    });
    try { this.hudDetails = localStorage.getItem(HUD) === "expanded"; } catch { /* Keep compact without storage. */ }
    this.applyHudDetails();
    this.adoptPrepared();
    this.bind(); this.intro();
    this.raf = requestAnimationFrame(this.frame);
    // Dev server only (stripped from production builds): lets QA scripts inspect the run.
    if (import.meta.env.DEV) (window as Window & { __escape?: unknown }).__escape = this;
  }
  private $<T extends HTMLElement = HTMLElement>(selector: string) { return this.root.querySelector<T>(selector)!; }
  private applyHudDetails() {
    this.$(".escape-hunt").classList.toggle("details-open", this.hudDetails);
    const button = this.$("#escape-hud-toggle");
    button.setAttribute("aria-expanded", String(this.hudDetails));
    button.setAttribute("aria-label", `${this.hudDetails ? "收起" : "展开"}警戒详情，Tab切换`);
    button.querySelector("span")!.textContent = this.hudDetails ? "收起" : "详情";
  }
  private toggleHudDetails() {
    this.hudDetails = !this.hudDetails; this.applyHudDetails();
    try { localStorage.setItem(HUD, this.hudDetails ? "expanded" : "compact"); } catch { /* The toggle still works. */ }
  }
  private button(id: string, fn: () => void) { this.$(`#${id}`).addEventListener("click", fn, { signal: this.signal }); }
  private preparePanel() {
    this.lobbyVisible=false;this.lobbyDisposer?.();this.lobbyDisposer=undefined;
    this.abilityHud.update({ ...this.world.data.abilities, floor: floorAt(this.world.data.player) }, false, this.settings.reducedMotion);
    this.look?.suspend();
    this.$(".escape-shell").classList.remove("intro-active");
    this.$(".escape-shell").classList.remove("capture-active");
    this.$("#escape-panel").classList.remove("escape-intro", "escape-pause-panel", "escape-map-panel", "escape-lobby-panel", "escape-bag-panel");
    this.$(".escape-shell").classList.add("menu-active");
    this.$("#escape-panel").hidden = false;
  }
  private panel(html: string) {
    this.preparePanel();
    this.$("#escape-panel").innerHTML = `<section class="escape-card">${html}</section>`;
    this.$("#escape-panel").querySelector<HTMLButtonElement>("button")?.focus({ preventScroll: true });
  }
  private intro() {
    this.paused = true; this.audio.setPlaying(false);
    this.showSocialLobby('home');
  }
  private showSocialLobby(screen:LobbyScreen){
    this.preparePanel();this.$("#escape-panel").classList.add("escape-lobby-panel");this.lobbyVisible=true;this.lobbyScreen=screen;this.lobbyScreenStack=[];this.lobbyMessage=undefined;this.renderSocialLobby();
    if(!this.lobbyTimer)this.lobbyTimer=window.setInterval(()=>{if(this.lobbyVisible)void this.refreshSocialLobby();else if(this.started&&!this.coopMode&&this.social.identity)void this.social.ensure().catch(()=>{});},15000);
    void this.refreshSocialLobby();
  }
  private openLobbyScreen(screen:LobbyScreen){
    if(this.lobbyScreen===screen)return;
    this.lobbyScreenStack.push(this.lobbyScreen);this.lobbyScreen=screen;this.lobbyMessage=undefined;this.lobbyVisible=true;this.renderSocialLobby();
  }
  private backLobbyScreen(){
    this.lobbyScreen=this.lobbyScreenStack.pop()??'home';this.lobbyMessage=undefined;this.lobbyVisible=true;this.renderSocialLobby();
  }
  private socialMessage(message:string){
    if(this.disposed)return;
    this.lobbyMessage=message;
    const main=this.root.querySelector('.lv-main');if(!main)return;let notice=main.querySelector<HTMLElement>('.lv-message');
    if(!notice){notice=document.createElement('p');notice.className='lv-message';notice.setAttribute('role','status');main.prepend(notice);}notice.textContent=message;
  }
  private async refreshSocialLobby(){
    if(this.lobbyRefreshing||this.disposed||!navigator.onLine)return;this.lobbyRefreshing=true;
    try{
      const results=await Promise.allSettled([this.social.ensure(),this.social.servers()]);
      if(results[1].status==='fulfilled')this.lobbyServerData=results[1].value;else this.lobbyServerData=undefined;
      if(results[0].status==='fulfilled')this.lobbyFriendData=await this.social.friends();
      if(this.lobbyVisible&&!this.root.querySelector('.lv-modal')&&!this.root.querySelector('input:focus'))this.renderSocialLobby();
      const failure=results.find(r=>r.status==='rejected');if(failure?.status==='rejected')this.socialMessage(failure.reason instanceof Error?failure.reason.message:'暂时无法连接服务器');
    }catch(error){this.socialMessage(error instanceof Error?error.message:'连接失败');}finally{this.lobbyRefreshing=false;}
  }
  private renderSocialLobby(){
    if(!this.lobbyVisible||this.disposed)return;
    const room=this.coopSnapshot?.room??(this.coop?{code:this.coop.session.code,phase:'lobby' as const,leaderId:this.coop.session.leader?this.coop.session.playerId:'',players:[]}:undefined);
    const profile=this.social.identity??{uid:'—',name:'幸存者',avatar:0};
    const rootScreen=this.lobbyScreenStack[0]??this.lobbyScreen;
    const model:LobbyModel={network:this.lobbyNetwork,profile,version:APP_VERSION,selfPlayerId:this.coop?.session.playerId,screen:this.lobbyScreen,rootScreen,canResume:!!this.saved&&["playing","caught"].includes(this.saved.phase),hasSave:!!this.saved,music:this.music,sound:this.sound,soloDifficulty:this.soloDifficulty,storageWarning:this.storageWarning,touchControls:matchMedia("(pointer:coarse)").matches,expanded:!!this.world.data.expansion?.enabled,servers:this.lobbyServerData?[this.lobbyServerData.server]:[],rooms:this.lobbyServerData?.rooms??[],...this.lobbyFriendData,selectedRoom:room,selectedRoomName:'name' in (room??{})?(room as {name?:string}).name:undefined,message:this.lobbyMessage??(this.coop&&this.coopState!=='connected'?this.coopMessage:undefined)};
    this.lobbyDisposer?.();
    if(location.origin===PUBLIC_GAME_ORIGIN){
      model.routeLatencies=this.routeLatencies;
      model.preferredRoute=this.preferredRoute;
      if(this.lobbyScreen==='servers' && this.lobbyNetwork==='online' && performance.now()>=this.nextRouteProbe){
        this.nextRouteProbe=performance.now()+14_000;
        for(const route of PUBLIC_ROUTES)void measureRoomRoute(route.host).then(ms=>{
          if(this.disposed)return;
          this.routeLatencies[route.id]=ms;
          updateRouteReadings(this.root,this.routeLatencies,this.preferredRoute);
        });
      }
    }
    const operation=(fn:()=>Promise<unknown>,success:string)=>{void fn().then(()=>{this.socialMessage(success);return this.refreshSocialLobby();}).catch(error=>this.socialMessage(error instanceof Error?error.message:'操作失败'));};
    this.lobbyDisposer=renderLobbyView(this.$('#escape-panel'),model,{
      selectRoute:id=>{if(this.coop || this.coopRequesting)return;this.preferredRoute=id;this.lobbyMessage=undefined;this.renderSocialLobby();},
      network:mode=>{if(this.coop || this.coopRequesting)return;this.lobbyNetwork=mode;this.lobbyMessage=undefined;this.renderSocialLobby();},
      screen:screen=>{this.lobbyMessage=undefined;if(['home','servers','room','friends','profile'].includes(screen)){this.lobbyScreen=screen==='room'&&!this.coop?'servers':screen;this.lobbyScreenStack=[];this.renderSocialLobby();}else this.openLobbyScreen(screen);void this.refreshSocialLobby();},
      single:()=>{const open=()=>this.openLobbyScreen('solo');if(this.coop)void this.leaveCoop().then(open);else open();},controls:()=>this.openLobbyScreen('controls'),settings:()=>this.openLobbyScreen('settings'),
      back:()=>this.backLobbyScreen(),continueGame:()=>void this.start(true),newGame:()=>void this.start(false),exportSave:()=>this.exportSave(),importSave:()=>this.$<HTMLInputElement>('#escape-import').click(),
      music:enabled=>{this.music=enabled;this.saveSound();},sound:enabled=>{this.sound=enabled;this.saveSound();},
      difficulty: value => {
        this.soloDifficulty = hunterDifficulty(value);
        try { localStorage.setItem(HUNTER_DIFFICULTY, String(this.soloDifficulty)); } catch { /* This session can still use the selected difficulty. */ }
      },
      exit:()=>{if(this.coop)void this.leaveCoop().then(()=>this.exit());else this.exit();},
      create:input=>{void this.openSocialRoom('create',input);},join:(code,password)=>{void this.openSocialRoom('join',{code,password});},
      leave:()=>{void this.leaveCoop();},start:()=>{void this.coop?.startRoom().then(()=>this.startCoopGame()).catch(error=>this.socialMessage(error.message));},
      avatar:avatar=>operation(()=>this.social.update({avatar}),'形象已更换'),rename:name=>operation(()=>this.social.update({name}),'昵称已保存'),
      addFriend:uid=>operation(()=>this.social.requestFriend(uid),'好友申请已发送'),acceptFriend:uid=>operation(()=>this.social.acceptFriend(uid),'已添加好友'),removeFriend:uid=>operation(()=>this.social.removeFriend(uid),'已移除好友'),
      inviteFriend:uid=>operation(()=>this.coop?this.social.invite(uid,this.coop.session.code):Promise.reject(new Error('先加入一个房间')),'邀请已发送'),acceptInvite:code=>{if(!this.coop)this.lobbyNetwork='online';void this.openSocialRoom('join',{code});},
    });
  }
  private async openSocialRoom(kind:'create'|'join',input:{name?:string;visibility?:'public'|'private';password?:string;code?:string}){
    if(this.coopRequesting)return;
    if(this.coop){this.socialMessage('先离开当前房间');return;}
    this.coopRequesting=true;
    try{const profile=await this.social.ensure();if(this.disposed||!this.lobbyVisible)return;const common={version:APP_VERSION,name:profile.name,avatar:profile.avatar as 0|1|2|3,profileToken:profile.token,password:input.password};
      const client=this.lobbyNetwork==='lan' ? await (await import('./lan-client.mjs')).openLanRoom(kind,profile,input) : kind==='create'?await CoopClient.create({...common,title:input.name,visibility:input.visibility}):await CoopClient.join({...common,code:input.code??''});
      if(this.lobbyNetwork==='online')client.preferredRoute=this.preferredRoute;
      if(this.disposed||!this.lobbyVisible){await client.leave();return;}this.attachCoop(client);this.showSocialLobby('room');void this.prepareCoopRoom(client);
    }catch(error){this.socialMessage(error instanceof Error?error.message:'无法进入房间');}finally{this.coopRequesting=false;}
  }
  private settingsMenu() {
    this.panel(`<p class="escape-eyebrow">设置</p><h2>声音</h2><div class="escape-setting-row"><label><input id="escape-menu-music" type="checkbox" ${this.music ? "checked" : ""}>音乐</label><label><input id="escape-menu-sound" type="checkbox" ${this.sound ? "checked" : ""}>音效</label></div><button id="escape-settings-back" class="escape-primary">返回</button>`);
    this.$<HTMLInputElement>("#escape-menu-music").onchange = e => { this.music = (e.target as HTMLInputElement).checked; this.saveSound(); };
    this.$<HTMLInputElement>("#escape-menu-sound").onchange = e => { this.sound = (e.target as HTMLInputElement).checked; this.saveSound(); };
    this.button("escape-settings-back", () => this.started ? this.pause() : this.intro());
  }
  private attachCoop(client: CoopClient) {
    this.detachCoop(); this.coopMode = true; this.$(".escape-shell").classList.add("coop-active"); this.coop = client; this.coopState = "connecting"; this.coopMessage = "正在连接房间"; this.coopLobbySignature = ""; this.coopFinal = false; this.coopWasCaught = false; this.coopAwaitingRespawn = false; this.coopPoses.clear(); this.coopSyncFaulted = false; this.coopRecovering = false; this.coopAssetsReady = !!this.renderer?.usable; this.coopMovement.reset();
    this.coopUnsubscribers.push(client.onSnapshot(snapshot => {
      const previousView = this.coopSnapshot?.viewPlayerId;
      this.coopSnapshot = snapshot;
      if (this.started && this.coopMode) {
        if (this.coopSyncFaulted && !this.coopRecovering) { this.renderCoopTeam(); this.renderCoopStatus(); return; }
        const wasFaulted = this.coopSyncFaulted;
        try {
          const angle = this.world.data.player.angle, pitch = this.world.data.player.pitch, previousHidden=this.world.data.hidden;
          this.world = EscapeWorld.restore(snapshot.world, { playerId: snapshot.viewPlayerId, targetId: snapshot.targetPlayerId }); this.world.pending = snapshot.search ? { ...snapshot.search } : undefined;
          if (previousView === snapshot.viewPlayerId && previousHidden === this.world.data.hidden) { this.world.data.player.angle = angle; this.world.data.player.pitch = pitch; }
          else this.coopMovement.reset();
          this.coopMovement.accept(this.world,performance.now(),this.coopLatency??100,snapshot.viewPlayerId);
          const receivedAt = performance.now(), hunter = this.world.data.hunter;
          this.coopPoses.observeClock(snapshot.serverTime, receivedAt);
          this.coopPoses.push("hunter", snapshot.serverTime, { x: hunter.x, z: hunter.z, angle: hunter.angle });
          for (const peer of snapshot.room.players) if (peer.position) this.coopPoses.push(peer.id, snapshot.serverTime, { x: peer.position.x, z: peer.position.z, angle: peer.position.angle });
          this.coopPoses.retain(["hunter", ...snapshot.room.players.map(peer => peer.id)]);
          this.phase = this.world.data.phase; this.coopSyncFaulted = false; this.coopRecovering = false;
        }
        catch (error) {
          this.coopSyncFaulted = true; this.coopRecovering = false; this.coopMessage = "房间状态无法同步"; this.paused = true; this.clearInput(); this.audio.setPlaying(false); console.error("Co-op room snapshot could not be restored", error);
          this.panel(`<p class="escape-eyebrow">逃生小队</p><h2>房间状态无法同步</h2><p>请重新连接，或退出房间。</p><button id="escape-coop-sync-reconnect" class="escape-primary">重新连接</button><button id="escape-coop-sync-leave" class="escape-secondary">退出房间</button>`);
          this.button("escape-coop-sync-reconnect", () => { this.coopRecovering = true; this.coop?.reconnect(); }); this.button("escape-coop-sync-leave", () => void this.leaveCoop());
          return;
        }
        if (wasFaulted && this.$("#escape-coop-sync-reconnect")?.isConnected) this.resume();
        const self = snapshot.room.players.find(player => player.id === client.session.playerId);
        if ((self?.status === "caught" || self?.status === "eliminated") && !this.coopWasCaught) this.showCoopCapture();
        if (self && self.status !== "caught" && self.status !== "eliminated") this.coopWasCaught = false;
        // Resume exactly once after a respawn. Re-resuming on every snapshot would clear held keys 8×/s and freeze the player.
        if (self?.status === "connected" && this.coopAwaitingRespawn && !this.coopFinal) { this.coopAwaitingRespawn = false; this.$(".escape-shell").classList.remove("capture-active"); this.resume(); }
        if (["won", "lost"].includes(snapshot.room.phase)) this.coopResult(snapshot.room.phase);
        this.updateHud(); this.renderCoopTeam();
      } else if (this.coopMode && snapshot.room.phase === "playing") void this.startCoopGame();
      else if (this.coopMode) this.renderCoopLobby();
    }));
    this.coopUnsubscribers.push(client.onState((state, message, latency) => {
      if (state === "reconnecting" && this.coopState !== "reconnecting") this.coopPoses.clear();
      this.coopState = state; this.coopMessage = message; if (latency !== undefined) this.coopLatency = latency; this.renderCoopStatus();
      if(this.coopMode&&this.lobbyVisible)this.renderCoopLobby();
      if(this.started&&state==='connected'&&message!=='已连接')this.world.say(message);
      if (state === "closed" && this.coopMode && !this.coopFinal) { this.paused = true; this.clearInput(); this.cinematic?.close(); this.showSocialLobby('closed'); }
    }));
    client.start(); client.startInputs();
  }
  private async prepareCoopRoom(client: CoopClient) {
    try {
      if (!this.renderer?.usable) await prepareEscape(this.settings, stage => { if (client === this.coop) this.coopMessage = stage; });
      if (client !== this.coop) return;
      this.coopAssetsReady = true;
      await client.ready(true); this.coopMessage = "已就绪，等待队友"; this.renderCoopLobby();
    } catch (error) { this.coopMessage = error instanceof Error ? error.message : "场景载入失败"; this.renderCoopLobby(); }
  }
  private detachCoop() {
    this.coopUnsubscribers.splice(0).forEach(unsubscribe => unsubscribe());
    this.coop?.stop(); this.coop = undefined; this.coopSnapshot = undefined; this.coopMode = false; this.$(".escape-shell").classList.remove("coop-active"); this.coopLobbySignature = "";
    this.renderer?.clearPeers();
  }
  private renderCoopLobby() {
    const room=this.coopSnapshot?.room;
    const signature=JSON.stringify([room?.code,room?.phase,room?.players.map(p=>[p.id,p.status,p.ready,p.lives,p.avatar,p.name]),this.coopMessage]);
    if(signature===this.coopLobbySignature&&this.lobbyVisible)return;
    this.coopLobbySignature=signature;
    if(!this.lobbyVisible)this.showSocialLobby('room');else this.renderSocialLobby();
    void this.refreshSocialLobby();
  }
  private async leaveCoop() { await this.coop?.leave().catch(() => {}); this.started = false; this.paused = true; this.world = new EscapeWorld(); this.detachCoop(); this.$("#escape-coop-team").hidden = true; this.$("#escape-coop-status").hidden = true; this.intro(); }
  private async startCoopGame() {
    if (!this.coop || this.coopStarting || this.started) return;
    this.coopStarting = true;
    this.paused = true; this.started = false; this.audio.setMode("escape"); this.applySound();
    this.panel('<p class="escape-eyebrow">多人逃生</p><h2>正在进入浴场…</h2>');
    try {
      if (!this.renderer?.usable) { if (!this.coopAssetsReady) { await prepareEscape(this.settings, () => {}); this.coopAssetsReady = true; } const bundle = takePreparedEscape(); if (!bundle) throw new Error("场景尚未准备完成"); const previous = this.$<HTMLCanvasElement>("#escape-view"); for (const attribute of previous.attributes) bundle.canvas.setAttribute(attribute.name, attribute.value); bundle.canvas.removeAttribute("style"); previous.replaceWith(bundle.canvas); this.renderer = bundle.renderer; this.art = bundle.art; this.bindView(bundle.canvas); }
      if (this.coopSnapshot) this.world = EscapeWorld.restore(this.coopSnapshot.world, { playerId: this.coopSnapshot.viewPlayerId, targetId: this.coopSnapshot.targetPlayerId });
      this.started = true; this.phase = this.world.data.phase; this.renderer?.resize(this.settings.quality === "high"); this.renderCoopTeam(); this.resume();
    } catch (error) { this.coopMessage = error instanceof Error ? error.message : "场景载入失败"; this.coopLobbySignature = ""; this.renderCoopLobby(); }
    finally { this.coopStarting = false; }
  }
  private coopResult(phase: string) {
    if (this.coopFinal || !this.coopMode) return;
    this.coopFinal = true; this.coop?.stop(); this.paused = true; this.clearInput(); this.audio.setPlaying(false); this.panel(`<p class="escape-eyebrow">逃生小队</p><h2>${phase === "won" ? "全队逃出生天" : "小队被困在浴场"}</h2><p>此次逃生已结束。</p><button id="escape-coop-result-exit" class="escape-primary">返回首页</button>`); this.button("escape-coop-result-exit", () => void this.leaveCoop());
  }
  private showCoopCapture() {
    this.coopWasCaught = true; this.paused = true; this.clearInput(); this.audio.setPlaying(false);
    this.$(".escape-shell").classList.add("capture-active");
    void this.playCinematic(randomCaughtClip()).then(() => {
      if (this.disposed || !this.coopMode || this.coopFinal) return;
      this.$(".escape-shell").classList.remove("capture-active");
      const player = this.coopSnapshot?.room.players.find(item => item.id === this.coop?.session.playerId);
      const eliminated = player?.status === "eliminated";
      this.panel(`<p class="escape-eyebrow">逃生小队</p><h2>${eliminated ? "继续旁观队友" : "队友还在浴场里"}</h2><p>${eliminated ? "你的机会已经用完。" : "可以请求在安全处重生。"}</p><button id="escape-coop-respawn" class="escape-primary">${eliminated ? "旁观队友" : "请求重生"}</button><button id="escape-coop-caught-leave" class="escape-secondary">退出房间</button>`);
      this.button("escape-coop-caught-leave", () => void this.leaveCoop());
      this.button("escape-coop-respawn", () => {
        if (eliminated) { this.$(".escape-shell").classList.remove("capture-active"); this.resume(); return; }
        const button = this.$<HTMLButtonElement>("#escape-coop-respawn"); button.disabled = true; button.textContent = "正在等待重生…";
        this.coopAwaitingRespawn = true;
        void this.coop?.respawn().then(() => { this.coopMessage = "已收到重生请求"; }).catch(error => { this.coopAwaitingRespawn = false; this.coopMessage = error instanceof Error ? error.message : "暂时无法重生"; button.disabled = false; button.textContent = "请求重生"; });
      });
    });
  }
  private renderCoopTeam() {
    const team = this.$<HTMLElement>("#escape-coop-team"); const players = this.coopSnapshot?.room.players ?? [];
    team.hidden = !this.coopMode || !this.started;
    const signature=JSON.stringify([this.coop?.session.playerId,this.coopSnapshot?.viewPlayerId,players.map(({id,slot,name,avatar,status,lives})=>({id,slot,name,avatar,status,lives}))]);
    if(signature===this.coopTeamSignature)return;this.coopTeamSignature=signature;
    const label = (status: string) => status === "escaped" ? "已逃出" : status === "eliminated" ? "已淘汰" : status === "left" ? "已退出" : status === "caught" ? "被抓" : status === "reconnecting" ? "重连中" : "逃生中";
    this.root.querySelector("#escape-coop-status")?.remove();
    team.innerHTML = `${[1, 2, 3].map(slot => { const player = players.find(item => item.slot === slot); return player ? `<div class="escape-coop-teammate ${player.status} ${player.id === this.coop?.session.playerId ? "self" : ""} ${player.id === this.coopSnapshot?.viewPlayerId ? "following" : ""}"><span class="escape-avatar-art" data-avatar="${player.avatar}"></span><span class="escape-coop-player-name">${slot} · ${safe(player.name)}</span><small ${player.id === this.coop?.session.playerId ? 'id="escape-coop-status" class="escape-coop-status"' : ""}>${player.status === "connected" ? "♥".repeat(Math.max(0, player.lives)) : label(player.status)}</small></div>` : `<div class="escape-coop-teammate empty"><span class="escape-avatar-art" data-avatar="0"></span><span class="escape-coop-player-name">${slot} · 空位</span><small>等待队友</small></div>`; }).join("")}`;
    this.renderCoopStatus();
  }
  private renderCoopStatus() {
    const status = this.root.querySelector<HTMLElement>("#escape-coop-status"); if (!status) return;
    status.hidden = !this.coopMode || !this.started;
    status.dataset.state = this.coopState === "connected" && (this.coopLatency ?? 0) > HIGH_LATENCY_MS ? "unstable" : this.coopState;
    const latency = this.coopLatency;
    status.title = latency === undefined ? "" : `延迟 ${latency} ms`;
    const lives = this.coopSnapshot?.room.players.find(player => player.id === this.coop?.session.playerId)?.lives ?? 0;
    // Latency only matters when it is bad; a healthy connection shows just the remaining lives.
    status.textContent = `${"♥".repeat(Math.max(0, lives))}${this.coopState !== "connected" ? " · 重连中" : (latency ?? 0) > HIGH_LATENCY_MS ? ` · ${latency} ms` : ""}`;
  }
  private adoptPrepared() {
    const bundle = takePreparedEscape();
    if (!bundle) return;
    const placeholder = this.$<HTMLCanvasElement>("#escape-view");
    for (const attribute of placeholder.attributes) bundle.canvas.setAttribute(attribute.name, attribute.value);
    bundle.canvas.removeAttribute("style");
    placeholder.replaceWith(bundle.canvas);
    this.renderer = bundle.renderer; this.art = bundle.art;
    this.renderer.setReducedMotion(this.settings.reducedMotion);
  }
  private async start(resume: boolean) {
    this.thinkingUntil = 0;
    const preparation = ++this.preparationSequence;
    this.save(); this.started = false; this.paused = true;
    this.audio.setMode("escape"); this.applySound(); void this.audio.unlock();
    if (!document.fullscreenElement && document.documentElement.requestFullscreen) void document.documentElement.requestFullscreen({ navigationUI: "hide" }).catch(() => {});
    this.panel(`<p class="escape-eyebrow">${ESCAPE_TITLE}</p><h2>正在进入浴场…</h2><p id="escape-preparing" role="status"></p><button id="escape-prepare-back" class="escape-primary">返回菜单</button>`);
    this.button("escape-prepare-back", () => { this.preparationSequence++; this.cinematic?.close(); this.intro(); });
    const opening = resume ? undefined : this.playCinematic(randomOpeningClip());
    try {
      if (!this.renderer?.usable) {
        this.renderer?.dispose(); this.renderer = undefined;
        await prepareEscape(this.settings, stage => { const label = this.root.querySelector("#escape-preparing"); if (label && preparation === this.preparationSequence) label.textContent = stage; });
        if (this.disposed || preparation !== this.preparationSequence) return;
        // Only the canvas changes here; global game listeners remain bound once.
        const bundle = takePreparedEscape();
        if (!bundle) throw new Error("场景尚未准备完成");
        const previous = this.$<HTMLCanvasElement>("#escape-view");
        for (const attribute of previous.attributes) bundle.canvas.setAttribute(attribute.name, attribute.value);
        bundle.canvas.removeAttribute("style");
        previous.replaceWith(bundle.canvas);
        this.renderer = bundle.renderer; this.art = bundle.art;
        this.bindView(bundle.canvas);
      }
      if (this.disposed || preparation !== this.preparationSequence) return;
      this.world = resume && this.saved ? EscapeWorld.restore(this.saved) : new EscapeWorld();
      this.world.setHunterDifficulty(this.soloDifficulty);
      this.beginRoomCue();
      this.renderer.setReducedMotion(this.settings.reducedMotion);
      if (this.disposed || preparation !== this.preparationSequence) return;
      this.renderer.resize(this.settings.quality === "high"); this.started = true; this.phase = this.world.data.phase;
      this.saveAt = this.world.data.elapsed; this.save();
      await opening;
      if (this.disposed || preparation !== this.preparationSequence) return;
      if (this.world.data.phase === "caught") this.result(); else this.resume();
    } catch {
      if (this.disposed || preparation !== this.preparationSequence) return;
      this.cinematic?.close();
      this.renderer?.dispose(); this.renderer = undefined;
      this.panel('<h2>场景载入失败</h2><p>请检查网络，或换用支持 WebGL 的浏览器。进度已保留。</p><button id="escape-load-back" class="escape-primary">返回菜单</button>');
      this.button("escape-load-back", () => this.intro());
    }
  }
  private async playCinematic(path: string) {
    this.paused = true; this.clearInput(); this.audio.setPlaying(false); this.audio.stopPreview();
    this.look?.suspend();
    this.$("#escape-room-toast").hidden = true;
    const shell = this.$(".escape-shell"); shell.inert = true;
    const player = new CinematicPlayer(this.root, path, this.sound); this.cinematic = player;
    await player.done;
    if (this.cinematic === player) this.cinematic = undefined;
    shell.inert = false;
    if (!this.disposed) this.$("#escape-panel").querySelector<HTMLButtonElement>("button")?.focus({ preventScroll: true });
  }
  private applySound() { this.audio.setSettings({ ...this.settings, music: this.music, sound: this.sound }); }
  private saveSound() { try { localStorage.setItem(SOUND, JSON.stringify({ music: this.music, sound: this.sound })); } catch { /* Audio still works without storage. */ } this.applySound(); }
  private resume() {
    if (this.coopMode && this.coopFinal) return;
    this.$(".escape-shell").classList.remove("capture-active");
    this.$("#escape-view").setAttribute("aria-label", "3D第一人称逃生。WASD移动，Shift切换奔跑，C切换蹲行；点击画面后移动鼠标转头，手机滑动转头。E交互，Esc暂停并释放鼠标。");
    this.$("#escape-panel").hidden = true; this.$(".escape-shell").classList.remove("menu-active"); this.updateHud(); this.paused = false; this.lastFrame = 0; this.clearInput();
    this.$("#escape-view").focus({ preventScroll: true }); this.audio.setPlaying(true); void this.audio.unlock();
    this.look?.capture();
  }
  private clearInput() { this.keys.clear(); this.stick = { x: 0, y: 0 }; this.look?.clear(); this.$("#escape-stick span").style.transform = "translate(0,0)"; if (this.coopMode) { this.coop?.clearActions(); this.coop?.sendInput({ move: { forward: 0, strafe: 0, turn: 0, look: 0, sprint: false } }); } }
  private coopActionInput(action: NonNullable<CoopInput["action"]>) {
    const self = this.coopSnapshot?.room.players.find(player => player.id === this.coop?.session.playerId);
    if (this.coopMode && !this.coopFinal && this.coopSnapshot?.room.phase === "playing" && self?.status === "connected") {
      const down=(key:string)=>this.keys.has(key)?1:0;
      this.coop?.sendInput({move:{forward:down('w')+down('arrowup')-down('s')-down('arrowdown')-this.stick.y,strafe:down('d')-down('a')+this.stick.x,turn:0,look:0,sprint:this.world.data.player.sprinting??false},aim:{angle:this.world.data.player.angle,pitch:this.world.data.player.pitch??0},action,...(action==='interact'?{targetId:this.world.nearest()?.id}:{})});
    }
  }
  private pause(map = false) {
    if (map) { this.showMap(); return; }
    if (!this.started || this.world.data.phase !== "playing") return;
    if (document.pointerLockElement === this.root.querySelector("#escape-view")) this.unlockAt = performance.now();
    this.paused = true; this.clearInput(); this.audio.setPlaying(false); this.save();
    this.panel(`<div class="escape-pause-menu"><h2>暂停</h2>${this.coopMode ? '<p class="escape-coop-note">房间里的时间不会停。</p>' : ""}<p class="escape-goal-line" id="escape-goal">${safe(this.world.nextGoal)}</p>
      <nav class="escape-menu-list"><button id="escape-resume" class="escape-primary">继续</button><button id="escape-journal">纸条</button><button id="escape-pause-settings">设置</button><button id="escape-help">操作说明</button>${this.coopMode ? "" : '<button id="escape-backup">备份存档</button><button id="escape-restart">重新开始</button>'}<button id="escape-exit">${this.coopMode ? "退出房间" : "保存并退出"}</button><button id="escape-audio-recover" class="escape-menu-minor">没有声音？</button></nav>
      <p class="escape-storage" id="escape-save-status">${this.coopMode ? "" : this.storageWarning || ""}</p></div>`);
    this.$("#escape-panel").classList.add("escape-pause-panel");
    this.button("escape-journal", () => this.showJournal());
    this.button("escape-resume", () => this.resume()); this.button("escape-help", () => this.help(true)); if (!this.coopMode) this.button("escape-restart", () => this.confirmRestart());
    this.button("escape-exit", () => { if (this.coopMode) void this.leaveCoop(); else { this.save(); this.exit(); } }); if (!this.coopMode) this.button("escape-backup", () => this.exportSave());
    this.button("escape-pause-settings", () => this.settingsMenu());
    this.button("escape-audio-recover", () => { void this.audio.recover().then(ok => { const el = this.root.querySelector("#escape-save-status"); if (el) el.textContent = ok ? "音效试听中" : "声音未开启，请重试。"; }); });
  }
  private showMap() {
    if (!this.started || this.world.data.phase !== "playing") return;
    this.paused = true; this.clearInput(); this.audio.setPlaying(false); this.save();
    this.panel(`<section class="escape-map-page"><h2>浴场地图</h2>${this.coopMode ? '<p class="escape-coop-note">房间仍在进行</p>' : ""}<div class="escape-floor-tabs" aria-label="地图楼层"><button id="escape-map-ground" aria-pressed="false">地面</button><button id="escape-map-basement" aria-pressed="false">负一楼</button></div><canvas id="escape-floorplan" width="560" height="560" aria-label="探索地图，箭头是你，暗处尚未探索"></canvas><p class="escape-map-legend"><i class="map-you"></i>你 <i class="map-door"></i>门 <i class="map-hide"></i>衣柜 <i class="map-fog"></i>未探索</p><p id="escape-map-current">当前位置：${safe(this.world.room)}</p><button id="escape-map-close" class="escape-secondary">返回游戏 <kbd>M</kbd></button></section>`);
    this.$("#escape-panel").classList.add("escape-map-panel");
    const draw = (floor: 0 | -1) => {
      this.$("#escape-map-ground").setAttribute("aria-pressed", String(floor === 0));
      this.$("#escape-map-basement").setAttribute("aria-pressed", String(floor === -1));
      // Render at the size it is shown (and screen density) so the big map stays crisp.
      const canvas = this.$<HTMLCanvasElement>("#escape-floorplan");
      const size = Math.round(canvas.getBoundingClientRect().width * Math.min(devicePixelRatio || 1, 2));
      if (size > 0 && canvas.width !== size) canvas.width = canvas.height = size;
      this.renderer?.drawMap(canvas, this.world, false, floor);
    };
    this.button("escape-map-ground", () => draw(0)); this.button("escape-map-basement", () => draw(-1));
    this.button("escape-map-close", () => this.resume()); draw(floorAt(this.world.data.player));
  }
  private showJournal() { this.showBag("notes"); }
  /** Backpack (B): items, crystals and notes with descriptions; crystals can be used from here. */
  private showBag(tab: BagTab = this.bagTab, selected = this.bagSelected) {
    if (!this.started || this.world.data.phase !== "playing") return;
    this.bagTab = tab; this.bagSelected = selected;
    this.paused = true; this.clearInput(); this.audio.setPlaying(false);
    this.panel(bagMarkup(this.world, tab, selected, this.coopMode));
    const panel = this.$("#escape-panel");
    panel.classList.add("escape-bag-panel");
    panel.querySelectorAll<HTMLElement>("[data-bag-tab]").forEach(button => button.onclick = () => this.showBag(button.dataset.bagTab as BagTab, undefined));
    panel.querySelectorAll<HTMLElement>("[data-bag-item]").forEach(button => button.onclick = () => this.showBag(tab, button.dataset.bagItem));
    panel.querySelector<HTMLElement>("[data-bag-use]")?.addEventListener("click", event => {
      const kind = (event.currentTarget as HTMLElement).dataset.bagUse as "freeze" | "reveal" | "ward";
      this.resume();
      if (this.coopMode) this.coopActionInput(kind); else this.world.useCrystal(kind);
    }, { signal: this.signal });
    this.button("escape-bag-close", () => this.resume());
    panel.querySelector<HTMLElement>(selected ? `[data-bag-item="${CSS.escape(selected)}"]` : ".bag-tab.is-active")?.focus({ preventScroll: true });
  }
  private openNote(id: string, fromJournal = false) {
    const note = PROPS.find(p => p.id === id && p.kind === "note");
    if (!note || !this.started || this.world.data.phase !== "playing") return;
    this.noteActive = true; this.noteReturnToJournal = fromJournal;
    this.paused = true; this.clearInput(); this.look?.suspend(); this.audio.setPlaying(false); this.save();
    this.$("#escape-panel").hidden = true; this.$(".escape-shell").classList.add("menu-active");
    const paper = this.root.querySelector(".escape-note-paper");
    paper?.querySelector(".escape-coop-note")?.remove();
    if (this.coopMode && paper) { const status = document.createElement("p"); status.className = "escape-coop-note"; status.textContent = "房间仍在进行"; paper.insertBefore(status, paper.querySelector(".escape-note-content")); }
    this.abilityHud.update({ ...this.world.data.abilities, floor: floorAt(this.world.data.player) }, false, this.settings.reducedMotion);
    this.noteDialog.show(note.name, note.text ?? "");
  }
  private help(fromPause: boolean) {
    const touch = matchMedia("(pointer:coarse)").matches;
    const expanded = !!this.world.data.expansion?.enabled;
    const controls = touch ? [["移动", "左侧摇杆"], ["观察", "滑动右侧画面"], ["互动", "靠近目标后点击手掌"], ["奔跑", "点击切换奔跑"], ["蹲行", "点击切换蹲行"], ["冻结 / 显形 / 净化", "屏幕晶体按钮"]] : [["移动", "WASD / 方向键"], ["观察", "点击画面后移动鼠标"], ["抬头 / 低头", "PageUp / PageDown"], ["互动", "E / 空格"], ["奔跑", "Shift 切换"], ["蹲行", "C 切换"], ["手电", "F"], ["石子 / 地图 / 背包", "Q / M / B"], ["警戒详情", "Tab 展开 / 收起"], ["冻结 / 显形 / 净化", "1 / 2 / 3"], ["暂停 / 释放鼠标", "Esc"]];
    const tips = ["被发现时拉开距离，躲进衣柜并保持安静。", "被干扰时仪表不可信，绿晶能驱散杂讯。", "找到钥匙和工具，打开下水道铁网。", "冻住奶蛙能争取调整位置的机会；显形晶可查看奶蛙方向。", ...(expanded ? ["旧更衣室里有缺失的手轮；锅炉房维修纸条记着泄压顺序。", "走廊碎玻璃可以绕开或蹲行通过。"] : []), "连续移动会积累疲劳，停下休息可恢复。", "照中奶蛙会增加警觉，移开光束后警觉会下降。", "被抓后进入下一夜，物品保留。第三次被抓则失败。"];
    this.panel(`<h2>操作</h2><dl class="escape-bindings">${controls.map(([label, value]) => `<div><dt>${label}</dt><dd>${value}</dd></div>`).join("")}</dl><ul class="escape-help">${tips.map(tip => `<li>${tip}</li>`).join("")}</ul><details class="escape-perception-help"><summary>暴露值与追击规则</summary><p>声音、灯光、视觉分别累积 0–100。总分由三路共同计算：</p><p class="escape-formula">100 × [1 − (1 − 声音/100)(1 − 灯光/100)(1 − 视觉/100)]</p><p>例：声音50、灯光50为75；三路各50为87.5；声音和灯光各99会封顶100；任一路100也为100。原始分达到99.5即封顶并进入追击。</p><p>总分达到45会警觉，感知速度变为×1.5。蹲行、步行、跑步的基础听距为5、13、24米，喘息22米；墙门缩短听距，离得越近涨分越快。贡献按线索重叠程度公平分摊，相加等于总分；显示值四舍五入。追击时总分锁定100，贡献按比例显示，甩开视线和声光线索后转为搜查。</p></details><button id="escape-help-settings" class="escape-secondary">设置</button><button id="escape-help-close" class="escape-primary">返回</button>`);
    this.button("escape-help-close", () => fromPause ? this.pause() : this.intro());
    this.button("escape-help-settings", () => this.settingsMenu());
  }
  private confirmRestart() {
    this.paused = true; this.audio.setPlaying(false);
    this.panel('<h2>重新进入浴场？</h2><p>重置当前逃生进度，保留最佳纪录。</p><button id="escape-confirm-restart" class="escape-primary">重新开始</button><button id="escape-cancel-restart" class="escape-secondary">继续游戏</button>');
    this.button("escape-confirm-restart", () => void this.start(false)); this.button("escape-cancel-restart", () => this.started ? this.pause() : this.intro());
  }
  private result(playCapture = false) {
    this.paused = true; this.clearInput(); this.audio.setPlaying(false); this.save();
    this.$(".escape-shell").classList.remove("freeze-active");
    if (playCapture) {
      void this.playCinematic(randomCaughtClip()).then(() => { if (!this.disposed) this.result(); });
      return;
    }
    const d = this.world.data;
    if (d.phase === "won") {
      const noteTotal = d.expansion?.enabled ? PROPS.filter(prop => prop.kind === "note").length : 3;
      this.panel(`<p class="escape-eyebrow">${ESCAPE_TITLE}</p><h1>逃生成功</h1><div class="escape-result-stats"><span>用时<strong>${time(d.elapsed)}</strong></span><span>被抓<strong>${d.captures} / 3</strong></span><span>纸条<strong>${d.notes.length} / ${noteTotal}</strong></span></div><p class="escape-record">最佳 ${time((this.record?.bestTimeMs ?? d.elapsed * 1000) / 1000)}</p><button id="escape-again" class="escape-primary">再玩一次</button><button id="escape-result-exit" class="escape-secondary">返回首页</button>`);
      this.button("escape-again", () => void this.start(false)); this.button("escape-result-exit", this.exit);
    } else {
      this.panel(`<p class="escape-eyebrow">${d.phase === "lost" ? "第三次被抓住" : `第 ${d.captures} 次被抓住`}</p><h2>${d.phase === "lost" ? "逃生失败" : "被抓住了"}</h2><p>${d.phase === "lost" ? `坚持了 ${time(d.elapsed)}` : "物品和已打开的锁会保留。"}</p><button id="escape-next" class="escape-primary">${d.phase === "lost" ? "重新开始" : `醒来 · 第 ${d.captures + 1} 夜`}</button><div class="escape-links"><button id="escape-replay-laugh">再听笑声</button><button id="escape-result-exit">保存并退出</button></div>`);
      this.$(".escape-shell").classList.add("capture-active");
      this.$("#escape-view").setAttribute("aria-label", "原画奶蛙正张嘴、双手捧腹大笑；游戏进度已暂停");
      this.button("escape-next", () => { if (d.phase === "lost") void this.start(false); else { this.world.nextNight(); this.phase = "playing"; this.beginRoomCue(); this.save(); this.resume(); } });
      this.button("escape-result-exit", this.exit);
      this.audio.haunt();
      // One deliberate click can replay the recognisable laugh, without changing settings.
      this.button("escape-replay-laugh", () => void this.audio.preview("sound"));
    }
  }
  private save() {
    if (!this.started || this.coopMode) return;
    try { this.saved = this.world.snapshot(); localStorage.setItem(SESSION, JSON.stringify(this.saved)); this.storageWarning = ""; }
    catch { this.storageWarning = "本机无法自动保存，请先备份存档。"; }
  }
  private recordWin() {
    const d = this.world.data, ms = Math.round(d.elapsed * 1000), previous = this.record;
    this.record = { version: 2, escapes: Math.min(1e9, (previous?.escapes ?? 0) + 1), bestTimeMs: Math.min(previous?.bestTimeMs ?? ms, ms), fewestCaptures: Math.min(previous?.fewestCaptures ?? d.captures, d.captures), mostNotes: Math.max(previous?.mostNotes ?? 0, d.notes.length) };
    try { localStorage.setItem(RECORD, JSON.stringify(this.record)); } catch { this.storageWarning = "纪录未能写入，请备份存档。"; }
  }
  private exportSave() {
    if (this.coopMode) return;
    const data = this.started ? this.world.snapshot() : this.saved;
    const blob = new Blob([JSON.stringify({ format: "nwaxz-escape", version: 2, generation: SAVE_GENERATION, session: data, record: this.record }, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob), link = document.createElement("a"); link.href = url; link.download = "nwaxz-escape-save.json"; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  private bind() {
    this.button("escape-pause", () => this.pause()); this.button("escape-map", () => this.pause(true));
    this.button("escape-hud-toggle", () => { if (!this.paused) this.toggleHudDetails(); });
    this.button("escape-hud-help", () => { if (!this.paused) this.pause(); this.help(true); });
    this.button("escape-interact", () => { if (!this.paused) this.coopMode ? this.coopActionInput("interact") : this.world.interact(); });
    this.button("escape-light", () => { if (!this.paused) this.coopMode ? this.coopActionInput("light") : this.world.toggleLight(); });
    this.button("escape-crouch", () => { if (!this.paused) this.coopMode ? this.coopActionInput("crouch") : this.world.toggleCrouch(); });
    this.button("escape-stone", () => { if (!this.paused) this.coopMode ? this.coopActionInput("stone") : this.world.throwStone(); });
    this.button("escape-bag", () => { if (!this.paused) this.showBag(); });
    this.button("escape-freeze", () => { if (!this.paused) this.coopMode ? this.coopActionInput("freeze") : this.world.useCrystal("freeze"); });
    this.button("escape-reveal", () => { if (!this.paused) this.coopMode ? this.coopActionInput("reveal") : this.world.useCrystal("reveal"); });
    this.button("escape-ward", () => { if (!this.paused) this.coopMode ? this.coopActionInput("ward") : this.world.useCrystal("ward"); });
    const stick = this.$("#escape-stick");
    const moveStick = (e: PointerEvent) => { const r = stick.getBoundingClientRect(), dx = (e.clientX - r.x - r.width / 2) / 42, dy = (e.clientY - r.y - r.height / 2) / 42, norm = Math.max(1, Math.hypot(dx, dy)); this.stick = { x: dx / norm, y: dy / norm }; stick.querySelector<HTMLElement>("span")!.style.transform = `translate(${this.stick.x * 38}px,${this.stick.y * 38}px)`; };
    let stickId: number | undefined;
    stick.addEventListener("pointerdown", e => { if (this.paused) return; e.preventDefault(); stickId = e.pointerId; stick.setPointerCapture(e.pointerId); moveStick(e); }, { signal: this.signal });
    stick.addEventListener("pointermove", e => { if (stickId === e.pointerId) moveStick(e); }, { signal: this.signal });
    for (const event of ["pointerup", "pointercancel", "lostpointercapture"]) stick.addEventListener(event, () => { stickId = undefined; this.stick = { x: 0, y: 0 }; stick.querySelector<HTMLElement>("span")!.style.transform = "translate(0,0)"; }, { signal: this.signal });
    this.bindView(this.$("#escape-view"));
    this.button("escape-sprint", () => { if (!this.paused) { if (this.coopMode) this.coopActionInput("sprint"); else this.world.toggleSprint(); } });
    document.addEventListener("keydown", e => {
      if (this.cinematic) return;
      if (this.noteActive) {
        e.preventDefault();
        if (!e.repeat && ["escape", "e", " "].includes(e.key.toLowerCase())) this.noteDialog.close();
        if (e.key === "Tab") this.$(".escape-note-close").focus();
        return;
      }
      if (this.$("#escape-panel").hidden === false) {
        if (e.key.toLowerCase() === "m" && !e.repeat && this.started && this.world.data.phase === "playing") {
          e.preventDefault(); if (this.$("#escape-panel").classList.contains("escape-map-panel")) this.resume(); else this.showMap(); return;
        }
        if (e.key.toLowerCase() === "b" && !e.repeat && this.$("#escape-panel").classList.contains("escape-bag-panel")) { e.preventDefault(); this.resume(); return; }
        if (e.key === "Escape" && this.started && this.world.data.phase === "playing") { e.preventDefault(); if (!e.repeat && performance.now() - this.unlockAt > 250) this.resume(); }
        if (e.key === "Tab") {
          const buttons = [...this.$("#escape-panel").querySelectorAll<HTMLElement>("button,input")], at = buttons.indexOf(document.activeElement as HTMLElement), next = (at + (e.shiftKey ? -1 : 1) + buttons.length) % buttons.length;
          e.preventDefault(); buttons[next]?.focus();
        }
        return;
      }
      const key = e.key.toLowerCase();
      if (["w", "a", "s", "d", "arrowup", "arrowdown", "arrowleft", "arrowright", "pageup", "pagedown", "shift", "e", "q", "c", "f", "m", "b", "escape", "tab", " ", "1", "2", "3"].includes(key)) e.preventDefault(); else return;
      this.keys.add(key);
      if (e.repeat) return;
      if (key === "tab") { this.toggleHudDetails(); return; }
      if (key === "b") { this.keys.delete(key); this.showBag(); return; }
      if (["escape", "m"].includes(key)) this.pause(key !== "escape");
      if (key === "e" || key === " ") this.coopMode ? this.coopActionInput("interact") : this.world.interact();
      if (key === "q") this.coopMode ? this.coopActionInput("stone") : this.world.throwStone();
      if (key === "f") this.coopMode ? this.coopActionInput("light") : this.world.toggleLight();
      if (key === "c") this.coopMode ? this.coopActionInput("crouch") : this.world.toggleCrouch();
      if (key === "shift") this.coopMode ? this.coopActionInput("sprint") : this.world.toggleSprint();
      if (key === "1") this.coopMode ? this.coopActionInput("freeze") : this.world.useCrystal("freeze");
      if (key === "2") this.coopMode ? this.coopActionInput("reveal") : this.world.useCrystal("reveal");
      if (key === "3") this.coopMode ? this.coopActionInput("ward") : this.world.useCrystal("ward");
    }, { signal: this.signal });
    document.addEventListener("keyup", e => this.keys.delete(e.key.toLowerCase()), { signal: this.signal });
    window.addEventListener("blur", () => { this.clearInput(); if (!this.cinematic && this.started && !this.paused) this.pause(); }, { signal: this.signal });
    document.addEventListener("visibilitychange", () => { if (!this.cinematic && document.hidden && !this.paused) this.pause(); }, { signal: this.signal });
    document.addEventListener("fullscreenchange", () => { this.renderer?.resize(this.settings.quality === "high"); if (!document.fullscreenElement && !this.paused) this.pause(); }, { signal: this.signal });
    window.addEventListener("resize", () => { this.renderer?.resize(this.settings.quality === "high"); if (this.renderer && this.paused) this.renderer.draw(this.world); }, { signal: this.signal });
    window.addEventListener("pagehide", () => this.save(), { signal: this.signal });
    this.$<HTMLInputElement>("#escape-import").onchange = async e => {
      const file = (e.target as HTMLInputElement).files?.[0]; if (!file) return;
      let validated = false;
      try {
        if (file.size > 64000) throw new Error("too large");
        const raw = JSON.parse(await file.text()); if (raw.format !== "nwaxz-escape" || raw.version !== 2 || raw.generation !== SAVE_GENERATION) throw new Error("旧版存档不可用于当前游戏");
        const saved = EscapeWorld.restore(raw.session).snapshot(), record = readBest(raw.record);
        const best: Best | undefined = record ? this.record ? { version: 2, escapes: Math.max(record.escapes, this.record.escapes), bestTimeMs: Math.min(record.bestTimeMs, this.record.bestTimeMs), fewestCaptures: Math.min(record.fewestCaptures, this.record.fewestCaptures), mostNotes: Math.max(record.mostNotes, this.record.mostNotes) } : record : this.record;
        validated = true;
        const entries: [string, string][] = best ? [[RECORD, JSON.stringify(best)], [SESSION, JSON.stringify(saved)]] : [[SESSION, JSON.stringify(saved)]];
        writeSaveBatch(localStorage, entries);
        this.saved = saved; this.record = best;
        this.storageWarning = "存档已导入。"; if(this.lobbyVisible){this.lobbyMessage=this.storageWarning;this.renderSocialLobby();}else{this.intro();this.socialMessage(this.storageWarning);}
      } catch (error) {
        this.storageWarning = !validated ? "存档无效，原进度已保留。" : error instanceof SaveWriteError && error.restored ? "写入失败，原存档已保留。请检查存储空间。" : "存档写入失败，请重试或从备份恢复。";
        if(this.lobbyVisible){this.lobbyMessage=this.storageWarning;this.renderSocialLobby();}else this.intro();
      }
      finally { (e.target as HTMLInputElement).value = ""; }
    };
  }
  private bindView(view: HTMLCanvasElement) {
    this.look?.dispose();
    this.look = new EscapeLook(view, {
      active: () => !this.disposed && this.started && !this.paused && !this.cinematic && this.world.data.phase === "playing",
      rotate: (x, y) => {
        if (this.world.data.hidden) return;
        const p = this.world.data.player;
        p.angle = Math.atan2(Math.sin(p.angle + x * .005), Math.cos(p.angle + x * .005));
        p.pitch = Math.max(-1.3, Math.min(1.3, (p.pitch ?? 0) - y * .004));
      },
      unlocked: () => { this.unlockAt = performance.now(); if (!this.paused) this.pause(); },
      mode: mode => { this.mouseMode = mode; if (mode === "free") this.mouseHintUntil = performance.now() + 2500; this.updateMouseHint(); },
    }, this.signal);
    view.addEventListener("webglcontextlost", e => { e.preventDefault(); if (this.started && !this.paused) this.pause(); }, { signal: this.signal });
  }
  private updateMouseHint() {
    this.$(".escape-shell").classList.toggle("mouse-locked", this.mouseMode === "locked");
    const hint = this.$("#escape-mouse-hint");
    hint.textContent = this.mouseMode === "free" ? "移动鼠标转头 · Esc 暂停" : "点击画面，移动鼠标转头";
    hint.hidden = this.paused || !!this.cinematic || !matchMedia("(pointer:fine)").matches || this.mouseMode === "locked" || this.mouseMode === "free" && performance.now() > this.mouseHintUntil;
  }
  private frame = (now: number) => {
    if (this.disposed) return;
    const dt = this.lastFrame ? Math.min(.1, (now - this.lastFrame) / 1000) : 0; this.lastFrame = now;
    if (this.started && !this.paused && !document.hidden) {
      const down = (key: string) => this.keys.has(key) ? 1 : 0;
      if (this.coopMode) {
        const self = this.coopSnapshot?.room.players.find(player => player.id === this.coop?.session.playerId);
        const canControl = this.coopState === 'connected' && this.coopSnapshot?.room.phase === "playing" && self?.status === "connected" && !this.coopFinal;
        if (canControl && !this.world.data.hidden) {
          const player = this.world.data.player;
          const angle = player.angle + (down("arrowright") - down("arrowleft")) * dt * 2;
          player.angle = Math.atan2(Math.sin(angle), Math.cos(angle));
          player.pitch = Math.max(-1.3, Math.min(1.3, (player.pitch ?? 0) + (down("pageup") - down("pagedown")) * dt * 1.5));
        }
        if (canControl && now - this.coopLastMoveAt >= 100) {
          this.coopLastMoveAt = now;
          this.coop?.sendInput({ move: { forward: down("w") + down("arrowup") - down("s") - down("arrowdown") - this.stick.y, strafe: down("d") - down("a") + this.stick.x, turn: 0, look: 0, sprint: this.world.data.player.sprinting ?? false }, aim: { angle: this.world.data.player.angle, pitch: this.world.data.player.pitch ?? 0 } });
        } else if (!canControl) { this.coop?.clearActions(); }
        const player = this.world.data.player, authX = player.x, authZ = player.z;
        const viewId = this.coopSnapshot?.viewPlayerId ?? this.coop?.session.playerId ?? "";
        const predicted=canControl?this.coopMovement.advance(this.world,dt,{forward:down('w')+down('arrowup')-down('s')-down('arrowdown')-this.stick.y,strafe:down('d')-down('a')+this.stick.x,sprint:player.sprinting??false},now,viewId):{x:authX,z:authZ};
        player.x = predicted.x; player.z = predicted.z;
        const hunter = this.world.data.hunter, hunterAt = { x: hunter.x, z: hunter.z, angle: hunter.angle };
        const smoothHunter = this.coopPoses.sample("hunter", now);
        if (smoothHunter) Object.assign(hunter, smoothHunter);
        try { this.renderer?.draw(this.world, dt); } finally { player.x = authX; player.z = authZ; Object.assign(hunter, hunterAt); }
        const peers = (this.coopSnapshot?.room.players ?? []).map(peer => {
          const pose = peer.id === viewId ? undefined : this.coopPoses.sample(peer.id, now);
          return pose && peer.position ? { ...peer, position: { ...peer.position, x: pose.x, z: pose.z, angle: pose.angle } } : peer;
        });
        this.renderer?.drawPeers(peers, viewId, dt);
        const snapshot = this.coopSnapshot;
        if (snapshot && snapshot.revision !== this.coopSeenRevision) {
          this.coopSeenRevision = snapshot.revision;
          for (const event of snapshot.events) {
            if (event.type === "message" && event.text) this.world.say(event.text);
            if (event.type === "laugh") this.audio.haunt();
            if (["step", "door", "noise"].includes(event.type)) this.audio.effect(event.type as "step" | "door" | "noise");
            if (event.type === "item") this.audio.effect("coin");
            if (event.type === "breath") this.audio.effect("breath");
            if (event.type === "note" && event.id) this.openNote(event.id);
          }
        }
        if (now - this.hudAt > 100) { this.hudAt = now; this.updateHud(); }
      } else {
      this.world.advance(dt, { forward: down("w") + down("arrowup") - down("s") - down("arrowdown") - this.stick.y, strafe: down("d") - down("a") + this.stick.x, turn: down("arrowright") - down("arrowleft"), look: down("pageup") - down("pagedown"), sprint: this.world.data.player.sprinting ?? false });
      this.renderer?.draw(this.world, dt);
      const d = this.world.data;
      for (const event of this.world.drainEvents()) {
        if (event.type === "hunter-think") this.thinkingUntil = d.elapsed + 2.5;
        if (event.type === "laugh" && d.phase === "playing") this.audio.haunt();
        if (["step", "door", "noise"].includes(event.type)) this.audio.effect(event.type as "step" | "door" | "noise");
        if (event.type === "item") this.audio.effect("coin");
        if (event.type === "breath") this.audio.effect("breath");
        if (event.type === "note" && event.id) this.openNote(event.id);
        if (["item", "door", "message"].includes(event.type)) this.save();
      }
      if (d.hunter.state === "chase" && d.elapsed - this.heartbeatAt > .72) { this.heartbeatAt = d.elapsed; this.audio.effect("heartbeat"); }
      if (d.elapsed - this.saveAt > 4) { this.saveAt = d.elapsed; this.save(); }
      if (d.phase !== this.phase) { this.phase = d.phase; if (d.phase === "won") this.recordWin(); this.result(d.phase === "caught" || d.phase === "lost"); }
      if (now - this.hudAt > 100) { this.hudAt = now; this.updateHud(); }
      }
    }
    // Capture is a cosmetic animation only. Simulation, battery and saves do
    // not advance while its clearly visible original-art belly laugh loops.
    if (this.started && this.paused && !this.cinematic && ["caught", "lost"].includes(this.world.data.phase) && !document.hidden && this.$(".escape-shell").classList.contains("capture-active")) this.renderer?.draw(this.world, dt);
    this.raf = requestAnimationFrame(this.frame);
  };
  private updateHud() {
    this.updateMouseHint();
    const d = this.world.data;
    const interfered = d.interference.stage === "corrupt";
    this.abilityHud.update({ ...d.abilities, floor: floorAt(d.player), subjectSlot: this.coopMode && this.coopSnapshot?.abilityTargetPlayerId !== this.coopSnapshot?.viewPlayerId ? this.coopSnapshot?.room.players.find(player => player.id === this.coopSnapshot?.abilityTargetPlayerId)?.slot : undefined }, this.started && !this.cinematic && d.phase === "playing" && floorAt(d.player) === -1, this.settings.reducedMotion);
    const room = this.world.room;
    if (room !== this.lastRoom) { this.lastRoom = room; this.roomCueUntil = d.elapsed + 1.6; }
    this.$("#escape-room").textContent = room;
    const objective = this.$("#escape-objective");
    if (objective.textContent !== this.world.nextGoal) objective.textContent = this.world.nextGoal;
    const mapButton = this.$("#escape-map");
    mapButton.setAttribute("aria-label", `查看地图，当前位置：${room}`);
    this.$("#escape-map-room").textContent = room;
    const roomCue = this.$("#escape-room-toast");
    if (roomCue.textContent !== room) roomCue.textContent = room;
    roomCue.classList.toggle("reduced-motion", this.settings.reducedMotion);
    roomCue.hidden = !this.started || this.paused || !!this.cinematic || d.phase !== "playing" || d.elapsed >= this.roomCueUntil;
    const pauseRoom = this.root.querySelector<HTMLElement>("#escape-map-current");
    if (pauseRoom) pauseRoom.textContent = `当前位置：${room}`;
    const items = ["brass", "cellar", "fuse", "cutters", "handwheel", "relay"] as const;
    const self = this.coopSnapshot?.room.players.find(player => player.id === this.coop?.session.playerId);
    const lifeCap = this.coopMode ? this.coopSnapshot?.team.total === 3 ? 1 : 2 : 3;
    const lives = this.coopMode ? self?.lives ?? lifeCap : 3 - d.captures;
    const inventoryKey = d.inventory.join(",") + ":" + lives + ":" + lifeCap + ":" + !!d.expansion?.enabled;
    if (inventoryKey !== this.inventoryKey) {
      this.inventoryKey = inventoryKey;
      this.$("#escape-inventory").classList.toggle("expansion-inventory", !!d.expansion?.enabled);
      this.$("#escape-inventory").innerHTML = items.map((item, i) => {
        const owned = d.inventory.includes(item), glyph = item === "cutters" ? "cutters" : item === "fuse" || item === "relay" ? "fuse" : item === "handwheel" ? "handwheel" : "key";
        return `<span class="escape-slot ${owned ? "owned" : ""}" title="${owned ? ITEM_NAMES[item] : "未找到物品"}" aria-label="${owned ? ITEM_NAMES[item] : "空物品栏"}"><small>${i+1}</small>${owned ? icon(glyph) : ""}</span>`;
      }).join("");
      this.$("#escape-lives").innerHTML = Array.from({ length: lifeCap }, (_, i) => `<span class="${i < lifeCap - lives ? "lost" : ""}">${icon("heart")}</span>`).join("");
      this.$("#escape-lives").setAttribute("aria-label", `剩余${lives}次机会`);
    }
    const notice = this.$("#escape-notice");
    if (this.world.message !== this.lastNotice) { this.lastNotice = this.world.message; this.noticeUntil = performance.now() + 5000; }
    const thinking = !this.coopMode && this.world.data.elapsed < this.thinkingUntil;
    const noticeText = thinking ? "奶娃正在思考…" : this.lastNotice;
    if (notice.textContent !== noticeText) notice.textContent = noticeText;
    notice.classList.toggle("is-thinking", thinking);
    notice.hidden = !thinking && performance.now() > this.noticeUntil;
    const danger = d.hidden ? "已藏匿" : this.world.isPlayerChased ? "被发现了" : Math.hypot(d.hunter.x - d.player.x, d.hunter.z - d.player.z) < 4 ? "脚步正在靠近" : "";
    this.$("#escape-danger").textContent = danger;
    this.$("#escape-danger").hidden = !danger;
    this.$(".escape-shell").classList.toggle("being-chased", this.world.isPlayerChased);
    this.$(".escape-shell").classList.toggle("in-cabinet", !!d.hidden);
    this.$(".escape-shell").classList.toggle("freeze-active", (d.hunt?.freeze ?? 0) > 0 && d.phase === "playing");
    const target = this.world.nearest(), interact = this.$<HTMLButtonElement>("#escape-interact");
    interact.hidden = !target || !!this.world.pending;
    interact.disabled = !target || !!this.world.pending;
    interact.querySelector("span")!.textContent = target?.label ?? "";
    this.$<HTMLMeterElement>("#escape-stamina").value = d.player.stamina;
    this.$<HTMLMeterElement>("#escape-battery").value = d.player.battery;
    this.$("#escape-stamina-value").textContent = String(Math.round(d.player.stamina));
    this.$("#escape-battery-value").textContent = String(Math.round(d.player.battery));
    const hunt = d.hunt;
    const effort = hunt?.effort ?? 0;
    const perception = displayPerception(this.world.perception, d.interference);
    const exposure = perception.total;
    this.$<HTMLMeterElement>("#escape-exposure").value = exposure;
    this.$("#escape-exposure-value").textContent = Number(exposure.toFixed(1)).toString();
    this.$("#escape-exposure-hint").textContent = this.world.hunterDecision;
    const huntState = d.hidden ? "藏匿" : hunt?.freeze ? "冻结" : d.hunter.state === "chase" ? this.world.isPlayerChased ? "追击" : "追击队友" : hunt?.alert && hunt.alert > 0 ? `警觉 · 感知×${this.world.perceptionMultiplier}` : d.hunter.state !== "patrol" ? this.world.hunterDecision : "平静";
    this.$("#escape-hunt-state").textContent = interfered ? "被干扰" : huntState;
    this.$<HTMLMeterElement>("#escape-effort").value = effort; this.$("#escape-effort-value").textContent = String(Math.round(effort));
    for (const [id, source] of [["noise", perception.contributions.noise], ["glare", perception.contributions.glare], ["sight", perception.contributions.sight]] as const) {
      this.$<HTMLMeterElement>(`#escape-${id}`).value = source.score;
      this.$(`#escape-${id}-value`).textContent = String(Math.round(source.score));
      this.$(`#escape-${id}-contribution`).textContent = `≈${Number(source.points.toFixed(1))}分 · ${Math.round(source.share)}%`;
    }
    const hearing = this.world.hearing;
    const actionNames = { walk: "步行", crouch: "蹲行", sprint: "跑步", still: "静止" } as const;
    const hearingDetail = `${actionNames[hearing.action]} · 距${hearing.distance.toFixed(1)}米\n${hunt?.freeze ? "感知暂停" : hearing.audible ? `可闻 +${hearing.rate.toFixed(1)}/秒` : "未听见"}${hearing.breathing ? " · 喘息" : ""}`;
    this.$("#escape-noise-info").textContent = hearingDetail;
    const vision = this.world.vision;
    this.$("#escape-sight-info").textContent = d.abilities.notice?.kind === "exposed" ? "技能感测 · 位置暴露" : `${vision.visible ? `被看到 · ${vision.distance.toFixed(1)}米` : "未被看到"}${vision.rate > 0 ? `\n+${vision.rate.toFixed(1)}/秒` : ""}`;
    const light = this.world.lightPerception;
    this.$("#escape-glare-info").textContent = `${light.illuminated ? "正照中奶蛙" : "未照中奶蛙"}${light.rate > 0 ? ` · +${light.rate.toFixed(1)}/秒` : ""}`;
    const modeNames = { walk: "步行", crouch: "蹲行", sprint: "奔跑", recover: "步行恢复体力", hidden: "藏匿中" };
    this.$("#escape-movement").textContent = `${modeNames[this.world.movementMode]}${matchMedia("(pointer:fine)").matches ? "　Shift 奔跑 · C 蹲行" : ""}`;
    this.$("#escape-stick").dataset.mode = modeNames[this.world.movementMode];
    this.$("#escape-effort-label").textContent = hunt?.panting ? "喘息" : "疲劳";
    this.$(".escape-hunt").classList.toggle("critical", d.hunter.state === "chase" || exposure === 100);
    this.$(".escape-meters").classList.toggle("panting", !!hunt?.panting);
    this.$(".escape-hunt").classList.toggle("alert", (hunt?.alert ?? 0) > 0);
    const freeze = hunt?.freeze ?? 0, reveal = hunt?.reveal ?? 0;
    const dx = d.hunter.x - d.player.x, dz = d.hunter.z - d.player.z;
    const bearing = Math.atan2(dz, dx) - d.player.angle;
    const wrappedBearing = Math.atan2(Math.sin(bearing), Math.cos(bearing));
    const direction = this.$<HTMLElement>("#escape-hunter-bearing");
    const otherFloor=floorAt(d.player)!==floorAt(d.hunter);
    direction.hidden = reveal <= 0 || !otherFloor&&Math.abs(wrappedBearing) < 1.35;
    direction.classList.toggle("left", wrappedBearing < 0);
    direction.textContent = otherFloor?(floorAt(d.hunter)===-1?'↓ 奶蛙·下层':'↑ 奶蛙·上层'):wrappedBearing < 0 ? "‹ 奶蛙" : "奶蛙 ›";
    direction.setAttribute("aria-label", otherFloor?(floorAt(d.hunter)===-1?'奶蛙在下层':'奶蛙在上层'):wrappedBearing < 0 ? "奶蛙在左侧" : "奶蛙在右侧");
    const freezeButton = this.$<HTMLButtonElement>("#escape-freeze"), revealButton = this.$<HTMLButtonElement>("#escape-reveal"), wardButton = this.$<HTMLButtonElement>("#escape-ward");
    freezeButton.disabled = this.world.crystalCharges("freeze") <= 0 || freeze > 0;
    revealButton.disabled = this.world.crystalCharges("reveal") <= 0 || reveal > 0;
    const ward = hunt?.ward ?? 0;
    wardButton.disabled = this.world.crystalCharges("ward") <= 0 || ward > 0;
    this.$("#escape-freeze-count").textContent = String(this.world.crystalCharges("freeze")); this.$("#escape-reveal-count").textContent = String(this.world.crystalCharges("reveal"));
    this.$("#escape-ward-count").textContent = String(this.world.crystalCharges("ward"));
    this.$("#escape-freeze-time").textContent = freeze > 0 ? `剩 ${freeze.toFixed(1)}s` : "持续10秒";
    this.$("#escape-reveal-time").textContent = reveal > 0 ? `剩 ${reveal.toFixed(1)}s` : "持续10秒";
    this.$<HTMLProgressElement>("#escape-ward-progress").value = ward;
    this.$("#escape-ward-label").textContent = ward > 0 ? "保护中" : "净化保护";
    wardButton.setAttribute("aria-label", ward > 0 ? "净化保护中" : `使用净化晶，剩余${this.world.crystalCharges("ward")}枚，快捷键3`);
    freezeButton.classList.toggle("active", freeze > 0); revealButton.classList.toggle("active", reveal > 0);
    wardButton.classList.toggle("active", ward > 0);
    const crystalsHeld = this.world.crystalCharges("freeze") + this.world.crystalCharges("reveal") + this.world.crystalCharges("ward");
    this.$(".escape-shell").classList.toggle("no-crystals", crystalsHeld <= 0 && freeze <= 0 && reveal <= 0 && ward <= 0);
    this.$("#escape-night").textContent = this.coopMode ? `${self?.slot ?? ""}号 · ${time(d.elapsed)}` : `第${Math.min(3, d.captures + 1)}夜 · ${time(d.elapsed)}`;
    this.$(".escape-hunt").classList.toggle("interfered", interfered);
    this.$("#escape-exposure-label").textContent = interfered ? "被干扰" : "暴露值";
    if (interfered) {
      this.$("#escape-exposure-hint").textContent = "被干扰";
      for (const name of ["noise", "glare", "sight"]) this.$(`#escape-${name}-info`).textContent = "信号受污染\n读数不可信";
      this.$("#escape-danger").hidden = true;
      this.$(".escape-shell").classList.remove("being-chased");
      if (/警觉|暴露|视线|脚步/.test(this.world.message)) this.$("#escape-notice").hidden = true;
    }
    this.$("#escape-crouch").setAttribute("aria-pressed", String(d.player.crouched));
    this.$("#escape-sprint").setAttribute("aria-pressed", String(d.player.sprinting ?? false));
    this.$("#escape-crouch").setAttribute("aria-label", d.player.crouched ? "切换站立，按 C 切换" : "切换蹲行，按 C 切换");
    this.$("#escape-light").setAttribute("aria-pressed", String(d.player.light));
    this.$("#escape-stones").textContent = String(d.stones);
    this.$("#escape-stone").setAttribute("aria-label", `丢石子，剩余${d.stones}颗`);
    this.$("#escape-search").hidden = !this.world.pending;
    this.$<HTMLProgressElement>("#escape-search progress").value = this.world.pending ? 1.15 - this.world.pending.remaining : 0;
    for (const meter of this.root.querySelectorAll<HTMLMeterElement>("meter")) meter.style.setProperty("--fill", `${meter.value}%`);
    this.renderer?.drawMap(this.$("#escape-minimap"), this.world, true);
  }
  private beginRoomCue() {
    this.lastRoom = this.world.room;
    this.roomCueUntil = this.world.data.elapsed + 1.6;
  }
  destroy() {
    this.lobbyVisible=false;clearInterval(this.lobbyTimer);this.lobbyDisposer?.();this.lobbyDisposer=undefined;
    if (this.disposed) return; this.save(); if (this.coop) void this.coop.leave().catch(() => {}); this.detachCoop(); this.disposed = true; this.cinematic?.close(); this.controller.abort(); cancelAnimationFrame(this.raf); this.audio.setPlaying(false); this.audio.stopPreview();
    if (this.renderer && this.art) returnPreparedEscape({ renderer: this.renderer, art: this.art, canvas: this.$("#escape-view") });
    this.renderer = undefined; this.abilityHud.destroy(); this.noteDialog.destroy();
  }
}
