import type { APIRoute } from 'astro';
import { site, analytics, engagement, siteExtension } from '../../runtime.ts';
import { stageMedia, csv, storageUsage, queryPublished, queryDrafts, contentQuery, exportSite, importSite, schedules, schedulePublication, cancelSchedule, retrySchedule, projectTerms, layouts, saveLayout, queryMedia, saveMediaMetadata, mediaReferences, archiveMedia, entryRevision, entryChanges, mergeEntry, saveMergedEntry, importWordPressWxr, digest } from '@weava/core';
import { WeavaError as DomainError, VERSION as frameworkVersion } from '@weava/contracts';
import { planHistoryArchive, historyArchives, historyArchiveContents, programStatus, SCHEMA_VERSION, preparePublication } from '@weava/core';
import { join } from 'node:path';
import { existsSync, readFileSync, openSync, closeSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
function json(value: any, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers },
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
    const worker = process.env.WEAVA_WORKER ?? join(framework, 'dist', 'worker.mjs');
    const compiledWorker = process.env.WEAVA_SOURCE_WORKER !== '1' &&
      (process.env.WEAVA_WORKER || import.meta.env.MODE !== 'development') && existsSync(worker);
    const args = compiledWorker
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
export const ALL: APIRoute = async (context) => {
  const { request, params, cookies, url } = context;
  try {
    const custom = await (await siteExtension)?.route?.(request, site.visibleRelease());
    if (custom) return custom;
    const route = params.route ?? '';
    const method = request.method;
    if (['v1/engagement', 'v1/like', 'v1/comment', 'v1/comment-captcha'].includes(route)) {
      const write = method === 'POST';
      if ((route === 'v1/engagement' && method !== 'GET') || (route !== 'v1/engagement' && !write))
        return json({ error: '请求方法无效。' }, 405);
      if (write && request.headers.get('Origin') && new URL(request.headers.get('Origin')!).host !== (request.headers.get('host') ?? url.host))
        throw new DomainError('请求来源无效。', 403);
      const data = write ? await request.json() : null;
      const id = String(data?.id ?? url.searchParams.get('id') ?? '');
      const entry = site.visibleRelease()?.entries.find((item) => item.id === id && item.kind === 'content');
      if (!entry) throw new DomainError('文章不存在。', 404);
      let reader = cookies.get('weava-reader')?.value ?? '';
      if (!/^[a-f0-9]{64}$/.test(reader)) {
        reader = randomBytes(32).toString('hex');
        cookies.set('weava-reader', reader, { path: '/', httpOnly: true, sameSite: 'lax', secure: url.protocol === 'https:', maxAge: 31536000 });
      }
      if (route === 'v1/engagement')
        return json(engagement.summary(id, reader, Number(url.searchParams.get('page')) || 1, url.searchParams.get('sort') === 'oldest' ? 'oldest' : 'latest'));
      let network = 'unknown';
      try { network = context.clientAddress; } catch {}
      if (route === 'v1/comment-captcha') return json(await engagement.createCaptcha(reader, network));
      if (route === 'v1/like') {
        if (typeof data.liked !== 'boolean') throw new DomainError('点赞状态无效。');
        return json(engagement.setLike(id, reader, data.liked, network));
      }
      const comment = engagement.postComment(id, reader, network, data);
      return json({ ...engagement.summary(id, reader), comment });
    }
    if (['v1/search', 'v1/content'].includes(route) && method === 'GET') {
      const query = contentQuery(url.searchParams);
      const result = queryPublished(site, query, route === 'v1/search');
      return json(result.items.map(({ document, compatibility, html, source, blocks, ...entry }) => entry), 200,
        { 'X-Total-Count': String(result.total), 'X-Total-Pages': String(result.pages), 'X-Page': String(result.page), 'X-Page-Size': String(result.pageSize) });
    }
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
              .visibleRelease()
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
    if (action === 'import/revisions' && method === 'GET') return json(Object.fromEntries(['entry', 'type', 'term', 'layout', 'settings', 'redirect'].flatMap((scope) => site.store.list(scope).map((row) => [scope + ':' + row.id, row.revision]))));
    if (action === 'import/wxr' && method === 'POST') {
      if (typeof data.xml !== 'string') throw new DomainError('请选择 WXR XML 文件。');
      const options = { ...data.options, mediaDirectory: undefined };
      const preview = await importWordPressWxr(site, data.xml, { ...options, dryRun: true });
      if (options.dryRun) return json(preview);
      const sourcePath = join(site.root, 'imports', 'wxr-' + digest(data.xml) + '.xml');
      if (!existsSync(sourcePath)) writeFileSync(sourcePath, data.xml);
      return json(await execute('import-wxr', { sourcePath, options }, request.headers.get('Idempotency-Key') ?? undefined), 202);
    }
    if (action === 'state')
      return json({
        settings: site.settings(),
        types: site.store.list('type'),
        terms: site.terms(),
        layouts: layouts(site),
        schedules: schedules(site),
        entries: url.searchParams.get('summary') === '1' ? [] : site.entries(),
        entryCount: site.store.raw.prepare("SELECT COUNT(*) n FROM records WHERE scope='entry'").get(),
        media: site.store.list('media'),
        jobs: site.jobs(),
        releases: site.releases(),
        themes: [{ id: 'weava', label: 'Weava' }, { id: 'newsletter', label: 'Newsletter' }, ...((await siteExtension)?.themes ?? [])],
        extensionPanels: (await siteExtension)?.panels ?? [],
        extensionBlocks: Object.keys((await siteExtension)?.blocks ?? {}),
        extensionBlockDefinitions: Object.fromEntries(Object.entries((await siteExtension).blockDefinitions).map(([key, value]) => [key, { label: value.label, fields: value.fields }])),
        extensions: (await siteExtension).status(),
        program: {...programStatus(site.root),databaseSchema:SCHEMA_VERSION},
      });
    if (action === 'entries') return json(site.entries());
    if (action === 'extensions' && method === 'GET') return json((await siteExtension).status());
    if (action === 'extensions/usage' && method === 'GET') return json((await siteExtension).usage(url.searchParams.get('id') ?? ''));
    if (action === 'extensions/toggle' && method === 'POST') {
      if (typeof data.enabled !== 'boolean') throw new DomainError('扩展启停状态无效。');
      return json(await (await siteExtension).setEnabled(data.id, data.enabled, data.revision ?? null));
    }
    if (action === 'entries/query' && method === 'GET') return json(queryDrafts(site, { ...contentQuery(url.searchParams),
      status: url.searchParams.get('status') ?? undefined, visibility: url.searchParams.get('visibility') ?? undefined }));
    if (action === 'publication' && method === 'POST'){const review=site.previewPublication(data??{});await (await siteExtension).validateRelease(preparePublication(site,review.options).release);return json(review);}
    if (action === 'schedules' && method === 'GET') return json(schedules(site));
    if (action === 'schedule' && method === 'POST') return json(schedulePublication(site, data.id, data.revision, data.dueAt));
    if (action === 'schedule/cancel' && method === 'POST') return json(cancelSchedule(site, data.id, data.revision));
    if (action === 'schedule/retry' && method === 'POST') return json(retrySchedule(site, data.id, data.revision));
    if (action === 'comments' && method === 'GET') {
      const result = engagement.comments(url.searchParams.get('status') ?? 'all', Number(url.searchParams.get('page')) || 1);
      return json({ ...result, items: result.items.map((comment) => {
        const entry = site.store.get('entry', comment.entryId)?.value;
        return { ...comment, title: entry?.title ?? comment.entryId, path: entry?.path ?? '' };
      }) });
    }
    if (action === 'comment' && method === 'POST') return json(engagement.moderate(data.id, data.status));
    if (action === 'maintenance') return json(storageUsage(site));
    if (action === 'maintenance/preview' && method === 'POST') {
      const plan = planHistoryArchive(site,data);
      return json({options:plan.options,releases:plan.releaseIds.length,revisions:plan.revisions.length,protectedReleases:plan.protectedReleases,protectedRevisions:plan.protectedRevisions,review:plan.review});
    }
    if (action === 'maintenance/archive' && method === 'POST') return json(await execute('archive-history',data),202);
    if (action === 'maintenance/restore' && method === 'POST') return json(await execute('restore-history',data),202);
    if (action === 'maintenance/archives' && method === 'GET') return json(historyArchives(site).map(({privateMedia,...row})=>row));
    if (action === 'maintenance/archive' && method === 'GET') return json(historyArchiveContents(site,url.searchParams.get('id') ?? ''));
    if (action === 'entry' && method === 'POST')
      return json(site.saveEntry(data.value, data.revision ?? null));
    if (action.startsWith('entry/') && method === 'GET') {
      const row = site.store.get('entry', decodeURIComponent(action.slice(6)));
      if (!row) throw new DomainError('内容不存在。', 404);
      return json({ ...row, value: projectTerms(row.value, site.terms().map((row) => row.value)) });
    }
    if (action === 'settings' && method === 'GET') return json(site.settings());
    if (action === 'settings' && isWrite) return json(site.saveSettings(data.value, data.revision));
    if (action === 'types' && method === 'GET') return json(site.store.list('type'));
    if (action === 'terms' && method === 'GET') return json(site.terms());
    if (action === 'terms' && method === 'POST') return json(site.saveTerm(data.value, data.revision ?? null));
    if (action === 'layouts' && method === 'GET') return json(layouts(site));
    if (action === 'layouts' && method === 'POST') return json(saveLayout(site, data.value, data.revision ?? null));
    if (action === 'types' && isWrite)
      return json(site.saveType(data.value, data.revision ?? null));
    if (action === 'history') return json(site.history(url.searchParams.get('id') ?? ''));
    if (action === 'revision' && method === 'GET') return json(entryRevision(site, url.searchParams.get('id') ?? '', Number(url.searchParams.get('version'))));
    if (action === 'revision/compare' && method === 'GET') {
      const id = url.searchParams.get('id') ?? '';
      const before = entryRevision(site, id, Number(url.searchParams.get('from'))), after = entryRevision(site, id, Number(url.searchParams.get('to')));
      return json({ before, after, changes: entryChanges(before.value, after.value) });
    }
    if (action === 'entry/merge' && method === 'POST') return json(mergeEntry(site, data.id, data.baseRevision, data.value, data.choices));
    if (action === 'entry/merge/save' && method === 'POST') return json(saveMergedEntry(site, data));
    if (action === 'restore') return json(site.restore(data.id, data.version, data.revision));
    if (action === 'withdraw') return json(site.withdraw(data.id, data.revision, !!data.archive));
    if (action === 'media' && method === 'GET') return json(site.store.list('media'));
    if (action === 'media/query' && method === 'GET') return json(queryMedia(site, url.searchParams));
    if (action === 'media/info' && method === 'POST') return json(saveMediaMetadata(site, data.id, data.value, data.revision));
    if (action === 'media/references' && method === 'GET') return json(mediaReferences(site, url.searchParams.get('id') ?? ''));
    if (action === 'media/archive' && method === 'POST') return json(archiveMedia(site, data.items, !!data.archived));
    if (action === 'media/crop' && method === 'POST') return json(await execute('media-edit', data, request.headers.get('Idempotency-Key') ?? undefined), 202);
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
    if (action === 'export') return json(exportSite(site));
    if (action === 'import' && method === 'POST') return json(importSite(site, data.value, data.options));
    return json({ error: '接口不存在。' }, 404);
  } catch (error: any) {
    const status = error instanceof DomainError ? error.status : 400;
    return json({ error: error.message ?? '操作失败。', details: error.details }, status);
  }
};
