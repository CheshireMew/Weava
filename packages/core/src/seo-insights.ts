import { WeavaError } from '@weava/contracts';
import type { Site } from './site.ts';
import { searchDatasetSchema } from './search-data.ts';
import { evidenceCurrent, validDate } from './seo.ts';
import { auditStatus } from './seo-audit.ts';
import { normalizePath } from './paths.ts';

interface Metric { clicks: number; impressions: number; positionSum: number; positionImpressions: number; dates: Set<string> }
const metric = (): Metric => ({ clicks: 0, impressions: 0, positionSum: 0, positionImpressions: 0, dates: new Set() });
const summarize = (value: Metric) => ({ clicks: value.clicks, impressions: value.impressions,
  ctr: value.impressions ? value.clicks / value.impressions : null,
  position: value.positionImpressions ? value.positionSum / value.positionImpressions : null, observedDays: value.dates.size });
const day = (date: string, offset: number) => new Date(Date.parse(date + 'T00:00:00Z') + offset * 86400000).toISOString().slice(0, 10);

/** Suggestions retain their measured basis; no score, automatic rewrite or publication. */
export function seoInsights(site: Site, options: { start?: string; end?: string } = {}) {
  const datasets = site.store.list('search-data').map(row => searchDatasetSchema.parse(row.value)).filter(dataset => dataset.kind === 'search-performance');
  const end = options.end ?? datasets.map(dataset => dataset.end).sort().at(-1) ?? new Date().toISOString().slice(0, 10);
  if (!validDate(end)) throw new WeavaError('需要有效的开始与结束日期。');
  const start = options.start ?? day(end, -27);
  if (!validDate(start) || !validDate(end) || start > end) throw new WeavaError('需要有效的开始与结束日期。');
  const days = Math.round((Date.parse(end) - Date.parse(start)) / 86400000) + 1;
  const priorStart = day(start, -days), priorEnd = day(start, -1), release = site.visibleRelease();
  const domain = new URL(release?.settings.domain ?? site.settings().value.domain);
  const entries = release?.entries ?? [];
  const entriesByPath = new Map(entries.map(entry => [entry.path, entry]));
  const match = (value: string) => {
    const url = new URL(value); if (url.origin !== domain.origin) return undefined;
    let path: string;
    try { path = normalizePath(url.pathname); } catch { return undefined; }
    const seen = new Set<string>();
    while (release?.redirects?.[path] && !seen.has(path)) { seen.add(path); path = release.redirects[path].target; }
    return entriesByPath.get(path);
  };
  type Row = Extract<(typeof datasets)[number], { kind: 'search-performance' }>['rows'][number];
  const groups = new Map<string, { provider: string; property: string; dimensions: string[]; rows: Map<string, { row: Row; collectedAt: string }> }>();
  for (const dataset of [...datasets].sort((a, b) => Date.parse(a.collectedAt) - Date.parse(b.collectedAt) || a.id.localeCompare(b.id))) for (const row of dataset.rows) {
    if (row.date < priorStart || row.date > end) continue;
    const dimensions = ['query', 'country', 'device'].filter(key => row[key as keyof Row] !== undefined);
    const key = JSON.stringify([dataset.provider, dataset.property, dimensions]);
    let group = groups.get(key);
    if (!group) { group = { provider: dataset.provider, property: dataset.property, dimensions, rows: new Map() }; groups.set(key, group); }
    const identity = JSON.stringify([row.url, row.date, row.query, row.country, row.device]);
    group.rows.set(identity, { row, collectedAt: dataset.collectedAt });
  }
  const reports = [...groups.values()].map(group => {
    const pages = new Map<string, { url: string; entryId: string | null; revision: number | null; title: string; current: Metric; previous: Metric }>();
    const queries = new Map<string, Map<string, Metric>>();
    for (const { row } of group.rows.values()) {
      const entry = match(row.url);
      let page = pages.get(row.url);
      if (!page) { page = { url: row.url, entryId: entry?.id ?? null, revision: entry?.revisionId ?? null, title: entry?.title ?? '', current: metric(), previous: metric() }; pages.set(row.url, page); }
      const add = (value: Metric) => { value.clicks += row.clicks; value.impressions += row.impressions; value.dates.add(row.date);
        if (row.position !== undefined) { value.positionSum += row.position * row.impressions; value.positionImpressions += row.impressions; } };
      add(row.date >= start ? page.current : page.previous);
      if (row.date >= start && row.query) {
        const query = queries.get(row.query) ?? new Map<string, Metric>();
        const value = query.get(row.url) ?? metric(); add(value); query.set(row.url, value); queries.set(row.query, query);
      }
    }
    const suggestions: { kind: string; urls: string[]; query?: string; reason: string; action: string }[] = [];
    const values = [...pages.values()].map(page => {
      const current = summarize(page.current), previous = summarize(page.previous);
      if (page.entryId && current.impressions >= 100 && current.ctr !== null && current.ctr < 0.02) suggestions.push({ kind: 'review-click-through', urls: [page.url], reason: `${current.impressions} 次展示，${current.clicks} 次点击。`, action: '结合具体查询和排名检查标题、摘要及内容是否符合需求；低点击率本身不代表标题有错。' });
      if (page.entryId && current.impressions >= 50 && current.position !== null && current.position >= 8 && current.position <= 20) suggestions.push({ kind: 'near-first-page', urls: [page.url], reason: `展示加权平均位置 ${current.position.toFixed(1)}。`, action: '检查主要查询，补足页面没有回答的问题，并从相关内容建立链接。' });
      if (page.entryId && current.observedDays > 0 && previous.clicks >= 10 && current.clicks <= previous.clicks * 0.7) suggestions.push({ kind: 'review-decline', urls: [page.url], reason: `前一等长窗口 ${previous.clicks} 次点击，当前 ${current.clicks} 次。`, action: '先核对数据窗口和覆盖，再检查需求变化、页面改动及信息是否过时。' });
      return { url: page.url, entryId: page.entryId, revision: page.revision, title: page.title, current, previous };
    });
    for (const [query, pages] of queries) {
      const urls = [...pages].filter(([url, value]) => match(url) && value.impressions >= 30).map(([url]) => url);
      if (urls.length > 1) suggestions.push({ kind: 'review-query-overlap', urls, query, reason: '同一查询有多个本站页面获得展示。', action: '核对页面是否服务不同意图；需要时调整分工、互相链接或合并，不能仅因共同排名就认定冲突。' });
    }
    return { provider: group.provider, property: group.property, dimensions: group.dimensions, rowCount: group.rows.size,
      pages: values.sort((a, b) => b.current.impressions - a.current.impressions), suggestions };
  });
  const maintenance: { entryId: string; revision: number; path: string; title: string; kind: string; reason: string; evidenceId?: string; claim?: string }[] = [];
  for (const entry of entries) for (const item of entry.evidence ?? []) if (!evidenceCurrent(item)) maintenance.push({ entryId: entry.id, revision: entry.revisionId, path: entry.path, title: entry.title,
    kind: item.status === 'verified' ? 'review-source' : 'verify-source', reason: item.status === 'verified' ? '来源核验已过期或日期不适用。' : '说法仍待核验。', evidenceId: item.id, claim: item.claim });
  const audits = site.store.list('seo-audit').map(row => row.value).filter(report => report.releaseId === release?.id && !auditStatus(site, report).stale).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  for (const finding of audits[0]?.findings ?? []) if (['internal-link', 'canonical-target', 'unavailable'].includes(finding.rule)) {
    const entry = entries.find(entry => entry.id === finding.entryId); if (entry) maintenance.push({ entryId: entry.id, revision: entry.revisionId, path: entry.path, title: entry.title, kind: 'review-link', reason: finding.message });
  }
  return { status: reports.length ? 'available' : 'no-search-data', releaseId: release?.id ?? null, start, end, days, previous: { start: priorStart, end: priorEnd }, groups: reports, maintenance,
    notes: ['不同服务商、资源和维度分别分析；重叠导入的同一行使用较新采集值，不能把分组相加当作全站总量。',
      '仅分析已导入的观测；平台截断、隐藏查询及缺失日期可能影响比较。建议不是排名保证，也不会自动改稿或发布。'] };
}
