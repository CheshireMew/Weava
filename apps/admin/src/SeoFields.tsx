import type { Entry, Settings } from '@weava/contracts';
import { useSelectors } from './Selectors.tsx';
import { SeoPreview } from './SeoPreview.tsx';
import { seoTemplatesSchema } from '@weava/contracts';
import { useState } from 'react';

export function SeoFields({ value, onChange }: { value: Entry; onChange: (patch: Partial<Entry>) => void }) {
  const selectors = useSelectors();
  const [open, setOpen] = useState(false);
  const seo = value.seo ?? {}, set = (patch: Partial<NonNullable<Entry['seo']>>) => onChange({ seo: { ...seo, ...patch } });
  return <details className="settings-disclosure seo-disclosure" onToggle={event => setOpen(event.currentTarget.open)}>
    <summary>搜索和分享预览</summary>
    <div className="seo-fields">
      {open && <SeoPreview input={{ entry: value }} />}
      <details className="seo-disclosure" data-field-path="seo">
        <summary>为这篇内容单独设置</summary>
        <label data-field-path="seo.title">搜索和分享标题<input value={seo.documentTitle ?? seo.title ?? ''} placeholder="自动使用内容标题" maxLength={300} onChange={event => {
          const title = event.target.value || undefined;
          set({ title, ...(seo.documentTitle !== undefined ? { documentTitle: title } : {}) });
        }} /></label>
        <label data-field-path="seo.description">搜索和分享摘要<textarea value={seo.description ?? ''} placeholder="自动使用摘要或正文" maxLength={2000} onChange={event => set({ description: event.target.value || undefined })} /></label>
        <div className="site-logo" data-field-path="seo.image"><span>分享图片</span>{seo.image && <img src={seo.image} alt={seo.imageAlt ?? ''} />}
          <button type="button" onClick={async () => { const media = await selectors.media('image'); if (media) set({ image: media.url, imageAlt: media.alt || media.name }); }}>选择图片</button>
          {seo.image && <button type="button" onClick={() => set({ image: undefined, imageAlt: undefined })}>恢复自动选择</button>}
        </div>
      </details>
    </div>
  </details>;
}
export function SiteSeoFields({ value, onChange }: { value: Settings; onChange: (patch: Partial<Settings>) => void }) {
  const selectors = useSelectors(), seo = value.seo ?? {};
  const templates = seo.templates ?? {};
  const valid = seoTemplatesSchema.safeParse(templates);
  const setTemplate = (key: 'title' | 'description', input: string) => onChange({ seo: { ...seo, templates: { ...templates, [key]: input || undefined } } });
  return <details className="form-card seo-disclosure">
    <summary>搜索和分享默认值</summary>
    <div className="site-logo"><span>默认分享图</span>
      {(seo.image || value.logo) && <img src={seo.image || value.logo} alt="默认分享图" />}
      <button type="button" onClick={async () => { const media = await selectors.media('image'); if (media) onChange({ seo: { ...seo, image: media.url } }); }}>选择图片</button>
      {seo.image && <button type="button" onClick={() => onChange({ seo: { ...seo, image: undefined } })}>恢复自动选择</button>}
    </div>
    <p className="seo-preview-detail">文章没有图片时才使用默认分享图。未设置时会尝试使用网站标志。</p>
    <details className="settings-disclosure seo-disclosure">
      <summary>自定义全站标题和摘要模板</summary>
      <label>标题模板<input value={templates.title ?? ''} placeholder="{title} · {siteName}" onChange={event => setTemplate('title', event.target.value)} maxLength={600} /></label>
      <label>摘要模板<textarea value={templates.description ?? ''} placeholder="{description}" onChange={event => setTemplate('description', event.target.value)} maxLength={2000} rows={2} /></label>
      <p className="seo-preview-detail">留空即使用内容标题和摘要。可用变量 <code>{'{title} {description} {siteName} {type} {author} {page}'}</code></p>
      {!valid.success && <p role="alert" className="error">{valid.error.issues[0]?.message}</p>}
    </details>
  </details>;
}
