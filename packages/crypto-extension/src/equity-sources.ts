import { json } from './http.ts';
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
export const ticker = (v: string) => {
  const key = String(v).toUpperCase().replace(/^EQ_/, '').replace(/\.US$/, '');
  return aliases[key] ?? key;
};
export async function getStocks(sourceId: string) {
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
          ({ KR_EQUITY: 'KR', HK_EQUITY: 'HK', CN_EQUITY: 'CN' } as any)[r.underlyingType] ?? 'US',
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
      const d = await json('https://api.bitget.com/api/v3/market/instruments?category=' + category);
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
