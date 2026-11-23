import type { CoopCreateRequest, CoopInput, CoopJoinRequest, CoopSessionResponse, CoopSnapshot } from './coop-protocol.ts';
import {version as APP_VERSION} from '../../package.json';
import { applyCoopSnapshot } from './coop-snapshot.ts';
import { firstReadyRoomSocket } from './public-route.ts';
export type CoopConnectionState='connecting'|'connected'|'reconnecting'|'offline'|'closed';
class CommandError extends Error { constructor(message:string,readonly status:number){super(message);} }

/** Bootstrap over HTTPS, then one authenticated WebSocket for inputs, snapshots and RTT. */
export type CoopSocket = Pick<WebSocket, 'readyState'|'bufferedAmount'|'close'|'onmessage'|'onopen'|'onerror'|'onclose'> & {send(data:string):void};
export type CoopLink = {open():CoopSocket; close():void};
export class CoopClient {
 private socket?:CoopSocket;
 private routeAttempt?:AbortController;
 private primaryNext=false;
 private alive=false; private connected=false; private inputTimer=0; private pingTimer=0; private retryTimer=0;
 private lastPacketAt=0; private pinging=false;
 private seq=0; private requestId=0; private lastInputAt=0; private lastSignature='';
 private latestInput?:Omit<CoopInput,'seq'|'action'|'targetId'>;
 private actions:Array<Pick<CoopInput,'action'|'targetId'>>=[];
 private listeners=new Set<(snapshot:CoopSnapshot)=>void>();
 private stateListeners=new Set<(state:CoopConnectionState,message:string,latency?:number)=>void>();
 private pending=new Map<number,{resolve:(value:any)=>void;reject:(error:Error)=>void;timer:number;at:number;ping:boolean}>();
 private lastSnapshot?:CoopSnapshot;
 constructor(readonly session:CoopSessionResponse,private base='/api/coop',private link?:CoopLink){}
 static create(request:CoopCreateRequest,base?:string){const{profileToken,...body}=request;return this.sessionRequest('/rooms',body,base,profileToken);}
 static join(request:CoopJoinRequest,base?:string){const{code,profileToken,...profile}=request;return this.sessionRequest(`/${encodeURIComponent(code)}/join`,profile,base,profileToken);}
 private static async sessionRequest(path:string,body:unknown,base='/api/coop',profileToken?:string){
  const response=await fetch(base+path,{method:'POST',headers:{'content-type':'application/json',...(profileToken?{authorization:`Bearer ${profileToken}`}:{})},body:JSON.stringify(body)}),data=await response.json();
  if(!response.ok)throw new Error(data.error??'暂时无法进入房间');return new CoopClient(data,base);
 }
 onSnapshot(fn:(snapshot:CoopSnapshot)=>void){this.listeners.add(fn);if(this.lastSnapshot)fn(this.lastSnapshot);return()=>this.listeners.delete(fn);}
 onState(fn:(state:CoopConnectionState,message:string,latency?:number)=>void){this.stateListeners.add(fn);return()=>this.stateListeners.delete(fn);}
 get snapshot(){return this.lastSnapshot;}
 private state(state:CoopConnectionState,message:string,latency?:number){for(const fn of this.stateListeners)fn(state,message,latency);}
 start(){if(this.alive)return;this.alive=true;this.connect();}
 private async connect(){
  if(!this.alive || this.socket || this.routeAttempt)return;
  this.state(this.lastSnapshot?'reconnecting':'connecting',this.lastSnapshot?'正在重新连接':'正在连接房间');
  const url=new URL(`${this.base}/${encodeURIComponent(this.session.code)}/socket`,location.href);url.protocol=url.protocol==='https:'?'wss:':'ws:';
  let ws:CoopSocket;
  let direct=false;
  if(!this.link && location.origin==='https://nwaxz.bzlom.cn' && url.origin==='wss://nwaxz.bzlom.cn' && !this.primaryNext){
   const attempt=new AbortController();this.routeAttempt=attempt;
   const alternate=new URL(url);alternate.hostname='play.bzlom.cn';
   try {
    const selected=await firstReadyRoomSocket([alternate,url],attempt.signal);
    if(attempt.signal.aborted){selected.close();return;}
    ws=selected;direct=selected.url===alternate.href;
   } catch {
    if(attempt.signal.aborted)return;
    this.primaryNext=true;
    this.retryTimer=window.setTimeout(()=>this.connect(),0);return;
   } finally {if(this.routeAttempt===attempt)this.routeAttempt=undefined;}
  }else{
   this.primaryNext=false;
   ws=this.link ? this.link.open() : new WebSocket(url);
  }
  this.socket=ws;
  const deadline=window.setTimeout(()=>{if(!this.connected)ws.close();},this.link ? 40000 : 7000);
  const authenticate=()=>ws.send(JSON.stringify({type:'auth',token:this.session.token,version:APP_VERSION}));
  ws.onopen=authenticate;
  ws.onmessage=event=>{
   if(this.socket!==ws)return;
   let packet;try{packet=JSON.parse(event.data);}catch{return;}
   this.lastPacketAt=performance.now();
   if(packet.type==='connected'){clearTimeout(deadline);this.connected=true;this.lastSignature='';this.state('connected','已连接');return;}
   if(packet.type==='snapshot'||packet.type==='snapshot-delta'){
    const snapshot=packet.type==='snapshot' ? packet.data as CoopSnapshot : applyCoopSnapshot(this.lastSnapshot,packet.data);
    if(snapshot?.protocol!==1||!snapshot.world||!snapshot.room?.players){ws.close();return;}
    this.lastSnapshot=snapshot;
    for(const listener of this.listeners)try{listener(snapshot);}catch(error){console.error('Co-op snapshot listener failed',error);this.state('reconnecting','房间状态无法同步');ws.close();}
    return;
   }
   const pending=this.pending.get(packet.id);
   if(pending){clearTimeout(pending.timer);this.pending.delete(packet.id);if(packet.type==='error')pending.reject(new CommandError(packet.error??'操作未完成',packet.status??400));else{if(pending.ping)this.state('connected','已连接',Math.round(performance.now()-pending.at));pending.resolve(packet.data);}}
   else if(packet.type==='error'&&!this.connected){this.stop();this.state('closed',packet.error??'房间已关闭');}
  };
  ws.onerror=()=>{};
  ws.onclose=event=>{
   clearTimeout(deadline);if(this.socket!==ws)return;this.socket=undefined;this.connected=false;this.actions=[];this.rejectPending();
   if(direct)this.primaryNext=true;
   if(this.link && event.code===4004){this.stop();this.state('closed',event.reason || '房主已离开');return;}
   if(this.alive){this.state('reconnecting','连接中断，正在重连');this.retryTimer=window.setTimeout(()=>this.connect(),1000);}
  };
  if(ws.readyState===WebSocket.OPEN)authenticate();
 }
 private rejectPending(){for(const p of this.pending.values()){clearTimeout(p.timer);p.reject(new CommandError('连接中断',0));}this.pending.clear();}
 private async request(type:string,data?:unknown){
  if(!this.connected){await new Promise<void>((resolve,reject)=>{const timer=window.setTimeout(()=>{off();reject(new CommandError('连接未就绪',0));},8000);const off=this.onState(state=>{if(state==='connected'||state==='closed'){clearTimeout(timer);off();state==='connected'?resolve():reject(new CommandError('房间已关闭',404));}});});}
  const ws=this.socket;if(!this.connected||ws?.readyState!==WebSocket.OPEN)throw new CommandError('连接中断',0);
  const id=++this.requestId;
  return new Promise<any>((resolve,reject)=>{const timer=window.setTimeout(()=>{this.pending.delete(id);reject(new CommandError('连接超时',0));},6000);this.pending.set(id,{resolve,reject,timer,at:performance.now(),ping:type==='ping'});ws.send(JSON.stringify({type,id,...(data===undefined?{}:{data})}));});
 }
 sendInput(input:Omit<CoopInput,'seq'>){const{action,targetId,...motion}=input;this.latestInput=motion;if(action){if(this.actions.length>=8)this.actions.shift();this.actions.push({action,...(targetId?{targetId}:{})});}}
 clearActions(){this.actions=[];}
 startInputs(){
  if(this.inputTimer)return;
  this.inputTimer=window.setInterval(()=>{
   if(!this.alive||!this.connected||!this.latestInput)return;
   const self=this.lastSnapshot?.room.players.find(p=>p.id===this.session.playerId);
   if(this.lastSnapshot?.room.phase!=='playing'||self?.status!=='connected'){this.latestInput=undefined;this.actions=[];return;}
   const ws=this.socket;
   if(ws?.readyState!==WebSocket.OPEN||ws.bufferedAmount>4096)return;
   const signature=JSON.stringify(this.latestInput),now=performance.now();if(!this.actions.length&&signature===this.lastSignature&&now-this.lastInputAt<200)return;
   this.lastSignature=signature;this.lastInputAt=now;
   const input={...this.latestInput,seq:++this.seq,...this.actions.shift()};
   if (input.action) void this.request('input',input).catch(error=>{if(this.connected)this.state('connected',error.message);});
   else ws.send(JSON.stringify({type:'input',data:input}));
  },100);
  this.pingTimer=window.setInterval(()=>{
   if(!this.connected)return;
   if(performance.now()-this.lastPacketAt>15_000){this.socket?.close();return;}
   if(this.pinging)return;
   this.pinging=true;
   void this.ping().catch(()=>{}).finally(()=>{this.pinging=false;});
  },2500);
 }
 ready(ready:boolean){return this.request('ready',{ready});}
 startRoom(){return this.request('start');}
 respawn(){return this.request('respawn');}
 async leave(){try{if(this.connected)await this.request('leave');else if(!this.link) await fetch(`${this.base}/${encodeURIComponent(this.session.code)}/leave`,{method:'POST',headers:{authorization:`Bearer ${this.session.token}`,'content-type':'application/json'},body:'{}'}).catch(()=>{});}finally{this.stop();}}
 async ping(){const at=performance.now();await this.request('ping');return Math.round(performance.now()-at);}
 reconnect(){this.reset();this.start();this.startInputs();}
 stop(){this.reset();this.link?.close();}
 private reset(){this.alive=false;this.connected=false;this.routeAttempt?.abort();this.routeAttempt=undefined;this.primaryNext=false;const ws=this.socket;this.socket=undefined;ws?.close();this.rejectPending();clearTimeout(this.retryTimer);clearInterval(this.inputTimer);clearInterval(this.pingTimer);this.inputTimer=this.pingTimer=0;this.latestInput=undefined;this.actions=[];}
}
