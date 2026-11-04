// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import AnalyticsPanel from '../apps/admin/src/AnalyticsPanel.tsx';
import { dateRange } from '../apps/admin/src/analytics/date-ranges.ts';
import { reportLocation } from '../apps/admin/src/analytics/report-navigation.ts';

const mocks = vi.hoisted(() => ({ api: vi.fn(), fail: false }));
vi.mock('../apps/admin/src/api.ts', () => ({ api: mocks.api }));
let host: HTMLDivElement, root: Root;
function fixture(query = '') {
  const p = new URLSearchParams(query), start = p.get('start') || '2026-10-06', end = p.get('end') || '2026-11-04';
  const totals = { views: start === '2026-10-29' ? 7 : 30, visitors: 2, sessions: 4, clicks: 3 };
  const data: any = { ...totals, range: { start, end, timezone: 'Asia/Shanghai', days: 30, previousStart: '2026-09-06', previousEnd: '2026-10-05' }, previous: { views: 10, visitors: 1, sessions: 2, clicks: 0 }, lifetime: totals, averageActiveMs: 45000, overview: [], daily: [{ date: end, ...totals, previousViews: 10, previousVisitors: 1 }], historicalViews: 0, lifetimeViews: 30, pageTitles: {}, realtime: { count: 0, visitors: [], windowMinutes: 5, at: '2026-11-04T00:00:00Z' }, geo: { available: false, updating: false } };
  for (const key of ['pages', 'sources', 'engines', 'countries', 'browsers', 'operatingSystems', 'devices', 'models', 'activeVisitors', 'recentVisitors', 'links', 'actions', 'campaigns', 'crawlers', 'legacySources', 'lifetimePages']) data[key] = [];
  return data;
}
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-04T03:00:00Z'));
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  window.history.replaceState(null, '', '/admin/?panel=analytics');
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  mocks.fail = false; mocks.api.mockReset();
  mocks.api.mockImplementation(async (path: string) => {
    if (path.startsWith('analytics?')) { if (mocks.fail) throw new Error('暂时无法读取'); return fixture(path.split('?')[1]); }
    return fixture().realtime;
  });
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.useRealTimers(); });
async function render() { await act(async () => root.render(<AnalyticsPanel onError={vi.fn()} />)); }
async function click(element: Element | null) { expect(element).not.toBeNull(); await act(async () => (element as HTMLElement).click()); }
const button = (name: string) => document.querySelector('[aria-label="' + name + '"]');
async function tab(name: string) { await click([...host.querySelectorAll('[role="tab"]')].find(node => node.textContent === name)!); }
async function sevenDays() {
  await click(button('统计日期范围'));
  await click([...document.querySelectorAll('.analytics-date-choices button')].find(node => node.textContent === '近 7 天')!);
}
const selected = () => host.querySelector('[role="tab"][aria-selected="true"]')!.textContent;

it('keeps the native report groups and avoids loading every report into the overview', async () => {
  await render();
  expect([...host.querySelectorAll('[role="tab"]')].map(node => node.textContent)).toEqual(['概览', '来源', '访客', '设备', '行为']);
  expect([...host.querySelectorAll('h2')].map(node => node.textContent)).toEqual(['流量趋势', '流量概览', '页面排行']);
  expect(host.querySelectorAll('[aria-label="统计日期范围"]')).toHaveLength(1);
  expect(host.querySelector('input[type="date"]')).toBeNull();
  await tab('来源'); expect(host.textContent).toContain('搜索与 AI 来源趋势'); expect(host.textContent).toContain('全球访客分布');
  await tab('设备'); expect(host.querySelectorAll('.analytics-section-grid > section')).toHaveLength(4);
  await tab('访客'); expect(host.textContent).toContain('最新访客'); expect(host.textContent).toContain('当前在线');
  await tab('行为'); expect(host.textContent).toContain('爬虫请求');
  expect(mocks.api.mock.calls.filter(([path]) => path.startsWith('analytics?'))).toHaveLength(1);
});

it('switches the visitor ordering without duplicating tables or querying again', async () => {
  await render(); await tab('访客');
  const count = mocks.api.mock.calls.length;
  expect(host.textContent).toContain('最新访客'); expect(host.textContent).not.toContain('最活跃访客');
  await act(async () => { const select = host.querySelector<HTMLSelectElement>('[aria-label="访客排序"]')!; select.value = 'active'; select.dispatchEvent(new Event('change', { bubbles: true })); });
  expect(host.textContent).toContain('最活跃访客'); expect(host.textContent).not.toContain('最新访客');
  expect(host.textContent).toContain('当前在线');
  expect(mocks.api.mock.calls.length).toBe(count);
});

it('shares the date and source filter across groups and detailed exports', async () => {
  await render(); await tab('来源'); await sevenDays();
  expect(selected()).toBe('来源');
  expect(host.querySelector('.analytics-period')!.textContent).toContain('近 7 天');
  await act(async () => { const select = host.querySelector<HTMLSelectElement>('[aria-label="来源筛选"]')!; select.value = 'search-referral'; select.dispatchEvent(new Event('change', { bubbles: true })); });
  expect(host.querySelector('.analytics-filter-tags')!.textContent).toContain('搜索引擎');
  await tab('概览');
  expect(host.querySelector('.analytics-period')!.textContent).toContain('近 7 天');
  expect(host.querySelector<HTMLSelectElement>('[aria-label="来源筛选"]')!.value).toBe('search-referral');
  const count = mocks.api.mock.calls.length;
  await click(host.querySelector('section[aria-label="流量趋势"] footer a'));
  expect(selected()).toBe('概览');
  const url = host.querySelector<HTMLAnchorElement>('.analytics-export')!.href;
  expect(url).toContain('start=2026-10-29'); expect(url).toContain('channel=search-referral'); expect(url).toContain('dataset=daily');
  expect(host.querySelectorAll('a[href*="dataset=daily"]')).toHaveLength(1);
  await click([...host.querySelectorAll('.analytics-view-switch button')].find(node => node.textContent === '数据')!);
  expect(host.querySelector('.analytics-trend tbody')!.textContent).toContain('2026-11-04');
  await click(host.querySelector('.analytics-report-heading a'));
  expect(host.querySelector('.analytics-period')!.textContent).toContain('近 7 天');
  expect(mocks.api.mock.calls.length).toBe(count);
});

it('keeps navigation and retry available after a query fails without exporting stale data', async () => {
  await render(); mocks.fail = true; await sevenDays();
  expect(host.querySelector('[role="alert"]')!.textContent).toContain('暂时无法读取');
  expect(host.querySelectorAll('[role="tab"]')).toHaveLength(5);
  expect(button('统计日期范围')).not.toBeNull();
  expect(host.querySelector('.analytics-export')).toBeNull();
  expect(host.querySelector('.analytics-metrics')).toBeNull();
  mocks.fail = false;
  await click(host.querySelector('[role="alert"] button'));
  expect(host.querySelector('[role="alert"]')).toBeNull();
  expect(host.querySelector('.analytics-period')!.textContent).toContain('近 7 天');
});

it('restores the selected group, dates and filters from a refreshed URL or browser history', async () => {
  window.history.replaceState(null, '', '/admin/?panel=analytics&section=devices&start=2026-10-29&end=2026-11-04&country=CN');
  await render();
  expect(selected()).toBe('设备'); expect(host.querySelector('.analytics-period')!.textContent).toContain('近 7 天');
  expect(host.querySelector('.analytics-filter-tags')!.textContent).toContain('中国');
  await act(async () => root.unmount()); root = createRoot(host); await render();
  expect(selected()).toBe('设备');
  await act(async () => { window.history.replaceState(null, '', '/admin/?panel=analytics&section=visitors&start=2026-10-06&end=2026-11-04'); window.dispatchEvent(new PopStateEvent('popstate')); });
  expect(selected()).toBe('访客'); expect(host.querySelector('.analytics-period')!.textContent).toContain('近 30 天');
});

it('submits custom native date fields as the shared reporting range', async () => {
  await render(); await click(button('统计日期范围'));
  await click([...document.querySelectorAll('button')].find(node => node.textContent === '自定义日期…')!);
  await act(async () => {
    const first = document.querySelector<HTMLInputElement>('.analytics-custom-range input[name="start"]')!;
    const last = document.querySelector<HTMLInputElement>('.analytics-custom-range input[name="end"]')!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(first, '2026-10-01');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(last, '2026-11-01');
    document.querySelector<HTMLFormElement>('.analytics-custom-range')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });
  expect(host.querySelector('.analytics-period')!.textContent).toContain('2026-10-01 — 2026-11-01');
  await tab('设备'); expect(host.querySelector('.analytics-period')!.textContent).toContain('2026-10-01 — 2026-11-01');
});

it('preserves the report group when a tab is selected with the keyboard', async () => {
  await render();
  await act(async () => host.querySelector('[role="tab"]')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })));
  expect(selected()).toBe('来源');
  expect(reportLocation(window.location.search).section).toBe('sources');
  expect(document.activeElement?.getAttribute('role')).toBe('tab');
});

it('uses calendar weeks and months across year and leap-day boundaries', () => {
  expect(dateRange('last-week', 'Asia/Shanghai', '2026-01-01')).toEqual({ start: '2025-12-22', end: '2025-12-28' });
  expect(dateRange('week', 'Asia/Shanghai', '2026-11-04')).toEqual({ start: '2026-11-02', end: '2026-11-04' });
  expect(dateRange('last-month', 'Asia/Shanghai', '2024-03-01')).toEqual({ start: '2024-02-01', end: '2024-02-29' });
});
