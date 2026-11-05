import { env } from "cloudflare:workers";
const UN_URL = "https://scsanctions.un.org/resources/xml/en/name/consolidated.xml";
const hash = async (value: string) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)))).map(x => x.toString(16).padStart(2, "0")).join("");
type Snapshot = { checkedAt: string; generatedAt: string | null; records: Record<string, string>; individuals: number; entities: number };

export async function parseUnSnapshot(xml: string): Promise<Snapshot> {
  if (!/<CONSOLIDATED_LIST\b/.test(xml) || !/<\/CONSOLIDATED_LIST>\s*$/.test(xml)) throw new Error("未取得完整联合国XML，不能用HTML错误页或不完整文件更新基线。");
  const rows = [...xml.matchAll(/<(INDIVIDUAL|ENTITY)\b[^>]*>([\s\S]*?)<\/\1>/g)];
  const records: Record<string, string> = {};
  let individuals = 0, entities = 0;
  for (const match of rows) {
    const dataId = match[2].match(/<DATAID>([^<]+)<\/DATAID>/)?.[1];
    if (!dataId) throw new Error("名单记录缺少稳定DATAID。");
    const key = match[1] + ":" + dataId.trim();
    if (records[key]) throw new Error("名单包含重复DATAID，需核验文件完整性。");
    records[key] = await hash(match[2].replace(/>\s+</g, "><").trim());
    if (match[1] === "INDIVIDUAL") individuals++; else entities++;
  }
  if (individuals < 500 || entities < 100) throw new Error("名单记录数量异常，保留原基线待核查。");
  return { checkedAt: new Date().toISOString(), generatedAt: xml.match(/dateGenerated="([^"]+)"/)?.[1] ?? null, records, individuals, entities };
}

export function compareSnapshots(previous: Snapshot | null, current: Snapshot) {
  const keys = Object.keys(current.records);
  if (!previous) return { baselineCreated: true, previousCheckedAt: null, added: [] as string[], removed: [] as string[], changed: [] as string[] };
  if (keys.length < Object.keys(previous.records).length * 0.8) throw new Error("名单数量显著减少，暂不覆盖上次基线，须人工核验。");
  return {
    baselineCreated: false, previousCheckedAt: previous.checkedAt,
    added: keys.filter(key => !Object.hasOwn(previous.records, key)),
    removed: Object.keys(previous.records).filter(key => !Object.hasOwn(current.records, key)),
    changed: keys.filter(key => previous.records[key] && previous.records[key] !== current.records[key]),
  };
}

export async function checkUnSanctionsChanges(fetcher: typeof fetch = fetch) {
  const response = await fetcher(UN_URL, { signal: AbortSignal.timeout(25_000) });
  if (!response.ok) throw new Error(`联合国名单 HTTP ${response.status}`);
  const xml = await response.text();
  if (xml.length > 10_000_000) throw new Error("名单文件超过安全大小，未更新基线。");
  const current = await parseUnSnapshot(xml);
  const row = await env.DB!.prepare("SELECT payload FROM monitor_source_state WHERE id='un-consolidated'").first<{ payload: string }>();
  const previous: Snapshot | null = row ? JSON.parse(row.payload) : null;
  const differences = compareSnapshots(previous, current);
  await env.DB!.prepare("INSERT INTO monitor_source_state(id,payload,updated_at) VALUES('un-consolidated',?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload,updated_at=excluded.updated_at").bind(JSON.stringify(current), current.checkedAt).run();
  return { sourceId: "un-consolidated", sourceUrl: UN_URL, checkedAt: current.checkedAt, fileGeneratedAt: current.generatedAt, individuals: current.individuals, entities: current.entities, ...differences,
    note: differences.baselineCreated ? "本次建立首个逐条记录基线，不能据此判定此前窗口新增或移除。文件生成时间不是政策修改日期。" : "按稳定DATAID比较各记录内容；文件每日生成时间不参与逐条哈希。变化只是核查线索，须返回官方制裁公告确认法律性质、生效时间及适用法域。未覆盖其他法域名单。" };
}
