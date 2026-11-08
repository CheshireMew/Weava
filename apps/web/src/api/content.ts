import {
  checkEntry,
  contentQuery,
  entryChanges,
  entryRevision,
  mergeEntry,
  queryReferences,
  saveMergedEntry,
} from '@weava/core';
import { adminEntry, queryAdminEntries } from '../../../../packages/core/src/admin-content.ts';

import {
  contentViews,
  createContent,
  creationTemplates,
  duplicateContent,
  saveContentView,
  saveCreationTemplate,
  structuredBody,
} from '@weava/core';

import { applyBulkEdit, previewBulkEdit } from '@weava/core';

import type { AdminHandlers, ApiServices } from './types.ts';
export function contentHandlers(
  services: Pick<ApiServices, 'site' | 'jobs' | 'analytics' | 'engagement'>,
) {
  const { site, jobs, analytics, engagement } = services;

  return {
    entries: async () => {
      return site.entries();
    },
    queryEntries: async ({}, context) => {
      const { url } = context;
      return queryAdminEntries(site, analytics, engagement, {
        ...contentQuery(url.searchParams),
        status: url.searchParams.get('status') ?? undefined,
        visibility: url.searchParams.get('visibility') ?? undefined,
        format: url.searchParams.get('format') as 'article' | 'note' | undefined,
      });
    },
    createEntry: async ({ body: data }) => {
      return createContent(site, data);
    },
    duplicateEntry: async ({ body: data }) => duplicateContent(site, data.id, data.revision),
    deleteEntry: async ({ body: data }, context) =>
      jobs.command(
        'entry-delete',
        data,
        context.request.headers.get('Idempotency-Key') ?? undefined,
      ),
    getEntry: async ({ params }) => {
      return adminEntry(site, params.id);
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
