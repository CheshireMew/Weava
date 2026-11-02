import type { APIContext } from 'astro';
import type { z } from 'zod';
import type { AdminApi, ApiOperation, ApiOutput } from '@weava/contracts/api';
import type { requestIdentity } from '@weava/core';

export type ApiServices = Pick<
  typeof import('../runtime.ts'),
  'site' | 'analytics' | 'engagement' | 'siteExtension' | 'jobs' | 'reports'
>;
export type AdminContext = APIContext & { identity: ReturnType<typeof requestIdentity> };
export type ParsedInput<K extends ApiOperation> = {
  params: z.output<AdminApi[K]['params']>;
  query: z.output<AdminApi[K]['query']>;
  body: z.output<AdminApi[K]['body']>;
};
export type AdminHandler<K extends ApiOperation> = (
  input: ParsedInput<K>,
  context: AdminContext,
) => ApiOutput<K> | Promise<ApiOutput<K>>;
export type AdminHandlers = { [K in ApiOperation]: AdminHandler<K> };
