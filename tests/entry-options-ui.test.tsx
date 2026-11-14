import {contentCommands} from '../apps/admin/src/content-commands.ts';
// @vitest-environment happy-dom
import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { entrySchema,zonedDateTime,type Entry } from '@weava/contracts';
import { EntryOptionsBar } from '../apps/admin/src/EntryOptionsBar.tsx';
import { EntryUrlField } from '../apps/admin/src/EntryUrlField.tsx';
import { EntrySettings } from '../apps/admin/src/EntrySettings.tsx';
import { EntryMoreActions } from '../apps/admin/src/EntryMoreActions.tsx';

const mocks = vi.hoisted(() => ({ media: vi.fn(), content: vi.fn(), api: vi.fn() }));
vi.mock('../apps/admin/src/Selectors.tsx', () => ({ useSelectors: () => ({ media: mocks.media, content: mocks.content }) }));
vi.mock('../apps/admin/src/api.ts', () => ({ api: mocks.api, waitJob: async (job: unknown) => job }));
let host: HTMLDivElement, root: Root;
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  mocks.media.mockReset(); mocks.content.mockReset(); mocks.api.mockReset();
  localStorage.clear();
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });
it('offers withdrawal only for published content and has no fourth archive state',async()=>{
  const current=model(),withdraw=vi.fn();
  await act(async()=>root.render(<EntryMoreActions model={{record:current.record,withdraw}}/>));
  expect(host.textContent).not.toContain('撤下为草稿');expect(host.textContent).not.toContain('归档');
  current.record.value.status='published';
  await act(async()=>root.render(<EntryMoreActions model={{record:current.record,withdraw}}/>));
  await click('撤下为草稿');expect(withdraw).toHaveBeenCalledWith();
  current.record.value.status='draft';current.record.published=true;
  await act(async()=>root.render(<EntryMoreActions model={{record:current.record,withdraw}}/>));
  expect(host.textContent).toContain('撤下为草稿');
  current.record.value.status='published';current.record.published=false;
  await act(async()=>root.render(<EntryMoreActions model={{record:current.record,withdraw}}/>));
  expect(host.textContent).not.toContain('撤下为草稿');
});
function model() {
  const record = { id: 'article', revision: 7, value: entrySchema.parse({ id: 'article', kind: 'content', path: '/article/', title: '已有文章', author: '作者', indexable: false, termIds: { categories: [], tags: ['tag-1'] }, tags: ['旧标签'] }) };
  const current = { record, session: { record }, state: { domain:'https://example.com', authors:['已用作者'], types: [{ id: 'post', value: { id: 'post', label: '文章', fields: [] } }], terms: [{ id: 'category-1', revision: 4, value: { id: 'category-1', kind: 'category', label: '写作', slug: 'writing' } }, { id: 'tag-1', revision: 5, value: { id: 'tag-1', kind: 'tag', label: '旧标签', slug: 'old' } }], schedules: [], layouts: [], entries: [] },
    update: vi.fn(), setError: vi.fn(), busy: false, dirty: false, saving: false, scheduleDueAt: '', setScheduleDueAt: vi.fn(), persist: vi.fn(async () => record), refresh: vi.fn(async () => {}), notify: vi.fn(), select: vi.fn(),
  } as any;
  const commands=contentCommands({editor:current,library:{} as any,refresh:current.refresh,notify:current.notify});
  current.schedule={record,busy:false,get scheduleDueAt(){return current.scheduleDueAt;},setScheduleDueAt:current.setScheduleDueAt,items:current.state.schedules,setError:current.setError,create:commands.schedule,cancel:(id:string,revision:number)=>commands.changeSchedule('cancel',id,revision),retry:(id:string,revision:number)=>commands.changeSchedule('retry',id,revision)};
  current.moreActions={record,withdraw:commands.withdraw};
  return current;
}
async function click(label: string) {
  await act(async () => {
    const button = [...document.querySelectorAll<HTMLButtonElement>('button')].find(item => item.getAttribute('aria-label') === label || item.textContent === label);
    expect(button, label).toBeDefined(); button!.click();
  });
}
async function fill(input: HTMLInputElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
    input.dispatchEvent(new Event('input', {bubbles:true}));
  });
}
it('groups author, category and tags and changes the address when choosing a category', async () => {
  const current = model();
  await act(async () => root.render(<EntryOptionsBar model={current} placement="metadata" />));
  expect(host.querySelectorAll('[role="group"] > button[aria-label^="设置"]')).toHaveLength(3);
  expect(host.querySelector('aside')).toBeNull();
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  await click('设置分类');
  const choices = document.querySelector('[role="dialog"][aria-label="分类"]')!;
  expect(choices.querySelector('details')).toBeNull();
  expect(document.activeElement?.getAttribute('aria-label')).toBe('查找或新建分类');
  await act(async () => choices.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click());
  expect(current.update).toHaveBeenCalledWith({ categories: ['写作'], termIds: { categories: ['category-1'], tags: ['tag-1'] }, path: '/writing/article/' });
});
it.each(['be6c2282', 'be6c2282-2eb6-4309-a84b-10b074642c5a'])('keeps automatic new/copy addresses (%s) blank and saves entered titles with the category prefix', async slug => {
  const current = model();
  function Editor() {
    const [value, setValue] = useState<Entry>({...current.record.value, id:'be6c2282-2eb6-4309-a84b-10b074642c5a', path:'/posts/'+slug+'/'});
    const update = (patch: Partial<Entry>) => {
      current.update(patch);
      setValue(old => ({...old,...patch}));
    };
    return <>
      <EntryUrlField value={value} onChange={update} />
      <EntryOptionsBar placement="metadata" model={{...current, record:{...current.record,id:value.id,value}, update}} />
    </>;
  }
  await act(async () => root.render(<Editor />));
  expect(host.querySelector('input')!.value).toBe('');
  await act(async () => root.render(<Editor key="reopened" />));
  const field = host.querySelector('[data-field-path="path"]')!;
  const input = field.querySelector('input')!;
  expect(input.value).toBe('');
  expect(input.getAttribute('placeholder')).toBeNull();
  await act(async () => input.dispatchEvent(new FocusEvent('focusout', {bubbles:true})));
  expect(current.update).not.toHaveBeenCalled();
  await click('设置分类');
  await act(async () => document.querySelector<HTMLInputElement>('.term-options input')!.click());
  expect(input.value).toBe('');
  expect(current.update).toHaveBeenLastCalledWith(expect.objectContaining({path:'/writing/'+slug+'/'}));
  await fill(input, 'A Writing Guide');
  expect(field.textContent).toBe('英文标题');
  await act(async () => input.dispatchEvent(new KeyboardEvent('keydown', {key:'Enter',bubbles:true})));
  expect(input.value).toBe('a-writing-guide');
  expect(current.update).toHaveBeenLastCalledWith({path:'/writing/a-writing-guide/'});
  await click('移除分类 写作');
  expect(current.update).toHaveBeenLastCalledWith(expect.objectContaining({path:'/posts/a-writing-guide/'}));
  await fill(input, '');
  await act(async () => input.dispatchEvent(new FocusEvent('focusout', {bubbles:true})));
  expect(current.update).toHaveBeenLastCalledWith({path:'/posts/be6c2282/'});
  expect(input.value).toBe('');
});
it.each([
  ['Debunking 8 Popular Weight Loss Myths, Backed by 227 Scientific References', 'debunking-8-popular-weight-loss-myths-backed-by-227-scientific-references'],
  ["  It's a Guide: A/B & C___D — Café!  ", 'its-a-guide-a-b-c-d-cafe'],
  ['---Hello___World!!!---', 'hello-world'],
  ['!@#$ 中文 😀', ''],
])('cleans unsupported characters in an entered English title: %s', async (text, expected) => {
  const current = model();
  const value = {...current.record.value, id:'be6c2282-2eb6-4309-a84b-10b074642c5a', path:'/guide/original-title/'};
  await act(async () => root.render(<EntryUrlField value={value} onChange={current.update} />));
  const input = host.querySelector('input')!;
  await fill(input, text);
  await act(async () => input.dispatchEvent(new FocusEvent('focusout', {bubbles:true})));
  expect(input.value).toBe(expected);
  expect(current.update).toHaveBeenLastCalledWith({path:'/guide/' + (expected || 'be6c2282') + '/'});
  expect(host.querySelector('[role="alert"]')).toBeNull();
});
it('keeps an existing imported address intact until its English title is edited', async () => {
  const current = model();
  await act(async () => root.render(<EntryUrlField value={{...current.record.value, path:'/认知/旧文章——标题/'}} onChange={current.update} />));
  const input = host.querySelector('input')!;
  await act(async () => input.dispatchEvent(new FocusEvent('focusout', {bubbles:true})));
  expect(input.value).toBe('旧文章——标题');
  expect(current.update).not.toHaveBeenCalled();
});
it('saves a legacy category alias before applying it to the article address', async () => {
  const current = model();
  const row = current.state.terms[0];
  row.value.slug = '写作';
  mocks.api.mockResolvedValue({...row, revision:7, value:{...row.value,slug:'writing'}});
  await act(async () => root.render(<EntryOptionsBar model={current} placement="metadata" />));
  await click('设置分类');
  await act(async () => document.querySelector<HTMLInputElement>('.term-options input')!.click());
  expect(current.update).not.toHaveBeenCalled();
  const dialog = document.querySelector('dialog[aria-label="管理分类"]')!;
  await fill(dialog.querySelectorAll('input')[1], 'Writing');
  await act(async () => dialog.querySelector('form')!.dispatchEvent(new Event('submit', {bubbles:true,cancelable:true})));
  expect(mocks.api).toHaveBeenCalledWith('terms', {value:{...row.value,slug:'writing'},revision:4});
  expect(current.update).toHaveBeenCalledWith(expect.objectContaining({path:'/writing/article/', categories:['写作']}));
});
it('offers authors from saved articles and remembers a new author after leaving the picker', async () => {
  const current = model();
  await act(async () => root.render(<EntryOptionsBar model={current} placement="metadata" />));
  await click('设置作者');
  expect(document.querySelector('.entry-author-list')?.textContent).toContain('已用作者');
  await fill(document.querySelector('[aria-label="作者姓名"]')!, '新作者');
  await click('关闭作者');
  await click('设置作者');
  await click('新作者');
  expect(current.update).toHaveBeenLastCalledWith({author:'新作者'});
  expect(localStorage.getItem('weava:last-author')).toBe('新作者');
});
it('uses switches for privacy and comments without changing search indexing', async () => {
  const current = model();
  await act(async () => root.render(<EntryOptionsBar model={current} placement="toolbar" />));
  await click('设置发布选项');
  expect(document.querySelector('[aria-label="私密文章"]')?.getAttribute('aria-checked')).toBe('false');
  await click('私密文章'); await click('允许评论');
  expect(current.update.mock.calls.map((call: any[]) => call[0])).toEqual([{ visibility: 'private' }, { allowComments: false }]);
  expect(document.body.textContent).not.toContain('允许搜索引擎收录');
});
it('keeps cover selection, Escape dismissal and the more settings entry working', async () => {
  const current = model(), more = vi.fn(); mocks.media.mockResolvedValue({ url: '/media/new.webp' });
  await act(async () => root.render(<><EntryOptionsBar model={current} placement="toolbar" onMore={more} /><EntryOptionsBar model={current} placement="metadata" /></>));
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
  const current=model();current.scheduleDueAt='2030-01-01T10:00';
  await act(async () => root.render(<EntryOptionsBar model={current} placement="toolbar" />));
  await click('设置发布选项'); await click('安排发布');
  expect(current.persist).toHaveBeenCalledTimes(1);
  expect(mocks.api).toHaveBeenCalledWith('schedule', { id: 'article', revision: 7, dueAt: zonedDateTime(current.scheduleDueAt,'Asia/Shanghai') });
  expect(current.setScheduleDueAt).toHaveBeenCalledWith('');
  expect(current.notify).toHaveBeenCalledWith('定时发布已安排');
});
it('groups secondary settings and removes the indexing checkbox without resetting existing data', async () => {
  const current = model();
  await act(async () => root.render(<EntrySettings model={current} mode="more" />));
  expect(host.querySelectorAll('[role="tab"]')).toHaveLength(3);
  expect(host.textContent).not.toContain('选择分类'); expect(host.textContent).not.toContain('选择封面');
  expect(host.querySelector('[data-field-path="author"]')).toBeNull();
  expect(host.querySelector('[data-field-path="path"] input')).toBeNull();
  expect(current.update).not.toHaveBeenCalled();
  await click('更多操作');
  const optional = [...host.querySelectorAll<HTMLDetailsElement>('[role="tabpanel"]:not([hidden]) > details')];
  expect(optional.map(item => item.querySelector('summary')?.textContent)).toEqual(['搜索和分享预览', '作者与引用来源']);
  expect(optional.every(item => !item.open)).toBe(true);
  expect(host.textContent).not.toContain('允许搜索引擎收录');
  expect(host.querySelector('input[type="checkbox"]')).toBeNull();
  expect(mocks.api).not.toHaveBeenCalled();
  expect(current.record.value.indexable).toBe(false);
  expect(current.update).not.toHaveBeenCalled();
});
