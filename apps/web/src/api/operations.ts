import { storageUsage, schedules, layouts } from '@weava/core';
import { WeavaError as DomainError } from '@weava/contracts';

import { readJobLog } from '@weava/core';
import { contentViews, creationTemplates } from '@weava/core';

import { publicationPlans } from '@weava/core';

import {
  planHistoryArchive,
  historyArchives,
  historyArchiveContents,
  programStatus,
  SCHEMA_VERSION,
} from '@weava/core';
import { join } from 'node:path';

import type { ApiServices, AdminHandlers } from './types.ts';
import { resolveSiteInfo } from '../../../../packages/core/src/site-info.ts';

export function operationsHandlers(services: Pick<ApiServices, 'site' | 'siteExtension' | 'jobs'>) {
  const { site, siteExtension, jobs } = services;
  const execute = (operation: string, payload: any, key?: string) =>
    jobs.enqueue(operation, payload, key);
  return {
    state: async ({}, context) => {
      const { url } = context;
      return {
        settings: site.settings(),
        ...(url.searchParams.get('panel') === 'appearance' ? { siteInfo: resolveSiteInfo(site) } : {}),
        types: site.store.list('type'),
        contentViews: contentViews(site),
        creationTemplates: creationTemplates(site),
        terms: site.terms(),
        layouts: layouts(site),
        schedules:
          url.searchParams.get('summary') === '1'
            ? url.searchParams.get('entryId')
              ? schedules(site, url.searchParams.get('entryId')!)
              : []
            : schedules(site),
        publicationPlans: url.searchParams.get('summary') === '1' ? [] : publicationPlans(site),
        entries: url.searchParams.get('summary') === '1' ? [] : site.entries(),
        entryCount: site.store.raw
          .prepare("SELECT COUNT(*) n FROM records WHERE scope='entry'")
          .get() as { n: number },
        media: url.searchParams.get('summary') === '1' ? [] : site.store.list('media'),
        jobs:
          url.searchParams.get('summary') === '1'
            ? url.searchParams.get('panel') === 'operations'
              ? site.jobs(true)
              : []
            : site.jobs(),
        releases:
          url.searchParams.get('summary') === '1'
            ? url.searchParams.get('panel') === 'operations'
              ? (site.store.raw
                  .prepare('SELECT id,created_at FROM releases ORDER BY created_at DESC LIMIT 20')
                  .all() as { id: string; created_at: string }[])
              : []
            : site.releases(),
        themes: [
          { id: 'weava', label: 'Weava' },
          { id: 'newsletter', label: 'Newsletter' },
          ...((await siteExtension)?.themes ?? []),
        ],
        extensionPanels: (await siteExtension)?.panels ?? [],
        fieldWidgets: site.fieldWidgets,
        extensionBlocks: Object.keys((await siteExtension)?.blocks ?? {}),
        extensionBlockDefinitions: Object.fromEntries(
          Object.entries((await siteExtension).blockDefinitions).map(([key, value]) => [
            key,
            { label: value.label, fields: value.fields.map((field) => ({ ...field })) },
          ]),
        ),
        extensions: (await siteExtension).status(),
        program: { ...programStatus(site.root), databaseSchema: SCHEMA_VERSION },
      };
    },
    extensions: async () => {
      return (await siteExtension).status();
    },
    extensionUsage: async ({}, context) => {
      const { url } = context;
      return (await siteExtension).usage(url.searchParams.get('id') ?? '');
    },
    toggleExtension: async ({ body: data }) => {
      if (typeof data.enabled !== 'boolean') throw new DomainError('扩展启停状态无效。');
      return await (await siteExtension).setEnabled(data.id, data.enabled, data.revision ?? null);
    },
    maintenance: async () => {
      return jobs.query('storage-usage',{});
    },
    previewArchive: async ({ body: data }) => {
      return jobs.query('archive-plan',data);
    },
    archiveHistory: async ({ body: data }) => {
      return await execute('archive-history', data);
    },
    restoreArchive: async ({ body: data }) => {
      return await execute('restore-history', data);
    },
    archives: async () => {
      return historyArchives(site).map(({ privateMedia, ...row }) => row);
    },
    archiveContents: async ({}, context) => {
      const { url } = context;
      return jobs.query('archive-contents',{id:url.searchParams.get('id')??''});
    },
    jobs: async () => {
      return site.jobs();
    },
    job: async ({ params }) => {
      return site.job(params.id);
    },
    logs: async ({}, context) => {
      const { url } = context;

      const id = url.searchParams.get('id') ?? '';
      site.job(id);
      const file = join(site.root, 'logs', id + '.log');
      return await readJobLog(file, Number(url.searchParams.get('offset') ?? 0));
    },
    backup: async ({ body: data }, context) => {
      const { request } = context;
      return await execute(
        'backup',
        data ?? {},
        request.headers.get('Idempotency-Key') ?? undefined,
      );
    },
    verify: async ({ body: data }, context) => {
      const { request } = context;
      return await execute(
        'verify',
        data ?? {},
        request.headers.get('Idempotency-Key') ?? undefined,
      );
    },
  } satisfies Pick<
    AdminHandlers,
    | 'state'
    | 'extensions'
    | 'extensionUsage'
    | 'toggleExtension'
    | 'maintenance'
    | 'previewArchive'
    | 'archiveHistory'
    | 'restoreArchive'
    | 'archives'
    | 'archiveContents'
    | 'jobs'
    | 'job'
    | 'logs'
    | 'backup'
    | 'verify'
  >;
}
