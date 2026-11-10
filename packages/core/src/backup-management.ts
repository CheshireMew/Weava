import {existsSync,readdirSync,lstatSync,readFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {WeavaError,z,zonedInstants} from '@weava/contracts';
import type {Site} from './site.ts';
import {digest} from '../../runtime-common/src/identity.ts';
import {dayInZone,shiftDay} from './analytics-dates.ts';
import {pathWithin} from './paths.ts';
import type {JobRunner} from './job-runner.ts';
export const backupPolicySchema=z.object({enabled:z.boolean(),path:z.string().min(1),time:z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/)});
export function backupPolicy(site:Pick<Site,'store'|'settings'>){
  const row=site.store.get('backup-policy','site');
  return {id:'site',revision:row?.revision??null,updatedAt:row?.updatedAt??'',value:(row?.value as z.infer<typeof backupPolicySchema>|undefined)??{enabled:false,path:process.env.WEAVA_BACKUP_ROOT??'D:/Tools/weava/backups',time:'03:00'},timezone:site.settings().value.timezone};
}
export function saveBackupPolicy(site:Site,value:z.infer<typeof backupPolicySchema>,revision:number|null){
  const parsed=backupPolicySchema.parse(value),path=resolve(parsed.path);
  if(pathWithin(site.root,path))throw new WeavaError('备份目录必须位于站点之外。');
  site.store.put('backup-policy','site',{...parsed,path},revision,'保存备份计划');return backupPolicy(site);
}
export function queueAutomaticBackup(site:Site,jobs:Pick<JobRunner,'enqueue'>,clock=Date.now()){
  const policy=backupPolicy(site);if(!policy.value.enabled||site.activeJobs().some(job=>job.operation==='backup'))return null;
  const today=dayInZone(new Date(clock),policy.timezone);
  function resolveDay(day:string){const wall=Date.parse(day+'T'+policy.value.time+':00Z');for(let minute=0;minute<181;minute++){const matches=zonedInstants(new Date(wall+minute*60000).toISOString().slice(0,16),policy.timezone);if(matches.length)return matches[0];}throw new WeavaError('无法确定备份执行时间。');}
  const todayDue=resolveDay(today),due=Date.parse(todayDue)<=clock?todayDue:resolveDay(shiftDay(today,-1));
  if(policy.updatedAt&&Date.parse(due)<Date.parse(policy.updatedAt))return null;
  const key='automatic-backup:'+policy.revision+':'+due;
  if(site.store.raw.prepare('SELECT id FROM jobs WHERE idempotency=?').get(key))return null;
  return jobs.enqueue('backup',{path:policy.value.path,label:'自动备份',scheduledAt:due},key);
}
export function recordBackupVerification(site:Site,path:string,error=''){
  const id=digest(resolve(path));site.store.put('backup-check',id,{path:resolve(path),checkedAt:new Date().toISOString(),error},site.store.get('backup-check',id)?.revision??null,'检查备份');
}
export function backupInventory(site:Site,inputPath?:string){
  const path=resolve(inputPath??backupPolicy(site).value.path),checks=new Map(site.store.list('backup-check').map(row=>[row.value.path,row.value]));
  const items:{id:string;path:string;createdAt:string;label:string;files:number;verifiedAt:string|null;error:string}[]=[];
  if(existsSync(path))for(const item of readdirSync(path,{withFileTypes:true})){const folder=join(path,item.name);if(!item.isDirectory()||lstatSync(folder).isSymbolicLink()||!existsSync(join(folder,'manifest.json')))continue;
    try{const manifest=JSON.parse(readFileSync(join(folder,'manifest.json'),'utf8'));if(manifest.version!==1||!Array.isArray(manifest.files))throw new Error('备份清单无效。');const check=checks.get(folder);items.push({id:manifest.id??item.name,path:folder,createdAt:manifest.createdAt??'',label:manifest.label??'',files:manifest.files.length,verifiedAt:check?.checkedAt??null,error:check?.error??''});}
    catch(error:any){items.push({id:item.name,path:folder,createdAt:'',label:'无效备份',files:0,verifiedAt:null,error:error.message});}
  }
  return {path,items:items.sort((a,b)=>b.createdAt.localeCompare(a.createdAt)),jobs:site.jobs().filter(job=>job.operation==='backup'||job.operation==='verify').slice(0,20)};
}
