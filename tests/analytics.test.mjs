import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';

const root = path.resolve(import.meta.dirname, '..');
const sqlite = new DatabaseSync(':memory:');
for (const file of fs.readdirSync(path.join(root, 'drizzle')).filter(f => f.endsWith('.sql')).sort()) sqlite.exec(fs.readFileSync(path.join(root, 'drizzle', file), 'utf8'));
const d1 = {
  prepare(sql) {
    let values = [];
    const statement = sqlite.prepare(sql);
    return {
      bind(...args) { values = args; return this; },
      async first() { return statement.get(...values) ?? null; },
      async all() { return { results: statement.all(...values) }; },
      async run() { return { results: [], meta: statement.run(...values) }; },
      execute() { return statement.columns().length ? this.all() : this.run(); },
    };
  },
  async batch(statements) {
    sqlite.exec('BEGIN');
    try { const result = []; for (const statement of statements) result.push(await statement.execute()); sqlite.exec('COMMIT'); return result; }
    catch (error) { sqlite.exec('ROLLBACK'); throw error; }
  },
};
const seeds = JSON.parse(fs.readFileSync(path.join(root, 'lib/seed.json'), 'utf8'));
const owner = 'owner@example.test';
let instant = '2026-10-29T16:05:00.000Z';
class Clock extends Date { constructor(...args) { super(...(args.length ? args : [instant])); } static now() { return Date.parse(instant); } }
const cache = new Map();
function load(relative) {
  let file = path.resolve(root, relative);
  if (!path.extname(file)) file += '.ts';
  if (file.endsWith('.json')) return JSON.parse(fs.readFileSync(file, 'utf8'));
  if (cache.has(file)) return cache.get(file).exports;
  const module = { exports: {} }; cache.set(file, module);
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  const require = specifier => {
    if (specifier === 'cloudflare:workers') return { env: { DB: d1, SITE_EDITOR_EMAIL: owner } };
    if (specifier === './store') return { feed: async () => ({ articles: seeds }) };
    if (specifier.startsWith('.')) return load(path.relative(root, path.resolve(path.dirname(file), specifier)));
    throw new Error('Unexpected test dependency: ' + specifier);
  };
  vm.runInNewContext(code, { module, exports: module.exports, require, Date: Clock, Response, Request, URL, crypto, Set, Map, console }, { filename: file });
  return module.exports;
}
const policy = load('lib/analytics-policy.ts');
assert.equal(policy.beijingDay(new Date('2026-10-29T15:59:59Z')), '2026-10-29');
assert.equal(policy.beijingDay(new Date('2026-10-29T16:00:00Z')), '2026-10-30');
assert.equal(JSON.stringify(policy.analyticsDays(new Date('2027-01-01T00:00:00Z'))), JSON.stringify(['2026-12-26','2026-12-27','2026-12-28','2026-12-29','2026-12-30','2026-12-31','2027-01-01']));
for (const value of ['/admin/analytics', '/api/feed', '/?q=private', '/articles/x?secret=1', '/articles/../admin', '//external.test', null]) assert.equal(policy.trackedPage(value), null);
assert.equal(policy.trackedPage('/articles/news-1').articleId, 'news-1');
assert.equal(policy.allowedAnalyticsOrigin('https://news.test/api/analytics/pageview', null, null), false);
assert.equal(policy.allowedAnalyticsOrigin('https://news.test/api/analytics/pageview', 'https://attacker.test', 'same-origin'), false);
assert.equal(policy.allowedAnalyticsOrigin('https://news.test/api/analytics/pageview', 'https://news.test', 'cross-site'), false);
assert.equal(policy.allowedAnalyticsOrigin('https://news.test/api/analytics/pageview', 'https://news.test', 'same-origin'), true);
assert.equal(policy.isLikelyBot('Googlebot/2.1'), true);
assert.equal(policy.isLikelyBot('Mozilla/5.0 Chrome/140.0.0.0 Safari/537.36'), false);

const api = load('app/api/analytics/route.ts');
const tracker = load('app/api/analytics/pageview/route.ts');
const service = load('lib/analytics.ts');
const origin = 'https://news.test';
const auth = { 'oai-authenticated-user-id': 'owner-id', 'oai-authenticated-user-email': owner };
assert.equal((await api.GET(new Request(origin + '/api/analytics'))).status, 401);
assert.equal((await api.GET(new Request(origin + '/api/analytics', { headers: { ...auth, 'oai-authenticated-user-email': 'visitor@example.test' } }))).status, 403);
assert.equal(sqlite.prepare('SELECT count(*) AS n FROM analytics_state').get().n, 0, 'unauthorized reads do not initialize or reveal statistics');
let response = await api.GET(new Request(origin + '/api/analytics', { headers: auth }));
assert.equal(response.status, 200);
assert.match(response.headers.get('cache-control'), /private, no-store/);
assert.equal((await response.json()).totals.all, 0, 'first report honestly starts at zero');
function view(body, extra = {}, urlOrigin = origin) {
  return tracker.POST(new Request(origin + '/api/analytics/pageview', { method: 'POST', headers: { Origin: urlOrigin, 'Sec-Fetch-Site': 'same-origin', 'Content-Type': 'application/json', 'User-Agent': 'Mozilla/5.0 Chrome/140.0.0.0 Safari/537.36', ...extra }, body: JSON.stringify(body) }));
}
const id = crypto.randomUUID();
assert.equal((await view({ id, path: '/' }, auth)).status, 204);
assert.equal((await service.analyticsReport()).totals.all, 0, 'owner pageviews are excluded');
assert.equal((await view({ id, path: '/' }, { 'User-Agent': 'Googlebot/2.1' })).status, 204);
assert.equal((await view({ id, path: '/' }, {}, 'https://attacker.test')).status, 403);
assert.equal((await view({ id, path: '/admin/analytics' })).status, 400);
assert.equal((await view({ id: 'invalid', path: '/' })).status, 400);
assert.equal((await view({ id, path: '/articles/not-a-real-article' })).status, 404);
assert.equal((await view({ id, path: '/', ignored: 'x'.repeat(1100) })).status, 400);
assert.equal((await view({ id, path: '/' })).status, 204);
assert.equal((await view({ id, path: '/' })).status, 204);
assert.equal((await service.analyticsReport()).totals.all, 1, 'replayed request counts only once');
assert.equal((await view({ id: crypto.randomUUID(), path: '/articles/' + seeds[0].id })).status, 204);
instant = '2026-10-29T15:59:59.000Z';
await service.recordPageView(crypto.randomUUID(), '/articles/' + seeds[0].id, seeds[0].id);
instant = '2026-10-23T16:00:00.000Z';
await service.recordPageView(crypto.randomUUID(), '/articles/' + seeds[1].id, seeds[1].id);
instant = '2026-10-23T15:59:59.000Z';
await service.recordPageView(crypto.randomUUID(), '/articles/' + seeds[1].id, seeds[1].id);
instant = '2026-10-29T16:05:00.000Z';
const report = await service.analyticsReport();
assert.equal(report.today, '2026-10-30');
assert.equal(report.weekStart, '2026-10-24');
assert.equal(JSON.stringify(report.totals), JSON.stringify({ today: 2, week: 4, all: 5, home: 1, articles: 4 }));
assert.equal(report.daily.length, 7);
assert.equal(report.daily[0].views, 1);
assert.equal(report.daily[6].views, 2);
assert.equal(report.daily.reduce((sum, day) => sum + day.views, 0), report.totals.week);
assert.equal(report.popular.week[0].articleId, seeds[0].id);
assert.equal(report.popular.week[0].title, seeds[0].title);
assert.equal(report.popular.week[0].views, 2);
assert.equal(report.popular.today.length, 1);
assert.equal(report.popular.today[0].views, 1);
assert.deepEqual(sqlite.prepare('PRAGMA table_info(page_views)').all().map(c => c.name), ['id','day','path','article_id','created_at'], 'no visitor identity, IP or browsing queries are persisted');
sqlite.close();
console.log('PASS analytics: real SQLite migrations, Beijing midnight/year boundary, deduplication, owner/bot exclusion, origin checks, owner-only API, period totals and popular articles');
