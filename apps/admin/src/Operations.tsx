import { useState, Suspense } from 'react';
import {retryableLazy as lazy} from './ErrorBoundary.tsx';
import { api } from './api.ts';
import { Dialog } from './Dialog.tsx';
import { PanelSections } from './PanelSections.tsx';
import { operationLabels, jobStatusLabels } from './admin-labels.ts';
import {RollbackDialog} from './RollbackDialog.tsx';
import {TemporaryMaintenance} from './TemporaryMaintenance.tsx';
import {LoadingState} from './LoadingState.tsx';
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
  const [path, setPath] = useState(() => { try { return localStorage.getItem('weava-backup-path') || 'D:/Tools/weava/backups'; } catch { return 'D:/Tools/weava/backups'; } });
  const [verify, setVerify] = useState(''), [usage, setUsage] = useState<any>(null);
  const [dialog, setDialog] = useState<'location' | 'verify' | null>(null), [nextPath, setNextPath] = useState('');
  const [rollbackId,setRollbackId]=useState<string|null>(null);
  const [readingUsage,setReadingUsage]=useState(false);
  const scans=useBackgroundTasks('storage'),scan=scans.find(task=>taskPending(task));
  async function inspectUsage(){
    setReadingUsage(true);
    try{
      setUsage(await api('maintenance'));
      const job=scan?.job??await startTask('maintenance/scan',{}, {scope:'storage',label:'扫描存储占用'});
      void awaitTask(job.id).then(()=>api('maintenance').then(setUsage)).catch(error=>onError(error.message));
    }catch(error:any){onError(error.message);}finally{setReadingUsage(false);}
  }
  const size = (n: number) => (n / 1048576).toFixed(1) + ' MB';
  const contentEnabled = !state.features || state.features.includes('content');
  return <div className="panel operations-panel">
    <div className="panel-title"><h1>备份与维护</h1><button onClick={refresh}>刷新</button></div>
    <PanelSections label="备份与维护分类" sections={[
      { id: 'backup', label: '备份', content: <section className="form-card settings-form">
        <h2>完整备份</h2><p>保存网站内容、设置和媒体文件，以便恢复整个网站。</p>
        <div className="backup-location"><span>保存位置：{path}</span><button onClick={() => { setNextPath(path); setDialog('location'); }}>更改位置</button></div>
        <div className="inline"><button className="primary" disabled={pending('backup') || !path.trim()} onClick={() => { try { localStorage.setItem('weava-backup-path', path); } catch {} return task('backup', { path }); }}>创建备份</button>
        <button disabled={pending('verify')} onClick={() => setDialog('verify')}>检查已有备份</button>
        </div>
      </section> },
      ...(contentEnabled ? [{ id: 'import', label: '导入与导出', content: <Suspense fallback={<LoadingState label="载入导入工具" />}><ImportManager refresh={refresh} /></Suspense> },
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
          <button disabled={readingUsage} onClick={()=>void inspectUsage()}>检查占用</button>
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
    {dialog && <Dialog label={dialog === 'location' ? '更改备份位置' : '检查已有备份'} onClose={() => setDialog(null)}>
      <div className="modal-title"><h2>{dialog === 'location' ? '更改备份位置' : '检查已有备份'}</h2><button onClick={() => setDialog(null)}>关闭</button></div>
      <form onSubmit={event => {
        event.preventDefault();
        if (dialog === 'location') { setPath(nextPath.trim()); try { localStorage.setItem('weava-backup-path', nextPath.trim()); } catch {} }
        else task('verify', { path: verify.trim() });
        setDialog(null);
      }}>
        <label>{dialog === 'location' ? '文件夹' : '备份所在文件夹'}<input data-autofocus required value={dialog === 'location' ? nextPath : verify} onChange={event => dialog === 'location' ? setNextPath(event.target.value) : setVerify(event.target.value)} /></label>
        <div className="dialog-actions"><button type="button" onClick={() => setDialog(null)}>取消</button><button disabled={!(dialog === 'location' ? nextPath : verify).trim()}>{dialog === 'location' ? '使用此位置' : '检查备份是否完整'}</button></div>
      </form>
    </Dialog>}
  </div>;
}
