import { useState, useRef, Suspense } from 'react';
import {retryableLazy as lazy} from './ErrorBoundary.tsx';
import { api } from './api.ts';
import { Dialog } from './Dialog.tsx';
import { PanelSections } from './PanelSections.tsx';
import { operationLabels, jobStatusLabels } from './admin-labels.ts';
import {RollbackDialog} from './RollbackDialog.tsx';
import {TemporaryMaintenance} from './TemporaryMaintenance.tsx';
import {LoadingState} from './LoadingState.tsx';
import {MarkdownExchange} from './MarkdownExchange.tsx';
import BackupManager from './BackupManager.tsx';
import {startTask,awaitTask,useBackgroundTasks,taskPending} from './background-tasks.ts';
const ImportManager = lazy(() => import('./ImportManager.tsx'));
const ExtensionManager = lazy(() => import('./ExtensionManager.tsx'));
const HistoryMaintenance = lazy(() => import('./HistoryMaintenance.tsx'));

export default function Operations({ state, task, refresh, onError, openLogs, busy = false, pending=()=>false }: {
  state: any;
  task: (op: 'publish' | 'backup' | 'verify', p?: any) => any;
  openLogs: (id: string) => void;
  refresh: () => any;
  onError: (s: string) => void;
  busy?: boolean;
  pending?: (operation:string)=>boolean;
}) {
  const [usage, setUsage] = useState<any>(null);
  const [rollbackId,setRollbackId]=useState<string|null>(null);
  const [readingUsage,setReadingUsage]=useState(false);
  const usageRequest=useRef(false);
  const scans=useBackgroundTasks('storage'),scan=scans.find(task=>taskPending(task));
  async function inspectUsage(){
    if(usageRequest.current||scan)return;
    usageRequest.current=true;
    setReadingUsage(true);
    try{
      setUsage(await api('maintenance'));
      const job=await startTask('maintenance/scan',{}, {scope:'storage',label:'扫描存储占用'});
      void awaitTask(job.id).then(()=>api('maintenance').then(setUsage)).catch(error=>onError(error.message));
    }catch(error:any){onError(error.message);}finally{usageRequest.current=false;setReadingUsage(false);}
  }
  const size = (n: number) => (n / 1048576).toFixed(1) + ' MB';
  const contentEnabled = !state.features || state.features.includes('content');
  return <div className="panel operations-panel">
    <div className="panel-title"><h1>备份与维护</h1><button onClick={refresh}>刷新</button></div>
    <PanelSections label="备份与维护分类" sections={[
      { id: 'backup', label: '备份', content: <Suspense fallback={<LoadingState label="读取备份"/>}><BackupManager onError={onError}/></Suspense> },
      ...(contentEnabled ? [{ id: 'import', label: '导入与导出', content: <Suspense fallback={<LoadingState label="载入导入工具" />}><ImportManager refresh={refresh} /><MarkdownExchange/></Suspense> },
      { id: 'publication', label: '发布记录', content: <>
        <section className="form-card"><h2>网站更新</h2>
          <p>一次发布已有公开内容和网站设置的修改。新文章请在编辑页发布。</p>
          <button disabled={busy||pending('publish')} onClick={() => task('publish', {})}>发布全站工作稿</button>
        </section>
        <section className="form-card"><h2>已发布的版本</h2>
          {!state.releases.length && <p className="muted">网站尚未发布。</p>}
          <div className="release-list">{state.releases.slice(0, 20).map((release: any) => <div key={release.id}>
            <time>{new Date(release.created_at).toLocaleString()}</time>
            <button onClick={()=>setRollbackId(release.id)}>恢复这个公开版本</button>
          </div>)}</div>
        </section>
      </> }] : []),
      { id: 'tasks', label: '任务记录', content: <section className="form-card">
        <h2>任务记录</h2>{!state.jobs.length && <p className="muted">暂无任务记录。</p>}
        <div className="release-list">{state.jobs.map((job: any) => <div key={job.id}>
          <span>{operationLabels[job.operation] ?? '网站任务'} · {jobStatusLabels[job.status] ?? '状态未知'}<small>{job.message}</small></span>
          <button onClick={() => openLogs(job.id)}>查看详情</button>
          {['queued','running'].includes(job.status)&&<button disabled={!!job.cancelRequestedAt} onClick={()=>api('jobs/cancel',{id:job.id}).then(refresh).catch(error=>onError(error.message))}>{job.cancelRequestedAt?'正在取消':'取消任务'}</button>}
        </div>)}</div>
      </section> },
      { id: 'maintenance', label: '维护', content: <>
        <section className="form-card"><h2>空间占用</h2>
          <button disabled={readingUsage||!!scan} onClick={()=>void inspectUsage()}>检查占用</button>
          {usage && <>
            <p>内容 {size(usage.databaseBytes)} · 访问统计 {size(usage.analyticsBytes)} · {usage.scan?.checkedAt?'媒体':'已登记媒体'} {size(usage.media.bytes)}</p>
            {scan&&<p role="status">正在后台核对文件和历史引用，可继续使用网站。</p>}
            <TemporaryMaintenance usage={usage} refresh={()=>api('maintenance').then(setUsage)} onError={onError}/>
            <p>{usage.versions.count} 个历史版本 · {usage.releases.count} 个发布版本{usage.scan?.checkedAt&&<> · {usage.backups.length} 份已记录备份</>}</p>
            {usage.scan?.checkedAt?<p>未被内容或历史引用的媒体：{usage.unreferenced.count} 个，{size(usage.unreferenced.bytes)}。检查于 {new Date(usage.scan.checkedAt).toLocaleString()}，文件继续保留。</p>:<p>历史引用尚未完成核对。</p>}
            {!!usage.backups.length && <section className="backup-locations"><h3>备份位置</h3>{usage.backups.map((backup: any) => <p key={backup.path}>{backup.path} · {size(backup.bytes)}</p>)}</section>}
          </>}
        </section>
        {contentEnabled && <Suspense fallback={<LoadingState label="载入历史维护" />}><HistoryMaintenance refresh={refresh} /></Suspense>}

      </> },
    ]} />
    {rollbackId&&<RollbackDialog id={rollbackId} onClose={()=>setRollbackId(null)} onRestored={refresh} onError={onError}/>}

  </div>;
}
