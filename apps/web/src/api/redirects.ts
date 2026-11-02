import { redirectRecords, previewRedirects, saveRedirects } from '@weava/core';

import type { ApiServices, AdminHandlers } from './types.ts';
export function redirectsHandlers(services: Pick<ApiServices, 'site'>) {
  const { site } = services;

  return {
    redirects: async () => {
      return redirectRecords(site);
    },
    previewRedirects: async ({ body: data }) => {
      return previewRedirects(site, data);
    },
    saveRedirects: async ({ body: data }) => {
      return saveRedirects(site, data);
    },
  } satisfies Pick<AdminHandlers, 'redirects' | 'previewRedirects' | 'saveRedirects'>;
}
