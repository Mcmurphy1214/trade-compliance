import { env } from "cloudflare:workers";
import seeds from "../../../../lib/seed.json";
import { editorAccess } from "../../../../lib/editor-access";
import { allowedAnalyticsOrigin, isLikelyBot, trackedPage, validViewId } from "../../../../lib/analytics-policy";
import { recordPageView } from "../../../../lib/analytics";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store" };
const seedIds = new Set(seeds.map(article => article.id));

export async function POST(request: Request) {
  if (!allowedAnalyticsOrigin(request.url, request.headers.get("origin"), request.headers.get("sec-fetch-site")))
    return new Response(null, { status: 403, headers });
  if ((await editorAccess(request)).canEdit || isLikelyBot(request.headers.get("user-agent")))
    return new Response(null, { status: 204, headers });
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json") || Number(request.headers.get("content-length") ?? 0) > 1024)
    return new Response(null, { status: 400, headers });
  let body: { id?: unknown; path?: unknown };
  try {
    const raw = await request.text();
    if (raw.length > 1024) return new Response(null, { status: 400, headers });
    body = JSON.parse(raw);
  } catch { return new Response(null, { status: 400, headers }); }
  if (!body || !validViewId(body.id)) return new Response(null, { status: 400, headers });
  const page = trackedPage(body.path);
  if (!page) return new Response(null, { status: 400, headers });
  try {
    if (page.articleId && !seedIds.has(page.articleId)) {
      const exists = await env.DB!.prepare("SELECT id FROM articles WHERE id=?").bind(page.articleId).first();
      if (!exists) return new Response(null, { status: 404, headers });
    }
    await recordPageView(body.id, page.path, page.articleId);
    return new Response(null, { status: 204, headers });
  } catch { return new Response(null, { status: 503, headers }); }
}
