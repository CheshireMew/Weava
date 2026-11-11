import {afterEach,expect,it,vi} from 'vitest';
import {join,resolve} from 'node:path';
import {Site,JobRunner,exportSite} from '@weava/core';
import {entrySchema} from '@weava/contracts';
import {stageImportSource,queueImportSource,executeImportSource,closePreparedImports} from '../packages/core/src/import-sources.ts';
import {previewImport} from '../packages/core/src/import-preview.ts';
import {exportResponse} from '../packages/core/src/export-response.ts';
import {wordpressFixture} from './fixtures/wordpress-wxr.ts';
import * as conversion from '../packages/core/src/wordpress-wxr-conversion.ts';
import {createAdminDispatcher} from '../apps/web/src/api/dispatch.ts';
const base=join(process.env.WEAVA_TEST_OUTPUT??'D:/Tools/cache/weava/tests','background-workflows-'+Date.now());
const sites:Site[]=[],runners:JobRunner[]=[];
function create(name:string){const site=new Site(join(base,name));sites.push(site);return site;}
const upload=(site:Site,name:string,text:string)=>stageImportSource(site,new Request('http://localhost',{method:'POST',headers:{'Content-Type':'application/octet-stream'},body:text}),name);
afterEach(()=>{closePreparedImports();runners.splice(0).forEach(runner=>runner.stop());sites.splice(0).forEach(site=>site.close());vi.restoreAllMocks();});
it('streams the same exchange format from a fixed WAL snapshot with intact Unicode and supports cancellation',async()=>{
  const site=create('export');const row=site.saveEntry(entrySchema.parse({id:'one',kind:'page',title:'中文😀',path:'/one/',document:{version:1,format:'markdown',source:'😀中文'.repeat(20000)}}),null);
  const expected=exportSite(site),response=exportResponse(site,true);
  site.saveEntry({...row.value,title:'之后的编辑'},row.revision);
  expect(await response.json()).toEqual(expected);expect(response.headers.get('Content-Disposition')).toContain('weava-site.json');
  const reader=exportResponse(site).body!.getReader();await reader.read();await reader.cancel();
  expect(site.store.raw.pragma('wal_checkpoint(TRUNCATE)')).toMatchObject([{busy:0}]);
});
it('previews using current authored context while another connection can keep saving the live site',()=>{
  const site=create('read-only-preview'),writer=new Site(site.root);sites.push(writer);
  const row=site.saveEntry(entrySchema.parse({id:'one',kind:'page',path:'/one/',title:'原稿'}),null);
  const before=site.store.raw.prepare('SELECT COUNT(*) n FROM revisions').get();
  previewImport(site,preview=>{
    expect(preview.store.get('entry',row.id)?.revision).toBe(row.revision);
    const changed=preview.saveEntry({...row.value,title:'预检中的临时状态'},row.revision);
    writer.saveEntry({...row.value,title:'用户继续写作'},row.revision);
    expect(changed.value.title).toBe('预检中的临时状态');
  });
  expect(site.store.get('entry',row.id)?.value.title).toBe('用户继续写作');
  expect((site.store.raw.prepare('SELECT COUNT(*) n FROM revisions').get() as any).n).toBe((before as any).n+1);
});
it('uploads WXR once and reuses parsed XML and conversion between preview and confirmed import',async()=>{
  const site=create('wxr-reuse'),source=await upload(site,'source.xml',wordpressFixture());
  const parse=vi.spyOn(conversion,'parseWxrSource'),convert=vi.spyOn(conversion,'convertWxr');
  const preview=await executeImportSource(site,source.id,{dryRun:true,comments:true});
  expect(site.store.list('entry')).toHaveLength(0);
  const done=await executeImportSource(site,source.id,{comments:true,review:(preview as any).review});
  expect(done.dryRun).toBe(false);expect(site.store.list('entry')).toHaveLength(5);expect(parse).toHaveBeenCalledTimes(1);expect(convert).toHaveBeenCalledTimes(1);
});
it('returns a durable import job immediately and honours the choice to omit source settings',async()=>{
  const site=create('json-job'),original=site.settings().value.name;
  const source=await upload(site,'site.json',JSON.stringify({version:1,settings:{...site.settings().value,name:'来源网站'},entries:[entrySchema.parse({id:'imported',kind:'page',path:'/imported/',title:'导入内容'})]}));
  const runner=new JobRunner(site,{framework:resolve('.'),source:true,startPaused:true});runners.push(runner);
  const job=queueImportSource(site,runner,source.id,{settings:false,dryRun:true},'preview');
  expect(job.status).toBe('queued');expect(queueImportSource(site,runner,source.id,{settings:false,dryRun:true},'preview').id).toBe(job.id);
  runner.pause(false);const preview=await runner.wait(job.id,15000);expect(preview.dryRun).toBe(true);expect(site.store.list('entry')).toHaveLength(0);
  const complete=await runner.wait(queueImportSource(site,runner,source.id,{settings:false}).id,15000);
  expect(complete.dryRun).toBe(false);expect(site.settings().value.name).toBe(original);expect(site.store.get('entry','imported')).not.toBeNull();
},35000);
it('keeps interactive queries available while background work occupies its own lane',async()=>{
  const site=create('lanes'),runner=new JobRunner(site,{framework:resolve('.'),source:true,startPaused:true});runners.push(runner);
  let release!:(value:any)=>void;
  const background=vi.spyOn((runner as any).background,'run').mockImplementation(()=>new Promise(resolve=>release=resolve));
  const query=vi.spyOn((runner as any).service,'run').mockResolvedValue({available:true});
  const job=runner.enqueue('media-optimize',{id:'image'});runner.pause(false);runner.pump();
  expect(background).toHaveBeenCalled();expect(site.job(job.id).status).toBe('running');
  expect(await runner.query('archive-plan',{})).toEqual({available:true});expect(query).toHaveBeenCalledWith('archive-plan',{});
  release({});await runner.wait(job.id,1000);
});
it('exposes a binary source upload, an immediate task response and a streamed download through the HTTP dispatcher',async()=>{
  const site=create('http'),runner=new JobRunner(site,{framework:resolve('.'),source:true,startPaused:true});runners.push(runner);
  const dispatch=createAdminDispatcher({site,jobs:runner} as any);
  const request=new Request('http://localhost/api/admin/v1/import/file?name=site.json',{method:'POST',headers:{'Content-Type':'application/octet-stream'},body:'{"version":1,"entries":[]}'});
  const context={request,url:new URL(request.url)} as any;
  const uploaded=await dispatch('stageImportSource',{},undefined,context);expect(uploaded.status).toBe(200);const source=await uploaded.json();
  const response=await dispatch('runImportSource',{}, {sourceId:source.id,options:{dryRun:true}},{...context,url:new URL('http://localhost/api/admin/v1/import/source')});expect(response.status).toBe(202);expect((await response.json()).status).toBe('queued');
  const download=await dispatch('exportFile',{},undefined,{...context,url:new URL('http://localhost/api/admin/v1/export/file')});
  expect(download.headers.get('X-Weava-Stream')).toBe('1');expect(await download.json()).toMatchObject({version:1,entries:[]});
});

it('uploads a Markdown file through the dispatcher and saves it as a draft only after a matching preview',async()=>{
  const site=create('markdown-file');
  const runner=new JobRunner(site,{framework:resolve('.'),source:true,startPaused:false});
  runners.push(runner);
  const dispatch=createAdminDispatcher({site,jobs:runner} as any);
  const url='http://localhost/api/admin/v1/import/';
  const request=new Request(url+'file?name='+encodeURIComponent('中文.markdown'),{
    method:'POST',headers:{'Content-Type':'application/octet-stream'},
    body:'---\nid: selected\ntitle: 导入的文章\nstatus: published\npath: /posts/selected/\n---\n# 正文\n\n这是一篇 Markdown 文章。',
  });
  const upload=await dispatch('stageImportSource',{},undefined,{request,url:new URL(request.url)} as any);
  expect(upload.status).toBe(200);
  const source=await upload.json();
  expect(source.format).toBe('markdown');
  const submit=async(options:object)=>{
    const next=new Request(url+'source',{method:'POST'});
    const response=await dispatch('runImportSource',{}, {sourceId:source.id,options},{request:next,url:new URL(next.url)} as any);
    expect(response.status).toBe(202);
    return runner.wait((await response.json()).id,15000);
  };
  const preview=await submit({dryRun:true});
  expect(preview).toMatchObject({dryRun:true,created:expect.arrayContaining(['entry:selected']),entry:{title:'导入的文章',path:'/posts/selected/'}});
  expect(site.store.get('entry','selected')).toBeNull();
  await expect(submit({mode:'merge',markdownReview:preview.markdownReview})).rejects.toThrow(/重新预检/);
  expect(site.store.get('entry','selected')).toBeNull();
  const result=await submit({markdownReview:preview.markdownReview});
  expect(result).toMatchObject({format:'markdown',dryRun:false,sourceId:source.id});
  expect(site.store.get('entry','selected')?.value).toMatchObject({title:'导入的文章',status:'draft',document:{format:'markdown',source:'# 正文\n\n这是一篇 Markdown 文章。'}});
  expect(site.release()).toBeNull();
},35000);
