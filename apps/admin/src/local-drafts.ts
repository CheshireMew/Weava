import type { Entry, Revision } from '@weava/contracts';
import { sameEditableValue } from './edit-session.ts';

interface DraftStorage { getItem(key: string): string | null; setItem(key: string, value: string): void; removeItem(key: string): void; readonly length?:number; key?(index:number):string|null }
export interface LocalDraft { id: string; sessionId?:string; capturedAt: number; updatedAt: number; pending?: boolean; record: Revision<Entry> }
interface DraftArchive { version: 2; entries: Record<string, LocalDraft[]> }
const key = 'weava-drafts:v2', byteLimit = 3 * 1024 * 1024;
const sessionPrefix='weava-draft-session:v1:';
const sessionKey=(id:string,sessionId:string)=>sessionPrefix+encodeURIComponent(sessionId)+':'+encodeURIComponent(id);
const sessionKeys=(storage:DraftStorage)=>Array.from({length:storage.length??0},(_,index)=>storage.key?.(index)).filter((key):key is string=>!!key&&key.startsWith(sessionPrefix));
export function latestPendingDraft(copies: LocalDraft[]): LocalDraft[] {
  const sessions=new Map<string,LocalDraft>();
  for(const copy of copies.filter(copy=>copy.pending!==false).sort((a,b)=>b.updatedAt-a.updatedAt))if(!sessions.has(copy.sessionId??'legacy'))sessions.set(copy.sessionId??'legacy',copy);
  return [...sessions.values()];
}
export function matchesDraft(copy: Pick<LocalDraft, 'record'>, record: Revision<Entry>) {
  // Saving changes metadata; recovery is needed only when authored content differs.
  const local=copy.record.value;
  return sameEditableValue({...local, updatedAt: undefined}, {...record.value,createdAt:local.createdAt===undefined?undefined:record.value.createdAt,updatedAt: undefined});
}
const read = (storage: DraftStorage): DraftArchive => {
  const raw = storage.getItem(key);
  if (!raw) return { version: 2, entries: Object.create(null) };
  const archive = JSON.parse(raw);
  if (archive.version !== 2 || !archive.entries || typeof archive.entries !== 'object' || Array.isArray(archive.entries)) throw new Error('浏览器草稿格式无法读取，请先保留浏览器数据。');
  return { version: 2, entries: Object.assign(Object.create(null), archive.entries) };
};
function store(archive: DraftArchive, storage: DraftStorage, preserve: string) {
  for (const id of Object.keys(archive.entries)) {
    archive.entries[id] = latestPendingDraft(archive.entries[id]);
    if (!archive.entries[id].length) delete archive.entries[id];
  }
  if(JSON.stringify(archive.entries[preserve]??[]).length*2>byteLimit)throw new Error('这份草稿过大，浏览器无法保留副本；请保持页面打开并保存到网站。');
  if(Object.keys(archive.entries).length>40||JSON.stringify(archive).length*2>byteLimit)throw new Error('本地未保存草稿已达容量上限，请先保存或明确放弃其它草稿。');
  try { storage.setItem(key, JSON.stringify(archive)); }
  catch { throw new Error('浏览器无法保存本地草稿，请保持页面打开并保存到网站。'); }
}
export function localDraftIds(storage:DraftStorage=localStorage){
  const ids=new Set(Object.keys(read(storage).entries));
  for(let index=0;index<(storage.length??0);index++){
    const name=storage.key?.(index);if(!name)continue;
    if(name.startsWith(sessionPrefix)){try{ids.add(JSON.parse(storage.getItem(name)!).record.id);}catch{}}
    else if(name.startsWith('weava-draft:'))ids.add(name.slice('weava-draft:'.length));
  }
  return [...ids];
}
export function localDrafts(id: string, storage: DraftStorage = localStorage): LocalDraft[] {
  const archive = read(storage), copies = latestPendingDraft([...(archive.entries[id] ?? []),...sessionKeys(storage).map(name=>JSON.parse(storage.getItem(name)!)).filter(copy=>copy.record?.id===id)]);
  const legacy = storage.getItem('weava-draft:' + id);
  if (!copies.length && legacy) {
    const record = JSON.parse(legacy);
    if (record?.id === id && record?.value) return [{ id: 'legacy', capturedAt: 0, updatedAt: 0, record }];
  }
  return copies;
}
export function saveLocalDraft(record: Revision<Entry>, storage: DraftStorage = localStorage, clock = Date.now(),sessionId='legacy') {
  if(sessionId!=='legacy'){
    const name=sessionKey(record.id,sessionId),value=JSON.stringify({id:record.id,sessionId,capturedAt:clock,updatedAt:clock,pending:true,record});
    if(value.length*2>byteLimit)throw new Error('这份草稿过大，浏览器无法保留副本；请保持页面打开并保存到网站。');
    const ids=new Set([...localDraftIds(storage),record.id]);
    const total=value.length*2+(storage.getItem(key)?.length??0)*2+sessionKeys(storage).filter(key=>key!==name).reduce((size,key)=>size+(storage.getItem(key)?.length??0)*2,0);
    if(ids.size>40||total>byteLimit)throw new Error('本地未保存草稿已达容量上限，请先保存或明确放弃其它草稿。');
    storage.setItem(name,value);return;
  }
  const archive = read(storage);
  archive.entries[record.id] = [{ id: record.id, capturedAt: clock, updatedAt: clock, pending: true, record: structuredClone(record) }];
  store(archive, storage, record.id);
  // Migration completes only after the replacement has been written successfully.
  storage.removeItem('weava-draft:' + record.id);
}
export function acknowledgeLocalDrafts(record: Revision<Entry>, storage: DraftStorage = localStorage,sessionId='legacy') {
  const name=sessionKey(record.id,sessionId),copy=storage.getItem(name);
  if(copy&&matchesDraft(JSON.parse(copy),record))storage.removeItem(name);
  const archive = read(storage);
  if (archive.entries[record.id]) archive.entries[record.id] = archive.entries[record.id].filter(copy => (copy.sessionId??'legacy')!==sessionId||!matchesDraft(copy, record));
  store(archive, storage, record.id);
  const legacy = storage.getItem('weava-draft:' + record.id);
  if (sessionId==='legacy'&&legacy && matchesDraft({record: JSON.parse(legacy)}, record)) storage.removeItem('weava-draft:' + record.id);
}
export function forgetLocalDrafts(id: string, storage: DraftStorage = localStorage) {
  const archive = read(storage);
  delete archive.entries[id];
  storage.setItem(key, JSON.stringify(archive));
  storage.removeItem('weava-draft:' + id);
}
