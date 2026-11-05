import {env} from "cloudflare:workers";
import type {WorkspaceActor} from "./workspace-types";
import {WorkspaceError} from "./workspace-policy";
const COOKIE="__Host-compliance_session";
const encode=(bytes:Uint8Array)=>Array.from(bytes,b=>b.toString(16).padStart(2,"0")).join("");
export const randomToken=()=>encode(crypto.getRandomValues(new Uint8Array(32)));
export async function digest(s:string){return encode(new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(s))));}
export async function hashPassword(password:string,salt:string){const key=await crypto.subtle.importKey("raw",new TextEncoder().encode(password),"PBKDF2",false,["deriveBits"]);return encode(new Uint8Array(await crypto.subtle.deriveBits({name:"PBKDF2",hash:"SHA-256",salt:new TextEncoder().encode(salt),iterations:100000},key,256)));}
export function validPassword(password:unknown){if(typeof password!=="string"||password.length<12||password.length>128)throw new WorkspaceError(400,"密码长度须为12至128个字符。");return password;}
export function constantEqual(a:string,b:string){let diff=a.length^b.length;for(let i=0;i<Math.max(a.length,b.length);i++)diff|=(a.charCodeAt(i)||0)^(b.charCodeAt(i)||0);return diff===0;}
export function sessionToken(request:Request){const raw=request.headers.get("cookie")??"";return raw.split(";").map(s=>s.trim()).find(s=>s.startsWith(COOKIE+"="))?.slice(COOKIE.length+1)??null;}
export function sessionCookie(token:string,maxAge=604800){return `${COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;}
export async function workspaceActor(request:Request):Promise<WorkspaceActor|null>{
 const token=sessionToken(request);
 if(token&&/^[a-f0-9]{64}$/.test(token)){
 const row=await env.DB!.prepare("SELECT u.* FROM workspace_sessions s JOIN workspace_users u ON u.id=s.user_id WHERE s.id=? AND s.expires_at>? AND u.disabled=0").bind(await digest(token),new Date().toISOString()).first<any>();
 if(row)return {id:row.id,username:row.username,displayName:row.display_name,role:row.role,kind:"independent",mustChangePassword:!!row.must_change_password};
 }

 return null;
}
export async function requireActor(request:Request,allowPasswordChange=false){const actor=await workspaceActor(request);if(!actor)throw new WorkspaceError(401,"请先登录团队工作台。");if(actor.mustChangePassword&&!allowPasswordChange)throw new WorkspaceError(403,"首次登录请先修改初始密码。");return actor;}
export function assertBrowserOrigin(request:Request){const origin=request.headers.get("origin");if(!origin||origin!==new URL(request.url).origin)throw new WorkspaceError(403,"请求来源无效，请从工作台重新提交。");if(request.headers.get("sec-fetch-site")==="cross-site")throw new WorkspaceError(403,"不允许跨站提交。");}
export async function login(request:Request,username:unknown,password:unknown){
 if(typeof username!=="string"||typeof password!=="string"||username.length>64||password.length>128)throw new WorkspaceError(400,"账号或密码格式无效。");
 const name=username.trim().toLowerCase();const time=new Date(),now=time.toISOString(),reset=new Date(+time+900000).toISOString();
 const ip=request.headers.get("cf-connecting-ip")??"shared";
 const keys=[await digest("ip:"+ip),await digest("account:"+name)];
 await env.DB!.batch(keys.map(id=>env.DB!.prepare("INSERT INTO workspace_login_limits(id,attempts,reset_at) VALUES(?,1,?) ON CONFLICT(id) DO UPDATE SET attempts=CASE WHEN reset_at<? THEN 1 ELSE attempts+1 END,reset_at=CASE WHEN reset_at<? THEN excluded.reset_at ELSE reset_at END").bind(id,reset,now,now)));
 const limits=await env.DB!.prepare("SELECT id,attempts FROM workspace_login_limits WHERE id IN (?,?)").bind(...keys).all<{id:string;attempts:number}>();
 if(limits.results.some(r=>r.attempts>(r.id===keys[0]?40:10)))throw new WorkspaceError(429,"尝试次数过多，请15分钟后重试或联系管理员。");
 const row=await env.DB!.prepare("SELECT * FROM workspace_users WHERE username=?").bind(name).first<any>();
 const computed=await hashPassword(password,row?.salt??"invalid-account-timing-salt");
 if(!row||row.disabled||!constantEqual(computed,row.password_hash))throw new WorkspaceError(401,"账号或密码错误，或账号已停用。");
 const token=randomToken();
 await env.DB!.batch([
 env.DB!.prepare("DELETE FROM workspace_sessions WHERE expires_at<?").bind(now),
 env.DB!.prepare("DELETE FROM workspace_login_limits WHERE reset_at<?").bind(now),
 env.DB!.prepare("INSERT INTO workspace_sessions(id,user_id,expires_at,created_at) VALUES(?,?,?,?)").bind(await digest(token),row.id,new Date(+time+604800000).toISOString(),now),
 env.DB!.prepare("INSERT INTO workspace_activity(id,actor_id,actor_name,action,article_id,detail,created_at) VALUES(?,?,?,?,NULL,?,?)").bind(crypto.randomUUID(),row.id,row.display_name,"登录",JSON.stringify({kind:"independent"}),now)
 ]);
 return token;
}
