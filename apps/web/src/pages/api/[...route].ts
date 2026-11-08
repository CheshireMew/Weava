import type { APIRoute } from 'astro';
import { matchAdminApi } from '@weava/contracts/api';
import { WeavaError } from '@weava/contracts';
import { readJsonBody, requestIdentity } from '@weava/core';
import * as services from '../../runtime.ts';
import { createAdminDispatcher } from '../../api/dispatch.ts';
import { publicApi } from '../../api/public.ts';
import { authorized, json, validateExtensionResponse } from '../../api/transport.ts';
import type { AdminContext } from '../../api/types.ts';
import { assertRequestOrigin,assertJsonRequest } from '../../../../../packages/core/src/request-safety.ts';
import { ZodError } from 'zod';
import { readMediaUploadRequest } from '../../../../../packages/core/src/legacy-media-upload.ts';
import { anonymousSessionOperations } from '@weava/contracts/session-api';
import {queueJsonImport} from '../../../../../packages/core/src/json-import.ts';
import {importRequestBytes} from '../../../../../packages/contracts/src/import-limits.ts';
const dispatch = createAdminDispatcher(services);
export const ALL: APIRoute = async (context) => {
  try {
    const route = new URL(context.request.url).pathname.slice('/api/'.length);
    // Decode the wire path exactly once, before extensions or a built-in mutation can execute.
    let match;
    try {
      if (route.startsWith('admin/v1/'))
        match = matchAdminApi(context.request.method, route.slice(9));
    } catch {
      return json({ error: '接口地址编码无效。' }, 400);
    }
    let peer = '';
    try {
      peer = context.clientAddress;
    } catch {}
    const requestContext = Object.assign(Object.create(context), {
      identity: requestIdentity(context.request, peer),
    }) as AdminContext;
    assertRequestOrigin(context.request,requestContext.identity.protocol);
    const admin=route.startsWith('admin/v1/');
    const write = !['GET', 'HEAD'].includes(context.request.method);
    if(admin && (!match || !(anonymousSessionOperations as readonly string[]).includes(match.operation)) && !authorized(services,requestContext))
      throw new WeavaError('请先登录。',401);
    if(admin && write && match?.operation!=='uploadChunk') assertJsonRequest(context.request);
    const custom = await (
      await services.siteExtension
    ).route?.(context.request, services.site.visibleRelease());
    if (custom) return validateExtensionResponse(custom, match?.operation);
    if (!route.startsWith('admin/v1/'))
      return (
        (await publicApi(services, requestContext, route)) ?? json({ error: '接口不存在。' }, 404)
      );
    if (!match) return json({ error: '接口或请求方法不存在。' }, 404);
    if(match.operation==='import')return json(await queueJsonImport(services.site,services.jobs,context.request),202);
    const limit =
      match.operation === 'login' ? 4096 : ['accountAccess','completeAccountAccess'].includes(match.operation)
        ? 16384
        : match.operation === 'uploadMedia'
          ? 45 * 1024 * 1024
          : match.operation === 'importWxr'
            ? importRequestBytes
            : 16 * 1024 * 1024;
    const body = match.operation==='uploadMedia' ? await readMediaUploadRequest(services.site,services.jobs,context.request) : write && match.operation!=='uploadChunk' ? await readJsonBody(context.request, limit) : undefined;
    return await dispatch(match.operation, match.params, body, requestContext);
  } catch (error: any) {
    if(error instanceof WeavaError){
      const retry=(error.details as {retryAfter?:number}|undefined)?.retryAfter;
      return json({error:error.message,details:error.details},error.status,retry&&[429,503].includes(error.status)?{'Retry-After':String(retry)}:{});
    }
    if(error instanceof ZodError)return json({error:'请求参数无效。',details:error.issues.map(issue=>({path:issue.path,message:issue.message}))},400);
    console.error('API request failed',error);
    return json({error:'网站暂时无法完成操作，请稍后重试。'},500);
  }
};
