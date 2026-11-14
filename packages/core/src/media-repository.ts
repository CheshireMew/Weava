import { mediaGroupSchema, WeavaError } from '@weava/contracts';
import type { Storage } from './storage.ts';
import { paginate } from './query-rules.ts';
import { digest } from '../../runtime-common/src/identity.ts';
import { mediaUsage } from './media-usage.ts';
import { indexRecord } from './record-indexes.ts';

/** Catalog persistence, revision checks and atomic metadata changes. */
export class MediaRepository {
  constructor(private store: Storage) {}
  usage(id: string) {
    return mediaUsage(this.store, id);
  }
  get(id: string) {
    return this.store.get('media', id);
  }
  list() {
    return this.store.list('media');
  }
  version() {
    return this.store.state('media-version') ?? '0';
  }
  directEntryReferences(url: string, limit: number) {
    return (
      this.store.raw
        .prepare(
          "SELECT DISTINCT id FROM authored_media_refs WHERE scope='entry' AND path=? ORDER BY id LIMIT ?",
        )
        .all(url, limit) as { id: string }[]
    ).map((row) => row.id);
  }
  replacement(id: string) {
    return this.store.get('media-replacement', id);
  }
  recordReplacement(id: string, result: unknown) {
    return this.store.put('media-replacement', id, result, null, '替换媒体引用');
  }
  presets() {
    return this.store.list('image-preset');
  }
  preset(id: string) {
    return this.store.get('image-preset', id);
  }
  savePreset(id: string, value: unknown, revision: number | null) {
    return this.store.put('image-preset', id, value, revision);
  }
  variant(id: string) {
    return this.store.get('media-variant', id);
  }
  variants(parentId: string | null) {
    return this.store.list('media-variant').filter((row) => row.value.parentId === parentId);
  }
  saveVariant(id: string, value: unknown) {
    return this.transaction(
      () => this.variant(id) ?? this.store.put('media-variant', id, value, null, '生成图片规格'),
    );
  }
  put(id: string, value: any, revision: number | null, label = '保存') {
    return this.store.put('media', id, value, revision, label);
  }
  transaction<T>(action: () => T): T {
    return this.store.raw.transaction(action).immediate();
  }
  query(params: URLSearchParams) {
    const q = (params.get('q') ?? '').toLowerCase(),
      kind = params.get('kind'),
      group = params.get('group');
    const archived = params.get('archived') === 'true';
    const page = Number(params.get('page') ?? 1),
      pageSize = Number(params.get('pageSize') ?? 24);
    paginate([], page, pageSize);
    const clauses = ['archived=?'],
      args: any[] = [archived ? 1 : 0];
    if (group === '__ungrouped__') clauses.push("COALESCE(group_id,'')=''");
    else if (group) {
      clauses.push('group_id=?');
      args.push(group);
    }
    if (q) {
      clauses.push('instr(search,?)>0');
      args.push(q.normalize('NFKC'));
    }
    if (kind) {
      clauses.push('kind=?');
      args.push(kind);
    }
    const where = clauses.join(' AND '),
      total = (
        this.store.raw.prepare('SELECT COUNT(*) n FROM media_list WHERE ' + where).get(...args) as {
          n: number;
        }
      ).n;
    const selected = this.store.raw
      .prepare(
        'SELECT id,revision,data,updated_at FROM media_list WHERE ' +
          where +
          ' ORDER BY created_at DESC,id LIMIT ? OFFSET ?',
      )
      .all(...args, pageSize, (page - 1) * pageSize) as {
      id: string;
      revision: number;
      data: string;
      updated_at: string;
    }[];
    return {
      page,
      pageSize,
      total,
      pages: Math.ceil(total / pageSize),
      items: selected.map((row) => ({
        id: row.id,
        revision: row.revision,
        value: JSON.parse(row.data),
        updatedAt: row.updated_at,
      })),
    };
  }
  groups() {
    return this.store.list('media-group');
  }
  saveGroup(input: unknown, revision: number | null) {
    const value = mediaGroupSchema.parse(input);
    return this.store.raw
      .transaction(() => {
        if (
          this.groups().some(
            (row) =>
              row.id !== value.id &&
              !row.value.archived &&
              !value.archived &&
              row.value.label === value.label,
          )
        )
          throw new WeavaError('已有同名媒体分组。');
        return this.store.put('media-group', value.id, value, revision);
      })
      .immediate();
  }
  validateGroup(id: string | null | undefined) {
    if (id === undefined || id === null || id === '') return;
    if (typeof id !== 'string') throw new WeavaError('媒体分组编号无效。');
    const group = this.store.get('media-group', id);
    if (!group || group.value.archived) throw new WeavaError('媒体分组不存在或已归档。');
  }
  move(items: { id: string; revision: number }[], groupId: string | null) {
    if (
      !Array.isArray(items) ||
      !items.length ||
      items.some(
        (item) => !item || typeof item.id !== 'string' || !Number.isSafeInteger(item.revision),
      ) ||
      new Set(items.map((item) => item.id)).size !== items.length
    )
      throw new WeavaError('请选择媒体并提供修订号，每项只能出现一次。');
    return this.store.raw
      .transaction(() => {
        this.validateGroup(groupId);
        return items.map((item) => {
          const row = this.store.get('media', item.id);
          if (!row || row.revision !== item.revision)
            throw new WeavaError('媒体信息已变化，请重新载入。', 409);
          return this.store.put(
            'media',
            row.id,
            { ...row.value, groupId: groupId || null },
            row.revision,
            '移动媒体分组',
          );
        });
      })
      .immediate();
  }
  saveMetadata(
    id: string,
    value: {
      name: string;
      alt?: string;
      caption?: string;
      groupId?: string | null;
      focalPoint?: { x: number; y: number };
    },
    revision: number,
  ) {
    return this.store.raw
      .transaction(() => {
        const row = this.store.get('media', id);
        if (!row || row.revision !== revision)
          throw new WeavaError('媒体信息已变化，请重新载入。', 409);
        if (
          typeof value?.name !== 'string' ||
          !value.name.trim() ||
          value.name.length > 300 ||
          typeof (value.alt ?? '') !== 'string' ||
          (value.alt?.length ?? 0) > 1000 ||
          typeof (value.caption ?? '') !== 'string' ||
          (value.caption?.length ?? 0) > 4000
        )
          throw new WeavaError('媒体名称、说明或图注无效。');
        if (value.groupId !== undefined && value.groupId !== row.value.groupId)
          this.validateGroup(value.groupId);
        if (
          value.focalPoint &&
          (['x', 'y'] as const).some(
            (axis) =>
              !Number.isFinite(value.focalPoint![axis]) ||
              value.focalPoint![axis] < 0 ||
              value.focalPoint![axis] > 100,
          )
        )
          throw new WeavaError('图片焦点需要在 0～100 之间。');
        return this.store.put(
          'media',
          id,
          {
            ...row.value,
            name: value.name.trim(),
            alt: value.alt ?? '',
            caption: value.caption ?? '',
            ...(value.groupId !== undefined ? { groupId: value.groupId || null } : {}),
            ...(value.focalPoint ? { focalPoint: value.focalPoint } : {}),
          },
          revision,
          '更新媒体信息',
        );
      })
      .immediate();
  }
  archive(items: { id: string; revision: number }[], archived: boolean) {
    if (!Array.isArray(items) || !items.length) throw new WeavaError('请选择媒体。');
    return this.store.raw
      .transaction(() =>
        items.map((item) => {
          const row = this.store.get('media', item.id);
          if (!row || row.revision !== item.revision)
            throw new WeavaError('媒体信息已变化，请重新载入。', 409);
          return this.store.put(
            'media',
            row.id,
            { ...row.value, archived },
            row.revision,
            archived ? '归档媒体' : '恢复媒体',
          );
        }),
      )
      .immediate();
  }

  updateOptimization(id: string, update: Record<string, unknown>) {
    return this.store.raw
      .transaction(() => {
        const row = this.store.get('media', id);
        if (!row) throw new WeavaError('媒体不存在。', 404);
        const value = { ...row.value, ...update };
        this.store.raw
          .prepare("UPDATE records SET data=? WHERE scope='media' AND id=?")
          .run(JSON.stringify(value), id);
        indexRecord(this.store.raw, 'media', id, value, row.revision, row.updatedAt);
        this.store.setState(
          'media-version',
          digest([id, value.derivatives, value.optimization, Date.now()]),
        );
        return { ...row, value };
      })
      .immediate();
  }
}
