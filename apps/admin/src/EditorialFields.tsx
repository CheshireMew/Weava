import type { Entry } from '@weava/contracts';
import { useSelectors } from './Selectors.tsx';
import { ReferenceField } from './ReferenceField.tsx';
export function EditorialFields({ value, onChange, entries, section = 'all' }: { value: Entry; onChange: (patch: Partial<Entry>) => void; entries: any[]; section?: 'all' | 'display' | 'documentation' }) {
  const selectors = useSelectors(), editorial = value.editorial ?? { featured: false, weight: 0, relatedIds: [] };
  return <>{section !== 'documentation' && <><details className="settings-disclosure"><summary>摘要设置</summary>
    <label>摘要来源<select value={value.summaryMode ?? 'manual'} onChange={(event) => onChange({ summaryMode: event.target.value as Entry['summaryMode'] })}><option value="manual">手动填写</option><option value="marker">正文分隔标记之前的内容</option><option value="auto">自动提取正文</option></select></label>
    {(value.summaryMode ?? 'manual') === 'manual' && <label>文章摘要<textarea rows={3} value={value.description} onChange={(event) => onChange({ description: event.target.value })} /></label>}
    {value.summaryMode === 'marker' && <p className="muted">在正文源码中用 &lt;!-- more --&gt; 标记摘要结束位置。</p>}
    </details><details className="settings-disclosure"><summary>推荐内容</summary>
    <label className="checkbox"><input type="checkbox" checked={editorial.featured} onChange={(event) => onChange({ editorial: { ...editorial, featured: event.target.checked } })} />首页推荐</label>
    {editorial.featured && <label>推荐排序（数字越大越靠前）<input type="number" value={editorial.weight} onChange={(event) => onChange({ editorial: { ...editorial, weight: Number(event.target.value) } })} /></label>}
    <div>{editorial.relatedIds.map((id) => <ReferenceField key={id} value={id} onChange={(next) => onChange({ editorial: { ...editorial, relatedIds: next ? editorial.relatedIds.map((item) => item === id ? next : item) : editorial.relatedIds.filter((item) => item !== id) } })} />)}<button type="button" onClick={async () => { const target = await selectors.content({ referenceTypes: undefined }); if (target && target.id !== value.id && !editorial.relatedIds.includes(target.id)) onChange({ editorial: { ...editorial, relatedIds: [...editorial.relatedIds, target.id] } }); }}>选择推荐内容</button></div>
    </details></>}{section !== 'display' && <details className="settings-disclosure"><summary>文档导航</summary>
    <label className="checkbox"><input type="checkbox" checked={!!value.documentation} onChange={(event) => onChange({ documentation: event.target.checked ? { group: '使用文档', order: 0 } : undefined })} />加入文档导航</label>
    {value.documentation && <><label>文档分组<input value={value.documentation.group} onChange={(event) => onChange({ documentation: { ...value.documentation!, group: event.target.value } })} /></label><label>文档顺序<input type="number" value={value.documentation.order} onChange={(event) => onChange({ documentation: { ...value.documentation!, order: Number(event.target.value) } })} /></label><div>上级文档<ReferenceField value={value.documentation.parentId ?? ''} onChange={(parentId) => onChange({ documentation: { ...value.documentation!, parentId: parentId || undefined } })} /></div></>}
  </details>}</>;
}
