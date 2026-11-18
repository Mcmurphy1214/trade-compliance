import type {Article,MonitorRun} from './types';
export type Regulation={kind:string;changeSummary:string;businessAdvice?:string;effectiveStatus?:string;provisions?:string[]};
export function isRegulation(a:Article){
 if('regulation' in a && a.regulation)return true;
 if(/执法案件|许可|和解/.test(a.eventType))return false;
 // Legacy records: classify only the instrument title/type, never incidental mentions in the body.
 return /^(法规|法律|法令|指令|规章|标准)$/.test(a.eventType)||/法规|法令|指令|行政令|规章|条例|标准|最终规则|临时最终规则|拟议规则|实施细则|修订草案|法案/.test(a.title);
}
type Deadline=Article['deadlines'][number];
type DateGroup={article:Article;dates:Map<string,Deadline>};

const EFFECTIVE_LABEL=/^(?:(?:本)?(?:条例或指令|条例|指令|规则|法规|规定|决定|措施))?(?:正式)?(?:生效|施行)(?:日期|日|时间)?(?:[，,；;。]|$)/;
const EXPIRY_LABEL=/^(?:(?:本)?(?:条例|指令|规则|法规|规定|决定|措施))?(?:到期(?:失效|日期|日|时间)?|有效期届满|限期豁免适用期结束)(?:[，,；;。]|$)/;

export function importantDateGroups(articles:Article[],today:string,days:number){
 const end=new Date(today+'T00:00:00Z');
 end.setUTCDate(end.getUTCDate()+days);
 const last=end.toISOString().slice(0,10);
 const groups=new Map<string,DateGroup>();

 for(const article of articles){
  const dates=[...article.deadlines];
  // Keep the more specific description and time zone for the same legal event.
  if(article.effectiveDate&&!article.deadlines.some(d=>d.date===article.effectiveDate&&EFFECTIVE_LABEL.test(d.label.trim()))){
   dates.push({date:article.effectiveDate,label:'生效日期',timezone:'以官方原文为准'});
  }
  if(article.expiryDate&&!article.deadlines.some(d=>d.date===article.expiryDate&&EXPIRY_LABEL.test(d.label.trim()))){
   dates.push({date:article.expiryDate,label:'到期日期',timezone:'以官方原文为准'});
  }

  const visible=dates.filter(d=>/^\d{4}-\d{2}-\d{2}$/.test(d.date)&&d.date>=today&&d.date<=last);
  if(!visible.length)continue;

  const group=groups.get(article.id)??{article,dates:new Map<string,Deadline>()};
  for(const date of visible){
   group.dates.set(JSON.stringify([date.date,date.label,date.timezone]),date);
  }
  groups.set(article.id,group);
 }

 return Array.from(groups.values(),({article,dates})=>({
  article,
  dates:[...dates.values()].sort((a,b)=>a.date.localeCompare(b.date))
 })).sort((a,b)=>a.dates[0].date.localeCompare(b.dates[0].date));
}
export function dailyBriefing(articles:Article[],run:MonitorRun){
 const ids=new Set(run.articleIds??[]);
 const updates=articles.filter(a=>ids.has(a.id));
 return {windowStart:run.windowStart,cutoff:run.cutoff,completedAt:run.completedAt,status:run.status,gaps:run.gaps,newCount:run.newCount,updatedCount:run.updatedCount,regulations:updates.filter(isRegulation),news:updates.filter(a=>!isRegulation(a))};
}
