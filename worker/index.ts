import handler from "vinext/server/fetch-handler";
import {ensureDatabase} from "../lib/database-setup";
import {createMonitorOAuth} from "./monitor-oauth";

const setupPage='<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>工作台数据库配置</title><body style="font-family:system-ui;padding:40px;line-height:1.8"><h1>数据库尚未就绪</h1><p>请检查 Cloudflare 中名为 DB 的 D1 绑定及数据库访问权限，然后重试。详细步骤见仓库 deployment-tools 中的部署说明。</p></body></html>';
const noStore={"Cache-Control":"no-store","X-Content-Type-Options":"nosniff"};
function unavailable(request:Request,database:string){
  return new URL(request.url).pathname.startsWith('/api/')
    ?Response.json({ready:false,database,error:"数据库尚未就绪，请检查 DB 绑定和 D1 权限。"},{status:503,headers:noStore})
    :new Response(setupPage,{status:503,headers:{...noStore,"Content-Type":"text/html;charset=UTF-8"}});
}

// Independent hosting: client-supplied Sites identity headers grant no privileges.
const app = {
  async fetch(request:Request, env:Cloudflare.Env, ctx:ExecutionContext){
    if(!env.DB)return unavailable(request,"missing");
    try{await ensureDatabase(env.DB);}catch(error){
      console.error("D1 initialization failed",error instanceof Error?error.message:"unknown");
      return unavailable(request,"unavailable");
    }
    if(new URL(request.url).pathname==='/api/deployment-health'){
      try{
        const row=await env.DB.prepare('SELECT COUNT(*) AS count FROM workspace_users').first<{count:number}>();
        return Response.json({ready:true,database:"ready",adminInitialized:Number(row?.count)>0,monitorApiConfigured:!!env.MONITOR_API_TOKEN||!!env.OAUTH_KV,oauthConfigured:!!env.OAUTH_KV,schedulesConfigured:false},{headers:noStore});
      }catch{return unavailable(request,"unavailable");}
    }
    const headers=new Headers(request.headers);
    for(const name of [...headers.keys()])if(name.toLowerCase().startsWith("oai-authenticated-"))headers.delete(name);
    return handler.fetch(new Request(request,{headers}),env,ctx);
  }
};
export default createMonitorOAuth(app);
