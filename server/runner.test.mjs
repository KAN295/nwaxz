import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import { RunnerWorld, readRunRecord } from '../src/runner/world.ts';

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
test('blocks and gaps kill a grounded runner but a timed jump clears either', () => {
  for (const kind of ['block','gap']) {
    const grounded = collision(kind); run(grounded,.5); assert.equal(grounded.phase,'lost');
    const jumping = collision(kind); jumping.action('jump'); run(jumping,.5); assert.equal(jumping.phase,'running');
  }
});
test('beams require sliding; jumping cannot clear an overhead beam', () => {
  const slide=collision('beam'); slide.action('slide'); run(slide,.5); assert.equal(slide.phase,'running');
  const jump=collision('beam'); jump.action('jump'); run(jump,.5); assert.equal(jump.phase,'lost');
});
test('coins collect once, and a safe lane avoids obstacles', () => {
  const coin=collision('coin'); run(coin,.6); assert.equal(coin.coins,1);
  const safe=collision('block'); safe.action('left'); run(safe,.6); assert.equal(safe.phase,'running');
});
test('corner inputs work only inside the signed window, and missed/wrong turns fail', () => {
  const w=new RunnerWorld(); w.start(); w.turns=[{z:30,direction:'left',taken:false}];
  w.action('left'); assert.equal(w.turnCount,0); w.distance=15; w.action('left'); assert.equal(w.turnCount,1); assert.equal(w.lane,1);
  const wrong=new RunnerWorld(); wrong.start(); wrong.turns=[{z:10,direction:'right',taken:false}]; wrong.action('left'); assert.equal(wrong.phase,'lost');
  const missed=new RunnerWorld(); missed.start(); missed.turns=[{z:1,direction:'left',taken:false}]; run(missed,.2); assert.equal(missed.phase,'lost');
});
test('long frame clamps and fixed ticks prevent hidden-tab fast forward and tunnelling', () => {
  const w=new RunnerWorld(); w.start(); w.advance(1000); assert.ok(w.distance < 1.3);
  const a=collision('block'), b=collision('block');
  for(let i=0;i<10;i++) a.advance(.05); run(b,.5); assert.equal(a.phase,b.phase); assert.ok(Math.abs(a.distance-b.distance)<.12);
});
test('seeded routes have a safe lane, no hazards around corners and bounded memory', () => {
  for(let seed=1;seed<=40;seed++) {
    const w=new RunnerWorld(seed); w.start(); w.endless=true;
    for(let tick=0;tick<18000 && w.phase==='running';tick++) {
      const turn=w.approachingTurn;
      if(turn && turn.z-w.distance<=15) w.action(turn.direction);
      const hazard=w.items.find(item=>item.kind!=='coin' && item.z>w.distance && item.z-w.distance<12);
      if(hazard) { const safe=(hazard.lane+1)%3; if(w.lane<safe) w.action('right'); else if(w.lane>safe) w.action('left'); }
      for(const item of w.items.filter(i=>i.kind!=='coin')) assert.ok(Math.min(item.z%180,180-item.z%180)>30);
      w.advance(1/120);
    }
    assert.equal(w.phase,'running',`seed ${seed} has an unplayable route: ${w.reason}`);
    assert.ok(w.distance>3000); assert.ok(w.items.length<35); assert.ok(w.turns.length<=2);
  }
});
test('1000m milestone stops for the celebration and endless continuation retains score', () => {
  const w=new RunnerWorld(); w.start();
  for(let tick=0;tick<15000 && w.phase==='running';tick++) {
    const turn=w.approachingTurn; if(turn && turn.z-w.distance<=15) w.action(turn.direction);
    const obstacle=w.items.find(i=>i.kind!=='coin' && i.z>w.distance && i.z-w.distance<12);
    if(obstacle) { const safe=(obstacle.lane+1)%3; if(w.lane<safe) w.action('right'); else if(w.lane>safe) w.action('left'); }
    w.advance(1/120);
  }
  assert.equal(w.phase,'won'); assert.equal(w.distance,1000); run(w,2); assert.equal(w.distance,1000);
  w.continue(); w.advance(.1); assert.equal(w.phase,'running'); assert.ok(w.distance>1000); assert.ok(w.endless);
});
test('record parser rejects corrupt, old or non-finite records without touching other saves', () => {
  for(const raw of [null,'{','{}','{"version":1,"distance":-2,"coins":0,"score":0}','{"version":1,"distance":4.5,"coins":0,"score":0}','{"version":1,"distance":500,"coins":-1,"score":0}','{"version":9,"distance":5,"coins":3,"score":200}']) assert.deepEqual(readRunRecord(raw),{version:1,distance:0,coins:0,score:0});
  assert.deepEqual(readRunRecord('{"version":1,"distance":1000,"coins":9,"score":10450,"extra":"discard"}'),{version:1,distance:1000,coins:9,score:10450});
});
test('generated realistic scenery, stone and transparent props retain their native PNG bytes', () => {
  const manifest=JSON.parse(fs.readFileSync(new URL('../public/assets/runner/manifest.json',import.meta.url),'utf8'));
  assert.equal(manifest.nativeBytes,true);assert.equal(manifest.assets.length,3);
  for(const asset of manifest.assets) {
    const bytes=fs.readFileSync(new URL('../public'+asset.url,import.meta.url));
    assert.equal(bytes.readUInt32BE(16),asset.width);assert.equal(bytes.readUInt32BE(20),asset.height);
    assert.equal(bytes.length,asset.bytes);assert.equal(bytes[25],asset.pngColorType);
    assert.equal(createHash('sha256').update(bytes).digest('hex'),asset.sha256);
  }
  assert.equal(manifest.assets.find(a=>a.url.endsWith('obstacles-v1.png')).pngColorType,6);
});
