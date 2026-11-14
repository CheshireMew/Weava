import { join } from 'node:path';
import { inside } from '../../runtime-common/src/paths.ts';
import type { JobContext } from './job-context.ts';
export async function executeImportJob({ site, job, content, imports }: JobContext) {
  const { operation, payload, id } = job;
  if (operation === 'import-json')
    return (await import('./json-import.ts')).executeJsonImport(site, id, payload);
  await content();
  if (operation.startsWith('markdown-')) {
    const markdown = await import('./markdown-folder.ts');
    if (operation === 'markdown-export')
      return markdown.exportMarkdownFolder(site, payload.path, payload.budgetBytes);
    if (operation === 'markdown-preview')
      return markdown.previewMarkdownFolder(site, payload.path, payload.options);
    return markdown.importMarkdownFolder(site, payload.path, payload.options);
  }
  const options = {
    ...payload.options,
    dryRun: operation === 'preflight-wxr' || payload.options?.dryRun === true,
  };
  const progress = (message: string) => site.updateJob(id, { message });
  const complete = (result: unknown) => {
    site.store.assertTask();
    site.updateJob(id, { status: 'complete', message: '导入处理已完成。', result });
  };
  if (payload.sourceId) {
    const source = imports ? await imports() : await import('./import-sources.ts');
    try {
      return await source.executeImportSource(site, payload.sourceId, options, progress, complete);
    } finally {
      if (!imports) source.closePreparedImports();
    }
  }
  return (await import('./wordpress-wxr.ts')).importWordPressWxr(
    site,
    { file: inside(join(site.root, 'imports'), payload.sourcePath) },
    options,
    progress,
  );
}
