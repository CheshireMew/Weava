import { contentViewSchema, creationTemplateSchema, entrySchema, WeavaError, type Block, type CreationTemplate } from '@weava/contracts';
import type { Site } from './site.ts';
import { queryDrafts } from './query.ts';
import { prepareEntryCandidate } from './content-validation.ts';
import { uuid } from './storage.ts';
import { renderDocument } from './documents.ts';

export const contentViews = (site: Site) => site.store.list('content-view');
export const creationTemplates = (site: Site) => site.store.list('creation-template');
export function structuredBody(value: unknown) {
  const entry = entrySchema.parse(value);
  if (entry.blocks.length) return entry.blocks;
  return [{ id: uuid(), type: 'richtext', props: { text: entry.document.format === 'lexical' ? renderDocument(entry.document) : entry.document.source } }];
}

export function saveContentView(site: Site, input: unknown, revision: number | null) {
  const value = contentViewSchema.parse(input);
  queryDrafts(site, { ...value.query, page: 1, pageSize: 1 });
  return site.store.put('content-view', value.id, value, revision);
}

export function saveCreationTemplate(site: Site, input: unknown, revision: number | null) {
  const value = creationTemplateSchema.parse(input);
  // Check initial values through the entry path without creating a document or revision.
  prepareEntryCandidate(site, { ...value.initial, id: '__creation-template-' + value.id, kind: value.kind, type: value.type, title: value.initial.title || value.name, path: '/template-check/' }, { required: false });
  return site.store.put('creation-template', value.id, value, revision);
}

export function createContent(site: Site, input: { kind: 'content' | 'page'; type?: string; templateId?: string; title?: string; path?: string }) {
  let template: CreationTemplate | undefined;
  if (input.templateId) {
    template = site.store.get('creation-template', input.templateId)?.value;
    if (!template || template.archived) throw new WeavaError('新建模板不存在或已归档。');
    if (template.kind !== input.kind || input.kind === 'content' && input.type && input.type !== template.type) throw new WeavaError('新建模板与所选内容类型不一致。');
  }
  const type = input.type ?? template?.type ?? site.store.list('type')[0]?.id ?? 'post';
  const definition = site.store.get('type', type)?.value;
  if (input.kind === 'content' && !definition) throw new WeavaError('内容类型不存在。');
  const id = uuid(), prefix = input.kind === 'page' ? '/' : definition.pathPrefix;
  const cloneBlocks = (blocks: Block[]): Block[] => blocks.map((block) => ({ ...structuredClone(block), id: uuid(), ...(block.children ? { children: cloneBlocks(block.children) } : {}) }));
  const value = entrySchema.parse({ ...structuredClone(template?.initial ?? {}), id, kind: input.kind, type,
    title: input.title ?? template?.initial.title ?? '未命名' + (input.kind === 'page' ? '页面' : '内容'),
    path: input.path ?? prefix + id.slice(0, 8) + '/', status: 'draft',
    blocks: cloneBlocks(template?.initial.blocks ?? []),
    document: template?.initial.document ?? { version: 1, format: 'lexical', source: { root: { type: 'root', version: 1, direction: null, format: '', indent: 0, children: [{ type: 'paragraph', version: 1, direction: null, format: '', indent: 0, children: [], textFormat: 0, textStyle: '' }] } } },
  });
  return site.saveEntry(value, null);
}
