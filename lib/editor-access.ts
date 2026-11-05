import {env} from "cloudflare:workers";
import {isAllowedWriteOrigin} from "./editor-policy";
import {workspaceActor,constantEqual,digest} from "./workspace-auth";
import {monitorIdentity} from "./monitor-context";

export async function editorAccess(request:Request){
 const oauth=monitorIdentity();
 if(new URL(request.url).pathname==="/mcp"&&oauth)return {signedIn:true,canEdit:oauth.scope.includes("monitor:write")};
 const actor=await workspaceActor(request);
 if(actor)return {signedIn:true,canEdit:actor.role==="admin"&&!actor.mustChangePassword};
 // Optional least-scope automation credential, only for the MCP endpoint.
 const configured=env.MONITOR_API_TOKEN;
 const match=request.headers.get("authorization")?.match(/^Bearer ([^\s]{32,256})$/);
 if(new URL(request.url).pathname==="/mcp"&&configured&&configured.length>=32&&match&&constantEqual(await digest(match[1]),await digest(configured)))
  return {signedIn:true,canEdit:true};
 return {signedIn:false,canEdit:false};
}
export async function writeDenial(request:Request):Promise<{status:number;message:string}|null>{
 if(!isAllowedWriteOrigin(request.url,request.headers.get("origin")))return {status:403,message:"不允许从其他网站提交修改。"};
 const access=await editorAccess(request);
 if(!access.canEdit)return {status:access.signedIn?403:401,message:access.signedIn?"此账号没有资讯编辑权限。":"请先使用独立管理员账号登录。"};
 return null;
}
