import { Site, schedulePublication, runSchedules, schedules } from '@weava/core';
import { entrySchema } from '@weava/contracts';
import { mkdirSync, existsSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { strict as assert } from 'node:assert';

if (process.argv[2] === '--child') {
  const root = process.argv[3], marker = process.argv[4], clock = Number(process.argv[5]);
  const site = new Site(root);
  site.publicationValidators.push(() => {
    writeFileSync(marker, JSON.stringify({ pid: process.pid, phase: 'inside publication transaction' }));
    // Hold a known live process at an exact transactional boundary until its parent stops it.
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 30000);
  });
  try { runSchedules(site, clock); } finally { site.close(); }
} else {
  const output = 'D:/Tools/cache/weava/schedule-interruption-' + Date.now(); mkdirSync(output, { recursive: true });
  const root = join(output, 'site'), marker = join(output, 'transaction.json');
  const site = new Site(root), clock = Date.now();
  site.saveType({ id: 'post', label: '文章', fields: [], pathPrefix: '/posts/', template: 'article' }, null);
  const row = site.saveEntry(entrySchema.parse({ id: 'one', kind: 'content', title: '中断后只发布一次', path: '/one/' }), null);
  const plan = schedulePublication(site, row.id, row.revision, new Date(clock + 1000).toISOString(), clock);
  site.close();
  const worker = spawn(process.execPath, ['--import', 'tsx', resolve(import.meta.filename), '--child', root, marker, String(clock + 2000)], {
    cwd: resolve(import.meta.dirname, '..'), windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let logs = ''; worker.stdout.on('data', (data) => logs += data); worker.stderr.on('data', (data) => logs += data);
  let observed = false;
  try {
    for (let i = 0; i < 100; i++) {
      assert.equal(worker.exitCode, null, logs);
      if (existsSync(marker)) { observed = true; break; }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    assert(observed, 'child did not reach the transaction boundary');
  } finally {
    if (worker.exitCode === null) { const stopped = new Promise<void>((resolve) => worker.once('exit', () => resolve())); worker.kill(); await stopped; }
  }
  const recovered = new Site(root);
  try {
    assert.equal(schedules(recovered)[0].value.status, 'scheduled');
    assert.equal(recovered.release(), null);
    const first = runSchedules(recovered, clock + 5000);
    assert.deepEqual(first.completed, [plan.id]);
    assert.deepEqual(runSchedules(recovered, clock + 6000), { completed: [], failed: [] });
    assert.equal(recovered.releases().length, 1);
    assert.equal(recovered.release()!.entries[0].title, '中断后只发布一次');
    const evidence = { passed: true, output, killedPid: worker.pid, observedInTransaction: observed,
      rollbackAfterExit: true, recoveredPlan: plan.id, publicationsAfterTwoRuns: 1 };
    writeFileSync(join(output, 'results.json'), JSON.stringify(evidence, null, 2)); console.log(JSON.stringify(evidence, null, 2));
  } finally { recovered.close(); }
}
