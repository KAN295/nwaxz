import type { RunnerWorld } from "./world.ts";

/** Rear-view walk frames of the haunted frog sheet (4×4), alternating feet. */
export function chaserFrame(world: RunnerWorld, reducedMotion: boolean): number {
  return 4 + (!reducedMotion && Math.floor(world.gait * 2) % 2 ? 8 : 0);
}

/** Dog sheets are 4×2: `run` holds an eight-frame gallop, `actions` holds jump/land/slide poses. */
export function dogPose(world: RunnerWorld, reducedMotion: boolean): { sheet: "run" | "actions"; frame: number } {
  if (world.phase === "lost" || world.phase === "caught") return { sheet: "actions", frame: 3 };
  if (world.slide > 0 && world.jumpHeight === 0) return { sheet: "actions", frame: 3 };
  if (world.jumpHeight > 0 || world.jump > 0) return { sheet: "actions", frame: world.jump > .2 ? 1 : 2 };
  if (world.stumble > 0) return { sheet: "actions", frame: 2 };
  if (reducedMotion || world.phase !== "running") return { sheet: "actions", frame: 0 };
  return { sheet: "run", frame: Math.floor(world.gait * 8) % 8 };
}
