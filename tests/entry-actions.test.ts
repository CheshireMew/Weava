import Database from 'better-sqlite3';
import { afterEach, expect, it, vi } from 'vitest';
import { entrySchema } from '@weava/contracts';
import { duplicateContent, deleteContent } from '../packages/core/src/entry-actions.ts';

// The action boundary only needs records and their list index; use SQLite in memory.
const databases: Database.Database[] = [];
afterEach(() => databases.splice(0).forEach(db => db.close()));
function fixture() {
  const db = new Database(':memory:'); databases.push(db);
  db.exec('CREATE TABLE records(scope TEXT,id TEXT,revision INTEGER,data TEXT,PRIMARY KEY(scope,id)); CREATE TABLE entry_list(id TEXT PRIMARY KEY);');
  const put = (scope: string, id: string, value: any, revision = 1) => db.prepare('INSERT OR REPLACE INTO records VALUES(?,?,?,?)').run(scope, id, revision, JSON.stringify(value));
  const store = {
    raw: db,
    get: (scope: string, id: string) => {
      const row = db.prepare('SELECT * FROM records WHERE scope=? AND id=?').get(scope, id) as any;
      return row ? { id, revision: row.revision, value: JSON.parse(row.data) } : null;
    },
    list: (scope: string) => (db.prepare('SELECT id,data FROM records WHERE scope=?').all(scope) as any[]).map(row => ({ id: row.id, value: JSON.parse(row.data) })),
  };
  const original = entrySchema.parse({ id: 'original', kind: 'content', type: 'post', title: '原文章', path: '/posts/original/',
    status: 'published', publishedAt: '2026-10-01T00:00:00Z', visibility: 'private', cover: '/media/shared.webp',
    document: { version: 1, format: 'markdown', source: '# 完整正文\n\n后面的内容不能丢失。' },
    fields: { nested: { rating: 5 } }, blocks: [{ id: 'original-block', type: 'text', props: { text: '区块内容' } }],
    seo: { title: '搜索标题', canonical: 'https://example.com/posts/original/' }, source: { wordpressId: 9 },
    compatibility: { wordpress: { unresolved: ['来源组件'], reviewed: false } },
  });
  put('type', 'post', { pathPrefix: '/posts/' }); put('entry', original.id, original);
  db.prepare('INSERT INTO entry_list VALUES(?)').run(original.id);
  const site = {
    store, activeJobs: vi.fn(() => [] as any[]),
    saveEntry: vi.fn((value: any) => {
      const parsed = entrySchema.parse(value); put('entry', value.id, parsed);
      db.prepare('INSERT INTO entry_list VALUES(?)').run(value.id);
      return { id: parsed.id, revision: 1, value: parsed };
    }),
    withdraw: vi.fn((id: string) => { const row = store.get('entry', id)!; put('entry', id, { ...row.value, status: 'archived' }, row.revision + 1); }),
  };
  return { site: site as any, original, put, db };
}

it('duplicates the full content into an independent draft with a new address and block identities', () => {
  const { site, original, put } = fixture();
  const copy = duplicateContent(site, original.id, 1);
  expect(copy.value).toMatchObject({ title: '原文章（副本）', status: 'draft', document: original.document, cover: original.cover, visibility: 'private', fields: original.fields, compatibility: original.compatibility });
  expect(copy.id).not.toBe(original.id); expect(copy.value.path).not.toBe(original.path);
  expect(copy.value.publishedAt).toBeUndefined(); expect(copy.value.source).toBeUndefined(); expect(copy.value.seo?.canonical).toBeUndefined();
  expect(copy.value.blocks[0].id).not.toBe(original.blocks[0].id);
  copy.value.fields.nested.rating = 1;
  expect(site.store.get('entry', original.id).value).toEqual(original);
  expect(() => duplicateContent(site, original.id, 2)).toThrow(/已变化/);
  put('entry', 'page', { ...original, id: 'page', kind: 'page' });
  expect(duplicateContent(site, 'page', 1).value).toMatchObject({ kind: 'page', status: 'draft' });
});

it('removes only the chosen entry and its list index after successful withdrawal', () => {
  const { site, original, db } = fixture();
  const copy = duplicateContent(site, original.id, 1);
  expect(deleteContent(site, original.id, 1, null)).toEqual({ id: original.id });
  expect(site.withdraw).toHaveBeenCalledWith(original.id, 1, true, null);
  expect(site.store.get('entry', original.id)).toBeNull();
  expect(db.prepare('SELECT * FROM entry_list WHERE id=?').get(original.id)).toBeUndefined();
  expect(site.store.get('entry', copy.id)).not.toBeNull();
});

it('keeps records and indexes intact on conflicts, planned publication or withdrawal failure', () => {
  const { site, original, put, db } = fixture();
  expect(() => deleteContent(site, original.id, 2)).toThrow(/已变化/);
  site.activeJobs.mockReturnValueOnce([{ operation: 'publish' }]);
  expect(() => deleteContent(site, original.id, 1)).toThrow(/发布任务/);
  put('publication-schedule', 'scheduled', { entryId: original.id, status: 'scheduled' });
  expect(() => deleteContent(site, original.id, 1)).toThrow(/定时发布/);
  put('publication-schedule', 'scheduled', { entryId: original.id, status: 'cancelled' });
  put('publication-plan', 'plan', { actions: [{ id: original.id }], status: 'draft' });
  expect(() => deleteContent(site, original.id, 1)).toThrow(/发布计划/);
  put('publication-plan', 'plan', { actions: [{ id: original.id }], status: 'cancelled' });
  site.withdraw.mockImplementationOnce(() => {
    put('entry', original.id, { ...original, status: 'archived' }, 2);
    throw new Error('公开页面仍引用这篇内容');
  });
  expect(() => deleteContent(site, original.id, 1)).toThrow(/仍引用/);
  expect(site.store.get('entry', original.id)).toMatchObject({ revision: 1, value: original });
  expect(db.prepare('SELECT * FROM entry_list WHERE id=?').get(original.id)).toBeDefined();
});
