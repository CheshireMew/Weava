import { WeavaError as DomainError } from '@weava/contracts';
import { cancelSchedule, retrySchedule, schedules } from '@weava/core';
import {
  publicationPlanEntry,
  requireRunnablePlan,
} from '../../../../packages/core/src/publication-plans.ts';

import { cancelPublicationPlan, publicationPlans } from '@weava/core';

import type { AdminHandlers, ApiServices } from './types.ts';
export function publicationHandlers(
  services: Pick<ApiServices, 'site' | 'siteExtension' | 'jobs'>,
) {
  const { site, siteExtension, jobs } = services;
  const execute = (operation: string, payload: any, key?: string) =>
    jobs.enqueue(operation, payload, key);
  return {
    publication: async ({ body: data }) => {
      return jobs.query('publication-review', data ?? {});
    },
    publish: async ({ body: data }, context) => {
      const { request } = context;
      const job=execute(
        'publish',
        data ?? {},
        request.headers.get('Idempotency-Key') ?? undefined,
      );
      return jobs.observe(job.id);
    },
    withdraw: async ({ body: data }, context) => {
      return jobs.command(
        'withdraw',
        data,
        context.request.headers.get('Idempotency-Key') ?? undefined,
      );
    },
    rollback: async ({ body: data }) => {
      if ((data.review === undefined) !== (data.baseReleaseId === undefined))
        throw new DomainError('请重新检查恢复内容。');
      return site.rollback(
        data.id,
        data.review === undefined
          ? undefined
          : { baseReleaseId: data.baseReleaseId!, review: data.review },
      );
    },
    previewRollback: async ({ body }) => site.previewRollback(body.id),
    schedules: async ({}, context) => {
      const { url } = context;
      return schedules(site, url.searchParams.get('entryId') ?? undefined);
    },
    schedule: async ({ body: data }, context) => {
      return jobs.command(
        'schedule-create',
        data,
        context.request.headers.get('Idempotency-Key') ?? undefined,
      );
    },
    cancelSchedule: async ({ body: data }) => {
      const result=cancelSchedule(site,data.id,data.revision);jobs.refreshSchedule();return result;
    },
    retrySchedule: async ({ body: data }) => {
      const result=retrySchedule(site,data.id,data.revision);jobs.refreshSchedule();return result;
    },
    plans: async () => {
      return publicationPlans(site);
    },
    savePlan: async ({ body: data }, context) => {
      return jobs.command(
        'plan-save',
        data,
        context.request.headers.get('Idempotency-Key') ?? undefined,
      );
    },
    planEntry: async ({}, context) => {
      const { url } = context;
      return publicationPlanEntry(site, url.searchParams.get('id') ?? '');
    },
    previewPlan: async ({ body: data }) => {
      return jobs.query('publication-plan-review', data);
    },
    runPlan: async ({ body: data }, context) => {
      const { request } = context;
      if (!data.options) throw new DomainError('请先检查发布计划。');
      requireRunnablePlan(site, data.id, data.revision);
      return await execute(
        'publish',
        { planId: data.id, planRevision: data.revision, options: data.options },
        request.headers.get('Idempotency-Key') ?? undefined,
      );
    },
    cancelPlan: async ({ body: data }) => {
      const result=cancelPublicationPlan(site,data.id,data.revision);jobs.refreshSchedule();return result;
    },
  } satisfies Pick<
    AdminHandlers,
    | 'publication'
    | 'publish'
    | 'withdraw'
    | 'rollback'
    | 'previewRollback'
    | 'schedules'
    | 'schedule'
    | 'cancelSchedule'
    | 'retrySchedule'
    | 'plans'
    | 'savePlan'
    | 'planEntry'
    | 'previewPlan'
    | 'runPlan'
    | 'cancelPlan'
  >;
}
