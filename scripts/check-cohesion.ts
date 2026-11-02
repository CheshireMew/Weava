import { strict as assert } from 'node:assert';
import { join } from 'node:path';
import type { Page } from 'playwright';

export async function checkCohesion({
  origin,
  output,
  page,
  api,
}: {
  origin: string;
  output: string;
  page: Page;
  api: (action: string, value?: any) => Promise<any>;
}) {
  async function wait(job: any) {
    const deadline = Date.now() + 60000;
    while (['queued', 'running'].includes(job.status) && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      job = await api('job/' + job.id);
    }
    assert.equal(job.status, 'complete', job.message);
    return job;
  }
  const media = (
    await wait(
      await api('media', {
        name: 'cohesion.txt',
        base64: Buffer.from('cohesion attachment').toString('base64'),
      }),
    )
  ).result;
  const entry = await api('entry', {
    revision: null,
    value: {
      id: 'cohesion-report',
      kind: 'content',
      type: 'post',
      title: 'Cohesion Report',
      path: '/cohesion-report/',
      document: {
        version: 1,
        format: 'markdown',
        source: `[下载附件](${media.value.url}?download=1#part)`,
      },
    },
  });
  const review = await api('publication', { ids: [entry.id] });
  await wait(await api('publish', review.options));
  const refs = await api('media/references?id=' + media.id),
    usage = await api('maintenance');
  assert(refs.working.some((row: any) => row.id === entry.id));
  assert(refs.published.some((row: any) => row.id === entry.id));
  assert(usage.unreferenced.files.length < 50, 'fixture must expose all unused media');
  assert(!usage.unreferenced.files.some((row: any) => row.path === media.value.url));
  const download = await fetch(origin + media.value.url + '?download=1');
  assert.equal(download.status, 200);
  assert.equal(await download.text(), 'cohesion attachment');

  const visitor = 'cohesion-reader-' + crypto.randomUUID(),
    stamp = Date.now();
  const events = Array.from({ length: 52 }, (_, index) => ({
    id: 'cohesion-' + crypto.randomUUID(),
    kind: 'view',
    ts: new Date(stamp - index * 1000).toISOString(),
    path: entry.value.path,
    visitor,
    session: 'cohesion-session',
  }));
  const collected = await fetch(origin + '/api/v1/analytics', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': 'Mozilla/5.0 Windows Chrome/134.0.0.0',
    },
    body: JSON.stringify(events),
  });
  assert.equal(collected.status, 200);
  assert.equal(((await collected.json()) as any).accepted, 52);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(origin + '/admin/');
  await page.locator('.sidebar nav').getByRole('button', { name: '访问统计', exact: true }).click();
  await page.getByRole('heading', { name: '访问统计', exact: true }).waitFor();
  await page.getByRole('button', { name: '查询', exact: true }).waitFor({ state: 'visible' });
  await page.waitForFunction(
    () => !(document.querySelector('button[aria-label="刷新统计"]') as HTMLButtonElement)?.disabled,
  );
  await page.getByLabel('页面路径筛选').fill(entry.value.path);
  await page.getByRole('button', { name: '查询', exact: true }).click();
  await page.waitForFunction(
    () => document.querySelector('.analytics-metrics article strong')?.textContent === '52',
  );
  await page
    .locator('.analytics-card')
    .filter({ has: page.getByRole('heading', { name: '最新访客', exact: true }) })
    .getByRole('button', { name: visitor.slice(0, 8), exact: true })
    .click();
  const dialog = page.getByRole('dialog', { name: '访客访问记录', exact: true });
  await dialog.waitFor();
  await page.waitForFunction(
    () => document.querySelectorAll('.analytics-visitor-dialog tbody tr').length === 50,
  );
  await dialog.getByRole('button', { name: '下一页', exact: true }).click();
  await page.waitForFunction(
    () => document.querySelectorAll('.analytics-visitor-dialog tbody tr').length === 2,
  );
  await dialog.getByRole('button', { name: '上一页', exact: true }).click();
  await page.waitForFunction(
    () => document.querySelectorAll('.analytics-visitor-dialog tbody tr').length === 50,
  );
  await dialog.getByRole('button', { name: '关闭访客记录', exact: true }).click();
  const exportUrl = await page.getByRole('link', { name: 'CSV', exact: true }).getAttribute('href');
  assert(exportUrl);
  const csv = await page.request.get(origin + exportUrl);
  assert.equal(csv.status(), 200);
  assert.match(await csv.text(), /cohesion-report/);
  await page.screenshot({ path: join(output, 'cohesion-analytics-desktop.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
  await page.screenshot({ path: join(output, 'cohesion-analytics-mobile.png'), fullPage: true });
  await page.setViewportSize({ width: 1440, height: 1000 });
  return {
    mediaQuerySuffixConsistent: true,
    publicAnalyticsCollection: true,
    reportPathFilter: true,
    visitorPagination: [50, 2, 50],
    csvExport: true,
    desktopAndMobile: true,
  };
}
