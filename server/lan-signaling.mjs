import { randomBytes } from 'node:crypto';
import { resolveCoopClientIp } from './coop-service.mjs';

const alphabet = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
const send = (ws, packet) => { if (ws?.readyState === 1) ws.send(JSON.stringify(packet)); };

// Only offers and answers pass through this broker. Inputs and world state have no relay route.
export function createLanBroker() {
  const rooms = new Map();
  function remove(room) {
    clearTimeout(room.expiry);
    rooms.delete(room.code);
    for (const guest of room.pending.values()) guest.close(1000);
    room.pending.clear();
  }
  return {
    close() { for (const room of rooms.values()) remove(room); },
    connect(ws, social, service, req) {
      let room, guestId, host = false, count = 0, windowAt = Date.now();
      const deadline = setTimeout(() => ws.close(1008), 15_000);
      ws.on('error', () => {});
      ws.on('close', () => {
        clearTimeout(deadline);
        if (guestId) room?.pending.delete(guestId);
        if (host && room.host === ws) {
          room.host = undefined;
          room.expiry = setTimeout(() => remove(room), 90_000);
          room.expiry.unref();
        }
      });
      ws.on('message', (bytes, binary) => {
        try {
          if (Date.now() - windowAt > 1000) { count = 0; windowAt = Date.now(); }
          if (binary || ++count > 16) throw new Error('请求太频繁');
          const p = JSON.parse(bytes.toString());
          if (!room) {
            if (!service.checkRate(resolveCoopClientIp({socket:req.socket, get:key=>req.headers[key], ip:req.socket.remoteAddress}))) throw new Error('请稍后再试');
            service.assertVersion(p.version);
            const profile = social.auth(p.token);
            if (p.type === 'host') {
              let entry;
              if (p.code) {
                entry = rooms.get(p.code);
                if (!entry || entry.uid !== profile.uid || entry.key !== p.key) throw new Error('房间已关闭');
                clearTimeout(entry.expiry);
                entry.host?.close(1000);
              } else {
                if (rooms.size >= 32 || [...rooms.values()].some(r => r.uid === profile.uid)) throw new Error('内网房间已满或已有房间');
                let code;
                do { code = 'L' + Array.from(randomBytes(6), n => alphabet[n % 32]).join(''); } while (rooms.has(code));
                entry = { code, key:randomBytes(24).toString('hex'), uid:profile.uid, pending:new Map() };
                rooms.set(code, entry);
              }
              host = true; room = entry; room.host = ws; clearTimeout(deadline);
              send(ws, {type:'room', code:room.code, key:room.key});
            } else if (p.type === 'offer' && typeof p.sdp === 'string') {
              const entry = rooms.get(p.code);
              if (!entry?.host) throw new Error('找不到内网房主，请确认房间码');
              if (entry.pending.size >= 4) throw new Error('房间正在连接其他玩家，请重试');
              room = entry; guestId = randomBytes(12).toString('hex');
              room.pending.set(guestId, ws);
              send(room.host, {type:'offer', id:guestId, sdp:p.sdp, profile:{uid:profile.uid,name:profile.name,avatar:profile.avatar}});
            } else throw new Error('连接请求无效');
          } else if (host && room.host === ws && p.type === 'answer' && typeof p.sdp === 'string') {
            const guest = room.pending.get(p.id);
            if (guest) { send(guest, {type:'answer',sdp:p.sdp}); room.pending.delete(p.id); }
          } else if (host && p.type === 'end' && room.host === ws) {
            room.host = undefined; remove(room); ws.close(1000);
          } else throw new Error('连接请求无效');
        } catch (e) { send(ws, {type:'error',error:e.message}); ws.close(1008); }
      });
    }
  };
}
