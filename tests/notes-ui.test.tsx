import {contentWorkspaceFixture} from './content-workspace-fixture.ts';
// @vitest-environment happy-dom
import {act} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {beforeEach,afterEach,it,expect,vi} from 'vitest';
import {NoteEditor} from '../apps/admin/src/NoteEditor.tsx';
import {NotesLibrary} from '../apps/admin/src/NotesLibrary.tsx';
import {useContentWorkspace} from '../apps/admin/src/useContentWorkspace.ts';
import {EditSessionsProvider} from '../apps/admin/src/EditSessions.tsx';
import {entrySchema} from '../packages/contracts/src/index.ts';
import {adminQueries} from '../apps/admin/src/query-cache.ts';
import {useContentLibrary} from '../apps/admin/src/useContentLibrary.ts';
import {api,waitJob} from '../apps/admin/src/api.ts';
import {DraftRepository} from '../apps/admin/src/draft-repository.ts';
import {importedDocument} from '../packages/core/src/imported-document.ts';
vi.mock('../apps/admin/src/Selectors.tsx',()=>({useSelectors:()=>({media:async()=>null})}));
vi.mock('../apps/admin/src/api.ts',()=>({api:vi.fn(async(path:string)=>path.startsWith('entries/query')?{items:[],total:0,pages:0}:[]),waitJob:vi.fn()}));
let host:HTMLDivElement,root:Root;
beforeEach(()=>{localStorage.clear();adminQueries.invalidate(true);(globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;host=document.createElement('div');document.body.append(host);root=createRoot(host);});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();});
const noteModel=(model:any)=>({...model,author:{name:model.state?.settings.value.name??'',logo:model.state?.siteIcon??model.state?.settings.value.logo??''},recovery:{record:null}});
const entry=entrySchema.parse({id:'existing-note',kind:'content',type:'wordpress-moment',status:'published',title:'原有笔记',path:'/moments/133.html',document:{version:1,format:'html',source:'<div style="color:white!important"><p>正常正文<a href="https://example.com/">参考链接</a></p><img src="/media/a.png"></div>'}});
const row={id:entry.id,value:entry,revision:10,updatedAt:'2026-11-05T00:00:00Z'};
it('keeps late edits when a durable delete finishes and does not close a different selected editor',async()=>{
 let workspace:any,finish:(value:any)=>void;const notify=vi.fn(),state={types:[]};
 vi.mocked(api).mockImplementation(async(path:string):Promise<any>=>path==='entries/delete'?{id:'delete-job'}:path.startsWith('entries/query')?{items:[],total:0,pages:0}:[]);
 vi.mocked(waitJob).mockImplementation(()=>new Promise(resolve=>finish=resolve));
 function Harness(){workspace=useContentWorkspace({state:contentWorkspaceFixture(state),receiveSchedules:vi.fn(),tab:'content',compact:false,busy:false,setError:vi.fn(),notify,refresh:async()=>{},task:vi.fn()});return null;}
 await act(async()=>root.render(<EditSessionsProvider><Harness/></EditSessionsProvider>));await act(async()=>workspace.navigation.adopt(row));
 let deleting:Promise<void>;await act(async()=>{deleting=workspace.library.actions.deleteEntry(row);});
 await act(async()=>workspace.editor.update({title:'Typed while deleting'}));await act(async()=>{finish!({status:'complete'});await deleting!;});
 expect(workspace.editor.record.value.title).toBe('Typed while deleting');expect(workspace.editor.dirty).toBe(true);expect(notify).toHaveBeenCalledWith(expect.stringContaining('新修改保留'));
 await act(async()=>workspace.navigation.adopt(row));await act(async()=>{deleting=workspace.library.actions.deleteEntry(row);});
 await act(async()=>workspace.navigation.adopt({...row,id:'other',value:{...row.value,id:'other',title:'Other editor'}}));
 await act(async()=>{finish!({status:'complete'});await deleting!;});expect(workspace.editor.record.id).toBe('other');
});
it('opens an empty article without saving it and remembers the chosen author across editor sessions',async()=>{
 let workspace:any;const notify=vi.fn();
 const state={types:[{id:'post',value:{id:'post',pathPrefix:'/posts/'}}]};
 vi.mocked(api).mockImplementation(async(path:string):Promise<any>=>path.startsWith('entries/query')?{items:[],total:0,pages:0}:[]);
 function Harness(){workspace=useContentWorkspace({state:contentWorkspaceFixture(state),receiveSchedules:vi.fn(),tab:'content',compact:false,busy:false,setError:vi.fn(),notify,refresh:async()=>{},task:vi.fn()});return null;}
 await act(async()=>root.render(<EditSessionsProvider><Harness/></EditSessionsProvider>));
 vi.mocked(api).mockClear();await act(async()=>workspace.library.newEntry('post'));
 expect(workspace.editor.record.revision).toBe(0);expect(workspace.editor.record.value.title).toBe('');expect(workspace.editor.dirty).toBe(false);
 await act(async()=>workspace.editor.update({author:'柴郡'}));
 await act(async()=>{await workspace.editor.persist();workspace.navigation.clear();});
 expect(vi.mocked(api).mock.calls.filter(([path])=>path==='entry'||path==='entries/create')).toHaveLength(0);
 await act(async()=>root.unmount());root=createRoot(host);
 await act(async()=>root.render(<EditSessionsProvider><Harness/></EditSessionsProvider>));await act(async()=>workspace.library.newEntry('post'));
 expect(workspace.editor.record.value.author).toBe('柴郡');expect(workspace.editor.dirty).toBe(false);
 await act(async()=>workspace.navigation.adopt({...row,value:{...row.value,author:'原作者'}}));
 expect(workspace.editor.record.value.author).toBe('原作者');
});
it('creates the requested article type and preserves the library context instead of silently filtering it',async()=>{
 let workspace:any;const state={types:[{id:'doc',value:{id:'doc',pathPrefix:'/docs/'}},{id:'post',value:{id:'post',pathPrefix:'/posts/'}}]};
 const result={id:'new-post',revision:1,value:entrySchema.parse({id:'new-post',kind:'content',type:'post',title:'新文章',path:'/posts/new/'})};
 vi.mocked(api).mockImplementation(async(path:string):Promise<any>=>path==='entries/create'?result:path.startsWith('entries/query')?{items:[],total:0,pages:0}:[]);
 function Harness(){workspace=useContentWorkspace({state:contentWorkspaceFixture(state),receiveSchedules:vi.fn(),tab:'content',compact:false,busy:false,setError:vi.fn(),notify:vi.fn(),refresh:vi.fn(async()=>{}),task:vi.fn()});return null;}
 await act(async()=>root.render(<EditSessionsProvider><Harness/></EditSessionsProvider>));
 await act(async()=>{workspace.library.setFilter('原搜索');workspace.library.setStatus('published');workspace.library.setVisibility('private');});
 await act(async()=>workspace.library.setLibraryPage(2));
 await act(async()=>workspace.library.newEntry('post'));
 expect(api).not.toHaveBeenCalledWith('entries/create',expect.anything());expect(workspace.editor.record.revision).toBe(0);
 expect(workspace.editor.record.value.type).toBe('post');expect(workspace.library.libraryType).toBe('');expect(workspace.library.status).toBe('published');expect(workspace.library.visibility).toBe('private');expect(workspace.library.filter).toBe('原搜索');expect(workspace.library.libraryPage).toBe(2);
 vi.mocked(api).mockImplementation(async(path:string):Promise<any>=>path.startsWith('entries/query')?{items:[],total:0,pages:0}:[]);
});
it('opens imported notes as readable HTML without exposing source or article settings',async()=>{
 const update=vi.fn(),publish=vi.fn(async()=>{}),model={record:row,state:{settings:{value:{name:'作者',logo:''}}},persist:vi.fn(),clear:vi.fn(),update,publish,setError:vi.fn()};
 await act(async()=>root.render(<NoteEditor model={noteModel(model) as any}/>));
 const frame=host.querySelector('iframe')!;expect(frame.title).toBe('笔记正文编辑器');const content=new DOMParser().parseFromString(frame.srcdoc,'text/html');
 expect(content.querySelector('#page-text')?.textContent).toBe('正常正文参考链接');expect(content.querySelector('#page-text [style]')).toBeNull();expect(content.querySelector('a')?.getAttribute('href')).toBe('https://example.com/');expect(content.querySelector('img')?.getAttribute('src')).toBe('/media/a.png');
 expect(host.querySelector('dialog[open]')?.getAttribute('aria-label')).toBe('编辑笔记');expect(host.querySelector('textarea')).toBeNull();expect(host.textContent).not.toMatch(/保留的来源|封面|草稿|预览/);expect(update).not.toHaveBeenCalled();
 await act(async()=>[...host.querySelectorAll('button')].find(button=>button.textContent==='保存修改')!.click());expect(publish).toHaveBeenCalledOnce();
});
it('distinguishes note drafts, published notes and unpublished changes without article filters or covers',async()=>{
 const model={items:[{...row,id:'draft',published:false},{...row,id:'published',published:true,hasChanges:false},{...row,id:'changed',published:true,hasChanges:true}],library:{pages:1},filter:'',setFilter:vi.fn(),select:vi.fn(),newEntry:vi.fn(),tab:'notes'};
 await act(async()=>root.render(<NotesLibrary model={model as any}/>));expect(host.textContent).toContain('写笔记');expect([...host.querySelectorAll('.entry-state')].map(node=>node.textContent)).toEqual(['草稿','已发布','有未发布修改']);expect(host.textContent).not.toMatch(/筛选|封面/);expect(host.querySelector('img,.publication-cover,select')).toBeNull();
});

it('does not save or retitle a published legacy note when it is opened, viewed, switched or closed',async()=>{
 const original={...row,value:{...entry,title:'B-roll 是什么？',document:importedDocument('<p>在视频制作中，<strong>B-roll</strong> 指的是补充画面。</p><ul><li><p><strong>场景：</strong>完整内容。</p></li></ul>')}};
 let workspace:any;
 const state={settings:{value:{name:'作者'}},types:[{id:'wordpress-moment',value:{id:'wordpress-moment',format:'note'}}]};
 function Harness(){workspace=useContentWorkspace({state:contentWorkspaceFixture(state),receiveSchedules:vi.fn(),tab:'notes',compact:false,busy:false,setError:vi.fn(),notify:vi.fn(),refresh:vi.fn(),task:vi.fn()});return <NoteEditor model={workspace.editor}/>;}
 await act(async()=>{await import('../apps/admin/src/Editor.tsx');root.render(<EditSessionsProvider><Harness/></EditSessionsProvider>);});
 await act(async()=>workspace.navigation.adopt(original));vi.mocked(api).mockClear();
 expect(host.querySelector('.visual-editor')).not.toBeNull();
 await act(async()=>host.querySelector<HTMLElement>('.visual-editor')!.click());
 await act(async()=>host.querySelector<HTMLButtonElement>('[aria-label="切换为 Markdown"]')!.click());
 expect(workspace.editor.record.value.document).toEqual(original.value.document);
 await act(async()=>host.querySelector<HTMLButtonElement>('[aria-label="切换为富文本"]')!.click());
 expect(workspace.editor.dirty).toBe(false);expect(workspace.editor.record.value.title).toBe('B-roll 是什么？');
 await act(async()=>[...host.querySelectorAll<HTMLButtonElement>('button')].find(button=>button.textContent==='关闭')!.click());
 expect(workspace.editor.record).toBeNull();expect(vi.mocked(api).mock.calls.filter(([path])=>path==='entry')).toHaveLength(0);
 await act(async()=>workspace.navigation.adopt(original));
 await act(async()=>host.querySelector<HTMLButtonElement>('[aria-label="切换为 Markdown"]')!.click());
 const field=host.querySelector('textarea')!;field.setSelectionRange(0,2);
 await act(async()=>host.querySelector<HTMLButtonElement>('[aria-label="加粗"]')!.click());expect(workspace.editor.dirty).toBe(true);
 await act(async()=>host.querySelector<HTMLButtonElement>('[aria-label="撤销"]')!.click());
 expect(workspace.editor.dirty).toBe(false);expect(workspace.editor.record.value.title).toBe('B-roll 是什么？');
 expect(workspace.editor.record.value.document).toEqual(original.value.document);
 await act(async()=>[...host.querySelectorAll<HTMLButtonElement>('button')].find(button=>button.textContent==='关闭')!.click());
 expect(vi.mocked(api).mock.calls.filter(([path])=>path==='entry')).toHaveLength(0);
});
it('publishes a note in one step and leaves the editor only after success',async()=>{
 let workspace:any;const task=vi.fn(async()=>({status:'complete'})),notify=vi.fn();const state={settings:{value:{name:'站点'}},types:[{id:'wordpress-moment',value:{id:'wordpress-moment'}}]};
 function Harness(){workspace=useContentWorkspace({state:contentWorkspaceFixture(state),receiveSchedules:vi.fn(),tab:'notes',compact:false,busy:false,setError:vi.fn(),notify,refresh:vi.fn(),task});return null;}
 await act(async()=>root.render(<EditSessionsProvider><Harness/></EditSessionsProvider>));await act(async()=>workspace.navigation.adopt(row));await act(async()=>workspace.editor.publish());
 expect(task).toHaveBeenCalledWith('publish',{ids:[row.id],revisions:{[row.id]:row.revision}},true);expect(workspace.editor.record).toBeNull();expect(notify).toHaveBeenCalledWith('已更新');
});
it('never exposes articles while switching to notes or waiting for a delayed notes response',async()=>{
 const state={types:[]};let model:any,resolveNotes:(value:any)=>void;
 vi.mocked(api).mockImplementation(async(path:string):Promise<any>=>{
  if(path.includes('format=note'))return new Promise(resolve=>{resolveNotes=resolve;});
  return {items:[{id:'article',value:{title:'不应显示在笔记里的文章'}}],total:1,pages:1};
 });
 function Harness({tab}:{tab:string}){model=useContentLibrary(contentWorkspaceFixture(state),tab,vi.fn());return <div>{model.items.map((item:any)=><span key={item.id}>{item.id}</span>)}</div>;}
 await act(async()=>root.render(<Harness tab="content"/>));expect(host.textContent).toBe('article');
 await act(async()=>root.render(<Harness tab="notes"/>));expect(host.textContent).toBe('');expect(model.libraryLoading).toBe(true);
 await act(async()=>resolveNotes!({items:[row],total:1,pages:1}));expect(host.textContent).toBe(row.id);expect(model.libraryLoading).toBe(false);
 vi.mocked(api).mockImplementation(async(path:string):Promise<any>=>path.startsWith('entries/query')?{items:[],total:0,pages:0}:[]);
});
it('restores each library view and keeps cached articles usable during a background refresh',async()=>{
 vi.useFakeTimers();
 try {
  let model:any,finish!:(value:any)=>void;
  const state=contentWorkspaceFixture({types:[{id:'post',value:{id:'post'}},{id:'note',value:{id:'note',format:'note'}}]});
  const page=(id:string)=>({items:[{id,value:{title:id}}],total:75,pages:3,page:3,pageSize:25});
  vi.mocked(api).mockImplementation(async(path:string):Promise<any>=>page(path));
  function View({tab}:{tab:string}){model=useContentLibrary(state,tab,vi.fn());return <div>{model.libraryLoading?'正在查找内容…':model.items[0]?.id}</div>;}
  await act(async()=>root.render(<View tab="content"/>));
  await act(async()=>{model.setFilter('编程');model.setStatus('published');});
  await act(async()=>vi.advanceTimersByTimeAsync(200));
  await act(async()=>model.setLibraryPage(3));
  const article=host.textContent;
  await act(async()=>root.render(<View tab="notes"/>));expect(model.filter).toBe('');expect(model.libraryPage).toBe(1);
  await act(async()=>model.setFilter('日记'));await act(async()=>vi.advanceTimersByTimeAsync(200));
  await act(async()=>root.render(<View tab="analytics"/>));
  await act(async()=>vi.advanceTimersByTimeAsync(31000));
  vi.mocked(api).mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));
  await act(async()=>root.render(<View tab="content"/>));
  expect(model.filter).toBe('编程');expect(model.status).toBe('published');expect(model.libraryPage).toBe(3);
  expect(model.libraryLoading).toBe(false);expect(host.textContent).toBe(article);
  await act(async()=>finish(page('刷新后的文章')));expect(host.textContent).toBe('刷新后的文章');
  vi.mocked(api).mockImplementation(async(path:string):Promise<any>=>page(path));
  await act(async()=>root.render(<View tab="notes"/>));expect(model.filter).toBe('日记');expect(model.libraryPage).toBe(1);
 } finally {vi.useRealTimers();}
});
it('opens a new note immediately without creating an empty record or inheriting an article type',async()=>{
 let workspace:any;const state={types:[{id:'post',value:{id:'post',pathPrefix:'/posts/'}},{id:'note',value:{id:'note',format:'note',pathPrefix:'/notes/'}}]};
 function Harness(){workspace=useContentWorkspace({state:contentWorkspaceFixture(state),receiveSchedules:vi.fn(),tab:'notes',compact:false,busy:false,setError:vi.fn(),notify:vi.fn(),refresh:vi.fn(),task:vi.fn()});return null;}
 await act(async()=>root.render(<EditSessionsProvider><Harness/></EditSessionsProvider>));await act(async()=>workspace.library.setLibraryType('post'));vi.mocked(api).mockClear();
 await act(async()=>workspace.editor.newEntry());expect(workspace.editor.record.value.type).toBe('note');expect(workspace.editor.record.revision).toBe(0);expect(workspace.editor.record.value.path).toMatch(/^\/notes\/[0-9a-f]{8}\/$/);expect(api).not.toHaveBeenCalledWith('entries/create',expect.anything());
 await act(async()=>{await workspace.editor.persist();workspace.navigation.clear();});expect(workspace.editor.record).toBeNull();expect(api).not.toHaveBeenCalledWith('entry',expect.anything());
});
it('keeps the whole long HTML note in one scrollable modal body with persistent controls',async()=>{
 const source='<p>开头</p>'+Array.from({length:30},(_,i)=>'<p>第'+i+'段完整内容</p>').join('')+'<h3>B-roll 的三大核心作用：</h3><p>总结：B-roll 是摆盘和配菜。</p>';
 const model={record:{...row,value:{...entry,document:{version:1,format:'html',source}}},state:{settings:{value:{name:'作者',logo:''}}},persist:vi.fn(),clear:vi.fn(),update:vi.fn(),publish:vi.fn(),setError:vi.fn()};
 await act(async()=>root.render(<NoteEditor model={noteModel(model) as any}/>));
 const frame=host.querySelector('.note-composer-body iframe')!;expect(frame.getAttribute('srcdoc')).toContain('总结：B-roll 是摆盘和配菜。');expect(host.querySelector('.note-composer-header button[aria-label="关闭笔记窗口"]')).not.toBeNull();expect(host.querySelector('.note-composer-footer .primary')?.textContent).toBe('保存修改');expect(model.update).not.toHaveBeenCalled();
});
it('keeps note settings inside the modal so the controls remain interactive',async()=>{
 const model={record:row,state:{settings:{value:{name:'作者',logo:''}}},persist:vi.fn(),clear:vi.fn(),update:vi.fn(),publish:vi.fn(),setError:vi.fn()};
 await act(async()=>root.render(<NoteEditor model={noteModel(model) as any}/>));await act(async()=>host.querySelector<HTMLButtonElement>('[aria-label="笔记设置"]')!.click());
 expect(host.querySelector('dialog .admin-popover [aria-label="笔记可见性"]')).not.toBeNull();
 await act(async()=>document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true})));expect(host.querySelector('.admin-popover')).toBeNull();expect(host.querySelector('dialog')?.open).toBe(true);
});
it('keeps edits made during publication and does not let an old completion close another note',async()=>{
 let workspace:any,complete!:(value:any)=>void;
 const task=vi.fn(()=>new Promise(resolve=>{complete=resolve;}));
 function Harness(){workspace=useContentWorkspace({state:contentWorkspaceFixture({types:[{id:'wordpress-moment',value:{id:'wordpress-moment'}}]}),receiveSchedules:vi.fn(),tab:'notes',compact:false,busy:false,setError:vi.fn(),notify:vi.fn(),refresh:vi.fn(),task});return null;}
 await act(async()=>root.render(<EditSessionsProvider><Harness/></EditSessionsProvider>));await act(async()=>workspace.navigation.adopt(row));
 let publishing:Promise<unknown>;await act(async()=>{publishing=workspace.editor.publish();await Promise.resolve();});
 await act(async()=>workspace.editor.update({document:{version:1,format:'markdown',source:'New text while publishing'}}));
 await act(async()=>{complete({status:'complete'});await publishing!;});
 expect(workspace.editor.record.value.document.source).toBe('New text while publishing');expect(workspace.editor.publicationNotice).toContain('尚未发布');
 await act(async()=>workspace.navigation.adopt(row));await act(async()=>{publishing=workspace.editor.publish();await Promise.resolve();});
 await act(async()=>workspace.navigation.adopt({...row,id:'another',value:{...row.value,id:'another'}}));
 await act(async()=>{complete({status:'complete'});await publishing!;});expect(workspace.editor.record.id).toBe('another');
});
it('offers and recovers a note that exists only in the browser after a new workspace opens',async()=>{
 const local={...row,id:'local-only',revision:0,value:{...row.value,id:'local-only',title:'Browser text',document:{version:1,format:'markdown',source:'Browser text'}}};
 const copy={id:local.id,sessionId:'previous-window',capturedAt:1,updatedAt:1,record:local};
 const list=vi.spyOn(DraftRepository.prototype,'list').mockResolvedValue([copy] as any),read=vi.spyOn(DraftRepository.prototype,'read').mockResolvedValue([copy] as any),save=vi.spyOn(DraftRepository.prototype,'save').mockResolvedValue([copy] as any);
 vi.mocked(api).mockImplementation(async(path:string):Promise<any>=>{if(path.startsWith('entries/query'))return {items:[],total:0,pages:0};if(path.startsWith('entry/'))throw Object.assign(new Error('内容不存在。'),{status:404});return [];});
 let workspace:any;const state={types:[{id:'wordpress-moment',value:{id:'wordpress-moment',pathPrefix:'/notes/'}}]};
 function Harness(){workspace=useContentWorkspace({state:contentWorkspaceFixture(state),receiveSchedules:vi.fn(),tab:'notes',compact:false,busy:false,setError:vi.fn(),notify:vi.fn(),refresh:vi.fn(),task:vi.fn()});return <NotesLibrary model={workspace.library}/>;}
 try{
  await act(async()=>root.render(<EditSessionsProvider><Harness/></EditSessionsProvider>));
  const recover=[...host.querySelectorAll('button')].find(button=>button.textContent==='恢复 Browser text')!;expect(recover).toBeDefined();
  await act(async()=>recover.click());expect(workspace.editor.record.id).toBe(local.id);expect(workspace.editor.record.value.document.source).toBe('Browser text');expect(workspace.editor.dirty).toBe(true);expect(read).toHaveBeenCalledWith(local.id);
 }finally{await act(async()=>root.render(null));list.mockRestore();read.mockRestore();save.mockRestore();}
});
