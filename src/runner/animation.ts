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
  if (!item || !isFallObstacle(item.kind)) return { forward: 0, drop: 0, roll: 0, tucked: false };
  const time = world.captureTime;
  const coast = Math.min(1, time / .28);
  const room = Math.max(0, item.z + obstacleHalfDepth(item.kind, item.z) - world.distance - .28);
  const forward = Math.min(room, (.42 + world.speed * .012) * coast * (2 - coast));
  const drop = Math.max(.65, -world.fallVelocity) * time + 4.9 * time * time;
  const roll = reducedMotion ? 0 : .95 * (1 - Math.exp(-7 * time));
  return { forward, drop, roll, tucked: time >= .12 };
}
