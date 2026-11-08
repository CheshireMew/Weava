import type { Entry, Settings } from '@weava/contracts';
import { useSelectors } from './Selectors.tsx';

export function SeoFields({ value, onChange, section = 'all', expanded = false }: { value: Entry; onChange: (patch: Partial<Entry>) => void; canVerify?: boolean; section?: 'all' | 'sharing' | 'evidence'; expanded?: boolean }) {
  const selectors = useSelectors();
  if (section === 'evidence') return null;
  const seo = value.seo ?? {}, set = (patch: Partial<NonNullable<Entry['seo']>>) => onChange({ seo: { ...seo, ...patch } });
  const fields = <div className="seo-fields" data-field-path="seo">
    <label data-field-path="seo.title">搜索标题<input value={seo.title ?? ''} placeholder={value.title} onChange={event => set({ title: event.target.value || undefined })} /></label>
    <label data-field-path="seo.description">搜索摘要<textarea value={seo.description ?? ''} placeholder={value.description || '使用正文摘要'} onChange={event => set({ description: event.target.value || undefined })} /></label>
    <div className="site-logo"><span>分享图片</span>{(seo.image || value.cover) && <img src={seo.image || value.cover} alt={seo.imageAlt ?? ''} />}
      <button type="button" onClick={async () => { const media = await selectors.media('image'); if (media) set({ image: media.url, imageAlt: media.alt || media.name }); }}>选择图片</button>
      {seo.image && <button type="button" onClick={() => set({ image: undefined, imageAlt: undefined })}>使用文章封面</button>}
    </div>
  </div>;
  return expanded ? fields : <section><h3>搜索与分享</h3>{fields}</section>;
}
export function SiteSeoFields({ value, onChange }: { value: Settings; onChange: (patch: Partial<Settings>) => void }) {
  const selectors = useSelectors(), seo = value.seo ?? {};
  return <section className="form-card"><h2>分享图片</h2><div className="site-logo">
    {(seo.image || value.logo) && <img src={seo.image || value.logo} alt="默认分享图片" />}
    <button type="button" onClick={async () => { const media = await selectors.media('image'); if (media) onChange({ seo: { ...seo, image: media.url } }); }}>选择图片</button>
    {seo.image && <button type="button" onClick={() => onChange({ seo: { ...seo, image: undefined } })}>使用网站标志</button>}
  </div></section>;
}
