import type { Navigation } from '@weava/contracts';
import { useSelectors } from './Selectors.tsx';

export function NavigationEditor({ value, onChange, depth = 0 }: {
  value: Navigation[]; onChange: (value: Navigation[]) => void; depth?: number;
}) {
  const selectors = useSelectors();
  const patch = (index: number, update: Partial<Navigation>) => onChange(value.map((item, i) => i === index ? { ...item, ...update } : item));
  return <div className="navigation-tree">
    {value.map((item, index) => <div className="navigation-item" key={index}>
      <div className="navigation-row">
        <label>文字<input value={item.label} onChange={(event) => patch(index, { label: event.target.value })} /></label>
        <label>网址<input value={item.url} onChange={(event) => patch(index, { url: event.target.value })} /></label>
        <button type="button" onClick={async () => { const content = await selectors.content(); if (content) patch(index, { url: 'entry:' + encodeURIComponent(content.id) }); }}>选择内容</button>
        <button aria-label="上移导航" disabled={index === 0} onClick={() => {
          const next = [...value]; [next[index - 1], next[index]] = [next[index], next[index - 1]]; onChange(next);
        }}>上移</button>
        <button onClick={() => onChange(value.filter((_, i) => i !== index))}>移除</button>
        {depth < 5 && <button onClick={() => patch(index, { children: [...(item.children ?? []), { label: '新导航', url: '/' }] })}>添加子导航</button>}
      </div>
      {!!item.children?.length && <NavigationEditor value={item.children} onChange={(children) => patch(index, { children })} depth={depth + 1} />}
    </div>)}
    {depth === 0 && <button onClick={() => onChange([...value, { label: '新导航', url: '/' }])}>添加导航</button>}
  </div>;
}
