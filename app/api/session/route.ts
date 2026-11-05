import {editorAccess} from "../../../lib/editor-access";
export const dynamic="force-dynamic";
export async function GET(request:Request){
 return Response.json({...await editorAccess(request),signInUrl:"/?view=login"},{headers:{"Cache-Control":"private, no-store","Vary":"Cookie"}});
}
