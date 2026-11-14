import {
  fieldSchema,
  isNoteType,
  type FieldDefinition,
  type ContentQuery,
  type ContentType,
  type Term,
  type Entry,
} from '@weava/contracts';
import type { Storage } from './storage.ts';
import { defaultArticleCover } from './entry-cover.ts';
import { paginate, validateQueryFields, queryOrder, contentSqlFilters } from './query-rules.ts';

/** Indexed draft and reference reads; never materialize full documents for a list. */
export function queryDraftCatalog(
  store: Storage,
  input: ContentQuery & {
    status?: string;
    visibility?: string;
    format?: 'article' | 'note';
    group?: 'published' | 'scheduled' | 'draft';
  } = {},
) {
  const page = input.page ?? 1,
    pageSize = input.pageSize ?? 24;
  paginate([], page, pageSize);
  const types = store.list('type').map((row) => row.value as ContentType),
    terms = store.list('term').map((row) => row.value as Term);
  validateQueryFields(input, types);
  const { clauses, args } = contentSqlFilters(input, terms, {
    kind: 'l.kind',
    type: 'l.type',
    author: "json_extract(l.summary,'$.author')",
    search: 'l.search',
    metadata: 'l.summary',
    fields: 'l.fields',
  });
  const eq = (sql: string, value: any) => {
    clauses.push(sql);
    args.push(value);
  };
  if (input.format) {
    const ids = types
      .filter((type) => (input.format === 'note' ? isNoteType(type) : !isNoteType(type)))
      .map((type) => type.id);
    if (ids.length) {
      clauses.push('l.type IN (' + ids.map(() => '?').join(',') + ')');
      args.push(...ids);
    } else clauses.push('0=1');
  }
  if (input.visibility && input.visibility !== 'all') eq('l.visibility=?', input.visibility);
  const scheduled =
    "EXISTS(SELECT 1 FROM records s WHERE s.scope='publication-schedule' AND json_extract(s.data,'$.entryId')=l.id AND json_extract(s.data,'$.status') IN ('scheduled','running'))";
  if (input.group === 'published') clauses.push('p.entry_id IS NOT NULL');
  else if (input.group === 'scheduled') clauses.push('p.entry_id IS NULL AND ' + scheduled);
  else if (input.group === 'draft') clauses.push('p.entry_id IS NULL AND NOT ' + scheduled);
  else if (input.status === 'published') clauses.push('p.entry_id IS NOT NULL');
  else if (input.status === 'changed')
    clauses.push('p.entry_id IS NOT NULL AND p.revision<>l.revision');
  else if (input.status === 'scheduled' || input.status === 'schedule-failed')
    eq(
      "EXISTS(SELECT 1 FROM records s WHERE s.scope='publication-schedule' AND json_extract(s.data,'$.entryId')=l.id AND json_extract(s.data,'$.status')=?)",
      input.status === 'scheduled' ? 'scheduled' : 'failed',
    );
  else if (input.status && input.status !== 'all')
    eq('p.entry_id IS NULL AND l.status=?', input.status);
  const order = queryOrder(input.sort);
  const from = `FROM entry_list l LEFT JOIN published_entry_revisions p ON p.entry_id=l.id AND p.release_id=(SELECT value FROM state WHERE key='release')${clauses.length ? ' WHERE ' + clauses.join(' AND ') : ''}`;
  const total = (store.raw.prepare('SELECT COUNT(*) n ' + from).get(...args) as { n: number }).n;
  const selected = store.raw
    .prepare(
      'SELECT l.id,l.revision,l.summary,l.fields,l.updated_at,p.revision published_revision ' +
        from +
        ' ORDER BY ' +
        order.draft +
        ',l.id LIMIT ? OFFSET ?',
    )
    .all(...args, pageSize, (page - 1) * pageSize) as {
    id: string;
    revision: number;
    summary: string;
    fields: string;
    updated_at: string;
    published_revision: number | null;
  }[];
  return {
    page,
    pageSize,
    total,
    pages: Math.ceil(total / pageSize),
    items: selected.map((row) => {
      const value = JSON.parse(row.summary),
        fields = JSON.parse(row.fields),
        type = types.find((type) => type.id === value.type),
        columns = type?.admin?.columns ?? [];
      // Older summaries may lack the default photo; fill it without reading or rewriting the body.
      value.cover ||= defaultArticleCover(value, type);
      const schedules = (
        store.raw
          .prepare(
            "SELECT id,revision,data FROM records WHERE scope='publication-schedule' AND json_extract(data,'$.entryId')=? AND json_extract(data,'$.status') IN ('scheduled','running','failed') ORDER BY json_extract(data,'$.dueAt'),id",
          )
          .all(row.id) as { id: string; revision: number; data: string }[]
      ).map((item) => {
        const schedule = JSON.parse(item.data);
        return {
          id: item.id,
          revision: item.revision,
          dueAt: schedule.dueAt,
          status: schedule.status as 'scheduled' | 'running' | 'failed',
          ...(schedule.error ? { error: schedule.error } : {}),
        };
      });
      return {
        id: row.id,
        revision: row.revision,
        updatedAt: row.updated_at,
        published: row.published_revision !== null,
        hasChanges: row.published_revision !== row.revision,
        ...(schedules.length ? { schedules } : {}),
        value: {
          ...value,
          fields: Object.fromEntries(
            columns.filter((key) => Object.hasOwn(fields, key)).map((key) => [key, fields[key]]),
          ),
        },
      };
    }),
  };
}

export function queryReferenceCatalog(
  store: Storage,
  input: {
    referenceTypes?: string[];
    referenceFilters?: FieldDefinition['referenceFilters'];
    query?: string;
    page?: number;
    pageSize?: number;
  },
) {
  const field = fieldSchema.parse({
    key: 'reference',
    label: '内容引用',
    type: 'reference',
    referenceTypes: input.referenceTypes,
    referenceFilters: input.referenceFilters,
  });
  const page = input.page ?? 1,
    pageSize = input.pageSize ?? 24;
  paginate([], page, pageSize);
  const clauses = ["status<>'archived'"],
    args: any[] = [];
  if (field.referenceTypes) {
    clauses.push(`kind='content' AND type IN (${field.referenceTypes.map(() => '?').join(',')})`);
    args.push(...field.referenceTypes);
  }
  if (input.query) {
    clauses.push('instr(search,?)>0');
    args.push(input.query.normalize('NFKC').toLowerCase());
  }
  for (const [key, expected] of Object.entries(field.referenceFilters ?? {})) {
    const type =
      typeof expected === 'boolean'
        ? expected
          ? 'true'
          : 'false'
        : typeof expected === 'number'
          ? 'integer,real'
          : 'text';
    clauses.push(
      `EXISTS(SELECT 1 FROM json_each(fields,?) WHERE type IN (${type
        .split(',')
        .map(() => '?')
        .join(',')}) AND CAST(value AS TEXT)=?)`,
    );
    args.push(
      '$.' + JSON.stringify(key),
      ...type.split(','),
      typeof expected === 'boolean' ? (expected ? '1' : '0') : String(expected),
    );
  }
  const where = clauses.join(' AND '),
    total = (
      store.raw.prepare('SELECT COUNT(*) n FROM entry_list WHERE ' + where).get(...args) as {
        n: number;
      }
    ).n;
  const rows = store.raw
    .prepare(
      "SELECT id,revision,title,kind,type,json_extract(summary,'$.path') AS path,updated_at FROM entry_list WHERE " +
        where +
        ' ORDER BY title COLLATE NOCASE,id LIMIT ? OFFSET ?',
    )
    .all(...args, pageSize, (page - 1) * pageSize) as {
    id: string;
    revision: number;
    title: string;
    kind: Entry['kind'];
    type: string;
    path: string;
    updated_at: string;
  }[];
  return {
    page,
    pageSize,
    total,
    pages: Math.ceil(total / pageSize),
    items: rows.map((row) => ({
      id: row.id,
      revision: row.revision,
      updatedAt: row.updated_at,
      value: { id: row.id, title: row.title, path: row.path, kind: row.kind, type: row.type },
    })),
  };
}
