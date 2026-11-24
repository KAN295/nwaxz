export const SCENE_LENGTH = 450;
export const RIDE_LEAD = 44;
export const RIDE_START = 140;
export const ROPE_LANE_SCALE = .47;
export const ROPE_GRAB_DISTANCE = 6;
export const ROPE_RELEASE_DISTANCE = 9;
export const BRIDGE_RAVINE_HALF_WIDTH = 5.6;
export const BRIDGE_WATER_Y = -4.7;
export type RideKind = "rope" | "cart";
export type FeatureKind = RideKind | "bridge";
type Section<K extends FeatureKind> = { kind: K; start: number; end: number };
export type RideSection = Section<"rope"> | Section<"cart">;
export type CourseFeature = RideSection | Section<"bridge">;

const sectionAt = (distance: number) => Math.floor(Math.max(0, distance) / SCENE_LENGTH);
export const sceneAt = (distance: number, startScene: number) => (sectionAt(distance) + startScene) % 3;

/** The entry and exit use the same distances for the route, input and obstacle generation. */
export function sectionFeature(distance: number, startScene: number): CourseFeature {
  const theme = sceneAt(distance, startScene);
  const start = sectionAt(distance) * SCENE_LENGTH + RIDE_START;
  if (theme === 0) return { kind: "rope", start, end: start + 54 };
  if (theme === 1) return { kind: "bridge", start, end: start + 46 };
  return { kind: "cart", start, end: start + 94 };
}

const unit = (value: number) => Math.max(0, Math.min(1, value));
const ease = (value: number) => {
  const t = unit(value);
  return t * t * (3 - 2 * t);
};

export function elevationAt(distance: number) {
  const section = sectionAt(distance);
  const at = distance - section * SCENE_LENGTH;
  return (section % 2 ? 8.2 : 6.4) * (ease((at - 45) / 75) - ease((at - 157) / 113));
}

export function ropeHeightAt(distance: number, ride: Section<"rope">) {
  const t = Math.max(0, Math.min(1, (distance - ride.start) / (ride.end - ride.start)));
  const high = elevationAt(ride.start) + 3.1, low = elevationAt(ride.end) + 2.7;
  return high + (low - high) * t - .65 * 4 * t * (1 - t);
}

export function ropeReleaseProgress(distance: number, ride: Section<"rope">) {
  return unit((distance - (ride.end - ROPE_RELEASE_DISTANCE)) / ROPE_RELEASE_DISTANCE);
}

export function riderHeightAt(distance: number, ride: RideSection, takeoff = 0, takeoffGrade = 0) {
  const fromStart = distance - ride.start;
  const board = ease(fromStart / ROPE_GRAB_DISTANCE);
  if (ride.kind === "cart") return (takeoff * (1 - board) + .48 * board) * ease((ride.end - distance) / 9);
  const release = ropeReleaseProgress(distance, ride);
  if (release > 0) {
    const at = ride.end - ROPE_RELEASE_DISTANCE;
    const height = ropeHeightAt(at, ride) - elevationAt(at) - 1.35;
    return height * (1 - release * release);
  }
  const hang = ropeHeightAt(distance, ride) - elevationAt(distance) - 1.35;
  return Math.max(0, (takeoff + takeoffGrade * fromStart) * (1 - board) + hang * board);
}

export function rideLateralScale(distance: number, ride?: RideSection) {
  if (ride?.kind !== "rope") return 1;
  const attached = ease((distance - ride.start) / 7) * ease((ride.end - distance) / 7);
  return 1 - (1 - ROPE_LANE_SCALE) * attached;
}
