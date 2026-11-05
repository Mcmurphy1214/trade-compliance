import { env } from "cloudflare:workers";
import { analyticsDays, beijingDay } from "./analytics-policy";
import { feed } from "./store";
import type { AnalyticsReport, PopularArticle } from "./analytics-types";

async function initializeAnalytics(now: string) {
  await env.DB!.prepare("INSERT OR IGNORE INTO analytics_state(id,started_at) VALUES('page_views',?)").bind(now).run();
}

export async function recordPageView(id: string, path: string, articleId: string | null) {
  const now = new Date();
  await env.DB!.batch([
    env.DB!.prepare("INSERT OR IGNORE INTO analytics_state(id,started_at) VALUES('page_views',?)").bind(now.toISOString()),
    env.DB!.prepare("INSERT OR IGNORE INTO page_views(id,day,path,article_id,created_at) VALUES(?,?,?,?,?)")
      .bind(id, beijingDay(now), path, articleId, now.toISOString()),
  ]);
}

export async function analyticsReport(): Promise<AnalyticsReport> {
  const now = new Date();
  const days = analyticsDays(now);
  const today = days[6];
  const weekStart = days[0];
  await initializeAnalytics(now.toISOString());
  const results = await env.DB!.batch([
    env.DB!.prepare("SELECT started_at FROM analytics_state WHERE id='page_views'"),
    env.DB!.prepare("SELECT COUNT(*) AS all_views, COALESCE(SUM(day=?),0) AS today_views, COALESCE(SUM(day>=? AND day<=?),0) AS week_views, COALESCE(SUM(article_id IS NULL),0) AS home_views, COALESCE(SUM(article_id IS NOT NULL),0) AS article_views FROM page_views").bind(today, weekStart, today),
    env.DB!.prepare("SELECT day,COUNT(*) AS views,COALESCE(SUM(article_id IS NOT NULL),0) AS article_views FROM page_views WHERE day>=? AND day<=? GROUP BY day ORDER BY day").bind(weekStart, today),
    env.DB!.prepare("SELECT article_id,COUNT(*) AS views FROM page_views WHERE article_id IS NOT NULL AND day=? GROUP BY article_id ORDER BY views DESC,article_id LIMIT 10").bind(today),
    env.DB!.prepare("SELECT article_id,COUNT(*) AS views FROM page_views WHERE article_id IS NOT NULL AND day>=? AND day<=? GROUP BY article_id ORDER BY views DESC,article_id LIMIT 10").bind(weekStart, today),
    env.DB!.prepare("SELECT article_id,COUNT(*) AS views FROM page_views WHERE article_id IS NOT NULL GROUP BY article_id ORDER BY views DESC,article_id LIMIT 10"),
  ]);
  const state = results[0].results[0] as { started_at: string };
  const total = results[1].results[0] as Record<string, number>;
  const daily = results[2].results as { day: string; views: number; article_views: number }[];
  const data = await feed();
  const articles = new Map(data.articles.map(a => [a.id, a]));
  const popular = (rows: unknown[]): PopularArticle[] => (rows as { article_id: string; views: number }[]).map(row => {
    const article = articles.get(row.article_id);
    return { articleId: row.article_id, title: article?.title ?? "已归档资讯（" + row.article_id + "）", category: article?.category ?? "已归档", views: Number(row.views) };
  });
  return {
    startedAt: state.started_at, generatedAt: now.toISOString(), today, weekStart,
    totals: { today: Number(total.today_views), week: Number(total.week_views), all: Number(total.all_views), home: Number(total.home_views), articles: Number(total.article_views) },
    daily: days.map(day => { const row = daily.find(item => item.day === day); return { day, views: Number(row?.views ?? 0), articleViews: Number(row?.article_views ?? 0) }; }),
    popular: { today: popular(results[3].results), week: popular(results[4].results), all: popular(results[5].results) },
  };
}
