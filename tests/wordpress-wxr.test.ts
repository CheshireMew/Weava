import { afterEach, describe, expect, it } from 'vitest';
import { createServer } from 'node:http';
import { existsSync, readFileSync } from 'node:fs';
import sharp from 'sharp';
import { Site, convertWordPressWxr, importWordPressWxr, renderEntryTemplate, resolveContentLinks } from '@weava/core';
import { wordpressFixture } from './fixtures/wordpress-wxr.ts';
const sites: Site[] = [], base = 'D:/Tools/cache/weava/tests/wxr-' + Date.now(); let sequence = 0;
const create = () => { const site = new Site(base + '/' + sequence++); sites.push(site); site.saveType({ id: 'post', label: '文章', fields: [], pathPrefix: '/posts/', template: 'article' }, null); return site; };
afterEach(() => sites.splice(0).forEach((site) => site.close()));
describe('standard WordPress WXR import', () => {
  it('preflights complete entries, pages, hierarchy, custom types, reusable blocks, plugin gaps and comments without writes', async () => {
    const site = create(), before = site.store.raw.prepare('SELECT COUNT(*) n FROM revisions').get();
    const report = await importWordPressWxr(site, wordpressFixture(), { dryRun: true, settings: true });
    expect(report).toMatchObject({ entries: 5, pages: 3, content: 2, terms: 3, comments: 2, published: false, dryRun: true });
    expect(report.types.map((type) => type.id)).toEqual(['post', 'wp-book']); expect(report.reviewRequired).toHaveLength(1);
    expect(report.reviewRequired[0].unresolved).toEqual(expect.arrayContaining(['acf/map 依赖原网站动态渲染', '短代码 contact-form-7']));
    expect(site.store.raw.prepare('SELECT COUNT(*) n FROM revisions').get()).toEqual(before); expect(site.release()).toBeNull(); expect(site.store.list('entry')).toEqual([]);
  });
  it('imports editable pages and content, retains original source, comments and identifiers, and repeats without duplicates', async () => {
    const site = create(), xml = wordpressFixture(), report = await importWordPressWxr(site, xml, { settings: true });
    expect(report.importedComments).toBe(2); expect(readFileSync(report.sourcePath!, 'utf8')).toBe(xml);
    const entries = site.store.list('entry'), about = entries.find((row) => row.value.title === '关于我们')!, team = entries.find((row) => row.value.title === '团队页面')!, post = entries.find((row) => row.value.title === '来源文章')!;
    expect(team.value.path).toBe('/about/team/'); expect(about.value.blocks.map((block: any) => block.type)).toEqual(['entry-heading', 'richtext', 'richtext']);
    expect(post.value.author).toBe('作者名字'); expect(post.value.blocks[1].props.caption).toBe('正文图注');
    expect(site.store.list('type').find((row) => row.id === 'wp-book')).toBeTruthy();
    expect(site.terms().find((row) => row.value.label === '教程')!.value.parentId).toBe(site.terms().find((row) => row.value.label === '写作')!.id);
    const release = site.publish(); const html = resolveContentLinks(renderEntryTemplate(release.entries.find((entry) => entry.id === post.id)!, release), release, true);
    expect(html).toContain('href="/about/#team"'); expect(renderEntryTemplate(release.entries.find((entry) => entry.id === about.id)!, release)).toContain('可复用正文');
    expect(site.redirect(new URL('https://target.example/?p=1&campaign=import'))).toBe('/hello/?campaign=import');
    expect(site.redirect(new URL('https://target.example/?page_id=11'))).toBe('/about/team/');
    expect(site.store.raw.prepare("SELECT COUNT(*) n FROM article_comments WHERE status='visible'").get()).toEqual({ n: 1 });
    const again = await importWordPressWxr(site, xml, { settings: true }); expect(again.exchange.created).toEqual([]); expect(again.exchange.updated).toEqual([]); expect(again.importedComments).toBe(0);
    const plugin = entries.find((row) => row.value.title === '原插件页面')!;
    expect(() => site.publish({ ids: [plugin.id] })).toThrow(/先检查/);
    site.saveEntry({ ...plugin.value, compatibility: { wordpress: { ...plugin.value.compatibility.wordpress, reviewed: true } } }, plugin.revision);
    expect(() => site.publish({ ids: [plugin.id] })).not.toThrow();
  });
  it('downloads attachments into the local library and rewrites full-size, thumbnail, cover and responsive URLs atomically', async () => {
    const image = await sharp({ create: { width: 600, height: 300, channels: 3, background: '#557744' } }).png().toBuffer();
    const server = createServer((request, response) => { if (request.url?.endsWith('/photo.png')) { response.setHeader('Content-Type', 'image/png'); response.end(image); } else { response.statusCode = 404; response.end(); } });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const url = 'http://127.0.0.1:' + (server.address() as any).port + '/wp-content/uploads/photo.png';
    try {
      const site = create(); const report = await importWordPressWxr(site, wordpressFixture({ mediaUrl: url }), { downloadMedia: true });
      expect(report.downloaded).toBe(1); const media = site.store.list('media')[0]; expect(media.value.alt).toBe('媒体说明'); expect(existsSync(site.root + media.value.url)).toBe(true);
      const post = site.store.list('entry').find((row) => row.value.title === '来源文章')!; expect(post.value.cover).toBe(media.value.url); expect(post.value.blocks[1].props.src).toBe(media.value.url);
      const repeated = await importWordPressWxr(site, wordpressFixture({ mediaUrl: url }), { downloadMedia: true }); expect(repeated.exchange.updated).toEqual([]); expect(repeated.downloaded).toBe(0);
      const failure = create(); await expect(importWordPressWxr(failure, wordpressFixture({ mediaUrl: url, missingMediaUrl: url.replace('photo.png', 'missing.png') }), { downloadMedia: true })).rejects.toThrow(/404/);
      expect(failure.store.list('entry')).toEqual([]); expect(failure.store.list('media')).toEqual([]); expect(failure.store.raw.prepare('SELECT COUNT(*) n FROM article_comments').get()).toEqual({ n: 0 });
    } finally { await new Promise<void>((resolve) => server.close(() => resolve())); }
  });
  it('rejects malformed XML, broken block structure, duplicate URLs and taxonomy cycles before changing the site', async () => {
    const site = create(), xml = wordpressFixture();
    expect(() => convertWordPressWxr(site, xml.slice(0, -15))).toThrow(/XML/);
    expect(() => convertWordPressWxr(site, xml.replace('<!-- /wp:image -->', '<!-- /wp:paragraph -->'))).toThrow(/标记/);
    expect(() => convertWordPressWxr(site, xml.replace('/hello/</link>', '/about/</link>'))).toThrow(/网址重复/);
    await expect(importWordPressWxr(site, xml.replace('<wp:cat_name>写作', '<wp:category_parent>guides</wp:category_parent><wp:cat_name>写作'))).rejects.toThrow(/循环/);
    expect(site.store.list('entry')).toEqual([]);
    expect(() => convertWordPressWxr(site, xml.replaceAll('wp:', 'other:').replace('xmlns:wp=', 'xmlns:other='))).not.toThrow();
  });
  it('ties a reviewed import to its exact source, options and current worktree revisions, with explicit merge revisions', async () => {
    const site = create(), xml = wordpressFixture();
    const preview = await importWordPressWxr(site, xml, { dryRun: true });
    const settings = site.settings(); site.saveSettings({ ...settings.value, name: '预检后的改动' }, settings.revision);
    await expect(importWordPressWxr(site, xml, { review: preview.review })).rejects.toThrow(/重新预检/);
    await importWordPressWxr(site, xml); const changed = wordpressFixture({ title: '修改后的来源标题' });
    await expect(importWordPressWxr(site, changed)).rejects.toThrow(/冲突/);
    const revisions = Object.fromEntries(site.store.list('entry').map((row) => ['entry:' + row.id, row.revision]));
    const merged = await importWordPressWxr(site, changed, { mode: 'merge', revisions }); expect(merged.exchange.updated).toHaveLength(1);
    expect(site.store.list('entry').some((row) => row.value.title === '修改后的来源标题')).toBe(true);
  });
  it('searches edited blocks instead of the preserved original document', async () => {
    const site = create(); await importWordPressWxr(site, wordpressFixture());
    const post = site.store.list('entry').find((row) => row.value.title === '一本书')!;
    site.saveEntry({ ...post.value, blocks: [{ id: 'updated', type: 'richtext', props: { text: '<p>更新后的独有搜索词</p>' } }] }, post.revision);
    site.publish(); expect(site.search('更新后的独有搜索词').some((hit) => hit.id === post.id)).toBe(true);
    expect(site.search('自定义类型正文').some((hit) => hit.id === post.id)).toBe(false);
  });
  it('reuses an existing same-level category and preserves its slug and child hierarchy', async () => {
    const site = create(); site.saveTerm({ id: 'existing-writing', kind: 'category', label: '写作', slug: 'writing-cn' }, null);
    const report = await importWordPressWxr(site, wordpressFixture());
    expect(site.terms().filter((row) => row.value.label === '写作')).toHaveLength(1);
    expect(site.store.get('term', 'existing-writing')!.value.slug).toBe('writing-cn');
    expect(site.terms().find((row) => row.value.label === '教程')!.value.parentId).toBe('existing-writing');
    expect(report.warnings.some((message) => message.includes('保留其网址 writing-cn'))).toBe(true);
    expect((await importWordPressWxr(site, wordpressFixture())).exchange.updated).toEqual([]);
  });
  it('reports changed comments during preflight and can explicitly preserve the current comments', async () => {
    const site = create(), xml = wordpressFixture(); await importWordPressWxr(site, xml);
    site.store.raw.prepare("UPDATE article_comments SET status='hidden' WHERE author='读者 1'").run();
    await expect(importWordPressWxr(site, xml, { dryRun: true })).rejects.toThrow(/评论.*冲突/);
    expect((await importWordPressWxr(site, xml, { dryRun: true, comments: false })).exchange.updated).toEqual([]);
  });
});
