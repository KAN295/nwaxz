import { createHash, randomBytes, randomInt, timingSafeEqual,scryptSync } from "node:crypto";
import { isIP } from "node:net";
import packageInfo from "../package.json" with { type: "json" };
import { EscapeWorld } from "../src/escape/world.ts";

// Snapshots go out every tick (20 Hz); clients interpolate remote actors between them.
const TICK_MS = 50, SNAPSHOT_MS = 50, GRACE_MS = 30_000, ROOM_TTL_MS = 30 * 60_000, EMPTY_LOBBY_TTL_MS = 2 * 60_000, TERMINAL_TTL_MS = 60_000;
const HARD_ROOM_LIMIT = 8, MAX_STREAMS = 48, CODE_CHARS = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
const validName = value => typeof value === "string" && value.trim().length > 0 && [...value.trim()].length <= 12 && !/[\u0000-\u001f\u007f]/u.test(value);
const safeName = value => value.trim().replace(/[<>]/gu, "");
const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const clone = value => JSON.parse(JSON.stringify(value));
const TEAM_KEYS = ["inventory", "searched", "opened", "unlocked", "notes", "power", "drained", "stones", "basement", "expansion", "abilities"];
const TEAM_HUNT_KEYS = ["collected", "freezeUsed", "revealUsed", "wardUsed", "freeze", "reveal", "ward"];
function syncTeam(source, target) {
  for (const key of TEAM_KEYS) target.data[key] = clone(source.data[key]);
  for (const key of TEAM_HUNT_KEYS) target.data.hunt[key] = source.data.hunt[key];
  target.data.phase = "playing"; target.data.elapsed = source.data.elapsed; target.data.captures = source.data.captures;
}
function syncRoomToActor(source, target) { syncTeam(source, target); target.data.hunter = clone(source.data.hunter); }
const SHARED_EVENT_TYPES = new Set(["item", "door", "noise", "won"]);

function isPrivateProxyAddress(address) {
  if (typeof address !== "string") return false;
  const normalized = address.toLowerCase().startsWith("::ffff:") ? address.slice(7) : address;
  if (isIP(normalized) === 4) {
    const [a, b] = normalized.split(".").map(Number);
    return a === 10 || a === 127 || a === 192 && b === 168 || a === 172 && b >= 16 && b <= 31 || a === 169 && b === 254;
  }
  if (isIP(normalized) === 6) return normalized === "::1" || /^(?:fc|fd|fe[89ab])/u.test(normalized);
  return false;
}

/** Trust X-Real-IP only on the private NPM common-net socket; app deployment has no public port. */
export function resolveCoopClientIp(req) {
  const real = req.get("x-real-ip")?.trim();
  return isPrivateProxyAddress(req.socket?.remoteAddress) && real && isIP(real) ? real : req.ip;
}

export class CoopService {
  constructor({ now = Date.now, randomBytesFn = randomBytes, maxRooms = Number(process.env.NWAXZ_COOP_MAX_ROOMS ?? 8), autoTick = true } = {}) {
    this.now = now; this.randomBytes = randomBytesFn; this.rooms = new Map(); this.ipBuckets = new Map();
    this.maxRooms = clamp(Number.isInteger(maxRooms) ? maxRooms : 8, 1, HARD_ROOM_LIMIT);
    this.timer = autoTick ? setInterval(() => this.pulse(), TICK_MS) : undefined; this.timer?.unref?.();
    this.reaper = autoTick ? setInterval(() => this.cleanup(), 5_000) : undefined; this.reaper?.unref?.();
  }
  close() { if (this.timer) clearInterval(this.timer); if (this.reaper) clearInterval(this.reaper); for (const room of this.rooms.values()) for (const peer of room.peers.values()) this.closePeer(peer); }
  shutdown() { this.close(); }
  code() { let code; do { code = Array.from({ length: 6 }, () => CODE_CHARS[randomInt(CODE_CHARS.length)]).join(""); } while (this.rooms.has(code)); return code; }
  token() { return this.randomBytes(32).toString("base64url"); }
  checkRate(ip) {
    const now = this.now(), bucket = this.ipBuckets.get(ip) ?? { at: now, count: 0 };
    if (now - bucket.at >= 60_000) { bucket.at = now; bucket.count = 0; }
    bucket.count++; this.ipBuckets.set(ip, bucket); return bucket.count <= 60;
  }
  create({ version, name, avatar, title='逃生小队',visibility='public',password='',profileUid }, ip = "") {
    this.assertVersion(version); if (!this.checkRate(ip)) throw new CoopError(429, "请求太频繁");
    const owned = [...this.rooms.values()].filter(room => room.ownerIp === ip).length;
    if (owned >= 3) throw new CoopError(429, "同一网络的活跃房间已达上限");
    if (this.rooms.size >= this.maxRooms) throw new CoopError(503, "房间已满");
    this.validateProfile(name, avatar);
    if(typeof title!=='string'||![...title.trim()].length||[...title.trim()].length>24||!['public','private'].includes(visibility)||typeof password!=='string'||password.length>32||visibility==='private'&&!password.length)throw new CoopError(400,'房间名称或密码无效');
    const code = this.code(), player = this.newPlayer(name, avatar, 1), room = {
      code, phase: "lobby", leaderId: player.id, players: new Map([[player.id, player]]), peers: new Map(),
      world: new EscapeWorld(randomInt(1, 0xffffffff)), sharedEvents: [], revision: 0, createdAt: this.now(), lastActive: this.now(), terminalAt: undefined,
      nextPulse: this.now(), nextSnapshot: this.now() + SNAPSHOT_MS, tickInputs: new Map(), tickCounter: 0, connectedAt: this.now(), startedAt: undefined, ownerIp: ip,
    };
    room.name=title.trim();room.visibility=visibility;
    if(visibility==='private'){room.passwordSalt=this.randomBytes(16);room.passwordHash=scryptSync(password,room.passwordSalt,32);}
    player.profileUid=profileUid;
    player.actor = { ...room.world.data.player, ...player.position };
    player.actorWorld = EscapeWorld.restore(room.world.snapshot());
    player.actorWorld.data.player = { ...player.actorWorld.data.player, ...player.position };
    this.rooms.set(code, room); return this.session(room, player);
  }
  join({ version, code, name, avatar, password='',profileUid,invited=false }, ip = "") {
    this.assertVersion(version); if (!this.checkRate(ip)) throw new CoopError(429, "请求太频繁");
    const room = this.rooms.get(String(code ?? "").toUpperCase()); if (!room) throw new CoopError(404, "房间不存在");
    if (room.phase !== "lobby") throw new CoopError(409, "游戏已开始，不能加入");
    if (room.players.size >= 3) throw new CoopError(409, "房间已满");
    if(room.passwordHash&&!invited&&(typeof password!=='string'||password.length>32||!timingSafeEqual(scryptSync(password,room.passwordSalt,32),room.passwordHash)))throw new CoopError(403,'房间密码错误');
    this.validateProfile(name, avatar);
    const used = new Set([...room.players.values()].map(p => p.slot));
    const slot = [1, 2, 3].find(n => !used.has(n)), player = this.newPlayer(name, avatar, slot);
    player.actor = { ...room.world.data.player, ...player.position };
    player.actorWorld = EscapeWorld.restore(room.world.snapshot());
    player.actorWorld.data.player = { ...player.actorWorld.data.player, ...player.position };
    room.players.set(player.id, player); room.lastActive = this.now(); room.revision++;
    player.profileUid=profileUid;
    return this.session(room, player);
  }
  start(code, player) {
    const room = this.auth(code, player.token); if (room.leaderId !== player.id) throw new CoopError(403, "只有房主可以开始");
    if (room.phase !== "lobby" || room.players.size < 2) throw new CoopError(409, "至少需要两名玩家");
    if ([...room.players.values()].some(p => p.status !== "connected" || !p.ready)) throw new CoopError(409, "所有玩家在线并准备好后才能开始");
    const lives = room.players.size === 2 ? 2 : 1;
    for (const item of room.players.values()) item.lives = lives;
    room.initialPlayerCount = room.players.size; room.phase = "playing"; room.startedAt = this.now(); room.revision++; room.lastActive = this.now(); return this.view(room);
  }
  newPlayer(name, avatar, slot) { return { id: this.randomBytes(12).toString("base64url"), token: this.token(), slot, name: safeName(name), avatar, ready: false, lives: 0, status: "connected", position: slot === 1 ? { x: 3.5, z: 5.5 } : slot === 2 ? { x: 4.5, z: 5.5 } : { x: 5.5, z: 5.5 }, actor: undefined, actorWorld: undefined, hidden: undefined, pending: undefined, moving: false, lastSeq: -1, lastInput: { forward: 0, strafe: 0, turn: 0, look: 0, sprint: false }, lastSeen: this.now(), lastEvent: 0 } }
  session(room, player) { return { code: room.code, playerId: player.id, token: player.token, leader: player.id === room.leaderId, phase: room.phase, protocol: 1 }; }
  setTerminalPhase(room, phase) { room.phase = phase; if (["won", "lost"].includes(phase) && room.terminalAt === undefined) room.terminalAt = this.now(); }
  resolveOutcome(room) {
    if (room.phase !== "playing") return;
    const remaining = [...room.players.values()].filter(player => !["left", "eliminated"].includes(player.status));
    if (remaining.length && remaining.every(player => player.status === "escaped")) this.setTerminalPhase(room, "won");
    else if (!remaining.length) this.setTerminalPhase(room, "lost");
  }
  validateProfile(name, avatar) { if (!validName(name)) throw new CoopError(400, "昵称需为 1 到 12 个字符"); if (!Number.isInteger(avatar) || avatar < 0 || avatar > 3) throw new CoopError(400, "角色编号无效"); }
  setReady(code, token, ready) { const room = this.auth(code, token), player = this.findPlayer(room, token); if (room.phase !== "lobby") throw new CoopError(409, "游戏已开始"); if (typeof ready !== "boolean") throw new CoopError(400, "准备状态无效"); player.ready = ready; room.revision++; room.lastActive = this.now(); return this.view(room); }
  assertVersion(version) { if (version !== packageInfo.version) throw new CoopError(409, "客户端版本不匹配", { expectedVersion: packageInfo.version }); }
  auth(code, token) { const room = this.rooms.get(String(code ?? "").toUpperCase()); if (!room) throw new CoopError(404, "房间不存在"); if (!this.findPlayer(room, token)) throw new CoopError(401, "会话无效"); return room; }
  findPlayer(room, token) { const hash = createHash("sha256").update(String(token ?? "")).digest(); return [...room.players.values()].find(p => timingSafeEqual(hash, createHash("sha256").update(p.token).digest())); }
  input(code, token, body) {
    const room = this.auth(code, token), player = this.findPlayer(room, token);
    if (room.phase !== "playing") throw new CoopError(409, "游戏尚未进行");
    if (player.status !== "connected") throw new CoopError(409, "当前状态不能操作");
    const now = this.now();
    if (now - (player.rateWindowAt ?? 0) >= 1000) { player.rateWindowAt = now; player.rateCount = 0; }
    if ((player.rateCount ?? 0) >= 30) throw new CoopError(429, "输入请求太频繁");
    player.rateCount = (player.rateCount ?? 0) + 1;
    if (!body || Object.keys(body).some(key => !["seq", "move", "aim", "action", "targetId"].includes(key))) throw new CoopError(400, "输入字段无效");
    if (!Number.isSafeInteger(body.seq) || body.seq <= player.lastSeq) throw new CoopError(400, "输入序号无效");
    if (body.action !== undefined && !["interact", "crouch", "sprint", "light", "stone", "freeze", "reveal", "ward"].includes(body.action)) throw new CoopError(400, "动作无效");
    if (body.targetId !== undefined && (typeof body.targetId !== "string" || body.targetId.length > 48)) throw new CoopError(400, "目标编号无效");
    const move = body.move; if (!move || typeof move !== "object" || Array.isArray(move) || Object.keys(move).some(key => !["forward", "strafe", "turn", "look", "sprint"].includes(key)) || typeof move.sprint !== "boolean" || ![move.forward, move.strafe, move.turn, move.look].every(n => typeof n === "number" && Number.isFinite(n))) throw new CoopError(400, "输入格式无效");
    if (body.aim !== undefined && (!body.aim || typeof body.aim !== "object" || Array.isArray(body.aim) || Object.keys(body.aim).some(key => !["angle", "pitch"].includes(key)) || !Number.isFinite(body.aim.angle) || !Number.isFinite(body.aim.pitch))) throw new CoopError(400, "视角输入无效");
    if (body.action !== undefined) {
      if (now - (player.actionRateWindowAt ?? 0) >= 1000) { player.actionRateWindowAt = now; player.actionRateCount = 0; }
      if ((player.actionRateCount ?? 0) >= 10) throw new CoopError(429, "游戏动作请求太频繁");
      player.actionRateCount = (player.actionRateCount ?? 0) + 1;
    }
    player.lastSeq = body.seq; player.lastSeen = this.now(); player.inputAt = this.now(); player.lastInput = { forward: clamp(move.forward, -1, 1), strafe: clamp(move.strafe, -1, 1), turn: clamp(move.turn, -4, 4), look: clamp(move.look, -4, 4), sprint: player.actorWorld.data.player.sprinting };
    if (body.aim && Number.isFinite(body.aim.angle) && Number.isFinite(body.aim.pitch)) player.aim = { angle: clamp(body.aim.angle, -Math.PI, Math.PI), pitch: clamp(body.aim.pitch, -1.3, 1.3) };
    if (body.action) {
      syncRoomToActor(room.world, player.actorWorld);
      player.actorWorld.setCoopPerceptionContext(player.id, room.world.coopTargetId);
      player.actorWorld.data.player = { ...player.actorWorld.data.player, ...player.position };
      if (player.aim) Object.assign(player.actorWorld.data.player, player.aim);
      player.actorWorld.data.hidden = player.hidden;
      player.actorWorld.pending = player.pending;
      this.act(room, player, body.action, body.targetId);
      this.collectActorEvents(room, player);
      const escaped = player.actorWorld.data.phase === "won";
      syncTeam(player.actorWorld, room.world);
      if (body.action === "ward") for (const member of room.players.values()) member.actorWorld.clearInterferenceAuthoritative();
      player.actor = { ...player.actorWorld.data.player };
      player.position = {x:player.actor.x,z:player.actor.z};
      player.hidden = player.actorWorld.data.hidden;
      player.pending = player.actorWorld.pending;
      if (escaped) { player.status = "escaped"; player.actorWorld.data.phase = "playing"; }
    }
    this.resolveOutcome(room);
    room.lastActive = this.now(); room.revision++; return { accepted: true, seq: player.lastSeq, serverTime: this.now() };
  }
  act(room, player, action, targetId) {
    const world = player.actorWorld;
    if (action === "interact") {
      const target = world.nearest(); if (!target || targetId !== target.id || dist(world.data.player, target.position) > 1.8) throw new CoopError(400, "交互目标无效");
      if (!world.interactAuthoritative(targetId)) throw new CoopError(400, "交互目标无效");
    } else if (action === "crouch") world.toggleCrouch();
    else if (action === "sprint") world.toggleSprint();
    else if (action === "light") world.toggleLight();
    else if (action === "stone") world.throwStone();
    else if (["freeze", "reveal", "ward"].includes(action)) {
      const kind = action, hunt = world.data.hunt;
      if (!hunt || !world.crystalCharges(kind)) throw new CoopError(409, "没有可用的水晶");
      world.useCrystal(kind);
    } else throw new CoopError(400, "动作无效");
  }
  collectActorEvents(room, player) {
    for (const event of player.actorWorld.drainEvents()) {
      if (event.type === "hunter-cast") { if (event.id === "interference") room.world.performHunterLaugh("interference"); continue; }
      if (SHARED_EVENT_TYPES.has(event.type)) room.sharedEvents.push(event);
      else (player.pendingEvents ??= []).push(event);
    }
  }
  disconnect(code, player) { const room = this.auth(code, player.token), p = this.findPlayer(room, player.token); if (p.status === "connected") p.status = "reconnecting"; p.disconnectedAt = this.now(); this.closePeer(room.peers.get(p.id)); room.peers.delete(p.id); if (room.leaderId === p.id) this.electLeader(room); room.revision++; return { ok: true }; }
  leave(code, token) {
    const room = this.auth(code, token), player = this.findPlayer(room, token);
    if (room.phase === "lobby") {
      this.closePeer(room.peers.get(player.id)); room.peers.delete(player.id); room.players.delete(player.id);
      if (room.leaderId === player.id) this.electLeader(room);
      if (!room.players.size) this.rooms.delete(room.code);
    } else {
      player.status = "left"; player.disconnectedAt = this.now();
      this.closePeer(room.peers.get(player.id)); room.peers.delete(player.id);
      if (room.leaderId === player.id) this.electLeader(room);
      const remaining = [...room.players.values()].filter(p => !["left", "eliminated"].includes(p.status));
      if (remaining.length && remaining.every(p => p.status === "escaped")) this.setTerminalPhase(room, "won");
      else if (!remaining.length) this.setTerminalPhase(room, "lost");
    }
    room.revision++; return { ok: true, phase: room.phase };
  }
  respawn(code, token) { const room = this.auth(code, token), player = this.findPlayer(room, token); if (room.phase !== "playing" || player.status !== "caught" || player.lives <= 0) throw new CoopError(409, "当前状态不能重生"); player.actorWorld.respawnCoopPlayer(); const spawnOptions = [{x:3.5,z:5.5},{x:5.5,z:5.5},{x:3.5,z:2.5},{x:20.5,z:5.5},{x:18.5,z:5.5}].filter(at => !room.world.wall(at.x,at.z) && !room.world.furniture(at.x,at.z,.25)).sort((a,b)=>dist(b,room.world.data.hunter)-dist(a,room.world.data.hunter));
    const spawn = spawnOptions.find(at => dist(at,room.world.data.hunter)>=6) ?? spawnOptions[0]; if(spawn)Object.assign(player.actorWorld.data.player,spawn); player.actor = {...player.actorWorld.data.player}; player.lastInput={forward:0,strafe:0,turn:0,look:0,sprint:false}; player.inputAt=0; player.aim=undefined; player.position = { x: player.actorWorld.data.player.x, z: player.actorWorld.data.player.z }; player.hidden = undefined; player.pending = undefined; player.moving = false; player.status = "connected"; player.lastSeen = this.now(); player.disconnectedAt = room.peers.has(player.id) ? undefined : this.now(); room.revision++; return this.view(room); }
  reconnect(code, token, res) { const room = this.auth(code, token), p = this.findPlayer(room, token); if (p.status === "left") throw new CoopError(409, "你已退出房间"); if (p.status === "reconnecting") p.status = "connected"; if (!room.players.get(room.leaderId) || room.players.get(room.leaderId).status !== "connected") this.electLeader(room); p.lastSeen = this.now(); this.attachStream(room, p, res); room.lastActive = this.now(); }
  attachStream(room, player, res) {
    const previous = room.peers.get(player.id); this.closePeer(previous);
    const streamCount = [...this.rooms.values()].reduce((sum, current) => sum + current.peers.size, 0) - (previous ? 1 : 0);
    if (streamCount >= MAX_STREAMS) throw new CoopError(503, "联机连接已满");
    res.status(200).set({ "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-store, no-transform", "Connection": "keep-alive", "X-Accel-Buffering": "no" }); res.flushHeaders?.();
    const peer = { res, lastSent: 0 }; room.peers.set(player.id, peer);
    room.revision++;
    res.on("close", () => { if (room.peers.get(player.id) === peer) { room.peers.delete(player.id); if (player.status === "connected") { player.status = "reconnecting"; if (room.leaderId === player.id) this.electLeader(room); } player.disconnectedAt = this.now(); } });
    res.write(`event: connected\ndata: ${JSON.stringify({ serverTime: this.now(), room: this.view(room) })}\n\n`);
  }
  closePeer(peer) { if (peer && !peer.res.writableEnded) peer.res.end(); }
  electLeader(room) { const roster = [...room.players.values()].filter(p => !["left", "eliminated", "escaped"].includes(p.status)); const next = roster.find(p => p.status === "connected") ?? roster[0]; if (next) room.leaderId = next.id; }
  view(room) { return { code: room.code,name:room.name,locked:!!room.passwordHash, phase: room.phase, leaderId: room.leaderId, startedAt: room.startedAt, players: [...room.players.values()].map(p => ({ id: p.id,uid:p.profileUid, slot: p.slot, name: p.name, avatar: p.avatar, ready: p.ready, lives: p.lives, status: p.status, position: { ...p.position, angle: p.actor?.angle ?? -Math.PI / 2, pitch: p.actor?.pitch ?? 0, crouched: p.actor?.crouched ?? false, sprinting: p.actor?.sprinting ?? false, moving: p.moving } })) }; }
  snapshot(room, player) {
    const spectating = ["eliminated", "escaped"].includes(player.status) ? [...room.players.values()].find(other => other.status === "connected") : undefined;
    const projection = spectating ?? player;
    syncRoomToActor(room.world, projection.actorWorld);
    projection.actorWorld.setCoopPerceptionContext(projection.id, room.world.coopTargetId);
    projection.actorWorld.data.hunt.exposure = projection.actorWorld.perception.total;
    const world = room.world.snapshot(), actor = projection.actorWorld.snapshot();
    world.player = { ...actor.player, ...projection.position }; world.hidden = actor.hidden;
    world.pursuit = actor.pursuit;
    world.hunt = { ...actor.hunt, collected: room.world.data.hunt.collected, freezeUsed: room.world.data.hunt.freezeUsed, revealUsed: room.world.data.hunt.revealUsed, wardUsed: room.world.data.hunt.wardUsed, freeze: room.world.data.hunt.freeze, reveal: room.world.data.hunt.reveal, ward: room.world.data.hunt.ward };
    world.abilities = room.world.data.abilities; world.interference = actor.interference; world.explored = actor.explored;
    const ownEvents = [...(player.pendingEvents ?? []), ...player.actorWorld.drainEvents()]; player.pendingEvents = [];
    return { protocol: 1, serverTime: this.now(), revision: room.revision, viewPlayerId: projection.id, ...(room.world.abilityTargetPlayerId ? { abilityTargetPlayerId: room.world.abilityTargetPlayerId } : {}), ...(room.world.coopTargetId ? { targetPlayerId: room.world.coopTargetId } : {}), room: this.view(room), world, ...(projection.actorWorld.pending ? { search: { ...projection.actorWorld.pending } } : {}), events: [...(room.snapshotEvents ?? []), ...ownEvents], team: { crystals: world.hunt?.collected.length ?? 0, maxCrystals: 9, escaped: [...room.players.values()].filter(p => p.status === "escaped").length, alive: [...room.players.values()].filter(p => !["eliminated", "escaped", "left"].includes(p.status)).length, total: room.initialPlayerCount ?? room.players.size } };
  }
  pulse() {
    const now = this.now();
    for (const room of this.rooms.values()) {
      if (room.terminalAt !== undefined && now - room.terminalAt >= TERMINAL_TTL_MS) {
        for (const peer of room.peers.values()) this.closePeer(peer);
        this.rooms.delete(room.code); continue;
      }
      if (room.peers.size && room.phase === "playing" && room.terminalAt === undefined) room.lastActive = now;
      if (room.phase === "playing" && now >= room.nextPulse) {
        room.nextPulse = now + TICK_MS;
        const connected = [...room.players.values()].filter(p => p.status === "connected");
        if (connected.length) {
          const roster = [...room.players.values()].filter(p => !["caught", "eliminated", "escaped", "left"].includes(p.status));
          const candidates = [];
          for (const member of roster) {
            syncRoomToActor(room.world, member.actorWorld);
            if (member.aim) Object.assign(member.actorWorld.data.player, member.aim);
            if (member.status === "connected") {
              const fresh = now - (member.inputAt ?? 0) <= 500 ? { ...member.lastInput, sprint: member.actorWorld.data.player.sprinting } : { forward: 0, strafe: 0, turn: 0, look: 0, sprint: member.actorWorld.data.player.sprinting };
              const before = { x: member.actorWorld.data.player.x, z: member.actorWorld.data.player.z };
              member.actorWorld.advanceActorAuthoritative(TICK_MS / 1000, member.aim ? { ...fresh, turn: 0, look: 0 } : fresh, { playerId: member.id, targetId: room.targetPlayerId });
              member.moving = dist(before, member.actorWorld.data.player) > 0.0001;
              this.collectActorEvents(room, member);
              syncTeam(member.actorWorld, room.world);
            } else member.moving = false;
            const personal = member.actorWorld.snapshot();
            member.position = { x: personal.player.x, z: personal.player.z }; member.actor = { ...personal.player };
            member.hidden = personal.hidden; member.pending = member.actorWorld.pending;
            const evidence = member.status === "connected" ? member.actorWorld.coopEvidence : { rawExposure: 0, currentExposure: 0, currentCues: {} };
            candidates.push({ id: member.id, player: personal.player, hidden: personal.hidden, seenHide: personal.pursuit?.seenHide, exposure: personal.hunt?.exposure ?? 0, ...evidence, focus: evidence.focus, traces: personal.hunt?.traces, living: true, moving: member.moving, investigation: member.actorWorld.drainCoopInvestigation() });
          }
          const caught = room.world.advanceEnemyAuthoritative(TICK_MS / 1000, candidates);
          for (const id of caught) {
            const victim = room.players.get(id); if (!victim) continue;
            victim.lives--; victim.status = victim.lives > 0 ? "caught" : "eliminated"; victim.moving = false; victim.disconnectedAt = this.now();
            victim.pendingEvents ??= []; victim.pendingEvents.push({ type: "caught", text: victim.lives > 0 ? "被奶蛙抓住了，等待重生。" : "你已被淘汰，正在观战。" });
          }
          room.targetPlayerId = room.world.coopTargetId;
          room.revision++;
          const remaining = [...room.players.values()].filter(p => !["eliminated", "left"].includes(p.status));
          if (remaining.length && remaining.every(p => p.status === "escaped")) this.setTerminalPhase(room, "won");
          else if (!remaining.length) this.setTerminalPhase(room, "lost");
        }
      }
      if (now >= room.nextSnapshot) {
        room.nextSnapshot += (Math.floor((now - room.nextSnapshot) / SNAPSHOT_MS) + 1) * SNAPSHOT_MS;
        if (room.phase === "lobby" && room.lastLobbyRevision === room.revision) {
          if (now - (room.lastLobbyHeartbeat ?? 0) >= 15_000) {
            room.lastLobbyHeartbeat = now;
            for (const peer of room.peers.values()) if (!peer.res.writableEnded) peer.res.write(": heartbeat\n\n");
          }
          continue;
        }
        if (room.phase === "lobby") { room.lastLobbyRevision = room.revision; room.lastLobbyHeartbeat = now; }
        room.snapshotEvents = [...room.world.drainEvents().filter(event => event.type !== "caught"), ...room.sharedEvents.splice(0)];
        for (const p of room.players.values()) {
          const peer = room.peers.get(p.id); if (!peer || peer.res.writableEnded) continue;
          if (peer.res.writableLength > 256 * 1024) { this.closePeer(peer); room.peers.delete(p.id); if (p.status === "connected") p.status = "reconnecting"; p.disconnectedAt = now; if (room.leaderId === p.id) this.electLeader(room); continue; }
          const snapshot=this.snapshot(room,p);
          if(peer.res.sendSnapshot)peer.res.sendSnapshot(snapshot);
          else if(!peer.res.write(`event: snapshot\ndata: ${JSON.stringify(snapshot)}\n\n`))peer.lastSent=now;
        }
      }
    }
  }
  cleanup() {
    const now = this.now();
    for (const room of this.rooms.values()) {
      if (room.terminalAt !== undefined && now - room.terminalAt >= TERMINAL_TTL_MS) {
        for (const peer of room.peers.values()) this.closePeer(peer);
        this.rooms.delete(room.code); continue;
      }
      if (room.phase === "playing") for (const player of room.players.values()) {
        if (!room.peers.has(player.id) && player.status === "connected") { player.status = "reconnecting"; player.disconnectedAt = now; if (room.leaderId === player.id) this.electLeader(room); }
      }
      for (const player of room.players.values()) if (!room.peers.has(player.id) && player.disconnectedAt !== undefined && now - player.disconnectedAt >= GRACE_MS) { room.players.delete(player.id); room.revision++; if (room.leaderId === player.id) this.electLeader(room); }
      this.resolveOutcome(room);
      const emptyLobbyExpired = room.phase === "lobby" && now - room.lastActive >= EMPTY_LOBBY_TTL_MS;
      if (!room.players.size || emptyLobbyExpired || now - room.lastActive > ROOM_TTL_MS) { for (const peer of room.peers.values()) this.closePeer(peer); this.rooms.delete(room.code); }
    }
    for (const [ip, bucket] of this.ipBuckets) if (now - bucket.at > 120_000) this.ipBuckets.delete(ip);
  }
}

export class CoopError extends Error { constructor(status, message, details = {}) { super(message); this.status = status; this.details = details; } }

export function mountCoopRoutes(app, { service = new CoopService(), express }) {
  const router = express.Router(); router.use(express.json({ limit: "8kb", strict: true }));
  const run = fn => (req, res) => { try { res.json(fn(req)); } catch (error) { res.status(error.status ?? 400).json({ error: error.message ?? "请求无效", ...error.details }); } };
  const onlyKeys = (body, keys) => body === undefined && keys.length === 0 || !!body && typeof body === "object" && !Array.isArray(body) && !Object.keys(body).some(key => !keys.includes(key));
  const tokenFrom = req => /^Bearer ([A-Za-z0-9_-]{20,128})$/u.exec(req.get("authorization") ?? "")?.[1] ?? "";
  router.get("/ping", (_req, res) => res.json({ serverTime: Date.now() }));
  router.get('/servers',run(()=>({serverTime:Date.now(),server:{id:'primary',name:'奶蛙浴场',rooms:service.rooms.size,capacity:service.maxRooms,players:[...service.rooms.values()].reduce((n,r)=>n+[...r.players.values()].filter(p=>p.status==='connected').length,0),version:packageInfo.version},rooms:[...service.rooms.values()].map(room=>({code:room.code,name:room.name,players:[...room.players.values()].filter(p=>p.status!=='left').length,maxPlayers:3,locked:!!room.passwordHash,phase:room.phase,leaderName:room.players.get(room.leaderId)?.name??''}))})));
  const identity=req=>{
    service.assertVersion(req.body?.version);service.validateProfile(req.body?.name,req.body?.avatar);
    return app.locals.social.auth(tokenFrom(req));
  };
  router.post("/rooms", run(req => { if (!req.body || Object.keys(req.body).some(key => !["version", "name", "avatar",'title','visibility','password'].includes(key))) throw new CoopError(400, "请求字段无效"); const profile=identity(req);return service.create({...req.body,name:profile.name,avatar:profile.avatar,profileUid:profile.uid}, resolveCoopClientIp(req)); }));
  router.post("/:code/join", run(req => { if (!req.body || Object.keys(req.body).some(key => !["version", "name", "avatar",'password'].includes(key))) throw new CoopError(400, "请求字段无效");const profile=identity(req),code=String(req.params.code).toUpperCase();const result=service.join({ ...req.body, code,name:profile.name,avatar:profile.avatar,profileUid:profile.uid,invited:app.locals.social.invited(profile.uid,code) }, resolveCoopClientIp(req));app.locals.social.consume(profile.uid,code);return result; }));
  router.post("/:code/start", run(req => { if (!onlyKeys(req.body, [])) throw new CoopError(400, "请求字段无效"); const room = service.auth(req.params.code, tokenFrom(req)); const player = service.findPlayer(room, tokenFrom(req)); return service.start(req.params.code, player); }));
  router.post("/:code/ready", run(req => { if (!onlyKeys(req.body, ["ready"])) throw new CoopError(400, "请求字段无效"); return service.setReady(req.params.code, tokenFrom(req), req.body.ready); }));
  router.post("/:code/respawn", run(req => { if (!onlyKeys(req.body, [])) throw new CoopError(400, "请求字段无效"); return service.respawn(req.params.code, tokenFrom(req)); }));
  router.post("/:code/input", run(req => service.input(req.params.code, tokenFrom(req), req.body)));
  router.post("/:code/leave", run(req => { if (!onlyKeys(req.body, [])) throw new CoopError(400, "请求字段无效"); return service.leave(req.params.code, tokenFrom(req)); }));
  router.get("/:code/events", (req, res) => { try { service.reconnect(req.params.code, tokenFrom(req), res); } catch (error) { res.status(error.status ?? 400).json({ error: error.message }); } });
  router.use((error, _req, res, _next) => res.status(error.status ?? 400).json({ error: "请求数据无效" }));
  app.use("/api/coop", router); return service;
}
