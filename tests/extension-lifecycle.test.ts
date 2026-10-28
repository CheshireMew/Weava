import { afterEach, describe, expect, it } from 'vitest';
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { Site, extension, renderEntryTemplate, type ExtensionManager } from '@weava/core';
import { entrySchema } from '@weava/contracts';
const base = 'D:/Tools/cache/weava/tests/extensions-' + Date.now(); let sequence = 0;
const sites: Site[] = [], managers: ExtensionManager[] = [];
const create = (sources: Record<string, string>, enabled: Record<string, boolean> = {}) => {
  const site = new Site(join(base, String(sequence++))); sites.push(site);
  const folder = join(site.root, 'extensions'); mkdirSync(folder, { recursive: true });
  for (const [id, body] of Object.entries(sources)) writeFileSync(join(folder, id + '.mjs'), body);
  writeFileSync(join(folder, 'manifest.json'), JSON.stringify({ version: 1, extensions: Object.keys(sources).map((id) => ({ id, file: id + '.mjs', enabled: enabled[id] ?? true })) }));
  return site;
};
const open = async (site: Site, events: string[] = [], mode: 'runtime' | 'worker' = 'runtime') => { const manager = await extension(site, { events }, { mode }); managers.push(manager); return manager; };
const core = `export default ({ events }) => ({id:'base',apiVersion:1,version:'1.2.0',start(){events.push('start:base')},stop(){events.push('stop:base')}});`;
const notice = `export default ({events,z}) => ({id:'notice',apiVersion:1,version:'1.0.0',dependencies:[{id:'base',minVersion:'1.1.0'}],blocks:{'notice:banner':(block)=>'<aside>'+block.props.text+'</aside>'},blockDefinitions:{'notice:banner':{label:'公告',fields:[{key:'text',label:'公告正文',control:'textarea',required:true}],schema:z.object({text:z.string().optional()})}},start(){events.push('start:notice')},stop(){events.push('stop:notice')}});`;
afterEach(async () => { for (const manager of managers.splice(0)) await manager.stop(); for (const site of sites.splice(0)) site.close(); });
describe('extension declaration and lifecycle', () => {
  it('orders multiple extensions, shares block forms and validation, and prevents disabling current dependencies and content', async () => {
    const site = create({ notice, base: core }), events: string[] = [], manager = await open(site, events);
    expect(events).toEqual(['start:base', 'start:notice']); expect(manager.status().map((row) => row.status)).toEqual(['active', 'active']);
    expect(site.extensionBlockDefinitions['notice:banner'].fields[0].label).toBe('公告正文');
    expect(() => site.saveEntry(entrySchema.parse({ id: 'bad', kind: 'page', title: '无效参数', path: '/bad/', blocks: [{ id: 'banner', type: 'notice:banner', props: { text: 4 } }] }), null)).toThrow(/参数无效/);
    const row = site.saveEntry(entrySchema.parse({ id: 'page', kind: 'page', title: '公告页面', path: '/page/', status: 'published', blocks: [{ id: 'banner', type: 'notice:banner', props: { text: '扩展公告内容' } }] }), null);
    const release = site.publish(); expect(renderEntryTemplate(release.entries[0], release, manager.blocks)).toContain('扩展公告内容');
    await expect(manager.setEnabled('notice', false, null)).rejects.toThrow(/引用/); await expect(manager.setEnabled('base', false, null)).rejects.toThrow(/引用/);
    expect(manager.usage('notice')).toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'entry', id: row.id }), expect.objectContaining({ kind: 'published', id: row.id })]));
    expect(site.release()!.id).toBe(release.id);
  });
  it('enables and disables with revision guards, reverse stop order and no leftover renderer', async () => {
    const site = create({ notice, base: core }), events: string[] = [], manager = await open(site, events);
    await manager.setEnabled('notice', false, null); expect(manager.status()[0].status).toBe('disabled'); expect(site.blockRenderers['notice:banner']).toBeUndefined();
    expect(events.slice(2, 5)).toEqual(['stop:notice', 'stop:base', 'start:base']);
    await expect(manager.setEnabled('notice', true, null)).rejects.toThrow(/变化/);
    await manager.setEnabled('notice', true, manager.status()[0].configRevision); expect(manager.status()[0].status).toBe('active');
    expect(site.blockRenderers['notice:banner']).toBeTypeOf('function');
  });
  it('isolates missing, incompatible and cyclic dependencies while independent extensions remain available', async () => {
    const site = create({ base: core, missing: `export default()=>({id:'missing',apiVersion:1,dependencies:[{id:'unknown'}]});`, 'too-new': `export default()=>({id:'too-new',apiVersion:1,dependencies:[{id:'base',minVersion:'2.0.0'}]});`, a: `export default()=>({id:'a',apiVersion:1,dependencies:[{id:'b'}]});`, b: `export default()=>({id:'b',apiVersion:1,dependencies:[{id:'a'}]});` });
    const manager = await open(site); expect(manager.status().find((row) => row.id === 'base')!.status).toBe('active');
    expect(manager.status().find((row) => row.id === 'missing')!.error).toContain('unknown');
    expect(manager.status().find((row) => row.id === 'too-new')!.error).toContain('2.0.0');
    expect(manager.status().find((row) => row.id === 'a')!.error).toContain('循环');
  });
  it('backs up before schema migration, commits data and version together, and runs migrations once across processes', async () => {
    const source = `export default({site})=>({id:'data',apiVersion:1,version:'1.0.0',schemaVersion:2,migrations:[{version:1,up(){site.store.put('plugin-data','one',{value:1},null)}},{version:2,up(){site.store.put('plugin-data','two',{value:2},null)}}]});`;
    const site = create({ data: source }), manager = await open(site), status = manager.status()[0];
    expect(status.status).toBe('active'); expect(status.installedSchema).toBe(2); expect(existsSync(status.backup!)).toBe(true);
    const backup = new Database(status.backup!, { readonly: true }); expect(backup.prepare("SELECT COUNT(*) n FROM records WHERE scope='plugin-data'").get()).toEqual({ n: 0 }); backup.close();
    expect(site.store.list('plugin-data')).toHaveLength(2); await manager.stop();
    const another = new Site(site.root); sites.push(another); const worker = await open(another, [], 'worker'); expect(worker.status()[0].status).toBe('active'); expect(another.store.list('plugin-data')).toHaveLength(2);
  });
  it('rolls back every migration write on failure and exposes a diagnostic instead of breaking the admin', async () => {
    const site = create({ broken: `export default({site})=>({id:'broken',apiVersion:1,version:'1.0.0',schemaVersion:2,migrations:[{version:1,up(){site.store.put('plugin-data','one',{value:1},null)}},{version:2,up(){throw new Error('migration interrupted')}}]});` });
    const manager = await open(site); expect(manager.status()[0]).toMatchObject({ status: 'failed', installedSchema: 0, error: 'migration interrupted' }); expect(site.store.list('plugin-data')).toEqual([]);
    expect(site.store.get('extension-installed', 'broken')).toBeNull(); expect(site.settings()).toBeTruthy();
  });
  it('restores the prior enable state when an extension fails to start, and never starts lifecycle hooks in worker mode', async () => {
    const site = create({ base: core, broken: `export default({events})=>({id:'broken',apiVersion:1,version:'1.0.0',start(){events.push('failed:start');throw new Error('service unavailable')},stop(){events.push('failed:stop')}});` }, { broken: false });
    const events: string[] = [], manager = await open(site, events); await expect(manager.setEnabled('broken', true, null)).rejects.toThrow(/service unavailable/);
    expect(manager.status().find((row) => row.id === 'base')!.status).toBe('active'); expect(manager.status().find((row) => row.id === 'broken')!.status).toBe('disabled'); expect(events).toContain('failed:stop');
    const workerSite = create({ base: core }), hooks: string[] = []; const worker = await open(workerSite, hooks, 'worker'); expect(worker.status()[0].status).toBe('active'); expect(hooks).toEqual([]);
  });
  it('supports legacy index factories and rejects code whose data version is older than the installed version', async () => {
    const site = new Site(join(base, String(sequence++))); sites.push(site); writeFileSync(join(site.root, 'extensions', 'index.mjs'), `export default()=>({id:'legacy',apiVersion:1,blocks:{'legacy:text':()=>'<p>legacy</p>'}});`);
    const manager = await open(site); expect(manager.status()[0].status).toBe('active'); expect(manager.blocks['legacy:text']).toBeTypeOf('function');
    const old = create({ old: `export default()=>({id:'old',apiVersion:1,version:'1.0.0'});` }); old.store.put('extension-installed', 'old', { version: '2.0.0', schemaVersion: 2 }, null);
    expect((await open(old)).status()[0].error).toContain('数据版本较新');
  });
});
