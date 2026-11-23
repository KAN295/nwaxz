import { createHash, randomBytes, randomInt, timingSafeEqual,scryptSync } from "node:crypto";
import { isIP } from "node:net";
import packageInfo from "../package.json" with { type: "json" };
import { CoopAuthority, CoopError } from "../src/escape/coop-authority.mjs";
export { CoopError };

export class CoopService extends CoopAuthority {
  constructor({ randomBytesFn = randomBytes, maxRooms = Number(process.env.NWAXZ_COOP_MAX_ROOMS ?? 8), ...options } = {}) {
    const digest = token => createHash("sha256").update(token).digest();
    super({ ...options, maxRooms, platform: {
      randomInt, secret: size => randomBytesFn(size).toString("base64url"),
      sameToken: (a, b) => timingSafeEqual(digest(a), digest(b)),
      hashPassword(password) {
        const salt = randomBytesFn(16);
        return { salt, hash: scryptSync(password, salt, 32) };
      },
      checkPassword: (password, stored) => timingSafeEqual(scryptSync(password, stored.salt, 32), stored.hash)
    } });
  }
}

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

export function mountCoopRoutes(app, { service = new CoopService(), express, lan = false, clientIp = resolveCoopClientIp }) {
  const router = express.Router(); router.use(express.json({ limit: "8kb", strict: true }));
  const run = fn => (req, res) => { try { res.json(fn(req)); } catch (error) { res.status(error.status ?? 400).json({ error: error.message ?? "请求无效", ...error.details }); } };
  const onlyKeys = (body, keys) => body === undefined && keys.length === 0 || !!body && typeof body === "object" && !Array.isArray(body) && !Object.keys(body).some(key => !keys.includes(key));
  const tokenFrom = req => /^Bearer ([A-Za-z0-9_-]{20,128})$/u.exec(req.get("authorization") ?? "")?.[1] ?? "";
  router.get("/ping", (_req, res) => res.json({ serverTime: Date.now() }));
  router.get('/servers',run(()=>({serverTime:Date.now(),server:{id:lan?'lan':'primary',name:lan?'局域网联机':'奶蛙浴场',rooms:service.rooms.size,capacity:service.maxRooms,players:[...service.rooms.values()].reduce((n,r)=>n+[...r.players.values()].filter(p=>p.status==='connected').length,0),version:packageInfo.version},rooms:[...service.rooms.values()].map(room=>({code:room.code,name:room.name,players:[...room.players.values()].filter(p=>p.status!=='left').length,maxPlayers:3,locked:!!room.passwordHash,phase:room.phase,leaderName:room.players.get(room.leaderId)?.name??''}))})));
  const identity=req=>{
    service.assertVersion(req.body?.version);service.validateProfile(req.body?.name,req.body?.avatar);
    return app.locals.social.auth(tokenFrom(req));
  };
  router.post("/rooms", run(req => { if (!req.body || Object.keys(req.body).some(key => !["version", "name", "avatar",'title','visibility','password'].includes(key))) throw new CoopError(400, "请求字段无效"); const profile=identity(req);return service.create({...req.body,name:profile.name,avatar:profile.avatar,profileUid:profile.uid}, clientIp(req)); }));
  router.post("/:code/join", run(req => { if (!req.body || Object.keys(req.body).some(key => !["version", "name", "avatar",'password'].includes(key))) throw new CoopError(400, "请求字段无效");const profile=identity(req),code=String(req.params.code).toUpperCase();const result=service.join({ ...req.body, code,name:profile.name,avatar:profile.avatar,profileUid:profile.uid,invited:app.locals.social.invited(profile.uid,code) }, clientIp(req));app.locals.social.consume(profile.uid,code);return result; }));
  router.post("/:code/start", run(req => { if (!onlyKeys(req.body, [])) throw new CoopError(400, "请求字段无效"); const room = service.auth(req.params.code, tokenFrom(req)); const player = service.findPlayer(room, tokenFrom(req)); return service.start(req.params.code, player); }));
  router.post("/:code/ready", run(req => { if (!onlyKeys(req.body, ["ready"])) throw new CoopError(400, "请求字段无效"); return service.setReady(req.params.code, tokenFrom(req), req.body.ready); }));
  router.post("/:code/respawn", run(req => { if (!onlyKeys(req.body, [])) throw new CoopError(400, "请求字段无效"); return service.respawn(req.params.code, tokenFrom(req)); }));
  router.post("/:code/input", run(req => service.input(req.params.code, tokenFrom(req), req.body)));
  router.post("/:code/leave", run(req => { if (!onlyKeys(req.body, [])) throw new CoopError(400, "请求字段无效"); return service.leave(req.params.code, tokenFrom(req)); }));
  router.get("/:code/events", (req, res) => { try { service.reconnect(req.params.code, tokenFrom(req), res); } catch (error) { res.status(error.status ?? 400).json({ error: error.message }); } });
  router.use((error, _req, res, _next) => res.status(error.status ?? 400).json({ error: "请求数据无效" }));
  app.use("/api/coop", router); return service;
}
