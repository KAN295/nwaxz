import { version } from '../../package.json';
import { CoopClient } from './coop-client.ts';
import { CoopAuthority } from './coop-authority.mjs';
import { attachCoopPeer } from './coop-wire.mjs';

const timeoutMessage = '内网直连超时，请确认设备连接同一网络，且 Wi-Fi 允许设备互访';
const signalUrl = () => new URL('/api/coop/lan/socket', location.href.replace(/^http/, 'ws'));
const send = (channel, packet) => channel.send(JSON.stringify(packet));

function waitFor(target, event, ms = 15000) {
  return new Promise((resolve, reject) => {
    const finish = (fn, value) => {
      clearTimeout(timer);
      for (const name of ['close','error',event]) target.removeEventListener(name, handle);
      fn(value);
    };
    function handle(e) { if (e.type === event) finish(resolve,e); else finish(reject,new Error(timeoutMessage)); }
    const timer = setTimeout(() => finish(reject,new Error(timeoutMessage)),ms);
    for (const name of ['close','error',event]) target.addEventListener(name, handle);
  });
}

async function packetAfter(channel, packet) {
  const response = waitFor(channel,'message');
  send(channel,packet);
  const result = JSON.parse((await response).data);
  if (result.type === 'error') throw new Error(result.error);
  return result;
}

// Gather host candidates only. With no STUN or TURN service, match traffic cannot use a relay.
async function description(pc, type) {
  await pc.setLocalDescription(type === 'offer' ? await pc.createOffer() : await pc.createAnswer());
  while (pc.iceGatheringState !== 'complete') await waitFor(pc,'icegatheringstatechange',20000);
  return pc.localDescription.sdp;
}

function serverWire(channel) {
  return {
    get readyState() { return channel.readyState === 'open' ? 1 : 3; },
    get bufferedAmount() { return channel.bufferedAmount; },
    send: text => channel.send(text), close: () => channel.close(),
    on(event, listener) {
      channel.addEventListener(event, e => event === 'message' ? listener(e.data, typeof e.data !== 'string') : listener(e));
    }
  };
}

// Keep the same authenticated command and snapshot protocol for the host's local player.
function localPair() {
  const pair = new MessageChannel();
  const endpoints = [pair.port1, pair.port2].map(port => {
    const channel = new EventTarget();
    channel.readyState = 'open'; channel.bufferedAmount = 0;
    channel.send = text => port.postMessage(text);
    port.onmessage = e => channel.dispatchEvent(new MessageEvent('message',{data:e.data}));
    channel.close = () => {
      for (const peer of endpoints) if (peer.readyState === 'open') {
        peer.readyState = 'closed'; peer.dispatchEvent(new Event('close'));
      }
      pair.port1.close(); pair.port2.close();
    };
    return channel;
  });
  return endpoints;
}

function socketFor(getChannel) {
  let channel, closed = false;
  const socket = {
    readyState:0, get bufferedAmount() { return channel?.bufferedAmount ?? 0; },
    send(text) { channel.send(text); }, close() { finish(); },
    onopen:null, onmessage:null, onerror:null, onclose:null
  };
  function finish(reason = '', code = 1000) {
    if (closed) return;
    closed = true; socket.readyState = 3; channel?.close();
    socket.onclose?.(new CloseEvent('close',{code,reason}));
  }
  Promise.resolve().then(getChannel).then(open => {
    if (closed) { open.close(); return; }
    channel = open;
    if (channel.readyState !== 'open') { finish(); return; }
    channel.addEventListener('close', () => finish());
    channel.addEventListener('message', e => socket.onmessage?.(e));
    socket.readyState = 1;
    socket.onopen?.(new Event('open'));
  }).catch(e => finish(e.message, /房主|房间已关闭|会话无效|已退出/.test(e.message) ? 4004 : 1006));
  return socket;
}

function peer() {
  const pc = new RTCPeerConnection({iceServers:[]});
  pc.onconnectionstatechange = () => { if (pc.connectionState === 'failed') pc.close(); };
  return pc;
}

const platform = {
  secret: size => Array.from(crypto.getRandomValues(new Uint8Array(size)), n => n.toString(16).padStart(2,'0')).join(''),
  randomInt: (min, max) => { if (max === undefined) { max=min; min=0; } return min + Math.floor(Math.random()*(max-min)); },
  // Private LAN rooms check their password inside the encrypted data channel and live only in host memory.
  hashPassword: value => value, checkPassword: (a,b) => a === b, sameToken: (a,b) => a === b
};

async function hostRoom(profile, options) {
  const service = new CoopAuthority({platform,maxRooms:1});
  const peers = new Set();
  let code, key, ws, stopped = false, retry;
  const close = () => {
    if (stopped) return;
    stopped=true; clearTimeout(retry);
    if (ws?.readyState === 1) send(ws,{type:'end'});
    ws?.close(); service.close();
    for (const pc of peers) pc.close();
    peers.clear(); window.removeEventListener('pagehide',close);
  };
  async function accept(offer, signaling) {
    if (peers.size >= 6) return;
    const pc = peer(); peers.add(pc);
    const release = () => { clearTimeout(timer); pc.close(); peers.delete(pc); };
    const timer = setTimeout(release,20000);
    pc.ondatachannel = ({channel}) => {
      channel.addEventListener('close',release,{once:true});
      channel.addEventListener('message', e => {
        try {
          if (typeof e.data !== 'string' || e.data.length > 2048) throw new Error('请求无效');
          const p = JSON.parse(e.data);
          if (p.type !== 'enter') throw new Error('请求无效');
          const {uid,name,avatar} = offer.profile;
          let session;
          if (p.resume) {
            const room = service.auth(code,p.resume), player = service.findPlayer(room,p.resume);
            if (player.profileUid !== uid || player.status === 'left') throw new Error('会话无效');
            session = service.session(room,player);
          } else {
            if ([...service.rooms.get(code).players.values()].some(p=>p.profileUid===uid)) throw new Error('你已在房间中');
            session = service.join({code,version,name,avatar,profileUid:uid,password:p.password});
          }
          clearTimeout(timer);
          send(channel,{type:'session',session});
          attachCoopPeer(serverWire(channel),code,service,session.token);
          // Also reclaim a slot if the guest loses its channel before protocol authentication.
          channel.addEventListener('close',()=>{
            const room=service.rooms.get(code), player=room?.players.get(session.playerId);
            if (player && !room.peers.has(player.id) && player.disconnectedAt === undefined) player.disconnectedAt=Date.now();
          });
        } catch (error) { send(channel,{type:'error',error:error.message}); channel.close(); }
      },{once:true});
    };
    try {
      await pc.setRemoteDescription({type:'offer',sdp:offer.sdp});
      const sdp = await description(pc,'answer');
      send(signaling,{type:'answer',id:offer.id,sdp});
    } catch { release(); }
  }
  async function register() {
    const socket = new WebSocket(signalUrl()); ws=socket;
    try {
      await waitFor(socket,'open');
      const result=await packetAfter(socket,{type:'host',version,token:profile.token,code,key});
      code=result.code; key=result.key;
      socket.onmessage=e=>{const p=JSON.parse(e.data);if(p.type==='offer')void accept(p,socket);};
    } catch(e) { socket.close(); throw e; }
    socket.onclose=()=>{if(!stopped) retry=setTimeout(recover,1500);};
  }
  async function recover() {
    if (stopped) return;
    try { await register(); } catch { if(!stopped)retry=setTimeout(recover,4000); }
  }
  try {
    await register();
    service.code=()=>code;
    const session=service.create({version,name:profile.name,avatar:profile.avatar,profileUid:profile.uid,title:options.name,visibility:options.visibility,password:options.password});
    window.addEventListener('pagehide',close);
    return new CoopClient(session,undefined,{
      open:()=>socketFor(()=>{const [client,host]=localPair();attachCoopPeer(serverWire(host),code,service,session.token);return client;}),
      close
    });
  } catch(e) { close(); throw e; }
}

async function joinRoom(profile, {code,password}) {
  let session, firstChannel, stopped=false;
  const connections = new Set();
  async function connect() {
    const pc=peer(), channel=pc.createDataChannel('escape'), ws=new WebSocket(signalUrl());
    connections.add(pc);
    const release=()=>{pc.close();connections.delete(pc);};
    channel.addEventListener('close',release,{once:true});
    try {
      const [sdp]=await Promise.all([description(pc,'offer'),waitFor(ws,'open')]);
      const answer=await packetAfter(ws,{type:'offer',version,token:profile.token,code,sdp});
      await pc.setRemoteDescription({type:'answer',sdp:answer.sdp});
      if(channel.readyState!=='open')await waitFor(channel,'open');
      if(stopped) throw new Error('房间已关闭');
      const reply=await packetAfter(channel,{type:'enter',password,resume:session?.token});
      if(reply.type!=='session') throw new Error('房间连接失败');
      session=reply.session; return channel;
    } catch(e) { release(); throw e; } finally { ws.close(); }
  }
  firstChannel=await connect();
  return new CoopClient(session,undefined,{
    open:()=>socketFor(()=>{if(!firstChannel)return connect();const channel=firstChannel;firstChannel=undefined;return channel;}),
    close(){stopped=true; for(const pc of connections)pc.close();connections.clear();}
  });
}

export async function openLanRoom(kind, profile, options) {
  if (!globalThis.isSecureContext || !globalThis.RTCPeerConnection) throw new Error('请使用支持内网直连的浏览器打开游戏的 HTTPS 网址');
  return kind === 'create' ? hostRoom(profile,options) : joinRoom(profile,options);
}
