import {env} from "cloudflare:workers";
import {workspaceActor,requireActor,assertBrowserOrigin,login,sessionCookie,sessionToken,digest} from "../../../lib/workspace-auth";
import {WorkspaceError,assertEditor} from "../../../lib/workspace-policy";
import {workspaceState,mutatePool,saveRule,syncRules,createMember,manageMember,changePassword} from "../../../lib/workspace";
import {EXPORT_FIELDS,exportRow,excelFile,wordFile} from "../../../lib/workspace-export";
import {selectedExportFields,EXPORT_LABELS} from "../../../lib/workspace-export-fields";
import type {ExportRow} from "../../../lib/workspace-export";
import type {ExportSnapshot} from "../../../lib/workspace-export";
import {feed} from "../../../lib/store";
import {buildBriefingSnapshot} from "../../../lib/briefing-model";
export const dynamic="force-dynamic";
const headers={"Cache-Control":"private, no-store","Vary":"Cookie","X-Content-Type-Options":"nosniff","X-Robots-Tag":"noindex, nofollow"};
const json=(data:unknown,status=200,extra:Record<string,string>={})=>Response.json(data,{status,headers:{...headers,...extra}});
function failure(e:unknown){if(e instanceof WorkspaceError)return json({error:e.message},e.status);console.error("workspace operation failed",e instanceof Error?e.message:"unknown");return json({error:"工作台数据暂时无法读取或保存，请稍后重试。"},503);}
export async function GET(request:Request){try{
 const url=new URL(request.url);
 if(url.searchParams.has("snapshot")){
 const actor=await requireActor(request);assertEditor(actor.role);const id=url.searchParams.get("snapshot"),format=url.searchParams.get("format");
 const row=await env.DB!.prepare("SELECT payload,checksum FROM workspace_exports WHERE id=?").bind(id).first<{payload:string;checksum:string}>();
 if(!row)throw new WorkspaceError(404,"导出快照不存在。");if(format!=="xlsx"&&format!=="docx"&&format!=="briefing")throw new WorkspaceError(400,"导出格式无效。");
 if(await digest(row.payload)!==row.checksum)throw new WorkspaceError(500,"导出快照校验失败。");const snapshot=JSON.parse(row.payload) as ExportSnapshot;
 if(format==="briefing"){
  if(!snapshot.briefing)throw new WorkspaceError(409,"旧快照未保存PDF所需的法规与节点资料，请重新生成导出快照。");
  return json({snapshot:snapshot.briefing,id:snapshot.id,checksum:row.checksum},200,{"X-Export-Snapshot":snapshot.id,"X-Export-Checksum":row.checksum});
 }
 if(snapshot.formats&&!snapshot.formats.includes(format!))throw new WorkspaceError(409,"此快照为完整PDF简报；如需Excel或Word，请另外生成所选字段快照。");
 const bytes=format==="xlsx"?excelFile(snapshot):wordFile(snapshot);
 return new Response(bytes as unknown as BodyInit,{headers:{...headers,"Content-Type":format==="xlsx"?"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet":"application/vnd.openxmlformats-officedocument.wordprocessingml.document","Content-Disposition":`attachment; filename="compliance-${snapshot.id}.${format}"`,"X-Export-Snapshot":snapshot.id,"X-Export-Checksum":row.checksum}});
 }
 return json(await workspaceState(await workspaceActor(request)));
 }catch(e){return failure(e);}}
export async function POST(request:Request){try{
 assertBrowserOrigin(request);const length=Number(request.headers.get("content-length")||0);if(length>120000)throw new WorkspaceError(413,"请求内容过大。");
 const text=await request.text();if(text.length>60000)throw new WorkspaceError(413,"请求内容过大。");let body:any;try{body=JSON.parse(text);}catch{throw new WorkspaceError(400,"请求格式无效。");}if(!body||typeof body!=="object"||Array.isArray(body))throw new WorkspaceError(400,"请求格式无效。");
 if(body.action==="login"){const token=await login(request,body.username,body.password);return json({ok:true},200,{"Set-Cookie":sessionCookie(token)});}
 if(body.action==="logout"){const token=sessionToken(request);if(token)await env.DB!.prepare("DELETE FROM workspace_sessions WHERE id=?").bind(await digest(token)).run();return json({ok:true},200,{"Set-Cookie":sessionCookie("",0)});}
 const actor=await requireActor(request,body.action==="change_password");
 if(body.action==="change_password")return json(await changePassword(actor,request,body));
 if(["follow","unfollow","edit","remove","restore"].includes(body.action))return json(await mutatePool(actor,body));
 if(body.action==="save_rule")return json(await saveRule(actor,body));
 if(body.action==="sync_rules")return json(await syncRules(actor));
 if(body.action==="create_member")return json(await createMember(actor,body));
 if(["reset_password","disable_member"].includes(body.action))return json(await manageMember(actor,body));
 if(body.action==="create_export"){
 assertEditor(actor.role);const pdfOnly=body.format==="pdf";if(body.format!==undefined&&!pdfOnly)throw new WorkspaceError(400,"导出格式无效。");let fields;try{fields=selectedExportFields(pdfOnly?undefined:body.fields);}catch{throw new WorkspaceError(400,"请至少勾选一个有效的导出字段。");}if(!Array.isArray(body.articleIds)||!body.articleIds.length||body.articleIds.length>100||body.articleIds.some((x:unknown)=>typeof x!=="string"))throw new WorkspaceError(400,"请选择1至100条团队选题导出。");
 const ids=[...new Set(body.articleIds as string[])],state=await workspaceState(actor),data=await feed(),entries=ids.map(id=>state.pool.find(p=>p.articleId===id&&p.active));
 if(entries.some(p=>!p))throw new WorkspaceError(409,"部分选题已被移出，请刷新后重新选择。");
 if(body.versions&&entries.some(p=>body.versions[p!.articleId]!==p!.version))throw new WorkspaceError(409,"部分选题内容已由成员修改，请刷新后再导出。");
 const rows=entries.map(p=>{const a=data.articles.find(a=>a.id===p!.articleId);if(!a)throw new WorkspaceError(409,"原资讯已不可用，请刷新。");const full=exportRow(a,p!);return Object.fromEntries(fields.map(f=>[f,full[f]])) as ExportRow;});
 if(!pdfOnly&&rows.some(r=>Object.values(r).some(v=>v.length>32767)))throw new WorkspaceError(400,"某个字段超过Excel单元格32767字符上限；为保证Word与Excel一致，本次不截断内容。可直接选择“生成并下载PDF简报”保留全文。");
 const id=crypto.randomUUID(),now=new Date().toISOString();let briefing;
 if(body.periodStart!==undefined&&typeof body.periodStart!=="string"||body.periodEnd!==undefined&&typeof body.periodEnd!=="string")throw new WorkspaceError(400,"简报日期无效。");
 try{briefing=buildBriefingSnapshot(ids.map(id=>data.articles.find(a=>a.id===id)!),now,{start:body.periodStart,end:body.periodEnd});}catch(e){throw new WorkspaceError(400,e instanceof Error?e.message:"简报日期无效。");}
 const snapshot:ExportSnapshot={id,createdAt:now,createdBy:actor.displayName,fields,rows,fieldLabels:Object.fromEntries(fields.map(f=>[f,EXPORT_LABELS[f]??f])),poolVersions:entries.map(p=>({id:p!.articleId,version:p!.version})),briefing,formats:pdfOnly?["pdf"]:["xlsx","docx","pdf"]};
 const payload=JSON.stringify(snapshot);if(new TextEncoder().encode(payload).length>1500000)throw new WorkspaceError(400,"导出内容过大，请减少条目分批导出。");const checksum=await digest(payload);
 await env.DB!.batch([env.DB!.prepare("INSERT INTO workspace_exports(id,payload,checksum,created_at,created_by,row_count) VALUES(?,?,?,?,?,?)").bind(id,payload,checksum,now,actor.id,rows.length),env.DB!.prepare("INSERT INTO workspace_activity(id,actor_id,actor_name,action,article_id,detail,created_at) VALUES(?,?,?,'创建导出快照',NULL,?,?)").bind(crypto.randomUUID(),actor.id,actor.displayName,JSON.stringify({snapshotId:id,rowCount:rows.length,checksum,fields}),now)]);
 return json({ok:true,id,checksum,rowCount:rows.length,fields,xlsx:pdfOnly?null:`/api/workspace?snapshot=${id}&format=xlsx`,docx:pdfOnly?null:`/api/workspace?snapshot=${id}&format=docx`,briefing:`/api/workspace?snapshot=${id}&format=briefing`});
 }
 throw new WorkspaceError(400,"未知工作台操作。");
 }catch(e){return failure(e);}}
