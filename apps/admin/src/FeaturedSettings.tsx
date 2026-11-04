import { useRef, useState } from 'react';
import { api } from './api.ts';

export function FeaturedSettings({ order = [], onChange, onError }: { order?: string[]; onChange: (ids: string[]) => void; onError: (message: string) => void }) {
  const [rows, setRows] = useState<any[] | null>(null), [loading, setLoading] = useState(false);
  const requested = useRef(false);
  const positions = new Map(order.map((id, index) => [id, index]));
  const sorted = [...(rows ?? [])].sort((a, b) => (positions.get(a.id) ?? Infinity) - (positions.get(b.id) ?? Infinity) || (b.value.editorial?.weight ?? 0) - (a.value.editorial?.weight ?? 0) || String(b.value.publishedAt).localeCompare(String(a.value.publishedAt)) || a.id.localeCompare(b.id));
  const move = (index: number, offset: number) => { const next = sorted.map(row => row.id); [next[index], next[index + offset]] = [next[index + offset], next[index]]; onChange(next); };
  return <details className="settings-disclosure" onToggle={event => {
    if (!event.currentTarget.open || requested.current) return;
    requested.current = true;
    setLoading(true); api('entries').then(entries => setRows(entries.filter(row => row.value.kind === 'content' && row.published && row.value.visibility !== 'private' && row.value.indexable !== false && row.value.editorial?.featured))).catch(error => { requested.current = false; onError(error.message); }).finally(() => setLoading(false));
  }}><summary>调整首页推荐顺序</summary>
    {loading && <p role="status">正在读取推荐文章…</p>}
    {rows && !sorted.length && <p>暂时没有推荐文章，可以在文章设置中选择“首页推荐”。</p>}
    {sorted.map((row, index) => <div className="featured-order-row" key={row.id}><span>{row.value.title}</span><button type="button" aria-label={'上移 ' + row.value.title} disabled={index === 0} onClick={() => move(index, -1)}>上移</button><button type="button" aria-label={'下移 ' + row.value.title} disabled={index === sorted.length - 1} onClick={() => move(index, 1)}>下移</button></div>)}
  </details>;
}
