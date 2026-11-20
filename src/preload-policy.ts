export type PreloadScope = "startup" | "all";
export type ResourceEntry = { url: string; revision?: string | null; integrity?: string; bytes: number; startup?: boolean };
export function entriesForScope<T extends ResourceEntry>(entries: readonly T[], scope: PreloadScope): T[] {
  return scope === "startup" ? entries.filter(entry => entry.startup === true) : [...entries];
}

export function assetTransferURL(url: string, revision?: string | null): string {
  const transfer = new URL(url);
  if (/^\/assets\/.+\.(?:png|webp|mp4|mp3|glb|woff2)$/.test(transfer.pathname) && revision && /^[a-f\d]{32}$/.test(revision)) {
    transfer.searchParams.set("nwaxz_v", revision);
    return transfer.href;
  }
  return url;
}
