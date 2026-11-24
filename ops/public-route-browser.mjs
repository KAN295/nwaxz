import assert from 'node:assert/strict';
import { build } from 'vite';
import { WebSocket } from 'ws';
import { createApp } from '../server/app.mjs';
import { attachCoopSockets } from '../server/coop-socket.mjs';
import info from '../package.json' with {type:'json'};

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
const main='nwaxz.bzlom.cn', direct='play.bzlom.cn', origin='https://'+main;
const bundle=await build({configFile:false,logLevel:'silent',build:{
  lib:{entry:'src/escape/coop-client.ts',formats:['es']},write:false,
}});
const script=bundle[0].output.find(file=>file.type==='chunk').code;
const app=createApp(), service=app.locals.coop, server=app.listen(0,'127.0.0.1');
await new Promise(resolve=>server.once('listening',resolve));
const closeSockets=attachCoopSockets(server,service);
const local='ws://127.0.0.1:'+server.address().port;
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH,headless:true});
const a=service.create({version:info.version,name:'队长',avatar:0});
const b=service.join({version:info.version,code:a.code,name:'队友',avatar:1});

async function player(session, blockDirect) {
  const page=await browser.newPage(), authenticated=[];
  let active;
  await page.route(origin+'/**',route=>{
    if(new URL(route.request().url()).pathname==='/client.js')
      return route.fulfill({contentType:'application/javascript',body:script});
    return route.fulfill({contentType:'text/html',body:'<!doctype html><title>Public route test</title>'});
  });
  await page.routeWebSocket('**/socket',route=>{
    const {hostname,pathname}=new URL(route.url());
    assert.ok([direct,main].includes(hostname));
    if(blockDirect && hostname===direct){route.close({code:1001,reason:'direct unavailable'});return;}
    const ws=new WebSocket(local+pathname,{headers:{Host:hostname},origin});
    ws.on('error',()=>{});
    ws.on('close',()=>route.close());
    route.onClose(()=>ws.close());
    ws.on('message',msg=>{
      if(hostname===main && JSON.parse(msg).type==='route-ready')
        setTimeout(()=>{if(ws.readyState===1)route.send(msg.toString());},150);
      else route.send(msg.toString());
    });
    route.onMessage(msg=>{
      if(JSON.parse(msg).type==='auth'){authenticated.push(hostname);active=ws;}
      if(ws.readyState===1)ws.send(msg);else ws.once('open',()=>ws.send(msg));
    });
  });
  await page.goto(origin);
  await page.evaluate(async session=>{
    const {CoopClient}=await import('/client.js');
    window.client=new CoopClient(session);
    window.client.start();window.client.startInputs();
    await window.client.ready(true);
  },session);
  return {page,authenticated,disconnect:()=>active.terminate()};
}

try {
  const host=await player(a,false), guest=await player(b,true);
  assert.deepEqual(host.authenticated,[direct]);assert.deepEqual(guest.authenticated,[main]);
  await host.page.evaluate(()=>window.client.startRoom());
  for (const p of [host,guest]) await p.page.waitForFunction(()=>window.client.snapshot?.room.phase==='playing');
  assert.equal((await guest.page.evaluate(()=>window.client.snapshot.room.players)).length,2);
  host.disconnect();
  await host.page.waitForFunction(()=>window.client.snapshot?.room.players.every(p=>p.status==='connected') && window.client.snapshot.world.elapsed>2);
  assert.ok(await host.page.evaluate(async()=>Number.isFinite(await window.client.ping())));
  assert.deepEqual(host.authenticated,[direct,main]);
  console.log('Two browser players share one room across routes; direct failure retains the session on the main endpoint.');
} finally {
  await browser.close();closeSockets();service.shutdown();app.locals.social.close();server.closeAllConnections();server.close();
}
