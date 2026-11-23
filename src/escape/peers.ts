/** Pure helpers and the isolated world-space renderer for remote co-op survivors. */
import { Color3 } from "@babylonjs/core/Maths/math.js";
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
import { interpolatePeerAngle, peerAvatarDefinition, peerDirectionForView, peerIsRenderable, peerViewAtlasCell, wrapPeerAngle } from "./peer-art.ts";
import { CELL } from "./scene.ts";
const SLOT_COLORS: Record<1 | 2 | 3, string> = { 1: "#bbd4df", 2: "#b9d7bd", 3: "#dfc68d" };
// Avatar artwork has a small transparent margin. Match the 1.65 m first-person eye line.
const PEER_HEIGHT = 1.88;
const PEER_WIDTH = 1.12;
export { interpolatePeerAngle, peerDirectionForView, peerIsRenderable, peerViewAtlasCell, wrapPeerAngle };

type PeerActor = {
  root: TransformNode;
  body: Mesh;
  marker: Mesh;
  bodyMaterial: StandardMaterial;
  atlas?: Texture;
  avatar?: number;
  markerMaterial: StandardMaterial;
  x: number;
  z: number;
  angle: number;
  time: number;
  crouched: boolean;
  moving: boolean;
  visible: boolean;
};

/** Maintains only remote peer meshes; the existing game actor and world are untouched. */
export class PeerActorsRenderer {
  private actors = new Map<string, PeerActor>();
  private markerMaterials = new Map<1 | 2 | 3, StandardMaterial>();
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
      if (actor.avatar !== peer.avatar) this.setAvatar(actor, peer.avatar);
      // The timestamped pose buffer already interpolates this sample.
      actor.x = p.x;
      actor.z = p.z;
      actor.angle = p.angle;
      actor.time += delta;
      actor.crouched = !!p.crouched;
      actor.moving = !!p.moving;
      actor.visible = true;

      const crouchScale = actor.crouched ? .66 : 1;
      const height = PEER_HEIGHT * crouchScale;
      const walkPhase = actor.moving ? actor.time * (p.sprinting ? 12 : 7.5) : 0;
      const bob = actor.moving ? Math.abs(Math.sin(walkPhase)) * (p.sprinting ? .045 : .025) : 0;
      const sway = actor.moving ? Math.sin(walkPhase) * .018 : 0;
      const floorY = floorYAt({ x: actor.x, z: actor.z });
      actor.root.position.set(actor.x * CELL + sway, floorY, actor.z * CELL);
      actor.root.scaling.y = 1;
      actor.body.position.y = PEER_HEIGHT * crouchScale * .5 + bob;
      actor.body.scaling.x = PEER_WIDTH;
      actor.body.scaling.y = height;
      actor.bodyMaterial.alpha = peer.status === "reconnecting" ? .42 : 1;
      actor.marker.position.y = height + .38 + bob;
      actor.markerMaterial.alpha = peer.status === "reconnecting" ? .55 : .96;
      actor.marker.setEnabled(true);
      actor.body.setEnabled(!!actor.atlas && actor.atlas.isReady());
      const viewFromAngle = Math.atan2(this.camera.position.z - actor.root.position.z, this.camera.position.x - actor.root.position.x);
      const cell = peerViewAtlasCell(actor.angle, viewFromAngle);
      if (actor.atlas) {
        actor.atlas.uOffset = cell.column / 4;
        actor.atlas.uScale = .25;
        actor.atlas.vScale = .5;
        actor.atlas.vOffset = cell.row === 0 ? .5 : 0;
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
  }

  private createActor(slot: 1 | 2 | 3): PeerActor {
    const root = new TransformNode(`coop-peer-${slot}`, this.scene);
    const body = MeshBuilder.CreatePlane(`coop-peer-body-${slot}`, { width: 1, height: 1 }, this.scene);
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
    return { root, body, marker, bodyMaterial, markerMaterial, x: 0, z: 0, angle: 0, time: 0, crouched: false, moving: false, visible: false };
  }

  private setAvatar(actor: PeerActor, avatar: number) {
    const definition = peerAvatarDefinition(avatar);
    actor.atlas?.dispose();
    const atlas = new Texture(definition.asset, this.scene, true, true, Texture.BILINEAR_SAMPLINGMODE);
    atlas.hasAlpha = true;
    atlas.uScale = .25;
    atlas.vScale = .5;
    atlas.vOffset = .5;
    actor.atlas = atlas;
    actor.avatar = avatar;
    actor.bodyMaterial.diffuseTexture = atlas;
    actor.bodyMaterial.alpha = 1;
    actor.bodyMaterial.useAlphaFromDiffuseTexture = true;
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
    actor.atlas?.dispose();
  }
}
