import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EscapeWorld,PROPS,VALVE_ORDER,roomAt} from '../src/escape/world.ts';

const frames=(w,seconds,input={})=>{for(let n=0;n<Math.ceil(seconds*60);n++)w.advance(1/60,input);};
const face=(w,id)=>{
  const p=PROPS.find(p=>p.id===id);
  Object.assign(w.data.player,{x:p.x,z:p.z+1,angle:-Math.PI/2,pitch:0});
};
const powered=()=>{
  const w=new EscapeWorld(42);w.data.inventory=['fuse','handwheel'];
  w.data.searched=['laundry-drawer','changing-drawer'];w.data.power=true;return w;
};

test('v2 restore requires the live basement systems and rejects invalid patrol or hiding references',()=>{
  const base=new EscapeWorld(42).snapshot();
  for(const mutate of [
    s=>{s.version=1;},
    s=>{delete s.basement;},
    s=>{delete s.abilities;},
    s=>{s.pursuit.patrolIndex=99;},
    s=>{s.pursuit.seenHide='missing-wardrobe';},
  ]){
    const invalid=structuredClone(base);mutate(invalid);
    assert.throws(()=>EscapeWorld.restore(invalid),/逃生存档/);
  }
});

test('new room doors do not shelter the player from a hunter investigating a real sound',()=>{
  for(const [door,room,x] of [['changing','旧更衣室',4.5],['boiler','锅炉房',11.5]]){
    const w=new EscapeWorld(42);w.data.elapsed=25;w.data.unlocked.push(door);
    w.data.hidden='bed-hide';Object.assign(w.data.player,{x:5.5,z:2.58,light:false});
    Object.assign(w.data.hunter,{x,z:9.5,state:'patrol'});
    w.noise({x,z:21.5},20);assert.equal(w.data.hunter.state,'investigate');
    let entered=false;
    for(let n=0;n<1800&&!entered;n++){
      w.advance(1/60);entered=roomAt(w.data.hunter)===room;
      assert.equal(w.data.phase,'playing');
    }
    assert.ok(entered,`hunter must physically cross the ${door} threshold`);
    assert.ok(w.data.opened.includes(door),'hunter opens the unlocked closed door');
    EscapeWorld.restore(w.snapshot());
  }
});

test('draining cannot bypass handwheel, supply or an incomplete pressure sequence',()=>{
  const w=powered();face(w,'drain');w.interact();assert.equal(w.data.drained,false);
  w.data.expansion.valves=[VALVE_ORDER[0],VALVE_ORDER[1]];w.interact();assert.equal(w.data.drained,false);
  w.data.expansion.valves=[...VALVE_ORDER];w.data.inventory=w.data.inventory.filter(i=>i!=='handwheel');
  w.interact();assert.equal(w.data.drained,false);
  w.data.inventory.push('handwheel');w.data.power=false;w.interact();assert.equal(w.data.drained,false);
  w.data.power=true;w.interact();assert.equal(w.data.drained,true);
  EscapeWorld.restore(w.snapshot());
});

test('pressure controls without electricity produce neither progress nor a false success',()=>{
  const w=powered();w.data.power=false;face(w,VALVE_ORDER[0]);w.interact();
  assert.deepEqual(w.data.expansion.valves,[]);assert.match(w.message,/供电/);
  assert.equal(w.drainEvents().filter(e=>e.type==='noise').length,0);
});

test('capture and a new night preserve a partially solved pressure puzzle and its real items',()=>{
  const w=powered();face(w,VALVE_ORDER[0]);w.interact();w.capture();w.nextNight();
  assert.equal(w.data.phase,'playing');assert.equal(w.data.captures,1);
  assert.deepEqual(w.data.expansion.valves,[VALVE_ORDER[0]]);
  assert.ok(w.data.inventory.includes('handwheel'));
  assert.deepEqual(EscapeWorld.restore(w.snapshot()).snapshot(),w.snapshot());
});

test('glass does not repeatedly ring while standing on it and rearms only after leaving',()=>{
  const w=new EscapeWorld(42);w.data.elapsed=25;
  Object.assign(w.data.player,{x:6.9,z:9.5,angle:0,light:false});
  Object.assign(w.data.hunter,{x:20.5,z:3.5});
  frames(w,.3,{forward:1});assert.equal(w.drainEvents().filter(e=>e.type==='noise').length,1);
  frames(w,.3);assert.equal(w.drainEvents().filter(e=>e.type==='noise').length,0);
  frames(w,.55,{forward:-1});assert.equal(w.drainEvents().filter(e=>e.type==='noise').length,0);
  frames(w,.55,{forward:1});assert.equal(w.drainEvents().filter(e=>e.type==='noise').length,1);
  const quiet=new EscapeWorld(42);quiet.data.elapsed=25;
  Object.assign(quiet.data.player,{x:6.9,z:9.5,angle:0,crouched:true,light:false});
  Object.assign(quiet.data.hunter,{x:13.5,z:14.5,angle:0});
  frames(quiet,.95,{forward:1});assert.ok(quiet.data.player.x>7.5);
  assert.equal(quiet.drainEvents().filter(e=>e.type==='noise').length,0);
  assert.equal(quiet.data.hunter.state,'patrol');
});

test("the HUD goal walks the whole escape chain in plain language", () => {
  const w = new EscapeWorld(); const d = w.data;
  const steps = [];
  const record = () => { const goal = w.nextGoal; assert.ok(goal.length > 4); if (steps.at(-1) !== goal) steps.push(goal); };
  record(); assert.match(w.nextGoal, /床头抽屉/);
  d.inventory.push("brass"); record(); assert.match(w.nextGoal, /档案室/);
  d.opened.push("study"); record(); d.inventory.push("cellar"); record(); assert.match(w.nextGoal, /保险丝/);
  d.inventory.push("fuse"); record(); d.power = true; record(); assert.match(w.nextGoal, /检修门/);
  d.opened.push("cellar"); record(); d.inventory.push("cutters"); record(); assert.match(w.nextGoal, /手轮/);
  d.inventory.push("handwheel"); record(); assert.match(w.nextGoal, /冷水/);
  d.expansion.valves = ["valve-cold", "valve-return", "valve-vent"]; record(); assert.match(w.nextGoal, /排水阀/);
  d.drained = true; record(); d.inventory.push("relay"); record(); d.basement.power = true; record(); assert.match(w.nextGoal, /污水闸/);
  d.basement.sluice = true; record(); assert.match(w.nextGoal, /铁网/);
  assert.equal(new Set(steps).size, steps.length);
});
