import type {Article} from "./types";

// Keep the aliases in one place. Editorial text uses a neutral company label;
// identifiers, dates and source URLs retain their original meaning and targets.
const companyNames=/(?:浙江)?正泰(?:(?:集团|电器|电气|电源|新能源|新能|安能)(?:(?:股份|有限责任)?有限公司)?)?|\b(?:CHINT(?:\s+(?:Group|Electric(?:al|s)?|Power(?:\s+Systems)?|New\s+Energy))?|Astronergy)\b/gi;
export function redactCompanyText(text:string):string{return text.replace(companyNames,"公司").replace(/公司(?:、公司)+/g,"公司");}
export function hasCompanyName(text:string):boolean{return !!text.match(companyNames);}

const opaqueKeys=new Set(["id","articleId","article_id","userId","user_id","ruleId","rule_id","snapshotId","sourceId","nonce","checksum","previousChecksum","password_hash","password","salt","username"]);
function redactString(text:string):string{
  // An original URL must remain usable, including URLs embedded in export cells.
  return text.split(/(https?:\/\/[^\s<>"'\u3000-\u9fff\uff00-\uffef]+)/g).map(part=>/^https?:\/\//i.test(part)?part:redactCompanyText(part)).join("");
}
export function anonymizeContent<T>(value:T):T{
  if(typeof value==="string")return redactString(value) as T;
  if(Array.isArray(value))return value.map(item=>anonymizeContent(item)) as T;
  if(value&&typeof value==="object")return Object.fromEntries(Object.entries(value).map(([key,item])=>[key,opaqueKeys.has(key)?item:anonymizeContent(item)])) as T;
  return value;
}
export function anonymizeArticle(article:Article):Article{
  const relevant=article.companyRelevant||hasCompanyName([article.title,article.summary,...(article.topics??[])].join(" "));
  const result=anonymizeContent(article);
  return relevant?{...result,companyRelevant:true}:result;
}
