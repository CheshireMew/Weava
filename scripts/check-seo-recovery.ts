import {spawn,spawnSync} from 'node:child_process';
import {existsSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {strict as assert} from 'node:assert';
const base='D:/Tools/cache/weava/tasks/seo-upgrade-20261105',home=join(base,'installation'),root=join(base,'sites/blog'),manager=join(home,'manager/manager.mjs'),origin='http://127.0.0.1:4654';
const installation=JSON.parse(readFileSync(join(home,'installation.json'),'utf8')),target=installation.defaultProgramId;
function launch(args:string[]){const child=spawn(process.execPath,[manager,'--installation',home,...args],{windowsHide:true,stdio:['ignore','pipe','pipe']});let out='',err='';child.stdout.on('data',b=>out+=b);child.stderr.on('data',b=>err+=b);const done=new Promise<any>((resolve,reject)=>{child.once('error',reject);child.once('close',code=>{if(code)return reject(new Error(err||out));try{resolve(JSON.parse(out.trim().split('\n').at(-1)!));}catch{resolve(out);}});});return {child,done};}
const cli=(args:string[])=>launch(args).done;
const nginx='D:/Tools/nginx-1.30.6/nginx.exe',nginxRoot=join(base,'nginx');spawn(nginx,['-p',nginxRoot+'/', '-c','nginx.conf'],{cwd:nginxRoot,windowsHide:true,stdio:'ignore'});
try{
 await cli(['host','start']);await cli(['site','start','blog']);
 const pointer=readFileSync(join(root,'program.json'),'utf8');
 mkdirSync(join(root,'custom/src/pages'),{recursive:true});
 const marker=join(root,'extensions/state/interrupted.json');
 writeFileSync(join(root,'custom/extensions.ts'),"import{mkdirSync,writeFileSync}from'node:fs';import{join}from'node:path';export default({site}:any)=>({id:'interrupted',apiVersion:1,schemaVersion:1,migrationFiles:['extensions/state/interrupted.json'],migrations:[{version:1,up(){site.store.put('interruption-proof','partial',{partial:true},null);if(!process.env.WEAVA_RESOURCE_ROOT){mkdirSync(join(site.root,'extensions/state'),{recursive:true});writeFileSync(join(site.root,'extensions/state/interrupted.json'),JSON.stringify({pid:process.pid}));Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0);}}}]});");
 const build=await cli(['site','build','blog']);
 const update=launch(['site','update','blog','--to',target,'--build',build.id]);update.done.catch(()=>{});
 for(let n=0;n<600&&!existsSync(marker);n++){if(update.child.exitCode!==null)throw new Error('upgrade exited before live migration checkpoint');await new Promise(r=>setTimeout(r,100));}
 assert(existsSync(marker));assert.equal((await fetch(origin+'/posts/story-0/')).status,503);assert.equal((await fetch(origin+'/robots.txt')).status,200);
 const worker=JSON.parse(readFileSync(marker,'utf8')).pid;update.child.kill();process.kill(worker);
 await update.done.catch(()=>{});
 const restored=await cli(['site','recover','blog']);assert(restored.recovered);assert.equal(readFileSync(join(root,'program.json'),'utf8'),pointer);assert(!existsSync(marker));
 const db=new DatabaseSync(join(root,'weava.sqlite'),{readOnly:true});assert(!db.prepare("SELECT 1 FROM records WHERE scope='interruption-proof'").get());db.close();
 assert.equal((await fetch(origin+'/posts/story-0/')).status,200);assert(!existsSync(join(home,'proxy/blog/active.json')));
 const results={interruptedMigration:true,maintenanceSurvivedInterruption:true,robotsAvailable:true,dataAndSelectionRestored:true,proxyReturnedTo200:true,recovery:restored};writeFileSync(join(base,'interruption-results.json'),JSON.stringify(results,null,2));console.log(JSON.stringify(results));
}finally{spawnSync(nginx,['-p',nginxRoot+'/', '-c','nginx.conf','-s','quit'],{windowsHide:true});await cli(['host','stop']).catch(()=>{});}
