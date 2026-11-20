import type { Settings } from "../settings.ts";
import { escapeAssetTimeout, loadImage } from "../loading.ts";
import type { EscapeRenderer, EscapeArt } from "./renderer.ts";
import { EscapeWorld } from "./world.ts";
import { surfacePaths, type SurfaceImages } from "./material-assets.ts";

type Prepared = { canvas: HTMLCanvasElement; renderer: EscapeRenderer; art: EscapeArt };
let prepared: Prepared | undefined;
let pending: Promise<void> | undefined;
let parking: HTMLDivElement | undefined;
function park(bundle: Prepared) {
  parking ??= document.createElement("div");
  parking.setAttribute("aria-hidden", "true");
  parking.style.cssText = "position:fixed;left:-200vw;top:0;width:100vw;height:100vh;pointer-events:none;visibility:hidden";
  bundle.canvas.style.cssText = "width:100%;height:100%;display:block";
  bundle.canvas.removeAttribute("id");
  parking.replaceChildren(bundle.canvas);
  document.body.append(parking);
}
export function takePreparedEscape(): Prepared | undefined {
  const bundle = prepared;
  prepared = undefined;
  if (!bundle) return;
  if (!bundle.renderer.usable) { bundle.renderer.dispose(); bundle.canvas.remove(); return; }
  return bundle;
}
export function returnPreparedEscape(bundle: Prepared) {
  if (!bundle.renderer.usable) { bundle.renderer.dispose(); bundle.canvas.remove(); return; }
  prepared?.renderer.dispose(); prepared = bundle; park(bundle);
}
export async function prepareEscape(settings: Settings, onStage: (stage: string) => void = () => {}) {
  if (prepared?.renderer.usable) { prepared.renderer.setReducedMotion(settings.reducedMotion); return; }
  if (pending) return pending;
  prepared?.renderer.dispose(); prepared = undefined;
  pending = (async () => {
    onStage("正在准备浴场…");
    const { EscapeRenderer } = await import("./renderer.ts");
    onStage("正在铺好浴室地图…");
    let readySurfaces = 0;
    const surfaceEntries = Object.entries(surfacePaths);
    const timeout = escapeAssetTimeout();
    const [surfaces, map, basement] = await Promise.all([
      Promise.all(surfaceEntries.map(async ([kind, path]) => {
        const image = await loadImage(path, timeout);
        onStage(`正在铺好浴室地图… ${++readySurfaces} / ${surfaceEntries.length}`);
        return [kind, image] as const;
      })).then(entries => Object.fromEntries(entries) as SurfaceImages),
      loadImage("/assets/ui/escape-map-atlas-v1.webp", timeout), loadImage("/assets/scenes/escape-basement-atlas-v1.webp", timeout),
    ]);
    const canvas = document.createElement("canvas"), art = { surfaces, map, basement };
    // Keep one mounted canvas: swapping a WebGL context to another canvas is impossible.
    parking ??= document.createElement("div");
    parking.style.cssText = "position:fixed;left:-200vw;top:0;width:100vw;height:100vh;pointer-events:none;visibility:hidden";
    canvas.style.cssText = "width:100%;height:100%;display:block";
    parking.replaceChildren(canvas); document.body.append(parking);
    let renderer: EscapeRenderer | undefined;
    try {
      renderer = new EscapeRenderer(canvas, art, settings.reducedMotion);
      await renderer.load(onStage);
      renderer.resize(settings.quality === "high");
      renderer.draw(new EscapeWorld());
      prepared = { canvas, renderer, art }; park(prepared);
    } catch (error) {
      renderer?.dispose(); canvas.remove();
      if (error instanceof Error && /超时|图片|奶蛙/.test(error.message)) throw error;
      throw new Error("三维浴场暂时未能准备好，可以重试或先进入其他模式。");
    }
  })().finally(() => { pending = undefined; });
  return pending;
}
