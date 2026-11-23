export type CurrencyPurse = { silver: number; gold: number; diamond: number };
export type DogLook = { id: string; name: string; description: string; color: string; price: Partial<CurrencyPurse> };
export type DogWardrobe = CurrencyPurse & { owned: string[]; equipped: string };

export const WARDROBE_KEY = "nwaxz-runner-wardrobe-v1";
export const DOG_LOOKS: readonly DogLook[] = [
  { id: "sunny", name: "奶油原色", description: "熟悉的奶狗本色", color: "#ffffff", price: {} },
  { id: "mint", name: "薄荷汽水", description: "清清凉凉的薄荷绿", color: "#b4ffd2", price: { silver: 45 } },
  { id: "sunset", name: "晚霞莓莓", description: "粉橘色的落日光泽", color: "#ffb8a6", price: { gold: 22 } },
  { id: "aurora", name: "极光蓝", description: "夜路上闪闪发亮", color: "#a5dcff", price: { gold: 60 } },
  { id: "nebula", name: "星云紫", description: "稀有钻石色，带星点光晕", color: "#dab4ff", price: { diamond: 3 } },
];

export function readWardrobe(raw: string | null): DogWardrobe {
  const base: DogWardrobe = { silver: 0, gold: 0, diamond: 0, owned: ["sunny"], equipped: "sunny" };
  try {
    const value = JSON.parse(raw ?? "null");
    if (!value || value.version !== 1) return base;
    for (const key of ["silver", "gold", "diamond"] as const) {
      if (!Number.isSafeInteger(value[key]) || value[key] < 0 || value[key] > 1e9) return base;
      base[key] = value[key];
    }
    const owned: string[] = Array.isArray(value.owned) ? [...new Set<string>(value.owned.filter((id: unknown): id is string => typeof id === "string" && DOG_LOOKS.some(look => look.id === id)))] : [];
    if (!owned.includes("sunny")) owned.unshift("sunny");
    base.owned = owned;
    base.equipped = owned.includes(value.equipped) ? value.equipped : "sunny";
    return base;
  } catch { return base; }
}

export function canAfford(wallet: CurrencyPurse, price: Partial<CurrencyPurse>) {
  return (Object.keys(price) as (keyof CurrencyPurse)[]).every(key => wallet[key] >= (price[key] ?? 0));
}
