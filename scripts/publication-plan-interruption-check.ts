import { Site, savePublicationPlan, runPublicationPlans } from '@weava/core';
import { entrySchema } from '@weava/contracts';
import { mkdirSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { strict as assert } from 'node:assert';

if (process.argv[2] === '--child') {
  const site = new Site(process.argv[3]);
  const setState = site.store.setState.bind(site.store);
  site.store.setState = (key, value) => {
    setState(key, value);
    if (key === 'release') { assert(site.store.raw.inTransaction); writeFileSync(process.argv[4], JSON.stringify({ pid: process.pid, inTransaction: site.store.raw.inTransaction, phase: 'release written; plan not yet complete' })); Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 30000); }
  };
  try { await runPublicationPlans(site, async () => {}, Number(process.argv[5])); } finally { site.close(); }
} else {
  const output = 'D:/Tools/cache/weava/plan-interruption-' + Date.now(); mkdirSync(output, { recursive: true });
  const root = join(output, 'site'), marker = join(output, 'transaction.json'), clock = Date.now(), site = new Site(root);
  const old = site.saveEntry(entrySchema.parse({ id: 'old', kind: 'page', title: '旧公开页', path: '/old/' }), null); site.publish({ ids: [old.id] }); const releaseId = site.release()!.id;
  const next = site.saveEntry(entrySchema.parse({ id: 'next', kind: 'page', title: '固定版本', path: '/next/' }), null);
  const plan = savePublicationPlan(site, { id: 'batch', name: '可恢复批次', dueAt: new Date(clock + 1000).toISOString(), actions: [{ id: old.id, revision: old.revision, action: 'withdraw' }, { id: next.id, revision: next.revision, action: 'publish' }] }, null, clock); site.close();
  const child = spawn(process.execPath, ['--import', 'tsx', resolve(import.meta.filename), '--child', root, marker, String(clock + 2000)], { cwd: resolve(import.meta.dirname, '..'), windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let logs = '', observed = false; child.stdout.on('data', (data) => logs += data); child.stderr.on('data', (data) => logs += data);
  try { for (let i = 0; i < 100; i++) { assert.equal(child.exitCode, null, logs); if (existsSync(marker)) { observed = true; break; } await new Promise((resolve) => setTimeout(resolve, 100)); } assert(observed, 'did not enter publication transaction'); assert.equal(JSON.parse(readFileSync(marker, 'utf8')).inTransaction, true); }
  finally { if (child.exitCode === null) { const stopped = new Promise<void>((resolve) => child.once('exit', () => resolve())); child.kill(); await stopped; } }
  const recovered = new Site(root);
  try {
    assert.equal(recovered.release()!.id, releaseId); assert.equal(recovered.store.get('publication-plan', plan.id)!.value.status, 'scheduled');
    assert.deepEqual((await runPublicationPlans(recovered, async () => {}, clock + 5000)).completed, [plan.id]); assert.deepEqual(await runPublicationPlans(recovered, async () => {}, clock + 6000), { completed: [], failed: [] });
    assert.deepEqual(recovered.release()!.entries.map((entry) => entry.id), [next.id]); assert.equal(recovered.releases().length, 2);
    const result = { passed: true, output, observedInTransaction: observed, oldReleasePreservedOnExit: true, combinedActionsCommittedAfterRecovery: true, planCompletedOnce: true }; writeFileSync(join(output, 'results.json'), JSON.stringify(result, null, 2)); console.log(JSON.stringify(result));
  } finally { recovered.close(); }
}
