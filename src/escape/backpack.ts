import { icon } from "./icons.ts";
import { ITEM_NAMES, PROPS, type EscapeWorld, type Item } from "./world.ts";

/**
 * Backpack (B): everything the player is carrying, grouped into tabs, with a detail pane.
 * Pure markup from world state so it can be rendered for solo and co-op alike.
 */
export type BagTab = "items" | "crystals" | "notes";
export type BagEntry = { id: string; tab: BagTab; name: string; glyph: string; tone: string; count?: number; tag: string; text: string; use?: "freeze" | "reveal" | "ward" };

const ITEM_TEXT: Record<Item, string> = {
  brass: "床头抽屉里找到的旧黄铜钥匙。能打开长廊北侧的档案室。",
  cellar: "档案抽屉里的钥匙。打开东南角的地下检修门，那扇门还需要先恢复供电。",
  fuse: "一根完好的保险丝。装进配电室的配电箱，整栋浴场就能来电。",
  cutters: "沉甸甸的断线钳。能剪开最南侧下水道出口的铁网。",
  handwheel: "生锈的手轮。装到地下检修室的排水阀上才能转动它。",
  relay: "备用继电器。装进负一楼泵房的控制箱，泵房才会通电。",
};
const ITEM_GLYPH: Record<Item, string> = { brass: icon("key"), cellar: icon("key"), fuse: icon("fuse"), cutters: icon("cutters"), handwheel: icon("handwheel"), relay: icon("fuse") };
const CRYSTALS = [
  { use: "freeze", name: "冻结晶", glyph: "❄", tone: "freeze", text: "捏碎后奶蛙原地僵住10秒，不能移动、转身或抓人。适合被追时脱身或从它身边绕过去。", key: "1" },
  { use: "reveal", name: "显形晶", glyph: "◇", tone: "reveal", text: "10秒内能隔着墙看到奶蛙的轮廓，屏幕边缘也会指出它的方向。", key: "2" },
  { use: "ward", name: "净化晶", glyph: "✦", tone: "ward", text: "驱散负一楼的干扰，让仪表重新可信，并在一段时间内保护你不被干扰。", key: "3" },
] as const;

export function bagEntries(world: EscapeWorld): BagEntry[] {
  const d = world.data, entries: BagEntry[] = [];
  for (const item of d.inventory) entries.push({ id: `item:${item}`, tab: "items", name: ITEM_NAMES[item], glyph: ITEM_GLYPH[item], tone: "key", tag: "关键道具", text: ITEM_TEXT[item] });
  if (d.stones > 0) entries.push({ id: "item:stones", tab: "items", name: "石子", glyph: icon("stone"), tone: "plain", count: d.stones, tag: "消耗品", text: "按 Q 扔出去，落地的声响会把还没发现你的奶蛙引过去。已经在追你时就不太管用了。" });
  entries.push({ id: "item:battery", tab: "items", name: "手电", glyph: icon("light"), tone: "plain", count: Math.round(d.player.battery), tag: "装备 · 电量%", text: "按 F 开关。关掉手电能让奶蛙更难看见你，但你也看不清路。值班室能找到备用电池。" });
  for (const crystal of CRYSTALS) {
    const count = world.crystalCharges(crystal.use);
    if (count > 0) entries.push({ id: `crystal:${crystal.use}`, tab: "crystals", name: crystal.name, glyph: crystal.glyph, tone: crystal.tone, count, tag: `晶体 · 快捷键 ${crystal.key}`, text: crystal.text, use: crystal.use });
  }
  for (const id of d.notes) {
    const note = PROPS.find(prop => prop.id === id && prop.kind === "note");
    if (note) entries.push({ id: `note:${id}`, tab: "notes", name: note.name, glyph: "✉", tone: "paper", tag: "纸条", text: note.text ?? "" });
  }
  return entries;
}

const esc = (value: string) => value.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const TABS: [BagTab, string][] = [["items", "物品"], ["crystals", "晶体"], ["notes", "纸条"]];
const EMPTY: Record<BagTab, string> = { items: "还没有找到道具。", crystals: "还没有捡到晶体。发光的晶片就在房间和走廊里。", notes: "还没有找到纸条。纸条里常常藏着线索。" };

export function bagMarkup(world: EscapeWorld, tab: BagTab, selected?: string, coop = false) {
  const entries = bagEntries(world), shown = entries.filter(entry => entry.tab === tab);
  const current = shown.find(entry => entry.id === selected) ?? shown[0];
  const tabs = TABS.map(([id, label]) => `<button class="bag-tab ${id === tab ? "is-active" : ""}" data-bag-tab="${id}" role="tab" aria-selected="${id === tab}">${label}<small>${entries.filter(entry => entry.tab === id).length}</small></button>`).join("");
  const grid = shown.length ? shown.map(entry => `<button class="bag-cell tone-${entry.tone} ${entry === current ? "is-selected" : ""}" data-bag-item="${esc(entry.id)}" aria-label="${esc(entry.name)}"><span class="bag-glyph">${entry.glyph}</span>${entry.count !== undefined ? `<b>${entry.count}</b>` : ""}<em>${esc(entry.name)}</em></button>`).join("") : `<p class="bag-empty">${EMPTY[tab]}</p>`;
  const detail = current ? `<div class="bag-detail-art tone-${current.tone}"><span class="bag-glyph">${current.glyph}</span></div><h3>${esc(current.name)}</h3><p class="bag-tag">${esc(current.tag)}${current.count !== undefined ? ` · ${current.tab === "items" && current.id === "item:battery" ? `${current.count}%` : `×${current.count}`}` : ""}</p><div class="bag-text ${current.tab === "notes" ? "is-note" : ""}">${esc(current.text)}</div>${current.use ? `<button class="escape-primary" data-bag-use="${current.use}" ${coop || world.data.phase === "playing" ? "" : "disabled"}>使用</button>` : ""}` : `<p class="bag-empty">选择左侧的物品查看说明。</p>`;
  return `<div class="bag"><header class="bag-head"><h2>背包</h2><span class="bag-keys"><kbd>B</kbd> 或 <kbd>Esc</kbd> 关闭</span><button class="bag-close" id="escape-bag-close" aria-label="关闭背包">✕</button></header>
    <nav class="bag-tabs" role="tablist">${tabs}</nav>
    <section class="bag-grid" aria-label="${TABS.find(([id]) => id === tab)![1]}">${grid}</section>
    <aside class="bag-detail" aria-live="polite">${detail}</aside></div>`;
}
