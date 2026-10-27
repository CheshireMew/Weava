import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { strict as assert } from 'node:assert';
const origin = 'http://127.0.0.1:4323';
const report: any = { checkedAt: new Date().toISOString() };
const feeds = (await (await fetch(origin + '/api/announcements')).json()) as any;
assert.equal(feeds.feeds.length, 4);
report.feeds = feeds.feeds.map((f: any) => ({
  id: f.id,
  status: f.status,
  count: f.items.length,
  updatedAt: f.updatedAt,
}));
const stocks = (await (await fetch(origin + '/api/equities/catalog')).json()) as any;
assert(stocks.items.length > 0);
assert(
  stocks.items.every(
    (i: any) => Array.isArray(i.platforms) && Array.isArray(i.trading_types) && i.offerings.length,
  ),
);
assert(!stocks.items.some((i: any) => i.ticker === 'GLD'));
report.stocks = { count: stocks.items.length, sources: stocks.sources };
const sources = JSON.parse(
  readFileSync('E:/Code/WeavaSites/crypto-blacknico/imports/video-sources.json', 'utf8'),
).videos;
const key = Object.keys(sources)[0];
const video = await fetch(origin + '/video/' + key, {
  redirect: 'manual',
  signal: AbortSignal.timeout(35000),
});
report.video = {
  key,
  status: video.status,
  redirectHost: video.headers.get('location')
    ? new URL(video.headers.get('location')!).hostname
    : null,
};
assert([302, 502].includes(video.status));
if (video.status === 302)
  assert(
    report.video.redirectHost.includes('notion') || report.video.redirectHost.includes('amazonaws'),
  );
const search = (await (
  await fetch(origin + '/api/v1/search?q=' + encodeURIComponent('钱包'))
).json()) as any[];
assert(search.length > 0);
report.search = { query: '钱包', results: search.length };
const before = await (await fetch(origin + '/__health')).json();
report.runtime = before;
mkdirSync('D:/Tools/cache/weava/acceptance', { recursive: true });
writeFileSync('D:/Tools/cache/weava/acceptance/services.json', JSON.stringify(report, null, 2));
console.log(JSON.stringify(report));
