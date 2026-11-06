import {Plus,Search} from 'lucide-react';
import type {ContentLibraryModel} from './content-models.ts';
import {EntryActions} from './EntryActions.tsx';
import {isNoteType} from '@weava/contracts';

export function NotesLibrary({model}:{model:Pick<ContentLibraryModel,'items'|'library'|'libraryLoading'|'filter'|'setFilter'|'select'|'newEntry'|'libraryPage'|'setLibraryPage'|'pendingDrafts'|'record'|'state'|'busy'|'actions'>}){
 const {items,library,libraryLoading,filter,setFilter,select,newEntry,libraryPage,setLibraryPage}=model;
 const pending=(model.pendingDrafts??[]).filter(copy=>copy.record.revision===0&&copy.record.id!==model.record?.id&&!items.some((row:any)=>row.id===copy.record.id)&&isNoteType(model.state?.types.find((type:any)=>type.id===copy.record.value.type)?.value));
 return <section className="notes-library" aria-label="笔记">
  <header><h1>笔记</h1><button className="primary" onClick={newEntry}><Plus size={18}/>写笔记</button></header>
  <div className="notes-search"><Search size={18} aria-hidden="true"/><input aria-label="搜索笔记" placeholder="搜索笔记" value={filter} onChange={event=>setFilter(event.target.value)}/></div>
  {pending.length>0&&<div className="recovery-banner" role="status">有尚未保存到网站的笔记。{[...new Map(pending.map(copy=>[copy.record.id,copy])).values()].map(copy=><button key={copy.record.id} onClick={()=>select(copy.record.id)}>恢复 {copy.record.value.title}</button>)}</div>}
  <div className="notes-list" aria-busy={libraryLoading}>
   {libraryLoading&&!items.length&&<p className="library-status" role="status">正在载入笔记…</p>}
   {!libraryLoading&&!items.length&&<p className="library-status">{filter?'没有找到笔记。':'随手记点什么吧。'}</p>}
   {items.map((row:any)=><article className="notes-list-item" key={row.id}>
    <button className="notes-list-open" onClick={()=>select(row.id)}><span>{row.value.title==='未命名笔记'?'继续写笔记…':row.value.title}</span><time dateTime={row.value.publishedAt||row.updatedAt}>{new Date(row.value.publishedAt||row.updatedAt).toLocaleString('zh-CN',{dateStyle:'medium',timeStyle:'short'})}</time></button>
    <EntryActions row={row} model={model.actions} disabled={libraryLoading||model.busy}/>
   </article>)}
  </div>
  {library.pages>1&&<nav className="library-pagination" aria-label="笔记分页"><button disabled={libraryPage<=1} onClick={()=>setLibraryPage(page=>page-1)}>上一页</button><span>{libraryPage} / {library.pages}</span><button disabled={libraryPage>=library.pages} onClick={()=>setLibraryPage(page=>page+1)}>下一页</button></nav>}
 </section>;
}
