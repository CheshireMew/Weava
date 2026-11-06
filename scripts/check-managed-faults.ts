import {spawn} from 'node:child_process';
import {readFileSync,writeFileSync,existsSync,mkdirSync} from 'node:fs';
import {join} from 'node:path';
import {strict as assert} from 'node:assert';
import {DatabaseSync} from 'node:sqlite';
const base='D:/Tools/cache/weava/tasks/shared-runtime-20261105',home=join(base,'installation'),root=join(base,'sites/check-empty'),manager=join(home,'manager/manager.mjs');
function launch(args:string[]){
 const child=spawn(process.execPath,[manager,'--installation',home,...args],{windowsHide:true,stdio:['ignore','pipe','pipe']});
 let out='',err='';child.stdout.on('data',b=>out+=b);child.stderr.on('data',b=>err+=b);
 const completed=new Promise<any>((resolve,reject)=>{child.once('error',reject);child.once('close',code=>{if(code)return reject(new Error(err||out));try{resolve(JSON.parse(out.trim().split('\n').at(-1)!));}catch{reject(new Error(out+err));}});});
 return {child,completed};
}
const cli=async(args:string[])=>launch(args).completed;
await cli(['site','stop','check-empty']);
const extension=join(root,'custom/extensions.ts');mkdirSync(join(root,'custom'),{recursive:true});
const marker=join(root,'extensions/state/fault.json');
writeFileSync(extension,"import {mkdirSync,writeFileSync} from 'node:fs';import {join} from 'node:path';export default({site}:any)=>({id:'fault',apiVersion:1,version:'1.0.0',schemaVersion:1,migrationFiles:['extensions/state/fault.json'],migrations:[{version:1,up(){site.store.put('fault-data','partial',{partial:true},null);if(!process.env.WEAVA_RESOURCE_ROOT){mkdirSync(join(site.root,'extensions/state'),{recursive:true});writeFileSync(join(site.root,'extensions/state/fault.json'),JSON.stringify({pid:process.pid,root:site.root}));Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0);}}}]});");
const build=await cli(['site','build','check-empty']);
const installation=JSON.parse(readFileSync(join(home,'installation.json'),'utf8')),programId=installation.defaultProgramId;
const active=launch(['site','update','check-empty','--to',programId,'--build',build.id]);
active.completed.catch(()=>{});
for(let n=0;n<500&&!existsSync(marker);n++){if(active.child.exitCode!==null)throw new Error('update exited before interruption checkpoint');await new Promise(r=>setTimeout(r,100));}
assert(existsSync(marker),'live migration checkpoint not reached');
const running=JSON.parse(readFileSync(marker,'utf8'));assert.equal(running.root.toLowerCase(),root.replaceAll('/','\\').toLowerCase());
active.child.kill();process.kill(running.pid);
for(let n=0;n<60;n++){let alive=false;try{process.kill(running.pid,0);alive=true;}catch{}if(!alive)break;await new Promise(r=>setTimeout(r,100));}
const restored=await cli(['site','recover','check-empty']);
const db=new DatabaseSync(join(root,'weava.sqlite'),{readOnly:true});assert(!db.prepare("SELECT 1 FROM records WHERE scope='fault-data'").get());db.close();
assert(!existsSync(marker));await cli(['site','start','check-empty']);
assert.equal((await fetch('http://127.0.0.1:4534/')).status,200);
const result={interruptedLiveMigration:true,recoveredDatabase:true,failedFilesRetained:true,websiteRestarted:true,recovery:restored};
writeFileSync(join(base,'fault-results.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));

