import {
  queryDrafts,
  contentQuery,
  projectTerms,
  entryRevision,
  entryChanges,
  mergeEntry,
  saveMergedEntry,
} from '@weava/core';
import { WeavaError as DomainError } from '@weava/contracts';
import { checkEntry, queryReferences } from '@weava/core';

import {
  contentViews,
  creationTemplates,
  saveContentView,
  saveCreationTemplate,
  createContent,
  duplicateContent,
  structuredBody,
} from '@weava/core';

import { previewBulkEdit, applyBulkEdit } from '@weava/core';

import type { ApiServices, AdminHandlers } from './types.ts';
export function contentHandlers(services: Pick<ApiServices, 'site' | 'jobs'>) {
  const { site, jobs } = services;

  return {
    entries: async () => {
      return site.entries();
    },
    queryEntries: async ({}, context) => {
      const { url } = context;
      return queryDrafts(site, {
        ...contentQuery(url.searchParams),
        status: url.searchParams.get('status') ?? undefined,
        visibility: url.searchParams.get('visibility') ?? undefined,
      });
    },
    createEntry: async ({ body: data }) => {
      return createContent(site, data);
    },
    duplicateEntry: async ({ body: data }) => duplicateContent(site, data.id, data.revision),
    deleteEntry: async ({ body: data }) => jobs.query('entry-delete', data),
    getEntry: async ({ params }) => {
      const row = site.store.get('entry', params.id);
      if (!row) throw new DomainError('内容不存在。', 404);
      return {
        ...row,
        value: projectTerms(
          row.value,
          site.terms().map((row) => row.value),
        ),
      };
    },
    saveEntry: async ({ body: data }) => {
      return site.saveEntry(data.value, data.revision ?? null);
    },
    checkEntry: async ({ body: data }) => {
      return checkEntry(site, data.value, { required: data.required !== false });
    },
    structureEntry: async ({ body: data }) => {
      return structuredBody(data.value);
    },
    previewBulk: async ({ body: data }) => {
      const { values, ...preview } = previewBulkEdit(site, data);
      return preview;
    },
    applyBulk: async ({ body: data }) => {
      return applyBulkEdit(site, data);
    },
    queryReferences: async ({}, context) => {
      const { url } = context;
      return queryReferences(site, {
        referenceTypes: url.searchParams.has('types')
          ? url.searchParams.get('types')!.split(',').filter(Boolean)
          : undefined,
        referenceFilters: url.searchParams.has('filters')
          ? JSON.parse(url.searchParams.get('filters')!)
          : undefined,
        query: url.searchParams.get('q') ?? '',
        page: Number(url.searchParams.get('page') || 1),
        pageSize: Number(url.searchParams.get('pageSize') || 18),
      });
    },
    views: async () => {
      return contentViews(site);
    },
    saveView: async ({ body: data }) => {
      return saveContentView(site, data.value, data.revision ?? null);
    },
    templates: async () => {
      return creationTemplates(site);
    },
    saveTemplate: async ({ body: data }) => {
      return saveCreationTemplate(site, data.value, data.revision ?? null);
    },
    history: async ({}, context) => {
      const { url } = context;
      return site.history(url.searchParams.get('id') ?? '');
    },
    revision: async ({}, context) => {
      const { url } = context;
      return entryRevision(
        site,
        url.searchParams.get('id') ?? '',
        Number(url.searchParams.get('version')),
      );
    },
    compareRevisions: async ({}, context) => {
      const { url } = context;

      const id = url.searchParams.get('id') ?? '';
      const before = entryRevision(site, id, Number(url.searchParams.get('from'))),
        after = entryRevision(site, id, Number(url.searchParams.get('to')));
      return { before, after, changes: entryChanges(before.value, after.value) };
    },
    mergeEntry: async ({ body: data }) => {
      return mergeEntry(site, data.id, data.baseRevision, data.value, data.choices);
    },
    saveMerge: async ({ body: data }) => {
      return saveMergedEntry(site, data);
    },
    restore: async ({ body: data }) => {
      return site.restore(data.id, data.version, data.revision);
    },
  } satisfies Pick<
    AdminHandlers,
    | 'entries'
    | 'queryEntries'
    | 'createEntry'
    | 'duplicateEntry'
    | 'deleteEntry'
    | 'getEntry'
    | 'saveEntry'
    | 'checkEntry'
    | 'structureEntry'
    | 'previewBulk'
    | 'applyBulk'
    | 'queryReferences'
    | 'views'
    | 'saveView'
    | 'templates'
    | 'saveTemplate'
    | 'history'
    | 'revision'
    | 'compareRevisions'
    | 'mergeEntry'
    | 'saveMerge'
    | 'restore'
  >;
}
