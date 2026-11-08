import { ApiClientError } from './api-error.ts';
import { apiErrorSchema } from './session-api.ts';

export interface ApiTransportOptions {
  baseUrl?: string;
  fetch?: typeof fetch;
  headers?: HeadersInit | (() => HeadersInit);
  timeoutMs?: number;
  onUnauthorized?: (path: string) => void;
}
interface ResponseContract<T> {
  safeParse(
    value: unknown,
  ): { success: true; data: T } | { success: false; error: { issues: unknown } };
}
/** This module intentionally has no dependency on the full admin API catalog. */
export async function requestApi<T>(
  path: string,
  body: unknown,
  responseContract: ResponseContract<T>,
  options: ApiTransportOptions = {},
  request: { binary?: boolean; timeoutMs?: number; anonymous?: boolean } = {},
): Promise<T> {
  const headers = new Headers(
    typeof options.headers === 'function' ? options.headers() : options.headers,
  );
  headers.set('Content-Type', request.binary ? 'application/octet-stream' : 'application/json');
  let response: Response;
  try {
    response = await (options.fetch ?? globalThis.fetch)(
      (options.baseUrl ?? '/api/admin/v1/').replace(/\/?$/, '/') + path,
      {
        method: body === undefined ? 'GET' : 'POST',
        headers,
        body:
          body === undefined
            ? undefined
            : request.binary
              ? (body as BodyInit)
              : JSON.stringify(body),
        signal: AbortSignal.timeout(options.timeoutMs ?? request.timeoutMs ?? 30000),
      },
    );
  } catch (error) {
    throw new ApiClientError(
      error instanceof Error && error.name === 'TimeoutError'
        ? '网站响应超时，请稍后重试。'
        : '无法连接网站，请检查服务和网络后重试。',
      0,
    );
  }
  let value: unknown;
  try {
    value = response.headers.get('content-type')?.includes('application/json')
      ? await response.json()
      : await response.text();
  } catch {
    throw new ApiClientError('网站没有返回有效结果，请稍后重试。', response.status);
  }
  if (!response.ok) {
    if (response.status === 401 && !request.anonymous) options.onUnauthorized?.(path);
    const parsed = apiErrorSchema.safeParse(value),
      retry = Number(response.headers.get('retry-after'));
    throw new ApiClientError(
      parsed.success ? parsed.data.error : '操作没有完成，请重试。',
      response.status,
      parsed.success ? parsed.data.details : undefined,
      Number.isFinite(retry) && retry > 0 ? retry : undefined,
    );
  }
  const parsed = responseContract.safeParse(value);
  if (!parsed.success)
    throw new ApiClientError('网站返回的数据与接口定义不一致。', 502, parsed.error.issues);
  return parsed.data;
}
