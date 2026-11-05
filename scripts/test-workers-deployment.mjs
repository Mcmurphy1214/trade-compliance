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
 console.log('PASS Workers deployment: generated config without placeholder IDs; exact multi-module entry and assets; missing DB diagnostics; empty-D1 first request initializes schema; public news and private collaboration; protected exports; readiness endpoint; PDF font.');
}finally{await mf.dispose();}
