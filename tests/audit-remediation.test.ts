import {expect,it} from 'vitest';
import {spawnSync} from 'node:child_process';
import {mkdirSync,readFileSync,writeFileSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {Site} from '../packages/core/src/site.ts';
import {requiredFeature,operationFeature} from '../packages/core/src/site-features.ts';
import {siteDescriptorSchema} from '../packages/contracts/src/installation.ts';
import {adminApi} from '../packages/contracts/src/admin-api.ts';
import {JobRunner} from '../packages/core/src/job-runner.ts';

const base=process.env.WEAVA_TEST_OUTPUT??'D:/Tools/cache/weava/tasks/audit-remediation-20261106';
const digest=(path:string)=>createHash('sha256').update(readFileSync(path)).digest('hex');
it('WVA-03 rejects managed initialization before changing its descriptor or database and still initializes new sites',()=>{
 const root=join(base,'initialization-'+randomUUID()),managed=join(root,'managed'),fresh=join(root,'fresh');
 const site=new Site(managed);site.close();
 const descriptor=join(managed,'site.json'),database=join(managed,'weava.sqlite');
 writeFileSync(descriptor,JSON.stringify({version:2,id:'managed',port:4900,features:['media'],template:'blank',environment:{EXAMPLE:'preserved'}}));
 const before={descriptor:digest(descriptor),database:digest(database)};
 const invoke=(target:string)=>spawnSync(process.execPath,['--import','tsx','packages/cli/src/index.ts','--site',target,'init'],{cwd:process.cwd(),windowsHide:true,encoding:'utf8',timeout:15000});
 const rejected=invoke(managed);
 expect(rejected.error).toBeUndefined();expect(rejected.status).not.toBe(0);
 expect({descriptor:digest(descriptor),database:digest(database)}).toEqual(before);
 expect(siteDescriptorSchema.parse(JSON.parse(readFileSync(descriptor,'utf8'))).id).toBe('managed');
 const initialized=invoke(fresh);expect(initialized.error).toBeUndefined();expect(initialized.status,initialized.stderr).toBe(0);
 expect(existsSync(join(fresh,'weava.sqlite'))).toBe(true);
 const reopened=new Site(fresh);try{expect(reopened.store.list('type').some(row=>row.id==='post')).toBe(true);}finally{reopened.close();}
},45000);

it('WVA-06 gates content exchange, plans, aliases and content maintenance while keeping basic maintenance available',()=>{
 const contentRoots=new Set(['entries','entry','references','authoring','types','terms','layouts','history','revision','restore','publication','publish','withdraw','rollback','schedule','schedules','bulk','plans','redirects','import','export','seo','search-data']);
 for(const definition of Object.values(adminApi)){
  const path='/api/admin/v1/'+definition.path.replace('{id}','example');
  if(contentRoots.has(definition.path.split('/')[0])||/^maintenance\/(preview|archive|archives|restore)(?:\/|$)/.test(definition.path))expect(requiredFeature(path),path).toBe('content');
 }
 for(const path of ['account','settings','backup','verify','maintenance','jobs','job/example','logs'])expect(requiredFeature('/api/admin/v1/'+path),path).toBeUndefined();
 for(const operation of ['plan-save','publication-review','publication-plan-review','schedule-create','withdraw','entry-delete','archive-plan','archive-contents'])expect(operationFeature(operation),operation).toBe('content');
 expect(operationFeature('media-references')).toBe('media');
});

it('WVA-06 rejects disabled content calculations and jobs before starting a worker or writing tasks',async()=>{
 const root=join(base,'disabled-jobs-'+randomUUID()),site=new Site(root);
 writeFileSync(join(root,'site.json'),JSON.stringify({version:2,id:'disabled',port:4900,features:[],template:'blank'}));
 const jobs=new JobRunner(site,{startPaused:false,framework:process.cwd(),source:true});
 try{
  for(const operation of ['plan-save','publication-review','schedule-create','entry-delete'])await expect(jobs.query(operation,{})).rejects.toMatchObject({status:404});
  expect(()=>jobs.enqueue('import-wxr',{})).toThrow(/未启用/);
  expect(jobs.queryProcessCount).toBe(0);expect(site.store.raw.prepare('SELECT COUNT(*) n FROM jobs').get()).toEqual({n:0});
 }finally{jobs.stop();site.close();}
});
