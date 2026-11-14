import {Suspense,useRef} from 'react';
import {retryableLazy as lazy} from './ErrorBoundary.tsx';
import {X,MoreHorizontal} from 'lucide-react';
import {noteTitle,type Document} from '@weava/contracts';
import {Popover} from './Popover.tsx';
import {EntryRecovery} from './EntryRecovery.tsx';
import type {NoteEditorModel} from './content-models.ts';
import {useSelectors} from './Selectors.tsx';
import {HtmlPageText} from './ImportedContentEditor.tsx';
import {Dialog} from './Dialog.tsx';
import {LoadingState} from './LoadingState.tsx';
import {AutosaveStatus} from './AutosaveStatus.tsx';
const Editor=lazy(()=>import('./Editor.tsx').then(module=>({default:module.Editor})));
export function NoteEditor({model,error=''}:{model:NoteEditorModel;error?:string}){
 const {record,saving,update,persist,publish,setError,clear,editorEpoch}=model;
 const selectors=useSelectors();
 const baseline=useRef<{id:string;epoch:number;document:string;title:string}|null>(null);
 if(!record)return null;
 const published=record.published??record.value.status==='published';
 if(baseline.current?.id!==record.id||baseline.current.epoch!==editorEpoch)baseline.current={id:record.id,epoch:editorEpoch,document:JSON.stringify(record.value.document),title:record.value.title};
 const changeDocument=(document:Document)=>{
  const serialized=JSON.stringify(document);if(serialized===JSON.stringify(record.value.document))return;
  update({document,title:serialized===baseline.current!.document?baseline.current!.title:noteTitle(document)});
 };
 const close=async()=>{try{await persist();setError('');clear();}catch(error:any){setError(error.message);}};
 return <Dialog className="note-composer" label={published?'编辑笔记':'写笔记'} onClose={()=>void close()} dismissible={!saving}>
  <header className="note-composer-header"><h2>{published?'编辑笔记':'写笔记'}</h2><button type="button" aria-label="关闭笔记窗口" disabled={saving} onClick={()=>void close()}><X size={20}/></button></header>
  <div className="note-composer-body">
  {error&&<p className="error" role="alert">{error}</p>}
  {model.publicationNotice&&<p role="status">{model.publicationNotice}</p>}
  <EntryRecovery model={model.recovery}/>
  <div className="note-writing"><div className="note-author"><span className="note-avatar">{model.author.logo?<img src={model.author.logo} alt=""/>:model.author.name.slice(0,1)}</span><strong>{record.value.author||model.author.name}</strong><Popover label="笔记设置" trigger={<MoreHorizontal size={18}/>}><div className="note-preferences"><label>可见性<select aria-label="笔记可见性" value={record.value.visibility??'public'} onChange={event=>update({visibility:event.target.value as 'public'|'private'})}><option value="public">公开</option><option value="private">私密</option></select></label><label className="checkbox"><input type="checkbox" checked={record.value.allowComments!==false} onChange={event=>update({allowComments:event.target.checked})}/>允许评论</label></div></Popover></div>
   {record.value.document.format==='html'?<HtmlPageText key={record.id+':'+editorEpoch} cleanFormatting value={String(record.value.document.source)} onChange={source=>changeDocument({version:1,format:'html',source})}/>:<Suspense fallback={<LoadingState label="打开笔记" />}><Editor key={record.id+':'+editorEpoch} compact value={record.value.document} placeholder="随手记点什么…" onChange={changeDocument} onMedia={()=>selectors.media()} onError={setError}/></Suspense>}
  </div>
  </div>
  <footer className="note-composer-footer">{model.autoSave && <AutosaveStatus state={model.autoSave}/>}<button type="button" disabled={saving} onClick={()=>void close()}>关闭</button><button type="button" className="primary async-action" disabled={saving||model.busy} onClick={()=>publish().catch(error=>setError(error.message))}>{model.busy?'正在发布…':published?'更新发布':'发布'}</button></footer>
 </Dialog>;
}
