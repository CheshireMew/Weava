import {describe,expect,it} from 'vitest';
import {spawn,type ChildProcess} from 'node:child_process';
import {createServer} from 'node:net';
import {mkdirSync,readFileSync,writeFileSync,linkSync,symlinkSync} from 'node:fs';
import {dirname,join,relative} from 'node:path';
import {randomUUID} from 'node:crypto';
import {once} from 'node:events';
import {saveInstallation,verify,json,atomic,hash,updateInstallation} from '../packages/manager/src/state.ts';
import {createSite} from '../packages/manager/src/operations.ts';
import {requestHost} from '../packages/manager/src/host.ts';
import {protectedUpgrade,recoverProtected} from '../packages/manager/src/upgrade.ts';
import {createAdminClient} from '../packages/contracts/src/api-client.ts';
import {SCHEMA_VERSION} from '../packages/core/src/storage.ts';

const programRoot=process.env.WEAVA_TEST_PROGRAM;
const base=process.env.WEAVA_TEST_OUTPUT??'D:/Tools/cache/weava/tasks/audit-remediation-20261106';
async function freePort(){const server=createServer();server.listen(0,'127.0.0.1');await once(server,'listening');const port=(server.address() as any).port;await new Promise<void>(resolve=>server.close(()=>resolve()));return port as number;}
async function fixture(run:(value:{home:string;root:string;programId:string;origin:string;client:ReturnType<typeof createAdminClient>})=>Promise<void>){
 const program=verify(programRoot!);expect(program.manifest.schemaVersion).toBe(SCHEMA_VERSION);expect(program.manifest.upgradeProtocol).toBe(2);
 const home=join(base,'managed-'+randomUUID()),root=join(home,'sites/blog'),port=await freePort(),origin='http://127.0.0.1:'+port;
 mkdirSync(home,{recursive:true});
 saveInstallation(home,{version:1,id:randomUUID(),node:process.execPath,sitesRoot:join(home,'sites'),backupRoot:join(home,'backups'),defaultProgramId:program.manifest.id,programs:{[program.manifest.id]:{root:program.root,manifestHash:program.manifestHash}},sites:{}});
 await createSite(home,'blog',{port,template:'blog',program:program.manifest.id,domain:origin});
 // This is the real host and selected frozen site program, with an isolated registration and database.
 const child=spawn(process.execPath,['--import','tsx','packages/manager/src/index.ts','--installation',home,'host','run'],{cwd:process.cwd(),windowsHide:true,stdio:['ignore','pipe','pipe']});
 let output='';child.stdout!.on('data',b=>output=(output+b).slice(-16000));child.stderr!.on('data',b=>output=(output+b).slice(-16000));
 try{
  let ready=false;for(let n=0;n<100;n++){if(child.exitCode!==null)throw new Error(output);try{await requestHost(home,'status',{timeoutMs:1000});ready=true;break;}catch{}await new Promise(r=>setTimeout(r,100));}expect(ready,output).toBe(true);
  const client=createAdminClient({baseUrl:origin+'/api/admin/v1/',headers:{Authorization:'Bearer '+readFileSync(join(root,'cli-token'),'utf8')},timeoutMs:15000});
  await run({home,root,programId:program.manifest.id,origin,client});
 }finally{
  await requestHost(home,'shutdown',{timeoutMs:5000}).catch(()=>{});
  if(child.exitCode===null){await Promise.race([once(child,'exit'),new Promise(r=>setTimeout(r,8000))]);if(child.exitCode===null){child.kill();await once(child,'exit');}}
 }
}
describe('real managed upgrade lifecycle',{skip:!programRoot},()=>{
 it('WVA-01 preserves the committed recovery point across a check and really restores data through HTTP',async()=>fixture(async({home,root,programId,client})=>{
  await requestHost(home,'start',{id:'blog'});
  const original=await client('settings');
  const originalDeployment=readFileSync(join(root,'program.json'),'utf8');
  expect(await protectedUpgrade(home,root,'blog',programId,undefined)).toMatchObject({unchanged:true,oldSiteStopped:false});
  // A second immutable identity reuses frozen file bytes, rather than copying dependencies.
  const source=verify(programRoot!),target=join(home,'candidate'),manifest={...source.manifest,id:randomUUID()};
  for(const file of [...manifest.files,...manifest.dependencyFiles]){const dest=join(target,file.path);mkdirSync(dirname(dest),{recursive:true});linkSync(join(source.root,file.path),dest);}
  for(const link of manifest.dependencyLinks){const dest=join(target,link.path);mkdirSync(dirname(dest),{recursive:true});symlinkSync(relative(dirname(dest),join(target,link.target)),dest,'junction');}
  atomic(join(target,'program.json'),manifest);
  updateInstallation(home,value=>{value.programs[manifest.id]={root:target,manifestHash:hash(readFileSync(join(target,'program.json')))};});
  const updated=await protectedUpgrade(home,root,'blog',manifest.id,undefined);
  expect(readFileSync(join(root,'program.json'),'utf8')).not.toBe(originalDeployment);
  const committed=readFileSync(join(root,'.weava-preparation.json'),'utf8');
  await client('settings',{value:{...original.value,name:'After the completed upgrade'},revision:original.revision});
  const checked=await protectedUpgrade(home,root,'blog',programId,undefined,{check:true});
  expect(readFileSync(join(root,'.weava-preparation.json'),'utf8')).toBe(committed);
  if(typeof checked.report!=='string')throw new Error('Expected a preflight report');
  // Historical shape captured by the pre-fix real-process regression: --check
  // overwrote this record, but not the committed migration journal/checkpoint.
  const report=json(checked.report);
  atomic(join(root,'.weava-preparation.json'),{version:1,operation:report.operation,status:'checked',report:checked.report,approval:checked.approval});
  await expect(recoverProtected(home,root)).rejects.toThrow(/restore-data/);
  const recovered=await recoverProtected(home,root,true);
  expect(recovered.point).toBe((updated as any).point);
  expect(readFileSync(join(root,'program.json'),'utf8')).toBe(originalDeployment);
  expect((await client('settings')).value.name).toBe(original.value.name);
  expect(json(join(root,'.weava-update.json')).status).toBe('rolled-back');
 }),180000);
 it('WVA-04 restores a stopped site after successful and failed checks',async()=>fixture(async({home,root,programId})=>{
  await protectedUpgrade(home,root,'blog',programId,undefined,{check:true});
  expect((await requestHost(home,'status')).sites.find((s:any)=>s.id==='blog').status).toBe('stopped');
  writeFileSync(join(root,'extensions/index.mjs'),"export default()=>({id:'preflight-failure',apiVersion:1,version:'1.0.0',route(request){if(new URL(request.url).pathname==='/robots.txt')return new Response('controlled preflight failure',{status:500});return null;}});");
  await expect(protectedUpgrade(home,root,'blog',programId,undefined,{check:true})).rejects.toThrow(/robots/);
  expect((await requestHost(home,'status')).sites.find((s:any)=>s.id==='blog').status).toBe('stopped');
 }),180000);
});
