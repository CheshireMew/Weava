import type { ApiServices, AdminContext } from './types.ts';
import { adminApi, type ApiOperation } from '@weava/contracts/api';

export function json(value: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      ...headers,
    },
  });
}
// Handlers return domain data. Status and wire encoding belong to the operation contract.
export function authorized(
  { site }: Pick<ApiServices, 'site'>,
  { request, cookies }: AdminContext,
) {
  return (
    site.authenticate(cookies.get('weava-session')?.value ?? '') ||
    request.headers.get('Authorization') === 'Bearer ' + site.cliToken()
  );
}

export async function validateExtensionResponse(response: Response, operation?: ApiOperation) {
  if (!operation || !response.ok) return response;
  try {
    const value = response.headers.get('Content-Type')?.includes('application/json')
      ? await response.clone().json()
      : await response.clone().text();
    const checked = adminApi[operation].response.safeParse(value);
    if (!checked.success)
      return json({ error: '网站返回数据与接口定义不一致。', details: checked.error.issues }, 500);
    return response;
  } catch {
    return json({ error: '接口响应无法校验。' }, 500);
  }
}
