import { expect, it, vi } from 'vitest';
import { defaultSettings, entrySchema, type PublishedEntry } from '@weava/contracts';
import { applySiteInfo, resolveSiteInfo } from '../packages/core/src/site-info.ts';
import { adminPanel, panelUrl } from '../apps/admin/src/admin-location.ts';

const time = '2026-11-04T00:00:00.000Z';
const entry = (id: string, path: string): PublishedEntry => ({ ...entrySchema.parse({ id, kind: 'page', title: id, path, status: 'published', blocks: [{ id: 'old', type: 'richtext', props: { text: '旧内容' } }] }), html: '<p>旧内容</p>', revisionId: 4, modifiedAt: time });

it('publishes fixed friend links at the legacy URL without changing the underlying entry or unrelated articles', () => {
  const legacy = entry('wordpress:friends', '/friends/'), article = { ...entry('post', '/post/'), kind: 'content' as const };
  const before = structuredClone(legacy), entries = new Map([[legacy.id, legacy], [article.id, article]]);
  const settings = { ...defaultSettings, siteInfo: { friends: { enabled: true, path: '/friends/', entryId: legacy.id, links: [{ name: '朋友的网站', url: 'https://example.com/', description: '一些介绍' }] } } };
  applySiteInfo(entries, settings, 20, time, [legacy, article]);
  expect(entries.size).toBe(2); expect(entries.get(article.id)).toBe(article); expect(legacy).toEqual(before);
  expect(entries.get(legacy.id)).toMatchObject({ id: legacy.id, path: '/friends/', source: { siteInfoRole: 'friends' }, blocks: [] });
  expect(entries.get(legacy.id)!.html).toContain('https://example.com/');
  expect(entries.get(legacy.id)!.html).toContain('朋友的网站');
  const published = entries.get(legacy.id)!;
  applySiteInfo(entries, settings, 21, '2026-11-05T00:00:00Z', [...entries.values()]);
  expect(entries.get(legacy.id)).toBe(published);
  applySiteInfo(entries, { ...settings, siteInfo: { friends: { ...settings.siteInfo.friends, enabled: false } } }, 22, time, [...entries.values()]);
  expect(entries.has(legacy.id)).toBe(false); expect(entries.get(article.id)).toBe(article); expect(legacy).toEqual(before);
  applySiteInfo(entries, settings, 23, time, [...entries.values()]);
  expect(entries.get(legacy.id)?.path).toBe('/friends/'); expect(entries.size).toBe(2);
});

it('generates about information as plain text and checks friend URLs only when publishing an enabled feature', () => {
  const entries = new Map<string, PublishedEntry>();
  applySiteInfo(entries, { ...defaultSettings, siteInfo: { about: { enabled: true, path: '/about/', text: '<script>hello</script>\n第二行' } } }, 1, time);
  const html = entries.get('site-info:about')!.html;
  expect(html).toContain('&lt;script&gt;'); expect(html).not.toContain('<script>'); expect(html).toContain('<br>第二行');
  const friends = { enabled: true, path: '/friendlink/', links: [{ name: '未填网址', url: '', description: '' }] };
  expect(() => applySiteInfo(entries, { ...defaultSettings, siteInfo: { friends } }, 1, time)).toThrow(/完整网址/);
  expect(() => applySiteInfo(entries, { ...defaultSettings, siteInfo: { friends: { ...friends, enabled: false } } }, 1, time)).not.toThrow();
  expect(() => applySiteInfo(entries, { ...defaultSettings, siteInfo: { about: { enabled: true, path: '/', text: '' } } }, 1, time)).toThrow(/网址无效/);
});

it('reads legacy information into simple settings without writing or converting stored records', () => {
  const about = { ...entrySchema.parse({ id: 'about', kind: 'page', title: '关于', path: '/about/', status: 'published', document: { version: 1, format: 'markdown', source: '第一段。\n\n第二段。' } }) };
  const friends = entrySchema.parse({ id: 'friends', kind: 'page', title: '友情链接', path: '/friendlink/', status: 'published', blocks: [{ id: 'body', type: 'richtext', props: { text: '<a href="https://example.com/"><h6>示例网站</h6><p>网站介绍</p></a>' } }] });
  const write = vi.fn(), site = { settings: () => ({ value: defaultSettings }), store: { put: write, raw: { prepare: () => ({ all: () => [about, friends].map(value => ({ data: JSON.stringify(value) })) }) } } } as any;
  const resolved = resolveSiteInfo(site);
  expect(resolved.about).toMatchObject({ path: '/about/', text: '第一段。\n\n第二段。' });
  expect(resolved.friends!.links).toEqual([{ name: '示例网站', url: 'https://example.com/', description: '网站介绍' }]);
  expect(write).not.toHaveBeenCalled();
});

it('routes retired page and layout screens to settings and does not create builder links', () => {
  expect(adminPanel('?panel=pages')).toBe('appearance'); expect(adminPanel('?panel=layouts')).toBe('appearance');
  expect(adminPanel('?panel=terms')).toBe('appearance');
  expect(adminPanel('?panel=redirects')).toBe('content'); expect(adminPanel('?panel=search-tools')).toBe('content');
  expect(() => panelUrl('http://localhost/admin/', 'redirects')).toThrow();
  expect(() => panelUrl('http://localhost/admin/', 'search-tools')).toThrow();
  expect(() => panelUrl('http://localhost/admin/', 'pages')).toThrow();
  expect(() => panelUrl('http://localhost/admin/', 'layouts')).toThrow();
});
