import {afterEach,expect,it,vi} from 'vitest';
import {join,resolve} from 'node:path';
import {Site,JobRunner} from '@weava/core';
import {entrySchema} from '@weava/contracts';
import {preparePublication,savePublicationReview,readPublicationCandidate,commitPublication,primePublication} from '../packages/core/src/publication.ts';
import {validateExtensionRelease} from '../packages/core/src/extension-rendering.ts';
import * as renderer from '../packages/core/src/render.ts';
import * as storage from '../packages/core/src/publication-store.ts';
import * as seo from '../packages/core/src/seo.ts';
import {createAdminDispatcher} from '../apps/web/src/api/dispatch.ts';
const base=join(process.env.WEAVA_TEST_OUTPUT??'D:/Tools/cache/weava/tests','publication-performance-'+Date.now());
const sites:Site[]=[],runners:JobRunner[]=[];
function create(name:string){const site=new Site(join(base,name));sites.push(site);return site;}
const page=(id:string)=>entrySchema.parse({id,kind:'page',title:id,path:'/'+id+'/',document:{version:1,format:'markdown',source:'## '+id+'\n\n正文'}});
afterEach(()=>{runners.splice(0).forEach(runner=>runner.stop());sites.splice(0).forEach(site=>site.close());vi.restoreAllMocks();});
it('renders only the changed page after priming and reuses the reviewed storage at confirmation',()=>{
 const site=create('incremental');for(let index=0;index<20;index++)site.saveEntry({...page('old-'+index),status:'published'},null);site.publish();
 primePublication(site);const row=site.saveEntry(page('new'),null),options={ids:[row.id],revisions:{[row.id]:row.revision}};
 const render=vi.spyOn(renderer,'renderEntryTemplate'),prepareStorage=vi.spyOn(storage,'prepareReleaseStorage');
 const review=savePublicationReview(site,options,preparePublication(site,options));
 expect(render.mock.calls.map(([entry])=>entry.id)).toEqual(['new']);
 prepareStorage.mockClear();render.mockClear();
 const release=commitPublication(site,readPublicationCandidate(site,review.options),review.options);
 expect(prepareStorage).not.toHaveBeenCalled();expect(render).not.toHaveBeenCalled();expect(release.entries).toHaveLength(21);expect(site.search('new').some(row=>row.id==='new')).toBe(true);
 const next=savePublicationReview(site,{ids:['new']},preparePublication(site,{ids:['new']}));
 site.saveEntry({...row.value,title:'预检后修改'},row.revision);
 expect(()=>readPublicationCandidate(site,next.options)).toThrow(/变化/);
});
it('skips page metadata work for routing-only extensions and still validates render contributions',async()=>{
 const site=create('extensions');site.saveEntry({...page('one'),status:'published'},null);const release=site.publish();
 const metadata=vi.spyOn(seo,'pageMetadata');
 await validateExtensionRelease([{id:'routes',apiVersion:1,route:async()=>null}],release);expect(metadata).not.toHaveBeenCalled();
 const contribution=vi.fn(async()=>({description:'说明'}));await validateExtensionRelease([{id:'metadata',apiVersion:1,metadata:contribution}],release);expect(contribution).toHaveBeenCalledTimes(1);expect(metadata).toHaveBeenCalledTimes(1);
});
it('reuses the preloaded execution process across real previews and consecutive publications',async()=>{
 const site=create('process');const runner=new JobRunner(site,{framework:resolve('.'),source:true,startPaused:false});runners.push(runner);
 const warm=await runner.warmPublication();const row=site.saveEntry(page('one'),null);
 const review=await runner.query('publication-review',{ids:[row.id],revisions:{[row.id]:row.revision}});
 const dispatch=createAdminDispatcher({site,jobs:runner} as any);
 const response=await dispatch('publish',{},review.options,{url:new URL('http://localhost/api/admin/v1/publish'),request:new Request('http://localhost/api/admin/v1/publish',{method:'POST'})} as any);
 const submitted=await response.json();expect(response.status).toBe(202);expect(submitted.status).toBe('complete');
 const first=await runner.wait(submitted.id,15000);
 expect(first.executionPid).toBe(warm.executionPid);expect(first.timings.totalMs).toBeGreaterThanOrEqual(0);
 const updated=site.saveEntry({...row.value,title:'下一版'},row.revision);
 const next=await runner.query('publication-review',{ids:[row.id],revisions:{[row.id]:updated.revision}});
 const second=await runner.wait(runner.enqueue('publish',next.options).id,15000);
 expect(second.executionPid).toBe(warm.executionPid);expect((runner as any).publication.processCount).toBe(1);expect(site.release()?.entries.find(entry=>entry.id===row.id)?.title).toBe('下一版');
},35000);
