import { layouts, saveLayout } from '@weava/core';
import { contentTypes } from '../../../../packages/core/src/admin-content.ts';
import {resolveSiteInfo} from '../../../../packages/core/src/site-info.ts';

import type { AdminHandlers, ApiServices } from './types.ts';
export function configurationHandlers(services: Pick<ApiServices, 'site'>) {
  const { site } = services;

  return {
    settings: async () => {
      return site.settings();
    },
    siteInfo:async()=>resolveSiteInfo(site),
    saveSettings: async ({ body: data }) => {
      return site.saveSettings(data.value, data.revision);
    },
    types: async () => {
      return contentTypes(site);
    },
    saveType: async ({ body: data }) => {
      return site.saveType(data.value, data.revision ?? null);
    },
    terms: async () => {
      return site.terms();
    },
    saveTerm: async ({ body: data }) => {
      return site.saveTerm(data.value, data.revision ?? null);
    },
    layouts: async () => {
      return layouts(site);
    },
    saveLayout: async ({ body: data }) => {
      return saveLayout(site, data.value, data.revision ?? null);
    },
  } satisfies Pick<
    AdminHandlers,
    | 'settings'
    | 'siteInfo'
    | 'saveSettings'
    | 'types'
    | 'saveType'
    | 'terms'
    | 'saveTerm'
    | 'layouts'
    | 'saveLayout'
  >;
}
