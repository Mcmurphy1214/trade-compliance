import {env} from 'cloudflare:workers';
import {anonymizeContent} from './content-privacy';
import {feed} from './store';
import {assertEditor,cleanText,WorkspaceError} from './workspace-policy';
import {validDate} from './workspace-filters';
import type {WorkspaceActor} from './workspace-types';
import {DEFAULT_TRACKS,TRACK_KINDS,TRACK_STATUSES,isTrackingExcluded,type TopicTrack,type TrackAction} from './topic-model';

type Row={id:string;payload:string;version:number;updated_at:string};
const db=()=>env.DB!;
const text=(v:unknown,n:number)=>anonymizeContent(cleanText(v,n));
async function rawTrack(id:string){
 const row=await db().prepare('SELECT id,payload,version,updated_at FROM topic_tracks WHERE id=?').bind(id).first<Row>();
 return row?{...JSON.parse(row.payload),version:row.version} as TopicTrack:structuredClone(DEFAULT_TRACKS.find(t=>t.id===id)??null);
}
export async function topicTracks(){
 const rows=await db().prepare('SELECT id,payload,version,updated_at FROM topic_tracks ORDER BY updated_at DESC').all<Row>();
 const tracks=new Map(DEFAULT_TRACKS.map(t=>[t.id,structuredClone(t)]));
 for(const r of rows.results)tracks.set(r.id,{...JSON.parse(r.payload),version:r.version});
 const visible=new Set((await feed()).articles.filter(a=>!isTrackingExcluded(a)).map(a=>a.id));
 // Retain history in storage while withholding every snapshot of an unpublished article.
 return [...tracks.values()].map(t=>anonymizeContent({...t,events:t.events.filter(e=>visible.has(e.articleId))}));
}
export async function mutateTrack(actor:WorkspaceActor,body:Record<string,unknown>){
 assertEditor(actor.role);
 const id=body.id===undefined?crypto.randomUUID():body.id;
 if(typeof id!=='string'||!/^[a-zA-Z0-9_-]{1,100}$/.test(id)||!Number.isInteger(body.version)||Number(body.version)<0)throw new WorkspaceError(400,'主题编号或版本无效。');
 const prior=await rawTrack(id);
 if((prior?.version??0)!==body.version)throw new WorkspaceError(409,'主题已由其他成员更新，请刷新后重试。');
 const now=new Date().toISOString();
 let next:TopicTrack;
 if(body.action==='save'){
  const title=text(body.title,120),description=text(body.description,1200),kind=text(body.kind,40),trackingStatus=text(body.trackingStatus,40);
  if(!title||!TRACK_KINDS.includes(kind as typeof TRACK_KINDS[number])||!TRACK_STATUSES.includes(trackingStatus as typeof TRACK_STATUSES[number]))throw new WorkspaceError(400,'请填写主题名称、类型和追踪状态。');
  if(!Array.isArray(body.keywords)||body.keywords.length>20||body.keywords.some(k=>typeof k!=='string'||!k.trim()||k.length>80))throw new WorkspaceError(400,'请提供不超过20个有效检索词。');
  if(!Array.isArray(body.actions)||body.actions.length>40)throw new WorkspaceError(400,'应对事项不得超过40项。');
  const actions=body.actions.map(raw=>{
   if(!raw||typeof raw!=='object')throw new WorkspaceError(400,'应对事项格式无效。');
   const a=raw as Record<string,unknown>,label=text(a.text,600),owner=text(a.owner,120),dueDate=text(a.dueDate,10);
   if(!label||typeof a.done!=='boolean'||dueDate&&!validDate(dueDate))throw new WorkspaceError(400,'应对事项或日期无效。');
   return {id:typeof a.id==='string'&&/^[\w-]{1,100}$/.test(a.id)?a.id:crypto.randomUUID(),text:label,owner,dueDate,done:a.done} as TrackAction;
  });
  next={id,title,description,kind,trackingStatus,keywords:[...new Set((body.keywords as string[]).map(k=>text(k,80)))],assessment:text(body.assessment,5000),nextWatch:text(body.nextWatch,1500),businessImpact:text(body.businessImpact,3000),actions,events:prior?.events??[],version:0,updatedAt:now,updatedBy:actor.displayName};
 }else if(body.action==='link_article'){
  if(!prior)throw new WorkspaceError(404,'主题不存在。');
  const a=(await feed()).articles.find(a=>a.id===body.articleId);
  if(!a)throw new WorkspaceError(404,'关联资讯不存在或已下架。');
  if(isTrackingExcluded(a))throw new WorkspaceError(400,'该资讯属于已明确排除的业务范围，不再关联到追踪主题。');
  const matter=text(body.matter,180);
  if(!matter)throw new WorkspaceError(400,'请填写具体事项或规则名称，避免将不同规则合并为一个状态。');
  if(prior.events.some(e=>e.articleId===a.id&&e.verifiedAt===a.verifiedAt))throw new WorkspaceError(409,'该核验版本已关联，无需重复加入。');
  if(prior.events.length>=100)throw new WorkspaceError(400,'单主题最多保留100个进展，请按财年或事项拆分主题。');
  next={...prior,events:[...prior.events,{id:crypto.randomUUID(),articleId:a.id,date:a.publishedDate,matter,title:a.title,status:a.status,summary:a.summary,sources:a.sources,verifiedAt:a.verifiedAt,linkedAt:now}],updatedAt:now,updatedBy:actor.displayName};
 }else if(body.action==='unlink_event'){
  if(!prior||!prior.events.some(e=>e.id===body.eventId))throw new WorkspaceError(404,'关联进展不存在。');
  next={...prior,events:prior.events.filter(e=>e.id!==body.eventId),updatedAt:now,updatedBy:actor.displayName};
 }else throw new WorkspaceError(400,'未知主题操作。');
 next=anonymizeContent({...next,version:Number(body.version)+1});
 const payload=JSON.stringify(next),nonce=crypto.randomUUID();
 if(payload.length>200000)throw new WorkspaceError(400,'主题内容过多，请拆分主题。');
 const initial=JSON.stringify(prior??{...next,version:0});
 const result=await db().batch([
  db().prepare("INSERT OR IGNORE INTO topic_tracks(id,payload,version,updated_at,last_mutation) VALUES(?,?,0,?,'')").bind(id,initial,now),
  db().prepare('UPDATE topic_tracks SET payload=?,version=version+1,updated_at=?,last_mutation=? WHERE id=? AND version=?').bind(payload,now,nonce,id,body.version),
  db().prepare('INSERT INTO topic_track_revisions(id,topic_id,payload,created_at) SELECT ?,?,?,? WHERE EXISTS(SELECT 1 FROM topic_tracks WHERE id=? AND last_mutation=?)').bind(crypto.randomUUID(),id,initial,now,id,nonce),
  db().prepare('INSERT INTO workspace_activity(id,actor_id,actor_name,action,article_id,detail,created_at) SELECT ?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM topic_tracks WHERE id=? AND last_mutation=?)').bind(crypto.randomUUID(),actor.id,actor.displayName,body.action==='link_article'?'关联主题进展':body.action==='unlink_event'?'移除主题关联':'保存追踪主题',typeof body.articleId==='string'?body.articleId:null,JSON.stringify({topicId:id,title:next.title,version:next.version}),now,id,nonce)
 ]);
 if(!result[1].meta.changes)throw new WorkspaceError(409,'主题已由其他成员更新，请刷新后重试。');
 return {ok:true,id,version:next.version};
}
