import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import { RunnerWorld, readRunRecord, isRunObstacle,weatherAt,nightAt } from '../src/runner/world.ts';
import {dogPose,chaserFrame} from '../src/runner/animation.ts';
import {RunnerRoute3D} from '../src/runner/route3d.ts';
import {RunnerTilt} from '../src/runner/tilt.ts';
import {NullEngine} from '@babylonjs/core/Engines/nullEngine.js';
import {Scene} from '@babylonjs/core/scene.js';
import {createRunnerSprite} from '../src/runner/actors2d.ts';

function run(world, seconds) { for (let i = 0; i < Math.round(seconds * 120); i++) world.advance(1 / 120); }
function collision(kind) {
  const world = new RunnerWorld(4); world.start();
  world.items = [{ id: 1, lane: 1, z: 5, kind, done: false }];
  return world;
}
test('ready, pause and resume freeze every simulation clock and input', () => {
  const w = new RunnerWorld(9); w.action('left'); run(w, 1); assert.equal(w.distance, 0); assert.equal(w.lane, 1);
  w.start(); run(w, .5); w.action('jump'); w.pause(); const snapshot = JSON.stringify(w);
  run(w, 30); w.action('right'); assert.equal(JSON.stringify(w), snapshot);
  w.resume(); run(w, .25); assert.ok(w.distance > 6); assert.ok(w.jump > 0);
});
test('lane bounds and smooth lane transitions are enforced', () => {
  const w = new RunnerWorld(); w.start(); for (let i=0;i<5;i++) w.action('left'); assert.equal(w.lane,0);
  run(w,.3); assert.ok(w.position < .01); for(let i=0;i<5;i++) w.action('right'); assert.equal(w.lane,2);
});
test('a box causes a recoverable stumble, a gap ends the run, and jumping clears either', () => {
  for (const kind of ['block','gap']) {
    const grounded = collision(kind); run(grounded,.5); assert.equal(grounded.phase,kind==='gap'?'caught':'running'); if(kind==='block')assert.ok(grounded.danger>0);
    const jumping = collision(kind); jumping.action('jump'); run(jumping,.5); assert.equal(jumping.phase,'running');
  }
});
test('beams require sliding; jumping cannot clear an overhead beam', () => {
  const slide=collision('beam'); slide.action('slide'); run(slide,.5); assert.equal(slide.phase,'running');
  const jump=collision('beam'); jump.action('jump'); run(jump,.5); assert.equal(jump.phase,'running');assert.ok(jump.danger>0);
});
test('coins collect once, and a safe lane avoids obstacles', () => {
  const coin=collision('coin'); run(coin,.6); assert.equal(coin.coins,1);
  const safe=collision('block'); safe.action('left'); run(safe,.6); assert.equal(safe.phase,'running');
});
test('corner inputs work only inside the signed window, and missed/wrong turns fail', () => {
  const w=new RunnerWorld(); w.start(); w.turns=[{z:30,direction:'left',taken:false}];
  w.action('left'); assert.equal(w.turnCount,0); w.distance=15; w.action('left'); assert.equal(w.turnCount,1); assert.equal(w.lane,1);
  const wrong=new RunnerWorld(); wrong.start(); wrong.turns=[{z:10,direction:'right',taken:false}]; wrong.action('left'); assert.equal(wrong.phase,'caught');
  const missed=new RunnerWorld(); missed.start(); missed.turns=[{z:1,direction:'left',taken:false}]; run(missed,.2); assert.equal(missed.phase,'caught');
});
test('long frame clamps and fixed ticks prevent hidden-tab fast forward and tunnelling', () => {
  const w=new RunnerWorld(); w.start(); w.advance(1000); assert.ok(w.distance < 1.5);
  const a=collision('block'), b=collision('block');
  for(let i=0;i<10;i++) a.advance(.05); run(b,.5); assert.equal(a.phase,b.phase); assert.ok(Math.abs(a.distance-b.distance)<.12);
});
function drive(w) {
  const turn=w.approachingTurn;if(turn&&turn.z-w.distance<=15)w.action(turn.direction);
  const next=w.items.filter(i=>isRunObstacle(i.kind)&&!i.done&&i.z>w.distance-1).sort((a,b)=>a.z-b.z)[0];
  if(!next)return;
  if(next.span===3){
    if(next.z-w.distance<w.speed*(next.kind==='beam'?.24:.42))w.action(next.kind==='beam'?'slide':'jump');
  }else if(next.z-w.distance<Math.max(14,w.speed*.6)){
    const blocked=w.items.filter(i=>isRunObstacle(i.kind)&&Math.abs(i.z-next.z)<.01).map(i=>i.lane);
    const safe=[0,1,2].find(lane=>!blocked.includes(lane));
    if(w.lane<safe)w.action('right');else if(w.lane>safe)w.action('left');
  }
}
test('40 seeded routes require jump/slide and remain solvable through all scenes with bounded memory',()=>{
 for(let seed=1;seed<=40;seed++){
  const w=new RunnerWorld(seed,'endless',seed%3);w.start();let forced=0;
  const ids=new Set();
  for(let tick=0;tick<18000&&w.phase==='running';tick++){
   for(const i of w.items.filter(i=>isRunObstacle(i.kind))){assert.ok(Math.min(i.z%180,180-i.z%180)>30);if(i.span===3&&!ids.has(i.id)){forced++;ids.add(i.id);}}
   drive(w);w.advance(1/120);
  }
  assert.equal(w.phase,'running',`seed ${seed}: ${w.reason} at ${w.distance}`);
  assert.ok(w.distance>3000);assert.ok(forced>15);assert.ok(w.items.length<45);assert.ok(w.turns.length<=2);
 }
});
test('1000m challenge stops for laughter and can continue in infinite mode',()=>{
 const w=new RunnerWorld();w.start();
 for(let tick=0;tick<15000&&w.phase==='running';tick++){drive(w);w.advance(1/120);}
 assert.equal(w.phase,'won');assert.equal(w.distance,1000);run(w,2);assert.equal(w.distance,1000);
 w.continue();w.advance(.1);assert.equal(w.phase,'running');assert.ok(w.distance>1000);
});
test('record parser rejects corrupt, old or non-finite records without touching other saves', () => {
  for(const raw of [null,'{','{}','{"version":1,"distance":-2,"coins":0,"score":0}','{"version":1,"distance":4.5,"coins":0,"score":0}','{"version":1,"distance":500,"coins":-1,"score":0}','{"version":9,"distance":5,"coins":3,"score":200}']) assert.deepEqual(readRunRecord(raw),{version:1,distance:0,coins:0,score:0});
  assert.deepEqual(readRunRecord('{"version":1,"distance":1000,"coins":9,"score":10450,"extra":"discard"}'),{version:1,distance:1000,coins:9,score:10450});
});
test('generated realistic scenery, stone and transparent props retain their native PNG bytes', () => {
  const manifest=JSON.parse(fs.readFileSync(new URL('../public/assets/runner/manifest.json',import.meta.url),'utf8'));
  assert.equal(manifest.nativeBytes,true);assert.equal(manifest.assets.length,12);
  for(const asset of manifest.assets) {
    const bytes=fs.readFileSync(new URL('../public'+asset.url,import.meta.url));
    assert.equal(bytes.readUInt32BE(16),asset.width);assert.equal(bytes.readUInt32BE(20),asset.height);
    assert.equal(bytes.length,asset.bytes);assert.equal(bytes[25],asset.pngColorType);
    assert.equal(createHash('sha256').update(bytes).digest('hex'),asset.sha256);
  }
  assert.equal(manifest.assets.find(a=>a.url.endsWith('obstacles-v1.png')).pngColorType,6);
});
test('a second stumble during pursuit is fatal; clean running lets the pursuer fall back', () => {
  const w=collision('block');run(w,.5);assert.ok(w.danger>0);assert.equal(w.phase,'running');
  run(w,1.5);w.items=[{id:2,z:w.distance+5,lane:1,kind:'beam',done:false}];run(w,.6);
  assert.equal(w.phase,'caught');assert.match(w.reason,/恐怖奶蛙/);
  const recovery=collision('block');run(recovery,.5);recovery.items=[];run(recovery,9);assert.equal(recovery.danger,0);assert.equal(recovery.phase,'running');
});
test('magnet collects coins across lanes and shield absorbs exactly one hit', () => {
  const w=collision('magnet');w.items=[{id:1,z:1,lane:1,kind:'magnet',done:false},{id:2,z:8,lane:0,kind:'coin',done:false}];run(w,.2);
  assert.equal(w.coins,1);assert.ok(w.magnet>9);
  const shield=collision('shield');run(shield,.5);assert.ok(shield.shield>0);
  shield.items=[{id:3,z:shield.distance+4,lane:1,kind:'gap',done:false}];run(shield,.5);
  assert.equal(shield.phase,'running');assert.equal(shield.shield,0);assert.equal(shield.danger,0);
});
test('boost speeds up, clears hazards, turns automatically and then expires', () => {
  const w=collision('boost');w.turns=[{z:25,direction:'right',taken:false}];
  w.items.push({id:2,z:15,lane:1,kind:'gap',done:false});run(w,1.5);
  assert.equal(w.phase,'running');assert.equal(w.turnCount,1);assert.ok(w.speed>18);
  w.items=[];run(w,4);assert.equal(w.boost,0);
});
test('coin streak increases coin score and expires after four seconds without a coin', () => {
  const w=collision('coin');w.items=Array.from({length:10},(_,id)=>({id,z:1,lane:1,kind:'coin',done:false}));run(w,.2);
  assert.equal(w.coins,10);assert.equal(w.multiplier,2);assert.equal(w.coinScore,550);
  run(w,4.1);assert.equal(w.multiplier,1);
});
test('infinite mode starts without the 1000m stop and every effect freezes on pause', () => {
  const w=new RunnerWorld(9,'endless');assert.ok(w.endless);w.start();w.magnet=8;w.shield=12;w.boost=4;w.danger=6;
  w.pause();const state=JSON.stringify(w);run(w,20);assert.equal(JSON.stringify(w),state);
  w.resume();run(w,.1);assert.ok(w.magnet<8);assert.ok(w.shield<12);
});
test('dog gallop uses eight distinct frames, real jump/crouch poses and a frozen clock', () => {
  const w=new RunnerWorld();w.start();const frames=new Set();
  for(let i=0;i<70;i++){w.advance(1/120);const pose=dogPose(w,false);assert.equal(pose.sheet,'run');frames.add(pose.frame);}
  assert.equal(frames.size,8);w.action('jump');assert.deepEqual(dogPose(w,false),{sheet:'actions',frame:1});
  run(w,.8);assert.equal(dogPose(w,false).frame,2);run(w,.2);w.action('slide');assert.equal(dogPose(w,false).frame,3);
  w.pause();const gait=w.gait;run(w,4);assert.equal(w.gait,gait);
  const still=new RunnerWorld();still.start();assert.deepEqual(dogPose(still,true),{sheet:'actions',frame:0});
});

test('full-width log, gap and low gate cannot be bypassed by any lane or by changing lanes',()=>{
 for(const kind of ['block','gap','beam'])for(const lane of [0,1,2]){
  const w=collision(kind);w.lane=lane;w.position=lane;w.items[0].span=3;w.action(lane===0?'right':'left');run(w,.5);assert.equal(w.phase,'caught',`${kind} lane ${lane}`);
  const safe=collision(kind);safe.lane=lane;safe.position=lane;safe.items[0].span=3;safe.action(kind==='beam'?'slide':'jump');run(safe,.5);assert.equal(safe.phase,'running');
 }
});
test('scene selection and 450m transitions cover distinct route themes',()=>{
 const w=new RunnerWorld(1,'endless',1);assert.equal(w.sceneIndex,1);w.distance=450;assert.equal(w.sceneIndex,2);w.distance=900;assert.equal(w.sceneIndex,0);
 const temple=new RunnerWorld(1,'endless',1);assert.ok(temple.items.some(i=>i.span===3&&i.kind==='block'));assert.ok(temple.items.some(i=>i.span===3&&i.kind==='beam'));
});
test('pursuer animation always uses rear-view frames while chasing',()=>{
 const w=new RunnerWorld();w.start();const frames=new Set();for(let i=0;i<100;i++){w.advance(1/120);frames.add(chaserFrame(w,false));}
 assert.deepEqual([...frames].sort((a,b)=>a-b),[4,12]);assert.equal(chaserFrame(w,true),4);
});
test('double jump preserves height, adds lift, rejects a third jump and resets on landing',()=>{
 const w=new RunnerWorld();w.start();w.items=[];w.action('jump');run(w,.35);const height=w.jumpHeight;w.action('jump');assert.equal(w.jumpCount,2);assert.equal(w.jumpHeight,height);const remaining=w.jump;w.action('jump');assert.equal(w.jump,remaining);run(w,.35);assert.ok(w.jumpHeight>1.5);run(w,2);assert.equal(w.jumpCount,0);assert.equal(w.jumpHeight,0);
});
test('new lethal hazards enter capture on the first collision with an explicit cause',()=>{
 for(const kind of ['spikes','boulder','fire','cliff']){const w=collision(kind);run(w,.6);assert.equal(w.phase,'caught');assert.ok(w.reason);assert.ok(w.deathHint);const distance=w.distance;run(w,1);assert.equal(w.distance,distance);assert.equal(w.phase,'caught');}
});
test('capture pauses independently and settles only after the lift animation or skip',()=>{
 const w=collision('spikes');run(w,.5);w.pause();const snapshot=JSON.stringify(w);run(w,10);assert.equal(JSON.stringify(w),snapshot);w.resume();assert.equal(w.phase,'caught');run(w,3);assert.equal(w.phase,'lost');
 const skip=collision('fire');run(skip,.5);skip.finishCapture();assert.equal(skip.phase,'lost');
});
test('weather is reproducible and night begins at 1000m then alternates every 500m',()=>{
 const values=new Set();for(let seed=0;seed<20;seed++)for(let d=0;d<6000;d+=300){values.add(weatherAt(seed,d));assert.equal(weatherAt(seed,d),weatherAt(seed,d+1));}
 assert.deepEqual([...values].sort(),['rain','snow','sunny']);for(const [d,value]of [[999,false],[1000,true],[1499,true],[1500,false],[2000,true]])assert.equal(nightAt(d),value);
});
test('3D route has continuous rounded quarter-turns and bounded corner history',()=>{
 const route=new RunnerRoute3D();route.sync([{z:180,direction:'right'},{z:360,direction:'left'}],0);
 assert.equal(route.sample(160).heading,0);assert.ok(Math.abs(route.sample(200).heading-Math.PI/2)<1e-8);
 for(const at of [168,180,192,348,360,372]){const a=route.sample(at-.001),b=route.sample(at+.001);assert.ok(Math.hypot(a.x-b.x,a.z-b.z)<.01);}
 for(let d=540;d<10000;d+=180)route.sync([{z:d,direction:'left'}],d);assert.ok(route.storedCorners<=4);
});
test('tilt calibration supports portrait/landscape, hysteresis and unavailable sensors',()=>{
 const tilt=new RunnerTilt();assert.equal(tilt.sample(null,0,0),null);assert.equal(tilt.sample(0,0,0),1);
 for(let i=0;i<12;i++)tilt.sample(0,-25,0);assert.equal(tilt.sample(0,-25,0),0);for(let i=0;i<15;i++)tilt.sample(0,0,0);assert.equal(tilt.sample(0,0,0),1);
 assert.equal(tilt.sample(30,0,90),1);for(let i=0;i<12;i++)tilt.sample(55,0,90);assert.equal(tilt.sample(55,0,90),2);tilt.calibrate();assert.equal(tilt.sample(55,0,90),1);
});
test('runner characters use camera-facing flat drawings in the 3D scene',()=>{
 const engine=new NullEngine();const scene=new Scene(engine);try{const dog=createRunnerSprite(scene,'runner-milk-dog-2d',3.9);const frog=createRunnerSprite(scene,'runner-milk-frog-2d',4.8);assert.ok(dog.root.billboardMode>0);assert.ok(frog.root.billboardMode>0);assert.equal(dog.root.getTotalVertices(),4);assert.equal(frog.root.getTotalVertices(),4);assert.ok(dog.root.getBoundingInfo().boundingBox.extendSize.x>1.9);}finally{scene.dispose();engine.dispose();}
});
