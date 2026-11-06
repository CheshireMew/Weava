import {spawn} from 'node:child_process';
import {readFileSync,writeFileSync,mkdirSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {strict as assert} from 'node:assert';
const base='D:/Tools/cache/weava/tasks/shared-runtime-20261105',home=join(base,'installation'),manager=join(home,'manager/manager.mjs');
const installation=JSON.parse(readFileSync(join(home,'installation.json'),'utf8')),program=installation.defaultProgramId;
async function cli(args:string[],fail=false):Promise<any>{
 return new Promise((resolve,reject)=>{const child=spawn(process.execPath,[manager,'--installation',home,...args],{windowsHide:true,stdio:['ignore','pipe','pipe']});let out='',err='';child.stdout.on('data',b=>out+=b);child.stderr.on('data',b=>err+=b);child.once('error',reject);child.once('close',code=>{if(fail)return code?resolve({failed:true,error:err||out}):reject(new Error('expected operation to fail'));if(code)return reject(new Error(err||out));try{resolve(JSON.parse(out.trim().split('\n').at(-1)!));}catch{reject(new Error(out+err));}});});
}
const tool=join(base,'sites/check-tool'),blog=join(base,'sites/check-blog'),origin='http://127.0.0.1:4523';
const normalExtension="import {getWebsite} from '@weava/site';export default()=>({id:'calculator',apiVersion:1,version:'1.0.0',jobs:{double:async(value:number)=>{const website=getWebsite();website.business.put('task-results','last',{site:website.id,value:value*2});return value*2;}}});";
if(!process.argv.includes('--http-only')){
 mkdirSync(join(tool,'custom/src/pages/api'),{recursive:true});
 writeFileSync(join(tool,'custom/extensions.ts'),normalExtension);
 writeFileSync(join(tool,'custom/migrations.ts'),"export default[{id:'calculator',version:1,up({business}:any){business.put('configuration','precision',2);}}];");
 writeFileSync(join(tool,'custom/src/pages/api/preferences.ts'),"import {getWebsite} from '@weava/site';export function GET(){return Response.json(getWebsite().business.list('preferences'));}export async function POST({request}:any){getWebsite().business.put('preferences','saved',await request.json());return Response.json({saved:true});}");
 writeFileSync(join(tool,'custom/src/pages/api/task.ts'),"import {getWebsite} from '@weava/site';export function GET({request}:any){const id=new URL(request.url).searchParams.get('id');return Response.json(getWebsite().tasks.get(id));}export async function POST({request}:any){return Response.json(getWebsite().tasks.enqueue('calculator:double',await request.json()));}");
 const page=join(blog,'custom/src/pages/posts/[slug].astro'),source=readFileSync(page,'utf8');
 if(!source.includes('专用页面返回404'))writeFileSync(page,source.replace('const website=getWebsite();',"const website=getWebsite();\nif(Astro.url.searchParams.has('missing'))return new Response('专用页面返回404',{status:404});"));
 if(!process.argv.includes('--resume')){await cli(['site','build','check-tool','--program',program,'--apply']);await cli(['site','build','check-blog','--program',program,'--apply']);}
 for(const id of ['check-company','check-portfolio','check-documentation','check-resource','check-empty']){
  if(!JSON.parse(readFileSync(join(home,'installation.json'),'utf8')).sites[id])await cli(['site','adopt',id,'--path',join(base,'sites',id),'--program',program]);
  else if(JSON.parse(readFileSync(join(base,'sites',id,'program.json'),'utf8')).programId!==program)await cli(['site','update',id,'--to',program]);
 }
}
for(const id of ['check-tool','check-blog','check-company','check-portfolio','check-documentation','check-resource','check-empty'])await cli(['site','start',id]);
const templates=[];
for(const [id,port]of [['check-blog',4522],['check-company',4530],['check-portfolio',4531],['check-documentation',4532],['check-resource',4533],['check-empty',4534]] as const){
 const response=await fetch('http://127.0.0.1:'+port+'/');assert.equal(response.status,200);assert((await response.text()).includes('<h1'));
 const info=await cli(['site','status',id]);assert.equal(info.runtime.programId,program);assert(!existsSync(join(info.root,'node_modules')));assert(!existsSync(join(info.root,'admin')));templates.push({id,port,shared:true});
}
assert.deepEqual(await fetch(origin+'/api/double?value=21').then(r=>r.json()),{value:42,site:'check-tool'});
assert.equal((await fetch(origin+'/icon.svg')).status,200);
assert.equal((await fetch('http://127.0.0.1:4522/posts/welcome/?missing=1')).status,404);
await fetch(origin+'/api/preferences',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({theme:'green'})});
assert.deepEqual(await fetch(origin+'/api/preferences').then(r=>r.json()),[{id:'saved',value:{theme:'green'}}]);
let task:any=await fetch(origin+'/api/task',{method:'POST',headers:{'Content-Type':'application/json'},body:'21'}).then(r=>r.json());
for(let n=0;n<100&&['queued','running'].includes(task.status);n++){await new Promise(r=>setTimeout(r,100));task=await fetch(origin+'/api/task?id='+task.id).then(r=>r.json());}
assert.equal(task.status,'complete');assert.equal(task.result,42);
assert.equal((await fetch('http://127.0.0.1:4522/api/preferences')).status,404);
const login=await fetch('http://127.0.0.1:4522/api/admin/v1/login',{method:'POST',headers:{'Content-Type':'application/json',Origin:'http://127.0.0.1:4522'},body:JSON.stringify({username:'owner',password:readFileSync(join(base,'test-owner.txt'),'utf8')})});assert(login.ok);
const cookie=login.headers.getSetCookie().map(value=>value.split(';')[0]).join('; ');
const publicHtml=await fetch('http://127.0.0.1:4522/posts/welcome/').then(r=>r.text()),preview=await fetch('http://127.0.0.1:4522/__preview/welcome/',{headers:{cookie}}).then(r=>r.text());
assert(publicHtml.includes('隔离验证的新标题'));assert(!publicHtml.includes('仅在专用页面预览的草稿'));assert(preview.includes('仅在专用页面预览的草稿'));
if(!process.argv.includes('--http-only')){
 const selection=readFileSync(join(tool,'program.json'),'utf8'),page=join(tool,'custom/src/pages/index.astro'),source=readFileSync(page,'utf8');
 try{writeFileSync(page,'---\nthis is invalid Astro syntax !!!\n---\n');await cli(['site','build','check-tool'],true);}finally{writeFileSync(page,source);}
 assert.equal(readFileSync(join(tool,'program.json'),'utf8'),selection);assert.equal((await fetch(origin)).status,200);
 // Worker preflight succeeds, but activating the real service fails. Data and
 // the selected build must both return to the previous running deployment.
 writeFileSync(join(tool,'custom/extensions.ts'),"export default()=>({id:'calculator',apiVersion:1,version:'1.0.1',start(){throw new Error('injected service initialization failure');}});");
 const candidate=await cli(['site','build','check-tool']);
 await cli(['site','update','check-tool','--to',program,'--build',candidate.id],true);
 assert.equal(readFileSync(join(tool,'program.json'),'utf8'),selection);assert.equal((await fetch(origin)).status,200);
 assert.equal(JSON.parse(readFileSync(join(tool,'.weava-update.json'),'utf8')).status,'rolled-back');
 writeFileSync(join(tool,'custom/extensions.ts'),normalExtension);
 await cli(['site','features','check-tool','--set','media,analytics']);
 assert((await fetch(origin).then(r=>r.text())).includes('/weava-analytics.js'));
 await cli(['site','features','check-tool','--set','media']);
 assert(!(await fetch(origin).then(r=>r.text())).includes('/weava-analytics.js'));
 assert.equal((await fetch(origin+'/api/admin/v1/analytics/summary')).status,404);
 await cli(['site','features','check-tool','--set','media,analytics']);
}
const result={program,templates,customPage:true,businessApi:true,businessMigration:true,persistentTask:true,assets:true,matched404:true,preview:true,siteIsolation:true,failedBuildPreservesSelection:true,startupFailureRestoresDataAndSelection:true,featureGates:true};
writeFileSync(join(base,'managed-results.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
