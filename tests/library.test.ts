import { expect, it } from 'vitest';
import { defaultSettings, entrySchema, type Release, type PublishedEntry } from '@weava/contracts';
import { collectionArchiveEntry, collectionEntries, collectionPage } from '../packages/core/src/collections.ts';
import { libraryBlocks } from '../apps/web/src/themes/library-render.ts';
import { convertCryptoLibrary } from '../scripts/adapters/crypto/library.ts';
import { mediaReferencesIn } from '../packages/core/src/media-references.ts';
import { Site } from '@weava/core';
import { seedStarter } from '../packages/core/src/starters.ts';
import cryptoExtension from '../packages/crypto-extension/src/index.ts';

const content=(id:string,options:Record<string,any>={}):PublishedEntry=>({...entrySchema.parse({id,kind:'content',type:'resource',title:id,path:'/resources/'+id+'/',status:'published',publishedAt:'2026-01-01T00:00:00Z',fields:{platform:'Web'},...options}),html:'<p>正文</p>',revisionId:1,modifiedAt:'2026-01-01T00:00:00Z'});
const release=():Release=>({id:'r',createdAt:'2026-01-01T00:00:00Z',label:'test',settings:{...defaultSettings,theme:'library'},types:[{id:'resource',label:'资料',pathPrefix:'/resources/',template:'article',fields:[{key:'platform',label:'平台',type:'select',options:['Web','Windows'],filterable:true}]}],entries:[content('first'),content('private',{visibility:'private'}),content('second',{publishedAt:'2026-02-01T00:00:00Z'})]});
it('updates collections from the selected release and keeps private content out',()=>{
  const r=release();expect(collectionEntries(r).map(e=>e.id)).toEqual(['second','first']);
  r.entries.push(content('new',{publishedAt:'2026-03-01T00:00:00Z'}));expect(collectionEntries(r)[0].id).toBe('new');
  r.entries=r.entries.filter(e=>e.id!=='second');expect(collectionEntries(r).map(e=>e.id)).toEqual(['new','first']);
});
it('resolves ordered courses by current IDs, titles and paths',()=>{
  const r=release();r.entries[0]={...r.entries[0],title:'新标题',path:'/changed/'};
  const b={id:'course',type:'collection',props:{ids:['first','private','missing','second'],presentation:'list'}};
  const page=entrySchema.parse({id:'p',kind:'page',title:'路线',path:'/route/'});
  const html=libraryBlocks([b],r,page,new URL('https://example.com/route/'),{});
  expect(html).toContain('href="/changed/">新标题');expect(html).not.toContain('private');expect(html.indexOf('新标题')).toBeLessThan(html.indexOf('second'));
});
it('filters across declared content types and derives new pagination URLs',()=>{
  const r=release(),b={id:'catalog',type:'collection',props:{presentation:'catalog',limit:1,fields:{platform:'Web'}}};
  const page={...content('index'),kind:'page' as const,path:'/resources/',blocks:[b]};r.entries.push(page);
  expect(collectionPage(r,b,new URL('https://example.com/resources/page/2/')).items[0].id).toBe('first');
  expect(collectionArchiveEntry(r,new URL('https://example.com/resources/page/2/'))?.path).toBe('/resources/page/2/');
  expect(collectionArchiveEntry(r,new URL('https://example.com/resources/page/3/'))).toBeUndefined();
  expect(collectionPage(r,b,new URL('https://example.com/resources/?field.platform=Windows')).total).toBe(0);
});
it('renders a clean catalogue without any Crypto extension or old homepage shell',()=>{
  const r=release(),page=entrySchema.parse({id:'p',kind:'page',title:'资料',path:'/resources/'});
  const html=libraryBlocks([{id:'list',type:'collection',props:{presentation:'catalog'}}],r,page,new URL('https://example.com/resources/'),{});
  expect(html).toContain('2 篇资料');expect(html).toContain('name="field.platform"');expect(html).not.toContain('blacknico');
});
it('converts old categories to live queries and preserves article documents and URLs',()=>{
  const r=release(),article=r.entries[0];
  const page=entrySchema.parse({id:'p',kind:'page',title:'主题',path:'/topics/test/',compatibility:{main:'<div class="catalog-layout"><div id="catalog-grid" data-scope=\'{"category":"test","base":"/topics/test/"}\'></div></div>'}});
  const result=convertCryptoLibrary([article,page],r.settings,r.types);
  expect(result.entries[0].document).toEqual(article.document);expect(result.entries[0].path).toBe(article.path);
  expect(result.entries[1].blocks[0].props.category).toBe('test');expect(result.entries[1].compatibility).toBeUndefined();
});
it('recognizes actual media URLs without srcset descriptors or truncated filenames',()=>{
  const refs=mediaReferencesIn('<img src="/media/name_(web).png" srcset="/media/small.webp 599w, /media/large.webp 1200w">');
  expect([...refs].sort()).toEqual(['/media/large.webp','/media/name_(web).png','/media/small.webp'].sort());
});
it('preserves referral disclosures, code labels and section spacing while using current business settings',async()=>{
  const r=release();r.settings.extensions.crypto={config:{referrals:{binance:{url:'https://binance.com/join',code:'new-code',futuresCode:'new-futures'}}}};
  const page=entrySchema.parse({id:'referrals',kind:'page',title:'平台',path:'/platforms/',compatibility:{main:'<section class="section wrap"><h2>平台入口</h2><div class="referral-grid"><section data-provider="binance"><h3>币安</h3><a class="button">注册币安</a><div class="invite-row"><span>邀请码</span><button data-copy="new-code">new-code</button></div><div class="invite-row"><span>合约邀请码</span><button data-copy="new-futures">new-futures</button></div><small class="referral-note">原有邀请说明</small></section></div></section>'}});
  const converted=convertCryptoLibrary([page],r.settings,r.types).entries[0];
  expect(converted.blocks[0].props.text).toContain('<section class="section wrap">');
  const provider=await cryptoExtension({site:{root:process.env.WEAVA_TEST_OUTPUT??'D:/Tools/cache/weava/tasks/library-20261108/unit'}});
  const block=converted.blocks.find(b=>b.type==='crypto-blacknico:referrals')!;
  const html=provider.blocks['crypto-blacknico:referrals'](block,r);
  expect(html).toContain('原有邀请说明');expect(html).toContain('复制合约邀请码 new-futures');expect(html).toContain('data-crypto-copy="new-code"');
});
it('creates and publishes a reusable library resource site through the normal starter',()=>{
  const site=new Site((process.env.WEAVA_TEST_OUTPUT??'D:/Tools/cache/weava/tasks/library-20261108/unit')+'/starter-'+Date.now());
  try{seedStarter(site,'resource','library');const r=site.visibleRelease()!;expect(r.settings.theme).toBe('library');expect(r.entries.find(e=>e.path==='/resources/')?.blocks[0].type).toBe('collection');expect(site.extensionThemes).toEqual([]);}finally{site.close();}
});
