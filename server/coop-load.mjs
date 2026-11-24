import packageInfo from "../package.json" with { type: "json" };
import { CoopService } from "./coop-service.mjs";
import { MAP } from "../src/escape/world.ts";
import { diffCoopSnapshot } from "../src/escape/coop-snapshot.ts";

const STEP_MS = 50, WARMUP_TICKS = 100, SAMPLE_TICKS = 400;
const makeResponse = () => ({
  writableEnded: false, writableLength: 0, bytes: 0, fullBytes: 0, snapshots: 0,
  status() { return this; }, set() { return this; }, flushHeaders() {}, on() {},
  write(chunk) { if (chunk.startsWith("event: snapshot")) { this.bytes += Buffer.byteLength(chunk); this.snapshots++; } return true; },
  sendSnapshot(data) {
    const full = JSON.stringify({ type: "snapshot", data });
    const current = JSON.parse(full).data, previous = this.previous;
    const wire = previous?.viewPlayerId === current.viewPlayerId && previous.room.phase === current.room.phase
      ? JSON.stringify({ type: "snapshot-delta", data: diffCoopSnapshot(previous, current) }) : full;
    this.previous = current;
    this.fullBytes += Buffer.byteLength(full);
    this.bytes += Buffer.byteLength(wire);
    this.snapshots++;
  },
  end() { this.writableEnded = true; },
});

const legalFloorTiles = MAP.flatMap((row, z) => row.flatMap((cell, x) => cell === 0 ? [z * row.length + x] : []));
const FULL_EXPLORATION_TILES = legalFloorTiles.length;

function runScenario(roomCount, fullExploration = false) {
  let now = 1_000_000;
  const service = new CoopService({ now: () => now, maxRooms: 8, autoTick: false });
  const rooms = [], sessions = [];
  try {
    global.gc?.();
    const heapBeforeRooms = process.memoryUsage().heapUsed;
    for (let roomIndex = 0; roomIndex < roomCount; roomIndex++) {
      const first = service.create({ version: packageInfo.version, name: `Host${roomIndex}`, avatar: 0 }, `load-${roomIndex}`);
      const roster = [first];
      for (let slot = 1; slot < 3; slot++) roster.push(service.join({ version: packageInfo.version, code: first.code, name: `P${slot}`, avatar: slot }, `load-${roomIndex}`));
      for (const session of roster) service.setReady(first.code, session.token, true);
      service.start(first.code, { id: first.playerId, token: first.token });
      const room = service.rooms.get(first.code); rooms.push(room);
      if (fullExploration) {
        for (const player of room.players.values()) player.actorWorld.data.explored = legalFloorTiles;
      }
      for (const session of roster) {
        const player = service.findPlayer(room, session.token), response = makeResponse();
        service.attachStream(room, player, response); sessions.push({ room, player, response, seq: 0, slot: player.slot });
      }
    }
    global.gc?.();
    const heapAfterRooms = process.memoryUsage().heapUsed;
    const totalTicks = WARMUP_TICKS + SAMPLE_TICKS;
    let cpuStart, heapStart;
    let activeTicks = 0, snapshotBytes = 0, fullSnapshotBytes = 0, snapshotCount = 0;
    for (let tick = 1; tick <= totalTicks; tick++) {
      now += STEP_MS;
      if (tick % 2 === 0) for (const item of sessions) {
        if (item.player.status !== "connected") continue;
        const angle = ((tick / 2 + item.slot * 5) % 24) / 24 * Math.PI * 2 - Math.PI;
        service.input(item.room.code, item.player.token, {
          seq: ++item.seq,
          move: { forward: Math.sin(angle), strafe: Math.cos(angle), turn: 0, look: 0, sprint: tick % 8 === 0 },
          aim: { angle, pitch: 0 },
        });
      }
      const elapsed = rooms.map(room => room.world.data.elapsed);
      service.pulse();
      if (tick > WARMUP_TICKS) rooms.forEach((room, index) => { if (room.world.data.elapsed > elapsed[index]) activeTicks++; });
      // Keep the synthetic fixture alive through capture resets so every sampled second contains 20Hz room steps.
      for (const room of rooms) {
        if (room.phase !== "playing") room.phase = "playing";
        for (const player of room.players.values()) if (["caught", "eliminated"].includes(player.status)) {
          player.lives = 1; player.status = "caught"; service.respawn(room.code, player.token);
        }
      }
      if (tick === WARMUP_TICKS) {
        for (const item of sessions) { item.response.bytes = 0; item.response.fullBytes = 0; item.response.snapshots = 0; }
        activeTicks = 0; global.gc?.(); cpuStart = process.cpuUsage(); heapStart = process.memoryUsage().heapUsed;
      }
    }
    for (const item of sessions) { snapshotBytes += item.response.bytes; fullSnapshotBytes += item.response.fullBytes; snapshotCount += item.response.snapshots; }
    const cpu = process.cpuUsage(cpuStart);
    global.gc?.(); const heapDeltaDuringSampleBytes = process.memoryUsage().heapUsed - heapStart;
    const simSeconds = SAMPLE_TICKS * STEP_MS / 1000;
    const result = {
      rooms: roomCount,
      exploration: fullExploration ? `full-map-${FULL_EXPLORATION_TILES}-tiles` : "normal",
      exploredTilesPerPlayer: fullExploration ? FULL_EXPLORATION_TILES : null,
      activeTicks,
      measuredSimulationSecondsPerRoom: simSeconds,
      cpuMs: Math.round((cpu.user + cpu.system) / 1000),
      totalOneCorePercent: Number(((cpu.user + cpu.system) / (simSeconds * 10_000)).toFixed(2)),
      perRoomOneCorePercent: roomCount ? Number(((cpu.user + cpu.system) / (simSeconds * roomCount * 10_000)).toFixed(2)) : null,
      staticHeapBytesAfterGc: heapAfterRooms - heapBeforeRooms,
      staticHeapBytesPerRoom: roomCount ? Math.round((heapAfterRooms - heapBeforeRooms) / roomCount) : null,
      heapDeltaDuringSampleBytes,
      snapshotCount,
      snapshotBytes,
      fullSnapshotBytes,
      egressBytesPerSecond: Math.round(snapshotBytes / simSeconds),
      fullSnapshotBytesPerSecond: Math.round(fullSnapshotBytes / simSeconds),
      note: "Synthetic local process benchmark; counts WebSocket JSON payload bytes without TCP/TLS overhead.",
    };
    return result;
  } finally { service.shutdown(); }
}

const median = values => { const sorted = [...values].sort((a, b) => a - b); return sorted[Math.floor(sorted.length / 2)]; };
for (const rooms of [0, 1, 8]) for (const fullExploration of [false, true]) {
  const runs = [runScenario(rooms, fullExploration), runScenario(rooms, fullExploration), runScenario(rooms, fullExploration)];
  const fields = ["activeTicks", "cpuMs", "totalOneCorePercent", "perRoomOneCorePercent", "staticHeapBytesAfterGc", "heapDeltaDuringSampleBytes", "snapshotCount", "snapshotBytes", "fullSnapshotBytes", "egressBytesPerSecond", "fullSnapshotBytesPerSecond"];
  const medianMetrics = Object.fromEntries(fields.map(field => {
    const values = runs.map(run => run[field]).filter(value => typeof value === "number");
    return [field, values.length ? median(values) : null];
  }));
  const heapPerRoomRuns = runs.map(run => run.staticHeapBytesPerRoom);
  const rawHeapPerRoom = rooms ? median(heapPerRoomRuns) : null;
  medianMetrics.staticHeapBytesPerRoom = rooms && heapPerRoomRuns.every(value => Number.isFinite(value) && value > 0) ? rawHeapPerRoom : null;
  medianMetrics.staticHeapRawPerRoomBytes = rawHeapPerRoom;
  medianMetrics.heapDeltaDuringSampleBytesPerRoom = rooms ? Math.round(median(runs.map(run => run.heapDeltaDuringSampleBytes)) / rooms) : null;
  const result = {
    rooms, exploration: runs[0].exploration, exploredTilesPerPlayer: runs[0].exploredTilesPerPlayer, repeats: runs.length, measuredSimulationSecondsPerRoom: runs[0].measuredSimulationSecondsPerRoom,
    median: medianMetrics,
    observedRange: Object.fromEntries(["cpuMs", "totalOneCorePercent", "perRoomOneCorePercent", "egressBytesPerSecond"].map(field => {
      const values = runs.map(run => run[field]).filter(value => value !== null);
      return [field, values.length ? [Math.min(...values), Math.max(...values)] : null];
    }).concat([
      ["staticHeapBytesPerRoom", (() => { const values = runs.map(run => run.staticHeapBytesPerRoom); return rooms && values.every(value => Number.isFinite(value) && value > 0) ? [Math.min(...values), Math.max(...values)] : null; })()],
      ["staticHeapRawPerRoomBytes", (() => { const values = runs.map(run => run.staticHeapBytesPerRoom); return rooms && values.every(value => Number.isFinite(value)) ? [Math.min(...values), Math.max(...values)] : null; })()],
      ["heapDeltaDuringSampleBytesPerRoom", (() => { const values = runs.map(run => rooms ? run.heapDeltaDuringSampleBytes / rooms : null).filter(value => value !== null); return values.length ? [Math.min(...values), Math.max(...values)] : null; })()],
    ])),
    note: `Local synthetic model range only, not a production capacity guarantee. Full exploration seeds ${FULL_EXPLORATION_TILES} legal MAP floor indices on every player's private snapshot. Auto-respawn fixture; no HTTP traffic, packet loss, TLS or transport overhead. Heap values are post-GC estimates; null static bytes per room means process-level GC noise made the estimate inconclusive, not zero.`,
  };
  process.stdout.write(`${JSON.stringify(result)}\n`);
}
