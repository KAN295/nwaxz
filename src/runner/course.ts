export const SCENE_LENGTH = 450;
export const RIDE_LEAD = 44;
export const RIDE_START = 140;
export const ROPE_LANE_SCALE = .47;
export type RideKind = "rope" | "cart";
export type RideSection = { kind: RideKind; start: number; end: number };

const sectionAt = (distance: number) => Math.floor(Math.max(0, distance) / SCENE_LENGTH);
export const sceneAt = (distance: number, startScene: number) => (sectionAt(distance) + startScene) % 3;

/** The entry and exit use the same distances for the route, input and obstacle generation. */
export function sectionRide(distance: number, startScene: number): RideSection | undefined {
  const theme = sceneAt(distance, startScene);
  if (theme === 1) return undefined;
  const start = sectionAt(distance) * SCENE_LENGTH + RIDE_START;
  return theme === 0 ? { kind: "rope", start, end: start + 54 } : { kind: "cart", start, end: start + 94 };
}

const ease = (value: number) => {
  const t = Math.max(0, Math.min(1, value));
  return t * t * (3 - 2 * t);
};

export function elevationAt(distance: number) {
  const section = sectionAt(distance);
  const at = distance - section * SCENE_LENGTH;
  return (section % 2 ? 8.2 : 6.4) * (ease((at - 45) / 75) - ease((at - 157) / 113));
}

export function ropeHeightAt(distance: number, ride: RideSection) {
  const t = Math.max(0, Math.min(1, (distance - ride.start) / (ride.end - ride.start)));
  const high = elevationAt(ride.start) + 3.1, low = elevationAt(ride.end) + 2.7;
  return high + (low - high) * t - .65 * 4 * t * (1 - t);
}

export function riderHeightAt(distance: number, ride: RideSection, takeoff = 0) {
  const board = ease((distance - ride.start) / 6), land = ease((ride.end - distance) / 9);
  const raised = ride.kind === "cart" ? .48 : ropeHeightAt(distance, ride) - elevationAt(distance) - 1.35;
  return (takeoff * (1 - board) + raised * board) * land;
}

export function rideLateralScale(distance: number, ride?: RideSection) {
  if (ride?.kind !== "rope") return 1;
  const attached = ease((distance - ride.start) / 7) * ease((ride.end - distance) / 7);
  return 1 - (1 - ROPE_LANE_SCALE) * attached;
}
