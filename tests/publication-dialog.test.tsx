// @vitest-environment happy-dom
import {act} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {PublicationDialog} from '../apps/admin/src/PublicationDialog.tsx';
vi.mock('../apps/admin/src/background-tasks.ts',()=>({awaitTask:vi.fn(async()=>({id:'publish-job',status:'queued'}))}));
let host:HTMLDivElement,root:Root;
beforeEach(()=>{(globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;host=document.createElement('div');document.body.append(host);root=createRoot(host);});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();});
const review=()=>({scope:'entries',baseReleaseId:'previous',settingsChanged:false,layoutsChanged:false,routesChanged:false,termsChanged:false,entries:[{id:'article:1',title:'第一篇文章',path:'/first/',url:'https://blog.example.com/posts/6fb11af5/',cover:'/media/cover.webp',description:'用于发布前检查的摘要',author:'柴郡',visibility:'public',revision:37,action:'add'},{id:'article:2',title:'第二篇文章',path:'/second/',url:'https://blog.example.com/guide/hello-world/',cover:'',description:'',author:'',visibility:'private',revision:45,action:'update'}],removed:[],options:{candidateId:'frozen-candidate',ids:['article:1','article:2'],revisions:{'article:1':37,'article:2':45}}});
async function click(label:string){await act(async()=>[...host.querySelectorAll<HTMLButtonElement>('button')].find(button=>button.textContent===label||button.getAttribute('aria-label')===label)!.click());}
it('shows content cards with cover, title, summary and author without page previews',async()=>{
 const model:any={publication:review(),setPublication:vi.fn(),busy:false,submit:vi.fn()};
 await act(async()=>root.render(<PublicationDialog model={model} error="" onPublished={vi.fn()}/>));
 expect(host.querySelector('img')?.getAttribute('src')).toBe('/media/cover.webp');expect(host.textContent).toContain('用于发布前检查的摘要');expect(host.textContent).toContain('柴郡');
 expect(host.querySelectorAll('article.publication-review-card')).toHaveLength(2);
 expect(host.querySelector('iframe, [aria-label="页面预览"], [aria-label="预览宽度"]')).toBeNull();
 expect(host.querySelector('button.publication-review-card')).toBeNull();expect(host.textContent).toContain('私密');
 expect([...host.querySelectorAll('.publication-review-path')].map(node=>node.textContent)).toEqual([
  'https://blog.example.com/posts/6fb11af5/',
  'https://blog.example.com/guide/hello-world/',
 ]);
 expect(host.querySelectorAll('.publication-review-url')).toHaveLength(2);
 expect(model.submit).not.toHaveBeenCalled();
});
it('returns to editing without publishing and confirms only the reviewed candidate',async()=>{
 const publication=review(),onPublished=vi.fn(),model:any={publication,setPublication:vi.fn(),busy:false,submit:vi.fn(async()=>({status:'complete'}))};
 await act(async()=>root.render(<PublicationDialog model={model} error="" onPublished={onPublished}/>));
 await click('返回编辑');expect(model.setPublication).toHaveBeenCalledWith(null);expect(model.submit).not.toHaveBeenCalled();
 await click('确认发布');expect(model.submit).toHaveBeenCalledWith('publish',publication.options);expect(onPublished).toHaveBeenCalledTimes(1);
});
it('keeps a failed confirmation open and disables an empty review',async()=>{
 const model:any={publication:review(),setPublication:vi.fn(),busy:false,submit:vi.fn(async()=>undefined)};
 await act(async()=>root.render(<PublicationDialog model={model} error="内容已变化" onPublished={vi.fn()}/>));
 await click('确认发布');expect(model.setPublication).not.toHaveBeenCalled();expect(host.querySelector('[role="alert"]')?.textContent).toBe('内容已变化');
 model.publication={...review(),entries:[]};await act(async()=>root.render(<PublicationDialog model={model} error="" onPublished={vi.fn()}/>));
 expect([...host.querySelectorAll('button')].find(button=>button.textContent==='确认发布')?.disabled).toBe(true);expect(host.querySelector('.publication-review-card')).toBeNull();
});
it('only leaves the editor after the accepted publication job completes',async()=>{
 const {awaitTask}=await import('../apps/admin/src/background-tasks.ts');
 let complete!:(value:any)=>void;vi.mocked(awaitTask).mockImplementationOnce(()=>new Promise(resolve=>{complete=resolve;}));
 const onPublished=vi.fn(),model:any={publication:review(),setPublication:vi.fn(),busy:false,submit:vi.fn(async()=>({id:'queued-publication',status:'queued'}))};
 await act(async()=>root.render(<PublicationDialog model={model} error="" onPublished={onPublished}/>));
 await click('确认发布');expect(model.setPublication).toHaveBeenCalledWith(null);expect(onPublished).not.toHaveBeenCalled();
 await act(async()=>complete({id:'queued-publication',status:'complete'}));expect(onPublished).toHaveBeenCalledTimes(1);
});
