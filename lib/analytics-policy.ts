const DAY_MS = 86_400_000;
const BEIJING_OFFSET_MS = 8 * 3_600_000;

export function beijingDay(date = new Date()): string {
  return new Date(date.getTime() + BEIJING_OFFSET_MS).toISOString().slice(0, 10);
}

export function analyticsDays(date = new Date()): string[] {
  return Array.from({ length: 7 }, (_, i) => beijingDay(new Date(date.getTime() - (6 - i) * DAY_MS)));
}

export function trackedPage(path: unknown): { path: string; articleId: string | null } | null {
  if (path === "/") return { path, articleId: null };
  if (typeof path !== "string") return null;
  const match = /^\/articles\/([a-zA-Z0-9_-]{1,100})$/.exec(path);
  return match ? { path, articleId: match[1] } : null;
}

export function validViewId(id: unknown): id is string {
  return typeof id === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id);
}

export function isLikelyBot(userAgent: string | null): boolean {
  return !userAgent || /bot\b|spider|crawler|headless|lighthouse|pagespeed|preview|facebookexternalhit|slurp|curl\/|wget\/|python-requests/i.test(userAgent);
}

export function allowedAnalyticsOrigin(url: string, origin: string | null, fetchSite: string | null): boolean {
  if (!origin || (fetchSite && fetchSite !== "same-origin")) return false;
  try { return new URL(url).origin === new URL(origin).origin; } catch { return false; }
}
