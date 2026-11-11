// @vitest-environment happy-dom
import {act} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import TrashPanel from '../apps/admin/src/Trash.tsx';
import {api} from '../apps/admin/src/api.ts';
import {adminQueries} from '../apps/admin/src/query-cache.ts';

vi.mock('../apps/admin/src/api.ts',()=>({api:vi.fn()}));
let host:HTMLDivElement,root:Root,rows:any[];
beforeEach(()=>{
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;
  host=document.createElement('div');document.body.append(host);root=createRoot(host);
  adminQueries.resume();vi.mocked(api).mockReset();
  rows=['first','second'].map((id,index)=>({id,revision:index+7,title:id==='first'?'未命名内容':'模板（副本）',path:'/posts/'+id+'/',kind:'content',type:'post',deletedAt:'2026-11-11T00:00:00Z'}));
  vi.mocked(api).mockImplementation(async(path:any,body:any)=>{
    if(path==='entries/trash/purge'||path==='entries/trash/restore'){
      rows=rows.filter(row=>row.id!==body.id);return {id:body.id};
    }
    return {items:rows,total:rows.length,pages:rows.length?1:0,page:1,pageSize:25};
  });
});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();});
async function click(text:string){await act(async()=>[...host.querySelectorAll<HTMLButtonElement>('button')].find(button=>button.textContent===text)!.click());}
async function open(){await act(async()=>root.render(<TrashPanel/>));expect(host.querySelector('h1')?.textContent).toBe('回收站');expect(host.querySelector('dialog')).toBeNull();}

it('permanently deletes the selected trash entry with one click and shows progress and completion',async()=>{
  await open();
  const handler=vi.mocked(api).getMockImplementation()!;
  let complete!:()=>void;
  vi.mocked(api).mockImplementation((path:any,body:any)=>path==='entries/trash/purge'?new Promise(resolve=>{complete=async()=>resolve(await handler(path,body));}):handler(path,body));
  await click('永久删除');
  expect(api).toHaveBeenCalledWith('entries/trash/purge',{id:'first',revision:7,confirmation:'永久删除'});
  expect(host.querySelector('input:not([type="search"]),section.form-card')).toBeNull();
  const deleting=[...host.querySelectorAll<HTMLButtonElement>('button')].find(button=>button.textContent==='正在删除…')!;
  expect(deleting.disabled).toBe(true);
  await act(async()=>deleting.click());
  expect(vi.mocked(api).mock.calls.filter(([path])=>path==='entries/trash/purge')).toHaveLength(1);
  await act(async()=>complete());
  expect(host.querySelector('.trash-list')?.textContent).not.toContain('未命名内容');expect(host.textContent).toContain('模板（副本）');
  expect(host.querySelector('.trash-feedback')?.textContent).toContain('已永久删除');
});

it('keeps a failed trash deletion available for a direct retry',async()=>{
  await open();vi.mocked(api).mockRejectedValueOnce(new Error('删除失败，请重试。'));
  await click('永久删除');
  expect(host.querySelector('[role="alert"]')?.textContent).toContain('删除失败');
  expect(host.textContent).toContain('未命名内容');expect(host.querySelector('.trash-feedback')).toBeNull();
  await click('永久删除');
  expect(host.querySelector('[role="alert"]')).toBeNull();expect(host.querySelector('.trash-list')?.textContent).not.toContain('未命名内容');
  expect(host.querySelector('.trash-feedback')?.textContent).toContain('已永久删除');
});

it('restores the selected entry as a draft without calling permanent deletion',async()=>{
  await open();await click('恢复为草稿');
  expect(api).toHaveBeenCalledWith('entries/trash/restore',{id:'first',revision:7});
  expect(vi.mocked(api).mock.calls.some(([path])=>path==='entries/trash/purge')).toBe(false);
  expect(host.querySelector('.trash-list')?.textContent).not.toContain('未命名内容');expect(host.querySelector('.trash-feedback')?.textContent).toContain('已恢复为草稿');
});
