import { WeavaError } from '@weava/contracts';
import type { Site } from './site.ts';
import { digest } from './storage.ts';
import { searchDatasetSchema, type SearchDataset } from '../../contracts/src/search-data.ts';
export { searchDatasetSchema, type SearchDataset } from '../../contracts/src/search-data.ts';

export function importSearchData(site: Site, input: unknown) {
  const dataset = searchDatasetSchema.parse(input);
  if (dataset.start > dataset.end) throw new WeavaError('数据时间窗口无效。');
  const seen = new Set<string>();
  for (const row of dataset.rows) {
    const rowDate = 'date' in row ? row.date : row.observedAt.slice(0, 10);
    if (rowDate < dataset.start || rowDate > dataset.end) throw new WeavaError('数据行超出了声明的时间窗口。');
    const key = 'id' in row ? row.id : digest(row);
    if (seen.has(key)) throw new WeavaError('数据行重复：' + key);
    seen.add(key);
    if ('entryId' in row && row.entryId && !site.store.get('entry', row.entryId)) throw new WeavaError('关联内容不存在：' + row.entryId);
  }
  if (dataset.kind === 'ai-observations' && dataset.expectedSamples !== undefined && dataset.rows.length > dataset.expectedSamples) throw new WeavaError('实际样本超过声明的计划样本数。');
  const existing = site.store.get('search-data', dataset.id);
  if (existing) {
    if (digest(existing.value) !== digest(dataset)) throw new WeavaError('这个数据批次编号已有不同内容，请使用新的批次编号。', 409);
    return { id: existing.id, imported: 0, rows: dataset.rows.length, unchanged: true };
  }
  site.store.put('search-data', dataset.id, dataset, null, '导入搜索观测');
  return { id: dataset.id, imported: dataset.rows.length, rows: dataset.rows.length, unchanged: false };
}
export function searchDataReport(site: Site) {
  const release = site.visibleRelease(), entryFor = (value: string) => {
    try { const parsed = new URL(value), base = new URL(release?.settings.domain || 'http://localhost'); return parsed.origin === base.origin ? release?.entries.find((entry) => entry.path === parsed.pathname)?.id ?? null : null; } catch { return null; }
  };
  const datasets = site.store.list('search-data').map((row) => {
    const d = searchDatasetSchema.parse(row.value), base = { id: d.id, provider: d.provider, property: d.property, kind: d.kind, start: d.start, end: d.end, collectedAt: d.collectedAt,
      rows: d.rows.length, status: d.rows.length ? 'available' : 'empty', planned: d.expectedSamples ?? null, missing: d.expectedSamples === undefined ? null : Math.max(0, d.expectedSamples - d.rows.length), notes: d.notes };
    if (d.kind === 'search-performance') {
      const impressions = d.rows.reduce((sum, row) => sum + row.impressions, 0), clicks = d.rows.reduce((sum, row) => sum + row.clicks, 0);
      return { ...base, impressions, clicks, ctr: impressions ? clicks / impressions : null,
        pages: d.rows.map((row) => ({ ...row, entryId: row.entryId || entryFor(row.url) })) };
    }
    if (d.kind === 'ai-observations') {
      const groups = new Map<string, { platform: string; model: string; locale: string; collectionMethod: string; panelVersion: string; observed: number; answered: number; ownedCitations: number }>();
      for (const row of d.rows) {
        const key = JSON.stringify([row.platform, row.model, row.locale, row.collectionMethod, row.panelVersion]);
        const group = groups.get(key) ?? { platform: row.platform, model: row.model, locale: row.locale, collectionMethod: row.collectionMethod, panelVersion: row.panelVersion, observed: 0, answered: 0, ownedCitations: 0 };
        group.observed++; group.answered += Number(row.status === 'answered');
        group.ownedCitations += Number(row.status === 'answered' && row.citations.some((url) => !!entryFor(url))); groups.set(key, group);
      }
      return { ...base, planned: d.expectedSamples ?? null, missing: d.expectedSamples ? d.expectedSamples - d.rows.length : null, groups: [...groups.values()].map((group) => ({ ...group, citationRateAmongAnswers: group.answered ? group.ownedCitations / group.answered : null })), observations: d.rows };
    }
    return { ...base, data: d.rows.map((row) => ({ ...row, ...('url' in row && row.url ? { entryId: entryFor(row.url) } : {}) })) };
  });
  return { status: datasets.length ? 'available' : 'not-connected', datasets, capabilities: ['search-performance', 'web-analytics', 'keyword-rank', 'ai-observations'],
    connections: ['gsc', 'ga4', 'dataforseo'].map((provider) => ({ provider, status: datasets.some((d) => d.provider === provider) ? 'data-imported' : 'not-connected' })) };
}
