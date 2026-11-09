import {useSyncExternalStore} from 'react';
import {adminApi} from '@weava/contracts/api';
import {importFileBytes} from '../../../packages/contracts/src/import-limits.ts';
import {api} from './api.ts';
import {startTask} from './background-tasks.ts';
const key='weava-import-workspace';
const defaults={settings:false,media:true,comments:true,merge:false,mediaDirectory:''};
interface Workspace {source?:{id:string;name:string;format:string};options:typeof defaults;uploading?:boolean;progress?:string;submitting?:boolean;taskId?:string;reportId?:string;kind?:'preview'|'commit';revisions?:Record<string,number>;requestKey?:string;error?:any}
let state:Workspace={options:defaults};
try{const saved=JSON.parse(sessionStorage.getItem(key)??'null');if(saved?.options)state={...saved,uploading:false,submitting:false,error:undefined};}catch{}
const listeners=new Set<()=>void>();
const snapshot=()=>state;
const subscribe=(listener:()=>void)=>{listeners.add(listener);return()=>{listeners.delete(listener);};};
function update(value:Partial<Workspace>){state={...state,...value};try{sessionStorage.setItem(key,JSON.stringify({...state,error:undefined,progress:undefined}));}catch{}for(const listener of listeners)listener();}
export const useImportWorkspace=()=>useSyncExternalStore(subscribe,snapshot,snapshot);
export function changeImportOption(name:keyof typeof defaults,value:any){update({options:{...state.options,[name]:value},reportId:undefined,taskId:undefined,error:undefined,requestKey:undefined});}
export async function uploadImport(file:File){
  if(state.uploading||state.submitting)return;
  if(file.size<1||file.size>importFileBytes){update({error:new Error('文件大小需要在 128 MB 以内。')});return;}
  if(!/\.(json|xml)$/i.test(file.name)){update({error:new Error('请选择 Weava JSON 或 WordPress XML 文件。')});return;}
  update({source:undefined,reportId:undefined,taskId:undefined,error:undefined,uploading:true,progress:'上传 0%',requestKey:undefined});
  try{
    const source=await new Promise<any>((resolve,reject)=>{
      const request=new XMLHttpRequest();request.open('POST','/api/admin/v1/import/file?'+new URLSearchParams({name:file.name}));request.timeout=300000;request.setRequestHeader('Content-Type','application/octet-stream');
      request.upload.onprogress=event=>update({progress:event.loaded>=file.size?'正在保存导入文件…':`上传 ${Math.round(event.loaded/file.size*100)}%`});
      request.onerror=()=>reject(new Error('上传连接中断，请重新选择文件。'));request.ontimeout=()=>reject(new Error('上传超时，请重新选择文件。'));
      request.onload=()=>{try{const value=JSON.parse(request.responseText);if(request.status>=400){if(request.status===401)window.dispatchEvent(new Event('weava-session-expired'));reject(Object.assign(new Error(value.error??'上传失败。'),{details:value.details}));}else resolve(adminApi.stageImportSource.response.parse(value));}catch{reject(new Error('上传响应无效，请重试。'));}};request.send(file);
    });update({source,progress:''});
  }catch(error){update({error});}finally{update({uploading:false,progress:''});}
}
export async function runImport(kind:'preview'|'commit',report?:any){
  if(!state.source||state.uploading||state.submitting)return;
  update({submitting:true,error:undefined,requestKey:state.requestKey??crypto.randomUUID()});
  try{
    const {settings,media,comments,merge,mediaDirectory}=state.options;
    const revisions=kind==='preview'?(merge?await api('import/revisions'):{}):state.revisions;
    const options={settings,comments,mode:merge?'merge' as const:'create' as const,downloadMedia:media&&!mediaDirectory.trim(),mediaDirectory:media&&mediaDirectory.trim()?mediaDirectory.trim():undefined,revisions,dryRun:kind==='preview',...(kind==='commit'&&report?.review?{review:report.review}:{})};
    const job=await startTask('import/source',{sourceId:state.source.id,options},{scope:'import',label:kind==='preview'?'导入预检':'导入内容',context:{kind,sourceId:state.source.id}},state.requestKey);
    update({taskId:job.id,reportId:kind==='preview'?undefined:state.reportId,kind,revisions,requestKey:undefined});
  }catch(error){update({error});}finally{update({submitting:false});}
}
export function acceptImportReport(id:string){if(state.reportId!==id)update({reportId:id});}
if(typeof window!=='undefined')window.addEventListener('weava-session-ended',()=>update({source:undefined,options:defaults,taskId:undefined,reportId:undefined,kind:undefined,revisions:undefined,requestKey:undefined,error:undefined,uploading:false,submitting:false,progress:''}));
