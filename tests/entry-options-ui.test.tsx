// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { entrySchema } from '@weava/contracts';
import { EntryOptionsBar } from '../apps/admin/src/EntryOptionsBar.tsx';
import { EntrySettings } from '../apps/admin/src/EntrySettings.tsx';

const mocks = vi.hoisted(() => ({ media: vi.fn(), content: vi.fn(), api: vi.fn() }));
vi.mock('../apps/admin/src/Selectors.tsx', () => ({ useSelectors: () => ({ media: mocks.media, content: mocks.content }) }));
vi.mock('../apps/admin/src/api.ts', () => ({ api: mocks.api }));
let host: HTMLDivElement, root: Root;
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  mocks.media.mockReset(); mocks.content.mockReset(); mocks.api.mockReset();
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });
function model() {
  const record = { id: 'article', revision: 7, value: entrySchema.parse({ id: 'article', kind: 'content', path: '/article/', title: '已有文章', author: '作者', indexable: false, termIds: { categories: [], tags: ['tag-1'] }, tags: ['旧标签'] }) };
  return { record, session: { record }, state: { types: [{ id: 'post', value: { id: 'post', label: '文章', fields: [] } }], terms: [{ id: 'category-1', value: { id: 'category-1', kind: 'category', label: '写作', slug: 'writing' } }, { id: 'tag-1', value: { id: 'tag-1', kind: 'tag', label: '旧标签', slug: 'old' } }], schedules: [], layouts: [], entries: [] },
    update: vi.fn(), setError: vi.fn(), busy: false, dirty: false, saving: false, scheduleDueAt: '', setScheduleDueAt: vi.fn(), persist: vi.fn(async () => record), refresh: vi.fn(async () => {}), notify: vi.fn(), select: vi.fn(),
  } as any;
}
async function click(label: string) {
  await act(async () => {
    const button = [...document.querySelectorAll<HTMLButtonElement>('button')].find(item => item.getAttribute('aria-label') === label || item.textContent === label);
    expect(button, label).toBeDefined(); button!.click();
  });
}
it('keeps five compact entry settings controls and opens taxonomy choices directly', async () => {
  const current = model();
  await act(async () => root.render(<EntryOptionsBar model={current} onMore={vi.fn()} />));
  expect(host.querySelectorAll('[role="group"] > button')).toHaveLength(5);
  expect(host.querySelector('aside')).toBeNull();
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  await click('设置分类');
  const choices = document.querySelector('[role="dialog"][aria-label="分类"]')!;
  expect(choices.querySelector('details')).toBeNull();
  expect(document.activeElement?.getAttribute('aria-label')).toBe('查找或新建分类');
  await act(async () => choices.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click());
  expect(current.update).toHaveBeenCalledWith({ categories: ['写作'], termIds: { categories: ['category-1'], tags: ['tag-1'] } });
});
it('uses switches for privacy and comments without changing search indexing', async () => {
  const current = model();
  await act(async () => root.render(<EntryOptionsBar model={current} onMore={vi.fn()} />));
  await click('设置发布选项');
  expect(document.querySelector('[aria-label="私密文章"]')?.getAttribute('aria-checked')).toBe('false');
  await click('私密文章'); await click('允许评论');
  expect(current.update.mock.calls.map((call: any[]) => call[0])).toEqual([{ visibility: 'private' }, { allowComments: false }]);
  expect(document.body.textContent).not.toContain('允许搜索引擎收录');
});
it('keeps cover selection, Escape dismissal and the more settings entry working', async () => {
  const current = model(), more = vi.fn(); mocks.media.mockResolvedValue({ url: '/media/new.webp' });
  await act(async () => root.render(<EntryOptionsBar model={current} onMore={more} />));
  await click('设置封面'); await click('选择封面');
  expect(current.update).toHaveBeenCalledWith({ cover: '/media/new.webp' });
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  await click('设置标签');
  await act(async () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  expect(document.activeElement?.getAttribute('aria-label')).toBe('设置标签');
  await click('更多设置'); expect(more).toHaveBeenCalledTimes(1);
});
it('keeps scheduling tied to the saved revision after moving it into publication options', async () => {
  const current = { ...model(), scheduleDueAt: '2030-01-01T10:00' };
  await act(async () => root.render(<EntryOptionsBar model={current} onMore={vi.fn()} />));
  await click('设置发布选项'); await click('安排发布');
  expect(current.persist).toHaveBeenCalledTimes(1);
  expect(mocks.api).toHaveBeenCalledWith('schedule', { id: 'article', revision: 7, dueAt: new Date(current.scheduleDueAt).toISOString() });
  expect(current.setScheduleDueAt).toHaveBeenCalledWith('');
  expect(current.notify).toHaveBeenCalledWith('定时发布已安排');
});
it('groups secondary settings and removes the indexing checkbox without resetting existing data', async () => {
  const current = model();
  await act(async () => root.render(<EntrySettings model={current} mode="more" />));
  expect(host.querySelectorAll('[role="tab"]')).toHaveLength(4);
  expect(host.textContent).not.toContain('选择分类'); expect(host.textContent).not.toContain('选择封面');
  expect(current.update).not.toHaveBeenCalled();
  await click('搜索与分享');
  expect(host.textContent).not.toContain('允许搜索引擎收录');
  const sharing = host.querySelector('[role="tabpanel"]:not([hidden])')!;
  expect(sharing.querySelector('input')).not.toBeNull();
  expect(sharing.textContent).not.toContain('来源与核验');
  expect(host.querySelector('input[type="checkbox"]')).toBeNull();
  await click('高级');
  expect(host.querySelector('[role="tabpanel"]:not([hidden])')?.textContent).toContain('来源与核验');
  expect(current.record.value.indexable).toBe(false);
  expect(current.update).not.toHaveBeenCalled();
});
