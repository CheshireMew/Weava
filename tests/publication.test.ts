import { afterEach, describe, expect, it } from 'vitest';
import { mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { Site, renderBlocks, renderNavigation, queryEntries, contentQuery, SCHEMA_VERSION, resolveContentLinks } from '@weava/core';
import { entrySchema, type Entry } from '@weava/contracts';

const base = 'D:/Tools/cache/weava/tests/publication-' + Date.now();
let counter = 0;
const sites: Site[] = [];
const create = () => { const site = new Site(join(base, String(counter++))); sites.push(site);
  site.saveType({ id: 'post', label: '文章', pathPrefix: '/posts/', template: 'article', fields: [] }, null); return site; };
const entry = (id: string, extra: Partial<Entry> = {}) => entrySchema.parse({ id, kind: 'content', title: id,
  path: '/' + id + '/', status: 'published', document: { version: 1, format: 'markdown', source: '原正文' }, ...extra });
afterEach(() => { sites.splice(0).forEach((site) => site.close()); });

describe('publication boundaries and candidate validation', () => {
  it('publishes settings without selecting an unrelated content revision, and freezes the reviewed state', () => {
    const site = create();
    const original = site.saveEntry(entry('one'), null);
    const first = site.publish();
    site.saveEntry({ ...original.value, title: '尚未发布的改稿' }, original.revision);
    const settings = site.settings();
    site.saveSettings({ ...settings.value, name: '新站名' }, settings.revision);
    const review = site.previewPublication({ scope: 'settings' });
    expect(review.entries).toEqual([]);
    expect(site.release()!.id).toBe(first.id);
    const changed = site.publish(review.options);
    expect(changed.settings.name).toBe('新站名');
    expect(changed.entries[0].title).toBe('one');
    expect(() => site.publish(review.options)).toThrow(/公开版本已变化/);
    const next = site.previewPublication({ ids: ['one'] });
    const row = site.store.get('entry', 'one')!;
    site.saveEntry({ ...row.value, title: '预览后再次改稿' }, row.revision);
    expect(() => site.publish(next.options)).toThrow(/工作稿已变化/);
  });
  it('keeps the first settings-only publication empty and requires explicit new draft selection', () => {
    const site = create(); site.saveEntry(entry('one'), null);
    expect(site.publish({ scope: 'settings' }).entries).toEqual([]);
    expect(() => site.publish({ scope: 'entries', ids: [] })).toThrow(/请选择/);
    expect(site.publish({ ids: ['one'] }).entries).toHaveLength(1);
  });
  it('rejects invalid timestamps and block props at save, and checks legacy rows before committing', () => {
    const site = create(); site.saveEntry(entry('good'), null); const before = site.publish();
    expect(() => site.saveEntry({ ...entry('bad'), publishedAt: 'not-a-date' }, null)).toThrow();
    expect(() => site.saveEntry(entry('bad', { kind: 'page', blocks: [{ id: 'g', type: 'gallery', props: { images: 'wrong' } }] }), null)).toThrow(/画廊/);
    site.store.put('entry', 'legacy-bad', { ...entry('legacy-bad'), blocks: [{ id: 'g', type: 'gallery', props: { images: 'wrong' } }] }, null);
    expect(() => site.publish()).toThrow(/画廊/);
    expect(site.release()!.id).toBe(before.id);
  });
  it('keeps incomplete draft fields but refuses dangling block references and internal buttons at publication', () => {
    const site = create();
    const row = site.saveEntry(entry('page', { kind: 'page', blocks: [{ id: 'button', type: 'button', props: {} }] }), null);
    expect(() => site.publish()).toThrow(/网址/);
    const dangling = site.saveEntry({ ...row.value, blocks: [{ id: 'button', type: 'button', props: { url: '/missing/' } }] }, row.revision);
    expect(() => site.publish()).toThrow(/引用无效/);
    site.saveEntry({ ...dangling.value, blocks: [{ id: 'content', type: 'content-detail', props: { entryId: 'missing' } }] }, dangling.revision);
    expect(() => site.publish()).toThrow(/引用无效/);
  });
  it('rolls all candidate objects back when commit fails', () => {
    const site = create(); const row = site.saveEntry(entry('one'), null); const first = site.publish();
    const objects = site.store.raw.prepare('SELECT COUNT(*) n FROM publication_objects').get();
    site.saveEntry({ ...row.value, title: 'changed' }, row.revision);
    expect(() => site.publish({ failAt: 'commit' })).toThrow(/提交/);
    expect(site.store.raw.prepare('SELECT COUNT(*) n FROM publication_objects').get()).toEqual(objects);
    expect(site.release()!.id).toBe(first.id);
  });
});

describe('search, querying, routes and content relationships', () => {
  it('indexes nested block text without indexing private pages or dynamic list contents', () => {
    const site = create();
    site.saveEntry(entry('page', { kind: 'page', blocks: [{ id: 'c', type: 'container', props: {}, children: [
      { id: 't', type: 'text', props: { text: '页面独有关键词' } },
      { id: 'f', type: 'faq', props: { items: [{ question: '独有问题', answer: '完整回答' }] } },
    ] }] }), null);
    site.saveEntry(entry('private', { visibility: 'private', blocks: [{ id: 't', type: 'text', props: { text: '私有关键词' } }] }), null);
    const first = site.publish();
    expect(site.search('页面独有关键词').map((item) => item.id)).toEqual(['page']);
    expect(site.search('独有问题')).toHaveLength(1);
    expect(site.search('私有关键词')).toHaveLength(0);
    const row = site.store.get('entry', 'page')!; site.withdraw('page', row.revision);
    expect(site.search('页面独有关键词')).toHaveLength(0);
    site.rollback(first.id); expect(site.search('页面独有关键词')).toHaveLength(1);
  });
  it('creates direct path history, resolves stable content links and restores the old routing on rollback', () => {
    const site = create(); let row = site.saveEntry(entry('article'), null);
    site.saveEntry(entry('links', { kind: 'page', document: { version: 1, format: 'markdown', source: '[文章](entry:article)' } }), null);
    const first = site.publish();
    row = site.saveEntry({ ...row.value, path: '/second/' }, row.revision); site.publish({ ids: ['article'] });
    row = site.saveEntry({ ...row.value, path: '/third/' }, row.revision); const current = site.publish({ ids: ['article'] });
    expect(site.redirect(new URL('https://example.test/article/?utm=test'))).toBe('/third/?utm=test');
    expect(site.redirect(new URL('https://example.test/second/'))).toBe('/third/');
    const html = renderBlocks([{ id: 'b', type: 'button', props: { url: 'entry:article', label: '详情' } }], current);
    expect(html).toContain('href="/third/"');
    site.rollback(first.id);
    expect(site.redirect(new URL('https://example.test/article/'))).toBeNull();
    expect(site.redirect(new URL('https://example.test/second/'))).toBeNull();
  });
  it('uses stable category IDs across renaming, filtering, block queries and rollback', () => {
    const site = create(); const settings = site.settings();
    site.saveSettings({ ...settings.value, taxonomies: [{ id: 'topic', label: '旧名称' }] }, settings.revision);
    site.saveEntry(entry('article', { categories: ['旧名称'] }), null);
    site.saveEntry(entry('list', { kind: 'page', blocks: [{ id: 'list', type: 'content-list', props: { category: '旧名称' } }] }), null);
    const first = site.publish();
    const changed = site.settings();
    site.saveSettings({ ...changed.value, taxonomies: [{ id: 'topic', label: '新名称', slug: 'new-name' }] }, changed.revision);
    const next = site.publish({ scope: 'settings' });
    const article = next.entries.find((item) => item.id === 'article')!;
    expect(article.categories).toEqual(['新名称']); expect(article.termIds?.categories).toEqual(['topic']);
    expect(queryEntries(next.entries, { category: 'topic', kind: 'content' }).total).toBe(1);
    expect(renderBlocks(next.entries.find((item) => item.id === 'list')!.blocks, next)).toContain('href="/article/"');
    site.rollback(first.id); expect(site.release()!.entries.find((item) => item.id === 'article')!.categories).toEqual(['旧名称']);
    const term = site.terms().find((row) => row.id === 'topic')!;
    expect(() => site.saveTerm({ ...term.value, parentId: 'topic' }, term.revision)).toThrow(/循环/);
  });
  it('uses deterministic real pagination and preserves other URL parameters', () => {
    const site = create();
    for (let i = 0; i < 33; i++) site.saveEntry(entry('item-' + i, { fields: { year: 2026 }, categories: ['测试'] }), null);
    const release = site.publish();
    const block = [{ id: 'list', type: 'content-list', props: {} }];
    const first = renderBlocks(block, release, undefined, {}, { url: new URL('https://example.test/?sort=date') });
    const second = renderBlocks(block, release, undefined, {}, { url: new URL('https://example.test/?sort=date&page=2') });
    expect((first.match(/class="card"/g) ?? []).length).toBe(24);
    expect((second.match(/class="card"/g) ?? []).length).toBe(9);
    expect(first).toContain('sort=date&amp;page=2');
    expect(queryEntries(release.entries, contentQuery(new URLSearchParams('pageSize=1&page=2&type=missing'))).items).toEqual([]);
    expect(queryEntries(release.entries, { fields: { year: 2026 }, pageSize: 10 }).total).toBe(33);
    expect(() => queryEntries(release.entries, { page: NaN })).toThrow(/页码/);
    expect(renderNavigation([{ label: '父导航', url: '/', children: [{ label: '子导航', url: '/child/' }] }])).toContain('子导航');
  });
  it('rejects missing stable links and redirect loops before switching, but renders unavailable public targets without a server error', () => {
    const site = create();
    const row = site.saveEntry(entry('one'), null); const first = site.publish();
    site.saveEntry({ ...row.value, document: { version: 1, format: 'markdown', source: '[链接](entry:missing)' } }, row.revision);
    expect(() => site.publish()).toThrow(/关联内容不存在/);
    expect(site.release()!.id).toBe(first.id);
    expect(resolveContentLinks('<p><a href="entry:missing">链接文字</a></p>', first)).toBe('<p>链接文字</p>');
    site.store.put('redirect', '/loop-a/', { target: '/loop-b/' }, null);
    site.store.put('redirect', '/loop-b/', { target: '/loop-a/' }, null);
    expect(() => site.publish({ scope: 'routes' })).toThrow(/循环/);
    expect(site.release()!.id).toBe(first.id);
  });
});

describe('compact immutable publication storage and upgrades', () => {
  it('reuses unchanged entry objects and search indexes across publication, withdrawal and rollback', () => {
    const site = create();
    for (let i = 0; i < 20; i++) site.saveEntry(entry('item-' + i), null);
    const first = site.publish();
    for (let i = 0; i < 4; i++) { const row = site.store.get('entry', 'item-0')!;
      site.saveEntry({ ...row.value, title: 'revision-' + i }, row.revision); site.publish({ ids: ['item-0'] }); }
    expect(site.store.raw.prepare("SELECT COUNT(*) n FROM publication_objects WHERE kind='entry'").get()).toEqual({ n: 24 });
    expect(site.store.raw.prepare('SELECT COUNT(*) n FROM publication_fts').get()).toEqual({ n: 24 });
    const persisted = site.store.raw.prepare('SELECT data FROM releases WHERE id=?').get(site.release()!.id) as any;
    expect(JSON.parse(persisted.data)).toMatchObject({ storageVersion: 2 });
    expect(persisted.data).not.toContain('原正文');
    const row = site.store.get('entry', 'item-0')!; site.withdraw(row.id, row.revision);
    expect(site.release()!.entries).toHaveLength(19);
    expect(site.store.raw.prepare('SELECT COUNT(*) n FROM publication_fts').get()).toEqual({ n: 24 });
    site.rollback(first.id); expect(site.release()!.entries[0].title).toBe('item-0');
  });
  it('backs up and migrates old complete snapshots while preserving IDs, aliases and searchable blocks', () => {
    const folder = join(base, 'legacy'); mkdirSync(folder, { recursive: true });
    const db = new Database(join(folder, 'weava.sqlite'));
    const seed = create(); seed.saveEntry(entry('legacy-page', { kind: 'page', blocks: [{ id: 'text', type: 'text', props: { text: '旧版区块词' } }] }), null);
    const release = seed.publish();
    db.exec(`CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY,applied_at TEXT NOT NULL); INSERT INTO schema_migrations VALUES(2,'old');
      CREATE TABLE releases(id TEXT PRIMARY KEY,data TEXT NOT NULL,created_at TEXT NOT NULL);
      CREATE TABLE state(key TEXT PRIMARY KEY,value TEXT NOT NULL);`);
    db.prepare('INSERT INTO releases VALUES(?,?,?)').run(release.id, JSON.stringify(release), release.createdAt);
    db.prepare('INSERT INTO state VALUES(?,?)').run('release', release.id); db.close();
    const upgraded = new Site(folder); sites.push(upgraded);
    expect(upgraded.release()!.id).toBe(release.id);
    expect(upgraded.search('旧版区块词')).toHaveLength(1);
    expect(upgraded.store.raw.prepare('SELECT MAX(version) v FROM schema_migrations').get()).toEqual({ v: SCHEMA_VERSION });
    const backups = readdirSync(join(folder, 'archives/schema-upgrades'));
    expect(backups).toHaveLength(1);
    const backup = new Database(join(folder, 'archives/schema-upgrades', backups[0]), { readonly: true });
    try { expect(backup.prepare('SELECT MAX(version) v FROM schema_migrations').get()).toEqual({ v: 2 });
      expect(JSON.parse((backup.prepare('SELECT data FROM releases').get() as any).data).entries).toHaveLength(1); }
    finally { backup.close(); }
  });
});
