import { WeavaError, type PublishOptions } from '@weava/contracts';
import type { Site } from './site.ts';
import type { ExtensionManager } from './extension-manager.ts';
import { preparePublication } from './publication.ts';
import { auditBasis, auditRelease, auditStatus, storeAudit, type SeoAudit } from './seo-audit.ts';
import { fetchAuditBatch } from './seo-crawl.ts';
import { siteRoutes } from './site-routes.ts';

/** Shared by reusable task services and standalone workers. */
export async function executeSeoAudit(site: Site, manager: ExtensionManager, payload: {
  target?: string; http?: boolean; origin?: string; maxPages?: number; resume?: string; options?: PublishOptions;
}, progress: (message: string) => void = () => {}) {
  const target = payload.target === 'draft' ? 'draft' : 'published';
  if (payload.http && target !== 'published') throw new WeavaError('HTTP 检查只能读取已发布页面。');
  progress('正在准备检查内容…');
  const basis = auditBasis(site, target);
  const release = target === 'draft' ? preparePublication(site, payload.options ?? {}).release : site.release();
  if (!release) throw new WeavaError('网站尚未发布，请选择工作稿检查。');
  const previous = payload.resume ? site.store.get('seo-audit', payload.resume)?.value as SeoAudit | undefined : undefined;
  if (payload.resume && (!payload.http || !previous?.crawl || previous.rulesVersion !== 3 || previous.basis !== basis || previous.target !== target))
    throw new WeavaError('续查报告不存在、已过期或不是 HTTP 检查，请重新检查。', 409);
  progress(payload.http ? '正在读取公开页面…' : '正在检查页面…');
  const customPaths = siteRoutes(site.root).paths;
  const batch = payload.http ? await fetchAuditBatch(release, payload.origin ?? release.settings.domain, { maxPages: payload.maxPages, previous: previous?.crawl, paths: customPaths }) : undefined;
  const report = await auditRelease(release, { target, basis, responses: batch?.responses, previous, crawl: batch?.state, customPaths, blocks: manager.blocks,
    render: (entry, release) => manager.render(entry, release), metadata: (entry, release, url, options) => manager.metadata(entry, release, url, options),
    progress: (checked, total) => progress(`正在检查页面：${checked} / ${total}`) });
  storeAudit(site, report);
  return auditStatus(site, report);
}
