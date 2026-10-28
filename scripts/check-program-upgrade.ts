import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { existsSync, writeFileSync, readFileSync, openSync, closeSync, copyFileSync } from 'node:fs';
import { strict as assert } from 'node:assert';
import { Site, writeProgramManifest } from '@weava/core';

export async function checkProgramUpgrade({output,root,framework}:{output:string;root:string;framework:string}){
  const command=join(output,'runtime/weava.mjs'),backupRoot=join(output,'upgrade-backups');
  const cli=(args:string[])=>new Promise<any>((resolve,reject)=>{const child=spawn(process.execPath,[command,'--site',root,...args],{cwd:framework,windowsHide:true,env:{...process.env,WEAVA_FRAMEWORK:framework},stdio:['ignore','pipe','pipe']});let stdout='',stderr='';child.stdout.on('data',(data)=>stdout+=data);child.stderr.on('data',(data)=>stderr+=data);child.once('error',reject);child.once('close',(code)=>{if(code!==0)reject(new Error(stdout+'\n'+stderr));else try{resolve(JSON.parse(stdout));}catch(error){reject(error);}});});
  const before=new Site(root),releaseId=before.release()!.id,revision=before.store.get('entry','article-0')!.revision;before.close();
  assert((await cli(['upgrade','verify','--program',output])).files>0);
  const plan=await cli(['upgrade','check','--program',output,'--backup-root',backupRoot]);assert.equal(plan.probe.releaseId,releaseId);assert(plan.probe.entries>=35);
  await cli(['upgrade','apply','--input',plan.path]);assert.equal((await cli(['upgrade','status'])).root,output.replaceAll('/','\\'));
  const descriptor=openSync(join(output,'selected-program.log'),'a');
  const runner=spawn(process.execPath,[command,'--site',root,'start'],{cwd:framework,windowsHide:true,stdio:['ignore',descriptor,descriptor],env:{...process.env,WEAVA_FRAMEWORK:framework}});closeSync(descriptor);
  const config=JSON.parse(readFileSync(join(root,'site.json'),'utf8')),origin='http://127.0.0.1:'+config.port;let runtime:any;
  try{
    let ready=false;for(let index=0;index<60;index++){if(runner.exitCode!==null)throw new Error('selected program failed to start');try{const response=await fetch(origin+'/__health',{signal:AbortSignal.timeout(1000)});if(response.ok){const health=await response.json() as any;assert.equal(health.releaseId,releaseId);ready=true;break;}}catch{}await new Promise((resolve)=>setTimeout(resolve,300));}assert(ready);
    const admin=await fetch(origin+'/admin/').then((response)=>response.text());assert(admin.includes('/_admin/assets/'));
    assert((await fetch(origin+'/posts/0/').then((response)=>response.text())).includes('未发布的文章改稿'));
  }finally{
    runtime=existsSync(join(root,'runtime.json'))?JSON.parse(readFileSync(join(root,'runtime.json'),'utf8')):null;
    if(runtime?.pid)try{process.kill(runtime.pid);}catch{}
    if(runner.exitCode===null)await new Promise<void>((resolve)=>{runner.once('close',()=>resolve());setTimeout(()=>{runner.kill();resolve();},2000);});
  }
  await cli(['upgrade','rollback','--restore-data']);assert.equal((await cli(['upgrade','status'])).selected,false);
  const restored=new Site(root);assert.equal(restored.release()!.id,releaseId);assert.equal(restored.store.get('entry','article-0')!.revision,revision);restored.close();
  // Use the actual compiled checker, with a deterministic pause after a partial migration write.
  const checker=join(output,'runtime/check.mjs'),original=readFileSync(checker,'utf8'),preserved=join(output,'runtime/check-original.mjs');copyFileSync(checker,preserved);
  const marker=join(output,'upgrade-interrupted.json');
  writeFileSync(checker,`import {writeFileSync} from 'node:fs';import Database from 'better-sqlite3';const root=process.argv[2];if(!root.includes('upgrade-check-')){const db=new Database(root+'/weava.sqlite');db.prepare("INSERT OR REPLACE INTO state VALUES('interrupted-upgrade','partial')").run();db.close();writeFileSync(${JSON.stringify(marker)},{toString(){return JSON.stringify({pid:process.pid})}}.toString());Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0);}await import('./check-original.mjs');`);
  writeProgramManifest(output,join(framework,'node_modules'));
  const interruptedPlan=await cli(['upgrade','check','--program',output,'--backup-root',backupRoot]);
  const child=spawn(process.execPath,[command,'--site',root,'upgrade','apply','--input',interruptedPlan.path],{cwd:framework,windowsHide:true,env:{...process.env,WEAVA_FRAMEWORK:framework},stdio:'ignore'});
  let checkpoint=false;for(let index=0;index<100;index++){if(existsSync(marker)){checkpoint=true;break;}if(child.exitCode!==null)break;await new Promise((resolve)=>setTimeout(resolve,100));}assert(checkpoint,'upgrade did not reach the real child-process interruption checkpoint');
  const checkerPid=JSON.parse(readFileSync(marker,'utf8')).pid;const closed=new Promise<void>((resolve)=>child.once('close',()=>resolve()));child.kill();await closed;try{process.kill(checkerPid);}catch(error:any){if(error.code!=='ESRCH')throw error;}
  for(let index=0;index<40;index++){let alive=false;try{process.kill(checkerPid,0);alive=true;}catch{}if(!alive)break;await new Promise((resolve)=>setTimeout(resolve,50));}
  const recovery=await cli(['upgrade','recover']);assert.equal(recovery.recovered,true);assert(existsSync(recovery.retained));
  const recovered=new Site(root);assert.equal(recovered.store.state('interrupted-upgrade'),undefined);assert.equal(recovered.release()!.id,releaseId);recovered.close();
  // Restore the compiled program file and its manifest without removing the preserved copy.
  writeFileSync(checker,original);writeProgramManifest(output,join(framework,'node_modules'));
  return {compiledVerification:true,isolatedPreflight:true,selectedProgramStarted:true,adminAndPublicPage:true,backupRollback:true,realProcessInterrupted:true,recoveryRestoresData:true,failedInstanceRetained:true};
}
