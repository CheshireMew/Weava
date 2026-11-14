import {entryRecoveryModel} from '../apps/admin/src/entry-recovery-model.ts';
// @vitest-environment happy-dom
import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { entrySchema, type Entry, type Revision } from '@weava/contracts';
import { EditSessionsProvider } from '../apps/admin/src/EditSessions.tsx';
import { EntryRecovery } from '../apps/admin/src/EntryRecovery.tsx';
import { useEntryEditor } from '../apps/admin/src/useEntryEditor.ts';
import { DraftRepository, type DraftDatabase, type DraftRow } from '../apps/admin/src/draft-repository.ts';
import { localDrafts } from '../apps/admin/src/local-drafts.ts';
import {contentCommands} from '../apps/admin/src/content-commands.ts';

const mocks = vi.hoisted(() => ({ api: vi.fn(),waitJob:vi.fn(), repository: null as DraftRepository | null }));
vi.mock('../apps/admin/src/api.ts', () => ({ api: mocks.api,waitJob:mocks.waitJob }));
vi.mock('../apps/admin/src/draft-repository.ts', async importOriginal => ({
  ...await importOriginal<typeof import('../apps/admin/src/draft-repository.ts')>(),
  drafts: () => mocks.repository!,
}));

let root: Root, host: HTMLDivElement, model: ReturnType<typeof useEntryEditor>;
let server: Revision<Entry>, rows: Map<string, DraftRow>;
const setError = vi.fn();
function Harness() {
  model = useEntryEditor({ setError, onSaved:vi.fn(), receiveSchedules:vi.fn(), compact: false });
  return <EntryRecovery model={entryRecoveryModel(model,setError)} />;
}
async function mount() {
  root = createRoot(host);
  await act(async () => root.render(<EditSessionsProvider><Harness /></EditSessionsProvider>));
  await act(async () => model.select(server.id));
}
async function advance(milliseconds: number) {
  await act(async () => { await vi.advanceTimersByTimeAsync(milliseconds); });
}
function closePage() {
  const event = new Event('beforeunload', { cancelable: true });
  Object.defineProperty(event, 'returnValue', { value: '', writable: true });
  window.dispatchEvent(event);
  return event as BeforeUnloadEvent;
}
it('keeps editor selection and returning to the list in sync with the URL',async()=>{
  window.history.replaceState(null,'','/admin/?panel=notes&entry=old');
  await mount();expect(new URLSearchParams(location.search).get('entry')).toBe(server.id);
  expect(new URLSearchParams(location.search).get('panel')).toBe('notes');
  await act(async()=>model.clear());expect(new URLSearchParams(location.search).has('entry')).toBe(false);
  const listUrl=location.href;await act(async()=>model.select(server.id,false));expect(location.href).toBe(listUrl);
  await act(async()=>model.clear(false));expect(location.href).toBe(listUrl);
});
it('saves a body before its title without inserting placeholder text or losing its author',async()=>{
  await mount();
  const blank={id:'new-article',revision:0,updatedAt:'',value:entrySchema.parse({id:'new-article',kind:'content',path:'/new-article/',title:'',author:'柴郡'})};
  await act(async()=>model.adopt(blank));mocks.api.mockClear();
  expect(new URLSearchParams(location.search).has('entry')).toBe(false);
  await act(async()=>model.update({document:{version:1,format:'markdown',source:'先写正文'}}));await advance(1200);
  expect(mocks.api).toHaveBeenCalledWith('entry',expect.objectContaining({revision:null,value:expect.objectContaining({title:'',author:'柴郡',document:expect.objectContaining({source:'先写正文'})})}));
  expect(model.record?.revision).toBe(1);expect(model.record?.value.title).toBe('');expect(model.dirty).toBe(false);
});
it('does not retain an empty new article after text is erased before autosave',async()=>{
  await mount();
  await act(async()=>model.adopt({id:'empty',revision:0,updatedAt:'',value:entrySchema.parse({id:'empty',kind:'content',path:'/empty/',title:''})}));mocks.api.mockClear();
  await act(async()=>model.update({title:'随后清空'}));await advance(250);
  await act(async()=>model.update({title:''}));await advance(1500);
  expect(model.dirty).toBe(false);expect(rows.has('empty')).toBe(false);expect(closePage().defaultPrevented).toBe(false);
  expect(mocks.api).not.toHaveBeenCalledWith('entry',expect.anything());
});
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-11-03T00:00:00Z'));
  localStorage.clear();
  host = document.createElement('div'); document.body.append(host);
  server = { id: 'article', revision: 1, updatedAt: '', value: entrySchema.parse({ id: 'article', kind: 'page', path: '/article/', title: '原文' }) };
  rows = new Map();
  const database: DraftDatabase = {async read(id){return structuredClone(rows.get(id));},async readAll(){return structuredClone([...rows.values()]);}, async transact(id, change) {
    const result = change(structuredClone(rows.get(id)), [...rows.values()].map(({ copies, ...metadata }) => metadata));
    for (const key of result.remove ?? []) rows.delete(key);
    if (result.row) rows.set(id, structuredClone(result.row));
    return structuredClone(rows.get(id)?.copies ?? []);
  } };
  mocks.repository = new DraftRepository(database, localStorage);
  setError.mockClear(); mocks.api.mockReset();
  mocks.api.mockImplementation(async (path: string, body?: any) => {
    if (path === 'entry') {
      server = { ...body, id: body.value.id, revision: body.revision + 1, updatedAt: new Date().toISOString(), value: { ...body.value, updatedAt: new Date().toISOString() } };
      return structuredClone(server);
    }
    return path.startsWith('entry/') ? structuredClone(server) : [];
  });
});
afterEach(async () => {
  await act(async () => root.unmount()); host.remove();
  localStorage.clear(); vi.useRealTimers();
});

it('automatically saves after typing stops, clears recovery storage, and only blocks closing while unsaved', async () => {
  await mount(); expect(closePage().defaultPrevented).toBe(false);
  await act(async () => model.update({ title: '自动保存的文章' }));
  const closing = closePage();
  expect(closing.defaultPrevented).toBe(true);
  expect(closing.returnValue).toBe('文章没有保存，是否确认关闭');
  await advance(250);
  expect(rows.get('article')?.copies).toHaveLength(1);
  expect(mocks.api.mock.calls.filter(([path]) => path === 'entry')).toHaveLength(0);
  await advance(950);
  expect(server.value.title).toBe('自动保存的文章'); expect(model.dirty).toBe(false);
  expect(rows.has('article')).toBe(false); expect(localDrafts('article')).toEqual([]);
  expect(closePage().defaultPrevented).toBe(false);
});

it('keeps local recovery during composition and waits for the completed text before autosaving', async () => {
  await mount();
  await act(async () => document.dispatchEvent(new Event('compositionstart', { bubbles: true })));
  await act(async () => model.update({ title: 'zhong' }));
  await advance(1500);
  expect(rows.get('article')?.copies[0].record.value.title).toBe('zhong');
  expect(mocks.api.mock.calls.filter(([path]) => path === 'entry')).toHaveLength(0);
  await act(async () => {
    model.update({ title: '中文' });
    document.dispatchEvent(new Event('compositionend', { bubbles: true }));
  });
  await advance(1200);
  expect(server.value.title).toBe('中文');
  expect(model.dirty).toBe(false);
});

it('keeps the last keystroke on immediate close and offers one recoverable draft after reopening', async () => {
  await mount();
  await act(async () => model.update({ document: { version: 1, format: 'markdown', source: '刚输入的最后一句' } }));
  expect(closePage().defaultPrevented).toBe(true);
  expect(rows.has('article')).toBe(false);
  expect(localDrafts('article')[0].record.value.document.source).toBe('刚输入的最后一句');
  await act(async () => root.unmount()); await mount();
  expect(model.recoveryCopies).toHaveLength(1);
  expect(model.restoreLocal?.value.document.source).toBe('刚输入的最后一句');
  await act(async () => [...host.querySelectorAll('button')].find(button => button.textContent === '恢复到编辑器')!.click());
  expect(model.record?.value.document.source).toBe('刚输入的最后一句');
  await advance(1200);
  expect(server.value.document.source).toBe('刚输入的最后一句');
  expect(rows.has('article')).toBe(false); expect(model.restoreLocal).toBeNull();
});

it('retains a single draft and close protection when the website cannot save', async () => {
  await mount();
  mocks.api.mockImplementation(async () => { throw new Error('网站暂时无法连接'); });
  await act(async () => model.update({ title: '断线时写的文章' })); await advance(1200);
  expect(model.dirty).toBe(true); expect(setError).toHaveBeenCalledWith('网站暂时无法连接');
  await act(async () => model.update({ title: '断线后继续补充' })); await advance(17000);
  expect(rows.get('article')?.copies).toHaveLength(1);
  expect(rows.get('article')?.copies[0].record.value.title).toBe('断线后继续补充');
  expect(closePage().defaultPrevented).toBe(true);
});
it.each([false, true])('reconciles a lost save acknowledgement, including edits typed later: %s', async moreEdits => {
  await mount(); const implementation=mocks.api.getMockImplementation()!;
  let lost=false;
  mocks.api.mockImplementation(async(path:string,body?:any)=>{
    const result=await implementation(path,body);
    if(path==='entry'&&!lost){lost=true;throw Object.assign(new Error('reply lost'),{status:0});}
    return result;
  });
  await act(async()=>model.update({title:'第一版'})); await advance(1200);
  expect(server.revision).toBe(2); expect(model.dirty).toBe(true);
  if(moreEdits) await act(async()=>model.update({title:'断线后第二版'}));
  await advance(4000);
  expect(server.value.title).toBe(moreEdits?'断线后第二版':'第一版');
  expect(server.revision).toBe(moreEdits?3:2); expect(model.dirty).toBe(false);
  expect(model.conflict).toBeNull(); expect(rows.has('article')).toBe(false);
});
it('leaves a real remote conflict intact and recovers if fetching its comparison disconnects', async()=>{
  await mount(); const original=structuredClone(server); let failComparison=true;
  mocks.api.mockImplementation(async(path:string,body?:any)=>{
    if(path==='entry')throw Object.assign(new Error('conflict'),{status:409});
    if(path==='entry/merge'){
      if(failComparison){failComparison=false;throw Object.assign(new Error('offline'),{status:0});}
      return {id:server.id,base:original,remote:server,local:body.value,fields:[]};
    }
    return structuredClone(server);
  });
  server={...server,revision:2,value:{...server.value,title:'另一窗口修改'}};
  await act(async()=>model.update({title:'本窗口修改'})); await advance(1200);
  expect(model.conflictPaused).toBe(false); await advance(4000);
  expect(model.conflictPaused).toBe(true); expect(model.conflict.remote.value.title).toBe('另一窗口修改');
  expect(model.record?.value.title).toBe('本窗口修改'); expect(model.dirty).toBe(true);
});

it('clears this editing session\'s recovery draft when changes are undone to the saved content', async () => {
  await mount();
  await act(async () => model.update({ title: '稍后撤销的修改' })); await advance(250);
  closePage();
  await act(async () => model.update({ title: '原文' }));
  expect(model.dirty).toBe(false); expect(closePage().defaultPrevented).toBe(false);
  expect(rows.has('article')).toBe(false); expect(localDrafts('article')).toEqual([]);
  expect(mocks.api.mock.calls.filter(([path]) => path === 'entry')).toHaveLength(0);
});

it('does not offer stale recovery when the website saved before a closed page could acknowledge it', async () => {
  await mount();
  await act(async () => model.update({ title: '已经送达服务器' })); closePage();
  server = { ...server, revision: 2, value: { ...model.record!.value, updatedAt: new Date().toISOString() } };
  await act(async () => root.unmount()); await mount();
  expect(model.restoreLocal).toBeNull(); expect(rows.has('article')).toBe(false);
  expect(localDrafts('article')).toEqual([]);
});

it('preserves edits made during a save and clears them only after the latest request succeeds', async () => {
  await mount();
  const pending: { snapshot: any; resolve: (record: Revision<Entry>) => void }[] = [];
  mocks.api.mockImplementation((_path: string, snapshot: any) => new Promise(resolve => pending.push({ snapshot, resolve })));
  await act(async () => model.update({ title: '第一段' })); await advance(1200);
  await act(async () => model.update({ title: '继续写的第二段' })); await advance(250);
  expect(closePage().defaultPrevented).toBe(true);
  const finish = (index: number) => {
    const { snapshot, resolve } = pending[index];
    resolve({ ...snapshot, id: 'article', revision: snapshot.revision + 1, updatedAt: '', value: { ...snapshot.value, updatedAt: new Date().toISOString() } });
  };
  await act(async () => finish(0));
  expect(pending).toHaveLength(2); expect(pending[1].snapshot.revision).toBe(2);
  expect(model.dirty).toBe(true);
  expect(rows.get('article')?.copies[0].record.value.title).toBe('继续写的第二段');
  await act(async () => finish(1));
  expect(model.dirty).toBe(false); expect(model.record?.value.title).toBe('继续写的第二段');
  expect(rows.has('article')).toBe(false); expect(localDrafts('article')).toEqual([]);
  expect(closePage().defaultPrevented).toBe(false);
});
it('recomputes a delayed conflict comparison and preserves edits made while saving its result',async()=>{
  await mount();
  const pending:{path:string;body:any;resolve:(value:any)=>void}[]=[];
  mocks.api.mockImplementation((path:string,body:any)=>new Promise(resolve=>pending.push({path,body,resolve})));
  await act(async()=>model.update({title:'Edit A'}));
  let comparing:Promise<void>;
  await act(async()=>{comparing=model.showConflict(model.record!);});
  await act(async()=>model.update({title:'Edit B'}));
  const comparison=(index:number)=>({id:server.id,base:server,remote:server,local:pending[index].body.value,fields:[]});
  await act(async()=>pending[0].resolve(comparison(0)));
  expect(pending).toHaveLength(2);expect(pending[1].body.value.title).toBe('Edit B');
  await act(async()=>{pending[1].resolve(comparison(1));await comparing!;});
  const commands=()=>contentCommands({editor:model,library:{} as any,refresh:async()=>{},notify:()=>{}});
  let saving:Promise<void>;await act(async()=>{saving=commands().saveMerge({});});
  expect(pending[2].body.value.title).toBe('Edit B');
  await act(async()=>model.update({title:'Edit C'}));
  await act(async()=>pending[2].resolve({...server,revision:2,value:pending[2].body.value}));
  expect(model.record?.value.title).toBe('Edit C');expect(model.dirty).toBe(true);
  await act(async()=>{pending[3].resolve(comparison(3));await saving!;});
  expect(model.conflict.local.title).toBe('Edit C');
});
it('reconciles a completed withdrawal with edits typed while the task was running',async()=>{
 await mount();let finish:(value:any)=>void;
 mocks.waitJob.mockImplementation(()=>new Promise(resolve=>finish=resolve));
 mocks.api.mockImplementation(async(path:string,body:any)=>path==='withdraw'?{id:'withdraw-job'}:path==='entry/merge'?{id:server.id,base:server,remote:server,local:body.value}:server);
 let withdrawing:Promise<void>;await act(async()=>{withdrawing=contentCommands({editor:model,library:{} as any,refresh:async()=>{},notify:()=>{}}).withdraw();});
 await act(async()=>model.update({title:'Typed while withdrawing'}));server={...server,revision:2};
 await act(async()=>{finish!({status:'complete'});await withdrawing!;});
 expect(model.record?.value.title).toBe('Typed while withdrawing');expect(model.dirty).toBe(true);expect(model.conflict.local.title).toBe('Typed while withdrawing');
});
