import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createApp } from '../server/app.mjs';
import { EscapeWorld, HEIGHT, SIZE } from '../src/escape/world.ts';
import { CoopService } from '../server/coop-service.mjs';
import {attachCoopSockets} from '../server/coop-socket.mjs';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
const coopService = new CoopService();
const browserHost = process.env.NWAXZ_BROWSER_LAN_HOST ?? '127.0.0.1';
const server = createApp({ distDir: fileURLToPath(new URL('../dist/', import.meta.url)), coopService, lan: browserHost !== '127.0.0.1' }).listen(0, browserHost);
await new Promise(resolve => server.once('listening', resolve));
attachCoopSockets(server,coopService);
const base = `http://${browserHost}:${server.address().port}`;
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH, headless: true, args: ['--disable-gpu', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-background-networking'] });
const instrumentation = `
  window.__coopSnapshots = []; window.__coopInputs = []; window.__coopSessions = [];
  const NativeSocket=window.WebSocket;
  window.WebSocket=class extends NativeSocket {
    constructor(...args){
      super(...args);
      let snapshot;
      const merge = (prior, delta) => {
        const next = {...prior, ...delta.set};
        for (const key of delta.clear) delete next[key];
        return next;
      };
      this.addEventListener('message',event=>{
        try {
          const p=JSON.parse(event.data);
          if (p.type==='snapshot') snapshot=p.data;
          else if(p.type==='snapshot-delta' && snapshot?.revision===p.data.base)
            snapshot={...merge(snapshot,p.data.snapshot),world:merge(snapshot.world,p.data.world)};
          else return;
          window.__coopSnapshots.push(snapshot);
          if(window.__coopSnapshots.length>300)window.__coopSnapshots.shift();
        } catch {}
      });
    }
    send(data){try{const p=JSON.parse(data);if(p.type==='input')window.__coopInputs.push(p.data);}catch{}return super.send(data);}
  };
  const realFetch = window.fetch.bind(window);
  window.fetch = async (input, init = {}) => {
    const url = typeof input === 'string' ? input : input.url;
    if (url.includes('/api/coop/') && url.endsWith('/input')) { try { window.__coopInputs.push(JSON.parse(init.body)); } catch {} }
    const response = await realFetch(input, init);
    if (url.includes('/api/coop/') && (url.endsWith('/rooms') || url.endsWith('/join')) && response.ok) response.clone().json().then(value => window.__coopSessions.push(value)).catch(() => {});
    if (url.includes('/api/coop/') && url.endsWith('/events') && response.ok && response.body) {
      const [appStream, monitor] = response.body.tee();
      (async () => { const reader = monitor.getReader(), decoder = new TextDecoder(); let text = '';
        while (true) { const { value, done } = await reader.read(); if (done) break; text = (text + decoder.decode(value, { stream: true })).replace(/\\r\\n/g, '\\n');
          let boundary; while ((boundary = text.indexOf('\\n\\n')) >= 0) { const block = text.slice(0, boundary); text = text.slice(boundary + 2); if (!block.startsWith('event: snapshot')) continue;
            const data = block.split('\\n').filter(line => line.startsWith('data:')).map(line => line.slice(5).trim()).join('\\n'); try { const snapshot = JSON.parse(data); window.__coopSnapshots.push(snapshot); if (window.__coopSnapshots.length > 300) window.__coopSnapshots.shift(); } catch {} }
        }
      })().catch(() => {});
      return new Response(appStream, { status: response.status, statusText: response.statusText, headers: response.headers });
    }
    return response;
  };
`;
const sessionValue = JSON.stringify(new EscapeWorld().snapshot());
const recordValue = JSON.stringify({ version: 2, escapes: 1, bestTimeMs: 12000, fewestCaptures: 0, mostNotes: 1 });
const contexts = [];
const pages = [];
const pageErrors = [];
const cspViolations = [];
const portraitResponses = [];

async function openPlayer(name, { phone = false } = {}) {
  const context = await browser.newContext({ viewport: phone ? { width: 390, height: 844 } : { width: 1280, height: 800 }, deviceScaleFactor: phone ? 2 : 1, isMobile: phone, hasTouch: phone, serviceWorkers: 'allow' });
  contexts.push(context); await context.addInitScript(instrumentation);
  const page = await context.newPage(); pages.push(page); page.on('pageerror', error => pageErrors.push(error.message)); page.on('console', message => { if (message.type() === 'error' && /Content Security Policy|Refused to (?:apply|load|connect)/i.test(message.text())) cspViolations.push(message.text()); }); page.on('response', response => { if (response.url().endsWith('/escape-survivor-portraits.webp')) portraitResponses.push(response.status()); });
  await page.goto(base); await page.locator('#extreme').click();
  await page.locator('.lv-user').waitFor({ state: 'visible', timeout: 15000 });
  await page.locator('.lv-user').click();
  await page.locator('#lv-name').fill(name);
  await page.locator('[data-action="rename"]').click();
  await page.waitForFunction(value => document.querySelector('.lv-user')?.textContent?.includes(value), name, { timeout: 10000 });
  await page.evaluate(({ session, record }) => {
    localStorage.setItem('nwaxz-escape-session-v1', session); localStorage.setItem('nwaxz-escape-record-v1', record);
    window.__soloSaveWrites = 0; const setItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) { if (key === 'nwaxz-escape-session-v1' || key === 'nwaxz-escape-record-v1') window.__soloSaveWrites++; return setItem.call(this, key, value); };
  }, { session: sessionValue, record: recordValue });
  await page.locator('#escape-menu-coop').click();
  return { context, page };
}
async function selectAvatar(page, avatar) {
  await page.locator('.lv-user').click();
  await page.locator(`[data-action="avatar"][data-avatar="${avatar}"]`).click();
  await page.waitForFunction(value => document.querySelector('.lv-user .lv-portrait')?.classList.contains(`lv-avatar-${value}`), avatar, { timeout: 10000 });
}
async function showServers(page) {
  if (await page.locator('.lv-room-bottom').count()) {
    await page.locator('[data-action="leave"]').click();
    await page.waitForFunction(() => !document.querySelector('.escape-shell')?.classList.contains('coop-active') && !document.querySelector('.lv-roster'), undefined, { timeout: 15000 });
  }
  if (!await page.locator('.lv-main .lv-list-tools').count()) await page.locator('#escape-menu-coop').click();
  await page.locator('.lv-main .lv-list-tools').waitFor({ state: 'visible', timeout: 15000 });
}
async function createRoom(page, avatar = 0) {
  await showServers(page); await selectAvatar(page, avatar);
  if (!await page.locator('.lv-main .lv-list-tools').count()) await page.locator('#escape-menu-coop').click();
  const previous = await page.evaluate(() => window.__coopSessions.length);
  await page.locator('[data-open-create]').click();
  const form = page.locator('form.lv-modal');
  await form.locator('input[name="name"]').fill('浏览器验收小队');
  await form.locator('select[name="visibility"]').selectOption('public');
  await form.locator('button[type="submit"]').click();
  await page.waitForFunction(count => window.__coopSessions.length > count, previous, { timeout: 15000 });
  const session = await page.evaluate(() => window.__coopSessions.at(-1));
  await page.waitForFunction(code => document.querySelector('.lv-roster') && document.querySelector('.lv-room-banner')?.textContent?.includes(code), session.code, { timeout: 15000 });
  return session.code;
}
async function joinRoom(page, code, avatar) {
  await showServers(page); await selectAvatar(page, avatar);
  if (!await page.locator('.lv-main .lv-list-tools').count()) await page.locator('#escape-menu-coop').click();
  const previous = await page.evaluate(() => window.__coopSessions.length);
  await page.locator('#lv-code').fill(code);
  await page.locator('[data-action="join-code"]').click();
  const form = page.locator('form.lv-modal');
  await form.locator('input[name="password"]').fill('');
  await form.locator('button[type="submit"]').click();
  await page.waitForFunction(count => window.__coopSessions.length > count, previous, { timeout: 15000 });
  await page.waitForFunction(roomCode => document.querySelector('.lv-roster') && document.querySelector('.lv-room-banner')?.textContent?.includes(roomCode), code, { timeout: 15000 });
}
async function waitReady(page) {
  await page.waitForFunction(() => { const players = window.__coopSnapshots.at(-1)?.room?.players; return players?.length >= 2 && players.every(player => player.status === 'connected' && player.ready); }, undefined, { timeout: 90000 });
}
async function startRoom(page) {
  await page.bringToFront();
  await page.waitForFunction(() => { const b = document.querySelector('[data-action="start"]'); return b && !b.disabled; }, undefined, { timeout: 15000 });
  await page.locator('[data-action="start"]').click(); await page.locator('#escape-coop-team').waitFor({ state: 'visible', timeout: 90000 });
}
async function latestSnapshot(page) { return page.evaluate(() => window.__coopSnapshots.at(-1)); }
async function exitRoom(page) {
  await page.bringToFront();
  const controls = '#escape-coop-result-exit:visible, #escape-coop-caught-leave:visible, #escape-coop-sync-leave:visible, #escape-coop-closed-leave:visible, #escape-exit:visible, #escape-pause:visible, #cinematic-skip:visible';
  for (let attempt = 0; attempt < 5; attempt++) {
    const finished = await page.evaluate(() => !document.querySelector('.escape-shell')?.classList.contains('coop-active') && !document.querySelector('.lv-roster'));
    if (finished) return;
    if (await page.evaluate(() => !!document.pointerLockElement)) { await page.keyboard.press('Escape'); continue; }
    const action = page.locator(controls).first();
    try {
      if (await page.evaluate(() => matchMedia('(pointer:coarse)').matches)) await action.tap({timeout:5000}); else await action.click({timeout:5000});
    } catch (error) {
      const finished = await page.evaluate(() => !document.querySelector('.escape-shell')?.classList.contains('coop-active') && !document.querySelector('.lv-roster'));
      if (finished) return;
      await page.screenshot({path:'.local/coop-exit-failure.png'});
      console.error('Exit state', await page.evaluate(() => ({ panel:document.querySelector('#escape-panel')?.textContent, classes:document.querySelector('.escape-shell')?.className, hidden:document.querySelector('#escape-panel')?.hasAttribute('hidden'), room:window.__coopSnapshots.at(-1)?.room.phase })));
      throw error;
    }
  }
  await page.waitForFunction(() => !document.querySelector('.escape-shell')?.classList.contains('coop-active') && !document.querySelector('.lv-roster'), undefined, { timeout: 10000 });
}

function position(snapshot, id) { return snapshot?.room?.players?.find(player => player.id === id)?.position; }
function placeForCapture(code, token) {
  const room = coopService.rooms.get(code), victim = coopService.findPlayer(room, token);
  assert.ok(room && victim, 'capture fixture finds the intended room player');
  const others = [...room.players.values()].filter(player => player !== victim && player.status === 'connected');
  let point;
  for (let z = 1.5; z < HEIGHT - 1 && !point; z += 1) for (let x = 1.5; x < SIZE - 1 && !point; x += 1) {
    if (room.world.wall(x, z) !== 0 || others.some(player => Math.hypot(player.position.x - x, player.position.z - z) < 7)) continue;
    point = { x, z };
  }
  assert.ok(point, 'capture fixture chooses a legal floor away from teammates');
  Object.assign(victim.position, point); Object.assign(victim.actorWorld.data.player, point); Object.assign(victim.actor, point);
  Object.assign(room.world.data.hunter, point, { state: 'patrol' }); room.world.coopTargetId = victim.id; room.targetPlayerId = victim.id;
  room.nextPulse = coopService.now(); coopService.pulse();
  return { room, victim, elapsed: room.world.data.elapsed };
}
async function assertTeamClear(page, viewport, label) {
  await page.setViewportSize(viewport);
  await page.waitForTimeout(100);
  const collisions = await page.evaluate(() => {
    const selectors = ['#escape-coop-team', '#escape-map', '.escape-hunt', '.escape-ability-hud', '#escape-inventory', '.escape-bottom .escape-meters', '.escape-stick', '.escape-actions', '#escape-interact', '.escape-crosshair', '#escape-coop-status', '.escape-crystals'];
    const rects = selectors.map(selector => { const node = document.querySelector(selector); if (!node || node.hidden) return undefined; const style = getComputedStyle(node), box = node.getBoundingClientRect(); if (style.display === 'none' || style.visibility === 'hidden' || box.width < 1 || box.height < 1) return undefined; return { selector, left: box.left, right: box.right, top: box.top, bottom: box.bottom }; }).filter(Boolean);
    const team = rects.find(rect => rect.selector === '#escape-coop-team');
    return team ? rects.filter(rect => rect !== team && !(rect.selector === '#escape-coop-status') && Math.min(team.right, rect.right) - Math.max(team.left, rect.left) > 2 && Math.min(team.bottom, rect.bottom) - Math.max(team.top, rect.top) > 2).map(rect => rect.selector) : ['team hidden'];
  });
  assert.deepEqual(collisions, [], `${label} team roster avoids map, exposure, abilities, movement, actions, inventory, interaction, crosshair, resources and latency`);
}

try {
  const a = await openPlayer('奶蛙甲'); const b = await openPlayer('奶蛙乙', { phone: true });
  const code = await createRoom(a.page, 2); await joinRoom(b.page, code, 1);
  await waitReady(a.page); await waitReady(b.page);
  await b.page.waitForFunction(() => window.__coopSnapshots.at(-1)?.room.players.some(player => player.avatar === 1), undefined, { timeout: 10000 });
  await startRoom(a.page); await b.page.locator('#escape-coop-team').waitFor({ state: 'visible', timeout: 90000 });
  await a.page.keyboard.press('e');
  try{await b.page.waitForFunction(()=>window.__coopSnapshots.at(-1)?.world.hunt.collected.includes('crystal-bed'),undefined,{timeout:10000});}
  catch(error){console.error('Pickup diagnostics',await a.page.evaluate(()=>({inputs:window.__coopInputs.slice(-8),player:window.__coopSnapshots.at(-1)?.world.player,panel:document.querySelector('#escape-panel')?.innerText,hidden:document.querySelector('#escape-panel')?.hidden,target:document.querySelector('#escape-interact')?.textContent,status:document.querySelector('#escape-coop-status')?.textContent})));throw error;}
  assert.ok(await a.page.evaluate(()=>window.__coopInputs.some(p=>p.action==='interact'&&p.targetId==='crystal-bed')),'real E pickup includes the target id and replicates to teammate');
  const entryA=await a.page.evaluate(()=>window.__coopSessions.at(-1));
  const ownRoom=coopService.rooms.get(code), ownActor=coopService.findPlayer(ownRoom,entryA.token);
  // Local interaction fixture; not a route-completion claim.
  ownActor.position={x:5.5,z:3.5};Object.assign(ownActor.actorWorld.data.player,ownActor.position,{angle:-Math.PI/2});
  await a.page.waitForFunction(()=>window.__coopSnapshots.at(-1)?.world.player.x===5.5,undefined,{timeout:5000});
  await a.page.waitForTimeout(150);await a.page.keyboard.press('e');
  await a.page.waitForFunction(()=>window.__coopSnapshots.at(-1)?.world.hidden==='bed-hide',undefined,{timeout:5000});
  await a.page.keyboard.press('e');
  await a.page.waitForFunction(()=>!window.__coopSnapshots.at(-1)?.world.hidden,undefined,{timeout:5000});
  assert.ok(ownActor.position.z>=3.4,'leaving a wardrobe persists the legal exit position');
  // Return the local fixture to the normal initial pose before the other acceptance cases.
  ownActor.position={x:3.5,z:5.5};Object.assign(ownActor.actorWorld.data.player,ownActor.position,{angle:-Math.PI/2});
  for (const [width, height] of [[1280, 800], [900, 500]]) await assertTeamClear(a.page, { width, height }, `2-player desktop ${width}x${height}`);
  for (const [width, height] of [[390, 844], [320, 568], [844, 390]]) await assertTeamClear(b.page, { width, height }, `2-player touch ${width}x${height}`);
  await a.page.setViewportSize({ width: 1280, height: 800 }); await b.page.setViewportSize({ width: 390, height: 844 });
  const phoneTeam = await b.page.locator('#escape-coop-team').boundingBox();
  assert.ok(phoneTeam && phoneTeam.x >= 0 && phoneTeam.x + phoneTeam.width <= 390, 'team panel fits a coarse-pointer phone viewport');
  await a.page.waitForFunction(() => window.__coopSnapshots.some(s => s.room?.players?.length === 2 && s.room.players.every(p => p.lives === 2)), undefined, { timeout: 15000 });
  assert.equal(await b.page.locator('#escape-lives span').count(), 2, 'personal hearts match the two-player life cap');
  assert.equal((await b.page.locator('#escape-coop-team').innerText()).match(/♥♥/g)?.length, 2, 'two-player team displays two lives per survivor');
  const sessionA = await a.page.evaluate(() => window.__coopSessions[0]); const sessionB = await b.page.evaluate(() => window.__coopSessions[0]);
  await b.page.waitForFunction(id => !!window.__coopSnapshots.at(-1)?.room.players.find(player => player.id === id)?.position, sessionA.playerId, { timeout: 10000 });
  await a.page.waitForFunction(id => !!window.__coopSnapshots.at(-1)?.room.players.find(player => player.id === id)?.position, sessionB.playerId, { timeout: 10000 });
  const start = await latestSnapshot(a.page); const before = position(start, sessionB.playerId);
  await b.page.bringToFront();
  await b.page.keyboard.down('w'); await b.page.waitForTimeout(1100); await b.page.keyboard.up('w');
  await b.page.locator('#escape-light').click();
  await a.page.waitForFunction(({ id, x, z }) => { const p = window.__coopSnapshots.at(-1)?.room.players.find(player => player.id === id)?.position; return p && Math.hypot(p.x - x, p.z - z) > .05; }, { id: sessionB.playerId, x: before.x, z: before.z }, { timeout: 10000 });
  assert.ok(await b.page.evaluate(() => window.__coopInputs.some(input => input.move.forward > 0)), 'non-host movement is sent as directional input');
  await b.page.waitForFunction(() => window.__coopInputs.some(input => input.action === 'light'), undefined, { timeout: 5000 });
  await a.page.locator('#escape-coop-status').waitFor({ state: 'visible' }); await a.page.waitForFunction(() => /延迟 \d+ ms/.test(document.querySelector('#escape-coop-status')?.title ?? ''), undefined, { timeout: 6000 });
  const previousPeer = ownRoom.peers.get(sessionB.playerId);
  coopService.closePeer(previousPeer);
  await b.page.waitForFunction(() => document.querySelector('#escape-coop-status')?.dataset.state === 'reconnecting', undefined, { timeout: 6000 });
  await b.context.setOffline(true); await b.page.waitForTimeout(1000); await b.context.setOffline(false);
  await b.page.waitForFunction(() => document.querySelector('#escape-coop-status')?.dataset.state === 'connected', undefined, { timeout: 15000 });
  assert.notEqual(ownRoom.peers.get(sessionB.playerId), previousPeer, 'weak connection gets a fresh peer and keeps the same room membership');
  const capture2 = placeForCapture(code, sessionB.token);
  await b.page.waitForFunction(id => window.__coopSnapshots.at(-1)?.room.players.find(player => player.id === id)?.status === 'caught', sessionB.playerId, { timeout: 10000 });
  await b.page.locator('.escape-cinematic').waitFor({ state: 'visible', timeout: 5000 });
  assert.equal(capture2.victim.lives, 1, 'two-player capture removes one life');
  assert.equal(await a.page.locator('.escape-cinematic').count(), 0, 'capture cinematic stays private to the caught player');
  await b.page.locator('#cinematic-skip').click();
  await b.page.locator('#escape-coop-respawn').waitFor({ state: 'visible', timeout: 10000 });
  const caughtInputCount = await b.page.evaluate(() => window.__coopInputs.length);
  await b.page.waitForTimeout(400);
  assert.equal(await b.page.evaluate(() => window.__coopInputs.length), caughtInputCount, 'caught player sends no stale movement or queued actions');
  await b.page.locator('#escape-coop-respawn').click();
  await b.page.waitForFunction(id => { const p = window.__coopSnapshots.at(-1)?.room.players.find(player => player.id === id); return p?.status === 'connected' && p.lives === 1; }, sessionB.playerId, { timeout: 10000 });
  assert.ok(capture2.room.world.data.elapsed >= capture2.elapsed, 'respawn waits for server acknowledgement and never advances a local night');
  assert.equal((await latestSnapshot(a.page)).room.players.find(player => player.id === sessionA.playerId)?.status, 'connected', 'host continues while teammate watches the capture cinematic');
  await exitRoom(a.page);
  await b.page.waitForFunction(id => { const room = window.__coopSnapshots.at(-1)?.room; return room?.phase === 'playing' && room.leaderId === id && room.players.some(player => player.status === 'left'); }, sessionB.playerId, { timeout: 10000 });
  assert.equal((await latestSnapshot(b.page)).room.phase, 'playing', 'room remains active after leader leaves');
  await exitRoom(b.page);

  const c = await openPlayer('奶蛙丙');
  const code3 = await createRoom(a.page, 0); await joinRoom(b.page, code3, 1); await joinRoom(c.page, code3, 3);
  await waitReady(a.page); await waitReady(b.page); await waitReady(c.page);
  await startRoom(a.page); await b.page.locator('#escape-coop-team').waitFor({ state: 'visible', timeout: 90000 }); await c.page.locator('#escape-coop-team').waitFor({ state: 'visible', timeout: 90000 });
  for (const [width, height] of [[1280, 800], [900, 500]]) await assertTeamClear(a.page, { width, height }, `3-player desktop ${width}x${height}`);
  for (const [width, height] of [[390, 844], [320, 568], [844, 390]]) await assertTeamClear(b.page, { width, height }, `3-player touch ${width}x${height}`);
  await a.page.setViewportSize({ width: 1280, height: 800 }); await b.page.setViewportSize({ width: 390, height: 844 });
  await a.page.waitForFunction(() => window.__coopSnapshots.some(s => s.room?.players?.length === 3 && s.room.players.every(p => p.lives === 1)), undefined, { timeout: 15000 });
  assert.equal(await c.page.locator('#escape-lives span').count(), 1, 'personal hearts match the three-player life cap');
  assert.equal((await c.page.locator('#escape-coop-team').innerText()).match(/♥/g)?.length, 3, 'three-player team displays one life per survivor');
  const thirdSession = await c.page.evaluate(() => window.__coopSessions.at(-1)); const newLeaderSession = await a.page.evaluate(() => window.__coopSessions.at(-1)); await c.page.bringToFront();
  await c.page.keyboard.down('w'); await c.page.waitForTimeout(700); await c.page.keyboard.up('w');
  assert.ok(await a.page.evaluate(id => window.__coopSnapshots.some(s => { const p = s.room?.players.find(player => player.id === id)?.position; return p && (p.x !== 5.5 || p.z !== 5.5); }), (await c.page.evaluate(() => window.__coopSessions.at(-1))).playerId), 'third player movement reaches the shared room');
  const capture3 = placeForCapture(code3, thirdSession.token);
  await c.page.waitForFunction(id => window.__coopSnapshots.at(-1)?.room.players.find(player => player.id === id)?.status === 'eliminated', thirdSession.playerId, { timeout: 10000 });
  try { await c.page.locator('.escape-cinematic').waitFor({ state: 'visible', timeout: 5000 }); }
  catch (error) { console.error('elimination capture diagnostics', await c.page.evaluate(() => ({ panelText: document.querySelector('#escape-panel')?.innerText, panelHidden: document.querySelector('#escape-panel')?.hidden, cinematic: document.querySelector('.escape-cinematic')?.outerHTML.slice(0, 240), respawn: !!document.querySelector('#escape-coop-respawn'), shell: document.querySelector('.escape-shell')?.className, following: document.querySelector('#escape-coop-team')?.innerText })), await c.page.locator('#escape-coop-status').getAttribute('data-state').catch(() => ''), pageErrors); throw error; }
  assert.equal(capture3.victim.lives, 0, 'three-player capture uses the single life');
  assert.equal(await a.page.locator('.escape-cinematic').count(), 0, 'eliminated teammate cinematic stays private');
  await c.page.locator('#cinematic-skip').click();
  await c.page.locator('#escape-coop-respawn').waitFor({ state: 'visible', timeout: 10000 });
  await c.page.locator('#escape-coop-respawn').click();
  await c.page.waitForFunction(id => { const snapshot = window.__coopSnapshots.at(-1); return snapshot?.viewPlayerId !== id && snapshot?.room.players.find(player => player.id === id)?.status === 'eliminated'; }, thirdSession.playerId, { timeout: 10000 });
  const spectatorInputCount = await c.page.evaluate(() => window.__coopInputs.length);
  await c.page.waitForTimeout(500);
  assert.equal(await c.page.evaluate(() => window.__coopInputs.length), spectatorInputCount, 'eliminated spectator cannot submit movement or actions');
  assert.ok(capture3.room.world.data.elapsed >= capture3.elapsed, 'elimination does not advance a local night');
  await exitRoom(a.page);
  await b.page.waitForFunction(id => { const room = window.__coopSnapshots.at(-1)?.room; return room?.phase === 'playing' && room.leaderId !== id && room.players.some(player => player.id === id && player.status === 'left'); }, newLeaderSession.playerId, { timeout: 10000 });
  assert.equal((await latestSnapshot(b.page)).room.phase, 'playing', 'remaining players continue after leader departure');
  for (const { page } of [{ page: b.page }, { page: c.page }]) {
    const storage = await page.evaluate(() => [localStorage.getItem('nwaxz-escape-session-v1'), localStorage.getItem('nwaxz-escape-record-v1')]);
    assert.deepEqual(storage, [sessionValue, recordValue], 'multiplayer does not touch single-player saves or records');
    assert.equal(await page.evaluate(() => window.__soloSaveWrites), 0, 'co-op never writes solo save keys');
  }
  assert.ok(portraitResponses.every(status => status === 200) && portraitResponses.length > 0, 'portrait atlas loads for roster avatars');
  assert.ok(!pageErrors.length, `browser errors: ${pageErrors.join('; ')}`); assert.ok(!cspViolations.length, `CSP errors: ${cspViolations.join('; ')}`);
  await exitRoom(b.page); await exitRoom(c.page);

  const offline = await openPlayer('离线玩家'); await offline.context.setOffline(true);
  await offline.page.locator('[data-open-create]').click();
  const offlineForm = offline.page.locator('form.lv-modal');
  await offlineForm.locator('input[name="name"]').fill('离线验收');
  await offlineForm.locator('button[type="submit"]').click();
  await offline.page.waitForFunction(() => !!document.querySelector('.lv-message')?.textContent?.trim(), undefined, { timeout: 10000 });
  assert.deepEqual(await offline.page.evaluate(() => [localStorage.getItem('nwaxz-escape-session-v1'), localStorage.getItem('nwaxz-escape-record-v1')]), [sessionValue, recordValue], 'offline join attempt keeps single-player saves unchanged');
  console.log('co-op browser acceptance passed: WebSocket, E crystal pickup, wardrobe entry/exit, 2-player movement/actions/lives, 3-player movement/lives, leader departure, phone layout, ping, save isolation, offline refusal');
} finally {
  await Promise.all(contexts.map(context => context.close().catch(() => {})));
  await browser.close(); coopService.close(); await new Promise(resolve => server.close(resolve));
}
