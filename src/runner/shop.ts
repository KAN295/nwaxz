import schools from "./qs2027-top-ranked.json" with { type: "json" };

export type CurrencyPurse = { silver: number; gold: number; diamond: number };
export type DogLook = { id: string; rank: string; name: string; color: string; logo: string; source: string; sprite: string; price: Partial<CurrencyPurse> };
export type DogWardrobe = CurrencyPurse & { owned: string[]; equipped: string };

export const WARDROBE_KEY = "nwaxz-runner-skin-shop-v2";
export const LEGACY_WARDROBE_KEY = "nwaxz-runner-wardrobe-v1";
export const ORIGINAL_LOOK = { id: "original", name: "默认奶狗", color: "#ffffff", logo: "" } as const;
export const DOG_LOOKS: readonly DogLook[] = schools.map(school => {
  const rank = Number(school.rank.replace("=", ""));
  const price: Partial<CurrencyPurse> = rank <= 20 ? { diamond: 3 + Math.ceil((21 - rank) / 5) }
    : rank <= 50 ? { gold: 25 + Math.ceil((51 - rank) * 1.5) }
    : rank <= 80 ? { gold: 8 + Math.ceil((81 - rank) / 2) }
    : { silver: 35 + (101 - rank) * 3 };
  return { ...school, sprite: `/assets/runner/qs2027/skins/${school.id}.webp`, price };
});

const empty = (): DogWardrobe => ({ silver: 0, gold: 0, diamond: 0, owned: [ORIGINAL_LOOK.id], equipped: ORIGINAL_LOOK.id });
export function getDogLook(id: string) { return DOG_LOOKS.find(look => look.id === id) ?? ORIGINAL_LOOK; }

export function readWardrobe(raw: string | null): DogWardrobe {
  const base = empty();
  try {
    const value = JSON.parse(raw ?? "null");
    if (!value || value.version !== 2) return base;
    for (const key of ["silver", "gold", "diamond"] as const) {
      if (!Number.isSafeInteger(value[key]) || value[key] < 0 || value[key] > 1e9) return base;
      base[key] = value[key];
    }
    const owned: string[] = Array.isArray(value.owned) ? [...new Set<string>(value.owned.filter((id: unknown): id is string => typeof id === "string" && DOG_LOOKS.some(look => look.id === id)))] : [];
    base.owned = [ORIGINAL_LOOK.id, ...owned];
    base.equipped = base.owned.includes(value.equipped) ? value.equipped : ORIGINAL_LOOK.id;
    return base;
  } catch { return base; }
}

/** Preserve existing coins and refund retired looks once during migration. */
export function migrateLegacyWardrobe(raw: string | null): DogWardrobe {
  const base = empty();
  try {
    const value = JSON.parse(raw ?? "null");
    if (!value || value.version !== 1) return base;
    for (const key of ["silver", "gold", "diamond"] as const) {
      if (!Number.isSafeInteger(value[key]) || value[key] < 0 || value[key] > 1e9) return base;
      base[key] = value[key];
    }
    const old: Record<string, Partial<CurrencyPurse>> = { mint: { silver: 45 }, sunset: { gold: 22 }, aurora: { gold: 60 }, nebula: { diamond: 3 } };
    for (const id of new Set<string>(Array.isArray(value.owned) ? value.owned.filter((item: unknown): item is string => typeof item === "string") : [])) {
      const price = old[id]; if (!price) continue;
      for (const key of ["silver", "gold", "diamond"] as const) base[key] = Math.min(1e9, base[key] + (price[key] ?? 0));
    }
    return base;
  } catch { return base; }
}

export function canAfford(wallet: CurrencyPurse, price: Partial<CurrencyPurse>) {
  return (Object.keys(price) as (keyof CurrencyPurse)[]).every(key => wallet[key] >= (price[key] ?? 0));
}
