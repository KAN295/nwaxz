/// <reference lib="webworker" />
import type { WorkboxPlugin } from "workbox-core/types.js";
import { cleanupOutdatedCaches, PrecacheController } from "workbox-precaching";
import { RangeRequestsPlugin } from "workbox-range-requests";
import { NavigationRoute, registerRoute } from "workbox-routing";
import { version } from "../package.json";
import { fetchVerifiedAsset, isNativePainting } from "./native-preload.ts";
import { assetTransferURL, entriesForScope, type ResourceEntry, type PreloadScope } from "./preload-policy.ts";

declare const self: ServiceWorkerGlobalScope;
const manifest = self.__WB_MANIFEST as ResourceEntry[];
const receiving = new Map<string, number>();
const failures = new Map<PreloadScope, string>();
const preparing = new Map<PreloadScope, Promise<void>>();
const downloads = new Map<string, Promise<Response>>();
let activeDownloads = 0;
const downloadQueue: (() => void)[] = [];
const legacyLoaders = new Set<string>();
async function reloadLegacyLoaders() {
  for (const id of [...legacyLoaders]) {
    legacyLoaders.delete(id);
    const client = await self.clients.get(id);
    if (client?.type === "window" && new URL(client.url).origin === self.location.origin) await (client as WindowClient).navigate(client.url).catch(() => null);
  }
}
async function downloadSlot() {
  if (activeDownloads < 3) activeDownloads++;
  else await new Promise<void>(resolve => downloadQueue.push(resolve));
  return () => { const next = downloadQueue.shift(); if (next) next(); else activeDownloads--; };
}
const progress: WorkboxPlugin = {
  fetchDidSucceed: async ({ request, response, event }) => {
    if (response.ok && response.body) {
      const reader = response.clone().body!.getReader(); receiving.set(request.url, 0);
      event.waitUntil((async () => {
        try { for (;;) { const { done, value } = await reader.read(); if (done) break; receiving.set(request.url, (receiving.get(request.url) ?? 0) + value.byteLength); } }
        catch { receiving.delete(request.url); }
      })());
    }
    return response;
  },
};
const precache = new PrecacheController({ plugins: [new RangeRequestsPlugin(), progress] });
precache.addToCacheList(manifest);
const absolute = (entry: ResourceEntry) => new URL(entry.url, self.location.href).href;
const byURL = new Map(manifest.map(entry => [absolute(entry), entry]));

async function download(entry: ResourceEntry): Promise<Response> {
  const url = absolute(entry), cacheKey = precache.getCacheKeyForURL(url)!;
  const cache = await caches.open(precache.strategy.cacheName), cached = await cache.match(cacheKey);
  if (cached) return cached;
  let task = downloads.get(url);
  if (!task) {
    task = (async () => {
      const release = await downloadSlot();
      try {
        if (!entry.integrity) throw new Error("资源缺少完整性记录");
        const transfer = assetTransferURL(url, entry.revision);
        const response = await fetchVerifiedAsset(transfer, entry.bytes, entry.integrity, loaded => receiving.set(url, loaded),
          { resumable: transfer !== url, painting: isNativePainting(new URL(url).pathname), reload: transfer === url && cacheKey !== url });
      await cache.put(cacheKey, response.clone()); return response;
      } finally { release(); }
    })().finally(() => { downloads.delete(url); receiving.delete(url); });
    downloads.set(url, task);
  }
  return (await task).clone();
}
// Uncached movies can stream immediately. A partial 206 must never be saved as a whole offline movie.
registerRoute(({ url, request }) => /\.(?:mp4|mp3)$/.test(url.pathname) && byURL.has(url.origin + url.pathname) &&
  (request.headers.has("range") || request.destination === "video" || request.destination === "audio"),
  async ({ url, request, event }) => {
    const original = url.origin + url.pathname, entry = byURL.get(original)!;
    const key = precache.getCacheKeyForURL(original)!;
    if (await precache.matchPrecache(original)) return precache.strategy.handle({ event, request, params: { cacheKey: key } });
    return fetch(new Request(assetTransferURL(original, entry.revision), request));
  });
// Whole binary assets are shared by online play and offline preparation.
registerRoute(({ url, request }) => {
  if (request.headers.has("range")) return false;
  const original = url.origin + url.pathname, entry = byURL.get(original);
  return !!entry && assetTransferURL(original, entry.revision) !== original;
}, ({ url }) => download(byURL.get(url.origin + url.pathname)!));
// Browser <img> requests default to no-cors. Convert our own same-origin assets so
// Workbox verifies SRI and saves them on their first use, not only during install.
registerRoute(({ url }) => byURL.has(url.origin + url.pathname), ({ url, request, event }) => {
  const key = precache.getCacheKeyForURL(url.origin + url.pathname)!;
  return precache.strategy.handle({ event, request: new Request(request, { mode: "same-origin" }),
    params: { cacheKey: key, integrity: precache.getIntegrityForCacheKey(key) } });
});
registerRoute(new NavigationRoute(precache.createHandlerBoundToURL("index.html"), { denylist: [/^\/api\//, /^\/game-worker/] }));
cleanupOutdatedCaches();

function prepare(scope: PreloadScope) {
  let task = preparing.get(scope);
  if (!task) {
    failures.delete(scope);
    task = (async () => {
      const entries = entriesForScope(manifest, scope); let next = 0, failed = false;
      await Promise.all(Array.from({ length: scope === "startup" ? 3 : 2 }, async () => {
        try { while (next < entries.length && !failed) {
          await download(entries[next++]);
        } } catch (error) { failed = true; throw error; }
      }));
    })().catch(error => { failures.set(scope, "资源未能保存，请检查网络和设备存储空间。"); throw error; }).finally(() => preparing.delete(scope));
    preparing.set(scope, task);
  }
  return task;
}
// Installation must not depend on unrelated modes, high-resolution actors or all five movies.
self.addEventListener("install", event => { event.waitUntil(prepare("startup")); });
self.addEventListener("activate", event => { event.waitUntil((async () => { await precache.activate(event); await self.clients.claim(); await reloadLegacyLoaders(); })()); });
self.addEventListener("message", event => {
  if (event.data?.type === "SKIP_WAITING") { void self.skipWaiting(); return; }
  if (event.data?.type !== "PREPARE_GAME") return;
  // Pre-0.31 clients only send this scope-less request while stuck on their boot
  // screen. Upgrade that caller after the small shell is ready, never navigate
  // other open games. Current clients always include an explicit scope.
  if (event.data.scope === undefined && event.source && "id" in event.source) {
    legacyLoaders.add(event.source.id);
    event.waitUntil((async () => {
      await prepare("startup"); await self.skipWaiting();
      try { await self.clients.claim(); } catch { return; } // Activation will finish the handoff.
      await reloadLegacyLoaders();
    })().catch(() => {}));
  }
  const scope: PreloadScope = event.data.scope === "startup" ? "startup" : "all";
  if (event.data.repair) event.waitUntil(prepare(scope).catch(() => {}));
  event.waitUntil((async () => {
    const cache = await caches.open(precache.strategy.cacheName);
    const present = new Set((await cache.keys()).map(request => request.url));
    let done = 0, loadedBytes = 0, totalBytes = 0;
    for (const entry of entriesForScope(manifest, scope)) {
      const url = absolute(entry), ready = present.has(precache.getCacheKeyForURL(url)!);
      totalBytes += entry.bytes;
      if (ready) { done++; loadedBytes += entry.bytes; }
      else loadedBytes += Math.min(entry.bytes, receiving.get(url) ?? 0);
    }
    event.ports[0]?.postMessage({ version, scope, done, total: entriesForScope(manifest, scope).length, loadedBytes, totalBytes, error: failures.get(scope) ?? "" });
  })());
});
