import {env} from "cloudflare:workers";
import {feed} from "./store";
import {anonymizeContent} from "./content-privacy";
import {assertAdmin,cleanText,WorkspaceError} from "./workspace-policy";
import type {ArticlePublication,WorkspaceActor} from "./workspace-types";

type Row={article_id:string;title:string;archived:number;reason:string;actor_name:string;updated_at:string;version:number};
export async function articlePublications():Promise<ArticlePublication[]>{
 const rows=await env.DB!.prepare("SELECT article_id,title,archived,reason,actor_name,updated_at,version FROM article_publications ORDER BY updated_at DESC").all<Row>();
 return rows.results.map(r=>({articleId:r.article_id,title:anonymizeContent(r.title),archived:!!r.archived,reason:anonymizeContent(r.reason),actorName:anonymizeContent(r.actor_name),updatedAt:r.updated_at,version:r.version}));
}

// Publication state is separate from the article payload, so seed merging and
// monitor upserts cannot undo an administrator's decision.
export async function setArticleVisibility(actor:WorkspaceActor,body:Record<string,unknown>){
 assertAdmin(actor.role);
 const id=body.articleId;
 if(typeof id!=="string"||!/^[a-zA-Z0-9_-]{1,100}$/.test(id)||typeof body.archived!=="boolean"||!Number.isInteger(body.version)||Number(body.version)<0)throw new WorkspaceError(400,"资讯编号或下架版本无效。");
 const reason=anonymizeContent(cleanText(body.reason,1000));
 if(!reason)throw new WorkspaceError(400,"请填写下架或恢复原因。");
 const article=(await feed(true)).articles.find(a=>a.id===id);
 if(!article)throw new WorkspaceError(404,"资讯不存在。");
 const now=new Date().toISOString(),nonce=crypto.randomUUID(),archived=body.archived?1:0;
 const result=await env.DB!.batch([
  env.DB!.prepare("INSERT OR IGNORE INTO article_publications(article_id,title,archived,reason,actor_id,actor_name,updated_at,version,last_mutation) VALUES(?,?,0,'','','',?,0,'')").bind(id,article.title,now),
  env.DB!.prepare("UPDATE article_publications SET title=?,archived=?,reason=?,actor_id=?,actor_name=?,updated_at=?,version=version+1,last_mutation=? WHERE article_id=? AND version=? AND archived<>?").bind(article.title,archived,reason,actor.id,actor.displayName,now,nonce,id,body.version,archived),
  env.DB!.prepare("INSERT INTO workspace_activity(id,actor_id,actor_name,action,article_id,detail,created_at) SELECT ?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM article_publications WHERE article_id=? AND last_mutation=?)").bind(crypto.randomUUID(),actor.id,actor.displayName,archived?"下架资讯":"恢复上架",id,JSON.stringify({articleTitle:article.title,reason}),now,id,nonce)
 ]);
 if(!result[1].meta.changes)throw new WorkspaceError(409,"资讯上下架状态已变更，请刷新后重试。");
 return {ok:true,articleId:id,archived:body.archived,version:Number(body.version)+1};
}
