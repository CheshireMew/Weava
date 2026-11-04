import { advertisementSlots, type Advertisements } from '@weava/contracts';
import { HtmlPageText } from './ImportedContentEditor.tsx';
import { useSelectors } from './Selectors.tsx';

export function AdvertisementSettings({ value, onChange }: { value: Advertisements | undefined; onChange: (value: Advertisements) => void }) {
  const selectors = useSelectors();
  return <section className="form-card advertisement-settings"><h2>广告</h2><div className="advertisement-editors">
    {advertisementSlots.map(({ id, label }) => {
      const slot = value?.[id] ?? { enabled: false, html: '' }, content = slot.content ?? { title: '', text: '', image: '', url: '' };
      const patch = (update: Partial<typeof slot>) => onChange({ ...value, [id]: { ...slot, ...update } });
      const edit = (update: Partial<typeof content>) => patch({ content: { ...content, ...update } });
      return <details key={id} className="settings-disclosure" open={slot.enabled || undefined}><summary>{label}</summary>
        <label className="checkbox"><input type="checkbox" checked={slot.enabled} onChange={event => patch({ enabled: event.target.checked })} />启用{label}广告</label>
        {slot.html.trim() && !slot.content ? <HtmlPageText value={slot.html} onChange={html => patch({ html })} minHeight={120} /> : <>
          <label>标题<input value={content.title} onChange={event => edit({ title: event.target.value })} /></label>
          <label>文字<textarea rows={3} value={content.text} onChange={event => edit({ text: event.target.value })} /></label>
          <label>链接<input type="url" value={content.url} onChange={event => edit({ url: event.target.value })} /></label>
          <div className="site-logo">{content.image && <img src={content.image} alt={content.title} />}<button type="button" onClick={async () => { const media = await selectors.media('image'); if (media) edit({ image: media.url }); }}>选择广告图片</button>{content.image && <button type="button" onClick={() => edit({ image: '' })}>移除图片</button>}</div>
        </>}
        <details className="settings-disclosure"><summary>接入第三方广告代码</summary><label>广告代码<textarea className="advertisement-code" rows={5} value={slot.html} onChange={event => patch({ html: event.target.value, content: undefined })} /></label></details>
      </details>;
    })}
  </div></section>;
}
