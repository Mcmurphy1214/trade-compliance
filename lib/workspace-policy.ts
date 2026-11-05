import type {RuleConditions} from "./workspace-types";
import type {Article} from "./types";
export class WorkspaceError extends Error{constructor(public status:number,message:string){super(message)}}
export function assertEditor(role:string){if(!["admin","editor"].includes(role))throw new WorkspaceError(403,"只读成员不能修改选题或生成导出。");}
export function assertAdmin(role:string){if(role!=="admin")throw new WorkspaceError(403,"此操作仅管理员可执行。");}
export function parseConditions(raw:unknown):RuleConditions{const c=raw as Record<string,unknown>;if(!c||typeof c!=="object")throw new WorkspaceError(400,"规则条件无效。");const out={} as RuleConditions;for(const key of ["categories","jurisdictions","topics","statuses"] as const){const v=c[key]??[];if(!Array.isArray(v)||v.length>50||v.some(x=>typeof x!=="string"||x.length>120))throw new WorkspaceError(400,"规则条件格式无效。");out[key]=[...new Set(v as string[])];}if(!Object.values(out).some(v=>v.length))throw new WorkspaceError(400,"请至少设置一个规则条件，避免全部资讯自动入池。");return out;}
export function matchesRule(a:Article,c:RuleConditions){return (!c.categories.length||c.categories.includes(a.category))&&(!c.jurisdictions.length||c.jurisdictions.includes(a.jurisdiction))&&(!c.topics.length||c.topics.some(t=>a.topics.includes(t)))&&(!c.statuses.length||c.statuses.includes(a.status));}
export function cleanText(v:unknown,max=2000){if(typeof v!=="string"||v.length>max)throw new WorkspaceError(400,`文本不得超过${max}字。`);return v.trim();}
