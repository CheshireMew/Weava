import { searchDatasetSchema, type SearchDataset } from './search-data.ts';
import { digest } from './storage.ts';
import { WeavaError } from '@weava/contracts';
import { validDate, webUrl } from './seo.ts';

export interface SearchConnection {
  provider: 'gsc' | 'ga4' | 'dataforseo'; property: string; start: string; end: string;
  accessToken?: string; login?: string; password?: string;
  keywords?: string[]; locationCode?: number; languageCode?: string; device?: 'desktop' | 'mobile';
  allowPaid?: boolean; maxRequests?: number; maxRows?: number;
}
export function planSearchData(config: SearchConnection) {
  if (!validDate(config.start) || !validDate(config.end) || config.start > config.end) throw new WeavaError('请提供有效的开始与结束日期。');
  const maxRows = config.maxRows ?? 1000;
  if (!Number.isSafeInteger(maxRows) || maxRows < 1 || maxRows > 10000) throw new WeavaError('数据行预算为 1～10000。');
  if (!['gsc', 'ga4', 'dataforseo'].includes(config.provider) || !config.property) throw new WeavaError('请指定有效的连接器和资源。');
  const keywords = [...new Set(config.keywords?.map((value) => value.trim()).filter(Boolean) ?? [])];
  if (config.provider === 'dataforseo') {
    webUrl(config.property, config.property);
    if (!Number.isSafeInteger(config.maxRequests) || !config.maxRequests || keywords.length > config.maxRequests || config.maxRequests > 100 || !keywords.length) throw new WeavaError('付费查询需要关键词和明确的 maxRequests（最多 100）。');
    const today = new Date().toISOString().slice(0, 10);
    if (config.start !== today || config.end !== today) throw new WeavaError('即时排名查询的时间窗口必须是当前 UTC 日期。');
    if (!Number.isSafeInteger(config.locationCode) || config.locationCode! < 1 || !config.languageCode) throw new WeavaError('DataForSEO 需要有效的地区和语言。');
  }
  return { provider: config.provider, property: config.property, start: config.start, end: config.end, maxRows,
    requests: config.provider === 'dataforseo' ? keywords.length : config.provider === 'gsc' ? Math.ceil(maxRows / 1000) : 1,
    paid: config.provider === 'dataforseo', estimatedCostUsd: null,
    costNote: config.provider === 'dataforseo' ? '费用由服务商账户与接口定价决定；此计划只限制请求数，不承诺金额上限。' : '按服务商资源配额执行。',
    ...(config.provider === 'dataforseo' ? { keywords, locationCode: config.locationCode, languageCode: config.languageCode, device: config.device || 'desktop', depth: 100 } : {}) };
}
export async function pullSearchData(config: SearchConnection, fetcher: typeof fetch = fetch): Promise<SearchDataset> {
  const plan = planSearchData(config), { maxRows } = plan;
  const request = async (url: string, body: unknown, authorization: string) => {
    const response = await fetcher(url, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: authorization }, body: JSON.stringify(body), signal: AbortSignal.timeout(45000) });
    if (!response.ok) throw new WeavaError(`外部服务请求失败（HTTP ${response.status}），请检查连接和额度。`, 502);
    return await response.json() as any;
  };
  const base = { version: 1, provider: config.provider, property: config.property, start: config.start, end: config.end, collectedAt: new Date().toISOString() };
  let data: any;
  if (config.provider === 'gsc') {
    if (!config.accessToken) throw new WeavaError('Search Console 尚未提供访问令牌。');
    const rows: any[] = [];
    while (rows.length < maxRows) {
      const page = await request(`https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(config.property)}/searchAnalytics/query`, {
        startDate: config.start, endDate: config.end, dimensions: ['page', 'query', 'date', 'country', 'device'], rowLimit: Math.min(1000, maxRows - rows.length), startRow: rows.length, dataState: 'final',
      }, 'Bearer ' + config.accessToken);
      const values = page.rows ?? [];
      rows.push(...values.map((row: any) => ({ url: row.keys[0], query: row.keys[1], date: row.keys[2], country: row.keys[3], device: row.keys[4], clicks: row.clicks, impressions: row.impressions, position: row.position })));
      if (values.length < Math.min(1000, maxRows - rows.length + values.length)) break;
    }
    data = { ...base, kind: 'search-performance', rows, notes: `Search Console 最终数据；日期按平台时区；最多 ${maxRows} 行，达到预算时不声称覆盖全部查询。` };
  } else if (config.provider === 'ga4') {
    if (!config.accessToken || !/^\d+$/.test(config.property)) throw new WeavaError('GA4 需要数字资源编号和访问令牌。');
    const page = await request(`https://analyticsdata.googleapis.com/v1beta/properties/${config.property}:runReport`, {
      dateRanges: [{ startDate: config.start, endDate: config.end }], dimensions: [{ name: 'pageLocation' }, { name: 'date' }, { name: 'sessionDefaultChannelGroup' }],
      metrics: [{ name: 'sessions' }, { name: 'keyEvents' }], limit: maxRows,
    }, 'Bearer ' + config.accessToken);
    data = { ...base, kind: 'web-analytics', rows: (page.rows ?? []).map((row: any) => ({ url: row.dimensionValues[0].value, date: row.dimensionValues[1].value.replace(/^(\d{4})(\d{2})(\d{2})$/, '$1-$2-$3'), channel: row.dimensionValues[2].value, sessions: Number(row.metricValues[0].value), keyEvents: Number(row.metricValues[1].value) })), notes: `GA4 资源数据；最多 ${maxRows} 行；平台总行数 ${page.rowCount ?? '未知'}。` };
  } else if (config.provider === 'dataforseo') {
    const keywords = plan.keywords!;
    if (config.allowPaid !== true) throw new WeavaError('付费查询需要明确设置 allowPaid:true。');
    if (!config.login || !config.password || !config.locationCode || !config.languageCode) throw new WeavaError('DataForSEO 需要凭据、地区和语言。');
    const today = new Date().toISOString().slice(0, 10);
    if (config.start !== today || config.end !== today) throw new WeavaError('即时排名查询的时间窗口必须是当前 UTC 日期。');
    const rows: any[] = [], host = new URL(config.property).hostname;
    let spent = 0;
    try { for (const keyword of keywords) {
      const result = await request('https://api.dataforseo.com/v3/serp/google/organic/live/advanced', [{ keyword, location_code: config.locationCode, language_code: config.languageCode, device: config.device || 'desktop', depth: 100 }], 'Basic ' + Buffer.from(config.login + ':' + config.password).toString('base64'));
      if (result.status_code !== 20000 || result.tasks?.[0]?.status_code !== 20000) throw new WeavaError('DataForSEO 未返回成功任务，已停止后续付费查询。', 502);
      spent += Number(result.cost ?? 0);
      const items = result.tasks[0].result?.[0]?.items ?? [];
      const ranked = items.find((item: any) => item.type === 'organic' && item.url && new URL(item.url).hostname === host);
      rows.push({ keyword, country: String(config.locationCode), device: config.device || 'desktop', date: today, rank: ranked?.rank_absolute ?? null, ...(ranked ? { url: ranked.url } : {}) });
    } } catch {
      const partial = { ...base, language: config.languageCode, kind: 'keyword-rank', rows, expectedSamples: keywords.length, notes: `查询中断；完成 ${rows.length}/${keywords.length} 项；已知费用 ${spent} USD；失败请求也可能计费。` };
      throw new WeavaError('排名查询中断，已停止后续请求；可从 details.partialDataset 恢复已取得的数据。', 502, { completedRequests: rows.length, requestedRequests: keywords.length, knownCostUsd: spent, partialDataset: searchDatasetSchema.parse({ ...partial, id: 'dataforseo-partial-' + digest(partial).slice(0, 24) }) });
    }
    data = { ...base, language: config.languageCode, kind: 'keyword-rank', rows, notes: `${keywords.length} 次即时请求；API 报告费用 ${spent} USD；null 表示本次前 100 项未见目标域名。` };
  } else throw new WeavaError('不支持这个搜索数据连接器。');
  return searchDatasetSchema.parse({ ...data, id: config.provider + '-' + digest(data).slice(0, 24) });
}
