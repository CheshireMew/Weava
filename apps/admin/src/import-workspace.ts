import {useSyncExternalStore} from 'react';
import {adminApi} from '@weava/contracts/api';
import {importFileBytes,isMarkdownImportFile,markdownImportFileBytes} from '../../../packages/contracts/src/import-limits.ts';
import {startTask,awaitTask} from './background-tasks.ts';

const key='weava-import-workspace-auto';
type Source={id:string;name:string;format:string};
interface Workspace {
  source?:Source;
  phase?:'upload'|'preview'|'commit'|'complete'|'failed';
  progress?:string;
  previewId?:string;
  commitId?:string;
  requestKey?:string;
  error?:any;
}
let state:Workspace={};
let active:object|undefined;
try{
  const saved=JSON.parse(sessionStorage.getItem(key)??'null');
  if(saved?.source)state=saved;
}catch{}
const listeners=new Set<()=>void>();
const snapshot=()=>state;
const subscribe=(listener:()=>void)=>{listeners.add(listener);return()=>{listeners.delete(listener);};};
function update(value:Partial<Workspace>){state={...state,...value};try{sessionStorage.setItem(key,JSON.stringify({...state,error:undefined,progress:undefined}));}catch{}for(const listener of listeners)listener();}
export const useImportWorkspace=()=>useSyncExternalStore(subscribe,snapshot,snapshot);
function stageFile(file:File,operation:object):Promise<Source>{
  return new Promise((resolve,reject)=>{
      const request=new XMLHttpRequest();request.open('POST','/api/admin/v1/import/file?'+new URLSearchParams({name:file.name}));request.timeout=300000;request.setRequestHeader('Content-Type','application/octet-stream');
      request.upload.onprogress=event=>{if(active===operation)update({progress:event.loaded>=file.size?'正在保存导入文件…':`正在上传 ${Math.round(event.loaded/file.size*100)}%`});};
      request.onerror=()=>reject(new Error('上传连接中断，请重新选择文件。'));request.ontimeout=()=>reject(new Error('上传超时，请重新选择文件。'));
      request.onload=()=>{try{const value=JSON.parse(request.responseText);if(request.status>=400){if(request.status===401)window.dispatchEvent(new Event('weava-session-expired'));reject(Object.assign(new Error(value.error??'上传失败。'),{details:value.details}));}else resolve(adminApi.stageImportSource.response.parse(value));}catch{reject(new Error('上传响应无效，请重试。'));}};request.send(file);
  });
}

async function processImport(operation:object,source:Source){
  const base={mode:'create',...(source.format==='wxr'?{downloadMedia:true,comments:true}:{})} as const;
  const submit=(kind:'preview'|'commit',options:object)=>startTask('import/source',
    {sourceId:source.id,options:{...base,...options}},
    {scope:'import',label:kind==='preview'?'检查导入文件':'导入内容'},state.requestKey);
  if(!state.commitId){
    if(!state.previewId){
      const preview=await submit('preview',{dryRun:true});
      if(active!==operation)return;
      update({previewId:preview.id});
    }
    const checked=await awaitTask(state.previewId!);
    if(active!==operation)return;
    const report=checked.result;
    if(!report?.dryRun || (source.format==='markdown'&&!report.markdownReview) || (source.format==='wxr'&&!report.review))
      throw new Error('未能检查导入文件，请重新选择文件。');
    if(state.phase!=='commit')update({phase:'commit',requestKey:crypto.randomUUID()});
    const commit=await submit('commit',{dryRun:false,...(source.format==='markdown'?{markdownReview:report.markdownReview}:source.format==='wxr'?{review:report.review}:{})});
    if(active!==operation)return;
    update({commitId:commit.id});
  }
  await awaitTask(state.commitId!);
  if(active===operation)update({phase:'complete'});
}

async function run(work:(operation:object)=>Promise<void>){
  const operation=active={};
  try{await work(operation);}
  catch(error){if(active===operation)update({phase:'failed',progress:'',error});}
  finally{if(active===operation)active=undefined;}
}

export function resumeImport(){
  const {source,phase}=state;
  if(!active&&source&&(phase==='preview'||phase==='commit'))void run(operation=>processImport(operation,source));
}

export function importFile(file:File){
  if(active)return;
  update({source:undefined,previewId:undefined,commitId:undefined,requestKey:undefined,phase:undefined,progress:'',error:undefined});
  void run(async operation=>{
    const markdown=isMarkdownImportFile(file.name);
    if(!markdown&&!/\.(json|xml)$/i.test(file.name))throw new Error('请选择 Weava JSON、WordPress XML 或 Markdown 文件。');
    if(!file.size)throw new Error('导入文件为空。');
    const limit=markdown?markdownImportFileBytes:importFileBytes;
    if(file.size>limit)throw new Error(`文件大小需要在 ${limit/1048576} MB 以内。`);
    update({phase:'upload',progress:'正在上传…'});
    const source=await stageFile(file,operation);
    if(active!==operation)return;
    update({source,phase:'preview',progress:'',requestKey:crypto.randomUUID()});
    await processImport(operation,source);
  });
}
if(typeof window!=='undefined')window.addEventListener('weava-session-ended',()=>{
  active=undefined;
  update({source:undefined,phase:undefined,progress:undefined,previewId:undefined,commitId:undefined,requestKey:undefined,error:undefined});
});
