/**
 * Snapshot interpolation for things the local player does not control (the hunter and
 * teammates). Each actor is drawn a fixed delay in the past, blended between the two
 * received states that bracket that moment, so motion stays continuous between server
 * updates instead of jumping on every snapshot.
 */
export type Pose = { x: number; z: number; angle: number };
type Sample = { at: number; pose: Pose };

const KEEP = 8;
/** Larger jumps are teleports (respawn, capture reset): snap instead of sliding across the map. */
const TELEPORT = 3;
/** Never guess more than this far past the newest state when updates are late. */
const MAX_EXTRAPOLATE_MS = 120;

const wrap = (angle: number) => Math.atan2(Math.sin(angle), Math.cos(angle));
const lerpAngle = (a: number, b: number, t: number) => a + wrap(b - a) * t;

export class PoseBuffer {
  private tracks = new Map<string, Sample[]>();
  readonly delayMs: number;
  constructor(delayMs = 100) { this.delayMs = delayMs; }

  push(id: string, at: number, pose: Pose) {
    let track = this.tracks.get(id);
    if (!track) this.tracks.set(id, track = []);
    const last = track.at(-1);
    if (last && Math.hypot(pose.x - last.pose.x, pose.z - last.pose.z) > TELEPORT) track.length = 0;
    if (last && at <= last.at) track.pop();
    track.push({ at, pose: { ...pose } });
    if (track.length > KEEP) track.splice(0, track.length - KEEP);
  }

  sample(id: string, now: number): Pose | undefined {
    const track = this.tracks.get(id);
    if (!track?.length) return undefined;
    const t = now - this.delayMs;
    if (track.length === 1 || t <= track[0].at) return { ...track[0].pose };
    for (let i = track.length - 1; i > 0; i--) {
      const a = track[i - 1], b = track[i];
      if (t >= a.at && t <= b.at) {
        const k = (t - a.at) / Math.max(1, b.at - a.at);
        return { x: a.pose.x + (b.pose.x - a.pose.x) * k, z: a.pose.z + (b.pose.z - a.pose.z) * k, angle: lerpAngle(a.pose.angle, b.pose.angle, k) };
      }
    }
    // Updates are late: continue along the last known velocity for a short while.
    const a = track.at(-2)!, b = track.at(-1)!;
    const span = Math.max(1, b.at - a.at), ahead = Math.min(MAX_EXTRAPOLATE_MS, t - b.at) / span;
    return { x: b.pose.x + (b.pose.x - a.pose.x) * ahead, z: b.pose.z + (b.pose.z - a.pose.z) * ahead, angle: b.pose.angle };
  }

  /** Forget actors that are no longer in the room. */
  retain(ids: Iterable<string>) {
    const keep = new Set(ids);
    for (const id of this.tracks.keys()) if (!keep.has(id)) this.tracks.delete(id);
  }

  clear() { this.tracks.clear(); }
}
