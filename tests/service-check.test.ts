import { it, expect, vi } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { checkService } from '../packages/manager/src/service-check.ts';
it('checks the configured admin route with the caller token and includes the homepage only when requested', async () => {
  const root = join(
    process.env.WEAVA_TEST_OUTPUT ?? 'D:/Tools/cache/weava/tests',
    'service-check-' + randomUUID(),
  );
  mkdirSync(root, { recursive: true });
  writeFileSync(join(root, 'site.json'), JSON.stringify({ version: 2, id:'service-check',features:[],port: 4323 }));
  writeFileSync(join(root, 'cli-token'), 'test-token');
  const db = new DatabaseSync(join(root, 'weava.sqlite'));
  db.exec(
    "CREATE TABLE state(key TEXT PRIMARY KEY,value TEXT);INSERT INTO state VALUES('owner-admin-path','/owner');",
  );
  db.close();
  const requests: { path: string; headers: Headers }[] = [];
  const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    requests.push({ path: new URL(String(input)).pathname, headers: new Headers(init?.headers) });
    return new Response('ok');
  });
  vi.stubGlobal('fetch', fetch);
  try {
    await checkService(root, { agent: 'WeavaUpgradeCheck' });
    expect(requests.map((row) => row.path)).toEqual([
      '/__health',
      '/api/admin/v1/session',
      '/owner/',
    ]);
    expect(
      requests.every(
        (row) =>
          row.headers.get('authorization') === 'Bearer test-token' &&
          row.headers.get('user-agent') === 'WeavaUpgradeCheck',
      ),
    ).toBe(true);
    requests.length = 0;
    await checkService(root, { homepage: true });
    expect(requests.map((row) => row.path)).toEqual([
      '/__health',
      '/api/admin/v1/session',
      '/owner/',
      '/',
    ]);
    fetch.mockImplementationOnce(async () => new Response('failed', { status: 503 }));
    await expect(checkService(root)).rejects.toThrow('/__health (503)');
  } finally {
    vi.unstubAllGlobals();
  }
});
