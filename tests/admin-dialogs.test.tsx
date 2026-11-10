// @vitest-environment happy-dom
import { act, useState } from 'react';
import {PreviewFrame} from '../apps/admin/src/PreviewFrame.tsx';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { EditSessionsProvider } from '../apps/admin/src/EditSessions.tsx';
import { SelectorsProvider, useSelectors } from '../apps/admin/src/Selectors.tsx';
import { Fields } from '../apps/admin/src/Fields.tsx';
import { MergeDialog, RevisionDialog } from '../apps/admin/src/Revisions.tsx';
import MediaManager from '../apps/admin/src/MediaManager.tsx';
import HistoryMaintenance from '../apps/admin/src/HistoryMaintenance.tsx';
import Operations from '../apps/admin/src/Operations.tsx';
import ImportManager from '../apps/admin/src/ImportManager.tsx';
import {TemporaryMaintenance} from '../apps/admin/src/TemporaryMaintenance.tsx';
import { AnalyticsReportView } from '../apps/admin/src/AnalyticsReportView.tsx';
import { ReportWorkspace } from '../apps/admin/src/analytics/report-workspace.ts';
import {refreshBackgroundTasks} from '../apps/admin/src/background-tasks.ts';
import { api, waitJob } from '../apps/admin/src/api.ts';
import { uploadFile } from '../apps/admin/src/upload-file.ts';
import { dismissMediaUpload, mediaUploadSnapshot } from '../apps/admin/src/media-uploads.tsx';
import { adminQueries } from '../apps/admin/src/query-cache.ts';
vi.mock('../apps/admin/src/upload-file.ts', () => ({ uploadFile: vi.fn() }));

const mocks = vi.hoisted(() => ({ api: vi.fn(), waitJob: vi.fn(),submitJob:vi.fn() }));
vi.mock('../apps/admin/src/api.ts', () => mocks);
let host: HTMLDivElement, root: Root;
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  window.dispatchEvent(new Event('weava-session-ended'));sessionStorage.clear();
  mocks.api.mockReset(); mocks.waitJob.mockReset();mocks.submitJob.mockReset().mockImplementation((path,body)=>mocks.api(path,body));localStorage.clear();
  vi.stubGlobal('XMLHttpRequest',class {status=200;responseText='';upload={};timeout=0;onload:any;open(){}setRequestHeader(){}send(file:File){this.responseText=JSON.stringify({id:'source-test',name:file.name,format:file.name.endsWith('.xml')?'wxr':'json',bytes:file.size,path:'uploads/request-test.json',sha256:'hash',expiresAt:new Date(Date.now()+86400000).toISOString()});queueMicrotask(()=>this.onload());}});
  adminQueries.resume();
  mediaUploadSnapshot().forEach(item => dismissMediaUpload(item.id)); vi.mocked(uploadFile).mockReset();
  mocks.api.mockImplementation(async (path: string) => path.includes('query?') ? { items: [], total: 0, pages: 0 } : []);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); localStorage.clear();window.dispatchEvent(new Event('weava-session-ended'));vi.unstubAllGlobals();vi.restoreAllMocks(); });
async function render(node: React.ReactNode) { await act(async () => root.render(<EditSessionsProvider><SelectorsProvider>{node}</SelectorsProvider></EditSessionsProvider>)); }
function button(text: string, scope: ParentNode = document) { const node = [...scope.querySelectorAll('button')].find(node => node.textContent === text || node.getAttribute('aria-label') === text); expect(node, text).toBeDefined(); return node!; }
async function click(text: string, scope?: ParentNode) { await act(async () => button(text, scope).click()); }
async function fill(selector: string, value: string) { await act(async () => { const node = document.querySelector<HTMLInputElement>(selector)!; Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(node, value); node.dispatchEvent(new Event('input', { bubbles: true })); }); }
function dialog(name: string) { return document.querySelector<HTMLDialogElement>(`dialog[aria-label="${name}"]`)!; }
function paste(target: Element, files: File[] = [], itemsOnly = false) {
  const event = new Event('paste', {bubbles: true, cancelable: true});
  Object.defineProperty(event, 'clipboardData', {value: {files: itemsOnly ? [] : files, items: files.map(file => ({kind: 'file', getAsFile: () => file})), getData: () => '剪贴板文字'}});
  target.dispatchEvent(event);
  return event;
}

it('copies exact code from sandboxed previews through the parent without enabling preview scripts', async()=>{
  const copy=vi.spyOn(navigator.clipboard,'writeText').mockResolvedValue();
  await render(<PreviewFrame title="代码预览" src="/__preview/example?revision=1"/>);
  const frame=host.querySelector('iframe')!, preview=document.implementation.createHTMLDocument('预览');
  preview.body.innerHTML='<div class="code-block"><button type="button" data-copy-code>复制代码</button><pre data-code-source="'+encodeURIComponent('first\n\n  next()')+'"></pre></div>';
  Object.defineProperty(frame,'contentDocument',{configurable:true,value:preview});
  await act(async()=>frame.dispatchEvent(new Event('load')));
  await act(async()=>preview.querySelector('button')!.click());
  expect(copy).toHaveBeenCalledWith('first\n\n  next()'); expect(preview.querySelector('button')!.textContent).toBe('已复制');
  expect(frame.getAttribute('sandbox')).toBe('allow-same-origin'); expect(frame.getAttribute('src')).toContain('embedded=1');
});

it('streams import files without reading them in the browser, reports server validation errors and accepts a corrected export',async()=>{
  await render(<ImportManager refresh={vi.fn(async()=>{})}/>);
  const field=host.querySelector<HTMLInputElement>('input[type="file"]')!,read=vi.fn(()=>{throw new Error('must not read');});
  const choose=async()=>{Object.defineProperty(field,'files',{configurable:true,value:[{name:'source.json',size:30,text:read}]});await act(async()=>field.dispatchEvent(new Event('change',{bubbles:true})));};
  await choose();mocks.submitJob.mockRejectedValueOnce(new Error('这个文件不是有效的 JSON。'));await click('预检导入');
  expect(host.textContent).toContain('不是有效的 JSON');expect(read).not.toHaveBeenCalled();
  mocks.submitJob.mockResolvedValueOnce({id:'valid-import',status:'queued',operation:'import-source'});
  mocks.api.mockResolvedValue({id:'valid-import',status:'complete',operation:'import-source',result:{format:'json',dryRun:true,created:[],updated:[],unchanged:[]}});
  await choose();await click('预检导入');await act(async()=>refreshBackgroundTasks());
  expect(mocks.submitJob).toHaveBeenLastCalledWith('import/source',expect.objectContaining({sourceId:'source-test',options:expect.objectContaining({dryRun:true})}),expect.any(String));
  expect(host.textContent).toContain('预检结果');expect(host.querySelector('[role="alert"]')).toBeNull();expect(read).not.toHaveBeenCalled();
});
it('shows the exact temporary cleanup preview and requires its explicit delete button',async()=>{
  const refresh=vi.fn(async()=>{}),onError=vi.fn();
  mocks.api.mockImplementation(async(path:string)=>path==='maintenance/temporary'?{files:[{id:'ended',kind:'upload',path:'uploads/ended.bin',bytes:1024}],bytes:1024,review:'review-current',skipped:[]}:{});
  await render(<TemporaryMaintenance usage={{uploadsBytes:1024,importsBytes:0,logsBytes:0,businessBytes:0,pendingUploads:[{id:'ended',name:'old.txt',offset:1024,size:1024,status:'expired'}]}} refresh={refresh} onError={onError}/>);
  await click('检查可清理的暂存文件');expect(dialog('清理暂存文件').textContent).toContain('old.txt');
  expect(api).not.toHaveBeenCalledWith('maintenance/temporary/cleanup',expect.anything());
  await click('删除这 1 个暂存文件');expect(api).toHaveBeenCalledWith('maintenance/temporary/cleanup',{review:'review-current',confirm:true});
  expect(dialog('清理暂存文件')).toBeNull();expect(onError).not.toHaveBeenCalled();
});
it('renders actionable schema and import conflicts without empty error rows',async()=>{
  await render(<ImportManager refresh={vi.fn(async()=>{})}/>);
  const field=host.querySelector<HTMLInputElement>('input[type="file"]')!;
  Object.defineProperty(field,'files',{value:[{name:'source.json',size:100,text:async()=>'{"version":1,"entries":[]}' }]});
  await act(async()=>field.dispatchEvent(new Event('change',{bubbles:true})));
  mocks.api.mockRejectedValue(Object.assign(new Error('导入预检未通过'),{details:[{scope:'entries',id:'post',reason:'网址已被占用'},{path:['value','entries',0,'title'],code:'invalid_type'},{},null]}));
  await click('预检导入');
  const lines=[...host.querySelectorAll('[role="alert"] li')].map(item=>item.textContent);
  expect(lines).toEqual(['内容 · post：网址已被占用','导入内容 · 内容 · 第 1 项 · 标题：数据类型不正确']);
});

it('uses a separate URL dialog, rejects invalid schemes, and preserves the media picker when cancelled', async () => {
  const selected = vi.fn();
  function Select() { const selectors = useSelectors(); return <button onClick={async () => selected(await selectors.media('image'))}>选图</button>; }
  await render(<Select />); await click('选图');
  expect(dialog('选择媒体').querySelector('.selector-toolbar')?.textContent).toContain('上传文件');
  await click('粘贴网址'); await fill('[aria-label="媒体网址"]', 'javascript:alert(1)');
  await act(async () => dialog('粘贴媒体网址').querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
  expect(dialog('粘贴媒体网址').textContent).toContain('请填写完整的网址'); expect(selected).not.toHaveBeenCalled();
  await click('取消', dialog('粘贴媒体网址')); expect(dialog('选择媒体').open).toBe(true);
  await click('粘贴网址'); await fill('[aria-label="媒体网址"]', 'https://example.com/image?id=4');
  await act(async () => dialog('粘贴媒体网址').querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
  expect(selected).toHaveBeenCalledWith(expect.objectContaining({ url: 'https://example.com/image?id=4', kind: 'image' }));
  expect(dialog('选择媒体')).toBeNull();
  expect(mocks.api.mock.calls.every(([, input]: any[]) => input === undefined)).toBe(true);
});

it('keeps media selection and closing available during upload and offers the original before optimization',async()=>{
  const selected=vi.fn(),existing={id:'existing',revision:1,value:{id:'existing',name:'existing.png',url:'/media/existing.png',bytes:4,createdAt:'2026-11-09'}};
  mocks.api.mockImplementation(async(path:string)=>path.includes('query?')?{items:[existing],total:1,pages:1}:[]);
  let resolve!: (value:any)=>void;vi.mocked(uploadFile).mockReturnValue(new Promise(done=>{resolve=done;}));
  function Select(){const selectors=useSelectors();return <button onClick={async()=>selected(await selectors.media('image'))}>选图</button>;}
  await render(<Select/>);await click('选图');
  const field=dialog('选择媒体').querySelector<HTMLInputElement>('input[type="file"]')!;
  Object.defineProperty(field,'files',{configurable:true,value:[new File(['image'],'upload.png',{type:'image/png'})]});
  await act(async()=>field.dispatchEvent(new Event('change',{bubbles:true})));
  expect(button('上传文件',dialog('选择媒体')).disabled).toBe(false);expect(button('关闭',dialog('选择媒体')).disabled).toBe(false);
  await click('关闭',dialog('选择媒体'));expect(selected).toHaveBeenLastCalledWith(null);
  await click('选图');expect(dialog('选择媒体').textContent).toContain('upload.png');
  await act(async()=>dialog('选择媒体').querySelector<HTMLButtonElement>('.selector-item')!.click());
  expect(selected).toHaveBeenLastCalledWith(expect.objectContaining({url:'/media/existing.png'}));
  await click('选图');
  await act(async()=>resolve({id:'original',revision:2,updatedAt:'2026-11-09',value:{id:'original',name:'upload.png',url:'/media/original.png',bytes:5,createdAt:'2026-11-09',derivatives:[],optimization:{status:'pending'}}}));
  await act(async()=>dialog('选择媒体').querySelector<HTMLButtonElement>('.media-upload-select')!.click());
  expect(selected).toHaveBeenLastCalledWith(expect.objectContaining({url:'/media/original.png',kind:'image'}));
  expect(waitJob).not.toHaveBeenCalled();expect(uploadFile).toHaveBeenCalledTimes(1);
});
it.each([false, true])('uploads a pasted image once into the current group and leaves it selectable (items only: %s)', async itemsOnly => {
  mocks.api.mockImplementation(async(path: string) => path === 'media/groups' ? [{id:'screenshots',value:{label:'截图'}}] : {items:[],total:0,pages:0});
  vi.mocked(uploadFile).mockResolvedValue({id:'pasted',revision:1,updatedAt:'2026-11-10',value:{id:'pasted',name:'image.png',url:'/media/pasted.png',bytes:5,createdAt:'2026-11-10'}});
  const selected = vi.fn(), image = new File(['image'], 'image.png', {type:'image/png'});
  function Select() {const selectors = useSelectors(); return <button onClick={async () => selected(await selectors.media('image','screenshots'))}>选图</button>;}
  await render(<Select/>); await click('选图');
  let event!: Event;
  await act(async () => {event = paste(dialog('选择媒体').querySelector('[aria-label="搜索媒体"]')!, [image], itemsOnly);});
  expect(event.defaultPrevented).toBe(true); expect(uploadFile).toHaveBeenCalledTimes(1);
  expect(uploadFile).toHaveBeenCalledWith(image, expect.any(Function), {groupId:'screenshots'});
  expect(selected).not.toHaveBeenCalled(); expect(dialog('选择媒体').textContent).toContain('已上传');
  await act(async () => dialog('选择媒体').querySelector<HTMLButtonElement>('.media-upload-select')!.click());
  expect(selected).toHaveBeenCalledWith(expect.objectContaining({id:'pasted',url:'/media/pasted.png',kind:'image'}));
});

it('preserves text and URL paste and ignores images outside an active image or media picker', async () => {
  function Select() {const selectors = useSelectors(); return <><button onClick={() => void selectors.media('image')}>选图</button><button onClick={() => void selectors.content()}>选内容</button></>;}
  await render(<Select/>); await click('选图');
  let event!: Event;
  await act(async () => {event = paste(dialog('选择媒体').querySelector('[aria-label="搜索媒体"]')!);});
  expect(event.defaultPrevented).toBe(false);
  const image = new File(['image'], 'image.png', {type:'image/png'});
  await act(async () => {event = paste(dialog('选择媒体'), [new File(['text'], 'note.txt', {type:'text/plain'})]);});
  expect(event.defaultPrevented).toBe(false);
  await click('粘贴网址');
  await act(async () => {event = paste(dialog('粘贴媒体网址').querySelector('input')!, [image]);});
  expect(event.defaultPrevented).toBe(false);
  await click('取消', dialog('粘贴媒体网址')); await click('关闭', dialog('选择媒体')); await click('选内容');
  await act(async () => {event = paste(dialog('选择内容').querySelector('input')!, [image]);});
  expect(event.defaultPrevented).toBe(false);
  await click('关闭', dialog('选择内容'));
  await act(async () => {event = paste(host, [image]);});
  expect(event.defaultPrevented).toBe(false); expect(uploadFile).not.toHaveBeenCalled();
});

it.each(['file', 'paste'] as const)('retries a failed background %s upload without locking the picker',async source=>{
  vi.mocked(uploadFile).mockRejectedValueOnce(new Error('网络中断')).mockResolvedValueOnce({id:'retried',revision:1,updatedAt:'2026-11-09',value:{name:'retry.png',url:'/media/retried.png',bytes:5,createdAt:'2026-11-09',optimization:{status:'pending'}}});
  const selected=vi.fn();
  function Select(){const selectors=useSelectors();return <button onClick={async()=>selected(await selectors.media('image'))}>选图</button>;}
  await render(<Select/>);await click('选图');
  const image=new File(['image'],'retry.png',{type:'image/png'});
  if(source==='paste')await act(async()=>{paste(dialog('选择媒体'),[image]);});
  else {
    const field=dialog('选择媒体').querySelector<HTMLInputElement>('input[type="file"]')!;
    Object.defineProperty(field,'files',{configurable:true,value:[image]});
    await act(async()=>field.dispatchEvent(new Event('change',{bubbles:true})));
  }
  expect(dialog('选择媒体').textContent).toContain('网络中断');expect(button('关闭',dialog('选择媒体')).disabled).toBe(false);
  await click('重试上传',dialog('选择媒体'));
  await act(async()=>dialog('选择媒体').querySelector<HTMLButtonElement>('.media-upload-select')!.click());
  expect(selected).toHaveBeenLastCalledWith(expect.objectContaining({url:'/media/retried.png'}));expect(uploadFile).toHaveBeenCalledTimes(2);
});

it('keeps simple repeat fields visible and edits complex items in a modal without changing their order', async () => {
  const changes = vi.fn();
  const definitions: any[] = [{ key: 'links', label: '链接', type: 'text', multiple: true }, { key: 'people', label: '人物', type: 'group', multiple: true, fields: [{ key: 'name', label: '姓名', type: 'text' }, { key: 'role', label: '职务', type: 'text' }, { key: 'note', label: '说明', type: 'text' }] }];
  function Form() { const [value, set] = useState({ links: ['one', 'two'], people: [{ name: '甲', role: '编辑', note: '原说明' }] }); return <Fields definitions={definitions} values={value} onChange={next => { changes(next); set(next); }} />; }
  await render(<Form />); expect(host.querySelector('details')).toBeNull();
  expect(host.querySelectorAll('input')).toHaveLength(2); await click('编辑');
  expect(dialog('编辑人物').querySelectorAll('input')).toHaveLength(3);
  await fill('dialog input[aria-label="姓名"]', '乙'); await click('完成', dialog('编辑人物'));
  expect(changes.mock.calls.at(-1)![0]).toEqual({ links: ['one', 'two'], people: [{ name: '乙', role: '编辑', note: '原说明' }] });
  await click('下移第1项'); expect(changes.mock.calls.at(-1)![0].links).toEqual(['two', 'one']);
});

it('shows comparisons directly and switches source views without modifying revision values', async () => {
  mocks.api.mockResolvedValue({ changes: [{ path: '/document', before: { source: '**旧文**' }, beforeHtml: '<p><b>旧文</b></p>', after: { source: '**新文**' }, afterHtml: '<p><b>新文</b></p>' }] });
  const restore = vi.fn();
  await render(<RevisionDialog id="article" history={[{ revision: 2 }, { revision: 1 }]} onClose={vi.fn()} onRestore={restore} onError={vi.fn()} />);
  expect(dialog('历史版本').querySelectorAll('.revision-prose')).toHaveLength(2);
  expect(host.querySelector('details')).toBeNull(); await click('修改前 正文代码');
  expect(dialog('历史版本').querySelector('pre')?.textContent).toContain('**旧文**');
  expect(restore).not.toHaveBeenCalled();
});

it('keeps merge choices when inspecting the original version and sends only the selected resolutions', async () => {
  const save = vi.fn(async () => {}), plan = { base: { revision: 1 }, remote: { revision: 3 }, conflicts: [{ path: '/title', base: '原名', local: '本地名', remote: '远程名' }], changes: [{ path: '/description', before: '旧摘要', after: '新摘要' }] };
  await render(<MergeDialog plan={plan} onSave={save} onRemote={vi.fn()} onClose={vi.fn()} onError={vi.fn()} />);
  expect(host.textContent).toContain('新摘要'); expect(button('保存合并结果').disabled).toBe(true);
  await act(async () => host.querySelector<HTMLInputElement>('[aria-label="标题保留本地"]')!.click());
  await click('查看原版本'); expect(dialog('原版本').textContent).toContain('原名');
  await click('关闭', dialog('原版本')); expect(host.querySelector<HTMLInputElement>('[aria-label="标题保留本地"]')!.checked).toBe(true);
  await click('保存合并结果'); expect(save).toHaveBeenCalledWith({ '/title': 'local' });
});

it('changes the backup folder only on confirmation and verifies using the entered folder', async () => {
  let policy = {id:'site',revision:null as number|null,updatedAt:'',timezone:'Asia/Shanghai',value:{enabled:false,path:'D:/Tools/weava/backups',time:'03:00'}};
  let loadPolicy!: (value: typeof policy) => void;
  const loading = new Promise<typeof policy>(resolve => {loadPolicy = resolve;});
  const jobs = new Map<string, any>();
  mocks.api.mockImplementation(async (path: string, body?: any) => {
    if(path==='backup/policy') {
      if(!body)return loading;
      policy={...policy,revision:(policy.revision??0)+1,value:body.value};
      return policy;
    }
    if(path.startsWith('backup/inventory?'))return {path:new URLSearchParams(path.split('?')[1]).get('path'),items:[],jobs:[...jobs.values()]};
    if(path.startsWith('job/'))return jobs.get(path.slice(4));
    throw new Error('Unexpected backup request: '+path);
  });
  mocks.submitJob.mockImplementation(async (operation: string, payload: any) => {
    const id='backup-check-'+jobs.size;
    const job={id,operation,payload,status:'complete',createdAt:'2026-11-10T00:00:00Z',message:'已完成',result:{path:payload.path}};
    jobs.set(id,job);
    return {...job,status:'queued'};
  });
  const onError=vi.fn(),task=vi.fn();
  await render(<Operations state={{ releases: [], jobs: [] }} task={task} refresh={vi.fn()} onError={onError} openLogs={vi.fn()} />);
  await act(async()=>{await vi.dynamicImportSettled();});
  expect(host.textContent).toContain('正在读取');expect(mocks.submitJob).not.toHaveBeenCalled();
  await act(async()=>loadPolicy(policy));
  expect(host.querySelector('details')).toBeNull(); await click('更改位置'); await fill('dialog input', 'D:/Backups/test');
  await click('取消', dialog('更改备份位置'));
  expect(mocks.api.mock.calls.filter(([path,body])=>path==='backup/policy'&&body)).toHaveLength(0);
  await click('创建备份'); expect(mocks.submitJob).toHaveBeenLastCalledWith('backup', { path: 'D:/Tools/weava/backups' },undefined);
  await act(async()=>{await refreshBackgroundTasks();});
  await click('更改位置'); await fill('dialog input', 'D:/Backups/test');
  await act(async () => dialog('更改备份位置').querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
  await click('创建备份'); expect(mocks.submitJob).toHaveBeenLastCalledWith('backup', { path: 'D:/Backups/test' },undefined);
  expect(mocks.api).toHaveBeenCalledWith('backup/policy',{value:{...policy.value,path:'D:/Backups/test'},revision:null});
  await act(async()=>{await refreshBackgroundTasks();});
  await click('检查已有备份'); await fill('dialog input', 'D:/Backups/existing');
  await act(async () => dialog('检查已有备份').querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
  expect(mocks.submitJob).toHaveBeenLastCalledWith('verify', { path: 'D:/Backups/existing' },undefined);
  await act(async()=>{await refreshBackgroundTasks();});
  expect(mocks.submitJob).toHaveBeenCalledTimes(3);expect(task).not.toHaveBeenCalled();expect(onError).not.toHaveBeenCalled();
  expect(host.textContent).toContain('校验 · 已完成');
});

it('starts one storage scan for repeated clicks and refreshes its complete result once', async () => {
  const overview={databaseBytes:100,analyticsBytes:0,uploadsBytes:0,importsBytes:0,pendingUploads:[],media:{count:1,bytes:4},versions:{count:1},releases:{count:0},backups:[],unreferenced:{count:0,bytes:0},scan:{checkedAt:null}};
  let finishOverview!: (value:any)=>void,complete=false;
  const initial=new Promise(resolve=>{finishOverview=resolve;});
  let reads=0;
  mocks.api.mockImplementation(async(path:string)=>{
    if(path==='backup/policy')return {id:'site',revision:null,updatedAt:'',value:{enabled:false,path:'D:/Tools/weava/backups',time:'03:00'},timezone:'Asia/Shanghai'};
    if(path.startsWith('backup/inventory'))return {path:'D:/Tools/weava/backups',items:[],jobs:[]};
    if(path==='maintenance')return ++reads===1?initial:{...overview,scan:{checkedAt:'2026-11-10T00:00:00Z'}};
    if(path==='job/scan-once')return {id:'scan-once',operation:'storage-scan',status:complete?'complete':'running',createdAt:'2026-11-10T00:00:00Z',message:'扫描文件'};
    throw new Error('Unexpected scan request: '+path);
  });
  mocks.submitJob.mockResolvedValue({id:'scan-once',operation:'storage-scan',status:'queued'});
  const onError=vi.fn();
  await render(<Operations state={{features:[],releases:[],jobs:[]}} task={vi.fn()} refresh={vi.fn()} onError={onError} openLogs={vi.fn()}/>);
  await click('维护');
  await act(async()=>{button('检查占用').click();button('检查占用').click();});
  expect(reads).toBe(1);
  await act(async()=>finishOverview(overview));
  expect(mocks.submitJob).toHaveBeenCalledTimes(1);expect(button('检查占用').disabled).toBe(true);
  complete=true;await act(async()=>{await refreshBackgroundTasks();});
  expect(reads).toBe(2);expect(button('检查占用').disabled).toBe(false);expect(onError).not.toHaveBeenCalled();
});

it('cancels crop without saving and submits the selected crop once when confirmed', async () => {
  const row = { id: 'image', revision: 3, value: { id: 'image', name: '原图', url: '/media/image.jpg' } };
  mocks.api.mockImplementation(async (path: string) => path.startsWith('media/query?') ? { items: [row], total: 1, pages: 1 } : path === 'media/groups' ? [] : path.startsWith('media/references') ? { working: [], layouts: [], published: [], historicalRevisions: 0 } : { id: 'job' });
  mocks.waitJob.mockResolvedValue({ result: { ...row, revision: 4 } } as any);
  await render(<MediaManager onError={vi.fn()} onOpen={vi.fn()} />);
  await act(async () => host.querySelector<HTMLButtonElement>('.media-open')!.click()); await click('裁切图片');
  await click('关闭', dialog('裁切图片')); expect(mocks.api.mock.calls.some(([path]: any[]) => path === 'media/crop')).toBe(false);
  await click('裁切图片'); const surface = dialog('裁切图片').querySelector<HTMLElement>('.crop-surface')!;
  surface.setPointerCapture = vi.fn(); surface.getBoundingClientRect = () => ({ left: 0, top: 0, width: 100, height: 100 }) as any;
  await act(async () => surface.dispatchEvent(new PointerEvent('pointerdown', { clientX: 10, clientY: 20, bubbles: true })));
  await act(async () => surface.dispatchEvent(new PointerEvent('pointermove', { clientX: 80, clientY: 90, bubbles: true })));
  await act(async () => surface.dispatchEvent(new PointerEvent('pointerup', { bubbles: true })));
  await click('保存裁切图片');
  expect(api).toHaveBeenCalledWith('media/crop', { id: 'image', revision: 3, crop: { left: 10, top: 20, width: 70, height: 70 } });
  expect(dialog('裁切图片')).toBeNull(); expect(waitJob).toHaveBeenCalledTimes(1);
});

it('retains an import preflight across page changes and opens long explanations without committing',async()=>{
  const report={format:'wxr',dryRun:true,content:1,pages:0,terms:0,attachments:[],comments:0,reviewRequired:[{id:'one',title:'旧文章',unresolved:['需检查视频']}],skipped:[],warnings:['说明一','说明二','说明三','说明四'],notes:[]};
  mocks.submitJob.mockResolvedValue({id:'wxr-preview',status:'queued',operation:'preflight-wxr'});
  mocks.api.mockImplementation(async path=>path==='job/wxr-preview'?{id:'wxr-preview',status:'complete',operation:'preflight-wxr',result:report}:[]);
  await render(<ImportManager refresh={vi.fn(async()=>{})}/>);
  const field=host.querySelector<HTMLInputElement>('input[type="file"]')!;Object.defineProperty(field,'files',{value:[new File(['<rss/>'],'source.xml')]});
  await act(async()=>field.dispatchEvent(new Event('change',{bubbles:true})));await click('预检导入');
  await render(<p>其它页面</p>);await act(async()=>refreshBackgroundTasks());await render(<ImportManager refresh={vi.fn(async()=>{})}/>);
  expect(host.textContent).toContain('需检查视频');await click('查看详情（4 条）');expect(dialog('转换说明').textContent).toContain('说明四');
  expect(mocks.submitJob).toHaveBeenCalledTimes(1);expect(mocks.submitJob).toHaveBeenCalledWith('import/source',expect.objectContaining({sourceId:'source-test',options:expect.objectContaining({dryRun:true})}),expect.any(String));
});
it('retains history task results after leaving the page and separates a completed archive from refresh errors',async()=>{
 const refresh=vi.fn().mockRejectedValue(new Error('断线'));
 mocks.api.mockImplementation(async(path:string)=>path==='maintenance/preview'?{options:{before:'2099-01-01',keepReleases:20,keepRevisions:20},releases:2,revisions:3,protectedReleases:20,protectedRevisions:20,review:'review'}:path==='job/history-job'?{id:'history-job',status:'complete',operation:'archive-history',result:{releases:2,revisions:3}}:[]);
 mocks.submitJob.mockResolvedValue({id:'history-job',status:'queued',operation:'archive-history'});
 await render(<HistoryMaintenance refresh={refresh}/>);await click('检查可整理的历史');await click('整理并保留恢复记录');
 await render(<p>其它页面</p>);await act(async()=>refreshBackgroundTasks());await render(<HistoryMaintenance refresh={refresh}/>);
 expect(host.textContent).toContain('已归档 2 个公开版本、3 个修订');expect(host.textContent).toContain('操作已完成，列表刷新失败');expect(button('检查可整理的历史').disabled).toBe(false);
});
it('keeps the overview focused and links to details without changing shared filters', async () => {
  const totals = { views: 1, visitors: 1, sessions: 1, clicks: 0 };
  const data: any = { ...totals, range: { start: '2026-11-03', end: '2026-11-04', timezone: 'Asia/Shanghai', previousStart: '2026-11-01', previousEnd: '2026-11-02' }, previous: totals, lifetime: totals, averageActiveMs: 10, overview: [], daily: [{ date: '2026-11-04', views: 1, visitors: 1, sessions: 1, clicks: 0, previousViews: 1, previousVisitors: 1 }], historicalViews: 0 };
  for (const key of ['pages', 'sources', 'engines', 'countries', 'browsers', 'operatingSystems', 'devices', 'models', 'activeVisitors', 'recentVisitors', 'links', 'actions', 'campaigns', 'crawlers', 'legacySources']) data[key] = [];
  const model: any = { loading: false, filters: { country: 'CN' }, loadedQuery: 'country=CN', live: { visitors: [], count: 0 }, retryLive: { current: vi.fn() }, filter: vi.fn(), updateGeo: vi.fn() };
  const navigate = vi.fn();
  await render(<ReportWorkspace.Provider value={{ data, query: 'start=2026-11-03&end=2026-11-04', loading: false, changeRange: vi.fn(), navigate, openVisitor: vi.fn() }}><AnalyticsReportView data={data} model={model} onError={vi.fn()} /></ReportWorkspace.Provider>);
  const headings = [...host.querySelectorAll('h2')].map(node => node.textContent);
  expect(headings).toEqual(['搜索与 AI 来源趋势', '流量趋势', '流量概览', '页面排行']);
  expect(host.querySelectorAll('[role="tab"]')).toHaveLength(0);
  expect(host.querySelector('details')).toBeNull();
  await act(async () => host.querySelector<HTMLAnchorElement>('[aria-label="流量趋势"] footer a')!.click());
  expect(navigate).toHaveBeenCalledWith('traffic', 'start=2026-11-03&end=2026-11-04');
  expect(model.filters).toEqual({ country: 'CN' }); expect(model.filter).not.toHaveBeenCalled(); expect(api).not.toHaveBeenCalled();
});

it('views archive contents in a dialog without restoring or altering history', async () => {
  mocks.api.mockImplementation(async (path: string) => path === 'maintenance/archives' ? [{ id: 'archive', createdAt: '2026-11-04T10:00:00Z', releases: 1, revisions: 2 }] : {id:'archive',page:1,pageSize:50,pages:1,totalReleases:1,totalRevisions:2,releases:[{id:'release',createdAt:'2026-11-01T10:00:00Z'}],revisions:[{revision:1,id:'one',createdAt:'2026-11-01T10:00:00Z'},{revision:2,id:'two',createdAt:'2026-11-01T10:00:00Z'}]});
  await render(<HistoryMaintenance refresh={vi.fn(async () => {})} />); await click('查看归档');
  expect(dialog('归档内容').textContent).toContain('公开版本 1 · 修订 2');
  await click('关闭', dialog('归档内容')); expect(dialog('归档内容')).toBeNull();
  expect(mocks.api).toHaveBeenCalledTimes(2); expect(waitJob).not.toHaveBeenCalled();
});
