import { WeavaError as DomainError } from '@weava/contracts';
import { digest } from '@weava/core';
import { importRevisions } from '../../../../packages/core/src/exchange.ts';

import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { queueJsonImport } from '../../../../packages/core/src/json-import.ts';
import { stageImportSource, queueImportSource } from '../../../../packages/core/src/import-sources.ts';
import { exportResponse } from '../../../../packages/core/src/export-response.ts';
import type { AdminHandlers, ApiServices } from './types.ts';
export function exchangeHandlers(services: Pick<ApiServices, 'site' | 'jobs'>) {
  const { site, jobs } = services;
  const execute = (operation: string, payload: any, key?: string) =>
    jobs.enqueue(operation, payload, key);
  return {
    markdownExport:async({body},context)=>jobs.enqueue('markdown-export',body,context.request.headers.get('Idempotency-Key')??undefined),
    markdownPreview:async({body},context)=>jobs.enqueue('markdown-preview',body,context.request.headers.get('Idempotency-Key')??undefined),
    markdownImport:async({body},context)=>jobs.enqueue('markdown-import',body,context.request.headers.get('Idempotency-Key')??undefined),
    export: async () => exportResponse(site),
    exportFile: async () => exportResponse(site, true),
    stageImportSource: async ({ query }, context) => stageImportSource(site, context.request, query.name),
    runImportSource: async ({ body }, context) => queueImportSource(site, jobs, body.sourceId, body.options ?? {}, context.request.headers.get('Idempotency-Key') ?? undefined),
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

      if ('sourceId' in data) return queueImportSource(site, jobs, data.sourceId, data.options ?? {}, request.headers.get('Idempotency-Key') ?? undefined);

      if (typeof data.xml !== 'string') throw new DomainError('请选择 WXR XML 文件。');
      const options = { ...data.options };

      const sourcePath = join(site.root, 'imports', 'wxr-' + digest(data.xml) + '.xml');
      if (!existsSync(sourcePath))
        await (await import('node:fs/promises')).writeFile(sourcePath, data.xml);
      return await execute(
        options.dryRun ? 'preflight-wxr' : 'import-wxr',
        { sourcePath, options },
        request.headers.get('Idempotency-Key') ?? undefined,
      );
    },
  } satisfies Pick<AdminHandlers, 'export' | 'exportFile' | 'stageImportSource' | 'runImportSource' | 'import' | 'importRevisions' | 'importWxr' | 'markdownExport' | 'markdownPreview' | 'markdownImport'>;
}
