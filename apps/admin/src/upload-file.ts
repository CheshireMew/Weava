import { api,waitJob } from './api.ts';
import { adminApi } from '@weava/contracts/api';
/** The browser sends bounded Blob slices; neither FileReader nor a base64 copy is needed. */
export async function uploadFile(file:File,onProgress:(message:string)=>void,onJob:(job:any)=>void=()=>{}){
  const key='weava-upload:'+file.name+':'+file.size+':'+file.lastModified;
  let id='';try{id=sessionStorage.getItem(key)??'';}catch{}
  let state;
  if(id){try{state=await api(`media/uploads/${encodeURIComponent(id)}`);if(state.size!==file.size||Date.parse(state.expiresAt)<=Date.now())state=undefined;}catch{state=undefined;}}
  if(!state){state=await api('media/uploads',{name:file.name,size:file.size});try{sessionStorage.setItem(key,state.id);}catch{}}
  while(state.offset<file.size){
    const offset=state.offset,end=Math.min(file.size,offset+state.chunkBytes),id:string=state.id;
    try{state=await new Promise<any>((resolve,reject)=>{
      const request=new XMLHttpRequest();request.open('POST',`/api/admin/v1/media/uploads/${encodeURIComponent(id)}?offset=${offset}`);request.setRequestHeader('Content-Type','application/octet-stream');request.timeout=120000;
      request.upload.onprogress=event=>onProgress(`上传 ${Math.round((offset+event.loaded)/file.size*100)}%`);
      request.onerror=()=>reject(new Error('上传连接中断，请重新选择同一文件继续。'));request.ontimeout=()=>reject(new Error('上传超时，请重新选择同一文件继续。'));
      request.onload=()=>{try{const value=JSON.parse(request.responseText);if(request.status>=400){if(request.status===401)window.dispatchEvent(new Event('weava-session-expired'));reject(new Error(value.error??'上传失败。'));}else resolve(adminApi.uploadStatus.response.parse(value));}catch{reject(new Error('上传响应无效，请重试。'));}};
      request.send(file.slice(offset,end));
    });}catch(error){
      const current:Awaited<ReturnType<typeof readStatus>>|null=await readStatus(id).catch(()=>null);
      if(current&&current.offset>offset){state=current;continue;}throw error;
    }
  }
  onProgress('正在处理文件…');const complete=await waitJob(await api('media',{uploadId:state.id}),job=>{onProgress(job.message);onJob(job);});
  try{sessionStorage.removeItem(key);}catch{}return complete.result;
}
const readStatus=(id:string)=>api(`media/uploads/${encodeURIComponent(id)}`);
