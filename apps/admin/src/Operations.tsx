import { useState, lazy, Suspense } from 'react';

import { api } from './api.ts';

const ImportManager = lazy(() => import('./ImportManager.tsx'));
const ExtensionManager = lazy(() => import('./ExtensionManager.tsx'));

const HistoryMaintenance = lazy(() => import('./HistoryMaintenance.tsx'));

export default function Operations({
  state,
  task,
  refresh,
  onError,
  openLogs,
}: {
  state: any;
  task: (op: 'publish' | 'backup' | 'verify', p?: any) => any;
  openLogs: (id: string) => void;
  refresh: () => any;
  onError: (s: string) => void;
}) {
  const [path, setPath] = useState('D:/Tools/weava/backups'),
    [verify, setVerify] = useState(''),
    [usage, setUsage] = useState<any>(null);
  const size = (n: number) => (n / 1048576).toFixed(1) + ' MB';
  return (
    <div className="panel">
      <div className="panel-title">
        <div>
          <h1>运行与备份</h1>
          <p>发布记录、任务状态与内容备份。</p>
          {state.program && (
            <p>
              程序 {state.program.framework} · 数据版本 {state.program.databaseSchema}
              {state.program.selected ? ' · 使用已检查的独立版本' : ''}
            </p>
          )}
        </div>
        <button onClick={refresh}>刷新</button>
      </div>
      <div className="settings-panels">
        <section className="form-card">
          <h2>全站发布</h2>
          <p>发布已有公开内容、页面及设置的工作稿；新草稿可在编辑页单独发布。</p>
          <button className="primary" onClick={() => task('publish', {})}>
            发布全站工作稿
          </button>
        </section>
        <section className="form-card">
          <h2>完整备份</h2>
          <label>
            备份根目录
            <input value={path} onChange={(e) => setPath(e.target.value)} />
          </label>
          <button onClick={() => task('backup', { path })}>创建备份</button>
          <label>
            校验备份目录
            <input value={verify} onChange={(e) => setVerify(e.target.value)} />
          </label>
          <button onClick={() => task('verify', { path: verify })}>校验</button>
        </section>
      </div>
      <Suspense fallback={<p>正在载入导入工具…</p>}>
        <ImportManager refresh={refresh} />
      </Suspense>
      <Suspense fallback={<p>正在载入扩展…</p>}>
        <ExtensionManager rows={state.extensions ?? []} refresh={refresh} />
      </Suspense>
      <Suspense fallback={<p>正在载入历史维护…</p>}>
        <HistoryMaintenance refresh={refresh} />
      </Suspense>
      <section className="form-card">
        <h2>空间占用</h2>
        <button
          onClick={() =>
            api('maintenance')
              .then(setUsage)
              .catch((e) => onError(e.message))
          }
        >
          检查占用
        </button>
        {usage && (
          <>
            <p>
              内容数据库 {size(usage.databaseBytes)} · 统计 {size(usage.analyticsBytes)} · 媒体{' '}
              {size(usage.media.bytes)}
            </p>
            <p>
              {usage.versions.count} 个历史版本 · {usage.releases.count} 个发布版本 ·{' '}
              {usage.backups.length} 份已记录备份
            </p>
            <p>
              未被内容或历史引用的媒体：{usage.unreferenced.count} 个，
              {size(usage.unreferenced.bytes)}。文件继续保留。
            </p>
            {usage.backups.map((b: any) => (
              <p key={b.path}>
                {b.path} · {size(b.bytes)}
              </p>
            ))}
          </>
        )}
      </section>
      <h2>公开版本</h2>
      <div className="release-list">
        {state.releases.slice(0, 20).map((r: any) => (
          <div key={r.id}>
            <span>
              {new Date(r.created_at).toLocaleString()}
              <small>{r.id}</small>
            </span>
            <button
              onClick={async () => {
                try {
                  await api('rollback', { id: r.id });
                  await refresh();
                } catch (e: any) {
                  onError(e.message);
                }
              }}
            >
              切换到这个版本
            </button>
          </div>
        ))}
      </div>
      <h2>任务记录</h2>
      <div className="release-list">
        {state.jobs.map((j: any) => (
          <div key={j.id}>
            <span>
              {j.operation} · {j.status}
              <small>{j.message}</small>
            </span>
            <button onClick={() => openLogs(j.id)}>日志</button>
          </div>
        ))}
      </div>
    </div>
  );
}
