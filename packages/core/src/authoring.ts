import {
  cloneBlocks,
  contentViewSchema,
  creationTemplateSchema,
  entrySchema,
  WeavaError,
  isNoteType,
  type CreationTemplate,
} from '@weava/contracts';
import type { EntryRepository } from './entry-repository.ts';
import type { EntryValidationSite } from './content-validation.ts';
import type { SiteContent } from './site-content.ts';
import type { Release } from '@weava/contracts';
interface AuthoringSite extends EntryValidationSite {
  entryStore: EntryRepository;
  release(): Release | null;
  saveEntry: SiteContent['saveEntry'];
}

import { queryDrafts } from './query.ts';
import { prepareEntryCandidate } from './content-validation.ts';
import { uuid } from '../../runtime-common/src/identity.ts';
import { renderDocument } from './documents.ts';
import { normalizePath } from './paths.ts';
import { writingSnippetSchema } from '@weava/contracts';

export const contentViews = (site: AuthoringSite) => site.entryStore.authoringList('content-view');
export const creationTemplates = (site: AuthoringSite) =>
  site.entryStore.authoringList('creation-template');
export const writingSnippets = (site: AuthoringSite) =>
  site.entryStore.authoringList('writing-snippet');
export function saveWritingSnippet(site: AuthoringSite, input: unknown, revision: number | null) {
  const value = writingSnippetSchema.parse(input);
  renderDocument({ version: 1, format: 'markdown', source: value.source });
  return site.entryStore.saveAuthoring('writing-snippet', value.id, value, revision);
}
export function structuredBody(value: unknown) {
  const entry = entrySchema.parse(value);
  if (entry.blocks.length) return entry.blocks;
  return [
    {
      id: uuid(),
      type: 'richtext',
      props: {
        text:
          entry.document.format === 'lexical'
            ? renderDocument(entry.document)
            : entry.document.source,
      },
    },
  ];
}

export function saveContentView(site: AuthoringSite, input: unknown, revision: number | null) {
  const value = contentViewSchema.parse(input);
  queryDrafts(site, { ...value.query, page: 1, pageSize: 1 });
  return site.entryStore.saveAuthoring('content-view', value.id, value, revision);
}

export function saveCreationTemplate(site: AuthoringSite, input: unknown, revision: number | null) {
  const value = creationTemplateSchema.parse(input);
  // Check initial values through the entry path without creating a document or revision.
  prepareEntryCandidate(
    site,
    {
      ...value.initial,
      id: '__creation-template-' + value.id,
      kind: value.kind,
      type: value.type,
      title: value.initial.title || value.name,
      path: '/template-check/',
    },
    { required: false },
  );
  return site.entryStore.saveAuthoring('creation-template', value.id, value, revision);
}

export function createContent(
  site: AuthoringSite,
  input: {
    kind: 'content' | 'page';
    type?: string;
    templateId?: string;
    title?: string;
    path?: string;
  },
) {
  let template: CreationTemplate | undefined;
  if (input.templateId) {
    template = site.entryStore.authoringRecord('creation-template', input.templateId)?.value;
    if (!template || template.archived) throw new WeavaError('新建模板不存在或已归档。');
    if (
      template.kind !== input.kind ||
      (input.kind === 'content' && input.type && input.type !== template.type)
    )
      throw new WeavaError('新建模板与所选内容类型不一致。');
  }
  const type = input.type ?? template?.type ?? site.entryStore.types()[0]?.id ?? 'post';
  const definition = site.entryStore.type(type)?.value;
  if (input.kind === 'content' && !definition) throw new WeavaError('内容类型不存在。');
  return site.entryStore.transaction(() => {
    const prefix = input.kind === 'page' ? '/' : definition.pathPrefix;
    const release = site.release();
    const occupied = new Set<string>([
      ...site.entryStore.occupiedPaths(),
      ...(release?.entries.map((entry) => entry.path) ?? []),
      ...Object.keys(release?.redirects ?? {}),
    ]);
    let id = '',
      path = '';
    for (let attempt = 0; attempt < 16; attempt++) {
      id = uuid();
      path = normalizePath(input.path ?? prefix + id.slice(0, 8) + '/');
      if (input.path !== undefined || !occupied.has(path)) break;
      if (attempt === 15) throw new WeavaError('暂时无法生成未使用的网址，请重试。', 409);
    }
    const value = entrySchema.parse({
      ...structuredClone(template?.initial ?? {}),
      id,
      kind: input.kind,
      type,
      title:
        input.title ??
        template?.initial.title ??
        '未命名' + (input.kind === 'page' ? '页面' : isNoteType(definition) ? '笔记' : '内容'),
      path,
      status: 'draft',
      blocks: cloneBlocks(template?.initial.blocks ?? []),
      document: template?.initial.document ?? {
        version: 1,
        format: 'lexical',
        source: {
          root: {
            type: 'root',
            version: 1,
            direction: null,
            format: '',
            indent: 0,
            children: [
              {
                type: 'paragraph',
                version: 1,
                direction: null,
                format: '',
                indent: 0,
                children: [],
                textFormat: 0,
                textStyle: '',
              },
            ],
          },
        },
      },
    });
    return site.saveEntry(value, null);
  });
}
