// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { entrySchema, defaultSettings } from '@weava/contracts';
import { EditorialFields } from '../apps/admin/src/EditorialFields.tsx';
import { SidebarSettings, legacySidebar } from '../apps/admin/src/SidebarSettings.tsx';
import { SiteInfoSettings } from '../apps/admin/src/SiteInfoSettings.tsx';
import { FeaturedSettings } from '../apps/admin/src/FeaturedSettings.tsx';
import { SeoFields } from '../apps/admin/src/SeoFields.tsx';
import { AdvertisementSettings } from '../apps/admin/src/AdvertisementSettings.tsx';
import { api } from '../apps/admin/src/api.ts';
import { adminPanel } from '../apps/admin/src/admin-location.ts';
import { Card, AnalyticsExportContext } from '../apps/admin/src/analytics/Card.tsx';

vi.mock('../apps/admin/src/api.ts', () => ({ api: vi.fn() }));
vi.mock('../apps/admin/src/Selectors.tsx', () => ({ useSelectors: () => ({ media: async () => ({ url: '/media/new.png', name: '图片' }) }) }));
let host: HTMLDivElement, root: Root;
beforeEach(() => { (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; host = document.createElement('div'); document.body.append(host); root = createRoot(host); vi.mocked(api).mockReset(); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });
async function render(node: React.ReactNode) { await act(async () => root.render(node)); }
async function input(selector: string, value: string) { await act(async () => { const field = host.querySelector<HTMLInputElement | HTMLTextAreaElement>(selector)!; const proto = field.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(field, value); field.dispatchEvent(new Event('input', { bubbles: true })); }); }

it('uses one optional summary and keeps editorial metadata without exposing document configuration', async () => {
  const value = entrySchema.parse({ kind: 'content', title: '文章', path: '/post/', id: 'post', evidence: [{ id: 'e', claim: '事实', title: '来源', url: 'https://example.com', status: 'verified' }], documentation: { group: '旧文档', order: 4 }, editorial: { featured: true, weight: 200, relatedIds: ['related'] } });
  const change = vi.fn(); await render(<EditorialFields value={value} entries={[]} onChange={change} />);
  expect(host.querySelector('select,input[type="number"]')).toBeNull();
  expect(host.textContent).not.toMatch(/文档导航|核验|推荐排序|选择推荐内容/); expect(change).not.toHaveBeenCalled();
  await input('textarea', '手写摘要'); expect(change).toHaveBeenLastCalledWith({ description: '手写摘要', summaryMode: 'auto' });
  await act(async () => host.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click());
  expect(change).toHaveBeenLastCalledWith({ editorial: { featured: false, weight: 200, relatedIds: ['related'] } });
});
it('lets filled information decide visibility and removes visibility switches', async () => {
  const change = vi.fn(); await render(<SiteInfoSettings section="about" value={{ about: { enabled: false, path: '/about/', text: '' } }} onChange={change} />);
  expect(host.querySelector('input[type="checkbox"]')).toBeNull(); await input('textarea', '我的介绍');
  expect(change.mock.calls[0][0].about).toMatchObject({ enabled: true, text: '我的介绍' });
  await render(<SiteInfoSettings section="about" value={change.mock.calls[0][0]} onChange={change} />);
  await input('textarea', ''); expect(change.mock.calls[1][0].about.enabled).toBe(false);
});
it('offers normal sidebar fields and only converts legacy markup after an explicit edit', async () => {
  const html = '<style>.a{color:red}</style><a href="https://example.com" aria-label="社交主页"><svg></svg></a><div class="oc-support-box">支持创作</div>';
  expect(legacySidebar(html)).toEqual({ text: '支持创作', links: [{ label: '社交主页', url: 'https://example.com' }] });
  const change = vi.fn(), settings = { ...defaultSettings, extensions: { newsletter: { sidebarHtml: html } } };
  await render(<SidebarSettings value={settings} onChange={change} />); expect(change).not.toHaveBeenCalled();
  expect(host.textContent).not.toContain('HTML'); await input('textarea', '新的说明');
  expect(change).toHaveBeenCalledWith({ text: '新的说明', links: [{ label: '社交主页', url: 'https://example.com' }] }); expect(settings.extensions.newsletter.sidebarHtml).toBe(html);
});
it('allows homepage recommendation reordering without changing article revisions', async () => {
  vi.mocked(api).mockResolvedValue([{ id: 'first', published: true, value: { kind: 'content', title: '第一篇', editorial: { featured: true, weight: 1 } } }, { id: 'second', published: true, value: { kind: 'content', title: '第二篇', editorial: { featured: true, weight: 0 } } }] as any);
  const change = vi.fn(); await render(<FeaturedSettings order={[]} onChange={change} onError={vi.fn()} />);
  await act(async () => { const details = host.querySelector('details')!; details.open = true; details.dispatchEvent(new Event('toggle')); });
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="下移 第一篇"]')!.click());
  expect(change).toHaveBeenCalledWith(['second', 'first']); expect(api).toHaveBeenCalledTimes(1);
});
it('preserves existing search overrides without exposing schema or author identity controls', async () => {
  const change = vi.fn(), value = entrySchema.parse({ kind: 'content', title: '文章', path: '/post/', id: 'post', seo: { title: '旧搜索标题', schemaType: 'TechArticle', authorType: 'Organization', canonical: 'https://example.com/old/' } });
  await render(<SeoFields value={value} onChange={change} expanded />); expect(change).not.toHaveBeenCalled();
  expect(host.querySelector('select')).toBeNull(); expect(host.textContent).not.toMatch(/规范地址|作者身份|页面类型|核验/);
  await input('input', '新标题'); expect(change.mock.calls[0][0].seo).toMatchObject({ title: '新标题', schemaType: 'TechArticle', authorType: 'Organization', canonical: 'https://example.com/old/' });
});
it('defaults new advertisements to normal content fields while keeping third-party code optional', async () => {
  const change = vi.fn(); await render(<AdvertisementSettings value={undefined} onChange={change} />);
  expect(change).not.toHaveBeenCalled(); expect(host.querySelector('iframe')).toBeNull();
  const code = [...host.querySelectorAll('details')].find(details => details.querySelector('summary')?.textContent === '接入第三方广告代码')!;
  expect(code.open).toBe(false); await input('input:not([type="checkbox"])', '赞助商');
  expect(change.mock.calls[0][0].siteTop.content).toEqual({ title: '赞助商', text: '', image: '', url: '' });
});
it('retires browser routes while leaving publication plans available to external tools', () => {
  expect(adminPanel('?panel=types')).toBe('content'); expect(adminPanel('?panel=publication-plans')).toBe('content');
});
it('exports the visible report and its applied filters including the initial unfiltered view', async () => {
  await render(<AnalyticsExportContext.Provider value=""><Card title="页面排行"><p>排行</p></Card></AnalyticsExportContext.Provider>);
  expect(host.querySelector('a')!.getAttribute('href')).toContain('dataset=pages');
  await render(<AnalyticsExportContext.Provider value="start=2026-11-01&end=2026-11-04&channel=search"><Card title="访问来源"><p>来源</p></Card></AnalyticsExportContext.Provider>);
  const url = host.querySelector('a')!.getAttribute('href')!;
  expect(url).toContain('channel=search'); expect(url).toContain('dataset=sources');
});
