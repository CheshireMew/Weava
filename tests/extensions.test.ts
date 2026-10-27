import { it, expect } from 'vitest';
import { mkdirSync, copyFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import cryptoExtension from '../scripts/crypto-extension.ts';
import { Site, renderDocument, renderBlocks } from '@weava/core';
it('honors theme switching and updates migrated SEO with the published revision', async () => {
  const site = new Site('D:/Tools/cache/weava/tests/theme-' + Date.now());
  try {
    const ext = await cryptoExtension({ site, apiVersion: 1, renderDocument, renderBlocks });
    const entry: any = {
      id: 'article',
      kind: 'content',
      title: '发布后的标题',
      description: '新的摘要',
      path: '/article/',
      blocks: [],
      indexable: true,
      publishedAt: '2020-01-01T00:00:00Z',
      modifiedAt: '2026-10-27T00:00:00Z',
      document: { version: 1, format: 'markdown', source: '新的正文' },
      compatibility: {
        article: true,
        head: '<title>旧标题</title><meta property="og:title" content="旧标题"><script type="application/ld+json">{"@type":"Article","headline":"旧标题"}</script>',
        shell: '<html><head>__WEAVA_HEAD__</head><body><main>__WEAVA_MAIN__</main></body></html>',
        main: '<h1>旧标题</h1><article class="article-body">旧正文</article>',
      },
    };
    const release: any = {
      id: 'release',
      entries: [entry],
      settings: {
        theme: 'crypto-blacknico',
        domain: 'https://example.com',
        name: '站点',
        navigation: [],
        extensions: {},
        themeConfig: { accent: '#315c4c', radius: 16, width: 1200 },
      },
    };
    const html = await ext.render(entry, release);
    expect(html).toContain('content="发布后的标题"');
    expect(html).toContain('"datePublished":"2020-01-01T00:00:00Z"');
    expect(html).toContain('新的正文');
    release.settings.theme = 'weava';
    expect(await ext.render(entry, release)).toBeNull();
  } finally {
    site.close();
  }
});
it('preserves feed and stock snapshots when every provider fails', async () => {
  const root = 'D:/Tools/cache/weava/tests/extensions-' + Date.now();
  mkdirSync(join(root, 'imports'), { recursive: true });
  const stock = {
    sources: {
      binance_stocks: {
        result: {
          listings: [
            {
              ticker: 'AAPL',
              name: 'Apple',
              asset_type: 'stock',
              market: 'US',
              offering: {
                source_id: 'binance_stocks',
                platform: 'binance',
                trading_type: 'spot',
                symbol: 'AAPL',
                url: 'https://www.binance.com/en/trade/stocks/AAPL',
              },
            },
          ],
          metadata: [],
          updated_at: new Date().toISOString(),
        },
      },
    },
  };
  writeFileSync(join(root, 'imports/equity-catalog.json'), JSON.stringify(stock));
  writeFileSync(
    join(root, 'imports/exchange-announcements.json'),
    JSON.stringify({
      feeds: [
        {
          id: 'binance-news',
          platform: 'binance',
          url: 'https://www.binance.com/',
          items: [{ id: 'one', title: '保留公告', url: 'https://www.binance.com/news/one' }],
          updatedAt: new Date().toISOString(),
        },
      ],
    }),
  );
  const site = new Site(root),
    original = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new Error('Controlled provider failure');
  };
  const ext = await cryptoExtension({ site, apiVersion: 1, renderDocument, renderBlocks });
  try {
    ext.start();
    await new Promise((r) => setTimeout(r, 100));
    const release: any = { settings: { extensions: { crypto: { config: {} } } }, entries: [] };
    const feeds = (await (await ext.route(
      new Request('http://localhost/api/announcements'),
      release,
    ))!.json()) as any;
    expect(feeds.feeds[0].items[0].title).toBe('保留公告');
    expect(feeds.feeds[0].status).toBe('cached');
    const stocks = (await (await ext.route(
      new Request('http://localhost/api/equities/catalog'),
      release,
    ))!.json()) as any;
    expect(stocks.items[0].ticker).toBe('AAPL');
    expect(stocks.items[0].platforms).toEqual(['binance']);
    expect(stocks.sources[0].status).toBe('stale');
  } finally {
    ext.stop();
    globalThis.fetch = original;
    site.close();
  }
});
