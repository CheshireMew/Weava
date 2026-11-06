import {spawn} from 'node:child_process';
import {readFileSync,writeFileSync,existsSync,mkdirSync} from 'node:fs';
import {join} from 'node:path';
import {strict as assert} from 'node:assert';
import sharp from 'sharp';
const base='D:/Tools/cache/weava/tasks/shared-runtime-20261105',home=join(base,'installation');
const manager=join(home,'manager/manager.mjs'),root=join(base,'sites/check-blog'),origin='http://127.0.0.1:4522';
async function cli(args:string[]){
 return new Promise<any>((resolve,reject)=>{const child=spawn(process.execPath,[manager,'--installation',home,...args],{windowsHide:true,stdio:['ignore','pipe','pipe']});let out='',err='';child.stdout.on('data',b=>out+=b);child.stderr.on('data',b=>err+=b);child.once('close',code=>{if(code)return reject(new Error(err||out));try{resolve(JSON.parse(out.trim().split('\n').at(-1)!));}catch{resolve(out);}});});
}
const token=readFileSync(join(root,'cli-token'),'utf8'),headers={Authorization:'Bearer '+token,'Content-Type':'application/json'};
async function call(path:string,body?:unknown){
 const response=await fetch(origin+'/api/admin/v1/'+path,{method:body===undefined?'GET':'POST',headers,body:body===undefined?undefined:JSON.stringify(body)});
 const result=await response.json();if(!response.ok)throw new Error(path+': '+JSON.stringify(result));return result as any;
}
if(!process.argv.includes('--from-media')){
await cli(['site','stop','check-blog']);
const passwordFile=join(base,'test-owner.txt');writeFileSync(passwordFile,'Weava local browser check 2026 #N5');
await cli(['--site','check-blog','owner','reset-password','--password-file',passwordFile]);
await cli(['site','start','check-blog']);
const original=await call('entry/welcome');
const saved=await call('entry',{revision:original.revision,value:{...original.value,title:'隔离验证的新标题',document:{version:1,format:'markdown',source:'## 发布验证\n\n这份文字通过真实 API 保存与发布。'}}});
let publicHtml=await fetch(origin+'/posts/welcome/').then(r=>r.text());assert(!publicHtml.includes('隔离验证的新标题'));
const preview=await call('publication',{scope:'entries',ids:['welcome']});
const job=await call('publish',preview.options);
let state=job;
for(let n=0;n<100&&['queued','running'].includes(state.status);n++){await new Promise(r=>setTimeout(r,150));state=await call('job/'+job.id);}
assert.equal(state.status,'complete');
publicHtml=await fetch(origin+'/posts/welcome/').then(r=>r.text());assert(publicHtml.includes('隔离验证的新标题'));
}
const source=join(base,'test-image.png');await sharp({create:{width:48,height:32,channels:3,background:'#315c4c'}}).png().toFile(source);
const media=await cli(['--site','check-blog','media-upload',source,'--wait']);assert(media);
const info=await call('state?summary=1&panel=operations');assert(info.features.includes('content'));assert.equal(info.program.framework,'0.2.0');
const before=await cli(['site','status','check-blog']);process.kill(before.runtime.pid);
let after:any;
for(let n=0;n<100;n++){await new Promise(r=>setTimeout(r,250));const r=await cli(['site','status','check-blog']);if(r.runtime?.status==='running'&&r.runtime.pid!==before.runtime.pid){after=r;break;}}
assert(after,'crashed website was not restarted');
const result={savePreviewPublish:true,draftIsolation:true,mediaUpload:true,stateContract:true,crashRestart:true,oldPid:before.runtime.pid,newPid:after.runtime.pid};
writeFileSync(join(base,'api-results.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));

