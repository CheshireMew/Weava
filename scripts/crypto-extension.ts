/** Migration adapter template. All account-specific settings/data remain in the private site instance. */
import { load } from 'cheerio';
import { readFileSync, existsSync, writeFileSync, renameSync, mkdirSync } from 'node:fs';
import { join, resolve, extname } from 'node:path';
export default async function ({ site, apiVersion, renderDocument, renderBlocks, analytics }: any) {
  const read = (name: string, fallback: any = {}) => {
    const file = join(site.root, 'imports', name);
    return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : fallback;
  };
  const runtimeDir = join(site.root, 'extensions/state');
  mkdirSync(runtimeDir, { recursive: true });
  const videoSources = read('video-sources.json').videos ?? {};
  const initialFeeds = read('exchange-announcements.json');
  const initialStocks = read('equity-catalog.json');
  const live = (name: string, seed: any) => {
    const file = join(runtimeDir, name);
    return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : seed;
  };
  let feeds = live('announcements.json', initialFeeds),
    stocks = live('stocks.json', initialStocks),
    refreshing = false;
  const write = (name: string, data: any) => {
    const file = join(runtimeDir, name);
    writeFileSync(file + '.pending', JSON.stringify(data));
    renameSync(file + '.pending', file);
  };
  const escape = (v: any) =>
    String(v ?? '').replace(
      /[&<>"']/g,
      (c) => (({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }) as any)[c],
    );
  function normalize(input: string, config: any, equity = false) {
    let u: URL;
    try {
      u = new URL(input);
    } catch {
      return input;
    }
    const host = u.hostname.replace(/^www\./, '');
    let provider =
      host === 'binance.com'
        ? 'binance'
        : host === 'okx.com'
          ? 'okx'
          : host === 'bitget.com'
            ? 'bitget'
            : host === 'web3.binance.com'
              ? 'binance-web3'
              : host === 'web3.okx.com'
                ? 'okx-web3'
                : null;
    if (!provider) return input;
    if (!equity && /\/(web3|wallet|web3-wallet)(\/|$)/i.test(u.pathname) && provider === 'okx')
      provider = 'okx-web3';
    const entry = config.referrals?.[provider];
    if (!entry) return input;
    if (/\/(join|register|registration|signup|referral|joindex)(\/|$)/i.test(u.pathname))
      return entry.url;
    const key =
      provider === 'bitget' ? 'clacCode' : equity && provider === 'okx' ? 'channelId' : 'ref';
    if (!u.pathname.startsWith('/api/') && !u.pathname.startsWith('/bapi/')) {
      u.searchParams.delete('ref');
      u.searchParams.set(key, entry.code);
    }
    return u.href;
  }
  function configFor(release: any) {
    return release?.settings.extensions.crypto?.config ?? {};
  }
  const response = (value: any, status = 200) =>
    new Response(JSON.stringify(value), {
      status,
      headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
    });
  const json = async (url: string) => {
    const result = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0', 'Accept-Language': 'zh-CN,zh;q=0.9' },
      signal: AbortSignal.timeout(25000),
    });
    if (!result.ok) throw new Error('HTTP ' + result.status);
    return result.json() as Promise<any>;
  };
  const aliases: Record<string, string> = {
    BRKB: 'BRK.B',
    'BRK-B': 'BRK.B',
    'BRK/B': 'BRK.B',
    BRKA: 'BRK.A',
    'BRK-A': 'BRK.A',
    STXSTOCK: 'STX',
    QNTX: 'QNT',
    HK1810: 'XIAOMI',
    HK0700: 'TENCENT',
  };
  const ticker = (v: string) => {
    const key = String(v).toUpperCase().replace(/^EQ_/, '').replace(/\.US$/, '');
    return aliases[key] ?? key;
  };
  async function getStocks(sourceId: string) {
    const rows: any[] = [];
    const add = (
      symbol: string,
      name: string,
      platform: string,
      trading_type: string,
      product: string,
      quote: string,
      url: string,
      status: string,
      asset_type = 'unknown',
      market = 'US',
      logo_url: any = null,
    ) =>
      rows.push({
        ticker: ticker(symbol),
        name,
        asset_type,
        market,
        logo_url,
        offering: {
          source_id: sourceId,
          platform,
          trading_type,
          product,
          symbol,
          quote,
          status,
          url,
        },
      });
    if (sourceId === 'binance_stocks') {
      const [a, b] = await Promise.all([
        json('https://www.binance.com/bapi/equity/v2/public/equity/symbol/get-exchange-info'),
        json('https://www.binance.com/bapi/equity/v1/public/equity/symbol/get-symbols-static'),
      ]);
      const names = new Map((b.data ?? []).map((r: any) => [r.s, r]));
      for (const r of a.data?.syms ?? []) {
        const n: any = names.get(r.s);
        if (['BUY_SELL', 'BUY', 'SELL'].includes(r.tr))
          add(
            r.s,
            n?.n ?? r.s,
            'binance',
            'spot',
            'Stocks',
            'USD',
            'https://www.binance.com/en/trade/stocks/' + r.s,
            r.tr,
            n?.t === 'ETF' ? 'etf' : n?.t === 'STOCK' ? 'stock' : 'unknown',
            'US',
            n?.l ? new URL(n.l, 'https://bin.bnbstatic.com/static/stock/').href : null,
          );
      }
    } else if (sourceId === 'binance_bstocks') {
      const d = await json(
        'https://www.binance.com/bapi/asset/v2/public/asset-service/product/get-products?includeEtf=true',
      );
      for (const r of d.data ?? [])
        if (
          r.tags?.includes('bStocks') &&
          ['TRADING', 'HALT', 'BREAK'].includes(r.st) &&
          r.b?.endsWith('B')
        ) {
          add(
            r.b.slice(0, -1),
            r.an ?? r.b,
            'binance',
            'spot',
            'bStocks',
            r.q,
            'https://www.binance.com/en/trade/' + r.b + '_' + r.q,
            r.st,
          );
          rows.at(-1).offering.symbol = r.s;
        }
    } else if (sourceId === 'binance_alpha') {
      const d = await json(
        'https://www.binance.com/bapi/defi/v1/public/wallet-direct/buw/wallet/cex/alpha/all/token/list',
      );
      for (const r of d.data ?? [])
        if (r.stockState && !r.offline && !r.fullyDelisted && !r.cexOffDisplay) {
          const t = r.rwaInfo?.metaInfo?.ticker;
          if (!t) throw new Error('股票标识缺失');
          add(
            t,
            r.name ?? t,
            'binance',
            'spot',
            'Alpha · Ondo',
            'USDT',
            `https://www.binance.com/en/alpha/${r.chainId}/${r.contractAddress}`,
            r.offsell ? 'sell_only' : 'trading',
            'unknown',
            'US',
            r.iconUrl,
          );
          rows.at(-1).offering.symbol = r.symbol;
        }
    } else if (sourceId === 'binance_perpetual') {
      const d = await json('https://fapi.binance.com/fapi/v1/exchangeInfo');
      for (const r of d.symbols ?? [])
        if (
          (r.underlyingType?.includes('EQUITY') || r.underlyingType === 'PREMARKET') &&
          ['TRADIFI_PERPETUAL', 'PERPETUAL'].includes(r.contractType) &&
          ['TRADING', 'HALT', 'BREAK'].includes(r.status)
        ) {
          const t = ({ STXX: 'STX', BBX: 'BB', USDEX: 'USDE' } as any)[r.baseAsset] ?? r.baseAsset;
          add(
            t,
            t,
            'binance',
            'perpetual',
            'Futures',
            r.quoteAsset,
            'https://www.binance.com/en/futures/' + r.symbol,
            r.status,
            'unknown',
            ({ KR_EQUITY: 'KR', HK_EQUITY: 'HK', CN_EQUITY: 'CN' } as any)[r.underlyingType] ??
              'US',
          );
          rows.at(-1).offering.symbol = r.symbol;
        }
    } else if (sourceId.startsWith('okx_')) {
      const spot = sourceId === 'okx_spot',
        d = await json(
          'https://www.okx.com/api/v5/public/instruments?instType=' + (spot ? 'SPOT' : 'SWAP'),
        );
      for (const r of d.data ?? [])
        if (r.instCategory === '3' && ['live', 'suspend'].includes(r.state)) {
          const base = spot ? r.baseCcy : r.ctValCcy;
          if (!base) throw new Error('股票标识缺失');
          add(
            spot && base.startsWith('X') ? base.slice(1) : base,
            base,
            'okx',
            spot ? 'spot' : 'perpetual',
            spot ? 'Unified Tokenized Stocks' : 'Stock Perpetuals',
            r.quoteCcy ?? r.settleCcy,
            'https://www.okx.com/trade-' + (spot ? 'spot' : 'swap') + '/' + r.instId.toLowerCase(),
            r.state,
          );
          rows.at(-1).offering.symbol = r.instId;
        }
    } else if (sourceId === 'bitget_stockplus') throw new Error('完整 Stock+ 目录尚未确认');
    else if (sourceId.startsWith('bitget_')) {
      const spot = sourceId === 'bitget_spot';
      for (const category of spot ? ['SPOT'] : ['USDT-FUTURES', 'USDC-FUTURES', 'COIN-FUTURES']) {
        const d = await json(
          'https://api.bitget.com/api/v3/market/instruments?category=' + category,
        );
        for (const r of d.data ?? [])
          if (
            (r.symbolType === 'stock' || r.isReality === 'yes') &&
            ['online', 'suspend', 'restrictedAPI'].includes(r.status) &&
            !(!spot && r.type !== 'perpetual')
          ) {
            const b = r.baseCoin ?? '';
            const t =
              r.isReality === 'yes'
                ? b.slice(1)
                : b.toUpperCase().endsWith('ON')
                  ? b.slice(0, -2)
                  : spot && b.toUpperCase().endsWith('X')
                    ? b.slice(0, -1)
                    : b;
            add(
              t,
              r.fullName ?? t,
              'bitget',
              spot ? 'spot' : 'perpetual',
              r.isReality === 'yes'
                ? 'Reality'
                : b.endsWith('ON')
                  ? 'Ondo'
                  : spot
                    ? 'Stocks'
                    : 'Stock Perpetuals',
              r.quoteCoin,
              'https://www.bitget.com/' + (spot ? 'spot/' : 'futures/usdt/') + r.symbol,
              r.status,
              r.instrumentType ?? 'unknown',
              r.marketRegion ?? 'US',
            );
            rows.at(-1).offering.symbol = r.symbol;
          }
      }
    }
    if (!rows.length) throw new Error('目录为空');
    return rows;
  }
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
  function stockPublic(release: any) {
    const config = configFor(release);
    if (Array.isArray(stocks.items)) return stocks;
    const grouped = new Map<string, any>();
    const metadata = new Map<string, any>();
    const sourceRows: any[] = [];
    for (const [id, saved] of Object.entries<any>(stocks.sources ?? {})) {
      for (const m of saved.result?.metadata ?? []) metadata.set(ticker(m.ticker), m);
      sourceRows.push({
        id,
        platform: id.split('_')[0],
        label: id.replaceAll('_', ' '),
        trading_type: id.includes('perpetual') ? 'perpetual' : 'spot',
        count: saved.result?.listings?.length ?? 0,
        status: !saved.result ? 'unavailable' : saved.error ? 'stale' : 'ok',
        updated_at: saved.result?.updated_at,
      });
    }
    const previous = read('public-stock-snapshot.json', { items: [] });
    const prior = new Map<string, any>((previous.items ?? []).map((i: any) => [i.ticker, i]));
    const rules = read('equity-rules.json'),
      excluded = new Set(rules.excluded ?? []),
      namePattern = new RegExp(rules.namePattern ?? 'a^', 'i');
    for (const saved of Object.values<any>(stocks.sources ?? {}))
      for (const row of saved.result?.listings ?? []) {
        const t = ticker(row.ticker);
        const meta = metadata.get(t) ?? {},
          old = prior.get(t),
          name = meta.name ?? row.name ?? t,
          kind = meta.asset_type ?? row.asset_type ?? 'unknown';
        if (
          excluded.has(t) ||
          /^(TESTA|TEST|XTESTA)$/.test(t) ||
          (['etf', 'unknown'].includes(kind) && namePattern.test(name))
        )
          continue;
        let item = grouped.get(t);
        if (!item) {
          item = {
            ...old,
            ticker: t,
            name,
            name_zh: rules.chinese?.[t] ?? old?.name_zh ?? '',
            market: rules.markets?.[t] ?? old?.market ?? row.market ?? 'US',
            asset_type: kind,
            logo_url: rules.logos?.[t] ?? old?.logo_url ?? meta.logo_url ?? row.logo_url,
            offerings: [],
          };
          grouped.set(t, item);
        }
        const offering = { ...row.offering, url: normalize(row.offering.url, config, true) };
        if (
          !item.offerings.some(
            (o: any) => o.source_id === offering.source_id && o.symbol === offering.symbol,
          )
        )
          item.offerings.push(offering);
      }
    for (const item of grouped.values()) {
      item.platforms = [...new Set(item.offerings.map((o: any) => o.platform))].sort();
      item.trading_types = [...new Set(item.offerings.map((o: any) => o.trading_type))].sort();
      item.offerings.sort((a: any, b: any) =>
        (a.platform + a.trading_type + a.product + a.symbol).localeCompare(
          b.platform + b.trading_type + b.product + b.symbol,
        ),
      );
    }
    return {
      items: [...grouped.values()].sort(
        (a, b) => b.platforms.length - a.platforms.length || a.ticker.localeCompare(b.ticker),
      ),
      sources: sourceRows,
      complete: sourceRows.every((s) => s.status === 'ok'),
      refresh_seconds: 300,
      updated_at: stocks.checked_at,
    };
  }
  const mime: Record<string, string> = {
    '.css': 'text/css',
    '.js': 'text/javascript',
    '.json': 'application/json',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.webp': 'image/webp',
    '.jpg': 'image/jpeg',
    '.xml': 'application/xml',
    '.txt': 'text/plain',
  };
  const videoCache = new Map<string, { url: string; until: number }>();
  let timer: ReturnType<typeof setInterval> | undefined;
  return {
    id: 'crypto-blacknico',
    apiVersion: 1,
    themes: [{ id: 'crypto-blacknico', label: 'BlackNico' }],
    panels: [
      {
        id: 'crypto',
        label: '平台与邀请设置',
        fields: [
          {
            key: 'config',
            label: '网站业务配置',
            type: 'group',
            fields: [
              {
                key: 'referrals',
                label: '各平台入口',
                type: 'group',
                fields: ['binance', 'okx', 'bitget', 'binance-web3', 'okx-web3'].map((id) => ({
                  key: id,
                  label: id,
                  type: 'group',
                  fields: [
                    { key: 'url', label: '邀请网址', type: 'text' },
                    { key: 'code', label: '邀请码', type: 'text' },
                  ],
                })),
              },
            ],
          },
        ],
      },
    ],
    start() {
      timer = setInterval(() => refresh(), 300000);
      timer.unref();
      refresh();
    },
    stop() {
      if (timer) clearInterval(timer);
    },
    async render(entry: any, release: any) {
      if (release.settings.theme !== 'crypto-blacknico') return null;
      let c = entry.compatibility;
      if (!c?.shell) {
        const base = release.entries.find((v: any) => v.path === '/')?.compatibility;
        if (!base) return null;
        c = {
          ...base,
          article: false,
          main: `<section class="page-heading wrap"><h1>${escape(entry.title)}</h1><p>${escape(entry.description)}</p></section><section class="wrap"><article class="article-body">${entry.kind === 'content' ? renderDocument(entry.document) : renderBlocks(entry.blocks, release, entry)}</article></section>`,
        };
      }
      const $ = load('<main>' + c.main + '</main>');
      if (entry.kind === 'page' && entry.blocks?.length)
        $('main').html(renderBlocks(entry.blocks, release, entry));
      const publicMap = new Map(release.entries.map((v: any) => [v.path, v]));
      if (c.article) {
        const target = $('article.article-body').first();
        if (target.length) {
          const body = renderDocument(entry.document);
          target.html(body);
        }
        $('h1').first().text(entry.title);
        $('.article-deck,.article-description').first().text(entry.description);
      }
      $('a[href^="/"]').each((_i, el) => {
        const a = $(el),
          href = a.attr('href')?.split(/[?#]/)[0] ?? '';
        const item: any = publicMap.get(href);
        if (item) {
          if (a.parent().is('h2,h3')) a.text(item.title);
          a.find('h2,h3').first().text(item.title);
          a.closest('.content-card').attr('data-title', item.title);
          if (a.hasClass('content-card') || a.hasClass('article-card'))
            a.find('p').first().text(item.description);
        } else if (/^\/(guides|learn)\/[^/]+\/$/.test(href)) {
          if (a.closest('.content-card,.article-card').length)
            a.closest('.content-card,.article-card').remove();
        }
      });
      const config = configFor(release);
      $('a[href^="http"]').each((_i, el) => {
        const a = $(el);
        a.attr('href', normalize(a.attr('href')!, config));
      });
      let head = c.head
        .replace(
          /<title>[\s\S]*?<\/title>/i,
          `<title>${escape(entry.title)} · ${escape(release.settings.name)}</title>`,
        )
        .replace(
          /<meta name="description" content="[^"]*"\s*\/?>/i,
          `<meta name="description" content="${escape(entry.description)}">`,
        );
      head = head.replace(
        /<link rel="canonical" href="[^"]*"\s*\/?>/i,
        `<link rel="canonical" href="${escape(release.settings.domain + entry.path)}">`,
      );
      let result = c.shell
        .replace('__WEAVA_HEAD__', head)
        .replace('__WEAVA_MAIN__', $('main').html() ?? '');
      const doc = load(result);
      const nav = doc('#main-nav');
      if (nav.length)
        nav.html(
          release.settings.navigation
            .map((n: any) => `<a href="${escape(n.url)}">${escape(n.label)}</a>`)
            .join(''),
        );
      doc('body').attr('data-release', release.id);
      const theme = release.settings.themeConfig;
      doc('head').append(
        `<style>:root{--green:${escape(theme.accent)};--paper:${escape(theme.background ?? '#f6f8f3')};--radius:${Number(theme.radius)}px;--max:${Number(theme.width)}px;--weava-space:${Number(theme.spacing ?? 24)}px;font-family:${escape(theme.font ?? 'system-ui,sans-serif')}}.card-grid,.article-cards{gap:var(--weava-space)}</style>`,
      );
      if (release.settings.logo)
        doc('.brand-mark').replaceWith(
          `<img src="${escape(release.settings.logo)}" alt="" width="38" height="38">`,
        );
      doc('meta[property="og:title"],meta[name="twitter:title"]').attr('content', entry.title);
      doc('meta[property="og:description"],meta[name="twitter:description"]').attr(
        'content',
        entry.description,
      );
      doc('meta[property="og:url"]').attr('content', release.settings.domain + entry.path);
      if (entry.cover)
        doc('meta[property="og:image"],meta[name="twitter:image"]').attr(
          'content',
          new URL(entry.cover, release.settings.domain).href,
        );
      doc('meta[name="robots"]').attr(
        'content',
        entry.indexable ? 'index, follow' : 'noindex, follow',
      );
      doc('script[type="application/ld+json"]').each((_i, el) => {
        try {
          const data = JSON.parse(doc(el).text());
          const update = (value: any) => {
            if (!value || typeof value !== 'object') return;
            if (Array.isArray(value)) {
              value.forEach(update);
              return;
            }
            if (['Article', 'BlogPosting', 'WebPage'].includes(value['@type']))
              Object.assign(value, {
                headline: entry.title,
                name: entry.title,
                description: entry.description,
                url: release.settings.domain + entry.path,
                ...(entry.publishedAt ? { datePublished: entry.publishedAt } : {}),
                ...(entry.modifiedAt ? { dateModified: entry.modifiedAt } : {}),
              });
            if (value['@graph']) update(value['@graph']);
          };
          update(data);
          doc(el).text(JSON.stringify(data).replaceAll('<', '\\u003c'));
        } catch {}
      });
      return doc.html();
    },
    async route(request: Request, release: any) {
      const url = new URL(request.url),
        path = url.pathname;
      if (path === '/analytics/collect' && request.method === 'POST') {
        const payload: any = await request.json(),
          catalog = JSON.parse(
            readFileSync(join(site.root, 'themes/crypto/analytics-catalog.json'), 'utf8'),
          );
        const events = (payload.events ?? []).map((event: any) => {
          const link = catalog.articles?.[event.path]?.links?.[event.link] ?? {};
          return {
            ...event,
            kind: event.type,
            ts: new Date(event.ts).toISOString(),
            url: link.url ?? '',
            label: link.label ?? '',
            zone: link.zone ?? '',
            releaseId: release.id,
          };
        });
        analytics.collect(
          events,
          request.headers.get('user-agent') ?? '',
          new Set(release.entries.filter((e: any) => e.kind === 'content').map((e: any) => e.path)),
        );
        return response({ accepted: events.map((e: any) => e.id), rejected: [] });
      }
      if (path === '/search-index.json')
        return response(
          release.entries
            .filter((e: any) => e.kind === 'content')
            .map((e: any, i: number) => ({
              id: e.id,
              title: e.title,
              url: e.path,
              category: e.categories[0] ?? '',
              categoryName: e.categories[0] ?? '',
              kind: e.fields.kind ?? 'article',
              cover: e.cover,
              thumb: e.cover,
              text: load(e.html ?? '').text(),
              description: e.description,
              readMinutes: e.fields.readMinutes ?? 2,
              platform: e.fields.platform ?? 'general',
              service: e.fields.service ?? '',
              order: i,
            })),
        );
      if (path === '/api/announcements') {
        const d = structuredClone(feeds);
        for (const feed of d.feeds ?? []) {
          feed.stale = !!feed.error || Date.now() - Date.parse(feed.updatedAt ?? '') > 1800000;
          feed.status = !feed.items?.length ? 'unavailable' : feed.stale ? 'cached' : 'current';
          feed.url = normalize(feed.url, configFor(release));
          for (const item of feed.items ?? []) item.url = normalize(item.url, configFor(release));
          delete feed.error;
        }
        return response(d);
      }
      if (path === '/api/equities/catalog' || path === '/equity-catalog.json')
        return response(stockPublic(release));
      if (path.startsWith('/video/')) {
        const key = decodeURIComponent(path.slice(7)),
          item = videoSources[key];
        if (!item) return response({ error: '视频不存在。' }, 404);
        try {
          let cached = videoCache.get(key);
          if (!cached || cached.until < Date.now() || url.searchParams.has('refresh')) {
            const base =
              item.platform === 'binance' ? 'https://app.notion.com' : 'https://www.notion.so';
            const res = await fetch(base + '/api/v3/getSignedFileUrls', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                urls: [
                  { url: item.fileLocator, permissionRecord: { table: 'block', id: item.blockId } },
                ],
              }),
              signal: AbortSignal.timeout(25000),
            });
            if (!res.ok) throw new Error('来源请求失败');
            const data: any = await res.json(),
              destination = new URL(data.signedUrls?.[0]);
            if (
              destination.protocol !== 'https:' ||
              ![
                'file.notion.com',
                'file.notion.so',
                'prod-files-secure.s3.us-west-2.amazonaws.com',
                's3.us-west-2.amazonaws.com',
              ].includes(destination.hostname)
            )
              throw new Error('来源地址无效');
            const expiration = Number(destination.searchParams.get('expirationTimestamp'));
            const expiry = expiration
              ? (expiration > 1e11 ? expiration : expiration * 1000) - 120000
              : Date.now() + 600000;
            cached = { url: destination.href, until: Math.min(Date.now() + 600000, expiry) };
            if (cached.until < Date.now()) throw new Error('来源地址已过期');
            videoCache.set(key, cached);
          }
          return new Response(null, {
            status: 302,
            headers: { Location: cached.url, 'Cache-Control': 'no-store' },
          });
        } catch {
          return response({ error: '原站视频暂时无法加载，请重试或打开原页面。' }, 502);
        }
      }
      if (['/sitemap.xml', '/rss.xml', '/robots.txt'].includes(path)) return null;
      const theme = join(site.root, 'themes/crypto'),
        file = resolve(theme, '.' + decodeURIComponent(path));
      if (file.startsWith(theme) && existsSync(file) && !path.endsWith('/')) {
        try {
          return new Response(readFileSync(file), {
            headers: {
              'Content-Type': mime[extname(file)] ?? 'application/octet-stream',
              'Cache-Control': path.endsWith('.json') ? 'no-cache' : 'public, max-age=3600',
            },
          });
        } catch {}
      }
      return null;
    },
  };
}
