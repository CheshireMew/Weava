import { readFileSync, writeFileSync } from 'node:fs';
import { strict as assert } from 'node:assert';
import { Site, verifyBackup, restoreBackup, walk } from '@weava/core';
const root = 'E:/Code/WeavaSites/crypto-blacknico',
  origin = 'http://127.0.0.1:4323',
  token = readFileSync(root + '/cli-token', 'utf8');
const response = await fetch(origin + '/api/admin/v1/backup', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
  body: JSON.stringify({ path: 'D:/Tools/weava/acceptance-backups' }),
});
assert.equal(response.status, 202);
let job = (await response.json()) as any;
while (['queued', 'running'].includes(job.status)) {
  await new Promise((r) => setTimeout(r, 500));
  job = await (
    await fetch(origin + '/api/admin/v1/job/' + job.id, {
      headers: { Authorization: 'Bearer ' + token },
    })
  ).json();
}
assert.equal(job.status, 'complete', JSON.stringify(job));
const manifest = verifyBackup(job.result.path);
const target = 'D:/Tools/weava/restored-crypto-' + Date.now();
await restoreBackup(job.result.path, target, 'D:/Tools/weava/acceptance-backups');
const original = new Site(root),
  restored = new Site(target);
try {
  assert.equal(restored.release()!.id, original.release()!.id);
  assert.equal(restored.entries().length, original.entries().length);
  assert.equal(walk(target + '/media').length, walk(root + '/media').length);
  assert.equal(restored.store.raw.pragma('integrity_check', { simple: true }), 'ok');
  const report = {
    passed: true,
    backup: job.result.path,
    restored: target,
    files: manifest.files.length,
    entries: restored.entries().length,
    releaseId: restored.release()!.id,
    media: walk(target + '/media').length,
  };
  writeFileSync('D:/Tools/cache/weava/acceptance/backup.json', JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
} finally {
  original.close();
  restored.close();
}
