import { version } from "../package.json";
import { DOWNLOAD_ATTEMPTS, DOWNLOAD_IDLE_MS } from "./native-preload.ts";

export type PreloadScope = "startup" | "all";
export type PreloadStatus = { version: string; done: number; total: number; loadedBytes: number; totalBytes: number; error: string };
function status(worker: ServiceWorker, repair = false, scope: PreloadScope = "all"): Promise<PreloadStatus | undefined> {
  return new Promise(resolve => {
    const channel = new MessageChannel();
    const finish = (value?: PreloadStatus) => { clearTimeout(timer); channel.port1.close(); resolve(value); };
    const timer = window.setTimeout(() => finish(), 1000);
    channel.port1.onmessage = event => finish(event.data as PreloadStatus);
    try { worker.postMessage({ type: "PREPARE_GAME", repair, scope }, [channel.port2]); }
    catch { finish(); }
  });
}

export async function readPreloadStatus(scope: PreloadScope = "all") {
  const worker = (await navigator.serviceWorker?.getRegistration("/"))?.active;
  if (!worker) return;
  const value = await status(worker, false, scope);
  return value?.version === version ? value : undefined;
}

/** Startup prepares the shell; all is an explicit complete-offline download. */
export async function preloadGame(onProgress: (value: PreloadStatus) => void, retry: () => void = () => {}, scope: PreloadScope = "all", signal?: AbortSignal) {
  if (!("serviceWorker" in navigator) || !("caches" in window)) throw new Error("此浏览器无法预存完整游戏，可重试或直接进入。");
  let lastChange = performance.now(), lastBytes = -1, lastDone = -1;
  let repairRequested: ServiceWorker | undefined, lastRetry = 0;
  for (;;) {
    signal?.throwIfAborted();
    const registration = await navigator.serviceWorker.getRegistration("/");
    const workers = [registration?.installing, registration?.waiting, registration?.active].filter((worker): worker is ServiceWorker => !!worker);
    if (!workers.length && navigator.onLine && performance.now() - lastRetry > 2000) { lastRetry = performance.now(); retry(); }
    for (const worker of workers) {
      const value = await status(worker, false, scope);
      if (!value || value.version !== version) continue;
      if (value.error) {
        if (repairRequested !== worker && worker.state === "activated") { repairRequested = worker; await status(worker, true, scope); continue; }
        throw new Error(value.error);
      }
      onProgress(value);
      if (value.loadedBytes !== lastBytes || value.done !== lastDone) { lastChange = performance.now(); lastBytes = value.loadedBytes; lastDone = value.done; }
      if (worker.state === "activated") {
        if (value.done === value.total && value.total > 0) return;
        if (repairRequested !== worker) { repairRequested = worker; void status(worker, true, scope); }
      }
      // A new page may be waiting for its worker to replace the older controller.
      if (worker.state === "installed") worker.postMessage({ type: "SKIP_WAITING" });
      break;
    }
    const idleLimit = navigator.onLine ? DOWNLOAD_ATTEMPTS * DOWNLOAD_IDLE_MS + 15_000 : 5000;
    if (performance.now() - lastChange > idleLimit && !document.hidden) throw new Error(navigator.onLine ? "下载暂时停住了，请重试。已经保存的资源会继续保留。" : "网络已断开，游戏尚未准备完整。联网后可以继续。");
    if (document.hidden) lastChange = performance.now();
    await new Promise(resolve => setTimeout(resolve, 300));
  }
}
