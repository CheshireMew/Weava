import type { Entry } from '@weava/contracts';
import { useSelectors } from './Selectors.tsx';
import { ReferenceField } from './ReferenceField.tsx';
export function EditorialFields({ value, onChange, entries }: { value: Entry; onChange: (patch: Partial<Entry>) => void; entries: any[] }) {
  const selectors = useSelectors(), editorial = value.editorial ?? { featured: false, weight: 0, relatedIds: [] };
  return <details className="editorial-fields"><summary>摘要、推荐与文档导航</summary>
    <label>摘要来源<select value={value.summaryMode ?? 'manual'} onChange={(event) => onChange({ summaryMode: event.target.value as Entry['summaryMode'] })}><option value="manual">仅使用手填摘要</option><option value="marker">正文 more 标记之前</option><option value="auto">自动提取正文</option></select></label><p className="muted">已填写摘要时优先使用手填内容。截断标记为 &lt;!-- more --&gt;。</p>
    <label className="checkbox"><input type="checkbox" checked={editorial.featured} onChange={(event) => onChange({ editorial: { ...editorial, featured: event.target.checked } })} />首页推荐</label>
    <label>推荐顺序权重<input type="number" value={editorial.weight} onChange={(event) => onChange({ editorial: { ...editorial, weight: Number(event.target.value) } })} /></label>
    <div>{editorial.relatedIds.map((id) => <ReferenceField key={id} value={id} onChange={(next) => onChange({ editorial: { ...editorial, relatedIds: next ? editorial.relatedIds.map((item) => item === id ? next : item) : editorial.relatedIds.filter((item) => item !== id) } })} />)}<button type="button" onClick={async () => { const target = await selectors.content({ referenceTypes: undefined }); if (target && target.id !== value.id && !editorial.relatedIds.includes(target.id)) onChange({ editorial: { ...editorial, relatedIds: [...editorial.relatedIds, target.id] } }); }}>选择推荐内容</button></div>
    <label className="checkbox"><input type="checkbox" checked={!!value.documentation} onChange={(event) => onChange({ documentation: event.target.checked ? { group: '使用文档', order: 0 } : undefined })} />加入文档导航</label>
    {value.documentation && <><label>文档分组<input value={value.documentation.group} onChange={(event) => onChange({ documentation: { ...value.documentation!, group: event.target.value } })} /></label><label>文档顺序<input type="number" value={value.documentation.order} onChange={(event) => onChange({ documentation: { ...value.documentation!, order: Number(event.target.value) } })} /></label><div>上级文档<ReferenceField value={value.documentation.parentId ?? ''} onChange={(parentId) => onChange({ documentation: { ...value.documentation!, parentId: parentId || undefined } })} /></div></>}
  </details>;
}
