import { useState } from 'react';
import { api, waitJob } from './api.ts';

const download = (value: any, name: string) => { const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' })); const link = document.createElement('a'); link.href = url; link.download = name; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); };
export default function ImportManager({ refresh }: { refresh: () => Promise<any> }) {
  const [source, setSource] = useState<{ name: string; text: string; wxr: boolean } | null>(null);
  const [settings, setSettings] = useState(false), [media, setMedia] = useState(true), [comments, setComments] = useState(true), [merge, setMerge] = useState(false);
  const [report, setReport] = useState<any>(null), [revisions, setRevisions] = useState<Record<string, number>>({});
  const [busy, setBusy] = useState(false), [progress, setProgress] = useState(''), [error, setError] = useState<any>(null);
  const options = () => ({ settings, downloadMedia: media, comments, mode: merge ? 'merge' as const : 'create' as const, revisions });
  const jsonSource = () => { const data = JSON.parse(source!.text.replace(/^\ufeff/, '')); return settings ? data : { ...data, settings: undefined }; };
  const preview = async () => {
    if (!source) return; setBusy(true); setError(null); setProgress('正在完整预检…');
    try {
      const current = merge ? await api('import/revisions') : {}; setRevisions(current);
      const nextOptions = { ...options(), revisions: current, dryRun: true };
      setReport(source.wxr ? await api('import/wxr', { xml: source.text, options: nextOptions }) : { ...await api('import', { value: jsonSource(), options: nextOptions }), format: 'json' });
    } catch (error) { setError(error); setReport(null); } finally { setBusy(false); setProgress(''); }
  };
  const commit = async () => {
    if (!source || !report?.dryRun) return; setBusy(true); setError(null);
    try {
      if (source.wxr) { const job = await api('import/wxr', { xml: source.text, options: { ...options(), dryRun: false, review: report.review } }); const complete = await waitJob(job, (job) => setProgress(job.message)); setReport(complete.result); }
      else setReport({ ...await api('import', { value: jsonSource(), options: { ...options(), dryRun: false } }), format: 'json' });
      await refresh();
    } catch (error) { setError(error); setReport(null); } finally { setBusy(false); setProgress(''); }
  };
  return <section className="form-card import-manager"><div className="panel-title"><h2>数据交换与 WordPress 导入</h2><button disabled={busy} onClick={() => api('export').then((data) => download(data, 'weava-site.json')).catch(setError)}>导出内容 JSON</button></div>
    <p>选择 Weava JSON 或 WordPress 标准 WXR XML。导入完成后保存在工作稿中，需要另外发布；JSON 不包含媒体文件，完整备份可保存媒体。</p>
    <label className="button">选择导入文件<input type="file" aria-label="选择导入文件" accept=".json,.xml" disabled={busy} onChange={async (event) => { const file = event.target.files?.[0]; if (!file) return; setError(null); setReport(null); if (file.size > 128 * 1024 * 1024) { setError(new Error('文件超过 128 MB，请分批导出。')); return; } const text = await file.text(); setSource({ name: file.name, text, wxr: /^\s*(?:\ufeff)?</.test(text) }); }} /></label>
    {source && <p>{source.name}</p>}
    <div className="import-options">{[['同时导入站点设置', settings, setSettings], ['合并已有内容', merge, setMerge], ...(source?.wxr ? [['下载来源附件', media, setMedia], ['导入来源评论', comments, setComments]] : [])].map(([label, value, change]) => <label className="checkbox" key={String(label)}><input type="checkbox" disabled={busy} checked={Boolean(value)} onChange={(event) => { (change as (value: boolean) => void)(event.target.checked); setReport(null); }} />{label as string}</label>)}</div>
    <div className="import-actions"><button disabled={busy || !source} onClick={() => void preview()}>预检导入</button><button className="primary" disabled={busy || !report?.dryRun} onClick={() => void commit()}>导入已预检内容</button></div>
    {progress && <p role="status">{progress}</p>}{error && <div role="alert"><p>{error.message}</p>{Array.isArray(error.details) && <ul>{error.details.map((detail: any, index: number) => <li key={index}>{detail.scope} {detail.id}：{detail.reason ?? detail.error}</li>)}</ul>}</div>}
    {report && <div className="import-report"><h3>{report.dryRun ? '预检结果' : '导入完成'}</h3>
      {source?.wxr ? <><p>文章及自定义内容 {report.content} · 页面 {report.pages} · 分类和标签 {report.terms} · 附件 {report.attachments.length} · 评论 {report.comments}</p><p>需检查来源功能的内容 {report.reviewRequired.length} · 保留在原始资料中的系统对象 {report.skipped.length}</p>
        {report.reviewRequired.map((item: any) => <details key={item.id}><summary>{item.title}</summary><ul>{item.unresolved.map((reason: string) => <li key={reason}>{reason}</li>)}</ul></details>)}
        {report.warnings.length > 0 && <details><summary>转换说明</summary><ul>{report.warnings.map((message: string) => <li key={message}>{message}</li>)}</ul></details>}
        {report.notes.map((note: string) => <p key={note}>{note}</p>)}{!report.dryRun && <p>已导入附件 {report.downloaded} · 新增评论 {report.importedComments}</p>}</> : <p>新增 {report.created.length} · 更新 {report.updated.length} · 相同内容 {report.unchanged.length}</p>}
      <button onClick={() => download(report, 'import-report.json')}>保存转换报告</button>
    </div>}
  </section>;
}
