import {useState} from 'react';
import {api} from './api.ts';
import type {EntrySummary} from './content-models.ts';
export function ScheduleSummary({items,timezone='Asia/Shanghai',onError}:{items:NonNullable<EntrySummary['schedules']>;timezone?:string;onError:(message:string)=>void}) {
  const [pending,setPending]=useState<string|null>(null);
  async function change(action:'cancel'|'retry',item:typeof items[number]) {setPending(item.id);try{await api(`schedule/${action}`,{id:item.id,revision:item.revision});}catch(error:any){onError(error.message);}finally{setPending(null);}}
  return <div className="publication-schedules">{items.map(item=><div key={item.id}>
    <time dateTime={item.dueAt}>{new Date(item.dueAt).toLocaleString('zh-CN',{timeZone:timezone})}（{timezone}）</time>
    <span>{item.status==='failed'?item.error||'定时发布失败':item.status==='running'?'正在定时发布':'已安排发布'}</span>
    {item.status!=='running'&&<button disabled={!!pending} onClick={()=>void change('cancel',item)}>取消计划</button>}
    {item.status==='failed'&&<button disabled={!!pending} onClick={()=>void change('retry',item)}>重试</button>}
  </div>)}</div>;
}
