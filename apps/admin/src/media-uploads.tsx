import { mediaKind } from '@weava/contracts';
import { useSyncExternalStore } from 'react';
import type { MediaRecord } from './media-models.ts';
import { uploadFile } from './upload-file.ts';

export interface MediaUpload {
  id: number;
  name: string;
  groupId?: string;
  preview?: string;
  status: 'queued' | 'uploading' | 'complete' | 'failed';
  message: string;
  row?: MediaRecord;
}
let sequence = 0, active = 0;
let uploads: MediaUpload[] = [];
const files = new Map<number, File>(), listeners = new Set<() => void>();
const controllers=new Map<number,AbortController>();
let generation=0,paused=false,lifecycle=false;
const notify = () => listeners.forEach(listener => listener());
const change = (id: number, update: Partial<MediaUpload>) => {
  uploads = uploads.map(item => item.id === id ? { ...item, ...update } : item);
  notify();
};
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
export const mediaUploadSnapshot = () => uploads;
export const useMediaUploads = () => useSyncExternalStore(subscribe, mediaUploadSnapshot);
function installLifecycle(){
  if(lifecycle||typeof window==='undefined')return;
  lifecycle=true;
  // Library uploads survive panel navigation, but their File objects cannot survive a page reload.
  window.addEventListener('beforeunload',event=>{
    if(uploads.some(item=>item.status!=='complete')){event.preventDefault();event.returnValue='文件尚未上传完成。';}
  });
  window.addEventListener('weava-session-ended',()=>{
    generation++;paused=false;
    for(const controller of controllers.values())controller.abort();
    controllers.clear();
    for(const item of uploads)if(item.preview)URL.revokeObjectURL(item.preview);
    files.clear();uploads=[];notify();
  });
  window.addEventListener('weava-session-expired',()=>{paused=true;for(const controller of controllers.values())controller.abort();});
  window.addEventListener('weava-session-restored',()=>{paused=false;pump();});
}

function pump() {
  while (!paused&&active < 2) {
    const item = uploads.find(item => item.status === 'queued');
    if (!item) return;
    active++;
    const started=generation,controller=new AbortController();controllers.set(item.id,controller);
    change(item.id, { status: 'uploading', message: '上传 0%' });
    void uploadFile(files.get(item.id)!, message => {if(started===generation)change(item.id,{message});}, { groupId: item.groupId,signal:controller.signal })
      .then(row => {
        if(started!==generation)return;
        files.delete(item.id);
        if (item.preview) URL.revokeObjectURL(item.preview);
        change(item.id, { status: 'complete', message: '已上传', row, preview: undefined });
      }, (error: Error) => {if(started===generation)change(item.id, { status: 'failed', message: paused?'登录已失效，请重新登录后重试上传。':error.message });})
      .finally(() => { controllers.delete(item.id);active--; pump(); });
  }
}
export function startMediaUploads(selected: File[], groupId?: string) {
  installLifecycle();
  // Keep recent completions available until the refreshed library contains them.
  for (const item of uploads.filter(item => item.status === 'complete').slice(0, -12)) dismissMediaUpload(item.id);
  for (const file of selected) {
    const id = ++sequence;
    files.set(id, file);
    const preview = mediaKind(file.name) === 'image' && typeof URL.createObjectURL === 'function' ? URL.createObjectURL(file) : undefined;
    uploads = [...uploads, { id, name: file.name, groupId, preview, status: 'queued', message: '等待上传' }];
  }
  notify(); pump();
}
export function retryMediaUpload(id: number) {
  if (!uploads.some(item => item.id === id && item.status === 'failed')) return;
  change(id, { status: 'queued', message: '等待上传' }); pump();
}
export function dismissMediaUpload(id: number) {
  const item = uploads.find(item => item.id === id);
  if (!item || ['queued', 'uploading'].includes(item.status)) return;
  if (item.preview) URL.revokeObjectURL(item.preview);
  files.delete(id); uploads = uploads.filter(item => item.id !== id); notify();
}
export function MediaUploadList({ items, select }: { items: MediaUpload[]; select?: (row: MediaRecord) => void }) {
  if (!items.length) return null;
  return <div className="media-upload-list" aria-label="文件上传">
    {items.map(item => <div className="media-upload-item" key={item.id}>
      {(item.preview || item.row && mediaKind(item.row.value.url) === 'image') && <img src={item.preview ?? item.row!.value.url} alt="" />}
      <div>{item.status === 'complete' && select
        ? <button className="media-upload-select" onClick={() => select(item.row!)}>{item.name}</button>
        : <strong>{item.name}</strong>}<span role={item.status === 'failed' ? 'alert' : 'status'}>{item.message}</span></div>
      {item.status === 'failed' && <><button onClick={() => retryMediaUpload(item.id)}>重试上传</button><button onClick={() => dismissMediaUpload(item.id)}>取消此上传</button></>}
    </div>)}
  </div>;
}
export function MediaUploadFeedback() {
  const items = useMediaUploads().filter(item => item.status !== 'complete');
  return items.length ? <aside className="media-upload-feedback" aria-label="后台上传"><MediaUploadList items={items} /></aside> : null;
}
