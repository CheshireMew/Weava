import React, { useEffect, useState } from 'react';
import { api } from './api.ts';
import { PanelSections } from './PanelSections.tsx';
import { SearchDataPanel } from './SearchDataPanel.tsx';

export default function SearchTools() {
  const [reports, setReports] = useState<any[]>([]), [external, setExternal] = useState<any>(null), [selected, setSelected] = useState<any>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [findingPage, setFindingPage] = useState(1), [rule, setRule] = useState('');
  const refresh = async () => { setLoading(true); try { const [reports, data] = await Promise.all([api('seo/audits'), api('search-data')]); setReports(reports); setExternal(data); return reports; } finally { setLoading(false); } };
  useEffect(() => { refresh().catch((error) => setError(error.message)); }, []);
  const execute = async (action: () => Promise<void>) => { if (busy) return; setBusy(true); setError(''); try { await action(); } catch (error: any) { setError(error.message); } finally { setBusy(false); } };
  const current = selected ? reports.find((report) => report.id === selected.id) ?? selected : reports[0];
  const findings = (current?.findings ?? []).filter((finding: any) => !rule || finding.rule === rule), pages = Math.max(1, Math.ceil(findings.length / 20)), page = Math.min(findingPage, pages);
  return <div className="panel"><div className="panel-title"><h1>网站检查</h1><button disabled={busy} onClick={() => execute(async () => { await refresh(); })}>刷新</button></div>
    {error && <p className="error" role="alert">{error}</p>}
    <PanelSections label="网站检查分类" sections={[{ id: "checks", label: "页面检查", content: <>
    <div className="toolbar"><button disabled={busy} onClick={() => execute(async () => { setSelected(await api('seo/audit', { target: 'published', http: true })); await refresh(); })}>检查公开页面</button>
      <button disabled={busy} onClick={() => execute(async () => { setSelected(await api('seo/audit', { target: 'draft' })); await refresh(); })}>检查待发布内容</button></div>
    {reports.length > 0 && <label>检查记录<select value={current?.id ?? ''} onChange={(event) => setSelected(reports.find((report) => report.id === event.target.value))}>{reports.map((report) => <option value={report.id} key={report.id}>{new Date(report.createdAt).toLocaleString()} · {report.target === 'draft' ? '工作稿' : '公开版本'}{report.stale ? ' · 已过期' : ''}</option>)}</select></label>}
    {current ? <><p>{current.stale ? '网站已有修改，请重新检查。' : ''} 已检查 {current.coverage.checked} 页，未能检查 {current.coverage.unavailable} 页。</p>
      <details className="settings-disclosure"><summary>检查范围</summary><p>{current.coverage.source === 'http-response' ? '读取访客实际打开的网页。' : '检查尚未发布的内容。'} 共 {current.coverage.eligible} 页，另检查 {current.coverage.paginationChecked ?? 0} 个分页。{current.coverage.linkDiscoveryComplete === false && '部分链接尚未检查。'}</p></details>
      <label>筛选发现<select value={rule} onChange={(event) => { setRule(event.target.value); setFindingPage(1); }}><option value="">全部（{current.findings.length}）</option>{[...new Set<string>(current.findings.map((finding: any) => finding.rule))].map((key) => <option key={key} value={key}>{current.findings.find((finding: any) => finding.rule === key).message}</option>)}</select></label>
      <div className="table-scroll"><table><thead><tr><th>页面</th><th>发现</th><th>处理方法</th></tr></thead><tbody>{findings.slice((page - 1) * 20, page * 20).map((finding: any) => <tr key={finding.id}><td><a href={finding.path} target="_blank" rel="noreferrer">{finding.path}</a></td><td>{finding.message}{finding.evidence && <small className="muted"> {finding.evidence}</small>}</td><td>{finding.action}</td></tr>)}</tbody></table></div>
      {pages > 1 && <nav className="pagination" aria-label="检查结果分页"><button disabled={page === 1} onClick={() => setFindingPage(page - 1)}>上一页</button><span>{page} / {pages}</span><button disabled={page === pages} onClick={() => setFindingPage(page + 1)}>下一页</button></nav>}
      {!current.findings.length && <p>已检查范围内没有需要处理的项目。</p>}</> : loading ? <p role="status">正在读取检查记录…</p> : !error && <p className="muted">尚无检查记录。</p>}
    </> }, { id: "data", label: "搜索数据", content: <SearchDataPanel data={external} refresh={refresh} busy={busy} execute={execute} /> }]} />

  </div>;
}
