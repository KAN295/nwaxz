/**
 * 奶狗快跑 missions: three at a time, each to be done within one run. A finished mission pays its
 * reward straight into the wallet; the next one from the list takes its place from the next run on.
 * The first missions are written out to teach the game; after them they repeat, a little harder each round.
 */
import type { CurrencyPurse } from "./shop.ts";
import type { RunMode } from "./world.ts";

export const MISSIONS_KEY = "nwaxz-runner-missions-v1";
export const MISSION_SLOTS = 3;

export type MissionKind = "distance" | "silver" | "gold" | "near" | "double" | "slide" | "forks" | "rides" | "powers" | "shield" | "multiplier" | "score" | "chase-win" | "chase-time";
export type Mission = { kind: MissionKind; target: number; reward: Partial<CurrencyPurse> };
export type MissionBook = { version: 1; next: number; active: number[]; completed: number };
/** What a run has done so far, as the missions count it. */
export type RunStats = {
  mode: RunMode; distance: number; silver: number; gold: number; score: number; nearMisses: number; doubleJumps: number; slides: number;
  forksCleared: number; ridesDone: number; powers: number; shieldSaves: number; bestMultiplier: number; won: boolean; timeLeft: number;
};

const m = (kind: MissionKind, target: number, reward: Partial<CurrencyPurse>): Mission => ({ kind, target, reward });
/** Written-out missions: they introduce the game one idea at a time. */
const OPENING: readonly Mission[] = [
  m("distance", 500, { silver: 40 }), m("silver", 60, { silver: 40 }), m("near", 3, { silver: 50 }),
  m("double", 5, { silver: 50 }), m("powers", 2, { silver: 60 }), m("forks", 1, { silver: 60 }),
  m("distance", 1000, { gold: 3 }), m("slide", 8, { silver: 60 }), m("rides", 1, { gold: 3 }),
  m("near", 8, { gold: 4 }), m("multiplier", 2, { gold: 4 }), m("chase-win", 1, { diamond: 1 }),
  m("silver", 200, { gold: 5 }), m("distance", 1600, { gold: 5 }), m("score", 30000, { gold: 6 }),
  m("near", 15, { gold: 6 }), m("rides", 2, { gold: 6 }), m("forks", 3, { diamond: 1 }),
  m("shield", 1, { gold: 6 }), m("distance", 2600, { gold: 8 }), m("multiplier", 3, { gold: 8 }),
  m("chase-time", 20, { diamond: 1 }), m("gold", 30, { gold: 10 }), m("distance", 3300, { diamond: 1 }),
];
/** After the opening list: one round of these, each round a step harder. */
const ROUND: readonly ((round: number) => Mission)[] = [
  r => m("distance", 3000 + r * 600, { gold: 8 + r * 2 }),
  r => m("near", 15 + r * 5, { gold: 6 + r * 2 }),
  r => m("silver", 220 + r * 60, { gold: 6 + r * 2 }),
  r => m("score", 40000 + r * 20000, { gold: 8 + r * 2 }),
  r => m("rides", Math.min(8, 2 + r), { gold: 6 + r * 2 }),
  r => m("chase-time", Math.min(45, 15 + r * 5), { diamond: 1 }),
  r => m("multiplier", Math.min(5, 3 + Math.floor(r / 2)), { gold: 8 + r * 2 }),
  r => m("double", 12 + r * 4, { gold: 5 + r * 2 }),
  r => m("gold", 25 + r * 10, { diamond: 1 }),
];

export function missionAt(index: number): Mission {
  if (index < OPENING.length) return OPENING[index];
  const after = index - OPENING.length;
  return ROUND[after % ROUND.length](1 + Math.floor(after / ROUND.length));
}

const freshBook = (): MissionBook => ({ version: 1, next: MISSION_SLOTS, active: [0, 1, 2], completed: 0 });

export function readMissionBook(raw: string | null): MissionBook {
  try {
    const value = JSON.parse(raw ?? "null");
    if (value?.version !== 1 || !Array.isArray(value.active) || value.active.length !== MISSION_SLOTS) return freshBook();
    const whole = (n: unknown): n is number => Number.isSafeInteger(n) && (n as number) >= 0 && (n as number) < 1e6;
    if (!whole(value.next) || !whole(value.completed) || !value.active.every(whole)) return freshBook();
    // Every active mission must have been dealt already, and no mission twice.
    if (new Set(value.active).size !== MISSION_SLOTS || value.active.some((index: number) => index >= value.next)) return freshBook();
    return { version: 1, next: value.next, active: [...value.active], completed: value.completed };
  } catch { return freshBook(); }
}

/** The book after the mission in `slot` is done: the next one in the list takes its place. */
export function completeMission(book: MissionBook, slot: number): MissionBook {
  const active = [...book.active]; active[slot] = book.next;
  return { version: 1, next: book.next + 1, active, completed: book.completed + 1 };
}

/** How far a run has got with a mission, in the mission's own units. Distance missions are endless mode only; the chase ones are the chase only. */
export function missionValue(mission: Mission, s: RunStats) {
  switch (mission.kind) {
    case "distance": return s.mode === "endless" ? Math.floor(s.distance) : 0;
    case "silver": return s.silver;
    case "gold": return s.gold;
    case "near": return s.nearMisses;
    case "double": return s.doubleJumps;
    case "slide": return s.slides;
    case "forks": return s.forksCleared;
    case "rides": return s.ridesDone;
    case "powers": return s.powers;
    case "shield": return s.shieldSaves;
    case "multiplier": return s.bestMultiplier;
    case "score": return s.score;
    case "chase-win": return s.mode === "chase" && s.won ? 1 : 0;
    case "chase-time": return s.mode === "chase" && s.won ? Math.floor(s.timeLeft) : 0;
  }
}
export const missionDone = (mission: Mission, s: RunStats) => missionValue(mission, s) >= mission.target;

export function missionText({ kind, target }: Mission) {
  switch (kind) {
    case "distance": return `无限模式跑满 ${target} 米`;
    case "silver": return `收集 ${target} 枚银币`;
    case "gold": return `收集 ${target} 枚金币`;
    case "near": return `惊险闪避 ${target} 次`;
    case "double": return `二段跳 ${target} 次`;
    case "slide": return `下滑 ${target} 次`;
    case "forks": return target === 1 ? "在岔路口选对一次" : `在岔路口选对 ${target} 次`;
    case "rides": return `完成 ${target} 段滑索、独木桥或矿车`;
    case "powers": return `拾取 ${target} 个道具`;
    case "shield": return target === 1 ? "用护盾挡住一次撞击" : `用护盾挡住 ${target} 次撞击`;
    case "multiplier": return `连续收币达到 ×${target} 倍`;
    case "score": return `单局得分 ${target}`;
    case "chase-win": return "在“夺回金苹果”里追上奶蛙";
    case "chase-time": return `夺回金苹果时还剩 ${target} 秒以上`;
  }
}

export function rewardText(reward: Partial<CurrencyPurse>) {
  const names = { silver: "银币", gold: "金币", diamond: "钻石" } as const;
  return (Object.keys(names) as (keyof CurrencyPurse)[]).filter(key => reward[key]).map(key => `${reward[key]} ${names[key]}`).join(" · ");
}
