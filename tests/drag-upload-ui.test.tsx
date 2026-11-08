import {contentWorkspaceFixture} from './content-workspace-fixture.ts';
// @vitest-environment happy-dom
import { act, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Editor } from '../apps/admin/src/Editor.tsx';
import { HtmlPageText } from '../apps/admin/src/ImportedContentEditor.tsx';
import MediaManager from '../apps/admin/src/MediaManager.tsx';
import { EditSessionsProvider, useEditSessions } from '../apps/admin/src/EditSessions.tsx';
import { useContentWorkspace } from '../apps/admin/src/useContentWorkspace.ts';
import { adminQueries } from '../apps/admin/src/query-cache.ts';
import { uploadFile } from '../apps/admin/src/upload-file.ts';
import { api,waitJob } from '../apps/admin/src/api.ts';
import { entrySchema } from '../packages/contracts/src/index.ts';
vi.mock('../apps/admin/src/Selectors.tsx', () => ({ useSelectors: () => ({ media: async () => null }) }));
vi.mock('../apps/admin/src/upload-file.ts', () => ({ uploadFile: vi.fn() }));
vi.mock('../apps/admin/src/api.ts', () => ({ api: vi.fn(), waitJob: vi.fn() }));
let host: HTMLDivElement, root: ReturnType<typeof createRoot>, library: any[];
const row = (file: File) => ({ id: file.name, revision: 1, value: { url: '/media/' + file.name, name: file.name, bytes: file.size } });
const file = (name = 'photo.png') => new File(['image'], name, { type: 'image/png' });
const pending = <T,>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; };
function drag(target: Element, files: File[], type = 'drop') {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperties(event, { dataTransfer: { value: { files, types: ['Files'], dropEffect: 'none' } }, clientX: { value: 10 }, clientY: { value: 10 } });
  target.dispatchEvent(event); return event;
}
function caret(doc: Document, text: Node, offset: number) {
  const range = doc.createRange(); range.setStart(text, offset); range.collapse(true);
  Object.defineProperty(doc, 'caretRangeFromPoint', { configurable: true, value: () => range.cloneRange() });
}
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; adminQueries.resume(); library = [];
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  vi.mocked(uploadFile).mockReset().mockImplementation(async upload => { const media = row(upload); library.push(media); return media; });
  vi.mocked(api).mockReset().mockImplementation(async (path: any, body?: any): Promise<any> => {
    if (String(path).startsWith('media/query?')) return { items: [...library], pages: 1, total: library.length };
    if (path === 'media/move') return body.items.map((item: {id:string}) => { const media=library.find(row=>row.id===item.id); media.value.groupId=body.groupId; return media; });
    if (path === 'media/groups') return [{ id: 'pictures', value: { label: '图片', archived: false } }];
    if (String(path).startsWith('entries/query?')) return { items: [], pages: 0, total: 0 };
    if (path === 'entry') return { id: body.value.id, revision: 2, value: body.value };
    return [];
  });
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); delete (document as any).caretRangeFromPoint; vi.restoreAllMocks(); });

it('crops through the keyboard, clamps the selection and sends the same crop to the media API',async()=>{
  const source=row(file()),cropped={...source,id:'cropped',value:{...source.value,url:'/media/cropped.png'}};library=[source];
  const original=vi.mocked(api).getMockImplementation()!;
  vi.mocked(api).mockImplementation(async(path:any,body?:any):Promise<any>=>String(path).startsWith('media/references')?{working:[],published:[],layouts:[],historicalRevisions:0}:path==='media/crop'?{id:'crop-job'}:original(path,body));
  vi.mocked(waitJob).mockResolvedValue({result:cropped} as any);
  await act(async()=>root.render(<EditSessionsProvider><MediaManager onError={vi.fn()} onOpen={vi.fn()}/></EditSessionsProvider>));
  await act(async()=>host.querySelector<HTMLButtonElement>('.media-open')!.click());
  await act(async()=>[...host.querySelectorAll('button')].find(button=>button.textContent==='裁切图片')!.click());
  const region=document.querySelector<HTMLElement>('[aria-label="裁切选区"]')!;
  const key=async(value:string,shiftKey=false)=>act(async()=>{region.dispatchEvent(new KeyboardEvent('keydown',{key:value,shiftKey,bubbles:true,cancelable:true}));});
  await key('ArrowLeft',true);await key('ArrowUp',true);await key('ArrowRight');await key('ArrowDown');
  expect(region.querySelector('span')!.style.left).toBe('5%');expect(region.querySelector('span')!.style.width).toBe('95%');
  await key('ArrowRight');expect(region.querySelector('span')!.style.left).toBe('5%');
  await key('Home');expect(region.querySelector('span')!.style.width).toBe('100%');
  expect([...document.querySelectorAll<HTMLButtonElement>('button')].find(button=>button.textContent==='保存裁切图片')!.disabled).toBe(true);
  await key('ArrowLeft',true);await key('ArrowUp',true);await key('ArrowRight');await key('ArrowDown');
  await act(async()=>[...document.querySelectorAll<HTMLButtonElement>('button')].find(button=>button.textContent==='保存裁切图片')!.click());
  expect(api).toHaveBeenCalledWith('media/crop',{id:source.id,revision:1,crop:{left:5,top:5,width:95,height:95}});
  expect(document.querySelector('dialog[aria-label="裁切图片"]')).toBeNull();
});

it.each([false, true])('uploads multiple dropped images into the visual article/note at the drop position (compact=%s)', async compact => {
  const change = vi.fn();
  await act(async () => root.render(<Editor compact={compact} value={{ version: 1, format: 'markdown', source: '左边右边' }} onChange={change} onMedia={async () => null} onError={vi.fn()} />));
  const editor = host.querySelector('[aria-label="正文编辑器"]')!; caret(document, document.createTreeWalker(editor.querySelector('p')!, NodeFilter.SHOW_TEXT).nextNode()!, 2);
  await act(async () => { expect(drag(editor, [file()], 'dragover').defaultPrevented).toBe(true); expect(drag(editor, [file('one.png'), file('two.png')]).defaultPrevented).toBe(true); });
  expect([...editor.querySelectorAll('img')].map(img => img.getAttribute('src'))).toEqual(['/media/one.png', '/media/two.png']);
  const children = [...editor.children]; expect(children[0].textContent).toBe('左边'); expect(children.at(-1)!.textContent).toBe('右边');
  expect(JSON.stringify(change.mock.calls.at(-1)![0])).toContain('/media/two.png'); expect(uploadFile).toHaveBeenCalledTimes(2);
});
it.each([false, true])('uploads into the imported HTML article/note without losing surrounding content (clean=%s)', async cleanFormatting => {
  const change = vi.fn();
  await act(async () => root.render(<HtmlPageText cleanFormatting={cleanFormatting} value="<p>左边右边</p>" onChange={change} />));
  const frame = host.querySelector('iframe')!, doc = frame.contentDocument!;
  doc.body.innerHTML = '<main id="page-text"><p>左边右边</p></main>';
  await act(async () => frame.dispatchEvent(new Event('load')));
  const editor = doc.getElementById('page-text')!; caret(doc, editor.querySelector('p')!.firstChild!, 2);
  await act(async () => drag(editor, [file('one.png'), file('two.png')]));
  expect(editor.querySelector('p')!.textContent).toBe('左边右边'); expect([...editor.querySelectorAll('img')].map(img => img.getAttribute('src'))).toEqual(['/media/one.png', '/media/two.png']);
  expect(change.mock.calls.at(-1)![0]).toContain('左边<img'); expect(change.mock.calls.at(-1)![0]).toContain('右边');
});
it('uploads files dropped in the media panel, preserving the selected group and refreshing the library', async () => {
  await act(async () => root.render(<EditSessionsProvider><MediaManager onError={vi.fn()} onOpen={vi.fn()} /></EditSessionsProvider>));
  const group = host.querySelector<HTMLSelectElement>('[aria-label="媒体分组筛选"]')!;
  await act(async () => { group.value = 'pictures'; group.dispatchEvent(new Event('change', { bubbles: true })); });
  await act(async () => drag(host.querySelector('.media-panel')!, [file('one.png'), file('two.png')]));
  expect(uploadFile).toHaveBeenCalledTimes(2); expect(api).toHaveBeenCalledWith('media/move', {items:[{id:'one.png',revision:1}],groupId:'pictures'});
  expect(host.querySelector('.media-grid')!.textContent).toContain('one.png'); expect(host.querySelector('.media-grid')!.textContent).toContain('two.png');
});
it('keeps failed files available for retry and blocks unsupported files from opening in the browser', async () => {
  vi.mocked(uploadFile).mockRejectedValueOnce(new Error('网络中断'));
  await act(async () => root.render(<Editor value={{ version: 1, format: 'markdown', source: '正文' }} onChange={vi.fn()} onMedia={async () => null} onError={vi.fn()} />));
  const editor = host.querySelector('[aria-label="正文编辑器"]')!;
  await act(async () => drag(editor, [file()])); expect(host.querySelector('[role="alert"]')!.textContent).toContain('网络中断');
  await act(async () => host.querySelector<HTMLButtonElement>('.file-upload-error button')!.click()); expect(editor.querySelector('img')?.getAttribute('src')).toBe('/media/photo.png'); expect(host.querySelector('[role="alert"]')).toBeNull();
  vi.mocked(uploadFile).mockClear(); await act(async () => expect(drag(editor, [file('wrong.exe')]).defaultPrevented).toBe(true)); expect(uploadFile).not.toHaveBeenCalled();
  expect([...host.querySelectorAll<HTMLButtonElement>('.file-upload-error button')].every(button=>!button.disabled)).toBe(true);
});
it('recovers from validation failure before progress starts without an unrelated render',async()=>{
  await act(async()=>root.render(<EditSessionsProvider><MediaManager onError={vi.fn()} onOpen={vi.fn()}/></EditSessionsProvider>));
  await act(async()=>drag(host.querySelector('.media-panel')!,[file('unsupported.svg')]));
  const controls=[...host.querySelectorAll<HTMLButtonElement>('button')];
  for(const label of ['上传文件','重试上传','取消这些上传'])expect(controls.find(button=>button.textContent===label)?.disabled).toBe(false);
  await act(async()=>controls.find(button=>button.textContent==='取消这些上传')!.click());
  await act(async()=>drag(host.querySelector('.media-panel')!,[file('valid.png')]));
  expect(host.querySelector('.media-grid')!.textContent).toContain('valid.png');
});
it('pauses the rest of a batch after failure so retry retains the original image order', async () => {
  let fail = true;
  vi.mocked(uploadFile).mockImplementation(async file => {
    if (file.name === 'two.png' && fail) { fail = false; throw new Error('网络中断'); }
    return row(file);
  });
  await act(async () => root.render(<Editor value={{ version: 1, format: 'markdown', source: '正文' }} onChange={vi.fn()} onMedia={async () => null} onError={vi.fn()} />));
  const editor = host.querySelector('[aria-label="正文编辑器"]')!;
  await act(async () => drag(editor, [file('one.png'), file('two.png'), file('three.png')]));
  expect(uploadFile).toHaveBeenCalledTimes(2); expect([...editor.querySelectorAll('img[src]')].map(img => img.getAttribute('src'))).toEqual(['/media/one.png']);
  await act(async () => host.querySelector<HTMLButtonElement>('.file-upload-error button')!.click());
  expect([...editor.querySelectorAll('img[src]')].map(img => img.getAttribute('src'))).toEqual(['/media/one.png', '/media/two.png', '/media/three.png']);
});
it('keeps save and navigation blocked after upload failure until retry or an explicit choice to omit the files', async () => {
  let manager!: ReturnType<typeof useEditSessions>;
  function Form() { manager = useEditSessions(); return <Editor value={{ version: 1, format: 'markdown', source: '正文' }} onChange={vi.fn()} onMedia={async () => null} onError={vi.fn()} />; }
  vi.mocked(uploadFile).mockRejectedValueOnce(new Error('网络中断'));
  await act(async () => root.render(<EditSessionsProvider><Form /></EditSessionsProvider>));
  await act(async () => drag(host.querySelector('[aria-label="正文编辑器"]')!, [file()]));
  await expect(manager.prepare()).rejects.toThrow('尚未上传'); await expect(manager.flush()).rejects.toThrow('尚未上传');
  expect([...host.querySelectorAll<HTMLButtonElement>('button')].find(button => button.getAttribute('aria-label') === '切换为 Markdown')!.disabled).toBe(true);
  await act(async () => [...host.querySelectorAll<HTMLButtonElement>('.file-upload-error button')].find(button => button.textContent === '不插入这些文件')!.click());
  await expect(manager.prepare()).resolves.toBeUndefined(); await expect(manager.flush()).resolves.toBeUndefined();
  expect([...host.querySelectorAll<HTMLButtonElement>('button')].find(button => button.getAttribute('aria-label') === '切换为 Markdown')!.disabled).toBe(false);
});
it('waits for an in-flight image before capturing the document for save/publish', async () => {
  const upload = pending<any>(); vi.mocked(uploadFile).mockReturnValue(upload.promise); let workspace: any;
  const state = { settings: { value: { name: '站点' } }, types: [{ id: 'post', value: { id: 'post' } }] };
  function Workspace() {
    workspace = useContentWorkspace({ state:contentWorkspaceFixture(state), receiveSchedules: vi.fn(), tab: 'content', compact: false, busy: false, setError: vi.fn(), notify: vi.fn(), refresh: vi.fn(),  task: vi.fn() });
    return workspace.editor.record ? <Editor value={workspace.editor.record.value.document} onChange={document => workspace.editor.update({ document })} onMedia={async () => null} onError={vi.fn()} /> : null;
  }
  await act(async () => root.render(<EditSessionsProvider><Workspace /></EditSessionsProvider>));
  await act(async () => workspace.navigation.adopt({ id: 'article', revision: 1, value: entrySchema.parse({ id: 'article', kind: 'content', type: 'post', title: '文章', path: '/article/', document: { version: 1, format: 'markdown', source: '正文' } }) }));
  await act(async () => drag(host.querySelector('[aria-label="正文编辑器"]')!, [file()]));
  let save!: Promise<any>; await act(async () => { save = workspace.editor.persist(); }); expect(vi.mocked(api).mock.calls.some(([path]) => path === 'entry')).toBe(false);
  await act(async () => { upload.resolve(row(file())); await save; });
  const written = vi.mocked(api).mock.calls.find(([path]) => path === 'entry')!;
  expect(JSON.stringify(written[1])).toContain('/media/photo.png'); expect(workspace.editor.dirty).toBe(false);
});
it('preserves text typed while an image is uploading in Markdown source mode', async () => {
  const upload = pending<any>(); vi.mocked(uploadFile).mockReturnValue(upload.promise);
  function Source() { const [value, setValue] = useState<any>({ version: 1, format: 'markdown', source: '左边右边' }); return <Editor value={value} onChange={setValue} onMedia={async () => null} onError={vi.fn()} />; }
  await act(async () => root.render(<Source />)); await act(async () => [...host.querySelectorAll('button')].find(button => button.getAttribute('aria-label') === '切换为 Markdown')!.click());
  const text = host.querySelector('textarea')!; text.setSelectionRange(2, 2);
  await act(async () => drag(text, [file()]));
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(text, '新增左边右边'); text.dispatchEvent(new Event('input', { bubbles: true })); });
  await act(async () => upload.resolve(row(file())));
  expect(text.value).toContain('新增左边'); expect(text.value).toContain('/media/photo.png'); expect(text.value).toMatch(/右边$/);
});
