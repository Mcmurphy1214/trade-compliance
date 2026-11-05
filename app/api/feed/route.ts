import {writeDenial} from "../../../lib/editor-access";
import {feed,upsert,recordRun} from "../../../lib/store";export const dynamic="force-dynamic";
export async function GET(){try{return Response.json(await feed(),{headers:{"Cache-Control":"no-store"}})}catch{return Response.json({error:"资讯库暂时无法连接，请稍后重试。"},{status:503})}}
export async function POST(request:Request){const denied=await writeDenial(request);if(denied)return Response.json({error:denied.message},{status:denied.status,headers:{"Cache-Control":"no-store"}});try{const body=await request.json() as {action?:string;run:any;articles:any[]};return Response.json(body.action==="record_run"?await recordRun(body.run):await upsert(body.articles));}catch(e){return Response.json({error:e instanceof Error?e.message:"保存失败"},{status:400})}}
