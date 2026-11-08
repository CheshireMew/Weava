import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { descriptor } from './state.ts';

/** Both activation paths verify the same service boundary. Upgrade separately
 * compares the public homepage with its pre-upgrade SEO snapshot. */
export async function checkService(
  root: string,
  options: { homepage?: boolean; agent?: string } = {},
) {
  const origin = 'http://127.0.0.1:' + descriptor(root).port;
  const headers = {
    Authorization: 'Bearer ' + readFileSync(join(root, 'cli-token'), 'utf8'),
    'User-Agent': options.agent ?? 'WeavaCheck',
  };
  const db = new DatabaseSync(join(root, 'weava.sqlite'), { readOnly: true });
  let admin = '/admin';
  try {
    admin = String(
      db.prepare("SELECT value FROM state WHERE key='owner-admin-path'").get()?.value ?? admin,
    );
  } finally {
    db.close();
  }
  for (const path of [
    '/__health',
    '/api/admin/v1/session',
    admin + '/',
    ...(options.homepage ? ['/'] : []),
  ]) {
    const response = await fetch(origin + path, { headers, signal: AbortSignal.timeout(15000) });
    await response.body?.cancel();
    if (!response.ok)
      throw new Error('网站实际启动检查失败：' + path + ' (' + response.status + ')');
  }
  return { http: true };
}
