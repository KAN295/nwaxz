import type {LobbyProfile,LobbyFriend,LobbyRequest,LobbyInvitation,LobbyRoom,LobbyServer} from './lobby-view.ts';
export const GUEST_IDENTITY_KEY='nwaxz-social-identity-v1';
export type GuestIdentity=LobbyProfile&{token:string};
export class SocialClient {
 identity?:GuestIdentity;
 private ensuring?:Promise<GuestIdentity>;
 constructor(){try{const raw=JSON.parse(localStorage.getItem(GUEST_IDENTITY_KEY)??'null');if(raw?.version===1&&/^\d{9}$/.test(raw.uid)&&/^[\w-]{43}$/.test(raw.token))this.identity={uid:raw.uid,name:raw.name,avatar:raw.avatar,token:raw.token};}catch{/* invalid credentials are replaced on explicit guest creation */}}
 private save(){if(this.identity)try{localStorage.setItem(GUEST_IDENTITY_KEY,JSON.stringify({version:1,...this.identity}));}catch{/* guest remains usable for this page */}}
 private async request(path:string,method='GET',body?:unknown){
  const response=await fetch('/api/social'+path,{method,cache:'no-store',signal:AbortSignal.timeout(7000),headers:{'content-type':'application/json',...(this.identity?{authorization:`Bearer ${this.identity.token}`}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});const data=await response.json();if(!response.ok)throw Object.assign(new Error(data.error??'服务器暂时无法连接'),{status:response.status});return data;
 }
 ensure(){return this.ensuring??=this.loadIdentity().finally(()=>{this.ensuring=undefined;});}
 private async loadIdentity():Promise<GuestIdentity>{
  if(this.identity){try{const me=await this.request('/me');this.identity={...this.identity,...me};this.save();return this.identity!;}catch(error){if((error as {status?:number}).status!==401)throw error;this.identity=undefined;}}
  this.identity=await this.request('/guest','POST',{name:'幸存者',avatar:0});this.save();return this.identity!;
 }
 async update(fields:Partial<Pick<LobbyProfile,'name'|'avatar'>>){await this.ensure();const me=await this.request('/me','PATCH',fields);this.identity={...this.identity!,...me};this.save();return this.identity;}
 async servers(){const at=performance.now(),response=await fetch('/api/coop/servers',{cache:'no-store',signal:AbortSignal.timeout(5000)}),data=await response.json();if(!response.ok)throw new Error(data.error??'服务器离线');return{server:{...data.server,state:'在线',latency:Math.round(performance.now()-at)} as LobbyServer,rooms:data.rooms as LobbyRoom[]};}
 friends():Promise<{friends:LobbyFriend[];requests:LobbyRequest[];invitations:LobbyInvitation[]}>{return this.request('/friends');}
 requestFriend(uid:string){return this.request('/friends/request','POST',{uid});}
 acceptFriend(uid:string){return this.request('/friends/accept','POST',{uid});}
 removeFriend(uid:string){return this.request('/friends/remove','POST',{uid});}
 invite(uid:string,roomCode:string){return this.request('/invite','POST',{uid,roomCode});}
}
