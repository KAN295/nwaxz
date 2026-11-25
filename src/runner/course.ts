export const RIDE_LEAD = 44;
export const RIDE_START = 140;
export const ROPE_LANE_SCALE = .47;
export const ROPE_GRAB_DISTANCE = 6;
export const ROPE_RELEASE_DISTANCE = 9;
/** Water level under the broken bridges at forks on solid ground. */
export const BRIDGE_WATER_Y = -4.7;
/** Sea level around the long log bridge; the bridge itself runs level at road height 0. */
export const SEA_Y = -1.7;
/** The log bridge starts this far into its scene and runs this long. */
export const BRIDGE_START = 125;
export const BRIDGE_LENGTH = 290;
/** Corners along the log bridge, in metres from its start. */
export const BRIDGE_TURNS = [80, 170, 255] as const;
export const CART_LENGTH = 210;
/** The canal zipline runs gently over the water; in the canyon and on the snowfield it drops from a high ledge across a gorge. */
export const ROPE_LENGTH = 54;
export const DOWNHILL_ROPE_LENGTH = 70;
/** Water at the bottom of those gorges. */
export const GORGE_Y = -6;
export const GORGE_HALF_WIDTH = 16;
export type RideKind = "rope" | "cart";
export type FeatureKind = RideKind | "bridge";
type Section<K extends FeatureKind> = { kind: K; start: number; end: number };
export type RideSection = Section<"rope"> | Section<"cart">;
export type CourseFeature = RideSection | Section<"bridge">;

/** Scene indices: 0 aqueduct, 1 temple, 2 mine, 3 bamboo, 4 canyon, 5 snow. */
export const SCENE_COUNT = 6;
/** Metres of road each scene lasts. The mine runs longest. */
const SCENE_LENGTHS = [450, 560, 680, 450, 450, 500] as const;
/** One fixed itinerary for every run. Snow comes round once for every two visits to each other scene. */
const ITINERARY = [0, 1, 2, 3, 5, 4, 0, 1, 2, 3, 4] as const;
const LOOP_STARTS = ITINERARY.map((_, i) => ITINERARY.slice(0, i).reduce<number>((sum, scene) => sum + SCENE_LENGTHS[scene], 0));
const LOOP_LENGTH = ITINERARY.reduce<number>((sum, scene) => sum + SCENE_LENGTHS[scene], 0);

/** Index of the scene section (counting from the start of the run) that contains `distance`. */
export function sectionIndexAt(distance: number) {
  const d = Math.max(0, distance), loop = Math.floor(d / LOOP_LENGTH), at = d - loop * LOOP_LENGTH;
  let i = 0;
  while (i < ITINERARY.length - 1 && at >= LOOP_STARTS[i + 1]) i++;
  return loop * ITINERARY.length + i;
}
export const sectionStart = (index: number) => Math.floor(index / ITINERARY.length) * LOOP_LENGTH + LOOP_STARTS[index % ITINERARY.length];
export const sectionScene = (index: number): number => ITINERARY[index % ITINERARY.length];
export const sectionLength = (index: number): number => SCENE_LENGTHS[sectionScene(index)];
export const sceneAt = (distance: number) => sectionScene(sectionIndexAt(distance));

/** The special stretch of a section, if its scene has one. Entry and exit use the same distances for the route, input and obstacles. */
export function featureOf(index: number): CourseFeature | undefined {
  const scene = sectionScene(index), start = sectionStart(index);
  if (scene === 0) return { kind: "rope", start: start + RIDE_START, end: start + RIDE_START + ROPE_LENGTH };
  if (scene === 1) return { kind: "bridge", start: start + BRIDGE_START, end: start + BRIDGE_START + BRIDGE_LENGTH };
  if (scene === 2) return { kind: "cart", start: start + RIDE_START, end: start + RIDE_START + CART_LENGTH };
  if (scene === 4 || scene === 5) return { kind: "rope", start: start + RIDE_START, end: start + RIDE_START + DOWNHILL_ROPE_LENGTH };
  return undefined;
}
/** A zipline that drops from a high ledge across a gorge, rather than crossing the canal. */
export const isDownhillRope = (ride: { kind: string; start: number }) => ride.kind === "rope" && sceneAt(ride.start) !== 0;
export const sectionFeature = (distance: number) => featureOf(sectionIndexAt(distance));

/** First log-bridge corner strictly after `z`. */
export function nextBridgeTurn(z: number) {
  for (let index = sectionIndexAt(z); index <= sectionIndexAt(z) + ITINERARY.length; index++) {
    const feature = featureOf(index);
    if (feature?.kind !== "bridge") continue;
    for (const offset of BRIDGE_TURNS) if (feature.start + offset > z) return feature.start + offset;
  }
  return Infinity;
}

const unit = (value: number) => Math.max(0, Math.min(1, value));
const ease = (value: number) => {
  const t = unit(value);
  return t * t * (3 - 2 * t);
};

/** Per scene: climb from `up` over `upLength` metres, descend from `down` over `downLength`; height alternates by section. */
const HILLS: readonly (readonly [up: number, upLength: number, down: number, downLength: number, low: number, high: number])[] = [
  [45, 75, 157, 113, 6.4, 8.2], // aqueduct: the zipline leaves from the top
  [18, 36, 60, 44, 2.4, 3.2], // temple: a knoll, then the sea crossing runs level
  [45, 75, 157, 113, 0, 0], // mine: level, so the track runs on the cavern floor between the walls
  [40, 70, 150, 110, 5.2, 6.6], // bamboo
  [40, 80, 140, 70, 10, 12], // canyon: up onto a mesa, then the zipline drops all the way down
  [45, 75, 140, 70, 8.5, 10], // snow: up a ridge, then the zipline drops into the valley
];

export function elevationAt(distance: number) {
  const index = sectionIndexAt(distance), at = Math.max(0, distance) - sectionStart(index);
  const [up, upLength, down, downLength, low, high] = HILLS[sectionScene(index)];
  return (index % 2 ? high : low) * (ease((at - up) / upLength) - ease((at - down) / downLength));
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
