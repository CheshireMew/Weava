import { schedules, schedulePublication, cancelSchedule, retrySchedule } from '@weava/core';
import { WeavaError as DomainError } from '@weava/contracts';

import {
  publicationPlans,
  savePublicationPlan,
  reviewPublicationPlan,
  cancelPublicationPlan,
} from '@weava/core';

import { preparePublication } from '@weava/core';

import type { ApiServices, AdminHandlers } from './types.ts';
export function publicationHandlers(
  services: Pick<ApiServices, 'site' | 'siteExtension' | 'jobs'>,
) {
  const { site, siteExtension, jobs } = services;
  const execute = (operation: string, payload: any, key?: string) =>
    jobs.enqueue(operation, payload, key);
  return {
    publication: async ({ body: data }) => {
      const review = site.previewPublication(data ?? {});
      await (await siteExtension).validateRelease(preparePublication(site, review.options).release);
      return review;
    },
    publish: async ({ body: data }, context) => {
      const { request } = context;
      return await execute(
        'publish',
        data ?? {},
        request.headers.get('Idempotency-Key') ?? undefined,
      );
    },
    withdraw: async ({ body: data }) => {
      const options = site.withdrawalOptions(data.id, data.revision);
      if (options)
        await (await siteExtension).validateRelease(preparePublication(site, options).release);
      return site.withdraw(data.id, data.revision, !!data.archive, options);
    },
    rollback: async ({ body: data }) => {
      return site.rollback(data.id);
    },
    schedules: async ({}, context) => {
      const { url } = context;
      return schedules(site, url.searchParams.get('entryId') ?? undefined);
    },
    schedule: async ({ body: data }) => {
      return schedulePublication(site, data.id, data.revision, data.dueAt);
    },
    cancelSchedule: async ({ body: data }) => {
      return cancelSchedule(site, data.id, data.revision);
    },
    retrySchedule: async ({ body: data }) => {
      return retrySchedule(site, data.id, data.revision);
    },
    plans: async () => {
      return publicationPlans(site);
    },
    savePlan: async ({ body: data }) => {
      return savePublicationPlan(site, data.value, data.revision ?? null);
    },
    planEntry: async ({}, context) => {
      const { url } = context;
      const id = url.searchParams.get('id') ?? '',
        row = site.store.get('entry', id);
      if (!row) throw new DomainError('内容不存在。', 404);
      return {
        id,
        title: row.value.title,
        revision: row.revision,
        publishedRevision: site.release()?.entries.find((entry) => entry.id === id)?.revisionId,
      };
    },
    previewPlan: async ({ body: data }) => {
      const checked = reviewPublicationPlan(site, data.id, data.revision);
      await (
        await siteExtension
      ).validateRelease(preparePublication(site, checked.review.options).release);
      return checked;
    },
    runPlan: async ({ body: data }, context) => {
      const { request } = context;
      if (!data.options) throw new DomainError('请先检查发布计划。');
      reviewPublicationPlan(site, data.id, data.revision);
      return await execute(
        'publish',
        { planId: data.id, planRevision: data.revision, options: data.options },
        request.headers.get('Idempotency-Key') ?? undefined,
      );
    },
    cancelPlan: async ({ body: data }) => {
      return cancelPublicationPlan(site, data.id, data.revision);
    },
  } satisfies Pick<
    AdminHandlers,
    | 'publication'
    | 'publish'
    | 'withdraw'
    | 'rollback'
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
