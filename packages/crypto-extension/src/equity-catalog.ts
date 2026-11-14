import type { CryptoState } from './state.ts';
import { configFor, normalize } from './referrals.ts';
import { ticker } from './equity-sources.ts';
export function stockPublic(state: CryptoState, release: any) {
  const { stocks, read } = state;
  const config = configFor(release);
  if (Array.isArray(stocks.items)) return stocks;
  const previous = read('public-stock-snapshot.json', { items: [] });
  const grouped = new Map<string, any>();
  const metadata = new Map<string, any>();
  const sourceRows: any[] = [];
  for (const [id, saved] of Object.entries<any>(stocks.sources ?? {})) {
    for (const m of saved.result?.metadata ?? []) metadata.set(ticker(m.ticker), m);
    const sourceMeta = previous.sources?.find((row: any) => row.id === id) ?? {};
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
