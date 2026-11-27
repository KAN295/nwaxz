import { elevationAt } from "./course.ts";

/**
 * Maps route distance to a ground position. Straight runs joined by smooth quarter turns; old
 * corners are folded into the base so memory stays bounded.
 *
 * A bend is measured along its own length, so the dog keeps the same speed through it (a corner cut
 * short by an arc used to slow it down for the length of the turn), and its heading eases in and out,
 * so the turn starts and ends without a jolt. Because a bend is shorter than the two sharp-corner legs
 * it replaces, the route runs BEND_SLACK metres further along each straight than the distance alone
 * would put it from the corner point.
 */
type Turn = { z: number; direction: "left" | "right" };
/** A corner: where its straights would meet (x, y), and the headings into and out of it. */
type Corner = Turn & { x: number; y: number; heading: number; out: number };
export type RoutePoint = { x: number; y: number; z: number; heading: number };

/** The bend leaves each straight this far from the corner point. */
export const CORNER_RADIUS = 11;
const ease = (u: number) => u * u * (3 - 2 * u);
const STEPS = 64;
/** Forward and sideways offsets along a bend one metre long, from where it leaves the straight. */
const SHAPE = (() => {
  const fine = 60, forward = [0], side = [0];
  let f = 0, s = 0;
  for (let i = 0; i < STEPS * fine; i++) {
    const angle = Math.PI / 2 * ease((i + .5) / (STEPS * fine));
    f += Math.cos(angle) / (STEPS * fine); s += Math.sin(angle) / (STEPS * fine);
    if ((i + 1) % fine === 0) { forward.push(f); side.push(s); }
  }
  return { forward, side };
})();
/** Length of a bend along its curve. */
export const BEND_LENGTH = CORNER_RADIUS / SHAPE.forward[STEPS];
const HALF = BEND_LENGTH / 2;
/** How much further along each straight the route runs than a sharp corner at the same distance. */
export const BEND_SLACK = CORNER_RADIUS - HALF;

/** Point on the bend at a corner, turning toward `out`. */
function bend(c: Corner, out: number, distance: number): RoutePoint {
  const u = Math.max(0, Math.min(1, (distance - c.z + HALF) / BEND_LENGTH));
  const k = u * STEPS, i = Math.min(STEPS - 1, Math.floor(k)), t = k - i;
  const forward = (SHAPE.forward[i] + (SHAPE.forward[i + 1] - SHAPE.forward[i]) * t) * BEND_LENGTH;
  // Scaled so the bend ends exactly CORNER_RADIUS to the side, on the outgoing straight.
  const side = (SHAPE.side[i] + (SHAPE.side[i + 1] - SHAPE.side[i]) * t) / SHAPE.side[STEPS] * CORNER_RADIUS * Math.sign(out - c.heading);
  const hx = Math.sin(c.heading), hz = Math.cos(c.heading), rx = Math.cos(c.heading), rz = -Math.sin(c.heading);
  return {
    x: c.x + hx * (forward - CORNER_RADIUS) + rx * side,
    y: elevationAt(distance),
    z: c.y + hz * (forward - CORNER_RADIUS) + rz * side,
    heading: c.heading + (out - c.heading) * ease(u),
  };
}

export class RunnerRoute3D {
  private corners: Corner[] = [];
  /** A point on a straight: its distance, position and heading. */
  private base = { z: 0, x: 0, y: 0, heading: 0 };
  /** Bumped whenever a corner is added, so cached geometry along the route can be re-placed. */
  version = 0;

  sync(turns: readonly Turn[], distance: number) {
    // Turns are made in order along the road, so the usual case needs no sorted copy every frame.
    let ordered = true;
    for (let i = 1; i < turns.length && ordered; i++) ordered = turns[i].z >= turns[i - 1].z;
    for (const turn of ordered ? turns : [...turns].sort((a, b) => a.z - b.z)) {
      if (turn.z <= this.base.z || this.corners.some(c => c.z === turn.z)) continue;
      const last = this.corners.at(-1);
      const start = last ? this.after(last) : this.base;
      // Along the straight to where the bend starts, then on to the corner point.
      const run = turn.z - HALF - start.z + CORNER_RADIUS;
      this.version++;
      this.corners.push({
        ...turn,
        x: start.x + Math.sin(start.heading) * run,
        y: start.y + Math.cos(start.heading) * run,
        heading: start.heading,
        out: start.heading + (turn.direction === "left" ? -1 : 1) * Math.PI / 2,
      });
    }
    while (this.corners.length > 3 && this.corners[1].z < distance - 80) this.base = this.after(this.corners.shift()!);
  }

  /** Where a corner's bend ends, on its outgoing straight. */
  private after(c: Corner) {
    return { z: c.z + HALF, x: c.x + Math.sin(c.out) * CORNER_RADIUS, y: c.y + Math.cos(c.out) * CORNER_RADIUS, heading: c.out };
  }

  sample(distance: number): RoutePoint {
    let start = this.base;
    for (const c of this.corners) {
      if (distance < c.z - HALF) break;
      if (distance <= c.z + HALF) return bend(c, c.out, distance);
      start = this.after(c);
    }
    return { x: start.x + Math.sin(start.heading) * (distance - start.z), y: elevationAt(distance), z: start.y + Math.cos(start.heading) * (distance - start.z), heading: start.heading };
  }

  /** Where the dog runs after taking the other side of the fork at `z` (straight in, round the bend, straight out). */
  branch(distance: number, z: number, direction: "left" | "right"): RoutePoint | undefined {
    const c = this.corners.find(corner => corner.z === z);
    if (!c) return undefined;
    if (distance < z - HALF) return this.straight(distance, z);
    const out = c.heading + (direction === "left" ? -1 : 1) * Math.PI / 2;
    if (distance <= z + HALF) return bend(c, out, distance);
    const along = distance - z + BEND_SLACK;
    return { x: c.x + Math.sin(out) * along, y: elevationAt(distance), z: c.y + Math.cos(out) * along, heading: out };
  }

  /** Where the dog would be if it ignored the corner at `z` and kept running straight. */
  straight(distance: number, z: number): RoutePoint | undefined {
    const c = this.corners.find(corner => corner.z === z);
    if (!c) return undefined;
    const along = distance - z - BEND_SLACK;
    return { x: c.x + Math.sin(c.heading) * along, y: elevationAt(distance), z: c.y + Math.cos(c.heading) * along, heading: c.heading };
  }

  /** How fast the heading turns at `distance`, in radians per metre (positive to the right). */
  turnRate(distance: number) {
    const c = this.corners.find(corner => Math.abs(distance - corner.z) < HALF);
    if (!c) return 0;
    const u = (distance - c.z + HALF) / BEND_LENGTH;
    return (c.out - c.heading) * 6 * u * (1 - u) / BEND_LENGTH;
  }

  /** Corner position and incoming heading, for drawing the dead-end wall and arrow. */
  corner(z: number) { const c = this.corners.find(c => c.z === z); return c && { x: c.x, z: c.y, heading: c.heading, out: c.out }; }

  get storedCorners() { return this.corners.length; }
}
