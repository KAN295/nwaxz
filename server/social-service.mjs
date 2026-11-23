import {DatabaseSync} from 'node:sqlite';
import {createHash,randomBytes,randomInt} from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
const hash=token=>createHash('sha256').update(token).digest('hex');
const fail=(status,message)=>{throw Object.assign(new Error(message),{status});};
export class SocialService {
 constructor({filename=':memory:',now=Date.now}={}){
  this.now=now;this.present=new Map();this.invites=new Map();this.buckets=new Map();this.apiBuckets=new Map();
  if(filename!==':memory:')fs.mkdirSync(path.dirname(filename),{recursive:true});
  this.db=new DatabaseSync(filename);this.db.exec(`PRAGMA journal_mode=WAL;PRAGMA foreign_keys=ON;
   CREATE TABLE IF NOT EXISTS profiles(uid TEXT PRIMARY KEY,token_hash TEXT UNIQUE NOT NULL,name TEXT NOT NULL,avatar INTEGER NOT NULL);
   CREATE TABLE IF NOT EXISTS friends(a TEXT NOT NULL REFERENCES profiles(uid),b TEXT NOT NULL REFERENCES profiles(uid),PRIMARY KEY(a,b));
   CREATE TABLE IF NOT EXISTS requests(sender TEXT NOT NULL REFERENCES profiles(uid),receiver TEXT NOT NULL REFERENCES profiles(uid),PRIMARY KEY(sender,receiver));`);
 }
 close(){this.db.close();}
 validate(name,avatar){if(typeof name!=='string'||![...name.trim()].length||[...name.trim()].length>12||/[\u0000-\u001f\u007f]/u.test(name)||!Number.isInteger(avatar)||avatar<0||avatar>3)fail(400,'昵称或形象无效');}
 public(uid){if(typeof uid!=='string'||!/^\d{9}$/.test(uid))fail(400,'UID 无效');const row=this.db.prepare('SELECT uid,name,avatar FROM profiles WHERE uid=?').get(uid);if(!row)fail(404,'UID 不存在');return {...row};}
 auth(token){if(typeof token!=='string'||!/^[\w-]{43}$/.test(token))fail(401,'游客身份失效，请重新登录');const row=this.db.prepare('SELECT uid,name,avatar FROM profiles WHERE token_hash=?').get(hash(token));if(!row)fail(401,'游客身份失效，请重新登录');this.present.set(row.uid,this.now());return {...row};}
 register({name='幸存者',avatar=0},ip=''){
  this.validate(name,avatar);const now=this.now(),bucket=this.buckets.get(ip)??{at:now,count:0};if(now-bucket.at>3600000){bucket.at=now;bucket.count=0;}if(++bucket.count>30)fail(429,'这个网络创建的游客过多，请稍后再试');this.buckets.set(ip,bucket);
  if(this.db.prepare('SELECT count(*) n FROM profiles').get().n>=10000)fail(503,'游客名额已满');
  let uid;do{uid=String(randomInt(100000000,1000000000));}while(this.db.prepare('SELECT 1 FROM profiles WHERE uid=?').get(uid));
  const token=randomBytes(32).toString('base64url');this.db.prepare('INSERT INTO profiles VALUES(?,?,?,?)').run(uid,hash(token),name.trim(),avatar);this.present.set(uid,now);return {...this.public(uid),token};
 }
 update(profile,{name=profile.name,avatar=profile.avatar}){this.validate(name,avatar);this.db.prepare('UPDATE profiles SET name=?,avatar=? WHERE uid=?').run(name.trim(),avatar,profile.uid);return this.public(profile.uid);}
 connected(a,b){const[x,y]=[a,b].sort();return !!this.db.prepare('SELECT 1 FROM friends WHERE a=? AND b=?').get(x,y);}
 request(profile,uid){this.public(uid);if(uid===profile.uid)fail(400,'不能添加自己');if(this.connected(profile.uid,uid))return{ok:true};if(this.db.prepare('SELECT count(*) n FROM requests WHERE sender=?').get(profile.uid).n>=25)fail(429,'待处理申请过多');this.db.prepare('INSERT OR IGNORE INTO requests VALUES(?,?)').run(profile.uid,uid);return{ok:true};}
 accept(profile,uid){this.db.exec('BEGIN IMMEDIATE');try{if(!this.db.prepare('SELECT 1 FROM requests WHERE sender=? AND receiver=?').get(uid,profile.uid))fail(404,'申请不存在');const count=this.db.prepare('SELECT count(*) n FROM friends WHERE a=? OR b=?');if(count.get(profile.uid,profile.uid).n>=100||count.get(uid,uid).n>=100)fail(409,'好友已满');const[a,b]=[uid,profile.uid].sort();this.db.prepare('INSERT OR IGNORE INTO friends VALUES(?,?)').run(a,b);this.db.prepare('DELETE FROM requests WHERE (sender=? AND receiver=?) OR (sender=? AND receiver=?)').run(uid,profile.uid,profile.uid,uid);this.db.exec('COMMIT');}catch(e){this.db.exec('ROLLBACK');throw e;}return{ok:true};}
 remove(profile,uid){const[a,b]=[uid,profile.uid].sort();this.db.prepare('DELETE FROM friends WHERE a=? AND b=?').run(a,b);for(const[key,invite]of this.invites)if(invite.fromUid===profile.uid&&invite.toUid===uid||invite.fromUid===uid&&invite.toUid===profile.uid)this.invites.delete(key);return{ok:true};}
 roomOf(uid,coop){for(const room of coop.rooms.values())for(const p of room.players.values())if(p.profileUid===uid&&!['left','eliminated','escaped'].includes(p.status)&&room.peers.has(p.id))return room.code;}
 snapshot(profile,coop){
  const friends=this.db.prepare('SELECT a,b FROM friends WHERE a=? OR b=?').all(profile.uid,profile.uid).map(row=>row.a===profile.uid?row.b:row.a).map(uid=>{const roomCode=this.roomOf(uid,coop);return{id:uid,...this.public(uid),online:!!roomCode||this.now()-(this.present.get(uid)??0)<45000,...(roomCode?{roomCode}:{})};});
  const requests=this.db.prepare('SELECT sender FROM requests WHERE receiver=?').all(profile.uid).map(row=>this.public(row.sender));
  const invitations=[];for(const[key,inv]of this.invites){if(!this.inviteActive(inv,coop)){this.invites.delete(key);continue;}if(inv.toUid===profile.uid)invitations.push({fromUid:inv.fromUid,fromName:this.public(inv.fromUid).name,roomCode:inv.roomCode});}
  return{friends,requests,invitations};
 }
 invite(profile,uid,roomCode,coop){for(const[k,v]of this.invites)if(v.expires<this.now())this.invites.delete(k);if(this.invites.size>=2048&&!this.invites.has(`${uid}:${roomCode}`))fail(429,'邀请过多，请稍后再试');if(!this.connected(profile.uid,uid))fail(403,'请先添加好友');const room=coop.rooms.get(roomCode);if(!room||room.phase!=='lobby'||![...room.players.values()].some(p=>p.profileUid===profile.uid))fail(409,'先加入一个等待中的房间');this.invites.set(`${uid}:${roomCode}`,{fromUid:profile.uid,toUid:uid,roomCode,expires:this.now()+300000,room,rooms:coop.rooms});return{ok:true};}
 inviteActive(inv,coop){const room=coop?.rooms.get(inv.roomCode)??(inv.rooms.get(inv.roomCode)===inv.room?inv.room:undefined);return inv.expires>=this.now()&&room===inv.room&&room?.phase==='lobby'&&[...room.players.values()].some(p=>p.profileUid===inv.fromUid&&!['left','eliminated','escaped'].includes(p.status));}
 invited(uid,roomCode,coop){const key=`${uid}:${roomCode}`,inv=this.invites.get(key);if(inv&&this.inviteActive(inv,coop))return true;if(inv)this.invites.delete(key);return false;}
 consume(uid,roomCode){this.invites.delete(`${uid}:${roomCode}`);}
}
export function mountSocialRoutes(app,{express,service=new SocialService(),coop=()=>app.locals.coop,clientIp=req=>req.ip}){
 const router=express.Router();router.use(express.json({limit:'4kb',strict:true}));
 router.use((req,res,next)=>{const now=service.now(),ip=clientIp(req),b=service.apiBuckets.get(ip)??{at:now,count:0};if(now-b.at>=60000){b.at=now;b.count=0;}service.apiBuckets.set(ip,b);if(++b.count>300){res.status(429).json({error:'操作过于频繁'});return;}if(service.apiBuckets.size>4096)for(const[k,v]of service.apiBuckets)if(now-v.at>60000)service.apiBuckets.delete(k);next();});
 const token=req=>/^Bearer ([\w-]+)$/.exec(req.get('authorization')??'')?.[1]??'';
 const wrap=(keys,fn)=>(req,res)=>{try{if(req.method!=='GET'&&(!req.body||Object.keys(req.body).some(k=>!keys.includes(k))))fail(400,'请求字段无效');res.json(fn(req));}catch(e){res.status(e.status??400).json({error:e.message});}};
 router.post('/guest',wrap(['name','avatar'],req=>service.register(req.body,clientIp(req))));
 router.get('/me',wrap([],req=>service.auth(token(req))));
 router.patch('/me',wrap(['name','avatar'],req=>{const profile=service.update(service.auth(token(req)),req.body);for(const room of coop().rooms.values())if(room.phase==='lobby')for(const player of room.players.values())if(player.profileUid===profile.uid){player.name=profile.name;player.avatar=profile.avatar;room.revision++;}return profile;}));
 router.get('/friends',wrap([],req=>service.snapshot(service.auth(token(req)),coop())));
 router.post('/friends/request',wrap(['uid'],req=>service.request(service.auth(token(req)),req.body.uid)));
 router.post('/friends/accept',wrap(['uid'],req=>service.accept(service.auth(token(req)),req.body.uid)));
 router.post('/friends/remove',wrap(['uid'],req=>service.remove(service.auth(token(req)),req.body.uid)));
 router.post('/invite',wrap(['uid','roomCode'],req=>service.invite(service.auth(token(req)),req.body.uid,req.body.roomCode,coop())));
 router.use((error,_req,res,_next)=>res.status(400).json({error:'请求数据无效'}));
 app.use('/api/social',router);return service;
}
