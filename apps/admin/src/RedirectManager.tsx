import { useEffect, useState } from 'react';
import { api } from './api.ts';
import { useManagedRecord } from './EditSessions.tsx';
const blank = () => ({id:'redirect-form',revision:null,value:{source:'',target:'',disabled:false,batch:''}});
export default function RedirectManager({ onError, publish }: { onError: (message: string) => void; publish: () => void | Promise<any> }) {
  const [rows,setRows] = useState<any[]>([]),[preview,setPreview] = useState<any>(null),[busy,setBusy] = useState(false);
  const refresh = () => api('redirects').then(setRows);
  const items = (row:any) => row.value.batch.trim() ? JSON.parse(row.value.batch) : [{source:row.value.source,target:row.value.target,disabled:row.value.disabled,revision:row.revision}];
  const managed = useManagedRecord<any>(blank(), async snapshot => {
    const batch = items(snapshot), checked = await api('redirects/preview',{items:batch});
    const saved = await api('redirects/save',{items:batch,review:checked.review});
    await refresh(); setPreview(null);
    return {...snapshot,revision:snapshot.value.batch.trim()?null:saved[0].revision,value:{...snapshot.value,batch:snapshot.value.batch.trim()?JSON.stringify(batch.map((item:any)=>({...item,revision:saved.find((row:any)=>row.id===item.source)?.revision??item.revision})),null,2):''}};
  }, '网址别名');
  const record = managed.record!,{source,target,disabled,batch}=record.value;
  const set = (patch:any) => { managed.setRecord((row:any)=>({...row,value:{...row.value,...patch}})); setPreview(null); };
  const select = async (row:any) => { try { await managed.session.save(); managed.session.adopt(row); setPreview(null); } catch(error:any) { onError(error.message); } };
  const execute = async (action:()=>Promise<any>) => { setBusy(true);try { await action(); } catch(error:any) { onError(error.message); } finally { setBusy(false); } };
  useEffect(()=>{refresh().catch((error)=>onError(error.message));},[]);
  return <div className="panel"><div className="panel-title"><h1>网址别名</h1><button disabled={busy} onClick={()=>void execute(async()=>{await managed.session.save();await publish();})}>发布别名</button></div><div className="split-panel"><nav className="object-list">{rows.map(row=><button key={row.id} disabled={busy} onClick={()=>void select({id:'redirect-form',revision:row.revision,value:{source:row.id,target:row.value.target,disabled:!!row.value.disabled,batch:''}})}>{row.id}<small>{row.value.disabled?'已停用':row.value.target}</small></button>)}</nav><div className="form-card">
    <label>来源路径<input value={source} disabled={record.revision!==null} placeholder="/old-page/" onChange={event=>set({source:event.target.value})}/></label><label>目标路径<input value={target} placeholder="/new-page/" onChange={event=>set({target:event.target.value})}/></label><label className="checkbox"><input type="checkbox" checked={disabled} onChange={event=>set({disabled:event.target.checked})}/>停用别名</label><details><summary>批量导入</summary><textarea aria-label="批量别名 JSON" value={batch} placeholder={'[{"source":"/old/","target":"/new/","revision":null}]'} onChange={event=>set({batch:event.target.value})}/></details>
    {preview&&<p role="status">已检查 {preview.items.length} 条别名，保存后还需发布才会生效。</p>}<div className="inline"><button disabled={busy} onClick={()=>void execute(async()=>{const snapshot=JSON.stringify(managed.session.record);const checked=await api('redirects/preview',{items:items(managed.session.record)});if(JSON.stringify(managed.session.record)===snapshot)setPreview(checked);})}>检查别名</button><button disabled={busy||!preview} onClick={()=>void execute(managed.session.save)}>保存别名</button><button disabled={busy} onClick={()=>void select(blank())}>新建别名</button></div>
  </div></div></div>;
}
