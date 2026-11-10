import { afterEach, expect, it } from 'vitest';
import { mkdirSync, writeFileSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { Site, mediaIdentity, mediaFile, pathWithin, createBackup, importSite, renderBlocks, validatePublicQuery, requestIdentity, readJobLog, queryDrafts, queryMedia } from '@weava/core';
import { entrySchema } from '@weava/contracts';
import { adminApi, matchAdminApi } from '@weava/contracts/api';
const sites: Site[] = [], base = (process.env.WEAVA_TEST_OUTPUT??'D:/Tools/cache/weava/tests')+'/architecture-' + Date.now(); let sequence = 0;
function fixture() {
  const site = new Site(join(base,String(sequence++))); sites.push(site);
  site.saveType({id:'post',label:'文章',pathPrefix:'/posts/',template:'article',fields:[]},null);
  return site;
}
const entry = (id: string, patch: object = {}) => entrySchema.parse({id,kind:'content',title:id,path:'/'+id+'/',status:'published',...patch});
afterEach(() => sites.splice(0).forEach(site => site.close()));

it('ARC-01/20 authorizes canonical Windows media identities without scanning history after writes', () => {
  const site = fixture(); writeFileSync(join(site.root,'media','secret.png'),'secret');
  const row = site.saveEntry(entry('secret',{visibility:'private',cover:'/media/secret.png'}),null); site.publish();
  expect(site.isPrivateMedia('/media/secret.png')).toBe(true);
  expect(site.isPrivateMedia('/media/SECRET.PNG')).toBe(true);
  expect(() => mediaIdentity('/media/foo%2f..%2fsecret.png')).toThrow();
  expect(() => mediaIdentity('/media/secret.png.')).toThrow();
  expect(() => mediaIdentity('/media/secret.png:stream')).toThrow();
  expect(mediaFile(site.root,mediaIdentity('/media/SECRET.PNG'))).toBe(join(site.root,'media','secret.png'));
  const beforeClear=site.settings();expect(()=>site.saveSettings({...beforeClear.value,name:'Settings while private media exists'},beforeClear.revision)).not.toThrow();
  site.saveEntry({...row.value,cover:''},row.revision);
  // Access no longer depends on deserializing entries, releases or revisions.
  site.store.raw.exec(`CREATE TRIGGER poison_read_guard AFTER INSERT ON state BEGIN SELECT 1; END;`);
  const prepare = site.store.raw.prepare.bind(site.store.raw), queries: string[] = [];
  site.store.raw.prepare = ((sql: string) => { queries.push(sql); return prepare(sql); }) as typeof site.store.raw.prepare;
  const settings = site.settings(); site.saveSettings({...settings.value,name:'Unrelated settings'},settings.revision);
  queries.length = 0;
  expect(site.isPrivateMedia('/media/secret.png')).toBe(true);
  expect(queries.every(sql => !/\b(revisions|releases|records|publication_objects)\b/.test(sql))).toBe(true);
});

it('ARC-01/13 rejects junction escapes and case-insensitive nested backup destinations before writing', async () => {
  const site = fixture(), outside = join(base,'outside'); mkdirSync(outside,{recursive:true});
  symlinkSync(outside,join(site.root,'media','external'),'junction');
  expect(() => mediaFile(site.root,mediaIdentity('/media/external/file.txt'))).toThrow();
  mkdirSync(join(site.root,'media','private'),{recursive:true});writeFileSync(join(site.root,'media','private','file.txt'),'secret');
  symlinkSync(join(site.root,'media','private'),join(site.root,'media','internal-alias'),'junction');
  expect(() => mediaFile(site.root,mediaIdentity('/media/internal-alias/file.txt'))).toThrow();
  expect(pathWithin(site.root,join(site.root,'media','backups').toLowerCase())).toBe(true);
  await expect(createBackup(site,join(site.root,'media','backups').toLowerCase())).rejects.toThrow('备份目录必须在站点外');
});

it('ARC-02 cleans compatibility HTML and rejects script protocols through save, import and final block rendering', () => {
  const site = fixture();
  const blocks = [{id:'html',type:'compatibility',props:{html:'<p>Keep text</p><script>alert(1)</script><a href="javascript:alert(2)" onclick="alert(3)">safe label</a>'}}];
  site.saveEntry(entry('html',{blocks}),null); const release = site.publish();
  const html = renderBlocks(blocks,release);
  expect(html).toContain('Keep text'); expect(html).not.toMatch(/<script|javascript:|onclick=/);
  for (const url of ['javascript:alert(1)','jAvAsCrIpT:alert(1)','java\nscript:alert(1)','data:text/html,hello']) {
    const malicious = [{id:'button',type:'button',props:{label:'Bad',url}}];
    expect(() => site.saveEntry(entry('bad',{blocks:malicious}),null)).toThrow();
    expect(() => importSite(site,{version:1,entries:[entry('bad',{blocks:malicious})]})).toThrow();
    expect(() => renderBlocks(malicious,release)).toThrow();
  }
});

it('ARC-03/11 binds rollback results to the contract and decodes wire IDs exactly once', () => {
  const site = fixture(); site.saveEntry(entry('one'),null); const release = site.publish();
  expect(adminApi.rollback.response.parse(site.rollback(release.id))).toEqual({releaseId:release.id});
  for (const id of ['percent%id','slash/id','literal%2Fid','空 格']) expect(matchAdminApi('GET','entry/'+encodeURIComponent(id))!.params.id).toBe(id);
});

it('ARC-09 uses current block bodies for references and search, refusing recursive references', () => {
  const site = fixture();
  site.saveEntry(entry('target',{document:{version:1,format:'markdown',source:'OLD-DOCUMENT'},blocks:[{id:'body',type:'richtext',props:{text:'NEW-BLOCK-UNIQUE'}}]}),null);
  site.saveEntry(entry('ref',{blocks:[{id:'reference',type:'content-detail',props:{entryId:'target'}}]}),null);
  const release = site.publish(), html = renderBlocks(release.entries.find(item=>item.id==='ref')!.blocks,release);
  expect(html).toContain('NEW-BLOCK-UNIQUE'); expect(html).not.toContain('OLD-DOCUMENT');
  expect(site.search('NEW-BLOCK-UNIQUE').some(item=>item.id==='ref')).toBe(true);
  const target = site.store.get('entry','target')!;
  site.saveEntry({...target.value,blocks:[{id:'back',type:'content-detail',props:{entryId:'ref'}}]},target.revision);
  expect(()=>site.publish({ids:['target']})).toThrow(/循环/);
});

it('ARC-10 withdraw and archive leave both draft and release unchanged when a required reference breaks', () => {
  const site = fixture(), type = site.store.get('type','post')!;
  site.saveType({...type.value,fields:[{key:'related',label:'引用',type:'reference',required:true}]},type.revision);
  const one = entry('one',{fields:{related:'two'}}), two = entry('two',{fields:{related:'one'}});
  const saved = site.saveEntry(one,null,{references:[one,two]}); site.saveEntry(two,null,{references:[one,two]}); const release = site.publish();
  for (const archive of [false,true]) expect(()=>site.withdraw('one',saved.revision,archive)).toThrow(/引用/);
  expect(site.release()!.id).toBe(release.id); expect(site.store.get('entry','one')!.revision).toBe(saved.revision);
});

it('ARC-12 validates list-specific page keys and fields before rendering', () => {
  const site = fixture(); site.saveEntry(entry('one'),null); const release = site.publish();
  for (const input of ['page=NaN','page=-1','page=0','page=1.2']) expect(()=>validatePublicQuery(new URLSearchParams(input),release)).toThrow();
  expect(()=>validatePublicQuery(new URLSearchParams('chapter=bad'),release,[{id:'list',type:'content-list',props:{pageKey:'chapter'}}])).toThrow();
  expect(()=>validatePublicQuery(new URLSearchParams('page=2'),release)).not.toThrow();
});

it('ARC-14 checks the final type/content batch while preserving conflicts and atomic rollback', () => {
  const site = fixture(), type = site.store.get('type','post')!;
  const numbered = site.saveType({...type.value,fields:[{key:'score',label:'分数',type:'number'}]},type.revision);
  const saved = site.saveEntry(entry('typed',{fields:{score:1}}),null);
  const source = {version:1 as const,types:[{...numbered.value,fields:[{key:'score',label:'分数',type:'text'}]}],entries:[{...saved.value,fields:{score:'one'}}]};
  const options = {mode:'merge' as const,revisions:{'type:post':numbered.revision,'entry:typed':saved.revision}};
  expect(importSite(site,source,{...options,dryRun:true}).updated).toHaveLength(2);
  expect(site.store.get('entry','typed')!.value.fields.score).toBe(1);
  expect(()=>importSite(site,source,{...options,revisions:{...options.revisions,'entry:typed':1}})).toThrow(/冲突/);
  expect(importSite(site,source,options).updated).toHaveLength(2);
  expect(site.store.get('entry','typed')!.value.fields.score).toBe('one');
});

it('ARC-19 reads complete UTF-8 pages with consistent byte cursors, including arbitrary and tail offsets', async () => {
  const file = join(base,'utf8.log'), original = 'start\n'+'中😀文'.repeat(30000)+'\nTAIL'; writeFileSync(file,original);
  const total = Buffer.byteLength(original); let offset=0,joined='';
  while (offset<total) {
    const page = await readJobLog(file,offset);
    expect(page.start).toBe(offset); expect(Buffer.byteLength(page.text)).toBe(page.end-page.start);
    expect(page.text).not.toContain('\ufffd'); expect(page.end-page.start).toBeLessThanOrEqual(20003);
    joined+=page.text; offset=page.end;
  }
  expect(joined).toBe(original);
  const tail = await readJobLog(file,total-1); expect(tail.text).toContain('TAIL');
  const arbitrary = await readJobLog(file,20001); expect(arbitrary.text).not.toContain('\ufffd');
});

it('ARC-21 password checks yield the event loop and bound concurrent and repeated attempts',async()=>{
  const site=fixture();site.setOwner('a-long-test-password');
  let yielded=false;const tick=new Promise<void>(resolve=>setTimeout(()=>{yielded=true;resolve();},0));
  const login=site.login('a-long-test-password','test-network');await tick;expect(yielded).toBe(true);
  const token=await login;expect(site.authenticate(token)).toBe(true);
  for(let n=0;n<5;n++)await expect(site.login('wrong-password','test-network')).rejects.toMatchObject({status:401});
  await expect(site.login('wrong-password','test-network')).rejects.toMatchObject({status:429});
  const first=site.login('wrong-password','one'),second=site.login('wrong-password','two');
  await expect(site.login('wrong-password','three')).rejects.toMatchObject({status:429});
  await Promise.allSettled([first,second]);
  const resetPending=site.login('a-long-test-password','reset-network');site.setOwner('replacement-test-password');
  await expect(resetPending).rejects.toMatchObject({status:401});expect(site.authenticate(token)).toBe(false);
});

it('ARC-22 shares forwarding identity and protocol only from trusted peers and strips trusted hops',()=>{
  const request=new Request('http://localhost/api',{headers:{'x-forwarded-for':'203.0.113.7, 198.51.100.9, 127.0.0.1','x-forwarded-proto':'https'}});
  const policy={enabled:true,trusted:['127.0.0.1']};
  expect(requestIdentity(request,'127.0.0.1',policy)).toMatchObject({network:'198.51.100.9',secure:true});
  expect(requestIdentity(request,'192.0.2.8',policy)).toMatchObject({network:'192.0.2.8',secure:false});
  expect(requestIdentity(request,'127.0.0.1',{...policy,enabled:false})).toMatchObject({network:'127.0.0.1',secure:false});
});
it('ARC-18 paginates projected data without loading complete entries or media collections',()=>{
  const site=fixture();
  for(let index=0;index<60;index++){
    site.saveEntry(entry('large-'+index,{document:{version:1,format:'markdown',source:'Long body '.repeat(10000)}}),null);
    site.store.put('media','media-'+index,{name:'Media '+index,url:'/media/'+index+'.png',bytes:1,createdAt:new Date().toISOString()},null);
  }
  const list=site.store.list.bind(site.store);site.store.list=((scope:string)=>{if(['entry','media'].includes(scope))throw new Error('full collection read');return list(scope);}) as typeof site.store.list;
  const get=site.store.get.bind(site.store);site.store.get=((scope:string,id:string)=>{if(scope==='entry')throw new Error('full body read');return get(scope,id);}) as typeof site.store.get;
  const content=queryDrafts(site,{page:2,pageSize:7}),media=queryMedia(site,new URLSearchParams({page:'2',pageSize:'7'}));
  expect(content.items).toHaveLength(7);expect(content.total).toBe(60);expect(content.items.every(row=>!('document' in row.value)&&!('blocks' in row.value))).toBe(true);
  expect(media.items).toHaveLength(7);expect(media.total).toBe(60);
});
