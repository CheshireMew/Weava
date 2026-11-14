import { WeavaError, type Entry, type Release } from '@weava/contracts';
import {
  clearCapabilities,
  registerCapabilities,
  validateCapabilities,
} from './extension-capabilities.ts';
import {
  loadExtensions,
  orderExtensions,
  type ExtensionDiagnostic,
  type ExtensionMember,
} from './extension-catalog.ts';
import { migrateExtension } from './extension-migrations.ts';
import {
  extensionMetadata,
  extensionRoute,
  renderExtension,
  validateExtensionRelease,
} from './extension-rendering.ts';
import { ExtensionTasks } from './extension-tasks.ts';
import { extensionUsage } from './extension-usage.ts';
import type { Extension } from './extensions.ts';
import type { Site } from './site.ts';
export { extensionManifestSchema, type ExtensionDiagnostic } from './extension-catalog.ts';

export class ExtensionManager {
  readonly id = 'weava-extensions';
  readonly apiVersion = 1;
  private members: ExtensionMember[] = [];
  private active: Extension[] = [];
  private diagnostics: ExtensionDiagnostic[] = [];
  private tasks = new ExtensionTasks(
    () => !this.changing && !this.paused,
    (id, error) => {
      const row = this.diagnostics.find((item) => item.id === id);
      if (row) row.taskError = error;
    },
  );
  private changing = false;
  private started = new Set<Extension>();
  private stopped = false;
  get isStopped() { return this.stopped; }
  constructor(
    private site: Site,
    _services: Record<string, any>,
    private mode: 'runtime' | 'worker',
    private allowMigrations = false,
    startPaused = false,
  ) {
    this.paused ||= startPaused;
  }
  static async open(
    site: Site,
    services: Record<string, any>,
    mode: 'runtime' | 'worker',
    migrate = false,
    startPaused = false,
  ) {
    const manager = new ExtensionManager(site, services, mode, migrate, startPaused);
    manager.members = await loadExtensions(site, services);
    await manager.activate();
    if (!manager.paused) manager.tasks.resume();
    site.extensionCleanup = () => manager.tasks.dispose();
    return manager;
  }
  get blocks() {
    return this.site.blockRenderers;
  }
  get blockDefinitions() {
    return this.site.extensionBlockDefinitions;
  }
  get themes() {
    return this.active.flatMap((extension) => extension.themes ?? []);
  }
  get migrationFiles() {
    return this.active.flatMap((extension) => extension.migrationFiles ?? []);
  }
  async runJob(name: string, payload: unknown) {
    const [id, job] = name.split(':');
    const extension = this.active.find((item) => item.id === id),
      handler = extension?.jobs?.[job];
    if (!handler) throw new WeavaError('网站任务未注册：' + name, 404);
    return handler(payload);
  }
  get panels() {
    return this.active.flatMap((extension) => extension.panels ?? []);
  }
  async transformHtml(html: string, release: Release, url: URL) {
    for (const extension of this.active) if (extension.transformHtml)
      html = await extension.transformHtml(html, release, url);
    return html;
  }
  status() {
    return structuredClone(this.diagnostics);
  }
  private configured(member: ExtensionMember) {
    return this.site.store.get('extension-config', member.id)?.value.enabled ?? member.enabled;
  }
  private snapshotDiagnostic(
    member: ExtensionMember,
    status: ExtensionDiagnostic['status'],
    error?: string,
  ): ExtensionDiagnostic {
    const ext = member.extension,
      installed = this.site.store.get('extension-installed', member.id)?.value;
    return {
      id: member.id,
      label: ext?.label ?? member.id,
      version: ext?.version ?? '0.0.0',
      enabled: this.configured(member),
      status,
      error: error ?? member.error,
      dependencies: ext?.dependencies ?? [],
      schemaVersion: ext?.schemaVersion ?? 0,
      installedSchema: installed?.schemaVersion ?? 0,
      backup: installed?.backup,
      configRevision: this.site.store.get('extension-config', member.id)?.revision ?? null,
    };
  }
  private async activate() {
    this.stopped = false;
    this.diagnostics = this.members.map((member) =>
      this.snapshotDiagnostic(member, this.configured(member) ? 'blocked' : 'disabled'),
    );
    const ordered = orderExtensions(
      this.members,
      (member) => this.configured(member),
      (member, error) => {
        this.diagnostics[this.members.indexOf(member)] = this.snapshotDiagnostic(
          member,
          member.error ? 'failed' : 'blocked',
          error.message,
        );
      },
    );
    for (const member of ordered) {
      const ext = member.extension!;
      let attemptedBackup: string | undefined;
      try {
        validateCapabilities(this.site, ext, this.active);
        await migrateExtension(this.site, ext, this.allowMigrations, (path) => {
          attemptedBackup = path;
        });
        if (this.mode === 'runtime' && !this.paused) {
          await ext.start?.();
          this.started.add(ext);
        }
        this.active.push(ext);
        registerCapabilities(this.site, ext, this.active);
        this.diagnostics[this.members.indexOf(member)] = this.snapshotDiagnostic(member, 'active');
        if (this.mode === 'runtime') this.tasks.start(ext);
      } catch (error: any) {
        for (const id of Object.keys(ext.fieldWidgets ?? {})) delete this.site.fieldWidgets[id];
        if (this.mode === 'runtime')
          await Promise.resolve()
            .then(() => ext.stop?.())
            .catch(() => {});
        this.diagnostics[this.members.indexOf(member)] = {
          ...this.snapshotDiagnostic(member, 'failed', error.message),
          ...(attemptedBackup ? { backup: attemptedBackup } : {}),
        };
      }
    }
  }
  private paused = process.env.WEAVA_VALIDATION === '1';
  async initialize() {
    if (this.mode === 'runtime')
      for (const ext of this.active)
        if (!this.started.has(ext)) {
          await ext.start?.();
          this.started.add(ext);
        }
  }
  async pause(value: boolean) {
    if (value) {
      this.paused = true;
      this.tasks.pause();
      return;
    }
    await this.initialize();
    this.paused = false;
    this.tasks.resume();
  }
  get pendingTasks() {
    return this.tasks.pending;
  }
  private assertAvailable() {
    if (this.changing) throw new WeavaError('扩展正在切换，请稍后重试。', 503);
  }
  async render(entry: Entry, release: Release) {
    this.assertAvailable();
    return renderExtension(this.active, entry, release);
  }
  async metadata(
    ...args: Parameters<typeof extensionMetadata> extends [unknown, ...infer Rest] ? Rest : never
  ) {
    this.assertAvailable();
    return extensionMetadata(this.active, ...args);
  }
  async validateRelease(release: Release) {
    this.assertAvailable();
    return validateExtensionRelease(this.active, release);
  }
  route(request: Request, release: Release | null) {
    return extensionRoute(this.active, request, release);
  }
  usage(id: string) {
    return extensionUsage(this.site, this.members, (member) => this.configured(member), id);
  }
  async setEnabled(id: string, enabled: boolean, expected: number | null) {
    if (this.mode !== 'runtime') throw new WeavaError('任务程序不更改扩展启停。');
    if (this.changing) throw new WeavaError('扩展正在切换，请稍后再试。', 409);
    const member = this.members.find((member) => member.id === id);
    if (!member) throw new WeavaError('扩展不存在。', 404);
    const row = this.site.store.get('extension-config', id);
    if ((row?.revision ?? null) !== expected)
      throw new WeavaError('扩展设置已变化，请刷新后重试。', 409);
    if (!enabled) {
      const uses = this.usage(id);
      if (uses.length)
        throw new WeavaError('扩展仍被以下内容或依赖使用，请先处理引用。', 409, uses);
    }
    const before = this.configured(member);
    this.changing = true;
    const liveJobs = this.site
      .activeJobs()
      .filter((job) => ['publish', 'import-wxr'].includes(job.operation));
    if (liveJobs.length) {
      this.changing = false;
      throw new WeavaError('内容任务仍在运行，请等待完成后切换扩展。', 409);
    }
    this.site.store.setState('extension-transition', JSON.stringify({ pid: process.pid, id }));
    try {
      const saved = this.site.store.put(
        'extension-config',
        id,
        { enabled },
        expected,
        enabled ? '启用扩展' : '停用扩展',
      );
      try {
        await this.stop();
        await this.activate();
        if (enabled && !this.active.some((ext) => ext.id === id))
          throw new WeavaError(
            this.diagnostics.find((row) => row.id === id)?.error ?? '扩展未能启动。',
          );
      } catch (error) {
        this.site.store.put(
          'extension-config',
          id,
          { enabled: before },
          saved.revision,
          '恢复扩展启停设置',
        );
        await this.stop();
        await this.activate();
        throw error;
      }
      return this.status();
    } finally {
      this.site.store.setState('extension-transition', '');
      this.changing = false;
    }
  }
  async stop() {
    await this.tasks.stop();
    const errors: string[] = [];
    for (const ext of [...this.active].reverse())
      try {
        if (this.mode === 'runtime' && this.started.has(ext)) await ext.stop?.();
      } catch (error: any) {
        errors.push(ext.id + '：' + error.message);
      }
    this.started.clear();
    this.active = [];
    clearCapabilities(this.site);
    this.stopped = true;
    if (errors.length) throw new WeavaError('扩展停止失败：' + errors.join('；'));
  }
}
