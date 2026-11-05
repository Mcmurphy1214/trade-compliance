import app from '../dist/server/index.js';
const setupPage='<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>工作台部署配置</title><body style="font-family:system-ui;padding:40px;line-height:1.8"><h1>还差一步：绑定数据库</h1><p>请在 Cloudflare Pages 项目中绑定 D1 数据库，变量名填写 <strong>DB</strong>，执行随附的数据库初始化 SQL，再创建一次正式部署。</p><p>请按部署准备包中的中文说明配置；不要把数据库或管理员口令放进上传 ZIP。</p></body></html>';
export default {
 async fetch(request,env,ctx){
  const url=new URL(request.url);
  if(url.pathname.startsWith('/_next/')||url.pathname.startsWith('/fonts/')||url.pathname==='/favicon.svg')return env.ASSETS.fetch(request);
  if(!env.DB&&url.pathname!=='/api/deployment-health')return new Response(setupPage,{status:503,headers:{'Content-Type':'text/html;charset=UTF-8','Cache-Control':'no-store'}});
  return app.fetch(request,env,ctx);
 }
};
