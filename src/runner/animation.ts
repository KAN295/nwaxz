import { isFallObstacle, obstacleHalfDepth, type RunnerWorld } from "./world.ts";

/** Rear-view walk frames of the haunted frog sheet (4×4), alternating feet. */
export function chaserFrame(world: RunnerWorld, reducedMotion: boolean): number {
  return 4 + (!reducedMotion && Math.floor(world.gait * 2) % 2 ? 8 : 0);
}

/** Dog sheets are 4×2: `run` holds an eight-frame gallop, `actions` holds jump/land/slide poses. */
export function dogPose(world: RunnerWorld, reducedMotion: boolean, falling = false): { sheet: "run" | "actions"; frame: number } {
  if (!falling && (world.phase === "lost" || world.phase === "caught")) return { sheet: "actions", frame: 3 };
  if (world.slide > 0 && world.jumpHeight === 0) return { sheet: "actions", frame: 3 };
  if (world.jumpHeight > 0 || world.jump > 0) return { sheet: "actions", frame: world.jump > .2 ? 1 : 2 };
  if (world.stumble > 0) return { sheet: "actions", frame: 2 };
  if (reducedMotion || (!falling && world.phase !== "running")) return { sheet: "actions", frame: 0 };
  return { sheet: "run", frame: Math.floor(world.gait * 8) % 8 };
}

export function dogFall(world: RunnerWorld, reducedMotion: boolean) {
  const item = world.fallObstacle;
  if (!item || !isFallObstacle(item.kind)) return { forward: 0, drop: 0, roll: 0, frame: 0 };
  const time = world.captureTime;
  const room = Math.max(0, item.z + obstacleHalfDepth(item.kind, item.z) - world.distance - .38);
  const forward = Math.min(room, (.34 + world.speed * .025) * (1 - Math.exp(-time / .115)));
  const drop = Math.max(.48, -world.fallVelocity) * time + 4.9 * time * time;
  const lead = Math.max(0, -world.fallVelocity - 1) * .022;
  const frame = reducedMotion ? (time < .13 ? 1 : 6) : Math.min(6, Math.floor((time + lead) / .069));
  const roll = reducedMotion ? 0 : .59 * (1 - Math.exp(-4.8 * time)) + .08 * Math.sin(time * 13) * Math.min(1, time * 7);
  return { forward, drop, roll, frame };
}
