import {anonymizeContent,anonymizeArticle} from "./content-privacy";

export const CONTENT_PRIVACY_VERSION="company-anonymized-v1";
const markerId="runtime:content-privacy-v1";
const completed=new WeakSet<D1Database>();
const targets=[
  {table:"articles",json:["payload"],text:[],article:true},
  {table:"article_revisions",json:["payload"],text:[],article:true},
  {table:"monitor_runs",json:["payload"],text:[]},
  {table:"monitor_source_state",json:["payload"],text:[]},
  {table:"workspace_exports",json:["payload"],text:[]},
  {table:"workspace_pool",json:[],text:["note","status"]},
  {table:"workspace_rules",json:["conditions"],text:["name","updated_by"]},
  {table:"workspace_matches",json:[],text:["rule_name"]},
  {table:"workspace_follows",json:[],text:["display_name"]},
  {table:"workspace_users",json:[],text:["display_name"]},
  {table:"workspace_activity",json:["detail"],text:["actor_name","action"]}
];
async function checksum(value:string){return [...new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(value)))].map(b=>b.toString(16).padStart(2,"0")).join("");}

// An idempotent data correction, independent of news monitoring windows. Never
// change article dates, login credentials, account versions or follow ownership.
export async function ensureContentPrivacy(db:D1Database):Promise<void>{
  if(completed.has(db))return;
  if(await db.prepare("SELECT id FROM monitor_source_state WHERE id=?").bind(markerId).first()){completed.add(db);return;}
  const counts:Record<string,number>={};
  for(const target of targets){
    let after=0;counts[target.table]=0;
    const columns=[...target.json,...target.text,...(target.table==="workspace_exports"?["checksum","id"]:[])];
    for(;;){
      const rows=await db.prepare(`SELECT rowid AS privacy_rowid,${columns.join(",")} FROM ${target.table} WHERE rowid>? ORDER BY rowid LIMIT ?`).bind(after,target.table==="workspace_exports"?1:20).all<Record<string,any>>();
      if(!rows.results.length)break;
      for(const row of rows.results){
        after=Number(row.privacy_rowid);
        if(target.table==="monitor_source_state"&&row.payload?.includes('"version":"'+CONTENT_PRIVACY_VERSION+'"'))continue;
        for(let attempt=0;attempt<3;attempt++){
          const changes:Record<string,string>={};
          for(const key of target.json){
            const parsed=JSON.parse(row[key]);
            const next=JSON.stringify(target.article?anonymizeArticle(parsed):anonymizeContent(parsed));
            // Preserve formatting when the JSON's values are already anonymous.
            if(JSON.stringify(parsed)!==next)changes[key]=next;
          }
          for(const key of target.text){const next=anonymizeContent(row[key]);if(next!==row[key])changes[key]=next;}
          if(!Object.keys(changes).length)break;
          if(target.table==="workspace_exports")changes.checksum=await checksum(changes.payload);
          const keys=Object.keys(changes),now=new Date().toISOString();
          const update=db.prepare(`UPDATE ${target.table} SET ${keys.map(k=>`${k}=?`).join(",")} WHERE rowid=? AND ${keys.map(k=>`${k}=?`).join(" AND ")}`).bind(...keys.map(k=>changes[k]),after,...keys.map(k=>row[k]));
          const commands=[update];
          if(target.table==="workspace_exports")commands.push(db.prepare("INSERT INTO workspace_activity(id,actor_id,actor_name,action,article_id,detail,created_at) SELECT ?,'system','隐私保护','导出快照匿名化',NULL,?,? WHERE changes()>0").bind(crypto.randomUUID(),JSON.stringify({snapshotId:row.id,previousChecksum:row.checksum,checksum:changes.checksum}),now));
          const result=await db.batch(commands);
          if(result.some(r=>!r.success))throw Error("Content privacy correction failed");
          if(result[0].meta.changes){counts[target.table]++;break;}
          const fresh=await db.prepare(`SELECT ${columns.join(",")} FROM ${target.table} WHERE rowid=?`).bind(after).first<Record<string,any>>();
          if(!fresh)break;
          Object.assign(row,fresh);
          if(attempt===2)throw Error("Content changed during privacy correction; retry required");
        }
      }
    }
  }
  const now=new Date().toISOString();
  await db.batch([
    db.prepare("INSERT INTO workspace_activity(id,actor_id,actor_name,action,article_id,detail,created_at) SELECT ?,'system','隐私保护','完成公司名称匿名化',NULL,?,? WHERE NOT EXISTS(SELECT 1 FROM monitor_source_state WHERE id=?)").bind(crypto.randomUUID(),JSON.stringify({version:CONTENT_PRIVACY_VERSION,recordsUpdated:counts}),now,markerId),
    db.prepare("INSERT OR IGNORE INTO monitor_source_state(id,payload,updated_at) VALUES(?,?,?)").bind(markerId,JSON.stringify({version:CONTENT_PRIVACY_VERSION,completedAt:now,recordsUpdated:counts}),now)
  ]);
  completed.add(db);
}
