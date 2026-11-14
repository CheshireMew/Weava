import { statSync } from 'node:fs';
import { join } from 'node:path';
import { WeavaError } from '@weava/contracts';
import { walk } from '../../runtime-common/src/files.ts';
import { digest } from '../../runtime-common/src/identity.ts';
import type { Site } from './site.ts';
import type { Analytics } from './analytics.ts';
import type { ExtensionManager } from './extension-manager.ts';
import { siteFeatures } from './site-features.ts';
import { executeManagedJob } from './managed-jobs.ts';

/** Owns process-local resources. Both worker entry points use the same initialization and teardown. */
export class TaskRuntime {
  private site?: Site;
  private analytics?: Analytics;
  private manager?: ExtensionManager;
  private extensionKey = '';
  private sourceImports?: typeof import('./import-sources.ts');
  constructor(private root: string) {}
  database = async () => (this.site ??= new (await import('./site.ts')).Site(this.root));
  stats = async () =>
    (this.analytics ??= new (await import('./analytics.ts')).Analytics(this.root));
  imports = async () => (this.sourceImports ??= await import('./import-sources.ts'));
  private async contentKey() {
    const site = await this.database(),
      statePath = join(this.root, 'extensions', 'state').replaceAll('\\', '/') + '/';
    return digest([
      site.configuration.extensionRuntimeRevisions(),
      walk(join(this.root, 'extensions'))
        .filter((file) => !file.replaceAll('\\', '/').startsWith(statePath))
        .map((file) => {
          const info = statSync(file);
          return [file, info.size, info.mtimeMs];
        }),
    ]);
  }
  content = async () => {
    const site = await this.database();
    if (!this.manager) {
      this.extensionKey = await this.contentKey();
      const analytics = siteFeatures(this.root).includes('analytics')
        ? await this.stats()
        : undefined;
      this.manager = await (
        await import('./extensions.ts')
      ).extension(site, analytics ? { analytics } : {}, { mode: 'worker' });
    }
    const failed = this.manager.status().filter((row) => row.enabled && row.status !== 'active');
    if (failed.length)
      throw new WeavaError(
        '扩展无法载入：' + failed.map((row) => row.id + '：' + row.error).join('；'),
      );
    return { site, manager: this.manager };
  };
  async changed() {
    return !!this.manager && (await this.contentKey()) !== this.extensionKey;
  }
  async executeJob(id: string) {
    const site = await this.database();
    return executeManagedJob(site, site.job(id), this.content, {
      stats: this.stats,
      imports: this.imports,
    });
  }
  async close() {
    this.sourceImports?.closePreparedImports();
    try {
      await this.manager?.stop();
    } finally {
      this.analytics?.close();
      this.site?.close();
    }
  }
}
