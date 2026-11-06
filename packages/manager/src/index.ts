import {Command} from 'commander';
import {spawn,spawnSync} from 'node:child_process';
import {existsSync,mkdirSync,copyFileSync,writeFileSync,readFileSync,symlinkSync} from 'node:fs';
import {join,resolve,dirname,basename} from 'node:path';
import {randomUUID,randomBytes} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {installationRoot,loadInstallation,saveInstallation,updateInstallation,verify,programFor,siteRoot,descriptor,selected,inspect,json,atomic,deployment,hash} from './state.ts';
import {installationSchema,validateFeatures,type FeatureId} from '../../contracts/src/installation.ts';
import {createSite,adoptSite,selection,run,restoreCheckpoint,applyFeatures,writeLauncher} from './operations.ts';
import {serveHost,ensureHost,requestHost} from './host.ts';
import {repairProgramLinks} from './relink.ts';
import {protectedUpgrade,recoverProtected,type UpgradeOptions} from './upgrade.ts';
import {prepareProxy} from './proxy.ts';
const cli=new Command().name('weava').version('0.2.0').option('--installation <path>').option('--site <id-or-path>').option('--human');
const home=()=>installationRoot(cli.opts().installation);
const output=(value:unknown)=>console.log(JSON.stringify(value,null,cli.opts().human?2:0));
function pick(id?:string,verifyFiles=true){const install=loadInstallation(home()),root=siteRoot(install,id??cli.opts().site??'demo');return {install,root,id:descriptor(root).id,p:selected(install,root,verifyFiles)};}
async function host(){const i=loadInstallation(home());return ensureHost(home(),i.node,join(home(),'manager/manager.mjs'));}
async function start(id?:string,foreground=false,port?:number){
 const s=pick(id,false);await host();const result=await requestHost(home(),'start',{id:s.id,port});
 const announce=()=>{
  if(!cli.opts().human)return output(result);
  const db=new DatabaseSync(join(s.root,'weava.sqlite'),{readOnly:true});let admin='/admin',name=s.id;
  try{admin=String(db.prepare("SELECT value FROM state WHERE key='owner-admin-path'").get()?.value??admin);const row=db.prepare("SELECT data FROM records WHERE scope='settings' AND id='site'").get();if(row)name=JSON.parse(String(row.data)).name??name;}finally{db.close();}
  const origin='http://127.0.0.1:'+(result.port??port??descriptor(s.root).port);
  console.log('\n'+name+' 已启动\n\n网站：'+origin+'/\n后台：'+origin+admin+'/\n\n'+(foreground?'此窗口正在监看网站。按 Ctrl+C 停止网站。':'网站在后台运行，关闭此窗口后会继续运行。')+'\n');
 };
 if(foreground){
  announce();process.once('SIGINT',()=>{void requestHost(home(),'stop',{id:s.id}).finally(()=>process.exit(0));});
  await new Promise<void>((resolve,reject)=>{const timer=setInterval(()=>{void requestHost(home(),'status').then(status=>{const r=status.sites.find((r:any)=>r.id===s.id);if(!r||['stopped','failed'].includes(r.status)){clearInterval(timer);r?.status==='failed'?reject(new Error('网站进程退出，请查看 site logs。')):resolve();}}).catch(reject);},1000);});
 }else announce();
}
async function checkHttp(root:string){
 const site=descriptor(root),origin='http://127.0.0.1:'+site.port,headers={Authorization:'Bearer '+readFileSync(join(root,'cli-token'),'utf8'),'User-Agent':'WeavaCheck'};
 const db=new DatabaseSync(join(root,'weava.sqlite'),{readOnly:true});let admin='/admin';try{admin=String(db.prepare("SELECT value FROM state WHERE key='owner-admin-path'").get()?.value??admin);}finally{db.close();}
 for(const path of ['/__health','/api/admin/v1/session',admin+'/']){
  const response=await fetch(origin+path,{headers,signal:AbortSignal.timeout(15000)});
  if(!response.ok)throw new Error('网站实际启动检查失败：'+path+' ('+response.status+')');
 }
 const response=await fetch(origin+'/',{headers,signal:AbortSignal.timeout(15000)});
 if(!response.ok)throw new Error('首页启动检查失败：'+response.status);
 return {http:true};
}
async function transition(id:string|undefined,programId?:string,adoptPath?:string,buildId?:string,options:UpgradeOptions={}){
 const install=loadInstallation(home()),root=adoptPath?resolve(adoptPath):siteRoot(install,id??cli.opts().site??'demo');
 const chosenId=id??(existsSync(join(root,'site.json'))?json(join(root,'site.json')).id:undefined)??basename(root);
 if(install.sites[chosenId]&&json(join(root,'site.json')).version===2){await host();return protectedUpgrade(home(),root,chosenId,programId,buildId,options);}
 let wasRunning=false;
 try{const state=await requestHost(home(),'status');wasRunning=state.sites.some((s:any)=>s.id===chosenId&&s.status==='running');if(wasRunning)await requestHost(home(),'stop',{id:chosenId});}catch(e:any){if(wasRunning)throw e;}
 let result:Awaited<ReturnType<typeof adoptSite>>|undefined;
 try{
  result=await adoptSite(home(),root,chosenId,programId,buildId);
  await host();await requestHost(home(),'start',{id:chosenId,validation:true});await checkHttp(root);
  await requestHost(home(),'activate',{id:chosenId});
  const journal=json(join(root,'.weava-update.json'));atomic(join(root,'.weava-update.json'),{...journal,status:'complete',completedAt:new Date().toISOString()});
  return {...result,verified:true};
 }catch(e){
  await requestHost(home(),'stop',{id:chosenId}).catch(()=>{});
  if(result){restoreCheckpoint(result.point,root);const journal=json(join(root,'.weava-update.json'));atomic(join(root,'.weava-update.json'),{...journal,status:'rolled-back',error:String(e)});}
  if(wasRunning)await requestHost(home(),'start',{id:chosenId}).catch(()=>{});
  throw e;
 }
}
cli.command('install').requiredOption('--program <path>').option('--sites-root <path>').option('--backup-root <path>').option('--node <path>').action(opts=>{
 const root=home(),p=verify(opts.program);mkdirSync(join(root,'manager'),{recursive:true});
 const existing=existsSync(join(root,'installation.json'))?loadInstallation(root):installationSchema.parse({version:1,id:randomUUID(),node:resolve(opts.node??process.execPath),sitesRoot:resolve(opts.sitesRoot??join(root,'sites')),backupRoot:resolve(opts.backupRoot??join(root,'backups')),programs:{},sites:{}});
 if(!existsSync(join(root,'installation.json')))saveInstallation(root,existing);
 updateInstallation(root,value=>{value.programs[p.manifest.id]={root:p.root,manifestHash:p.manifestHash};value.defaultProgramId=p.manifest.id;});
 const destination=join(root,'manager/manager.mjs');if(resolve(process.argv[1])!==resolve(destination))copyFileSync(process.argv[1].endsWith('.mjs')?process.argv[1]:join(p.root,'runtime/manager.mjs'),destination);
 if(!existsSync(join(root,'control-token')))writeFileSync(join(root,'control-token'),randomBytes(32).toString('hex'),{flag:'wx',mode:0o600});
 writeFileSync(join(root,'weava.cmd'),'@echo off\r\nsetlocal\r\n"'+existing.node.replaceAll('%','%%')+'" "%~dp0manager\\manager.mjs" --installation "%~dp0." %*\r\nexit /b %ERRORLEVEL%\r\n');
 output({installed:true,root,programId:p.manifest.id});
});
const programs=cli.command('program');
programs.command('add').requiredOption('--from <path>').option('--default').option('--repair-links').action(opts=>{if(opts.repairLinks)repairProgramLinks(resolve(opts.from),join(home(),'checks/link-repairs'));const p=verify(opts.from);updateInstallation(home(),i=>{i.programs[p.manifest.id]={root:p.root,manifestHash:p.manifestHash};if(opts.default)i.defaultProgramId=p.manifest.id;});output({id:p.manifest.id,root:p.root,reused:true});});
programs.command('list').action(()=>output(loadInstallation(home()).programs));
programs.command('verify [id]').action(id=>{const p=programFor(loadInstallation(home()),id);output({id:p.manifest.id,verified:true});});
const sites=cli.command('site');
sites.command('create <id>').option('--path <path>').option('--port <number>','端口','4322').option('--template <name>','blog/company/portfolio/documentation/resource/blank/demo','blog').option('--theme <name>','weava/newsletter','weava').option('--program <id>').option('--domain <url>').action(async(id,opts)=>output(await createSite(home(),id,{...opts,port:Number(opts.port)})));
sites.command('adopt [id]').requiredOption('--path <path>').option('--program <id>').action(async(id,opts)=>output(await transition(id,opts.program,opts.path)));
sites.command('update [id]').requiredOption('--to <program-id>').option('--build <id>').option('--sites <ids>').option('--check','只演练和比较 SEO，保留网站原运行状态').option('--accept-seo <fingerprint>','接受已核对的精确 SEO 差异').action(async(id,opts)=>{if(id&&opts.sites)throw new Error('网站编号和 --sites 不能同时使用。');if(opts.sites&&opts.acceptSeo)throw new Error('SEO 差异确认必须逐站执行。');const ids=opts.sites?opts.sites.split(','):[id??cli.opts().site??'demo'];const results=[];for(const name of ids)results.push(await transition(name,opts.to,undefined,opts.build,{check:opts.check,acceptSeo:opts.acceptSeo}));output(results.length===1?results[0]:results);});
sites.command('list').action(()=>output(loadInstallation(home()).sites));
for(const action of ['status','inspect'])sites.command(action+' [id]').action(async id=>{
 const s=pick(id,false),d=deployment(s.root);let runtime:any=null;try{runtime=(await requestHost(home(),'status')).sites.find((r:any)=>r.id===s.id)??null;}catch{}
 output({id:s.id,root:s.root,configuration:descriptor(s.root),deployment:d,database:inspect(s.root),runtime});
});
sites.command('start [id]').option('--foreground').option('--port <number>').option('--autostart').action(async(id,opts)=>{if(opts.autostart){const s=pick(id,false);updateInstallation(home(),i=>{i.sites[s.id].autostart=true;});}await start(id,!!opts.foreground,opts.port?Number(opts.port):undefined);});
sites.command('stop [id]').option('--timeout <seconds>','等待任务完成的时间','300').action(async(id,opts)=>{const s=pick(id,false);output(await requestHost(home(),'stop',{id:s.id,timeoutMs:Number(opts.timeout)*1000}));});
sites.command('restart [id]').action(async id=>{const s=pick(id,false);await host();output(await requestHost(home(),'restart',{id:s.id}));});
sites.command('recover [id]').option('--restore-data').action(async(id,opts)=>{
 const i=loadInstallation(home()),r=siteRoot(i,id??cli.opts().site??'demo');if(existsSync(join(r,'.weava-preparation.json'))){output(await recoverProtected(home(),r,!!opts.restoreData));return;}
 const install=loadInstallation(home()),root=siteRoot(install,id??cli.opts().site??'demo'),path=join(root,'.weava-update.json'),journal=json(path),siteId=json(join(root,'site.json')).id??basename(root);
 const s={install,root,id:siteId};
 if(journal.status==='complete'&&!opts.restoreData)throw new Error('已完成升级；回退数据需要 --restore-data。');
 await requestHost(home(),'stop',{id:s.id}).catch(()=>{});
 const p=programFor(install,journal.programId);await (await import('./operations.ts')).withLease(home(),s.root,p,async()=>{restoreCheckpoint(journal.point,s.root);atomic(path,{...journal,status:'rolled-back'});});output({recovered:true,point:journal.point});
});
sites.command('build [id]').option('--program <id>').option('--apply').action(async(id,opts)=>{
 const s=pick(id),p=opts.program?programFor(s.install,opts.program):s.p;
 const result=await run(p,s.install.node,'site-build.mjs',[s.root,p.root]);
 if(opts.apply)output({...result,applied:await transition(s.id,p.manifest.id,undefined,result.id)});
 else output({...result,applied:false,programId:p.manifest.id});
});
sites.command('features [id]').option('--set <list>').action(async(id,opts)=>{
 const s=pick(id,opts.set!==undefined);if(opts.set===undefined)return output({features:descriptor(s.root).features});
 const features=validateFeatures(opts.set?opts.set.split(','):[]);let running=false;
 try{running=(await requestHost(home(),'status')).sites.some((r:any)=>r.id===s.id&&r.status==='running');if(running)await requestHost(home(),'stop',{id:s.id});}catch(e){if(running)throw e;}
 const before=descriptor(s.root);try{await applyFeatures(home(),s.root,s.p,features);if(running){await requestHost(home(),'start',{id:s.id});await checkHttp(s.root);}}catch(e){atomic(join(s.root,'site.json'),before);if(running)await requestHost(home(),'start',{id:s.id}).catch(()=>{});throw e;}
 output({features});
});
sites.command('logs [id]').action(id=>{const s=pick(id,false),file=join(home(),'logs',s.id+'.log');process.stdout.write(existsSync(file)?readFileSync(file).subarray(-20000):'');});
sites.command('deployment-info [id]').option('--proxy-origin <url>','登记现有代理入口，升级时实际验证维护响应').action((id,opts)=>{const s=pick(id,false),config=descriptor(s.root);if(opts.proxyOrigin){const url=new URL(opts.proxyOrigin);if(!['http:','https:'].includes(url.protocol)||url.pathname!=='/'||url.search||url.hash||url.username||url.password)throw new Error('代理入口必须是无路径和凭据的 HTTP(S) 网址。');updateInstallation(home(),i=>{i.sites[s.id].proxyOrigin=url.origin;});}output({id:s.id,origin:'http://127.0.0.1:'+config.port,proxyOrigin:loadInstallation(home()).sites[s.id]?.proxyOrigin??null,start:[join(home(),'weava.cmd'),'--site',s.id,'site','start'],...prepareProxy(home(),s.id,config.port)});});
const hosts=cli.command('host');
hosts.command('run').action(()=>serveHost(home()));
hosts.command('start').action(async()=>output(await host()));
hosts.command('status').action(async()=>output(await requestHost(home(),'status')));
hosts.command('stop').action(async()=>output(await requestHost(home(),'shutdown')));
hosts.command('autostart').requiredOption('--account <name>').option('--configure').option('--output <file>').action(opts=>{
 const install=loadInstallation(home()),name='Weava-'+install.id;
 const script="[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false); $ErrorActionPreference=\'Stop\'; $action=New-ScheduledTaskAction -Execute "+ps(install.node)+" -Argument "+ps('"'+join(home(),'manager/manager.mjs')+'" --installation "'+home()+'" host run')+"; $trigger=New-ScheduledTaskTrigger -AtStartup; $principal=New-ScheduledTaskPrincipal -UserId "+ps(opts.account)+" -LogonType S4U -RunLevel Limited; $settings=New-ScheduledTaskSettingsSet -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) -MultipleInstances IgnoreNew; Register-ScheduledTask -TaskName "+ps(name)+" -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Force | Out-Null; Get-ScheduledTask -TaskName "+ps(name)+" | Select-Object TaskName,State | ConvertTo-Json -Compress";
 if(opts.output)writeFileSync(resolve(opts.output),script+'\n');
 if(!opts.configure)return output({name,account:opts.account,script,message:'使用 --configure 创建开机任务；需要有权为该普通账户登记任务。'});
 const r=spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',script],{windowsHide:true,encoding:'utf8'});if(r.status)throw new Error(r.stderr);output({configured:true,task:JSON.parse(r.stdout)});
});
function ps(s:string){return "'"+s.replaceAll("'","''")+"'";}
cli.command('start').option('--port <port>').action(opts=>start(cli.opts().site,true,opts.port?Number(opts.port):undefined));
async function main(){
 const argv=process.argv.slice(2),commands=['install','program','site','host','start'];
 let first:string|undefined;for(let i=0;i<argv.length;i++){if(['--installation','--site','--url'].includes(argv[i])){i++;continue;}if(!argv[i].startsWith('-')){first=argv[i];break;}}
 if(first&&!commands.includes(first)){
  const siteIndex=argv.indexOf('--site'),installIndex=argv.indexOf('--installation');
  const install=loadInstallation(installationRoot(installIndex>=0?argv[installIndex+1]:undefined)),root=siteRoot(install,siteIndex>=0?argv[siteIndex+1]:'demo'),p=selected(install,root);
  const args=argv.filter((_,i)=>i!==installIndex&&i!==installIndex+1||installIndex<0);
  if(siteIndex>=0){const i=args.indexOf('--site');args[i+1]=root;}else args.unshift('--site',root);
  const child=spawn(install.node,[join(p.root,'runtime/weava.mjs'),...args],{cwd:p.root,windowsHide:true,stdio:'inherit',env:{...process.env,WEAVA_DELEGATED:'1',WEAVA_INSTALLATION:installationRoot(installIndex>=0?argv[installIndex+1]:undefined),WEAVA_PROGRAM_ROOT:p.root,WEAVA_FRAMEWORK:p.root,WEAVA_DATABASE_MODE:'open'}});
  child.once('exit',code=>process.exitCode=code??1);return;
 }
 await cli.parseAsync();
}
main().catch(error=>{console.error(cli.opts().human?'操作失败：'+error.message:JSON.stringify({error:error.message,...(error.details?{details:error.details}:{})}));process.exitCode=1;});

