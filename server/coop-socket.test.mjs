import test from 'node:test';
import assert from 'node:assert/strict';
import {createApp} from './app.mjs';
import {CoopService} from './coop-service.mjs';
import {attachCoopSockets} from './coop-socket.mjs';
import {applyCoopSnapshot} from '../src/escape/coop-snapshot.ts';
import packageInfo from '../package.json' with {type:'json'};
const {version}=packageInfo;
async function fixture(t){
 const service=new CoopService(),server=createApp({coopService:service}).listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const close=attachCoopSockets(server,service);
 t.after(()=>{close();service.shutdown();server.closeAllConnections();server.close();});
 const a=service.create({version,name:'甲',avatar:0}),b=service.join({version,code:a.code,name:'乙',avatar:1});
 async function connect(s,authVersion=version){
  const ws=new WebSocket(`ws://127.0.0.1:${server.address().port}/api/coop/${s.code}/socket`),packets=[];
  let snapshot;
  ws.addEventListener('message',e=>{
    const packet=JSON.parse(e.data);
    if(packet.type==='snapshot') snapshot=packet.data;
    if(packet.type==='snapshot-delta'){
      snapshot=applyCoopSnapshot(snapshot,packet.data);
      if(snapshot)packets.push({type:'snapshot',data:snapshot});
    }
    packets.push(packet);
  });
  await new Promise((r,j)=>{ws.onopen=r;ws.onerror=j;});ws.send(JSON.stringify({type:'auth',token:s.token,version:authVersion}));
  const wait=async predicate=>{const end=Date.now()+4000;while(Date.now()<end){const found=packets.find(predicate);if(found)return found;await new Promise(r=>setTimeout(r,10));}throw new Error('socket response timeout');};
  let seq=0;return{ws,packets,wait,command:async(type,data)=>{const id=++seq;ws.send(JSON.stringify({type,id,data}));return wait(p=>p.id===id);}};
 }
 return{service,a,b,connect};
}
test('one authenticated socket exchanges snapshots, ready/start, inputs and RTT without URL credentials',async t=>{
 const{a,b,connect}=await fixture(t),aa=await connect(a),bb=await connect(b);await aa.wait(p=>p.type==='connected');await bb.wait(p=>p.type==='connected');
 assert.equal((await aa.command('ready',{ready:true})).type,'ack');await bb.command('ready',{ready:true});await aa.command('start');
 const snapshot=await aa.wait(p=>p.type==='snapshot'&&p.data.room.phase==='playing');assert.deepEqual(snapshot.data.room.players.map(p=>p.lives),[2,2]);
 assert.ok(!JSON.stringify(snapshot).includes(a.token)&&!JSON.stringify(snapshot).includes(b.token));
 assert.equal((await aa.command('ping')).type,'pong');
 assert.equal((await aa.command('input',{seq:1,move:{forward:0,strafe:0,turn:0,look:0,sprint:false},action:'interact',targetId:'crystal-bed'})).type,'ack');
 await bb.wait(p=>p.type==='snapshot'&&p.data.world.hunt.collected.includes('crystal-bed'));
});
test('rejected actions remain a connected game, while obsolete clients cannot authenticate',async t=>{
 const{a,b,connect}=await fixture(t),aa=await connect(a),bb=await connect(b);await aa.wait(p=>p.type==='connected');await bb.wait(p=>p.type==='connected');await aa.command('ready',{ready:true});await bb.command('ready',{ready:true});await aa.command('start');
 const rejected=await aa.command('input',{seq:1,move:{forward:0,strafe:0,turn:0,look:0,sprint:false},action:'interact',targetId:'exit'});
 assert.equal(rejected.type,'error');assert.equal(rejected.status,400);assert.equal((await aa.command('ping')).type,'pong');
 const old=await connect(a,'obsolete');assert.equal((await old.wait(p=>p.type==='error')).status,409);
});
test('steady updates omit unchanged exploration and reconnect supplies a complete baseline',async t=>{
 const {service,a,b,connect}=await fixture(t),aa=await connect(a),bb=await connect(b);
 await aa.wait(p=>p.type==='connected');await bb.wait(p=>p.type==='connected');
 await aa.command('ready',{ready:true});await bb.command('ready',{ready:true});await aa.command('start');
 await aa.wait(p=>p.type==='snapshot'&&p.data.room.phase==='playing');
 const room=service.rooms.get(a.code),player=room.players.get(a.playerId);
 player.actorWorld.data.explored=[4,5,6,7];
 await aa.wait(p=>p.type==='snapshot-delta'&&p.data.world.set.explored?.includes(7));
 aa.packets.length=0;
 const input={seq:1,move:{forward:0,strafe:0,turn:0,look:0,sprint:false}};
 aa.ws.send(JSON.stringify({type:'input',data:input}));
 const next=await aa.wait(p=>p.type==='snapshot-delta'&&!Object.hasOwn(p.data.world.set,'explored'));
 assert.ok(next.data.world.set.elapsed>0);
 assert.equal(aa.packets.some(p=>p.type==='ack'||p.type==='error'),false);
 assert.equal((await aa.command('ping')).type,'pong');
 const retry=await connect(a);
 await retry.wait(p=>p.type==='connected');
 const baseline=await retry.wait(p=>p.type==='snapshot'&&p.data.room.phase==='playing');
 assert.ok(baseline.data.world.explored.includes(7));
});
test('wardrobe entry and exit persist their server positions on the next physics tick',async t=>{
 const{service,a,b,connect}=await fixture(t),aa=await connect(a),bb=await connect(b);await aa.wait(p=>p.type==='connected');await bb.wait(p=>p.type==='connected');await aa.command('ready',{ready:true});await bb.command('ready',{ready:true});await aa.command('start');
 const room=service.rooms.get(a.code),player=room.players.get(a.playerId);player.position={x:5.5,z:3.5};Object.assign(player.actorWorld.data.player,player.position,{angle:-Math.PI/2});
 const input={move:{forward:0,strafe:0,turn:0,look:0,sprint:false},action:'interact'};
 assert.equal((await aa.command('input',{...input,seq:1,targetId:'bed-hide'})).type,'ack');await aa.wait(p=>p.type==='snapshot'&&p.data.world.hidden==='bed-hide');
 assert.equal((await aa.command('input',{...input,seq:2,targetId:'leave-hide'})).type,'ack');await new Promise(r=>setTimeout(r,100));assert.equal(player.hidden,undefined);assert.ok(player.position.z>=3.4);
});
