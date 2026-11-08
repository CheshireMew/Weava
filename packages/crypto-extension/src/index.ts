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
    mkdirSync(runtimeDir, { recursive: true });
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
      const sourceMeta=read('public-stock-snapshot.json',{sources:[]}).sources?.find((row:any)=>row.id===id)??{};
      sourceRows.push({
        ...sourceMeta,
        id,
        platform: id.split('_')[0],
        label: sourceMeta.label ?? id.replaceAll('_', ' '),
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
  const providerLabels:Record<string,string>={binance:'币安',okx:'OKX',bitget:'Bitget','binance-web3':'币安 Web3 钱包','okx-web3':'OKX Web3 钱包'};
  const videoCache = new Map<string, { url: string; until: number }>();
  return {
    id: 'crypto-blacknico',
    apiVersion: 1,
    version: '1.0.0', label: 'Crypto 数据服务', migrationFiles: [],
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
                  label: providerLabels[id] ?? id,
                  type: 'group',
                  fields: [
                    { key: 'url', label: '邀请网址', type: 'text' },
                    { key: 'code', label: '邀请码', type: 'text' },
                    ...(id==='binance'?[{key:'futuresCode',label:'合约邀请码',type:'text'}]:[]),
                  ],
                })),
              },
            ],
          },
        ],
      },
    ],
    schedules: [{ id: 'refresh-sources', intervalMs: 300000, run: refresh }],
    async start() { await refresh(); },

    blocks: {
      'crypto-blacknico:stocks': (_block:any, release:any) => {
        const file=join(site.root,'extensions/templates/stocks.html');
        if(!existsSync(file))return '<p>股票目录尚未配置。</p>';
        const $=load(readFileSync(file,'utf8'),null,false), data=stockPublic(release);
        $('#eq-count').text('共 '+(data.items?.length??0)+' 个标的');
        $('#eq-list').html((data.items??[]).slice(0,50).map((item:any)=>'<details class="eq-stock"><summary><strong>'+escape(item.ticker)+'</strong> '+escape(item.name_zh||item.name)+'</summary><div class="eq-products">'+(item.offerings??[]).map((o:any)=>'<a class="eq-product" href="'+escape(o.url)+'" rel="sponsored noopener" target="_blank">'+escape(o.platform+' '+o.product+' '+o.symbol)+'</a>').join('')+'</div></details>').join(''));
        return '<link rel="stylesheet" href="/equities.css">'+$.html()+'<script src="/equities.js" defer></script>';
      },
      'crypto-blacknico:referrals': (block:any, release:any) => '<section class="section wrap"><div class="referral-grid">'+(block.props.providers??[]).map((id:string)=>{
        const item=configFor(release).referrals?.[id];if(!item)return '';const display=block.props.items?.find((row:any)=>row.provider===id)??{};
        const codes=display.codes?.length?display.codes:[{key:'code',label:id.endsWith('-web3')?'Web3 邀请码':'邀请码'},...(item.futuresCode?[{key:'futuresCode',label:'合约邀请码'}]:[])];
        return '<section class="referral" data-provider="'+escape(id)+'"><h3>'+escape(display.title||item.name||providerLabels[id]||id)+'</h3>'+(display.description??[]).map((text:string)=>'<p>'+escape(text)+'</p>').join('')+'<a class="button lime" href="'+escape(item.url)+'" rel="sponsored noopener" target="_blank">'+escape(display.actionLabel||'前往平台 ↗')+'</a><div class="referral-codes">'+codes.filter((code:any)=>item[code.key]).map((code:any)=>'<div class="invite-row"><span>'+escape(code.label)+'</span><button aria-label="复制'+escape(code.label)+' '+escape(item[code.key])+'" data-crypto-copy="'+escape(item[code.key])+'">'+escape(item[code.key])+' ⧉</button></div>').join('')+'</div>'+(display.note?'<small class="referral-note">'+escape(display.note)+'</small>':'')+'</section>';
      }).join('')+'</div></section><script src="/crypto-business.js" defer></script>',
      'crypto-blacknico:announcements': (_block:any, release:any) => '<section class="wrap announcements-page"><div class="announcements-widget" data-announcements data-compact="false" data-limit="8"><div class="announcement-filters" aria-label="筛选官方公告">'+[['all','全部栏目'],['binance','币安'],['okx','OKX'],['events','最新活动']].map(([id,label])=>'<button data-announcement-filter="'+id+'" aria-pressed="'+(id==='all')+'">'+label+'</button>').join('')+'</div><p data-announcements-status class="announcements-status" role="status" hidden></p><div class="announcements-grid">'+ (feeds.feeds??[]).map((feed:any)=>'<section class="announcement-feed" data-announcement-feed="'+escape(feed.id)+'" data-platform="'+escape(feed.platform)+'" id="'+escape(feed.id)+'"><div class="announcement-feed-heading"><h3>'+escape(feed.name||feed.id)+'</h3><a class="announcement-source" href="'+escape(normalize(feed.url,configFor(release)))+'" rel="sponsored noopener" target="_blank">官网 ↗</a></div><p class="announcement-updated" data-feed-status>'+escape(feed.updatedAt||'尚未更新')+'</p><ul class="announcement-list" data-feed-list>'+ (feed.items??[]).slice(0,8).map((item:any)=>'<li><a href="'+escape(normalize(item.url,configFor(release)))+'" target="_blank" rel="sponsored noopener">'+escape(item.title)+'</a><time>'+escape(item.date||'')+'</time></li>').join('')+'</ul><p data-feed-empty hidden>暂无公告</p><button data-feed-more="'+escape(feed.id)+'" class="announcement-more">显示更多公告 ↓</button></section>').join('')+'</div></div></section><script src="/announcements.js" defer></script>',
    },
    transformHtml(html:string, release:any) {
      const $=load(html), config=configFor(release);
      $('a[href^="http"]').each((_i,el)=>{const a=$(el);a.attr('href',normalize(a.attr('href')!,config));});
      if($('video[data-video-key]').length)$('body').append('<script src="/crypto-business.js" defer></script>');
      return $.html();
    },
    async route(request: Request, release: any) {
      if (!release) return null;
      const url = new URL(request.url), path = url.pathname;
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
      if (['/sitemap.xml', '/sitemap-videos.xml', '/search-index.json', '/rss.xml', '/robots.txt'].includes(path)) return null;
      if(path==='/announcements.js'||path==='/crypto-business.js'||path==='/equities.js'||path==='/equities.css') {
        const file=join(site.root,'extensions/templates',path.slice(1));
        if(existsSync(file))return new Response(readFileSync(file),{headers:{'Content-Type':mime[extname(file)]||'application/octet-stream'}});
      }
      const theme = join(site.root, 'extensions/assets'),
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
