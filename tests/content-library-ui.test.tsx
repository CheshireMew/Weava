// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ContentEntries } from '../apps/admin/src/ContentEntries.tsx';
import { ContentLibrary } from '../apps/admin/src/ContentLibrary.tsx';

vi.mock('../apps/admin/src/AuthoringControls.tsx', () => ({ SavedViewControls: () => null }));
let host: HTMLDivElement, root: Root;
beforeEach(() => { (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; host = document.createElement('div'); document.body.append(host); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });
function model() {
  return {
    tab: 'content', record: null, state: { types: [{ id: 'post', value: { id: 'post', label: '文章', fields: [{ key: 'rating', label: '评分' }], admin: { columns: ['title', 'status', 'rating'] } } }] },
    items: [{ id: 'entry-1', revision: 7, published: true, updatedAt: '2026-11-01T00:00:00Z', value: { title: '已有文章', type: 'post', status: 'published', fields: { rating: 5 } } }],
    libraryLoading: false, filter: '', searchTerm: '', bulkIds: [], setBulkIds: vi.fn(), select: vi.fn(), status: 'all', setStatus: vi.fn(),
    visibility: 'all', libraryType: '', librarySort: '', fieldFilters: {}, library: { total: 1, pages: 1 }, libraryPage: 1,
    setFilter: vi.fn(), setLibraryPage: vi.fn(), setLibrarySort: vi.fn(), setVisibility: vi.fn(), setLibraryType: vi.fn(), setFieldFilters: vi.fn(),
    duplicateEntry: vi.fn(), deleteEntry: vi.fn(), setError: vi.fn(),
  } as any;
}

it('keeps configured fields, opening and batch selection without redundant status badges', async () => {
  const current = model();
  await act(async () => root.render(<ContentEntries model={current} selectable />));
  expect(host.textContent).toContain('评分：5');
  expect(host.textContent).not.toContain('已发布');
  expect(host.querySelector('.entry-state')).toBeNull();
  await act(async () => host.querySelector<HTMLButtonElement>('.publication-open')!.click());
  expect(current.select).toHaveBeenCalledWith('entry-1');
  await act(async () => host.querySelector<HTMLInputElement>('[aria-label="批量选择 已有文章"]')!.click());
  expect(current.setBulkIds.mock.calls[0][0]([])).toEqual(['entry-1']);
});

it('prevents opening or batch selection while displayed results are stale', async () => {
  const current = { ...model(), filter: '新查询', searchTerm: '' };
  await act(async () => root.render(<ContentEntries model={current} selectable />));
  expect(host.querySelector<HTMLButtonElement>('.publication-open')!.disabled).toBe(true);
  expect(host.querySelector<HTMLInputElement>('[aria-label="批量选择 已有文章"]')!.disabled).toBe(true);
  expect(host.querySelector<HTMLButtonElement>('[aria-haspopup="menu"]')!.disabled).toBe(true);
});

async function openMenu() {
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-haspopup="menu"]')!.click());
}
async function clickAction(label: string) {
  await act(async () => [...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find(button => button.textContent === label)!.click());
}
it('offers exactly edit, duplicate and delete, and wires edit and duplicate to the selected row', async () => {
  const current = model();
  await act(async () => root.render(<ContentEntries model={current} />));
  await openMenu();
  expect([...document.querySelectorAll('[role="menuitem"]')].map(item => item.textContent)).toEqual(['编辑', '复制', '删除']);
  expect(document.activeElement?.textContent).toBe('编辑');
  await clickAction('编辑');
  expect(current.select).toHaveBeenCalledWith('entry-1');
  await openMenu();
  await clickAction('复制');
  expect(current.duplicateEntry).toHaveBeenCalledWith(current.items[0]);
  expect(document.querySelector('[role="menu"]')).toBeNull();
});
it('requires delete confirmation and keeps a failed deletion visible for retry', async () => {
  const current = model();
  await act(async () => root.render(<ContentEntries model={current} />));
  await openMenu(); await clickAction('删除');
  expect(current.deleteEntry).not.toHaveBeenCalled();
  await act(async () => document.querySelector<HTMLButtonElement>('[data-autofocus]')!.click());
  expect(document.querySelector('dialog')).toBeNull();
  await openMenu(); await clickAction('删除');
  current.deleteEntry.mockRejectedValueOnce(new Error('内容已变化，请刷新列表后重试。'));
  await act(async () => document.querySelector<HTMLButtonElement>('.publication-delete-confirm')!.click());
  expect(document.querySelector('[role="alert"]')?.textContent).toContain('内容已变化');
  expect(document.querySelector('dialog')).not.toBeNull();
  current.deleteEntry.mockResolvedValueOnce(undefined);
  await act(async () => document.querySelector<HTMLButtonElement>('.publication-delete-confirm')!.click());
  expect(current.deleteEntry).toHaveBeenLastCalledWith(current.items[0]);
  expect(document.querySelector('dialog')).toBeNull();
});

it('uses the existing status and sorting setters from the new controls', async () => {
  const current = model();
  await act(async () => root.render(<ContentLibrary model={current} />));
  await act(async () => [...host.querySelectorAll('button')].find(button => button.textContent === '草稿')!.click());
  expect(current.setStatus).toHaveBeenCalledWith('draft');
  const sort = host.querySelector<HTMLSelectElement>('[aria-label="内容排序"]')!;
  expect(sort.value).toBe('-updatedAt');
  await act(async () => { sort.value = 'title'; sort.dispatchEvent(new Event('change', { bubbles: true })); });
  expect(current.setLibrarySort).toHaveBeenCalledWith('title');
  expect(current.setLibraryPage).toHaveBeenCalledWith(1);
});
