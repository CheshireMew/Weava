import { WeavaError as DomainError } from '@weava/contracts';

import { siteOpenApi, siteSchema, siteTypes } from '@weava/core';


import {
  importSearchData,
  renderEntryTemplate,
  searchDataReport,
} from '@weava/core';
import type { AdminHandlers, ApiServices } from './types.ts';
export function searchHandlers(services: Pick<ApiServices, 'site' | 'siteExtension' | 'jobs'>) {
  const { site, siteExtension, jobs } = services;

  return {
    schema: async ({ query }) => {
      return query.format === 'types'
        ? siteTypes(site)
        : query.format === 'openapi'
          ? siteOpenApi(site)
          : siteSchema(site);
    },
    seoAudit: async ({ body: data }, context) => {
      const target = data?.target === 'draft' ? 'draft' : 'published';
      if (data?.http && target !== 'published')
        throw new DomainError('HTTP 检查只能读取已发布页面。');
      return jobs.enqueue('seo-audit', {...data, target, origin:context.url.origin}, context.request.headers.get('Idempotency-Key') ?? undefined);
    },
    seoAudits: async () => {
      return jobs.query('seo-audits', {});
    },
    seoMetadata: async ({}, context) => {
      const { url } = context;

      const release = site.visibleRelease();
      if (!release) throw new DomainError('网站尚未发布。');
      const entry = release.entries.find((entry) => entry.id === url.searchParams.get('id'));
      if (!entry) throw new DomainError('公开内容不存在。', 404);
      const manager = await siteExtension;
      const html =
        (await manager.render(entry, release)) ||
        renderEntryTemplate(entry, release, manager.blocks);
      return await manager.metadata(
        entry,
        release,
        new URL(url.searchParams.get('path') || entry.path, release.settings.domain),
        { html },
      );
    },
    searchData: async () => {
      return searchDataReport(site);
    },
    importSearchData: async ({ body: data }) => {
      return importSearchData(site, data);
    },
  } satisfies Pick<
    AdminHandlers,
    'schema' | 'seoAudit' | 'seoAudits' | 'seoMetadata' | 'searchData' | 'importSearchData'
  >;
}
