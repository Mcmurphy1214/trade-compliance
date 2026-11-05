import type {Article,MonitorRun} from './types';
export type Regulation={kind:string;changeSummary:string;businessAdvice?:string;effectiveStatus?:string;provisions?:string[]};
export function isRegulation(a:Article){
 if('regulation' in a && a.regulation)return true;
 if(/执法案件|许可|和解/.test(a.eventType))return false;
 // Legacy records: classify only the instrument title/type, never incidental mentions in the body.
 return /^(法规|法律|法令|指令|规章|标准)$/.test(a.eventType)||/法规|法令|指令|行政令|规章|条例|标准|最终规则|临时最终规则|拟议规则|实施细则|修订草案|法案/.test(a.title);
}
export function importantDates(articles:Article[],today:string,days:number){
 const end=new Date(today+'T00:00:00Z');end.setUTCDate(end.getUTCDate()+days);const last=end.toISOString().slice(0,10);
 return articles.flatMap(a=>[...(a.effectiveDate?[{date:a.effectiveDate,label:'生效日期',timezone:'以官方原文为准'}]:[]),...(a.expiryDate?[{date:a.expiryDate,label:'到期日期',timezone:'以官方原文为准'}]:[]),...a.deadlines].filter(d=>/^\d{4}-\d{2}-\d{2}$/.test(d.date)&&d.date>=today&&d.date<=last).map(d=>({...d,article:a}))).filter((d,i,all)=>all.findIndex(x=>x.article.id===d.article.id&&x.date===d.date&&x.label===d.label)===i).sort((a,b)=>a.date.localeCompare(b.date));
}
export function dailyBriefing(articles:Article[],run:MonitorRun){
 const ids=new Set(run.articleIds??[]);
 const updates=articles.filter(a=>ids.has(a.id));
 return {windowStart:run.windowStart,cutoff:run.cutoff,completedAt:run.completedAt,status:run.status,gaps:run.gaps,newCount:run.newCount,updatedCount:run.updatedCount,regulations:updates.filter(isRegulation),news:updates.filter(a=>!isRegulation(a))};
}
