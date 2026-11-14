import { WeavaError, type Entry } from '@weava/contracts';
import type { Storage } from './storage.ts';
import { queryDraftCatalog, queryReferenceCatalog } from './content-catalog.ts';
type AuthoringScope = 'content-view' | 'creation-template' | 'writing-snippet';

/** Content records and indexes share one persistence boundary. */
export class EntryRepository {
  constructor(private store: Storage) {}
  get(id: string) {
    return this.store.get('entry', id);
  }
  type(id: string) {
    return this.store.get('type', id);
  }
  types() {
    return this.store.list('type');
  }
  term(id: string) {
    return this.store.get('term', id);
  }
  authoringList(scope: AuthoringScope) {
    return this.store.list(scope);
  }
  authoringRecord(scope: AuthoringScope, id: string) {
    return this.store.get(scope, id);
  }
  saveAuthoring(scope: AuthoringScope, id: string, value: unknown, revision: number | null) {
    return this.store.put(scope, id, value, revision);
  }
  query(input: Parameters<typeof queryDraftCatalog>[1] = {}) {
    return queryDraftCatalog(this.store, input);
  }
  references(input: Parameters<typeof queryReferenceCatalog>[1]) {
    return queryReferenceCatalog(this.store, input);
  }
  transaction<T>(action: () => T): T {
    return this.store.raw.transaction(action).immediate();
  }
  revision(id: string, version: number): Entry | null {
    return this.revisionRecord(id, version)?.value ?? null;
  }
  revisionRecord(id: string, version: number) {
    const row = this.store.raw
      .prepare(
        "SELECT data,created_at,label FROM revisions WHERE scope='entry' AND id=? AND revision=?",
      )
      .get(id, version) as { data: string; created_at: string; label: string } | undefined;
    return row
      ? {
          id,
          revision: version,
          value: JSON.parse(row.data) as Entry,
          createdAt: row.created_at,
          label: row.label,
        }
      : null;
  }
  pagesAtPaths(paths: string[]) {
    return this.store.raw
      .prepare(
        `SELECT r.id,r.revision,r.data FROM entry_list l JOIN records r ON r.scope='entry' AND r.id=l.id WHERE l.kind='page' AND json_extract(l.summary,'$.path') IN (${paths.map(() => '?').join(',')})`,
      )
      .all(...paths) as { id: string; revision: number; data: string }[];
  }
  publishedRevision(id: string) {
    return (
      this.store.raw
        .prepare(
          "SELECT revision FROM published_entry_revisions WHERE entry_id=? AND release_id=(SELECT value FROM state WHERE key='release')",
        )
        .get(id) as { revision: number } | undefined
    )?.revision;
  }
  idAtPath(path: string) {
    return (
      this.store.raw
        .prepare("SELECT id FROM entry_list WHERE json_extract(summary,'$.path')=?")
        .get(path) as { id: string } | undefined
    )?.id;
  }
  matchingIds(query: string) {
    if (!query.trim()) return [];
    return (
      this.store.raw
        .prepare(
          "SELECT id FROM entry_list WHERE instr(lower(coalesce(json_extract(summary,'$.title'),'')||' '||coalesce(json_extract(summary,'$.path'),'')),lower(?))>0",
        )
        .all(query.trim()) as { id: string }[]
    ).map((row) => row.id);
  }
  authors() {
    return (
      this.store.raw
        .prepare(
          "SELECT DISTINCT trim(json_extract(summary,'$.author')) name FROM entry_list WHERE kind='content' AND trim(coalesce(json_extract(summary,'$.author'),''))<>'' ORDER BY name",
        )
        .all() as { name: string }[]
    ).map((row) => row.name);
  }
  count() {
    return (
      this.store.raw.prepare("SELECT COUNT(*) n FROM records WHERE scope='entry'").get() as {
        n: number;
      }
    ).n;
  }
  occupiedPaths() {
    return [
      ...(
        this.store.raw
          .prepare("SELECT json_extract(summary,'$.path') path FROM entry_list")
          .all() as { path: string }[]
      ).map((row) => row.path),
      ...(
        this.store.raw.prepare("SELECT id FROM records WHERE scope='redirect'").all() as {
          id: string;
        }[]
      ).map((row) => row.id),
    ];
  }
  scheduled(id: string) {
    return !!this.store.raw
      .prepare(
        "SELECT 1 FROM records WHERE scope='publication-schedule' AND json_extract(data,'$.entryId')=? AND json_extract(data,'$.status') IN ('scheduled','running','failed') LIMIT 1",
      )
      .get(id);
  }
  planned(id: string) {
    return this.store
      .list('publication-plan')
      .some(
        (row) =>
          ['draft', 'scheduled', 'running', 'failed'].includes(row.value.status) &&
          row.value.actions.some((action: { id: string }) => action.id === id),
      );
  }
  moveToTrash(id: string, entry: Entry, revision: number, deletedAt: string) {
    this.transaction(() => {
      this.store.put(
        'entry-trash',
        id,
        { entry, deletedAt, originalRevision: revision },
        null,
        '移入回收站',
      );
      this.store.raw.prepare("DELETE FROM records WHERE scope='entry' AND id=?").run(id);
      this.store.raw.prepare('DELETE FROM entry_list WHERE id=?').run(id);
    });
  }
  trashRecord(id: string) {
    return this.store.get('entry-trash', id);
  }
  removeTrash(id: string) {
    this.store.raw.prepare("DELETE FROM records WHERE scope='entry-trash' AND id=?").run(id);
  }
  trashed(
    input: { query?: string; kind?: 'content' | 'page'; page?: number; pageSize?: number } = {},
  ) {
    const page = input.page ?? 1,
      pageSize = input.pageSize ?? 25;
    if (
      !Number.isSafeInteger(page) ||
      page < 1 ||
      !Number.isSafeInteger(pageSize) ||
      pageSize < 1 ||
      pageSize > 100
    )
      throw new WeavaError('回收站页码无效。');
    const clauses = ["scope='entry-trash'"],
      args: string[] = [];
    if (input.kind) {
      clauses.push("json_extract(data,'$.entry.kind')=?");
      args.push(input.kind);
    }
    if (input.query?.trim()) {
      clauses.push("instr(lower(json_extract(data,'$.entry.title')),lower(?))>0");
      args.push(input.query.trim());
    }
    const where = clauses.join(' AND '),
      total = (
        this.store.raw.prepare('SELECT COUNT(*) n FROM records WHERE ' + where).get(...args) as {
          n: number;
        }
      ).n;
    const rows = this.store.raw
      .prepare(
        'SELECT id,revision,data FROM records WHERE ' +
          where +
          " ORDER BY json_extract(data,'$.deletedAt') DESC,id LIMIT ? OFFSET ?",
      )
      .all(...args, pageSize, (page - 1) * pageSize) as {
      id: string;
      revision: number;
      data: string;
    }[];
    return {
      page,
      pageSize,
      total,
      pages: Math.ceil(total / pageSize),
      items: rows.map((row) => {
        const value = JSON.parse(row.data);
        return {
          id: row.id,
          revision: row.revision,
          title: value.entry.title,
          path: value.entry.path,
          kind: value.entry.kind,
          type: value.entry.type,
          deletedAt: value.deletedAt,
        };
      }),
    };
  }
}
