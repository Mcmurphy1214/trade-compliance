import assert from 'node:assert/strict';
import fs from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {build} from 'esbuild';
import {unzipSync,strFromU8} from 'fflate';
import {pathToFileURL} from 'node:url';
const filterBuild=await build({entryPoints:['lib/workspace-filters.ts'],bundle:true,platform:'node',format:'esm',write:false});
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
async function account(username,role){const {data}=await post({action:'create_member',username,displayName:username,role},owner);const first=await post({action:'login',username,password:data.temporaryPassword});const cookie=first.res.headers.get('set-cookie').split(';')[0];assert(first.res.headers.get('set-cookie').includes('HttpOnly; Secure; SameSite=Lax'));let session=await state({cookie});assert.equal(session.user.mustChangePassword,true);assert.equal(session.pool.length,0);await post({action:'follow',articleId:'x',version:0},{cookie},403);const password='Personal-Password!'+username;await post({action:'change_password',currentPassword:data.temporaryPassword,newPassword:password},{cookie});session=await state({cookie});assert.equal(session.user.mustChangePassword,false);return {headers:{cookie},password,user:session.user};}
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
const exported=await post({action:'create_export',articleIds:[a.id,a.id],versions:{[a.id]:p.version}},alice.headers);assert.equal(exported.data.rowCount,1);const snapshot=JSON.parse(sqlite.prepare('SELECT payload FROM workspace_exports WHERE id=?').get(exported.data.id).payload);
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
const expectedFields=['资讯标题','资讯内容','企业启示','板块','发布日期','原文链接'],expectedLabels=['原文标题','资讯完整内容','建议','领域','信息发布日期','原文链接'];
assert(!worksheet.includes('<f>'));assert.equal(snapshot.rows[0]['资讯内容'],a.content);assert.equal(snapshot.rows[0]['企业启示'],a.implications);assert.equal(snapshot.rows[0]['板块'],a.category);assert.equal(snapshot.fields.length,6);assert.deepEqual(snapshot.fields,expectedFields);assert.deepEqual(Object.keys(snapshot.rows[0]),snapshot.fields);assert.deepEqual(snapshot.fields.map(f=>snapshot.fieldLabels[f]),expectedLabels);
const sheetHeaders=[...worksheet.match(/<row r="1"[^>]*>([\s\S]*?)<\/row>/)[1].matchAll(/<t xml:space="preserve">([^<]*)<\/t>/g)].map(x=>x[1]);assert.deepEqual(sheetHeaders,expectedLabels);
const bodyParts=[...worksheet.matchAll(/<row r="(\d+)"[^>]*>([\s\S]*?)<\/row>/g)].filter(m=>Number(m[1])>1).map(m=>[...m[2].matchAll(/<t xml:space="preserve">([\s\S]*?)<\/t>/g)].map(x=>x[1])[1]);assert.equal(bodyParts.join(''),escaped(a.content));
assert(!Object.hasOwn(snapshot.rows[0],'摘要'));assert(!Object.hasOwn(snapshot.rows[0],'发布机构'));
const reordered=await post({action:'create_export',articleIds:[a.id],fields:[...expectedFields].reverse()},alice.headers);const reorderedSnapshot=JSON.parse(sqlite.prepare('SELECT payload FROM workspace_exports WHERE id=?').get(reordered.data.id).payload);assert.deepEqual(reorderedSnapshot.fields,expectedFields);
const custom=await post({action:'create_export',articleIds:[a.id],fields:['团队备注','发布机构','团队备注']},alice.headers);
const customSnapshot=JSON.parse(sqlite.prepare('SELECT payload FROM workspace_exports WHERE id=?').get(custom.data.id).payload);
assert.deepEqual(customSnapshot.fields,['发布机构','团队备注']);assert.deepEqual(Object.keys(customSnapshot.rows[0]),customSnapshot.fields);
for(const format of ['xlsx','docx']){const res=await route.GET(new Request(base+custom.data[format],{headers:alice.headers}));const files=unzipSync(new Uint8Array(await res.arrayBuffer()));const xml=strFromU8(files[format==='xlsx'?'xl/worksheets/sheet1.xml':'word/document.xml']);if(format==='xlsx'){assert(!xml.includes(escaped(a.title)));assert(!xml.includes(escaped(a.content)));}else assert(xml.includes(escaped(a.title)));assert(xml.includes(escaped(a.authority)));}
await post({action:'create_export',articleIds:[a.id],fields:[]},alice.headers,400);
await post({action:'create_export',articleIds:[a.id],fields:['invalid']},alice.headers,400);
const allFields=['资讯ID','资讯标题','摘要','资讯内容','发布机构','生效状态','发布日期','生效日期','到期日期','板块','发布法域','受影响地区','主题','企业启示','原文链接','公告编号','相关期限','核验时间','团队备注','选题状态'];
const allExport=await post({action:'create_export',articleIds:[a.id],fields:allFields},alice.headers);assert.equal(allExport.data.fields.length,20);
await post({action:'create_export',articleIds:[a.id]},viewer.headers,403);
const anonExport=await route.GET(new Request(base+exported.data.xlsx));assert.equal(anonExport.status,401);
s=await state(owner);const member=s.members.find(m=>m.username==='alice');await post({action:'disable_member',userId:member.id,version:member.version,disabled:true},owner);assert.equal((await state(alice.headers)).user,null);
assert(!JSON.stringify(await state(owner)).includes('password_hash'));assert(!JSON.stringify(await state(owner)).includes(alice.password));
let currentRule=(await state(owner)).rules.find(r=>r.id===rule.data.id);await post({action:'save_rule',id:currentRule.id,version:currentRule.version,name:'已修订规则',conditions,enabled:false},owner);await post({action:'save_rule',id:currentRule.id,version:currentRule.version,name:'过期规则',conditions,enabled:true},owner,409);
const actions=(await state(owner)).activity.map(l=>l.action);for(const name of ['修改备注','修改选题状态','修改规则','团队移出','恢复选题','创建导出快照'])assert(actions.includes(name));
console.log('PASS: migrations; anonymous privacy; CSRF; independent login and first-password gate; role boundaries; merged follows; cancellation isolation; stale-write prevention; rule auto-selection; suppression and restore; complete-body XLSX with lossless continuation; complete two-column Word independent of Excel fields; disabled session revocation; secret redaction.');
