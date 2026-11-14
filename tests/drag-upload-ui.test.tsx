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
import { dismissMediaUpload, mediaUploadSnapshot } from '../apps/admin/src/media-uploads.tsx';
import { api,waitJob } from '../apps/admin/src/api.ts';
import { entrySchema } from '../packages/contracts/src/index.ts';
import { useMediaEditor, type MediaEditor } from '../apps/admin/src/useMediaEditor.ts';
import {EditorView} from '@codemirror/view';
vi.mock('../apps/admin/src/Selectors.tsx', () => ({ useSelectors: () => ({ media: async () => null }) }));
vi.mock('../apps/admin/src/upload-file.ts', () => ({ uploadFile: vi.fn() }));
vi.mock('../apps/admin/src/api.ts', () => ({ api: vi.fn(), waitJob: vi.fn() }));
let host: HTMLDivElement, root: ReturnType<typeof createRoot>, library: any[];
const row = (file: File) => ({ id: file.name, revision: 1, updatedAt: '2026-11-09', value: { url: '/media/' + file.name, name: file.name, bytes: file.size, createdAt: '2026-11-09' } });
const file = (name = 'photo.png') => new File(['image'], name, { type: 'image/png' });
const pending = <T,>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; };
function drag(target: Element, files: File[], type = 'drop') {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperties(event, { dataTransfer: { value: { files, types: ['Files'], dropEffect: 'none' } }, clientX: { value: 10 }, clientY: { value: 10 } });
  target.dispatchEvent(event); return event;
}
function paste(target: Element, files: File[], itemsOnly = false) {
  const event = new Event('paste', {bubbles:true,cancelable:true});
  Object.defineProperty(event, 'clipboardData', {value:{files:itemsOnly?[]:files,items:files.map(file=>({kind:'file',getAsFile:()=>file})),types:['Files'],getData:()=>''}});
  target.dispatchEvent(event); return event;
}
const transfer = (target: Element, files: File[], method: string) => method==='drop'?drag(target,files):paste(target,files,method==='items');
function caret(doc: Document, text: Node, offset: number) {
  const range = doc.createRange(); range.setStart(text, offset); range.collapse(true);
  Object.defineProperty(doc, 'caretRangeFromPoint', { configurable: true, value: () => range.cloneRange() });
  const selection = doc.defaultView?.getSelection(); selection?.removeAllRanges(); selection?.addRange(range);
}
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; adminQueries.resume(); library = [];
  mediaUploadSnapshot().forEach(item => dismissMediaUpload(item.id));
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  vi.mocked(uploadFile).mockReset().mockImplementation(async (upload, _progress, options) => { const media = { ...row(upload), value: { ...row(upload).value, groupId: options?.groupId } }; library.push(media); adminQueries.invalidate(false, path => path.startsWith('media')); return media; });
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

it.each(['pictures',null])('preserves a pending media group choice (%s) when a duplicate upload returns',async groupId=>{
  let editor!:MediaEditor;
  const source={...row(file()),value:{...row(file()).value,groupId:'original',alt:'original'}};
  function View(){editor=useMediaEditor(vi.fn(),vi.fn());return null;}
  vi.mocked(api).mockImplementation(async(_path:any,body:any):Promise<any>=>({...source,revision:3,value:{...source.value,...body.value}}));
  await act(async()=>root.render(<EditSessionsProvider><View/></EditSessionsProvider>));
  await act(async()=>editor.choose(source));
  await act(async()=>editor.setSelected(current=>({...current!,value:{...current!.value,groupId}})));
  await act(async()=>editor.receiveUpload({...source,revision:2,value:{...source.value,groupId:'uploaded',alt:'server description'}}));
  expect(editor.selected).toMatchObject({revision:2,value:{groupId,alt:'server description'}});
  await act(async()=>editor.flush());
  expect(api).toHaveBeenCalledWith('media/info',expect.objectContaining({revision:2,value:expect.objectContaining({groupId,alt:'server description'})}));
});

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

it.each(['drop','paste','items'].flatMap(method=>[false,true].map(compact=>({method,compact}))))('inserts multiple $method images at the article/note caret (compact=$compact)', async ({method,compact}) => {
  const change = vi.fn();
  await act(async () => root.render(<Editor compact={compact} value={{ version: 1, format: 'markdown', source: '左边右边' }} onChange={change} onMedia={async () => null} onError={vi.fn()} />));
  const editor = host.querySelector('[aria-label="正文编辑器"]')!; caret(document, document.createTreeWalker(editor.querySelector('p')!, NodeFilter.SHOW_TEXT).nextNode()!, 2);
  await act(async () => { expect(drag(editor, [file()], 'dragover').defaultPrevented).toBe(true); expect(transfer(editor, [file('one.png'), file('two.png')], method).defaultPrevented).toBe(true); });
  expect([...editor.querySelectorAll('img')].map(img => img.getAttribute('src'))).toEqual(['/media/one.png', '/media/two.png']);
  const children = [...editor.children]; expect(children[0].textContent).toBe('左边'); expect(children.at(-1)!.textContent).toBe('右边');
  expect(JSON.stringify(change.mock.calls.at(-1)![0])).toContain('/media/two.png'); expect(uploadFile).toHaveBeenCalledTimes(2);
});
it.each(['drop','paste','items'].flatMap(method=>[false,true].map(cleanFormatting=>({method,cleanFormatting}))))('inserts $method images into imported HTML without losing content (clean=$cleanFormatting)', async ({method,cleanFormatting}) => {
  const change = vi.fn();
  await act(async () => root.render(<HtmlPageText cleanFormatting={cleanFormatting} value="<p>左边右边</p>" onChange={change} />));
  const frame = host.querySelector('iframe')!, doc = frame.contentDocument!;
  doc.body.innerHTML = '<main id="page-text"><p>左边右边</p></main>';
  await act(async () => frame.dispatchEvent(new Event('load')));
  const editor = doc.getElementById('page-text')!; caret(doc, editor.querySelector('p')!.firstChild!, 2);
  await act(async () => transfer(editor, [file('one.png'), file('two.png')], method));
  expect(editor.querySelector('p')!.textContent).toBe('左边右边'); expect([...editor.querySelectorAll('img')].map(img => img.getAttribute('src'))).toEqual(['/media/one.png', '/media/two.png']);
  expect(change.mock.calls.at(-1)![0]).toContain('左边<img'); expect(change.mock.calls.at(-1)![0]).toContain('右边');
});
it.each(['drop','paste','items'])('uploads %s files in the media panel, preserving the selected group and refreshing the library', async method => {
  await act(async () => root.render(<EditSessionsProvider><MediaManager onError={vi.fn()} onOpen={vi.fn()} /></EditSessionsProvider>));
  expect(document.activeElement).toBe(host.querySelector('.media-panel'));
  const group = host.querySelector<HTMLSelectElement>('[aria-label="媒体分组筛选"]')!;
  await act(async () => { group.value = 'pictures'; group.dispatchEvent(new Event('change', { bubbles: true })); });
  await act(async () => transfer(host.querySelector('.media-panel')!, [file('one.png'), file('two.png')], method));
  expect(uploadFile).toHaveBeenCalledTimes(2); expect(uploadFile).toHaveBeenCalledWith(expect.objectContaining({name:'one.png'}), expect.any(Function), expect.objectContaining({groupId:'pictures',signal:expect.any(AbortSignal)})); expect(api).not.toHaveBeenCalledWith('media/move', expect.anything());
  expect(host.querySelector('.media-grid')!.textContent).toContain('one.png'); expect(host.querySelector('.media-grid')!.textContent).toContain('two.png');
});
it('keeps library uploads alive after leaving the panel and does not hold navigation pending',async()=>{
  const upload=pending<any>();vi.mocked(uploadFile).mockReturnValue(upload.promise);
  let manager!:ReturnType<typeof useEditSessions>;
  function Panel(){manager=useEditSessions();return <MediaManager onError={vi.fn()} onOpen={vi.fn()}/>;}
  await act(async()=>root.render(<EditSessionsProvider><Panel/></EditSessionsProvider>));
  await act(async()=>drag(host.querySelector('.media-panel')!,[file('background.png')]));
  expect([...host.querySelectorAll<HTMLButtonElement>('button')].find(button=>button.textContent==='上传文件')!.disabled).toBe(false);
  await expect(manager.prepare()).resolves.toBeUndefined();await expect(manager.flush()).resolves.toBeUndefined();
  const leave=new Event('beforeunload',{cancelable:true});window.dispatchEvent(leave);expect(leave.defaultPrevented).toBe(true);
  await act(async()=>root.render(<div>继续编辑</div>));
  await act(async()=>upload.resolve(row(file('background.png'))));
  expect(mediaUploadSnapshot().find(item=>item.name==='background.png')?.status).toBe('complete');
  expect(host.textContent).toBe('继续编辑');
  const done=new Event('beforeunload',{cancelable:true});window.dispatchEvent(done);expect(done.defaultPrevented).toBe(false);
});
it('aborts uploads on logout, clears queued files and ignores late responses from the previous session',async()=>{
  const upload=pending<any>();vi.mocked(uploadFile).mockReturnValue(upload.promise);
  await act(async()=>root.render(<EditSessionsProvider><MediaManager onError={vi.fn()} onOpen={vi.fn()}/></EditSessionsProvider>));
  await act(async()=>drag(host.querySelector('.media-panel')!,[file('one.png'),file('two.png'),file('queued.png')]));
  const signals=vi.mocked(uploadFile).mock.calls.map(call=>call[2]!.signal!);expect(signals).toHaveLength(2);
  await act(async()=>window.dispatchEvent(new Event('weava-session-ended')));
  expect(signals.every(signal=>signal.aborted)).toBe(true);expect(mediaUploadSnapshot()).toEqual([]);
  await act(async()=>upload.resolve(row(file('one.png'))));
  expect(mediaUploadSnapshot()).toEqual([]);expect(uploadFile).toHaveBeenCalledTimes(2);
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
  vi.mocked(uploadFile).mockRejectedValueOnce(new Error('不支持这个文件格式。'));
  await act(async()=>root.render(<EditSessionsProvider><MediaManager onError={vi.fn()} onOpen={vi.fn()}/></EditSessionsProvider>));
  await act(async()=>drag(host.querySelector('.media-panel')!,[file('unsupported.svg')]));
  const controls=[...host.querySelectorAll<HTMLButtonElement>('button')];
  for(const label of ['上传文件','重试上传','取消此上传'])expect(controls.find(button=>button.textContent===label)?.disabled).toBe(false);
  await act(async()=>controls.find(button=>button.textContent==='取消此上传')!.click());
  await act(async()=>drag(host.querySelector('.media-panel')!,[file('valid.png')]));
  expect(host.querySelector('.media-grid')!.textContent).toContain('valid.png');
});
it.each(['drop','paste'])('pauses a %s batch after failure so retry retains the original image order', async method => {
  let fail = true;
  vi.mocked(uploadFile).mockImplementation(async file => {
    if (file.name === 'two.png' && fail) { fail = false; throw new Error('网络中断'); }
    return row(file);
  });
  await act(async () => root.render(<Editor value={{ version: 1, format: 'markdown', source: '正文' }} onChange={vi.fn()} onMedia={async () => null} onError={vi.fn()} />));
  const editor = host.querySelector('[aria-label="正文编辑器"]')!;
  await act(async () => transfer(editor, [file('one.png'), file('two.png'), file('three.png')], method));
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
it.each(['drop','paste'])('waits for an in-flight %s image before capturing the document for save/publish', async method => {
  const upload = pending<any>(); vi.mocked(uploadFile).mockReturnValue(upload.promise); let workspace: any;
  const state = { settings: { value: { name: '站点' } }, types: [{ id: 'post', value: { id: 'post' } }] };
  function Workspace() {
    workspace = useContentWorkspace({ state:contentWorkspaceFixture(state), receiveSchedules: vi.fn(), tab: 'content', compact: false, busy: false, setError: vi.fn(), notify: vi.fn(), refresh: vi.fn(),  task: vi.fn() });
    return workspace.editor.record ? <Editor value={workspace.editor.record.value.document} onChange={document => workspace.editor.update({ document })} onMedia={async () => null} onError={vi.fn()} /> : null;
  }
  await act(async () => root.render(<EditSessionsProvider><Workspace /></EditSessionsProvider>));
  await act(async () => workspace.navigation.adopt({ id: 'article', revision: 1, value: entrySchema.parse({ id: 'article', kind: 'content', type: 'post', title: '文章', path: '/article/', document: { version: 1, format: 'markdown', source: '正文' } }) }));
  await act(async () => transfer(host.querySelector('[aria-label="正文编辑器"]')!, [file()], method));
  let save!: Promise<any>; await act(async () => { save = workspace.editor.persist(); }); expect(vi.mocked(api).mock.calls.some(([path]) => path === 'entry')).toBe(false);
  await act(async () => { upload.resolve(row(file())); await save; });
  const written = vi.mocked(api).mock.calls.find(([path]) => path === 'entry')!;
  expect(JSON.stringify(written[1])).toContain('/media/photo.png'); expect(workspace.editor.dirty).toBe(false);
});
it.each(['drop','paste','items'])('preserves text typed while a %s image uploads in Markdown source mode', async method => {
  const upload = pending<any>(); vi.mocked(uploadFile).mockReturnValue(upload.promise);
  function Source() { const [value, setValue] = useState<any>({ version: 1, format: 'markdown', source: '左边右边' }); return <Editor value={value} onChange={setValue} onMedia={async () => null} onError={vi.fn()} />; }
  await act(async () => root.render(<Source />)); await act(async () => [...host.querySelectorAll('button')].find(button => button.getAttribute('aria-label') === '切换为 Markdown')!.click());
  const text = host.querySelector('textarea')!; text.setSelectionRange(2, 2);
  await act(async () => transfer(text, [file()], method));
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(text, '新增左边右边'); text.dispatchEvent(new Event('input', { bubbles: true })); });
  await act(async () => upload.resolve(row(file())));
  expect(text.value).toContain('新增左边'); expect(text.value).toContain('/media/photo.png'); expect(text.value).toMatch(/右边$/);
});
it('flushes pending long-source edits before pasting images and preserves edits made during upload', async () => {
  const upload=pending<any>();vi.mocked(uploadFile).mockReturnValue(upload.promise);
  const source='完整正文。'.repeat(10000);
  function Source(){const [value,setValue]=useState<any>({version:1,format:'markdown',source});return <Editor value={value} onChange={setValue} onMedia={async()=>null} onError={vi.fn()}/>;}
  await act(async()=>root.render(<Source/>));
  for(let i=0;i<100&&host.querySelector('[aria-busy="true"]');i++)await act(async()=>{await new Promise(resolve=>setTimeout(resolve,10));});
  await act(async()=>host.querySelector<HTMLButtonElement>('[aria-label="切换为 Markdown"]')!.click());
  for(let i=0;i<50&&!host.querySelector('.cm-content');i++)await act(async()=>{await new Promise(resolve=>setTimeout(resolve,10));});
  const field=host.querySelector<HTMLElement>('.cm-content')!,code=EditorView.findFromDOM(field)!;
  await act(async()=>{
    code.dispatch({changes:{from:0,insert:'刚输入'},selection:{anchor:3}});
    expect(paste(field,[file()],true).defaultPrevented).toBe(true);
  });
  await act(async()=>code.dispatch({changes:{from:code.state.doc.length,insert:'尾部补充'}}));
  await act(async()=>{await new Promise(resolve=>setTimeout(resolve,180));});
  await act(async()=>upload.resolve(row(file())));
  expect(code.state.doc.toString()).toBe('刚输入\n\n![photo.png](/media/photo.png)\n\n'+source+'尾部补充');
  expect(uploadFile).toHaveBeenCalledTimes(1);
});
it('leaves text and URL paste untouched in source, imported HTML and the media library', async () => {
  await act(async()=>root.render(<Editor value={{version:1,format:'markdown',source:'正文'}} onChange={vi.fn()} onMedia={async()=>null} onError={vi.fn()}/>));
  await act(async()=>host.querySelector<HTMLButtonElement>('[aria-label="切换为 Markdown"]')!.click());
  await act(async()=>expect(paste(host.querySelector('textarea')!,[]).defaultPrevented).toBe(false));
  await act(async()=>root.render(<HtmlPageText value="<p>正文</p>" onChange={vi.fn()}/>));
  const frame=host.querySelector('iframe')!,doc=frame.contentDocument!;doc.body.innerHTML='<main id="page-text"><p>正文</p></main>';
  await act(async()=>frame.dispatchEvent(new Event('load')));
  await act(async()=>expect(paste(doc.getElementById('page-text')!,[]).defaultPrevented).toBe(false));
  await act(async()=>root.render(<EditSessionsProvider><MediaManager onError={vi.fn()} onOpen={vi.fn()}/></EditSessionsProvider>));
  await act(async()=>expect(paste(host.querySelector('.media-panel')!,[]).defaultPrevented).toBe(false));
  expect(uploadFile).not.toHaveBeenCalled();
});
