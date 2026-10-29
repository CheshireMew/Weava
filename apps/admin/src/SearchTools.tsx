import React, { useEffect, useState } from 'react';
import { api } from './api.ts';

export default function SearchTools() {
  const [reports, setReports] = useState<any[]>([]), [external, setExternal] = useState<any>(null), [selected, setSelected] = useState<any>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [input, setInput] = useState('');
  const [findingPage, setFindingPage] = useState(1), [rule, setRule] = useState('');
  const refresh = async () => { const [reports, data] = await Promise.all([api('seo/audits'), api('search-data')]); setReports(reports); setExternal(data); return reports; };
  useEffect(() => { refresh().catch((error) => setError(error.message)); }, []);
  const execute = async (action: () => Promise<void>) => { if (busy) return; setBusy(true); setError(''); try { await action(); } catch (error: any) { setError(error.message); } finally { setBusy(false); } };
  const current = selected ? reports.find((report) => report.id === selected.id) ?? selected : reports[0];
  const findings = (current?.findings ?? []).filter((finding: any) => !rule || finding.rule === rule), pages = Math.max(1, Math.ceil(findings.length / 20)), page = Math.min(findingPage, pages);
  return <div className="panel"><div className="panel-title"><h1>搜索与内容检查</h1><button disabled={busy} onClick={() => execute(async () => { await refresh(); })}>刷新</button></div>
    {error && <p className="error" role="alert">{error}</p>}
    <div className="toolbar"><button disabled={busy} onClick={() => execute(async () => { setSelected(await api('seo/audit', { target: 'published', http: true })); await refresh(); })}>检查公开页面</button>
      <button disabled={busy} onClick={() => execute(async () => { setSelected(await api('seo/audit', { target: 'draft' })); await refresh(); })}>检查待发布内容</button></div>
    {reports.length > 0 && <label>检查记录<select value={current?.id ?? ''} onChange={(event) => setSelected(reports.find((report) => report.id === event.target.value))}>{reports.map((report) => <option value={report.id} key={report.id}>{new Date(report.createdAt).toLocaleString()} · {report.target === 'draft' ? '工作稿' : '公开版本'}{report.stale ? ' · 已过期' : ''}</option>)}</select></label>}
    {current ? <><p>{current.stale ? '内容或设置已变化，需要重新检查。' : '检查结果对应记录的内容版本。'} {current.coverage.source === 'http-response' ? '实际 HTTP 响应' : '发布内容生成检查'}：已检查 {current.coverage.checked}/{current.coverage.eligible} 页，未能检查 {current.coverage.unavailable} 页。另读取 {current.coverage.paginationChecked ?? 0} 个分页。{current.coverage.linkDiscoveryComplete === false && '链接发现未完整覆盖，未判断孤立页面。'}</p>
      <label>筛选发现<select value={rule} onChange={(event) => { setRule(event.target.value); setFindingPage(1); }}><option value="">全部（{current.findings.length}）</option>{[...new Set<string>(current.findings.map((finding: any) => finding.rule))].map((key) => <option key={key} value={key}>{current.findings.find((finding: any) => finding.rule === key).message}</option>)}</select></label>
      <div className="table-scroll"><table><thead><tr><th>页面</th><th>发现</th><th>处理方法</th></tr></thead><tbody>{findings.slice((page - 1) * 20, page * 20).map((finding: any) => <tr key={finding.id}><td><a href={finding.path} target="_blank" rel="noreferrer">{finding.path}</a></td><td>{finding.message}{finding.evidence && <small className="muted"> {finding.evidence}</small>}</td><td>{finding.action}</td></tr>)}</tbody></table></div>
      {pages > 1 && <nav className="pagination" aria-label="检查结果分页"><button disabled={page === 1} onClick={() => setFindingPage(page - 1)}>上一页</button><span>{page} / {pages}</span><button disabled={page === pages} onClick={() => setFindingPage(page + 1)}>下一页</button></nav>}
      {!current.findings.length && <p>已检查范围内没有需要处理的项目。</p>}</> : <p className="muted">尚无检查记录。</p>}
    <section className="form-card"><h2>搜索数据与 AI 观测</h2>
      {external && <><p>{external.status === 'not-connected' ? '尚未接入数据。' : `已保存 ${external.datasets.length} 个数据批次。`}</p><div className="table-scroll"><table><thead><tr><th>来源</th><th>数据</th><th>窗口</th><th>记录数</th></tr></thead><tbody>{external.datasets.map((dataset: any) => <tr key={dataset.id}><td>{dataset.provider} · {dataset.property}</td><td>{dataset.kind}</td><td>{dataset.start}～{dataset.end}</td><td>{dataset.rows}</td></tr>)}</tbody></table></div>
      {external.datasets.map((dataset: any) => <details key={dataset.id}><summary>{dataset.provider} · {dataset.start}～{dataset.end}</summary><pre className="search-data-json">{JSON.stringify(dataset, null, 2)}</pre></details>)}</>}
      <label>导入数据集<input type="file" accept=".json,application/json" onChange={async (event) => { const file = event.target.files?.[0]; if (file) setInput(await file.text()); }} /></label>
      <label>JSON<textarea rows={7} value={input} onChange={(event) => setInput(event.target.value)} /></label>
      <button disabled={busy || !input.trim()} onClick={() => execute(async () => { await api('search-data/import', JSON.parse(input)); setInput(''); await refresh(); })}>校验并导入</button>
    </section>
  </div>;
}
