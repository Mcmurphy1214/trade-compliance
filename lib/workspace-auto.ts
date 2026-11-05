import {env} from "cloudflare:workers";
import {matchesRule} from "./workspace-policy";
import type {Article} from "./types";
export async function applyWorkspaceRules(articles:Article[]){
 const rules=await env.DB!.prepare("SELECT * FROM workspace_rules WHERE enabled=1").all<any>();let matched=0;
 for(const rule of rules.results){const conditions=JSON.parse(rule.conditions);for(const a of articles){
 if(!matchesRule(a,conditions))continue;
 const nonce=crypto.randomUUID(),now=new Date().toISOString();
 const result=await env.DB!.batch([
 env.DB!.prepare("INSERT OR IGNORE INTO workspace_pool(article_id,active,suppressed,note,status,version,last_mutation,created_at,updated_at) VALUES(?,1,0,'','待研判',0,?,?,?)").bind(a.id,nonce,now,now),
 env.DB!.prepare("INSERT INTO workspace_matches(article_id,rule_id,rule_name,rule_version,matched_at,mutation_id) SELECT ?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM workspace_pool WHERE article_id=? AND suppressed=0) ON CONFLICT(article_id,rule_id) DO UPDATE SET rule_name=excluded.rule_name,rule_version=excluded.rule_version,matched_at=excluded.matched_at,mutation_id=excluded.mutation_id WHERE workspace_matches.rule_version<>excluded.rule_version").bind(a.id,rule.id,rule.name,rule.version,now,nonce,a.id),
 env.DB!.prepare("UPDATE workspace_pool SET active=1,version=version+1,last_mutation=?,updated_at=? WHERE article_id=? AND suppressed=0 AND EXISTS(SELECT 1 FROM workspace_matches WHERE article_id=? AND rule_id=? AND mutation_id=?)").bind(nonce,now,a.id,a.id,rule.id,nonce),
 env.DB!.prepare("INSERT INTO workspace_activity(id,actor_id,actor_name,action,article_id,detail,created_at) SELECT ?,'system','自动入池规则','规则加入',?,?,? WHERE EXISTS(SELECT 1 FROM workspace_matches WHERE article_id=? AND rule_id=? AND mutation_id=?)").bind(crypto.randomUUID(),a.id,JSON.stringify({ruleId:rule.id,ruleName:rule.name,ruleVersion:rule.version}),now,a.id,rule.id,nonce)
 ]);if(result[1].meta.changes)matched++;
 }}return matched;
}
