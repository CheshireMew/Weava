import {cloneBlocks,entrySchema,WeavaError,type PublishOptions} from '@weava/contracts';
import type {Site} from './site.ts';
import {now,uuid} from '../../runtime-common/src/identity.ts';

function currentEntry(site: Site, id: string, revision: number) {
  const row = site.store.get('entry', id);
  if (!row) throw new WeavaError('内容不存在。', 404);
  if (row.revision !== revision) throw new WeavaError('内容已变化，请刷新列表后重试。', 409);
  return row;
}

export function duplicateContent(site: Site, id: string, revision: number) {
  return site.store.raw.transaction(() => {
    const original = currentEntry(site, id, revision).value;
    const nextId = uuid();
    const prefix = original.kind === 'page' ? '/' : site.store.get('type', original.type)?.value.pathPrefix;
    if (!prefix) throw new WeavaError('内容类型不存在。');
    const value = entrySchema.parse({
      ...structuredClone(original), id: nextId,
      title: original.title.slice(0, 296) + '（副本）', path: prefix + nextId + '/',
      status: 'draft', createdAt: now(), updatedAt: undefined, publishedAt: undefined,
      source: undefined,
      seo: original.seo ? { ...original.seo, canonical: undefined } : undefined,
      blocks: cloneBlocks(original.blocks),
    });
    return site.saveEntry(value, null);
  }).immediate();
}

export function deleteContent(site: Site, id: string, revision: number, reviewed?: PublishOptions | null) {
  return site.store.raw.transaction(() => {
    const original = structuredClone(currentEntry(site, id, revision).value);
    if (site.activeJobs().some(job => job.operation === 'publish'))
      throw new WeavaError('发布任务正在执行，请等待完成后再删除。', 409);
    const scheduled = site.store.raw.prepare("SELECT 1 FROM records WHERE scope='publication-schedule' AND json_extract(data,'$.entryId')=? AND json_extract(data,'$.status') IN ('scheduled','running','failed') LIMIT 1").get(id);
    if (scheduled) throw new WeavaError('请先取消这篇内容的定时发布，再删除。', 409);
    const planned = site.store.list('publication-plan').some(row => ['draft', 'scheduled', 'running', 'failed'].includes(row.value.status) && row.value.actions.some((action: { id: string }) => action.id === id));
    if (planned) throw new WeavaError('这篇内容仍在发布计划中，请先从计划移除，再删除。', 409);
    // Withdraw through the normal publication checks; retain historical snapshots and shared media.
    site.withdraw(id, revision, true, reviewed);
    site.store.put('entry-trash',id,{entry:original,deletedAt:now(),originalRevision:revision},null,'移入回收站');
    site.store.raw.prepare("DELETE FROM records WHERE scope='entry' AND id=?").run(id);
    site.store.raw.prepare('DELETE FROM entry_list WHERE id=?').run(id);
    return { id };
  }).immediate();
}

export function trashedContent(site: Site, input: {query?:string;kind?:'content'|'page';page?:number;pageSize?:number} = {}) {
  const page=input.page??1,pageSize=input.pageSize??25;
  if(!Number.isSafeInteger(page)||page<1||!Number.isSafeInteger(pageSize)||pageSize<1||pageSize>100)throw new WeavaError('回收站页码无效。');
  const clauses=["scope='entry-trash'"],args:string[]=[];
  if(input.kind){clauses.push("json_extract(data,'$.entry.kind')=?");args.push(input.kind);}
  if(input.query?.trim()){clauses.push("instr(lower(json_extract(data,'$.entry.title')),lower(?))>0");args.push(input.query.trim());}
  const where=clauses.join(' AND '),total=(site.store.raw.prepare('SELECT COUNT(*) n FROM records WHERE '+where).get(...args) as {n:number}).n;
  const rows=site.store.raw.prepare('SELECT id,revision,data FROM records WHERE '+where+" ORDER BY json_extract(data,'$.deletedAt') DESC,id LIMIT ? OFFSET ?").all(...args,pageSize,(page-1)*pageSize) as {id:string;revision:number;data:string}[];
  return {page,pageSize,total,pages:Math.ceil(total/pageSize),items:rows.map(row=>{const value=JSON.parse(row.data);return {id:row.id,revision:row.revision,title:value.entry.title,path:value.entry.path,kind:value.entry.kind,type:value.entry.type,deletedAt:value.deletedAt};})};
}
function trashRecord(site:Site,id:string,revision:number){const row=site.store.get('entry-trash',id);if(!row)throw new WeavaError('回收站内容不存在。',404);if(row.revision!==revision)throw new WeavaError('回收站内容已变化，请重新读取。',409);return row;}
export function restoreTrashedContent(site:Site,id:string,revision:number) {
  return site.store.raw.transaction(()=>{
    const row=trashRecord(site,id,revision);
    if(site.store.get('entry',id))throw new WeavaError('相同编号的内容已存在，未覆盖。',409);
    const value=entrySchema.parse({...row.value.entry,status:'draft',publishedAt:undefined});
    const restored=site.saveEntry(value,null);
    site.store.raw.prepare("DELETE FROM records WHERE scope='entry-trash' AND id=?").run(id);
    return restored;
  }).immediate();
}
/** Immutable publication history follows the separate history retention policy. */
export function purgeTrashedContent(site:Site,id:string,revision:number,confirmation:string){
  if(confirmation!=='永久删除')throw new WeavaError('请明确输入“永久删除”。');
  return site.store.raw.transaction(()=>{trashRecord(site,id,revision);site.store.raw.prepare("DELETE FROM records WHERE scope='entry-trash' AND id=?").run(id);return {id};}).immediate();
}
