import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {SocialService} from './social-service.mjs';
import {CoopService} from './coop-service.mjs';
import packageInfo from '../package.json' with {type:'json'};

test('guest UID authenticates privately and mutual friends persist after reopening the separate database',t=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'nwaxz-social-test-')),filename=path.join(directory,'guests.sqlite');let social=new SocialService({filename});
 t.after(()=>{social.close();const resolved=path.resolve(directory);assert.ok(resolved.startsWith(path.resolve(os.tmpdir())+path.sep)&&path.basename(resolved).startsWith('nwaxz-social-test-'));fs.rmSync(resolved,{recursive:true,force:true});});
 const a=social.register({name:'雨衣',avatar:0},'a'),b=social.register({name:'浴袍',avatar:1},'b');
 assert.match(a.uid,/^\d{9}$/);assert.notEqual(a.token,b.token);assert.equal(social.auth(a.token).uid,a.uid);assert.throws(()=>social.auth('x'.repeat(43)),e=>e.status===401);
 const rows=social.db.prepare('SELECT * FROM profiles').all();assert.ok(!JSON.stringify(rows).includes(a.token));assert.ok(!('token_hash' in social.public(a.uid)));
 social.request(a,b.uid);assert.equal(social.snapshot(b,{rooms:new Map()}).requests[0].uid,a.uid);assert.throws(()=>social.accept(a,b.uid),e=>e.status===404);social.accept(b,a.uid);
 social.close();social=new SocialService({filename});assert.equal(social.auth(a.token).uid,a.uid);assert.equal(social.snapshot(a,{rooms:new Map()}).friends[0].uid,b.uid);assert.equal(social.snapshot(a,{rooms:new Map()}).friends[0].online,false);
 social.update(a,{name:'巡夜人',avatar:3});assert.equal(social.public(a.uid).name,'巡夜人');social.remove(a,b.uid);assert.equal(social.snapshot(b,{rooms:new Map()}).friends.length,0);
});
test('password rooms reject a wrong password and only a real friend invitation bypasses it',t=>{
 let now=1000000;const social=new SocialService({now:()=>now}),coop=new CoopService({autoTick:false});t.after(()=>{social.close();coop.close();});
 const a=social.register({name:'甲',avatar:0},'a'),b=social.register({name:'乙',avatar:1},'b'),c=social.register({name:'丙',avatar:2},'c');social.request(a,b.uid);social.accept(b,a.uid);
 const host=coop.create({version:packageInfo.version,name:a.name,avatar:a.avatar,profileUid:a.uid,title:'地下小队',visibility:'private',password:'safe-password'},'a');
 assert.equal(coop.maxRooms,8);const view=coop.view(coop.rooms.get(host.code));assert.equal(view.locked,true);assert.ok(!JSON.stringify(view).includes('safe-password'));assert.ok(!JSON.stringify(view).includes('passwordHash'));
 assert.throws(()=>coop.join({version:packageInfo.version,code:host.code,name:b.name,avatar:b.avatar,password:'wrong'},'b'),e=>e.status===403);
 assert.throws(()=>social.invite(a,c.uid,host.code,coop),e=>e.status===403);social.invite(a,b.uid,host.code,coop);assert.equal(social.snapshot(b,coop).invitations[0].roomCode,host.code);
 const guest=coop.join({version:packageInfo.version,code:host.code,name:b.name,avatar:b.avatar,profileUid:b.uid,invited:social.invited(b.uid,host.code)},'b');assert.ok(guest.playerId);social.consume(b.uid,host.code);assert.equal(social.invited(b.uid,host.code),false);
 social.invite(a,b.uid,host.code,coop);now+=300001;assert.equal(social.invited(b.uid,host.code),false);
});
test('profile and request limits reject malformed or self-directed operations',t=>{
 const social=new SocialService();t.after(()=>social.close());assert.throws(()=>social.register({name:'a'.repeat(13),avatar:0}),e=>e.status===400);const a=social.register({name:'甲',avatar:0});assert.throws(()=>social.request(a,a.uid),e=>e.status===400);assert.throws(()=>social.request(a,'not-a-uid'),e=>e.status===400);
});

test('accept enforces the 100-friend limit for both request endpoints',t=>{
 const social=new SocialService();t.after(()=>social.close());
 const accounts=Array.from({length:102},(_,i)=>social.register({name:`访客${i}`,avatar:0},`ip-${i}`));
 const ordered=[...accounts].sort((a,b)=>a.uid.localeCompare(b.uid)),full=ordered[50],contacts=[...ordered.slice(0,50),...ordered.slice(51,101)],candidate=ordered[101];
 for(const contact of contacts){const[a,b]=[full.uid,contact.uid].sort();social.db.prepare('INSERT INTO friends VALUES(?,?)').run(a,b);}
 assert.equal(social.db.prepare('SELECT count(*) n FROM friends WHERE a=? OR b=?').get(full.uid,full.uid).n,100);
 social.request(full,candidate.uid);
 assert.throws(()=>social.accept(candidate,full.uid),e=>e.status===409);
 assert.equal(social.db.prepare('SELECT sender FROM requests WHERE sender=? AND receiver=?').get(full.uid,candidate.uid)?.sender,full.uid,'the pending request remains after the full sender cannot gain another friend');
 assert.equal(social.snapshot(full,{rooms:new Map()}).friends.length,100);
});

test('removing a friend revokes their room invitation and started rooms expire pending invitations',t=>{
 let now=1000000;const social=new SocialService({now:()=>now}),coop=new CoopService({autoTick:false});t.after(()=>{social.close();coop.close();});
 const host=social.register({name:'房主',avatar:0},'host'),friend=social.register({name:'好友',avatar:1},'friend');social.request(host,friend.uid);social.accept(friend,host.uid);
 const room=coop.create({version:packageInfo.version,name:host.name,avatar:host.avatar,profileUid:host.uid,title:'邀请权限',visibility:'private',password:'pass-phrase'},'host');
 social.invite(host,friend.uid,room.code,coop);assert.equal(social.invited(friend.uid,room.code),true);
 social.remove(friend,host.uid);assert.equal(social.invited(friend.uid,room.code),false);assert.deepEqual(social.snapshot(friend,coop).invitations,[]);
 social.request(host,friend.uid);social.accept(friend,host.uid);social.invite(host,friend.uid,room.code,coop);
 coop.rooms.get(room.code).phase='playing';assert.deepEqual(social.snapshot(friend,coop).invitations,[]);assert.equal(social.invited(friend.uid,room.code),false);
 now+=300001;assert.equal(social.invites.size,0);
});

test('a room invitation stops authorizing password bypass after its sender leaves',t=>{
 const social=new SocialService(),coop=new CoopService({autoTick:false});t.after(()=>{social.close();coop.close();});
 const host=social.register({name:'房主',avatar:0},'host'),target=social.register({name:'邀请对象',avatar:1},'target'),member=social.register({name:'队员',avatar:2},'member');
 social.request(host,target.uid);social.accept(target,host.uid);
 const room=coop.create({version:packageInfo.version,name:host.name,avatar:host.avatar,profileUid:host.uid,title:'队伍',visibility:'private',password:'room-pass'},'host');
 coop.join({version:packageInfo.version,code:room.code,name:member.name,avatar:member.avatar,profileUid:member.uid,password:'room-pass'},'member');
 social.invite(host,target.uid,room.code,coop);assert.equal(social.invited(target.uid,room.code),true);
 coop.leave(room.code,room.token);
 assert.equal(coop.rooms.has(room.code),true,'the other player keeps the lobby alive');
 assert.equal(social.invited(target.uid,room.code),false);
 assert.deepEqual(social.snapshot(target,coop).invitations,[]);
});
