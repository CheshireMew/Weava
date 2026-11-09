import { WeavaError as DomainError } from '@weava/contracts';
import { adminState } from '../../../../packages/core/src/admin-state.ts';

import { readJobLog } from '@weava/core';

import { historyArchives } from '@weava/core';
import { join } from 'node:path';

import {
  cleanupTemporaryFiles,
  previewTemporaryCleanup,
} from '../../../../packages/core/src/temporary-files.ts';
import type { AdminHandlers, ApiServices } from './types.ts';

export function operationsHandlers(services: Pick<ApiServices, 'site' | 'siteExtension' | 'jobs'>) {
  const { site, siteExtension, jobs } = services;
  const execute = (operation: string, payload: any, key?: string) =>
    jobs.enqueue(operation, payload, key);
  return {
    cancelJob: async ({ body }) => jobs.cancel(body.id),
    previewTemporaryCleanup: async () => previewTemporaryCleanup(site),
    cleanupTemporaryFiles: async ({ body }) => cleanupTemporaryFiles(site, body.review),
    state: async ({}, context) => {
      const { url } = context;
      return adminState(site, await siteExtension, {
        panel: url.searchParams.get('panel'),
        summary: url.searchParams.get('summary') === '1',
        entryId: url.searchParams.get('entryId'),
      });
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
      return jobs.query('storage-usage', {});
    },
    previewArchive: async ({ body: data }) => {
      return jobs.query('archive-plan', data);
    },
    archiveHistory: async ({ body: data },context) => {
      return await execute('archive-history', data,context.request.headers.get('Idempotency-Key')??undefined);
    },
    restoreArchive: async ({ body: data },context) => {
      return await execute('restore-history', data,context.request.headers.get('Idempotency-Key')??undefined);
    },
    archives: async () => {
      return historyArchives(site).map(({ privateMedia, ...row }) => row);
    },
    archiveContents: async ({query}) => {
      return jobs.query('archive-contents', query);
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
    | 'cancelJob'
    | 'previewTemporaryCleanup'
    | 'cleanupTemporaryFiles'
    | 'logs'
    | 'backup'
    | 'verify'
  >;
}
