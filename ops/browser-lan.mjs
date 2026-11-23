import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createApp } from '../server/app.mjs';
import { attachCoopSockets } from '../server/coop-socket.mjs';

const {chromium} = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
const app = createApp({distDir:fileURLToPath(new URL('../dist/',import.meta.url))});
const server = app.listen(0,'127.0.0.1');
await new Promise(resolve=>server.once('listening',resolve));
const closeSockets = attachCoopSockets(server,app.locals.coop,undefined,app.locals.social);
const base = 'http://127.0.0.1:'+server.address().port;
const browsers=[];
try {
  async function player() {
    const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH,headless:true,args:['--enable-unsafe-swiftshader','--disable-background-timer-throttling']});
    browsers.push(browser);
    const page=await browser.newPage();
    page.on('pageerror',e=>console.error('page error:',e.message));
    await page.addInitScript(()=>{
      window.links=[]; window.matchPackets=0; window.snapshots=0; window.signals=[];
      const NativePeer=window.RTCPeerConnection;
      window.RTCPeerConnection=class extends NativePeer {
        constructor(...options) { super(...options);window.links.push(this); }
        createDataChannel(...options) {
          const channel=super.createDataChannel(...options);
          channel.addEventListener('message',e=>{
            const p=JSON.parse(e.data);
            if (p.type==='snapshot') {window.lastFull=p.data;window.fullCount=(window.fullCount??0)+1;}
            const room=p.data?.snapshot?.set?.room ?? p.data?.room;
            if(room)window.roster=room.players;
            if (p.type==='snapshot'||p.type==='snapshot-delta')window.snapshots++;
          });
          return channel;
        }
      };
      const raw=WebSocket.prototype.send;
      WebSocket.prototype.send=function(data) {
        if(this.url.endsWith('/lan/socket'))window.signals.push(this);
        else if(this.url.endsWith('/socket'))window.matchPackets++;
        return raw.call(this,data);
      };
    });
    await page.goto(base);await page.locator('#extreme').click();
    await page.locator('#escape-menu-coop').click();await page.locator('[data-network="lan"]').click();
    return page;
  }
  const host=await player();
  await host.locator('[data-open-create]').click();
  const form=host.locator('form.lv-modal');
  await form.locator('[name=name]').fill('内网测试');
  await form.locator('select').selectOption('private');
  await form.locator('[name=password]').fill('bath');
  await form.locator('[type=submit]').click();
  await host.locator('.lv-room-banner').waitFor();
  const code=(await host.locator('.lv-room-banner').textContent()).match(/L[A-Z2-9]{6}/)[0];
  console.log('Host created private browser room');
  async function join(page,password) {
    await page.locator('#lv-code').fill(code);
    await page.locator('[data-action=join-code]').click();
    const modal=page.locator('form.lv-modal');
    await modal.locator('[name=password]').fill(password);
    await modal.locator('[type=submit]').click();
  }
  const [b,c]=await Promise.all([player(),player()]);
  await join(b,'wrong'); await b.getByText('房间密码错误',{exact:true}).waitFor();
  await Promise.all([b,c].map(async p=>{await join(p,'bath');await p.locator('.lv-room-banner').waitFor();}));
  await host.waitForFunction(()=>document.querySelectorAll('.lv-slot.occupied .ready').length===3,null,{timeout:90000});
  await host.locator('[data-action=start]').click();
  await Promise.all([b,c].map(p=>p.waitForFunction(()=>window.lastFull?.room.phase==='playing',null,{timeout:30000})));
  assert.equal(app.locals.coop.rooms.size,0);
  const roster=await b.evaluate(()=>window.lastFull.room.players);
  assert.equal(new Set(roster.map(p=>p.id)).size,3);
  assert.ok(roster.every(p=>p.lives===1));
  for(const page of [b,c]) {
    const candidates=await page.evaluate(async()=>{
      const pc=window.links.find(pc=>pc.connectionState==='connected');
      const stats=await pc.getStats();const transport=[...stats.values()].find(s=>s.selectedCandidatePairId);
      const pair=stats.get(transport.selectedCandidatePairId);
      return [stats.get(pair.localCandidateId).candidateType,stats.get(pair.remoteCandidateId).candidateType];
    });
    assert.deepEqual(candidates,['host','host']);
  }
  console.log('Three players ready and playing over two direct host candidate pairs');
  // Break one physical peer connection: the guest should resume its original slot using the room channel.
  const fullCount=await b.evaluate(()=>window.fullCount);
  await b.evaluate(()=>window.links.find(pc=>pc.connectionState==='connected').close());
  await b.waitForFunction(n=>window.fullCount>n && window.roster.every(p=>p.status==='connected'),fullCount,{timeout:30000});
  const next=await b.evaluate(()=>window.lastFull.room.players.map(p=>p.id));assert.deepEqual(next,roster.map(p=>p.id));
  console.log('Guest resumes original slot');
  for(const p of [host,b,c]) {
    await p.route('**/api/**',r=>r.abort());
    await p.evaluate(()=>{for(const ws of new Set(window.signals))ws.close();});
  }
  const before=await b.evaluate(()=>window.snapshots);
  await b.waitForFunction(n=>window.snapshots>n+12,before,{timeout:10000});
  for(const p of [host,b,c])assert.equal(await p.evaluate(()=>window.matchPackets),0);
  await b.locator('#escape-coop-team').waitFor({state:'visible'});
  const self=await b.evaluate(()=>window.lastFull.viewPlayerId);
  const origin=await c.evaluate(id=>window.roster.find(p=>p.id===id).position,self);
  await b.keyboard.down('w');
  try { await c.waitForFunction(({self,origin})=>{const p=window.roster.find(p=>p.id===self).position;return Math.hypot(origin.x-p.x,origin.z-p.z)>.15;},{self,origin},{timeout:5000}); }
  finally { await b.keyboard.up('w'); }
  console.log('Guest keyboard movement visible to the other guest');
  console.log('Match continues with signaling disconnected; no public gameplay sockets');
} finally {
  await Promise.allSettled(browsers.map(b=>b.close()));
  closeSockets();app.locals.coop.shutdown();app.locals.social.close();server.closeAllConnections();server.close();
}
