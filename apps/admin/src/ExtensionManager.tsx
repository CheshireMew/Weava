import { useState } from 'react';
import { api } from './api.ts';
export default function ExtensionManager({ rows, refresh }: { rows: any[]; refresh: () => Promise<any> }) {
  const [error, setError] = useState<any>(null), [usage, setUsage] = useState<any[] | null>(null), [busy, setBusy] = useState('');
  const statuses: Record<string, string> = { active: '运行中', disabled: '已停用', failed: '启动失败', blocked: '依赖未满足' };
  return <section className="form-card"><h2>扩展</h2>{!rows.length && <p>本站尚未配置扩展。</p>}{rows.map((row) => <article className="extension-row" key={row.id}><div><h3>{row.label}</h3><p>{row.version} · {statuses[row.status]}</p>{row.dependencies.length > 0 && <p>依赖 {row.dependencies.map((item: any) => item.id + (item.minVersion ? ' ≥ ' + item.minVersion : '')).join('、')}</p>}{row.error && <p role="alert">{row.error}</p>}{row.taskError && <p role="alert">{row.taskError}</p>}<p>数据版本 {row.installedSchema} / {row.schemaVersion}</p>{row.backup && <details><summary>升级前数据库副本</summary><p>{row.backup}</p></details>}</div>
    <div><button disabled={!!busy} onClick={() => api('extensions/usage?id=' + encodeURIComponent(row.id)).then(setUsage).catch(setError)}>查看引用</button><button disabled={!!busy} onClick={async () => { setBusy(row.id); setError(null); setUsage(null); try { await api('extensions/toggle', { id: row.id, revision: row.configRevision, enabled: !row.enabled }); } catch (error) { setError(error); } finally { await refresh(); setBusy(''); } }}>{busy === row.id ? '正在切换…' : row.enabled ? '停用' : '启用'}</button></div></article>)}
    {error && <div role="alert"><p>{error.message}</p>{Array.isArray(error.details) && <ul>{error.details.map((item: any, index: number) => <li key={index}>{item.label ?? item.id} · {item.kind}</li>)}</ul>}</div>}{usage && <section><h3>引用位置</h3>{usage.length ? <ul>{usage.map((item, index) => <li key={index}>{item.label} · {item.kind}</li>)}</ul> : <p>当前内容、公开版本和其他扩展均未引用。</p>}</section>}
  </section>;
}
