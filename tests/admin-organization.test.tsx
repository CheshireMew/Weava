// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { defaultSettings, type Revision, type Settings } from '@weava/contracts';
import { EditSessionsProvider } from '../apps/admin/src/EditSessions.tsx';
import SettingsPanel from '../apps/admin/src/SettingsPanel.tsx';
import Operations from '../apps/admin/src/Operations.tsx';
import { CommentSettings } from '../apps/admin/src/SiteSettingControls.tsx';
import { SearchDataPanel } from '../apps/admin/src/SearchDataPanel.tsx';
import { AdminNavigation } from '../apps/admin/src/AdminNavigation.tsx';

const mocks = vi.hoisted(() => ({ api: vi.fn() }));
vi.mock('../apps/admin/src/api.ts', () => ({ api: mocks.api }));
vi.mock('../apps/admin/src/Selectors.tsx', () => ({ useSelectors: () => ({ media: async () => null }) }));
let host: HTMLDivElement, root: Root;
let settings: Revision<Settings>;
const onError = vi.fn(), publish = vi.fn(), save = vi.fn();
beforeEach(() => {
  vi.useFakeTimers();
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  localStorage.clear(); onError.mockClear(); publish.mockReset(); save.mockReset(); mocks.api.mockReset();
  settings = { id: 'site', revision: 1, updatedAt: '', value: structuredClone(defaultSettings) };
  save.mockImplementation(async (value, revision) => ({ ...settings, value, revision: revision + 1 }));
  mocks.api.mockImplementation(async path => path === 'entries' ? [] : structuredClone(settings));
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); localStorage.clear(); vi.useRealTimers(); });
async function render(node: React.ReactNode) {
  await act(async () => root.render(<EditSessionsProvider>{node}</EditSessionsProvider>));
}
function button(text: string) {
  const found = [...host.querySelectorAll('button')].find(button => button.textContent === text || button.getAttribute('aria-label') === text);
  expect(found, text).toBeDefined(); return found!;
}
async function click(text: string) { await act(async () => button(text).click()); }
function field(text: string) {
  const named = [...host.querySelectorAll<HTMLInputElement>('input')].find(input => input.getAttribute('aria-label') === text);
  if (named) return named;
  const label = [...host.querySelectorAll('label')].find(label => label.firstChild?.textContent?.trim() === text);
  expect(label, text).toBeDefined(); return label!.querySelector('input')!;
}
async function fill(text: string, value: string) {
  await act(async () => {
    const input = field(text);
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
async function autosave() { await act(async () => { await vi.advanceTimersByTimeAsync(850); }); }

it('keeps website edits across section switches and saves the full settings without duplicate comment controls', async () => {
  await render(<SettingsPanel row={settings} themes={[]} panels={[]} layouts={[]} save={save} onError={onError} />);
  await fill('名称', '我的网站'); await click('外观'); await click('基本信息');
  expect(field('名称').value).toBe('我的网站');
  await click('导航与分类');
  expect(host.textContent).not.toContain('新评论需要审核');
  expect(host.textContent).not.toContain('添加分类');
  expect(host.textContent).not.toContain('保存设置');
  await autosave();
  expect(save).toHaveBeenCalledWith({ ...settings.value, name: '我的网站' }, 1);
  expect(publish).not.toHaveBeenCalled(); expect(onError).not.toHaveBeenCalled();
});

it('edits friend links in settings, preserves values across tabs, and leaves unrelated legacy information untouched', async () => {
  const defaults = { about: { enabled: true, path: '/about/', text: '原介绍' }, friends: { enabled: true, path: '/friendlink/', links: [{ name: '原网站', url: 'https://old.example/', description: '原说明' }] } };
  await render(<SettingsPanel row={settings} themes={[]} panels={[]} layouts={[]} siteInfo={defaults} save={save} onError={onError} />);
  await click('友情链接');
  expect(field('网站名称').value).toBe('原网站');
  expect(save).not.toHaveBeenCalled();
  await fill('网站名称', '新网站'); await fill('网址', 'https://new.example/');
  await click('关于本站'); await click('友情链接');
  expect(field('网站名称').value).toBe('新网站');
  await autosave();
  expect(save).toHaveBeenCalledWith(expect.objectContaining({ siteInfo: { friends: { enabled: true, path: '/friendlink/', links: [{ name: '新网站', url: 'https://new.example/', description: '原说明' }] } } }), 1);
  expect(publish).not.toHaveBeenCalled(); expect(onError).not.toHaveBeenCalled();
});

it('automatically applies taxonomy edits without a separate publish action', async () => {
  const term = { id: 'writing', label: '写作', slug: 'writing', kind: 'category' as const };
  const sequence: string[] = [];
  mocks.api.mockImplementation(async (path, input) => {
    expect(path).toBe('terms'); sequence.push('term');
    return { id: term.id, revision: 3, value: input.value };
  });
  save.mockImplementation(async value => { sequence.push('settings'); return { ...settings, revision: 2, value }; });
  publish.mockImplementation(async () => { sequence.push('publish'); });
  await render(<SettingsPanel row={settings} themes={[]} panels={[]} layouts={[]} terms={[{ id: term.id, revision: 2, value: term }]} refresh={vi.fn(async () => {})} applyTerms={publish} save={save} onError={onError} />);
  await click('导航与分类');
  expect(host.querySelectorAll('h1')).toHaveLength(1);
  expect(host.textContent).not.toContain('发布分类和标签');
  expect(host.textContent).not.toContain('发布首页目录');
  await click('编辑分类 写作'); await fill('分类或标签名称', '写作与表达');
  expect(host.querySelector('dialog[open] .taxonomy-edit-fields details')).toBeNull();
  expect(host.querySelector('dialog[open] [aria-label="上级分类"]')).not.toBeNull();
  await click('完成');
  expect(host.querySelector('dialog[open]')).toBeNull();
  await click('基本信息'); await fill('名称', '修改后的站名'); await click('导航与分类');
  await autosave();
  expect(mocks.api).toHaveBeenCalledWith('terms', { value: { ...term, label: '写作与表达' }, revision: 2 });
  expect(save).toHaveBeenCalledWith(expect.objectContaining({ name: '修改后的站名' }), 1);
  expect(sequence).toEqual(['term', 'publish', 'settings']);
  expect(publish).toHaveBeenCalledTimes(1); expect(onError).not.toHaveBeenCalled();
});

it('retains an unsuccessful term edit and stops publishing the integrated settings', async () => {
  const term = { id: 'writing', label: '写作', slug: 'writing', kind: 'category' as const };
  mocks.api.mockRejectedValue(new Error('分类已在其他窗口修改'));
  await render(<SettingsPanel row={settings} themes={[]} panels={[]} layouts={[]} terms={[{ id: term.id, revision: 2, value: term }]} initialSection="navigation" applyTerms={publish} save={save} onError={onError} />);
  await click('编辑分类 写作'); await fill('分类或标签名称', '新名称'); await autosave();
  expect(host.textContent).toContain('分类已在其他窗口修改');
  expect(save).not.toHaveBeenCalled(); expect(publish).not.toHaveBeenCalled();
  expect(field('分类或标签名称').value).toBe('新名称');
});

it('automatically saves every advertising toggle and retains the HTML without manual save controls', async () => {
  const slots = ['siteTop', 'siteBottom', 'articleTop', 'articleBottom'] as const;
  settings.value.advertisements = Object.fromEntries(slots.map(id => [id, { enabled: true, html: '<div>' + id + '</div>' }]));
  await render(<SettingsPanel row={settings} themes={[]} panels={[]} layouts={[]} save={save} onError={onError} />);
  await click('广告');
  await act(async () => {
    for (const button of host.querySelectorAll<HTMLButtonElement>('[role="switch"][aria-label^="启用"]')) button.click();
  });
  await autosave();
  const stored = save.mock.calls[0][0];
  for (const id of slots) expect(stored.advertisements[id]).toEqual({ enabled: false, html: '<div>' + id + '</div>' });
  expect(publish).not.toHaveBeenCalled(); expect(onError).not.toHaveBeenCalled();
  expect(host.textContent).not.toContain('保存并应用');
});

it('merges an independent category update when autosaving website settings', async () => {
  const remote = { ...settings, revision: 3, value: { ...settings.value, taxonomies: [{ id: 'writing', label: '新分类名', kind: 'category' as const }] } };
  save.mockRejectedValueOnce(Object.assign(new Error('版本已变化'), { status: 409 }));
  mocks.api.mockResolvedValue(remote);
  await render(<SettingsPanel row={settings} themes={[]} panels={[]} layouts={[]} save={save} onError={onError} />);
  await fill('名称', '我的新站名'); await autosave();
  expect(save.mock.calls[1]).toEqual([{ ...remote.value, name: '我的新站名' }, 3]);
  expect(host.querySelector('.panel-title')?.textContent).toBe('网站设置');
  expect(host.textContent).not.toContain('已保存并生效');
});

it('keeps both inputs intact when the same setting changed elsewhere', async () => {
  save.mockRejectedValueOnce(Object.assign(new Error('版本已变化'), { status: 409 }));
  mocks.api.mockResolvedValue({ ...settings, revision: 3, value: { ...settings.value, name: '其他窗口的名称' } });
  await render(<SettingsPanel row={settings} themes={[]} panels={[]} layouts={[]} save={save} onError={onError} />);
  await fill('名称', '当前输入'); await autosave();
  expect(save).toHaveBeenCalledTimes(1); expect(field('名称').value).toBe('当前输入');
  expect(host.textContent).toContain('同一项设置已在其他窗口修改'); expect(publish).not.toHaveBeenCalled();
});

it('retains comment changes and requests a reload when another page changed that same setting', async () => {
  await render(<CommentSettings settings={settings} saveSettings={save} onError={onError} />);
  await act(async () => host.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click());
  mocks.api.mockResolvedValue({ ...settings, revision: 3, value: { ...settings.value, commentModeration: false } });
  await autosave();
  expect(host.textContent).toContain('其他页面修改');
  expect(save).not.toHaveBeenCalled(); expect(publish).not.toHaveBeenCalled();
  expect(host.querySelector<HTMLInputElement>('input[type="checkbox"]')!.checked).toBe(false);
});

it('shows task names and statuses in Chinese and keeps maintenance out of the backup section', async () => {
  await render(<Operations state={{ releases: [], jobs: [{ id: 'job', operation: 'backup', status: 'failed', message: '空间不足' }] }} task={vi.fn()} refresh={vi.fn()} onError={onError} openLogs={vi.fn()} />);
  expect(host.querySelector('[role="tabpanel"]:not([hidden])')?.textContent).toContain('创建备份');
  expect(mocks.api).not.toHaveBeenCalled();
  await click('任务记录');
  const current = host.querySelector('[role="tabpanel"]:not([hidden])')!;
  expect(current.textContent).toContain('创建备份 · 失败');
  expect(current.textContent).not.toContain('backup'); expect(current.textContent).not.toContain('failed');
});

it('presents imported search results as readable rows with pagination rather than raw JSON', async () => {
  const pages = Array.from({ length: 21 }, (_, index) => ({ url: 'https://example.com/' + index, date: '2026-11-03', clicks: index, impressions: 30 }));
  await render(<SearchDataPanel data={{ datasets: [{ id: 'search', provider: 'Google', property: 'example.com', kind: 'search-performance', start: '2026-11-01', end: '2026-11-03', rows: 21, pages }] }} refresh={vi.fn()} execute={async action => action()} busy={false} />);
  expect(host.querySelector('pre')).toBeNull();
  expect(host.textContent).toContain('搜索表现'); expect(host.querySelectorAll('tbody tr')).toHaveLength(20);
  await click('下一页'); expect(host.querySelectorAll('tbody tr')).toHaveLength(1);
  expect(host.querySelector('tbody')?.textContent).toContain('https://example.com/20');
});

it('keeps everyday navigation without hidden maintenance pages or a more-management group', async () => {
  const props = { compact: false, state: null, setMenu: vi.fn(), navigate: vi.fn(), logout: vi.fn() };
  await render(<AdminNavigation {...props} tab="content" />);
  expect(host.querySelector('details')).toBeNull();
  expect(host.textContent).not.toContain('网站页面');
  expect(host.textContent).not.toContain('模板与布局');
  expect([...host.querySelectorAll('button')].some(item => item.textContent === '分类与标签')).toBe(false);
  expect(host.textContent).not.toContain('网址别名');
  expect(host.textContent).not.toContain('网站检查');
  expect(host.textContent).not.toContain('更多管理');
  expect(button('文章').getAttribute('aria-current')).toBe('page');
  const identity = { settings: { value: { name: '我的网站', logo: '/media/site-logo.png' } } };
  await render(<AdminNavigation {...props} state={identity} tab="content" />);
  expect(host.querySelector('.app-brand img')?.getAttribute('src')).toBe('/media/site-logo.png');
  await render(<AdminNavigation {...props} state={{ ...identity, siteIcon: '/media/optimized/site-logo-480.webp' }} tab="content" />);
  expect(host.querySelector('.app-brand img')?.getAttribute('src')).toBe('/media/optimized/site-logo-480.webp');
  expect(host.querySelector('.brand-mark')).toBeNull();
  await render(<AdminNavigation {...props} state={{ settings: { value: { ...identity.settings.value, logo: '/media/new-logo.png' } } }} tab="content" />);
  expect(host.querySelector('.app-brand img')?.getAttribute('src')).toBe('/media/new-logo.png');
  await render(<AdminNavigation {...props} tab="content" />);
  expect(host.querySelector('.app-brand img')).toBeNull();
  expect(host.querySelector('.brand-mark')?.textContent).toBe('W');
});

it('WVA-05 keeps the home link on the current private admin entrance', async () => {
  const previous = location.href;
  history.replaceState(null, '', '/private-owner/?panel=account');
  try {
    await render(<AdminNavigation compact={false} state={null} tab="account" setMenu={vi.fn()} navigate={vi.fn()} logout={vi.fn()} />);
    expect(host.querySelector('.app-brand')?.getAttribute('href')).toBe('/private-owner/');
  } finally { history.replaceState(null, '', previous); }
});

it('WVA-06 hides content-only maintenance while retaining backups, tasks and storage inspection', async () => {
  await render(<Operations state={{ features: ['media'], releases: [], jobs: [] }} task={vi.fn()} refresh={vi.fn()} onError={onError} openLogs={vi.fn()} />);
  const labels = [...host.querySelectorAll('[role="tab"]')].map(tab => tab.textContent);
  expect(labels).not.toContain('导入与导出'); expect(labels).not.toContain('发布记录');
  expect(labels).toEqual(expect.arrayContaining(['备份', '任务记录', '维护']));
  await click('维护');
  expect(host.textContent).toContain('检查占用'); expect(host.textContent).not.toContain('历史归档');
});
