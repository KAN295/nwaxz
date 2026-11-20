export const isNativePainting = (pathname: string) => /^\/assets\/(?:scenes|character|materials|versus)\/.+\.png$/.test(pathname);

export const DOWNLOAD_IDLE_MS = 45_000;
export const DOWNLOAD_ATTEMPTS = 3;

/** Stream original bytes. If a binary transfer drops, resume at the last byte received. */
export async function fetchVerifiedAsset(url: string, bytes: number, integrity: string, onProgress: (bytes: number) => void,
  { resumable = false, painting = false, reload = false, fetcher = fetch } = {}): Promise<Response> {
  if (!Number.isSafeInteger(bytes) || bytes <= 0 || bytes > 8 * 1024 * 1024 || !/^sha256-[A-Za-z0-9+/]{43}=$/.test(integrity)) {
    throw new Error("资源清单无效");
  }
  const buffer = new Uint8Array(bytes);
  let received = 0, highWaterMark = 0;
  for (let attempt = 0; ; attempt++) {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const expectProgress = () => {
      clearTimeout(timer);
      timer = setTimeout(() => controller.abort(), DOWNLOAD_IDLE_MS);
    };
    const offset = resumable ? received : 0;
    try {
      expectProgress();
      const response = await fetcher(url, {
        credentials: "same-origin", cache: reload ? "reload" : "default", signal: controller.signal,
        ...(offset > 0 ? { headers: { Range: `bytes=${offset}-${bytes - 1}` } } : {}),
      });
      const headers = new Headers(response.headers);
      if (!response.body || (painting && !/^image\/png(?:;|$)/i.test(headers.get("content-type") ?? ""))) {
        throw new Error("资源响应格式无效");
      }
      if (response.status === 200) received = 0;
      else if (response.status === 206 && offset > 0 && headers.get("content-range") === `bytes ${offset}-${bytes - 1}/${bytes}`) received = offset;
      else throw new Error("资源分段范围无效");
      const reader = response.body.getReader();
      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          if (!value.byteLength) continue;
          if (received + value.byteLength > bytes) throw new Error("资源长度无效");
          buffer.set(value, received);
          received += value.byteLength;
          expectProgress();
          if (received > highWaterMark) { highWaterMark = received; onProgress(received); }
        }
      } finally { reader.releaseLock(); }
      if (received !== bytes) throw new Error("资源下载未完成");
      const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", buffer));
      if (`sha256-${btoa(String.fromCharCode(...digest))}` !== integrity) throw new Error("资源完整性校验失败");
      headers.delete("content-range");
      headers.delete("content-encoding");
      headers.set("content-length", String(bytes));
      return new Response(buffer, { status: 200, headers });
    } catch (error) {
      controller.abort();
      if (attempt + 1 >= DOWNLOAD_ATTEMPTS) throw error;
      if (received === bytes) { received = 0; reload = true; }
    } finally { clearTimeout(timer); }
  }
}
