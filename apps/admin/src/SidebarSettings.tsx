import type { Settings } from '@weava/contracts';
import type { SiteSidebar } from '../../../packages/contracts/src/site-presentation.ts';

export function legacySidebar(html: string): SiteSidebar {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  return {
    text: [...doc.querySelectorAll('.oc-support-box,p')].map(node => node.textContent?.trim()).filter(Boolean).join('\n'),
    links: [...doc.querySelectorAll('a[href]')].map(link => ({ label: link.textContent?.trim() || link.getAttribute('aria-label') || link.getAttribute('title') || '链接', url: link.getAttribute('href')! })),
  };
}
export function SidebarSettings({ value, onChange }: { value: Settings; onChange: (sidebar: SiteSidebar) => void }) {
  const sidebar = value.sidebar ?? legacySidebar(value.extensions.newsletter?.sidebarHtml ?? '');
  const patch = (index: number, update: Partial<SiteSidebar['links'][number]>) => onChange({ ...sidebar, links: sidebar.links.map((link, i) => i === index ? { ...link, ...update } : link) });
  return <section className="form-card"><h2>首页侧栏</h2>
    <label>文字<textarea rows={2} value={sidebar.text} onChange={event => onChange({ ...sidebar, text: event.target.value })} /></label>
    {sidebar.links.map((link, index) => <div className="friend-settings-row" key={index}><div className="form-columns">
      <label>名称<input value={link.label} onChange={event => patch(index, { label: event.target.value })} /></label>
      <label>网址<input type="url" value={link.url} onChange={event => patch(index, { url: event.target.value })} /></label>
    </div><button type="button" onClick={() => onChange({ ...sidebar, links: sidebar.links.filter((_, i) => i !== index) })}>移除链接</button></div>)}
    <button type="button" onClick={() => onChange({ ...sidebar, links: [...sidebar.links, { label: '', url: '' }] })}>添加链接</button>
  </section>;
}
