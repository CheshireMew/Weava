import { useEffect, useState } from 'react';
import { api } from './api.ts';
import { LoadingState } from './LoadingState.tsx';

export function FeaturedSettings({ order = [], onChange, onError }: { order?: string[]; onChange: (ids: string[]) => void; onError: (message: string) => void }) {
  const [rows, setRows] = useState<any[] | null>(null), [loading, setLoading] = useState(false);
  const [failure, setFailure] = useState(''), [reload, setReload] = useState(0);
  useEffect(() => {
    let active = true;
    setLoading(true); setFailure('');
    api('entries').then(entries => { if (active) setRows(entries.filter((row: any) => row.value.kind === 'content' && row.published && row.value.visibility !== 'private' && row.value.indexable !== false && row.value.editorial?.featured)); })
      .catch(error => { if (active) { setFailure(error.message); onError(error.message); } }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [reload]);
  const positions = new Map(order.map((id, index) => [id, index]));
  const sorted = [...(rows ?? [])].sort((a, b) => (positions.get(a.id) ?? Infinity) - (positions.get(b.id) ?? Infinity) || (b.value.editorial?.weight ?? 0) - (a.value.editorial?.weight ?? 0) || String(b.value.publishedAt).localeCompare(String(a.value.publishedAt)) || a.id.localeCompare(b.id));
  const move = (index: number, offset: number) => { const next = sorted.map(row => row.id); [next[index], next[index + offset]] = [next[index + offset], next[index]]; onChange(next); };
  return <section className="featured-order"><h3>首页推荐顺序</h3>
    {loading && !rows && <LoadingState label="读取推荐文章" />}
    {failure && <p role="alert">{failure} <button type="button" onClick={() => setReload(value => value + 1)}>重新读取</button></p>}
    {rows && !sorted.length && <p>暂时没有推荐文章，可以在文章设置中选择“首页推荐”。</p>}
    {sorted.map((row, index) => <div className="featured-order-row" key={row.id}><span>{row.value.title}</span><button type="button" aria-label={'上移 ' + row.value.title} disabled={index === 0} onClick={() => move(index, -1)}>上移</button><button type="button" aria-label={'下移 ' + row.value.title} disabled={index === sorted.length - 1} onClick={() => move(index, 1)}>下移</button></div>)}
  </section>;
}
