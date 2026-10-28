import { join, resolve } from 'node:path';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { Storage, now, uuid, digest } from './storage.ts';
import { renderDocument, plain, tokens, validateFields } from './documents.ts';
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
  type FieldDefinition,
} from '@weava/contracts';
import { load } from 'cheerio';
export class Site {
  store: Storage;
  private releaseCache = new Map<string, Release>();
  private mediaPolicyCache?: { key: string; privatePaths: Set<string> };
  constructor(public root: string) {
    this.root = resolve(root);
    this.store = new Storage(root);
    if (!this.store.get('settings', 'site'))
      this.store.put('settings', 'site', defaultSettings, null, '初始化');
    if (!existsSync(join(root, 'cli-token')))
      writeFileSync(join(root, 'cli-token'), randomBytes(32).toString('hex'));
  }
  close() {
    this.store.close();
  }
  settings() {
    return this.store.get('settings', 'site')!;
  }
  saveSettings(value: Settings, revision: number) {
    if (!value.name?.trim()) throw new WeavaError('请填写网站名称。');
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
    return this.store.put('settings', 'site', value, revision);
  }
  saveType(value: ContentType, revision: number | null) {
    const type = typeSchema.parse(value);
    const seen = new Set<string>();
    for (const f of type.fields) {
      if (seen.has(f.key)) throw new WeavaError('字段名称重复：' + f.key);
      seen.add(f.key);
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
    if (previous) {
      const a = { ...previous.value, updatedAt: '' },
        b = { ...input, updatedAt: '' };
      if (digest(a) === digest(b)) return previous;
    }
    return this.store.put('entry', input.id, input, revision);
  }
  validateBlocks(blocks: Block[]) {
    const ids = new Set<string>();
    const visit = (items: Block[], depth: number) => {
      if (depth > 12) throw new WeavaError('页面区块嵌套过深。');
      for (const b of items) {
        if (ids.has(b.id)) throw new WeavaError('区块编号重复。');
        ids.add(b.id);
        if (!blockTypes.includes(b.type) && !this.store.get('extension-block', b.type))
          throw new WeavaError('未知区块：' + b.type);
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
    if (cached) return cached;
    const row = this.store.raw.prepare('SELECT data FROM releases WHERE id=?').get(key) as any;
    if (!row) return null;
    const release = JSON.parse(row.data);
    this.releaseCache.set(key, release);
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
    const navigation = (items: Settings['navigation']): Settings['navigation'] =>
      items.filter((item) => {
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
      const entryMedia = (entry: Entry, into: Set<string>) =>
        collect([entry.cover, entry.document, entry.blocks, entry.fields], into);
      const release = this.release();
      for (const entry of release?.entries ?? [])
        entryMedia(entry, entry.visibility === 'private' ? privatePaths : publicPaths);
      collect(release?.settings ?? {}, publicPaths);
      for (const row of this.store.list('entry'))
        if (row.value.visibility === 'private') entryMedia(row.value, privatePaths);
      const privateHistory = this.store.raw.prepare("SELECT data FROM revisions WHERE scope='entry' AND json_extract(data,'$.visibility')='private'").all() as { data: string }[];
      for (const row of privateHistory) entryMedia(JSON.parse(row.data), privatePaths);
      // Originals and responsive derivatives have the same access policy.
      for (const row of this.store.list('media')) {
        const family: string[] = [row.value.url, ...(row.value.derivatives ?? []).map((d: any) => d.url)];
        if (family.some((url) => privatePaths.has(url))) family.forEach((url) => privatePaths.add(url));
        if (family.some((url) => publicPaths.has(url))) family.forEach((url) => publicPaths.add(url));
      }
      publicPaths.forEach((url) => privatePaths.delete(url));
      this.mediaPolicyCache = { key, privatePaths };
    }
    return this.mediaPolicyCache.privatePaths.has(decodeURIComponent(path));
  }
  redirect(url: URL, includePrivate = false) {
    const path = normalizePath(url.pathname);
    const queryKey = path === '/' && url.searchParams.has('p') ? '/?p=' + url.searchParams.get('p') : path;
    const value = this.store.get('redirect', queryKey)?.value;
    if (!value) return null;
    const release = this.visibleRelease(includePrivate);
    if (value.entryId && !release?.entries.some((e) => e.id === value.entryId)) return null;
    if (!includePrivate && value.target.startsWith('/media/') && this.isPrivateMedia(value.target)) return null;
    const query = new URLSearchParams(url.search);
    if (queryKey !== path) query.delete('p');
    return value.target + (query.size ? '?' + query.toString() : '');
  }
  publish(
    // Visibility is independent of the draft/published lifecycle.
    options: {
      ids?: string[];
      label?: string;
      failAt?: string;
      jobId?: string;
      revisions?: Record<string, number>;
    } = {},
  ) {
    const snapshot = this.store.raw.transaction(() => ({
      previous: this.release(),
      drafts: this.store.list('entry'),
      settings: this.settings().value,
      types: this.store.list('type').map((r) => r.value),
    }))();
    const previous = snapshot.previous;
    const drafts = snapshot.drafts;
    const selected = options.ids ? new Set(options.ids) : null;
    if (selected)
      for (const id of selected) {
        const row = drafts.find((r) => r.id === id);
        if (!row) throw new WeavaError('内容不存在：' + id, 404);
        if (options.revisions?.[id] && options.revisions[id] !== row.revision)
          throw new WeavaError('待发布内容已变化，请重新载入。', 409);
      }
    const entries = selected ? new Map(previous?.entries.map((e) => [e.id, e]) ?? []) : new Map();
    const time = now();
    for (const row of drafts) {
      if (selected && !selected.has(row.id)) continue;
      const e = row.value as Entry;
      if (e.status === 'archived') {
        entries.delete(e.id);
        continue;
      }
      // A new draft is included only by explicit selection; existing published entries update in full-site publication.
      if (e.status === 'draft' && !selected && !previous?.entries.some((p) => p.id === e.id))
        continue;
      entries.set(e.id, {
        ...e,
        status: 'published',
        publishedAt:
          e.publishedAt || previous?.entries.find((p) => p.id === e.id)?.publishedAt || time,
        html: renderDocument(e.document),
        modifiedAt: row.updatedAt,
        revisionId: row.revision,
      });
    }
    const paths = new Map<string, string>();
    for (const e of entries.values()) {
      if (paths.has(e.path)) throw new WeavaError('网址重复：' + e.path);
      paths.set(e.path, e.id);
      this.validateBlocks(e.blocks);
      const def = snapshot.types.find((t) => t.id === e.type);
      if (e.kind === 'content' && def) validateFields(def.fields, e.fields);
    }
    const missing: any[] = [];
    const references = (defs: FieldDefinition[], values: Record<string, any>, id: string) => {
      for (const field of defs) {
        const value = values[field.key];
        if (value === undefined || value === null || value === '') continue;
        for (const item of field.multiple ? value : [value]) {
          if (field.type === 'reference' && !entries.has(item))
            missing.push({ id, field: field.key, reference: item });
          if (field.type === 'group') references(field.fields ?? [], item, id);
        }
      }
    };
    for (const e of entries.values()) {
      const def = snapshot.types.find((t) => t.id === e.type);
      if (def) references(def.fields, e.fields, e.id);
      const source = e.html + JSON.stringify(e.blocks) + JSON.stringify(e.fields) + ' ' + e.cover;
      for (const match of source.matchAll(/\/media\/[\w%./@+~-]+/g)) {
        const path = decodeURIComponent(match[0].replace(/[\\]+$/, ''));
        if (!existsSync(join(this.root, path.slice(1)))) missing.push({ id: e.id, path });
      }
      if (!e.compatibility) {
        const $ = load(e.html);
        $('a[href]').each((_i, el) => {
          const href = $(el).attr('href') ?? '';
          if (href.startsWith('#') || !href.startsWith('/')) return;
          const path = normalizePath(href);
          const redirect = this.store.get('redirect', path)?.value;
          if (
            !paths.has(path) &&
            !(redirect && (paths.has(redirect.target) || redirect.target.startsWith('/media/') || ['/rss.xml','/sitemap.xml'].includes(redirect.target))) &&
            !/^\/(media|api|video|search)(\/|$)/.test(path) &&
            !['/rss.xml', '/sitemap.xml'].includes(path)
          )
            missing.push({ id: e.id, path });
        });
      }
    }
    if (missing.length) throw new WeavaError('内容或媒体引用无效。', 400, missing.slice(0, 30));
    const release: Release = {
      id: uuid(),
      createdAt: time,
      entries: [...entries.values()],
      settings: selected && previous ? previous.settings : snapshot.settings,
      types: snapshot.types,
      label: options.label ?? '发布',
    };
    if (options.failAt === 'validate') throw new WeavaError('测试：发布校验失败。');
    this.store.raw
      .transaction(() => {
        if ((this.store.state('release') ?? null) !== (previous?.id ?? null))
          throw new WeavaError('公开版本在发布期间发生变化，请重试。', 409);
        this.store.raw
          .prepare('INSERT INTO releases VALUES(?,?,?)')
          .run(release.id, JSON.stringify(release), time);
        const insert = this.store.raw.prepare('INSERT INTO search_documents VALUES(?,?,?,?,?)'),
          fts = this.store.raw.prepare('INSERT INTO search_fts VALUES(?,?,?)');
        for (const e of release.entries) {
          if (!e.indexable || e.visibility === 'private') continue;
          insert.run(release.id, e.id, e.path, e.title, e.description);
          fts.run(
            release.id,
            e.id,
            tokens(
              e.title +
                ' ' +
                e.description +
                ' ' +
                plain(e.html) +
                ' ' +
                e.categories.join(' ') +
                ' ' +
                e.tags.join(' '),
            ),
          );
        }
        if (options.failAt === 'commit') throw new WeavaError('测试：发布提交失败。');
        this.store.setState('release', release.id);
        if (options.jobId)
          this.updateJob(options.jobId, {
            status: 'complete',
            message: '发布已完成。',
            result: { releaseId: release.id, entries: release.entries.length },
          });
      })
      .immediate();
    return release;
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
          this.store.raw
            .prepare('INSERT INTO releases VALUES(?,?,?)')
            .run(next.id, JSON.stringify(next), next.createdAt);
          this.store.raw
            .prepare(
              'INSERT INTO search_documents SELECT ?,entry_id,path,title,description FROM search_documents WHERE release_id=? AND entry_id<>?',
            )
            .run(next.id, current.id, id);
          this.store.raw
            .prepare(
              'INSERT INTO search_fts SELECT ?,entry_id,tokens FROM search_fts WHERE release_id=? AND entry_id<>?',
            )
            .run(next.id, current.id, id);
          this.store.setState('release', next.id);
        }
        return saved;
      })
      .immediate();
  }
  rollback(id: string) {
    if (!this.release(id)) throw new WeavaError('公开版本不存在。', 404);
    this.store.raw.transaction(() => this.store.setState('release', id)).immediate();
    return { releaseId: id };
  }
  search(query: string, releaseId?: string) {
    const release = releaseId ?? this.store.state('release');
    const terms = tokens(query).split(' ').filter(Boolean);
    if (!release || !terms.length) return [];
    const match = terms.map((t) => '"' + t.replace(/"/g, '') + '"').join(' AND ');
    const publicIds = new Set(this.visibleRelease(false, release)?.entries.map((e) => e.id) ?? []);
    return this.store.raw
      .prepare(
        `SELECT d.entry_id id,d.path,d.title,d.description FROM search_fts s JOIN search_documents d ON d.release_id=s.release_id AND d.entry_id=s.entry_id WHERE search_fts MATCH ? AND s.release_id=? ORDER BY rank LIMIT 60`,
      )
      .all(match, release).filter((row: any) => publicIds.has(row.id));
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
