import { strict as assert } from 'node:assert';
import { join,resolve } from 'node:path';
import { readFileSync,writeFileSync,openSync,closeSync } from 'node:fs';
import { spawn,spawnSync } from 'node:child_process';
import { createServer } from 'node:net';
import Database from 'better-sqlite3';

// Run only against a completed check-personal-site fixture; never selects a real instance.
const output=resolve(process.argv[2]??'');
const original=JSON.parse(readFileSync(join(output,'results.json'),'utf8'));
assert.equal(original.passed,true);assert.equal(resolve(original.output),output);
const root=join(output,'site'),build=resolve(original.build),framework=resolve(import.meta.dirname,'..');
const cli=join(build,'runtime/weava.mjs');
const run=(args:string[])=>spawnSync(process.execPath,[cli,'--site',root,'owner','reset-two-factor',...args],{cwd:framework,windowsHide:true,encoding:'utf8',env:{...process.env,WEAVA_FRAMEWORK:framework},timeout:15000});
assert.notEqual(run([]).status,0,'confirmation is mandatory');
const probe=createServer();await new Promise<void>(done=>probe.listen(0,'127.0.0.1',done));const port=(probe.address() as any).port;await new Promise<void>(done=>probe.close(()=>done()));
const log=openSync(join(output,'recovery-server.log'),'a');
const server=spawn(process.execPath,[join(build,'web/server/entry.mjs')],{cwd:framework,windowsHide:true,stdio:['ignore',log,log],env:{...process.env,WEAVA_SITE:root,WEAVA_FRAMEWORK:framework,WEAVA_ADMIN_DIST:join(build,'admin'),WEAVA_WORKER:join(build,'runtime/worker.mjs'),HOST:'127.0.0.1',PORT:String(port),TEMP:output,TMP:output}});closeSync(log);
let liveRejected=false;
try{
  let ready=false;for(let i=0;i<60;i++){if(server.exitCode!==null)throw new Error('Recovery fixture did not start');try{if((await fetch('http://127.0.0.1:'+port+'/__health')).ok){ready=true;break;}}catch{}await new Promise(done=>setTimeout(done,100));}assert(ready);
  const refused=run(['--confirm']);assert.notEqual(refused.status,0);assert.match(refused.stderr+refused.stdout,/停止|运行|占用/);liveRejected=true;
}finally{if(server.exitCode===null){server.kill();await new Promise<void>(done=>server.once('exit',()=>done()));}}
const recovered=run(['--confirm']);assert.equal(recovered.status,0,recovered.stderr);assert.equal(JSON.parse(recovered.stdout).loginRequired,true);
const db=new Database(join(root,'weava.sqlite'),{readonly:true});
try{assert.equal((db.prepare("SELECT value FROM state WHERE key='owner-totp'").get() as any).value,'null');assert.equal((db.prepare('SELECT COUNT(*) n FROM sessions WHERE expires>?').get(Date.now()) as any).n,0);}finally{db.close();}
const evidence={passed:true,confirmationRequired:true,liveInstanceRejected:liveRejected,compiledOfflineRecovery:true,allSessionsRevoked:true};writeFileSync(join(output,'recovery-results.json'),JSON.stringify(evidence,null,2));console.log(JSON.stringify(evidence));
