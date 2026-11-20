import assert from 'node:assert/strict';
import fs from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {build} from 'esbuild';
import {unzipSync,strFromU8} from 'fflate';
import {pathToFileURL} from 'node:url';
import {importantDateGroups} from '../lib/regulatory.ts';

const sharedDate='2026-11-23';
const effect={date:sharedDate,label:'条例或指令生效，另核具体适用节点',timezone:'Europe/Brussels'};
const comment={date:sharedDate,label:'征求意见截止',timezone:'Europe/Brussels'};
const later={date:'2026-12-10',label:'过渡期结束',timezone:'Europe/Brussels'};
const title='工作台测试资讯';
const article={id:'regulation',title,effectiveDate:sharedDate,expiryDate:null,deadlines:[later,effect,comment,effect,{date:'待定',label:'待定',timezone:''}]};
const other={id:'same-title',title,effectiveDate:sharedDate,expiryDate:null,deadlines:[]};
const early={id:'early',title:'较早节点',effectiveDate:null,expiryDate:'2026-11-19',deadlines:[{date:'2026-11-19',label:'有效期届满',timezone:'Asia/Seoul'}]};
const items=[article,other,early];
const seven=importantDateGroups(items,'2026-11-18',7);
assert.deepEqual(seven.map(group=>group.article.id),['early','regulation','same-title']);
assert.deepEqual(seven[1].dates,[effect,comment]);
assert.equal(seven[2].dates[0].label,'生效日期');
assert.deepEqual(seven[0].dates,early.deadlines);
assert.deepEqual(importantDateGroups(items,'2026-11-18',30)[1].dates,[effect,comment,later]);
assert.deepEqual(importantDateGroups(items,'2026-12-19',7),[]);
const sameDayDifferentEvent={...other,deadlines:[comment]};
assert.equal(importantDateGroups([sameDayDifferentEvent],'2026-11-18',7)[0].dates.length,2);
const filterBuild=await build({entryPoints:['lib/workspace-filters.ts'],bundle:true,platform:'node',format:'esm',write:false});
const exportBuild=await build({entryPoints:['lib/workspace-export.ts'],bundle:true,platform:'node',format:'esm',write:false});
const {excelDisplayText}=await import('data:text/javascript;base64,'+Buffer.from(exportBuild.outputFiles[0].text).toString('base64'));
const {validDate,inPublicationRange}=await import('data:text/javascript;base64,'+Buffer.from(filterBuild.outputFiles[0].text).toString('base64'));
assert(validDate('2024-02-29'));assert(!validDate('2026-02-29'));assert(!validDate('2026-13-01'));
assert(inPublicationRange('2026-11-01','2026-11-01','2026-11-04'));assert(inPublicationRange('2026-11-04','2026-11-01','2026-11-04'));
assert(!inPublicationRange('2026-10-31','2026-11-01','2026-11-04'));assert(!inPublicationRange('2026-11-05','2026-11-01','2026-11-04'));
assert(inPublicationRange('2026-11-04','','2026-11-04'));assert(inPublicationRange('2026-11-04','2026-11-04',''));
assert(!inPublicationRange(null,'2026-11-01',''));assert(inPublicationRange(null,'',''));assert(!inPublicationRange('2026-11-03','2026-11-04','2026-11-01'));
const sqlite=new DatabaseSync(':memory:');
for(const file of fs.readdirSync('drizzle').filter(f=>f.endsWith('.sql')).sort())sqlite.exec(fs.readFileSync('drizzle/'+file,'utf8'));
class Statement{
 constructor(sql,args=[]){this.sql=sql;this.args=args;}
 bind(...args){return new Statement(this.sql,args);}
 execute(){const s=sqlite.prepare(this.sql);if(/^\s*(SELECT|PRAGMA)/i.test(this.sql))return {results:s.all(...this.args),meta:{changes:0},success:true};const r=s.run(...this.args);return {results:[],meta:{changes:Number(r.changes)},success:true};}
 async all(){return this.execute();}
 async run(){return this.execute();}
 async first(){return this.execute().results[0]??null;}
}
globalThis.__WORKSPACE_TEST_ENV={DB:{prepare:sql=>new Statement(sql),batch:async statements=>{sqlite.exec('BEGIN');try{const r=statements.map(s=>s.execute());sqlite.exec('COMMIT');return r;}catch(e){sqlite.exec('ROLLBACK');throw e;}}}};
const compiled=await build({entryPoints:['app/api/workspace/route.ts'],bundle:true,platform:'node',target:'node24',format:'esm',write:false,plugins:[{name:'worker-test-env',setup(b){b.onResolve({filter:/^cloudflare:workers$/},()=>({path:'env',namespace:'test-env'}));b.onLoad({filter:/.*/,namespace:'test-env'},()=>({contents:'export const env=globalThis.__WORKSPACE_TEST_ENV;',loader:'js'}));}}]});
const route=await import('data:text/javascript;base64,'+Buffer.from(compiled.outputFiles[0].text).toString('base64'));
const base='https://workbench.example.test';
let owner={};
async function post(body,headers={},expect=200){const res=await route.POST(new Request(base+'/api/workspace',{method:'POST',headers:{Origin:base,'Content-Type':'application/json',...headers},body:JSON.stringify(body)}));const data=await res.json();assert.equal(res.status,expect,JSON.stringify(data));return {res,data};}
async function state(headers={}){const res=await route.GET(new Request(base+'/api/workspace',{headers}));assert.equal(res.status,200);return res.json();}
let s=await state();assert.equal(s.user,null);assert.deepEqual(s.activity,[]);assert.deepEqual(s.pool,[]);
await post({action:'follow',articleId:'unknown',version:0},{},401);
const cross=await route.POST(new Request(base+'/api/workspace',{method:'POST',headers:{Origin:'https://evil.test'},body:'{}'}));assert.equal(cross.status,403);
async function account(username,role){const {data}=await post({action:'create_member',username,displayName:username,role},owner);const first=await post({action:'login',username,password:data.temporaryPassword});const cookie=first.res.headers.get('set-cookie').split(';')[0];assert(first.res.headers.get('set-cookie').includes('HttpOnly; Secure; SameSite=Lax'));let session=await state({cookie});assert.equal(session.user.mustChangePassword,true);assert.equal(session.pool.length,0);await post({action:'follow',articleId:'x',version:0},{cookie},403);await post({action:'set_article_visibility',articleId:'x',version:0,archived:true,reason:'test'},{cookie},403);const password='Personal-Password!'+username;await post({action:'change_password',currentPassword:data.temporaryPassword,newPassword:password},{cookie});session=await state({cookie});assert.equal(session.user.mustChangePassword,false);return {headers:{cookie},password,user:session.user};}
const adminPass='Test-Only-Admin-Password!';const adminSalt='test-only-admin-salt';const adminKey=await crypto.subtle.importKey('raw',new TextEncoder().encode(adminPass),'PBKDF2',false,['deriveBits']);
const adminHash=Buffer.from(await crypto.subtle.deriveBits({name:'PBKDF2',salt:new TextEncoder().encode(adminSalt),iterations:100000,hash:'SHA-256'},adminKey,256)).toString('hex');
sqlite.prepare("INSERT INTO workspace_users(id,username,display_name,role,password_hash,salt,disabled,must_change_password,version,last_mutation,created_at,updated_at) VALUES('qa-admin','qa-admin','Admin','admin',?,?,0,0,1,'',?,?)").run(adminHash,adminSalt,new Date().toISOString(),new Date().toISOString());
const adminLogin=await post({action:'login',username:'qa-admin',password:adminPass});owner={cookie:adminLogin.res.headers.get('set-cookie').split(';')[0]};
await post({action:'create_member',username:'forged-admin',displayName:'x',role:'admin'},{'oai-authenticated-user-id':'forged','oai-authenticated-user-email':'owner@example.test'},401);
const alice=await account('alice','editor'),bob=await account('bobby','editor'),viewer=await account('viewer','viewer');
await post({action:'login',username:'alice',password:'invalid'},{},401);
await post({action:'create_member',username:'elevated',displayName:'x',role:'admin'},alice.headers,403);
await post({action:'follow',articleId:'x',version:0},viewer.headers,403);
const feed=JSON.parse(fs.readFileSync('lib/seed.json','utf8'));const a=feed[0];
await post({action:'follow',articleId:a.id,version:0},alice.headers);s=await state(owner);let p=s.pool.find(x=>x.articleId===a.id);assert.equal(p.followers.length,1);
await post({action:'follow',articleId:a.id,version:p.version},bob.headers);s=await state(owner);p=s.pool.find(x=>x.articleId===a.id);assert.equal(s.pool.filter(x=>x.active).length,1);assert.equal(p.followers.length,2);assert(p.followers.every(f=>f.at));
await post({action:'edit',articleId:a.id,version:p.version-1,note:'stale',status:'研判中'},alice.headers,409);
const firstVersion=p.version;await post({action:'edit',articleId:a.id,version:p.version,note:'团队评估备注，含<&>与换行\n保留全文',status:'拟纳入简报'},alice.headers);s=await state(owner);p=s.pool.find(x=>x.articleId===a.id);const auditLength=s.activity.length;
await post({action:'edit',articleId:a.id,version:firstVersion,note:'overwrite',status:'已归档'},bob.headers,409);assert.equal((await state(owner)).activity.length,auditLength);
await post({action:'unfollow',articleId:a.id,version:p.version},alice.headers);s=await state(owner);p=s.pool.find(x=>x.articleId===a.id);assert.equal(p.followers.length,1);assert.equal(p.followers[0].name,'bobby');assert.equal(p.active,true);
await post({action:'remove',articleId:a.id,version:p.version,reason:'x'},bob.headers,403);
const conditions={categories:[a.category],jurisdictions:[a.jurisdiction],topics:[],statuses:[]};const rule=await post({action:'save_rule',name:'业务监测',conditions,enabled:true},owner);assert(rule.data.matched>0);s=await state(owner);p=s.pool.find(x=>x.articleId===a.id);assert.equal(p.rules.length,1);
await post({action:'remove',articleId:a.id,version:p.version,reason:'本期不选用'},owner);await post({action:'sync_rules'},owner);s=await state(owner);p=s.pool.find(x=>x.articleId===a.id);assert.equal(p.active,false);assert.equal(p.suppressed,true);
await post({action:'follow',articleId:a.id,version:p.version},alice.headers,409);
await post({action:'restore',articleId:a.id,version:p.version},owner);s=await state(owner);p=s.pool.find(x=>x.articleId===a.id);assert(p.active);assert.equal(p.note,'团队评估备注，含<&>与换行\n保留全文');assert(p.followers.some(f=>f.name==='bobby'));
// The latest manual selector comes from persisted follows, not the export actor.
sqlite.prepare('UPDATE workspace_follows SET followed_at=? WHERE article_id=? AND user_id=?').run('2026-11-19T01:00:00Z',a.id,alice.user.id);
sqlite.prepare('UPDATE workspace_follows SET followed_at=? WHERE article_id=? AND user_id=?').run('2026-11-20T01:00:00Z',a.id,bob.user.id);
const exported=await post({action:'create_export',articleIds:[a.id,a.id],versions:{[a.id]:p.version}},alice.headers);assert.equal(exported.data.rowCount,1);const snapshot=JSON.parse(sqlite.prepare('SELECT payload FROM workspace_exports WHERE id=?').get(exported.data.id).payload);
assert.equal(snapshot.rows[0]['创建人'],'bobby');assert.equal(snapshot.createdBy,'alice');
const buffers={};for(const format of ['xlsx','docx']){const res=await route.GET(new Request(base+exported.data[format],{headers:alice.headers}));assert.equal(res.status,200);assert.equal(res.headers.get('x-export-snapshot'),exported.data.id);assert.equal(res.headers.get('x-export-checksum'),exported.data.checksum);buffers[format]=new Uint8Array(await res.arrayBuffer());}
const briefingRes=await route.GET(new Request(base+exported.data.briefing,{headers:alice.headers}));assert.equal(briefingRes.status,200);
const pdfSnapshot=await briefingRes.json();assert.equal(pdfSnapshot.id,snapshot.id);assert.equal(pdfSnapshot.checksum,exported.data.checksum);assert.equal(pdfSnapshot.snapshot.articles[0].id,a.id);assert.equal(pdfSnapshot.snapshot.articles[0].content,a.content);
const pdfOnly=await post({action:'create_export',format:'pdf',articleIds:[a.id],fields:[]},alice.headers);assert.equal(pdfOnly.data.xlsx,null);assert(pdfOnly.data.docx);assert.equal((await route.GET(new Request(base+pdfOnly.data.docx,{headers:alice.headers}))).status,200);
assert.equal((await route.GET(new Request(base+pdfOnly.data.briefing,{headers:alice.headers}))).status,200);
assert.equal((await route.GET(new Request(base+'/api/workspace?snapshot='+pdfOnly.data.id+'&format=xlsx',{headers:alice.headers}))).status,409);
assert.equal((await route.GET(new Request(base+exported.data.briefing))).status,401);
assert.equal((await route.GET(new Request(base+exported.data.briefing,{headers:viewer.headers}))).status,403);
await post({action:'create_export',articleIds:[a.id],periodStart:'2026-11-06',periodEnd:'2026-11-05'},alice.headers,400);
await post({action:'create_export',articleIds:[a.id],periodStart:'2026-02-30'},alice.headers,400);
const legacyId='legacy-qa';const legacy={...snapshot,id:legacyId};delete legacy.briefing;delete legacy.fieldLabels;const legacyJson=JSON.stringify(legacy);
const hash=Buffer.from(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(legacyJson))).toString('hex');
sqlite.prepare('INSERT INTO workspace_exports(id,payload,checksum,created_at,created_by,row_count) VALUES(?,?,?,?,?,?)').run(legacyId,legacyJson,hash,snapshot.createdAt,'test',1);
assert.equal((await route.GET(new Request(base+'/api/workspace?snapshot='+legacyId+'&format=briefing',{headers:alice.headers}))).status,409);
const legacyExcel=await route.GET(new Request(base+'/api/workspace?snapshot='+legacyId+'&format=xlsx',{headers:alice.headers}));assert.equal(legacyExcel.status,200);
const legacySheet=strFromU8(unzipSync(new Uint8Array(await legacyExcel.arrayBuffer()))['xl/worksheets/sheet1.xml']);for(const field of legacy.fields)assert(legacySheet.includes('<t xml:space="preserve">'+field+'</t>'));
const xlsx=unzipSync(buffers.xlsx),docx=unzipSync(buffers.docx);const worksheet=strFromU8(xlsx['xl/worksheets/sheet1.xml']),document=strFromU8(docx['word/document.xml']);
if(process.env.WORKSPACE_EXPORT_QA_DIR){fs.mkdirSync(process.env.WORKSPACE_EXPORT_QA_DIR,{recursive:true});for(const format of ['xlsx','docx'])fs.writeFileSync(process.env.WORKSPACE_EXPORT_QA_DIR+'/compliance-test.'+format,buffers[format]);fs.writeFileSync(process.env.WORKSPACE_EXPORT_QA_DIR+'/expected.json',JSON.stringify(snapshot));}
const escaped=s=>s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&apos;');
const wordText=document.replace(/<[^>]*>/g,'');
for(const field of snapshot.fields){const label=snapshot.fieldLabels[field];assert(worksheet.includes(escaped(label)));}
for(const text of [a.title,a.content,a.implications])for(const line of text.split('\n').filter(Boolean))assert(wordText.includes(escaped(line.replace(/^【([^】]+)】\s*/, '$1'))));
const expectedFields=['资讯标题','资讯内容','企业启示','板块','发布日期','原文链接','创建人'],expectedLabels=['原文标题','资讯完整内容','建议','领域','信息发布日期','原文链接','创建人'];
assert(!worksheet.includes('<f>'));assert.equal(snapshot.rows[0]['资讯内容'],a.content);assert.equal(snapshot.rows[0]['企业启示'],a.implications);assert.equal(snapshot.rows[0]['板块'],a.category);assert.equal(snapshot.fields.length,7);assert.deepEqual(snapshot.fields,expectedFields);assert.deepEqual(Object.keys(snapshot.rows[0]),snapshot.fields);assert.deepEqual(snapshot.fields.map(f=>snapshot.fieldLabels[f]),expectedLabels);
const sheetHeaders=[...worksheet.match(/<row r="1"[^>]*>([\s\S]*?)<\/row>/)[1].matchAll(/<t xml:space="preserve">([^<]*)<\/t>/g)].map(x=>x[1]);assert.deepEqual(sheetHeaders,expectedLabels);
const bodyParts=[...worksheet.matchAll(/<row r="(\d+)"[^>]*>([\s\S]*?)<\/row>/g)].filter(m=>Number(m[1])>1).map(m=>[...m[2].matchAll(/<t xml:space="preserve">([\s\S]*?)<\/t>/g)].map(x=>x[1])[1]);assert.equal(bodyParts.length,1);assert.equal(bodyParts[0],escaped(excelDisplayText(a.content)));
assert(!Object.hasOwn(snapshot.rows[0],'摘要'));assert(!Object.hasOwn(snapshot.rows[0],'发布机构'));
// Retain the most recent add even after that member cancels; no fallback to
// the exporter, an older active follower, or the last note/status editor.
await post({action:'follow',articleId:a.id,version:(await state(owner)).pool.find(x=>x.articleId===a.id).version},alice.headers);
sqlite.prepare('UPDATE workspace_follows SET followed_at=?,display_name=? WHERE article_id=? AND user_id=?').run('2026-11-21T01:00:00Z','童谣',a.id,alice.user.id);
await post({action:'unfollow',articleId:a.id,version:(await state(owner)).pool.find(x=>x.articleId===a.id).version},alice.headers);
const creatorExport=await post({action:'create_export',articleIds:[a.id],fields:['原文链接','创建人'],creator:'forged name'},bob.headers);
const creatorSnapshot=JSON.parse(sqlite.prepare('SELECT payload FROM workspace_exports WHERE id=?').get(creatorExport.data.id).payload);
assert.deepEqual(creatorSnapshot.fields,['原文链接','创建人']);assert.equal(creatorSnapshot.rows[0]['创建人'],'童谣');
assert.equal(JSON.parse(sqlite.prepare('SELECT payload FROM workspace_exports WHERE id=?').get(exported.data.id).payload).rows[0]['创建人'],'bobby','Earlier snapshot keeps the captured creator');
const creatorFile=await route.GET(new Request(base+creatorExport.data.xlsx,{headers:bob.headers}));
assert(strFromU8(unzipSync(new Uint8Array(await creatorFile.arrayBuffer()))['xl/worksheets/sheet1.xml']).includes('童谣'));
const ruleOnly=(await state(owner)).pool.find(x=>x.active&&x.rules.length&&!sqlite.prepare('SELECT 1 FROM workspace_follows WHERE article_id=?').get(x.articleId));assert(ruleOnly);
const ruleExport=await post({action:'create_export',articleIds:[ruleOnly.articleId],fields:['创建人']},bob.headers);
assert.equal(JSON.parse(sqlite.prepare('SELECT payload FROM workspace_exports WHERE id=?').get(ruleExport.data.id).payload).rows[0]['创建人'],'');
const reordered=await post({action:'create_export',articleIds:[a.id],fields:[...expectedFields].reverse()},alice.headers);const reorderedSnapshot=JSON.parse(sqlite.prepare('SELECT payload FROM workspace_exports WHERE id=?').get(reordered.data.id).payload);assert.deepEqual(reorderedSnapshot.fields,expectedFields);
const custom=await post({action:'create_export',articleIds:[a.id],fields:['团队备注','发布机构','团队备注']},alice.headers);
const customSnapshot=JSON.parse(sqlite.prepare('SELECT payload FROM workspace_exports WHERE id=?').get(custom.data.id).payload);
assert.deepEqual(customSnapshot.fields,['发布机构','团队备注']);assert.deepEqual(Object.keys(customSnapshot.rows[0]),customSnapshot.fields);
for(const format of ['xlsx','docx']){const res=await route.GET(new Request(base+custom.data[format],{headers:alice.headers}));const files=unzipSync(new Uint8Array(await res.arrayBuffer()));const xml=strFromU8(files[format==='xlsx'?'xl/worksheets/sheet1.xml':'word/document.xml']);if(format==='xlsx'){assert(!xml.includes(escaped(a.title)));assert(!xml.includes(escaped(a.content)));}else assert(xml.includes(escaped(a.title)));assert(xml.includes(escaped(a.authority)));}
await post({action:'create_export',articleIds:[a.id],fields:[]},alice.headers,400);
await post({action:'create_export',articleIds:[a.id],fields:['invalid']},alice.headers,400);
const allFields=['资讯ID','资讯标题','摘要','资讯内容','发布机构','生效状态','发布日期','生效日期','到期日期','板块','发布法域','受影响地区','主题','企业启示','原文链接','创建人','公告编号','相关期限','核验时间','团队备注','选题状态'];
const allExport=await post({action:'create_export',articleIds:[a.id],fields:allFields},alice.headers);assert.equal(allExport.data.fields.length,21);
await post({action:'create_export',articleIds:[a.id]},viewer.headers,403);
const anonExport=await route.GET(new Request(base+exported.data.xlsx));assert.equal(anonExport.status,401);
s=await state(owner);const member=s.members.find(m=>m.username==='alice');await post({action:'disable_member',userId:member.id,version:member.version,disabled:true},owner);assert.equal((await state(alice.headers)).user,null);
assert(!JSON.stringify(await state(owner)).includes('password_hash'));assert(!JSON.stringify(await state(owner)).includes(alice.password));
let currentRule=(await state(owner)).rules.find(r=>r.id===rule.data.id);await post({action:'save_rule',id:currentRule.id,version:currentRule.version,name:'已修订规则',conditions,enabled:false},owner);await post({action:'save_rule',id:currentRule.id,version:currentRule.version,name:'过期规则',conditions,enabled:true},owner,409);
const actions=(await state(owner)).activity.map(l=>l.action);for(const name of ['修改备注','修改选题状态','修改规则','团队移出','恢复选题','创建导出快照'])assert(actions.includes(name));
// Article publication is independent of team-pool removal and feed payloads.
async function loadPublicationModule(file){
 const b=await build({entryPoints:[file],bundle:true,platform:'node',target:'node24',format:'esm',write:false,plugins:[{name:'publication-test-env',setup(b){b.onResolve({filter:/^cloudflare:workers$/},()=>({path:'env',namespace:'test-env'}));b.onLoad({filter:/.*/,namespace:'test-env'},()=>({contents:'export const env=globalThis.__WORKSPACE_TEST_ENV;',loader:'js'}));}}]});
 return import('data:text/javascript;base64,'+Buffer.from(b.outputFiles[0].text).toString('base64'));
}
const store=await loadPublicationModule('lib/store.ts'),publicFeed=await loadPublicationModule('app/api/feed/route.ts'),briefingRoute=await loadPublicationModule('app/api/briefing/route.ts'),mcp=await loadPublicationModule('app/mcp/route.ts'),auto=await loadPublicationModule('lib/workspace-auto.ts');
const visibility={action:'set_article_visibility',articleId:a.id,version:0,archived:true,reason:'无关化学原材料'};
await post(visibility,{},401);await post(visibility,{Authorization:'Bearer '+'a'.repeat(64)},401);await post(visibility,bob.headers,403);await post(visibility,viewer.headers,403);
const crossVisibility=await route.POST(new Request(base+'/api/workspace',{method:'POST',headers:{...owner,Origin:'https://evil.test'},body:JSON.stringify(visibility)}));assert.equal(crossVisibility.status,403);
await post({...visibility,reason:' '},owner,400);await post({...visibility,version:-1},owner,400);await post({...visibility,articleId:'unknown-id'},owner,404);
const poolBefore=sqlite.prepare('SELECT * FROM workspace_pool WHERE article_id=?').get(a.id),followsBefore=sqlite.prepare('SELECT * FROM workspace_follows WHERE article_id=?').all(a.id);
const monitoring={id:'publication-qa-run',windowStart:'2026-11-11T01:00:00Z',cutoff:'2026-11-12T01:00:00Z',completedAt:'2026-11-12T02:00:00Z',status:'部分完成',newCount:2,updatedCount:0,articleIds:[a.id,'publication-database-article'],gaps:[],checkedSources:[],summary:'monitoring record stays unchanged'};
sqlite.prepare('INSERT INTO monitor_runs(id,payload,completed_at) VALUES(?,?,?)').run(monitoring.id,JSON.stringify(monitoring),monitoring.completedAt);
await store.upsert([{...a,id:'publication-database-article',title:'Database article'}]);
await post(visibility,owner);s=await state(owner);let pub=s.articlePublications.find(p=>p.articleId===a.id);assert.equal(pub.version,1);assert.equal(pub.archived,true);assert.equal(pub.reason,visibility.reason);assert.equal(pub.actorName,'Admin');assert(!s.pool.some(p=>p.articleId===a.id));assert.deepEqual((await state(bob.headers)).articlePublications,[]);assert.deepEqual((await state()).articlePublications,[]);
assert(!(await store.feed()).articles.some(x=>x.id===a.id));assert((await store.feed(true)).articles.some(x=>x.id===a.id));
assert(!(await(await publicFeed.GET(new Request(base+'/api/feed?includeArchived=true'))).json()).articles.some(x=>x.id===a.id));
const briefing=await(await briefingRoute.GET()).json();assert(![...briefing.regulations,...briefing.news].some(x=>x.id===a.id));
const mcpResult=await(await mcp.POST(new Request(base+'/mcp',{method:'POST',body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'get_trade_briefing',arguments:{limit:300}}})}))).json();assert(!JSON.parse(mcpResult.result.content[0].text).articles.some(x=>x.id===a.id));
const skipped=await store.upsert([{...a,title:'Must never resurrect from collection'}]);assert.equal(skipped.added,0);assert.equal(skipped.updated,0);assert.deepEqual(skipped.ids,[]);assert.deepEqual(skipped.skippedArchivedIds,[a.id]);
const revisionsBefore=sqlite.prepare('SELECT COUNT(*) AS n FROM article_revisions').get().n;await auto.applyWorkspaceRules([a]);await post({action:'sync_rules'},owner);assert.deepEqual(sqlite.prepare('SELECT * FROM workspace_pool WHERE article_id=?').get(a.id),poolBefore);assert.deepEqual(sqlite.prepare('SELECT * FROM workspace_follows WHERE article_id=?').all(a.id),followsBefore);assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM article_revisions').get().n,revisionsBefore);
await post({action:'follow',articleId:a.id,version:poolBefore.version},bob.headers,404);await post({action:'create_export',articleIds:[a.id]},owner,409);
const logsAfterArchive=(await state(owner)).activity.length;await post(visibility,owner,409);assert.equal((await state(owner)).activity.length,logsAfterArchive);
await post({...visibility,archived:false,version:1,reason:'管理员复核后恢复'},owner);assert((await store.feed()).articles.some(x=>x.id===a.id));assert((await state(owner)).pool.some(p=>p.articleId===a.id&&p.active===!!poolBefore.active));assert.deepEqual(sqlite.prepare('SELECT * FROM workspace_pool WHERE article_id=?').get(a.id),poolBefore);assert.deepEqual(sqlite.prepare('SELECT * FROM workspace_follows WHERE article_id=?').all(a.id),followsBefore);
await post({...visibility,archived:false,version:1,reason:'stale restore'},owner,409);
await post({...visibility,articleId:'publication-database-article'},owner);assert(!(await store.feed()).articles.some(x=>x.id==='publication-database-article'));assert.deepEqual((await store.upsert([{...a,id:'publication-database-article'}])).skippedArchivedIds,['publication-database-article']);
await post({...visibility,articleId:'publication-database-article',archived:false,version:1,reason:'恢复数据库资讯'},owner);
assert((await store.feed()).articles.some(x=>x.id==='publication-database-article'));assert.deepEqual(JSON.parse(sqlite.prepare('SELECT payload FROM monitor_runs WHERE id=?').get(monitoring.id).payload),monitoring);
// Two administrators racing from the same publication version get one success.
const races=await Promise.all([route.POST(new Request(base+'/api/workspace',{method:'POST',headers:{...owner,Origin:base},body:JSON.stringify({...visibility,version:2})})),route.POST(new Request(base+'/api/workspace',{method:'POST',headers:{...owner,Origin:base},body:JSON.stringify({...visibility,version:2})}))]);assert.deepEqual(races.map(r=>r.status).sort(),[200,409]);
const publicationLogs=(await state(owner)).activity.filter(l=>['下架资讯','恢复上架'].includes(l.action));assert.equal(publicationLogs.length,5);assert(publicationLogs.every(l=>l.actorName==='Admin'&&l.at&&JSON.parse(l.detail).reason));
console.log('PASS article publication: admin-only and CSRF; reason validation; seed/database hiding; public and MCP feed and daily briefing; pool/export protection; collection suppression; original team data preserved; restore; stale writes and concurrent administrators; audit logs; monitoring window/counts unchanged.');
// Topic reading is public; internal tasks and all writes remain authenticated.
const topicRoute=await loadPublicationModule('app/api/topics/route.ts');
const topicModel=await loadPublicationModule('lib/topic-model.ts'),bilateral=topicModel.DEFAULT_TRACKS.find(t=>t.id==='china-us-measures');
assert(!topicModel.isTrackCandidate(bilateral,{...a,title:'美国对中国PTMEG作出反倾销初裁',jurisdiction:'美国',summary:'暂停清算，程序延期',topics:[]}));
assert(!topicModel.isTrackCandidate(bilateral,{...a,title:'美国将中国某产品反倾销初裁延期',jurisdiction:'美国',summary:'调查继续',topics:[]}));
assert(topicModel.isTrackCandidate(bilateral,{...a,title:'中国继续暂停对美部分加征关税',jurisdiction:'中国',summary:'正式暂停安排',topics:[]}));
assert(topicModel.isTrackCandidate({...bilateral,id:'equipment',keywords:['制冷剂']},{...a,title:'电气设备二氟甲烷排放与制冷剂安全要求调整',summary:'',topics:[]}),'Direct equipment and refrigerant requirements remain eligible');
assert(!topicModel.isTrackCandidate({...bilateral,id:'chemicals',keywords:['暂停']},{...a,title:'暂停聚醚多元醇反倾销措施',summary:'',topics:[]}));
async function topicState(headers=owner){const r=await topicRoute.GET(new Request(base+'/api/topics',{headers}));assert.equal(r.status,200);return (await r.json()).tracks;}
async function topicPost(body,headers=owner,expected=200){const r=await topicRoute.POST(new Request(base+'/api/topics',{method:'POST',headers:{Origin:base,...headers},body:JSON.stringify(body)}));const d=await r.json();assert.equal(r.status,expected,JSON.stringify(d));return d;}
assert.equal((await topicRoute.GET(new Request(base+'/api/topics'))).status,200);
assert.equal((await topicRoute.GET(new Request(base+'/api/topics',{headers:{Authorization:'Bearer '+'a'.repeat(64)}}))).status,200);
let track=(await topicState()).find(t=>t.id==='ndaa');assert.equal(track.version,0);assert.deepEqual(track.events,[]);
const topicEdit={...track,action:'save',assessment:'待团队复核的分析意见',nextWatch:'下一正式文件',businessImpact:'适用性待评估',events:[{id:'forged',title:'Unverified finding'}],actions:[{id:'qa-task',text:'核对适用范围',owner:'合规团队',dueDate:'2026-11-20',done:false}]};
await topicPost(topicEdit,{},401);await topicPost(topicEdit,viewer.headers,403);
await topicPost(topicEdit,{...owner,Origin:'https://evil.test'},403);
await topicPost({...topicEdit,actions:[{...topicEdit.actions[0],dueDate:'2026-02-30'}]},owner,400);
await topicPost(topicEdit);track=(await topicState()).find(t=>t.id==='ndaa');assert.equal(track.version,1);assert.deepEqual(track.events,[],'Client-provided facts must never enter a timeline');
const publicTracks=await topicState({}),publicNdaa=publicTracks.find(t=>t.id==='ndaa');
assert.deepEqual(publicNdaa.actions,[]);assert.equal(publicNdaa.updatedBy,'');assert.equal(publicNdaa.assessment,track.assessment);
assert(!JSON.stringify(publicTracks).includes('qa-task'));assert(!JSON.stringify(publicTracks).includes('合规团队'));
const projected=topicModel.publicTopicTrack({...track,futurePrivateField:'must-not-leak',events:[]});assert(!JSON.stringify(projected).includes('must-not-leak'));
assert.equal(track.actions[0].owner,'合规团队');assert.equal(track.updatedBy,'Admin');
assert.equal((await topicState({})).find(t=>t.id==='ndaa').version,track.version);
sqlite.prepare("UPDATE workspace_users SET must_change_password=1 WHERE id='qa-admin'").run();
assert.deepEqual((await topicState(owner)).find(t=>t.id==='ndaa').actions,[]);
await topicPost({...topicEdit,version:track.version},owner,403);
sqlite.prepare("UPDATE workspace_users SET must_change_password=0 WHERE id='qa-admin'").run();
await store.upsert([{...a,id:'topic-excluded-chemistry',title:'美国对中国PTMEG作出反倾销初裁'}]);
await topicPost({action:'link_article',id:'ndaa',version:1,articleId:'topic-excluded-chemistry',matter:'不得绕过业务范围排除'},owner,400);
await topicPost(topicEdit,owner,409);
const topicArticle=feed[1],link={action:'link_article',id:'ndaa',version:1,articleId:topicArticle.id,matter:'财年与具体条款分别跟踪'};
await topicPost(link,bob.headers);track=(await topicState()).find(t=>t.id==='ndaa');assert.equal(track.version,2);assert.equal(track.events[0].title,topicArticle.title);assert.equal(track.events[0].status,topicArticle.status);assert.deepEqual(track.events[0].sources,topicArticle.sources);assert.equal(track.events[0].date,topicArticle.publishedDate);
await topicPost({...link,version:2},owner,409);
const savedEvidence=structuredClone(track.events[0]);
const topicArchive={action:'set_article_visibility',articleId:topicArticle.id,version:0,archived:true,reason:'核对主题下架一致性'};
await post(topicArchive,owner);assert.equal((await topicState()).find(t=>t.id==='ndaa').events.length,0);await topicPost({...link,version:2},owner,404);
assert.equal((await topicState({})).find(t=>t.id==='ndaa').events.length,0,'Anonymous readers must not see unpublished article snapshots');
assert.equal(JSON.parse(sqlite.prepare("SELECT payload FROM topic_tracks WHERE id='ndaa'").get().payload).events.length,1,'Soft unpublishing must preserve evidence history');
await post({...topicArchive,version:1,archived:false,reason:'复核恢复'},owner);assert.deepEqual((await topicState()).find(t=>t.id==='ndaa').events[0],savedEvidence);
await topicPost({...track,action:'save',actions:track.actions.map(x=>({...x,done:true}))},bob.headers);track=(await topicState()).find(t=>t.id==='ndaa');assert.equal(track.version,3);assert(track.actions[0].done);assert.equal(track.events.length,1);
const topicRace={...track,action:'save',nextWatch:'并发复核'};
const topicRaces=await Promise.all([topicRoute.POST(new Request(base+'/api/topics',{method:'POST',headers:{...owner,Origin:base},body:JSON.stringify(topicRace)})),topicRoute.POST(new Request(base+'/api/topics',{method:'POST',headers:{...bob.headers,Origin:base},body:JSON.stringify(topicRace)}))]);assert.deepEqual(topicRaces.map(r=>r.status).sort(),[200,409]);
track=(await topicState()).find(t=>t.id==='ndaa');await topicPost({action:'unlink_event',id:track.id,version:track.version,eventId:track.events[0].id});
assert.equal((await topicState()).find(t=>t.id==='ndaa').events.length,0);assert((await store.feed()).articles.some(x=>x.id===topicArticle.id));
assert(sqlite.prepare("SELECT COUNT(*) AS n FROM topic_track_revisions WHERE topic_id='ndaa'").get().n>=5);assert((await state(owner)).activity.some(a=>a.action==='关联主题进展'));
console.log('PASS topic tracking: anonymous reading and private-field projection; authenticated writes, roles and CSRF; defaults and persistence; input validation; trusted evidence snapshots; duplicate and stale writes; atomic concurrent edits; tasks; unpublishing hides evidence without erasing history; restore and audit.');
console.log('PASS: migrations; anonymous privacy; CSRF; independent login and first-password gate; role boundaries; merged follows; cancellation isolation; stale-write prevention; rule auto-selection; suppression and restore; complete-body XLSX with one article per row; complete two-column Word independent of Excel fields; disabled session revocation; secret redaction.');

// Reject actual Excel cell overflow without truncation or continuation rows.
const overflowArticle={...a,id:'excel-cell-limit-qa',content:'字'.repeat(32768)};
await store.upsert([overflowArticle]);
const overflowPool=(await state(owner)).pool.find(x=>x.articleId===overflowArticle.id);
await post({action:'follow',articleId:overflowArticle.id,version:overflowPool?.version??0},owner);
const exportCountBefore=sqlite.prepare('SELECT COUNT(*) AS n FROM workspace_exports').get().n;
const overflow=await post({action:'create_export',articleIds:[overflowArticle.id],fields:['资讯内容']},owner,400);
assert(overflow.data.error.includes('32767'));assert(overflow.data.error.includes('Word'));assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM workspace_exports').get().n,exportCountBefore);
const longPdf=await post({action:'create_export',articleIds:[overflowArticle.id],format:'pdf',fields:[]},owner);assert.equal(longPdf.data.xlsx,null);assert(longPdf.data.docx);
const savedLong=JSON.parse(sqlite.prepare('SELECT payload FROM workspace_exports WHERE id=?').get(longPdf.data.id).payload);assert.equal(savedLong.briefing.articles[0].content,overflowArticle.content);
const oversizedLegacy={...savedLong,id:'oversized-legacy',formats:['xlsx'],fields:['资讯内容']};const oversizedPayload=JSON.stringify(oversizedLegacy);
sqlite.prepare('INSERT INTO workspace_exports(id,payload,checksum,created_at,created_by,row_count) VALUES(?,?,?,?,?,?)').run(oversizedLegacy.id,oversizedPayload,Buffer.from(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(oversizedPayload))).toString('hex'),oversizedLegacy.createdAt,'test',1);
const oldOverflow=await route.GET(new Request(base+'/api/workspace?snapshot=oversized-legacy&format=xlsx',{headers:owner}));assert.equal(oldOverflow.status,400);assert((await oldOverflow.json()).error.includes('32767'));
console.log('PASS Excel single-row export: one complete body per article; 32767-character boundary; clear overflow response; PDF/Word escape hatch; historical snapshot validation.');
