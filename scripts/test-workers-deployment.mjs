import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {Miniflare} from 'miniflare';

const root=path.resolve('dist/server'),config=JSON.parse(fs.readFileSync(path.join(root,'wrangler.json'),'utf8'));
assert.equal(config.name,'trade-compliance');
assert.equal(config.d1_databases[0].binding,'DB');
assert(!config.d1_databases[0].database_id,'First deployment must allow automatic D1 provisioning');
const entry=path.resolve(root,config.main),files=[];
function walk(dir){for(const e of fs.readdirSync(dir,{withFileTypes:true})){const f=path.join(dir,e.name);if(e.isDirectory())walk(f);else if(/\.(?:js|mjs)$/.test(f))files.push(f);}}walk(root);
const modules=[entry,...files.filter(f=>f!==entry)].map(f=>({type:'ESModule',path:f}));
const options={modules,modulesRoot:root,compatibilityDate:config.compatibility_date,compatibilityFlags:config.compatibility_flags,assets:{directory:path.resolve(root,config.assets.directory),binding:'ASSETS',routerConfig:{invoke_user_worker_ahead_of_assets:false,has_user_worker:true}}};
const origin='https://workbench.test';
const missing=new Miniflare(options);
try{
 const health=await missing.dispatchFetch(origin+'/api/deployment-health');assert.equal(health.status,503);assert.equal((await health.json()).database,'missing');
}finally{await missing.dispose();}
const mf=new Miniflare({...options,d1Databases:['DB']});
try{
 // Test the same multi-module Worker that `npx wrangler deploy` uploads,
 // without the Pages adapter or any manual schema import.
 const page=await mf.dispatchFetch(origin+'/');assert.equal(page.status,200);const markup=await page.text();assert(markup.includes('团队工作台'));
 const feed=await mf.dispatchFetch(origin+'/api/feed');assert.equal(feed.status,200);const news=await feed.json();assert.equal(news.articles.length,56);assert(!/正泰|chint|astronergy/i.test(JSON.stringify(news)));
 const state=await(await mf.dispatchFetch(origin+'/api/workspace')).json();assert.equal(state.user,null);for(const key of ['pool','members','rules','activity'])assert.deepEqual(state[key],[]);
 const follow=await mf.dispatchFetch(origin+'/api/workspace',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({action:'follow',articleId:'anonymous-test',version:0})});assert.equal(follow.status,401);
 assert.equal((await mf.dispatchFetch(origin+'/api/workspace?snapshot=anonymous-test&format=xlsx')).status,401);
 const health=await(await mf.dispatchFetch(origin+'/api/deployment-health')).json();assert.equal(health.ready,true);assert.equal(health.adminInitialized,false);assert.equal(health.schedulesConfigured,false);assert.equal(health.contentPrivacy,'company-anonymized-v1');
 const asset=markup.match(/src="(\/_next\/[^\"]+\.js)"/)[1];assert.equal((await mf.dispatchFetch(origin+asset)).status,200);
 const font=await mf.dispatchFetch(origin+'/fonts/NotoSansSC-Regular.ttf');assert.equal(font.status,200);await font.body.cancel();
 // Exercise publication through the actual deployed Worker routes and D1.
 const db=await mf.getD1Database('DB'),a=news.articles[0],token='ab'.repeat(32),now=new Date().toISOString();
 const sessionHash=Buffer.from(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(token))).toString('hex');
 await db.batch([
  db.prepare("INSERT INTO workspace_users(id,username,display_name,role,password_hash,salt,disabled,must_change_password,created_at,updated_at) VALUES('publication-admin','publication-admin','QA admin','admin','test-only-hash','test-only-salt',0,0,?,?)").bind(now,now),
  db.prepare("INSERT INTO workspace_sessions(id,user_id,expires_at,created_at) VALUES(?,'publication-admin',?,?)").bind(sessionHash,new Date(Date.now()+3600000).toISOString(),now)
 ]);
 const headers={Origin:origin,Cookie:'__Host-compliance_session='+token,'Content-Type':'application/json'};
 assert.equal((await mf.dispatchFetch(origin+'/api/topics')).status,200);
 assert.equal((await mf.dispatchFetch(origin+'/api/topics',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({action:'save'})})).status,401);
 const publicTopics=(await(await mf.dispatchFetch(origin+'/api/topics')).json()).tracks;assert(publicTopics.every(t=>t.actions.length===0&&t.updatedBy===''));
 const tracks=await(await mf.dispatchFetch(origin+'/api/topics',{headers})).json();assert.equal(tracks.tracks.length,3);assert(tracks.tracks.every(t=>t.events.length===0));
 const linked=await mf.dispatchFetch(origin+'/api/topics',{method:'POST',headers,body:JSON.stringify({action:'link_article',id:'ndaa',version:0,articleId:a.id,matter:'Worker integration test'})});assert.equal(linked.status,200,await linked.text());
 assert.equal((await(await mf.dispatchFetch(origin+'/api/topics',{headers})).json()).tracks.find(t=>t.id==='ndaa').events[0].articleId,a.id);
 const setVisibility=async(archived,version)=>mf.dispatchFetch(origin+'/api/workspace',{method:'POST',headers,body:JSON.stringify({action:'set_article_visibility',articleId:a.id,archived,version,reason:'Publication integration verification'})});
 const beforePage=await mf.dispatchFetch(origin+'/articles/'+a.id);assert.equal(beforePage.status,200);await beforePage.body.cancel();
 const archived=await setVisibility(true,0);assert.equal(archived.status,200,await archived.text());
 assert(!(await(await mf.dispatchFetch(origin+'/api/feed')).json()).articles.some(x=>x.id===a.id));
 assert.equal((await(await mf.dispatchFetch(origin+'/api/topics')).json()).tracks.find(t=>t.id==='ndaa').events.length,0);
 assert.equal((await(await mf.dispatchFetch(origin+'/api/topics',{headers})).json()).tracks.find(t=>t.id==='ndaa').events.length,0);
 const gone=await mf.dispatchFetch(origin+'/articles/'+a.id);assert.equal(gone.status,404);await gone.body.cancel();
 const adminState=await(await mf.dispatchFetch(origin+'/api/workspace',{headers})).json();assert(adminState.articlePublications.some(x=>x.articleId===a.id&&x.archived));assert(adminState.activity.some(x=>x.articleId===a.id&&x.action==='下架资讯'));
 const restored=await setVisibility(false,1);assert.equal(restored.status,200,await restored.text());
 const restoredPage=await mf.dispatchFetch(origin+'/articles/'+a.id);assert.equal(restoredPage.status,200);await restoredPage.body.cancel();
 assert((await(await mf.dispatchFetch(origin+'/api/feed')).json()).articles.some(x=>x.id===a.id));
 assert.equal((await(await mf.dispatchFetch(origin+'/api/topics',{headers})).json()).tracks.find(t=>t.id==='ndaa').events.length,1);
 console.log('PASS deployed topic routes: private access; three empty templates; trusted source association; archive suppression and restore.');
 console.log('PASS deployed publication routes: authenticated administrator; auto-created schema; seed hidden from feed; direct article returns 404; admin archive and audit readback; restored article returns 200.');
 console.log('PASS Workers deployment: generated config without placeholder IDs; exact multi-module entry and assets; missing DB diagnostics; empty-D1 first request initializes schema; public news and private collaboration; protected exports; readiness endpoint; PDF font.');
}finally{await mf.dispose();}
