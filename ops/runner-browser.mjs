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
 await page.getByRole('button',{name:'开始逃亡'}).waitFor();
 await page.screenshot({path:fileURLToPath(new URL('desktop-ready.png',out))});
 await page.getByRole('button',{name:'开始逃亡'}).click(); await page.waitForTimeout(500);
 await page.keyboard.press('ArrowLeft'); await page.keyboard.press('ArrowUp');
 await page.keyboard.press('Escape'); await page.getByRole('heading',{name:'已暂停',exact:true}).waitFor();
 const distance=await page.locator('#run-distance').textContent(); await page.waitForTimeout(400); assert.equal(await page.locator('#run-distance').textContent(),distance);
 await page.getByRole('button',{name:'继续逃亡',exact:true}).click(); await page.keyboard.press('p');
 await page.getByRole('button',{name:'返回模式选择',exact:true}).first().click(); await page.locator('#bath').waitFor();
 await page.locator('#bath').click(); await page.locator('#normal').waitFor(); await page.locator('#hub-back').click();
 await page.locator('#runner').click(); await page.getByRole('button',{name:'开始逃亡'}).waitFor();
 await page.evaluate(async()=>{
   const {RunnerGame}=await import('/src/runner/game.ts'); const {AudioManager}=await import('/src/audio.ts'); const {defaultSettings}=await import('/src/settings.ts');
   // An isolated QA instance allows deterministic clock/state checks without shipping a debug API.
   document.querySelector('[data-run=exit]').click();
   const settings={...defaultSettings(),music:false,sound:false,reducedMotion:true};
   window.qaAudio=new AudioManager(settings); window.qaGame=new RunnerGame(document.querySelector('#app'),window.qaAudio,settings,()=>{window.qaGame.destroy();});
 });
 await page.getByRole('button',{name:'开始逃亡'}).click();
 await page.evaluate(()=>{
  const w=window.qaGame.world;
  for(let i=0;i<16000&&w.phase==='running';i++){
   const t=w.approachingTurn;if(t&&t.z-w.distance<=15)w.action(t.direction);
   const o=w.items.find(i=>i.kind!=='coin'&&i.z>w.distance&&i.z-w.distance<12);
   if(o){const lane=(o.lane+1)%3;if(w.lane<lane)w.action('right');else if(w.lane>lane)w.action('left');}
   w.advance(1/120);
  }
 });
 await page.getByRole('heading',{name:'笑着跑出浴场！'}).waitFor();
 await page.screenshot({path:fileURLToPath(new URL('desktop-victory.png',out))});
 assert.equal(await page.locator('.runner-laugh').count(),1);
 assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('nwaxz-runner-record-v1')).distance),1000);
 await page.getByRole('button',{name:'继续 · 无尽逃亡'}).click(); await page.waitForTimeout(250); assert.ok(await page.evaluate(()=>window.qaGame.world.distance)>1000);
 await page.evaluate(()=>{window.qaGame.world.items=[{id:999,z:window.qaGame.world.distance+1,lane:1,kind:'block',done:false}];window.qaGame.world.lane=1;window.qaGame.world.position=1;});
 await page.getByRole('heading',{name:'再跳远一点'}).waitFor();
 await page.getByRole('button',{name:'重新出发',exact:true}).click(); await page.waitForTimeout(100);
 await page.evaluate(()=>window.dispatchEvent(new Event('blur'))); await page.getByRole('heading',{name:'已暂停',exact:true}).waitFor();
 await page.evaluate(()=>window.qaGame.destroy()); await context.close();
 const mobile=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,deviceScaleFactor:2});
 const p=await mobile.newPage();p.on('pageerror',e=>errors.push(e.message));await p.goto(base);
 await p.locator('#runner').waitFor(); assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth),390);
 await p.screenshot({path:fileURLToPath(new URL('mobile-home.png',out))});
 await p.locator('#runner').click();await p.getByRole('button',{name:'开始逃亡'}).waitFor();
 await p.screenshot({path:fileURLToPath(new URL('mobile-ready.png',out))});
 await p.evaluate(async()=>{const {RunnerWorld}=await import('/src/runner/world.ts');const original=RunnerWorld.prototype.action;RunnerWorld.prototype.action=function(action){window.qaTouchWorld=this;return original.call(this,action);};});
 await p.getByRole('button',{name:'开始逃亡'}).click();
 const cdp=await mobile.newCDPSession(p);await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:180,y:450}]});await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:80,y:450}]});await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
 assert.equal(await p.evaluate(()=>window.qaTouchWorld.lane),0);
 await p.getByRole('button',{name:'跳跃',exact:true}).click();assert.ok(await p.evaluate(()=>window.qaTouchWorld.jump)>0);await p.waitForTimeout(500);
 await p.screenshot({path:fileURLToPath(new URL('mobile-running.png',out))});
 await p.getByRole('button',{name:'暂停跑酷'}).click();await p.getByRole('heading',{name:'已暂停',exact:true}).waitFor();
 await p.setViewportSize({width:844,height:390});await p.screenshot({path:fileURLToPath(new URL('mobile-landscape.png',out))});
 assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth),844);
 assert.deepEqual(errors,[]); console.log('PASS desktop/mobile entry, keyboard, touch, pause, blur, 1000m laugh, endless, collision, restart, persistence; page errors: 0');
 await fs.writeFile(new URL('result.json',out),JSON.stringify({passed:true,errors},null,2));
} finally {await browser.close();}
