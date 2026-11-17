import {requireActor,workspaceActor,assertBrowserOrigin} from '../../../lib/workspace-auth';
import {ensureDatabase} from '../../../lib/database-setup';
import {env} from 'cloudflare:workers';
import {WorkspaceError} from '../../../lib/workspace-policy';
import {topicTracks,mutateTrack} from '../../../lib/topic-tracks';
import {publicTopicTrack} from '../../../lib/topic-model';
export const dynamic='force-dynamic';
const headers={'Cache-Control':'private, no-store','Vary':'Cookie','X-Content-Type-Options':'nosniff','X-Robots-Tag':'noindex, nofollow'};
const json=(data:unknown,status=200)=>Response.json(data,{status,headers});
function failure(e:unknown){if(e instanceof WorkspaceError)return json({error:e.message},e.status);console.error('topic operation failed',e instanceof Error?e.message:'unknown');return json({error:'主题暂时无法读取或保存，请稍后重试。'},503);}
export async function GET(request:Request){try{
 await ensureDatabase(env.DB!);const actor=await workspaceActor(request),tracks=await topicTracks();
 return json({tracks:actor&&!actor.mustChangePassword?tracks:tracks.map(publicTopicTrack)});
}catch(e){return failure(e);}}
export async function POST(request:Request){try{
 assertBrowserOrigin(request);await ensureDatabase(env.DB!);const actor=await requireActor(request);
 if(Number(request.headers.get('content-length')||0)>120000)throw new WorkspaceError(413,'请求内容过大。');
 const raw=await request.text();if(raw.length>60000)throw new WorkspaceError(413,'请求内容过大。');
 let body;try{body=JSON.parse(raw);}catch{throw new WorkspaceError(400,'请求格式无效。');}
 if(!body||typeof body!=='object'||Array.isArray(body))throw new WorkspaceError(400,'请求格式无效。');
 return json(await mutateTrack(actor,body));
 }catch(e){return failure(e);}}
