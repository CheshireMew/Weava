import { WeavaError as DomainError } from '@weava/contracts';
import { digest, exportSite } from '@weava/core';
import { importRevisions } from '../../../../packages/core/src/exchange.ts';

import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { queueJsonImport } from '../../../../packages/core/src/json-import.ts';
import type { AdminHandlers, ApiServices } from './types.ts';
export function exchangeHandlers(services: Pick<ApiServices, 'site' | 'jobs'>) {
  const { site, jobs } = services;
  const execute = (operation: string, payload: any, key?: string) =>
    jobs.enqueue(operation, payload, key);
  return {
    export: async () => {
      return exportSite(site);
    },
    import: async ({ body: data }, context) => {
      return queueJsonImport(
        site,
        jobs,
        new Request(context.request.url, {
          method: 'POST',
          headers: context.request.headers,
          body: JSON.stringify(data),
        }),
      );
    },
    importRevisions: async () => {
      return importRevisions(site);
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
