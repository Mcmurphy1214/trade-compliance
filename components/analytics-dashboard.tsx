"use client";
import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, ArrowUpRight, BarChart3, Clock3, Eye, FileText, LockKeyhole, RefreshCw, ShieldCheck, TrendingUp } from "lucide-react";
import { articlePath } from "../lib/article-links";
import type { AnalyticsReport } from "../lib/analytics-types";

const number = (n: number) => n.toLocaleString("zh-CN");
const time = (value: string) => new Date(value).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false });
const periods = [{ key: "today", label: "今日" }, { key: "week", label: "近7天" }, { key: "all", label: "累计" }] as const;

export function AnalyticsDashboard() {
  const [report, setReport] = useState<AnalyticsReport | null>(null);
  const [period, setPeriod] = useState<"today" | "week" | "all">("week");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/analytics", { cache: "no-store", credentials: "same-origin" });
      if (!response.ok) throw new Error(response.status === 401 ? "登录已过期，请重新登录网站管理账号。" : response.status === 403 ? "当前账号没有查看统计的权限。" : "暂时无法读取访问统计，请重试。");
      setReport(await response.json()); setError("");
    } catch (e) { setError(e instanceof Error ? e.message : "读取失败，请稍后重试。"); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); const timer = setInterval(() => { if (document.visibilityState === "visible") void load(); }, 60_000); return () => clearInterval(timer); }, [load]);
  const popular = report?.popular[period] ?? [];
  const maxDay = Math.max(1, ...(report?.daily.map(day => day.views) ?? []));
  return <div className="analytics-shell">
    <div className="utility"><div className="wrap utility-inner"><span><span className="live-dot"/> COMPLIANCE FRONTIER</span><span>北京时间 · Asia/Shanghai</span></div></div>
    <header className="header"><div className="wrap header-inner"><a className="brand" href="/"><span className="brand-mark"><ShieldCheck size={25}/></span><span><strong>合规前沿<span className="brand-dot">.</span></strong><small>COMPLIANCE FRONTIER</small></span></a><a className="analytics-back" href="/"><ArrowLeft size={15}/>返回资讯首页</a></div></header>
    <main className="analytics-wrap">
      <div className="analytics-heading"><div><p className="eyebrow">AUDIENCE INSIGHTS</p><h1>网站访问统计 <span><LockKeyhole size={12}/>仅所有者可见</span></h1><p>了解网站浏览趋势与读者关注的资讯。</p></div><button className="outline" onClick={() => void load()} disabled={loading}><RefreshCw size={14} className={loading ? "spin" : ""}/>{loading ? "读取中" : "刷新数据"}</button></div>
      {error && <div className="analytics-error" role="alert">{error}{report && " 当前保留上次成功读取的数据。"}<button onClick={() => void load()}>重试</button></div>}
      <div className="analytics-status" aria-live="polite"><span><Clock3 size={13}/>{report ? "数据截至 " + time(report.generatedAt) : loading ? "正在读取统计数据…" : "数据暂不可用"}</span><span>{report ? "统计起算 " + time(report.startedAt) : ""}</span></div>
      <section className="analytics-metrics" aria-label="页面浏览量">
        {[
          { label: "今日浏览量", value: report?.totals.today, note: report ? report.today + " · 00:00 至今" : "北京时间自然日", Icon: Eye },
          { label: "近7天浏览量", value: report?.totals.week, note: report ? report.weekStart + " — " + report.today : "含今天及此前6个自然日", Icon: TrendingUp },
          { label: "累计浏览量", value: report?.totals.all, note: "自统计启用后累计", Icon: BarChart3 },
        ].map(({ label, value, note, Icon }) => <article className="analytics-metric" key={label}><div><span>{label}</span><Icon size={20}/></div><strong data-metric={label}>{value === undefined ? "—" : number(value)}<small>PV</small></strong><p>{note}</p></article>)}
      </section>
      <section className="analytics-panel"><div className="analytics-panel-heading"><div><h2>近7天浏览趋势</h2><p>首页与资讯详情页的有效浏览次数</p></div><span className="analytics-legend"><i/>页面浏览量</span></div>
        {report ? <div className="analytics-chart" role="img" aria-label={report.daily.map(day => day.day + "：" + day.views + "次").join("；")}>
          {report.daily.map(day => <div className={"analytics-chart-column " + (day.day === report.today ? "is-today" : "")} key={day.day}><strong>{number(day.views)}</strong><div className="analytics-bar-space"><div className="analytics-bar" style={{ height: day.views ? Math.max(4, day.views / maxDay * 100) + "%" : "2px" }}/></div><span>{day.day.slice(5).replace("-", "/")}</span><small>{day.day === report.today ? "今天" : ""}</small></div>)}
        </div> : <div className="analytics-placeholder">{loading ? "正在加载趋势…" : "暂无可显示的统计数据"}</div>}
        {report?.totals.all === 0 && <p className="analytics-empty-note">统计已启用，尚未记录到公开页面浏览。历史访问不会补录，管理账号的浏览不计入。</p>}
      </section>
      <section className="analytics-panel"><div className="analytics-panel-heading"><div><h2>热门文章</h2><p>按资讯详情页浏览次数排序 · 最多展示10篇</p></div><div className="analytics-periods" aria-label="热门文章统计周期">{periods.map(item => <button key={item.key} aria-pressed={period === item.key} className={period === item.key ? "on" : ""} onClick={() => setPeriod(item.key)}>{item.label}</button>)}</div></div>
        {popular.length ? <div className="analytics-table-scroll"><table className="analytics-table"><thead><tr><th>排名</th><th>资讯标题</th><th>板块</th><th>浏览量</th></tr></thead><tbody>{popular.map((article, index) => <tr key={article.articleId}><td><span className={"analytics-rank " + (index < 3 ? "top" : "")}>{String(index + 1).padStart(2, "0")}</span></td><td><a href={articlePath(article.articleId)}>{article.title}<ArrowUpRight size={13}/></a></td><td>{article.category}</td><td><strong>{number(article.views)}</strong><span className="analytics-mini-bar"><i style={{ width: article.views / popular[0].views * 100 + "%" }}/></span></td></tr>)}</tbody></table></div> : <div className="analytics-placeholder"><FileText size={26}/><p>{loading && !report ? "正在加载热门文章…" : report ? "该时段暂无文章浏览记录" : "数据暂不可用"}</p><small>文章被公开访客打开后，会按浏览次数显示在这里。</small></div>}
      </section>
      <section className="analytics-method"><h2><ShieldCheck size={17}/>统计口径</h2><ul><li>按北京时间自然日汇总；近7天包含今天及此前6天，累计值从统计功能首次运行开始。</li><li>PV 为首页和资讯详情页的浏览次数，不等于访问人数。同一人重新打开或刷新页面可再次计数；首页搜索、筛选不额外计数。</li><li>不计入已登录管理账号的浏览、统计页面、API 请求及已识别的爬虫。统计在页面可见且脚本成功运行后提交，网络拦截或禁用脚本可能导致漏计。</li><li>仅保存页面路径、资讯编号、时间和用于去重的随机浏览编号；不保存访客姓名、邮箱、IP，不使用跨站跟踪或访客识别 Cookie。</li><li>启用前没有记录的历史访问无法补算；页面每分钟自动刷新，也可手动刷新。</li></ul>{report && <p className="analytics-breakdown">累计组成：首页 {number(report.totals.home)} 次 · 资讯详情 {number(report.totals.articles)} 次</p>}</section>
    </main><footer className="footer"><div className="analytics-wrap analytics-footer"><strong>合规前沿.</strong><span>访问数据仅供网站所有者查看</span><a href="/">返回资讯首页 <ArrowUpRight size={12}/></a></div></footer>
  </div>;
}
