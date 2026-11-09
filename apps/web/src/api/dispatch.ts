import { exchangeHandlers } from './exchange.ts';
import { commentsHandlers } from './comments.ts';
import { redirectsHandlers } from './redirects.ts';
import { configurationHandlers } from './configuration.ts';
import { adminApi, type ApiOperation } from '@weava/contracts/api';
import type {
  AdminContext,
  AdminHandler,
  AdminHandlers,
  ApiServices,
  ParsedInput,
} from './types.ts';
import { contentHandlers } from './content.ts';
import { publicationHandlers } from './publication.ts';
import { mediaHandlers } from './media.ts';
import { operationsHandlers } from './operations.ts';
import { analyticsHandlers } from './analytics.ts';
import { searchHandlers } from './search.ts';
import { sessionHandlers } from './session.ts';
import { accountHandlers } from './account.ts';
import { json } from './transport.ts';

export function createAdminHandlers(services: ApiServices) {
  return {
    ...contentHandlers(services),
    ...exchangeHandlers(services),
    ...commentsHandlers(services),
    ...redirectsHandlers(services),
    ...configurationHandlers(services),
    ...publicationHandlers(services),
    ...mediaHandlers(services),
    ...operationsHandlers(services),
    ...analyticsHandlers(services),
    ...searchHandlers(services),
    ...sessionHandlers(services),
    ...accountHandlers(services),
  };
}
export function createAdminDispatcher(services: ApiServices) {
  const handlers: AdminHandlers = createAdminHandlers(services);
  return async <K extends ApiOperation>(
    operation: K,
    params: Record<string, string>,
    body: unknown,
    context: AdminContext,
  ) => {
    const definition = adminApi[operation];
    const input = {
      params: definition.params.parse(params),
      query: definition.query.parse(Object.fromEntries(context.url.searchParams)),
      body: definition.body.parse(body),
    } as ParsedInput<K>;
    // A runtime-selected key retains the same K for its parsed input and its handler.
    const handler = handlers[operation] as AdminHandler<K>;
    const value = await handler(input, context);
    if ('stream' in definition && definition.stream && value instanceof Response) return value;
    const checked = definition.response.safeParse(value);
    if (!checked.success) {
      console.error('API response contract mismatch', operation, checked.error.issues);
      return json({ error: '网站返回数据与接口定义不一致。', details: checked.error.issues }, 500);
    }
    if (definition.format === 'csv')
      return new Response(String(checked.data), {
        status: definition.status,
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Cache-Control': 'no-store',
          'Content-Disposition': 'attachment; filename="weava-analytics.csv"',
        },
      });
    if (typeof checked.data === 'string' && definition.format === 'schema')
      return new Response(checked.data, {
        status: definition.status,
        headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
      });
    return json(value, definition.status);
  };
}
