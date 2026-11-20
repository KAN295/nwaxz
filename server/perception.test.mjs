import test from 'node:test';
import assert from 'node:assert/strict';
import {combinePerception,SENSES,ALERT_MULTIPLIER} from '../src/escape/perception.ts';
import {EscapeWorld} from '../src/escape/world.ts';
const near=(a,b,epsilon=1e-8)=>assert.ok(Math.abs(a-b)<epsilon,`${a} vs ${b}`);
const frames=(w,seconds,input={})=>{for(let i=0;i<Math.ceil(seconds*60);i++)w.advance(1/60,input)};
function hall(gap=4){
 const w=new EscapeWorld(42);w.data.elapsed=10;
 Object.assign(w.data.player,{x:3.5,z:9.5,angle:0,light:false,crouched:false});
 Object.assign(w.data.hunter,{x:3.5+gap,z:9.5,angle:0,state:'patrol'});w.target={x:22.5,z:9.5};return w;
}

test('no light, sound or sight starts and remains at zero, with no minimum score',()=>{
 const w=hall(14);frames(w,2);
 assert.equal(w.data.hunt.noise,0);assert.equal(w.data.hunt.glare,0);assert.equal(w.data.hunt.sight,0);
 assert.equal(w.data.hunt.exposure,0);assert.equal(w.perception.total,0);
});

test('nonlinear exposure saturates for full or overlapping high clues, without adding two 50s to 100',()=>{
 for(const source of SENSES){const scores={noise:0,glare:0,sight:0};scores[source]=100;assert.equal(combinePerception(scores).total,100)}
 near(combinePerception({noise:50,glare:50,sight:0}).total,75);
 near(combinePerception({noise:50,glare:50,sight:50}).total,87.5);
 assert.equal(combinePerception({noise:99,glare:99,sight:0}).total,100);
 assert.equal(combinePerception({noise:90,glare:90,sight:90}).total,100);
 assert.equal(combinePerception({noise:99,glare:0,sight:0}).total,99);
});

test('fair contributions sum to the authoritative total, preserve symmetry and diminishing overlap',()=>{
 for(let n=0;n<=100;n+=10)for(let g=0;g<=100;g+=10)for(let s=0;s<=100;s+=10){
  const p=combinePerception({noise:n,glare:g,sight:s});
  assert.ok(p.total>=Math.max(n,g,s)-1e-8&&p.total<=100);
  near(SENSES.reduce((sum,k)=>sum+p.contributions[k].points,0),p.total);
  near(SENSES.reduce((sum,k)=>sum+p.contributions[k].share,0),p.raw?100:0);
  for(const key of SENSES)assert.ok(p.contributions[key].points>=0&&p.contributions[key].points<=100);
 }
 const half=combinePerception({noise:50,glare:50,sight:0});near(half.contributions.noise.points,37.5);near(half.contributions.glare.share,50);
 const a=combinePerception({noise:20,glare:60,sight:80}),b=combinePerception({noise:80,glare:20,sight:60});
 near(a.total,b.total);near(a.contributions.noise.points,b.contributions.glare.points);
 assert.ok(combinePerception({noise:50,glare:50,sight:50}).total-half.total<25);
});

test('footsteps use measured mode ranges, metric distance, and report audible near crouching',()=>{
 const rates={};
 for(const mode of ['walk','crouch','sprint']){
  const w=hall(.9);w.data.player.crouched=mode==='crouch';w.advance(1/60,{forward:1,sprint:mode==='sprint'});
  assert.equal(w.hearing.action,mode);assert.ok(w.hearing.audible);assert.ok(w.data.hunt.noise>0);rates[mode]=w.hearing.rate;
  near(w.hearing.distance,Math.hypot(w.data.player.x-w.data.hunter.x,w.data.player.z-w.data.hunter.z)*1.5);
 }
 assert.ok(rates.sprint>rates.walk&&rates.walk>rates.crouch);
 const tenMetreRun=hall(10/1.5);tenMetreRun.advance(1/60,{forward:1,sprint:true});assert.equal(tenMetreRun.hearing.audible,true);assert.ok(tenMetreRun.hearing.rate>0);
 const beyondRunRange=hall(24.5/1.5);beyondRunRange.advance(1/60,{forward:1,sprint:true});assert.equal(beyondRunRange.hearing.audible,false);assert.equal(beyondRunRange.data.hunt.noise,0);
 const nearCrouch=hall(4/1.5);nearCrouch.data.player.crouched=true;nearCrouch.advance(1/60,{forward:1});assert.equal(nearCrouch.hearing.action,'crouch');assert.ok(nearCrouch.hearing.rate>0);
 const blocked=hall(8);Object.assign(blocked.data.player,{x:1.18,z:9.5,angle:Math.PI});blocked.advance(.1,{forward:1,sprint:true});
 assert.equal(blocked.hearing.action,'still');assert.equal(blocked.data.hunt.noise,0);
});

test('a closed door attenuates hearing and a ten-metre run remains audible through it',()=>{
 const w=hall();Object.assign(w.data.player,{x:11.5,z:6.5,angle:Math.PI/2});Object.assign(w.data.hunter,{x:11.5,z:9.5,angle:0});
 Object.assign(w.data.player,{z:3.5});w.data.hunter.z=10.5;
 w.advance(1/60,{forward:1,sprint:true});assert.equal(w.hearing.occluded,true);assert.equal(w.hearing.audible,true);assert.ok(w.hearing.range<24);assert.ok(w.data.hunt.noise>0);
 w.data.inventory.push('brass');w.data.unlocked.push('study');w.data.opened.push('study');w.advance(.05,{forward:1});
 assert.equal(w.hearing.occluded,false);assert.equal(w.hearing.audible,true);assert.ok(w.data.hunt.noise>0);
});

test('sight needs a clear view and accumulates at distance-based rates rather than instantly chasing',()=>{
 const readings=[];
 for(const metres of [2,5,10]){
  const w=hall(metres/1.5);w.data.player.angle=Math.PI;w.data.player.light=true;w.data.hunter.angle=Math.PI;w.target={...w.data.player};
  assert.equal(w.vision.visible,true);readings.push(w.vision.rate);w.advance(.1);
  assert.ok(w.data.hunt.sight>0&&w.data.hunt.sight<45);assert.notEqual(w.data.hunter.state,'chase');
 }
 assert.deepEqual(readings,[60,35,20]);
 const w=hall(4);w.data.hunter.angle=0;assert.equal(w.vision.visible,false);w.advance(.1);assert.equal(w.data.hunt.sight,0);
 Object.assign(w.data.player,{x:4.5,z:2.5});Object.assign(w.data.hunter,{x:6.5,z:2.5,angle:Math.PI});assert.equal(w.vision.visible,false,'the wardrobe blocks vision');
});

test('alert applies exactly 1.5x to all three live sensor rates and survives pause/save',()=>{
 const w=hall(.9);w.data.player.light=true;w.data.hunter.angle=Math.PI;w.target={...w.data.player};w.advance(1/60,{forward:1});
 const before={hearing:w.hearing.rate,vision:w.vision.rate,light:w.lightPerception.rate};w.data.hunt.alert=6;
 near(w.hearing.rate,before.hearing*ALERT_MULTIPLIER);near(w.vision.rate,before.vision*1.5);near(w.lightPerception.rate,before.light*1.5);
 const saved=w.snapshot(),restored=EscapeWorld.restore(saved);assert.deepEqual(restored.snapshot(),saved);assert.equal(restored.perceptionMultiplier,1.5);
 const alert=hall(8);alert.noise({...alert.data.hunter},20,45);assert.equal(alert.data.hunt.alert,6);assert.equal(alert.data.hunter.state,'investigate');
 assert.ok(alert.perception.total>=45&&alert.perception.total<100);
 const memory=hall(14);memory.data.hunt.noise=50;memory.data.hunt.glare=50;memory.advance(1/60);
 assert.equal(memory.perceptionMultiplier,1.5);assert.equal(memory.data.hunter.state,'patrol','alert alone does not reveal a new position');
});

test('solo difficulty zero removes sight but a thrown stone still sends the model to its impact',()=>{
 const w=hall(4);
 w.data.hunter.angle=Math.PI;
 assert.equal(w.vision.visible,true);
 w.setHunterDifficulty(0);
 assert.equal(w.vision.visible,false);
 const impact={x:10.5,z:9.5};
 w.noise(impact,20,0,'stone');
 assert.equal(w.data.hunter.state,'investigate');
 assert.deepEqual(w.target,impact);
 assert.ok(w.drainEvents().some(event=>event.type==='hunter-think'));
});

test('max difficulty can choose to chase a long tracked sighting but still respects cover',()=>{
 const w=hall(11);
 w.data.hunter.angle=Math.PI;
 w.target={...w.data.player};
 assert.equal(w.vision.visible,false);
 w.setHunterDifficulty(100);
 assert.equal(w.vision.visible,true);
 Object.assign(w.data.player,{x:11.5,z:3.5});
 Object.assign(w.data.hunter,{x:11.5,z:10.5,angle:-Math.PI/2});
 assert.equal(w.vision.visible,false,'closed study door blocks even maximum difficulty');
 Object.assign(w.data.player,{x:3.5,z:9.5});
 Object.assign(w.data.hunter,{x:14.5,z:9.5,angle:Math.PI});
 w.advance(1/60);
 assert.notEqual(w.data.hunter.state,'chase','a brief glimpse does not immediately lock on');
 w.data.hunt.sight=76;
 w.advance(1/60);
 assert.ok(w.data.hunt.sight<100);
 assert.equal(w.data.hunter.state,'chase');
 assert.ok(w.drainEvents().some(event=>event.type==='hunter-think'));
});

test('sound, torch, sight and multiple sub-100 clues can all cause the same authoritative chase transition',()=>{
 const sound=hall(8),at={...sound.data.hunter};sound.noise(at,20,100);
 assert.equal(sound.data.hunter.state,'chase');assert.equal(sound.perception.total,100);near(sound.target.x,at.x);near(sound.target.z,at.z);
 const light=hall(12);light.data.player.light=true;light.data.hunt.glare=99.4;light.advance(1/60);
 assert.equal(light.data.hunter.state,'chase');assert.equal(light.data.hunt.exposure,100);
 const sight=hall(4);sight.data.hunter.angle=Math.PI;sight.target={...sight.data.player};sight.data.hunt.sight=99.4;sight.advance(1/60);
 assert.equal(sight.data.hunter.state,'chase');assert.equal(sight.data.hunt.exposure,100);
 const mixed=hall(8);mixed.data.hunt.noise=90;mixed.data.hunt.glare=90;mixed.data.hunt.sight=90;mixed.data.player.light=true;mixed.advance(1/60);
 assert.ok(mixed.data.hunt.noise<100&&mixed.data.hunt.glare<100&&mixed.data.hunt.sight<100);
 assert.equal(mixed.data.hunter.state,'chase');assert.equal(mixed.perception.total,100);
});

test('a heard source directs decisions without revealing an unseen player, and lost contact becomes a search',()=>{
 const w=hall(8),sound={x:15.5,z:9.5};w.noise(sound,30,1000);
 assert.equal(w.data.hunter.state,'chase');near(w.target.x,sound.x);
 const original=w.data.player.x;Object.assign(w.data.player,{x:2.5,z:3.5});frames(w,1);
 assert.notEqual(w.target.x,w.data.player.x);assert.equal(original,3.5);
 frames(w,3);assert.ok(['search','patrol'].includes(w.data.hunter.state));assert.ok(w.perception.total<100);
});

test('standing is default, stance and sprint toggle mutually, leaving a cabinet and respawning stand up',()=>{
 const w=new EscapeWorld(42);assert.equal(w.movementMode,'walk');w.toggleCrouch();assert.equal(w.movementMode,'crouch');
 w.toggleSprint();assert.equal(w.movementMode,'sprint');assert.equal(w.data.player.crouched,false);w.toggleSprint();assert.equal(w.movementMode,'walk');
 w.toggleSprint();w.toggleCrouch();assert.equal(w.data.player.sprinting,false);assert.equal(w.movementMode,'crouch');
 Object.assign(w.data.player,{x:5.5,z:3.5,angle:-Math.PI/2});w.interact();assert.equal(w.data.hidden,'bed-hide');
 w.interact();assert.equal(w.movementMode,'walk');assert.equal(w.data.player.crouched,false);
 w.toggleCrouch();w.capture();w.nextNight();assert.equal(w.movementMode,'walk');
 const tired=hall(15);tired.toggleSprint();tired.data.player.stamina=1;tired.advance(.1,{forward:1});assert.equal(tired.movementMode,'recover');
 frames(tired,2.6,{forward:1});assert.equal(tired.data.player.sprinting,true);assert.equal(tired.movementMode,'sprint');
});

test('version 2 perception saves round-trip and reject legacy missing state',()=>{
 const current=new EscapeWorld(42).snapshot();assert.deepEqual(EscapeWorld.restore(current).snapshot(),current);
 const v1=structuredClone(current);v1.version=1;assert.throws(()=>EscapeWorld.restore(v1),/逃生存档/);
 for(const key of ['basement','abilities','interference','expansion','hunt','explored']){
  const old=structuredClone(current);delete old[key];assert.throws(()=>EscapeWorld.restore(old),/逃生存档/);
 }
 for(const key of ['pitch','sprinting','winded']){
  const old=structuredClone(current);delete old.player[key];assert.throws(()=>EscapeWorld.restore(old),/逃生存档/);
 }
 for(const mutate of [s=>s.hunt.noise=101,s=>s.hunt.sight=-1,s=>s.hunt.alert=6.1,s=>s.hunt.traces={noise:{x:-1,z:3}},s=>s.hunt.traces={noise:{x:3,z:3,secret:1}},s=>s.player.sprinting='yes',s=>{s.player.crouched=true;s.player.sprinting=true}]){
  const bad=new EscapeWorld(42).snapshot();mutate(bad);assert.throws(()=>EscapeWorld.restore(bad),/逃生存档/);
 }
});
