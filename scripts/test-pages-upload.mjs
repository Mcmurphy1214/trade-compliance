import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {Miniflare} from 'miniflare';
import {unzipSync,strFromU8} from 'fflate';

// Run the exact offline admin helper without a network-capable DOM.
const controls=new Map();const element=id=>{if(!controls.has(id))controls.set(id,{value:'',hidden:false,textContent:'',addEventListener(event,fn){this[event]=fn;},select(){}});return controls.get(id);};
const html=fs.readFileSync('deployment-tools/管理员初始化工具.html','utf8'),js=html.match(/<script>([\s\S]*)<\/script>/)[1];
const password='Test-Only-Initial-Password!';
for(const [id,value]of Object.entries({username:'local-admin',displayName:'Local Admin',password,confirm:password}))element(id).value=value;
vm.runInNewContext(js,{document:{getElementById:element},crypto,TextEncoder,Uint8Array,Blob,URL,Error,console},{filename:'offline-admin-helper.js'});
await element('form').submit({preventDefault(){}});assert.equal(element('error').textContent,'');
const adminSql=element('sql').value;assert(adminSql.includes('WHERE NOT EXISTS'));assert(!adminSql.includes(password));assert.equal(element('password').value,'');

const mf=new Miniflare({modules:[{type:'ESModule',path:path.resolve('pages-upload/_worker.js')}],compatibilityDate:'2026-05-15',compatibilityFlags:['nodejs_compat'],d1Databases:['DB'],bindings:{MONITOR_API_TOKEN:'test-only-monitor-credential-0123456789abcdef'},assets:{directory:'pages-upload',binding:'ASSETS',routerConfig:{invoke_user_worker_ahead_of_assets:true,has_user_worker:true}}});
const origin='https://workbench.test';
async function request(route,options={}){return mf.dispatchFetch(origin+route,options);}
async function post(body,cookie='',extra={}){return request('/api/workspace',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json',...(cookie?{cookie}:{}),...extra},body:JSON.stringify(body)});}
try{
 const early=await request('/api/deployment-health');assert.equal(early.status,503);assert.equal((await early.json()).database,'schema_missing');
 const db=await mf.getD1Database('DB'),schema=fs.readFileSync('deployment-tools/数据库初始化.sql','utf8').replace(/^\s*--.*$/gm,'');
 for(const statement of schema.split(';').map(s=>s.trim()).filter(Boolean))await db.prepare(statement).run();
 for(const statement of schema.split(';').map(s=>s.trim()).filter(Boolean))await db.prepare(statement).run(); // safe repeated schema setup
 let health=await(await request('/api/deployment-health')).json();assert.equal(health.ready,true);assert.equal(health.adminInitialized,false);
 await db.prepare(adminSql.split('\n')[0]).run();await db.prepare(adminSql.split('\n')[0]).run();assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM workspace_users').first()).n,1);
 const denied=await post({action:'create_member',username:'forged',displayName:'x',role:'admin'},'',{'oai-authenticated-user-id':'attacker','oai-authenticated-user-email':'owner@example.test'});assert.equal(denied.status,401);
 let res=await post({action:'login',username:'local-admin',password});assert.equal(res.status,200);const cookie=res.headers.get('set-cookie').split(';')[0];assert(res.headers.get('set-cookie').includes('HttpOnly; Secure; SameSite=Lax'));
 let session=await(await request('/api/session',{headers:{cookie}})).json();assert.equal(session.canEdit,false);
 assert.equal((await post({action:'create_member',username:'blocked',displayName:'x',role:'editor'},cookie)).status,403);
 res=await post({action:'change_password',currentPassword:password,newPassword:'Test-Only-Replacement-Password!'},cookie);assert.equal(res.status,200);
 session=await(await request('/api/session',{headers:{cookie}})).json();assert.equal(session.canEdit,true);
 const feed=await(await request('/api/feed')).json();assert.equal(feed.articles.length,56);assert.equal(feed.run.scheduleEnabled,false);assert.equal(feed.run.newCount,0);
 const article=feed.articles[0];res=await post({action:'follow',articleId:article.id,version:0},cookie);assert.equal(res.status,200);
 res=await post({action:'create_export',articleIds:[article.id]},cookie);assert.equal(res.status,200);const snapshot=await res.json();
 res=await request(snapshot.xlsx,{headers:{cookie}});assert.equal(res.status,200);const file=unzipSync(new Uint8Array(await res.arrayBuffer())),sheet=strFromU8(file['xl/worksheets/sheet1.xml']);
 const labels=[...sheet.match(/<row r="1"[^>]*>([\s\S]*?)<\/row>/)[1].matchAll(/<t xml:space="preserve">([^<]*)<\/t>/g)].map(x=>x[1]);assert.deepEqual(labels,['原文标题','内容简述','建议','领域','信息发布日期','原文链接']);
 assert.equal((await request(snapshot.xlsx)).status,401);const briefing=await(await request(snapshot.briefing,{headers:{cookie}})).json();assert.equal(briefing.snapshot.articles[0].content,article.content);
 const service=await post({action:'create_member',username:'service-escalation',displayName:'x',role:'admin'},'',{Authorization:'Bearer test-only-monitor-credential-0123456789abcdef'});assert.equal(service.status,401);
 const rpc=await request('/mcp',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer test-only-monitor-credential-0123456789abcdef'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/list'})});assert((await rpc.json()).result.tools.some(t=>t.name==='upsert_articles'));
 assert.equal((await post({action:'create_member',username:'cross-site',displayName:'x',role:'editor'},cookie,{Origin:'https://attacker.test'})).status,403);
 const page=await request('/');assert.equal(page.status,200);const markup=await page.text();assert(markup.includes('团队工作台'));assert(!markup.includes('使用ChatGPT管理身份登录'));
 const asset=markup.match(/src="(\/_next\/[^\"]+\.js)"/)[1];const script=await request(asset);assert.equal(script.status,200);assert((await script.text()).length>0);
 const font=await request('/fonts/NotoSansSC-Regular.ttf');assert.equal(font.status,200);await font.body.cancel();
 health=await(await request('/api/deployment-health')).json();assert.equal(health.adminInitialized,true);
 console.log('PASS Pages upload: exact single-file Worker, SSR and assets; D1 schema and repeated safe setup; offline password hashing; first-password gate; forged-header rejection; admin permissions; CSRF; immutable exports with exact six Excel columns; MCP scope; 56 migrated articles; no migrated schedules.');
}finally{await mf.dispose();}
