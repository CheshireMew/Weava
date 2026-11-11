// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import AnalyticsPanel from '../apps/admin/src/AnalyticsPanel.tsx';
import { adminQueries } from '../apps/admin/src/query-cache.ts';
import { dateRange } from '../apps/admin/src/analytics/date-ranges.ts';
import { reportLocation } from '../apps/admin/src/analytics/report-navigation.ts';
import { VisitorDetails } from '../apps/admin/src/analytics/VisitorDetails.tsx';

const mocks = vi.hoisted(() => ({ api: vi.fn(), fail: false, paused: false }));
vi.mock('../apps/admin/src/api.ts', () => ({ api: (path:string,...args:unknown[]) => path==='analytics/health'?Promise.resolve({collecting:!mocks.paused,reason:mocks.paused?'今日统计采集已达到数量上限，次日自动恢复。':'',bytes:1024,maximumBytes:1073741824,freeBytes:10737418240,minimumFreeBytes:536870912,dailyEvents:1,dailyLimit:100000,resetAt:null,lastAcceptedAt:null}):mocks.api(path,...args) }));
let host: HTMLDivElement, root: Root;
function fixture(query = '') {
  const p = new URLSearchParams(query), start = p.get('start') || '2026-10-06', end = p.get('end') || '2026-11-04';
  const totals = { views: start === '2026-10-29' ? 7 : 30, visitors: 2, sessions: 4, clicks: 3 };
  const data: any = { ...totals, range: { start, end, timezone: 'Asia/Shanghai', days: 30, previousStart: '2026-09-06', previousEnd: '2026-10-05' }, previous: { views: 10, visitors: 1, sessions: 2, clicks: 0 }, lifetime: totals, averageActiveMs: 45000, overview: [], daily: [{ date: end, ...totals, previousViews: 10, previousVisitors: 1 }], historicalViews: 0, lifetimeViews: 30, pageTitles: {}, realtime: { count: 0, visitors: [], windowMinutes: 5, at: '2026-11-04T00:00:00Z' }, geo: { available: false, updating: false } };
  for (const key of ['pages', 'sources', 'engines', 'countries', 'browsers', 'operatingSystems', 'devices', 'models', 'activeVisitors', 'recentVisitors', 'links', 'actions', 'campaigns', 'crawlers', 'legacySources', 'lifetimePages']) data[key] = [];
  return data;
}
beforeEach(() => {
  adminQueries.invalidate(true);
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-04T03:00:00Z'));
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  window.history.replaceState(null, '', '/admin/?panel=analytics');
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  mocks.fail = false; mocks.paused = false; mocks.api.mockReset();
  mocks.api.mockImplementation(async (path: string) => {
    if (path.startsWith('analytics?')) { if (mocks.fail) throw new Error('暂时无法读取'); return fixture(path.split('?')[1]); }
    return fixture().realtime;
  });
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.useRealTimers(); });
async function render() { await act(async () => root.render(<AnalyticsPanel onError={vi.fn()} />)); }
async function click(element: Element | null) { expect(element).not.toBeNull(); await act(async () => (element as HTMLElement).click()); }
const button = (name: string) => document.querySelector('[aria-label="' + name + '"]');
const visitorDetail = (label: string, page = 1) => ({ page, pages: 2, total: 51, events: [{ ts: '2026-11-01T12:00:00Z', session: 'visit', kind: 'view', path: '/article/', label, activeMs: 1000, scroll: 20 }] });
it('reopens cached visitor records immediately and keeps pages scoped to the visitor and date range', async () => {
  mocks.api.mockImplementation(async (path: string) => { const p = new URLSearchParams(path.split('?')[1]);return visitorDetail(p.get('id') + ':' + p.get('page'), Number(p.get('page'))); });
  const show = (id: string, data = fixture()) => root.render(<VisitorDetails visitor={id} setVisitor={vi.fn()} data={data} />);
  await act(async () => show('one'));expect(host.textContent).toContain('one:1');
  await click([...host.querySelectorAll('button')].find(node => node.textContent === '下一页')!);expect(host.textContent).toContain('one:2');
  await act(async () => show('two'));expect(host.textContent).toContain('two:1');expect(host.textContent).not.toContain('one:2');
  await act(async () => root.render(null));const calls = mocks.api.mock.calls.length;
  await act(async () => show('one'));expect(host.textContent).toContain('one:1');expect(host.querySelector('.loading-state')).toBeNull();expect(mocks.api).toHaveBeenCalledTimes(calls);
  let finish!: (value: any) => void;mocks.api.mockReturnValue(new Promise(resolve => finish = resolve));
  await act(async () => show('one', fixture('start=2026-10-01&end=2026-10-02')));expect(host.textContent).not.toContain('one:1');expect(host.querySelector('[aria-label="读取访问记录"]')).not.toBeNull();
  await act(async () => finish(visitorDetail('new range')));expect(host.textContent).toContain('new range');
});
it('keeps visitor records readable during background refresh and offers retry without hiding cached records', async () => {
  mocks.api.mockResolvedValue(visitorDetail('retained visit'));
  await act(async () => root.render(<VisitorDetails visitor="one" setVisitor={vi.fn()} data={fixture()} />));
  let fail!: (error: Error) => void;mocks.api.mockReturnValue(new Promise((_resolve, reject) => fail = reject));
  await act(async () => adminQueries.invalidate(false, path => path.startsWith('analytics/visitor?')));
  expect(host.textContent).toContain('retained visit');expect(host.querySelector('.loading-state')).toBeNull();
  await act(async () => fail(new Error('连接中断')));expect(host.textContent).toContain('retained visit');expect(host.querySelector('[role=alert]')?.textContent).toContain('连接中断');
  mocks.api.mockResolvedValue(visitorDetail('updated visit'));await click([...host.querySelectorAll('button')].find(node => node.textContent === '重新读取')!);
  expect(host.textContent).toContain('updated visit');expect(host.querySelector('[role=alert]')).toBeNull();
});
async function tab(name: string) { await click([...host.querySelectorAll('[role="tab"]')].find(node => node.textContent === name)!); }
it('keeps healthy reports free of internal maintenance controls and displays a useful pause notice',async()=>{
 await render();
 for(const name of ['概览','来源','访客','设备','行为']) {
  await tab(name);expect(host.querySelector('.analytics-collection-health,.analytics-archive,.analytics-management')).toBeNull();
  expect(host.textContent).not.toContain('统计库');expect(host.textContent).not.toContain('今日采集');
 }
 expect(mocks.api.mock.calls.some(([path])=>path==='analytics/archives'||path.startsWith('analytics/archive/days'))).toBe(false);
 mocks.paused=true;await act(async()=>vi.advanceTimersByTimeAsync(30000));
 expect(host.querySelector('.analytics-collection-health')?.textContent).toContain('次日自动恢复');
 expect(host.querySelector('.analytics-collection-health')?.textContent).not.toContain('100000');
});
it('opens old management links as reports and preserves dates through history',async()=>{
 window.history.replaceState(null,'','/admin/?panel=analytics&section=management&start=2026-10-01&end=2026-10-02');
 await render();expect(host.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toBe('概览');
 expect(reportLocation('?section=management&report=traffic').section).toBe('overview');
 expect(mocks.api.mock.calls.some(([path])=>path.startsWith('analytics?')&&path.includes('start=2026-10-01')&&path.includes('end=2026-10-02'))).toBe(true);
 window.history.replaceState(null,'','/admin/?panel=analytics&section=sources&start=2026-10-01&end=2026-10-02');
 await act(async()=>window.dispatchEvent(new PopStateEvent('popstate')));expect(host.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toBe('来源');
});
async function sevenDays() {
  await click(button('统计日期范围'));
  await click([...document.querySelectorAll('.analytics-date-choices button')].find(node => node.textContent === '近 7 天')!);
}
it('shows five attributed sources per page and resets for a new range',async()=>{
 mocks.api.mockImplementation(async(path:string)=>{
  const data=fixture(path.split('?')[1]);
  data.sources=Array.from({length:23},(_,index)=>({name:'来源 '+(index+1),host:'source'+index+'.test',channel:'referral',views:23-index,visitors:1,sessions:1}));
  return path.startsWith('analytics?')?data:data.realtime;
 });
 await render();await tab('来源');
 const card=()=>[...host.querySelectorAll('h2')].find(heading=>heading.textContent==='访问来源')!.closest('section')!;
 expect(card().querySelectorAll('tbody tr')).toHaveLength(5);
 await click(card().querySelector('[aria-label="下一页"]'));expect(card().querySelector('tbody tr')?.textContent).toContain('来源 6');
 await click(button('刷新统计'));expect(card().querySelector('tbody tr')?.textContent).toContain('来源 6');
 await sevenDays();expect(card().querySelector('tbody tr')?.textContent).toContain('来源 1');expect(card().querySelector('.analytics-pagination')?.textContent).toContain('1 / 5');
});
const period = () => host.querySelector('.analytics-date-menu')!.textContent;
const selected = () => host.querySelector('[role="tab"][aria-selected="true"]')!.textContent;
it('removes report filters and ignores old dimension selections in saved URLs',async()=>{
  window.history.replaceState(null,'','/admin/?panel=analytics&country=CN&channel=search-referral&path=%2Farticle%2F');
  await render();
  expect(button('筛选报表')).toBeNull();expect(host.querySelector('.analytics-filter-tags')).toBeNull();
  for(const [path] of mocks.api.mock.calls.filter(([path])=>path.startsWith('analytics?'))){
    const query=new URLSearchParams(path.split('?')[1]);expect(query.has('country')).toBe(false);expect(query.has('channel')).toBe(false);expect(query.has('path')).toBe(false);expect(query.get('section')).not.toBe('filters');
  }
  await sevenDays();expect(new URLSearchParams(location.search).has('country')).toBe(false);
});

it('keeps the native report groups and avoids loading every report into the overview', async () => {
  mocks.api.mockImplementation(async (path: string) => {
    const data = fixture(path.split('?')[1]);
    data.crawlers = [
      { agent: 'googlebot', path: '/one/', status: 200, requests: 4 },
      { agent: 'googlebot', path: '/one/', status: 304, requests: 2 },
      { agent: 'googlebot', path: '/two/', status: 200, requests: 1 },
      { agent: 'googlebot', path: '/three/', status: 503, requests: 1 },
    ];
    return path.startsWith('analytics?') ? data : data.realtime;
  });
  await render();
  expect([...host.querySelectorAll('[role="tab"]')].map(node => node.textContent)).toEqual(['概览', '来源', '访客', '设备', '行为']);
  expect([...host.querySelectorAll('h2')].map(node => node.textContent)).toEqual(['搜索与 AI 来源趋势', '流量趋势', '流量概览', '页面排行']);
  expect(host.querySelector('[role="tablist"]')!.classList.contains('library-status-tabs')).toBe(true);
  expect(host.querySelectorAll('.panel-title .analytics-date-menu')).toHaveLength(0);
  expect(host.querySelector('.analytics-card footer .analytics-date-menu')).not.toBeNull();
  expect(host.querySelectorAll('.analytics-date-menu')).toHaveLength(1);
  expect(host.querySelector('.analytics-toolbar')).toBeNull();
  expect(host.querySelector('.analytics-metrics')).toBeNull();
  expect(host.querySelector('.analytics-local-options')).toBeNull();
  expect(host.querySelector('.analytics-comparison')).toBeNull();
  expect(host.querySelector('section[aria-label="流量趋势"] footer .analytics-date-menu')).toBeNull();
  expect(host.querySelector('section[aria-label="流量趋势"] footer .analytics-report-period')?.textContent).toBe(period());
  expect(host.querySelector('input[type="date"]')).toBeNull();
  await tab('来源'); expect(host.textContent).not.toContain('搜索与 AI 来源趋势'); expect(host.textContent).toContain('全球访客分布');
  expect(host.querySelectorAll('.analytics-date-menu')).toHaveLength(1);
  const countries = host.querySelectorAll<HTMLAnchorElement>('a[href*="dataset=countries"]');
  expect(countries).toHaveLength(1);expect(countries[0].getAttribute('aria-label')).toBe('导出国家 / 地区');
  await tab('设备'); expect(host.querySelectorAll('.analytics-section-grid > section')).toHaveLength(4);
  expect(host.querySelectorAll('.analytics-date-menu')).toHaveLength(1);
  await tab('访客'); expect(host.textContent).toContain('最新访客'); expect(host.textContent).toContain('当前在线');
  expect(host.querySelectorAll('.analytics-date-menu')).toHaveLength(1);
  await tab('行为');
  const crawlerCard = [...host.querySelectorAll('h2')].find(heading => heading.textContent === '爬虫请求')!.closest('section')!;
  expect([...crawlerCard.querySelector('table')!.querySelectorAll('tbody tr:first-child td')].map(cell => cell.textContent)).toEqual(['googlebot', '2', '8']);
  expect(crawlerCard.querySelector('summary')?.textContent).toBe('按页面查看');
  expect(host.querySelectorAll('.analytics-date-menu')).toHaveLength(1);
  expect(mocks.api.mock.calls.filter(([path]) => path.startsWith('analytics?')).map(([path])=>new URLSearchParams(path.split('?')[1]).get('section'))).toEqual(['overview','sources','devices','visitors','actions']);
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

it('shares the footer date selection across report groups and detailed exports', async () => {
  await render();await tab('来源');await sevenDays();
  expect(selected()).toBe('来源');expect(period()).toContain('近 7 天');
  expect(host.querySelector<HTMLAnchorElement>('a[href*="dataset=countries"]')!.href).toContain('start=2026-10-29');
  await tab('概览');expect(period()).toContain('近 7 天');
  const count=mocks.api.mock.calls.length;
  await click(host.querySelector('section[aria-label="流量趋势"] footer a'));
  expect(selected()).toBe('概览');
  const url=host.querySelector<HTMLAnchorElement>('a[href*="dataset=daily"]')!.href;
  expect(url).toContain('start=2026-10-29');expect(url).toContain('dataset=daily');expect(url).not.toContain('channel=');
  expect(host.querySelectorAll('a[href*="dataset=daily"]')).toHaveLength(1);expect(host.querySelectorAll('.analytics-date-menu')).toHaveLength(1);
  expect(host.querySelector('.analytics-trend svg')).not.toBeNull();
  expect(host.querySelector('[aria-label="趋势显示方式"]')).toBeNull();
  await click(host.querySelector('.analytics-report-heading a'));expect(period()).toContain('近 7 天');expect(mocks.api.mock.calls.length).toBe(count);
});

it('keeps navigation and retry available after a query fails without exporting stale data', async () => {
  await render(); mocks.fail = true; await sevenDays();
  expect(host.querySelector('[role="alert"]')!.textContent).toContain('暂时无法读取');
  expect(host.querySelectorAll('[role="tab"]')).toHaveLength(5);
  expect(button('统计日期范围')).not.toBeNull();
  expect(host.querySelectorAll('.analytics-date-menu')).toHaveLength(1);
  expect(host.querySelector('.analytics-export')).toBeNull();
  expect(host.querySelector('.analytics-metrics')).toBeNull();
  mocks.fail = false;
  await click([...host.querySelectorAll('[role="alert"] button')].find(node => node.textContent === '重试')!);
  expect(host.querySelector('[role="alert"]')).toBeNull();
  expect(period()).toContain('近 7 天');
});

it('restores the selected group and dates from a refreshed URL or browser history', async () => {
  window.history.replaceState(null, '', '/admin/?panel=analytics&section=devices&start=2026-10-29&end=2026-11-04&country=CN');
  await render();
  expect(selected()).toBe('设备'); expect(period()).toContain('近 7 天');
  expect(host.querySelector('.analytics-filter-tags')).toBeNull();
  await act(async () => root.unmount()); root = createRoot(host); await render();
  expect(selected()).toBe('设备');
  await act(async () => { window.history.replaceState(null, '', '/admin/?panel=analytics&section=visitors&start=2026-10-06&end=2026-11-04'); window.dispatchEvent(new PopStateEvent('popstate')); });
  expect(selected()).toBe('访客'); expect(period()).toContain('近 30 天');
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
  expect(period()).toContain('2026-10-01 — 2026-11-01');
  await tab('设备'); expect(period()).toContain('2026-10-01 — 2026-11-01');
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

it('keeps current source trends in the chart without a data mode or comparison controls',async()=>{
  mocks.api.mockImplementation(async(path:string)=>{
    const data=fixture(path.split('?')[1]);
    data.daily=Array.from({length:7},(_,i)=>({...data.daily[0],date:'2026-10-'+(29+i)}));
    data.engines=['Google','Bing','DuckDuckGo','ChatGPT'].map((name,i)=>({name,channel:'search-referral',views:[40,25,1,0][i],previousViews:100,daily:data.daily.map((day:any,j:number)=>({date:day.date,views:i===0?j+1:i===1?7-j:i===2&&j===1?1:0})),previousDaily:data.daily.map((day:any)=>({date:day.date,views:100}))}));
    return path.startsWith('analytics?')?data:data.realtime;
  });
  await render();
  const card=[...host.querySelectorAll('h2')].find(node=>node.textContent==='搜索与 AI 来源趋势')!.closest('section')!;
  const lines=()=>[...card.querySelectorAll('[data-series]')].map(node=>node.getAttribute('data-series'));
  expect(lines()).toEqual(['Google','Bing']);expect(card.querySelector('polyline[stroke-dasharray]')).toBeNull();expect(host.textContent).not.toContain('上期');
  await click(card.querySelector('[aria-label="显示或隐藏DuckDuckGo"]'));expect(lines()).toEqual(['Google','Bing','DuckDuckGo']);
  await click(button('刷新统计'));expect(lines()).toEqual(['Google','Bing','DuckDuckGo']);
  await act(async()=>card.querySelector('svg')!.dispatchEvent(new KeyboardEvent('keydown',{key:'End',bubbles:true})));
  expect(card.querySelector('[role="status"]')?.textContent).toContain('Google');expect(card.querySelector('[role="status"]')?.textContent).not.toContain('上期');
  expect(card.querySelector('[aria-label="趋势显示方式"],table')).toBeNull();
  expect(card.querySelector('[aria-label="显示或隐藏ChatGPT"]')).not.toBeNull();
  expect(card.querySelector('footer .analytics-date-menu')).not.toBeNull();
});
it('shows only selected-period values in overview and detailed traffic charts',async()=>{
 await render();
 const verify=()=>{
  expect(host.textContent).not.toMatch(/上期|同期|新增|\+\d+%/);
  expect(host.querySelector('.analytics-comparison,[aria-label="趋势显示方式"]')).toBeNull();
  const chart=[...host.querySelectorAll('h2')].find(node=>node.textContent==='流量趋势')!.closest('section')!;
  expect([...chart.querySelectorAll('[data-series]')].map(line=>line.getAttribute('data-series'))).toEqual(['访客','浏览量']);
  expect(chart.querySelector('polyline[stroke-dasharray]')).toBeNull();
  return chart;
 };
 verify();await click(host.querySelector('a[href*="report=traffic"]'));const chart=verify();
 await act(async()=>chart.querySelector('svg')!.dispatchEvent(new KeyboardEvent('keydown',{key:'End',bubbles:true})));
 expect(chart.querySelector('[role="status"]')?.textContent).not.toContain('上期');
});
