import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { existsSync, readFileSync, mkdirSync } from 'node:fs';
import { z } from 'zod';
import { blockTypes, typeSchema, WeavaError, VERSION, validateBlockProps, type Block, type Entry, type Release } from '@weava/contracts';
import type { Extension } from './extensions.ts';
import type { Site } from './site.ts';
import { renderDocument } from './documents.ts';
import { renderBlocks } from './render.ts';
import { inside, uuid } from './storage.ts';
import { visitBlocks } from './layouts.ts';

const identifier = z.string().regex(/^[a-z][a-z0-9-]*$/);
export const extensionManifestSchema = z.object({ version: z.literal(1), extensions: z.array(z.object({ id: identifier, file: z.string().endsWith('.mjs'), enabled: z.boolean().default(true) })) });
const versionSchema = z.string().regex(/^\d+\.\d+\.\d+$/);
const compareVersion = (a: string, b: string) => { const x = a.split('.').map(Number), y = b.split('.').map(Number); return x[0] - y[0] || x[1] - y[1] || x[2] - y[2]; };
interface Member { id: string; file: string; enabled: boolean; extension?: Extension; error?: string }
export interface ExtensionDiagnostic { id: string; label: string; version: string; enabled: boolean; status: 'active' | 'disabled' | 'failed' | 'blocked'; error?: string; dependencies: { id: string; minVersion?: string }[]; schemaVersion: number; installedSchema: number; configRevision: number | null; backup?: string; taskError?: string }
export class ExtensionManager {
  readonly id = 'weava-extensions'; readonly apiVersion = 1;
  private members: Member[] = []; private active: Extension[] = [];
  private timers = new Map<string, ReturnType<typeof setInterval>[]>();
  private tasks = new Set<Promise<any>>(); private diagnostics: ExtensionDiagnostic[] = [];
  private changing = false; private disposed = false;
  constructor(private site: Site, private services: Record<string, any>, private mode: 'runtime' | 'worker') {}
  static async open(site: Site, services: Record<string, any>, mode: 'runtime' | 'worker') {
    const manager = new ExtensionManager(site, services, mode);
    await manager.load(); await manager.activate();
    site.extensionCleanup = () => manager.disposeSync(); return manager;
  }
  get blocks() { return this.site.blockRenderers; }
  get blockDefinitions() { return this.site.extensionBlockDefinitions; }
  get themes() { return this.active.flatMap((extension) => extension.themes ?? []); }
  get panels() { return this.active.flatMap((extension) => extension.panels ?? []); }
  status() { return structuredClone(this.diagnostics); }
  private configured(member: Member) { return this.site.store.get('extension-config', member.id)?.value.enabled ?? member.enabled; }
  private async load() {
    const folder = join(this.site.root, 'extensions'), manifest = join(folder, 'manifest.json');
    let descriptors: { id?: string; file: string; enabled: boolean }[];
    try {
      descriptors = existsSync(manifest) ? extensionManifestSchema.parse(JSON.parse(readFileSync(manifest, 'utf8'))).extensions : existsSync(join(folder, 'index.mjs')) ? [{ file: 'index.mjs', enabled: true }] : [];
      const seen = new Set<string>();
      for (const descriptor of descriptors) {
        if (descriptor.id && seen.has(descriptor.id)) throw new WeavaError('扩展清单编号重复：' + descriptor.id);
        if (descriptor.id) seen.add(descriptor.id);
      }
    } catch (error: any) { this.members = [{ id: 'manifest', file: manifest, enabled: true, error: '扩展清单无效：' + error.message }]; return; }
    for (const descriptor of descriptors) {
      const member: Member = { id: descriptor.id ?? 'legacy', file: descriptor.file, enabled: descriptor.enabled }; this.members.push(member);
      try {
        const file = inside(folder, descriptor.file);
        const factory = (await import(pathToFileURL(file).href)).default;
        if (typeof factory !== 'function') throw new Error('扩展需要默认导出工厂函数。');
        const ext: Extension = await factory({ site: this.site, apiVersion: 1, frameworkVersion: VERSION, renderDocument, renderBlocks, z, ...this.services });
        identifier.parse(ext.id); if (descriptor.id && ext.id !== descriptor.id) throw new Error('扩展编号与清单不一致。'); member.id = ext.id;
        if (ext.apiVersion !== 1) throw new Error('扩展 API 版本不兼容。');
        versionSchema.parse(ext.version ?? '0.0.0');
        for (const dependency of ext.dependencies ?? []) { identifier.parse(dependency.id); if (dependency.minVersion) versionSchema.parse(dependency.minVersion); }
        if (!Number.isSafeInteger(ext.schemaVersion ?? 0) || (ext.schemaVersion ?? 0) < 0) throw new Error('扩展数据版本无效。');
        const migrations = ext.migrations ?? [], versions = new Set<number>();
        for (const migration of migrations) { if (!Number.isSafeInteger(migration.version) || migration.version < 1 || migration.version > (ext.schemaVersion ?? 0) || versions.has(migration.version) || typeof migration.up !== 'function' || migration.up.constructor.name === 'AsyncFunction') throw new Error('扩展迁移编号无效、重复或使用了异步函数。'); versions.add(migration.version); }
        for (const type of ext.contentTypes ?? []) typeSchema.parse(type);
        for (const [key, renderer] of Object.entries(ext.blocks ?? {})) {
          if (!key.startsWith(ext.id + ':') || blockTypes.includes(key) || typeof renderer !== 'function') throw new Error('扩展区块需要使用自己的前缀与渲染器：' + key);
          const definition = ext.blockDefinitions?.[key];
          if (definition && (!definition.label || !Array.isArray(definition.fields) || typeof definition.schema?.safeParse !== 'function')) throw new Error('扩展区块声明无效：' + key);
        }
        for (const key of Object.keys(ext.blockDefinitions ?? {})) if (!ext.blocks?.[key]) throw new Error('区块声明缺少渲染器：' + key);
        for (const task of ext.schedules ?? []) if (!task.id || !Number.isFinite(task.intervalMs) || task.intervalMs < 1000 || typeof task.run !== 'function') throw new Error('扩展定时任务声明无效。');
        member.extension = ext;
      } catch (error: any) { member.error = error.message; }
    }
  }
  private order(strict = true) {
    const selected = this.members.filter((member) => this.configured(member)), ordered: Member[] = [], visiting = new Set<string>(), visited = new Set<string>();
    const visit = (member: Member) => {
      if (visited.has(member.id)) return;
      if (visiting.has(member.id)) throw new WeavaError('扩展依赖形成循环：' + [...visiting, member.id].join(' → '));
      if (member.error || !member.extension) throw new WeavaError(member.id + ' 无法载入：' + member.error);
      visiting.add(member.id);
      for (const dependency of member.extension.dependencies ?? []) {
        const target = selected.find((item) => item.id === dependency.id);
        if (!target) throw new WeavaError(member.id + ' 需要启用扩展 ' + dependency.id);
        visit(target);
        if (dependency.minVersion && compareVersion(target.extension!.version ?? '0.0.0', dependency.minVersion) < 0) throw new WeavaError(member.id + ' 需要 ' + dependency.id + ' ' + dependency.minVersion + ' 或更新版本');
      }
      visiting.delete(member.id); visited.add(member.id); ordered.push(member);
    };
    for (const member of selected) try { visit(member); } catch (error: any) {
      visiting.clear();
      if (strict) throw error;
      this.diagnostics[this.members.indexOf(member)] = this.snapshotDiagnostic(member, member.error ? 'failed' : 'blocked', error.message);
    }
    return ordered;
  }
  private snapshotDiagnostic(member: Member, status: ExtensionDiagnostic['status'], error?: string): ExtensionDiagnostic {
    const ext = member.extension, installed = this.site.store.get('extension-installed', member.id)?.value;
    return { id: member.id, label: ext?.label ?? member.id, version: ext?.version ?? '0.0.0', enabled: this.configured(member), status, error: error ?? member.error,
      dependencies: ext?.dependencies ?? [], schemaVersion: ext?.schemaVersion ?? 0, installedSchema: installed?.schemaVersion ?? 0, backup: installed?.backup,
      configRevision: this.site.store.get('extension-config', member.id)?.revision ?? null };
  }
  private async activate() {
    this.diagnostics = this.members.map((member) => this.snapshotDiagnostic(member, this.configured(member) ? 'blocked' : 'disabled'));
    const ordered = this.order(false);
    const themes = new Set(['weava', 'newsletter']), panels = new Set<string>(), types = new Set<string>();
    for (const member of ordered) {
      const ext = member.extension!;
      let attemptedBackup: string | undefined;
      try {
        for (const dependency of ext.dependencies ?? []) if (!this.active.some((item) => item.id === dependency.id)) throw new Error('依赖扩展启动失败：' + dependency.id);
        for (const theme of ext.themes ?? []) if (themes.has(theme.id)) throw new Error('主题编号重复：' + theme.id);
        for (const panel of ext.panels ?? []) if (panels.has(panel.id)) throw new Error('设置面板编号重复：' + panel.id);
        for (const type of ext.contentTypes ?? []) if (types.has(type.id)) throw new Error('多个扩展声明了相同内容类型：' + type.id);
        const installed = this.site.store.get('extension-installed', ext.id), current = installed?.value.schemaVersion ?? 0, target = ext.schemaVersion ?? 0;
        if (current > target) throw new Error('扩展数据版本较新，不能使用旧版代码。');
        for (let version = current + 1; version <= target; version++) if (!ext.migrations?.some((item) => item.version === version)) throw new Error('缺少扩展迁移：' + version);
        let backup = installed?.value.backup;
        if (target > current) { const folder = join(this.site.root, 'archives', 'extension-upgrades'); mkdirSync(folder, { recursive: true }); backup = join(folder, ext.id + '-v' + current + '-to-v' + target + '-' + uuid() + '.sqlite'); attemptedBackup = backup; await this.site.store.raw.backup(backup); }
        this.site.store.raw.transaction(() => {
          for (let version = current + 1; version <= target; version++) {
            const result: unknown = ext.migrations!.find((item) => item.version === version)!.up({ site: this.site });
            if (result && typeof (result as any).then === 'function') throw new Error('扩展迁移必须同步完成，只写入事务内的站点数据。');
          }
          for (const type of ext.contentTypes ?? []) if (!this.site.store.get('type', type.id)) this.site.saveType(type, null);
          for (const [key, renderer] of Object.entries(ext.blocks ?? {})) {
            const row = this.site.store.get('extension-block', key), definition = ext.blockDefinitions?.[key];
            this.site.store.put('extension-block', key, { extension: ext.id, label: definition?.label ?? key, fields: definition?.fields ?? [] }, row?.revision ?? null);
          }
          this.site.store.put('extension-installed', ext.id, { version: ext.version ?? '0.0.0', schemaVersion: target, ...(backup ? { backup } : {}) }, installed?.revision ?? null, '扩展版本检查');
        }).immediate();
        if (this.mode === 'runtime') await ext.start?.();
        this.active.push(ext); for (const theme of ext.themes ?? []) themes.add(theme.id); for (const panel of ext.panels ?? []) panels.add(panel.id); for (const type of ext.contentTypes ?? []) types.add(type.id);
        this.site.extensionThemes = this.themes.map((theme) => theme.id);
        for (const [key, renderer] of Object.entries(ext.blocks ?? {})) {
          if (ext.blockDefinitions?.[key]) this.site.extensionBlockDefinitions[key] = ext.blockDefinitions[key];
          this.site.blockRenderers[key] = (block, release, entry) => { if (ext.blockDefinitions?.[key]) validateBlockProps(key, block.props, true, ext.blockDefinitions[key]); return renderer(block, release, entry); };
        }
        this.diagnostics[this.members.indexOf(member)] = this.snapshotDiagnostic(member, 'active');
        if (this.mode === 'runtime') this.startTasks(ext);
      } catch (error: any) { if (this.mode === 'runtime') await Promise.resolve().then(() => ext.stop?.()).catch(() => {}); this.diagnostics[this.members.indexOf(member)] = { ...this.snapshotDiagnostic(member, 'failed', error.message), ...(attemptedBackup ? { backup: attemptedBackup } : {}) }; }
    }
  }
  private startTasks(ext: Extension) {
    this.timers.set(ext.id, (ext.schedules ?? []).map((task) => {
      let running = false;
      const timer = setInterval(() => {
        if (running || this.disposed || this.changing) return; running = true;
        const work = Promise.resolve().then(task.run).catch((error) => { const row = this.diagnostics.find((item) => item.id === ext.id); if (row) row.taskError = task.id + '：' + error.message; }).finally(() => { running = false; this.tasks.delete(work); });
        this.tasks.add(work);
      }, task.intervalMs); timer.unref(); return timer;
    }));
  }
  async render(entry: Entry, release: Release) { if (this.changing) throw new WeavaError('扩展正在切换，请稍后重试。', 503); for (const ext of this.active) { const html = await ext.render?.(entry, release); if (html != null) return html; } return null; }
  async validateRelease(release:Release){for(const entry of release.entries)try{await this.render(entry,release);}catch(error:any){throw new WeavaError('扩展无法渲染“'+entry.title+'”：'+error.message,400,{id:entry.id});}}
  async route(request: Request, release: Release | null) { for (const ext of this.active) { const response = await ext.route?.(request, release); if (response != null) return response; } return null; }
  usage(id: string) {
    const ext = this.members.find((member) => member.id === id)?.extension;
    const result: { kind: string; id: string; label: string }[] = []; if (!ext) return result;
    const inspect = (kind: string, id: string, label: string, value: any) => {
      let used = false; visitBlocks(value.blocks ?? [], (block) => { if (block.type.startsWith(ext.id + ':')) used = true; });
      if ((ext.contentTypes ?? []).some((type) => value.kind === 'content' && type.id === value.type) || (ext.themes ?? []).some((theme) => value.theme === theme.id)) used = true;
      if (used) result.push({ kind, id, label });
    };
    for (const row of this.site.store.list('entry')) inspect('entry', row.id, row.value.title, row.value);
    for (const row of this.site.store.list('layout')) inspect('layout', row.id, row.value.label, row.value);
    inspect('settings', 'site', '网站设置工作稿', this.site.settings().value);
    const release = this.site.release();
    if (release) { for (const entry of release.entries) inspect('published', entry.id, entry.title, entry); for (const layout of release.layouts ?? []) inspect('published-layout', layout.id, layout.label, layout); inspect('published-settings', 'site', '公开网站设置', release.settings); }
    for (const member of this.members) if (this.configured(member) && member.extension?.dependencies?.some((dependency) => dependency.id === id)) result.push({ kind: 'extension', id: member.id, label: member.extension.label ?? member.id });
    return result;
  }
  async setEnabled(id: string, enabled: boolean, expected: number | null) {
    if (this.mode !== 'runtime') throw new WeavaError('任务程序不更改扩展启停。');
    if (this.changing) throw new WeavaError('扩展正在切换，请稍后再试。', 409);
    const member = this.members.find((member) => member.id === id); if (!member) throw new WeavaError('扩展不存在。', 404);
    const row = this.site.store.get('extension-config', id);
    if ((row?.revision ?? null) !== expected) throw new WeavaError('扩展设置已变化，请刷新后重试。', 409);
    if (!enabled) { const uses = this.usage(id); if (uses.length) throw new WeavaError('扩展仍被以下内容或依赖使用，请先处理引用。', 409, uses); }
    const before = this.configured(member); this.changing = true;
    const liveJobs = this.site.jobs().filter((job) => ['publish', 'import-wxr'].includes(job.operation) && ['queued', 'running'].includes(job.status));
    if (liveJobs.length) { this.changing = false; throw new WeavaError('内容任务仍在运行，请等待完成后切换扩展。', 409); }
    this.site.store.setState('extension-transition', JSON.stringify({ pid: process.pid, id }));
    try {
      const saved = this.site.store.put('extension-config', id, { enabled }, expected, enabled ? '启用扩展' : '停用扩展');
      try {
        await this.stop(); this.disposed = false; await this.activate();
        if (enabled && !this.active.some((ext) => ext.id === id)) throw new WeavaError(this.diagnostics.find((row) => row.id === id)?.error ?? '扩展未能启动。');
      } catch (error) {
        this.site.store.put('extension-config', id, { enabled: before }, saved.revision, '恢复扩展启停设置');
        await this.stop(); this.disposed = false; await this.activate(); throw error;
      }
      return this.status();
    } finally { this.site.store.setState('extension-transition', ''); this.changing = false; }
  }
  private disposeSync() { this.disposed = true; for (const timers of this.timers.values()) timers.forEach(clearInterval); this.timers.clear(); }
  async stop() {
    this.disposeSync(); await Promise.allSettled(this.tasks);
    const errors: string[] = [];
    for (const ext of [...this.active].reverse()) try { if (this.mode === 'runtime') await ext.stop?.(); } catch (error: any) { errors.push(ext.id + '：' + error.message); }
    this.active = []; this.site.blockRenderers = {}; this.site.extensionBlockDefinitions = {}; this.site.extensionThemes = [];
    if (errors.length) throw new WeavaError('扩展停止失败：' + errors.join('；'));
  }
}
