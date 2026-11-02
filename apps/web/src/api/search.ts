import { WeavaError as DomainError } from '@weava/contracts';

import { siteSchema, siteOpenApi, siteTypes } from '@weava/core';

import { preparePublication } from '@weava/core';

import {
  auditRelease,
  auditBasis,
  storeAudit,
  auditStatus,
  fetchAuditResponses,
  renderEntryTemplate,
  importSearchData,
  searchDataReport,
} from '@weava/core';
import type { ApiServices, AdminHandlers } from './types.ts';
export function searchHandlers(services: Pick<ApiServices, 'site' | 'siteExtension'>) {
  const { site, siteExtension } = services;

  return {
    schema: async ({ query }) => {
      return query.format === 'types'
        ? siteTypes(site)
        : query.format === 'openapi'
          ? siteOpenApi(site)
          : siteSchema(site);
    },
    seoAudit: async ({ body: data }, context) => {
      const { url } = context;

      const target = data?.target === 'draft' ? 'draft' : 'published';
      const release =
        target === 'draft' ? preparePublication(site, data?.options ?? {}).release : site.release();
      if (!release) throw new DomainError('网站尚未发布，请选择工作稿检查。');
      const manager = await siteExtension;
      if (data?.http && target !== 'published')
        throw new DomainError('HTTP 检查只能读取已发布页面。');
      const basis = auditBasis(site, target);
      const responses = data?.http ? await fetchAuditResponses(release, url.origin) : undefined;
      const report = await auditRelease(release, {
        target,
        basis,
        responses,
        blocks: manager.blocks,
        render: (entry, release) => manager.render(entry, release),
        metadata: (entry, release, url, options) => manager.metadata(entry, release, url, options),
      });
      storeAudit(site, report);
      return auditStatus(site, report);
    },
    seoAudits: async () => {
      return site.store
        .list('seo-audit')
        .map((row) => auditStatus(site, row.value))
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
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
