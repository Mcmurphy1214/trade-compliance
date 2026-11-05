import app from '../dist/server/index.js';
const setupPage='<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>工作台部署配置</title><body style="font-family:system-ui;padding:40px;line-height:1.8"><h1>还差一步：绑定数据库</h1><p>请在 Cloudflare Pages 项目中绑定 D1 数据库，变量名填写 <strong>DB</strong>，执行随附的数据库初始化 SQL，再创建一次正式部署。</p><p>请按部署准备包中的中文说明配置；不要把数据库或管理员口令放进上传 ZIP。</p></body></html>';
export default {
 async fetch(request,env,ctx){
  const url=new URL(request.url);
  if(url.pathname==='/api/deployment-health'){
   if(!env.DB)return Response.json({ready:false,database:'missing',message:'请绑定名为 DB 的 D1 数据库。'},{status:503});
   try{const row=await env.DB.prepare('SELECT COUNT(*) AS count FROM workspace_users').first();return Response.json({ready:true,database:'ready',adminInitialized:Number(row.count)>0,automationConfigured:!!env.MONITOR_API_TOKEN},{headers:{'Cache-Control':'no-store'}});}
   catch{return Response.json({ready:false,database:'schema_missing',message:'请执行数据库初始化 SQL。'},{status:503});}
  }
  if(url.pathname.startsWith('/_next/')||url.pathname.startsWith('/fonts/')||url.pathname==='/favicon.svg')return env.ASSETS.fetch(request);
  if(!env.DB)return new Response(setupPage,{status:503,headers:{'Content-Type':'text/html;charset=UTF-8','Cache-Control':'no-store'}});
  return app.fetch(request,env,ctx);
 }
};
