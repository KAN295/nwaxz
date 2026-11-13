import "./style.css";
import "./menu.css";
import type { EscapeGame } from "./escape/game.ts";
import type { VersusClient } from "./versus/client.ts";
import type { RunnerGame } from "./runner/game.ts";
import { version } from "../package.json";
import { createGameUpdater } from "./updates.ts";
import { preloadGame, readPreloadStatus } from "./preload.ts";
import { levels } from "./game/levels";
import { canEnter, modeIndices, modeOf, nextLevel, bathNames, bathModes, isDarkBath, type GameMode } from "./game/modes";
import { BathGame, type RunResult } from "./game/renderer";
import { artworkPaths, loadArtwork, levelArtworkKeys, type Artwork } from "./artwork";
import { AudioManager } from "./audio";
import { defaultSettings, loadSettings, saveSettings, type Settings } from "./settings";
import { prepareSaveGeneration } from "./save-generation.ts";
import {
  createSaveBackup,
  emptyProgress,
  loadProgress,
  mergeProgress,
  parseSaveBackup,
  saveProgress,
  starCount,
  scoreRun,
  formatTime,
  type Progress,
} from "./progress";

const app = document.querySelector<HTMLDivElement>("#app")!;
let progress: Progress = emptyProgress(),
  settings: Settings = defaultSettings(),
  art: Artwork;
let saveReady = false;
let mode: GameMode = "normal";
let escapeGame: EscapeGame | undefined;
let versusClient: VersusClient | undefined;
let runnerGame: RunnerGame | undefined;
let game: BathGame | undefined,
  selected = 0,
  chapter = 1,
  screen: "loading" | "preparing" | "home" | "baths" | "levels" | "play" | "escape" | "versus" | "runner" = "loading";
let preparationId = 0;
let offlineReady = false,
  updateAvailable = false,
  toastTimer = 0;
const audio = new AudioManager(settings);
const chapterCount = () => Math.max(...modeIndices(mode).map(index => levels[index].chapter ?? 1));
const modeName = () => bathNames[mode];
const chapterArt = () => mode === "halloween" ? artworkPaths.halloweenBath : mode === "infernal" ? artworkPaths.infernalBath : mode === "horror" ? horrorChapters[chapter].art : artworkPaths.cover;
const chapterTitle = () => mode === "halloween" ? "灯熄之前" : mode === "infernal" ? "炉火深处" : mode === "horror" ? horrorChapters[chapter].title : chapterNames[chapter] ?? "新的水路";
const chapterCaption = () => mode === "halloween" ? "灯还亮着，时间却不多了。" : mode === "infernal" ? "钟声停下，它就来接你。" : mode === "horror" ? horrorChapters[chapter].caption : "";
function applyBathTheme() { document.body.classList.toggle("horror-theme",isDarkBath(mode));document.body.classList.toggle("halloween-theme",mode==="halloween");document.body.classList.toggle("infernal-theme",mode==="infernal"); }
const horrorChapters: { [chapter: number]: { title: string; caption: string; art: string } } = {
  1: { title: "夜幕初临", caption: "灯灭之后，奶蛙还在笑。", art: artworkPaths.hauntedBath },
  2: { title: "地下回声", caption: "洗衣机停了，地下却还有水声。", art: artworkPaths.hauntedLaundry },
};
const chapterNames: { [chapter: number]: string } = { 1: "等水的奶蛙", 2: "风和水的小机关", 3: "清水的守护者", 4: "暖暖水工坊" };
const channel =
  typeof BroadcastChannel === "undefined"
    ? undefined
    : new BroadcastChannel("nwaxz-progress");
const $ = <T extends HTMLElement = HTMLElement>(selector: string) =>
  app.querySelector<T>(selector)!;
const icons = {
  back: '<path d="m15 5-7 7 7 7"/>',
  settings:
    '<path d="m10 3-.6 2.2-2.1 1.2-2.2-.5-2 3.4 1.6 1.7v2.4L3.1 15l2 3.4 2.2-.5 2.1 1.2L10 21h4l.6-2.2 2.1-1.2 2.2.5 2-3.4-1.6-1.7v-2.4l1.6-1.7-2-3.4-2.2.5-2.1-1.2L14 3Z"/><circle cx="12" cy="12" r="3"/>',
  pause: '<path d="M8 5v14M16 5v14"/>',
  restart: '<path d="M4 9a8 8 0 1 1 1 9M4 3v6h6"/>',
  play: '<path d="m9 5 11 7-11 7Z"/>',
  star: '<path d="m12 2 3 6 7 1-5 5 1 7-6-3-6 3 1-7-5-5 7-1Z"/>',
  lock: '<rect x="5" y="10" width="14" height="11" rx="3"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',
  close: '<path d="m6 6 12 12M18 6 6 18"/>',
  drop: '<path d="M12 2S4 10 4 15a8 8 0 0 0 16 0c0-5-8-13-8-13Z"/>',
};
const icon = (name: keyof typeof icons) =>
  `<svg viewBox="0 0 24 24" aria-hidden="true">${icons[name]}</svg>`;
const buttonIcon = (name: keyof typeof icons, label: string, id: string) =>
  `<button class="icon-button" id="${id}" aria-label="${label}" title="${label}">${icon(name)}</button>`;
const stars = (count: number) =>
  `<span class="stars" aria-label="${count} / 3 泡泡币">${[0, 1, 2].map((i) => `<span class="${i < count ? "earned" : ""}">${icon("star")}</span>`).join("")}</span>`;
const totalCoins = (target: GameMode = mode) =>
  modeIndices(target).reduce(
    (sum, index) => sum + starCount(progress.levels[levels[index].id]?.collected ?? 0),
    0,
  );
const unlocked = (index: number) =>
  canEnter(index, progress);
const scoreText = (value: number) => value.toLocaleString("zh-CN");
function chrome(content: string) {
  app.innerHTML = `${content}<dialog id="dialog" aria-labelledby="dialog-title"></dialog><div id="toast" class="toast" role="status" aria-live="polite" hidden></div>`;
}
function toast(message: string) {
  const dialog = app.querySelector<HTMLDialogElement>("dialog[open]");
  let element =
    dialog?.querySelector<HTMLElement>(".modal-feedback") ??
    app.querySelector<HTMLElement>("#toast");
  if (dialog && !dialog.querySelector(".modal-feedback")) {
    element = document.createElement("p");
    element.className = "modal-feedback";
    element.setAttribute("role", "status");
    dialog.append(element);
  }
  if (!element) return;
  clearTimeout(toastTimer);
  element.textContent = message;
  element.hidden = false;
  toastTimer = window.setTimeout(() => {
    element.hidden = true;
  }, 4000);
}
function leaveGame() {
  preparationId++;
  runnerGame?.destroy(); runnerGame = undefined;
  versusClient?.destroy(); versusClient = undefined;
  escapeGame?.destroy(); escapeGame = undefined;
  document.body.classList.remove("escape-theme", "hub-theme", "versus-theme", "runner-theme", "halloween-theme", "infernal-theme");
  audio.setSettings(settings);
  game?.destroy();
  game = undefined;
  audio.setPlaying(false);
  if (document.fullscreenElement === document.documentElement)
    void document.exitFullscreen().catch(() => {});
}
function modeCheckpoint(target: GameMode) {
  const indices = modeIndices(target);
  return indices.find(i => unlocked(i) && !progress.levels[levels[i].id]?.completed) ?? indices[0];
}
function openMode(target: GameMode) {
  mode = target;
  chapter = levels[modeCheckpoint(target)].chapter ?? 1;
  audio.setMode(target); void audio.unlock(); audio.effect("tap");
  renderLevels();
}
function renderHome() {
  renderHub("home");
}
function renderBaths() {
  renderHub("baths");
}
function renderHub(page: "home" | "baths") {
  leaveGame(); mode = "normal"; audio.setMode(mode);
  document.body.classList.remove("horror-theme"); document.body.classList.add("hub-theme");
  screen = page;
  const modes: { id: string; title: string; name: string; caption: string; art: string; hot?: boolean; planned?: boolean }[] = page === "baths" ? [
    { id: "normal", title: "泡泡浴场", name: "引水解谜", caption: "挖土 · 引水", art: "/assets/scenes/bath-cover-v2.webp" },
    { id: "horror", title: "午夜浴场", name: "暗夜机关", caption: "暗夜 · 机关", art: "/assets/scenes/haunted-cover-v1.webp" },
    { id: "halloween", title: "万圣浴场", name: "南瓜夜宴", caption: "南瓜 · 限时", art: "/assets/scenes/halloween-cover-v1.png" },
    { id: "infernal", title: "地狱浴场", name: "炉火禁区", caption: "噩梦 · 限时", art: "/assets/scenes/infernal-cover-v1.png" },
  ] : [
    { id: "bath", title: "浴场模式", name: "泡泡浴场 · 午夜浴场", caption: "挖土 · 引水", art: "/assets/scenes/bath-cover-v2.webp" },
    { id: "extreme", title: "逃生模式", name: "下水道逃生", caption: "搜寻 · 躲藏", art: "/assets/scenes/escape-cover-v1.webp", hot: true },
    { id: "runner", title: "奶蛙逃亡", name: "无限跑酷", caption: "跳跃 · 转向", art: "/assets/runner/aqueduct-scene-v1.png" },
    { id: "pvp", title: "奶娃峡谷", name: "3v3 · 阵容预演", caption: "两岸 · 争流", art: "/assets/scenes/versus-cover-v1.png" },
  ];
  chrome(`<main class="game-hub screen-enter" data-hub-page="${page}" aria-label="${page === "home" ? "游戏主界面" : "选择浴场"}"><header class="hub-header"><div class="hub-heading">${page === "baths" ? buttonIcon("back", "返回模式选择", "hub-back") : ""}<h1>${page === "home" ? "奶蛙<span>爱洗澡</span>" : "浴场<span>模式</span>"}</h1></div>${buttonIcon("settings", "设置", "settings")}</header>
    <nav class="mode-posters" data-count="${modes.length}" aria-label="${page === "baths" ? "选择浴场" : "选择模式"}">${modes.map(m => `<button id="${m.id}" class="mode-poster mode-${m.id}" aria-label="${m.title} · ${m.name}${m.planned ? "，尚未开放" : ""}" ${m.planned ? "disabled" : ""}><img class="mode-art" src="${m.art}" alt=""/>${m.hot ? '<span class="mode-hot">HOT</span>' : m.id === "pvp" ? '<span class="mode-badge">3v3</span>' : ''}<span class="mode-content"><span class="mode-caption">${m.caption}</span><strong>${m.title}</strong><span class="mode-name">${m.name}</span><span class="mode-enter">${m.planned ? "筹备中" : m.id === "pvp" ? "进入大厅" : page === "baths" ? "进入浴场" : "进入模式"} ${icon(m.planned ? "lock" : "play")}</span></span></button>`).join("")}</nav>
    <footer class="hub-footer"><span>v${version}</span><button id="update" ${updateAvailable ? "" : "hidden"}>有新版本 ${icon("restart")}</button></footer></main>`);
  if (page === "baths") {
    $("#normal").onclick = () => openMode("normal");
    $("#horror").onclick = () => openMode("horror");
    $("#halloween").onclick = () => openMode("halloween");
    $("#infernal").onclick = () => openMode("infernal");
    $("#hub-back").onclick = renderHome;
  } else {
    $("#bath").onclick = renderBaths;
    $("#extreme").onclick = () => void enterEscape();
    $("#runner").onclick = () => void enterRunner();
    $("#pvp").onclick = () => void enterVersus();
  }
  $("#settings").onclick = () => openSettings(); $("#update").onclick = applyUpdate;
  queueMicrotask(() => gameUpdater.apply());
}
async function enterRunner() {
  leaveGame(); screen = "runner";
  const request = preparationId;
  document.body.classList.remove("horror-theme");
  document.body.classList.add("runner-theme");
  audio.setMode("normal");
  chrome('<main class="escape-entry-screen"><div class="escape-entry-status" role="status"><small>奶蛙逃亡</small><p>正在寻找水渠出口…</p></div><button id="runner-return" class="escape-entry-back">返回首页</button></main>');
  $("#runner-return").onclick = renderHome;
  try {
    const { RunnerGame } = await import("./runner/game.ts");
    if (screen !== "runner" || preparationId !== request) return;
    runnerGame = new RunnerGame(app, audio, settings, renderHome);
  } catch {
    if (screen !== "runner" || preparationId !== request) return;
    chrome('<main class="escape-entry-screen"><div class="escape-entry-status" role="status"><p>水渠未能载入，请检查网络后重试。</p><button id="runner-retry" class="escape-entry-back">重试</button></div><button id="runner-return" class="escape-entry-back">返回首页</button></main>');
    $("#runner-retry").onclick = () => void enterRunner();
    $("#runner-return").onclick = renderHome;
  }
}
async function enterVersus() {
  leaveGame(); screen = "versus";
  document.body.classList.remove("horror-theme");
  document.body.classList.add("versus-theme");
  chrome('<main class="menu-stage"><p class="escape-loading">正在前往峡谷…</p></main>');
  try {
    const { VersusClient } = await import("./versus/client.ts");
    if (screen !== "versus") return;
    versusClient = new VersusClient(app, { version, updateAvailable, onExit: renderHome, onUpdate: applyUpdate, onSafe: () => queueMicrotask(() => gameUpdater.apply()) });
    queueMicrotask(() => gameUpdater.apply());
  } catch {
    chrome('<main class="menu-stage"><p class="escape-loading">峡谷载入失败，请重试。</p><button id="versus-retry" class="game-button">重试</button><button id="versus-return" class="game-button">返回主界面</button></main>');
    $("#versus-retry").onclick = () => void enterVersus();
    $("#versus-return").onclick = renderHome;
  }
}
async function enterEscape() {
  leaveGame(); screen = "escape";
  const request = preparationId;
  document.body.classList.add("horror-theme", "escape-theme");
  chrome('<main class="escape-entry-screen" aria-label="正在进入逃生大厅"><div class="escape-entry-status" role="status"><small>逃生模式</small><p>正在进入大厅…</p><span class="escape-entry-line" aria-hidden="true"></span></div><button id="escape-load-return" class="escape-entry-back">返回首页</button></main>');
  $("#escape-load-return").onclick = renderHome;
  try {
    const { EscapeGame } = await import("./escape/game.ts");
    if (screen !== "escape" || request !== preparationId) return;
    escapeGame = new EscapeGame(app, audio, settings, renderHome);
  } catch {
    if (screen !== "escape" || request !== preparationId) return;
    chrome('<main class="escape-entry-screen" aria-label="逃生大厅载入失败"><div class="escape-entry-status" role="status"><small>逃生模式</small><p>大厅暂时未能载入</p><button id="escape-load-retry" class="escape-entry-back">刷新重试</button></div><button id="escape-load-return" class="escape-entry-back">返回首页</button></main>');
    $("#escape-load-retry").onclick = () => location.reload();
    $("#escape-load-return").onclick = renderHome;
  }
}
function renderLevels() {
  leaveGame();
  applyBathTheme();
  screen = "levels";
  const checkpoint = modeCheckpoint(mode), complete = modeIndices(mode).every(i => progress.levels[levels[i].id]?.completed);
  chrome(
    `<main class="menu-stage chapter-screen screen-enter" aria-label="${modeName()}选关"><img class="cover-art chapter-art" src="${chapterArt()}" alt=""/><header class="menu-header">${buttonIcon("back", "返回浴场模式", "home")}<h1>${modeName()}</h1><span class="coin-badge">${icon("star")}${totalCoins()} / ${modeIndices(mode).length * 3}</span></header><div class="chapter-heading"><div class="chapter-pager"><button id="previous-chapter" aria-label="上一章" ${chapter === 1 ? "disabled" : ""}>‹</button><span>第${["", "一", "二", "三", "四"][chapter] ?? chapter}章</span><button id="next-chapter" aria-label="下一章" ${chapter === chapterCount() ? "disabled" : ""}>›</button></div><h2>${chapterTitle()}</h2>${chapterCaption() ? `<p class="night-caption">${chapterCaption()}</p>` : ""}</div><button id="mode-continue" class="mode-continue"><span>${complete ? "再玩一次" : progress.levels[levels[modeIndices(mode)[0]].id]?.completed ? "继续闯关" : "开始闯关"}<small>第${modeIndices(mode).indexOf(checkpoint) + 1}关 · ${levels[checkpoint].title}</small></span>${icon("play")}</button><nav class="level-map" aria-label="选择关卡">${levels
      .map((level, index) => {
        if (modeOf(index) !== mode || (level.chapter ?? 1) !== chapter) return "";
        const number = modeIndices(mode).indexOf(index) + 1;
        const record = progress.levels[level.id],
          locked = !unlocked(index);
        const score =
          record?.bestScore !== undefined
            ? `最高分 <b>${scoreText(record.bestScore)}</b>${record.bestTimeMs !== undefined ? `<small>最快 ${formatTime(record.bestTimeMs)}</small>` : ""}`
            : record?.completed
              ? "已通关"
              : "未通关";
        return `<button class="level-stop ${locked ? "locked" : record?.completed ? "completed" : ""}" data-level="${index}" ${locked ? "disabled" : ""} aria-label="第${number}关 ${level.title}${locked ? "，尚未解锁" : ""}"><span class="level-number">${locked ? icon("lock") : String(number).padStart(2, "0")}</span><span class="level-info"><strong>${level.title}</strong>${stars(starCount(record?.collected ?? 0))}<span class="level-score">${locked ? "通关上一关解锁" : score}</span>${level.timeLimitMs ? `<span class="level-deadline">限时 ${level.timeLimitMs/1000}秒</span>` : ""}</span>${locked ? "" : `<span class="level-go">${icon("play")}</span>`}</button>`;
      })
      .join(
        "",
      )}</nav><button id="settings" class="chapter-settings icon-button" aria-label="设置">${icon("settings")}</button></main>`,
  );
  $("#home").onclick = renderBaths;
  $("#mode-continue").onclick = () => enterLevel(checkpoint);
  $("#settings").onclick = () => openSettings();
  $("#previous-chapter").onclick = () => { chapter = Math.max(1, chapter - 1); renderLevels(); };
  $("#next-chapter").onclick = () => { chapter = Math.min(chapterCount(), chapter + 1); renderLevels(); };
  for (const element of app.querySelectorAll<HTMLButtonElement>("[data-level]"))
    element.onclick = () => enterLevel(Number(element.dataset.level));
  queueMicrotask(() => gameUpdater.apply());
}
async function enterLevel(index: number) {
  if (!unlocked(index)) return;
  audio.unlock();
  audio.effect("tap");
  if (!document.fullscreenElement && document.documentElement.requestFullscreen)
    void document.documentElement
      .requestFullscreen({ navigationUI: "hide" })
      .catch(() => {});
  game?.destroy();
  game = undefined;
  audio.setPlaying(false);
  const request = ++preparationId;
  screen = "preparing";
  chrome('<main class="menu-stage resource-preparing"><p class="escape-loading" id="prepare-label">正在布置浴场…</p><progress id="prepare-progress" max="100" value="0" aria-label="浴场准备进度"></progress><button id="prepare-back" class="game-button">返回选关</button></main>');
  $("#prepare-back").onclick = renderLevels;
  try {
    const loaded = await loadArtwork((done, total) => {
      if (request !== preparationId) return;
      $<HTMLProgressElement>("#prepare-progress").value = done / total * 100;
      $("#prepare-label").textContent = `正在布置浴场… ${done} / ${total}`;
    }, levelArtworkKeys(levels[index]));
    if (request !== preparationId) return;
    art = loaded;
  } catch {
    if (request !== preparationId) return;
    $("#prepare-label").textContent = "浴场还没准备好，请检查网络后重试。";
    const retry = document.createElement("button"); retry.className = "game-button"; retry.textContent = "重试"; retry.onclick = () => void enterLevel(index); $("#prepare-back").before(retry);
    return;
  }
  selected = index;
  mode = modeOf(index);
  audio.setMode(mode);
  applyBathTheme();
  chapter = levels[index].chapter ?? 1;
  screen = "play";
  const level = levels[index];
  const devices = [
    ...(level.fans ?? []).map((fan, i) => ({ point: fan.position, kind: "fan", index: i, label: "风扇" })),
    ...(level.valves ?? []).map((valve, i) => ({ point: valve.position, kind: "valve", index: i, label: valve.kind === "sewage" ? "污水阀" : "清水阀" })),
    ...(level.sponges ?? []).map((sponge, i) => ({ point: sponge.position, kind: "sponge", index: i, label: level.sponges!.length > 1 ? `${i + 1}号海绵` : "海绵" })),
  ];
  chrome(
    `<main class="play-screen screen-enter" aria-label="游戏关卡"><div class="game-stage"><canvas id="game" tabindex="0" aria-label="挖土引水游戏。划动手指或按住鼠标挖土；方向键移动，空格挖土，Shift加方向键连续挖土；F切换风扇，V切换清水阀，B切换污水阀，E挤出海绵的水。"></canvas><div class="play-hud"><div class="hud-buttons">${buttonIcon("pause", "暂停游戏", "pause")}${buttonIcon("restart", "重新开始", "restart")}</div><div class="water-badge">${icon("drop")}<progress id="water-meter" max="100" value="0" aria-label="浴缸水量"></progress><span id="water-count">0 / 100</span></div><div id="hud-coins" class="hud-coins" aria-label="已收集0枚泡泡币">${stars(0)}</div></div>${level.timeLimitMs ? `<div class="bath-countdown" role="timer" aria-label="剩余时间"><span>${mode === "infernal" ? "炉门将落" : "灯熄之前"}</span><strong id="bath-clock">${formatTime(level.timeLimitMs)}</strong><progress id="bath-deadline" max="${level.timeLimitMs}" value="${level.timeLimitMs}" aria-label="剩余时间进度"></progress></div>` : ""}${devices.map(device => `<button class="device-control" data-device="${device.kind}-${device.index}" aria-label="${device.label}" aria-pressed="false"></button>`).join("")}<div id="result" class="result-layer" hidden></div><div id="gesture-hint" class="gesture-hint" ${progress.levels[level.id]?.completed ? "hidden" : ""}>${level.hint}</div></div></main>`,
  );
  $(".play-screen").classList.toggle("workshop", level.scene === "workshop");
  if (isDarkBath(mode)) $(".play-screen").style.setProperty("--night-scene", `url("${artworkPaths[level.scene as keyof typeof artworkPaths]}")`);
  for (const device of devices) {
    const control = $(`[data-device="${device.kind}-${device.index}"]`);
    control.style.left = `${device.point.x / 480 * 100}%`;
    control.style.top = `${device.point.y / 800 * 100}%`;
  }
  let lastCoins = 0,
    lastWater = -1,
    hintCleared = false,
    deviceState = "",
    lastDeadlineSecond = -1;
  game = new BathGame(
    $<HTMLCanvasElement>("#game"),
    levels[index],
    {
      progress(water, mask) {
        if (lastWater !== water) {
          $("#water-count").textContent = `${Math.min(100, water)} / 100`;
          $<HTMLProgressElement>("#water-meter").value = Math.min(100, water);
          lastWater = water;
        }
        if (lastCoins !== mask) {
          $("#hud-coins").innerHTML = stars(starCount(mask));
          $("#hud-coins").setAttribute(
            "aria-label",
            `已收集${starCount(mask)}枚泡泡币`,
          );
          audio.effect("coin");
          lastCoins = mask;
        }
      },
      complete: finishLevel,
      failed: finishFailed,
      deadline(remainingMs, limitMs) {
        const seconds=Math.ceil(remainingMs/1000);
        $<HTMLProgressElement>("#bath-deadline").value=remainingMs;
        if(seconds===lastDeadlineSecond)return;
        lastDeadlineSecond=seconds;$("#bath-clock").textContent=`${String(Math.floor(seconds/60)).padStart(2,"0")}:${String(seconds%60).padStart(2,"0")}`;
        $(".bath-countdown").classList.toggle("critical",remainingMs<=10000);
        if(seconds>0&&seconds<=10)audio.effect("heartbeat");
      },
      caught() {$("#gesture-hint").hidden=true;$(".play-screen").classList.add("being-caught");audio.haunt();audio.effect("heartbeat");},
      haunt() { audio.haunt(); },
      devices(interacted = false) {
        if (!game || !devices.length) return;
        if (interacted) $("#gesture-hint").hidden = true;
        const state = JSON.stringify([game.world.fanOn, game.world.valveOn, game.world.valveRemaining.map(n => n === 0), game.world.spongeContents.map(particles => particles.length > 0), game.won, game.lost]);
        if (state === deviceState) return;
        deviceState = state;
        for (const device of devices) {
          const control = $<HTMLButtonElement>(`[data-device="${device.kind}-${device.index}"]`);
          const on = device.kind === "fan" ? game.world.fanOn[device.index] : device.kind === "valve" ? game.world.valveOn[device.index] : game.world.spongeContents[device.index].length > 0;
          const empty = device.kind === "valve" && game.world.valveRemaining[device.index] === 0;
          if (device.kind === "sponge") control.removeAttribute("aria-pressed");
          else control.setAttribute("aria-pressed", String(on));
          control.setAttribute("aria-label", device.kind === "sponge" ? on ? `挤出${device.label}里的水` : `${device.label}正在等待吸水` : empty ? `${device.label}水量已用完` : `${on ? "关闭" : "开启"}${device.label}`);
          control.disabled = empty || (device.kind === "sponge" && !on) || game.won || game.lost;
        }
      },
      tap() {
        audio.effect("tap");
      },
      dig() {
        audio.effect("dig");
        if (!hintCleared && !devices.length) {
          $("#gesture-hint").hidden = true;
          hintCleared = true;
        }
      },
    },
    { art, reducedMotion: settings.reducedMotion, quality: settings.quality },
  );
  $("#pause").onclick = openPause;
  $("#restart").onclick = openRestart;
  for (const device of devices)
    $(`[data-device="${device.kind}-${device.index}"]`).onclick = () => {
      game?.activateDevice(device.point);
      $("#gesture-hint").hidden = true;
      $("#game").focus({ preventScroll: true });
    };
  audio.setPlaying(true);
  $("#game").focus({ preventScroll: true });
}
async function persist(value: Progress) {
  try {
    progress = await saveProgress(value);
    channel?.postMessage("changed");
    return true;
  } catch {
    toast("存档未能写入，请到设置里导出备份。");
    return false;
  }
}
function finishLevel(result: RunResult) {
  const deadline = app.querySelector<HTMLElement>(".bath-countdown"); if(deadline)deadline.hidden=true;
  audio.setPlaying(false);
  audio.effect("win");
  if (isDarkBath(mode)) audio.haunt();
  const next = nextLevel(selected);
  const score = scoreRun(result.collected, result.elapsedMs),
    previous = progress.levels[levels[selected].id]?.bestScore;
  const incoming = emptyProgress();
  incoming.levels[levels[selected].id] = {
    completed: true,
    collected: result.collected,
    bestScore: score,
    bestTimeMs: result.elapsedMs,
  };
  progress = mergeProgress(progress, incoming);
  void persist(progress);
  $<HTMLButtonElement>("#pause").disabled = true;
  $<HTMLButtonElement>("#restart").disabled = true;
  $("#gesture-hint").hidden = true;
  const showCelebration = () => {
    $("#result").hidden = false;
    $("#result").classList.add("celebration-layer");
    $("#result").innerHTML = `<section class="celebration-card" aria-label="奶蛙通关庆祝"><h1>${isDarkBath(mode) ? "通关！" : "洗澡成功！"}</h1>${stars(starCount(result.collected))}<button id="show-score" class="game-button gold">查看成绩 ${icon("play")}</button></section>`;
    $("#show-score").onclick = showScore;
    $("#show-score").focus({ preventScroll: true });
  };
  const showScore = () => {
    $("#result").classList.remove("celebration-layer");
    $("#result").innerHTML =
      `<section class="result-card" aria-label="通关结算"><span class="result-kicker">${modeName()} · ${levels[selected].title}</span><h1>洗澡成功</h1>${stars(starCount(result.collected))}<div class="score-value">${scoreText(score)}<small>分</small></div><span class="score-record">${previous === undefined || score > previous ? "新纪录" : `最高分 ${scoreText(previous)}`}</span><div class="result-stats"><span>通关用时<strong>${formatTime(result.elapsedMs)}</strong></span><span>泡泡币<strong>${starCount(result.collected)} / 3</strong></span></div><details class="score-breakdown"><summary>得分明细</summary><p>接水 1000 · 泡泡币 ${starCount(result.collected) * 500} · 时间 ${score - 1000 - starCount(result.collected) * 500}</p></details><button id="next" class="game-button gold">${next !== undefined ? (levels[next].chapter ?? 1) !== chapter ? "进入下一章" : "下一关" : `返回选关`} ${icon("play")}</button><div class="result-secondary"><button id="replay">${icon("restart")}再玩一次</button><button id="level-menu">返回选关</button></div></section>`;
    $("#next").onclick = () =>
      next !== undefined ? enterLevel(next) : renderLevels();
    $("#replay").onclick = () => enterLevel(selected);
    $("#level-menu").onclick = renderLevels;
    const watchAgain = document.createElement("button");
    watchAgain.textContent = "再看大笑";
    watchAgain.onclick = showCelebration;
    $(".result-secondary").append(watchAgain);
    $("#next").focus({ preventScroll: true });
  };
  showCelebration();
}
function finishFailed(reason: "pollution" | "timeout" = "pollution") {
  const deadline = app.querySelector<HTMLElement>(".bath-countdown"); if(deadline)deadline.hidden=true;
  audio.setPlaying(false);
  audio.effect("tap");
  $("#gesture-hint").hidden = true;
  $("#result").hidden = false;
  if(reason === "timeout") {
    $("#result").innerHTML=`<section class="result-card failure-card timeout-card" aria-label="超时被抓"><span class="result-kicker">时间耗尽</span><h1>${mode==="infernal"?"它来接你了":"灯灭了"}</h1><p>奶蛙把你拖进了黑暗。</p><button id="retry" class="game-button gold">再试一次 ${icon("restart")}</button><button id="failed-menu" class="game-button cream">返回选关</button></section>`;
    $("#retry").onclick=()=>enterLevel(selected);$("#failed-menu").onclick=renderLevels;$("#retry").focus({preventScroll:true});return;
  }
  const tip = levels[selected].plants?.length ? "让水草吸收污水，再开清水阀。" : "保留污水池下方的泥土，另挖清水水路。";
  $("#result").innerHTML = `<section class="result-card failure-card" aria-label="本次挑战失败"><span class="result-kicker">清水被污染了</span><h1>水变脏啦！</h1><p class="dialog-copy">污水进入浴缸。${tip}</p><button id="retry" class="game-button gold">再试一次 ${icon("restart")}</button><button id="failed-menu" class="game-button cream">返回选关</button></section>`;
  $("#retry").onclick = () => enterLevel(selected);
  $("#failed-menu").onclick = renderLevels;
}
function showDialog(content: string, onClose: () => void = () => {}) {
  const previous = $<HTMLDialogElement>("#dialog");
  previous.onclose = null;
  previous.remove();
  const dialog = document.createElement("dialog");
  dialog.id = "dialog";
  dialog.setAttribute("aria-labelledby", "dialog-title");
  dialog.innerHTML = `${content}<input id="import-file" type="file" accept="application/json,.json" hidden/>`;
  dialog.querySelector<HTMLInputElement>("#import-file")!.onchange = importSave;
  app.append(dialog);
  dialog.onclose = onClose;
  dialog.addEventListener("close", () => queueMicrotask(() => gameUpdater.apply()), { once: true });
  dialog.showModal();
  return dialog;
}
const dialogTop = (title: string) =>
  `<div class="dialog-top"><h2 id="dialog-title">${title}</h2>${buttonIcon("close", "关闭", "dialog-close")}</div>`;
function openPause() {
  if (!game || game.won || (game.lost && !game.catching) || $<HTMLDialogElement>("#dialog").open) return;
  game.paused = true;
  audio.setPlaying(false);
  const dialog = showDialog(
    `${dialogTop("暂停")}<div class="pause-mascot"><img src="${isDarkBath(mode) ? "/assets/props/pumpkin-v1.webp" : "/assets/character/wait.webp"}" alt=""/></div><button id="resume" class="game-button gold">继续游戏 ${icon("play")}</button><button id="pause-settings" class="game-button cream">设置 ${icon("settings")}</button><div class="dialog-links"><button id="pause-restart">重新开始</button><button id="quit">退出选关</button></div>`,
    () => {
      if (game && !game.won && screen === "play") {
        game.paused = false;
        audio.setPlaying(true);
        $("#game").focus({ preventScroll: true });
      }
    },
  );
  $("#dialog-close").onclick = () => dialog.close();
  $("#resume").onclick = () => dialog.close();
  $("#pause-settings").onclick = () => {
    dialog.onclose = null;
    dialog.close();
    openSettings(true);
  };
  $("#pause-restart").onclick = () => {
    dialog.onclose = null;
    dialog.close();
    enterLevel(selected);
  };
  $("#quit").onclick = () => {
    dialog.onclose = null;
    dialog.close();
    renderLevels();
  };
}
function openRestart() {
  if (!game || $<HTMLDialogElement>("#dialog").open) return;
  game.paused = true;
  audio.setPlaying(false);
  const dialog = showDialog(
    `${dialogTop("重新开始？")}<p class="dialog-copy">重置当前关卡，保留已获成绩。</p><button id="confirm-restart" class="game-button gold">重新开始 ${icon("restart")}</button><button id="cancel-restart" class="game-button cream">继续这一局</button>`,
    () => {
      if (game && !game.won) {
        game.paused = false;
        audio.setPlaying(true);
      }
    },
  );
  $("#dialog-close").onclick = () => dialog.close();
  $("#cancel-restart").onclick = () => dialog.close();
  $("#confirm-restart").onclick = () => {
    dialog.onclose = null;
    dialog.close();
    enterLevel(selected);
  };
}
function openSettings(fromPause = false) {
  let offlineDownload: AbortController | undefined;
  const toggles: { key: keyof Settings; title: string; description: string }[] =
    [
      { key: "music", title: "音乐", description: "" },
      {
        key: "sound",
        title: "音效",
        description: "",
      },
      {
        key: "vibration",
        title: "振动",
        description: "",
      },
      {
        key: "reducedMotion",
        title: "简化动作",
        description: "减少画面晃动",
      },
    ];
  const dialog = showDialog(
    `${dialogTop("设置")}<div class="settings-options">${toggles.map(({ key, title, description }) => `<label class="setting-row"><span>${title}${description ? `<small>${description}</small>` : ""}</span><input type="checkbox" role="switch" data-setting="${key}" ${settings[key] ? "checked" : ""}/><span class="switch-knob" aria-hidden="true"></span></label>`).join("")}<label class="setting-row"><span>画质</span><select id="quality" aria-label="画质"><option value="balanced" ${settings.quality === "balanced" ? "selected" : ""}>平衡</option><option value="high" ${settings.quality === "high" ? "selected" : ""}>高清</option></select></label></div><details class="save-settings"><summary>存档管理</summary><h3>关卡存档</h3><span>${levels.filter((l) => progress.levels[l.id]?.completed).length} / ${levels.length} 关 · ${bathModes.reduce((sum,target)=>sum+totalCoins(target),0)} 枚泡泡币</span><div><button id="export">导出存档</button><button id="import">导入存档</button></div><small>四座浴场的关卡成绩。逃生存档在逃生模式内管理。</small></details><div class="settings-bottom"><span>${offlineReady ? "完整离线包已就绪" : "资源按需下载"} · v${version}</span>${updateAvailable ? '<button id="settings-update">更新游戏</button>' : ""}<button id="help">怎么玩</button></div>`,
    () => {
      offlineDownload?.abort();
      audio.stopPreview();
      if (fromPause) openPause();
      else if (screen === "levels") renderLevels();
      else if (screen === "baths") renderBaths();
      else renderHome();
    },
  );
  $("#dialog-close").onclick = () => dialog.close();
  const offline = document.createElement("section");
  offline.className = "offline-download";
  offline.innerHTML = `<button id="prepare-offline" ${offlineReady ? "disabled" : ""}>${offlineReady ? "完整离线包已就绪" : "准备完整离线包"}</button><small id="offline-detail" role="status"></small>`;
  $(".settings-bottom").before(offline);
  $("#prepare-offline").onclick = async () => {
    offlineDownload = new AbortController();
    const button = $<HTMLButtonElement>("#prepare-offline"), detail = $("#offline-detail");
    button.disabled = true; button.textContent = "正在准备离线包…";
    try {
      await preloadGame(value => {
        if (!dialog.open) return;
        detail.textContent = `${Math.floor(value.loadedBytes / Math.max(1, value.totalBytes) * 100)}% · ${(value.loadedBytes / 1048576).toFixed(1)} / ${(value.totalBytes / 1048576).toFixed(1)} MB`;
      }, () => gameUpdater.check(), "all", offlineDownload.signal);
      offlineReady = true;
      if (dialog.open) { button.textContent = "完整离线包已就绪"; detail.textContent = "可断网游玩所有模式"; }
    } catch (error) {
      if (!dialog.open || offlineDownload.signal.aborted) return;
      button.disabled = false; button.textContent = "继续准备离线包";
      detail.textContent = error instanceof Error ? error.message : "下载未完成，请重试。";
    }
  };
  const previews = document.createElement("div");
  previews.className = "audio-preview";
  previews.innerHTML = '<button id="preview-music">试听音乐</button><button id="preview-sound">试听音效</button><button id="recover-audio">恢复声音</button><p id="audio-feedback" role="status" aria-live="polite"></p>';
  $(".settings-options").after(previews);
  const previewAudio = async (kind: "music" | "sound") => {
    const ready = await audio.preview(kind);
    if (!dialog.open) return;
    $("#audio-feedback").textContent = ready
      ? kind === "music" ? "正在试听音乐（4 秒）" : "音效试听中"
      : "声音未开启，请点“恢复声音”。";
  };
  $("#preview-music").onclick = () => { void previewAudio("music"); };
  $("#preview-sound").onclick = () => { void previewAudio("sound"); };
  $("#recover-audio").onclick = () => {
    // Resume synchronously in this click before the preview awaits loading.
    $("#audio-feedback").textContent = "正在恢复声音…";
    void audio.recover().then(ready => {
      if (!dialog.open) return;
      if (ready) $("#audio-feedback").textContent = "音效试听中";
      else $("#audio-feedback").textContent = "仍无声音？请检查手机媒体音量后重试。";
    });
  };
  for (const input of app.querySelectorAll<HTMLInputElement>("[data-setting]"))
    input.onchange = () => {
      settings = { ...settings, [input.dataset.setting!]: input.checked };
      applySettings();
      audio.unlock();
      if (input.dataset.setting === "music") {
        if (input.checked) void previewAudio("music");
        else audio.stopPreview();
      }
      audio.effect("tap");
    };
  $<HTMLSelectElement>("#quality").onchange = () => {
    settings = {
      ...settings,
      quality: $<HTMLSelectElement>("#quality").value as Settings["quality"],
    };
    applySettings();
  };
  $("#export").onclick = exportSave;
  $("#import").onclick = () => $("#import-file").click();
  $("#help").onclick = () => {
    audio.stopPreview();
    dialog.onclose = null;
    dialog.close();
    openHelp(fromPause);
  };
  const update = app.querySelector<HTMLButtonElement>("#settings-update");
  if (update) update.onclick = applyUpdate;
}
function applySettings() {
  audio.setSettings(settings);
  game?.setPreferences(settings);
  document.documentElement.classList.toggle(
    "reduced-motion",
    settings.reducedMotion,
  );
  try {
    saveSettings(settings);
  } catch {
    toast("设置暂时无法保存。");
  }
}
function openHelp(fromPause = false) {
  const overview = screen === "home" || screen === "baths";
  const modesHelp = "<div class=\"help-modes\"><section><h3>浴场模式</h3><p>泡泡浴场：挖土引水，收集泡泡币。午夜浴场：借灯光辨认水路，破解暗夜机关。万圣浴场与地狱浴场：限时接满清水，超时会被奶蛙抓走。</p></section><section><h3>逃生模式</h3><p>搜寻钥匙和工具，躲开奶蛙，逃进下水道。可单人游玩或与朋友组队。</p></section><section><h3>奶娃峡谷</h3><p>3v3 阵容预演与峡谷图鉴；对局尚未开放。</p></section></div>";
  const dialog = showDialog(
    `${dialogTop(overview ? "玩法" : modeName())}${overview ? modesHelp : `<ol class="how-to"><li>按住鼠标或划动手指，挖开泥土。</li><li>把清水引进右下方的管道，接够 100 滴水。</li><li>顺路收集 3 枚泡泡币，用时越短得分越高。</li><li>石板挖不动，要绕个弯。</li><li>轻点风扇可以推水；喷水阀可开关，水量有限。</li><li>紫色污水会污染清水，流进浴缸就要重试。</li><li>水草挡水，吸收紫水后会枯萎；海绵吸水，轻点可以挤水。</li></ol><p class="keyboard-help">键盘：方向键移动，空格挖土，Shift + 方向键连续挖土，F 切换风扇，V 切换清水阀，B 切换污水阀，E 挤水，Esc 暂停。</p>`}<button id="help-ok" class="game-button gold">知道了</button>`,
    () => openSettings(fromPause),
  );
  $("#dialog-close").onclick = () => dialog.close();
  $("#help-ok").onclick = () => dialog.close();
}
function exportSave() {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(createSaveBackup(progress), null, 2)], { type: "application/json" }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = "nwaxz-save.json";
  link.hidden = true;
  const dialog = $<HTMLDialogElement>("#dialog");
  (dialog.open ? dialog : app).append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast("备份已生成。");
}
async function importSave(event: Event) {
  const input = event.target as HTMLInputElement,
    file = input.files?.[0];
  if (!file) return;
  try {
    if (file.size > 16384) throw new Error("too large");
    progress = mergeProgress(progress, parseSaveBackup(JSON.parse(await file.text())));
    if (await persist(progress)) toast("存档已导入。");
  } catch (error) {
    toast(error instanceof Error ? `${error.message}现有进度仍保留。` : "存档格式不正确，现有进度仍保留。");
  } finally {
    input.value = "";
  }
}
channel?.addEventListener("message", () => {
  if (!saveReady) return;
  void loadProgress()
    .then((value) => {
      progress = mergeProgress(progress, value);
      if (screen === "levels") renderLevels();
    })
    .catch(() => {});
});
document.addEventListener("keydown", (event) => {
  if (
    event.key === "Escape" &&
    screen === "play" &&
    !$<HTMLDialogElement>("#dialog").open
  ) {
    event.preventDefault();
    openPause();
  }
});
document.addEventListener("visibilitychange", () => {
  if (document.hidden && screen === "play") openPause();
});
document.addEventListener("fullscreenchange", () => {
  if (!document.fullscreenElement && screen === "play") openPause();
});
window.addEventListener("pagehide", () => audio.suspend());
window.addEventListener("pageshow", () => audio.resume());
const gameUpdater = createGameUpdater({
  canReload: () => ["home", "baths", "levels", "versus"].includes(screen) && !app.querySelector("dialog[open]"),
  onReady() {
    updateAvailable = true;
    const update = app.querySelector<HTMLButtonElement>("#update");
    if (update) update.hidden = false;
    versusClient?.setUpdateAvailable();
  },
});
if ("serviceWorker" in navigator && "caches" in window) {
  void navigator.serviceWorker.ready
    .then(async () => {
      const value = await readPreloadStatus();
      offlineReady = !!value && value.total > 0 && value.done === value.total;
    })
    .catch(() => {});
}
function applyUpdate() {
  if (!["home", "baths", "levels", "versus"].includes(screen)) {
    toast("返回首页后更新。");
    return;
  }
  app.querySelector<HTMLDialogElement>("dialog[open]")?.close();
  gameUpdater.apply();
}
async function boot(enterNow = false) {
  let startupStage: "saves" | "assets" = "saves";
  try {
    await prepareSaveGeneration();
    settings = loadSettings();
    audio.setSettings(settings);
    progress = await loadProgress();
    saveReady = true;
    startupStage = "assets";
    const loading = $(".boot-loading");
    loading.innerHTML = '<small id="boot-label">正在准备浴室…</small><progress id="boot-progress" max="100" aria-label="游戏加载进度"></progress><small id="boot-detail">正在准备游戏入口</small>';
    if (!enterNow && !import.meta.env.DEV) {
      await preloadGame(value => {
        const percent = value.totalBytes > 0 ? Math.floor(value.loadedBytes / value.totalBytes * 100) : 0;
        $<HTMLProgressElement>("#boot-progress").value = percent;
        $("#boot-detail").textContent = `${percent}% · ${(value.loadedBytes / 1048576).toFixed(1)} / ${(value.totalBytes / 1048576).toFixed(1)} MB`;
      }, () => gameUpdater.check(), "startup");
    }
    applySettings();
    renderHome();
  } catch (error) {
    const loading = app.querySelector<HTMLElement>(".boot-loading");
    if (loading) {
      loading.innerHTML = startupStage === "saves"
        ? '<p id="boot-error"></p><button id="retry-load">重试读取存档</button>'
        : '<p id="boot-error"></p><button id="retry-load">继续准备</button><button id="enter-now">先进入游戏</button>';
      $("#boot-error").textContent = error instanceof Error
        ? error.message
        : startupStage === "saves" ? "存档读取失败，请重试。" : "浴室准备失败，请重试。";
      $("#retry-load").onclick = () => void boot(enterNow);
      const enter = app.querySelector<HTMLButtonElement>("#enter-now");
      if (enter) enter.onclick = () => void boot(true);
    }
  }
}
void boot();
