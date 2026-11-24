import { isFallObstacle, obstacleHalfDepth, type RunnerWorld } from "./world.ts";
import { ROPE_GRAB_DISTANCE, ropeReleaseProgress } from "./course.ts";

export const CAPTURE_GRAB_AT = .38;
export const CAPTURE_LAUGH_AT = 1.03;
export const MINECART_SURPRISE_ART = "/assets/runner/milk-dog-minecart-surprise-v1.webp";

export function captureMotion(time: number, reducedMotion: boolean) {
  const ease = (start: number, end: number) => {
    const progress = Math.max(0, Math.min(1, (time - start) / (end - start)));
    return progress * progress * (3 - 2 * progress);
  };
  const reach = ease(0, CAPTURE_GRAB_AT);
  const lift = ease(CAPTURE_GRAB_AT, .94);
  const settle = ease(.94, 1.19);
  const sway = reducedMotion ? 0 : Math.sin((time - CAPTURE_GRAB_AT) * 10) * lift * .04;
  return {
    reach,
    lift,
    height: .90 * lift - .08 * settle + sway,
    tilt: reducedMotion ? 0 : .23 * lift - .11 * settle + sway,
    orbit: ease(.10, 1.16),
    focus: ease(.08, .43),
  };
}

/** Rear-view walk frames of the haunted frog sheet (4×4), alternating feet. */
export function chaserFrame(world: RunnerWorld, reducedMotion: boolean): number {
  return 4 + (!reducedMotion && Math.floor(world.gait * 2) % 2 ? 8 : 0);
}

/** Dog sheets are 4×2: `run` holds an eight-frame gallop, `actions` holds jump/land/slide poses. */
export function dogPose(world: RunnerWorld, reducedMotion: boolean, falling = false): { sheet: "run" | "actions"; frame: number } {
  const caught = !falling && (world.phase === "lost" || world.phase === "caught" || (world.phase === "paused" && !!world.reason));
  if (caught && world.captureTime >= .15) return { sheet: "actions", frame: world.captureTime < CAPTURE_GRAB_AT ? 3 : 2 };
  if (world.ride?.kind === "rope") {
    const entering = world.distance - world.ride.start < ROPE_GRAB_DISTANCE * .53;
    const release = ropeReleaseProgress(world.distance, world.ride);
    return { sheet: "actions", frame: entering || (release > .16 && release < .62) ? 1 : 2 };
  }
  if (world.ride?.kind === "cart") return { sheet: "actions", frame: 0 };
  if (world.slide > 0 && world.jumpHeight === 0) return { sheet: "actions", frame: 3 };
  if (world.jumpHeight > 0 || world.jump > 0) return { sheet: "actions", frame: world.jump > .2 ? 1 : 2 };
  if (world.elapsed - world.ropeLandedAt < .13) return { sheet: "actions", frame: 2 };
  if (world.cycling) return { sheet: "actions", frame: 1 };
  if (world.stumble > 0) return { sheet: "actions", frame: 2 };
  if (reducedMotion || (!falling && !caught && world.phase !== "running")) return { sheet: "actions", frame: 0 };
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
