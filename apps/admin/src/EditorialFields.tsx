import type { Entry } from '@weava/contracts';
export function EditorialFields({ value, onChange, entries, section = 'all' }: { value: Entry; onChange: (patch: Partial<Entry>) => void; entries: any[]; section?: 'all' | 'display' | 'documentation' }) {
  const editorial = value.editorial ?? { featured: false, weight: 0, relatedIds: [] };
  if (section === 'documentation') return null;
  return <>
    <label>文章摘要<textarea rows={3} placeholder="留空时自动使用正文摘要" value={value.description} onChange={(event) => onChange({ description: event.target.value, summaryMode: 'auto' })} /></label>

    <label className="checkbox"><input type="checkbox" checked={editorial.featured} onChange={(event) => onChange({ editorial: { ...editorial, featured: event.target.checked } })} />首页推荐</label>
    </>;
}
