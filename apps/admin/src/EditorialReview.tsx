import type { Entry, Evidence } from '@weava/contracts';
import { Plus, Check } from 'lucide-react';

export function EditorialReview({ value, onChange, canVerify }: { value: Entry; onChange: (patch: Partial<Entry>) => void; canVerify: boolean }) {
  const sources = value.evidence ?? [];
  const today = new Date().toISOString().slice(0, 10);
  const change = (id: string, patch: Partial<Evidence>) => onChange({ evidence: sources.map(source => source.id === id ? { ...source, ...patch } : source) });
  const updateSource = (id: string, patch: Partial<Evidence>) => change(id, { ...patch, status: 'pending', verifiedAt: undefined });
  const updateSeo = (patch: Partial<NonNullable<Entry['seo']>>) => onChange({ seo: { ...value.seo, ...patch } });
  return <div className="editorial-review">
    <section className="seo-author-fields" aria-label="作者信息">
      <h3>作者信息</h3>
      <label>作者姓名<input value={value.author} onChange={event => onChange({ author: event.target.value })} /></label>
      <label data-field-path="seo.authorUrl">作者主页<input placeholder="https://…" value={value.seo?.authorUrl ?? ''} onChange={event => updateSeo({ authorUrl: event.target.value || undefined })} /></label>
      <label data-field-path="seo.authorBio">作者简介<textarea rows={2} maxLength={500} value={value.seo?.authorBio ?? ''} onChange={event => updateSeo({ authorBio: event.target.value || undefined })} /></label>
    </section>
    <section aria-label="来源核验" data-field-path="evidence">
      <div className="seo-section-heading"><h3>来源核验</h3><button type="button" disabled={sources.length >= 200} onClick={() => onChange({ evidence: [...sources, { id: crypto.randomUUID(), claim: '', title: '', url: '', status: 'pending' }] })}><Plus size={15}/>添加来源</button></div>
      {sources.map((source, index) => {
        const expired = !!source.validUntil && source.validUntil < today;
        const verified = source.status === 'verified';
        const ready = canVerify && !!source.claim.trim() && !!source.url.trim() && !expired;
        return <fieldset className="seo-evidence-card" key={source.id} data-field-path={`evidence.${index}`}>
          <legend>{source.title || `来源 ${index + 1}`}</legend>
          <label data-field-path={`evidence.${index}.claim`}>需要核对的说法<textarea rows={2} value={source.claim} onChange={event => updateSource(source.id, { claim: event.target.value })} /></label>
          <label data-field-path={`evidence.${index}.title`}>来源名称<input value={source.title} onChange={event => updateSource(source.id, { title: event.target.value })} /></label>
          <label data-field-path={`evidence.${index}.validUntil`}>复核期限<input type="date" value={source.validUntil ?? ''} onChange={event => updateSource(source.id, { validUntil: event.target.value || undefined })} /></label>
          <label data-field-path={`evidence.${index}.url`}>来源网址<input value={source.url} placeholder="https://…" onChange={event => updateSource(source.id, { url: event.target.value })} /></label>
          <div className="seo-review-actions">
            <span role="status">{verified ? (expired ? '需要复核' : `已核验 · ${source.verifiedAt}`) : '待核验'}</span>
            <button type="button" onClick={() => onChange({ evidence: sources.filter(item => item.id !== source.id) })}>移除来源</button>
            {verified && !expired ? <button type="button" onClick={() => updateSource(source.id, {})}>重新核验</button> : <button type="button" disabled={!ready} onClick={() => change(source.id, { status: 'verified', verifiedAt: today })}><Check size={15}/>确认已核验</button>}
          </div>
          {expired && <p className="seo-preview-detail">请核对来源并更新复核期限。</p>}
        </fieldset>;
      })}
    </section>
  </div>;
}
