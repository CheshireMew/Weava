import React from 'react';
import { schemaTypes, type Entry, type Settings } from '@weava/contracts';

export function SeoFields({ value, onChange, canVerify = true }: { value: Entry; onChange: (patch: Partial<Entry>) => void; canVerify?: boolean }) {
  const seo = value.seo ?? {}, set = (patch: Partial<NonNullable<Entry['seo']>>) => onChange({ seo: { ...seo, ...patch } });
  const evidence = value.evidence ?? [];
  const edit = (index: number, patch: any) => onChange({ evidence: evidence.map((item, i) => i === index ? { ...item, ...patch, ...(('claim' in patch || 'url' in patch || 'title' in patch) ? { status: 'pending' as const } : {}) } : item) });
  return <>
    <details className="seo-fields"><summary>搜索与分享</summary>
      <label>搜索标题<input value={seo.title ?? ''} placeholder={value.title} onChange={(event) => set({ title: event.target.value })} /></label>
      <label>搜索摘要<textarea value={seo.description ?? ''} placeholder={value.description} onChange={(event) => set({ description: event.target.value || undefined })} /></label>
      <label>规范地址<input value={seo.canonical ?? ''} placeholder="使用当前页面地址" onChange={(event) => set({ canonical: event.target.value })} /></label>
      <label>分享图片<input value={seo.image ?? ''} placeholder="使用内容封面或网站默认图片" onChange={(event) => set({ image: event.target.value })} /></label>
      <label>分享图片说明<input value={seo.imageAlt ?? ''} onChange={(event) => set({ imageAlt: event.target.value })} /></label>
      <label>页面语义<select value={seo.schemaType ?? ''} onChange={(event) => set({ schemaType: event.target.value as any || undefined })}><option value="">跟随内容类型</option>{schemaTypes.map((type) => <option key={type}>{type}</option>)}</select></label>
      <label>作者身份<select value={seo.authorType ?? 'Person'} onChange={(event) => set({ authorType: event.target.value as any })}><option value="Person">个人</option><option value="Organization">组织</option></select></label>
      <label>作者主页<input value={seo.authorUrl ?? ''} onChange={(event) => set({ authorUrl: event.target.value })} /></label>
    </details>
    <details className="seo-fields"><summary>来源与核验（{evidence.length}）</summary>
      {evidence.map((item, index) => <fieldset key={item.id}><legend>来源 {index + 1}</legend>
        <label>支持的说法<textarea value={item.claim} onChange={(event) => edit(index, { claim: event.target.value })} /></label>
        <label>来源名称<input value={item.title} onChange={(event) => edit(index, { title: event.target.value })} /></label>
        <label>来源网址<input value={item.url} onChange={(event) => edit(index, { url: event.target.value })} /></label>
        <label>核验日期<input type="date" value={item.verifiedAt ?? ''} onChange={(event) => edit(index, { verifiedAt: event.target.value || undefined })} /></label>
        <label>有效至<input type="date" value={item.validUntil ?? ''} onChange={(event) => edit(index, { validUntil: event.target.value || undefined })} /></label>
        <label>核验状态<select value={item.status} disabled={!canVerify} onChange={(event) => edit(index, { status: event.target.value })}><option value="pending">待核验</option><option value="verified">已核验</option></select></label>
        {!canVerify && <small>来源修改保存后，可以确认核验状态。</small>}
        <button type="button" onClick={() => onChange({ evidence: evidence.filter((_, i) => i !== index) })}>移除这条来源</button>
      </fieldset>)}
      <button type="button" onClick={() => onChange({ evidence: [...evidence, { id: crypto.randomUUID(), claim: '', title: '', url: '', status: 'pending' }] })}>添加来源</button>
    </details>
  </>;
}
export function SiteSeoFields({ value, onChange }: { value: Settings; onChange: (patch: Partial<Settings>) => void }) {
  const seo = value.seo ?? {}, set = (patch: Partial<NonNullable<Settings['seo']>>) => onChange({ seo: { ...seo, ...patch } });
  return <section className="form-card"><h2>搜索与分享</h2>
    <label>发布者身份<select value={seo.publisherType ?? ''} onChange={(event) => set({ publisherType: event.target.value as any || undefined })}><option value="">未声明</option><option value="Person">个人</option><option value="Organization">组织</option></select></label>
    <label>发布者名称<input value={seo.publisherName ?? ''} placeholder={value.name} onChange={(event) => set({ publisherName: event.target.value })} /></label>
    <label>发布者主页<input value={seo.publisherUrl ?? ''} placeholder={value.domain} onChange={(event) => set({ publisherUrl: event.target.value })} /></label>
    <label>默认分享图片<input value={seo.image ?? ''} onChange={(event) => set({ image: event.target.value })} /></label>
    <label>官方资料网址（每行一个）<textarea value={(seo.sameAs ?? []).join('\n')} onChange={(event) => set({ sameAs: event.target.value.split('\n').map((value) => value.trim()).filter(Boolean) })} /></label>
  </section>;
}
