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
  window.history.replaceState(null, '', '/admin/?panel=analytics'); sessionStorage.clear();
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  mocks.fail = false; mocks.api.mockReset();
  mocks.api.mockImplementation(async (path: string) => {
    if (path.startsWith('analytics?')) { if (mocks.fail) throw new Error('暂时无法读取'); return fixture(path.split('?')[1]); }
    return fixture().realtime;
  });
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.useRealTimers(); sessionStorage.clear(); });
async function render() { await act(async () => root.render(<AnalyticsPanel onError={vi.fn()} />)); }
async function click(element: Element | null) { expect(element).not.toBeNull(); await act(async () => (element as HTMLElement).click()); }
const card = (name: string) => host.querySelector<HTMLElement>('section[aria-label="' + name + '"]')!;
const button = (name: string) => document.querySelector('[aria-label="' + name + '"]');
async function sevenDays(name: string) {
  await click(button(name + '日期范围'));
  await click([...document.querySelectorAll('.analytics-date-choices button')].find(node => node.textContent === '近 7 天')!);
}

it('changes one card independently, carries its dates into details and export, and preserves them on return', async () => {
  await render();
  expect(host.querySelector('input[type="date"]')).toBeNull();
  await sevenDays('流量趋势');
  expect(card('流量趋势').querySelector('footer')!.textContent).toContain('近 7 天');
  expect(card('搜索与 AI 来源趋势').querySelector('footer')!.textContent).toContain('近 30 天');
  expect(card('页面排行').querySelector('footer')!.textContent).toContain('近 30 天');
  expect(mocks.api.mock.calls.filter(([path]) => path.startsWith('analytics?'))).toHaveLength(2);
  await click(card('流量趋势').querySelector('footer a'));
  expect(reportLocation(window.location.search)).toEqual({ report: 'traffic', query: 'start=2026-10-29&end=2026-11-04' });
  const exportUrl = host.querySelector<HTMLAnchorElement>('.analytics-export')!.href;
  expect(exportUrl).toContain('start=2026-10-29'); expect(exportUrl).toContain('dataset=daily');
  expect(host.textContent).toContain('上期');
  await click([...host.querySelectorAll('.analytics-view-switch button')].find(node => node.textContent === '数据')!);
  expect(host.querySelector('.analytics-trend tbody')!.textContent).toContain('2026-11-04');
  await click(host.querySelector('.analytics-back'));
  expect(card('流量趋势').querySelector('footer')!.textContent).toContain('近 7 天');
  expect(card('页面排行').querySelector('footer')!.textContent).toContain('近 30 天');
});

it('keeps other cards available after a scoped request fails and retries the requested range', async () => {
  await render(); mocks.fail = true;
  await sevenDays('页面排行');
  expect(card('页面排行').textContent).toContain('暂时无法读取');
  expect(card('页面排行').querySelector('footer')!.textContent).toContain('近 30 天');
  expect(card('流量趋势').querySelector('footer')!.textContent).toContain('近 30 天');
  mocks.fail = false;
  await click(card('页面排行').querySelector('.analytics-card-error button'));
  expect(card('页面排行').querySelector('[role="alert"]')).toBeNull();
  expect(card('页面排行').querySelector('footer')!.textContent).toContain('近 7 天');
});

it('opens a detail URL directly and preserves its filters when changing the date', async () => {
  window.history.replaceState(null, '', '/admin/?panel=analytics&report=sources&start=2026-10-06&end=2026-11-04&channel=search-referral&country=CN');
  await render();
  expect(host.querySelector('h1')!.textContent).toBe('访问来源');
  expect(host.querySelector<HTMLSelectElement>('[aria-label="来源筛选"]')!.value).toBe('search-referral');
  await sevenDays('访问来源');
  const location = reportLocation(window.location.search), p = new URLSearchParams(location.query);
  expect(location.report).toBe('sources'); expect(p.get('channel')).toBe('search-referral'); expect(p.get('country')).toBe('CN'); expect(p.get('start')).toBe('2026-10-29');
  const url = host.querySelector<HTMLAnchorElement>('.analytics-export')!.href;
  expect(url).toContain('channel=search-referral'); expect(url).toContain('country=CN');
});

it('restores independent card dates after reloading the analytics panel', async () => {
  await render(); await sevenDays('页面排行');
  await act(async () => root.unmount()); root = createRoot(host);
  await render();
  expect(card('页面排行').querySelector('footer')!.textContent).toContain('近 7 天');
  expect(card('流量趋势').querySelector('footer')!.textContent).toContain('近 30 天');
});

it('submits custom native date fields instead of reusing the prior preset', async () => {
  await render(); await click(button('国家 / 地区日期范围'));
  await click([...document.querySelectorAll('button')].find(node => node.textContent === '自定义日期…')!);
  await act(async () => {
    const first = document.querySelector<HTMLInputElement>('.analytics-custom-range input[name="start"]')!;
    const last = document.querySelector<HTMLInputElement>('.analytics-custom-range input[name="end"]')!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(first, '2026-10-01');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(last, '2026-11-01');
    document.querySelector<HTMLFormElement>('.analytics-custom-range')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });
  expect(card('国家 / 地区').querySelector('footer')!.textContent).toContain('2026-10-01 — 2026-11-01');
  expect(card('流量趋势').querySelector('footer')!.textContent).toContain('近 30 天');
});

it('uses calendar weeks and months across year and leap-day boundaries', () => {
  expect(dateRange('last-week', 'Asia/Shanghai', '2026-01-01')).toEqual({ start: '2025-12-22', end: '2025-12-28' });
  expect(dateRange('week', 'Asia/Shanghai', '2026-11-04')).toEqual({ start: '2026-11-02', end: '2026-11-04' });
  expect(dateRange('last-month', 'Asia/Shanghai', '2024-03-01')).toEqual({ start: '2024-02-01', end: '2024-02-29' });
  expect(dateRange('yesterday', 'Asia/Shanghai', '2026-01-01')).toEqual({ start: '2025-12-31', end: '2025-12-31' });
});
