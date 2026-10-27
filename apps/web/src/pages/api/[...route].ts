import type { APIRoute } from 'astro';
import { site, analytics, siteExtension } from '../../runtime.ts';
import { stageMedia, csv, storageUsage } from '@weava/core';
import { WeavaError as DomainError, VERSION as frameworkVersion } from '@weava/contracts';
import { join } from 'node:path';
import { existsSync, readFileSync, openSync, closeSync } from 'node:fs';
import { spawn } from 'node:child_process';
function json(value: any, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}
function authorized(request: Request, cookies: any) {
  const token = cookies.get('weava-session')?.value ?? '';
  return (
    site.authenticate(token) || request.headers.get('Authorization') === 'Bearer ' + site.cliToken()
  );
}
async function execute(operation: string, payload: any, key?: string) {
  const job = site.createJob(operation, payload, key);
  if (job.status !== 'queued') return job;
  const claimed = {
    ...job,
    status: 'running',
    message: '正在启动任务',
    updatedAt: new Date().toISOString(),
  };
  const ownsTask = site.store.raw
    .prepare('UPDATE jobs SET status=?,data=? WHERE id=? AND status=?')
    .run('running', JSON.stringify(claimed), job.id, 'queued').changes;
  if (!ownsTask) return site.job(job.id);
  const log = join(site.root, 'logs', job.id + '.log');
  // Worker tasks use their own DB connection. Publication remains a single transaction.
  const framework = process.env.WEAVA_FRAMEWORK ?? process.cwd();
  const worker = join(framework, 'dist', 'worker.mjs');
  const args = existsSync(worker)
    ? [worker, site.root, job.id]
    : [
        '--import',
        'tsx',
        join(framework, 'packages', 'core', 'src', 'worker.ts'),
        site.root,
        job.id,
      ];
  const descriptor = openSync(log, 'a');
  let child;
  try {
    child = spawn(process.execPath, args, {
      cwd: framework,
      windowsHide: true,
      stdio: ['ignore', descriptor, descriptor],
      env: { ...process.env, WEAVA_SITE: site.root },
    });
  } finally {
    closeSync(descriptor);
  }
  if (child.pid) site.updateJob(job.id, { workerPid: child.pid });
  child.on('error', (err) => site.updateJob(job.id, { status: 'failed', message: err.message }));
  child.on('exit', (code) => {
    const current = site.job(job.id);
    if (['queued', 'running'].includes(current.status))
      site.updateJob(job.id, { status: 'failed', message: '任务进程意外退出：' + code });
  });
  return site.job(job.id);
}
export const ALL: APIRoute = async ({ request, params, cookies, url }) => {
  try {
    const custom = await (await siteExtension)?.route?.(request, site.release());
    if (custom) return custom;
    const route = params.route ?? '';
    const method = request.method;
    if (route === 'v1/search' && method === 'GET')
      return json(site.search(url.searchParams.get('q') ?? ''));
    if (route === 'v1/content' && method === 'GET')
      return json(
        site
          .release()
          ?.entries.filter((e) => e.kind === 'content')
          .map(({ document, compatibility, html, ...e }) => e) ?? [],
      );
    if (route === 'v1/analytics' && method === 'POST') {
      if (
        request.headers.get('Origin') &&
        new URL(request.headers.get('Origin')!).host !== (request.headers.get('host') ?? url.host)
      )
        throw new DomainError('请求来源无效。', 403);
      return json(
        analytics.collect(
          await request.json(),
          request.headers.get('user-agent') ?? '',
          new Set(
            site
              .release()
              ?.entries.filter((e) => e.kind === 'content')
              .map((e) => e.path) ?? [],
          ),
        ),
      );
    }
    if (!route.startsWith('admin/v1/')) return json({ error: '接口不存在。' }, 404);
    const action = route.slice(9);
    const isWrite = !['GET', 'HEAD'].includes(method);
    if (
      isWrite &&
      request.headers.get('Origin') &&
      new URL(request.headers.get('Origin')!).host !== (request.headers.get('host') ?? url.host)
    )
      throw new DomainError('请求来源无效。', 403);
    if (action === 'session' && method === 'GET')
      return json({
        authenticated: authorized(request, cookies),
        initialized: site.ownerExists(),
        version: frameworkVersion,
      });
    if (action === 'login' && method === 'POST') {
      const data = await request.json();
      const token = site.login(String(data.password ?? ''));
      cookies.set('weava-session', token, {
        path: '/',
        httpOnly: true,
        sameSite: 'strict',
        secure: url.protocol === 'https:',
        maxAge: 604800,
      });
      return json({ authenticated: true });
    }
    if (!authorized(request, cookies)) throw new DomainError('请先登录。', 401);
    if (action === 'logout') {
      site.logout(cookies.get('weava-session')?.value ?? '');
      cookies.set('weava-session', '', { path: '/', maxAge: 0 });
      return json({ ok: true });
    }
    const data = isWrite ? await request.json() : null;
    if (action === 'state')
      return json({
        settings: site.settings(),
        types: site.store.list('type'),
        entries: site.entries(),
        media: site.store.list('media'),
        jobs: site.jobs(),
        releases: site.releases(),
        themes: [{ id: 'weava', label: 'Weava' }, ...((await siteExtension)?.themes ?? [])],
        extensionPanels: (await siteExtension)?.panels ?? [],
        extensionBlocks: Object.keys((await siteExtension)?.blocks ?? {}),
      });
    if (action === 'entries') return json(site.entries());
    if (action === 'maintenance') return json(storageUsage(site));
    if (action === 'entry' && method === 'POST')
      return json(site.saveEntry(data.value, data.revision ?? null));
    if (action.startsWith('entry/') && method === 'GET') {
      const row = site.store.get('entry', decodeURIComponent(action.slice(6)));
      if (!row) throw new DomainError('内容不存在。', 404);
      return json(row);
    }
    if (action === 'settings' && method === 'GET') return json(site.settings());
    if (action === 'settings' && isWrite) return json(site.saveSettings(data.value, data.revision));
    if (action === 'types' && method === 'GET') return json(site.store.list('type'));
    if (action === 'types' && isWrite)
      return json(site.saveType(data.value, data.revision ?? null));
    if (action === 'history') return json(site.history(url.searchParams.get('id') ?? ''));
    if (action === 'restore') return json(site.restore(data.id, data.version, data.revision));
    if (action === 'withdraw') return json(site.withdraw(data.id, data.revision, !!data.archive));
    if (action === 'media' && method === 'GET') return json(site.store.list('media'));
    if (action === 'media' && isWrite)
      return json(
        await execute(
          'media',
          stageMedia(site, Buffer.from(data.base64, 'base64'), String(data.name ?? '')),
          request.headers.get('Idempotency-Key') ?? undefined,
        ),
        202,
      );
    if (action === 'publish' || action === 'backup' || action === 'verify')
      return json(
        await execute(action, data ?? {}, request.headers.get('Idempotency-Key') ?? undefined),
        202,
      );
    if (action === 'rollback') return json(site.rollback(data.id));
    if (action === 'jobs') return json(site.jobs());
    if (action.startsWith('job/')) return json(site.job(action.slice(4)));
    if (action === 'logs') {
      const id = url.searchParams.get('id') ?? '';
      site.job(id);
      const file = join(site.root, 'logs', id + '.log');
      const text = existsSync(file) ? readFileSync(file, 'utf8') : '';
      const start = Math.max(0, Number(url.searchParams.get('offset')) || 0),
        end = Math.min(text.length, start + 20000);
      return json({
        text: text.slice(start, end),
        start,
        end,
        total: text.length,
        truncated: end < text.length,
      });
    }
    if (action === 'analytics')
      return json(analytics.report(url.searchParams, site.settings().value.timezone));
    if (action === 'analytics/export') {
      const report = analytics.report(url.searchParams, site.settings().value.timezone);
      const group = url.searchParams.get('group') ?? 'pages';
      return new Response(csv((report as any)[group] ?? report.pages), {
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': 'attachment; filename="weava-analytics.csv"',
        },
      });
    }
    if (action === 'export')
      return json({
        version: 1,
        settings: site.settings().value,
        types: site.store.list('type').map((r) => r.value),
        entries: site.store.list('entry').map((r) => r.value),
      });
    return json({ error: '接口不存在。' }, 404);
  } catch (error: any) {
    const status = error instanceof DomainError ? error.status : 400;
    return json({ error: error.message ?? '操作失败。', details: error.details }, status);
  }
};
