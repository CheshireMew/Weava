import { useRef, useState } from 'react';
import { advertisementSlots, type AdvertisementPosition, type Advertisements } from '@weava/contracts';
import { HtmlPageText } from './ImportedContentEditor.tsx';
import { useSelectors } from './Selectors.tsx';

type Advertisement = NonNullable<Advertisements[AdvertisementPosition]>;
const escape = (text: string) => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');

// Keep legacy HTML byte-for-byte. Structured ads are converted only after an edit.
function advertisementSource(slot: Advertisement) {
  if (!slot.content) return slot.html;
  const { title, text, image, url } = slot.content;
  if (![title, text, image].some(value => value.trim())) return '';
  const body = (image ? `<img src="${escape(image)}" alt="${escape(title)}" loading="lazy" style="max-width:100%;height:auto;margin-inline:auto">` : '')
    + (title ? `<strong style="display:block;font-size:1.1em">${escape(title)}</strong>` : '')
    + (text ? `<p style="margin:8px 0 0;white-space:pre-line">${escape(text)}</p>` : '');
  return '<div style="padding:20px;border:1px solid #ddd;border-radius:8px;text-align:center">'
    + (url ? `<a href="${escape(url)}" target="_blank" rel="sponsored noopener noreferrer" style="display:block;color:inherit;text-decoration:none">${body}</a>` : body) + '</div>';
}

function AdvertisementEditor({ id, label, slot, onChange }: { id: AdvertisementPosition; label: string; slot: Advertisement; onChange: (value: Advertisement) => void }) {
  const selectors = useSelectors();
  const [code, setCode] = useState(false);
  const source = advertisementSource(slot);
  const edit = (html: string) => onChange({ ...slot, html, content: undefined });
  const content = slot.content ?? { title: '', text: '', image: '', url: '' };
  const editContent = (update: Partial<typeof content>) => onChange({ ...slot, content: { ...content, ...update } });
  return <section className="advertisement-slot" data-advertisement={id} aria-label={`${label}广告设置`}>
    <div className="advertisement-heading">
      <h3>{label}</h3>
      <div className="advertisement-controls">
      <button type="button" className="advertisement-switch" role="switch" aria-label={`启用${label}广告`} aria-checked={slot.enabled} onClick={() => onChange({ ...slot, enabled: !slot.enabled })}>
        <span>启用</span><span className="advertisement-switch-track" aria-hidden="true" />
      </button>
      <button type="button" className="advertisement-switch" role="switch" aria-label={`${label}广告代码模式`} aria-checked={code} onClick={() => setCode(!code)}>
        <span>代码</span><span className="advertisement-switch-track" aria-hidden="true" />
      </button>
      </div>
    </div>
    <div className="advertisement-editor">
      {code ? <textarea aria-label={`${label}广告代码`} className="advertisement-code" rows={8} spellCheck={false} autoCapitalize="off" autoCorrect="off" value={source} onChange={event => edit(event.target.value)} />
        : slot.html.trim() && !slot.content ? <HtmlPageText value={source} onChange={edit} minHeight={120} /> : <>
          <label>标题<input value={content.title} onChange={event => editContent({ title: event.target.value })} /></label>
          <label>文字<textarea rows={3} value={content.text} onChange={event => editContent({ text: event.target.value })} /></label>
          <label>链接<input type="url" value={content.url} onChange={event => editContent({ url: event.target.value })} /></label>
          <div className="site-logo">{content.image && <img src={content.image} alt={content.title} />}<button type="button" onClick={async () => { const media = await selectors.media('image'); if (media) editContent({ image: media.url }); }}>选择广告图片</button>{content.image && <button type="button" onClick={() => editContent({ image: '' })}>移除图片</button>}</div>
        </>}
    </div>
  </section>;
}

export function AdvertisementSettings({ value, onChange }: { value: Advertisements | undefined; onChange: (value: Advertisements) => void }) {
  const current = useRef(value);
  current.current = value;
  const change = (id: AdvertisementPosition, slot: Advertisement) => {
    const next = { ...current.current, [id]: slot };
    current.current = next;
    onChange(next);
  };
  return <section className="form-card advertisement-settings"><h2>广告</h2><div className="advertisement-editors">
    {advertisementSlots.map(({ id, label }) => <AdvertisementEditor key={id} id={id} label={label} slot={value?.[id] ?? { enabled: false, html: '' }} onChange={slot => change(id, slot)} />)}
  </div></section>;
}
