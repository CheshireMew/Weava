import {afterEach,expect,it} from 'vitest';
import {join} from 'node:path';
import {Site,Analytics} from '@weava/core';
import {entrySchema,type ContentQuery} from '@weava/contracts';
import {queryEntries,queryPublished} from '../packages/core/src/query.ts';
import {newsletterCatalog,newsletterCover,newsletterRanking} from '../packages/core/src/newsletter.ts';
const base='D:/Tools/cache/weava/tests/public-query-'+Date.now();let sequence=0;const sites:Site[]=[];
afterEach(()=>sites.splice(0).forEach(site=>site.close()));
function fixture(){const site=new Site(join(base,String(sequence++)));sites.push(site);
  site.saveType({id:'post',label:'Post',fields:[{key:'score',label:'Score',type:'number',filterable:true},{key:'flag',label:'Flag',type:'boolean',filterable:true}],pathPrefix:'/posts/',template:'article'},null);
  const parent=site.saveTerm({id:'parent',kind:'category',label:'Parent',slug:'parent'},null);site.saveTerm({id:'child',kind:'category',label:'Child',slug:'child',parentId:parent.id},null);
  for(let index=0;index<18;index++)site.saveEntry(entrySchema.parse({id:'item-'+index,kind:'content',type:'post',title:['中文','Alpha','alpha'][index%3],path:'/posts/'+index+'/',status:'published',visibility:index%7===0?'private':'public',indexable:index%5!==0,
    termIds:{categories:[index%2?'child':'parent'],tags:[]},categories:[index%2?'Child':'Parent'],fields:{score:index%3,flag:index%2===0},publishedAt:new Date(Date.UTC(2026,0,1+index%4)).toISOString(),document:{version:1,format:'markdown',source:'## Common body\n\n![Image](/media/test.png)'}}),null);
  // The cover test only needs an authored HTML URL, with no physical-media publication dependency.
  const rows=site.store.list('entry');for(const row of rows)site.saveEntry({...row.value,document:{version:1,format:'markdown',source:'## Common body\n\n![Image](https://example.com/test.png)'}},row.revision);
  site.publish();return site;
}
it('matches existing query semantics for ordering, hierarchical categories, fields and later pages without loading bodies',()=>{
  const site=fixture(),release=site.visibleRelease()!,ids=(value:any)=>({...value,items:value.items.map((entry:any)=>entry.id)});
  const filtersList:ContentQuery[]=[{},{category:'parent'},{category:'child'},{type:'post',fields:{score:'1'}},{type:'post',fields:{flag:'true'}},{query:'ALPHA'}];
  for(const sort of ['date','oldest','title','-title','publishedAt','-publishedAt','updatedAt','-updatedAt'] as const)
    for(const filters of filtersList){
      const input:ContentQuery={...filters,sort,page:2,pageSize:3};expect(ids(queryPublished(site,input))).toEqual(ids(queryEntries(release.entries,{kind:'content',...input},release.types,release.terms)));
    }
  const prepare=site.store.raw.prepare.bind(site.store.raw);site.store.raw.prepare=((sql:string)=>{if(sql==='SELECT data FROM publication_objects WHERE key=?')throw new Error('Body fetched by a directory query');return prepare(sql);}) as any;
  expect(queryPublished(site,{page:2,pageSize:3})).toMatchObject({total:15,page:2});
  const found=queryPublished(site,{query:'common',page:2,pageSize:3},true);expect(found.items).toHaveLength(3);expect(found.items.every(entry=>entry.indexable&&entry.visibility==='public')).toBe(true);
  expect(()=>queryPublished(site,{pageSize:101})).toThrow(/最多 100/);
});
it('reuses newsletter metadata and popularity while discovering only requested covers, and invalidates by release',()=>{
  const site=fixture(),release=site.visibleRelease()!,analytics=new Analytics(site.root);
  try{const first=newsletterCatalog(release);expect(newsletterCatalog(release)).toBe(first);
    expect(newsletterCover(first.posts[0])).toBe('https://example.com/test.png');
    let calls=0;const totals=analytics.viewTotals.bind(analytics);analytics.viewTotals=((...args:Parameters<typeof totals>)=>{calls++;return totals(...args);}) as any;
    const ranking=newsletterRanking(release,analytics,100);expect(newsletterRanking(release,analytics,1000)).toBe(ranking);expect(calls).toBe(1);
    expect(newsletterRanking(release,analytics,10200)).not.toBe(ranking);expect(calls).toBe(2);
    const row=site.store.get('entry','item-1')!;site.saveEntry({...row.value,title:'New title'},row.revision);site.publish({ids:[row.id]});expect(newsletterCatalog(site.visibleRelease()!)).not.toBe(first);
  }finally{analytics.close();}
});
