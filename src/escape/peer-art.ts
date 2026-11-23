/** Shared survivor portrait and sprite atlas metadata for co-op peers. */
import type { CoopPlayer } from "./coop-protocol.ts";
export const PEER_AVATAR_IDS = [0, 1, 2, 3] as const;
export type PeerAvatarId = typeof PEER_AVATAR_IDS[number];

export const PEER_AVATARS = [
  { id: 0, name: "雨衣青年", asset: "/assets/character/escape-survivors-0.webp", accent: "#c8b978" },
  { id: 1, name: "旧浴袍幸存者", asset: "/assets/character/escape-survivors-1.webp", accent: "#d4c8a2" },
  { id: 2, name: "蒙脸维修员", asset: "/assets/character/escape-survivors-2.webp", accent: "#97b2a1" },
  { id: 3, name: "旧制服巡夜人", asset: "/assets/character/escape-survivors-3.webp", accent: "#c3a875" },
] as const;
export const peerAvatarOptions = PEER_AVATARS.map(({ id, name }) => ({ id, label: name }));
export const PEER_PORTRAIT_ATLAS = "/assets/character/escape-survivor-portraits.webp";

/** Atlas order, clockwise from the survivor facing the camera. */
export const PEER_DIRECTIONS = [
  "front", "front-right", "right", "back-right", "back", "back-left", "left", "front-left",
] as const;
export type PeerDirection = typeof PEER_DIRECTIONS[number];

export const PEER_ATLAS_COLUMNS = 4;
export const PEER_ATLAS_ROWS = 2;
export const PEER_ATLAS_TILE_WIDTH = 384;
export const PEER_ATLAS_TILE_HEIGHT = 512;

export function peerAvatarDefinition(avatar: number) {
  return PEER_AVATARS[isPeerAvatarId(avatar) ? avatar : 0];
}

export function isPeerAvatarId(value: number): value is PeerAvatarId {
  return Number.isInteger(value) && value >= 0 && value < PEER_AVATARS.length;
}

/** CSS contract for a square roster portrait, cropped to the matching cell in the 2x2 portrait atlas. */
export function peerAvatarPortraitStyle(avatar: number): { backgroundImage: string; backgroundSize: string; backgroundPosition: string; backgroundRepeat: string } {
  const id = isPeerAvatarId(avatar) ? avatar : 0;
  const position = ["0% 0%", "100% 0%", "0% 100%", "100% 100%"][id];
  return {
    backgroundImage: `url("${PEER_PORTRAIT_ATLAS}")`,
    backgroundSize: "200% 200%",
    backgroundPosition: position,
    backgroundRepeat: "no-repeat",
  };
}

export function peerDirectionCell(direction: number) {
  const index = (Math.trunc(direction) % 8 + 8) % 8;
  return { column: index % PEER_ATLAS_COLUMNS, row: Math.floor(index / PEER_ATLAS_COLUMNS) };
}

const TAU = Math.PI * 2;
const EIGHTH_TURN = Math.PI / 4;

export const wrapPeerAngle = (angle: number) => ((angle + Math.PI) % TAU + TAU) % TAU - Math.PI;

/** Shortest-path angular interpolation; works across the -π/π boundary. */
export function interpolatePeerAngle(from: number, to: number, amount: number) {
  return wrapPeerAngle(from + wrapPeerAngle(to - from) * Math.max(0, Math.min(1, amount)));
}

/** Select a tile from body heading and the angle from the actor toward the viewer. */
export function peerDirectionForView(bodyAngle: number, viewFromAngle: number) {
  const relative = wrapPeerAngle(viewFromAngle - bodyAngle);
  return (Math.round(relative / EIGHTH_TURN) % 8 + 8) % 8;
}

export function peerViewAtlasCell(bodyAngle: number, viewFromAngle: number) {
  return peerDirectionCell(peerDirectionForView(bodyAngle, viewFromAngle));
}

/** Keep self, terminal roster states, invalid avatars and unusable positions out of the 3D scene. */
export function peerIsRenderable(peer: CoopPlayer, selfId: string) {
  return peer.id !== selfId
    && (peer.status === "connected" || peer.status === "reconnecting")
    && isPeerAvatarId(peer.avatar)
    && !!peer.position
    && [peer.position.x, peer.position.z, peer.position.angle].every(Number.isFinite);
}
