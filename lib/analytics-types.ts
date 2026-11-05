export type PopularArticle = { articleId: string; title: string; category: string; views: number };
export type AnalyticsReport = {
  startedAt: string;
  generatedAt: string;
  today: string;
  weekStart: string;
  totals: { today: number; week: number; all: number; home: number; articles: number };
  daily: { day: string; views: number; articleViews: number }[];
  popular: { today: PopularArticle[]; week: PopularArticle[]; all: PopularArticle[] };
};
