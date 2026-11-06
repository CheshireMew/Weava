import {describe,it,expect} from 'vitest';
import {mkdirSync,writeFileSync,readFileSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {Site} from '../packages/core/src/site.ts';
import {Analytics} from '../packages/core/src/analytics.ts';
import {SCHEMA_VERSION} from '../packages/core/src/storage.ts';
import {seedStarter,starters,starterFeatures} from '../packages/core/src/starters.ts';
import {siteFeatures,requiredFeature} from '../packages/core/src/site-features.ts';
import {siteDescriptorSchema,validateFeatures} from '../packages/contracts/src/installation.ts';
import {inspect,atomic,hash} from '../packages/manager/src/state.ts';
import {BusinessStore,withWebsite,getWebsite} from '../packages/core/src/site-sdk.ts';
import {getWebsite as publicWebsite} from '../packages/core/src/site-public.ts';
import {migrateWebsite} from '../packages/core/src/site-migrations.ts';
const task='D:/Tools/cache/weava/tasks/shared-runtime-20261105';
mkdirSync(task,{recursive:true});
function root(){const path=join(task,'unit-'+randomUUID());mkdirSync(path,{recursive:true});return path;}
describe('shared runtime and site data contracts',()=>{
 it('checks business versions on startup without migrating and skips previously applied steps',async()=>{
  const path=root(),folder=join(path,'site-builds','one');mkdirSync(folder,{recursive:true});atomic(join(folder,'site-build.json'),{migrations:'migrations.mjs'});
  const source=join(folder,'migrations.mjs');writeFileSync(source,"export default[{id:'tool',version:1,up({business}){business.put('tool','one',1)}},{id:'tool',version:2,up({business}){business.put('tool','two',2)}}];");
  const initial=new BusinessStore(path,'migrate');initial.close();const before=hash(readFileSync(join(path,'business.sqlite')));
  await expect(migrateWebsite(path,'one','open')).rejects.toThrow(/显式迁移/);expect(hash(readFileSync(join(path,'business.sqlite')))).toBe(before);
  await migrateWebsite(path,'one');await migrateWebsite(path,'one');await migrateWebsite(path,'one','open');
  const business=new BusinessStore(path);expect(business.get('tool','two')).toBe(2);expect(business.version('tool')).toBe(2);business.close();
 });
 it('requires an explicit operation for an existing older database and keeps read inspection inert',()=>{
  const path=root();let site=new Site(path);site.store.raw.prepare('DELETE FROM schema_migrations WHERE version=?').run(SCHEMA_VERSION);site.close();
  const before=hash(readFileSync(join(path,'weava.sqlite')));
  expect(inspect(path).schemaVersion).toBe(SCHEMA_VERSION-1);
  expect(()=>new Site(path)).toThrow(/需要迁移/);
  expect(hash(readFileSync(join(path,'weava.sqlite')))).toBe(before);
  site=new Site(path,{mode:'migrate'});site.close();
  expect(inspect(path).schemaVersion).toBe(SCHEMA_VERSION);
 });
 it('does not repair missing initialization state during a normal open',()=>{
  const path=root(),site=new Site(path);site.store.raw.prepare("DELETE FROM state WHERE key='engagement-secret'").run();site.close();const before=hash(readFileSync(join(path,'weava.sqlite')));
  expect(()=>new Site(path)).toThrow(/普通打开不会补写/);expect(hash(readFileSync(join(path,'weava.sqlite')))).toBe(before);
  const migrated=new Site(path,{mode:'migrate'});expect(migrated.engagementSecret()).toBeTruthy();migrated.close();
 });
 it('requires explicit analytics migration for legacy data',()=>{
  const path=root(),site=new Site(path),analytics=new Analytics(path);
  analytics.raw.exec('DROP TABLE weava_analytics_schema');analytics.close();
  expect(()=>new Analytics(path)).toThrow(/显式迁移/);
  const migrated=new Analytics(path,{mode:'migrate'});expect(migrated.raw.prepare('SELECT version FROM weava_analytics_schema').get()).toEqual({version:1});migrated.close();site.close();
 });
 for(const template of starters)it('creates the '+template+' starter without copying framework code',()=>{
  const path=root(),site=new Site(path);
  atomic(join(path,'site.json'),siteDescriptorSchema.parse({version:2,id:template,port:4500,features:starterFeatures(template),template}));
  try{
   seedStarter(site,template);
   expect(siteFeatures(path)).toEqual(starterFeatures(template));
   if(template==='blank'){expect(site.entries()).toHaveLength(0);expect(site.release()).toBeNull();}
   else {expect(site.release()?.entries.some(e=>e.path==='/')).toBe(true);expect(()=>seedStarter(site,template)).toThrow();}
   expect(existsSync(join(path,'node_modules'))).toBe(false);
  }finally{site.close();}
 });
 it('keeps optional feature dependencies and HTTP gates aligned',()=>{
  expect(()=>validateFeatures(['engagement'])).toThrow();
  expect(validateFeatures(['content','content','engagement'])).toEqual(['content','engagement']);
  expect(requiredFeature('/api/admin/v1/media/uploads/abc')).toBe('media');
  expect(requiredFeature('/api/admin/v1/entries/query')).toBe('content');
  expect(requiredFeature('/api/v1/comment-captcha')).toBe('engagement');
  expect(requiredFeature('/api/admin/v1/account')).toBeUndefined();
  expect(requiredFeature('/api/admin/v1/analytics/realtime')).toBe('analytics');
 });
 it('binds the public SDK to the request and keeps business state apart from publication',()=>{
  const path=root();expect(()=>getWebsite()).toThrow();expect(()=>new BusinessStore(path)).toThrow();
  const store=new BusinessStore(path,'migrate');
  store.migrate('calculator',1,()=>store.put('settings','precision',2));
  store.migrate('calculator',1,()=>{throw new Error('must not repeat');});
  expect(store.get('settings','precision')).toBe(2);
  expect(()=>store.migrate('calculator',0,()=>{})).toThrow(/比代码新/);
  expect(()=>store.transaction(()=>{store.put('test','a',1);throw new Error('rollback');})).toThrow();
  expect(store.get('test','a')).toBeNull();
  withWebsite({id:'first'} as any,()=>{expect(publicWebsite().id).toBe('first');withWebsite({id:'second'} as any,()=>expect(publicWebsite().id).toBe('second'));expect(publicWebsite().id).toBe('first');});
  expect(()=>publicWebsite()).toThrow();store.close();
 });
});

