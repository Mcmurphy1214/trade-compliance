export function isEditorIdentity(userId:string|null,email:string|null,editorEmail:string|undefined):boolean{
 if(!userId?.trim()||!email?.trim()||!editorEmail?.trim())return false;
 return email.trim().toLowerCase()===editorEmail.trim().toLowerCase();
}
export function isAllowedWriteOrigin(requestUrl:string,origin:string|null):boolean{
 // MCP requests can have no browser Origin. Browser writes must stay on this Site.
 if(origin===null)return true;
 try{return new URL(origin).origin===new URL(requestUrl).origin}catch{return false}
}
