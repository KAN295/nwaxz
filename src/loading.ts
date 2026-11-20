/** Bound browser loaders that otherwise may never settle after a failed asset. */
export async function withTimeout<T>(task: Promise<T>, message: string, milliseconds = 30000): Promise<T> {
  if (!Number.isFinite(milliseconds)) return task;
  let timer: ReturnType<typeof setTimeout>;
  try {
    return await Promise.race([task, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(message)), milliseconds); })]);
  } finally { clearTimeout(timer!); }
}

/** The active worker owns download timeouts; a browser without one still needs a fallback. */
export function escapeAssetTimeout() {
  return navigator.serviceWorker?.controller ? Infinity : 300_000;
}
export async function loadImage(url: string, milliseconds = 30000) {
  const image = new Image();
  image.src = url;
  await withTimeout(image.decode(), "图片准备失败，请重试。", milliseconds);
  return image;
}
