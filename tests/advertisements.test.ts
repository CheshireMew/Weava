import { afterEach, expect, it } from 'vitest';
import { adminApi } from '@weava/contracts/api';
import { advertisementsSchema, defaultSettings, entrySchema } from '@weava/contracts';
import { Site, exportSite, importSite, projectSettingTerms, settingsPublicationState } from '@weava/core';
import type { Release, Term } from '@weava/contracts';

const sites: Site[] = [];
const root = 'D:/Tools/cache/weava/tests/advertisements-' + Date.now();
const create = () => {
  const site = new Site(root + '/' + sites.length);
  sites.push(site);
  return site;
};
afterEach(() => sites.splice(0).forEach((site) => site.close()));

it('reports pending settings only for real changes, including disabled ads and renamed terms', () => {
  const terms: Term[] = [
    { id: 'category-writing', kind: 'category', label: '写作', slug: 'writing' },
    { id: 'tag-ui', kind: 'tag', label: 'UI', slug: 'ui' },
  ];
  const settings = { ...defaultSettings, taxonomies: [{ id: 'legacy-writing', label: '写作', slug: 'old-writing' }], advertisements: { siteBottom: { enabled: true, html: '<div>广告</div>' } } };
  const published = { settings: JSON.parse(JSON.stringify(projectSettingTerms(settings, terms))), terms: [...terms].reverse() } as Release;
  expect(settingsPublicationState(settings, terms, published)).toEqual({ settingsPending: false, termsPending: false });
  expect(settingsPublicationState({ ...settings, advertisements: { siteBottom: { ...settings.advertisements.siteBottom, enabled: false } } }, terms, published))
    .toEqual({ settingsPending: true, termsPending: false });
  const renamed = terms.map(term => term.kind === 'tag' ? { ...term, label: '界面' } : term);
  expect(settingsPublicationState(settings, renamed, published)).toEqual({ settingsPending: false, termsPending: true });
  expect(settingsPublicationState(settings, terms, null)).toEqual({ settingsPending: true, termsPending: true });
});

it('retains all four HTML slots through API input and output, while accepting old settings', () => {
  const html = '<style>.banner{color:red}</style><a href="/offer/?a=1&b=2">广告</a><iframe src="https://example.com"></iframe><script>window.adLoaded=true</script>';
  const advertisements = Object.fromEntries(
    ['siteTop', 'siteBottom', 'articleTop', 'articleBottom'].map((position) => [position, { enabled: true, html }]),
  );
  const input = adminApi.saveSettings.body.parse({ value: { ...defaultSettings, advertisements }, revision: 1 });
  expect(input.value.advertisements).toEqual(advertisements);
  const result = adminApi.settings.response.parse({ id: 'site', revision: 1, value: input.value, updatedAt: new Date().toISOString() });
  expect(result.value.advertisements).toEqual(advertisements);
  expect(adminApi.saveSettings.body.safeParse({ value: defaultSettings, revision: 1 }).success).toBe(true);
  expect(advertisementsSchema.safeParse({ siteTop: { enabled: 'true', html } }).success).toBe(false);
  expect(advertisementsSchema.safeParse({ siteTop: { enabled: true, html: 42 } }).success).toBe(false);
});

it('keeps advertising drafts separate from publication and restores their published state on rollback', () => {
  const site = create();
  site.saveType({ id: 'post', label: '文章', fields: [], pathPrefix: '/posts/', template: 'article' }, null);
  site.saveEntry(entrySchema.parse({ id: 'article', kind: 'content', title: '文章', path: '/posts/article/', status: 'published' }), null);
  site.publish();
  const original = '<a href="https://example.com">原广告</a><script>window.ad=1</script>';
  let row = site.settings();
  site.saveSettings({ ...row.value, advertisements: { siteTop: { enabled: true, html: original } } }, row.revision);
  expect(site.release()!.settings.advertisements).toBeUndefined();
  const published = site.publish({ scope: 'settings' });
  expect(published.settings.advertisements?.siteTop?.html).toBe(original);
  row = site.settings();
  site.saveSettings({ ...row.value, advertisements: { siteTop: { enabled: false, html: original } } }, row.revision);
  expect(site.release()!.settings.advertisements?.siteTop?.enabled).toBe(true);
  const disabled = site.publish({ scope: 'settings' });
  expect(disabled.settings.advertisements?.siteTop).toEqual({ enabled: false, html: original });
  site.rollback(published.id);
  expect(site.release()!.settings.advertisements?.siteTop).toEqual({ enabled: true, html: original });
});

it('preserves advertising in JSON exchange and rejects invalid direct writes without changing the stored revision', () => {
  const source = create();
  const row = source.settings();
  const advertisements = { articleBottom: { enabled: true, html: '<div style="padding:20px">底部广告</div>' } };
  source.saveSettings({ ...row.value, advertisements }, row.revision);
  const target = create();
  importSite(target, exportSite(source));
  expect(target.settings().value.advertisements).toEqual(advertisements);
  const before = source.settings();
  expect(() => source.saveSettings({ ...before.value, advertisements: { siteTop: { enabled: true, html: null } } } as any, before.revision)).toThrow();
  expect(source.settings()).toEqual(before);
});
