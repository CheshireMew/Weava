import { describe, it, expect } from 'vitest';
import {
  Site,
  renderDocument,
  createBackup,
  restoreBackup,
  verifyBackup,
  recoverRestore,
  Analytics,
  uploadMedia,
} from '@weava/core';
import { entrySchema } from '@weava/contracts';
import { mkdirSync, writeFileSync, readFileSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
const base = 'D:/Tools/cache/weava/tests/' + Date.now();
mkdirSync(base, { recursive: true });
function fixture(name: string) {
  const site = new Site(join(base, name));
  site.saveType(
    { id: 'post', label: '文章', fields: [], pathPrefix: '/posts/', template: 'article' },
    null,
  );
  return site;
}
const entry = (id: string) =>
  entrySchema.parse({
    id,
    kind: 'content',
    type: 'post',
    title: '中文测试 ' + id,
    path: '/posts/' + id + '/',
    status: 'published',
    document: {
      version: 1,
      format: 'markdown',
      source: '## 清晰的内容\n\n中文搜索与正文。\n\n| 字段 | 内容 |\n|---|---|\n| 甲 | 乙 |',
    },
  });
describe('content and publication', () => {
  it('autosaves incomplete fields and requires them at publication', () => {
    const site = fixture('required-draft');
    try {
      const type = site.store.get('type', 'post')!;
      site.saveType(
        { ...type.value, fields: [{ key: 'year', label: '年份', type: 'number', required: true }] },
        type.revision,
      );
      const row = site.saveEntry(entry('one'), null);
      expect(row.value.fields).toEqual({});
      expect(() => site.publish()).toThrow(/年份/);
      const saved = site.saveEntry({ ...row.value, fields: { year: 2026 } }, row.revision);
      expect(site.publish().entries[0].fields.year).toBe(2026);
      expect(() => site.saveEntry(saved.value, row.revision)).toThrow(/其他窗口/);
    } finally {
      site.close();
    }
  });
  it('validates references against the candidate release and restores only drafts', () => {
    const site = fixture('references');
    try {
      const t = site.store.get('type', 'post')!;
      site.saveType(
        { ...t.value, fields: [{ key: 'related', label: '关联内容', type: 'reference' }] },
        t.revision,
      );
      const first = site.saveEntry(entry('one'), null);
      site.saveEntry({ ...entry('two'), fields: { related: 'missing' } }, null);
      expect(() => site.publish()).toThrow(/引用无效/);
      const two = site.store.get('entry', 'two')!;
      site.saveEntry({ ...two.value, fields: { related: 'one' } }, two.revision);
      site.publish();
      const restored = site.restore('one', first.revision, first.revision);
      expect(restored.value.status).toBe('draft');
      expect(site.release()?.entries.find((e) => e.id === 'one')?.status).toBe('published');
    } finally {
      site.close();
    }
  });
  it('keeps revisions, conflicts, drafts and release snapshots independent', () => {
    const site = fixture('revisions');
    try {
      const one = site.saveEntry(entry('one'), null);
      const first = site.publish();
      const two = site.saveEntry({ ...one.value, title: '新标题' }, one.revision);
      expect(site.release()?.entries[0].title).toBe('中文测试 one');
      expect(() => site.saveEntry({ ...one.value, title: '过期' }, one.revision)).toThrow(
        /其他窗口/,
      );
      site.publish();
      expect(site.release()?.entries[0].title).toBe('新标题');
      site.rollback(first.id);
      expect(site.release()?.entries[0].title).toBe('中文测试 one');
      const restored = site.restore(one.id, one.revision, two.revision);
      expect(restored.value.title).toBe('中文测试 one');
    } finally {
      site.close();
    }
  });
  it('rolls back failed commits and reports path/media conflicts', () => {
    const site = fixture('rollback');
    try {
      site.saveEntry(entry('one'), null);
      const before = site.publish();
      expect(() => site.publish({ failAt: 'commit' })).toThrow(/提交/);
      expect(site.release()?.id).toBe(before.id);
      site.saveEntry({ ...entry('two'), path: '/posts/one/' }, null);
      expect(() => site.publish()).toThrow(/重复/);
    } finally {
      site.close();
    }
  });
  it('indexes Chinese and prevents unpublished content from leaking', () => {
    const site = fixture('search');
    try {
      site.saveEntry(entry('one'), null);
      site.saveEntry({ ...entry('draft'), title: '独特草稿', status: 'draft' }, null);
      site.publish();
      expect(site.search('中文搜索').length).toBe(1);
      expect(site.search('独特草稿')).toHaveLength(0);
      const row = site.store.get('entry', 'one')!;
      site.withdraw('one', row.revision);
      expect(site.search('中文搜索')).toHaveLength(0);
    } finally {
      site.close();
    }
  });
  it('rejects incompatible field definitions without discarding old values', () => {
    const site = fixture('fields');
    try {
      const t = site.store.get('type', 'post')!;
      site.saveType(
        { ...t.value, fields: [{ key: 'year', label: '年份', type: 'number' }] },
        t.revision,
      );
      site.saveEntry({ ...entry('one'), fields: { year: 2026 } }, null);
      const updated = site.store.get('type', 'post')!;
      expect(() =>
        site.saveType(
          { ...updated.value, fields: [{ key: 'year', label: '年份', type: 'text' }] },
          updated.revision,
        ),
      ).toThrow(/不兼容/);
      site.saveType({ ...updated.value, fields: [] }, updated.revision);
      const row = site.store.get('entry', 'one')!;
      expect(site.saveEntry({ ...row.value, fields: {} }, row.revision).value.fields.year).toBe(
        2026,
      );
    } finally {
      site.close();
    }
  });
  it('keeps asynchronous idempotency and interrupted job status', () => {
    const site = fixture('jobs');
    try {
      const one = site.createJob('publish', {}, 'same');
      expect(site.createJob('publish', {}, 'same').id).toBe(one.id);
      expect(() => site.createJob('publish')).toThrow(/正在运行/);
      site.recoverJobs();
      expect(site.job(one.id).status).toBe('failed');
    } finally {
      site.close();
    }
  });
  it('sanitizes document HTML and handles rich documents', () => {
    expect(
      renderDocument({
        version: 1,
        format: 'markdown',
        source: '<script>alert(1)</script>\n\n![图](javascript:alert(1))',
      }),
    ).not.toContain('<script>');
    expect(
      renderDocument({
        version: 1,
        format: 'lexical',
        source: {
          root: {
            type: 'root',
            children: [
              { type: 'paragraph', children: [{ type: 'text', text: '中文', format: 1 }] },
            ],
          },
        },
      }),
    ).toContain('<strong>中文</strong>');
  });
});
describe('media, analytics and backup', () => {
  it('refuses active restore and recovers an interrupted directory switch', async () => {
    const site = fixture('restore-interrupted');
    site.saveEntry(entry('one'), null);
    const release = site.publish();
    const result = await createBackup(site, join(base, 'recovery-backups'));
    site.close();
    const target = join(base, 'recovery-target');
    await restoreBackup(result.path, target, join(base, 'recovery-backups'));
    writeFileSync(
      join(target, 'runtime.json'),
      JSON.stringify({ pid: process.pid, status: 'running' }),
    );
    await expect(
      restoreBackup(result.path, target, join(base, 'recovery-backups')),
    ).rejects.toThrow(/仍在运行/);
    writeFileSync(
      join(target, 'runtime.json'),
      JSON.stringify({ pid: process.pid, status: 'stopped' }),
    );
    const retained = target + '.retained-test';
    renameSync(target, retained);
    writeFileSync(
      target + '.restore.json',
      JSON.stringify({
        target,
        backup: retained,
        staging: target + '.restore-test',
        status: 'displaced',
      }),
    );
    expect(recoverRestore(target).recovered).toBe(true);
    const restored = new Site(target);
    expect(restored.release()!.id).toBe(release.id);
    restored.close();
  });
  it('generates image derivatives and publishes media references', async () => {
    const site = fixture('media');
    try {
      const data = await sharp({
        create: { width: 1000, height: 600, channels: 3, background: '#315c4b' },
      })
        .png()
        .toBuffer();
      const record = await uploadMedia(site, data, 'image.png');
      expect(record.value.derivatives.length).toBeGreaterThan(1);
      site.saveEntry({ ...entry('photo'), cover: record.value.url }, null);
      expect(site.publish().entries).toHaveLength(1);
    } finally {
      site.close();
    }
  });
  it('deduplicates events and separates timezones and previews', () => {
    const site = fixture('analytics');
    const analytics = new Analytics(site.root);
    try {
      const event = {
        id: 'test-event-1234',
        kind: 'view',
        ts: new Date().toISOString(),
        path: '/posts/one/',
        visitor: 'visitor',
        session: 'session',
      };
      const allowed = new Set([event.path]);
      analytics.collect(event, 'Chrome', allowed);
      analytics.collect(event, 'Chrome', allowed);
      analytics.collect(
        { ...event, id: 'preview-event', path: '/__preview/one' },
        'Chrome',
        allowed,
      );
      expect(analytics.report(new URLSearchParams()).views).toBe(1);
    } finally {
      analytics.close();
      site.close();
    }
  });
  it('restores a validated backup into an empty site and detects corruption', async () => {
    const site = fixture('backup');
    site.saveEntry(entry('one'), null);
    const release = site.publish();
    const result = await createBackup(site, join(base, 'backups'));
    site.close();
    expect(verifyBackup(result.path).files.length).toBeGreaterThan(0);
    const target = join(base, 'restored');
    await restoreBackup(result.path, target, join(base, 'backups'));
    const restored = new Site(target);
    expect(restored.release()?.id).toBe(release.id);
    restored.close();
    const manifest = verifyBackup(result.path);
    writeFileSync(join(result.path, manifest.files[0].path), 'corrupt');
    expect(() => verifyBackup(result.path)).toThrow(/校验失败/);
  });
});
