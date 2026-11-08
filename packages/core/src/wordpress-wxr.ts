import { WeavaError } from '@weava/contracts';
import { copyFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { checkWxrComments, writeWxrComments } from './wordpress-wxr-comments.ts';
import { importSite } from './exchange.ts';
import type { Site } from './site.ts';
import { EntryWorkspace } from './staged-entries.ts';
import { prepareWxrAttachments } from './wordpress-wxr-assets.ts';
import { convertWxr } from './wordpress-wxr-conversion.ts';
import { optionKey, type WxrOptions } from './wordpress-wxr-options.ts';
import { wxrDigest, type WxrInput } from './wordpress-wxr-xml.ts';
export type { WxrOptions } from './wordpress-wxr-options.ts';
export type { WxrInput } from './wordpress-wxr-xml.ts';
const revision = (site: Site) =>
  (site.store.raw.prepare('SELECT COALESCE(MAX(revision),0) n FROM revisions').get() as any)
    .n as number;
export function convertWordPressWxr(
  site: Site,
  xml: WxrInput,
  options: WxrOptions = {},
  mediaMap: Record<string, string> = {},
  workspace?: EntryWorkspace,
) {
  const fingerprint = wxrDigest(xml);
  return convertWxr(
    {
      fingerprint,
      known: site.store.get('import-report', fingerprint)?.value,
      terms: site.terms().map((row) => row.value),
      types: site.store.list('type').map((row) => row.value),
      settings: site.settings().value,
      revision: revision(site),
      releaseId: site.store.state('release') ?? null,
      paths: site.store.raw
        .prepare("SELECT id,json_extract(summary,'$.path') path FROM entry_list")
        .all() as { id: string; path: string }[],
    },
    xml,
    options,
    mediaMap,
    workspace,
  );
}
export async function importWordPressWxr(
  site: Site,
  xml: WxrInput,
  options: WxrOptions = {},
  progress: (message: string) => void = () => {},
) {
  const workspace = new EntryWorkspace(site.root);
  try {
    return await importWxr(site, xml, options, progress, workspace);
  } finally {
    workspace.close();
  }
}
async function importWxr(
  site: Site,
  xml: WxrInput,
  options: WxrOptions,
  progress: (message: string) => void,
  workspace: EntryWorkspace,
) {
  const initial = convertWordPressWxr(site, xml, options, {}, workspace);
  const checkReview = () => {
    if (
      options.review &&
      (options.review.fingerprint !== initial.report.fingerprint ||
        options.review.revision !== revision(site) ||
        options.review.releaseId !== (site.store.state('release') ?? null) ||
        options.review.options !== optionKey(options))
    )
      throw new WeavaError('来源文件、导入选项或站点内容已变化，请重新预检。', 409);
  };
  checkReview();
  if (options.comments !== false) checkWxrComments(site, initial.comments);
  const preview = importSite(site, initial.value, { ...options, dryRun: true });
  if (options.dryRun)
    return {
      ...initial.report,
      exchange: preview,
      dryRun: true,
      downloaded: 0,
      importedComments: 0,
      sourcePath: null,
    };
  const { prepared, mediaMap, reusedMedia } = await prepareWxrAttachments(
    site,
    initial,
    options,
    progress,
  );
  if (Object.keys(mediaMap).length) {
    initial.value.entries = [];
    initial.comments.length = 0;
    workspace.reset();
  }
  const converted = Object.keys(mediaMap).length
    ? convertWordPressWxr(site, xml, options, mediaMap, workspace)
    : initial;
  const archive = join(site.root, 'imports', 'wordpress-wxr', initial.report.fingerprint);
  mkdirSync(archive, { recursive: true });
  const sourcePath = join(archive, 'source.xml');
  if (!existsSync(sourcePath)) {
    if (typeof xml === 'string') writeFileSync(sourcePath, xml);
    else copyFileSync(xml.file, sourcePath);
  }
  const result = site.store.raw
    .transaction(() => {
      checkReview();
      const exchange = importSite(site, converted.value, { ...options, dryRun: false });
      for (const row of prepared)
        if (!site.store.get('media', row.id))
          site.store.put('media', row.id, row.value, null, 'WordPress 附件');
      const comments = options.comments === false ? 0 : writeWxrComments(site, converted.comments);
      const result = {
        ...converted.report,
        exchange,
        dryRun: false,
        downloaded: prepared.length,
        reusedMedia,
        importedComments: comments,
        sourcePath,
      };
      const old = site.store.get('import-report', initial.report.fingerprint);
      site.store.put(
        'import-report',
        initial.report.fingerprint,
        result,
        old?.revision ?? null,
        'WordPress WXR 导入',
      );
      return result;
    })
    .immediate();
  return result;
}
