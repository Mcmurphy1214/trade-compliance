import type {Article} from './types';

export const TRACK_KINDS=['法案追踪','出口管制','双边措施','经济制裁','市场准入','其他'] as const;
export const TRACK_STATUSES=['持续跟踪','重点关注','暂缓跟踪','已归档'] as const;
export type TrackEvent={id:string;articleId:string;date:string|null;matter:string;title:string;status:string;summary:string;sources:{title:string;url:string}[];verifiedAt:string;linkedAt:string};
export type TrackAction={id:string;text:string;owner:string;dueDate:string;done:boolean};
export type TopicTrack={id:string;title:string;kind:string;description:string;keywords:string[];trackingStatus:string;assessment:string;nextWatch:string;businessImpact:string;events:TrackEvent[];actions:TrackAction[];version:number;updatedAt:string;updatedBy:string};
const template=(id:string,title:string,kind:string,description:string,keywords:string[]):TopicTrack=>({id,title,kind,description,keywords,trackingStatus:'持续跟踪',assessment:'',nextWatch:'',businessImpact:'',events:[],actions:[],version:0,updatedAt:'',updatedBy:''});
export const DEFAULT_TRACKS:TopicTrack[]=[
 template('ndaa','NDAA法案更新','法案追踪','按财年区分法案版本、立法进程、关键条款和配套执行，不将草案视为已生效法律。',['NDAA','国防授权法','National Defense Authorization']),
 template('chip-export-controls','芯片出口管制规则变化','出口管制','按规则和文号跟踪物项范围、许可条件、例外及实施指引。',['芯片','半导体','先进计算','集成电路','semiconductor']),
 template('china-us-measures','中美规则暂停与恢复','双边措施','逐项区分规则的暂停、延期、到期和恢复适用，保留期限、条件与过渡安排。',['暂停','恢复适用','继续暂停','中美','延期'])
];
// The explicit business exclusions apply to both discovery and manual linking.
// Fluorinated refrigerants are not the methane industry exclusion.
export function isTrackingExcluded(a:Article){return /丙烯酸(?:丁酯|2[-—－]?乙基己酯|酯)|聚醚多元醇|\bPTMEG\b|(?<![氟氯溴])甲烷排放|木材|森林风险商品|医疗(?:专用)?冷水机|医疗器械认证|长链全氟羧酸/i.test(a.title);}
// Keyword matches are discovery leads only, never legal findings or automatic events.
export function isTrackCandidate(track:TopicTrack,a:Article){
 if(isTrackingExcluded(a))return false;
 if(track.events.some(e=>e.articleId===a.id&&e.verifiedAt===a.verifiedAt))return false;
 if(track.id==='china-us-measures'&&(!['中国','美国'].includes(a.jurisdiction)||!/(暂停|恢复适用|继续暂停|中美)/.test(a.title)))return false;
 if(track.id==='chip-export-controls'&&a.category!=='出口管制')return false;
 const text=[a.title,a.reference,a.summary,...a.topics].join(' ').toLowerCase();
 return track.keywords.some(k=>text.includes(k.toLowerCase()));
}
