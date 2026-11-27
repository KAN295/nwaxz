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
