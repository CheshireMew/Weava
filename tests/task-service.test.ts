import {afterEach,expect,it} from 'vitest';
import {join,resolve} from 'node:path';
import {writeFileSync,existsSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {Site} from '../packages/core/src/site.ts';
import {TaskService} from '../packages/core/src/task-service.ts';
import {entrySchema} from '@weava/contracts';
const base=join(process.env.WEAVA_TEST_OUTPUT??'D:/Tools/cache/weava/tests','task-service-'+randomUUID());
const sites:Site[]=[],services:TaskService[]=[];
let sequence=0;
const delay=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));
function fixture(source:string){
  const site=new Site(join(base,String(sequence++)));sites.push(site);
  writeFileSync(join(site.root,'site.json'),JSON.stringify({version:2,id:'worker-test',port:4500,features:['content'],template:'blank'}));
  writeFileSync(join(site.root,'extensions/index.mjs'),source);
  site.saveEntry(entrySchema.parse({id:'page',kind:'page',path:'/page/',title:'Page',status:'published'}),null);
  const service=new TaskService(site.root,{framework:resolve('.'),source:true},1);services.push(service);return {site,service};
}
afterEach(async()=>{await Promise.all(services.splice(0).map(service=>service.stop()));for(const site of sites.splice(0))site.close();});
it('reloads configuration and transitive extension modules in a fresh process without bypassing validation',async()=>{
  const {site,service}=fixture('import reason from "./reason.mjs";export default()=>({id:"audit",apiVersion:1,render(){throw new Error(reason)}})');
  writeFileSync(join(site.root,'extensions/reason.mjs'),'export default "first failure"');
  await expect(service.run('publication-review',{})).rejects.toThrow('first failure');
  site.store.put('extension-config','audit',{enabled:true},null);
  await expect(service.run('publication-review',{})).rejects.toThrow('first failure');
  writeFileSync(join(site.root,'extensions/reason.mjs'),'export default "changed dependency failure"');
  await expect(service.run('publication-review',{})).rejects.toThrow('changed dependency failure');
  writeFileSync(join(site.root,'extensions/index.mjs'),'export default()=>{throw new Error("broken factory") }');
  await expect(service.run('publication-review',{})).rejects.toThrow('broken factory');
});
it.each([{deadline:700,grace:5000,status:408},{deadline:5000,grace:150,status:503}])('bounds shutdown by the earlier execution or stop deadline (%j)',async({deadline,grace,status})=>{
  const {site,service}=fixture('import{writeFileSync}from"node:fs";import{join}from"node:path";export default({site})=>({id:"audit",apiVersion:1,render(){writeFileSync(join(site.root,"entered"),"yes");return new Promise(()=>setInterval(()=>{},1000));}})');
  await service.run('publication-warm',{});
  const work=service.run('publication-review',{deadlineAt:Date.now()+deadline}).catch(error=>error);
  const until=Date.now()+2000;while(!existsSync(join(site.root,'entered'))&&Date.now()<until)await delay(10);
  expect(existsSync(join(site.root,'entered'))).toBe(true);
  const start=Date.now();await service.stop(grace);const error=await work;
  expect(error.status).toBe(status);expect(Date.now()-start).toBeLessThan(2500);expect(service.processCount).toBe(0);expect(service.pending).toBe(0);
});
