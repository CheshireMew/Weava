import {spawn} from 'node:child_process';
import {readFileSync,writeFileSync,existsSync,mkdirSync} from 'node:fs';
import {join} from 'node:path';
import {strict as assert} from 'node:assert';
const home='D:/Tools/cache/weava/tasks/shared-runtime-20261105/installation';
const manager=join(home,'manager/manager.mjs');
const program=process.argv[2]??'9617b4e5-6397-44ab-a6ba-9c3e9a8d8e30';
const results:any[]=[];
async function cli(args:string[]){
 return new Promise<any>((resolve,reject)=>{
  const child=spawn(process.execPath,[manager,'--installation',home,...args],{windowsHide:true,stdio:['ignore','pipe','pipe']});
  let out='',err='';child.stdout.on('data',b=>out+=b);child.stderr.on('data',b=>err+=b);
  child.once('error',reject);child.once('close',code=>{if(code)return reject(new Error(err||out));try{resolve(JSON.parse(out.trim().split('\n').at(-1)!));}catch(e){reject(new Error(out+err));}});
 });
}
const install=JSON.parse(readFileSync(join(home,'installation.json'),'utf8'));
for(const [index,template]of ['company','portfolio','documentation','resource','blank'].entries()){
 const id=template==='blank'?'check-empty':'check-'+template,port=4530+index;
 if(!install.sites[id])await cli(['site','create',id,'--port',String(port),'--template',template]);
 const state=await cli(['site','start',id]);
 const response=await fetch('http://127.0.0.1:'+port+'/');
 assert.equal(response.status,200);assert((await response.text()).includes('<h1'));
 const root=join('D:/Tools/cache/weava/tasks/shared-runtime-20261105/sites',id);
 assert(!existsSync(join(root,'node_modules')));assert(!existsSync(join(root,'admin')));
 results.push({id,template,port,programId:state.programId,homepage:true,sharedFiles:true});
 console.log(JSON.stringify(results.at(-1)));
}
writeFileSync(join(home,'../template-results.json'),JSON.stringify(results,null,2));

