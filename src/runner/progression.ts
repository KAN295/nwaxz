/**
 * 奶狗快跑 long-term progress outside a run: power-up upgrades bought with coins, and a reward for
 * coming back each day. Pure functions over small saved records, so they can be tested without a page.
 */
import type { CurrencyPurse } from "./shop.ts";
import { RUN_POWER_SECONDS, type RunPowerKind } from "./world.ts";

export const UPGRADES_KEY = "nwaxz-runner-upgrades-v1";
export const LOGIN_KEY = "nwaxz-runner-login-v1";
/** Power-ups that can be upgraded (the golden apple is too rare to plan around). */
export const UPGRADABLE: readonly Exclude<RunPowerKind, "fruit">[] = ["magnet", "shield", "boost", "slow", "double", "spring", "bike", "balloon"];
export const MAX_LEVEL = 5;
/** Each level adds a fifth of the base duration. */
const STEP = .2;
/** What the next level costs, from level 0 to 1 up to 4 to 5. */
const LEVEL_COSTS: readonly Partial<CurrencyPurse>[] = [{ silver: 60 }, { silver: 150 }, { silver: 320 }, { gold: 12 }, { gold: 30 }];

export type Upgrades = { version: 1; levels: Partial<Record<RunPowerKind, number>> };

export function readUpgrades(raw: string | null): Upgrades {
  const levels: Partial<Record<RunPowerKind, number>> = {};
  try {
    const value = JSON.parse(raw ?? "null");
    if (value?.version !== 1 || typeof value.levels !== "object" || !value.levels) return { version: 1, levels };
    for (const kind of UPGRADABLE) {
      const level = value.levels[kind];
      if (Number.isSafeInteger(level) && level > 0 && level <= MAX_LEVEL) levels[kind] = level;
    }
  } catch { /* A broken record starts from nothing. */ }
  return { version: 1, levels };
}

export const levelOf = (upgrades: Upgrades, kind: RunPowerKind) => upgrades.levels[kind] ?? 0;
/** Seconds a power-up lasts at `level`, rounded to half a second. */
export const durationAt = (kind: RunPowerKind, level: number) => Math.round(RUN_POWER_SECONDS[kind] * (1 + STEP * level) * 2) / 2;
/** Durations for a run, with every upgrade bought. */
export function upgradedDurations(upgrades: Upgrades) {
  const durations: Partial<Record<RunPowerKind, number>> = {};
  for (const kind of UPGRADABLE) durations[kind] = durationAt(kind, levelOf(upgrades, kind));
  return durations;
}
/** The price of the next level, or undefined at the top. */
export const nextCost = (upgrades: Upgrades, kind: RunPowerKind) => LEVEL_COSTS[levelOf(upgrades, kind)];

/** Buys the next level if the wallet allows: the new wallet and upgrades, or undefined. */
export function buyUpgrade<W extends CurrencyPurse>(wallet: W, upgrades: Upgrades, kind: RunPowerKind): { wallet: W; upgrades: Upgrades } | undefined {
  const cost = nextCost(upgrades, kind);
  if (!cost || !UPGRADABLE.includes(kind as Exclude<RunPowerKind, "fruit">)) return undefined;
  const next = { ...wallet };
  for (const key of ["silver", "gold", "diamond"] as const) {
    next[key] -= cost[key] ?? 0;
    if (next[key] < 0) return undefined;
  }
  return { wallet: next, upgrades: { version: 1, levels: { ...upgrades.levels, [kind]: levelOf(upgrades, kind) + 1 } } };
}

// ---------- coming back each day ----------

export type Login = { version: 1; last: string; streak: number };
/** Rewards for the first to seventh day in a row; after a week the streak starts over. */
export const LOGIN_REWARDS: readonly Partial<CurrencyPurse>[] = [{ silver: 30 }, { silver: 50 }, { silver: 80 }, { gold: 3 }, { silver: 120 }, { gold: 6 }, { diamond: 1 }];

/** The local date as YYYY-MM-DD. */
export function dayKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function readLogin(raw: string | null): Login | undefined {
  try {
    const value = JSON.parse(raw ?? "null");
    if (value?.version !== 1 || typeof value.last !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value.last) || !Number.isSafeInteger(value.streak) || value.streak < 1 || value.streak > 7) return undefined;
    return { version: 1, last: value.last, streak: value.streak };
  } catch { return undefined; }
}

/**
 * The first visit of a day: which day of the streak it is and what it pays. Undefined when today was
 * already rewarded. A missed day starts the streak over; so does finishing a week.
 */
export function checkIn(login: Login | undefined, today: Date): { login: Login; day: number; reward: Partial<CurrencyPurse> } | undefined {
  const key = dayKey(today);
  if (login?.last === key) return undefined;
  const yesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1);
  const day = login && login.last === dayKey(yesterday) && login.streak < 7 ? login.streak + 1 : 1;
  return { login: { version: 1, last: key, streak: day }, day, reward: LOGIN_REWARDS[day - 1] };
}

export const CAREER_KEY = "nwaxz-runner-career-v1";
/** Lifetime totals over every run on this device, for the career page. */
export type Career = {
  version: 1; runs: number; metres: number; silver: number; gold: number; diamond: number;
  nearMisses: number; doubleJumps: number; chests: number; revives: number; longest: number; bestScore: number; bestCombo: number;
};
/** What one run adds to the career. */
export type RunSummary = { metres: number; silver: number; gold: number; diamond: number; nearMisses: number; doubleJumps: number; chests: number; revives: number; score: number; combo: number };
const CAREER_FIELDS = ["runs", "metres", "silver", "gold", "diamond", "nearMisses", "doubleJumps", "chests", "revives", "longest", "bestScore", "bestCombo"] as const;

export function readCareer(raw: string | null): Career {
  const career: Career = { version: 1, runs: 0, metres: 0, silver: 0, gold: 0, diamond: 0, nearMisses: 0, doubleJumps: 0, chests: 0, revives: 0, longest: 0, bestScore: 0, bestCombo: 0 };
  try {
    const value = JSON.parse(raw ?? "null");
    if (value?.version === 1) for (const key of CAREER_FIELDS) {
      const n = value[key];
      if (Number.isSafeInteger(n) && n >= 0) career[key] = n;
    }
  } catch { /* A broken record starts again from nothing. */ }
  return career;
}

/**
 * Adds a finished run. A run that was revived and ended again passes what it had already added as
 * `before`, so only the difference counts and it is still one run.
 */
export function addRun(career: Career, run: RunSummary, before?: RunSummary): Career {
  const gain = (key: "silver" | "gold" | "diamond" | "nearMisses" | "doubleJumps" | "chests" | "revives") => Math.max(0, run[key] - (before?.[key] ?? 0));
  const metres = Math.floor(run.metres);
  return {
    version: 1,
    runs: career.runs + (before ? 0 : 1),
    metres: career.metres + Math.max(0, metres - Math.floor(before?.metres ?? 0)),
    silver: career.silver + gain("silver"), gold: career.gold + gain("gold"), diamond: career.diamond + gain("diamond"),
    nearMisses: career.nearMisses + gain("nearMisses"), doubleJumps: career.doubleJumps + gain("doubleJumps"),
    chests: career.chests + gain("chests"), revives: career.revives + gain("revives"),
    longest: Math.max(career.longest, metres), bestScore: Math.max(career.bestScore, run.score), bestCombo: Math.max(career.bestCombo, run.combo),
  };
}

export const GRAPHICS_KEY = "nwaxz-runner-graphics-v1";
/**
 * Picture effects a player can switch off if the game stutters; all on unless turned off.
 * post: tone mapping, bloom and anti-aliasing; shadows: real-time shadows near the dog;
 * volumetric: light shafts from lamps at night and in the mine; wet: wet roads, puddles and ripples in the rain.
 */
export type Graphics = { post: boolean; shadows: boolean; volumetric: boolean; wet: boolean };
export const GRAPHICS_OPTIONS = ["post", "shadows", "volumetric", "wet"] as const;

export function readGraphics(raw: string | null): Graphics {
  const graphics: Graphics = { post: true, shadows: true, volumetric: true, wet: true };
  try {
    const value = JSON.parse(raw ?? "null");
    if (value && typeof value === "object") for (const key of GRAPHICS_OPTIONS) if (typeof value[key] === "boolean") graphics[key] = value[key];
  } catch { /* A broken record keeps everything on. */ }
  return graphics;
}
