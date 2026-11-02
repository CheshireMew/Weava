import { VERSION as frameworkVersion } from '@weava/contracts';

import type { ApiServices, AdminHandlers } from './types.ts';
import { authorized } from './transport.ts';
export function sessionHandlers(services: Pick<ApiServices, 'site'>) {
  const { site } = services;

  return {
    session: async ({}, context) => {
      return {
        authenticated: authorized(services, context),
        initialized: site.ownerExists(),
        version: frameworkVersion,
      };
    },
    login: async ({ body: data }, context) => {
      const { cookies, identity } = context;

      const token = await site.login(data.password, identity.network, { code:data.code,username:data.username,userAgent:context.request.headers.get('user-agent') ?? '' });
      cookies.set('weava-session', token, {
        path: '/',
        httpOnly: true,
        sameSite: 'strict',
        secure: identity.secure,
        maxAge: 604800,
      });
      return { authenticated: true };
    },
    logout: async ({}, context) => {
      const { cookies } = context;

      site.logout(cookies.get('weava-session')?.value ?? '');
      cookies.set('weava-session', '', { path: '/', maxAge: 0 });
      return { ok: true };
    },
  } satisfies Pick<AdminHandlers, 'session' | 'login' | 'logout'>;
}
