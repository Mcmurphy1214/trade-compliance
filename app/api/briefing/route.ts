import {feed} from '../../../lib/store';
import {dailyBriefing} from '../../../lib/regulatory';
export const dynamic='force-dynamic';
export async function GET(){try{const f=await feed();return Response.json(dailyBriefing(f.articles,f.run),{headers:{'Cache-Control':'no-store'}});}catch{return Response.json({error:'本轮简报暂时无法读取'},{status:503});}}
