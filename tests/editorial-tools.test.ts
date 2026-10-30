import { afterEach, describe, expect, it } from 'vitest';
import { Site, entrySummary, recommendedEntries, featuredEntries, documentNavigation, scopedFeed, renderEntryTemplate, renderDocument, previewBulkEdit, applyBulkEdit, Engagement, structuredBody } from '@weava/core';
import { entrySchema } from '@weava/contracts';
const root = 'D:/Tools/cache/weava/tests/editorial-' + Date.now(), sites: Site[] = []; let sequence = 0;
const create = () => { const site = new Site(root + '/' + sequence++); sites.push(site); site.saveType({ id: 'post', label: '文章', pathPrefix: '/post/', template: 'article', fields: [{ key: 'rating', label: '评分', type: 'number', max: 10 }] }, null); return site; };
const entry = (id: string, extra = {}) => entrySchema.parse({ id, kind: 'content', type: 'post', title: id, path: '/' + id + '/', ...extra });
afterEach(() => sites.splice(0).forEach((site) => site.close()));
describe('editorial behavior', () => {
  it('previews and atomically applies explicit metadata changes without publishing; rejects stale reviews', () => {
    const site = create(), a = site.saveEntry(entry('a'), null), b = site.saveEntry(entry('b'), null);
    const release = site.publish({ ids: ['a', 'b'] });
    const input = { items: [a, b].map((row) => ({ id: row.id, revision: row.revision })), changes: [{ field: 'author', mode: 'replace' as const, value: '站主' }] };
    const preview = previewBulkEdit(site, input); expect(site.store.get('entry', a.id)!.value.author).toBe('');
    applyBulkEdit(site, { ...input, review: preview.review }); expect(site.store.get('entry', b.id)!.value.author).toBe('站主'); expect(site.release()!.id).toBe(release.id);
    expect(() => applyBulkEdit(site, { ...input, review: preview.review })).toThrow(/变化/);
    const current = [a, b].map((row) => site.store.get('entry', row.id)!);
    const before = current[0].revision;
    expect(() => previewBulkEdit(site, { items: current, changes: [{ field: 'fields.rating', mode: 'replace', value: 20 }] })).toThrow(/评分/);
    expect(site.store.get('entry', a.id)!.revision).toBe(before);
  });
  it('keeps taxonomy identities through append and clear', () => {
    const site = create(); site.saveTerm({ id: 'one', label: '一', slug: 'one', kind: 'tag' }, null); site.saveTerm({ id: 'two', label: '二', slug: 'two', kind: 'tag' }, null);
    let row = site.saveEntry(entry('a', { tags: ['一'], termIds: { tags: ['one'], categories: [] } }), null);
    for (const [mode, value, expected] of [['append', ['two'], ['one', 'two']], ['clear', [], []]] as const) {
      const input = { items: [{ id: row.id, revision: row.revision }], changes: [{ field: 'tags', mode, value: [...value] }] };
      const preview = previewBulkEdit(site, input); row = applyBulkEdit(site, { ...input, review: preview.review })[0];
      expect(row.value.termIds.tags).toEqual(expected);
    }
  });
  it('shares manual precedence and marker/auto summaries across publication and keeps drafts unchanged', () => {
    const source = { version: 1 as const, format: 'markdown' as const, source: '开头摘要\n\n<!-- more -->\n\n后面正文' };
    expect(entrySummary(entry('a', { summaryMode: 'marker', document: source }))).toBe('开头摘要');
    expect(entrySummary(entry('a', { summaryMode: 'marker', description: '手填', document: source }))).toBe('手填');
    expect(entrySummary(entry('a', { summaryMode: 'marker', document: { ...source, source: '没有标记' } }))).toBe('');
    const site = create(), row = site.saveEntry(entry('a', { summaryMode: 'auto', document: source }), null);
    expect(site.publish({ ids: [row.id] }).entries[0].description).toContain('开头摘要'); expect(site.store.get('entry', row.id)!.value.description).toBe('');
    expect(entrySummary(entry('code', { summaryMode: 'auto', document: { version: 1, format: 'markdown', source: '```ts\nconst count = 1;\n```' } }))).toBe('const count = 1;');
  });
  it('builds ordered document trees and breadcrumbs and refuses cycles or inaccessible parents', () => {
    const site = create();
    for (const value of [entry('root', { documentation: { group: '指南', order: 1 } }), entry('child', { documentation: { group: '指南', order: 2, parentId: 'root' } }), entry('last', { documentation: { group: '指南', order: 3 } })]) site.saveEntry(value, null);
    const release = site.publish({ ids: ['root', 'child', 'last'] }), nav = documentNavigation(release.entries.find((item) => item.id === 'child')!, release)!;
    expect(nav.items.map((item) => item.id)).toEqual(['root', 'child', 'last']); expect(nav.breadcrumbs[0].id).toBe('root'); expect(nav.next!.id).toBe('last');
    expect(renderEntryTemplate(release.entries[1], release)).toContain('文档导航');
    const row = site.store.get('entry', 'root')!; site.saveEntry({ ...row.value, documentation: { ...row.value.documentation, parentId: 'child' } }, row.revision);
    expect(() => site.publish({ ids: ['root'] })).toThrow(/循环/); expect(site.release()!.id).toBe(release.id);
  });
  it('derives marker summaries from the current nested block body after conversion', () => {
    const site = create();
    const value = entry('cards', { summaryMode: 'marker', document: { version: 1, format: 'markdown', source: '旧摘要<!-- more -->旧正文' }, blocks: [{ id: 'group', type: 'container', props: {}, children: [{ id: 'current', type: 'richtext', props: { text: '新的摘要。\n\n<!-- more -->\n\n新的后文。' } }, { id: 'later', type: 'text', props: { text: '不在摘要中' } }] }] });
    const row = site.saveEntry(value, null); expect(site.publish({ ids: [row.id] }).entries[0].description).toBe('新的摘要。');
    expect(site.store.get('entry', row.id)!.value.blocks[0].children[0].props.text).toContain('新的后文');
    const current = site.store.get('entry', row.id)!; site.saveEntry({ ...current.value, blocks: [{ id: 'without-marker', type: 'text', props: { text: '当前正文没有标记' } }] }, current.revision);
    expect(site.publish({ ids: [row.id] }).entries[0].description).toBe('');
  });
  it('distinguishes editorial priorities, topic relevance and filtered public feeds', () => {
    const site = create();
    for (const value of [entry('a', { tags: ['代码'], editorial: { relatedIds: ['c'] } }), entry('b', { tags: ['代码'] }), entry('c', { editorial: { featured: true, weight: 10 } }), entry('private', { visibility: 'private', tags: ['代码'] })]) site.saveEntry(value, null);
    const release = site.publish({ ids: ['a', 'b', 'c', 'private'] });
    expect(recommendedEntries(release.entries[0], release).map((item) => item.id)).toEqual(['c', 'b']);
    expect(featuredEntries(release.entries)[0].id).toBe('c'); expect(scopedFeed(release, new URLSearchParams('type=post')).some((item) => item.id === 'private')).toBe(false);
  });
  it('updates document navigation on withdrawal and restores it with the public snapshot', () => {
    const site=create();const root=site.saveEntry(entry('nav-root',{documentation:{group:'回退文档',order:1}}),null);
    const child=site.saveEntry(entry('nav-child',{documentation:{group:'回退文档',order:2,parentId:root.id}}),null);
    const release=site.publish({ids:[root.id,child.id]});expect(documentNavigation(release.entries.find((entry)=>entry.id===root.id)!,release)!.next!.id).toBe(child.id);
    site.withdraw(child.id,child.revision);const withdrawn=site.release()!;expect(documentNavigation(withdrawn.entries.find((entry)=>entry.id===root.id)!,withdrawn)!.next).toBeNull();
    site.rollback(release.id);const restored=site.release()!;expect(documentNavigation(restored.entries.find((entry)=>entry.id===root.id)!,restored)!.next!.id).toBe(child.id);
    expect(site.store.get('entry',child.id)!.revision).not.toBe(child.revision);
  });
  it('fills recommendations with latest eligible articles after manual and related results', () => {
    const site = create();
    for (const value of [entry('current', { publishedAt: '2026-01-03T00:00:00Z', tags: ['topic'], editorial: { relatedIds: ['manual', 'manual'] } }), entry('manual', { publishedAt: '2026-01-01T00:00:00Z' }), entry('related', { tags: ['topic'], publishedAt: '2026-01-02T00:00:00Z' }), entry('latest', { publishedAt: '2026-05-01T00:00:00Z' }), entry('tie-a', { publishedAt: '2026-04-01T00:00:00Z' }), entry('tie-b', { publishedAt: '2026-04-01T00:00:00Z' }), entry('private', { visibility: 'private', publishedAt: '2026-12-01T00:00:00Z' }), entry('unlisted', { indexable: false, publishedAt: '2026-12-02T00:00:00Z' })]) site.saveEntry(value, null);
    const release = site.publish({ ids: ['current','manual','related','latest','tie-a','tie-b','private','unlisted'] }), current = release.entries.find((item) => item.id === 'current')!;
    expect(recommendedEntries(current,release,5).map((item)=>item.id)).toEqual(['manual','related','latest','tie-a','tie-b']);
    expect(recommendedEntries(current,release,2).map((item)=>item.id)).toEqual(['manual','related']);
    expect(recommendedEntries(current,release,0)).toEqual([]);
    const noTopics = release.entries.find((item)=>item.id==='manual')!;
    expect(recommendedEntries(noTopics,release,2).map((item)=>item.id)).toEqual(['latest','tie-a']);
  });
  it('keeps code literal, language, line numbers and highlight lines in Markdown, Lexical and block rendering', () => {
    const source = 'const text = "<script>{{ value }}</script>";\nreturn text;\n';
    const html = renderDocument({ version: 1, format: 'markdown', source: '```ts linenos {2}\n' + source + '```' });
    expect(html).toContain('syntax-d73a49'); expect(html).toContain('line-numbers'); expect(html).toContain('highlighted'); expect(html).not.toContain('<script>');
    expect(decodeURIComponent(/data-code-source="([^"]+)"/.exec(html)![1])).toBe(source);
    expect(renderDocument({ version: 1, format: 'lexical', source: { root: { type: 'root', children: [{ type: 'code', language: 'python', children: [{ type: 'text', text: 'print("你好")' }] }] } } })).toContain('language-python');
    expect(structuredBody(entry('a', { document: { version: 1, format: 'markdown', source: '# 原正文' } }))[0].props.text).toBe('# 原正文');
  });
  it('holds comments for review without exposing counts and keeps moderation idempotent', async () => {
    const site = create(), engagement = new Engagement(site.store.raw, 'secret', { code: () => 'A2BCD' });
    const token = 'a'.repeat(64), captcha = await engagement.createCaptcha(token, 'network');
    const input = { author: '访客', body: '待审核评论', captchaId: captcha.id, captcha: 'A2BCD', clientId: 'new-pending-comment' };
    const comment = engagement.postComment('a', token, 'network', input, 'pending');
    expect(engagement.summary('a').comments).toBe(0); expect(engagement.comments('pending').total).toBe(1);
    expect(engagement.postComment('a', token, 'network', input, 'pending').id).toBe(comment.id);
    engagement.moderate(comment.id, 'visible'); expect(engagement.summary('a').comments).toBe(1);
  });
  it('retains independent theme settings in instance storage', () => {
    const site = create(), settings = site.settings();
    const a = site.saveSettings({ ...settings.value, themeConfig: { ...settings.value.themeConfig, width: 1200 } }, settings.revision);
    const b = site.saveSettings({ ...a.value, theme: 'newsletter', themeConfig: { ...a.value.themeConfig, width: 900 } }, a.revision);
    expect(b.value.themeSettings.weava.width).toBe(1200); expect(b.value.themeSettings.newsletter.width).toBe(900);
  });
});
