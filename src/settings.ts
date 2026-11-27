export type Settings = {
  music: boolean;
  sound: boolean;
  vibration: boolean;
  reducedMotion: boolean;
  quality: "balanced" | "high";
};

const storageKey = "nwaxz-settings";
const keys = ["music", "sound", "vibration", "reducedMotion", "quality"];

export function defaultSettings(): Settings {
  let reducedMotion = false;
  try {
    reducedMotion =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    // Environments without matchMedia use the non-reduced default.
  }
  return {
    music: false,
    sound: true,
    vibration: true,
    reducedMotion,
    quality: "high",
  };
}

export function parseSettings(value: unknown): Settings {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("设置格式不正确");
  const raw = value as Partial<Settings>;
  if (
    Object.keys(raw).some((key) => !keys.includes(key)) ||
    typeof raw.music !== "boolean" ||
    typeof raw.sound !== "boolean" ||
    typeof raw.vibration !== "boolean" ||
    typeof raw.reducedMotion !== "boolean" ||
    (raw.quality !== "balanced" && raw.quality !== "high")
  )
    throw new Error("设置格式不正确");
  return {
    music: raw.music,
    sound: raw.sound,
    vibration: raw.vibration,
    reducedMotion: raw.reducedMotion,
    quality: raw.quality,
  };
}

export function loadSettings(): Settings {
  const fallback = defaultSettings();
  try {
    const stored = localStorage.getItem(storageKey);
    if (stored === null) return fallback;
    return parseSettings(JSON.parse(stored) as unknown);
  } catch {
    return fallback;
  }
}

export function saveSettings(value: Settings): void {
  const settings = parseSettings(value);
  localStorage.setItem(storageKey, JSON.stringify(settings));
}
