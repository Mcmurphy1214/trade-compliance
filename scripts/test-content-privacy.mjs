import assert from 'node:assert/strict';
import fs from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {build} from 'esbuild';
import {createHash} from 'node:crypto';
import {unzipSync,strFromU8} from 'fflate';

const hash=s=>createHash('sha256').update(s).digest('hex');
const sql=new DatabaseSync(':memory:');
for(const statement of JSON.parse(fs.readFileSync('lib/database-schema.json','utf8')))sql.exec(statement);
class Statement{
 constructor(text,args=[]){this.text=text;this.args=args;}
 bind(...args){return new Statement(this.text,args);}
 execute(){const statement=sql.prepare(this.text);if(/^\s*SELECT/i.test(this.text))return {results:statement.all(...this.args),meta:{changes:0},success:true};const r=statement.run(...this.args);return {results:[],meta:{changes:Number(r.changes)},success:true};}
 async all(){return this.execute();}async first(){return this.execute().results[0]??null;}async run(){return this.execute();}
}
const binding=()=>({prepare:text=>new Statement(text),batch:async statements=>{sql.exec('BEGIN');try{const r=statements.map(s=>s.execute());sql.exec('COMMIT');return r;}catch(e){sql.exec('ROLLBACK');throw e;}}});
globalThis.__PRIVACY_TEST_ENV={DB:binding()};
async function load(file){const b=await build({entryPoints:[file],bundle:true,platform:'node',target:'node24',format:'esm',write:false,plugins:[{name:'test-env',setup(b){b.onResolve({filter:/^cloudflare:workers$/},()=>({path:'env',namespace:'test'}));b.onLoad({filter:/.*/,namespace:'test'},()=>({contents:'export const env=globalThis.__PRIVACY_TEST_ENV;',loader:'js'}));}}]});return import('data:text/javascript;base64,'+Buffer.from(b.outputFiles[0].text).toString('base64'));}
const {anonymizeContent,anonymizeArticle}=await load('lib/content-privacy.ts');
const {ensureContentPrivacy,CONTENT_PRIVACY_VERSION}=await load('lib/content-privacy-migration.ts');
const {upsert,feed}=await load('lib/store.ts');
const {excelFile,wordFile}=await load('lib/workspace-export.ts');
const name='正泰',aliases=['正泰集团有限公司','浙江正泰电器股份有限公司','正泰电气','正泰电源','正泰新能','正泰安能','CHINT','chint group','Astronergy'];
for(const alias of aliases)assert.equal(anonymizeContent(alias),'公司');
assert.equal(anonymizeContent('正泰电器、正泰电气、正泰电源及其他供货业务'),'公司及其他供货业务');
assert.equal(anonymizeContent('见 https://example.gov/notice。正泰建议'),'见 https://example.gov/notice。公司建议');
const originalUrl='https://example.gov/doc/CHINT-2026.html';
assert.deepEqual(anonymizeContent({id:'CHINT-id',username:'chint-user',url:originalUrl,note:name}),{id:'CHINT-id',username:'chint-user',url:originalUrl,note:'公司'});
const seed=JSON.parse(fs.readFileSync('lib/seed.json','utf8'));
assert(!/正泰|chint|astronergy/i.test(JSON.stringify(seed)),'All bundled article values must be anonymous');
const original={...seed[0],id:'privacy-article',title:name+'业务公告',implications:name+'及CHINT业务建议',history:[{date:'2026-11-04',note:name+'历史记录'}],sources:[{title:name+'官方公告',url:originalUrl}],regulation:{kind:'法规',changeSummary:name+'更新内容',businessAdvice:'Astronergy适用条件',effectiveStatus:'待生效'}};
assert(anonymizeArticle(original).companyRelevant,'Business priority must survive removal of names');
const payload=JSON.stringify(original),snapshot={id:'privacy-export',createdAt:'2026-11-04',createdBy:name,fields:['资讯标题','企业启示','原文链接'],rows:[{'资讯标题':name+'标题','企业启示':name+'建议','原文链接':originalUrl}],briefing:{templateVersion:1,createdAt:"2026-11-04T01:00:00Z",periodStart:"2026-11-04",periodEnd:"2026-11-04",articles:[original]}};
const exported=JSON.stringify(snapshot);
sql.prepare('INSERT INTO articles(id,payload,version,updated_at) VALUES(?,?,7,?)').run(original.id,payload,'2026-11-04');
sql.prepare('INSERT INTO article_revisions(id,article_id,payload,created_at) VALUES(?,?,?,?)').run('rev',original.id,payload,'2026-11-03');
sql.prepare('INSERT INTO monitor_runs(id,payload,completed_at) VALUES(?,?,?)').run('run',JSON.stringify({windowStart:'2026-11-03T01:00:00Z',cutoff:'2026-11-04T01:00:00Z',summary:name+'记录',newCount:1,updatedCount:2}),'2026-11-04');
sql.prepare('INSERT INTO workspace_exports(id,payload,checksum,created_at,created_by,row_count) VALUES(?,?,?,?,?,1)').run(snapshot.id,exported,hash(exported),'2026-11-04','user');
sql.prepare("INSERT INTO workspace_pool(article_id,note,last_mutation,created_at,updated_at) VALUES(?,?,'before','2026-11-04','2026-11-04')").run(original.id,name+'备注');
sql.prepare("INSERT INTO workspace_users(id,username,display_name,role,password_hash,salt,created_at,updated_at) VALUES('user','chint-user',?,'admin','opaque-hash','opaque-salt','2026-11-04','2026-11-04')").run(name+'用户');
sql.prepare("INSERT INTO workspace_follows(article_id,user_id,display_name,followed_at) VALUES(?,'user',?,'2026-11-04')").run(original.id,name+'用户');
sql.prepare("INSERT INTO workspace_rules(id,name,conditions,updated_at,updated_by) VALUES('rule',?,?,'2026-11-04',?)").run(name+'规则',JSON.stringify({categories:[],jurisdictions:[],topics:[name],statuses:[]}),name+'用户');
sql.prepare("INSERT INTO workspace_matches(article_id,rule_id,rule_name,rule_version,matched_at,mutation_id) VALUES(?,'rule',?,1,'2026-11-04','before')").run(original.id,name+'规则');
sql.prepare("INSERT INTO workspace_activity(id,actor_id,actor_name,action,article_id,detail,created_at) VALUES('log','user',?,'修改备注',?,?,'2026-11-04')").run(name+'用户',original.id,JSON.stringify({before:name+'旧备注',after:name+'新备注'}));
await ensureContentPrivacy(globalThis.__PRIVACY_TEST_ENV.DB);
const stored=sql.prepare('SELECT * FROM articles WHERE id=?').get(original.id),article=JSON.parse(stored.payload);
assert.equal(article.title,'公司业务公告');assert.equal(article.sources[0].url,originalUrl);assert.equal(article.companyRelevant,true);assert.equal(stored.version,7);assert.equal(stored.updated_at,'2026-11-04');
for(const table of ['articles','article_revisions','monitor_runs','workspace_exports']){
 const text=sql.prepare('SELECT payload FROM '+table).get().payload;
 assert(!text.includes(name));assert(!text.includes('Astronergy'));assert(!text.includes('CHINT业务'));
}
const run=JSON.parse(sql.prepare('SELECT payload FROM monitor_runs').get().payload);assert.equal(run.cutoff,'2026-11-04T01:00:00Z');assert.equal(run.newCount,1);assert.equal(run.updatedCount,2);
const user=sql.prepare('SELECT * FROM workspace_users').get();assert.equal(user.username,'chint-user');assert.equal(user.password_hash,'opaque-hash');assert.equal(user.salt,'opaque-salt');assert.equal(user.version,1);assert.equal(user.display_name,'公司用户');
assert.equal(sql.prepare('SELECT note FROM workspace_pool').get().note,'公司备注');
assert.equal(sql.prepare('SELECT rule_name FROM workspace_matches').get().rule_name,'公司规则');
assert.equal(sql.prepare('SELECT user_id FROM workspace_follows').get().user_id,'user');
assert(!JSON.stringify(sql.prepare('SELECT * FROM workspace_activity').all()).includes(name));
const saved=sql.prepare('SELECT * FROM workspace_exports').get();assert.equal(saved.checksum,hash(saved.payload));assert.notEqual(saved.checksum,hash(exported));
for(const bytes of [excelFile(JSON.parse(saved.payload)),wordFile(JSON.parse(saved.payload))])assert(!Object.values(unzipSync(bytes)).some(v=>strFromU8(v).includes(name)),'Historical exports must remain downloadable and anonymous');
const marker=JSON.parse(sql.prepare("SELECT payload FROM monitor_source_state WHERE id='runtime:content-privacy-v1'").get().payload);assert.equal(marker.version,CONTENT_PRIVACY_VERSION);assert.equal(marker.recordsUpdated.workspace_exports,1);
const before=sql.prepare('SELECT COUNT(*) AS n FROM workspace_activity').get().n;
await ensureContentPrivacy(binding());assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM workspace_activity').get().n,before,'Repeated cold isolates must not re-run the migration');
const fresh={...original,id:'future-article',title:name+'新资讯',sources:seed[0].sources};
const inserted=await upsert([fresh]);assert.equal(inserted.added,1);assert.equal((await feed()).articles.find(a=>a.id===fresh.id).title,'公司新资讯');
await upsert([{...fresh,implications:name+'修订建议'}]);
assert(!JSON.stringify(sql.prepare('SELECT payload FROM articles').all()).includes(name));assert(!JSON.stringify(sql.prepare('SELECT payload FROM article_revisions').all()).includes(name));
assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM articles WHERE id=?').get(fresh.id).n,1,'Privacy correction must not duplicate articles');
sql.close();console.log('PASS company privacy: aliases, original links, neutral business priority, stored articles/revisions/runs/team notes/rules, export checksum and files, preserved credentials/ownership/dates/counts, migration idempotence, future upsert and revision protection.');
