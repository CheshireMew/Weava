import { describe, it, expect } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Site, renderBlocks } from '@weava/core';
import { entrySchema } from '@weava/contracts';

const base = 'D:/Tools/cache/weava/tests/privacy-' + Date.now();
const entry = (id: string, visibility: 'public' | 'private' = 'public') => entrySchema.parse({
  id, kind: 'content', title: id === 'secret' ? '私密记录独有词' : id, path: '/' + id + '/',
  status: 'published', visibility,
  document: { version: 1, format: 'markdown', source: '正文 ' + id },
});
function fixture(name: string) {
  const site = new Site(join(base, name));
  site.saveType({ id:'post',label:'文章',fields:[],pathPrefix:'/posts/',template:'article' }, null);
  return site;
}
describe('private content', () => {
  it('keeps private articles out of visitor snapshots, lists, references and search', () => {
    const site = fixture('surfaces');
    try {
      site.saveEntry(entry('public'), null);
      site.saveEntry(entry('secret', 'private'), null);
      const settings = site.settings();
      site.saveSettings({ ...settings.value, navigation: [{ label:'秘密',url:'/secret/' },{ label:'公开',url:'/public/' }] }, settings.revision);
      site.publish();
      expect(site.visibleRelease()!.entries.map((e) => e.id)).toEqual(['public']);
      expect(site.visibleRelease()!.settings.navigation.map((e) => e.url)).toEqual(['/public/']);
      expect(site.visibleRelease(true)!.entries).toHaveLength(2);
      expect(site.search('私密记录独有词')).toEqual([]);
      const html = renderBlocks([{ id:'list',type:'content-list',props:{} }, { id:'detail',type:'content-detail',props:{ entryId:'secret' } }], site.visibleRelease()!);
      expect(html).not.toContain('私密记录独有词');
      expect(html).not.toContain('正文 secret');
      expect(site.entries().find((e) => e.id === 'secret')!.value.visibility).toBe('private');
    } finally { site.close(); }
  });
  it('applies visibility at publication and preserves it through withdraw and rollback', () => {
    const site = fixture('transition');
    try {
      const row = site.saveEntry(entry('secret'), null);
      const publicRelease = site.publish();
      const changed = site.saveEntry({ ...row.value, visibility:'private' }, row.revision);
      expect(site.visibleRelease()!.entries).toHaveLength(1);
      const privateRelease = site.publish({ ids:[row.id] });
      expect(site.visibleRelease()!.entries).toHaveLength(0);
      site.rollback(publicRelease.id);
      expect(site.visibleRelease()!.entries).toHaveLength(1);
      site.rollback(privateRelease.id);
      const withdrawn = site.withdraw(row.id, changed.revision);
      expect(withdrawn.value.visibility).toBe('private');
      expect(site.visibleRelease(true)!.entries).toHaveLength(0);
    } finally { site.close(); }
  });
  it('protects private originals, derivatives and history while allowing shared public media', () => {
    const site = fixture('media');
    try {
      mkdirSync(join(site.root, 'media/optimized'), { recursive:true });
      for (const file of ['secret.png','shared.png','optimized/secret.webp']) writeFileSync(join(site.root,'media',file),'image');
      site.store.put('media','secret',{ url:'/media/secret.png',derivatives:[{ url:'/media/optimized/secret.webp' }] }, null);
      const secret = site.saveEntry({ ...entry('secret','private'),cover:'/media/secret.png',document:{ version:1,format:'markdown',source:'![共用](/media/shared.png)' } }, null);
      site.saveEntry({ ...entry('public'),cover:'/media/shared.png' },null);
      site.publish();
      expect(site.isPrivateMedia('/media/secret.png')).toBe(true);
      expect(site.isPrivateMedia('/media/optimized/secret.webp')).toBe(true);
      expect(site.isPrivateMedia('/media/shared.png')).toBe(false);
      site.saveEntry({ ...secret.value,cover:'' },secret.revision);
      site.publish();
      expect(site.isPrivateMedia('/media/secret.png')).toBe(true);
    } finally { site.close(); }
  });
  it('does not disclose private article paths through WordPress redirect aliases', () => {
    const site = fixture('aliases');
    try {
      site.saveEntry(entry('secret','private'),null);
      site.saveEntry(entry('public'),null);
      site.store.put('redirect','/?p=42',{ target:'/secret/',entryId:'secret' },null);
      site.store.put('redirect','/?p=43',{ target:'/public/',entryId:'public' },null);
      site.publish();
      expect(site.redirect(new URL('https://example.com/?p=42'))).toBe(null);
      expect(site.redirect(new URL('https://example.com/?p=42'),true)).toBe('/secret/');
      expect(site.redirect(new URL('https://example.com/?p=43&utm_source=test'))).toBe('/public/?utm_source=test');
    } finally { site.close(); }
  });
});
