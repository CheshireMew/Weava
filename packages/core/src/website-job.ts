import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import { BusinessStore, websiteContext, withWebsite } from './site-sdk.ts';
import { migrateWebsite } from './site-migrations.ts';
import { readJobLog } from './job-logs.ts';
import type { JobContext } from './job-context.ts';
export async function executeWebsiteJob({ site, job, content }: JobContext) {
  const { manager } = await content(),
    selection = JSON.parse(readFileSync(join(site.root, 'program.json'), 'utf8'));
  await migrateWebsite(site.root, selection.siteBuildId, 'open');
  const business = new BusinessStore(site.root);
  try {
    const context = websiteContext(
      site,
      business,
      {
        enqueue: (operation, payload, key) => {
          const created = site.createJob(operation, payload, key);
          return site.updateJob(created.id, { managed: true });
        },
        get: site.job.bind(site),
        log: (id, offset) => readJobLog(join(site.root, 'logs', id + '.log'), offset),
      },
      new Request(new URL('/__task/' + job.id, site.settings().value.domain)),
    );
    return await withWebsite(context, () => manager.runJob(job.operation.slice(8), job.payload));
  } finally {
    business.close();
  }
}
