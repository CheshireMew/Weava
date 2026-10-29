import { Site, Analytics, Engagement, atomicJson, now, extension, runSchedulesAsync } from '@weava/core';
import { join, resolve } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
const root = resolve(
  process.env.WEAVA_SITE ??
    resolve(process.env.WEAVA_FRAMEWORK ?? process.cwd(), '../WeavaSites/demo'),
);
const runtimeFile = join(root, 'runtime.json');
if (existsSync(runtimeFile)) {
  const old = JSON.parse(readFileSync(runtimeFile, 'utf8'));
  if (old.status !== 'stopped' && old.pid !== process.pid) {
    let alive = false;
    try {
      process.kill(old.pid, 0);
      alive = true;
    } catch {}
    if (alive) throw new Error('这个站点已经由另一个进程运行。');
  }
}
export const site = new Site(root);
export const analytics = new Analytics(root);
void analytics.geo.update(false).catch(() => {});
const geoWatch = setInterval(() => { void analytics.geo.update(false).catch(() => {}); }, 24 * 60 * 60 * 1000);
geoWatch.unref();
export const engagement = new Engagement(site.store.raw, site.cliToken());
site.recoverJobs();
const jobWatch = setInterval(() => site.recoverJobs(), 5000);
jobWatch.unref();
const state = {
  pid: process.pid,
  status: 'running',
  startedAt: now(),
  port: Number(process.env.PORT ?? 4322),
};
atomicJson(runtimeFile, state);
const stop = () => {
  atomicJson(runtimeFile, { ...state, status: 'stopped' });
};
process.once('exit', stop);
export const siteExtension = extension(site, { analytics });
let stopping = false;
const shutdown = async () => {
  if (stopping) return; stopping = true; clearInterval(jobWatch); clearInterval(geoWatch);
  try { await (await siteExtension).stop(); analytics.close(); site.close(); }
  catch (error) { console.error('Extension shutdown failed:', error); }
  finally { stop(); process.exit(0); }
};
process.once('SIGTERM', shutdown);
process.once('SIGINT', shutdown);
// Wait for extensions to register their renderers before processing overdue plans.
void siteExtension.then((manager) => {
  let running=false;
  const tick = async () => { if(running||stopping)return;running=true;try { await runSchedulesAsync(site,(release)=>manager.validateRelease(release)); } catch (error) { console.error('Scheduled publication failed:', error); }finally{running=false;} };
  tick(); const timer = setInterval(tick, 5000); timer.unref();
});
