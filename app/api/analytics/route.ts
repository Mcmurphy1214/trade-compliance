import { editorAccess } from "../../../lib/editor-access";
import { analyticsReport } from "../../../lib/analytics";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store", "Vary": "Cookie", "X-Robots-Tag": "noindex, nofollow" };
export async function GET(request: Request) {
  const access = await editorAccess(request);
  if (!access.canEdit) return Response.json({ error: "访问统计仅网站所有者可见。" }, { status: access.signedIn ? 403 : 401, headers });
  try { return Response.json(await analyticsReport(), { headers }); }
  catch { return Response.json({ error: "暂时无法读取访问统计，请稍后重试。" }, { status: 503, headers }); }
}
