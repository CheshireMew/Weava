import {
  WeavaError,
  type ContentQuery,
  type PageResult,
  type ContentType,
  type Term,
  type PublishedEntry,
} from '@weava/contracts';

const title = {
  field: 'title',
  direction: 1,
  draft: 'l.title COLLATE NOCASE ASC',
  catalog: 'sort_title',
} as const;
export const querySorts = {
  relevance: {field:'publishedAt', direction:-1, draft:'l.published_at DESC', catalog:'sort_date'},
  title,
  '-title': {
    ...title,
    direction: -1,
    draft: 'l.title COLLATE NOCASE DESC',
    catalog: 'sort_title_desc',
  },
  updatedAt: {
    field: 'updatedAt',
    direction: 1,
    draft: 'l.updated_at ASC',
    catalog: 'sort_updated',
  },
  '-updatedAt': {
    field: 'updatedAt',
    direction: -1,
    draft: 'l.updated_at DESC',
    catalog: 'sort_updated_desc',
  },
  publishedAt: {
    field: 'publishedAt',
    direction: 1,
    draft: 'l.published_at ASC',
    catalog: 'sort_published',
  },
  date: { field: 'publishedAt', direction: -1, draft: 'l.published_at DESC', catalog: 'sort_date' },
  '-publishedAt': {
    field: 'publishedAt',
    direction: -1,
    draft: 'l.published_at DESC',
    catalog: 'sort_published_desc',
  },
  oldest: {
    field: 'publishedAt',
    direction: 1,
    draft: 'l.published_at ASC',
    catalog: 'sort_oldest',
  },
} satisfies Record<
  NonNullable<ContentQuery['sort']>,
  {
    field: 'title' | 'updatedAt' | 'publishedAt';
    direction: number;
    draft: string;
    catalog: string;
  }
>;
export function queryOrder(sort: ContentQuery['sort'] = 'date') {
  if (!Object.hasOwn(querySorts, sort)) throw new WeavaError('排序方式无效。');
  return querySorts[sort];
}
export function compareContent(
  a: Pick<PublishedEntry, 'id' | 'title' | 'updatedAt' | 'publishedAt'>,
  b: typeof a,
  order: ReturnType<typeof queryOrder>,
) {
  // Match SQLite's NOCASE title ordering and binary ID/date ordering in every adapter.
  const text = (value: unknown) =>
    order.field === 'title'
      ? String(value ?? '').replace(/[A-Z]/g, (c) => c.toLowerCase())
      : String(value ?? '');
  return (
    Buffer.compare(Buffer.from(text(a[order.field])), Buffer.from(text(b[order.field]))) *
      order.direction || Buffer.compare(Buffer.from(a.id), Buffer.from(b.id))
  );
}

/** Storage adapters supply columns; parameter values and filter semantics are shared. */
export function contentSqlFilters(
  input: ContentQuery,
  terms: Term[],
  columns: {
    kind: string;
    type: string;
    author: string;
    search: string;
    metadata: string;
    fields: string;
  },
) {
  const clauses: string[] = [],
    args: (string | number)[] = [];
  const eq = (sql: string, value: string) => {
    clauses.push(sql);
    args.push(value);
  };
  for (const key of ['kind', 'type', 'author'] as const)
    if (input[key]) eq(columns[key] + '=?', input[key]);
  if (input.query)
    eq('instr(' + columns.search + ',?)>0', input.query.normalize('NFKC').toLowerCase());
  for (const [key, kind, value] of [
    ['categories', 'category', input.category],
    ['tags', 'tag', input.tag],
  ] as const)
    if (value) {
      const ids = [value, ...taxonomyIds(terms, kind, value)];
      clauses.push(
        `(EXISTS(SELECT 1 FROM json_each(${columns.metadata},?) WHERE value=?) OR EXISTS(SELECT 1 FROM json_each(${columns.metadata},?) WHERE value IN (${ids.map(() => '?').join(',')})))`,
      );
      args.push('$.' + key, value, '$.termIds.' + key, ...ids);
    }
  for (const [key, value] of Object.entries(input.fields ?? {})) {
    clauses.push(
      `EXISTS(SELECT 1 FROM json_each(${columns.fields},?) WHERE CASE type WHEN 'true' THEN 'true' WHEN 'false' THEN 'false' ELSE CAST(value AS TEXT) END=?)`,
    );
    args.push('$.' + JSON.stringify(key), String(value));
  }
  return { clauses, args };
}

export function paginate<T>(items: T[], page = 1, pageSize = 24): PageResult<T> {
  if (
    !Number.isSafeInteger(page) ||
    page < 1 ||
    !Number.isSafeInteger(pageSize) ||
    pageSize < 1 ||
    pageSize > 100
  )
    throw new WeavaError('页码或每页数量无效，每页最多 100 项。');
  return {
    items: items.slice((page - 1) * pageSize, page * pageSize),
    page,
    pageSize,
    total: items.length,
    pages: Math.ceil(items.length / pageSize),
  };
}

export function validateQueryFields(input: ContentQuery, types: ContentType[]) {
  const fields = Object.entries(input.fields ?? {});
  if (!fields.length) return;
  const type = types.find((type) => type.id === input.type);
  if (!type) throw new WeavaError('字段筛选需要选择内容类型。');
  for (const [key, value] of fields) {
    const field = type.fields.find((field) => field.key === key && field.filterable);
    if (!field) throw new WeavaError('字段未声明为可筛选：' + key);
    if (
      (field.type === 'number' && !Number.isFinite(Number(value))) ||
      (field.type === 'boolean' && !['true', 'false'].includes(String(value))) ||
      (field.type === 'date' && !Number.isFinite(Date.parse(String(value)))) ||
      (field.type === 'select' && !field.options?.includes(String(value)))
    )
      throw new WeavaError('字段筛选值无效：' + field.label);
  }
}
export function taxonomyIds(catalog: Term[], kind: Term['kind'], value: string) {
  const ids = new Set(
    catalog
      .filter((term) => term.kind === kind && [term.id, term.label, term.slug].includes(value))
      .map((term) => term.id),
  );
  if (kind === 'category') {
    let changed = true;
    while (changed) {
      changed = false;
      for (const term of catalog)
        if (term.kind === kind && term.parentId && ids.has(term.parentId) && !ids.has(term.id)) {
          ids.add(term.id);
          changed = true;
        }
    }
  }
  return ids;
}
