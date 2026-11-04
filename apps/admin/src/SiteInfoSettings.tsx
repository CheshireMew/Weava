import type { SiteInfo } from '../../../packages/contracts/src/site-info.ts';

export function SiteInfoSettings({ section, value, defaults, onChange }: {
  section: 'about' | 'friends'; value?: SiteInfo; defaults?: SiteInfo; onChange: (value: SiteInfo) => void;
}) {
  if (section === 'about') {
    const about = value?.about ?? defaults?.about ?? { enabled: false, path: '/about/', text: '' };
    const set = (patch: Partial<typeof about>) => onChange({ ...value, about: { ...about, ...patch } });
    return <section className="form-card"><h2>关于本站</h2>
      <label className="checkbox"><input type="checkbox" checked={about.enabled} onChange={event => set({ enabled: event.target.checked })} />显示关于本站</label>
      <label>网站或个人介绍<textarea rows={12} value={about.text} onChange={event => set({ text: event.target.value })} /></label>
    </section>;
  }
  const friends = value?.friends ?? defaults?.friends ?? { enabled: false, path: '/friendlink/', links: [] };
  const set = (patch: Partial<typeof friends>) => onChange({ ...value, friends: { ...friends, ...patch } });
  const patch = (index: number, update: Partial<(typeof friends.links)[number]>) => set({ links: friends.links.map((link, i) => i === index ? { ...link, ...update } : link) });
  return <section className="form-card"><h2>友情链接</h2>
    <label className="checkbox"><input type="checkbox" checked={friends.enabled} onChange={event => set({ enabled: event.target.checked })} />显示友情链接</label>
    <div className="friend-settings-list">{friends.links.map((link, index) => <div className="friend-settings-row" key={index}>
      <div className="form-columns"><label>网站名称<input value={link.name} onChange={event => patch(index, { name: event.target.value })} /></label>
      <label>网址<input type="url" placeholder="https://" value={link.url} onChange={event => patch(index, { url: event.target.value })} /></label></div>
      <label>简介<input value={link.description} onChange={event => patch(index, { description: event.target.value })} /></label>
      <button type="button" onClick={() => set({ links: friends.links.filter((_link, i) => i !== index) })}>移除友情链接</button>
    </div>)}</div>
    <button type="button" onClick={() => set({ enabled: true, links: [...friends.links, { name: '', url: '', description: '' }] })}>添加友情链接</button>
  </section>;
}
