import { layouts, saveLayout } from '@weava/core';

import type { ApiServices, AdminHandlers } from './types.ts';
export function configurationHandlers(services: Pick<ApiServices, 'site'>) {
  const { site } = services;

  return {
    settings: async () => {
      return site.settings();
    },
    saveSettings: async ({ body: data }) => {
      return site.saveSettings(data.value, data.revision);
    },
    types: async () => {
      return site.store.list('type');
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
    | 'saveSettings'
    | 'types'
    | 'saveType'
    | 'terms'
    | 'saveTerm'
    | 'layouts'
    | 'saveLayout'
  >;
}
