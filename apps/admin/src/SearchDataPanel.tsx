import { useState } from 'react';
import { api } from './api.ts';
import { datasetLabels } from './admin-labels.ts';

function DatasetDetails({ dataset }: { dataset: any }) {
  const [page, setPage] = useState(1);
  const rows: any[] = dataset.pages ?? dataset.observations ?? dataset.data ?? [];
  const pages = Math.max(1, Math.ceil(rows.length / 20));
  const columns: Record<string, [string, string][]> = {
    'search-performance': [['url', '页面'], ['query', '搜索词'], ['date', '日期'], ['clicks', '点击'], ['impressions', '展示']],
    'keyword-rank': [['keyword', '关键词'], ['date', '日期'], ['rank', '排名'], ['country', '国家或地区'], ['device', '设备']],
    'web-analytics': [['url', '页面'], ['date', '日期'], ['sessions', '访问次数'], ['keyEvents', '关键操作'], ['channel', '来源']],
    'ai-observations': [['platform', '平台'], ['query', '提问'], ['answer', '回答'], ['status', '结果']],
  };
  const fields = columns[dataset.kind] ?? [];
  return <details className="settings-disclosure dataset-details">
    <summary>{dataset.provider} · {datasetLabels[dataset.kind] ?? '导入数据'} · {dataset.rows} 条</summary>
    <p>{dataset.property} · {dataset.start} 至 {dataset.end}</p>
    {dataset.notes && <p>{dataset.notes}</p>}
    {dataset.missing > 0 && <p>计划中还有 {dataset.missing} 条记录尚未取得。</p>}
    {rows.length ? <>
      <div className="table-scroll"><table><thead><tr>{fields.map(([key, label]) => <th key={key}>{label}</th>)}</tr></thead>
        <tbody>{rows.slice((page - 1) * 20, page * 20).map((row, index) => <tr key={index}>{fields.map(([key]) => <td key={key}>
          {key === 'status' ? row.status === 'answered' ? '已回答' : '未能取得回答' : key === 'url'
            ? <a href={row.url} target="_blank" rel="noreferrer">{row.url}</a> : row[key] ?? '—'}
          {key === 'answer' && row.citations?.length > 0 && <details><summary>引用来源（{row.citations.length}）</summary>
            {row.citations.map((url: string) => <p key={url}><a href={url} target="_blank" rel="noreferrer">{url}</a></p>)}
          </details>}
        </td>)}</tr>)}</tbody></table></div>
      {pages > 1 && <nav className="pagination" aria-label={`${dataset.provider} 数据分页`}>
        <button disabled={page === 1} onClick={() => setPage(page - 1)}>上一页</button><span>{page} / {pages}</span>
        <button disabled={page === pages} onClick={() => setPage(page + 1)}>下一页</button>
      </nav>}
    </> : <p className="muted">这个批次尚无数据。</p>}
  </details>;
}

export function SearchDataPanel({ data, refresh, busy, execute }: {
  data: any; refresh: () => Promise<any>; busy: boolean; execute: (action: () => Promise<void>) => Promise<void>;
}) {
  return <section className="form-card"><h2>搜索表现与 AI 回答记录</h2>
    {data?.datasets.length ? data.datasets.map((dataset: any) => <DatasetDetails key={dataset.id} dataset={dataset} />) : <p className="muted">暂无搜索数据。</p>}
  </section>;
}
