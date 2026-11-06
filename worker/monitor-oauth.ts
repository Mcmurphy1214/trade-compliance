import {OAuthProvider,AuthorizationError,CimdFetchError,authorizationErrorRedirect} from "@cloudflare/workers-oauth-provider";
import type {OAuthHelpers,ConsentDescription,OAuthResourceContext} from "@cloudflare/workers-oauth-provider";
import {workspaceActor,login,sessionCookie,constantEqual,digest,assertBrowserOrigin} from "../lib/workspace-auth";
import {withMonitorIdentity} from "../lib/monitor-context";
import {ensureDatabase} from "../lib/database-setup";
import {monitorOAuthFailure} from "../lib/monitor-oauth-errors";
import {beginMonitorConsent,consumeMonitorConsent,MonitorConsentError} from "../lib/monitor-consent";

const ORIGIN="https://tradecompliance-t.online";
const RESOURCE=ORIGIN+"/mcp";
const SCOPES=["monitor:read","monitor:write","offline_access"];
type AuthEnv=Cloudflare.Env&{OAUTH_PROVIDER:OAuthHelpers};
type Props={userId:string;accountVersion:number};
const escape=(value:string)=>value.replace(/[&<>"']/g,c=>`&#${c.charCodeAt(0)};`);
const challenge={"Cache-Control":"no-store","WWW-Authenticate":`Bearer resource_metadata="${ORIGIN}/.well-known/oauth-protected-resource/mcp"`};
const styles="body{font:16px/1.8 system-ui,'Microsoft YaHei',sans-serif;background:#f2f5fa;color:#19324b;padding:32px}main{max-width:660px;margin:auto;background:white;padding:30px;border-radius:12px}h1{font-size:25px}label{display:block;margin:14px 0}input:not([type=checkbox]){display:block;width:95%;padding:10px;font-size:16px;border:1px solid #ccd7e3;border-radius:6px}button{padding:12px 20px;margin:14px 10px 0 0;background:#245dcc;color:white;border:0;border-radius:6px;font-size:16px}button[value=deny]{background:#63758a}.note{background:#f3f6fa;padding:16px}.small{font-size:13px;color:#64758a}";
function page(body:string,headers=new Headers(),status=200){
 // HTML form POSTs under no-referrer send Origin: null, so the strict
 // same-origin CSRF check rejects even a legitimate consent submission.
 // strict-origin preserves that Origin without exposing authorization query
 // parameters in Referer (including to the registered callback).
 headers.set("Content-Type","text/html;charset=UTF-8");headers.set("Cache-Control","no-store");headers.set("X-Content-Type-Options","nosniff");headers.set("X-Frame-Options","DENY");headers.set("Referrer-Policy","strict-origin");
 headers.set("Content-Security-Policy","default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'");
 return new Response(`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>授权资讯更新 · 合规前沿</title><style>${styles}</style><main>${body}</main></html>`,{status,headers});
}
function consent(details:ConsentDescription,handle:string,signedIn:boolean){
 const labels:Record<string,string>={"monitor:read":"读取公开资讯与监测配置","monitor:write":"新增或修订资讯、保存监测记录（不能管理成员或导出团队资料）",offline_access:"允许保持连接，供已授权的定时任务使用"};
 return `<h1>授权资讯自动更新</h1><p>应用：<strong>${escape(details.clientName)}</strong></p><div class="note"><p>${details.clientDomain?`应用发布域名：${escape(details.clientDomain)}`:"应用名称由注册方提供，请核对回调地址。"}</p><p>授权将交给：<strong>${escape(details.redirectHost)}</strong></p>${details.redirectIsLoopback?'<p>这是你电脑上的应用，仅在你刚发起连接时继续。</p>':''}</div><form method="post" action="/authorize"><input type="hidden" name="handle" value="${escape(handle)}">${signedIn?'<p>使用当前工作台管理员身份授权。</p>':'<label>管理员账号<input name="username" required autocomplete="username" maxlength="40"></label><label>密码<input name="password" type="password" required autocomplete="current-password" maxlength="128"></label>'}${SCOPES.map(s=>`<label><input type="checkbox" name="scope" value="${s}" checked> ${labels[s]}</label>`).join('')}<button name="decision" value="approve">${signedIn?'同意授权':'登录并同意授权'}</button><button name="decision" value="deny" formnovalidate>拒绝</button></form><p class="small">只允许已完成首次改密的管理员授权。停用账号、重置或修改密码后，已有自动更新授权会失效。定时任务仍需另行设置；授权成功不代表已执行采集。</p><p><a href="/?view=login" target="_blank" rel="noopener">打开工作台登录与改密</a></p>`;
}
async function authorize(request:Request,env:AuthEnv){
 const oauth=env.OAUTH_PROVIDER;
 let phase='request';
 try{
  if(request.method==="GET"){
   // Some connections cached CIMD before it failed in production. A DCR-only
   // server must ask the client to register again, never trust a supplied URL
   // as a registration or silently rewrite the authorization request.
   if(/^https?:\/\//i.test(new URL(request.url).searchParams.get('client_id')??'')){
    return page('<h1>请更新插件注册方式</h1><p>本站已切换为动态客户端注册（DCR）。请在 ChatGPT 插件设置中将客户端注册方式改为 DCR，刷新配置后重新连接。</p><p class="small">服务器地址：https://tradecompliance-t.online/mcp<br>认证方式：OAuth<br>原因代码：client_registration_required</p>',undefined,400);
   }
   const auth=await oauth.parseAuthRequest(request);
   if(auth.scope.some(s=>!SCOPES.includes(s)))return page('<h1>请求包含不支持的权限</h1>',undefined,400);
   const count=await env.DB.prepare('SELECT COUNT(*) AS n FROM workspace_users').first<{n:number}>();
   if(!Number(count?.n))return page('<h1>请先初始化管理员</h1><p>本站没有默认密码，也没有开放管理员注册。请由站点所有者先在 Cloudflare D1 控制台完成管理员初始化，再重新发起连接。</p>',undefined,409);
   phase='client';
   const details=await oauth.describeConsent(auth),actor=await workspaceActor(request);
   const transaction=await beginMonitorConsent(env.DB,request,auth,!!actor);
   return page(consent(details,transaction.handle,!!actor),transaction.headers);
  }
  if(request.method!=="POST")return new Response(null,{status:405,headers:{Allow:"GET, POST"}});
  phase='origin';
  assertBrowserOrigin(request);
  phase='consent';
  if(Number(request.headers.get('content-length')||0)>20000)return page('<h1>请求内容过大</h1>',undefined,413);
  const text=await request.text();if(text.length>12000)return page('<h1>请求内容过大</h1>',undefined,413);
  const form=new URLSearchParams(text),handle=form.get('handle')??'';
  const approved=await consumeMonitorConsent(env.DB,request,handle);
  // Revalidate the encrypted server-side request with the OAuth library. The
  // form supplies no client, callback, state, PKCE or resource parameters.
  const original=approved.request;
  const params=new URLSearchParams({client_id:original.clientId,response_type:original.responseType,redirect_uri:original.redirectUri,scope:original.scope.join(' '),state:original.state});
  if(original.resource)params.set('resource',original.resource);
  if(original.codeChallenge)params.set('code_challenge',original.codeChallenge);
  if(original.codeChallengeMethod)params.set('code_challenge_method',original.codeChallengeMethod);
  approved.request=await oauth.parseAuthRequest(new Request(ORIGIN+'/authorize?'+params));
  if(form.get('decision')!=="approve"){
   approved.headers.set('Location',authorizationErrorRedirect(approved.request,'access_denied'));
   return new Response(null,{status:302,headers:approved.headers});
  }
  const scopes=[...new Set(form.getAll('scope'))];
  if(scopes.some(scope=>!SCOPES.includes(scope)))throw new AuthorizationError('invalid_scope',{description:'Unsupported approved scope'});
  approved.request.scope=scopes;
  let actor=await workspaceActor(request),newCookie:string|undefined;
  if(!actor){
   phase='login';
   const token=await login(request,form.get('username'),form.get('password'));
   const headers=new Headers(request.headers);headers.set('Cookie',sessionCookie(token).split(';')[0]);
   actor=await workspaceActor(new Request(request.url,{headers}));newCookie=sessionCookie(token);
  }
  if(!actor||actor.role!=="admin"||actor.mustChangePassword)return page('<h1>需要管理员授权</h1><p>请先在工作台完成首次改密，并以管理员身份重新发起连接。</p>',undefined,403);
  const user=await env.DB.prepare('SELECT version FROM workspace_users WHERE id=? AND disabled=0').bind(actor.id).first<{version:number}>();
  if(!user)return page('<h1>账号不可用</h1>',undefined,403);
  phase='grant';
  const result=await oauth.completeAuthorization({request:approved.request,userId:actor.id,metadata:{purpose:"trade-compliance-monitor"},scope:approved.request.scope,props:{userId:actor.id,accountVersion:user.version}});
  approved.headers.set('Location',result.redirectTo);if(newCookie)approved.headers.append('Set-Cookie',newCookie);
  await env.DB.prepare("INSERT INTO workspace_activity(id,actor_id,actor_name,action,article_id,detail,created_at) VALUES(?,?,?,'授权资讯自动更新',NULL,?,?)").bind(crypto.randomUUID(),actor.id,actor.displayName,JSON.stringify({clientId:approved.request.clientId,scope:approved.request.scope}),new Date().toISOString()).run();
  return new Response(null,{status:302,headers:approved.headers});
 }catch(error){
  const failure=monitorOAuthFailure(error instanceof AuthorizationError||error instanceof CimdFetchError||error instanceof MonitorConsentError?error:{},phase);
  console.warn('Monitor OAuth failure',{code:failure.code,phase});
  return page(`<h1>授权未完成</h1><p>${escape(failure.message)}</p><p class="small">原因代码：${escape(failure.code)}</p>`,undefined,400);
 }
}

type App={fetch(request:Request,env:Cloudflare.Env,ctx:ExecutionContext):Promise<Response>|Response};
export function createMonitorOAuth(app:App){
 const provider=new OAuthProvider<Cloudflare.Env>({
  apiRoute:'/mcp',authorizeEndpoint:'/authorize',tokenEndpoint:'/oauth/token',clientRegistrationEndpoint:'/oauth/register',
  resourceMetadata:{resource:RESOURCE,authorization_servers:[ORIGIN]},requiredScopes:['monitor:read'],scopesSupported:SCOPES,
  // Production CIMD metadata resolution failed for the owner's connection.
  // DCR keeps registration local and preserves OAuth, PKCE and admin checks.
  clientIdMetadataDocumentEnabled:false,accessTokenTTL:3600,refreshTokenTTL:2592000,refreshTokenIdleTTL:2592000,
  tokenExchangeCallback:async options=>({refreshTokenTTL:options.scope.includes('offline_access')?2592000:0}),
  apiHandler:{async fetch(request,env,context){
   const ctx=context as OAuthResourceContext<Props>,props=ctx.props;
   if(!ctx.auth?.scope.includes('monitor:read')||!props?.userId)return Response.json({error:'insufficient_scope'},{status:403,headers:challenge});
   const user=await env.DB.prepare('SELECT role,disabled,must_change_password,version FROM workspace_users WHERE id=?').bind(props.userId).first<{role:string;disabled:number;must_change_password:number;version:number}>();
   if(!user||user.role!=='admin'||user.disabled||user.must_change_password||user.version!==props.accountVersion)return Response.json({error:'invalid_token'},{status:401,headers:challenge});
   return withMonitorIdentity({userId:props.userId,scope:ctx.auth.scope},()=>app.fetch(request,env,ctx));
  }},
  defaultHandler:{async fetch(request,env,ctx){
   if(new URL(request.url).pathname==='/authorize'){await ensureDatabase(env.DB);return authorize(request,env as AuthEnv);}
   return app.fetch(request,env,ctx);
  }}
 });
 return {async fetch(request:Request,env:Cloudflare.Env,ctx:ExecutionContext){
  const path=new URL(request.url).pathname;
  // Keep the optional CLI service credential restricted to the MCP endpoint.
  const token=request.headers.get('authorization')?.match(/^Bearer ([^\s]{32,256})$/)?.[1];
  if(path==='/mcp'&&token&&env.MONITOR_API_TOKEN&&env.MONITOR_API_TOKEN.length>=32&&constantEqual(await digest(token),await digest(env.MONITOR_API_TOKEN)))return app.fetch(request,env,ctx);
  const oauthPath=path==='/mcp'||path==='/authorize'||path.startsWith('/oauth/')||path.startsWith('/.well-known/oauth-');
  if(!oauthPath)return app.fetch(request,env,ctx);
  if(!env.DB)return Response.json({error:'Database binding DB is not configured'},{status:503,headers:{'Cache-Control':'no-store'}});
  if(!env.OAUTH_KV)return Response.json({error:'OAuth storage is not configured'},{status:503,headers:{'Cache-Control':'no-store'}});
  await ensureDatabase(env.DB);
  return provider.fetch(request,env,ctx);
 }};
}
