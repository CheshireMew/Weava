import Database from 'better-sqlite3';
import { afterEach, expect, it } from 'vitest';
import {
  entrySchema,
  defaultSettings,
  type ContentQuery,
  type Release,
  type ContentType,
  type Term,
} from '@weava/contracts';
import type { Site } from '../packages/core/src/site.ts';
import { migrateStorage } from '../packages/core/src/storage-migrations.ts';
import { indexListRecord } from '../packages/core/src/list-index.ts';
import { queryEntries, queryDrafts, contentQuery } from '../packages/core/src/query.ts';
import { queryPublicCatalog } from '../packages/core/src/public-query.ts';
import { querySorts } from '../packages/core/src/query-rules.ts';

const databases: Database.Database[] = [];
afterEach(() => databases.splice(0).forEach((db) => db.close()));
function fixture() {
  const db = new Database(':memory:');
  databases.push(db);
  migrateStorage(db, 'D:/Tools/cache/weava/tests/in-memory-query', 0);
  const type: ContentType = {
    id: 'post',
    label: 'Post',
    pathPrefix: '/posts/',
    template: 'article',
    fields: [
      { key: 'score', label: 'Score', type: 'number', filterable: true },
      { key: 'flag', label: 'Flag', type: 'boolean', filterable: true },
      {
        key: 'labels',
        label: 'Labels',
        type: 'select',
        options: ['a', 'b'],
        multiple: true,
        filterable: true,
      },
    ],
  };
  const terms: Term[] = [
    { id: 'parent', kind: 'category', label: 'Parent', slug: 'parent' },
    { id: 'child', kind: 'category', label: 'Child', slug: 'child', parentId: 'parent' },
  ];
  db.prepare('INSERT INTO records VALUES(?,?,?,?,?)').run(
    'type',
    type.id,
    1,
    JSON.stringify(type),
    '',
  );
  const entries = ['中文', 'Alpha', 'alpha', 'Beta', '😀', 'beta', 'Other', 'Page'].map(
    (title, index) => ({
      ...entrySchema.parse({
        id: 'item-' + index,
        kind: index === 7 ? 'page' : 'content',
        title,
        path: '/posts/' + index + '/',
        author: index % 2 ? 'Alice' : 'Bob',
        status: 'published',
        categories: ['Child'],
        termIds: { categories: ['child'], tags: [] },
        fields: { score: index % 3, flag: index % 2 === 0, labels: index % 2 ? ['a', 'b'] : ['b'] },
        publishedAt: '2026-11-0' + ((index % 3) + 1) + 'T00:00:00Z',
        updatedAt: '2026-11-0' + ((index % 4) + 1) + 'T00:00:00Z',
      }),
      html: '',
      revisionId: index + 1,
      modifiedAt: '',
    }),
  );
  for (const entry of entries)
    indexListRecord(db, 'entry', entry.id, entry, entry.revisionId, entry.updatedAt!);
  const release: Release = {
    id: 'memory-release',
    entries,
    types: [type],
    terms,
    settings: defaultSettings,
    label: 'Memory',
    createdAt: '',
  };
  const site = {
    store: { raw: db, list: () => [{ id: type.id, value: type }] },
    terms: () => terms.map((value) => ({ id: value.id, value })),
  } as unknown as Site;
  return { db, site, release };
}
it('keeps author, taxonomy, fields, sorting and pagination consistent across all three query adapters', () => {
  const { db, site, release } = fixture(),
    ids = (result: { items: { id: string }[]; total: number }) => ({
      items: result.items.map((row) => row.id),
      total: result.total,
    });
  const filters: ContentQuery[] = [
    {},
    { author: 'Alice' },
    { category: 'parent' },
    { type: 'post', fields: { score: 1 } },
    { type: 'post', fields: { flag: true } },
    { type: 'post', fields: { labels: 'a' } },
    { query: 'ALPHA' },
    { author: 'Nobody' },
  ];
  for (const sort of Object.keys(querySorts) as NonNullable<ContentQuery['sort']>[])
    for (const filter of filters)
      for (const page of [1, 2]) {
        const input: ContentQuery = { kind: 'content', ...filter, sort, page, pageSize: 3 };
        const expected = ids(queryEntries(release.entries, input, release.types, release.terms));
        expect(ids(queryPublicCatalog(db, release, input)), JSON.stringify(input)).toEqual(
          expected,
        );
        expect(ids(queryDrafts(site, input)), JSON.stringify(input)).toEqual(expected);
      }
  expect(contentQuery(new URLSearchParams('author=Alice')).author).toBe('Alice');
});
it('applies the same validation at each query boundary and keeps versioned migrations in memory', () => {
  const { db, site, release } = fixture();
  expect(db.prepare('SELECT MAX(version) version FROM schema_migrations').get()).toEqual({
    version: 14,
  });
  for (const input of [
    { page: 0 },
    { pageSize: 101 },
    { sort: 'invalid' },
    { type: 'post', fields: { score: 'NaN' } },
    { fields: { score: 1 } },
  ] as ContentQuery[]) {
    expect(() => queryEntries(release.entries, input, release.types, release.terms)).toThrow();
    expect(() => queryPublicCatalog(db, release, input)).toThrow();
    expect(() => queryDrafts(site, input)).toThrow();
  }
});
