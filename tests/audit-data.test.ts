import { afterEach, describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { Site, checkEntry, createBackup, exportSite, importSite, restoreBackup, verifyBackup } from '@weava/core';
import { entrySchema } from '@weava/contracts';

const base = 'D:/Tools/cache/weava/tests/audit-data-' + Date.now();
let sequence = 0;
const open: Site[] = [];
const fixture = () => { const site = new Site(join(base, String(sequence++))); open.push(site); return site; };
afterEach(() => { for (const site of open.splice(0)) site.close(); });
const page = (path = '/page/') => entrySchema.parse({ id: 'page', kind: 'page', title: '保留的正文', path, status: 'published' });

describe('audit data boundaries', () => {
  it('WVA-01 rejects an incomplete manifest before replacing an existing site', async () => {
    const site = fixture(), original = site.saveEntry(page(), null);
    const bad = join(base, 'incomplete'); mkdirSync(bad, { recursive: true });
    writeFileSync(join(bad, 'manifest.json'), JSON.stringify({ version: 1, files: [] }));
    expect(() => verifyBackup(bad)).toThrow(/数据库|清单/);
    site.close(); open.splice(open.indexOf(site), 1);
    await expect(restoreBackup(bad, site.root, join(base, 'before'))).rejects.toThrow(/数据库|清单/);
    const reopened = new Site(site.root); open.push(reopened);
    expect(reopened.store.get('entry', original.id)?.value.title).toBe(original.value.title);
    expect(existsSync(site.root + '.restore.json')).toBe(false);
  });

  it('WVA-01 restores only verified members and rejects a corrupted required database', async () => {
    const site = fixture(); site.saveEntry(page(), null); const release = site.publish();
    const backup = await createBackup(site, join(base, 'backups'));
    const extra = 'not-in-manifest.txt'; writeFileSync(join(backup.path, extra), 'unverified');
    const target = join(base, 'restored');
    await restoreBackup(backup.path, target, join(base, 'before'));
    expect(existsSync(join(target, extra))).toBe(false);
    const restored = new Site(target); open.push(restored);
    expect(restored.release()?.id).toBe(release.id);
    const original = readFileSync(join(backup.path, 'weava.sqlite'));
    writeFileSync(join(backup.path, 'weava.sqlite'), 'not a database');
    expect(() => verifyBackup(backup.path)).toThrow(/校验|数据库/);
    writeFileSync(join(backup.path, 'weava.sqlite'), original);
    expect(verifyBackup(backup.path).files.length).toBeGreaterThan(0);
  });

  it('WVA-03 recovers old interrupted jobs beyond two recent-list windows without touching a live worker', () => {
    const site = fixture(), old = site.createJob('publish');
    const alive = site.createJob('verify', { path: 'alive' });
    site.updateJob(alive.id, { status: 'running', workerPid: process.pid });
    for (let i = 0; i < 205; i++) {
      const job = site.createJob('verify', { path: String(i) });
      site.updateJob(job.id, { status: 'complete' });
    }
    expect(site.jobs()).toHaveLength(100);
    site.recoverJobs();
    expect(site.job(old.id).status).toBe('failed');
    expect(site.job(alive.id).status).toBe('running');
    const next = site.createJob('publish'); expect(next.status).toBe('queued');
    for (let wave = 0; wave < 3; wave++) {
      const pending = Array.from({ length: 110 }, (_, i) => site.createJob('verify', { path: `wave-${wave}-${i}` }));
      site.recoverJobs();
      expect(pending.every((job) => site.job(job.id).status === 'failed')).toBe(true);
      expect(site.job(alive.id).status).toBe('running');
    }
    expect(site.job(next.id).status).toBe('failed');
  });

  it('WVA-04 merges taxonomy and settings together while preserving external revision and rollback checks', () => {
    const site = fixture(), initial = site.settings();
    site.saveSettings({ ...initial.value, taxonomies: [{ id: 'topic', kind: 'category', label: 'Before', slug: 'Before' }] }, initial.revision);
    site.saveEntry(page(), null);
    const data = exportSite(site);
    data.terms![0] = { ...data.terms![0], label: 'After' };
    data.settings!.taxonomies[0] = { ...data.settings!.taxonomies[0], label: 'After' };
    const revisions = Object.fromEntries(['term', 'settings'].flatMap((scope) => site.store.list(scope).map((row) => [scope + ':' + row.id, row.revision])));
    const before = JSON.stringify(exportSite(site));
    expect(importSite(site, data, { mode: 'merge', revisions, dryRun: true }).updated).toContain('settings:site');
    expect(JSON.stringify(exportSite(site))).toBe(before);
    expect(importSite(site, data, { mode: 'merge', revisions }).updated).toContain('term:topic');
    expect(site.settings().value.taxonomies[0].label).toBe('After');
    expect(site.terms()[0].value.label).toBe('After');
    const stale = structuredClone(data); stale.settings!.name = 'stale';
    expect(() => importSite(site, stale, { mode: 'merge', revisions })).toThrow(/冲突/);
    expect(site.settings().value.name).not.toBe('stale');
  });

  it('WVA-05 rejects system content addresses in checks, saves, imports and historical publication', () => {
    for (const path of ['/rss.xml', '/sitemap.xml', '/robots.txt']) {
    const site = fixture(), value = page(path);
    expect(checkEntry(site, value).valid).toBe(false);
    expect(() => site.saveEntry(value, null)).toThrow(/系统/);
    expect(() => importSite(site, { version: 1, entries: [value] })).toThrow(/系统/);
    // A persisted revision can predate validation changes. Publication owns its
    // own boundary and must reject that state as well.
    const historical = site.store.put('entry', value.id, value, null, '历史版本');
    expect(() => site.publish({ ids: [value.id], versions: { [value.id]: historical.revision } })).toThrow(/系统/);
    expect(site.release()).toBeNull();
    }
  });
});
