import { exportSite, importSite, digest } from '@weava/core';
import { WeavaError as DomainError } from '@weava/contracts';

import { join } from 'node:path';
import { existsSync } from 'node:fs';

import type { ApiServices, AdminHandlers } from './types.ts';
export function exchangeHandlers(services: Pick<ApiServices, 'site' | 'jobs'>) {
  const { site, jobs } = services;
  const execute = (operation: string, payload: any, key?: string) =>
    jobs.enqueue(operation, payload, key);
  return {
    export: async () => {
      return exportSite(site);
    },
    import: async ({ body: data }) => {
      return importSite(site, data.value, data.options);
    },
    importRevisions: async () => {
      return Object.fromEntries(
        [
          'entry',
          'type',
          'term',
          'layout',
          'settings',
          'redirect',
          'content-view',
          'creation-template',
        ].flatMap((scope) =>
          site.store.list(scope).map((row) => [scope + ':' + row.id, row.revision]),
        ),
      );
    },
    importWxr: async ({ body: data }, context) => {
      const { request } = context;

      if (typeof data.xml !== 'string') throw new DomainError('请选择 WXR XML 文件。');
      const options = { ...data.options };

      const sourcePath = join(site.root, 'imports', 'wxr-' + digest(data.xml) + '.xml');
      if (!existsSync(sourcePath))
        await (await import('node:fs/promises')).writeFile(sourcePath, data.xml);
      if (options.dryRun)
        return await jobs.wait(
          jobs.enqueue(
            'preflight-wxr',
            { sourcePath, options },
            request.headers.get('Idempotency-Key') ?? undefined,
          ).id,
        );
      return await execute(
        'import-wxr',
        { sourcePath, options },
        request.headers.get('Idempotency-Key') ?? undefined,
      );
    },
  } satisfies Pick<AdminHandlers, 'export' | 'import' | 'importRevisions' | 'importWxr'>;
}
