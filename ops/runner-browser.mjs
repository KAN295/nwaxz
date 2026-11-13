// Start pnpm dev first. Optional QA tooling lives outside project dependencies.
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
const out = new URL('../.local/runner-qa/', import.meta.url);
await fs.mkdir(out, {recursive:true});
const base=process.env.RUNNER_QA_BASE ?? 'http://127.0.0.1:5173';
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH,headless:true,args:['--disable-gpu']});
const errors=[];
try {
 const context=await browser.newContext({viewport:{width:1280,height:800},reducedMotion:'reduce'});
 const page=await context.newPage(); page.on('pageerror',e=>errors.push(e.message));
 await page.goto(base); await page.locator('#runner').click();
 await page.getByRole('button',{name:'开始游戏'}).waitFor();
 await page.screenshot({path:fileURLToPath(new URL('desktop-ready.png',out))});
 await page.getByRole('button',{name:'遗迹长廊',exact:true}).click();await page.waitForTimeout(100);assert.equal(await page.locator('#runner-scene').textContent(),'遗迹长廊');await page.screenshot({path:fileURLToPath(new URL('temple-ready.png',out))});
 await page.getByRole('button',{name:'矿洞轨道',exact:true}).click();await page.waitForTimeout(100);assert.equal(await page.locator('#runner-scene').textContent(),'矿洞轨道');await page.screenshot({path:fileURLToPath(new URL('mine-ready.png',out))});
 await page.getByRole('button',{name:'峡谷水渠',exact:true}).click();
 await page.getByRole('button',{name:'开始游戏'}).click(); await page.waitForTimeout(500);
 await page.keyboard.press('ArrowLeft'); await page.keyboard.press('ArrowUp');
 await page.keyboard.press('Escape'); await page.getByRole('heading',{name:'暂停',exact:true}).waitFor();
 const distance=await page.locator('#run-distance').textContent(); await page.waitForTimeout(400); assert.equal(await page.locator('#run-distance').textContent(),distance);
 await page.getByRole('button',{name:'继续',exact:true}).click(); await page.keyboard.press('p');
 await page.getByRole('button',{name:'返回模式选择',exact:true}).first().click(); await page.locator('#bath').waitFor();
 await page.locator('#bath').click(); await page.locator('#normal').waitFor(); await page.locator('#hub-back').click();
 await page.locator('#runner').click(); await page.getByRole('button',{name:'开始游戏'}).waitFor();
 await page.evaluate(async()=>{
   const {RunnerGame}=await import('/src/runner/game.ts'); const {AudioManager}=await import('/src/audio.ts'); const {defaultSettings}=await import('/src/settings.ts');
   // An isolated QA instance allows deterministic clock/state checks without shipping a debug API.
   document.querySelector('[data-run=exit]').click();
   const settings={...defaultSettings(),music:false,sound:false,reducedMotion:true};
   window.qaAudio=new AudioManager(settings); window.qaGame=new RunnerGame(document.querySelector('#app'),window.qaAudio,settings,()=>{window.qaGame.destroy();});
 });
 await page.getByRole('button',{name:'千米挑战',exact:true}).click();
 await page.getByRole('button',{name:'开始游戏'}).click();
 await page.evaluate(()=>{
  const w=window.qaGame.world;
  for(let i=0;i<16000&&w.phase==='running';i++){
   const t=w.approachingTurn;if(t&&t.z-w.distance<=15)w.action(t.direction);
   const o=w.items.filter(i=>['block','gap','beam'].includes(i.kind)&&!i.done&&i.z>w.distance-1).sort((a,b)=>a.z-b.z)[0];
   if(o?.span===3){if(o.z-w.distance<w.speed*(o.kind==='beam'?.24:.42))w.action(o.kind==='beam'?'slide':'jump');}
   else if(o&&o.z-w.distance<Math.max(14,w.speed*.6)){const blocked=w.items.filter(i=>['block','gap','beam'].includes(i.kind)&&Math.abs(i.z-o.z)<.01).map(i=>i.lane);const lane=[0,1,2].find(l=>!blocked.includes(l));if(w.lane<lane)w.action('right');else if(w.lane>lane)w.action('left');}
   w.advance(1/120);
  }
 });
 await page.getByRole('heading',{name:'挑战完成'}).waitFor();
 await page.screenshot({path:fileURLToPath(new URL('desktop-victory.png',out))});
 assert.equal(await page.locator('.runner-laugh').count(),1);
 assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('nwaxz-runner-record-v1')).distance),1000);
 await page.getByRole('button',{name:'继续无限模式'}).click(); await page.waitForTimeout(250); assert.ok(await page.evaluate(()=>window.qaGame.world.distance)>1000);
 await page.evaluate(()=>{window.qaGame.world.items=[{id:999,z:window.qaGame.world.distance+1,lane:1,kind:'gap',done:false}];window.qaGame.world.shield=0;window.qaGame.world.boost=0;window.qaGame.world.lane=1;window.qaGame.world.position=1;});
 await page.getByRole('heading',{name:'游戏结束'}).waitFor();
 await page.getByRole('button',{name:'再跑一次',exact:true}).click(); await page.waitForTimeout(100);
 await page.evaluate(()=>{const g=window.qaGame,w=g.world;if(!g.runArt.src.endsWith('/milk-dog-run-v2.png')||!g.chaserArt.src.endsWith('/haunted-frog-directions-walk-v1.webp'))throw new Error('player/chaser identity mismatch');w.items=['magnet','shield','boost'].map((kind,id)=>({id,z:w.distance+1,lane:w.lane,kind,done:false}));});
 await page.locator('.runner-effect-boost').waitFor();assert.equal(await page.locator('.runner-effect').count(),3);
 await page.evaluate(()=>{const w=window.qaGame.world;window.qaTurns=w.turnCount;w.turns=[{z:w.distance+10,direction:'right',taken:false}];});await page.waitForTimeout(200);
 assert.equal(await page.evaluate(()=>window.qaGame.world.turnCount),await page.evaluate(()=>window.qaTurns+1));
 await page.screenshot({path:fileURLToPath(new URL('desktop-powerups.png',out))});
 await page.evaluate(()=>{const w=window.qaGame.world;w.boost=0;w.shield=0;w.danger=0;w.jump=0;w.slide=0;w.turns=[];w.items=[{id:9999,z:w.distance+10,lane:1,kind:'beam',span:3,done:false}];});
 await page.locator('.runner-action-cue:not([hidden])').waitFor();assert.match(await page.locator('.runner-action-cue').textContent(),/下滑/);await page.screenshot({path:fileURLToPath(new URL('mandatory-gate.png',out))});
 await page.keyboard.press('ArrowDown');await page.waitForTimeout(1000);assert.equal(await page.evaluate(()=>window.qaGame.world.phase),'running');
 await page.evaluate(()=>{const w=window.qaGame.world;w.items=[];w.turns=[{z:w.distance+35,direction:'left',taken:false}];});
 await page.locator('.runner-turn:not([hidden])').waitFor();assert.match(await page.locator('.runner-turn').textContent(),/左转/);await page.screenshot({path:fileURLToPath(new URL('turn-warning.png',out))});
 await page.evaluate(()=>{const w=window.qaGame.world;w.turns[0].z=w.distance+12;});await page.waitForTimeout(50);await page.keyboard.press('ArrowLeft');await page.waitForTimeout(100);await page.screenshot({path:fileURLToPath(new URL('turn-camera.png',out))});assert.equal(await page.locator('.runner-screen.runner-turning').count(),1);
 await page.evaluate(()=>{const w=window.qaGame.world;w.items=[];w.turns=[];w.danger=8;w.hitAt=w.elapsed;});await page.waitForTimeout(100);await page.screenshot({path:fileURLToPath(new URL('rear-chase.png',out))});

 await page.evaluate(()=>window.dispatchEvent(new Event('blur'))); await page.getByRole('heading',{name:'暂停',exact:true}).waitFor();
 await page.evaluate(()=>window.qaGame.destroy()); await context.close();
 const mobile=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,deviceScaleFactor:2});
 const p=await mobile.newPage();p.on('pageerror',e=>errors.push(e.message));await p.goto(base);
 await p.locator('#runner').waitFor(); assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth),390);
 await p.screenshot({path:fileURLToPath(new URL('mobile-home.png',out))});
 await p.locator('#runner').click();await p.getByRole('button',{name:'开始游戏'}).waitFor();
 await p.screenshot({path:fileURLToPath(new URL('mobile-ready.png',out))});
 await p.evaluate(async()=>{
  const {RunnerGame}=await import('/src/runner/game.ts');const {AudioManager}=await import('/src/audio.ts');const {defaultSettings}=await import('/src/settings.ts');
  document.querySelector('[data-run=exit]').click();const settings={...defaultSettings(),sound:false,music:false};
  window.qaAudio=new AudioManager(settings);window.qaGame=new RunnerGame(document.querySelector('#app'),window.qaAudio,settings,()=>window.qaGame.destroy());
 });
 await p.getByRole('button',{name:'开始游戏'}).click();
 const cdp=await mobile.newCDPSession(p);await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:180,y:450}]});await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:80,y:450}]});await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
 assert.equal(await p.evaluate(()=>window.qaGame.world.lane),0);
 await p.getByRole('button',{name:'跳跃',exact:true}).click();assert.ok(await p.evaluate(()=>window.qaGame.world.jump)>0);await p.waitForTimeout(500);
 await p.screenshot({path:fileURLToPath(new URL('mobile-running.png',out))});
 await p.getByRole('button',{name:'暂停跑酷'}).click();await p.getByRole('heading',{name:'暂停',exact:true}).waitFor();
 await p.setViewportSize({width:844,height:390});await p.screenshot({path:fileURLToPath(new URL('mobile-landscape.png',out))});
 assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth),844);
 assert.deepEqual(errors,[]); console.log('PASS desktop/mobile entry, keyboard, touch, pause, blur, three scenes, full-width gate, rear chase, stronger turn cue/camera, dog/chaser identity, powerups, auto-turn, 1000m laugh, endless, collision, restart, persistence; page errors: 0');
 await fs.writeFile(new URL('result.json',out),JSON.stringify({passed:true,errors},null,2));
} finally {await browser.close();}
