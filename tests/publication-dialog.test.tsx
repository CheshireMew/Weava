// @vitest-environment happy-dom
import {act} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {PublicationDialog} from '../apps/admin/src/PublicationDialog.tsx';
vi.mock('../apps/admin/src/PreviewFrame.tsx',()=>({PreviewFrame:({title,src,style}:any)=><div data-preview title={title} data-src={src} style={style}/>}));
let host:HTMLDivElement,root:Root;
beforeEach(()=>{(globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;host=document.createElement('div');document.body.append(host);root=createRoot(host);});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();});
const review=()=>({scope:'entries',baseReleaseId:'previous',settingsChanged:false,layoutsChanged:false,routesChanged:false,termsChanged:false,entries:[{id:'article:1',title:'第一篇文章',path:'/first/',cover:'/media/cover.webp',description:'用于发布前检查的摘要',author:'柴郡',visibility:'public',revision:37,action:'add'},{id:'article:2',title:'第二篇文章',path:'/second/',cover:'',description:'',author:'',visibility:'private',revision:45,action:'update'}],removed:[],options:{candidateId:'frozen-candidate',ids:['article:1','article:2'],revisions:{'article:1':37,'article:2':45}}});
async function click(label:string){await act(async()=>[...host.querySelectorAll<HTMLButtonElement>('button')].find(button=>button.textContent===label||button.getAttribute('aria-label')===label)!.click());}
it('shows the cover, title, summary and author and previews the exact selected revision',async()=>{
 const model:any={publication:review(),setPublication:vi.fn(),busy:false,task:vi.fn()};
 await act(async()=>root.render(<PublicationDialog model={model} error="" onPublished={vi.fn()}/>));
 expect(host.querySelector('img')?.getAttribute('src')).toBe('/media/cover.webp');expect(host.textContent).toContain('用于发布前检查的摘要');expect(host.textContent).toContain('柴郡');
 expect(host.querySelector('[data-preview]')?.getAttribute('data-src')).toBe('/__preview/article%3A1?revision=37&candidate=frozen-candidate');
 await click('窄屏预览');expect(host.querySelector<HTMLElement>('[data-preview]')?.style.width).toBe('390px');
 await click('预览：第二篇文章');expect(host.querySelector('[data-preview]')?.getAttribute('data-src')).toBe('/__preview/article%3A2?revision=45&candidate=frozen-candidate');expect(host.textContent).toContain('私密');
 expect(model.task).not.toHaveBeenCalled();
});
it('returns to editing without publishing and confirms only the reviewed candidate',async()=>{
 const publication=review(),onPublished=vi.fn(),model:any={publication,setPublication:vi.fn(),busy:false,task:vi.fn(async()=>({status:'complete'}))};
 await act(async()=>root.render(<PublicationDialog model={model} error="" onPublished={onPublished}/>));
 await click('返回编辑');expect(model.setPublication).toHaveBeenCalledWith(null);expect(model.task).not.toHaveBeenCalled();
 await click('确认发布');expect(model.task).toHaveBeenCalledWith('publish',publication.options,true);expect(onPublished).toHaveBeenCalledTimes(1);
});
it('keeps a failed confirmation open and disables an empty review',async()=>{
 const model:any={publication:review(),setPublication:vi.fn(),busy:false,task:vi.fn(async()=>undefined)};
 await act(async()=>root.render(<PublicationDialog model={model} error="内容已变化" onPublished={vi.fn()}/>));
 await click('确认发布');expect(model.setPublication).not.toHaveBeenCalled();expect(host.querySelector('[role="alert"]')?.textContent).toBe('内容已变化');
 model.publication={...review(),entries:[]};await act(async()=>root.render(<PublicationDialog model={model} error="" onPublished={vi.fn()}/>));
 expect([...host.querySelectorAll('button')].find(button=>button.textContent==='确认发布')?.disabled).toBe(true);expect(host.querySelector('[data-preview]')).toBeNull();
});
