import { VERSION as frameworkVersion } from '@weava/contracts';

import type { ApiServices, AdminHandlers, AdminContext } from './types.ts';
import { authorized } from './transport.ts';
export function sessionHandlers(services: Pick<ApiServices, 'site'>) {
  const { site } = services;
  const excludeOwnVisits = (context: AdminContext) => context.cookies.set('weava-exclude', '1', {
    path: '/', sameSite: 'lax', secure: context.identity.secure, maxAge: 31536000,
  });

  return {
    session: async ({}, context) => {
      const authenticated = authorized(services, context);
      if (authenticated) excludeOwnVisits(context);
      return {
        authenticated,
        initialized: site.ownerExists(),
        version: frameworkVersion,
        accountLinks:true as const,
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
      excludeOwnVisits(context);
      return { authenticated: true };
    },
    logout: async ({}, context) => {
      const { cookies } = context;

      site.logout(cookies.get('weava-session')?.value ?? '');
      cookies.set('weava-session', '', { path: '/', maxAge: 0 });
      return { ok: true };
    },
    accountAccess: async({body},context)=>site.auth.accessInfo(body.token,context.identity.network),
    completeAccountAccess:async({body},context)=>{
      const result=await site.auth.completeAccess(body.token,context.identity.network,body);
      context.cookies.set('weava-session','',{path:'/',httpOnly:true,sameSite:'strict',secure:context.identity.secure,maxAge:0});
      return result;
    },
  } satisfies Pick<AdminHandlers, 'session' | 'login' | 'logout' | 'accountAccess' | 'completeAccountAccess'>;
}
