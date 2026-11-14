import { load } from 'cheerio';
import type { CryptoState } from './state.ts';
import { json } from './http.ts';
import { getStocks } from './equity-sources.ts';
export function sourceRefresher(state: CryptoState) {
  const { feeds, stocks, write } = state;
  let refreshing = false;
  async function refresh() {
    if (refreshing) return;
    refreshing = true;
    try {
      await Promise.allSettled(
        (feeds.feeds ?? []).map(async (feed: any) => {
          try {
            let items: any[] = [];
            if (feed.platform === 'binance') {
              const id = feed.id === 'binance-news' ? 49 : 93;
              const d = await json(
                `https://www.binance.com/bapi/composite/v1/public/cms/article/list/query?type=1&pageNo=1&pageSize=20&catalogId=${id}`,
              );
              const rows = d.data?.catalogs?.find((c: any) => c.catalogId === id)?.articles;
              if (!rows?.length) throw new Error('栏目为空');
              items = rows.map((r: any) => ({
                id: r.code,
                title: r.title,
                url: 'https://www.binance.com/zh-CN/support/announcement/detail/' + r.code,
                publishedAt: new Date(r.releaseDate).toISOString(),
                date: new Date(r.releaseDate).toISOString().slice(0, 10),
              }));
            } else {
              const html = await (
                await fetch(feed.url, { signal: AbortSignal.timeout(25000) })
              ).text();
              const $ = load(html),
                state = JSON.parse($('#appState').text());
              const rows = state.appContext.initialProps.sectionData.articleList.list;
              if (!rows?.length) throw new Error('栏目为空');
              items = rows.map((r: any) => ({
                id: r.slug,
                title: r.title,
                url: 'https://www.okx.com/zh-hans/help/' + r.slug,
                publishedAt: new Date(r.publishTime).toISOString(),
                date: new Date(r.publishTime).toISOString().slice(0, 10),
              }));
            }
            Object.assign(feed, {
              items,
              updatedAt: new Date().toISOString(),
              checkedAt: new Date().toISOString(),
              error: null,
            });
          } catch (error: any) {
            feed.checkedAt = new Date().toISOString();
            feed.error = error.message;
          }
        }),
      );
      write('announcements.json', feeds);
      const ids = Array.isArray(stocks.sources)
        ? stocks.sources.map((s: any) => s.id)
        : Object.keys(stocks.sources ?? {});
      if (!Array.isArray(stocks.sources)) {
        await Promise.allSettled(
          ids.map(async (id: string) => {
            const item = stocks.sources[id];
            try {
              const rows = await getStocks(id);
              item.result = {
                ...(item.result ?? {}),
                listings: rows,
                updated_at: new Date().toISOString(),
              };
              item.error = null;
              item.checked_at = new Date().toISOString();
            } catch (error: any) {
              item.error = error.message;
              item.checked_at = new Date().toISOString();
            }
          }),
        );
        stocks.checked_at = new Date().toISOString();
        write('stocks.json', stocks);
      }
    } finally {
      refreshing = false;
    }
  }
  return refresh;
}
