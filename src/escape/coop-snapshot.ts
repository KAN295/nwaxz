import type { CoopSnapshot } from "./coop-protocol.ts";

type Patch<T> = { set: Partial<T>; clear: (keyof T)[] };
export type CoopSnapshotDelta = {
  base: number;
  snapshot: Patch<Omit<CoopSnapshot, "world">>;
  world: Patch<CoopSnapshot["world"]>;
};

function diff<T extends object>(previous: T, current: T): Patch<T> {
  const set: Partial<T> = {}, clear: (keyof T)[] = [];
  for (const key of Object.keys(current) as (keyof T)[]) {
    if (JSON.stringify(previous[key]) !== JSON.stringify(current[key])) set[key] = current[key];
  }
  for (const key of Object.keys(previous) as (keyof T)[]) {
    if (!Object.hasOwn(current, key)) clear.push(key);
  }
  return { set, clear };
}

function apply<T extends object>(previous: T, patch: Patch<T>): T {
  const next = { ...previous, ...patch.set };
  for (const key of patch.clear) delete next[key];
  return next;
}

export function diffCoopSnapshot(previous: CoopSnapshot, current: CoopSnapshot): CoopSnapshotDelta {
  const { world: previousWorld, ...previousSnapshot } = previous;
  const { world: currentWorld, ...currentSnapshot } = current;
  return { base: previous.revision, snapshot: diff(previousSnapshot, currentSnapshot), world: diff(previousWorld, currentWorld) };
}

export function applyCoopSnapshot(previous: CoopSnapshot | undefined, delta: CoopSnapshotDelta): CoopSnapshot | undefined {
  if (!previous || previous.revision !== delta?.base || !delta.snapshot || !delta.world) return;
  return { ...apply(previous, delta.snapshot), world: apply(previous.world, delta.world) };
}
