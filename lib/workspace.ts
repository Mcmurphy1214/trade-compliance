import {anonymizeContent} from "./content-privacy";
import {env} from "cloudflare:workers";
import {feed} from "./store";
import {applyWorkspaceRules} from "./workspace-auto";
import {hashPassword,randomToken,validPassword,sessionToken,digest,constantEqual} from "./workspace-auth";
import {WorkspaceError,assertAdmin,assertEditor,cleanText,parseConditions} from "./workspace-policy";
import {POOL_STATUSES} from "./workspace-types";
import type {WorkspaceActor,WorkspaceState,PoolEntry,WorkspaceRule} from "./workspace-types";
type Raw=Record<string,any>;
const db=()=>env.DB!;
function activity(actor:WorkspaceActor,action:string,articleId:string|null,detail:unknown,nonce?:string){
 let sql="INSERT INTO workspace_activity(id,actor_id,actor_name,action,article_id,detail,created_at) ";
 const args:any[]=[crypto.randomUUID(),actor.id,actor.displayName,action,articleId,JSON.stringify(anonymizeContent(detail)),new Date().toISOString()];
 if(nonce){sql+="SELECT ?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM workspace_pool WHERE article_id=? AND last_mutation=?)";args.push(articleId,nonce);}else sql+="VALUES(?,?,?,?,?,?,?)";
 return db().prepare(sql).bind(...args);
}
const ruleObject=(r:Raw):WorkspaceRule=>({id:r.id,name:r.name,conditions:JSON.parse(r.conditions),enabled:!!r.enabled,version:r.version,updatedAt:r.updated_at,updatedBy:r.updated_by});
export async function workspaceState(actor:WorkspaceActor|null):Promise<WorkspaceState>{
 const base={user:actor,pool:[],rules:[],activity:[],members:[],signInUrl:"/?view=login",serverTime:new Date().toISOString()};
 if(!actor||actor.mustChangePassword)return base;
 const [entries,follows,matches,rules,logs,members]=await db().batch<Raw>([
 db().prepare("SELECT * FROM workspace_pool ORDER BY updated_at DESC"),
 db().prepare("SELECT * FROM workspace_follows WHERE active=1"),
 db().prepare("SELECT * FROM workspace_matches"),
 db().prepare("SELECT * FROM workspace_rules ORDER BY updated_at DESC"),
 db().prepare("SELECT * FROM workspace_activity ORDER BY created_at DESC,rowid DESC LIMIT 250"),
 db().prepare(actor.role==="admin"?"SELECT id,username,display_name,role,disabled,must_change_password,version,created_at FROM workspace_users ORDER BY created_at":"SELECT id FROM workspace_users WHERE 0")
 ]);
 return {...base,pool:entries.results.map((p:Raw):PoolEntry=>({articleId:p.article_id,active:!!p.active,suppressed:!!p.suppressed,note:p.note,status:p.status,version:p.version,updatedAt:p.updated_at,followers:follows.results.filter((f:Raw)=>f.article_id===p.article_id).map((f:Raw)=>({userId:f.user_id,name:f.display_name,at:f.followed_at})),rules:matches.results.filter((r:Raw)=>r.article_id===p.article_id).map((r:Raw)=>({id:r.rule_id,name:r.rule_name,version:r.rule_version,at:r.matched_at}))})),rules:rules.results.map(ruleObject),activity:logs.results.map((r:Raw)=>({id:r.id,actorName:r.actor_name,action:r.action,articleId:r.article_id,detail:r.detail,at:r.created_at})),members:members.results.map((u:Raw)=>({id:u.id,username:u.username,displayName:u.display_name,role:u.role,disabled:!!u.disabled,mustChangePassword:!!u.must_change_password,version:u.version,createdAt:u.created_at}))};
}
async function knownArticle(id:unknown){if(typeof id!=="string"||id.length>100)throw new WorkspaceError(400,"资讯编号无效。");const a=(await feed()).articles.find(a=>a.id===id);if(!a)throw new WorkspaceError(404,"资讯不存在。");return a;}
export async function mutatePool(actor:WorkspaceActor,body:Raw){
 assertEditor(actor.role);const a=await knownArticle(body.articleId),id=a.id,now=new Date().toISOString();
 const p=await db().prepare("SELECT * FROM workspace_pool WHERE article_id=?").bind(id).first<Raw>();
 if(!Number.isInteger(body.version)||body.version!==(p?.version??0))throw new WorkspaceError(409,"其他成员已更新此选题，请刷新后重试。");
 if(["remove","restore"].includes(body.action))assertAdmin(actor.role);
 if(p?.suppressed&&body.action!=="restore")throw new WorkspaceError(409,"此资讯已由管理员移出，请管理员先恢复选题。");
 if(body.action!=="follow"&&(!p||(!p.active&&body.action!=="restore")))throw new WorkspaceError(404,"选题已不在池内，请刷新。");
 const nonce=crypto.randomUUID(),version=p?.version??0,commands:D1PreparedStatement[]=[];
 let note=p?.note??"",status=p?.status??"待研判",active=1,suppressed=p?.suppressed??0;
 let action="",detail:Raw={};
 const follower=await db().prepare("SELECT * FROM workspace_follows WHERE article_id=? AND user_id=? AND active=1").bind(id,actor.id).first<Raw>();
 if(body.action==="follow"){
 if(follower&&p?.active)return {ok:true,unchanged:true};action="加入关注";detail={articleTitle:a.title,source:"manual",merged:!!p?.active};
 }else if(body.action==="unfollow"){
 if(!follower)return {ok:true,unchanged:true};action="取消本人关注";detail={articleTitle:a.title,userId:actor.id,previousFollowedAt:follower.followed_at};
 }else if(body.action==="edit"){
 note=anonymizeContent(cleanText(body.note,5000));status=body.status;if(!POOL_STATUSES.includes(status))throw new WorkspaceError(400,"选题状态无效。");
 if(note===p!.note&&status===p!.status)return {ok:true,unchanged:true};
 }else if(body.action==="remove"){
 active=0;suppressed=1;action="团队移出";detail={articleTitle:a.title,reason:anonymizeContent(cleanText(body.reason,1000)),previous:{note:p!.note,status:p!.status}};
 if(!detail.reason)throw new WorkspaceError(400,"请填写团队移出原因。");
 }else if(body.action==="restore"){
 if(!p?.suppressed)throw new WorkspaceError(400,"此选题无需恢复。");suppressed=0;action="恢复选题";detail={articleTitle:a.title};
 }else throw new WorkspaceError(400,"未知选题操作。");
 if(!p)commands.push(db().prepare("INSERT OR IGNORE INTO workspace_pool(article_id,active,suppressed,note,status,version,last_mutation,created_at,updated_at) VALUES(?,0,0,'','待研判',0,'',?,?)").bind(id,now,now));
 const updateIndex=commands.length;
 commands.push(db().prepare("UPDATE workspace_pool SET active=?,suppressed=?,note=?,status=?,version=version+1,last_mutation=?,updated_at=? WHERE article_id=? AND version=?").bind(active,suppressed,note,status,nonce,now,id,version));
 if(body.action==="follow")commands.push(db().prepare("INSERT INTO workspace_follows(article_id,user_id,display_name,followed_at,active) SELECT ?,?,?,?,1 WHERE EXISTS(SELECT 1 FROM workspace_pool WHERE article_id=? AND last_mutation=?) ON CONFLICT(article_id,user_id) DO UPDATE SET active=1,display_name=excluded.display_name,followed_at=excluded.followed_at").bind(id,actor.id,actor.displayName,now,id,nonce));
 if(body.action==="unfollow"){
 commands.push(db().prepare("UPDATE workspace_follows SET active=0 WHERE article_id=? AND user_id=? AND EXISTS(SELECT 1 FROM workspace_pool WHERE article_id=? AND last_mutation=?)").bind(id,actor.id,id,nonce));
 commands.push(db().prepare("UPDATE workspace_pool SET active=0 WHERE article_id=? AND last_mutation=? AND NOT EXISTS(SELECT 1 FROM workspace_follows WHERE article_id=? AND active=1) AND NOT EXISTS(SELECT 1 FROM workspace_matches WHERE article_id=?)").bind(id,nonce,id,id));
 }
 if(body.action==="edit"){
 if(note!==p!.note)commands.push(activity(actor,"修改备注",id,{articleTitle:a.title,before:p!.note,after:note},nonce));
 if(status!==p!.status)commands.push(activity(actor,"修改选题状态",id,{articleTitle:a.title,before:p!.status,after:status},nonce));
 }else commands.push(activity(actor,action,id,detail,nonce));
 const result=await db().batch(commands);
 if(!result[updateIndex].meta.changes)throw new WorkspaceError(409,"并发更新冲突，本次修改未应用，请刷新后重试。");
 return {ok:true};
}
export async function saveRule(actor:WorkspaceActor,body:Raw){
 assertAdmin(actor.role);const name=anonymizeContent(cleanText(body.name,100));if(!name)throw new WorkspaceError(400,"请填写规则名称。");
 const conditions=parseConditions(anonymizeContent(body.conditions)),enabled=body.enabled!==false,now=new Date().toISOString();
 const old=body.id?await db().prepare("SELECT * FROM workspace_rules WHERE id=?").bind(body.id).first<Raw>():null;
 if(body.id&&!old)throw new WorkspaceError(404,"规则不存在。");if(old&&body.version!==old.version)throw new WorkspaceError(409,"规则已由其他管理员修改，请刷新。");
 const id=old?.id??crypto.randomUUID(),nonce=crypto.randomUUID();
 const stmt=old?db().prepare("UPDATE workspace_rules SET name=?,conditions=?,enabled=?,version=version+1,updated_at=?,updated_by=?,last_mutation=? WHERE id=? AND version=?").bind(name,JSON.stringify(conditions),enabled?1:0,now,actor.displayName,nonce,id,old.version):db().prepare("INSERT INTO workspace_rules(id,name,conditions,enabled,version,updated_at,updated_by,last_mutation) VALUES(?,?,?,?,1,?,?,?)").bind(id,name,JSON.stringify(conditions),enabled?1:0,now,actor.displayName,nonce);
 const result=await db().batch([stmt,db().prepare("INSERT INTO workspace_activity(id,actor_id,actor_name,action,article_id,detail,created_at) SELECT ?,?,?,?,NULL,?,? WHERE EXISTS(SELECT 1 FROM workspace_rules WHERE id=? AND last_mutation=?)").bind(crypto.randomUUID(),actor.id,actor.displayName,old?"修改规则":"创建规则",JSON.stringify({ruleId:id,before:old?ruleObject(old):null,after:{name,conditions,enabled,version:(old?.version??0)+1},operator:actor.displayName}),now,id,nonce)]);
 if(!result[0].meta.changes)throw new WorkspaceError(409,"规则并发修改失败，请刷新。");
 const matched=await applyWorkspaceRules((await feed()).articles);return {ok:true,id,matched};
}
export async function syncRules(actor:WorkspaceActor){assertAdmin(actor.role);const matched=await applyWorkspaceRules((await feed()).articles);await activity(actor,"执行规则",null,{matched}).run();return {ok:true,matched};}
export async function createMember(actor:WorkspaceActor,body:Raw){
 assertAdmin(actor.role);const username=cleanText(body.username,40).toLowerCase(),name=anonymizeContent(cleanText(body.displayName,80)),role=body.role;
 if(!/^[a-z0-9][a-z0-9_.-]{2,39}$/.test(username)||!name||!["admin","editor","viewer"].includes(role))throw new WorkspaceError(400,"账号须为3至40位英文、数字或_.-，并填写姓名及有效角色。");
 if(await db().prepare("SELECT id FROM workspace_users WHERE username=?").bind(username).first())throw new WorkspaceError(409,"账号已存在。");
 const id=crypto.randomUUID(),password="TC!"+randomToken().slice(0,20),salt=randomToken(),hash=await hashPassword(password,salt),now=new Date().toISOString();
 await db().batch([db().prepare("INSERT INTO workspace_users(id,username,display_name,role,password_hash,salt,disabled,must_change_password,version,created_at,updated_at) VALUES(?,?,?,?,?,?,0,1,1,?,?)").bind(id,username,name,role,hash,salt,now,now),activity(actor,"创建独立账号",null,{userId:id,username,displayName:name,role})]);
 return {ok:true,username,temporaryPassword:password};
}
export async function manageMember(actor:WorkspaceActor,body:Raw){
 assertAdmin(actor.role);const member=await db().prepare("SELECT * FROM workspace_users WHERE id=?").bind(body.userId).first<Raw>();if(!member)throw new WorkspaceError(404,"账号不存在。");
 if(member.id===actor.id)throw new WorkspaceError(400,"不能从成员管理停用或重置自己的账号，请使用修改密码。");
 if(member.version!==body.version)throw new WorkspaceError(409,"账号状态已变更，请刷新。");
 const now=new Date().toISOString();let password:string|undefined;const nonce=crypto.randomUUID();let stmt:D1PreparedStatement;
 if(body.action==="reset_password"){password="TC!"+randomToken().slice(0,20);const salt=randomToken();stmt=db().prepare("UPDATE workspace_users SET password_hash=?,salt=?,must_change_password=1,version=version+1,updated_at=?,last_mutation=? WHERE id=? AND version=?").bind(await hashPassword(password,salt),salt,now,nonce,member.id,member.version);
 }else if(body.action==="disable_member"){stmt=db().prepare("UPDATE workspace_users SET disabled=?,version=version+1,updated_at=?,last_mutation=? WHERE id=? AND version=?").bind(body.disabled?1:0,now,nonce,member.id,member.version);
 }else throw new WorkspaceError(400,"未知账号管理操作。");
 const result=await db().batch([stmt,db().prepare("DELETE FROM workspace_sessions WHERE user_id=? AND EXISTS(SELECT 1 FROM workspace_users WHERE id=? AND last_mutation=?)").bind(member.id,member.id,nonce),db().prepare("INSERT INTO workspace_activity(id,actor_id,actor_name,action,article_id,detail,created_at) SELECT ?,?,?,?,NULL,?,? WHERE EXISTS(SELECT 1 FROM workspace_users WHERE id=? AND last_mutation=?)").bind(crypto.randomUUID(),actor.id,actor.displayName,body.action==="reset_password"?"重置密码":body.disabled?"停用账号":"启用账号",JSON.stringify({userId:member.id,username:member.username}),now,member.id,nonce)]);
 if(!result[0].meta.changes)throw new WorkspaceError(409,"账号被并发更新，请刷新。");return {ok:true,username:member.username,...password?{temporaryPassword:password}:{}};
}
export async function changePassword(actor:WorkspaceActor,request:Request,body:Raw){
 if(actor.kind!=="independent")throw new WorkspaceError(400,"平台所有者请在ChatGPT中管理登录安全。");
 const password=validPassword(body.newPassword),old=await db().prepare("SELECT * FROM workspace_users WHERE id=? AND disabled=0").bind(actor.id).first<Raw>();
 if(!old||typeof body.currentPassword!=="string"||body.currentPassword.length>128||!constantEqual(await hashPassword(body.currentPassword,old.salt),old.password_hash))throw new WorkspaceError(400,"当前密码错误。");
 if(password===body.currentPassword)throw new WorkspaceError(400,"新密码不能与当前密码相同。");const salt=randomToken(),hash=await hashPassword(password,salt),now=new Date().toISOString(),token=sessionToken(request);if(!token)throw new WorkspaceError(401,"会话已失效。");
 const nonce=crypto.randomUUID();
 const result=await db().batch([db().prepare("UPDATE workspace_users SET password_hash=?,salt=?,must_change_password=0,version=version+1,updated_at=?,last_mutation=? WHERE id=? AND version=?").bind(hash,salt,now,nonce,actor.id,old.version),db().prepare("DELETE FROM workspace_sessions WHERE user_id=? AND id<>? AND EXISTS(SELECT 1 FROM workspace_users WHERE id=? AND last_mutation=?)").bind(actor.id,await digest(token),actor.id,nonce),db().prepare("INSERT INTO workspace_activity(id,actor_id,actor_name,action,article_id,detail,created_at) SELECT ?,?,?,'修改密码',NULL,?,? WHERE EXISTS(SELECT 1 FROM workspace_users WHERE id=? AND last_mutation=?)").bind(crypto.randomUUID(),actor.id,actor.displayName,JSON.stringify({userId:actor.id}),now,actor.id,nonce)]);
 if(!result[0].meta.changes)throw new WorkspaceError(409,"账号状态已变更，请重新登录。");return {ok:true};
}
