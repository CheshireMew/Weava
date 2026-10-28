import { join, resolve } from 'node:path';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { Storage, now, uuid, digest } from './storage.ts';
import { renderDocument, validateFields } from './documents.ts';
import { loadRelease, storeRelease, searchRelease } from './publication-store.ts';
import { preparePublication, publish } from './publication.ts';
import { saveTerm, ensureTerm, attachTerms } from './taxonomy.ts';
import { layouts, referencedLayouts, visitBlocks } from './layouts.ts';
import type { Term } from '@weava/contracts';
import {
  defaultSettings,
  entrySchema,
  typeSchema,
  blockTypes,
  WeavaError,
  type Entry,
  type Settings,
  type Release,
  type Job,
  type ContentType,
  type Block,
  type PublishOptions,
  validateBlockProps,
  blockDefinitions,
  type BlockDefinition,
} from '@weava/contracts';
export class Site {
  store: Storage;
  private releaseCache = new Map<string, Release>();
  private mediaPolicyCache?: { key: string; privatePaths: Set<string> };
  blockRenderers: Record<string, (block: Block, release: Release, entry?: Entry) => string> = {};
  extensionBlockDefinitions: Record<string, BlockDefinition> = {};
  extensionThemes: string[] = [];
  extensionCleanup?: () => void;
  publicationValidators: ((release: Release) => void)[] = [];
  constructor(public root: string) {
    this.root = resolve(root);
    this.store = new Storage(root);
    if (!this.store.get('settings', 'site'))
      this.store.put('settings', 'site', defaultSettings, null, '初始化');
    if (!existsSync(join(root, 'cli-token')))
      writeFileSync(join(root, 'cli-token'), randomBytes(32).toString('hex'));
  }
  close() {
    this.extensionCleanup?.();
    this.store.close();
  }
  settings() {
    return this.store.get('settings', 'site')!;
  }
  saveSettings(value: Settings, revision: number) {
    if (!value.name?.trim()) throw new WeavaError('请填写网站名称。');
    const navigation = (items: Settings['navigation'], depth = 0) => {
      if (!Array.isArray(items) || depth > 5) throw new WeavaError('导航层级最多为六层。');
      for (const item of items) {
        if (!item.label?.trim() || typeof item.url !== 'string') throw new WeavaError('导航文字或网址无效。');
        try { const url = new URL(item.url, value.domain); if (!['http:', 'https:', 'mailto:', 'tel:', 'entry:'].includes(url.protocol)) throw new Error(); }
        catch { throw new WeavaError('导航网址无效：' + item.label); }
        if (item.children) navigation(item.children, depth + 1);
      }
    };
    navigation(value.navigation);
    try {
      new URL(value.domain);
      new Intl.DateTimeFormat(value.language, { timeZone: value.timezone });
    } catch {
      throw new WeavaError('域名、语言或时区无效。');
    }
    if (
      !/^#[0-9a-f]{6}$/i.test(value.themeConfig.accent) ||
      !/^#[0-9a-f]{6}$/i.test(value.themeConfig.background)
    )
      throw new WeavaError('颜色需要使用六位十六进制格式。');
    if (
      value.themeConfig.width < 600 ||
      value.themeConfig.width > 2400 ||
      value.themeConfig.radius < 0 ||
      value.themeConfig.radius > 80 ||
      value.themeConfig.spacing < 0 ||
      value.themeConfig.spacing > 100
    )
      throw new WeavaError('主题尺寸超出范围。');
    return this.store.raw.transaction(() => {
      for (const item of value.taxonomies) {
        const current = this.store.get('term', item.id);
        if (!current) ensureTerm(this, item.label, item.kind ?? 'category', item.id);
        else if (current.value.label !== item.label || (item.slug && current.value.slug !== item.slug) || current.value.parentId !== item.parentId)
          saveTerm(this, { ...current.value, label: item.label, slug: item.slug ?? current.value.slug, parentId: item.parentId }, current.revision);
      }
      return this.store.put('settings', 'site', value, revision);
    }).immediate();
  }
  terms() { return this.store.list('term'); }
  saveTerm(value: Term, revision: number | null) {
    return this.store.raw.transaction(() => {
      const saved = saveTerm(this, value, revision);
      const settings = this.settings();
      if (settings.value.taxonomies.some((term: any) => term.id === value.id))
        this.store.put('settings', 'site', { ...settings.value, taxonomies: settings.value.taxonomies.map((term: any) => term.id === value.id ? { ...term, ...saved.value } : term) }, settings.revision);
      return saved;
    }).immediate();
  }
  saveType(value: ContentType, revision: number | null) {
    const type = typeSchema.parse(value);
    const seen = new Set<string>();
    for (const f of type.fields) {
      if (seen.has(f.key)) throw new WeavaError('字段名称重复：' + f.key);
      seen.add(f.key);
      if (f.filterable && !['text', 'number', 'boolean', 'date', 'select', 'reference'].includes(f.type)) throw new WeavaError('这个字段类型不能用于列表筛选：' + f.label);
    }
    const affected = [];
    for (const row of this.store.list('entry').filter((r) => r.value.type === type.id)) {
      try {
        validateFields(type.fields, row.value.fields);
      } catch (e) {
        affected.push({ id: row.id, title: row.value.title, error: String(e) });
      }
    }
    if (affected.length) throw new WeavaError('字段变更与现有内容不兼容。', 409, affected);
    return this.store.put('type', type.id, type, revision);
  }
  entries() {
    const published = new Map(this.release()?.entries.map((e) => [e.id, e]) ?? []);
    return this.store.list('entry').map((r) => {
      const { document, blocks, compatibility, fields, source, ...summary } = r.value;
      return {
        ...r,
        value: { ...summary, visibility: summary.visibility ?? 'public' },
        published: published.has(r.id),
        hasChanges: published.get(r.id)?.revisionId !== r.revision,
      };
    });
  }
  saveEntry(value: Entry, revision: number | null) {
    const input = entrySchema.parse(value);
    input.path = normalizePath(input.path);
    if (/^\/(admin|api|_astro|_admin|media|__preview|__health)(\/|$)/.test(input.path))
      throw new WeavaError('这个网址由系统使用。');
    const previous = this.store.get('entry', input.id);
    if ((previous?.revision ?? null) !== revision)
      throw new WeavaError('内容已被其他窗口修改，请重新载入。', 409, {
        id: input.id,
        currentRevision: previous?.revision,
      });
    const time = now();
    input.createdAt = previous?.value.createdAt ?? input.createdAt ?? time;
    input.updatedAt = time;
    if (!previous && revision !== null) throw new WeavaError('内容不存在。', 409);
    if (input.kind === 'content') {
      const definition = this.store.get('type', input.type)?.value;
      if (!definition) throw new WeavaError('内容类型不存在。');
      validateFields(definition.fields, input.fields, '', false);
    }
    // Removed fields survive edits so schema changes cannot silently destroy values.
    if (previous) input.fields = { ...previous.value.fields, ...input.fields };
    renderDocument(input.document);
    this.validateBlocks(input.blocks);
    const body = (items: Block[]): boolean => items.some((block) => block.type === 'entry-body' || body(block.children ?? []));
    if (body(input.blocks)) throw new WeavaError('内容正文占位只用于模板，页面内容不能引用自身。');
    if (previous) {
      const a = { ...previous.value, updatedAt: '' },
        b = { ...input, updatedAt: '' };
      if (digest(a) === digest(b)) return previous;
    }
    return this.store.raw.transaction(() => this.store.put('entry', input.id, attachTerms(this, input, previous?.value), revision)).immediate();
  }
  validateBlocks(blocks: Block[], publishing = false) {
    const ids = new Set<string>();
    const visit = (items: Block[], depth: number) => {
      if (depth > 12) throw new WeavaError('页面区块嵌套过深。');
      for (const b of items) {
        if (ids.has(b.id)) throw new WeavaError('区块编号重复。');
        ids.add(b.id);
        if (!blockTypes.includes(b.type) && !this.store.get('extension-block', b.type))
          throw new WeavaError('未知区块：' + b.type);
        const definition = this.extensionBlockDefinitions[b.type] ?? blockDefinitions[b.type];
        const placeholders = Object.fromEntries((definition?.fields ?? []).filter((field) => field.required && b.bindings?.[field.key]).map((field) => [field.key, field.control === 'number' ? 0 : '绑定值']));
        try { validateBlockProps(b.type, { ...b.props, ...placeholders }, publishing, definition); }
        catch (error: any) { throw new WeavaError(error.message, 400, { blockId: b.id, type: b.type }); }
        if (b.children) visit(b.children, depth + 1);
      }
    };
    visit(blocks, 0);
  }
  history(id: string) {
    return this.store.history('entry', id);
  }
  restore(id: string, version: number, revision: number) {
    return this.store.raw
      .transaction(() => {
        const row = this.store.raw
          .prepare('SELECT data FROM revisions WHERE scope=? AND id=? AND revision=?')
          .get('entry', id, version) as any;
        if (!row) throw new WeavaError('版本不存在。', 404);
        return this.saveEntry({ ...JSON.parse(row.data), status: 'draft' }, revision);
      })
      .immediate();
  }
  release(id?: string): Release | null {
    const key = id ?? this.store.state('release');
    if (!key) return null;
    const cached = this.releaseCache.get(key);
    if (cached) return !id || this.store.raw.prepare('SELECT 1 FROM releases WHERE id=?').get(key) ? cached : null;
    const row = this.store.raw.prepare('SELECT data FROM releases WHERE id=?').get(key) as any;
    if (!row) return null;
    const release = loadRelease(this.store.raw, row.data);
    this.releaseCache.set(key, release);
    if(this.releaseCache.size>3)this.releaseCache.delete(this.releaseCache.keys().next().value!);
    if (this.releaseCache.size > 2)
      this.releaseCache.delete(this.releaseCache.keys().next().value!);
    return release;
  }
  releases() {
    return this.store.raw
      .prepare('SELECT id,created_at FROM releases ORDER BY created_at DESC')
      .all();
  }
  visibleRelease(includePrivate = false, id?: string): Release | null {
    const release = this.release(id);
    if (!release || includePrivate) return release;
    const hidden = new Set(
      release.entries.filter((e) => e.visibility === 'private').map((e) => e.path),
    );
    const hiddenIds = new Set(release.entries.filter((entry) => entry.visibility === 'private').map((entry) => entry.id));
    const navigation = (items: Settings['navigation']): Settings['navigation'] =>
      items.filter((item) => {
        if (item.url.startsWith('entry:')) return !hiddenIds.has(decodeURIComponent(item.url.slice(6)));
        try {
          const url = new URL(item.url, release.settings.domain);
          return url.origin !== new URL(release.settings.domain).origin || !hidden.has(normalizePath(url.pathname));
        } catch { return true; }
      }).map((item) => ({ ...item, ...(item.children ? { children: navigation(item.children) } : {}) }));
    return {
      ...release,
      entries: release.entries.filter((e) => e.visibility !== 'private'),
      settings: { ...release.settings, navigation: navigation(release.settings.navigation) },
    };
  }
  isPrivateMedia(path: string) {
    const revision = (this.store.raw.prepare('SELECT MAX(revision) revision FROM revisions').get() as any).revision;
    const key = `${this.store.state('release') ?? ''}:${revision}`;
    if (this.mediaPolicyCache?.key !== key) {
      const publicPaths = new Set<string>(), privatePaths = new Set<string>();
      const collect = (value: unknown, into: Set<string>) => {
        for (const match of JSON.stringify(value).matchAll(/\/media\/[\w%./@+~-]+/g))
          into.add(decodeURIComponent(match[0].replace(/[\\]+$/, '')));
      };
      const entryMedia = (entry: Entry, into: Set<string>, catalog: Pick<Release, 'settings' | 'types' | 'layouts'>) =>
        collect([entry.cover, entry.blocks.length ? null : entry.document, entry.blocks, entry.fields, referencedLayouts(entry, catalog)], into);
      const release = this.release();
      for (const entry of release?.entries ?? [])
        entryMedia(entry, entry.visibility === 'private' ? privatePaths : publicPaths, release!);
      collect(release?.settings ?? {}, publicPaths);
      if (release) collect(referencedLayouts(undefined, release), publicPaths);
      const working = { settings: this.settings().value, types: this.store.list('type').map((row) => row.value), layouts: layouts(this).map((row) => row.value) };
      for (const row of this.store.list('entry'))
        if (row.value.visibility === 'private') entryMedia(row.value, privatePaths, working);
      const privateHistory = this.store.raw.prepare("SELECT data FROM revisions WHERE scope='entry' AND json_extract(data,'$.visibility')='private'").all() as { data: string }[];
      for (const row of privateHistory) entryMedia(JSON.parse(row.data), privatePaths, working);
      for(const row of this.store.raw.prepare('SELECT data FROM releases').iterate() as Iterable<{data:string}>){const historical=loadRelease(this.store.raw,row.data);for(const entry of historical.entries)if(entry.visibility==='private')entryMedia(entry,privatePaths,historical);}
      for (const row of this.store.list('history-archive')) for (const path of row.value.privateMedia ?? []) privatePaths.add(path);
      // Originals and responsive derivatives have the same access policy.
      const media = this.store.list('media');
      for (const row of media) {
        const family: string[] = [row.value.url, ...(row.value.derivatives ?? []).map((d: any) => d.url)];
        if (family.some((url) => privatePaths.has(url))) family.forEach((url) => privatePaths.add(url));
        if (family.some((url) => publicPaths.has(url))) family.forEach((url) => publicPaths.add(url));
      }
      let inherited = true;
      while (inherited) {
        inherited = false;
        for (const row of media) {
          const parent = row.value.parentId ? media.find((item) => item.id === row.value.parentId) : null;
          if (!parent || !privatePaths.has(parent.value.url)) continue;
          for (const url of [row.value.url, ...(row.value.derivatives ?? []).map((item: any) => item.url)])
            if (!privatePaths.has(url)) { privatePaths.add(url); inherited = true; }
        }
      }
      publicPaths.forEach((url) => privatePaths.delete(url));
      this.mediaPolicyCache = { key, privatePaths };
    }
    return this.mediaPolicyCache.privatePaths.has(decodeURIComponent(path));
  }
  redirect(url: URL, includePrivate = false) {
    const path = normalizePath(url.pathname);
    const parameter = url.searchParams.has('p') ? 'p' : url.searchParams.has('page_id') ? 'page_id' : null;
    const queryKey = path === '/' && parameter ? '/?' + parameter + '=' + url.searchParams.get(parameter) : path;
    const release = this.visibleRelease(includePrivate);
    const value = release?.redirects?.[queryKey];
    if (!value || release?.entries.some((entry) => entry.path === queryKey)) return null;
    if (value.entryId && !release?.entries.some((e) => e.id === value.entryId)) return null;
    const target = value.entryId ? release!.entries.find((entry) => entry.id === value.entryId)!.path : value.target;
    if (target === path) return null;
    if (!includePrivate && target.startsWith('/media/') && this.isPrivateMedia(target)) return null;
    const query = new URLSearchParams(url.search);
    if (queryKey !== path && parameter) query.delete(parameter);
    return target + (query.size ? (target.includes('?') ? '&' : '?') + query.toString() : '');
  }
  previewPublication(options: PublishOptions = {}) {
    const { changes } = preparePublication(this, options);
    return { ...changes, options: { ...options, baseReleaseId: changes.baseReleaseId,
      reviewRevision: (this.store.raw.prepare('SELECT MAX(revision) n FROM revisions').get() as any).n } };
  }
  publish(options: PublishOptions = {}) {
    return publish(this, options);
  }
  withdraw(id: string, revision: number, archive = false) {
    return this.store.raw
      .transaction(() => {
        const row = this.store.get('entry', id);
        if (!row || row.revision !== revision)
          throw new WeavaError('内容已变化，请重新载入。', 409);
        const saved = this.saveEntry(
          { ...row.value, status: archive ? 'archived' : 'draft' },
          revision,
        );
        const current = this.release();
        if (current) {
          const next = {
            ...current,
            id: uuid(),
            createdAt: now(),
            label: archive ? '归档' : '撤下',
            entries: current.entries.filter((e) => e.id !== id),
          };
          storeRelease(this.store.raw, next);
          this.store.setState('release', next.id);
        }
        return saved;
      })
      .immediate();
  }
  rollback(id: string) {
    const release = this.release(id);
    if (!release) throw new WeavaError('公开版本不存在。', 404);
    this.validateReleaseExtensions(release);
    this.store.raw.transaction(() => this.store.setState('release', id)).immediate();
    return { releaseId: id };
  }
  validateReleaseExtensions(release: Release) {
    const missing = new Set<string>();
    const check = (block: Block) => { if (!blockTypes.includes(block.type) && !this.blockRenderers[block.type]) missing.add(block.type); };
    for (const entry of release.entries) visitBlocks(entry.blocks, check);
    for (const layout of release.layouts ?? []) visitBlocks(layout.blocks, check);
    if (!['weava', 'newsletter', ...this.extensionThemes].includes(release.settings.theme)) missing.add('主题 ' + release.settings.theme);
    if (missing.size) throw new WeavaError('请先恢复或启用公开版本所需的扩展。', 409, [...missing]);
  }
  search(query: string, releaseId?: string) {
    const release = this.visibleRelease(false, releaseId);
    return release ? searchRelease(this.store.raw, release, query) : [];
  }
  setOwner(password: string) {
    if (password.length < 10) throw new WeavaError('密码至少 10 个字符。');
    const salt = randomBytes(16).toString('hex');
    this.store.setState('owner', salt + ':' + scryptSync(password, salt, 64).toString('hex'));
    this.store.raw.prepare('UPDATE sessions SET expires=0').run();
  }
  ownerExists() {
    return !!this.store.state('owner');
  }
  login(password: string) {
    const stored = this.store.state('owner');
    if (!stored) throw new WeavaError('请先设置站主密码。', 403);
    const [salt, hash] = stored.split(':');
    const actual = scryptSync(password, salt, 64),
      expected = Buffer.from(hash, 'hex');
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected))
      throw new WeavaError('账号或密码不正确。', 401);
    const token = randomBytes(32).toString('hex');
    this.store.raw
      .prepare('INSERT INTO sessions VALUES(?,?)')
      .run(digest(token), Date.now() + 7 * 86400000);
    return token;
  }
  authenticate(token: string) {
    return !!this.store.raw
      .prepare('SELECT 1 FROM sessions WHERE token=? AND expires>?')
      .get(digest(token), Date.now());
  }
  logout(token: string) {
    this.store.raw.prepare('UPDATE sessions SET expires=0 WHERE token=?').run(digest(token));
  }
  cliToken() {
    return readFileSync(join(this.root, 'cli-token'), 'utf8');
  }
  job(id: string): Job {
    const row = this.store.raw.prepare('SELECT data FROM jobs WHERE id=?').get(id) as any;
    if (!row) throw new WeavaError('任务不存在。', 404);
    return JSON.parse(row.data);
  }
  jobs(): Job[] {
    return (
      this.store.raw.prepare('SELECT data FROM jobs ORDER BY rowid DESC LIMIT 100').all() as any[]
    ).map((r) => JSON.parse(r.data));
  }
  createJob(operation: string, payload: any = {}, key?: string) {
    if (key) {
      const existing = this.store.raw
        .prepare('SELECT data FROM jobs WHERE idempotency=?')
        .get(key) as any;
      if (existing) {
        const job = JSON.parse(existing.data) as Job;
        if (job.operation !== operation || digest(job.payload) !== digest(payload))
          throw new WeavaError('相同请求标识不能用于不同的操作。', 409);
        return job;
      }
    }
    const job: Job = {
      id: uuid(),
      operation,
      status: 'queued',
      createdAt: now(),
      updatedAt: now(),
      message: '等待执行',
      payload,
    };
    try {
      this.store.raw
        .prepare('INSERT INTO jobs VALUES(?,?,?,?,?)')
        .run(job.id, operation, job.status, JSON.stringify(job), key ?? null);
    } catch {
      throw new WeavaError('同类任务正在运行，请等待完成。', 409);
    }
    return job;
  }
  updateJob(id: string, updates: Partial<Job>) {
    const job = { ...this.job(id), ...updates, updatedAt: now() };
    this.store.raw
      .prepare('UPDATE jobs SET status=?,data=? WHERE id=?')
      .run(job.status, JSON.stringify(job), id);
    return job;
  }
  recoverJobs() {
    for (const job of this.jobs().filter((j) => ['queued', 'running'].includes(j.status))) {
      if (job.workerPid) {
        let alive = false;
        try {
          process.kill(job.workerPid, 0);
          alive = true;
        } catch {}
        if (alive) continue;
      }
      if (
        job.operation === 'publish' &&
        job.result?.releaseId &&
        job.result.releaseId === this.store.state('release')
      )
        this.updateJob(job.id, { status: 'complete', message: '发布已完成。' });
      else
        this.updateJob(job.id, {
          status: 'failed',
          message: '上次任务中断，当前公开版本保持有效；可重试。',
        });
    }
  }
}
export function normalizePath(input: string) {
  let path = decodeURI(input.split(/[?#]/)[0]).replace(/\/+/g, '/');
  if (path.includes('..') || path.includes('\\') || !path.startsWith('/'))
    throw new WeavaError('网址路径无效。');
  if (path !== '/' && !/\.[a-z0-9]+$/i.test(path) && !path.endsWith('/')) path += '/';
  return path;
}
