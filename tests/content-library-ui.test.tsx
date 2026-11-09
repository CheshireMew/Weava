// @vitest-environment happy-dom
import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ContentEntries } from '../apps/admin/src/ContentEntries.tsx';
import { ContentLibrary } from '../apps/admin/src/ContentLibrary.tsx';

vi.mock('../apps/admin/src/AuthoringControls.tsx', () => ({ SavedViewControls: () => null }));
let host: HTMLDivElement, root: Root;
beforeEach(() => { (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; host = document.createElement('div'); document.body.append(host); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });
function model() {
  const current = {
    tab: 'content', record: null, state: { types: [{ id: 'post', value: { id: 'post', label: '文章', fields: [{ key: 'rating', label: '评分' }], admin: { columns: ['title', 'status', 'rating'] } } }] },
    items: [{ id: 'entry-1', revision: 7, published: true, updatedAt: '2026-11-01T00:00:00Z', value: { title: '已有文章', type: 'post', status: 'published', fields: { rating: 5 } } }],
    libraryLoading: false, filter: '', searchTerm: '', bulkIds: [], setBulkIds: vi.fn(), select: vi.fn(), status: 'all', setStatus: vi.fn(),
    visibility: 'all', libraryType: '', librarySort: '', fieldFilters: {}, library: { total: 1, pages: 1 }, libraryPage: 1,
    setFilter: vi.fn(), setLibraryPage: vi.fn(), setLibrarySort: vi.fn(), setVisibility: vi.fn(), setLibraryType: vi.fn(), setFieldFilters: vi.fn(),
    duplicateEntry: vi.fn(), deleteEntry: vi.fn(), setError: vi.fn(),newEntry:vi.fn(async()=>{}),openBulk:vi.fn(async()=>{}),
  } as any;
  current.actions={tab:current.tab,setError:current.setError,select:current.select,duplicateEntry:current.duplicateEntry,deleteEntry:current.deleteEntry};
  return current;
}

it('asks for the creation type when viewing all types and names filtered creation explicitly',async()=>{
  const current=model();
  current.state.types.unshift({id:'doc',value:{id:'doc',label:'文档',fields:[]}});
  await act(async()=>root.render(<ContentLibrary model={current}/>));
  await act(async()=>host.querySelector<HTMLButtonElement>('[aria-label="新建内容"]')!.click());
  const choice=document.querySelector('[role="menu"][aria-label="新建内容"]')!;
  expect(choice.textContent).toContain('新建文档');
  await act(async()=>[...choice.querySelectorAll('button')].find(button=>button.textContent==='新建文章')!.click());
  expect(current.newEntry).toHaveBeenCalledWith('post');
  current.libraryType='doc';
  await act(async()=>root.render(<ContentLibrary model={current}/>));
  await act(async()=>host.querySelector<HTMLButtonElement>('[aria-label="新建文档"]')!.click());
  expect(current.newEntry).toHaveBeenLastCalledWith('doc');
});
it('reaches batch editing from the default library and clears selections when leaving selection mode', async () => {
  const current=model();
  function Library() { const [ids,setIds]=useState<string[]>([]); return <ContentLibrary model={{...current,bulkIds:ids,setBulkIds:setIds}}/>; }
  await act(async()=>root.render(<Library/>));
  const click=async(text:string)=>act(async()=>[...host.querySelectorAll('button')].find(button=>button.textContent===text)!.click());
  expect(host.querySelector('[aria-label="全选本页内容"]')).toBeNull();
  await click('批量选择');
  await act(async()=>host.querySelector<HTMLInputElement>('[aria-label="全选本页内容"]')!.click());
  await click('批量编辑（1）'); expect(current.openBulk).toHaveBeenCalledOnce();
  await click('取消选择'); await click('批量选择');
  expect(host.querySelector<HTMLInputElement>('[aria-label="批量选择 已有文章"]')!.checked).toBe(false);
  expect(host.textContent).not.toContain('批量编辑（');
});
it('identifies types in the mixed library and removes redundant type labels after filtering',async()=>{
  const current=model();current.state.types.push({id:'doc',value:{id:'doc',label:'文档',fields:[]}});
  current.items.push({...current.items[0],id:'doc',value:{...current.items[0].value,type:'doc',title:'文档条目'}});
  await act(async()=>root.render(<ContentLibrary model={current}/>));
  expect(host.querySelector('h1')?.textContent).toBe('内容');
  expect([...host.querySelectorAll('.publication-type')].map(node=>node.textContent)).toEqual(['文章','文档']);
  current.libraryType='doc';current.items=current.items.slice(1);
  await act(async()=>root.render(<ContentLibrary model={current}/>));
  expect(host.querySelector('h1')?.textContent).toBe('文档');expect(host.querySelector('.publication-type')).toBeNull();
});
it('keeps active conditions visible and clearable even when the filtered library has results',async()=>{
  const current=model();current.libraryType='post';current.status='changed';current.visibility='private';current.fieldFilters={rating:'5'};
  await act(async()=>root.render(<ContentLibrary model={current}/>));
  const conditions=host.querySelector('[aria-label="已生效的筛选"]')!;
  expect(conditions.textContent).toContain('文章');expect(conditions.textContent).toContain('有未发布修改');expect(conditions.textContent).toContain('私密');expect(conditions.textContent).toContain('评分：5');
  await act(async()=>[...conditions.querySelectorAll('button')].find(button=>button.textContent==='清除筛选')!.click());
  expect(current.setLibraryType).toHaveBeenCalledWith('');expect(current.setStatus).toHaveBeenCalledWith('all');expect(current.setVisibility).toHaveBeenCalledWith('all');expect(current.setFieldFilters).toHaveBeenCalledWith({});
});

it('keeps configured fields, opening and batch selection without redundant status badges', async () => {
  const current = model();
  await act(async () => root.render(<ContentEntries model={current} selectable />));
  expect(host.textContent).toContain('评分：5');
  expect(host.querySelector('.publication-meta')?.textContent).toContain('已发布');
  expect(host.querySelector('.entry-state')).toBeNull();
  await act(async () => host.querySelector<HTMLButtonElement>('.publication-open')!.click());
  expect(current.select).toHaveBeenCalledWith('entry-1');
  await act(async () => host.querySelector<HTMLInputElement>('[aria-label="批量选择 已有文章"]')!.click());
  expect(current.setBulkIds.mock.calls[0][0]([])).toEqual(['entry-1']);
});

it('shows the publication state once beside the date instead of the content type or a badge', async () => {
  const current = model();
  current.state.types[0].value.admin.columns = ['type', 'updatedAt'];
  for (const [published, hasChanges, state, label] of [
    [false, true, 'draft', '草稿'],
    [true, false, 'published', '已发布'],
    [true, true, 'published', '已发布（有未发布修改）'],
    [false, false, 'archived', '已归档'],
  ] as const) {
    const row = current.items[0];
    row.published = published; row.hasChanges = hasChanges; row.value.status = state;
    await act(async () => root.render(<ContentEntries model={current} />));
    const meta = host.querySelector('.publication-meta')!;
    expect(meta.querySelector('time')).not.toBeNull();
    expect(meta.textContent).toContain(label); expect(meta.textContent).not.toContain('文章');
    expect(host.querySelector('.entry-state')).toBeNull();
    expect(host.querySelector('.publication-copy')!.textContent!.split(label)).toHaveLength(2);
  }
});

it('shows the original public date, live metrics and published URL independently of later draft changes', async () => {
  const current = model(), row = current.items[0];
  current.state.types[0].value.admin.columns = ['updatedAt'];
  row.updatedAt = '2026-11-06T12:00:00Z';
  row.value.publishedAt = '2026-11-06T12:00:00Z';
  row.value.path = '/unpublished-change/';
  row.publication = {publishedAt: '2026-07-21T04:00:00Z', path: '/original-article/'};
  row.metrics = {likes: 12, comments: 3, views: 1234};
  await act(async () => root.render(<ContentEntries model={current} />));
  expect(host.querySelector('time')?.dateTime).toBe('2026-07-21T04:00:00Z');
  expect(host.querySelector('.publication-meta')?.textContent).not.toContain('更新于');
  for (const label of ['点赞：12', '评论：3', '浏览量：1234']) expect(host.querySelector('[aria-label="'+label+'"]')).not.toBeNull();
  const link = host.querySelector<HTMLAnchorElement>('a[aria-label="打开文章：已有文章"]')!;
  expect(link.getAttribute('href')).toBe('/original-article/'); expect(link.target).toBe('_blank');
  link.addEventListener('click', event => event.preventDefault(), {once: true});
  await act(async () => link.click()); expect(current.select).not.toHaveBeenCalled();
  row.metrics = {likes: 0, comments: 0, views: 0};
  await act(async () => root.render(<ContentEntries model={current} />));
  expect(host.querySelector('[aria-label="浏览量：0"]')).not.toBeNull();
  row.published = false; row.value.status = 'draft';
  await act(async () => root.render(<ContentEntries model={current} />));
  expect(host.querySelector('.publication-metrics')).toBeNull(); expect(host.querySelector('.publication-visit')).toBeNull();
  expect(host.querySelector('time')?.dateTime).toBe(row.updatedAt);
});

it('keeps visible results openable while a new query settles, without selecting a stale batch', async () => {
  const current = { ...model(), filter: '新查询', searchTerm: '' };
  await act(async () => root.render(<ContentEntries model={current} selectable />));
  expect(host.querySelector<HTMLButtonElement>('.publication-open')!.disabled).toBe(false);
  await act(async()=>host.querySelector<HTMLButtonElement>('.publication-open')!.click());expect(current.select).toHaveBeenCalled();
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

it('opens filters above the library and restores focus on Escape without changing the selection', async () => {
  const current = model();
  await act(async () => root.render(<ContentLibrary model={current} />));
  const trigger = host.querySelector<HTMLButtonElement>('[aria-label="筛选内容"]')!;
  expect(host.querySelector('details')).toBeNull();
  await act(async () => trigger.click());
  const popup = document.querySelector('[role="dialog"][aria-label="筛选内容"]')!;
  expect(popup).not.toBeNull(); expect(host.contains(popup)).toBe(false);
  await act(async () => { const select = popup.querySelector<HTMLSelectElement>('[aria-label="更多内容状态"]')!; select.value = 'changed'; select.dispatchEvent(new Event('change', { bubbles: true })); });
  expect(current.setStatus).toHaveBeenCalledWith('changed');
  await act(async () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
  expect(document.querySelector('[role="dialog"][aria-label="筛选内容"]')).toBeNull();
  expect(document.activeElement).toBe(trigger);
});
