import type { Vec } from "./world.ts";
import { HUNTER_POLICY_WEIGHTS } from "./hunter-policy-weights.ts";

export const POLICY_INPUTS = 32;
export const POLICY_HIDDEN = 32;
export const DEFAULT_HUNTER_DIFFICULTY = 50;
export function hunterDifficulty(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.min(100, Math.round(value))) : DEFAULT_HUNTER_DIFFICULTY;
}

export const HUNTER_ACTIONS = ["continue", "investigate", "chase", "search"] as const;
export const HUNTER_CUES = ["footsteps", "stone", "glass", "impact", "sight", "glare", "lost"] as const;
export type HunterAction = typeof HUNTER_ACTIONS[number];
export type HunterCue = typeof HUNTER_CUES[number];
export type HunterObservation = {
  cue: HunterCue;
  strength: number;
  exposure: number;
  distance: number;
  difficulty: number;
  occluded?: boolean;
  credible?: boolean;
};
export type HunterOption = { action: HunterAction; point?: Vec; geometry?: readonly number[] };

export function policyFeatures(observation: HunterObservation, option: HunterOption): number[] {
  const { cue, strength, exposure, distance, occluded, credible } = observation;
  const difficulty = (observation.difficulty - DEFAULT_HUNTER_DIFFICULTY) / 50;
  return [
    ...Array.from({ length: 8 }, (_, i) => option.geometry?.[i] ?? 0),
    ...HUNTER_ACTIONS.map(action => Number(option.action === action)),
    ...HUNTER_CUES.map(kind => Number(cue === kind)),
    strength, exposure, distance, difficulty, Number(!!occluded), Number(!!credible), strength * exposure, strength * (1 - distance),
    strength * difficulty, exposure * difficulty, distance * difficulty, strength * Number(!!credible), exposure * Number(cue === "sight"),
  ];
}

export function policyScore(input: readonly number[], weights: readonly number[] = HUNTER_POLICY_WEIGHTS): number {
  const outputOffset = POLICY_HIDDEN * (POLICY_INPUTS + 1);
  let score = weights[outputOffset + POLICY_HIDDEN];
  for (let node = 0; node < POLICY_HIDDEN; node++) {
    const offset = node * (POLICY_INPUTS + 1);
    let activation = weights[offset + POLICY_INPUTS];
    for (let i = 0; i < POLICY_INPUTS; i++) activation += weights[offset + i] * input[i];
    score += Math.max(0, activation) * weights[outputOffset + node];
  }
  return score;
}

export function chooseHunterAction<T extends HunterOption>(observation: HunterObservation, options: readonly T[],
  weights: readonly number[] = HUNTER_POLICY_WEIGHTS): T | undefined {
  let best: T | undefined;
  let bestScore = -Infinity;
  for (const option of options) {
    const score = policyScore(policyFeatures(observation, option), weights);
    if (score > bestScore) { best = option; bestScore = score; }
  }
  return best;
}

export type SearchClue = { last: Vec; from: Vec; observer: Vec; heading?: Vec; movedAt: number };
type SearchCandidate = { point: Vec; features: number[] };
const OFFSETS = [[1, 0], [-1, 0], [0, 1], [0, -1]] as const;
const MAX_STEPS = 5;
const key = (point: Vec) => `${point.x},${point.z}`;

export function searchCandidates(last: Vec, heading: Vec, observer: Vec,
  canStand: (point: Vec) => boolean, canObserve: (from: Vec, point: Vec) => boolean): SearchCandidate[] {
  const start = { x: Math.floor(last.x) + 0.5, z: Math.floor(last.z) + 0.5 };
  if (!canStand(start)) return [];
  const queue = [{ point: start, steps: 0, first: 0 }];
  const visited = new Set([key(start)]);
  for (const item of queue) {
    if (item.steps >= MAX_STEPS) continue;
    for (const [dx, dz] of OFFSETS) {
      const point = { x: item.point.x + dx, z: item.point.z + dz };
      const id = key(point);
      if (visited.has(id) || !canStand(point)) continue;
      visited.add(id);
      queue.push({ point, steps: item.steps + 1, first: item.steps ? item.first : dx * heading.x + dz * heading.z });
    }
  }
  return queue.slice(1).map(({ point, steps, first }) => {
    const dx = point.x - last.x, dz = point.z - last.z;
    const forward = (dx * heading.x + dz * heading.z) / Math.max(0.25, Math.hypot(dx, dz));
    const aroundCover = canObserve(observer, point) ? 0 : 1;
    const stride = steps / MAX_STEPS;
    return {
      point,
      features: [1, forward, first, stride, Math.abs(dx * heading.z - dz * heading.x) / MAX_STEPS,
        aroundCover, forward * stride, first * aroundCover],
    };
  });
}

export function chooseSearchProbe(candidates: SearchCandidate[], difficulty = DEFAULT_HUNTER_DIFFICULTY): Vec | undefined {
  const options = candidates.map(({ point, features }) => ({ action: "search" as const, point, geometry: features }));
  return chooseHunterAction({ cue: "lost", strength: 1, exposure: 0, distance: 0, difficulty }, options)?.point;
}
