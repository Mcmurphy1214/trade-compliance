export const CATALOGS = {
  "cn-bureau-consultations": { url: "https://aqygzj.mofcom.gov.cn/zhxx/index.html", dateRole: "published" },
  "cn-consultations-policy": { url: "https://www.mofcom.gov.cn/zqyj/zcfgzqyj/index.html", dateRole: "deadline" },
  "cn-consultations-commissions": { url: "https://www.mofcom.gov.cn/zqyj/hwhzqyj/index.html", dateRole: "deadline" },
  "cn-consultations-standards": { url: "https://www.mofcom.gov.cn/zqyj/bqzqyj/index.html", dateRole: "deadline" },
  "cn-consultations-other": { url: "https://www.mofcom.gov.cn/zqyj/qtzqyj/index.html", dateRole: "deadline" },
} as const;
type CatalogId = keyof typeof CATALOGS;
export type CatalogEntry = { title: string; url: string; listedDate: string | null; dateRole: string };

const clean = (html: string) => html.replace(/<[^>]*>/g, " ").replace(/&nbsp;|&#160;/gi, " ").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\s+/g, " ").trim();
const attr = (html: string, name: string) => new RegExp(`\\b${name}="([^"]*)"`, "i").exec(html)?.[1];

export function catalogLoader(html: string, pageUrl: string) {
  const script = html.match(/<script\b[^>]*queryData="[^"]+"[^>]*>/i)?.[0];
  if (!script) throw new Error("目录没有返回公开列表加载参数，不能将栏目壳当成空目录。");
  const endpoint = attr(script, "url");
  if (endpoint !== "/api-gateway/jpaas-publish-server/front/page/build/unit") throw new Error("官网列表接口发生变化，需重新核验。");
  const raw = JSON.parse(attr(script, "queryData")!.replaceAll("'", '"'));
  const query: Record<string, string> = {};
  for (const key of ["parseType", "webId", "tplSetId", "pageType", "tagId", "editType", "pageId"]) {
    if (typeof raw[key] === "string") query[key] = raw[key];
  }
  if (!query.webId || !query.pageId || !query.tagId) throw new Error("公开列表参数不完整。");
  return { endpoint: new URL(endpoint, pageUrl).href, query };
}

export function catalogPage(html: string, pageUrl: string, dateRole: string) {
  const entries: CatalogEntry[] = [];
  for (const row of html.matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/gi)) {
    const a = row[1].match(/<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i);
    if (!a) continue;
    const url = new URL(a[1].replaceAll("&amp;", "&"), pageUrl);
    if (!["http:", "https:"].includes(url.protocol) || !/(^|\.)mofcom\.gov\.cn$/.test(url.hostname)) continue;
    const title = clean(a[2]);
    if (!title || title === "结果反馈") continue;
    entries.push({ title, url: url.href.replace(/^http:/, "https:"), listedDate: row[1].match(/\d{4}-\d{2}-\d{2}/)?.[0] ?? null, dateRole });
  }
  const total = Number(attr(html, "count"));
  const pageNo = Number(attr(html, "pageNo"));
  const pageSize = Number(attr(html, "rows"));
  if (!Number.isInteger(total) || total < 0 || !Number.isInteger(pageNo) || pageNo < 1 || !Number.isInteger(pageSize) || pageSize < 1) throw new Error("缺少可信分页数量，不能认定目录已完整读取。");
  return { entries, total, pageNo, pageSize };
}

async function readText(url: string, fetcher: typeof fetch) {
  const response = await fetcher(url, { signal: AbortSignal.timeout(20_000), headers: { Accept: "text/html,application/json" } });
  if (!response.ok) throw new Error(`官方接口 HTTP ${response.status}`);
  const body = await response.text();
  if (body.length > 2_000_000) throw new Error("单次目录响应超出安全大小，请分批核查。");
  return body;
}

export async function readOfficialCatalog(id: string, maxPages = 8, fetcher: typeof fetch = fetch) {
  if (!Object.hasOwn(CATALOGS, id)) throw new Error("不支持的目录编号。");
  if (!Number.isInteger(maxPages) || maxPages < 1 || maxPages > 8) throw new Error("max_pages须在1至8之间。");
  const source = CATALOGS[id as CatalogId];
  const loader = catalogLoader(await readText(source.url, fetcher), source.url);
  const entries = new Map<string, CatalogEntry>();
  const requests: string[] = [];
  let total = 0, pagesRead = 0, pagesExpected = 1;
  for (let pageNo = 1; pageNo <= Math.min(maxPages, pagesExpected); pageNo++) {
    const url = new URL(loader.endpoint);
    const query = { ...loader.query, paramJson: JSON.stringify({ pageNo, pageSize: 15 }) };
    url.search = new URLSearchParams(query).toString();
    const data = JSON.parse(await readText(url.href, fetcher));
    if (!data.success || typeof data.data?.html !== "string") throw new Error("公开接口未返回有效目录正文。");
    const page = catalogPage(data.data.html, source.url, source.dateRole);
    if (page.pageNo !== pageNo) throw new Error("官网未按请求页码返回，不能以重复第一页代替分页核查。");
    if (pageNo > 1 && page.total !== total) throw new Error("核查过程中目录总数改变，请重试以保持同一快照。");
    total = page.total;
    pagesExpected = Math.max(1, Math.ceil(total / page.pageSize));
    const before = entries.size;
    for (const item of page.entries) entries.set(item.url, item);
    if (total > 0 && before === entries.size) throw new Error("目录返回空页或重复页，尚不能认定覆盖完成。");
    pagesRead++; requests.push(url.href);
  }
  const complete = pagesRead === pagesExpected && entries.size === total;
  return {
    id, sourceUrl: source.url, checkedAt: new Date().toISOString(), total, pagesRead, pagesExpected,
    entries: [...entries.values()], complete, requests,
    note: source.dateRole === "deadline" ? "列表日期为意见截止日，不是发布日期；必须逐条打开与业务相关的原通知核对原始日期，不能按此日期过滤新增。目录读取成功不代表所有附件或全部政策源已核查。" : "列表日期为公布日期，仍须读相关原文和附件。目录读取成功不代表全部法域核查完成。",
  };
}
