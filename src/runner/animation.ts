import type { RunnerWorld } from "./world.ts";

export function chaserFrame(world: RunnerWorld, reducedMotion: boolean): number {
  return 4 + (!reducedMotion && Math.floor(world.gait*2)%2 ? 8 : 0);
}

/** The eight drawings are successive canine support/suspension phases, not a bobbed still. */
export function dogPose(world: RunnerWorld, reducedMotion: boolean): { sheet: "run" | "actions"; frame: number } {
  if (world.phase === "lost"||world.phase === "caught") return { sheet: "actions", frame: 5 };
  if (world.slide > 0) return { sheet: "actions", frame: 3 };
  if (world.jump > 0) return { sheet: "actions", frame: world.jump > .2 ? 1 : 2 };
  if (world.stumble > 0) return { sheet: "actions", frame: 2 };
  if (reducedMotion || world.phase !== "running") return { sheet: "actions", frame: 0 };
  return { sheet: "run", frame: Math.floor(world.gait * 8) % 8 };
}
