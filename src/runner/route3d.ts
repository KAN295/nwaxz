import { elevationAt } from "./course.ts";

/**
 * Maps route distance to a ground position. Straight runs joined by rounded quarter
 * turns; old corners are folded into the base so memory stays bounded.
 */
type Turn = { z: number; direction: "left" | "right" };
type Corner = Turn & { x: number; y: number; heading: number; out: number };
export type RoutePoint = { x: number; y: number; z: number; heading: number };

export const CORNER_RADIUS = 11;

export class RunnerRoute3D {
  private corners: Corner[] = [];
  private base = { z: 0, x: 0, y: 0, heading: 0 };
  /** Bumped whenever a corner is added, so cached geometry along the route can be re-placed. */
  version = 0;

  sync(turns: readonly Turn[], distance: number) {
    for (const turn of [...turns].sort((a, b) => a.z - b.z)) {
      if (turn.z <= this.base.z || this.corners.some(c => c.z === turn.z)) continue;
      const last = this.corners.at(-1);
      const start = last ? { z: last.z, x: last.x, y: last.y, heading: last.out } : this.base;
      const run = turn.z - start.z;
      this.version++;
      this.corners.push({
        ...turn,
        x: start.x + Math.sin(start.heading) * run,
        y: start.y + Math.cos(start.heading) * run,
        heading: start.heading,
        out: start.heading + (turn.direction === "left" ? -1 : 1) * Math.PI / 2,
      });
    }
    while (this.corners.length > 3 && this.corners[1].z < distance - 80) {
      const c = this.corners.shift()!;
      this.base = { z: c.z, x: c.x, y: c.y, heading: c.out };
    }
  }

  sample(distance: number): RoutePoint {
    const r = CORNER_RADIUS;
    let start = this.base;
    for (const c of this.corners) {
      if (distance < c.z - r) break;
      if (distance <= c.z + r) {
        const t = (distance - c.z + r) / (2 * r), angle = t * Math.PI / 2;
        const dx = Math.sin(c.heading), dz = Math.cos(c.heading), ox = Math.sin(c.out), oz = Math.cos(c.out);
        return {
          x: c.x - dx * r + ox * r - ox * r * Math.cos(angle) + dx * r * Math.sin(angle),
          y: elevationAt(distance),
          z: c.y - dz * r + oz * r - oz * r * Math.cos(angle) + dz * r * Math.sin(angle),
          heading: c.heading + (c.out - c.heading) * t,
        };
      }
      start = { z: c.z, x: c.x, y: c.y, heading: c.out };
    }
    return { x: start.x + Math.sin(start.heading) * (distance - start.z), y: elevationAt(distance), z: start.y + Math.cos(start.heading) * (distance - start.z), heading: start.heading };
  }

  /** Where the dog would be if it ignored the corner at `z` and kept running straight. */
  straight(distance: number, z: number): RoutePoint | undefined {
    const c = this.corners.find(c => c.z === z);
    if (!c) return undefined;
    const d = distance - c.z;
    return { x: c.x + Math.sin(c.heading) * d, y: elevationAt(distance), z: c.y + Math.cos(c.heading) * d, heading: c.heading };
  }

  /** Corner position and incoming heading, for drawing the dead-end wall and arrow. */
  corner(z: number) { const c = this.corners.find(c => c.z === z); return c && { x: c.x, z: c.y, heading: c.heading, out: c.out }; }

  get storedCorners() { return this.corners.length; }
}
