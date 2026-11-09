import * as z from 'zod';
import {
  adminApi,
  matchAdminApi,
  validateApiInput,
  type AdminApi,
  type ApiInput,
  type ApiOperation,
  type ApiOutput,
} from './admin-api.ts';
import { ApiClientError } from './api-error.ts';
import { requestApi, type ApiTransportOptions } from './api-transport.ts';
export { ApiClientError } from './api-error.ts';
export type ApiClientOptions = ApiTransportOptions;
type ParamPath<P extends string> = P extends `${infer A}{${string}}${infer B}`
  ? `${A}${string}${ParamPath<B>}`
  : P;
type Method = 'GET' | 'POST';
export type ApiPath<M extends Method> = {
  [K in ApiOperation]: AdminApi[K]['method'] extends M
    ? ParamPath<AdminApi[K]['path']> | `${ParamPath<AdminApi[K]['path']>}?${string}`
    : never;
}[ApiOperation];
type WithoutQuery<P extends string> = P extends `${infer A}?${string}` ? A : P;
type OperationAt<P extends string, M extends Method> = P extends unknown
  ? {
      [K in ApiOperation]: AdminApi[K]['method'] extends M
        ? WithoutQuery<P> extends ParamPath<AdminApi[K]['path']>
          ? K
          : never
        : never;
    }[ApiOperation]
  : never;
export type PathOutput<P extends string, M extends Method> = ApiOutput<OperationAt<P, M>>;
export type PathBody<P extends string> = z.input<AdminApi[OperationAt<P, 'POST'>]['body']>;
type InputPart<T, K extends string> = {} extends T ? { [P in K]?: T } : { [P in K]: T };
export type ClientInput<K extends ApiOperation> = InputPart<ApiInput<K>['params'], 'params'> &
  InputPart<ApiInput<K>['query'], 'query'> &
  (AdminApi[K]['method'] extends 'POST' ? { body: ApiInput<K>['body'] } : {});
export interface AdminClient {
  <const P extends ApiPath<'GET'>>(path: P): Promise<PathOutput<P, 'GET'>>;
  <const P extends ApiPath<'POST'>>(path: P, body: PathBody<P>): Promise<PathOutput<P, 'POST'>>;
  call<K extends ApiOperation>(operation: K, input: ClientInput<K>): Promise<ApiOutput<K>>;
  request(path: string, body?: unknown): Promise<unknown>;
}
export function createAdminClient(options: ApiClientOptions = {}): AdminClient {
  const request = async (path: string, body?: unknown): Promise<unknown> => {
    const method = body === undefined ? 'GET' : 'POST',
      match = matchAdminApi(method, path);
    if (!match) throw new ApiClientError('接口未在共用定义中声明：' + method + ' ' + path, 0);
    const query = new URLSearchParams(path.includes('?') ? path.slice(path.indexOf('?') + 1) : '');
    try {
      validateApiInput(match, query, body);
    } catch (error) {
      throw new ApiClientError(
        '请求参数无效。',
        400,
        error instanceof z.ZodError ? error.issues : undefined,
      );
    }
    return requestApi(path, body, match.definition.response, options, {
      binary: match.definition.binary,
      timeoutMs:
        match.operation === 'uploadMediaFile' ? 120000 : match.definition.path.startsWith('analytics') ||
        ['importWxr', 'import'].includes(match.operation)
          ? 140000
          : 30000,
      anonymous: ['login', 'session', 'account-access', 'account-access/complete'].includes(path),
    });
  };
  const client = request as AdminClient;
  client.request = request;
  client.call = async (operation, input) => {
    const definition = adminApi[operation];
    const params = definition.params.parse(input.params ?? {}) as Record<string, string>;
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(input.query ?? {}))
      if (value !== undefined) query.set(key, String(value));
    const path = definition.path.replace(/\{([^}]+)\}/g, (_, key: string) =>
      encodeURIComponent(params[key]),
    );
    return (await request(
      path + (query.size ? '?' + query : ''),
      'body' in input ? input.body : undefined,
    )) as ApiOutput<typeof operation>;
  };
  return client;
}
