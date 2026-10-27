import { readFileSync, writeFileSync, mkdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { strict as assert } from 'node:assert';
import { entrySchema } from '@weava/contracts';
const root = 'E:/Code/WeavaSites/demo',
  token = readFileSync(join(root, 'cli-token'), 'utf8');
const headers = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token };
async function request(path: string, body?: any, key?: string) {
  const r = await fetch('http://127.0.0.1:4322/api/admin/v1/' + path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { ...headers, ...(key ? { 'Idempotency-Key': key } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: r.status, value: (await r.json()) as any };
}
async function task(action: string, body: any) {
  let { value } = await request(action, body);
  while (['queued', 'running'].includes(value.status)) {
    await new Promise((r) => setTimeout(r, 150));
    value = (await request('job/' + value.id)).value;
  }
  assert.equal(value.status, 'complete', JSON.stringify(value));
  return value;
}
const before = (await (await fetch('http://127.0.0.1:4322/__health')).json()) as any;
const buildStamp = statSync('apps/web/dist/server/entry.mjs').mtimeMs;
const checks: string[] = [];
const id = 'api-check-' + Date.now(),
  value = entrySchema.parse({
    id,
    kind: 'content',
    type: 'post',
    title: '接口验收',
    path: '/blog/' + id + '/',
    document: { version: 1, format: 'markdown', source: '## 接口验收\n\n中文内容与发布。' },
  });
const created = (await request('entry', { value, revision: null })).value;
assert.equal(
  (
    await request('entry', {
      value: { ...created.value, title: '过期写入' },
      revision: created.revision - 1,
    })
  ).status,
  409,
);
checks.push('revision-conflict');
const key = id + '-publish',
  job = (await request('publish', { ids: [id] }, key)).value;
assert.equal((await request('publish', { ids: [id] }, key)).value.id, job.id);
let current = job;
while (['queued', 'running'].includes(current.status)) {
  await new Promise((r) => setTimeout(r, 200));
  current = (await request('job/' + job.id)).value;
}
assert.equal(current.status, 'complete', JSON.stringify(current));
checks.push('idempotent-publication');
assert((await (await fetch('http://127.0.0.1:4322' + value.path)).text()).includes('接口验收'));
checks.push('runtime-new-route');
const settings = (await request('settings')).value;
const color = '#284f72';
await request('settings', {
  value: { ...settings.value, themeConfig: { ...settings.value.themeConfig, accent: color } },
  revision: settings.revision,
});
assert(!(await (await fetch('http://127.0.0.1:4322/')).text()).includes('--accent:' + color));
await task('publish', {});
assert((await (await fetch('http://127.0.0.1:4322/')).text()).includes('--accent:' + color));
checks.push('draft-settings-and-publish');
const latest = (await request('settings')).value;
await request('settings', { value: settings.value, revision: latest.revision });
await task('publish', {});
const backup = await task('backup', { path: 'D:/Tools/weava/acceptance-backups' });
await task('verify', { path: backup.result.path });
checks.push('real-worker-backup-and-verify');
await request('withdraw', { id, revision: created.revision, archive: true });
assert.equal((await fetch('http://127.0.0.1:4322' + value.path)).status, 404);
checks.push('withdraw-updates-routing');
const after = (await (await fetch('http://127.0.0.1:4322/__health')).json()) as any;
assert.equal(before.pid, after.pid);
assert.equal(buildStamp, statSync('apps/web/dist/server/entry.mjs').mtimeMs);
checks.push('no-process-restart-or-program-rebuild');
const report = { passed: true, checks, backup: backup.result.path, pid: before.pid };
mkdirSync('D:/Tools/cache/weava/acceptance', { recursive: true });
writeFileSync('D:/Tools/cache/weava/acceptance/api.json', JSON.stringify(report, null, 2));
console.log(JSON.stringify(report));
