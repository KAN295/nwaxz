/** Pure helpers and the isolated world-space renderer for remote co-op survivors. */
import { Color3 } from "@babylonjs/core/Maths/math.js";
import { VertexBuffer } from "@babylonjs/core/Buffers/buffer.js";
import { Constants } from "@babylonjs/core/Engines/constants.js";
import { Material } from "@babylonjs/core/Materials/material.js";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial.js";
import { Texture } from "@babylonjs/core/Materials/Textures/texture.js";
import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture.js";
import { Mesh } from "@babylonjs/core/Meshes/mesh.js";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder.js";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode.js";
import type { FreeCamera } from "@babylonjs/core/Cameras/freeCamera.js";
import type { Scene } from "@babylonjs/core/scene.js";
import type { CoopPlayer } from "./coop-protocol.ts";
import { floorYAt } from "./basement-map.ts";
import { interpolatePeerAngle, peerDirectionForView, peerIsRenderable, peerViewAtlasCell, wrapPeerAngle } from "./peer-art.ts";
import { CELL } from "./scene.ts";
import { raincoatAction, advanceRaincoatPhase, raincoatSheet, type RaincoatAction } from "./raincoat.ts";
import raincoatArt from "./raincoat-frames.json";
const SLOT_COLORS: Record<1 | 2 | 3, string> = { 1: "#bbd4df", 2: "#b9d7bd", 3: "#dfc68d" };
// Painted standing height above the floor, with the eyes near the first-person camera height.
const PEER_HEIGHT = 1.79;
export { interpolatePeerAngle, peerDirectionForView, peerIsRenderable, peerViewAtlasCell, wrapPeerAngle };

type PeerActor = {
  root: TransformNode;
  body: Mesh;
  marker: Mesh;
  bodyMaterial: StandardMaterial;
  frame: number;
  phase: number;
  motion: RaincoatAction;
  markerMaterial: StandardMaterial;
  x: number;
  z: number;
  facing?: number;
  visible: boolean;
};

/** Maintains only remote peer meshes; the existing game actor and world are untouched. */
export class PeerActorsRenderer {
  private actors = new Map<string, PeerActor>();
  private markerMaterials = new Map<1 | 2 | 3, StandardMaterial>();
  private sheets = new Map<RaincoatAction, Texture>();
  private disposed = false;

  constructor(private scene: Scene, private camera: FreeCamera) {}

  draw(peers: readonly CoopPlayer[], selfId: string, dt: number) {
    if (this.disposed) return;
    const live = new Set<string>();
    const delta = Math.max(0, Math.min(.12, Number.isFinite(dt) ? dt : 1 / 60));

    for (const peer of peers) {
      if (!peerIsRenderable(peer, selfId) || !peer.position) {
        const existing = this.actors.get(peer.id);
        if (existing) existing.visible = false;
        continue;
      }
      live.add(peer.id);
      const p = peer.position;
      let actor = this.actors.get(peer.id);
      if (!actor) {
        actor = this.createActor(peer.slot);
        this.actors.set(peer.id, actor);
      }
      const metres = actor.visible ? Math.hypot(p.x - actor.x, p.z - actor.z) * CELL : 0;
      const backwards = (p.x - actor.x) * Math.cos(p.angle) + (p.z - actor.z) * Math.sin(p.angle) < 0;
      const action = raincoatAction(!!p.moving, !!p.crouched, !!p.sprinting);
      if (actor.motion !== action) { actor.phase = 0; actor.motion = action; }
      const travel = metres >= 2 ? 0 : metres * (backwards ? -1 : 1);
      actor.phase = advanceRaincoatPhase(action, actor.phase, travel, delta);
      actor.x = p.x; actor.z = p.z; actor.visible = true;
      actor.root.position.set(p.x * CELL, floorYAt(p), p.z * CELL);
      actor.bodyMaterial.alpha = peer.status === "reconnecting" ? .42 : 1;
      actor.marker.position.y = (p.crouched ? 1.18 : 1.8) + .38;
      actor.markerMaterial.alpha = peer.status === "reconnecting" ? .55 : .96;
      const bearing = Math.atan2(this.camera.position.z - actor.root.position.z, this.camera.position.x - actor.root.position.x);
      const candidate = peerDirectionForView(p.angle, bearing);
      if (actor.facing === undefined || Math.abs(wrapPeerAngle(bearing - p.angle - actor.facing * Math.PI / 4)) > Math.PI / 8 + .07) actor.facing = candidate;
      const desired = this.sheet(action);
      const texture = desired.isReady() ? desired : this.sheet('idle');
      actor.body.setEnabled(texture.isReady());
      if (!texture.isReady()) continue;
      const frame = (texture === desired ? Math.floor(actor.phase * 4) : 0) * 8 + actor.facing;
      if (actor.frame !== frame || actor.bodyMaterial.diffuseTexture !== texture) {
        actor.frame = frame;
        actor.bodyMaterial.diffuseTexture = texture;
        const art = raincoatArt.actions[texture === desired ? action : 'idle'];
        const [x, y, w, h] = art.frames[frame];
        const left = x / art.width, right = (x + w) / art.width;
        const top = 1 - y / art.height, bottom = 1 - (y + h) / art.height;
        const metresPerPixel = PEER_HEIGHT / raincoatArt.referenceHeights[actor.facing];
        actor.body.scaling.set(w * metresPerPixel, h * metresPerPixel, 1);
        actor.body.position.y = (h / 2 - 2) * metresPerPixel;
        actor.body.updateVerticesData(VertexBuffer.UVKind, [left,bottom, right,bottom, right,top, left,top]);
      }
    }

    for (const [id, actor] of this.actors) {
      if (!live.has(id)) {
        this.disposeActor(actor);
        this.actors.delete(id);
      } else actor.root.setEnabled(actor.visible);
    }
  }

  clear() {
    for (const actor of this.actors.values()) this.disposeActor(actor);
    this.actors.clear();
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.clear();
    for (const material of this.markerMaterials.values()) material.dispose(false, true);
    this.markerMaterials.clear();
    for (const texture of this.sheets.values()) texture.dispose();
    this.sheets.clear();
  }

  private createActor(slot: 1 | 2 | 3): PeerActor {
    const root = new TransformNode(`coop-peer-${slot}`, this.scene);
    const body = MeshBuilder.CreatePlane(`coop-peer-body-${slot}`, { width: 1, height: 1, updatable: true }, this.scene);
    body.parent = root;
    body.billboardMode = Mesh.BILLBOARDMODE_Y;
    body.position.y = PEER_HEIGHT * .5;
    body.isPickable = false;
    body.renderingGroupId = 0;
    const bodyMaterial = new StandardMaterial(`coop-peer-body-material-${slot}`, this.scene);
    bodyMaterial.backFaceCulling = false;
    bodyMaterial.useAlphaFromDiffuseTexture = true;
    bodyMaterial.transparencyMode = Material.MATERIAL_ALPHABLEND;
    bodyMaterial.disableDepthWrite = true;
    bodyMaterial.specularColor.set(.035, .035, .03);
    bodyMaterial.ambientColor.set(.16, .15, .12);
    bodyMaterial.emissiveColor.set(.6, .6, .6);
    body.material = bodyMaterial;

    const marker = MeshBuilder.CreatePlane(`coop-peer-slot-${slot}`, { width: .38, height: .38 }, this.scene);
    marker.parent = root;
    marker.billboardMode = Mesh.BILLBOARDMODE_ALL;
    marker.isPickable = false;
    marker.renderingGroupId = 1;
    marker.position.y = PEER_HEIGHT + .38;
    const markerMaterial = this.markerMaterial(slot);
    marker.material = markerMaterial;
    return { root, body, marker, bodyMaterial, markerMaterial, x: 0, z: 0, frame: -1, phase: 0, motion: "idle", visible: false };
  }

  private sheet(action: RaincoatAction): Texture {
    let texture = this.sheets.get(action);
    if (!texture) {
      texture = new Texture(raincoatSheet(action), this.scene, true, true, Texture.BILINEAR_SAMPLINGMODE);
      texture.hasAlpha = true;
      texture.wrapU = texture.wrapV = Texture.CLAMP_ADDRESSMODE;
      this.sheets.set(action, texture);
    }
    return texture;
  }

  private markerMaterial(slot: 1 | 2 | 3) {
    const existing = this.markerMaterials.get(slot);
    if (existing) return existing;
    const color = SLOT_COLORS[slot];
    const texture = new DynamicTexture(`coop-peer-slot-texture-${slot}`, { width: 128, height: 128 }, this.scene, false);
    texture.hasAlpha = true;
    const ctx = texture.getContext() as unknown as CanvasRenderingContext2D;
    const glow = ctx.createRadialGradient(64, 64, 6, 64, 64, 58);
    glow.addColorStop(0, `${color}55`); glow.addColorStop(.48, `${color}24`); glow.addColorStop(1, `${color}00`);
    ctx.fillStyle = glow; ctx.fillRect(0, 0, 128, 128);
    ctx.strokeStyle = color; ctx.lineWidth = 4; ctx.beginPath(); ctx.arc(64, 64, 27, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = "#f5f1df"; ctx.font = "bold 52px Georgia, serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.shadowColor = color; ctx.shadowBlur = 14; ctx.fillText(String(slot), 64, 66);
    texture.update(true);
    const material = new StandardMaterial(`coop-peer-slot-material-${slot}`, this.scene);
    material.diffuseTexture = texture;
    material.emissiveColor = new Color3(.8, .8, .8);
    material.useAlphaFromDiffuseTexture = true;
    material.transparencyMode = Material.MATERIAL_ALPHABLEND;
    material.disableDepthWrite = true;
    material.depthFunction = Constants.ALWAYS;
    material.disableLighting = true;
    material.backFaceCulling = false;
    this.markerMaterials.set(slot, material);
    return material;
  }

  private disposeActor(actor: PeerActor) {
    actor.body.dispose(false, false);
    actor.marker.dispose(false, false);
    actor.root.dispose(false, false);
    actor.bodyMaterial.dispose(false, false);
  }
}
