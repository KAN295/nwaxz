import { WebSocketServer } from 'ws';
import { attachCoopPeer } from '../src/escape/coop-wire.mjs';
import { createLanBroker } from './lan-signaling.mjs';

/** Same-origin, one authenticated duplex connection; capability never appears in its URL. */
export function attachCoopSockets(server, service, allowUpgrade = () => true, social) {
  const wss = new WebSocketServer({noServer:true,maxPayload:8192,perMessageDeflate:false});
  const signaling = new WebSocketServer({noServer:true,maxPayload:8192,perMessageDeflate:false});
  const broker = createLanBroker();
  const upgrade = (req,socket,head) => {
    if (!allowUpgrade(req)) { socket.destroy(); return; }
    const match = /^\/api\/coop\/([A-Z2-9]{6})\/socket$/.exec(new URL(req.url,'http://local').pathname);
    const lan = !!social && new URL(req.url,"http://local").pathname === "/api/coop/lan/socket";
    if(!match && !lan){socket.destroy();return;}
    if(req.headers.origin){try{if(new URL(req.headers.origin).host!==req.headers.host){socket.destroy();return;}}catch{socket.destroy();return;}}
    const target = lan ? signaling : wss;
    if(target.clients.size>=64){socket.end('HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n\r\n');return;}
    target.handleUpgrade(req,socket,head,ws=>lan ? broker.connect(ws, social, service, req) : attachCoopPeer(ws, match[1], service));
  };
  server.on('upgrade',upgrade);
  let closed=false;
  const close=()=>{if(closed)return;closed=true;broker.close();server.off('upgrade',upgrade);for(const target of [wss,signaling]){for(const ws of target.clients)ws.terminate();target.close();}};
  server.once('close',close);return close;
}
