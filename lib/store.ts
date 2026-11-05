import {env} from "cloudflare:workers";
import {anonymizeArticle,anonymizeContent} from "./content-privacy";
import {applyWorkspaceRules} from "./workspace-auto";
import monitorConfig from "./monitor-config.json";
import {reconcileMonitorCoverage} from "./monitor-coverage";
import seeds from "./seed.json";import {SEED_RUN} from "./config";import type {Article,MonitorRun} from "./types";
export async function feed(){
const records=await env.DB!.prepare("SELECT payload FROM articles").all<{payload:string}>();const map=new Map<string,Article>((seeds as Article[]).map(a=>[a.id,a]));
for(const r of records.results??[]){const a=JSON.parse(r.payload);map.set(a.id,a);}
const run=await env.DB!.prepare("SELECT payload FROM monitor_runs ORDER BY completed_at DESC LIMIT 1").first<{payload:string}>();
return {articles:[...map.values()].map(anonymizeArticle).sort((a,b)=>(b.publishedDate??"").localeCompare(a.publishedDate??"")),run:anonymizeContent(run?JSON.parse(run.payload):SEED_RUN)};}
export function validate(a:any):Article{
for(const k of ["id","title","category","jurisdiction","authority","eventType","status","summary","content","implications","verifiedAt"])if(typeof a[k]!=="string"||!a[k].trim())throw new Error("缺少字段："+k);
if(!/^[a-zA-Z0-9_-]{1,100}$/.test(a.id))throw new Error("资讯ID格式不正确");
if(!Array.isArray(a.sources)||!a.sources.length||a.sources.some((s:any)=>{try{return new URL(s.url).protocol!=="https:"}catch{return true}}))throw new Error("至少提供一条HTTPS原文链接");
if(a.publishedDate&&!/^\d{4}-\d{2}-\d{2}$/.test(a.publishedDate))throw new Error("发布日期须为YYYY-MM-DD");
if(isNaN(Date.parse(a.verifiedAt)))throw new Error("核验时间无效");
if(JSON.stringify(a).length>65000)throw new Error("单条内容过长");
if(a.regulation){if(typeof a.regulation.kind!=="string"||typeof a.regulation.changeSummary!=="string"||!a.regulation.changeSummary.trim())throw new Error("法规监测须填写文书类型和经原文核实的更新内容");}
return anonymizeArticle({...a,affectedRegions:a.affectedRegions??[],topics:a.topics??[],deadlines:a.deadlines??[],publishedDate:a.publishedDate??null,effectiveDate:a.effectiveDate??null,expiryDate:a.expiryDate??null,reference:a.reference??"",changeType:a.changeType??"新增",priority:a.priority??"一般",verification:a.verification??"已核原文",collectedAt:a.collectedAt??new Date().toISOString(),history:a.history??[]});}
export async function upsert(list:any[]){if(!Array.isArray(list)||list.length>60)throw new Error("每次最多60条");const valid=list.map(validate);const now=new Date().toISOString();const prior=await feed();let added=0,updated=0;const commands=[];
for(let a of valid){const old=prior.articles.find(x=>x.id===a.id);if(old&&JSON.stringify(old)===JSON.stringify(a))continue;if(old){commands.push(env.DB!.prepare("INSERT INTO article_revisions(id,article_id,payload,created_at) VALUES(?,?,?,?)").bind(crypto.randomUUID(),a.id,JSON.stringify(old),now));a={...a,history:[...(old.history??[]),{date:now,note:"内容修订，上一版本已保存"}]};updated++;}else added++;
commands.push(env.DB!.prepare("INSERT INTO articles(id,payload,version,updated_at) VALUES(?,?,1,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload,version=articles.version+1,updated_at=excluded.updated_at").bind(a.id,JSON.stringify(a),now));}
if(commands.length)await env.DB!.batch(commands);let ruleWarning:string|undefined;try{await applyWorkspaceRules(valid);}catch{ruleWarning="资讯已保存，但团队自动入池规则未完成，请管理员在工作台重试执行规则。";}return {ok:true,added,updated,ids:valid.map(a=>a.id),...(ruleWarning?{ruleWarning}:{})};}
export async function recordRun(run:MonitorRun){if(!run?.cutoff||isNaN(Date.parse(run.cutoff))||!run.windowStart||isNaN(Date.parse(run.windowStart)))throw new Error("核查窗口无效");
const result=anonymizeContent({...run,id:run.id??crypto.randomUUID(),completedAt:run.completedAt??new Date().toISOString(),checkedSources:run.checkedSources??[],gaps:run.gaps??[],newCount:run.newCount??0,updatedCount:run.updatedCount??0,status:run.status??"已完成"});
const previous=(await feed()).run as MonitorRun;
const since=Date.parse(previous.completedAt)>Date.parse(result.windowStart)&&Date.parse(previous.completedAt)<=Date.parse(result.cutoff)?previous.completedAt:result.windowStart;
const changed=await env.DB!.prepare("SELECT id FROM articles WHERE updated_at > ? AND updated_at <= ?").bind(since,result.completedAt).all<{id:string}>();
result.articleIds=(changed.results??[]).map(a=>a.id);
const coverage=reconcileMonitorCoverage(result.status,result.checkedSources,result.gaps,monitorConfig.coveragePolicy.requiredSources);Object.assign(result,coverage);
await env.DB!.prepare("INSERT INTO monitor_runs(id,payload,completed_at) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload,completed_at=excluded.completed_at").bind(result.id,JSON.stringify(result),result.completedAt).run();return {ok:true,run:result};}


// Persistent, non-article handshake for validating a new automation connection.
export async function verifyMonitorConnection(origin:string){
 const id="runtime:monitor-connection-check",nonce=crypto.randomUUID(),verifiedAt=new Date().toISOString();
 const payload=JSON.stringify({origin,nonce,verifiedAt});
 await env.DB!.prepare("INSERT INTO monitor_source_state(id,payload,updated_at) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload,updated_at=excluded.updated_at").bind(id,payload,verifiedAt).run();
 const row=await env.DB!.prepare("SELECT payload FROM monitor_source_state WHERE id=?").bind(id).first<{payload:string}>();
 if(!row||JSON.parse(row.payload).nonce!==nonce)throw new Error("连接检查未完成持久读回，请重试。");
 return {writeVerified:true,readbackVerified:true,site:origin,verifiedAt,articlesChanged:0};
}
