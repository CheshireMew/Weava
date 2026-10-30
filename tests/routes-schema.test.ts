import { afterEach, expect, it } from 'vitest';
import { Site, previewRedirects, saveRedirects, siteSchema, siteOpenApi, siteTypes } from '@weava/core';
import { entrySchema } from '@weava/contracts';
const sites: Site[] = [], root = 'D:/Tools/cache/weava/tests/routes-schema-' + Date.now(); let sequence = 0;
const create = () => { const site = new Site(root + '/' + sequence++); sites.push(site); return site; };
afterEach(() => sites.splice(0).forEach((site) => site.close()));
it('checks alias batches, publishes only routes and rolls back both route and content history', () => {
  const site = create(), row = site.saveEntry(entrySchema.parse({ id: 'a', kind: 'page', title: '公开标题', path: '/a/' }), null), first = site.publish({ ids: [row.id] });
  site.saveEntry({ ...row.value, title: '待发布修改' }, row.revision);
  const input = { items: [{ source: '/old/', target: '/a/', revision: null }, { source: '/older/', target: '/old/', revision: null }] }, preview = previewRedirects(site, input);
  expect(site.store.list('redirect')).toHaveLength(0); saveRedirects(site, { ...input, review: preview.review });
  expect(site.redirect(new URL('https://example.com/old/'))).toBeNull();
  const published = site.publish({ scope: 'routes' }); expect(published.entries[0].title).toBe('公开标题'); expect(site.redirect(new URL('https://example.com/older/'))).toBe('/a/');
  const current = site.store.get('redirect', '/old/')!, disabling = { items: [{ source: current.id, target: '/a/', revision: current.revision, disabled: true }, { source: '/older/', target: '/a/', revision: site.store.get('redirect', '/older/')!.revision }] };
  saveRedirects(site, { ...disabling, review: previewRedirects(site, disabling).review }); site.publish({ scope: 'routes' }); expect(site.redirect(new URL('https://example.com/old/'))).toBeNull();
  site.rollback(published.id); expect(site.redirect(new URL('https://example.com/old/'))).toBe('/a/'); site.rollback(first.id); expect(site.redirect(new URL('https://example.com/old/'))).toBeNull();
});
it('rejects cycles, stale reviews and invalid targets before writing any alias', () => {
  const site = create(); site.saveEntry(entrySchema.parse({ id: 'a', kind: 'page', title: 'a', path: '/a/' }), null); site.publish({ ids: ['a'] });
  expect(() => previewRedirects(site, { items: [{ source: '/x/', target: '/y/', revision: null }, { source: '/y/', target: '/x/', revision: null }] })).toThrow(/循环/);
  expect(() => previewRedirects(site, { items: [{ source: '/x/', target: '/missing/', revision: null }] })).toThrow(/目标/);
  expect(() => previewRedirects(site, { items: [{ source: '/x/', target: '//external.example/', revision: null }] })).toThrow(/站内/);
  const input = { items: [{ source: '/x/', target: '/a/', revision: null }] }, preview = previewRedirects(site, input); site.publish({ scope: 'routes' });
  expect(() => saveRedirects(site, { ...input, review: preview.review })).toThrow(/预检/); expect(site.store.list('redirect')).toHaveLength(0);
});
it('leaves dormant imported aliases untouched when checking an unrelated published target', () => {
  const site = create(); site.saveEntry(entrySchema.parse({ id: 'live', kind: 'page', title: '公开', path: '/live/' }), null); site.publish({ ids: ['live'] });
  const dormant = site.store.put('redirect', '/?p=1', { target: '/unpublished/', entryId: 'unpublished' }, null);
  const input = { items: [{ source: '/old-live/', target: '/live/', revision: null }] };
  saveRedirects(site, { ...input, review: previewRedirects(site, input).review }); site.publish({ scope: 'routes' });
  expect(site.redirect(new URL('https://example.com/old-live/'))).toBe('/live/'); expect(site.redirect(new URL('https://example.com/?p=1'))).toBeNull();
  expect(site.store.get('redirect', '/?p=1')!.revision).toBe(dormant.revision);
  expect(() => previewRedirects(site, { items: [{ source: dormant.id, ...dormant.value, revision: dormant.revision }] })).toThrow(/尚未发布/);
});
it('exports machine schemas and site-specific types from current definitions', () => {
  const site = create(); site.saveType({ id: 'resource', label: '资源', pathPrefix: '/resources/', template: 'resource', fields: [{ key: 'rating', label: '评分', type: 'number', required: true, min: 0, max: 10 }, { key: 'platform', label: '平台', type: 'select', options: ['Windows', 'Linux'] }] }, null);
  const schema = siteSchema(site), dynamic = schema.types[0].schema as any;
  expect(dynamic.properties.fields.properties.rating.maximum).toBe(10); expect(dynamic.properties.fields.required).toContain('rating');
  const operation = siteOpenApi(site).paths['/api/admin/v1/entry'].post as { requestBody: { content: { 'application/json': { schema: { properties: { value: { properties: Record<string, unknown> } } } } } } };
  expect(operation.requestBody.content['application/json'].schema.properties.value.properties).toHaveProperty('document');
  expect(siteTypes(site)).toContain('"rating": number'); expect(siteTypes(site)).toContain('"Windows" | "Linux"');
});
