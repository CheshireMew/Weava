import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, openSync, closeSync, statSync } from 'node:fs';
import { strict as assert } from 'node:assert';
const origin = 'http://127.0.0.1:4323',
  root = 'E:/Code/WeavaSites/crypto-blacknico',
  token = readFileSync(root + '/cli-token', 'utf8'),
  headers = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token };
const before = (await (await fetch(origin + '/__health')).json()) as any;
assert.equal(before.site.replaceAll('\\', '/'), root);
const stamp = statSync('apps/web/dist/server/entry.mjs').mtimeMs;
const start = await fetch(origin + '/api/admin/v1/backup', {
  method: 'POST',
  headers,
  body: JSON.stringify({ path: 'D:/Tools/weava/acceptance-backups', label: '服务重启恢复验证' }),
});
assert.equal(start.status, 202);
let job = (await start.json()) as any;
assert(job.workerPid);
process.kill(before.pid);
const fd = openSync('D:/Tools/cache/weava/acceptance/restarted-server.log', 'a');
const child = spawn(process.execPath, ['apps/web/dist/server/entry.mjs'], {
  cwd: process.cwd(),
  windowsHide: true,
  detached: true,
  stdio: ['ignore', fd, fd],
  env: {
    ...process.env,
    WEAVA_SITE: root,
    WEAVA_FRAMEWORK: process.cwd(),
    PORT: '4323',
    HOST: '127.0.0.1',
  },
});
child.unref();
closeSync(fd);
let ready: any;
for (let i = 0; i < 80; i++) {
  try {
    const r = await fetch(origin + '/__health');
    if (r.ok) {
      ready = await r.json();
      break;
    }
  } catch {}
  await new Promise((r) => setTimeout(r, 200));
}
assert(ready, '服务未恢复');
assert.notEqual(ready.pid, before.pid);
const observed: string[] = [];
for (let i = 0; i < 300; i++) {
  job = await (await fetch(origin + '/api/admin/v1/job/' + job.id, { headers })).json();
  observed.push(job.status);
  if (!['queued', 'running'].includes(job.status)) break;
  await new Promise((r) => setTimeout(r, 300));
}
assert(['complete', 'failed'].includes(job.status), JSON.stringify(job));
const interrupted = { id: job.id, status: job.status, workerPid: job.workerPid };
if (job.status === 'failed') {
  let alive = false;
  try {
    process.kill(job.workerPid, 0);
    alive = true;
  } catch {}
  assert.equal(alive, false);
  const retry = await fetch(origin + '/api/admin/v1/backup', {
    method: 'POST',
    headers,
    body: JSON.stringify({ path: 'D:/Tools/weava/acceptance-backups', label: '中断后重试验证' }),
  });
  assert.equal(retry.status, 202);
  job = await retry.json();
  for (let i = 0; i < 300; i++) {
    if (!['queued', 'running'].includes(job.status)) break;
    await new Promise((r) => setTimeout(r, 300));
    job = await (await fetch(origin + '/api/admin/v1/job/' + job.id, { headers })).json();
  }
  assert.equal(job.status, 'complete', JSON.stringify(job));
}
assert.equal(ready.releaseId, before.releaseId);
assert.equal(stamp, statSync('apps/web/dist/server/entry.mjs').mtimeMs);
const report = {
  passed: true,
  oldPid: before.pid,
  newPid: ready.pid,
  interrupted,
  jobId: job.id,
  observed: [...new Set(observed)],
  backup: job.result.path,
  releasePreserved: true,
  buildUnchanged: true,
};
writeFileSync('D:/Tools/cache/weava/acceptance/restart.json', JSON.stringify(report, null, 2));
console.log(JSON.stringify(report));
