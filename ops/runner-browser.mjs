// Start pnpm dev first. Optional isolated Playwright installation; no production debug API.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE??'playwright');
const output=new URL('../.local/runner-qa/',import.meta.url);await fs.mkdir(output,{recursive:true});
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH,headless:true,args:['--enable-unsafe-swiftshader']});
const base=process.env.RUNNER_QA_BASE??'http://127.0.0.1:5173';const errors=[];
const shot=(page,name)=>page.screenshot({path:fileURLToPath(new URL(name+'.png',output))});
const watch=page=>{page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error'&&/shader|compile.*effect|WebGL.*error/i.test(m.text()))errors.push(m.text());});};
async function mount(page){
 await page.evaluate(async()=>{const {RunnerGame}=await import('/src/runner/game.ts');const {AudioManager}=await import('/src/audio.ts');const {defaultSettings}=await import('/src/settings.ts');
 document.querySelector('[data-run=exit]').click();const settings={...defaultSettings(),sound:false,music:false,reducedMotion:false};window.qaGame=new RunnerGame(document.querySelector('#app'),new AudioManager(settings),settings,()=>window.qaGame.destroy());});
 await page.getByRole('button',{name:'开始游戏'}).waitFor({timeout:90000});
}
try{
 const context=await browser.newContext({viewport:{width:1280,height:800}});const page=await context.newPage();watch(page);
 await page.goto(base);await page.locator('#runner').click();await page.getByRole('button',{name:'开始游戏'}).waitFor({timeout:90000});
 assert.equal(await page.locator('[data-engine=babylon]').count(),1);await shot(page,'3d-ready');
 for(const name of ['遗迹长廊','矿洞轨道','峡谷水渠']){await page.getByRole('button',{name,exact:true}).click();await page.waitForFunction(name=>document.querySelector('#runner-scene').textContent.startsWith(name),name);}
 await page.getByRole('button',{name:'开始游戏'}).click();await page.keyboard.press('ArrowLeft');await page.keyboard.press('Space');await page.keyboard.press('Escape');
 await page.getByRole('heading',{name:'暂停',exact:true}).waitFor();const distance=await page.locator('#run-distance').textContent();await page.waitForTimeout(200);assert.equal(await page.locator('#run-distance').textContent(),distance);
 await page.getByRole('button',{name:'返回模式选择',exact:true}).click();await page.locator('#runner').click();await page.getByRole('button',{name:'开始游戏'}).waitFor({timeout:90000});await mount(page);
 await page.getByRole('button',{name:'千米挑战',exact:true}).click();await page.getByRole('button',{name:'开始游戏'}).click();
 await page.evaluate(()=>{const w=window.qaGame.world;for(let i=0;i<16000&&w.phase==='running';i++){
  const t=w.approachingTurn;if(t&&t.z-w.distance<=15)w.action(t.direction);
  const o=w.items.filter(i=>!['coin','magnet','shield','boost'].includes(i.kind)&&!i.done&&i.z>w.distance-1).sort((a,b)=>a.z-b.z)[0];
  if(o?.span===3){if(o.z-w.distance<w.speed*(o.kind==='beam'?.24:.42))w.action(o.kind==='beam'?'slide':'jump');}
  else if(o&&o.z-w.distance<Math.max(14,w.speed*.6)){const blocked=w.items.filter(i=>!['coin','magnet','shield','boost'].includes(i.kind)&&Math.abs(i.z-o.z)<.01).map(i=>i.lane);const lane=[0,1,2].find(l=>!blocked.includes(l));if(w.lane<lane)w.action('right');else if(w.lane>lane)w.action('left');}
  w.advance(1/120);
 }});
 await page.getByRole('heading',{name:'挑战完成'}).waitFor();await shot(page,'3d-victory');assert.equal(await page.locator('.runner-laugh').count(),1);
 await page.getByRole('button',{name:'继续无限模式'}).click();await page.waitForTimeout(100);assert.ok(await page.evaluate(()=>window.qaGame.world.distance)>1000);
 await page.evaluate(()=>{const w=window.qaGame.world;w.boost=0;w.shield=0;w.turns=[];w.items=[{id:999,z:w.distance+1,lane:w.lane,kind:'spikes',done:false}];});
 await page.locator('[data-phase=caught]').waitFor();await page.waitForTimeout(1600);
 assert.ok(await page.evaluate(()=>window.qaGame.renderer.dog.root.position.y)>1.6);await shot(page,'3d-capture');
 await page.getByRole('button',{name:'暂停跑酷'}).click();const captured=await page.evaluate(()=>window.qaGame.world.captureTime);await page.waitForTimeout(200);assert.equal(await page.evaluate(()=>window.qaGame.world.captureTime),captured);
 await page.getByRole('button',{name:'继续',exact:true}).click();await page.getByRole('button',{name:'跳过',exact:true}).click();await page.getByRole('heading',{name:'游戏结束'}).waitFor();assert.match(await page.locator('.runner-death-hint').textContent(),/跳/);
 await page.getByRole('button',{name:'再跑一次',exact:true}).click();
 await page.evaluate(()=>{const w=window.qaGame.world;w.elapsed=5;w.items=[];w.turns=[];});await page.waitForTimeout(100);await page.keyboard.press('Space');await page.waitForTimeout(180);await page.keyboard.press('Space');assert.equal(await page.evaluate(()=>window.qaGame.world.jumpCount),2);await shot(page,'3d-double-jump');
 for(const [weather,name]of [['rain','3d-rain-night'],['snow','3d-snow-night'],['sunny','3d-sunny']]){
  await page.evaluate(async weather=>{const {RunnerWorld,weatherAt}=await import('/src/runner/world.ts');const distance=weather==='sunny'?1500:1100;const seed=Array.from({length:100},(_,i)=>i).find(i=>weatherAt(i,distance)===weather);const w=new RunnerWorld(seed,'endless',0);w.start();w.distance=distance;w.elapsed=5;w.items=[];w.turns=[];w.nextRow=distance+200;w.nextTurn=distance+180;window.qaGame.world=w;},weather);
  await page.waitForTimeout(150);assert.ok((await page.locator('#runner-scene').textContent()).includes(weather==='rain'?'雨天':weather==='snow'?'雪天':'晴天'));await shot(page,name);
 }
 assert.ok(await page.evaluate(()=>window.qaGame.renderer.dog.root.billboardMode)>0);
 assert.ok(await page.evaluate(()=>window.qaGame.renderer.chaserSprite.root.billboardMode)>0);
 assert.equal(await page.evaluate(()=>window.qaGame.renderer.scene.getMeshByName('dog-long-round-body')),null);
 await page.evaluate(()=>window.qaGame.destroy());await context.close();
 const mobile=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,deviceScaleFactor:1.5});const p=await mobile.newPage();watch(p);await p.goto(base);await p.locator('#runner').click();await p.getByRole('button',{name:'开始游戏'}).waitFor({timeout:90000});await mount(p);
 await p.evaluate(()=>Object.defineProperty(DeviceOrientationEvent,'requestPermission',{configurable:true,value:async()=> 'denied'}));await p.getByRole('button',{name:'开启倾斜控制'}).click();await p.getByText('未获得运动权限，可继续用滑动或按钮。').waitFor();
 await p.evaluate(()=>Object.defineProperty(DeviceOrientationEvent,'requestPermission',{configurable:true,value:async()=> 'granted'}));await p.getByRole('button',{name:'开启倾斜控制'}).click();await p.evaluate(()=>window.dispatchEvent(new DeviceOrientationEvent('deviceorientation',{beta:0,gamma:0})));await p.getByRole('button',{name:'开始游戏'}).click();
 await p.evaluate(()=>{const w=window.qaGame.world;w.items=[];w.turns=[];window.dispatchEvent(new DeviceOrientationEvent('deviceorientation',{beta:0,gamma:0}));for(let i=0;i<15;i++)window.dispatchEvent(new DeviceOrientationEvent('deviceorientation',{beta:0,gamma:25}));});assert.equal(await p.evaluate(()=>window.qaGame.world.lane),2);
 await p.getByRole('button',{name:'跳跃',exact:true}).click();await p.waitForTimeout(150);await p.getByRole('button',{name:'跳跃',exact:true}).click();assert.equal(await p.evaluate(()=>window.qaGame.world.jumpCount),2);await shot(p,'3d-mobile');
 const cdp=await mobile.newCDPSession(p);await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:220,y:450}]});await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:100,y:450}]});await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});assert.equal(await p.evaluate(()=>window.qaGame.world.lane),1);
 await p.getByRole('button',{name:'暂停跑酷'}).click();await p.setViewportSize({width:844,height:390});await shot(p,'3d-landscape');assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth),844);
 assert.deepEqual(errors,[]);console.log('PASS 3D environment with original 2D dog/frog sprites, capture lift/death hint, double jump, weather/night, tilt grant/deny/calibration, touch, pause, scenes, challenge/infinite; page errors: 0');await fs.writeFile(new URL('result.json',output),JSON.stringify({passed:true,errors},null,2));
}finally{await browser.close();}
