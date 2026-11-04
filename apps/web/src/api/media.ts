import {
  stageMedia,
  queryMedia,
  saveMediaMetadata,
  mediaReferences,
  archiveMedia,
} from '@weava/core';

import { mediaGroups, saveMediaGroup, moveMedia } from '@weava/core';

import { imagePresets, saveImagePreset } from '@weava/core';

import type { ApiServices, AdminHandlers } from './types.ts';
import { beginMediaUpload,receiveMediaChunk,mediaUploadStatus,finishMediaUpload } from '../../../../packages/core/src/media-upload.ts';
export function mediaHandlers(services: Pick<ApiServices, 'site' | 'jobs'>) {
  const { site, jobs } = services;
  const execute = (operation: string, payload: any, key?: string) =>
    jobs.enqueue(operation, payload, key);
  return {
    media: async () => {
      return site.store.list('media');
    },
    uploadMedia: async ({ body: data }, context) => {
      const { request } = context;
      if('uploadId' in data)return finishMediaUpload(site,jobs,data.uploadId);
      return await execute(
        'media',
        stageMedia(site, Buffer.from(data.base64, 'base64'), String(data.name ?? '')),
        request.headers.get('Idempotency-Key') ?? undefined,
      );
    },
    beginUpload:async({body},context)=>beginMediaUpload(site,body.name,body.size,context.request.headers.get('Idempotency-Key')??undefined),
    uploadStatus:async({params})=>mediaUploadStatus(site,params.id),
    uploadChunk:async({params,query},context)=>receiveMediaChunk(site,params.id,query.offset,context.request),
    mediaQuery: async ({}, context) => {
      const { url } = context;
      return queryMedia(site, url.searchParams);
    },
    mediaInfo: async ({ body: data }) => {
      return saveMediaMetadata(site, data.id, data.value, data.revision);
    },
    mediaReferences: async ({}, context) => {
      const { url } = context;
      return jobs.query('media-references',{id:url.searchParams.get('id')??''});
    },
    archiveMedia: async ({ body: data }) => {
      return archiveMedia(site, data.items, !!data.archived);
    },
    cropMedia: async ({ body: data }, context) => {
      const { request } = context;
      return await execute('media-edit', data, request.headers.get('Idempotency-Key') ?? undefined);
    },
    groups: async () => {
      return mediaGroups(site);
    },
    saveGroup: async ({ body: data }) => {
      return saveMediaGroup(site, data.value, data.revision ?? null);
    },
    moveMedia: async ({ body: data }) => {
      return moveMedia(site, data.items, data.groupId ?? null);
    },
    imagePresets: async () => {
      return imagePresets(site);
    },
    saveImagePreset: async ({ body: data }) => {
      return saveImagePreset(site, data.value, data.revision ?? null);
    },
    variants: async ({}, context) => {
      const { url } = context;
      return site.store
        .list('media-variant')
        .filter((row) => row.value.parentId === url.searchParams.get('id'));
    },
    imageVariant: async ({ body: data }, context) => {
      const { request } = context;
      return await execute(
        'media-variant',
        data,
        request.headers.get('Idempotency-Key') ?? undefined,
      );
    },
  } satisfies Pick<
    AdminHandlers,
    | 'media'
    | 'uploadMedia'
    | 'beginUpload'
    | 'uploadStatus'
    | 'uploadChunk'
    | 'mediaQuery'
    | 'mediaInfo'
    | 'mediaReferences'
    | 'archiveMedia'
    | 'cropMedia'
    | 'groups'
    | 'saveGroup'
    | 'moveMedia'
    | 'imagePresets'
    | 'saveImagePreset'
    | 'variants'
    | 'imageVariant'
  >;
}
