// @vitest-environment happy-dom
import {act, useState} from 'react';
import {createRoot, type Root} from 'react-dom/client';
import {afterEach, beforeEach, expect, it, vi} from 'vitest';
import {entrySchema} from '@weava/contracts';
import {EntryEditor} from '../apps/admin/src/EntryEditor.tsx';
import {SelectorsProvider} from '../apps/admin/src/Selectors.tsx';
import {EditSessionsProvider} from '../apps/admin/src/EditSessions.tsx';
import {contentWorkspaceFixture} from './content-workspace-fixture.ts';

vi.mock('../apps/admin/src/Editor.tsx',()=>({Editor:()=> <div contentEditable aria-label="正文编辑器"/>}));
let host:HTMLDivElement,root:Root;
beforeEach(()=>{(globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;host=document.createElement('div');document.body.append(host);root=createRoot(host);vi.useFakeTimers({toFake:['requestAnimationFrame','cancelAnimationFrame']});});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();vi.useRealTimers();});
async function click(label:string){await act(async()=>{[...document.querySelectorAll<HTMLButtonElement>('button')].find(node=>node.textContent===label||node.getAttribute('aria-label')===label)!.click();});}
async function frames(){for(let i=0;i<4;i++)await act(async()=>{await vi.advanceTimersByTimeAsync(20);});}
async function mount(path:string,fields:any[]=[],values:Record<string,unknown>={}){
  const state=contentWorkspaceFixture({types:[{id:'post',value:{id:'post',label:'文章',fields}}]});
  function Form(){
    const [value,setValue]=useState(entrySchema.parse({id:'post',kind:'content',title:'审查文章',path:'/post/',type:'post',fields:values}));
    const record={id:'post',revision:1,updatedAt:'',value};
    const update=(patch:any)=>setValue(old=>({...old,...patch}));
    const check={id:'post',valid:false,errors:[{path,code:'required',message:'请修正此字段'}]};
    const model:any={record,update,state,contentCheck:check,check:async()=>{},settings:{record,update,state,contentCheck:check,schedule:{items:[]},moreActions:{record}},recovery:{record:null},persist:async()=>record};
    return <EntryEditor model={model}/>;
  }
  await act(async()=>root.render(<EditSessionsProvider><SelectorsProvider><Form/></SelectorsProvider></EditSessionsProvider>));
  await click('更多编辑操作');await click('检查');
}
it('closes the settings dialog and focuses the required field so typing can continue',async()=>{
  await mount('fields.url',[{key:'url',label:'网址',type:'text',required:true}]);
  expect(document.querySelector('dialog[open]')).not.toBeNull();await click('请修正此字段');await frames();
  expect(document.querySelector('dialog')).toBeNull();expect(document.activeElement).toBe(host.querySelector('[aria-label="网址"]'));
  const input=document.activeElement as HTMLInputElement;
  await act(async()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(input,'https://example.com');input.dispatchEvent(new Event('input',{bubbles:true}));});
  expect(input.value).toBe('https://example.com');
});
it('opens the owning repeat-item editor before focusing a nested required field',async()=>{
  await mount('fields.people.0.name',[{key:'people',label:'人物',type:'group',multiple:true,fields:[{key:'name',label:'姓名',type:'text',required:true},{key:'role',label:'职务',type:'text'},{key:'note',label:'说明',type:'text'}]}],{people:[{name:'',role:'',note:''}]});
  await click('请修正此字段');await frames();
  expect(document.querySelector('dialog[aria-label="文章设置"]')).toBeNull();expect(document.querySelector<HTMLDialogElement>('dialog[aria-label="编辑人物"]')?.open).toBe(true);
  expect(document.activeElement?.getAttribute('aria-label')).toBe('姓名');
});
it('selects an unvisited settings tab and focuses its field without closing the dialog',async()=>{
  await mount('seo.description');await click('请修正此字段');await frames();
  const panel=host.querySelector('[role="tabpanel"]:not([hidden])')!;
  expect(panel.textContent).toContain('搜索摘要');expect(document.querySelector('dialog[open]')).not.toBeNull();
  expect(document.activeElement).toBe(panel.querySelector('textarea'));
});
it('keeps errors without an editable destination as text instead of a dead button',async()=>{
  await mount('type');expect([...document.querySelectorAll('button')].some(node=>node.textContent==='请修正此字段')).toBe(false);
  expect(document.querySelector('.content-check')?.textContent).toContain('请修正此字段');
});
it('shows an empty title as a placeholder and exposes the author next to article options',async()=>{
  const update=vi.fn(),record={id:'new',revision:0,updatedAt:'',value:entrySchema.parse({id:'new',kind:'content',title:'',path:'/new/',author:'柴郡'})};
  const state=contentWorkspaceFixture({types:[{id:'post',value:{id:'post',label:'文章'}}]});
  const model:any={record,update,state,settings:{record,update,state,schedule:{items:[]},moreActions:{record}},recovery:{record:null}};
  await act(async()=>root.render(<EditSessionsProvider><SelectorsProvider><EntryEditor model={model}/></SelectorsProvider></EditSessionsProvider>));
  const title=host.querySelector<HTMLTextAreaElement>('[aria-label="内容标题"]')!;
  expect(title.value).toBe('');expect(title.placeholder).toBe('未命名内容');expect(host.querySelector('.save-status')).toBeNull();
  await click('设置作者');expect(document.querySelector<HTMLInputElement>('[aria-label="作者姓名"]')?.value).toBe('柴郡');
});
