export const EXPORT_FIELDS=["资讯标题","摘要","企业启示","板块","发布日期","原文链接","资讯ID","资讯内容","发布机构","生效状态","生效日期","到期日期","发布法域","受影响地区","主题","公告编号","相关期限","核验时间","团队备注","选题状态"] as const;
export type ExportField=typeof EXPORT_FIELDS[number];
export const DEFAULT_EXPORT_FIELDS:ExportField[]=["资讯标题","摘要","企业启示","板块","发布日期","原文链接"];
export const EXPORT_LABELS:Partial<Record<ExportField,string>>={资讯标题:"原文标题",摘要:"内容简述",企业启示:"建议",板块:"领域",发布日期:"信息发布日期",原文链接:"原文链接",资讯内容:"正文"};
export function selectedExportFields(value:unknown):ExportField[]{
 if(value===undefined)return [...DEFAULT_EXPORT_FIELDS];
 if(!Array.isArray(value)||!value.length||value.some(v=>typeof v!=="string"||!EXPORT_FIELDS.includes(v as ExportField)))throw new Error("请至少勾选一个有效的导出字段。");
 return EXPORT_FIELDS.filter(f=>value.includes(f));
}
