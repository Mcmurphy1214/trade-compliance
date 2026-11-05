import {anonymizeArticle,hasCompanyName} from './content-privacy';
import type {Article} from './types';
import {isRegulation} from './regulatory';
import {validDate} from './workspace-filters';

export type BriefingSnapshot={templateVersion:1;createdAt:string;periodStart:string|null;periodEnd:string|null;articles:Article[]};
export type BriefingBadge={text:string;tone:'green'|'amber'|'blue'|'gray'};
// Legacy records may already have an explicit normative-measure event type but no regulation object.
// This affects the PDF's broader "法规与规范性措施" group only, without rewriting source classification.
const normativeEventTypes=new Set(['认证范围调整','征求意见期限公布','生效实施','征求意见','最终征税']);
export const isBriefingRegulation=(a:Article)=>isRegulation(a)||normativeEventTypes.has(a.eventType);
const officialDate=(value:string|null|undefined)=>value&&validDate(value)?value:null;
export const legalStatus=(a:Article)=>a.regulation?.effectiveStatus||a.status||'状态待核实';
export function businessRank(a:Article){
 const text=[a.title,a.summary,...a.topics].join(' ');
 if(a.companyRelevant||hasCompanyName(text))return 0;
 if(/电气|电力|变压器|开关|配电|输电|光伏|太阳能|储能|电池|新能源|逆变器|硅片|组件|OEM|KS认证|UWB|不锈钢/i.test(text))return 1;
 if(/出口管制|原产地|自贸协定|海关|跨境投融资|贸易融资|船旗|航运|船舶/.test(text))return 2;
 return 3;
}
export function buildBriefingSnapshot(articles:Article[],createdAt:string,period?:{start?:string;end?:string}):BriefingSnapshot{
 if(!articles.length)throw Error('请选择至少一条资讯。');
 for(const d of [period?.start,period?.end])if(d&&!validDate(d))throw Error('简报日期无效。');
 if(period?.start&&period?.end&&period.start>period.end)throw Error('简报开始日期不能晚于结束日期。');
 const dates=articles.map(a=>officialDate(a.publishedDate)).filter((d):d is string=>!!d).sort();
 const unique=[...new Map(articles.map(a=>[a.id,anonymizeArticle(a)])).values()];
 const ordered=unique.map((a,i)=>({a,i})).sort((x,y)=>Number(isBriefingRegulation(y.a))-Number(isBriefingRegulation(x.a))||businessRank(x.a)-businessRank(y.a)||((x.a.priority==='高'||x.a.priority==='重要'?0:1)-(y.a.priority==='高'||y.a.priority==='重要'?0:1))||(y.a.publishedDate||'').localeCompare(x.a.publishedDate||'')||x.i-y.i).map(x=>x.a);
 return {templateVersion:1,createdAt,periodStart:period?.start||dates[0]||null,periodEnd:period?.end||dates.at(-1)||null,articles:structuredClone(ordered)};
}
export function periodLabel(b:BriefingSnapshot){
 const fmt=(s:string)=>{const [y,m,d]=s.split('-');return `${y}年${Number(m)}月${Number(d)}日`;};
 if(b.periodStart&&b.periodEnd)return b.periodStart===b.periodEnd?fmt(b.periodStart):`${fmt(b.periodStart)}-${fmt(b.periodEnd)}`;
 return '发布日期未明确';
}
export function nodeBadges(a:Article):BriefingBadge[]{
 const status=legalStatus(a),result:BriefingBadge[]=[];
 const draft=/拟议|草案|征求意见|谈判|待立法/.test(status);
 if(a.effectiveDate&&validDate(a.effectiveDate))result.push({text:`${a.effectiveDate} ${/替代/.test(status)?'文件替代':draft?'拟定生效':'生效'}`,tone:draft?'blue':/废止|失效|撤销/.test(status)?'gray':'green'});
 for(const d of a.deadlines||[]){
  if(!validDate(d.date))continue;
  const condition=(d as typeof d&{condition?:string}).condition;
  let label=d.label;
  if(/截止|反馈|评论/.test(label))label=(/实施规则/.test(label)?'实施规则':/实施令/.test(label)?'实施令':'')+(/回复/.test(label)?'回复截止':/评论/.test(label)?'评论截止':'意见截止');
  else if(/授权.*起始|授权.*起算/.test(label))label='授权起始（有条件）';
  result.push({text:`${d.date} ${label}${condition?'（条件见正文）':''}`,tone:/截止|反馈|评论/.test(d.label)?'amber':'blue'});
 }
 if(a.expiryDate&&validDate(a.expiryDate))result.push({text:`${a.expiryDate} 到期`,tone:'gray'});
 if(!result.length)result.push({text:status,tone:/已生效|已公布执行/.test(status)?'green':/征求意见/.test(status)?'amber':'blue'});
 return result;
}
export function articleSections(content:string){
 return content.split(/\n\s*\n|\n(?=【)/).map(p=>p.trim()).filter(Boolean).flatMap(p=>{
  const m=p.match(/^【([^】]+)】\s*([\s\S]*)$/);
  return m?[{heading:m[1],text:m[2]}]:[{heading:'',text:p}];
 }).filter(s=>!/^业务分析参考$/.test(s.heading));
}
export function sourceUrl(raw:string){try{const u=new URL(raw);return /^https?:$/.test(u.protocol)?u.href:null;}catch{return null;}}
