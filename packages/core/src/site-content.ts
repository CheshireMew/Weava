import { normalizePath } from './paths.ts';

import { prepareEntryCandidate } from './content-validation.ts';

import { now, digest } from './storage.ts';

import { attachTerms } from './taxonomy.ts';

import { validateSeo } from './seo.ts';

import {
  typeSchema,
  WeavaError,
  type Entry,
  type ContentType,
  blockDefinitions,
  fieldDefinitionIssues,
  fieldIssues,
  effectiveFields,
  contentBlockIssues,
  isReservedContentPath,
} from '@weava/contracts';
import type { Site } from './site.ts';
export class SiteContent {
  constructor(
    private site: Pick<
      Site,
      | 'store'
      | 'extensionBlockDefinitions'
      | 'fieldWidgets'
      | 'release'
      | 'settings'
      | 'validateBlocks'
      | 'saveEntry'
      | 'terms'
    >,
  ) {}
  saveType(value: ContentType, revision: number | null, candidates: Entry[] = []) {
    const type = typeSchema.parse(value);
    for (const name of type.allowedBlocks ?? [])
      if (!blockDefinitions[name] && !this.site.extensionBlockDefinitions[name])
        throw new WeavaError('允许的正文区块未注册：' + name);
    const definitions = effectiveFields(type.fields, this.site.fieldWidgets);
    const definitionErrors = fieldDefinitionIssues(definitions);
    const fieldKeys = new Set(type.fields.map((field) => field.key));
    for (const item of type.admin?.fields ?? [])
      if (!fieldKeys.has(item.key)) throw new WeavaError('后台布局引用了不存在的字段：' + item.key);
    for (const item of type.admin?.columns ?? [])
      if (!['title', 'status', 'updatedAt', 'publishedAt', ...fieldKeys].includes(item))
        throw new WeavaError('列表引用了不存在的字段：' + item);
    if (definitionErrors.length) throw new WeavaError('字段定义无效。', 400, definitionErrors);
    const seen = new Set<string>();
    for (const f of type.fields) {
      if (seen.has(f.key)) throw new WeavaError('字段名称重复：' + f.key);
      seen.add(f.key);
      if (
        f.filterable &&
        !['text', 'number', 'boolean', 'date', 'select', 'reference'].includes(f.type)
      )
        throw new WeavaError('这个字段类型不能用于列表筛选：' + f.label);
    }
    const affected = [];
    const candidateEntries = new Map(
      this.site.store.list('entry').map((row) => [row.id, row.value as Entry]),
    );
    for (const entry of candidates) candidateEntries.set(entry.id, entry);
    for (const value of [...candidateEntries.values()].filter((entry) => entry.type === type.id)) {
      const row = { id: value.id, value };
      try {
        if (row.value.kind === 'content') {
          const blocked = contentBlockIssues(row.value.blocks, type);
          if (blocked.length)
            throw new WeavaError(blocked.map((issue) => issue.message).join('；'), 400, blocked);
        }
        const issues = fieldIssues(definitions, row.value.fields, {
          reference: (id) => candidateEntries.get(id),
        });
        if (issues.length)
          throw new WeavaError(issues.map((issue) => issue.message).join('；'), 400, issues);
      } catch (e) {
        affected.push({ id: row.id, title: row.value.title, error: String(e) });
      }
    }
    if (affected.length) throw new WeavaError('字段变更与现有内容不兼容。', 409, affected);
    return this.site.store.put('type', type.id, type, revision);
  }
  entries() {
    const published = new Map(this.site.release()?.entries.map((e) => [e.id, e]) ?? []);
    return this.site.store.list('entry').map((r) => {
      const { document, blocks, compatibility, fields, source, ...summary } = r.value;
      return {
        ...r,
        value: { ...summary, visibility: summary.visibility ?? 'public' },
        published: published.has(r.id),
        hasChanges: published.get(r.id)?.revisionId !== r.revision,
      };
    });
  }
  saveEntry(value: Entry, revision: number | null, options: { references?: Entry[] } = {}) {
    const input = prepareEntryCandidate(this.site, value, { required: false, ...options });
    input.path = normalizePath(input.path);
    if (isReservedContentPath(input.path)) throw new WeavaError('这个网址由系统使用。');
    const adminPaths=[this.site.store.state('owner-admin-path')??'/admin',...JSON.parse(this.site.store.state('owner-retired-admin-paths')??'[]')];
    if(adminPaths.some((path:string)=>input.path.replace(/\/$/,'')===path||input.path.startsWith(path+'/')))
      throw new WeavaError('这个网址由后台入口使用。');
    const previous = this.site.store.get('entry', input.id);
    for (const item of input.evidence ?? []) {
      const old = previous?.value.evidence?.find((value: any) => value.id === item.id);
      if (
        old?.status === 'verified' &&
        (old.claim !== item.claim || old.url !== item.url || old.title !== item.title)
      )
        item.status = 'pending';
    }
    validateSeo(input, this.site.settings().value.domain);
    if ((previous?.revision ?? null) !== revision)
      throw new WeavaError('内容已被其他窗口修改，请重新载入。', 409, {
        id: input.id,
        currentRevision: previous?.revision,
      });
    const time = now();
    input.createdAt = previous?.value.createdAt ?? input.createdAt ?? time;
    input.updatedAt = time;
    if (!previous && revision !== null) throw new WeavaError('内容不存在。', 409);
    if (previous) {
      const a = { ...previous.value, updatedAt: '' },
        b = { ...input, updatedAt: '' };
      if (digest(a) === digest(b)) return previous;
    }
    return this.site.store.raw
      .transaction(() =>
        this.site.store.put(
          'entry',
          input.id,
          attachTerms(this.site, input, previous?.value),
          revision,
        ),
      )
      .immediate();
  }
  history(id: string) {
    return this.site.store.history('entry', id);
  }
  restore(id: string, version: number, revision: number) {
    return this.site.store.raw
      .transaction(() => {
        const row = this.site.store.raw
          .prepare('SELECT data FROM revisions WHERE scope=? AND id=? AND revision=?')
          .get('entry', id, version) as any;
        if (!row) throw new WeavaError('版本不存在。', 404);
        return this.site.saveEntry({ ...JSON.parse(row.data), status: 'draft' }, revision);
      })
      .immediate();
  }
}
