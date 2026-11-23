import type { CoopPlayer, CoopRoomView } from "./coop-protocol.ts";
import { DEFAULT_HUNTER_DIFFICULTY } from "./hunter-search-model.ts";

export type LobbyScreen = "home" | "servers" | "room" | "friends" | "profile" | "solo" | "settings" | "saves" | "controls" | "restart" | "closed";
export type LobbyProfile = { uid: string; name: string; avatar: number };
export type LobbyServer = { id: string; name: string; rooms: number; capacity: number; players: number; latency?: number; state: string };
export type LobbyRoom = { code: string; name: string; players: number; maxPlayers: number; locked: boolean; phase: string; leaderName: string };
export type LobbyFriend = { id: string; uid: string; name: string; avatar: number; online: boolean; roomCode?: string };
export type LobbyRequest = { uid: string; name: string; avatar: number };
export type LobbyInvitation = { fromUid: string; fromName: string; roomCode: string };
export type LobbyModel = {
  profile: LobbyProfile;
  version?: string;
  selfPlayerId?: string;
  network?: "online" | "lan";
  screen: LobbyScreen;
  servers: LobbyServer[];
  rooms: LobbyRoom[];
  friends: LobbyFriend[];
  requests: LobbyRequest[];
  invitations: LobbyInvitation[];
  selectedRoom?: CoopRoomView;
  selectedRoomName?: string;
  message?:string;
  rootScreen?: LobbyScreen;
  canResume?: boolean;
  hasSave?: boolean;
  music?: boolean;
  sound?: boolean;
  soloDifficulty?: number;
  storageWarning?: string;
  touchControls?: boolean;
  expanded?: boolean;
};
export type LobbyActions = {
  network?(mode:"online"|"lan"):void;
  screen(name: LobbyScreen): void;
  create(input: { name: string; visibility: "public" | "private"; password?: string }): void;
  join(code: string, password?: string): void;
  leave(): void;
  exit(): void;
  single?():void;
  controls?():void;
  settings?():void;
  back?():void;
  continueGame?():void;
  newGame?():void;
  exportSave?():void;
  importSave?():void;
  music?(enabled:boolean):void;
  sound?(enabled:boolean):void;
  difficulty?(value: number): void;
  start(): void;
  avatar(id: number): void;
  rename(name: string): void;
  addFriend(uid: string): void;
  acceptFriend(uid: string): void;
  removeFriend(uid: string): void;
  inviteFriend(uid: string): void;
  acceptInvite(roomCode: string): void;
};

const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
const avatar = (id: number) => `<span class="lv-portrait lv-avatar-${Math.max(0, Math.min(3, Math.trunc(id)))}" aria-hidden="true"></span>`;

/** Render a data-driven co-op lobby. Call the returned disposer when removing the view. */
export function renderLobbyView(container: HTMLElement, model: LobbyModel, actions: LobbyActions): () => void {
  const nav: [LobbyScreen, string][] = [["home", "大厅"], ["servers", "服务器"], ["room", "房间"], ["friends", "好友"], ["profile", "个人资料"]];
  const activePlayers = model.selectedRoom?.players ?? [];
  const roomScreen = model.screen === "room";
  const mainScreen = model.rootScreen ?? model.screen;
  const subScreen = ["solo", "settings", "saves", "controls", "restart", "closed"].includes(model.screen);
  const activeMainScreen = subScreen ? undefined : (["friends", "profile"].includes(model.screen) ? model.screen : mainScreen);
  container.innerHTML = `<section class="escape-lobby" data-lobby-screen="${model.screen}" aria-label="逃生大厅">
    <header class="lv-top"><div class="lv-status" ${model.screen==="servers" && model.network!=="lan"?"":"hidden"}><i class="${model.servers.some(s=>/online|在线|ready|可用/i.test(s.state))?"is-up":"is-down"}"></i>${model.servers[0]?esc(model.servers[0].state):"无服务器"} · ${model.servers.length?`${model.servers.reduce((n,s)=>n+s.players,0)} 人在线`:"--"}${model.servers.find(s=>s.latency!=null)?` · ${model.servers.find(s=>s.latency!=null)!.latency} ms`:""}</div><button class="lv-user" data-screen="profile">${avatar(model.profile.avatar)}<span>${esc(model.profile.name)}</span></button></header>
    <aside class="lv-rail"><button class="lv-title" data-screen="home" aria-label="回到标题画面"><small>奶蛙</small><strong>下水道逃生</strong></button>
      <nav class="lv-menu" aria-label="主菜单">
        <button class="lv-nav ${["solo","saves","restart"].includes(model.screen)?"is-active":""}" data-action="single" id="escape-menu-solo">单人游戏</button>
        <button class="lv-nav ${["servers","room"].includes(activeMainScreen??"")?"is-active":""}" data-screen="${model.selectedRoom?"room":"servers"}" id="escape-menu-coop">${model.selectedRoom?"返回房间":"多人游戏"}</button>
        <button class="lv-nav ${activeMainScreen==="friends"?"is-active":""}" data-screen="friends">好友${model.requests.length?`<em>${model.requests.length}</em>`:""}</button>
        <button class="lv-nav ${activeMainScreen==="profile"?"is-active":""}" data-screen="profile">角色</button>
        <button class="lv-nav ${model.screen==="settings"?"is-active":""}" data-screen="settings">设置</button>
        <button class="lv-nav ${model.screen==="controls"?"is-active":""}" data-screen="controls" id="escape-menu-help">操作说明</button>
        <button class="lv-nav lv-exit" data-action="exit" id="escape-intro-exit">返回首页</button>
      </nav>
      <div class="lv-rail-foot">${model.version?`v${esc(model.version)}`:""}</div></aside>
    <main class="lv-main"><div class="lv-heading"><div><div class="lv-eyebrow">${screenEyebrow(model.screen,mainScreen)}</div><h1>${roomScreen?esc(model.selectedRoomName||`房间 ${model.selectedRoom?.code||""}`):screenTitle(model.screen)}</h1><p>${roomScreen?"查看队员状态并开始游戏。":screenSubtitle(model.screen)}</p></div>${model.screen==="servers"?`<button class="lv-primary" data-open-create>＋ 创建房间</button>`:""}</div>
    ${model.message?`<p class="lv-message" role="status">${esc(model.message)}</p>`:''}${roomScreen?roomMarkup(model,activePlayers):model.screen==="servers"?serverMarkup(model):model.screen==="friends"?friendsMarkup(model):model.screen==="profile"?profileMarkup(model):model.screen==="solo"?soloMarkup(model):model.screen==="settings"?settingsMarkup(model):model.screen==="saves"?savesMarkup(model):model.screen==="controls"?controlsMarkup(model):model.screen==="restart"?restartMarkup():model.screen==="closed"?closedMarkup():homeMarkup(model)}
    </main><div class="lv-modal-root"></div></section>`;
  const onClick = (event: Event) => {
    const target = (event.target as HTMLElement).closest<HTMLElement>("button,[data-room]"); if (!target) return;
    const scr=target.dataset.screen as LobbyScreen|undefined; if(scr){actions.screen(scr==="room"&&!model.selectedRoom?"servers":scr);return;}
    if(target.dataset.network==="lan" || target.dataset.network==="online"){actions.network?.(target.dataset.network);return;}
    if(target.hasAttribute("data-open-create")){showCreate();return;}
    if(target.dataset.action==="join-code"){const code=(container.querySelector<HTMLInputElement>("#lv-code")?.value||"").trim().toUpperCase();if(code)showJoin(code,false);return;}
    const act=target.dataset.action, uid=target.dataset.uid||"";
    if(act==='single'){actions.single?.();return;}if(act==='controls'){actions.controls?.();return;}if(act==='settings'){actions.settings?.();return;}
    if(act==='back'){actions.back?.();return;}if(act==='continue'){actions.continueGame?.();return;}if(act==='new-game'){if(model.canResume)actions.screen('restart');else actions.newGame?.();return;}if(act==='confirm-new'){actions.newGame?.();return;}if(act==='save-export'){actions.exportSave?.();return;}if(act==='save-import'){actions.importSave?.();return;}
    if(act==="exit")actions.exit(); else if(act==="leave")actions.leave(); else if(act==="start"){if(canStart(model))actions.start();} else if(act==="accept-friend")actions.acceptFriend(uid); else if(act==="remove-friend")actions.removeFriend(uid); else if(act==="invite"&&model.selectedRoom)actions.inviteFriend(uid); else if(act==="accept-invite")actions.acceptInvite(target.dataset.code||""); else if(target.dataset.room){const room=model.rooms.find(r=>r.code===target.dataset.room);showJoin(target.dataset.room,!!room?.locked);}
    else if(act==="add-friend"){const v=container.querySelector<HTMLInputElement>("#lv-add-uid")?.value.trim();if(v)actions.addFriend(v);}
    else if(act==="rename"){const v=container.querySelector<HTMLInputElement>("#lv-name")?.value.trim();if(v)actions.rename(v);}
    else if(act==="avatar"){const v=Number(target.dataset.avatar);if(Number.isInteger(v))actions.avatar(v);}
  };
  const onChange=(event:Event)=>{const input=event.target as HTMLInputElement;if(input.id==='escape-menu-music')actions.music?.(input.checked);else if(input.id==='escape-menu-sound')actions.sound?.(input.checked);};
  const onInput = (event: Event) => {
    const input = event.target as HTMLInputElement;
    if (input.id !== 'escape-solo-difficulty') return;
    const output = container.querySelector<HTMLOutputElement>('#escape-difficulty-value');
    if (output) output.value = input.value;
    actions.difficulty?.(input.valueAsNumber);
  };
  container.addEventListener("click",onClick);
  container.addEventListener("change",onChange);
  container.addEventListener("input",onInput);
  function showJoin(code:string, locked:boolean){const root=container.querySelector<HTMLElement>(".lv-modal-root")!;root.innerHTML=`<div class="lv-scrim" data-dismiss><form class="lv-modal"><button type="button" class="lv-close" data-dismiss aria-label="关闭">×</button><div class="lv-eyebrow">加入房间</div><h2>${esc(code)}</h2>${locked?`<label>房间密码<input name="password" type="password" required autofocus></label>`:`<label>房间密码（如有）<input name="password" type="password" autofocus></label>`}<button class="lv-primary" type="submit">加入</button></form></div>`;const form=root.querySelector("form")!;form.addEventListener("submit",e=>{e.preventDefault();actions.join(code,String(new FormData(form).get("password")||"")||undefined);root.innerHTML="";});root.addEventListener("click",e=>{if((e.target as HTMLElement).hasAttribute("data-dismiss"))root.innerHTML="";},{once:true});}
  function showCreate(){const root=container.querySelector<HTMLElement>(".lv-modal-root")!;root.innerHTML=`<div class="lv-scrim" data-dismiss><form class="lv-modal"><button type="button" class="lv-close" data-dismiss aria-label="关闭">×</button><div class="lv-eyebrow">新建房间</div><h2>创建房间</h2><label>房间名称<input name="name" maxlength="12" placeholder="房间名称" required></label><label>访问权限<select name="visibility"><option value="public">公开</option><option value="private">密码房</option></select></label><label class="lv-password" hidden>房间密码<input name="password" maxlength="32" type="password" placeholder="设置加入密码"></label><button class="lv-primary" type="submit">创建并加入</button></form></div>`;const form=root.querySelector("form")!,visibilityField=form.querySelector<HTMLSelectElement>('select')!,password=form.querySelector<HTMLInputElement>('[name="password"]')!;visibilityField.addEventListener('change',()=>{const locked=visibilityField.value==='private';password.required=locked;password.closest<HTMLElement>('label')!.hidden=!locked;});form.addEventListener("submit",e=>{e.preventDefault();const fd=new FormData(form);const visibility=fd.get("visibility")==="private"?"private":"public";actions.create({name:String(fd.get("name")||"小队"),visibility,...(visibility==="private"?{password:String(fd.get("password")||"")}: {})});root.innerHTML="";});root.addEventListener("click",e=>{if((e.target as HTMLElement).hasAttribute("data-dismiss"))root.innerHTML="";},{once:true}); }
  return () => { container.removeEventListener("click",onClick); container.removeEventListener("change",onChange); container.removeEventListener("input",onInput); container.innerHTML=""; };
}

function homeMarkup(m:LobbyModel){return `<div class="lv-home-stage"><p class="lv-home-line">浴场的灯又灭了。别让它听见你。</p></div>${m.invitations.length?`<div class="lv-invites">${m.invitations.map(i=>`<div>${avatar(0)}<span><b>${esc(i.fromName)}</b> 邀请你加入 <strong>${esc(i.roomCode)}</strong></span><button class="lv-primary" data-action="accept-invite" data-code="${esc(i.roomCode)}">接受邀请</button></div>`).join("")}</div>`:""}`;}
function serverCard(s:LobbyServer){return `<article class="lv-server"><h3>${esc(s.name)}</h3><p>${s.rooms}/${s.capacity} 个房间 · ${s.players} 人</p><footer><span class="${s.latency!=null&&s.latency<100?"lv-good":""}">${s.latency==null?"--":`${s.latency} ms`}</span></footer></article>`;}
function serverMarkup(m: LobbyModel) {
  const local = m.network === "lan";
  const modes = m.servers[0]?.id === "lan" ? "" : `<div class="lv-network" role="group" aria-label="联机方式">${(["online","lan"] as const).map(mode=>`<button class="lv-secondary" data-network="${mode}" aria-pressed="${mode===(m.network??"online")}">${mode==="lan"?"内网模式":"在线模式"}</button>`).join("")}</div>`;
  const join = '<div class="lv-list-tools"><label>房间码<input id="lv-code" maxlength="12" placeholder="输入房间码" autocomplete="off"></label><button class="lv-secondary" data-action="join-code">加入房间</button></div>';
  if(local) return modes + join + '<p class="lv-message">连上同一 Wi-Fi 或有线网络，让队友用房间码加入。对局期间请房主保持游戏页面打开。</p>';
  return `${modes}${join}<div class="lv-server-grid">${m.servers.map(serverCard).join("") || '<div class="lv-empty">暂无服务器数据</div>'}</div><div class="lv-section-head"><h2>房间列表</h2><span>公开房间与密码房</span></div><div class="lv-room-list">${m.rooms.map(r=>`<article><div><b>${esc(r.name)}</b><span>${esc(r.code)} · 队长 ${esc(r.leaderName)}</span></div><span class="lv-room-phase">${phaseLabel(r.phase)}</span><span>${r.locked?"需要密码":"公开"}</span><span>${r.players}/${r.maxPlayers}</span><button class="lv-primary" data-room="${esc(r.code)}" ${r.phase!=="lobby"||r.players>=r.maxPlayers?"disabled":""}>${r.players>=r.maxPlayers?"已满":r.phase!=="lobby"?"进行中":"加入"}</button></article>`).join("") || '<div class="lv-empty">暂无房间。</div>'}</div>`;
}
function roomMarkup(m:LobbyModel,players:CoopPlayer[]){const ps=players;return `<div class="lv-room-banner"><span>${m.network==="lan"?"内网房间":"房间"}　/　${esc(m.selectedRoom?.code||"------")}</span><span>${ps.length}/3 玩家</span></div><div class="lv-roster">${[0,1,2].map(slot=>{const p=ps.find(p=>p.slot===slot+1);return `<article class="lv-slot ${p?"occupied":"vacant"}">${p?`<div class="lv-body lv-body-${p.avatar}" aria-hidden="true"></div><div class="lv-player-card">${avatar(p.avatar)}<span><b>${esc(p.name)}${p.id===m.selectedRoom?.leaderId?` <small>队长</small>`:""}</b><em>${p.status!=="connected"?esc(p.status):p.ready?"已准备":"等待准备"}</em></span><i class="${p.ready?"ready":""}">${p.ready?"✓":"…"}</i></div>`:`<div class="lv-vacant-mark">＋</div><b>等待玩家</b><span>空位</span>`}</article>`;}).join("")}</div><div class="lv-room-bottom"><div><b>队伍状态</b><span>${ps.length<3?`还可加入 ${3-ps.length} 名玩家`:"队伍已满"}</span></div><button class="lv-secondary" data-action="leave">离开房间</button>${m.selfPlayerId===m.selectedRoom?.leaderId?`<button class="lv-primary" data-action="start" ${canStart(m)?"":"disabled"}>开始游戏　→</button>`:`<button class="lv-secondary" disabled>等待队长</button>`}</div>`;}
function friendsMarkup(m:LobbyModel){return `<div class="lv-list-tools"><label>添加好友 UID<input id="lv-add-uid" maxlength="48" placeholder="输入好友 UID"></label><button class="lv-primary" data-action="add-friend">发送申请</button></div>${m.requests.length?`<div class="lv-section-head"><h2>好友申请</h2></div><div class="lv-friend-list">${m.requests.map(r=>`<div>${avatar(r.avatar)}<b>${esc(r.name)} <small>UID ${esc(r.uid)}</small></b><button class="lv-primary" data-action="accept-friend" data-uid="${esc(r.uid)}">接受</button></div>`).join("")}</div>`:""}<div class="lv-section-head"><h2>好友列表</h2><span>${m.friends.filter(f=>f.online).length} 位在线</span></div><div class="lv-friend-list">${m.friends.map(f=>`<div>${avatar(f.avatar)}<b>${esc(f.name)} <small>UID ${esc(f.uid)}</small></b><span class="${f.online?"online":""}">${f.online?(f.roomCode?`房间 ${esc(f.roomCode)}`:"在线"):"离线"}</span>${f.online?`<button class="lv-secondary" data-action="invite" data-uid="${esc(f.uid)}" ${m.selectedRoom && m.network!=="lan"?"":"disabled"}>邀请</button>`:""}<button class="lv-quiet" data-action="remove-friend" data-uid="${esc(f.uid)}">移除</button></div>`).join("")||`<div class="lv-empty">暂无好友。输入 UID 发送申请。</div>`}</div>${m.invitations.length?`<div class="lv-section-head"><h2>房间邀请</h2></div><div class="lv-friend-list">${m.invitations.map(i=>`<div>${avatar(0)}<b>${esc(i.fromName)} <small>邀请你加入 ${esc(i.roomCode)}</small></b><button class="lv-primary" data-action="accept-invite" data-code="${esc(i.roomCode)}">加入房间</button></div>`).join("")}</div>`:""}`;}
function profileMarkup(m:LobbyModel){return `<div class="lv-profile"><div class="lv-profile-card">${avatar(m.profile.avatar)}<div><h2>${esc(m.profile.name)}</h2><p>UID ${esc(m.profile.uid)}</p></div></div><label>昵称<input id="lv-name" maxlength="12" value="${esc(m.profile.name)}"></label><button class="lv-primary" data-action="rename">保存昵称</button><div class="lv-section-head"><h2>选择角色</h2></div><div class="lv-avatar-picker">${[0,1,2,3].map(i=>`<button class="${m.profile.avatar===i?"selected":""}" data-action="avatar" data-avatar="${i}">${avatar(i)}<b>${["雨衣青年","旧浴袍幸存者","蒙脸维修员","旧制服巡夜人"][i]}</b><span>${m.profile.avatar===i?"当前选择":"选择角色"}</span></button>`).join("")}</div></div>`;}

function screenTitle(screen:LobbyScreen){return ({home:"多人大厅",servers:"多人游戏",room:"房间",friends:"好友",profile:"角色",solo:"单人游戏",settings:"设置",saves:"存档",controls:"操作说明",restart:"重新开始",closed:"房间已关闭"} satisfies Record<LobbyScreen,string>)[screen];}
function screenEyebrow(_screen:LobbyScreen,_root:LobbyScreen){return "";}
function screenSubtitle(screen:LobbyScreen){return ({home:"",servers:"",room:"查看队员状态并开始游戏。",friends:"",profile:"",solo:"选择继续或开始新游戏。",settings:"声音设置",saves:"本机存档",controls:"",restart:"是否重新开始？当前进度会被重置。",closed:"当前房间已关闭。"} satisfies Record<LobbyScreen,string>)[screen];}
function soloMarkup(m:LobbyModel) {
  const difficulty = m.soloDifficulty ?? DEFAULT_HUNTER_DIFFICULTY;
  return `<div class="lv-window"><div class="lv-difficulty">
    <label for="escape-solo-difficulty">奶娃难度<output id="escape-difficulty-value" for="escape-solo-difficulty">${difficulty}</output></label>
    <input id="escape-solo-difficulty" type="range" min="0" max="100" step="1" value="${difficulty}" aria-describedby="escape-difficulty-hint">
    <small id="escape-difficulty-hint">0 失明 · 50 标准 · 100 敏锐</small>
  </div><div class="lv-window-actions">${m.canResume?`<button class="lv-primary" id="escape-continue" data-action="continue">继续游戏</button>`:""}<button class="${m.canResume?"lv-secondary":"lv-primary"}" id="escape-new" data-action="new-game">新游戏</button><button class="lv-secondary" id="escape-intro-saves" data-screen="saves">存档</button><button class="lv-secondary" data-screen="settings">设置</button><button class="lv-quiet" id="escape-solo-back" data-action="back">返回</button></div></div>`;
}
function settingsMarkup(m:LobbyModel){return `<div class="lv-window"><div class="lv-setting-list"><label><span>音乐</span><input id="escape-menu-music" type="checkbox" ${m.music?"checked":""}></label><label><span>音效</span><input id="escape-menu-sound" type="checkbox" ${m.sound?"checked":""}></label></div><button class="lv-primary" id="escape-settings-back" data-action="back">返回</button></div>`;}
function savesMarkup(m:LobbyModel){return `<div class="lv-window"><p>${m.hasSave?"已有逃生进度":"暂无逃生进度"}</p>${m.storageWarning?`<p class="lv-message">${esc(m.storageWarning)}</p>`:""}<button class="lv-primary" id="escape-save-export" data-action="save-export" ${m.hasSave?"":"disabled"}>备份存档</button><button class="lv-secondary" id="escape-intro-import" data-action="save-import">恢复存档</button><button class="lv-quiet" id="escape-saves-back" data-action="back">返回</button></div>`;}
function controlsMarkup(m:LobbyModel){const controls=m.touchControls?[["移动","左侧摇杆"],["观察","滑动右侧画面"],["互动","靠近目标后点击手掌"],["奔跑","点击切换奔跑"],["蹲行","点击切换蹲行"],["冻结 / 显形 / 净化","屏幕晶体按钮"]]:[["移动","WASD / 方向键"],["观察","点击画面后移动鼠标"],["抬头 / 低头","PageUp / PageDown"],["互动","E / 空格"],["奔跑","Shift 切换"],["蹲行","C 切换"],["手电","F"],["石子 / 地图 / 背包","Q / M / B"],["暴露详情","Tab"],["冻结 / 显形 / 净化","1 / 2 / 3"],["暂停 / 释放鼠标","Esc"]];const tips=["被发现时拉开距离，躲进衣柜并保持安静。","被干扰时仪表不可信，绿晶能驱散杂讯。","找到钥匙和工具，打开下水道铁网。","冻住奶蛙能争取调整位置的机会；显形晶可查看奶蛙方向。",...(m.expanded?["旧更衣室里有缺失的手轮；锅炉房维修纸条记着泄压顺序。","走廊碎玻璃可以绕开或蹲行通过。"]:[]),"一直跑会积累疲劳并发出喘息声，停下休息可恢复。","手电照到奶蛙会让它更快发现你，移开光束警觉会下降。","被抓后进入下一夜，物品保留；第三次被抓则失败。"];return `<div class="lv-window"><dl class="escape-bindings">${controls.map(([label,value])=>`<div><dt>${label}</dt><dd>${value}</dd></div>`).join("")}</dl><ul class="escape-help">${tips.map(tip=>`<li>${tip}</li>`).join("")}</ul><div class="lv-window-actions"><button id="escape-help-settings" class="lv-secondary" data-screen="settings">设置</button><button id="escape-help-close" class="lv-primary" data-action="back">返回</button></div></div>`;}
function restartMarkup(){return `<div class="lv-window"><p>重新开始会重置当前逃生进度，保留最佳纪录。</p><button id="escape-confirm-restart" class="lv-primary" data-action="confirm-new">重新开始</button><button id="escape-cancel-restart" class="lv-secondary" data-action="back">返回</button></div>`;}
function closedMarkup(){return `<div class="lv-window"><button id="escape-coop-closed-leave" class="lv-primary" data-action="leave">返回大厅</button></div>`;}

function canStart(m:LobbyModel){const room=m.selectedRoom;return !!room&&room.leaderId===m.selfPlayerId&&room.players.length>=2&&room.players.every(p=>p.ready&&p.status==="connected");}
function phaseLabel(phase:string){return phase==="lobby"?"等待中":phase==="playing"?"进行中":phase==="won"||phase==="lost"?"已结束":phase;}
