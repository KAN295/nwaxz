import { Engine } from "@babylonjs/core/Engines/engine.js";
import { Vector3, Color3, Color4 } from "@babylonjs/core/Maths/math.js";
import { DefaultRenderingPipeline } from "@babylonjs/core/PostProcesses/RenderPipeline/Pipelines/defaultRenderingPipeline.js";
import { ImageProcessingConfiguration } from "@babylonjs/core/Materials/imageProcessingConfiguration.js";
import { Viewport } from "@babylonjs/core/Maths/math.viewport.js";
import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture.js";
import { Texture } from "@babylonjs/core/Materials/Textures/texture.js";
import { ShadowGenerator } from "@babylonjs/core/Lights/Shadows/shadowGenerator.js";
import { PointLight } from "@babylonjs/core/Lights/pointLight.js";
import { LoadAssetContainerAsync } from "@babylonjs/core/Loading/sceneLoader.js";
import type { AssetContainer } from "@babylonjs/core/assetContainer.js";
import "@babylonjs/loaders/glTF/2.0/glTFLoader.js";
import "@babylonjs/loaders/glTF/2.0/Extensions/KHR_materials_emissive_strength.js";
import "@babylonjs/core/Lights/Shadows/shadowGeneratorSceneComponent.js";
import { aimCamera, CELL, createEscapeScene } from "./scene.ts";
import { installEscapeModels } from "./models.ts";
import { DOORS, type EscapeWorld } from "./world.ts";
import { EscapeMap } from "./minimap.ts";
import { escapeAssetTimeout, withTimeout } from "../loading.ts";
import { floorAt } from "./basement-map.ts";
import type { CoopPlayer } from "./coop-protocol.ts";
import { PeerActorsRenderer } from "./peers.ts";
import { nativeRenderSize, type SurfaceImages, type SurfaceKind } from "./material-assets.ts";
import { FROG_EXTRA_ART } from "./extra-art.ts";
import type { FrogTextures } from "./frog.ts";
import type { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial.js";

export type EscapeArt = { surfaces: SurfaceImages; map: HTMLImageElement; basement: HTMLImageElement };
export class EscapeRenderer {
  private engine: Engine;
  private view;
  private models?: ReturnType<typeof installEscapeModels>;
  private containers: AssetContainer[] = [];
  private shadow: ShadowGenerator;
  private captureLight: PointLight;
  private height = 1.65;
  private wasHidden = false;
  private wasExpanded?: boolean;
  private disposed = false;
  private map: EscapeMap;
  private peerActors?: PeerActorsRenderer;
  private surfaceTextures: Record<SurfaceKind, Texture>;
  private film: DefaultRenderingPipeline;
  private dread = 0;
  constructor(private canvas: HTMLCanvasElement, art: EscapeArt, private reduced: boolean) {
    this.engine = new Engine(canvas, true, { preserveDrawingBuffer: false, stencil: false, powerPreference: "high-performance" }, false);
    this.view = createEscapeScene(this.engine);
    this.surfaceTextures = Object.fromEntries(Object.entries(art.surfaces).map(([kind, image]) => {
      // Upload the original decoded image directly, with no intermediate resize canvas.
      const texture = new Texture(image.src, this.view.scene, false, true, Texture.TRILINEAR_SAMPLINGMODE, undefined, undefined, image);
      texture.name = `original-surface:${kind}`;
      texture.wrapU = texture.wrapV = Texture.WRAP_ADDRESSMODE;
      texture.anisotropicFilteringLevel = this.engine.getCaps().maxAnisotropy;
      return [kind, texture];
    })) as Record<SurfaceKind, Texture>;
    this.map = new EscapeMap(art.map);
    const beam = new DynamicTexture("soft-flashlight-optics", 128, this.view.scene, false);
    const bc = beam.getContext(), gradient = bc.createRadialGradient(64, 64, 0, 64, 64, 64);
    // A real torch has a hot centre and a long soft falloff, not a disc with an edge.
    gradient.addColorStop(0, "#fffaf0"); gradient.addColorStop(.18, "#f2ede4"); gradient.addColorStop(.4, "#b9b4ab");
    gradient.addColorStop(.62, "#5f5b55"); gradient.addColorStop(.82, "#1c1b19"); gradient.addColorStop(1, "#000000");
    bc.fillStyle = gradient; bc.fillRect(0, 0, 128, 128); beam.update(false);
    this.view.torch.projectionTexture = beam;
    for (const [name, kind] of [["painted-tile", "wall"], ["painted-door", "wood"], ["painted-floor", "floor"], ["painted-ceiling", "ceiling"], ["basement-tile", "basementWall"], ["basement-floor", "basementFloor"], ["basement-ceiling", "basementCeiling"], ["rusty-trim", "rustedIron"]] as const) {
      const material = this.view.scene.getMaterialByName(name);
      if (material && "diffuseTexture" in material) {
        material.diffuseTexture = this.surfaceTextures[kind];
        if ("diffuseColor" in material) (material.diffuseColor as Color3).set(1, 1, 1);
      }
    }
    // The user supplied surfaces 1–9; keep the existing separate story mural.
    const muralSize = art.basement.naturalWidth / 2;
    const mural = new DynamicTexture("existing-basement-secret", muralSize, this.view.scene, true, Texture.TRILINEAR_SAMPLINGMODE);
    mural.getContext().drawImage(art.basement, muralSize, muralSize, muralSize, muralSize, 0, 0, muralSize, muralSize);
    mural.vScale = -1; mural.vOffset = 1; mural.update(false);
    const secret = this.view.scene.getMaterialByName("basement-secret");
    if (secret && "diffuseTexture" in secret) secret.diffuseTexture = mural;
    this.shadow = new ShadowGenerator(512, this.view.torch);
    this.shadow.usePoissonSampling = true; this.shadow.bias = .001; this.shadow.normalBias = .02; this.shadow.setDarkness(.42);
    this.captureLight = new PointLight("capture-laugh-key", Vector3.Zero(), this.view.scene);
    this.captureLight.diffuse = new Color3(.92, .84, .64); this.captureLight.range = 8; this.captureLight.intensity = 10;
    this.captureLight.setEnabled(false);
    this.film = this.createFilmLook();
  }
  /**
   * Camera look: filmic tone mapping, vignette, grain and a touch of lens fringing.
   * One merged image-processing pass plus FXAA and the fringe pass, so it stays cheap.
   */
  private createFilmLook() {
    const film = new DefaultRenderingPipeline("escape-film", false, this.view.scene, [this.view.camera]);
    film.fxaaEnabled = true;
    film.imageProcessingEnabled = true;
    const look = film.imageProcessing;
    look.toneMappingEnabled = true; look.toneMappingType = ImageProcessingConfiguration.TONEMAPPING_ACES;
    look.exposure = 1.6; look.contrast = 1.12;
    look.vignetteEnabled = true; look.vignetteWeight = 1.6; look.vignetteStretch = .5; look.vignetteCameraFov = .7;
    look.vignetteColor = new Color4(0, 0, 0, 0);
    film.grainEnabled = true; film.grain.intensity = 6; film.grain.animated = !this.reduced;
    film.chromaticAberrationEnabled = true; film.chromaticAberration.aberrationAmount = 8; film.chromaticAberration.radialIntensity = 1.2;
    return film;
  }
  /** Danger is felt through the lens: the vignette closes in and reddens, grain thickens. */
  private updateFilm(world: EscapeWorld, dt: number) {
    const d = world.data, chased = world.isPlayerChased, near = Math.hypot(d.hunter.x - d.player.x, d.hunter.z - d.player.z);
    const target = chased ? 1 : near < 4 && d.phase === "playing" ? .45 : 0;
    this.dread += (target - this.dread) * Math.min(1, dt * (target > this.dread ? 3 : 1.2));
    const look = this.film.imageProcessing;
    look.vignetteWeight = 1.6 + this.dread * 2.4;
    look.vignetteColor.set(.28 * this.dread, 0, 0, 0);
    this.film.grain.intensity = 6 + this.dread * 10;
    this.film.chromaticAberration.aberrationAmount = 8 + this.dread * 22;
  }
  get usable() { return !this.disposed && !this.engine._gl?.isContextLost(); }
  setReducedMotion(reduced: boolean) { this.reduced = reduced; this.models?.actor.setReducedMotion(reduced); }
  async load(onStage: (stage: string) => void = () => {}) {
    try {
      const timeout = escapeAssetTimeout();
      onStage("正在摆放浴室里的物件…");
      for (const name of ["escape-props-v1.glb"]) {
        const task = LoadAssetContainerAsync(`/assets/models/${name}`, this.view.scene, { pluginOptions: { gltf: { animationStartMode: 0 } } }).then(container => {
          if (this.disposed) { container.dispose(); throw new Error("场景已关闭"); }
          return container;
        });
        const container = await withTimeout(task, "浴室模型准备超时，请重试。", timeout);
        this.applyPropSurfaces(container);
        this.containers.push(container);
      }
      onStage("奶蛙正在就位…");
      const texture = (url: string, noMipmaps = false) => {
        let image: Texture;
        return withTimeout(new Promise<Texture>((resolve, reject) => {
          image = new Texture(url, this.view.scene, noMipmaps, true, noMipmaps ? Texture.BILINEAR_SAMPLINGMODE : Texture.TRILINEAR_SAMPLINGMODE, () => resolve(image), message => reject(new Error(message || "奶蛙贴图未能载入")));
        }), "奶蛙贴图准备超时，请重试。", timeout);
      };
      const [original, actions, directionIdle, directionWalk] = await Promise.all([texture("/assets/character/haunted-frog-v1.webp"), texture("/assets/character/haunted-frog-actions-v2.webp"), texture("/assets/character/haunted-frog-directions-idle-v1.webp", true), texture("/assets/character/haunted-frog-directions-walk-v1.webp", true)]);
      const extra = Object.fromEntries(await Promise.all(Object.entries(FROG_EXTRA_ART).map(async ([key, art]) => [key, await texture(art.url, true)]))) as Pick<FrogTextures, keyof typeof FROG_EXTRA_ART>;
      if (this.disposed) throw new Error("场景已关闭");
      this.models = installEscapeModels(this.view.scene, this.containers[0], { original, actions, directionIdle, directionWalk, ...extra }, this.reduced);
      for (const mesh of [...this.models.propRoots.values()].flatMap(n => n.getChildMeshes())) this.shadow.addShadowCaster(mesh, false);
      for (const door of this.view.doors.values()) for (const mesh of door.getChildMeshes()) this.shadow.addShadowCaster(mesh, false);
      onStage("正在点亮浴室…");
      await withTimeout(this.view.scene.whenReadyAsync(), "浴室灯光准备超时，请重试。");
    } catch (e) { this.dispose(); throw e; }
  }
  resize(high = false) {
    if (this.disposed) return;
    const rect = this.canvas.getBoundingClientRect(), size = nativeRenderSize(rect.width, rect.height, window.devicePixelRatio);
    this.engine.setSize(size.width, size.height);
    this.shadow.getShadowMap()?.resize(high ? 1024 : 512);
  }
  private applyPropSurfaces(container: AssetContainer) {
    for (const material of container.materials) {
      const kind = material.name.startsWith("wood_") ? "wood" : material.name.startsWith("iron_") ? "rustedIron" : material.name === "pipe_ceramic_old" ? "paintedMetal" : undefined;
      if (!kind || !("albedoTexture" in material)) continue;
      const pbr = material as PBRMaterial;
      pbr.albedoTexture = this.surfaceTextures[kind];
      pbr.albedoColor.setAll(material.name === "wood_interior" ? .2 : 1);
    }
    const fusebox = [...container.transformNodes, ...container.meshes].find(node => node.name === "fusebox");
    for (const mesh of fusebox?.getChildMeshes() ?? []) {
      if (!mesh.material || !["iron_blackened", "iron_worn"].includes(mesh.material.name) || !("albedoTexture" in mesh.material)) continue;
      const painted = mesh.material.clone(`painted-equipment:${mesh.name}`) as PBRMaterial;
      painted.albedoTexture = this.surfaceTextures.paintedMetal;
      painted.albedoColor.setAll(1); painted.metallic = .1; painted.roughness = .85;
      mesh.material = painted;
    }
  }
  draw(world: EscapeWorld, dt = 1 / 60) {
    if (this.disposed || !this.models) return;
    const d = world.data, caught = d.phase === "caught" || d.phase === "lost";
    this.updateFilm(world, dt);
    const expanded = !!d.expansion?.enabled;
    if (expanded !== this.wasExpanded) { for (const shard of this.view.glassMeshes) shard.setEnabled(expanded); this.wasExpanded = expanded; }
    this.models.animate(world, dt);
    const desired = d.hidden ? 1.65 : d.player.crouched ? 1.02 : 1.65;
    if (!!d.hidden !== this.wasHidden) this.height = desired;
    this.wasHidden = !!d.hidden;
    this.height += (desired - this.height) * (1 - Math.exp(-dt * 12));
    aimCamera(this.view, world, this.height);
    for (const door of DOORS) {
      const hinge = this.view.doors.get(door.id)!, target = d.opened.includes(door.id) ? Math.PI * .5 : 0;
      hinge.rotation.y += (target - hinge.rotation.y) * (1 - Math.exp(-dt * 12));
    }
    this.view.corridorLamp.setEnabled(!caught && d.player.z < 18);
    this.view.sewerGlow.setEnabled(!caught && d.player.z >= 18);
    const inBasement = floorAt(d.player) === -1;
    this.view.basementMaintenance.setEnabled(!caught && inBasement);
    this.view.sumpGlow.setEnabled(!caught && inBasement);
    this.view.corridorLamp.intensity = (d.power ? .30 : .15) * (this.reduced ? 1 : .8 + .2 * Math.sin(d.elapsed * 8) ** 14);
    this.captureLight.setEnabled(caught);
    this.view.ambient.intensity = caught ? .5 : inBasement ? .025 : .055;
    this.view.camera.viewport = caught ? this.engine.getRenderWidth() / this.engine.getRenderHeight() > 1.3 ? new Viewport(0, 0, .56, 1) : new Viewport(0, .34, 1, .66) : new Viewport(0, 0, 1, 1);
    if (caught) {
      const actor = this.models.actorRoot, center = actor.position.add(new Vector3(0, 1.05, 0));
      this.view.camera.position.copyFrom(center.add(new Vector3(0, .08, 3.05)));
      this.view.camera.setTarget(center); actor.rotation.y = 0;
      this.view.torch.intensity = 0;
      this.captureLight.position.copyFrom(center.add(new Vector3(-1.2, 1.8, 2)));
    }
    this.engine.beginFrame(); this.view.scene.render(); this.engine.endFrame();
  }
  /** Update remote survivor billboards before draw(world); body sprites keep normal world depth testing. */
  drawPeers(peers: readonly CoopPlayer[], selfId: string, dt = 1 / 60) {
    if (this.disposed) return;
    this.peerActors ??= new PeerActorsRenderer(this.view.scene, this.view.camera);
    this.peerActors.draw(peers, selfId, dt);
  }
  /** Remove all peer meshes when leaving a room or returning to the menu. */
  clearPeers() { this.peerActors?.clear(); }
  drawMap(canvas: HTMLCanvasElement, world: EscapeWorld, compact = false, floor?: 0 | -1) {
    this.map.draw(canvas, world, compact, floor);
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true; this.peerActors?.dispose(); this.peerActors = undefined; this.models?.dispose(); this.shadow.dispose();
    for (const container of this.containers) container.dispose();
    this.view.scene.dispose(); this.engine.dispose();
  }
}
