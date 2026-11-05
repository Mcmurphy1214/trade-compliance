import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { DatabaseSync } from 'node:sqlite';
import ts from 'typescript';
import { catalogLoader, catalogPage, readOfficialCatalog } from '../lib/official-catalog.ts';

const page='<script url="/api-gateway/jpaas-publish-server/front/page/build/unit" queryData="{\'parseType\':\'bulidstatic\',\'webId\':\'web\',\'pageId\':\'page\',\'tagId\':\'列表\'}"></script>';
const html=(number,title='咨询')=>`<li><a href="/x/art/2026/a${number}.html">${title}</a><span>2026-11-24</span><span>截止</span></li><div count="2" pageNo="${number}" rows="1"></div>`;
assert.throws(()=>catalogLoader('<html>栏目壳</html>','https://www.mofcom.gov.cn/zqyj/'),/不能将栏目壳/);
assert.throws(()=>catalogLoader(page.replace('/api-gateway/jpaas-publish-server/front/page/build/unit','https://attacker.test'),'https://www.mofcom.gov.cn/'),/接口发生变化/);
assert.equal(catalogPage(html(1),'https://www.mofcom.gov.cn/','deadline').entries[0].dateRole,'deadline');
assert.throws(()=>catalogPage('<li>no pagination</li>','https://www.mofcom.gov.cn/','published'),/分页数量/);
let calls=0;
const fetcher=async url=>{calls++;if(!String(url).includes('/api-gateway/'))return new Response(page);const n=JSON.parse(new URL(url).searchParams.get('paramJson')).pageNo;return Response.json({success:true,data:{html:html(n)}});};
const full=await readOfficialCatalog('cn-consultations-policy',8,fetcher);
assert.equal(full.complete,true);assert.equal(full.entries.length,2);assert.equal(full.pagesRead,2);assert.equal(calls,3);
assert.equal((await readOfficialCatalog('cn-consultations-policy',1,fetcher)).complete,false,'bounded fetch must report remaining pages');
await assert.rejects(()=>readOfficialCatalog('https://attacker.test',8,fetcher),/不支持/);
await assert.rejects(()=>readOfficialCatalog('cn-consultations-policy',8,async url=>!String(url).includes('/api-gateway/')?new Response(page):Response.json({success:true,data:{html:html(1)}})),/请求页码/);

const root=path.resolve(import.meta.dirname,'..');const sqlite=new DatabaseSync(':memory:');
for(const file of fs.readdirSync(path.join(root,'drizzle')).filter(f=>f.endsWith('.sql')).sort())sqlite.exec(fs.readFileSync(path.join(root,'drizzle',file),'utf8'));
const db={prepare(sql){let args=[];const statement=sqlite.prepare(sql);return{bind(...values){args=values;return this;},async first(){return statement.get(...args)??null;},async run(){return statement.run(...args);}};}};
const cache=new Map();let networkCalls=0;
function load(file){file=path.resolve(root,file);if(!path.extname(file))file+='.ts';if(file.endsWith('.json'))return JSON.parse(fs.readFileSync(file,'utf8'));if(cache.has(file))return cache.get(file).exports;const module={exports:{}};cache.set(file,module);const code=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText;vm.runInNewContext(code,{exports:module.exports,module,require(name){if(name==='cloudflare:workers')return{env:{DB:db,SITE_EDITOR_EMAIL:'owner@example.test'}};if(name.startsWith('.'))return load(path.relative(root,path.resolve(path.dirname(file),name)));throw Error(name);},crypto,TextEncoder,URL,URLSearchParams,Request,Response,AbortSignal,fetch:async()=>{networkCalls++;throw Error('unplanned network');},console},{filename:file});return module.exports;}
const snapshots=load('lib/sanctions-snapshot.ts');
const records=Array.from({length:600},(_,i)=>`<INDIVIDUAL><DATAID>${i}</DATAID><FIRST_NAME>name${i}</FIRST_NAME></INDIVIDUAL>`).join('')+Array.from({length:150},(_,i)=>`<ENTITY><DATAID>${i}</DATAID><FIRST_NAME>entity${i}</FIRST_NAME></ENTITY>`).join('');
const xml=(stamp,body=records)=>`<CONSOLIDATED_LIST dateGenerated="${stamp}">${body}</CONSOLIDATED_LIST>`;
await assert.rejects(()=>snapshots.parseUnSnapshot('<html>XML unavailable</html>'),/完整联合国XML/);
await assert.rejects(()=>snapshots.parseUnSnapshot(xml('x','<ENTITY><DATAID>1</DATAID></ENTITY>')),/数量异常/);
const first=await snapshots.checkUnSanctionsChanges(async()=>new Response(xml('2026-11-03')));
assert.equal(first.baselineCreated,true);assert.equal(first.individuals,600);assert.equal(first.entities,150);
const repeat=await snapshots.checkUnSanctionsChanges(async()=>new Response(xml('2026-11-04')));
assert.equal(repeat.baselineCreated,false);assert.equal(repeat.changed.length,0,'file generation time alone is not a policy change');
const changed=await snapshots.checkUnSanctionsChanges(async()=>new Response(xml('2026-11-04',records.replace('name12<','new alias<'))));
assert.equal(changed.changed.length,1);assert.equal(changed.changed[0],'INDIVIDUAL:12');
const before=sqlite.prepare('SELECT payload FROM monitor_source_state').get().payload;
await assert.rejects(()=>snapshots.checkUnSanctionsChanges(async()=>new Response('<html>service error</html>')),/完整联合国XML/);
assert.equal(sqlite.prepare('SELECT payload FROM monitor_source_state').get().payload,before,'error page cannot destroy baseline');
const handler=load('app/mcp/route.ts');
for(const tool of ['read_official_catalog','check_un_sanctions_changes']){
 const response=await handler.POST(new Request('https://news.test/mcp',{method:'POST',body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name:tool,arguments:{source_ids:['cn-consultations-policy']}}})}));
 assert.equal(response.status,401,'anonymous caller cannot probe sources or mutate baselines');
}
const publicList=await handler.POST(new Request('https://news.test/mcp',{method:'POST',body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/list'})}));
assert.equal((await publicList.json()).result.tools.some(t=>t.name==='check_un_sanctions_changes'),false);
assert.equal(networkCalls,0,'unauthorized RPC never reaches official fetch');
const requestRun={windowStart:'2026-11-02T01:00:00Z',cutoff:'2026-11-03T01:00:00Z',checkedSources:[],gaps:[],summary:'requested check test',status:'已完成',sourceCheckRequests:['un-consolidated']};
const checked=await handler.POST(new Request('https://news.test/mcp',{method:'POST',headers:{'oai-authenticated-user-id':'owner-test','oai-authenticated-user-email':'owner@example.test'},body:JSON.stringify({jsonrpc:'2.0',id:2,method:'tools/call',params:{name:'record_monitor_run',arguments:{run:requestRun}}})}));
const checkedRun=JSON.parse((await checked.json()).result.content[0].text).run;
assert.equal(checkedRun.sourceCheckResults[0].status,'access_failed');
assert.equal(checkedRun.status,'部分完成','failed requested check must never claim complete');
assert.equal(networkCalls,1,'owner explicitly requested check runs once');
assert.equal(sqlite.prepare('SELECT payload FROM monitor_source_state').get().payload,before,'failed live fetch preserves the saved baseline');
sqlite.close();
console.log('PASS source recovery: full pagination, deadline semantics, fail-closed catalogs, SQLite snapshot baseline/diff, generated-time exclusion, error preservation and owner-only tools');
