import {expect,it,vi} from 'vitest';
const mocks=vi.hoisted(()=>({paths:[{id:'article',path:'/changed/'}],sql:[] as string[]}));
vi.mock('better-sqlite3',()=>({default:class {prepare(sql:string){mocks.sql.push(sql);return {all:()=>mocks.paths};}close(){}}}));
import {wordpressLifetime} from '../packages/core/src/analytics-wordpress.ts';
it('reuses unchanged imported totals and refreshes both snapshot replacements and article path changes',()=>{
 let fingerprint='first';
 const tables:any={pages:[{id:1,uri:'/original/',views:10},{id:2,uri:'https://old.example/original/',views:4}],visitors:[{id:1,hits:14}],relationships:[{pageId:1,visitorId:1}],historical:[{category:'uri',uri:'/original/',value:6},{category:'visits',value:6},{category:'visitors',value:1}],daily:[],events:[]};
 const rows=vi.fn((table:string)=>tables[table].map((row:any)=>({data:JSON.stringify(row)})));
 const db:any={name:'D:/test/analytics.sqlite',prepare:(sql:string)=>({get:()=>({exists:1}),all:(_fingerprint:string,table:string)=>sql.includes('JOIN wp_statistics_snapshots')?[{source_id:'imported',fingerprint,metadata:JSON.stringify({mapping:[{id:1,entryId:'article',path:'/original/'}],source:{timezone:'UTC'}})}]:rows(table)})};
 const first=wordpressLifetime(db)!;
 expect(first.views).toBe(20);expect(first.visitors).toBe(2);expect(first.entries.get('article')).toBe(16);expect(first.pages.get('/changed/')).toBe(16);
 first.entries.clear(); // Callers cannot corrupt the cached total maps.
 expect(wordpressLifetime(db)!.entries.get('article')).toBe(16);expect(rows).toHaveBeenCalledTimes(6);
 expect(wordpressLifetime(db,'/changed/')).toMatchObject({views:16,visitors:1});
 mocks.paths=[{id:'article',path:'/renamed/'}];expect(wordpressLifetime(db)!.pages.get('/renamed/')).toBe(16);expect(rows).toHaveBeenCalledTimes(12);
 tables.pages[0].views=20;fingerprint='replacement';expect(wordpressLifetime(db)!.entries.get('article')).toBe(26);expect(rows).toHaveBeenCalledTimes(18);
 expect(mocks.sql.every(sql=>sql.includes('entry_list'))).toBe(true);
});
